/**
 * P.O.N. — Wren, the other half of the crew.
 *
 * The real game is 1-4 player co-op. Rather than pretend a solo run is the
 * whole thing, Wren stands in for the partner: she is physically present in the
 * level, she talks, and — importantly — the predator considers her a target.
 * That last part is what makes her more than decoration. She can pull heat off
 * you, and losing her costs you the eyes and the second pair of hands.
 *
 * She is deliberately not a bodyguard. She cannot fight anything. Everything
 * she does is about information and misdirection, which is the same currency
 * the player is spending.
 */

import { hasLineOfSight, brightnessAt, isWall } from './level.js';
import { Pathfinder } from './pathfind.js';
import { BARK } from './voice.js';

export const WREN = {
  FOLLOW: 'follow',
  HOLD: 'hold',
  SCOUT: 'scout',
  HIDE: 'hide',
  DISTRACT: 'distract',
  DOWNED: 'downed',
  GONE: 'gone',
};

export const ORDER = {
  FOLLOW: 'follow',
  HOLD: 'hold',
  DISTRACT: 'distract',
};

/** Sprite frame indices; see COMPANION_POSES in textures.js. */
const FRAME = { IDLE: 0, STRIDE_A: 1, STRIDE_B: 2, CROUCH: 3, DOWN: 4 };

const SPEED = { follow: 2.9, sprint: 4.2, sneak: 1.4 };

/**
 * The bark book. `when` is evaluated against a context snapshot each tick and
 * the highest-priority match that is off cooldown wins, so she stays quiet
 * unless she has something worth saying.
 */
