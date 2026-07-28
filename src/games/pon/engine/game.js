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
import { AudioEngine } from './audio.js';
import { Predator, Drone, updateCameras, DIFFICULTY, PRED } from './ai.js';

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
    this.renderer = new Renderer(canvas);
    this.audio = new AudioEngine();
    this.onHud = opts.onHud || (() => {});
    this.onEnd = opts.onEnd || (() => {});
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

    this.predator = new Predator(lv, this.cfg);
    this.drones = lv.droneRoutes
      .slice(0, this.cfg.drones)
      .map((route, i) => new Drone(lv, route, i));

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
    this.audio.stop();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.audio.start();
    this.last = performance.now();
    const step = (now) => {
      if (!this.running || this.destroyed) return;
      this.raf = requestAnimationFrame(step);
      // Upper clamp stops a backgrounded tab from teleporting the predator on
      // return; the lower clamp matters because the first rAF timestamp can
      // predate the performance.now() captured in start(), and a negative dt
      // runs every eased value backwards past zero.
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      if (!this.paused) this.tick(dt);
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
    this.renderer.resize(w, h, this.quality);
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
      noiseEvents: this.noiseEvents,
      onEvent: (type, src) => this.handleEvent(type, src),
    };

    if (this.status === 'playing' || this.status === 'caught') {
      this.predator.update(dt, world);
      for (const d of this.drones) d.update(dt, world);
      this.cameraPeak = updateCameras(this.lv, dt, world);
    }

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

  takeLoot(l) {
    if (l.taken) return;
    l.taken = true;
    this.bag.items += 1;
    if (l.kind === 'data') this.bag.data += 1;
    else this.bag.cash += 1;
    this.bag.value += l.kind === 'data' ? 40000 : 25000;
    this.player.carrying = this.bag.items;
    this.audio.pickup(l.kind);
    // Bags rustle. Grabbing something is never free.
    this.emitNoise(this.player.x, this.player.y, 0.45);
    this.pushMessage(`Bagged: ${l.label}  (${this.bag.items}/${this.lv.objective.items})`, 3);
  }

  tryExtract() {
    const need = this.lv.objective;
    if (this.bag.items < need.items || this.bag.data < need.data) {
      this.pushMessage('Not enough to walk away with. Go back in.', 3.5);
      return;
    }
    this.status = 'extracted';
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

  buildSprites() {
    const a = this.atlas;
    const out = [];
    for (const l of this.lv.loot) {
      if (l.taken) continue;
      out.push({
        x: l.x,
        y: l.y,
        tex: l.kind === 'data' ? a.data : a.cash,
        worldH: 0.32,
        z: 0.02,
        glow: l.kind === 'data' ? 0.7 : 0,
      });
    }
    for (const c of this.lv.cameras) {
      out.push({ x: c.x, y: c.y, tex: a.camera, worldH: 0.26, z: 1.55, glow: c.disabled ? 0 : 0.4 });
    }
    for (const d of this.drones) {
      out.push({ x: d.x, y: d.y, tex: a.drone, worldH: 0.42, z: 0.62 + Math.sin(d.bob) * 0.07, glow: 0.9 });
    }
    const ex = this.lv.extraction;
    out.push({ x: ex.x, y: ex.y, tex: a.exit, worldH: 1.7, z: 0, glow: 1 });

    const pr = this.predator;
    if (pr.state !== PRED.PERCH) {
      out.push({
        x: pr.x,
        y: pr.y,
        tex: a.predator[pr.frame % a.predator.length],
        worldH: pr.state === PRED.TAKEDOWN ? 2.6 : 1.98,
        z: 0,
        glow: 1.4,
        lightMul: 1.15,
      });
    }
    return out;
  }

  draw() {
    const p = this.player;
    const bobY = Math.sin(p.bob) * (p.sprinting ? 3.4 : 2.1) * Math.min(1, p.speed / WALK_SPEED);
    const bobX = Math.cos(p.bob * 0.5) * 0.012 * Math.min(1, p.speed / WALK_SPEED);
    const dirX = Math.cos(p.angle + bobX);
    const dirY = Math.sin(p.angle + bobX);
    const fovScale = 0.72 + (p.sprinting ? 0.06 : 0) + this.dread * 0.05;
    const ih = this.renderer.ih || 300;
    // Crouching lowers the eye line; pitch and bob ride on top of it.
    const heightShift = (0.5 - p.height) * ih;

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
      horizonOffset: p.pitch * ih + bobY + heightShift,
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
    });
  }
}
