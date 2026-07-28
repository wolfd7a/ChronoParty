/**
 * P.O.N. — "Meridian Trust", the level.
 *
 * The building is carved out of a solid block rather than typed as an ASCII
 * map: the grid is easier to keep consistent that way, and the room/corridor
 * rectangles below double as the data the AI and the tablet map read from.
 *
 * Layout is deliberately a *ring*: three vertical service corridors crossed by
 * three horizontal ones, with nine rooms in the gaps. Every room has at least
 * two ways out, so a chase always has somewhere to go — except the vault,
 * whose second exit is a maintenance hatch most players never find.
 *
 * This module is DOM-free so it can be unit-tested outside the browser.
 */

import { WALL, FLOOR, CEIL } from './textures.js';

export const MAP_W = 48;
export const MAP_H = 50;

/** Interior rectangles, inclusive of both bounds. */
const CORRIDORS = [
  // vertical service runs
  { id: 'shaft', name: 'West Service Shaft', x0: 1, y0: 1, x1: 3, y1: 48, wall: WALL.BRICK, floor: FLOOR.GRATE, ceil: CEIL.CONCRETE },
  { id: 'midCorr', name: 'Central Corridor', x0: 18, y0: 1, x1: 20, y1: 48, wall: WALL.CONCRETE, floor: FLOOR.CONCRETE, ceil: CEIL.PANEL },
  { id: 'eastCorr', name: 'East Corridor', x0: 35, y0: 1, x1: 37, y1: 48, wall: WALL.CONCRETE, floor: FLOOR.CONCRETE, ceil: CEIL.PANEL },
  // horizontal runs
  { id: 'northCorr', name: 'North Corridor', x0: 5, y0: 13, x1: 46, y1: 15, wall: WALL.CONCRETE, floor: FLOOR.CONCRETE, ceil: CEIL.PANEL },
  { id: 'southCorr', name: 'South Corridor', x0: 5, y0: 30, x1: 46, y1: 32, wall: WALL.CONCRETE, floor: FLOOR.CONCRETE, ceil: CEIL.PANEL },
  { id: 'southService', name: 'Sub-level Access', x0: 1, y0: 46, x1: 46, y1: 48, wall: WALL.BRICK, floor: FLOOR.GRATE, ceil: CEIL.CONCRETE },
];

const ROOMS = [
  { id: 'dock', name: 'Loading Dock', x0: 5, y0: 1, x1: 16, y1: 11, wall: WALL.BRICK, floor: FLOOR.CONCRETE, ceil: CEIL.CONCRETE },
  { id: 'lobby', name: 'Main Lobby', x0: 22, y0: 1, x1: 33, y1: 11, wall: WALL.MARBLE, floor: FLOOR.MARBLE, ceil: CEIL.PANEL },
  { id: 'offices', name: 'Executive Offices', x0: 39, y0: 1, x1: 46, y1: 11, wall: WALL.OFFICE, floor: FLOOR.CARPET, ceil: CEIL.PANEL },
  { id: 'vault', name: 'Vault', x0: 5, y0: 17, x1: 16, y1: 28, wall: WALL.STEEL, floor: FLOOR.GRATE, ceil: CEIL.CONCRETE },
  { id: 'teller', name: 'Teller Hall', x0: 22, y0: 17, x1: 33, y1: 28, wall: WALL.MARBLE, floor: FLOOR.MARBLE, ceil: CEIL.PANEL },
  { id: 'server', name: 'Server Room', x0: 39, y0: 17, x1: 46, y1: 28, wall: WALL.SERVER, floor: FLOOR.GRATE, ceil: CEIL.CONCRETE },
  { id: 'security', name: 'Security Office', x0: 5, y0: 34, x1: 16, y1: 44, wall: WALL.OFFICE, floor: FLOOR.CARPET, ceil: CEIL.PANEL },
  { id: 'archive', name: 'Records Archive', x0: 22, y0: 34, x1: 33, y1: 44, wall: WALL.OFFICE, floor: FLOOR.CARPET, ceil: CEIL.PANEL },
  { id: 'stairwell', name: 'Fire Stairwell', x0: 39, y0: 34, x1: 46, y1: 44, wall: WALL.CONCRETE, floor: FLOOR.CONCRETE, ceil: CEIL.CONCRETE },
];

