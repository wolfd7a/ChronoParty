/**
 * P.O.N. — procedural texture + sprite atlas.
 *
 * Every wall, floor, ceiling and sprite in the game is painted at runtime onto
 * an offscreen canvas and read back as raw RGBA bytes. Nothing here ships as a
 * binary asset, which keeps the whole heist inside the JS bundle.
 *
 * All builders are lazy: `buildAtlas()` must be called from the browser, never
 * at module scope, so the module stays importable in a non-DOM environment.
 */

export const TEX_SIZE = 64;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Small, fast, deterministic PRNG so a given seed always paints the same wall. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasOf(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return { cv, g };
}

/** Read a canvas back into the flat {w,h,data} form the renderer samples. */
function readBack(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, cv.width, cv.height);
  return { w: cv.width, h: cv.height, data: img.data };
}

/** Per-pixel monochrome grain. `amount` is the ± swing in 0-255 units. */
function grain(g, w, h, rnd, amount) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 2 * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

/** Irregular dark blotches — grime, water damage, scuffing. */
function blotches(g, w, h, rnd, count, color, maxR) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 2 + rnd() * maxR;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/* ------------------------------------------------------------------ */
/* wall textures                                                       */
/* ------------------------------------------------------------------ */

function texConcrete(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#3c4046';
  g.fillRect(0, 0, S, S);
  // poured-slab seams
  g.strokeStyle = 'rgba(12,14,17,0.75)';
  g.lineWidth = 1;
  for (let y = 16; y < S; y += 16) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(S, y + 0.5);
    g.stroke();
  }
  blotches(g, S, S, rnd, 22, 'rgba(20,22,26,0.5)', 12);
  blotches(g, S, S, rnd, 8, 'rgba(96,100,108,0.28)', 9);
  grain(g, S, S, rnd, 16);
  return readBack(cv);
}

