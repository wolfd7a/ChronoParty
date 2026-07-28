/**
 * P.O.N. — WebGL2 renderer.
 *
 * Same contract as the software renderer (`resize`, `render(scene)`), a very
 * different pipeline:
 *
 *   1. scene pass   fullscreen fragment shader raycasts the grid into an HDR
 *                   target + a linear-distance target. Normal-mapped GGX
 *                   shading, spotlight torch, dynamic point lights with DDA
 *                   shadows, mirror reflections via a second DDA, volumetrics.
 *   2. sprite pass  instanced billboards, depth-resolved against pass 1.
 *   3. bloom        bright-pass into half res, then widening separable blurs.
 *   4. composite    ACES tonemap, grade, chromatic aberration, vignette, grain.
 *
 * Everything renders at native resolution, so there is no upscale blur.
 */

import { buildSurfaceArrays, buildSpriteArray, LAYER } from './textures.js';
import { MAP_W, MAP_H } from './level.js';
import {
  createGL, program, FULLSCREEN_VS, drawFullscreen,
  createTexture2D, createTextureArray, createFBO, bindTex,
} from './gl/glutil.js';
import {
  SCENE_FS, SPRITE_VS, SPRITE_FS, BRIGHT_FS, BLUR_FS, COMPOSITE_FS,
} from './gl/shaders.js';

const MAX_SPRITES = 64;
const MAX_LIGHTS = 6;

/** quality (the shared detail knob) -> GPU feature set. */
function tier(quality) {
  if (quality <= 240) {
    return { scale: 0.75, vol: 0, reflect: 0, blurs: 2, dprMax: 1, bloom: 0.7 };
  }
  if (quality <= 320) {
    return { scale: 1.0, vol: 14, reflect: 1, blurs: 3, dprMax: 1.5, bloom: 0.9 };
  }
  return { scale: 1.0, vol: 26, reflect: 1, blurs: 4, dprMax: 2, bloom: 1.0 };
}