/** Single cells punched through a dividing wall. */
const DOORS = [
  [4, 6], [17, 6], [10, 12],            // dock
  [21, 5], [27, 12], [34, 8],           // lobby
  [38, 5], [42, 12],                    // offices
  [17, 22], [4, 26],                    // vault (main door + maintenance hatch)
  [21, 20], [26, 16], [34, 24], [29, 29], // teller hall
  [38, 22], [42, 16],                   // server room
  [10, 33], [17, 40], [4, 38],          // security
  [21, 38], [27, 33], [27, 45],         // archive
  [38, 40], [42, 45],                   // stairwell
];

/**
 * Furniture. These are full-height blockers — pillars, counters, racks, stacks.
 * They exist to break sightlines: an open room is a death sentence when the
 * thing hunting you moves faster than you do.
 */
const OBSTACLES = [
  // lobby pillars
  { x0: 25, y0: 4, x1: 25, y1: 4, mat: WALL.MARBLE },
  { x0: 30, y0: 4, x1: 30, y1: 4, mat: WALL.MARBLE },
  { x0: 25, y0: 9, x1: 25, y1: 9, mat: WALL.MARBLE },
  { x0: 30, y0: 9, x1: 30, y1: 9, mat: WALL.MARBLE },
  // teller counter with a service gap
  { x0: 23, y0: 21, x1: 27, y1: 21, mat: WALL.GLASS },
  { x0: 29, y0: 21, x1: 32, y1: 21, mat: WALL.GLASS },
  // vault deposit-box blocks
  { x0: 8, y0: 19, x1: 9, y1: 19, mat: WALL.STEEL },
  { x0: 12, y0: 19, x1: 13, y1: 19, mat: WALL.STEEL },
  { x0: 8, y0: 25, x1: 9, y1: 25, mat: WALL.STEEL },
  { x0: 12, y0: 25, x1: 13, y1: 25, mat: WALL.STEEL },
  // server aisles
  { x0: 39, y0: 20, x1: 42, y1: 20, mat: WALL.SERVER },
  { x0: 44, y0: 20, x1: 46, y1: 20, mat: WALL.SERVER },
  { x0: 39, y0: 25, x1: 41, y1: 25, mat: WALL.SERVER },
  { x0: 43, y0: 25, x1: 46, y1: 25, mat: WALL.SERVER },
  // archive shelving
  { x0: 23, y0: 37, x1: 27, y1: 37, mat: WALL.OFFICE },
  { x0: 29, y0: 37, x1: 32, y1: 37, mat: WALL.OFFICE },
  { x0: 23, y0: 41, x1: 26, y1: 41, mat: WALL.OFFICE },
  { x0: 28, y0: 41, x1: 32, y1: 41, mat: WALL.OFFICE },
  // security desks + office cubicles
  { x0: 7, y0: 37, x1: 10, y1: 37, mat: WALL.OFFICE },
  { x0: 12, y0: 40, x1: 14, y1: 40, mat: WALL.OFFICE },
  { x0: 41, y0: 5, x1: 43, y1: 5, mat: WALL.GLASS },
  { x0: 44, y0: 8, x1: 45, y1: 8, mat: WALL.GLASS },
];

/** kind: 'cash' | 'data'. Cash is heavy, data is the thing the client wants. */
const LOOT = [
  { x: 7, y: 22, kind: 'cash', label: 'Banded cash' },
  { x: 10, y: 22, kind: 'cash', label: 'Bearer bonds' },
  { x: 13, y: 22, kind: 'cash', label: 'Banded cash' },
  { x: 10, y: 27, kind: 'cash', label: 'Bullion bar' },
  { x: 24, y: 25, kind: 'cash', label: 'Till cassette' },
  { x: 31, y: 25, kind: 'cash', label: 'Till cassette' },
  { x: 41, y: 18, kind: 'data', label: 'Client ledger' },
  { x: 45, y: 23, kind: 'data', label: 'Wire records' },
  { x: 41, y: 27, kind: 'data', label: 'Key material' },
  { x: 41, y: 3, kind: 'data', label: 'Board minutes' },
  { x: 45, y: 10, kind: 'cash', label: 'Petty cash' },
  { x: 24, y: 35, kind: 'data', label: 'Deed archive' },
  { x: 31, y: 43, kind: 'cash', label: 'Escrow box' },
];