function texMarble(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  const base = g.createLinearGradient(0, 0, 0, S);
  base.addColorStop(0, '#c8ccd6');
  base.addColorStop(1, '#9aa0ad');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // veining: random walks across the slab
  for (let v = 0; v < 7; v++) {
    g.strokeStyle = `rgba(70,76,90,${0.14 + rnd() * 0.22})`;
    g.lineWidth = rnd() < 0.4 ? 1.6 : 0.7;
    g.beginPath();
    let x = rnd() * S;
    let y = -2;
    g.moveTo(x, y);
    while (y < S) {
      x += (rnd() - 0.5) * 9;
      y += 3 + rnd() * 4;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // panel joint every half tile
  g.strokeStyle = 'rgba(48,52,62,0.55)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, S - 1, S - 1);
  g.beginPath();
  g.moveTo(0, S / 2 + 0.5);
  g.lineTo(S, S / 2 + 0.5);
  g.stroke();
  grain(g, S, S, rnd, 7);
  return readBack(cv);
}

function texVaultSteel(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#2a323d';
  g.fillRect(0, 0, S, S);
  // brushed vertical striations
  for (let x = 0; x < S; x++) {
    g.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`;
    g.fillRect(x, 0, 1, S);
  }
  // riveted panel plates
  g.strokeStyle = 'rgba(10,13,18,0.9)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, S - 8, S - 8);
  g.strokeStyle = 'rgba(120,134,152,0.25)';
  g.lineWidth = 1;
  g.strokeRect(5.5, 5.5, S - 11, S - 11);
  const rivets = [
    [10, 10], [S - 10, 10], [10, S - 10], [S - 10, S - 10],
    [S / 2, 10], [S / 2, S - 10], [10, S / 2], [S - 10, S / 2],
  ];
  for (const [rx, ry] of rivets) {
    const grd = g.createRadialGradient(rx - 0.8, ry - 0.8, 0, rx, ry, 3);
    grd.addColorStop(0, '#8d9aab');
    grd.addColorStop(1, '#1a2029');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(rx, ry, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, S, S, rnd, 8);
  return readBack(cv);
}

function texOffice(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#6d6757';
  g.fillRect(0, 0, S, S);
  blotches(g, S, S, rnd, 10, 'rgba(40,36,30,0.35)', 14);
  // chair rail + skirting board
  g.fillStyle = '#4a4438';
  g.fillRect(0, S - 9, S, 9);
  g.fillStyle = '#5c5648';
  g.fillRect(0, S - 10, S, 1);
  g.fillStyle = 'rgba(140,132,112,0.35)';
  g.fillRect(0, 22, S, 2);
  grain(g, S, S, rnd, 11);
  return readBack(cv);
}

function texServerRack(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#14181e';
  g.fillRect(0, 0, S, S);
  // 1U slots
  for (let y = 3; y < S - 3; y += 8) {
    g.fillStyle = '#0a0d11';
    g.fillRect(3, y, S - 6, 6);
    g.fillStyle = '#232a33';
    g.fillRect(3, y, S - 6, 1);
    // vent grille
    for (let x = 7; x < S - 12; x += 3) {
      g.fillStyle = 'rgba(255,255,255,0.045)';
      g.fillRect(x, y + 2, 1, 3);
    }
    // status LEDs — these are what you see glowing in the dark
    if (rnd() < 0.85) {
      g.fillStyle = rnd() < 0.72 ? '#39e07a' : '#e0a13a';
      g.fillRect(S - 9, y + 2, 2, 2);
    }
    if (rnd() < 0.4) {
      g.fillStyle = '#39a8e0';
      g.fillRect(S - 13, y + 2, 2, 2);
    }
  }
  grain(g, S, S, rnd, 5);
  return readBack(cv);
}

function texBrick(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#241f1c';
  g.fillRect(0, 0, S, S);
  const bh = 8;
  const bw = 16;
  for (let row = 0, y = 0; y < S; y += bh, row++) {
    const offset = row % 2 ? -bw / 2 : 0;
    for (let x = offset; x < S; x += bw) {
      const shade = 0.72 + rnd() * 0.5;
      const r = Math.round(88 * shade);
      const gg = Math.round(56 * shade);
      const b = Math.round(46 * shade);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
  blotches(g, S, S, rnd, 14, 'rgba(14,12,11,0.5)', 11);
  grain(g, S, S, rnd, 12);
  return readBack(cv);
}

function texGlass(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#16222f');
  grd.addColorStop(0.5, '#25384b');
  grd.addColorStop(1, '#101a24');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // reflection streaks
  g.strokeStyle = 'rgba(180,214,240,0.16)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(-8, S * 0.8);
  g.lineTo(S * 0.8, -8);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(6, S + 6);
  g.lineTo(S + 6, 6);
  g.stroke();
  // aluminium frame
  g.strokeStyle = '#5c6672';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  grain(g, S, S, rnd, 4);
  return readBack(cv);
}

function texSecurityDoor(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#39414d';
  g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x++) {
    g.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`;
    g.fillRect(x, 0, 1, S);
  }
  // hazard chevrons along the bottom
  g.save();
  g.beginPath();
  g.rect(0, S - 14, S, 14);
  g.clip();
  for (let i = -S; i < S * 2; i += 10) {
    g.fillStyle = '#c9a227';
    g.beginPath();
    g.moveTo(i, S);
    g.lineTo(i + 5, S - 14);
    g.lineTo(i + 10, S - 14);
    g.lineTo(i + 5, S);
    g.closePath();
    g.fill();
  }
  g.restore();
  // wired observation window
  g.fillStyle = '#0d151d';
  g.fillRect(20, 10, 24, 22);
  g.strokeStyle = 'rgba(150,170,190,0.35)';
  g.lineWidth = 1;
  for (let i = 22; i < 44; i += 5) {
    g.beginPath();
    g.moveTo(i, 10);
    g.lineTo(i, 32);
    g.stroke();
  }
  g.strokeStyle = '#78838f';
  g.lineWidth = 2;
  g.strokeRect(20, 10, 24, 22);
  grain(g, S, S, rnd, 7);
  return readBack(cv);
}

/* ------------------------------------------------------------------ */
/* floor + ceiling textures                                            */
/* ------------------------------------------------------------------ */

function texFloorMarble(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  // 2x2 checkerboard of polished slabs
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      g.fillStyle = (tx + ty) % 2 ? '#b3b8c4' : '#7d8391';
      g.fillRect(tx * 32, ty * 32, 32, 32);
    }
  }
  for (let v = 0; v < 6; v++) {
    g.strokeStyle = `rgba(60,66,78,${0.1 + rnd() * 0.14})`;
    g.lineWidth = 0.8;
    g.beginPath();
    let x = rnd() * S;
    let y = -2;
    g.moveTo(x, y);
    while (y < S) {
      x += (rnd() - 0.5) * 10;
      y += 4 + rnd() * 4;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.strokeStyle = 'rgba(40,44,54,0.7)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, 31, 31);
  g.strokeRect(32.5, 0.5, 31, 31);
  g.strokeRect(0.5, 32.5, 31, 31);
  g.strokeRect(32.5, 32.5, 31, 31);
  grain(g, S, S, rnd, 6);
  return readBack(cv);
}

function texFloorConcrete(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#34383e';
  g.fillRect(0, 0, S, S);
  blotches(g, S, S, rnd, 26, 'rgba(18,20,24,0.45)', 13);
  blotches(g, S, S, rnd, 6, 'rgba(88,92,100,0.2)', 10);
  g.strokeStyle = 'rgba(14,16,19,0.6)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, S - 1, S - 1);
  grain(g, S, S, rnd, 15);
  return readBack(cv);
}

function texFloorGrate(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#1b1f25';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#464e59';
  for (let y = 0; y < S; y += 8) g.fillRect(0, y, S, 3);
  for (let x = 0; x < S; x += 8) g.fillRect(x, 0, 3, S);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 0; y < S; y += 8) g.fillRect(0, y, S, 1);
  grain(g, S, S, rnd, 10);
  return readBack(cv);
}

function texFloorCarpet(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#33302b';
  g.fillRect(0, 0, S, S);
  // fibrous speckle
  for (let i = 0; i < 900; i++) {
    const l = rnd();
    g.fillStyle = l < 0.5 ? 'rgba(70,64,54,0.5)' : 'rgba(24,22,19,0.5)';
    g.fillRect(rnd() * S, rnd() * S, 1, 1);
  }
  grain(g, S, S, rnd, 8);
  return readBack(cv);
}

function texCeilPanel(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#3a3d42';
  g.fillRect(0, 0, S, S);
  // suspended-ceiling tile grid
  g.fillStyle = '#22252a';
  g.fillRect(0, 0, S, 3);
  g.fillRect(0, 0, 3, S);
  g.fillRect(0, 32, S, 2);
  g.fillRect(32, 0, 2, S);
  blotches(g, S, S, rnd, 8, 'rgba(20,22,26,0.4)', 10);
  grain(g, S, S, rnd, 9);
  return readBack(cv);
}

function texCeilConcrete(seed) {
  const S = TEX_SIZE;
  const { cv, g } = canvasOf(S, S);
  const rnd = mulberry32(seed);
  g.fillStyle = '#282b30';
  g.fillRect(0, 0, S, S);
  // exposed ducts / conduit runs
  g.fillStyle = '#1d2024';
  g.fillRect(0, 18, S, 7);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, 18, S, 1);
  g.fillStyle = '#22262b';
  g.fillRect(0, 44, S, 4);
  blotches(g, S, S, rnd, 12, 'rgba(12,14,17,0.5)', 12);
  grain(g, S, S, rnd, 12);
  return readBack(cv);
}

