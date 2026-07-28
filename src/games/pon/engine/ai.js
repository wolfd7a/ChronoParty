/**
 * P.O.N. — the things that are looking for you.
 *
 * Three tiers of threat, deliberately different in kind:
 *
 *  - Cameras are static and predictable. They cost you information.
 *  - Drones patrol and hear everything. They cost you position.
 *  - The predator costs you the run.
 *
 * The predator is faster than a sprinting player on purpose. You are not meant
 * to win a footrace; you are meant to break line of sight, go dark, and let it
 * lose the thread. Everything in its FSM is built around that: it commits hard
 * while it can see you and degrades gracefully into searching when it cannot.
 */

import { hasLineOfSight, brightnessAt, MAP_W } from './level.js';
import { Pathfinder } from './pathfind.js';

export const PRED = {
  DORMANT: 'dormant',
  PATROL: 'patrol',
  INVESTIGATE: 'investigate',
  STALK: 'stalk',
  HUNT: 'hunt',
  PERCH: 'perch',
  TAKEDOWN: 'takedown',
};

export const DIFFICULTY = {
  rookie: {
    label: 'Rookie',
    blurb: 'It wakes late and loses you easily. Two strikes.',
    wakeDelay: 45,
    huntSpeed: 4.4,
    stalkSpeed: 2.9,
    patrolSpeed: 1.4,
    awarenessGain: 0.55,
    awarenessDecay: 0.3,
    loseTime: 3.2,
    hearMul: 0.8,
    strikes: 2,
    drones: 2,
    perchChance: 0.35,
  },
  pro: {
    label: 'Professional',
    blurb: 'It is already awake. It does not get bored. Two strikes.',
    wakeDelay: 22,
    huntSpeed: 5.3,
    stalkSpeed: 3.5,
    patrolSpeed: 1.7,
    awarenessGain: 0.85,
    awarenessDecay: 0.2,
    loseTime: 5,
    hearMul: 1,
    strikes: 2,
    drones: 3,
    perchChance: 0.55,
  },
  legend: {
    label: 'Urban Legend',
    blurb: 'It knew you were coming. One strike.',
    wakeDelay: 8,
    huntSpeed: 6.1,
    stalkSpeed: 4.2,
    patrolSpeed: 2.1,
    awarenessGain: 1.25,
    awarenessDecay: 0.13,
    loseTime: 7,
    hearMul: 1.35,
    strikes: 1,
    drones: 4,
    perchChance: 0.75,
  },
};

const TAU = Math.PI * 2;

function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Shared "walk a path, repath when it goes stale" behaviour. */
class Walker {
  constructor(level, x, y) {
    this.lv = level;
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.path = [];
    this.repathTimer = 0;
    this.goal = null;
  }

  setGoal(pf, gx, gy, force = false) {
    const moved = !this.goal || Math.hypot(this.goal.x - gx, this.goal.y - gy) > 1.2;
    if (!force && !moved && this.path.length) return;
    this.goal = { x: gx, y: gy };
    this.path = pf.find(this.x, this.y, gx, gy);
    this.repathTimer = 0.45;
  }

  /** Returns true once the path has been consumed. */
  advance(dt, speed) {
    this.repathTimer -= dt;
    let budget = speed * dt;
    let guard = 0;
    while (budget > 0 && this.path.length && guard++ < 8) {
      const n = this.path[0];
      const dx = n.x - this.x;
      const dy = n.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-4) {
        this.path.shift();
        continue;
      }
      const step = Math.min(budget, d);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      budget -= step;
      this.angle = Math.atan2(dy, dx);
      if (d - step < 0.02) this.path.shift();
    }
    return this.path.length === 0;
  }
}

/* ------------------------------------------------------------------ */
/* The predator                                                        */
/* ------------------------------------------------------------------ */