/** Sweeping wall cameras. `angle` is the centre of the sweep, in radians. */
const CAMERAS = [
  { x: 23.5, y: 2.5, angle: 0.9, sweep: 0.85, speed: 0.45, range: 11 },
  { x: 32.5, y: 2.5, angle: 2.2, sweep: 0.85, speed: 0.38, range: 11 },
  { x: 23.5, y: 17.5, angle: 0.7, sweep: 0.7, speed: 0.5, range: 10 },
  { x: 24.5, y: 13.5, angle: 1.57, sweep: 1.1, speed: 0.33, range: 12 },
  { x: 39.5, y: 34.5, angle: 0.8, sweep: 0.8, speed: 0.42, range: 10 },
  { x: 19.5, y: 20.5, angle: 3.14, sweep: 0.9, speed: 0.4, range: 11 },
];

/** Drone patrol routes. They stick to corridors and hear everything. */
const DRONE_ROUTES = [
  [[6.5, 14.5], [45.5, 14.5]],
  [[19.5, 3.5], [19.5, 47.5]],
  [[45.5, 31.5], [6.5, 31.5]],
  [[36.5, 4.5], [36.5, 44.5]],
];

/**
 * Places the predator likes to be. It does not walk everywhere — it arrives.
 * Junctions and room corners with a view of an approach.
 */
const PERCHES = [
  [19.5, 14.5], [36.5, 14.5], [19.5, 31.5], [36.5, 31.5],
  [2.5, 14.5], [2.5, 31.5], [19.5, 47.5], [36.5, 47.5], [2.5, 47.5],
  [25.5, 5.5], [30.5, 10.5], [42.5, 21.5], [10.5, 23.5], [27.5, 39.5],
  [10.5, 5.5], [19.5, 5.5], [36.5, 8.5], [8.5, 42.5],
];

/**
 * [x, y, r, g, b, radius, flicker?]
 *
 * The building is lit so that every room has a legible identity in the dark:
 * the lobby is painfully bright, the vault is emergency red, the server room
 * is green, the service shaft is a single dying sodium fixture. Brightness is
 * also a game mechanic — `brightnessAt` feeds straight into how easily the
 * predator picks you up — so these numbers are balance, not just mood.
 */
const LIGHTS = [
  // lobby is the brightest place in the building, and the worst place to stand
  [25.5, 3.5, 1.1, 1.05, 0.95, 12, 0],
  [30.5, 3.5, 1.1, 1.05, 0.95, 12, 0],
  [25.5, 10.5, 1.1, 1.05, 0.95, 12, 0],
  [30.5, 10.5, 1.1, 1.05, 0.95, 12, 0],
  [27.5, 6.5, 0.92, 0.88, 0.8, 11, 0],
  // corridors: sparse cold strip lighting
  [8.5, 14.5, 0.82, 0.92, 1.06, 9, 0],
  [16.5, 14.5, 0.82, 0.92, 1.06, 9, 1],
  [24.5, 14.5, 0.82, 0.92, 1.06, 9, 0],
  [32.5, 14.5, 0.82, 0.92, 1.06, 9, 0],
  [41.5, 14.5, 0.82, 0.92, 1.06, 9, 0],
  [10.5, 31.5, 0.76, 0.85, 1.0, 9, 0],
  [21.5, 31.5, 0.76, 0.85, 1.0, 9, 1],
  [31.5, 31.5, 0.76, 0.85, 1.0, 9, 0],
  [41.5, 31.5, 0.76, 0.85, 1.0, 9, 0],
  [19.5, 4.5, 0.7, 0.78, 0.92, 8, 0],
  [19.5, 25.5, 0.7, 0.78, 0.92, 8, 0],
  [19.5, 42.5, 0.7, 0.78, 0.92, 8, 1],
  [36.5, 8.5, 0.7, 0.78, 0.92, 8, 0],
  [36.5, 27.5, 0.7, 0.78, 0.92, 8, 0],
  [36.5, 42.5, 0.7, 0.78, 0.92, 8, 0],
  // service shaft: one dying fixture, and a lot of nothing
  [2.5, 20.5, 0.85, 0.6, 0.26, 8, 1],
  [2.5, 41.5, 0.36, 0.31, 0.25, 7, 0],
  [12.5, 47.5, 0.46, 0.17, 0.16, 8, 0],
  [31.5, 47.5, 0.46, 0.17, 0.16, 8, 0],
  // rooms
  [10.5, 6.5, 0.66, 0.54, 0.34, 10, 0],      // dock
  [10.5, 22.5, 1.15, 0.26, 0.2, 12, 0],      // vault emergency red
  [27.5, 19.5, 1.0, 1.04, 1.1, 10, 0],       // teller hall
  [27.5, 26.5, 0.82, 0.86, 0.94, 10, 0],
  [42.5, 22.5, 0.25, 1.0, 0.78, 11, 0],      // server room glow
  [42.5, 6.5, 0.95, 0.78, 0.46, 10, 0],      // offices
  [27.5, 39.5, 0.58, 0.62, 0.7, 10, 0],      // archive
  [10.5, 39.5, 0.34, 0.53, 0.95, 10, 0],     // security monitors
  // Stairwell: a neutral fill so the room has form, and the exit sign on top
  // of it rather than instead of it.
  [41.5, 37.5, 0.52, 0.56, 0.62, 10, 0],
  [44.5, 41.5, 0.2, 0.6, 0.38, 8, 0],
];