/* ------------------------------------------------------------------ */
/* sprites                                                             */
/* ------------------------------------------------------------------ */

/**
 * The predator. Deliberately read as a silhouette: the player should mostly
 * see a shape and two eyes, never enough detail to feel safe about it.
 * `pose` drives cape spread and stride so the same painter covers all frames.
 */
function drawPredator(g, w, h, pose, rnd) {
  const cx = w / 2;
  const cape = pose.cape; // 0 = furled, 1 = full spread
  const stride = pose.stride; // -1..1

  g.clearRect(0, 0, w, h);

  // --- legs (drawn first, so the cape falls in front of them) ----------
  g.fillStyle = '#070a0f';
  g.fillRect(cx - w * 0.135 + stride * w * 0.055, h * 0.58, w * 0.105, h * 0.41);
  g.fillRect(cx + w * 0.03 - stride * w * 0.055, h * 0.58, w * 0.105, h * 0.41);

  // --- cape -----------------------------------------------------------
  // Kept narrow at rest: at the size this is normally seen, a wide cape stops
  // reading as a figure and starts reading as a bell.
  const spread = 0.1 + cape * 0.32;
  const hemW = w * (0.07 + cape * 0.26);
  const hemY = h * 0.8;
  g.fillStyle = '#04060a';
  g.beginPath();
  g.moveTo(cx, h * 0.19);
  g.bezierCurveTo(
    cx - w * spread, h * 0.26,
    cx - w * (spread + 0.07), h * 0.6,
    cx - hemW, hemY,
  );
  g.lineTo(cx + hemW, hemY);
  g.bezierCurveTo(
    cx + w * (spread + 0.07), h * 0.6,
    cx + w * spread, h * 0.26,
    cx, h * 0.19,
  );
  g.closePath();
  g.fill();

  // scalloped cape hem — the tell that it is a cape and not a coat
  for (let i = -3; i <= 3; i++) {
    const sx = cx + (i / 3) * hemW;
    g.beginPath();
    g.arc(sx, hemY, hemW / 4.6, 0, Math.PI);
    g.fill();
  }

  // rim light so it separates from a black corridor
  g.strokeStyle = 'rgba(120,150,190,0.32)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(cx - hemW, hemY);
  g.bezierCurveTo(
    cx - w * (spread + 0.07), h * 0.6,
    cx - w * spread, h * 0.26,
    cx, h * 0.19,
  );
  g.stroke();

  // --- torso ----------------------------------------------------------
  g.fillStyle = '#0a0e14';
  g.beginPath();
  g.moveTo(cx - w * 0.19, h * 0.31);
  g.lineTo(cx + w * 0.19, h * 0.31);
  g.lineTo(cx + w * 0.13, h * 0.7);
  g.lineTo(cx - w * 0.13, h * 0.7);
  g.closePath();
  g.fill();

  // chest emblem, barely legible — a suggestion, not a logo
  g.fillStyle = 'rgba(40,48,60,0.75)';
  g.beginPath();
  g.ellipse(cx, h * 0.42, w * 0.1, h * 0.035, 0, 0, Math.PI * 2);
  g.fill();

  // gauntlets
  g.fillStyle = '#06090e';
  g.fillRect(cx - w * 0.26, h * 0.4, w * 0.08, h * 0.16);
  g.fillRect(cx + w * 0.18, h * 0.4, w * 0.08, h * 0.16);

  // --- cowl -----------------------------------------------------------
  // The ears do the heavy lifting: at the size this sprite is usually seen,
  // two horns against a corridor ceiling is the entire read.
  g.fillStyle = '#080b11';
  g.beginPath();
  g.ellipse(cx, h * 0.225, w * 0.135, h * 0.095, 0, 0, Math.PI * 2);
  g.fill();
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * w * 0.135, h * 0.2);
    g.lineTo(cx + s * w * 0.175, h * 0.02);
    g.lineTo(cx + s * w * 0.055, h * 0.155);
    g.closePath();
    g.fill();
    // a hairline of rim light down the outer edge of each ear
    g.strokeStyle = 'rgba(130,160,200,0.4)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx + s * w * 0.135, h * 0.2);
    g.lineTo(cx + s * w * 0.175, h * 0.02);
    g.stroke();
  }

  // jaw catches a little light
  g.fillStyle = 'rgba(70,80,96,0.5)';
  g.beginPath();
  g.ellipse(cx, h * 0.27, w * 0.075, h * 0.035, 0, 0, Math.PI * 2);
  g.fill();

  // --- eyes: the only bright thing on the model ------------------------
  const eyeY = h * 0.21;
  for (const s of [-1, 1]) {
    const ex = cx + s * w * 0.062;
    const glow = g.createRadialGradient(ex, eyeY, 0, ex, eyeY, w * 0.14);
    glow.addColorStop(0, 'rgba(200,232,255,0.85)');
    glow.addColorStop(0.35, 'rgba(120,190,255,0.3)');
    glow.addColorStop(1, 'rgba(90,160,255,0)');
    g.fillStyle = glow;
    g.fillRect(ex - w * 0.14, eyeY - w * 0.14, w * 0.28, w * 0.28);
    g.fillStyle = '#eaf6ff';
    g.beginPath();
    g.ellipse(ex, eyeY, w * 0.035, h * 0.011, s * 0.25, 0, Math.PI * 2);
    g.fill();
  }

  // faint dust motes so it never sits perfectly still
  for (let i = 0; i < 12; i++) {
    g.fillStyle = `rgba(150,175,205,${0.04 + rnd() * 0.05})`;
    g.fillRect(rnd() * w, h * 0.2 + rnd() * h * 0.7, 1, 1);
  }
}

