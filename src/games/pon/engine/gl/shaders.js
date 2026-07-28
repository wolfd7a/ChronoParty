/**
 * P.O.N. — GLSL for the WebGL2 renderer.
 *
 * The scene pass is a single fullscreen fragment shader that raycasts the grid
 * directly. That is unusual, and it is the right call here: the world is a
 * uniform grid of unit-height boxes, so a DDA gives *exact* primary visibility
 * with no geometry, no z-fighting and no LOD — and, crucially, the same DDA is
 * reusable for reflection rays and shadow rays, which is where most of the
 * visual gain over the software renderer comes from.
 */

/* ------------------------------------------------------------------ */
/* shared GLSL                                                         */
/* ------------------------------------------------------------------ */

const COMMON = `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

const float PI = 3.14159265359;

// Interleaved gradient noise — cheap, stable under motion, and good enough to
// break up both volumetric banding and tonemapped gradients.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/* ------------------------------------------------------------------ */
/* scene pass                                                          */
/* ------------------------------------------------------------------ */

export const SCENE_FS = `#version 300 es
${COMMON}

in vec2 vUv;
layout(location = 0) out vec4 oColor;   // HDR radiance
layout(location = 1) out vec4 oDepth;   // linear perpendicular distance

uniform vec2  uRes;
uniform vec2  uCam;          // world xy
uniform float uCamZ;         // eye height, 0..1 within the storey
uniform vec2  uDir;
uniform vec2  uPlane;
uniform float uHorizon;      // horizon offset in pixels (pitch + bob + crouch)

uniform sampler2D uMap;      // r = wall material, g = floor type, b = ceil type
uniform sampler2D uLight;    // baked static lighting, one texel per cell
uniform sampler2D uFlicker;  // flickering fixtures, added on top
uniform float uFlickerAmt;
uniform vec2  uMapSize;

uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormal;   // rgb tangent normal, a roughness
uniform sampler2DArray uEmissive;
uniform float uMetal[14];

uniform float uTime;
uniform float uTorchOn;
uniform float uTorchI;
uniform float uTorchCos;     // cosine of the outer cone half-angle
uniform float uTorchRange;

uniform int   uNumLights;
uniform vec4  uLightPos[6];  // xyz world, w radius
uniform vec4  uLightCol[6];  // rgb, w intensity

uniform int   uVolSteps;     // 0 disables volumetrics
uniform int   uReflect;      // 0 disables reflection rays
uniform float uFogDensity;
uniform vec3  uFogColor;

struct Hit {
  bool  hit;
  float t;        // perpendicular distance
  vec3  p;        // world position (z is height within the storey)
  vec3  n;        // geometric normal
  vec2  uv;
  int   layer;
  int   kind;     // 0 wall, 1 floor, 2 ceiling
};

vec3 mapAt(vec2 cell) {
  return texture(uMap, (cell + 0.5) / uMapSize).rgb;
}

bool solid(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uMapSize.x || cell.y >= uMapSize.y) return true;
  return mapAt(cell).r > 0.0015;
}

/**
 * Walk the grid until a wall is hit, then decide whether the floor or ceiling
 * plane is actually nearer. rd2 is the horizontal ray whose projection on the
 * view axis is unit length, so the returned t is a true perpendicular distance
 * and the whole thing stays consistent with the classic raycaster projection.
 */