const AMBIENT = [0.115, 0.128, 0.17];

export const SPAWN = { x: 8.5, y: 8.5, angle: -0.35 };
export const EXTRACTION = { x: 44.5, y: 41.5 };

/** How much of the take the fence will accept. */
export const OBJECTIVE = { items: 6, data: 2 };

/* ------------------------------------------------------------------ */

function carve(lv, r) {
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
      const i = y * MAP_W + x;
      lv.walls[i] = 0;
      lv.floors[i] = r.floor;
      lv.ceils[i] = r.ceil;
      lv.zone[i] = r.zoneIndex;
    }
  }
  // Dress the ring of solid cells around the space with the room's material,
  // but never overwrite a wall another room already claimed.
  for (let y = r.y0 - 1; y <= r.y1 + 1; y++) {
    for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const i = y * MAP_W + x;
      if (lv.walls[i] === WALL.CONCRETE && !lv.claimed[i]) {
        lv.walls[i] = r.wall;
        lv.claimed[i] = 1;
      }
    }
  }
}

/** Grid line-of-sight between two world points. Walls block, nothing else. */
export function hasLineOfSight(lv, ax, ay, bx, by) {
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const invX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const invY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let sideX = dx === 0 ? Infinity : (dx > 0 ? (x + 1 - ax) : (ax - x)) * invX;
  let sideY = dy === 0 ? Infinity : (dy > 0 ? (y + 1 - ay) : (ay - y)) * invY;
  let guard = 0;
  while ((x !== ex || y !== ey) && guard++ < 512) {
    if (sideX < sideY) {
      sideX += invX;
      x += stepX;
    } else {
      sideY += invY;
      y += stepY;
    }
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    if (x === ex && y === ey) break;
    if (lv.walls[y * MAP_W + x]) return false;
  }
  return true;
}

function bakeLighting(lv) {
  const n = MAP_W * MAP_H;
  lv.lm = new Float32Array(n * 3);
  lv.lmFlicker = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    lv.lm[i * 3] = AMBIENT[0];
    lv.lm[i * 3 + 1] = AMBIENT[1];
    lv.lm[i * 3 + 2] = AMBIENT[2];
  }
  for (const [lx, ly, lr, lg, lb, radius, flicker] of LIGHTS) {
    const target = flicker ? lv.lmFlicker : lv.lm;
    const x0 = Math.max(0, Math.floor(lx - radius));
    const x1 = Math.min(MAP_W - 1, Math.ceil(lx + radius));
    const y0 = Math.max(0, Math.floor(ly - radius));
    const y1 = Math.min(MAP_H - 1, Math.ceil(ly + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * MAP_W + x;
        const cx = x + 0.5;
        const cy = y + 0.5;
        const d = Math.hypot(cx - lx, cy - ly);
        if (d > radius) continue;
        // Walls get lit too — they are what the player actually sees.
        if (lv.walls[i] === 0 && !hasLineOfSight(lv, lx, ly, cx, cy)) continue;
        const f = (1 - d / radius) ** 1.7;
        target[i * 3] += lr * f;
        target[i * 3 + 1] += lg * f;
        target[i * 3 + 2] += lb * f;
      }
    }
  }
  // Perceived brightness per cell — the AI uses this to decide how exposed
  // the player is, and the HUD uses it for the "in shadow" readout.
  lv.brightness = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = lv.lm[i * 3] + lv.lmFlicker[i * 3] * 0.6;
    const g = lv.lm[i * 3 + 1] + lv.lmFlicker[i * 3 + 1] * 0.6;
    const b = lv.lm[i * 3 + 2] + lv.lmFlicker[i * 3 + 2] * 0.6;
    lv.brightness[i] = Math.min(1, 0.299 * r + 0.587 * g + 0.114 * b);
  }
}