const LINES = [
  {
    id: 'predator-hunting',
    priority: BARK.URGENT,
    cooldown: 9,
    when: (c) => c.predatorHunting && c.predatorDist < 18,
    text: () => pick([
      'It is on you. Move, move.',
      'Run. Do not look back.',
      'It has you. Break the line.',
    ]),
  },
  {
    id: 'predator-drop',
    priority: BARK.URGENT,
    cooldown: 8,
    when: (c) => c.ceilingWarn,
    text: () => pick([
      'Above you. Above you.',
      'Ceiling. Get out from under it.',
    ]),
  },
  {
    id: 'predator-close',
    priority: BARK.WARN,
    cooldown: 16,
    when: (c) => c.predatorDist < 9 && !c.predatorHunting,
    text: () => pick([
      'It is close. Kill the light.',
      'Stop. It is right there.',
      'Do not move. Let it pass.',
    ]),
  },
  {
    id: 'torch-exposed',
    priority: BARK.WARN,
    cooldown: 26,
    when: (c) => c.flashlight && c.predatorAware > 0.35,
    text: () => 'Your torch. It can see that from the far end.',
  },
  {
    id: 'too-bright',
    priority: BARK.INFO,
    cooldown: 34,
    when: (c) => c.brightness > 0.55 && c.predatorAware > 0.2,
    text: () => 'You are lit up like a shop window. Get to the dark.',
  },
  {
    id: 'drone',
    priority: BARK.WARN,
    cooldown: 14,
    when: (c) => c.droneDist < 9,
    text: () => pick(['Drone. Hold still.', 'Machine coming. Wait.']),
  },
  {
    id: 'camera',
    priority: BARK.INFO,
    cooldown: 18,
    when: (c) => c.cameraDetect > 0.25,
    text: () => 'Camera is sweeping you. Move out of the arc.',
  },
  {
    id: 'loot-spotted',
    priority: BARK.INFO,
    cooldown: 20,
    when: (c) => c.lootInSight,
    // Phrased to survive both singular and plural labels.
    text: (c) => `${pick(['I see', 'Got eyes on', 'Spotted'])} ${c.lootInSight.label.toLowerCase()} over here.`,
  },
  {
    id: 'sprinting',
    priority: BARK.CHATTER,
    cooldown: 40,
    when: (c) => c.sprinting && c.predatorAware > 0.15,
    text: () => 'Every step you take running, it hears.',
  },
  {
    id: 'objective-ready',
    priority: BARK.WARN,
    cooldown: 45,
    when: (c) => c.objectiveReady,
    text: () => 'That is the six. Stairwell. We are done here.',
  },
  {
    id: 'progress',
    priority: BARK.CHATTER,
    cooldown: 12,
    when: (c) => c.justBagged,
    text: (c) => (c.remaining === 1 ? 'One more piece.' : `${c.remaining} more to go.`),
  },
  {
    id: 'idle',
    priority: BARK.CHATTER,
    cooldown: 60,
    when: (c) => c.idleFor > 26,
    text: () => pick([
      'We are burning clock.',
      'Whatever you are thinking about, think faster.',
    ]),
  },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class Companion {
  constructor(level, spawn) {
    this.lv = level;
    this.pf = new Pathfinder(level);
    this.x = spawn.x + 0.9;
    this.y = spawn.y + 0.6;
    this.angle = spawn.angle;
    this.state = WREN.FOLLOW;
    this.order = ORDER.FOLLOW;
    this.path = [];
    this.repathTimer = 0;
    this.goal = null;
    this.animT = 0;
    this.frame = FRAME.IDLE;
    this.downs = 0;
    this.reviveProgress = 0;
    this.downedGrace = 0;
    this.holdAt = null;
    this.distractAt = null;
    this.distractTimer = 0;
    this.bagged = 0;
    this.lootCooldown = 0;
    this.said = null;
  }

  get alive() {
    return this.state !== WREN.GONE;
  }

  get active() {
    return this.state !== WREN.GONE && this.state !== WREN.DOWNED;
  }

  /* ---------------------------------------------------------------- */

  setOrder(order, world) {
    if (!this.active) return null;
    this.order = order;
    if (order === ORDER.HOLD) {
      this.holdAt = { x: this.x, y: this.y };
      this.state = WREN.HOLD;
      return { id: 'ack-hold', priority: BARK.INFO, cooldown: 0, text: pick(['Holding.', 'I am not moving.']) };
    }
    if (order === ORDER.FOLLOW) {
      this.state = WREN.FOLLOW;
      this.holdAt = null;
      return { id: 'ack-follow', priority: BARK.INFO, cooldown: 0, text: pick(['On you.', 'Right behind you.']) };
    }
    if (order === ORDER.DISTRACT) {
      const spot = this.pickDistractSpot(world);
      if (!spot) {
        return { id: 'ack-nodistract', priority: BARK.INFO, cooldown: 0, text: 'Nowhere to draw it to. Not from here.' };
      }
      this.distractAt = spot;
      this.distractTimer = 16;
      this.state = WREN.DISTRACT;
      this.order = ORDER.FOLLOW;
      return {
        id: 'ack-distract',
        priority: BARK.WARN,
        cooldown: 0,
        text: pick(['Going loud. Do not waste it.', 'Pulling it off you. Move.']),
      };
    }
    return null;
  }

  /** Somewhere far from the player, and preferably away from the exit route. */
  pickDistractSpot(world) {
    const p = world.player;
    let best = null;
    let bestScore = -Infinity;
    for (const perch of this.lv.perches) {
      const dp = Math.hypot(perch.x - p.x, perch.y - p.y);
      if (dp < 9) continue;
      const dw = Math.hypot(perch.x - this.x, perch.y - this.y);
      // Far from the player, but not so far she spends the whole run walking.
      const score = dp - dw * 0.55;
      if (score > bestScore) {
        bestScore = score;
        best = perch;
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- */

  moveTo(gx, gy, speed, dt) {
    this.repathTimer -= dt;
    const stale = !this.goal || Math.hypot(this.goal.x - gx, this.goal.y - gy) > 1.4;
    if (stale || (this.repathTimer <= 0 && !this.path.length)) {
      this.goal = { x: gx, y: gy };
      this.path = this.pf.find(this.x, this.y, gx, gy);
      this.repathTimer = 0.5;
    }
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

  /* ---------------------------------------------------------------- */

  update(dt, world) {
    this.animT += dt;
    this.lootCooldown -= dt;
    if (this.state === WREN.GONE) return;

    const p = world.player;
    const pr = world.predator;
    const distToPlayer = Math.hypot(p.x - this.x, p.y - this.y);
    const distToPredator = Math.hypot(pr.x - this.x, pr.y - this.y);

    if (this.state === WREN.DOWNED) {
      this.frame = FRAME.DOWN;
      this.downedGrace -= dt;
      // Leave her there and it comes back for her — but not instantly. The
      // thing that just put her down is still standing over her, and taking
      // her there and then would give the player no window at all.
      if (this.downedGrace <= 0 && distToPredator < 1.4 && pr.awareness > 0.4) {
        this.abandon();
        world.onCompanionLost();
      }
      return;
    }

    // Caught. She is not killed either — she is taken, same as you.
    if (distToPredator < 1.05 && pr.canSee(this)) {
      this.down(world);
      return;
    }

    // Anything closer than this and she stops being useful and starts being
    // quiet, regardless of what she was told to do.
    const scared = distToPredator < 7 && pr.awareness > 0.45;

    if (scared && this.state !== WREN.DISTRACT) {
      this.state = WREN.HIDE;
    } else if (this.state === WREN.HIDE) {
      this.state = this.order === ORDER.HOLD ? WREN.HOLD : WREN.FOLLOW;
    }

    switch (this.state) {
      case WREN.HIDE: {
        // Freeze and go dark. Standing still is the whole trick.
        this.frame = FRAME.CROUCH;
        this.angle = Math.atan2(pr.y - this.y, pr.x - this.x);
        this.path = [];
        this.goal = null;
        return;
      }
      case WREN.DISTRACT: {
        this.distractTimer -= dt;
        const there = this.moveTo(this.distractAt.x, this.distractAt.y, SPEED.sprint, dt);
        // Loud on purpose, the entire way.
        world.emitNoise(this.x, this.y, 1.15);
        if (there || this.distractTimer <= 0) {
          this.state = WREN.FOLLOW;
          this.distractAt = null;
        }
        this.frame = FRAME.STRIDE_A + (Math.floor(this.animT * 8) % 2);
        return;
      }
      case WREN.HOLD: {
        const anchor = this.holdAt || { x: this.x, y: this.y };
        if (Math.hypot(anchor.x - this.x, anchor.y - this.y) > 0.5) {
          this.moveTo(anchor.x, anchor.y, SPEED.sneak, dt);
        } else {
          this.path = [];
        }
        this.frame = FRAME.CROUCH;
        this.tryGrabLoot(world);
        return;
      }
      default: {
        // Follow: hang back a couple of cells, and match the player's pace so
        // she is not sprinting noisily while you are trying to creep.
        const behindX = p.x - Math.cos(p.angle) * 1.7;
        const behindY = p.y - Math.sin(p.angle) * 1.7;
        const speed = distToPlayer > 7 ? SPEED.sprint
          : p.crouching ? SPEED.sneak : SPEED.follow;
        if (distToPlayer > 2.1) {
          this.moveTo(behindX, behindY, speed, dt);
          this.frame = FRAME.STRIDE_A + (Math.floor(this.animT * 6) % 2);
          if (!p.crouching) world.emitNoise(this.x, this.y, 0.22);
        } else {
          this.path = [];
          this.goal = null;
          this.frame = p.crouching ? FRAME.CROUCH : FRAME.IDLE;
          this.angle = p.angle;
        }
        this.tryGrabLoot(world);
      }
    }
  }

  /** She pockets anything she walks over. Two pairs of hands is the point. */
  tryGrabLoot(world) {
    if (this.lootCooldown > 0) return;
    for (const l of this.lv.loot) {
      if (l.taken) continue;
      if (Math.hypot(l.x - this.x, l.y - this.y) > 0.85) continue;
      this.lootCooldown = 1.2;
      this.bagged += 1;
      world.takeLoot(l, this);
      return;
    }
  }

  down(world) {
    this.state = WREN.DOWNED;
    this.downs += 1;
    this.reviveProgress = 0;
    this.downedGrace = 14;
    this.path = [];
    this.goal = null;
    world.onCompanionDown(this);
  }

  /** Returns true on the frame the revive completes. */
  revive(dt) {
    if (this.state !== WREN.DOWNED) return false;
    this.reviveProgress = Math.min(1, this.reviveProgress + dt / 3.2);
    if (this.reviveProgress >= 1) {
      this.state = WREN.FOLLOW;
      this.order = ORDER.FOLLOW;
      this.reviveProgress = 0;
      return true;
    }
    return false;
  }

  abandon() {
    this.state = WREN.GONE;
  }

  /* ---------------------------------------------------------------- */

  /** Anything worth stealing that she can actually see from where she stands. */
  lootInSight() {
    for (const l of this.lv.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.x - this.x, l.y - this.y);
      if (d > 7) continue;
      if (!hasLineOfSight(this.lv, this.x, this.y, l.x, l.y)) continue;
      return l;
    }
    return null;
  }

  /**
   * Choose what, if anything, she says this tick. Returns a line object for the
   * Voice queue, or null.
   */
  chooseLine(ctx) {
    if (!this.active) return null;
    let best = null;
    for (const line of LINES) {
      if (!line.when(ctx)) continue;
      if (best && (line.priority ?? 0) <= (best.priority ?? 0)) continue;
      best = line;
    }
    if (!best) return null;
    return {
      id: best.id,
      priority: best.priority,
      cooldown: best.cooldown,
      text: best.text(ctx),
    };
  }

  /** Barks that fire from a specific event rather than from world state. */
  static eventLine(kind) {
    switch (kind) {
      case 'down':
        return { id: 'wren-down', priority: BARK.URGENT, cooldown: 0, text: pick(['It got me — go, go!', 'I am down. Do not come back for me.']) };
      case 'revived':
        return { id: 'wren-up', priority: BARK.WARN, cooldown: 0, text: pick(['I owe you. Move.', 'Up. I am up.']) };
      case 'lost':
        return { id: 'wren-lost', priority: BARK.URGENT, cooldown: 0, text: 'They have got her. You are on your own.' };
      case 'wren-loot':
        return { id: 'wren-loot', priority: BARK.CHATTER, cooldown: 6, text: pick(['Got one.', 'In the bag.', 'That is mine.']) };
      case 'extract':
        return { id: 'wren-extract', priority: BARK.WARN, cooldown: 0, text: 'Go. I am right behind you.' };
      case 'start':
        return { id: 'wren-start', priority: BARK.INFO, cooldown: 0, text: 'Six pieces, two of them data. I will call what I see.' };
      default:
        return null;
    }
  }

  /**
   * How loudly she is advertising herself, on the same scale the predator uses
   * for the player. Deliberately spikes while distracting — that is the whole
   * transaction.
   */
  exposure() {
    if (!this.active) return 0;
    let e = 0.1 + brightnessAt(this.lv, this.x, this.y) * 0.9;
    if (this.state === WREN.DISTRACT) e += 1.8;
    if (this.state === WREN.HIDE) e *= 0.25;
    if (this.path.length) e += 0.35;
    return e;
  }

  /** Where she is standing, for the tablet. */
  marker() {
    return { x: this.x, y: this.y, state: this.state };
  }
}

export { isWall };
