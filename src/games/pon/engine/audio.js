/**
 * P.O.N. — fully synthesised audio.
 *
 * There are no sound files. Everything below is built from oscillators and a
 * single white-noise buffer, which keeps the bundle small and lets the mix
 * respond continuously to game state (the drone detunes as dread rises, the
 * heartbeat rate is a direct function of how close the thing is).
 *
 * Every method is a no-op until `start()` has run inside a user gesture, so
 * autoplay policy never throws.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.dread = 0;
    this.beatTimer = 0;
    this.beatPhase = 0;
    this.muffle = 0;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    // One global lowpass: closing it is how the game says "you are hidden".
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000;
    this.muffleFilter.connect(this.master);
    this.master.connect(ctx.destination);

    // 2 s of white noise, reused by every noise-based voice.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.buildBed();
  }

  /** Low sustained room tone: two detuned saws plus filtered air. */
  buildBed() {
    const ctx = this.ctx;
    const bed = ctx.createGain();
    bed.gain.value = 0.0;
    bed.connect(this.muffleFilter);
    this.bedGain = bed;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 3;
    lp.connect(bed);
    this.bedFilter = lp;

    this.bedOscs = [];
    for (const [freq, detune] of [[41, -7], [41, 9], [61.5, 4]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      o.connect(g).connect(lp);
      o.start();
      this.bedOscs.push(o);
    }

    // Air / HVAC hiss
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuf;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 620;
    airFilter.Q.value = 0.7;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.045;
    air.connect(airFilter).connect(airGain).connect(this.muffleFilter);
    air.start();
    this.airGain = airGain;

    bed.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 3);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  stop() {
    if (!this.ctx) return;
    try {
      this.ctx.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
  }

  /** Stereo placement + falloff for a world-space event. */
  place(node, dx, dy, cam, maxDist = 26) {
    const ctx = this.ctx;
    const dist = Math.hypot(dx, dy);
    const pan = ctx.createStereoPanner
      ? ctx.createStereoPanner()
      : null;
    if (pan) {
      // Project onto the camera's right vector.
      const rightX = -cam.dirY;
      const rightY = cam.dirX;
      const p = dist < 0.001 ? 0 : (dx * rightX + dy * rightY) / dist;
      pan.pan.value = Math.max(-1, Math.min(1, p));
    }
    const g = ctx.createGain();
    g.gain.value = Math.max(0, 1 - dist / maxDist) ** 1.6;
    if (pan) {
      node.connect(pan).connect(g).connect(this.muffleFilter);
    } else {
      node.connect(g).connect(this.muffleFilter);
    }
    return g;
  }

  /** Per-frame mix update. `dread` 0..1, `muffle` 0..1 (1 = fully hidden). */
  update(dt, dread, muffle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.dread = dread;
    if (this.bedFilter) {
      this.bedFilter.frequency.setTargetAtTime(200 + dread * 480, t, 0.4);
    }
    if (this.bedGain) {
      this.bedGain.gain.setTargetAtTime(0.45 + dread * 0.55, t, 0.4);
    }
    if (this.bedOscs) {
      // The bed sours as it gets closer.
      this.bedOscs[2].detune.setTargetAtTime(4 + dread * 60, t, 0.6);
    }
    if (this.muffleFilter) {
      const target = 20000 - muffle * 19200;
      this.muffleFilter.frequency.setTargetAtTime(Math.max(320, target), t, 0.12);
    }

    // Heartbeat: silent until there is something to be afraid of.
    if (dread > 0.12) {
      const bpm = 58 + dread * 92;
      this.beatTimer -= dt;
      if (this.beatTimer <= 0) {
        this.beatTimer = 60 / bpm;
        this.thump(0.22 + dread * 0.4);
        setTimeout(() => this.thump(0.14 + dread * 0.26), 145);
      }
    } else {
      this.beatTimer = 0;
    }
  }

  thump(gain) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.muffleFilter);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** `surface` picks the filter colour: 0 concrete, 1 marble, 2 metal grate. */
  footstep(intensity, surface = 0) {
    if (!this.ctx || intensity <= 0) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = [420, 900, 1700][surface] * (0.85 + Math.random() * 0.3);
    f.Q.value = surface === 2 ? 3.5 : 1.2;
    const g = ctx.createGain();
    const peak = 0.05 * intensity;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (surface === 2 ? 0.22 : 0.11));
    src.connect(f).connect(g).connect(this.muffleFilter);
    src.start(t);
    src.stop(t + 0.3);
  }

  /** Cape displacing air, somewhere off to your left. */
  whoosh(dx, dy, cam, strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.22);
    f.frequency.exponentialRampToValueAtTime(280, t + 0.75);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5 * strength, t + 0.1);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    src.connect(f).connect(env);
    this.place(env, dx, dy, cam, 30);
    src.start(t);
    src.stop(t + 0.9);
  }

  /** Drone or camera spotting you. */
  alarm(dx, dy, cam) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.17;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = i % 2 ? 660 : 990;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.09, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(env);
      this.place(env, dx, dy, cam, 34);
      o.start(t);
      o.stop(t + 0.15);
    }
  }

  /** The moment it sees you. Dissonant, loud, unmissable. */
  stinger() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const f of [155, 164, 233, 466]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.075, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4200, t);
      lp.frequency.exponentialRampToValueAtTime(500, t + 1.1);
      o.connect(lp).connect(g).connect(this.muffleFilter);
      o.start(t);
      o.stop(t + 1.25);
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(hp).connect(ng).connect(this.muffleFilter);
    src.start(t);
    src.stop(t + 0.6);
  }

  pickup(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = kind === 'data' ? [880, 1320, 1760] : [523, 784];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * 0.06;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.07, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
      o.connect(g).connect(this.muffleFilter);
      o.start(s);
      o.stop(s + 0.35);
    });
  }

  /** Two seconds of being caught. */
  takedown() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.9);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 1.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 1.8);

    if (this.bedGain) this.bedGain.gain.setTargetAtTime(0, t, 0.3);
  }

  /** Clean, quiet, and a long way from the building. */
  extracted() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [392, 523, 659, 784].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * 0.13;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.08, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.1);
      o.connect(g).connect(this.master);
      o.start(s);
      o.stop(s + 1.2);
    });
    if (this.bedGain) this.bedGain.gain.setTargetAtTime(0, t, 0.5);
  }

  /**
   * Concrete flexing overhead. The cue that buys the player about a second to
   * work out that the ceiling is the problem.
   */
  ceilingStress(dx, dy, cam) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.42;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5.5;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.linearRampToValueAtTime(520, t + 0.7);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.16, t + 0.15);
    env.gain.linearRampToValueAtTime(0.22, t + 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    src.connect(bp).connect(env);
    this.place(env, dx, dy, cam, 22);
    src.start(t);
    src.stop(t + 0.9);
  }

  /** Something heavy arriving. Low, short, and physical. */
  impact(dx, dy, cam, power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.42);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7 * power, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(og);
    this.place(og, dx, dy, cam, 34);
    o.start(t);
    o.stop(t + 0.6);

    // grit and debris on top of the thump
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3 * power, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(hp).connect(ng);
    this.place(ng, dx, dy, cam, 34);
    src.start(t);
    src.stop(t + 0.55);
  }

  /** Squelch either side of a radio line. */
  radioClick(open = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = open ? 1.8 : 1.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = open ? 2400 : 1500;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(bp).connect(g).connect(this.muffleFilter);
    src.start(t);
    src.stop(t + 0.08);
  }

  /** A short metallic knock somewhere in the building — pure paranoia fuel. */
  ambientCue(dx, dy, cam) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180 + Math.random() * 260, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.055, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(env);
    this.place(env, dx, dy, cam, 40);
    o.start(t);
    o.stop(t + 0.45);
  }
}