export class Predator extends Walker {
  constructor(level, cfg) {
    // Starts as far from the dock as the perch list allows.
    const start = level.perches[level.perches.length - 1];
    super(level, start.x, start.y);
    this.cfg = cfg;
    this.pf = new Pathfinder(level);
    this.state = PRED.DORMANT;
    this.timer = cfg.wakeDelay;
    this.awareness = 0;
    this.lastKnown = null;
    this.lastSeen = 999;
    this.visibleFrames = 0;
    this.showTimer = 0;
    this.frame = 0;
    this.animT = 0;
    this.sawPlayerLastTick = false;
    this.cueTimer = 6;
    this.stunned = 0;
  }

  get speed() {
    switch (this.state) {
      case PRED.HUNT: return this.cfg.huntSpeed;
      case PRED.STALK: return this.cfg.stalkSpeed;
      case PRED.INVESTIGATE: return this.cfg.stalkSpeed * 0.72;
      case PRED.PATROL: return this.cfg.patrolSpeed;
      default: return 0;
    }
  }

  distTo(p) {
    return Math.hypot(p.x - this.x, p.y - this.y);
  }

  /**
   * How loudly the player is broadcasting their position right now.
   * Standing still, crouched, in the dark, with the light off is ~0.05.
   * Sprinting through the lit lobby with the flashlight on is ~2.6.
   */
  exposure(p) {
    const bright = brightnessAt(this.lv, p.x, p.y);
    let e = 0.12 + bright * 1.25;
    if (p.flashlightOn) e += 1.1;
    e += p.moveNoise * 0.9;
    if (p.crouching) e *= 0.45;
    if (p.carrying > 0) e += 0.06 * p.carrying;
    return e;
  }

  canSee(p) {
    const d = this.distTo(p);
    if (d > 26) return false;
    if (!hasLineOfSight(this.lv, this.x, this.y, p.x, p.y)) return false;
    // Wide but not total: you can stand behind it.
    const toPlayer = Math.atan2(p.y - this.y, p.x - this.x);
    return Math.abs(angDiff(toPlayer, this.angle)) < 1.5 || d < 4;
  }

  hear(ev) {
    const d = Math.hypot(ev.x - this.x, ev.y - this.y);
    const radius = ev.loudness * 9 * this.cfg.hearMul;
    if (d > radius) return false;
    // Walls muffle, they do not block.
    const clear = hasLineOfSight(this.lv, this.x, this.y, ev.x, ev.y);
    const strength = (1 - d / radius) * (clear ? 1 : 0.45);
    if (strength < 0.06) return false;
    this.awareness = Math.min(1, this.awareness + strength * 0.65);
    this.lastKnown = { x: ev.x, y: ev.y };
    if (this.state === PRED.DORMANT && this.awareness > 0.35) this.wake();
    return true;
  }

  wake() {
    if (this.state !== PRED.DORMANT) return;
    this.state = PRED.PATROL;
    this.timer = 0;
  }

  /** A perch that can see `target` but that the player is not looking at. */
  pickPerch(target, p, wantVisible) {
    const options = [];
    for (const perch of this.lv.perches) {
      const d = Math.hypot(perch.x - target.x, perch.y - target.y);
      if (d < 4 || d > 20) continue;
      const sees = hasLineOfSight(this.lv, perch.x, perch.y, target.x, target.y);
      if (wantVisible !== sees) continue;
      // Never materialise inside the player's current view frustum.
      const toPerch = Math.atan2(perch.y - p.y, perch.x - p.x);
      const inView = Math.abs(angDiff(toPerch, p.angle)) < 0.75 &&
        hasLineOfSight(this.lv, p.x, p.y, perch.x, perch.y);
      if (inView) continue;
      options.push({ perch, d });
    }
    if (!options.length) return null;
    options.sort((a, b) => a.d - b.d);
    const pick = options[Math.floor(Math.random() * Math.min(4, options.length))];
    return pick.perch;
  }