Hit trace(vec2 ro, vec2 rd2, float roZ, float tV, float maxT) {
  Hit h;
  h.hit = false; h.t = maxT; h.kind = 0; h.layer = 0;
  h.p = vec3(ro, roZ); h.n = vec3(0.0, 0.0, 1.0); h.uv = vec2(0.0);

  // Where the horizontal ray would meet the floor (z=0) or ceiling (z=1).
  float tPlane = maxT;
  int planeKind = -1;
  if (tV > 1e-5) {
    tPlane = roZ / tV;
    planeKind = 1;
  } else if (tV < -1e-5) {
    tPlane = (1.0 - roZ) / (-tV);
    planeKind = 2;
  }

  vec2 cell = floor(ro);
  vec2 delta = abs(1.0 / max(abs(rd2), vec2(1e-6)));
  vec2 stp = sign(rd2);
  vec2 side = (stp * (cell - ro) + stp * 0.5 + 0.5) * delta;

  float t = 0.0;
  int axis = 0;
  bool wall = false;
  for (int i = 0; i < 192; i++) {
    if (side.x < side.y) { t = side.x; side.x += delta.x; cell.x += stp.x; axis = 0; }
    else                 { t = side.y; side.y += delta.y; cell.y += stp.y; axis = 1; }
    if (t > min(maxT, tPlane)) break;
    if (solid(cell)) { wall = true; break; }
  }

  if (wall && t <= tPlane) {
    h.hit = true;
    h.t = t;
    vec2 pxy = ro + rd2 * t;
    float z = roZ - tV * t;
    h.p = vec3(pxy, z);
    h.kind = 0;
    float mat = floor(mapAt(cell).r * 255.0 + 0.5);
    h.layer = int(mat) - 1;
    if (axis == 0) {
      h.n = vec3(-stp.x, 0.0, 0.0);
      // Mirror u on the far face so tiling never seams at a corner.
      h.uv = vec2(stp.x > 0.0 ? 1.0 - fract(pxy.y) : fract(pxy.y), 1.0 - z);
    } else {
      h.n = vec3(0.0, -stp.y, 0.0);
      h.uv = vec2(stp.y > 0.0 ? fract(pxy.x) : 1.0 - fract(pxy.x), 1.0 - z);
    }
    return h;
  }

  if (planeKind > 0 && tPlane < maxT) {
    vec2 pxy = ro + rd2 * tPlane;
    h.hit = true;
    h.t = tPlane;
    h.p = vec3(pxy, planeKind == 1 ? 0.0 : 1.0);
    h.n = vec3(0.0, 0.0, planeKind == 1 ? 1.0 : -1.0);
    h.uv = fract(pxy);
    h.kind = planeKind;
    vec3 m = mapAt(floor(pxy));
    h.layer = planeKind == 1
      ? 8 + int(floor(m.g * 255.0 + 0.5))
      : 12 + int(floor(m.b * 255.0 + 0.5));
  }
  return h;
}

vec3 bakedLight(vec2 p) {
  vec2 uv = p / uMapSize;
  return texture(uLight, uv).rgb + texture(uFlicker, uv).rgb * uFlickerAmt;
}

/**
 * The baked lightmap has no direction, so normal maps would be invisible under
 * it. Its spatial gradient is a decent stand-in for "which way is the light",
 * and it makes brick and grating read as geometry rather than wallpaper.
 */
vec3 bakedDirection(vec2 p) {
  float e = 0.75;
  float lx = luma(bakedLight(p + vec2(e, 0.0))) - luma(bakedLight(p - vec2(e, 0.0)));
  float ly = luma(bakedLight(p + vec2(0.0, e))) - luma(bakedLight(p - vec2(0.0, e)));
  return normalize(vec3(lx, ly, 0.55));
}

/** Trowbridge-Reitz specular, single term, no multiscatter compensation. */
float ggx(vec3 N, vec3 V, vec3 L, float rough) {
  vec3 H = normalize(V + L);
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float ndh = max(dot(N, H), 0.0);
  float ndv = max(dot(N, V), 1e-4);
  float ndl = max(dot(N, L), 0.0);
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float k = a * 0.5;
  float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
  return D * G / (4.0 * ndv * max(ndl, 1e-4)) * ndl;
}

vec3 fresnel(vec3 f0, float ndv) {
  return f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
}