function spritePredator(frameCount = 4) {
  const w = 96;
  const h = 158;
  const frames = [];
  const poses = [
    { cape: 0.15, stride: 0 },    // idle / watching
    { cape: 0.35, stride: 1 },    // stride A
    { cape: 0.3, stride: 0 },     // pass
    { cape: 1.0, stride: -0.6 },  // lunge — cape wide, about to close
  ];
  for (let i = 0; i < frameCount; i++) {
    const { cv, g } = canvasOf(w, h);
    drawPredator(g, w, h, poses[i % poses.length], mulberry32(900 + i));
    frames.push(readBack(cv));
  }
  return frames;
}

function spriteCash() {
  const w = 48;
  const h = 48;
  const { cv, g } = canvasOf(w, h);
  g.clearRect(0, 0, w, h);
  // banded cash bundle
  for (let i = 0; i < 3; i++) {
    const y = 14 + i * 8;
    g.fillStyle = '#6f8b5e';
    g.fillRect(8, y, 32, 8);
    g.fillStyle = '#89a874';
    g.fillRect(8, y, 32, 2);
    g.fillStyle = '#3f5136';
    g.fillRect(8, y + 7, 32, 1);
    g.fillStyle = '#c0563a';
    g.fillRect(20, y, 8, 8);
  }
  g.strokeStyle = 'rgba(220,235,200,0.35)';
  g.lineWidth = 1;
  g.strokeRect(8.5, 14.5, 31, 23);
  return readBack(cv);
}

