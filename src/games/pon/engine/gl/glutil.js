/**
 * P.O.N. — minimal WebGL2 helpers.
 *
 * Deliberately small: this renderer draws exactly one primitive shape (a
 * fullscreen triangle) plus one instanced quad buffer, so there is no need for
 * a scene graph, a material system, or anything else a real engine would have.
 */

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  // Float render targets are required for HDR; without them, bail to software.
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  gl.getExtension('OES_texture_float_linear');
  return gl;
}

export function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[pon/gl] ${label} failed to compile:\n${log}`);
  }
  return sh;
}

export function program(gl, vsSrc, fsSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`[pon/gl] ${label} failed to link:\n${log}`);
  }
  // Cache every uniform location up front — location lookups are not free and
  // this renderer sets most uniforms every frame.
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { program: p, u: uniforms };
}

/** A single oversized triangle covers the viewport with no vertex buffer. */
export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function drawFullscreen(gl) {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function createTexture2D(gl, opts) {
  const {
    width, height, internalFormat, format, type,
    data = null, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE,
  } = opts;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
}

export function createTextureArray(gl, opts) {
  const {
    width, height, layers, data,
    filter = gl.LINEAR, wrap = gl.REPEAT, mipmap = true,
  } = opts;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  const levels = mipmap ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, width, height, layers);
  gl.texSubImage3D(
    gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0,
    width, height, layers, gl.RGBA, gl.UNSIGNED_BYTE, data,
  );
  if (mipmap) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(
    gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER,
    mipmap ? gl.LINEAR_MIPMAP_LINEAR : filter,
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, wrap);
  return t;
}

/** Colour-only framebuffer; `attachments` is a list of textures. */
export function createFBO(gl, attachments) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const bufs = [];
  attachments.forEach((tex, i) => {
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0,
    );
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  });
  gl.drawBuffers(bufs);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`[pon/gl] incomplete framebuffer: 0x${status.toString(16)}`);
  }
  return fbo;
}

export function bindTex(gl, unit, target, tex, loc) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, tex);
  if (loc) gl.uniform1i(loc, unit);
}