/** Is p visible from lp? One DDA, walls only. */
float shadow(vec3 p, vec3 lp) {
  vec2 d = lp.xy - p.xy;
  float dist = length(d);
  if (dist < 0.05) return 1.0;
  vec2 rd = d / dist;
  vec2 cell = floor(p.xy);
  vec2 delta = abs(1.0 / max(abs(rd), vec2(1e-6)));
  vec2 stp = sign(rd);
  vec2 side = (stp * (cell - p.xy) + stp * 0.5 + 0.5) * delta;
  for (int i = 0; i < 64; i++) {
    float t = min(side.x, side.y);
    if (t >= dist) break;
    if (side.x < side.y) { side.x += delta.x; cell.x += stp.x; }
    else                 { side.y += delta.y; cell.y += stp.y; }
    if (solid(cell)) return 0.0;
  }
  return 1.0;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float camX = 2.0 * (frag.x / uRes.x) - 1.0;
  vec2  rd2  = uDir + uPlane * camX;
  // gl_FragCoord counts up from the bottom; the projection is defined top-down.
  float yTop = uRes.y - frag.y;
  float tV   = (yTop - (uRes.y * 0.5 + uHorizon)) / uRes.y;

  float maxT = 60.0;
  Hit h = trace(uCam, rd2, uCamZ, tV, maxT);

  vec3 V = normalize(vec3(-rd2, tV));   // surface -> eye
  vec3 col = vec3(0.0);

  if (h.hit) {
    vec3 alb = texture(uAlbedo, vec3(h.uv, float(h.layer))).rgb;
    vec4 nr  = texture(uNormal, vec3(h.uv, float(h.layer)));
    vec3 emi = texture(uEmissive, vec3(h.uv, float(h.layer))).rgb;
    float rough = clamp(nr.a, 0.03, 1.0);
    float metal = uMetal[h.layer];

    // Tangent frame per face orientation.
    vec3 N = h.n;
    vec3 T, B;
    if (h.kind == 0) {
      T = abs(N.x) > 0.5 ? vec3(0.0, N.x, 0.0) : vec3(-N.y, 0.0, 0.0);
      B = vec3(0.0, 0.0, -1.0);
    } else {
      T = vec3(1.0, 0.0, 0.0);
      B = vec3(0.0, N.z > 0.0 ? 1.0 : -1.0, 0.0);
    }
    vec3 tn = nr.rgb * 2.0 - 1.0;
    N = normalize(T * tn.x + B * tn.y + N * tn.z);

    vec3 f0 = mix(vec3(0.04), alb, metal);
    vec3 diffAlb = alb * (1.0 - metal);

    // --- baked static lighting, given a direction so normals show ---
    vec3 lm = bakedLight(h.p.xy);
    vec3 Lb = bakedDirection(h.p.xy);
    float wrap = max(dot(N, Lb) * 0.5 + 0.5, 0.0);   // soft, it stands in for bounce
    col += diffAlb * lm * mix(0.6, 1.05, wrap);
    col += lm * ggx(N, V, Lb, max(rough, 0.25)) * f0 * 1.1;

    // --- torch: a real spotlight sitting at the eye ---
    if (uTorchOn > 0.5) {
      vec3 Lp = vec3(uCam, uCamZ);
      vec3 Ld = Lp - h.p;
      float dist = length(Ld);
      Ld /= max(dist, 1e-4);
      vec3 axis = normalize(vec3(uDir, 0.0));
      float cosA = dot(-Ld, axis);
      // Wide, soft falloff from the beam centre — a hard smoothstep across a
      // narrow band reads as a torch-shaped sticker rather than a light.
      float cone = pow(smoothstep(uTorchCos, 1.0, cosA), 1.6);
      float atten = max(0.0, 1.0 - dist / uTorchRange);
      atten *= atten / (1.0 + dist * dist * 0.05);
      // Beam has not spread at point blank, so a wall you lean on stays readable.
      atten *= min(1.0, dist * 0.85);
      float k = uTorchI * cone * atten * 2.2;
      vec3 radiance = vec3(1.0, 0.96, 0.88) * k;
      col += diffAlb * radiance * max(dot(N, Ld), 0.0);
      col += radiance * ggx(N, V, Ld, rough) * fresnel(f0, max(dot(N, V), 0.0));
    }

    // --- dynamic lights: the predator's eyes, drone strobes ---
    for (int i = 0; i < 6; i++) {
      if (i >= uNumLights) break;
      vec3 Lp = uLightPos[i].xyz;
      float radius = uLightPos[i].w;
      vec3 Ld = Lp - h.p;
      float dist = length(Ld);
      if (dist > radius) continue;
      Ld /= max(dist, 1e-4);
      float atten = pow(max(0.0, 1.0 - dist / radius), 2.0) * shadow(h.p, Lp);
      vec3 radiance = uLightCol[i].rgb * uLightCol[i].w * atten;
      col += diffAlb * radiance * max(dot(N, Ld), 0.0);
      col += radiance * ggx(N, V, Ld, rough) * fresnel(f0, max(dot(N, V), 0.0));
    }

    // --- reflections: the same DDA, run once more along the mirror ray ---
    if (uReflect > 0 && rough < 0.42) {
      vec3 R = reflect(-V, N);
      if (abs(R.z) < 0.999) {
        vec2 rr = R.xy;
        float rlen = length(rr);
        if (rlen > 1e-3) {
          // Renormalise so the secondary t stays a perpendicular distance.
          vec2 rdir = rr / rlen;
          float rtV = -R.z / rlen;
          vec3 org = h.p + N * 0.002;
          Hit rh = trace(org.xy, rdir, org.z, rtV, 26.0);
          vec3 refl = uFogColor;
          if (rh.hit) {
            vec3 ra = texture(uAlbedo, vec3(rh.uv, float(rh.layer))).rgb;
            vec3 re = texture(uEmissive, vec3(rh.uv, float(rh.layer))).rgb;
            refl = ra * bakedLight(rh.p.xy) * 1.3 + re * 3.0;
            refl = mix(refl, uFogColor, 1.0 - exp(-rh.t * uFogDensity * 1.4));
          }
          float ndv = max(dot(N, V), 0.0);
          vec3 F = fresnel(f0, ndv);
          // Rough surfaces get a weaker, flatter reflection instead of a blur.
          col += refl * F * smoothstep(0.42, 0.05, rough);
        }
      }
    }

    col += emi * 4.0;
    col = mix(col, uFogColor, 1.0 - exp(-h.t * uFogDensity));
  } else {
    col = uFogColor;
  }

  // --- volumetric torch: in-scatter along the primary ray ---
  // The light sits at the eye, so nothing along this segment can occlude it and
  // no shadow march is needed — just cone and falloff.
  if (uVolSteps > 0 && uTorchOn > 0.5) {
    float far = min(h.t, uTorchRange);
    float steps = float(uVolSteps);
    float jitter = ign(frag + uTime * 61.0);
    vec3 axis = normalize(vec3(uDir, 0.0));
    vec3 rd3 = vec3(rd2, -tV);
    float acc = 0.0;
    for (int i = 0; i < 40; i++) {
      if (i >= uVolSteps) break;
      float s = (float(i) + jitter) / steps;
      float t = s * far;
      vec3 p = vec3(uCam, uCamZ) + rd3 * t;
      vec3 Ld = vec3(uCam, uCamZ) - p;
      float dist = max(length(Ld), 1e-4);
      float cosA = dot(-normalize(Ld), axis);
      float cone = pow(smoothstep(uTorchCos, 1.0, cosA), 1.8);
      acc += cone * max(0.0, 1.0 - dist / uTorchRange) / (1.0 + dist * dist * 0.16);
    }
    acc *= far / steps;
    col += vec3(1.0, 0.95, 0.86) * acc * uTorchI * 0.055;
  }

  oColor = vec4(max(col, vec3(0.0)), 1.0);
  oDepth = vec4(h.hit ? h.t : maxT, 0.0, 0.0, 1.0);
}`;

/* ------------------------------------------------------------------ */
/* sprites                                                             */
/* ------------------------------------------------------------------ */

/**
 * Billboards are projected with the raycaster's own maths rather than a
 * conventional matrix, so a sprite's footprint lines up exactly with the wall
 * behind it. Depth is resolved by sampling the scene's linear-distance target,
 * which sidesteps having to match depth encodings between the two passes.
 */
export const SPRITE_VS = `#version 300 es
${COMMON}