export class GLRenderer {
  /** @returns {GLRenderer|null} null when WebGL2 / float targets are unavailable */
  static tryCreate(canvas) {
    try {
      const gl = createGL(canvas);
      if (!gl) return null;
      return new GLRenderer(canvas, gl);
    } catch (err) {
      console.warn('[pon] WebGL2 renderer unavailable, falling back:', err.message);
      return null;
    }
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.quality = 320;
    this.iw = 0;
    this.ih = 0;
    this.levelRef = null;

    this.scene = program(gl, FULLSCREEN_VS, SCENE_FS, 'scene');
    this.sprite = program(gl, SPRITE_VS, SPRITE_FS, 'sprite');
    this.bright = program(gl, FULLSCREEN_VS, BRIGHT_FS, 'bright');
    this.blur = program(gl, FULLSCREEN_VS, BLUR_FS, 'blur');
    this.composite = program(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');

    this.emptyVao = gl.createVertexArray();

    this.buildSurfaceTextures();
    this.buildSpriteBuffers();

    this.instPos = new Float32Array(MAX_SPRITES * 4);
    this.instParam = new Float32Array(MAX_SPRITES * 4);
    this.lightPos = new Float32Array(MAX_LIGHTS * 4);
    this.lightCol = new Float32Array(MAX_LIGHTS * 4);
    this.targets = null;
  }

  buildSurfaceTextures() {
    const gl = this.gl;
    const s = buildSurfaceArrays();
    const mk = (data) => createTextureArray(gl, {
      width: s.size, height: s.size, layers: s.layers, data,
    });
    this.texAlbedo = mk(s.albedo);
    this.texNormal = mk(s.normal);
    this.texEmissive = mk(s.emissive);
    this.metal = s.metal;

    const sp = buildSpriteArray();
    this.texSprites = createTextureArray(gl, {
      width: sp.w, height: sp.h, layers: sp.layers, data: sp.data,
      wrap: gl.CLAMP_TO_EDGE, mipmap: true,
    });
    this.spriteMeta = sp.index;
    this.spriteAspect = sp.w / sp.h;
  }

  buildSpriteBuffers() {
    const gl = this.gl;
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.bufPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_SPRITES * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    this.bufParam = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufParam);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_SPRITES * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  /** Grid + baked lighting live on the GPU; they only change when the run resets. */
  uploadLevel(lv) {
    if (this.levelRef === lv) return;
    this.levelRef = lv;
    const gl = this.gl;

    const n = MAP_W * MAP_H;
    const packed = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      packed[i * 4] = lv.walls[i];
      packed[i * 4 + 1] = lv.floors[i];
      packed[i * 4 + 2] = lv.ceils[i];
      packed[i * 4 + 3] = 255;
    }
    if (this.texMap) gl.deleteTexture(this.texMap);
    this.texMap = createTexture2D(gl, {
      width: MAP_W, height: MAP_H,
      internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
      data: packed, filter: gl.NEAREST,
    });

    const toRGBA = (src) => {
      const out = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        out[i * 4] = src[i * 3];
        out[i * 4 + 1] = src[i * 3 + 1];
        out[i * 4 + 2] = src[i * 3 + 2];
        out[i * 4 + 3] = 1;
      }
      return out;
    };
    if (this.texLight) gl.deleteTexture(this.texLight);
    if (this.texFlicker) gl.deleteTexture(this.texFlicker);
    const lightOpts = {
      width: MAP_W, height: MAP_H,
      internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT,
      filter: gl.LINEAR,
    };
    this.texLight = createTexture2D(gl, { ...lightOpts, data: toRGBA(lv.lm) });
    this.texFlicker = createTexture2D(gl, { ...lightOpts, data: toRGBA(lv.lmFlicker) });
  }

  resize(cssW, cssH, quality) {
    const gl = this.gl;
    this.quality = quality || this.quality;
    const t = tier(this.quality);
    const dpr = Math.min(window.devicePixelRatio || 1, t.dprMax);
    const w = Math.max(320, Math.round(cssW * dpr * t.scale));
    const h = Math.max(240, Math.round(cssH * dpr * t.scale));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    if (w === this.iw && h === this.ih) return;
    this.iw = w;
    this.ih = h;
    this.canvas.width = w;
    this.canvas.height = h;

    this.disposeTargets();
    const hdr = (tw, th) => createTexture2D(gl, {
      width: tw, height: th,
      internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT,
      filter: gl.LINEAR,
    });
    const sceneColor = hdr(w, h);
    const sceneDepth = createTexture2D(gl, {
      width: w, height: h,
      internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT,
      filter: gl.NEAREST,
    });
    const bw = Math.max(1, w >> 1);
    const bh = Math.max(1, h >> 1);
    const bloomA = hdr(bw, bh);
    const bloomB = hdr(bw, bh);

    this.targets = {
      sceneColor,
      sceneDepth,
      bloomA,
      bloomB,
      bw,
      bh,
      fboScene: createFBO(gl, [sceneColor, sceneDepth]),
      fboSpriteOnly: createFBO(gl, [sceneColor]),
      fboA: createFBO(gl, [bloomA]),
      fboB: createFBO(gl, [bloomB]),
    };
  }

  disposeTargets() {
    const gl = this.gl;
    const t = this.targets;
    if (!t) return;
    for (const k of ['sceneColor', 'sceneDepth', 'bloomA', 'bloomB']) gl.deleteTexture(t[k]);
    for (const k of ['fboScene', 'fboSpriteOnly', 'fboA', 'fboB']) gl.deleteFramebuffer(t[k]);
    this.targets = null;
  }

  destroy() {
    this.disposeTargets();
    const gl = this.gl;
    for (const t of [this.texAlbedo, this.texNormal, this.texEmissive,
      this.texSprites, this.texMap, this.texLight, this.texFlicker]) {
      if (t) gl.deleteTexture(t);
    }
  }

  /* ---------------------------------------------------------------- */

  render(s) {
    if (!this.targets) return;
    const gl = this.gl;
    const t = tier(this.quality);
    const { iw, ih } = this;
    this.uploadLevel(s.level);

    const horizonPx = (s.horizonN || 0) * ih;
    const fogDensity = 0.055;
    const fog = [0.012, 0.016, 0.026];

    /* ---- 1. scene ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.fboScene);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, iw, ih);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);

    const P = this.scene;
    gl.useProgram(P.program);
    gl.uniform2f(P.u.uRes, iw, ih);
    gl.uniform2f(P.u.uCam, s.cam.x, s.cam.y);
    gl.uniform1f(P.u.uCamZ, s.camZ);
    gl.uniform2f(P.u.uDir, s.cam.dirX, s.cam.dirY);
    gl.uniform2f(P.u.uPlane, s.cam.planeX, s.cam.planeY);
    gl.uniform1f(P.u.uHorizon, horizonPx);
    gl.uniform2f(P.u.uMapSize, MAP_W, MAP_H);
    gl.uniform1f(P.u.uFlickerAmt, s.flicker);
    gl.uniform1f(P.u.uTime, s.time);
    gl.uniform1fv(P.u.uMetal, this.metal);

    const fl = s.flashlight;
    gl.uniform1f(P.u.uTorchOn, fl.on ? 1 : 0);
    gl.uniform1f(P.u.uTorchI, fl.intensity);
    gl.uniform1f(P.u.uTorchCos, Math.cos(fl.cone));
    gl.uniform1f(P.u.uTorchRange, fl.range);

    const lights = (s.lights || []).slice(0, MAX_LIGHTS);
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      this.lightPos[i * 4] = L.x;
      this.lightPos[i * 4 + 1] = L.y;
      this.lightPos[i * 4 + 2] = L.z;
      this.lightPos[i * 4 + 3] = L.radius;
      this.lightCol[i * 4] = L.r;
      this.lightCol[i * 4 + 1] = L.g;
      this.lightCol[i * 4 + 2] = L.b;
      this.lightCol[i * 4 + 3] = L.intensity;
    }
    gl.uniform1i(P.u.uNumLights, lights.length);
    gl.uniform4fv(P.u.uLightPos, this.lightPos);
    gl.uniform4fv(P.u.uLightCol, this.lightCol);

    gl.uniform1i(P.u.uVolSteps, t.vol);
    gl.uniform1i(P.u.uReflect, t.reflect);
    gl.uniform1f(P.u.uFogDensity, fogDensity);
    gl.uniform3f(P.u.uFogColor, fog[0], fog[1], fog[2]);

    bindTex(gl, 0, gl.TEXTURE_2D, this.texMap, P.u.uMap);
    bindTex(gl, 1, gl.TEXTURE_2D, this.texLight, P.u.uLight);
    bindTex(gl, 2, gl.TEXTURE_2D, this.texFlicker, P.u.uFlicker);
    bindTex(gl, 3, gl.TEXTURE_2D_ARRAY, this.texAlbedo, P.u.uAlbedo);
    bindTex(gl, 4, gl.TEXTURE_2D_ARRAY, this.texNormal, P.u.uNormal);
    bindTex(gl, 5, gl.TEXTURE_2D_ARRAY, this.texEmissive, P.u.uEmissive);
    drawFullscreen(gl);

    /* ---- 2. sprites ---- */
    this.drawSprites(s, horizonPx, fogDensity, fog);

    /* ---- 3. bloom ---- */
    const T = this.targets;
    gl.bindVertexArray(this.emptyVao);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, T.bw, T.bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fboA);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.useProgram(this.bright.program);
    gl.uniform1f(this.bright.u.uThreshold, 1.05);
    gl.uniform1f(this.bright.u.uKnee, 0.55);
    bindTex(gl, 0, gl.TEXTURE_2D, T.sceneColor, this.bright.u.uTex);
    drawFullscreen(gl);

    gl.useProgram(this.blur.program);
    gl.uniform2f(this.blur.u.uTexel, 1 / T.bw, 1 / T.bh);
    let src = T.bloomA;
    let dstFbo = T.fboB;
    let dstTex = T.bloomB;
    for (let i = 0; i < t.blurs; i++) {
      const radius = 1 << i;
      for (const dir of [[radius, 0], [0, radius]]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
        gl.uniform2f(this.blur.u.uDirection, dir[0], dir[1]);
        bindTex(gl, 0, gl.TEXTURE_2D, src, this.blur.u.uTex);
        drawFullscreen(gl);
        const tmpTex = src;
        src = dstTex;
        dstTex = tmpTex;
        dstFbo = dstFbo === T.fboA ? T.fboB : T.fboA;
      }
    }

    /* ---- 4. composite ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, iw, ih);
    const C = this.composite;
    gl.useProgram(C.program);
    bindTex(gl, 0, gl.TEXTURE_2D, T.sceneColor, C.u.uScene);
    bindTex(gl, 1, gl.TEXTURE_2D, src, C.u.uBloom);
    gl.uniform1f(C.u.uBloomAmt, t.bloom * 0.9);
    gl.uniform1f(C.u.uExposure, 0.9);
    gl.uniform1f(C.u.uTime, s.time);
    gl.uniform1f(C.u.uGrain, 0.014 + (s.fear || 0) * 0.05);
    gl.uniform1f(C.u.uDread, s.dread || 0);
    gl.uniform1f(C.u.uBlind, s.blind || 0);
    gl.uniform1f(C.u.uAberration, 1);
    gl.uniform2f(C.u.uRes, iw, ih);
    drawFullscreen(gl);
  }

  drawSprites(s, horizonPx, fogDensity, fog) {
    const gl = this.gl;
    const T = this.targets;
    const cam = s.cam;

    const list = [];
    for (const sp of s.sprites) {
      const meta = this.spriteMeta[sp.kind];
      if (!meta) continue;
      const rx = sp.x - cam.x;
      const ry = sp.y - cam.y;
      // Depth along the view axis, matching the projection used in the shader.
      const depth = rx * cam.dirX + ry * cam.dirY;
      if (depth < 0.05) continue;
      list.push({ sp, meta, depth });
    }
    if (!list.length) return;
    list.sort((a, b) => b.depth - a.depth);
    const count = Math.min(list.length, MAX_SPRITES);

    for (let i = 0; i < count; i++) {
      const { sp, meta } = list[i];
      const cellH = sp.worldH / meta.contentH;
      const zBase = (sp.z || 0) - (cellH - sp.worldH) * 0.5;
      this.instPos[i * 4] = sp.x;
      this.instPos[i * 4 + 1] = sp.y;
      this.instPos[i * 4 + 2] = zBase;
      this.instPos[i * 4 + 3] = cellH;
      this.instParam[i * 4] = meta.layer;
      this.instParam[i * 4 + 1] = sp.glow || 0;
      this.instParam[i * 4 + 2] = sp.lightMul || 1;
      this.instParam[i * 4 + 3] = 0;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fboSpriteOnly);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, this.iw, this.ih);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instPos, 0, count * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufParam);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instParam, 0, count * 4);

    const S = this.sprite;
    gl.useProgram(S.program);
    gl.uniform2f(S.u.uCam, cam.x, cam.y);
    gl.uniform1f(S.u.uCamZ, s.camZ);
    gl.uniform2f(S.u.uDir, cam.dirX, cam.dirY);
    gl.uniform2f(S.u.uPlane, cam.planeX, cam.planeY);
    gl.uniform1f(S.u.uHorizon, horizonPx);
    gl.uniform2f(S.u.uRes, this.iw, this.ih);
    gl.uniform1f(S.u.uAspect, this.spriteAspect);
    gl.uniform2f(S.u.uMapSize, MAP_W, MAP_H);
    gl.uniform1f(S.u.uFlickerAmt, s.flicker);
    const fl = s.flashlight;
    gl.uniform1f(S.u.uTorchOn, fl.on ? 1 : 0);
    gl.uniform1f(S.u.uTorchI, fl.intensity);
    gl.uniform1f(S.u.uTorchCos, Math.cos(fl.cone));
    gl.uniform1f(S.u.uTorchRange, fl.range);
    gl.uniform1f(S.u.uFogDensity, fogDensity);
    gl.uniform3f(S.u.uFogColor, fog[0], fog[1], fog[2]);
    bindTex(gl, 0, gl.TEXTURE_2D_ARRAY, this.texSprites, S.u.uSprites);
    bindTex(gl, 1, gl.TEXTURE_2D, T.sceneDepth, S.u.uSceneDepth);
    bindTex(gl, 2, gl.TEXTURE_2D, this.texLight, S.u.uLight);
    bindTex(gl, 3, gl.TEXTURE_2D, this.texFlicker, S.u.uFlicker);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}

export { LAYER };
