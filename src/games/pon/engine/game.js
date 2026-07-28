/**
 * P.O.N. — the game itself.
 *
 * Owns the fixed-timestep simulation, the player, input (keyboard + pointer
 * lock, and a touch layer for phones), and the bridge to React: the UI never
 * reads simulation state directly, it receives an immutable snapshot ~12 times
 * a second via `onHud`.
 *
 * The design rule everything else follows: the player has no weapon. Every
 * verb is about *information* — where you are, how loud you are, how lit you
 * are, and what the thing hunting you currently believes.
 */

import { buildLevel, isWall, brightnessAt, zoneNameAt, MAP_W } from './level.js';
import { buildAtlas, FLOOR } from './textures.js';
import { Renderer } from './renderer.js';
import { GLRenderer } from './glrenderer.js';
import { AudioEngine } from './audio.js';
import { Predator, Drone, updateCameras, DIFFICULTY, PRED } from './ai.js';
import { Companion, ORDER, WREN } from './companion.js';
import { Particles } from './particles.js';
import { Voice, BARK } from './voice.js';

const PLAYER_RADIUS = 0.26;
const WALK_SPEED = 2.65;
const SPRINT_SPEED = 4.5;
const CROUCH_SPEED = 1.3;
const MOUSE_SENS = 0.0021;
const MAX_PITCH = 0.42;