  randomPerch() {
    return this.lv.perches[Math.floor(Math.random() * this.lv.perches.length)];
  }

  update(dt, world) {
    const p = world.player;
    this.animT += dt;
    this.lastSeen += dt;
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.frame = 0;
      return;
    }

    for (const ev of world.noiseEvents) this.hear(ev);

    const seesPlayer = this.state !== PRED.DORMANT && this.canSee(p);
    if (seesPlayer) {
      const d = this.distTo(p);
      const gain = this.exposure(p) * this.cfg.awarenessGain * (1 - Math.min(0.8, d / 32));
      this.awareness = Math.min(1, this.awareness + gain * dt);
      if (this.awareness > 0.55) {
        this.lastKnown = { x: p.x, y: p.y };
        this.lastSeen = 0;
      }
    } else {
      this.awareness = Math.max(0, this.awareness - this.cfg.awarenessDecay * dt);
    }

    // A one-shot musical sting the first time it locks on.
    if (seesPlayer && this.awareness > 0.7 && !this.sawPlayerLastTick) {
      world.onEvent('spotted');
    }
    this.sawPlayerLastTick = seesPlayer && this.awareness > 0.7;

    // Idle paranoia: distant knocks so the building never feels empty.
    this.cueTimer -= dt;
    if (this.cueTimer <= 0) {
      this.cueTimer = 7 + Math.random() * 12;
      if (this.state !== PRED.HUNT) world.onEvent('ambientCue', this);
    }

    switch (this.state) {
      case PRED.DORMANT: this.tickDormant(dt); break;
      case PRED.PATROL: this.tickPatrol(dt, p, world); break;
      case PRED.INVESTIGATE: this.tickInvestigate(dt, p, world); break;
      case PRED.STALK: this.tickStalk(dt, p, world); break;
      case PRED.HUNT: this.tickHunt(dt, p, world); break;
      case PRED.PERCH: this.tickPerch(dt, p, world); break;
      default: break;
    }