function spriteDataDrive() {
  const w = 48;
  const h = 48;
  const { cv, g } = canvasOf(w, h);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#1c2129';
  g.fillRect(12, 16, 24, 20);
  g.fillStyle = '#2c333d';
  g.fillRect(12, 16, 24, 3);
  g.fillStyle = '#0d1014';
  g.fillRect(15, 22, 18, 8);
  // activity LED + halo, so it reads in a dark server room
  const glow = g.createRadialGradient(30, 33, 0, 30, 33, 12);
  glow.addColorStop(0, 'rgba(90,240,170,0.9)');
  glow.addColorStop(1, 'rgba(90,240,170,0)');
  g.fillStyle = glow;
  g.fillRect(18, 21, 24, 24);
  g.fillStyle = '#7dffcb';
  g.fillRect(29, 32, 3, 3);
  g.fillStyle = '#6a7482';
  g.fillRect(12, 34, 24, 2);
  return readBack(cv);
}

function spriteDrone() {
  const w = 64;
  const h = 64;
  const { cv, g } = canvasOf(w, h);
  g.clearRect(0, 0, w, h);
  // hull
  g.fillStyle = '#2b3038';
  g.beginPath();
  g.ellipse(32, 34, 18, 12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3d444e';
  g.beginPath();
  g.ellipse(32, 30, 18, 9, 0, 0, Math.PI * 2);
  g.fill();
  // rotor booms
  g.strokeStyle = '#22262c';
  g.lineWidth = 3;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(32, 30);
    g.lineTo(32 + s * 26, 20);
    g.stroke();
    g.fillStyle = 'rgba(180,200,220,0.18)';
    g.beginPath();
    g.ellipse(32 + s * 26, 20, 10, 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  // sensor eye
  const glow = g.createRadialGradient(32, 34, 0, 32, 34, 14);
  glow.addColorStop(0, 'rgba(255,70,70,0.95)');
  glow.addColorStop(1, 'rgba(255,70,70,0)');
  g.fillStyle = glow;
  g.fillRect(18, 20, 28, 28);
  g.fillStyle = '#ff5a5a';
  g.beginPath();
  g.arc(32, 34, 3.5, 0, Math.PI * 2);
  g.fill();
  return readBack(cv);
}

function spriteCamera() {
  const w = 48;
  const h = 48;
  const { cv, g } = canvasOf(w, h);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#31363d';
  g.fillRect(14, 14, 22, 12);
  g.fillStyle = '#22262b';
  g.fillRect(12, 16, 4, 8);
  g.fillStyle = '#14171b';
  g.beginPath();
  g.arc(36, 20, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4a525c';
  g.fillRect(22, 8, 4, 7);
  g.fillStyle = '#ff4d4d';
  g.fillRect(17, 17, 2, 2);
  return readBack(cv);
}

function spriteExtraction() {
  const w = 64;
  const h = 96;
  const { cv, g } = canvasOf(w, h);
  g.clearRect(0, 0, w, h);
  // glowing exit frame
  const glow = g.createRadialGradient(32, 48, 4, 32, 48, 44);
  glow.addColorStop(0, 'rgba(80,255,160,0.55)');
  glow.addColorStop(1, 'rgba(80,255,160,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#5cffa8';
  g.lineWidth = 3;
  g.strokeRect(14, 14, 36, 70);
  g.fillStyle = 'rgba(20,60,40,0.65)';
  g.fillRect(16, 16, 32, 66);
  // running-man arrow
  g.fillStyle = '#9dffd0';
  g.beginPath();
  g.moveTo(24, 42);
  g.lineTo(36, 42);
  g.lineTo(36, 36);
  g.lineTo(46, 48);
  g.lineTo(36, 60);
  g.lineTo(36, 54);
  g.lineTo(24, 54);
  g.closePath();
  g.fill();
  return readBack(cv);
}

function spriteBody() {
  const w = 64;
  const h = 40;
  const { cv, g } = canvasOf(w, h);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#1a1d22';
  g.beginPath();
  g.ellipse(32, 28, 24, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a2f36';
  g.beginPath();
  g.ellipse(16, 24, 7, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(120,20,20,0.5)';
  g.beginPath();
  g.ellipse(38, 33, 16, 5, 0, 0, Math.PI * 2);
  g.fill();
  return readBack(cv);
}

/* ------------------------------------------------------------------ */
/* atlas                                                               */
/* ------------------------------------------------------------------ */

/** Wall material ids. 0 means "walkable", so every wall id starts at 1. */
export const WALL = {
  CONCRETE: 1,
  MARBLE: 2,
  STEEL: 3,
  OFFICE: 4,
  SERVER: 5,
  BRICK: 6,
  GLASS: 7,
  DOOR: 8,
};

export const FLOOR = { CONCRETE: 0, MARBLE: 1, GRATE: 2, CARPET: 3 };
export const CEIL = { PANEL: 0, CONCRETE: 1 };

/**
 * Surface response, per material. Read by the WebGL renderer only — the
 * software renderer is unlit-diffuse and ignores all of it.
 *
 * `bump` scales the Sobel-derived normal map, `rough`/`roughVar` set base
 * microfacet roughness and how much the albedo's own luminance modulates it
 * (mortar rougher than brick face), `metal` drives the Fresnel colour, and
 * `emit` extracts self-lit texels — the server LEDs are the main customer.
 */
const SURFACE = {
  concrete: { bump: 1.5, rough: 0.93, roughVar: 0.1, metal: 0.0, emit: 0 },
  marble: { bump: 0.45, rough: 0.2, roughVar: 0.14, metal: 0.03, emit: 0 },
  steel: { bump: 0.9, rough: 0.34, roughVar: 0.16, metal: 0.85, emit: 0 },
  office: { bump: 1.1, rough: 0.95, roughVar: 0.06, metal: 0.0, emit: 0 },
  server: { bump: 1.7, rough: 0.52, roughVar: 0.2, metal: 0.35, emit: 4.2 },
  brick: { bump: 2.4, rough: 0.96, roughVar: 0.08, metal: 0.0, emit: 0 },
  glass: { bump: 0.25, rough: 0.06, roughVar: 0.04, metal: 0.2, emit: 0.25 },
  door: { bump: 1.3, rough: 0.42, roughVar: 0.18, metal: 0.7, emit: 0 },
  floorConcrete: { bump: 1.3, rough: 0.9, roughVar: 0.12, metal: 0.0, emit: 0 },
  floorMarble: { bump: 0.4, rough: 0.15, roughVar: 0.12, metal: 0.04, emit: 0 },
  floorGrate: { bump: 2.0, rough: 0.45, roughVar: 0.2, metal: 0.8, emit: 0 },
  floorCarpet: { bump: 1.6, rough: 0.99, roughVar: 0.04, metal: 0.0, emit: 0 },
  ceilPanel: { bump: 1.0, rough: 0.9, roughVar: 0.08, metal: 0.0, emit: 0 },
  ceilConcrete: { bump: 1.4, rough: 0.93, roughVar: 0.08, metal: 0.0, emit: 0 },
};

/** Layer order in the surface array texture: walls 1-8, floors, ceilings. */
const SURFACE_ORDER = [
  'concrete', 'marble', 'steel', 'office', 'server', 'brick', 'glass', 'door',
  'floorConcrete', 'floorMarble', 'floorGrate', 'floorCarpet',
  'ceilPanel', 'ceilConcrete',
];

export const LAYER = {
  /** Wall material id 1-8 maps to layers 0-7. */
  wall: (mat) => mat - 1,
  floor: (t) => 8 + t,
  ceil: (t) => 12 + t,
  count: SURFACE_ORDER.length,
};

/**
 * Sobel the albedo's luminance as a height field into a tangent-space normal
 * map, with roughness in alpha. Wrapping the sampler keeps tiled surfaces
 * seamless at the edges.
 */
function deriveNormalRough(tex, props) {
  const { w, h, data } = tex;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const at = (x, y) => lum[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1); const t = at(x, y - 1); const tr = at(x + 1, y - 1);
      const l = at(x - 1, y); const r = at(x + 1, y);
      const bl = at(x - 1, y + 1); const b = at(x, y + 1); const br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * props.bump;
      let ny = -dy * props.bump;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      out[i + 3] = Math.max(0.02, Math.min(1, props.rough + (lum[y * w + x] - 0.5) * props.roughVar)) * 255;
    }
  }
  return out;
}

/**
 * Pull out the texels that should glow. Emissive detail in these textures is
 * always small, bright and saturated — indicator LEDs, not lit surfaces — so a
 * luminance-and-saturation test isolates it cleanly.
 */
function deriveEmissive(tex, props) {
  const { w, h, data } = tex;
  const out = new Uint8ClampedArray(w * h * 4);
  if (props.emit <= 0) return out;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    const glows = lum > 0.28 && sat > 0.3;
    const k = glows ? Math.min(1, props.emit * 0.25) : 0;
    out[i * 4] = r * k;
    out[i * 4 + 1] = g * k;
    out[i * 4 + 2] = b * k;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Flatten a list of same-sized RGBA maps into one array-texture upload. */
function packLayers(maps, size) {
  const stride = size * size * 4;
  const out = new Uint8Array(stride * maps.length);
  maps.forEach((m, i) => out.set(m, stride * i));
  return out;
}

let glCached = null;

/**
 * Build the array textures the GPU renderer samples: albedo, normal+roughness,
 * and emissive, one layer per material, plus the per-layer metalness the
 * shader needs as a uniform.
 */
export function buildSurfaceArrays() {
  if (glCached) return glCached;
  const a = buildAtlas();
  const source = {
    concrete: a.walls[WALL.CONCRETE],
    marble: a.walls[WALL.MARBLE],
    steel: a.walls[WALL.STEEL],
    office: a.walls[WALL.OFFICE],
    server: a.walls[WALL.SERVER],
    brick: a.walls[WALL.BRICK],
    glass: a.walls[WALL.GLASS],
    door: a.walls[WALL.DOOR],
    floorConcrete: a.floors[FLOOR.CONCRETE],
    floorMarble: a.floors[FLOOR.MARBLE],
    floorGrate: a.floors[FLOOR.GRATE],
    floorCarpet: a.floors[FLOOR.CARPET],
    ceilPanel: a.ceils[CEIL.PANEL],
    ceilConcrete: a.ceils[CEIL.CONCRETE],
  };
  const albedo = [];
  const normal = [];
  const emissive = [];
  const metal = [];
  const rough = [];
  for (const key of SURFACE_ORDER) {
    const tex = source[key];
    const props = SURFACE[key];
    albedo.push(tex.data);
    normal.push(deriveNormalRough(tex, props));
    emissive.push(deriveEmissive(tex, props));
    metal.push(props.metal);
    rough.push(props.rough);
  }
  glCached = {
    size: TEX_SIZE,
    layers: SURFACE_ORDER.length,
    albedo: packLayers(albedo, TEX_SIZE),
    normal: packLayers(normal, TEX_SIZE),
    emissive: packLayers(emissive, TEX_SIZE),
    metal: new Float32Array(metal),
    rough: new Float32Array(rough),
  };
  return glCached;
}

/* ---- sprite array texture --------------------------------------- */

const SPRITE_W = 128;
const SPRITE_H = 192;

function texToCanvas(tex) {
  const { cv, g } = canvasOf(tex.w, tex.h);
  g.putImageData(new ImageData(new Uint8ClampedArray(tex.data), tex.w, tex.h), 0, 0);
  return cv;
}

let spriteCached = null;

/**
 * Every sprite scaled to fit one common 128x192 cell so they can live in a
 * single array texture and render in one instanced draw. `contentH` records
 * what fraction of the cell the artwork actually occupies, which is how the
 * renderer recovers the true world size from a padded layer.
 */
export function buildSpriteArray() {
  if (spriteCached) return spriteCached;
  const a = buildAtlas();
  const entries = [
    ['predator0', a.predator[0]],
    ['predator1', a.predator[1]],
    ['predator2', a.predator[2]],
    ['predator3', a.predator[3]],
    ['cash', a.cash],
    ['data', a.data],
    ['drone', a.drone],
    ['camera', a.camera],
    ['exit', a.exit],
    ['body', a.body],
  ];
  const stride = SPRITE_W * SPRITE_H * 4;
  const out = new Uint8Array(stride * entries.length);
  const index = {};
  entries.forEach(([name, tex], i) => {
    const { cv, g } = canvasOf(SPRITE_W, SPRITE_H);
    g.clearRect(0, 0, SPRITE_W, SPRITE_H);
    const fit = Math.min(SPRITE_W / tex.w, SPRITE_H / tex.h);
    const dw = tex.w * fit;
    const dh = tex.h * fit;
    g.imageSmoothingEnabled = false;
    g.drawImage(texToCanvas(tex), (SPRITE_W - dw) / 2, (SPRITE_H - dh) / 2, dw, dh);
    out.set(readBack(cv).data, stride * i);
    index[name] = { layer: i, contentH: dh / SPRITE_H, aspect: tex.w / tex.h };
  });
  spriteCached = { w: SPRITE_W, h: SPRITE_H, layers: entries.length, data: out, index };
  return spriteCached;
}

let cached = null;

/**
 * Paint (or return the already-painted) atlas. Safe to call repeatedly; the
 * work happens exactly once per page load.
 */
export function buildAtlas() {
  if (cached) return cached;
  cached = {
    // index 0 unused so WALL ids map straight into the array
    walls: [
      null,
      texConcrete(11),
      texMarble(22),
      texVaultSteel(33),
      texOffice(44),
      texServerRack(55),
      texBrick(66),
      texGlass(77),
      texSecurityDoor(88),
    ],
    floors: [
      texFloorConcrete(101),
      texFloorMarble(102),
      texFloorGrate(103),
      texFloorCarpet(104),
    ],
    ceils: [texCeilPanel(201), texCeilConcrete(202)],
    predator: spritePredator(4),
    cash: spriteCash(),
    data: spriteDataDrive(),
    drone: spriteDrone(),
    camera: spriteCamera(),
    exit: spriteExtraction(),
    body: spriteBody(),
  };
  return cached;
}