/** Bilinear sample of the baked lighting, including the flicker layer. */
export function sampleLight(lv, x, y, flickerAmt, out) {
  const fx = Math.max(0, Math.min(MAP_W - 1.001, x - 0.5));
  const fy = Math.max(0, Math.min(MAP_H - 1.001, y - 0.5));
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = Math.min(MAP_W - 1, x0 + 1);
  const y1 = Math.min(MAP_H - 1, y0 + 1);
  const i00 = (y0 * MAP_W + x0) * 3;
  const i10 = (y0 * MAP_W + x1) * 3;
  const i01 = (y1 * MAP_W + x0) * 3;
  const i11 = (y1 * MAP_W + x1) * 3;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const lm = lv.lm;
  const fl = lv.lmFlicker;
  for (let c = 0; c < 3; c++) {
    out[c] =
      (lm[i00 + c] + fl[i00 + c] * flickerAmt) * w00 +
      (lm[i10 + c] + fl[i10 + c] * flickerAmt) * w10 +
      (lm[i01 + c] + fl[i01 + c] * flickerAmt) * w01 +
      (lm[i11 + c] + fl[i11 + c] * flickerAmt) * w11;
  }
  return out;
}

export function isWall(lv, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
  return lv.walls[(y | 0) * MAP_W + (x | 0)] !== 0;
}

export function brightnessAt(lv, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 0;
  return lv.brightness[(y | 0) * MAP_W + (x | 0)];
}

export function zoneNameAt(lv, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return '';
  const z = lv.zone[(y | 0) * MAP_W + (x | 0)];
  return z === 255 ? '' : lv.zoneNames[z];
}

/** Every walkable cell reachable from the spawn. Used to validate the map. */
export function reachableCells(lv, sx, sy) {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const stack = [(sy | 0) * MAP_W + (sx | 0)];
  seen[stack[0]] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop();
    count++;
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const j = ny * MAP_W + nx;
      if (seen[j] || lv.walls[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return { seen, count };
}

export function buildLevel() {
  const n = MAP_W * MAP_H;
  const lv = {
    w: MAP_W,
    h: MAP_H,
    walls: new Uint8Array(n).fill(WALL.CONCRETE),
    floors: new Uint8Array(n),
    ceils: new Uint8Array(n),
    zone: new Uint8Array(n).fill(255),
    claimed: new Uint8Array(n),
    zoneNames: [],
    rects: [],
  };

  const all = [...ROOMS, ...CORRIDORS];
  all.forEach((r, idx) => {
    r.zoneIndex = idx;
    lv.zoneNames.push(r.name);
    lv.rects.push({ id: r.id, name: r.name, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
  });
  // Rooms first, corridors second: where they meet, the corridor wins, which
  // is what keeps the crossings open.
  for (const r of ROOMS) carve(lv, r);
  for (const r of CORRIDORS) carve(lv, r);

  for (const [dx, dy] of DOORS) {
    const i = dy * MAP_W + dx;
    lv.walls[i] = 0;
    lv.floors[i] = FLOOR.CONCRETE;
    lv.ceils[i] = CEIL.CONCRETE;
    lv.doors = lv.doors || [];
    lv.doors.push([dx, dy]);
  }

  for (const o of OBSTACLES) {
    for (let y = o.y0; y <= o.y1; y++) {
      for (let x = o.x0; x <= o.x1; x++) {
        lv.walls[y * MAP_W + x] = o.mat;
      }
    }
  }

  // Hard border, no matter what the rectangles said.
  for (let x = 0; x < MAP_W; x++) {
    lv.walls[x] = WALL.CONCRETE;
    lv.walls[(MAP_H - 1) * MAP_W + x] = WALL.CONCRETE;
  }
  for (let y = 0; y < MAP_H; y++) {
    lv.walls[y * MAP_W] = WALL.CONCRETE;
    lv.walls[y * MAP_W + MAP_W - 1] = WALL.CONCRETE;
  }

  bakeLighting(lv);

  lv.loot = LOOT.map((l, i) => ({
    id: i,
    x: l.x + 0.5,
    y: l.y + 0.5,
    kind: l.kind,
    label: l.label,
    taken: false,
  }));
  lv.cameras = CAMERAS.map((c, i) => ({ ...c, id: i, phase: i * 1.3, disabled: false }));
  lv.droneRoutes = DRONE_ROUTES;
  lv.perches = PERCHES.map(([x, y]) => ({ x, y }));
  lv.lights = LIGHTS;
  lv.spawn = { ...SPAWN };
  lv.extraction = { ...EXTRACTION };
  lv.objective = { ...OBJECTIVE };

  return lv;
}