/** Interactable terminals. The security desk is the only way to kill cameras. */
const TERMINALS = [
  {
    id: 'security',
    x: 10.5,
    y: 39.5,
    label: 'Security terminal',
    prompt: 'Hold [E] — cut the camera feed',
    duration: 2.4,
    loudness: 0.5,
  },
];

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    // 'ultra' uses the WebGL2 pipeline, 'retro' the software raycaster. A
    // canvas can only ever hand out one context type, so this is decided once
    // per canvas and the UI only offers the choice before a run starts.
    const wantGL = (opts.graphics || 'ultra') !== 'retro';
    this.renderer = wantGL ? GLRenderer.tryCreate(canvas) : null;
    this.graphics = this.renderer ? 'ultra' : 'retro';
    if (!this.renderer) this.renderer = new Renderer(canvas);
    this.audio = new AudioEngine();
    this.onHud = opts.onHud || (() => {});
    this.onEnd = opts.onEnd || (() => {});
    this.onQuality = opts.onQuality || (() => {});
    this.difficultyKey = opts.difficulty || 'pro';
    this.cfg = DIFFICULTY[this.difficultyKey] || DIFFICULTY.pro;
    this.quality = opts.quality || 300;
    this.atlas = buildAtlas();
    this.keys = new Set();
    this.running = false;
    this.paused = false;
    this.destroyed = false;
    this.touch = { move: null, look: null, moveX: 0, moveY: 0, lookDX: 0, lookDY: 0 };
    this.buttons = { sprint: false, crouch: false, interact: false };
    this.reset();
    this.bindEvents();
    // Dev-only handle so the running simulation can be poked from the console
    // or a browser test — teleporting the predator is the only practical way
    // to exercise the chase without playing for five minutes.
    if (import.meta.env?.DEV) window.__PON__ = this;
  }

  /* ---------------------------------------------------------------- */
  /* setup                                                            */
  /* ---------------------------------------------------------------- */

  reset() {
    const lv = buildLevel();
    this.lv = lv;
    this.terminals = TERMINALS.map((t) => ({ ...t, used: false, progress: 0 }));

    this.player = {
      x: lv.spawn.x,
      y: lv.spawn.y,
      angle: lv.spawn.angle,
      pitch: 0,
      crouching: false,
      sprinting: false,
      flashlightOn: false,
      battery: 100,
      stamina: 100,
      staminaLock: 0,
      moveNoise: 0,
      carrying: 0,
      bob: 0,
      speed: 0,
      height: 0.5,
    };

    this.bag = { items: 0, data: 0, cash: 0, value: 0 };
    this.noisemakers = 3;
    this.strikes = this.cfg.strikes;
    this.heat = 0;
    this.time = 0;
    this.flick = 1;
    this.blind = 0;
    this.dread = 0;
    this.status = 'playing'; // playing | caught | busted | extracted
    this.messages = [];
    this.noiseEvents = [];
    this.footTimer = 0;
    this.interactTimer = 0;
    this.hudTimer = 0;
    this.cameraPeak = 0;
    this.thrown = [];
    this.endSequence = 0;
    this.tablet = false;
    this.focus = null;
    this.pickupCooldown = 0;
    this.frameAvg = 16.7;
    this.slowFor = 0;
    this.qualityDrops = 0;

    this.predator = new Predator(lv, this.cfg);
    this.drones = lv.droneRoutes
      .slice(0, this.cfg.drones)
      .map((route, i) => new Drone(lv, route, i));

    this.particles = new Particles();
    this.companion = new Companion(lv, lv.spawn);
    this.voice = this.voice || new Voice();
    this.voice.cancel();
    this.voice.onClick = (open) => this.audio.radioClick(open);
    this.shake = 0;
    this.shakeSeed = Math.random() * 100;
    this.barkTimer = 1.5;
    this.idleFor = 0;
    this.justBagged = 0;
    this.ceilingWarnFor = 0;

    this.pushMessage('Meridian Trust. Six pieces minimum, two of them data.', 6);
    this.pushMessage('Get to the fire stairwell when you have them.', 6);
  }

  setDifficulty(key) {
    this.difficultyKey = key;
    this.cfg = DIFFICULTY[key] || DIFFICULTY.pro;
  }

  bindEvents() {
    this.onKeyDown = (e) => {
      if (this.destroyed) return;
      const k = e.key.toLowerCase();
      if (['tab', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();
      }
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === 'f') this.toggleFlashlight();
      if (k === 'g') this.throwNoisemaker();
      if (k === 'tab') this.tablet = !this.tablet;
      if (k === '1') this.order(ORDER.FOLLOW);
      if (k === '2') this.order(ORDER.HOLD);
      if (k === '3') this.order(ORDER.DISTRACT);
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'e') this.interactTimer = 0;
    };
    this.onMouseMove = (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.player.angle += e.movementX * MOUSE_SENS;
      this.player.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, this.player.pitch - e.movementY * MOUSE_SENS * 0.8),
      );
    };
    this.onBlur = () => this.keys.clear();
    this.onVisibility = () => {
      if (document.hidden) this.paused = true;
    };

    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.bindTouch();
  }

  bindTouch() {
    const c = this.canvas;
    const rectHalf = () => c.getBoundingClientRect();

    this.onTouchStart = (e) => {
      const r = rectHalf();
      for (const t of e.changedTouches) {
        const local = t.clientX - r.left;
        if (local < r.width * 0.45 && this.touch.move === null) {
          this.touch.move = { id: t.identifier, ox: t.clientX, oy: t.clientY };
        } else if (this.touch.look === null) {
          this.touch.look = { id: t.identifier, px: t.clientX, py: t.clientY };
        }
      }
      e.preventDefault();
    };
    this.onTouchMove = (e) => {
      for (const t of e.changedTouches) {
        if (this.touch.move && t.identifier === this.touch.move.id) {
          const dx = t.clientX - this.touch.move.ox;
          const dy = t.clientY - this.touch.move.oy;
          const m = Math.max(1, Math.hypot(dx, dy));
          const k = Math.min(1, m / 56) / m;
          this.touch.moveX = dx * k;
          this.touch.moveY = dy * k;
        } else if (this.touch.look && t.identifier === this.touch.look.id) {
          this.touch.lookDX += t.clientX - this.touch.look.px;
          this.touch.lookDY += t.clientY - this.touch.look.py;
          this.touch.look.px = t.clientX;
          this.touch.look.py = t.clientY;
        }
      }
      e.preventDefault();
    };
    this.onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this.touch.move && t.identifier === this.touch.move.id) {
          this.touch.move = null;
          this.touch.moveX = 0;
          this.touch.moveY = 0;
        }
        if (this.touch.look && t.identifier === this.touch.look.id) this.touch.look = null;
      }
    };

    c.addEventListener('touchstart', this.onTouchStart, { passive: false });
    c.addEventListener('touchmove', this.onTouchMove, { passive: false });
    c.addEventListener('touchend', this.onTouchEnd);
    c.addEventListener('touchcancel', this.onTouchEnd);
  }

  destroy() {
    this.destroyed = true;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    const c = this.canvas;
    c.removeEventListener('touchstart', this.onTouchStart);
    c.removeEventListener('touchmove', this.onTouchMove);
    c.removeEventListener('touchend', this.onTouchEnd);
    c.removeEventListener('touchcancel', this.onTouchEnd);
    this.renderer.destroy?.();
    this.voice?.cancel();
    this.audio.stop();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.audio.start();
    this.last = performance.now();
    // Wren opens the run once audio is unlocked by the same gesture.
    setTimeout(() => {
      if (!this.destroyed && this.status === 'playing') this.speakEvent('start');
    }, 900);
    const step = (now) => {
      if (!this.running || this.destroyed) return;
      this.raf = requestAnimationFrame(step);
      // Upper clamp stops a backgrounded tab from teleporting the predator on
      // return; the lower clamp matters because the first rAF timestamp can
      // predate the performance.now() captured in start(), and a negative dt
      // runs every eased value backwards past zero.
      const rawMs = now - this.last;
      const dt = Math.max(0, Math.min(0.05, rawMs / 1000));
      this.last = now;
      if (!this.paused) {
        this.tick(dt);
        this.governQuality(Math.min(200, rawMs));
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(step);
  }

  setPaused(p) {
    this.paused = p;
    if (!p) this.last = performance.now();
  }

  resize(w, h, quality) {
    this.quality = quality || this.quality;
    this.cssW = w;
    this.cssH = h;
    this.renderer.resize(w, h, this.quality);
  }

  /**
   * Adaptive detail. The GPU path can be asked to do a lot — per-pixel DDA,
   * reflection rays, volumetrics, bloom — and there is no way to know in
   * advance what hardware it landed on. If frame time stays bad for a couple of
   * seconds, step the preset down rather than let someone play a slideshow.
   * Only ever steps down, and only twice, so it cannot oscillate.
   */
  governQuality(dtMs) {
    if (this.graphics !== 'ultra' || this.qualityDrops >= 2) return;
    this.frameAvg += (dtMs - this.frameAvg) * 0.05;
    if (this.frameAvg < 34) {
      this.slowFor = 0;
      return;
    }
    this.slowFor += dtMs / 1000;
    if (this.slowFor < 2.5) return;
    const next = this.quality > 300 ? 300 : 220;
    if (next >= this.quality) {
      this.qualityDrops = 2;
      return;
    }
    this.qualityDrops += 1;
    this.slowFor = 0;
    this.frameAvg = 16.7;
    this.quality = next;
    if (this.cssW) this.renderer.resize(this.cssW, this.cssH, next);
    this.onQuality(next);
    this.pushMessage('Detail reduced to hold the frame rate.', 4);
  }

  requestPointerLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  /* ---------------------------------------------------------------- */
  /* simulation                                                       */
  /* ---------------------------------------------------------------- */

  tick(dt) {
    this.time += dt;
    this.updateFlicker(dt);
    this.noiseEvents.length = 0;

    if (this.status === 'playing') {
      this.updatePlayer(dt);
      this.updateInteraction(dt);
    } else {
      this.endSequence += dt;
      this.blind = Math.max(0, this.blind - dt * 0.6);
    }

    this.updateThrown(dt);

    const world = {
      player: this.player,
      predator: this.predator,
      companion: this.companion,
      noiseEvents: this.noiseEvents,
      onEvent: (type, src) => this.handleEvent(type, src),
      emitNoise: (x, y, l) => this.emitNoise(x, y, l),
      takeLoot: (l, by) => this.takeLoot(l, by),
      onCompanionDown: () => this.handleCompanionDown(),
      onCompanionLost: () => {
        this.speakEvent('lost');
        this.pushMessage('Wren is gone. You are on your own now.', 6);
        this.audio.stinger();
      },
    };

    if (this.status === 'playing' || this.status === 'caught') {
      this.predator.update(dt, world);
      for (const d of this.drones) d.update(dt, world);
      this.cameraPeak = updateCameras(this.lv, dt, world);
      this.companion.update(dt, world);
    }

    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.9);
    this.ceilingWarnFor = Math.max(0, this.ceilingWarnFor - dt);
    this.justBagged = Math.max(0, this.justBagged - dt);
    this.voice.update(dt);
    this.updateBarks(dt);

    this.heat = Math.max(0, this.heat - dt * 0.012);
    this.updateDread(dt);
    this.audio.update(dt, this.dread, this.player.crouching ? 0.35 : 0);

    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);

    if (this.status === 'caught' && this.endSequence > 2.2) this.resolveTakedown();

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      this.emitHud();
    }
  }

  /** Player orders to Wren. The ack is itself a bark. */
  order(kind) {
    if (this.status !== 'playing') return;
    const line = this.companion.setOrder(kind, { player: this.player });
    if (line) this.voice.say(line, this.time);
  }

  /**
   * Wren decides what to say. Polled rather than event-driven so that the
   * highest-priority *current* truth wins — telling you a camera is sweeping
   * while something is dropping through the ceiling would be worse than useless.
   */
  updateBarks(dt) {
    if (this.status !== 'playing' || !this.companion.active) return;
    const p = this.player;
    this.idleFor = p.speed > 0.2 ? 0 : this.idleFor + dt;
    this.barkTimer -= dt;
    if (this.barkTimer > 0) return;
    this.barkTimer = 0.7;

    const pr = this.predator;
    let droneDist = 99;
    for (const d of this.drones) {
      droneDist = Math.min(droneDist, Math.hypot(d.x - p.x, d.y - p.y));
    }
    const line = this.companion.chooseLine({
      predatorDist: Math.hypot(pr.x - p.x, pr.y - p.y),
      predatorHunting: pr.state === PRED.HUNT,
      predatorAware: pr.awareness,
      ceilingWarn: this.ceilingWarnFor > 0,
      flashlight: p.flashlightOn,
      sprinting: p.sprinting,
      brightness: brightnessAt(this.lv, p.x, p.y),
      droneDist,
      cameraDetect: this.cameraPeak,
      lootInSight: this.companion.lootInSight(),
      objectiveReady: this.bag.items >= this.lv.objective.items
        && this.bag.data >= this.lv.objective.data,
      justBagged: this.justBagged > 0,
      remaining: Math.max(0, this.lv.objective.items - this.bag.items),
      idleFor: this.idleFor,
    });
    if (line) this.voice.say(line, this.time);
  }

  speakEvent(kind) {
    const line = Companion.eventLine(kind);
    if (line) this.voice.say(line, this.time);
  }

  handleCompanionDown() {
    this.speakEvent('down');
    this.pushMessage('Wren is down. Hold [E] over her to bring her round.', 6);
    this.particles.burst(this.companion.x, this.companion.y, { count: 12, power: 0.6, sparks: 0 });
    this.shake = Math.max(this.shake, 0.35);
  }

  updateFlicker(dt) {
    // Two incommensurate sines plus a rare hard dropout: reads as a failing
    // ballast rather than a sine wave.
    const t = this.time;
    const base = 0.55 + 0.45 * Math.sin(t * 11.3) * Math.sin(t * 4.1);
    const dropout = Math.sin(t * 2.3) > 0.985 ? 0.05 : 1;
    this.flick += ((base * dropout) - this.flick) * Math.min(1, dt * 22);
  }

  updatePlayer(dt) {
    const p = this.player;

    // --- look ---
    if (this.keys.has('arrowleft')) p.angle -= 2.1 * dt;
    if (this.keys.has('arrowright')) p.angle += 2.1 * dt;
    if (this.keys.has('arrowup')) p.pitch = Math.min(MAX_PITCH, p.pitch + 1.1 * dt);
    if (this.keys.has('arrowdown')) p.pitch = Math.max(-MAX_PITCH, p.pitch - 1.1 * dt);
    if (this.touch.lookDX || this.touch.lookDY) {
      p.angle += this.touch.lookDX * 0.0042;
      p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch - this.touch.lookDY * 0.0032));
      this.touch.lookDX = 0;
      this.touch.lookDY = 0;
    }

    // --- intent ---
    let fwd = 0;
    let strafe = 0;
    // QWERTY and AZERTY both, since the shell app is French.
    if (this.keys.has('w') || this.keys.has('z')) fwd += 1;
    if (this.keys.has('s')) fwd -= 1;
    if (this.keys.has('a') || this.keys.has('q')) strafe -= 1;
    if (this.keys.has('d')) strafe += 1;
    if (this.touch.moveX || this.touch.moveY) {
      fwd += -this.touch.moveY;
      strafe += this.touch.moveX;
    }
    const mag = Math.hypot(fwd, strafe);
    if (mag > 1) {
      fwd /= mag;
      strafe /= mag;
    }

    p.crouching = this.keys.has('control') || this.keys.has('c') || this.buttons.crouch;
    const wantsSprint =
      (this.keys.has('shift') || this.buttons.sprint) && !p.crouching && p.stamina > 1;
    p.sprinting = wantsSprint && mag > 0.15;

    // --- stamina ---
    if (p.sprinting) {
      p.stamina = Math.max(0, p.stamina - 21 * dt);
      p.staminaLock = 1.1;
      if (p.stamina <= 0) p.sprinting = false;
    } else {
      p.staminaLock = Math.max(0, p.staminaLock - dt);
      if (p.staminaLock <= 0) p.stamina = Math.min(100, p.stamina + 15 * dt);
    }

    // --- speed ---
    let speed = p.crouching ? CROUCH_SPEED : p.sprinting ? SPRINT_SPEED : WALK_SPEED;
    speed *= 1 - Math.min(0.22, this.bag.items * 0.035);
    if (this.tablet) speed *= 0.55;
    if (this.interactTimer > 0) speed = 0;

    const vx = (Math.cos(p.angle) * fwd - Math.sin(p.angle) * strafe) * speed;
    const vy = (Math.sin(p.angle) * fwd + Math.cos(p.angle) * strafe) * speed;
    this.moveWithCollision(p, vx * dt, vy * dt);
    p.speed = Math.hypot(vx, vy);

    // --- noise ---
    const surface = this.lv.floors[(p.y | 0) * MAP_W + (p.x | 0)];
    const grate = surface === FLOOR.GRATE ? 1.35 : surface === FLOOR.MARBLE ? 1.12 : 1;
    if (mag > 0.1 && speed > 0) {
      p.moveNoise = (p.crouching ? 0.16 : p.sprinting ? 1 : 0.5) * grate;
      const cadence = p.crouching ? 0.78 : p.sprinting ? 0.29 : 0.46;
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = cadence;
        this.audio.footstep(p.crouching ? 0.35 : p.sprinting ? 1 : 0.65, surface === FLOOR.GRATE ? 2 : surface === FLOOR.MARBLE ? 1 : 0);
        this.emitNoise(p.x, p.y, p.moveNoise * 0.55);
      }
      p.bob += dt * (p.sprinting ? 12 : p.crouching ? 5 : 8);
    } else {
      p.moveNoise = 0;
      p.bob += dt * 1.2;
      this.footTimer = 0;
    }

    // --- flashlight ---
    if (p.flashlightOn) {
      p.battery = Math.max(0, p.battery - 2.1 * dt);
      if (p.battery <= 0) {
        p.flashlightOn = false;
        this.pushMessage('Torch is dead. Let it cool.', 3);
      }
    } else {
      p.battery = Math.min(100, p.battery + 0.85 * dt);
    }

    p.height = p.crouching ? 0.32 : 0.5;
  }

  moveWithCollision(p, dx, dy) {
    const r = PLAYER_RADIUS;
    // Axis-separated so sliding along a wall feels right.
    if (!this.blocked(p.x + dx + Math.sign(dx) * r, p.y)) p.x += dx;
    else {
      const half = dx * 0.35;
      if (!this.blocked(p.x + half + Math.sign(half) * r, p.y)) p.x += half;
    }
    if (!this.blocked(p.x, p.y + dy + Math.sign(dy) * r)) p.y += dy;
    else {
      const half = dy * 0.35;
      if (!this.blocked(p.x, p.y + half + Math.sign(half) * r)) p.y += half;
    }
  }

  blocked(x, y) {
    const r = PLAYER_RADIUS * 0.8;
    return (
      isWall(this.lv, x + r, y + r) ||
      isWall(this.lv, x - r, y + r) ||
      isWall(this.lv, x + r, y - r) ||
      isWall(this.lv, x - r, y - r)
    );
  }

  emitNoise(x, y, loudness) {
    if (loudness <= 0.01) return;
    this.noiseEvents.push({ x, y, loudness });
  }

  /* ---------------------------------------------------------------- */

  updateInteraction(dt) {
    const p = this.player;
    this.pickupCooldown = Math.max(0, this.pickupCooldown - dt);
    const target = this.findInteractable();
    this.focus = target;
    const holding = this.keys.has('e') || this.buttons.interact;

    if (!target || !holding) {
      this.interactTimer = 0;
      return;
    }

    if (target.type === 'loot') {
      // Held [E] will hoover up a whole shelf, but one item at a time.
      if (this.pickupCooldown <= 0) {
        this.takeLoot(target.ref);
        this.pickupCooldown = 0.4;
      }
      this.interactTimer = 0;
      return;
    }

    if (target.type === 'terminal') {
      this.interactTimer += dt;
      target.ref.progress = Math.min(1, this.interactTimer / target.ref.duration);
      this.emitNoise(p.x, p.y, target.ref.loudness * dt * 4);
      if (target.ref.progress >= 1 && !target.ref.used) {
        target.ref.used = true;
        for (const c of this.lv.cameras) c.disabled = true;
        this.pushMessage('Camera feed cut. That will be noticed.', 4);
        this.heat = Math.min(1, this.heat + 0.15);
        this.interactTimer = 0;
      }
      return;
    }

    if (target.type === 'revive') {
      if (this.companion.revive(dt)) {
        this.speakEvent('revived');
        this.pushMessage('Wren is back on her feet.', 3);
      }
      // Kneeling over her is noisy and it takes time you may not have.
      this.emitNoise(p.x, p.y, 0.3 * dt * 4);
      return;
    }

    if (target.type === 'exit') {
      this.tryExtract();
      this.interactTimer = 0;
    }
  }

  findInteractable() {
    const p = this.player;
    let best = null;
    let bestD = 1.5;
    for (const l of this.lv.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.x - p.x, l.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { type: 'loot', ref: l, label: l.label, prompt: `[E] Take — ${l.label}` };
      }
    }
    for (const t of this.terminals) {
      if (t.used) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { type: 'terminal', ref: t, label: t.label, prompt: t.prompt };
      }
    }
    if (this.companion.state === WREN.DOWNED) {
      const d = Math.hypot(this.companion.x - p.x, this.companion.y - p.y);
      if (d < 1.7 && d < bestD) {
        bestD = d;
        best = {
          type: 'revive',
          ref: this.companion,
          label: 'Wren',
          prompt: 'Hold [E] — get her up',
        };
      }
    }
    const ex = this.lv.extraction;
    const de = Math.hypot(ex.x - p.x, ex.y - p.y);
    if (de < 2.2 && de < bestD) {
      const ready = this.bag.items >= this.lv.objective.items && this.bag.data >= this.lv.objective.data;
      best = {
        type: 'exit',
        ref: ex,
        label: 'Fire stairwell',
        prompt: ready ? '[E] Get out' : 'Not enough. The fence wants six, two of them data.',
      };
    }
    return best;
  }

  takeLoot(l, by = null) {
    if (l.taken) return;
    l.taken = true;
    this.bag.items += 1;
    if (l.kind === 'data') this.bag.data += 1;
    else this.bag.cash += 1;
    this.bag.value += l.kind === 'data' ? 40000 : 25000;
    this.player.carrying = this.bag.items;
    this.justBagged = 1.5;
    this.audio.pickup(l.kind);
    // Bags rustle. Grabbing something is never free — including when she does it.
    const src = by || this.player;
    this.emitNoise(src.x, src.y, 0.45);
    if (by) {
      this.speakEvent('wren-loot');
      this.pushMessage(`Wren bagged: ${l.label}  (${this.bag.items}/${this.lv.objective.items})`, 3);
    } else {
      this.pushMessage(`Bagged: ${l.label}  (${this.bag.items}/${this.lv.objective.items})`, 3);
    }
  }

  tryExtract() {
    const need = this.lv.objective;
    if (this.bag.items < need.items || this.bag.data < need.data) {
      this.pushMessage('Not enough to walk away with. Go back in.', 3.5);
      return;
    }
    this.status = 'extracted';
    this.speakEvent('extract');
    this.audio.extracted();
    this.finish('extracted');
  }

  toggleFlashlight() {
    if (this.status !== 'playing') return;
    const p = this.player;
    if (!p.flashlightOn && p.battery < 3) {
      this.pushMessage('Battery is flat.', 2.5);
      return;
    }
    p.flashlightOn = !p.flashlightOn;
  }

  /** Throw a bolt: a loud noise somewhere you are not. The only real counter-play. */
  throwNoisemaker() {
    if (this.status !== 'playing' || this.noisemakers <= 0) return;
    this.noisemakers -= 1;
    const p = this.player;
    // Travel until it hits something, up to 9 cells.
    let tx = p.x;
    let ty = p.y;
    const dx = Math.cos(p.angle) * 0.25;
    const dy = Math.sin(p.angle) * 0.25;
    for (let i = 0; i < 36; i++) {
      if (isWall(this.lv, tx + dx, ty + dy)) break;
      tx += dx;
      ty += dy;
    }
    this.thrown.push({ x: tx, y: ty, t: 0.55 });
    this.pushMessage('Thrown.', 1.6);
  }

  updateThrown(dt) {
    for (const t of this.thrown) {
      t.t -= dt;
      if (t.t <= 0 && !t.fired) {
        t.fired = true;
        this.audio.ambientCue(t.x - this.player.x, t.y - this.player.y, this.camVectors());
        this.emitNoise(t.x, t.y, 1.5);
        this.predator.distract(t.x, t.y, 1.2);
      }
    }
    this.thrown = this.thrown.filter((t) => t.t > -1);
  }

  /* ---------------------------------------------------------------- */

  handleEvent(type, src) {
    const cam = this.camVectors();
    switch (type) {
      case 'spotted':
        this.audio.stinger();
        this.pushMessage('It has seen you.', 3);
        break;
      case 'lostYou':
        this.pushMessage('It stopped. It is listening.', 3);
        break;
      case 'whoosh':
        if (src) this.audio.whoosh(src.x - this.player.x, src.y - this.player.y, cam, 1);
        break;
      case 'ambientCue':
        if (src) this.audio.ambientCue(src.x - this.player.x, src.y - this.player.y, cam);
        break;
      case 'ceilingWarn':
        // The building complains before it gives way. This is the tell.
        this.audio.ceilingStress(src.x - this.player.x, src.y - this.player.y, cam);
        this.particles.ceilingDust(src.x, src.y, 14);
        this.shake = Math.max(this.shake, 0.16);
        this.ceilingWarnFor = 1.6;
        this.pushMessage('Something is moving above the ceiling.', 2.5);
        break;
      case 'ceilingBreak':
        this.particles.ceilingDust(src.x, src.y, 22);
        this.audio.whoosh(src.x - this.player.x, src.y - this.player.y, cam, 1.4);
        break;
      case 'impact':
        this.audio.impact(src.x - this.player.x, src.y - this.player.y, cam, 1.2);
        this.particles.burst(src.x, src.y, { count: 34, power: 1.35, sparks: 12 });
        this.shake = 1;
        this.blind = Math.max(this.blind, 0.12);
        this.pushMessage('It came through the ceiling.', 3);
        break;
      case 'droneAlert':
        this.audio.alarm(src.x - this.player.x, src.y - this.player.y, cam);
        this.heat = Math.min(1, this.heat + 0.18);
        this.predator.hear({ x: this.player.x, y: this.player.y, loudness: 1.6 });
        this.predator.wake();
        this.pushMessage('Drone has eyes on you.', 3);
        break;
      case 'cameraAlert':
        this.audio.alarm(src.x - this.player.x, src.y - this.player.y, cam);
        this.heat = Math.min(1, this.heat + 0.22);
        this.predator.hear({ x: this.player.x, y: this.player.y, loudness: 1.4 });
        this.predator.wake();
        this.pushMessage('Camera flagged you.', 3);
        break;
      case 'takedown':
        this.beginTakedown();
        break;
      default:
        break;
    }
  }

  beginTakedown() {
    if (this.status !== 'playing') return;
    this.status = 'caught';
    this.endSequence = 0;
    this.blind = 1;
    this.audio.takedown();
  }

  resolveTakedown() {
    this.strikes -= 1;
    if (this.strikes <= 0) {
      this.status = 'busted';
      this.finish('busted');
      return;
    }
    // It does not kill you. It takes the bag and leaves you for the police —
    // which, on the clock, is arguably worse.
    for (const l of this.lv.loot) l.taken = false;
    this.bag = { items: 0, data: 0, cash: 0, value: 0 };
    this.player.carrying = 0;
    this.player.x = this.lv.spawn.x;
    this.player.y = this.lv.spawn.y;
    this.player.angle = this.lv.spawn.angle;
    this.player.stamina = 55;
    this.predator.withdraw();
    this.status = 'playing';
    this.blind = 0.85;
    this.heat = Math.min(1, this.heat + 0.3);
    this.pushMessage('You wake up at the dock. The bag is gone. Everything is back where it was.', 6);
    this.pushMessage(`${this.strikes} strike${this.strikes === 1 ? '' : 's'} left.`, 6);
  }

  finish(result) {
    // The loop keeps running so the last frame stays on screen behind the
    // result card rather than snapping to black.
    this.onEnd({
      result,
      time: this.time,
      bag: { ...this.bag },
      heat: this.heat,
      difficulty: this.difficultyKey,
      strikesLeft: this.strikes,
    });
    this.emitHud();
  }

  /* ---------------------------------------------------------------- */

  updateDread(dt) {
    const pr = this.predator;
    const d = Math.hypot(pr.x - this.player.x, pr.y - this.player.y);
    const weight = {
      [PRED.DORMANT]: 0,
      [PRED.PATROL]: 0.28,
      [PRED.INVESTIGATE]: 0.5,
      [PRED.STALK]: 0.78,
      [PRED.PERCH]: 0.62,
      [PRED.HUNT]: 1,
      [PRED.TAKEDOWN]: 1,
    }[pr.state] ?? 0.3;
    const prox = Math.max(0, 1 - d / 24);
    const target = Math.min(1, prox * weight + pr.awareness * 0.3 + this.heat * 0.15);
    this.dread += (target - this.dread) * Math.min(1, dt * 2.2);
  }

  camVectors() {
    const a = this.player.angle;
    return { dirX: Math.cos(a), dirY: Math.sin(a) };
  }

  pushMessage(text, t = 3.5) {
    this.messages.push({ text, t });
    if (this.messages.length > 4) this.messages.shift();
  }

  /* ---------------------------------------------------------------- */
  /* rendering                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Sprites are named rather than carrying a texture, so the same scene object
   * feeds either renderer — the software path resolves the name to an
   * ImageData, the GPU path to an array-texture layer.
   */
  buildSprites() {
    const out = [];
    // Heights are in storey units: a wall spans z 0..1, so 1.0 is floor to
    // ceiling. The GPU renderer occludes sprites against real geometry, so
    // anything taller than the room genuinely disappears into the ceiling.
    for (const l of this.lv.loot) {
      if (l.taken) continue;
      out.push({
        x: l.x,
        y: l.y,
        kind: l.kind === 'data' ? 'data' : 'cash',
        worldH: 0.13,
        z: 0.01,
        glow: l.kind === 'data' ? 0.7 : 0,
      });
    }
    for (const c of this.lv.cameras) {
      out.push({ x: c.x, y: c.y, kind: 'camera', worldH: 0.11, z: 0.8, glow: c.disabled ? 0 : 0.4 });
    }
    for (const d of this.drones) {
      out.push({ x: d.x, y: d.y, kind: 'drone', worldH: 0.17, z: 0.44 + Math.sin(d.bob) * 0.03, glow: 0.9 });
    }
    const ex = this.lv.extraction;
    out.push({ x: ex.x, y: ex.y, kind: 'exit', worldH: 0.8, z: 0, glow: 1 });

    const w = this.companion;
    if (w.state !== WREN.GONE) {
      out.push({
        x: w.x,
        y: w.y,
        kind: `companion${w.frame}`,
        worldH: w.state === WREN.DOWNED ? 0.3 : 0.74,
        z: 0,
        glow: 0.9,
        lightMul: 1.1,
      });
    }

    const pr = this.predator;
    // During the warning beat it is inside the ceiling; showing it there would
    // give the whole thing away a second early.
    const hidden = pr.state === PRED.PERCH
      || (pr.state === PRED.DESCEND && pr.dropPhase === 'warn');
    if (!hidden) {
      out.push({
        x: pr.x,
        y: pr.y,
        kind: `predator${pr.frame}`,
        // Deliberately near the ceiling: it should not comfortably fit.
        worldH: pr.state === PRED.TAKEDOWN ? 0.98 : 0.86,
        z: pr.z || 0,
        glow: 1.4,
        lightMul: 1.15,
      });
    }

    this.particles.appendSprites(out);
    return out;
  }

  /**
   * Real-time point lights for the GPU renderer. Kept deliberately few and
   * diegetic: the predator's eye glow throwing its own shadow down a corridor
   * is worth more than a dozen ambient fills.
   */
  buildLights() {
    const p = this.player;
    const out = [];
    const pr = this.predator;
    if (pr.state !== PRED.PERCH && Math.hypot(pr.x - p.x, pr.y - p.y) < 22) {
      out.push({
        x: pr.x, y: pr.y, z: 0.74 + (pr.z || 0), radius: 6.5,
        r: 0.42, g: 0.7, b: 1.0,
        // It flares on impact — the room briefly reads in cold blue.
        intensity: pr.state === PRED.DESCEND && pr.dropPhase === 'recover' ? 4.5 : 1.9,
      });
    }
    const w = this.companion;
    if (w.active && Math.hypot(w.x - p.x, w.y - p.y) < 18) {
      out.push({
        x: w.x, y: w.y, z: 0.62, radius: 4.6,
        r: 0.35, g: 1.0, b: 0.62, intensity: 1.15,
      });
    }
    for (const d of this.drones) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist > 16) continue;
      out.push({
        x: d.x, y: d.y, z: 0.5, radius: 5,
        r: 1.0, g: 0.24, b: 0.2,
        intensity: d.alertTimer > 0 ? 2.6 : 1.1,
        dist,
      });
    }
    out.sort((a, b) => (a.dist || 0) - (b.dist || 0));
    return out.slice(0, 6);
  }

  /** Soft blobs that plant characters on the floor. */
  buildGroundShadows() {
    const p = this.player;
    const out = [];
    const pr = this.predator;
    if (pr.state !== PRED.PERCH) {
      // Tightens and darkens as it lands, so the drop reads as impact.
      const h = pr.z || 0;
      out.push({
        x: pr.x, y: pr.y,
        radius: 0.55 + h * 1.6,
        strength: 0.72 * Math.max(0.15, 1 - h * 0.9),
      });
    }
    if (this.companion.active) {
      out.push({ x: this.companion.x, y: this.companion.y, radius: 0.5, strength: 0.6 });
    }
    for (const d of this.drones) {
      out.push({ x: d.x, y: d.y, radius: 0.7, strength: 0.34 });
    }
    return out
      .map((s) => ({ ...s, dist: Math.hypot(s.x - p.x, s.y - p.y) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 4);
  }

  draw() {
    const p = this.player;
    // Bob and pitch are expressed as fractions of screen height so both
    // renderers can scale them to whatever buffer they happen to own.
    const moveAmt = Math.min(1, p.speed / WALK_SPEED);
    const bobN = Math.sin(p.bob) * (p.sprinting ? 0.0115 : 0.007) * moveAmt;
    const bobX = Math.cos(p.bob * 0.5) * 0.012 * moveAmt;
    // Camera shake. Two incommensurate frequencies so it reads as a jolt
    // rather than a wobble, and it decays fast enough to stay readable.
    const sh = this.shake * this.shake;
    const t = this.time * 41 + this.shakeSeed;
    const shakeY = sh * 0.045 * (Math.sin(t) * 0.6 + Math.sin(t * 2.7) * 0.4);
    const shakeX = sh * 0.03 * (Math.sin(t * 1.7) * 0.6 + Math.sin(t * 3.3) * 0.4);
    const dirX = Math.cos(p.angle + bobX + shakeX);
    const dirY = Math.sin(p.angle + bobX + shakeX);
    const fovScale = 0.72 + (p.sprinting ? 0.06 : 0) + this.dread * 0.05;

    const scene = {
      level: this.lv,
      cam: {
        x: p.x,
        y: p.y,
        dirX,
        dirY,
        planeX: -dirY * fovScale,
        planeY: dirX * fovScale,
      },
      camZ: p.height,
      horizonN: p.pitch + bobN + shakeY,
      lights: this.buildLights(),
      groundShadows: this.buildGroundShadows(),
      haze: 0.022,
      flashlight: {
        on: p.flashlightOn,
        // A dying battery stutters, which is its own kind of pressure.
        intensity: 1.7 * (p.battery < 18 ? 0.45 + Math.random() * 0.55 : 1),
        cone: 0.46,
        range: 15,
      },
      sprites: this.buildSprites(),
      time: this.time,
      flicker: this.flick,
      dread: this.dread,
      fear: Math.max(this.dread, this.status === 'caught' ? 1 : 0),
      blind: this.blind,
    };
    this.renderer.render(scene);
  }

  /* ---------------------------------------------------------------- */

  emitHud() {
    const p = this.player;
    const pr = this.predator;
    const d = Math.hypot(pr.x - p.x, pr.y - p.y);
    const bright = brightnessAt(this.lv, p.x, p.y);
    this.onHud({
      status: this.status,
      time: this.time,
      items: this.bag.items,
      data: this.bag.data,
      needItems: this.lv.objective.items,
      needData: this.lv.objective.data,
      value: this.bag.value,
      stamina: p.stamina,
      battery: p.battery,
      flashlight: p.flashlightOn,
      crouching: p.crouching,
      sprinting: p.sprinting,
      noisemakers: this.noisemakers,
      strikes: this.strikes,
      heat: this.heat,
      dread: this.dread,
      noise: p.moveNoise,
      exposure: bright,
      hidden: bright < 0.18 && !p.flashlightOn && p.crouching,
      zone: zoneNameAt(this.lv, p.x, p.y),
      prompt: this.focus ? this.focus.prompt : null,
      progress: this.focus && this.focus.type === 'terminal' ? this.focus.ref.progress : 0,
      cameraDetect: this.cameraPeak,
      messages: this.messages.map((m) => m.text),
      predator: {
        // Never the exact position — only what the fear would tell you, and
        // on the tablet only a sector, rounded to a 4-cell block.
        proximity: Math.max(0, 1 - d / 26),
        state: pr.state,
        awareness: pr.awareness,
        hunting: pr.state === PRED.HUNT,
        hintX: Math.round(pr.x / 4) * 4,
        hintY: Math.round(pr.y / 4) * 4,
      },
      tablet: !!this.tablet,
      player: { x: p.x, y: p.y, angle: p.angle },
      subtitle: this.voice.subtitle,
      companion: {
        state: this.companion.state,
        order: this.companion.order,
        alive: this.companion.alive,
        active: this.companion.active,
        reviveProgress: this.companion.reviveProgress,
        bagged: this.companion.bagged,
        x: this.companion.x,
        y: this.companion.y,
        dist: Math.hypot(this.companion.x - p.x, this.companion.y - p.y),
      },
      drop: this.predator.state === PRED.DESCEND ? this.predator.dropPhase : null,
    });
  }
}