layout(location = 0) in vec2 aCorner;      // unit quad, -0.5..0.5
layout(location = 1) in vec4 iPosSize;     // xy world, z base height, w cell height
layout(location = 2) in vec4 iParams;      // layer, glow, lightMul, tint

uniform vec2  uCam;
uniform float uCamZ;
uniform vec2  uDir;
uniform vec2  uPlane;
uniform float uHorizon;
uniform vec2  uRes;
uniform float uAspect;                     // sprite cell width / height

out vec2  vUv;
out float vLayer;
out float vGlow;
out float vLightMul;
out vec2  vWorld;
out float vDepth;

void main() {
  vec2 rel = iPosSize.xy - uCam;
  float invDet = 1.0 / (uPlane.x * uDir.y - uDir.x * uPlane.y);
  float tX = invDet * (uDir.y * rel.x - uDir.x * rel.y);
  float tY = invDet * (-uPlane.y * rel.x + uPlane.x * rel.y);

  float cellH = iPosSize.w;
  float cellW = cellH * uAspect;
  // tX is a sideways offset already divided by the camera-plane length, so a
  // world-space width has to be divided by the same factor to match.
  float fov = length(uPlane);
  float sx = tX + aCorner.x * cellW / fov;
  float z  = iPosSize.z + (aCorner.y + 0.5) * cellH;

  float horizonN = 1.0 - 2.0 * (uRes.y * 0.5 + uHorizon) / uRes.y;

  gl_Position = vec4(
    sx,
    horizonN * tY - 2.0 * (uCamZ - z),
    0.0,
    tY
  );

  vUv = vec2(aCorner.x + 0.5, 1.0 - (aCorner.y + 0.5));
  vLayer = iParams.x;
  vGlow = iParams.y;
  vLightMul = iParams.z;
  vWorld = iPosSize.xy;
  vDepth = tY;
}`;

export const SPRITE_FS = `#version 300 es
${COMMON}

in vec2  vUv;
in float vLayer;
in float vGlow;
in float vLightMul;
in vec2  vWorld;
in float vDepth;

out vec4 oColor;