    // Animation frame: 0 idle, 1/2 stride, 3 lunge.
    if (this.state === PRED.HUNT) {
      this.frame = this.distTo(p) < 3 ? 3 : 1 + (Math.floor(this.animT * 7) % 2);
    } else if (this.path.length) {
      this.frame = 1 + (Math.floor(this.animT * 4) % 2);
    } else {
      this.frame = 0;
    }
  }

  tickDormant(dt) {
    this.timer -= dt;
    if (this.timer <= 0) this.wake();
  }

  tickPatrol(dt, p, world) {
    if (this.awareness > 0.55) {
      this.state = PRED.STALK;
      this.timer = 0;
      return;
    }
    if (this.awareness > 0.2 && this.lastKnown) {
      this.state = PRED.INVESTIGATE;
      this.timer = 12;
      this.setGoal(this.pf, this.lastKnown.x, this.lastKnown.y, true);
      return;
    }
    if (this.advance(dt, this.speed) && this.repathTimer <= 0) {
      const t = this.randomPerch();
      this.setGoal(this.pf, t.x, t.y, true);
    }
    void world;
  }

  tickInvestigate(dt, p, world) {
    this.timer -= dt;
    if (this.awareness > 0.62) {
      this.state = PRED.HUNT;
      return;
    }
    if (this.lastKnown) this.setGoal(this.pf, this.lastKnown.x, this.lastKnown.y);
    const done = this.advance(dt, this.speed);
    if ((done && this.repathTimer <= 0) || this.timer <= 0) {
      if (this.awareness > 0.3 && Math.random() < this.cfg.perchChance) {
        this.enterPerch(p, world);
      } else {
        this.state = PRED.PATROL;
        this.path = [];
      }
    }
  }

  /**
   * The signature behaviour: close the distance in a wide arc, stop somewhere
   * you can just about see it, hold for a beat, then be gone.
   */
  tickStalk(dt, p, world) {
    this.timer -= dt;
    if (this.awareness > 0.82 && this.lastSeen < 1.5) {
      this.state = PRED.HUNT;
      return;
    }
    if (this.awareness < 0.28) {
      this.state = PRED.INVESTIGATE;
      this.timer = 10;
      return;
    }

    if (this.showTimer > 0) {
      this.showTimer -= dt;
      // Face the player while it lets itself be seen.
      this.angle = Math.atan2(p.y - this.y, p.x - this.x);
      if (this.showTimer <= 0) {
        this.enterPerch(p, world);
      }
      return;
    }

    if (this.timer <= 0 || (this.advance(dt, this.speed) && this.repathTimer <= 0)) {
      const wantVisible = Math.random() < 0.45;
      const target = this.lastKnown || p;
      const perch = this.pickPerch(target, p, wantVisible);
      if (perch) {
        this.setGoal(this.pf, perch.x, perch.y, true);
        this.timer = 6;
        if (wantVisible) this.showTimer = 0;
      } else {
        this.setGoal(this.pf, target.x, target.y, true);
        this.timer = 6;
      }
      // Standing where it can be seen is a choice it makes on arrival.
      if (!this.path.length && wantVisible) {
        this.showTimer = 1.4;
        world.onEvent('whoosh', this);
      }
    }
  }

  tickHunt(dt, p, world) {
    const d = this.distTo(p);
    if (this.canSee(p)) {
      this.lastSeen = 0;
      this.lastKnown = { x: p.x, y: p.y };
    }
    if (this.lastSeen > this.cfg.loseTime) {
      this.state = Math.random() < this.cfg.perchChance ? PRED.STALK : PRED.INVESTIGATE;
      this.timer = 10;
      this.awareness = Math.min(this.awareness, 0.6);
      world.onEvent('lostYou');
      return;
    }
    const target = this.lastKnown || p;
    this.setGoal(this.pf, target.x, target.y);
    if (this.repathTimer <= 0) this.setGoal(this.pf, target.x, target.y, true);
    this.advance(dt, this.speed);
    if (d < 1.15) {
      this.state = PRED.TAKEDOWN;
      world.onEvent('takedown', this);
    }
  }

  enterPerch(p, world) {
    const target = this.lastKnown || p;
    const perch = this.pickPerch(target, p, false) || this.randomPerch();
    this.state = PRED.PERCH;
    this.timer = 0.9 + Math.random() * 1.4;
    this.pendingPerch = perch;
    world.onEvent('whoosh', this);
  }

  /** It is not on screen during this state; it is "somewhere else". */
  tickPerch(dt, p, world) {
    this.timer -= dt;
    if (this.timer <= 0) {
      const perch = this.pendingPerch || this.randomPerch();
      this.x = perch.x;
      this.y = perch.y;
      this.path = [];
      this.goal = null;
      this.angle = Math.atan2(p.y - this.y, p.x - this.x);
      this.state = this.awareness > 0.6 ? PRED.STALK : PRED.INVESTIGATE;
      this.timer = 8;
      world.onEvent('whoosh', this);
    }
  }

  /** Player used a strike-recovery, or threw something clever. */
  distract(x, y, seconds) {
    this.stunned = Math.max(this.stunned, seconds);
    this.lastKnown = { x, y };
    this.awareness = Math.min(this.awareness, 0.5);
    this.lastSeen = 999;
    if (this.state === PRED.HUNT) this.state = PRED.INVESTIGATE;
    this.path = [];
    this.goal = null;
  }

  /** Called after a takedown so the run can continue. */
  withdraw() {
    const perch = this.randomPerch();
    this.x = perch.x;
    this.y = perch.y;
    this.state = PRED.PATROL;
    this.awareness = 0;
    this.lastKnown = null;
    this.lastSeen = 999;
    this.stunned = 6;
    this.path = [];
    this.goal = null;
  }
}

