/**
 * P.O.N. — software raycasting renderer.
 *
 * Renders at a low internal resolution into an ImageData buffer and upscales
 * with smoothing off. That is a deliberate look (grain + chunky pixels read as
 * a body-cam), but it is also what makes per-pixel lighting affordable: the
 * flashlight cone, the baked lightmap and the fog are all evaluated per pixel
 * rather than faked with overlays.
 *
 * Coordinate conventions follow the classic Lode Vandevenne raycaster: `dir`
 * is the view vector, `plane` is the camera plane whose length sets the FOV,
 * and a pixel `y` maps to a vertical tangent of `(y - horizon) / height`.
 */

import { TEX_SIZE, buildAtlas } from './textures.js';
import { sampleLight, MAP_W } from './level.js';

const FOG_LUT_SIZE = 512;
const FOG_MAX_DIST = 34;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.atlas = buildAtlas();
    this.iw = 0;
    this.ih = 0;
    this.quality = 300;
    this.tmpA = new Float32Array(3);
    this.tmpB = new Float32Array(3);
    this.tmpC = new Float32Array(3);
    this.buildFogLut();
    this.buildNoise();
  }

  buildFogLut() {
    // Index is distance * (FOG_LUT_SIZE / FOG_MAX_DIST); value is how much of
    // the surface survives the murk.
    this.fogLut = new Float32Array(FOG_LUT_SIZE);
    for (let i = 0; i < FOG_LUT_SIZE; i++) {
      const d = (i / FOG_LUT_SIZE) * FOG_MAX_DIST;
      this.fogLut[i] = 1 / (1 + d * 0.055 + d * d * 0.0072);
    }
  }

  buildNoise() {
    // A tiled grain field, scrolled per frame — far cheaper than per-pixel RNG.
    const S = 128;
    this.noiseSize = S;
    this.noise = new Float32Array(S * S);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < S * S; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      this.noise[i] = ((seed >>> 0) / 4294967296 - 0.5);
    }
  }

  /** `quality` is the internal render height in pixels. */
  resize(cssW, cssH, quality) {
    const dpr = 1; // internal buffer is already the resolution knob
    const q = quality || this.quality;
    const aspect = cssW / Math.max(1, cssH);
    const ih = Math.max(120, Math.round(q));
    const iw = Math.max(160, Math.round(ih * aspect));
    this.quality = q;
    if (iw === this.iw && ih === this.ih && this.cssW === cssW && this.cssH === cssH) return;
    this.iw = iw;
    this.ih = ih;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.imageSmoothingEnabled = false;

    this.img = this.ctx.createImageData(iw, ih);
    this.data = this.img.data;
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
    this.zbuf = new Float32Array(iw);
    this.scratch = document.createElement('canvas');
    this.scratch.width = iw;
    this.scratch.height = ih;
    this.sctx = this.scratch.getContext('2d');
    this.sctx.imageSmoothingEnabled = false;

    // Vignette weight per pixel, computed once per resize.
    this.vig = new Float32Array(iw * ih);
    const cx = iw / 2;
    const cy = ih / 2;
    const maxR = Math.hypot(cx, cy);
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const r = Math.hypot(x - cx, y - cy) / maxR;
        this.vig[y * iw + x] = Math.max(0, 1 - 0.85 * r ** 2.4);
      }
    }
  }

  /**
   * @param {object} s scene — { level, cam:{x,y,dirX,dirY,planeX,planeY},
   *   horizonN, camZ, flashlight:{on,intensity,cone,range}, sprites:[],
   *   time, flicker, dread, blind, fear }
   */
  render(s) {
    if (!this.iw) return;
    this.drawWorldAndFloor(s);
    this.drawSprites(s);
    this.post(s);
    this.sctx.putImageData(this.img, 0, 0);
    this.ctx.drawImage(this.scratch, 0, 0, this.canvas.width, this.canvas.height);
  }

  /* -------------------------------------------------------------- */

  drawWorldAndFloor(s) {
    const { iw, ih, data, zbuf, fogLut, tmpA, tmpB } = this;
    const lv = s.level;
    const cam = s.cam;
    const px = cam.x;
    const py = cam.y;
    const { dirX, dirY, planeX, planeY } = cam;
    // Eye height is faked by sliding the horizon; the GPU path models it for
    // real, which is why the scene carries `camZ` rather than a pixel offset.
    const horizon = ih * (0.5 + (s.horizonN || 0) + (0.5 - s.camZ));
    const posZ = 0.5 * ih;
    const flick = s.flicker;
    const atlas = this.atlas;
    const fogScale = FOG_LUT_SIZE / FOG_MAX_DIST;

    // Flashlight parameters, expressed as tangents so no trig runs per pixel.
    const fl = s.flashlight;
    const flOn = fl && fl.on && fl.intensity > 0.01;
    const coneT = fl ? Math.tan(fl.cone) : 0;
    const coneT2 = coneT * coneT;
    const coneInner2 = (coneT * 0.55) ** 2;
    const flI = fl ? fl.intensity : 0;
    const flRange = fl ? fl.range : 1;

    for (let x = 0; x < iw; x++) {
      const cameraX = (2 * x) / iw - 1;
      const rayDirX = dirX + planeX * cameraX;
      const rayDirY = dirY + planeY * cameraX;
      // Horizontal tangent of this column relative to the view axis.
      const tH = cameraX * Math.hypot(planeX, planeY);
      const tH2 = tH * tH;

      let mapX = px | 0;
      let mapY = py | 0;
      const deltaX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
      const deltaY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
      let stepX;
      let stepY;
      let sideDistX;
      let sideDistY;
      if (rayDirX < 0) {
        stepX = -1;
        sideDistX = (px - mapX) * deltaX;
      } else {
        stepX = 1;
        sideDistX = (mapX + 1 - px) * deltaX;
      }
      if (rayDirY < 0) {
        stepY = -1;
        sideDistY = (py - mapY) * deltaY;
      } else {
        stepY = 1;
        sideDistY = (mapY + 1 - py) * deltaY;
      }

      let side = 0;
      let mat = 0;
      let guard = 0;
      while (guard++ < 256) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaY;
          mapY += stepY;
          side = 1;
        }
        if (mapX < 0 || mapY < 0 || mapX >= lv.w || mapY >= lv.h) {
          mat = 1;
          break;
        }
        mat = lv.walls[mapY * MAP_W + mapX];
        if (mat) break;
      }

      const perp = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;
      const dist = Math.max(0.02, perp);
      zbuf[x] = dist;

      const lineH = ih / dist;
      const wallTop = horizon - lineH * 0.5;
      const wallBot = horizon + lineH * 0.5;
      const drawStart = Math.max(0, Math.ceil(wallTop));
      const drawEnd = Math.min(ih - 1, Math.floor(wallBot));

      /* ---- ceiling ---- */
      this.castHorizontal(
        s, x, 0, drawStart - 1, true,
        horizon, posZ, rayDirX, rayDirY, px, py, flick, tH2,
        flOn, coneT2, coneInner2, flI, flRange, fogScale,
      );

      /* ---- wall ---- */
      if (drawEnd >= drawStart && mat) {
        const tex = atlas.walls[mat] || atlas.walls[1];
        let wallX = side === 0 ? py + dist * rayDirY : px + dist * rayDirX;
        wallX -= Math.floor(wallX);
        let texX = (wallX * TEX_SIZE) | 0;
        if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) {
          texX = TEX_SIZE - texX - 1;
        }
        // Sample the baked light just in front of the surface so the wall
        // picks up the light of the room it faces, not the solid behind it.
        const hitX = px + dist * rayDirX - rayDirX * 0.04;
        const hitY = py + dist * rayDirY - rayDirY * 0.04;
        sampleLight(lv, hitX, hitY, flick, tmpA);
        const sideMul = side === 1 ? 0.72 : 1;
        const fog = fogLut[Math.min(FOG_LUT_SIZE - 1, (dist * fogScale) | 0)];

        const texStep = TEX_SIZE / lineH;
        let texPos = (drawStart - horizon + lineH * 0.5) * texStep;
        const td = tex.data;

        for (let y = drawStart; y <= drawEnd; y++) {
          const texY = texPos & (TEX_SIZE - 1);
          texPos += texStep;
          const ti = ((texY * TEX_SIZE) + texX) * 4;

          let lr = tmpA[0] * sideMul;
          let lg = tmpA[1] * sideMul;
          let lb = tmpA[2] * sideMul;

          if (flOn) {
            const tV = (y - horizon) / ih;
            const a = tH2 + tV * tV;
            if (a < coneT2) {
              const edge = a <= coneInner2 ? 1 : 1 - (a - coneInner2) / (coneT2 - coneInner2);
              const rangeF = Math.max(0, 1 - dist / flRange);
              // Near-field attenuation: the beam has not spread yet at point
              // blank, so a wall you are touching does not white out.
              const near = dist < 1.2 ? dist * 0.83 : 1;
              const k = flI * edge * edge * rangeF * rangeF * near;
              lr += k * 1.05;
              lg += k * 1.0;
              lb += k * 0.92;
            }
          }

          const o = (y * iw + x) * 4;
          data[o] = td[ti] * lr * fog;
          data[o + 1] = td[ti + 1] * lg * fog;
          data[o + 2] = td[ti + 2] * lb * fog;
        }
      }

      /* ---- floor ---- */
      this.castHorizontal(
        s, x, drawEnd + 1, ih - 1, false,
        horizon, posZ, rayDirX, rayDirY, px, py, flick, tH2,
        flOn, coneT2, coneInner2, flI, flRange, fogScale,
      );

      // silence the unused-binding lint for the second scratch vector
      void tmpB;
    }
  }

  /**
   * Floor and ceiling share one routine — they differ only in which texture
   * array they read and which side of the horizon they occupy.
   * Lighting is sampled every 4 rows and linearly interpolated between; the
   * lightmap is smooth enough that the difference is invisible and it removes
   * three quarters of the bilinear work.
   */
  castHorizontal(
    s, x, yFrom, yTo, isCeiling,
    horizon, posZ, rayDirX, rayDirY, px, py, flick, tH2,
    flOn, coneT2, coneInner2, flI, flRange, fogScale,
  ) {
    if (yTo < yFrom) return;
    const { iw, ih, data, fogLut, tmpA, tmpB } = this;
    const lv = s.level;
    const atlas = this.atlas;
    const texArr = isCeiling ? atlas.ceils : atlas.floors;
    const typeArr = isCeiling ? lv.ceils : lv.floors;

    let lr = 0;
    let lg = 0;
    let lb = 0;
    let dr = 0;
    let dg = 0;
    let db = 0;
    let nextSample = yFrom;

    for (let y = yFrom; y <= yTo; y++) {
      const denom = isCeiling ? horizon - y : y - horizon;
      if (denom <= 0.0001) continue;
      const rowDist = posZ / denom;
      if (rowDist > FOG_MAX_DIST * 1.4) continue;
      const fx = px + rowDist * rayDirX;
      const fy = py + rowDist * rayDirY;

      if (y >= nextSample) {
        sampleLight(lv, fx, fy, flick, tmpA);
        const d2 = isCeiling ? horizon - (y - 4) : y + 4 - horizon;
        if (d2 > 0.0001) {
          const rd2 = posZ / d2;
          sampleLight(lv, px + rd2 * rayDirX, py + rd2 * rayDirY, flick, tmpB);
          dr = (tmpB[0] - tmpA[0]) / 4;
          dg = (tmpB[1] - tmpA[1]) / 4;
          db = (tmpB[2] - tmpA[2]) / 4;
        } else {
          dr = dg = db = 0;
        }
        lr = tmpA[0];
        lg = tmpA[1];
        lb = tmpA[2];
        nextSample = y + 4;
      }

      const cellX = fx | 0;
      const cellY = fy | 0;
      let ci = 0;
      if (cellX >= 0 && cellY >= 0 && cellX < lv.w && cellY < lv.h) {
        ci = typeArr[cellY * MAP_W + cellX];
      }
      const tex = texArr[ci] || texArr[0];
      const td = tex.data;
      const tx = ((fx - cellX) * TEX_SIZE) & (TEX_SIZE - 1);
      const ty = ((fy - cellY) * TEX_SIZE) & (TEX_SIZE - 1);
      const ti = ((ty * TEX_SIZE) + tx) * 4;

      let rr = lr;
      let gg = lg;
      let bb = lb;
      if (flOn) {
        const tV = (y - horizon) / ih;
        const a = tH2 + tV * tV;
        if (a < coneT2) {
          const edge = a <= coneInner2 ? 1 : 1 - (a - coneInner2) / (coneT2 - coneInner2);
          const rangeF = Math.max(0, 1 - rowDist / flRange);
          const near = rowDist < 1.2 ? rowDist * 0.83 : 1;
          const k = flI * edge * edge * rangeF * rangeF * near;
          rr += k * 1.05;
          gg += k * 1.0;
          bb += k * 0.92;
        }
      }

      const fog = fogLut[Math.min(FOG_LUT_SIZE - 1, (rowDist * fogScale) | 0)];
      const o = (y * iw + x) * 4;
      data[o] = td[ti] * rr * fog;
      data[o + 1] = td[ti + 1] * gg * fog;
      data[o + 2] = td[ti + 2] * bb * fog;

      lr += dr;
      lg += dg;
      lb += db;
    }
  }

  /* -------------------------------------------------------------- */

  /**
   * Scenes name their sprites rather than carrying a texture, so the same
   * scene object can be consumed by either renderer.
   */
  texForKind(kind) {
    const a = this.atlas;
    if (kind.startsWith('predator')) return a.predator[+kind.slice(8) || 0];
    return a[kind] || null;
  }

  drawSprites(s) {
    const { iw, ih, data, zbuf, fogLut, tmpC } = this;
    const cam = s.cam;
    const { dirX, dirY, planeX, planeY } = cam;
    const horizon = ih * (0.5 + (s.horizonN || 0) + (0.5 - s.camZ));
    const fogScale = FOG_LUT_SIZE / FOG_MAX_DIST;
    const invDet = 1 / (planeX * dirY - dirX * planeY);

    const fl = s.flashlight;
    const flOn = fl && fl.on && fl.intensity > 0.01;
    const coneT = fl ? Math.tan(fl.cone) : 0;
    const coneT2 = coneT * coneT;
    const coneInner2 = (coneT * 0.55) ** 2;
    const planeLen = Math.hypot(planeX, planeY);

    const list = s.sprites
      .map((sp) => {
        const rx = sp.x - cam.x;
        const ry = sp.y - cam.y;
        return { sp, d2: rx * rx + ry * ry, rx, ry };
      })
      .sort((a, b) => b.d2 - a.d2);

    for (const { sp, rx, ry } of list) {
      const tex = this.texForKind(sp.kind);
      if (!tex) continue;
      const tX = invDet * (dirY * rx - dirX * ry);
      const tY = invDet * (-planeY * rx + planeX * ry);
      if (tY < 0.12) continue;

      const worldH = sp.worldH || 1;
      const worldW = worldH * (tex.w / tex.h) * (sp.aspect || 1);
      const screenX = (iw / 2) * (1 + tX / tY);
      const spriteH = Math.abs((ih / tY) * worldH);
      const spriteW = Math.abs((ih / tY) * worldW);
      const baseY = horizon + (0.5 - (sp.z || 0)) * (ih / tY);
      const startY = Math.max(0, Math.floor(baseY - spriteH));
      const endY = Math.min(ih - 1, Math.floor(baseY));
      const startX = Math.max(0, Math.floor(screenX - spriteW / 2));
      const endX = Math.min(iw - 1, Math.floor(screenX + spriteW / 2));
      if (endX < startX || endY < startY) continue;

      sampleLight(s.level, sp.x, sp.y, s.flicker, tmpC);
      let lr = tmpC[0] * (sp.lightMul || 1);
      let lg = tmpC[1] * (sp.lightMul || 1);
      let lb = tmpC[2] * (sp.lightMul || 1);
      const dist = Math.hypot(rx, ry);
      if (flOn) {
        const tHs = (screenX / iw * 2 - 1) * planeLen;
        const a = tHs * tHs;
        if (a < coneT2) {
          const edge = a <= coneInner2 ? 1 : 1 - (a - coneInner2) / (coneT2 - coneInner2);
          const rangeF = Math.max(0, 1 - dist / fl.range);
          const near = dist < 1.2 ? dist * 0.83 : 1;
          const k = fl.intensity * edge * rangeF * rangeF * near;
          lr += k * 1.05;
          lg += k;
          lb += k * 0.92;
        }
      }
      const fog = fogLut[Math.min(FOG_LUT_SIZE - 1, (dist * fogScale) | 0)];
      const glowBoost = sp.glow || 0;
      const td = tex.data;

      for (let x = startX; x <= endX; x++) {
        if (tY >= zbuf[x]) continue;
        const texX = (((x - (screenX - spriteW / 2)) * tex.w) / spriteW) | 0;
        if (texX < 0 || texX >= tex.w) continue;
        for (let y = startY; y <= endY; y++) {
          const texY = (((y - (baseY - spriteH)) * tex.h) / spriteH) | 0;
          if (texY < 0 || texY >= tex.h) continue;
          const ti = (texY * tex.w + texX) * 4;
          const a = td[ti + 3];
          if (a < 6) continue;
          const sr = td[ti];
          const sg = td[ti + 1];
          const sb = td[ti + 2];
          // Bright texels are treated as self-lit — this is what keeps the
          // predator's eyes and the exit sign visible in a pitch-black room.
          const lum = (sr * 0.299 + sg * 0.587 + sb * 0.114) / 255;
          const em = lum > 0.62 ? (lum - 0.62) * 2.8 * (1 + glowBoost) : 0;
          const mr = lr * fog + em;
          const mg = lg * fog + em;
          const mb = lb * fog + em;
          const o = (y * iw + x) * 4;
          const af = a / 255;
          const ia = 1 - af;
          data[o] = data[o] * ia + sr * mr * af;
          data[o + 1] = data[o + 1] * ia + sg * mg * af;
          data[o + 2] = data[o + 2] * ia + sb * mb * af;
        }
      }
    }
  }

  /* -------------------------------------------------------------- */

  /** Vignette, film grain, dread tint and the takedown whiteout, in one pass. */
  post(s) {
    const { iw, ih, data, vig, noise, noiseSize } = this;
    const grainAmt = 7 + (s.fear || 0) * 26;
    const ox = (s.time * 91) & (noiseSize - 1);
    const oy = (s.time * 57) & (noiseSize - 1);
    const dread = s.dread || 0;
    // Blood-warm push as the thing closes in, plus a cold crush elsewhere.
    const tintR = 1 + dread * 0.32;
    const tintG = 1 - dread * 0.16;
    const tintB = 1 - dread * 0.2;
    const blind = s.blind || 0;

    for (let y = 0; y < ih; y++) {
      const nrow = ((y + oy) & (noiseSize - 1)) * noiseSize;
      for (let x = 0; x < iw; x++) {
        const i = y * iw + x;
        const o = i * 4;
        const v = vig[i];
        const n = noise[nrow + ((x + ox) & (noiseSize - 1))] * grainAmt;
        let r = data[o] * v * tintR + n;
        let g = data[o + 1] * v * tintG + n;
        let b = data[o + 2] * v * tintB + n;
        if (blind > 0) {
          r += 255 * blind;
          g += 245 * blind;
          b += 240 * blind;
        }
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      }
    }
  }
}