uniform sampler2DArray uSprites;
uniform sampler2D uSceneDepth;
uniform sampler2D uLight;
uniform sampler2D uFlicker;
uniform float uFlickerAmt;
uniform vec2  uMapSize;
uniform vec2  uRes;
uniform vec2  uCam;
uniform float uCamZ;
uniform vec2  uDir;
uniform float uTorchOn;
uniform float uTorchI;
uniform float uTorchCos;
uniform float uTorchRange;
uniform float uFogDensity;
uniform vec3  uFogColor;

void main() {
  vec4 tex = texture(uSprites, vec3(vUv, vLayer));
  if (tex.a < 0.02) discard;

  float sceneT = texture(uSceneDepth, gl_FragCoord.xy / uRes).r;
  if (vDepth > sceneT + 0.02) discard;

  vec2 uvL = vWorld / uMapSize;
  vec3 lm = texture(uLight, uvL).rgb + texture(uFlicker, uvL).rgb * uFlickerAmt;
  vec3 lit = lm * vLightMul * 1.15;

  if (uTorchOn > 0.5) {
    vec3 d = vec3(uCam, uCamZ) - vec3(vWorld, 0.5);
    float dist = max(length(d), 1e-4);
    float cosA = dot(-normalize(d), normalize(vec3(uDir, 0.0)));
    float cone = pow(smoothstep(uTorchCos, 1.0, cosA), 1.6);
    float atten = max(0.0, 1.0 - dist / uTorchRange);
    lit += vec3(1.0, 0.96, 0.88) * uTorchI * cone * atten * atten * 1.4;
  }

  // Bright texels are self-lit: this is what keeps the predator's eyes and the
  // exit sign readable in a pitch-black room, and it feeds the bloom pass.
  float l = luma(tex.rgb);
  float emis = max(0.0, l - 0.6) * 3.2 * (1.0 + vGlow);

  vec3 col = tex.rgb * lit + tex.rgb * emis;
  col = mix(col, uFogColor, 1.0 - exp(-vDepth * uFogDensity));
  oColor = vec4(col, tex.a);
}`;

/* ------------------------------------------------------------------ */
/* post                                                                */
/* ------------------------------------------------------------------ */

export const BRIGHT_FS = `#version 300 es
${COMMON}
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = luma(c);
  // Soft knee so surfaces near the threshold ease into the bloom.
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  oColor = vec4(c * w, 1.0);
}`;

export const BLUR_FS = `#version 300 es
${COMMON}
in vec2 vUv;
out vec4 oColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uDirection;
void main() {
  // 9-tap Gaussian folded into 5 bilinear fetches.
  vec2 o1 = uDirection * uTexel * 1.3846153846;
  vec2 o2 = uDirection * uTexel * 3.2307692308;
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + o1).rgb * 0.3162162162;
  c += texture(uTex, vUv - o1).rgb * 0.3162162162;
  c += texture(uTex, vUv + o2).rgb * 0.0702702703;
  c += texture(uTex, vUv - o2).rgb * 0.0702702703;
  oColor = vec4(c, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
${COMMON}
in vec2 vUv;
out vec4 oColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform float uExposure;
uniform float uTime;
uniform float uGrain;
uniform float uDread;
uniform float uBlind;
uniform float uAberration;
uniform vec2  uRes;

// ACES filmic, Narkowicz's fit — cheap and holds highlight colour together.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // Lateral chromatic aberration, stronger toward the edges and with dread.
  float ab = uAberration * (0.0016 + uDread * 0.004) * r2;
  vec3 scene;
  scene.r = texture(uScene, uv + c * ab).r;
  scene.g = texture(uScene, uv).g;
  scene.b = texture(uScene, uv - c * ab).b;

  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 col = scene + bloom * uBloomAmt;

  col *= uExposure;
  col = aces(col);

  // Grade: cold shadows, and a blood push as it closes in.
  col = mix(col, col * vec3(1.0, 1.03, 1.16), 0.35 * (1.0 - luma(col)));
  col *= mix(vec3(1.0), vec3(1.22, 0.86, 0.82), uDread * 0.75);

  float vig = 1.0 - 0.92 * pow(r2 * 1.9, 1.25);
  col *= clamp(vig, 0.0, 1.0);

  float n = ign(gl_FragCoord.xy + uTime * 137.0) - 0.5;
  col += n * (uGrain + uDread * 0.06);

  col += uBlind;

  // Ordered dither before the 8-bit write, so gradients do not band.
  col += (ign(gl_FragCoord.xy * 1.7) - 0.5) / 255.0;
  oColor = vec4(col, 1.0);
}`;
