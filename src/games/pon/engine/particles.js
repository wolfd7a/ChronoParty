/**
 * P.O.N. — a very small particle system.
 *
 * Particles are just sprites with velocity, so they ride the existing sprite
 * pass in both renderers rather than needing a path of their own. There is no
 * pooling and no allocation-avoidance here on purpose: a landing throws about
 * thirty puffs and they are gone in a second, which is nowhere near enough to
 * matter next to the per-pixel work the renderer is already doing.
 */

const GRAVITY = 1.35;

export class Particles {
  constructor(limit = 220) {
    this.items = [];
    this.limit = limit;
  }

  clear() {
    this.items.length = 0;
  }

  spawn(p) {
    if (this.items.length >= this.limit) this.items.shift();
    this.items.push({
      x: p.x,
      y: p.y,
      z: p.z ?? 0.1,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      vz: p.vz ?? 0,
      life: p.life ?? 1,
      maxLife: p.life ?? 1,
      size: p.size ?? 0.12,
      grow: p.grow ?? 0.6,
      drag: p.drag ?? 2.2,
      gravity: p.gravity ?? 1,
      kind: p.kind ?? 'dust',
      glow: p.glow ?? 0,
    });
  }

  /**
   * A ring of dust kicked outward along the floor, plus a few embers. This is
   * the punctuation on the predator's landing.
   */
  burst(x, y, opts = {}) {
    const count = opts.count ?? 26;
    const power = opts.power ?? 1;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = (0.9 + Math.random() * 2.1) * power;
      this.spawn({
        x, y,
        z: 0.03 + Math.random() * 0.08,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: (0.4 + Math.random() * 1.3) * power,
        life: 0.7 + Math.random() * 0.8,
        size: 0.1 + Math.random() * 0.16,
        grow: 1.5,
        drag: 3.2,
        gravity: 0.55,
        kind: 'dust',
      });
    }
    for (let i = 0; i < (opts.sparks ?? 8); i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 2.6;
      this.spawn({
        x, y,
        z: 0.05,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: 1.2 + Math.random() * 2.2,
        life: 0.4 + Math.random() * 0.5,
        size: 0.03 + Math.random() * 0.04,
        grow: -0.3,
        drag: 1.4,
        gravity: 2.4,
        kind: 'spark',
        glow: 2.5,
      });
    }
  }

  /** Debris shaken loose from the ceiling before something comes through it. */
  ceilingDust(x, y, count = 10) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.9,
        y: y + (Math.random() - 0.5) * 0.9,
        z: 0.96,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        vz: -0.5 - Math.random() * 0.6,
        life: 0.9 + Math.random() * 0.6,
        size: 0.04 + Math.random() * 0.07,
        grow: 0.4,
        drag: 0.8,
        gravity: 1.1,
        kind: 'dust',
      });
    }
  }

  update(dt) {
    const out = [];
    for (const p of this.items) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.vz = p.vz * damp - GRAVITY * p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0.02) {
        p.z = 0.02;
        p.vz = 0;
        // Skidding along the floor rather than bouncing reads as dust.
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      out.push(p);
    }
    this.items = out;
  }

  /** Emit into a sprite list. Fade is carried by shrinking, since sprite
   *  rendering has no per-instance alpha. */
  appendSprites(list) {
    for (const p of this.items) {
      const t = p.life / p.maxLife;
      const fade = t < 0.35 ? t / 0.35 : 1;
      const size = p.size * (1 + (1 - t) * p.grow) * fade;
      if (size < 0.006) continue;
      list.push({
        x: p.x,
        y: p.y,
        kind: p.kind,
        worldH: size,
        z: p.z,
        glow: p.glow,
        lightMul: p.kind === 'spark' ? 1.2 : 0.85,
      });
    }
  }
}