/* ------------------------------------------------------------------ */
/* Drones                                                              */
/* ------------------------------------------------------------------ */

export class Drone extends Walker {
  constructor(level, route, id) {
    super(level, route[0][0], route[0][1]);
    this.pf = new Pathfinder(level);
    this.route = route;
    this.leg = 0;
    this.id = id;
    this.alertTimer = 0;
    this.investigate = null;
    this.bob = Math.random() * TAU;
    this.cooldown = 0;
  }

  canSee(p) {
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (d > 10) return false;
    if (p.crouching && d > 6.5) return false;
    if (!hasLineOfSight(this.lv, this.x, this.y, p.x, p.y)) return false;
    const toPlayer = Math.atan2(p.y - this.y, p.x - this.x);
    const fov = p.flashlightOn ? 1.1 : 0.62;
    return Math.abs(angDiff(toPlayer, this.angle)) < fov;
  }

  update(dt, world) {
    const p = world.player;
    this.bob += dt * 2.4;
    this.cooldown -= dt;

    for (const ev of world.noiseEvents) {
      const d = Math.hypot(ev.x - this.x, ev.y - this.y);
      if (d < ev.loudness * 8) this.investigate = { x: ev.x, y: ev.y, t: 8 };
    }

    if (this.canSee(p) && this.cooldown <= 0) {
      this.cooldown = 5;
      this.alertTimer = 6;
      world.onEvent('droneAlert', this);
    }

    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.setGoal(this.pf, p.x, p.y);
      if (this.repathTimer <= 0) this.setGoal(this.pf, p.x, p.y, true);
      this.advance(dt, 3.1);
      return;
    }

    if (this.investigate) {
      this.investigate.t -= dt;
      this.setGoal(this.pf, this.investigate.x, this.investigate.y);
      const done = this.advance(dt, 2.5);
      if (done || this.investigate.t <= 0) this.investigate = null;
      return;
    }

    const node = this.route[this.leg];
    this.setGoal(this.pf, node[0], node[1]);
    if (this.advance(dt, 1.9) && this.repathTimer <= 0) {
      this.leg = (this.leg + 1) % this.route.length;
      this.setGoal(this.pf, this.route[this.leg][0], this.route[this.leg][1], true);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Cameras                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cameras fill a per-camera detection meter rather than tripping instantly, so
 * crossing a covered corridor quickly is a real option.
 * Returns the highest detection level this frame, for the HUD.
 */
export function updateCameras(lv, dt, world) {
  const p = world.player;
  let peak = 0;
  for (const c of lv.cameras) {
    if (c.baseAngle === undefined) c.baseAngle = c.angle;
    c.phase += dt * c.speed;
    c.aim = c.baseAngle + Math.sin(c.phase) * c.sweep;
    c.detect = c.detect || 0;

    if (c.disabled) {
      c.detect = Math.max(0, c.detect - dt * 1.5);
      continue;
    }
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    let seen = false;
    if (d < c.range && hasLineOfSight(lv, c.x, c.y, p.x, p.y)) {
      const to = Math.atan2(dy, dx);
      if (Math.abs(angDiff(to, c.aim)) < 0.42) {
        // Crouching low behind counters buys you a little, but not much.
        seen = !(p.crouching && d > c.range * 0.55);
      }
    }
    if (seen) {
      c.detect = Math.min(1, c.detect + dt * (0.55 + (p.flashlightOn ? 0.5 : 0)));
      if (c.detect >= 1 && !c.tripped) {
        c.tripped = true;
        world.onEvent('cameraAlert', c);
      }
    } else {
      c.detect = Math.max(0, c.detect - dt * 0.35);
      if (c.detect <= 0) c.tripped = false;
    }
    peak = Math.max(peak, c.detect);
  }
  return peak;
}

export function cellIndex(x, y) {
  return (y | 0) * MAP_W + (x | 0);
}
