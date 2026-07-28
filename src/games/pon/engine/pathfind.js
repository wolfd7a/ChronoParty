/**
 * Grid A* for the hunters.
 *
 * The map is only 48x50, so a plain binary-heap A* over a flat index array is
 * far cheaper than the allocation churn of anything fancier. Buffers are
 * allocated once per Pathfinder and reused every search.
 */

import { MAP_W, MAP_H } from './level.js';

const N = MAP_W * MAP_H;

/** Minimal binary min-heap keyed by a parallel score array. */
class Heap {
  constructor(scores) {
    this.items = new Int32Array(N);
    this.size = 0;
    this.scores = scores;
  }

  clear() {
    this.size = 0;
  }

  push(v) {
    const a = this.items;
    let i = this.size++;
    a[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[a[p]] <= this.scores[a[i]]) break;
      const t = a[p];
      a[p] = a[i];
      a[i] = t;
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    a[0] = a[--this.size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.scores[a[l]] < this.scores[a[m]]) m = l;
      if (r < this.size && this.scores[a[r]] < this.scores[a[m]]) m = r;
      if (m === i) break;
      const t = a[m];
      a[m] = a[i];
      a[i] = t;
      i = m;
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;

export class Pathfinder {
  constructor(level) {
    this.lv = level;
    this.g = new Float32Array(N);
    this.f = new Float32Array(N);
    this.from = new Int32Array(N);
    this.state = new Uint8Array(N); // 0 unseen, 1 open, 2 closed
    this.stamp = new Int32Array(N);
    this.epoch = 0;
    this.heap = new Heap(this.f);
  }

  /**
   * Shortest walkable path between two world positions.
   * Returns an array of {x, y} cell centres, excluding the start cell, or an
   * empty array when there is no route.
   */
  find(sx, sy, tx, ty, maxNodes = 4000) {
    const lv = this.lv;
    const start = (sy | 0) * MAP_W + (sx | 0);
    const goal = (ty | 0) * MAP_W + (tx | 0);
    if (start === goal) return [];
    if (lv.walls[goal] || lv.walls[start]) return [];

    const { g, f, from, state, stamp } = this;
    const epoch = ++this.epoch;
    this.heap.clear();

    stamp[start] = epoch;
    state[start] = 1;
    g[start] = 0;
    f[start] = this.h(start, goal);
    from[start] = -1;
    this.heap.push(start);

    let expanded = 0;
    while (this.heap.size > 0) {
      const cur = this.heap.pop();
      if (stamp[cur] !== epoch || state[cur] === 2) continue;
      if (cur === goal) return this.rebuild(cur, epoch);
      state[cur] = 2;
      if (++expanded > maxNodes) break;

      const cx = cur % MAP_W;
      const cy = (cur / MAP_W) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = ny * MAP_W + nx;
          if (lv.walls[ni]) continue;
          // No cutting corners through a diagonal gap between two walls.
          if (dx !== 0 && dy !== 0) {
            if (lv.walls[cy * MAP_W + nx] || lv.walls[ny * MAP_W + cx]) continue;
          }
          if (stamp[ni] !== epoch) {
            stamp[ni] = epoch;
            state[ni] = 0;
            g[ni] = Infinity;
          }
          if (state[ni] === 2) continue;
          const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
          const ng = g[cur] + step;
          if (ng < g[ni]) {
            g[ni] = ng;
            f[ni] = ng + this.h(ni, goal);
            from[ni] = cur;
            state[ni] = 1;
            this.heap.push(ni);
          }
        }
      }
    }
    return [];
  }

  /** Octile distance — admissible for 8-way movement. */
  h(a, b) {
    const ax = a % MAP_W;
    const ay = (a / MAP_W) | 0;
    const bx = b % MAP_W;
    const by = (b / MAP_W) | 0;
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  }

  rebuild(goal, epoch) {
    const out = [];
    let cur = goal;
    let guard = 0;
    while (cur !== -1 && guard++ < N) {
      out.push({ x: (cur % MAP_W) + 0.5, y: ((cur / MAP_W) | 0) + 0.5 });
      const prev = this.from[cur];
      if (prev === -1 || this.stamp[prev] !== epoch) break;
      cur = prev;
    }
    out.pop(); // drop the start cell
    out.reverse();
    return out;
  }
}
