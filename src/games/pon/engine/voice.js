/**
 * P.O.N. — Wren's voice.
 *
 * Speech comes from the browser's own Web Speech API, so the companion
 * genuinely talks without the project shipping a single audio file. Voices vary
 * enormously between platforms, so we pick deliberately (English, female if one
 * is offered, never a novelty voice) and push rate and pitch toward flat and
 * hushed — she is whispering over a radio in a building she should not be in.
 *
 * Everything degrades cleanly: with no speechSynthesis the subtitles still run,
 * which is also the accessible path.
 */

/** Higher wins, and can interrupt anything of lower priority. */
export const BARK = {
  CHATTER: 0,
  INFO: 1,
  WARN: 2,
  URGENT: 3,
};

const BANNED_VOICE = /novelty|whisper|zarvox|trinoids|bells|bad news|good news|jester|bubbles|boing|albert|wobble|organ|cellos/i;

export class Voice {
  constructor() {
    this.enabled = true;
    this.supported = typeof window !== 'undefined'
      && 'speechSynthesis' in window
      && typeof window.SpeechSynthesisUtterance === 'function';
    this.voice = null;
    this.current = null;
    this.currentPriority = -1;
    this.lastSpokenAt = new Map();
    this.subtitle = null;
    this.subtitleTimer = 0;
    this.onClick = null;
    if (this.supported) this.pickVoice();
  }

  pickVoice() {
    const choose = () => {
      const all = window.speechSynthesis.getVoices().filter((v) => !BANNED_VOICE.test(v.name));
      if (!all.length) return;
      const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang));
      const pool = en.length ? en : all;
      this.voice = pool.find((v) => /female|samantha|karen|serena|zira|aria|jenny|sonia/i.test(v.name))
        || pool.find((v) => v.default)
        || pool[0];
    };
    choose();
    // Chrome populates the list asynchronously.
    window.speechSynthesis.onvoiceschanged = choose;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.cancel();
  }

  cancel() {
    if (this.supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* some engines throw when idle */
      }
    }
    this.current = null;
    this.currentPriority = -1;
  }

  /**
   * @param {object} line { id, text, priority, cooldown }
   * @param {number} now  game clock in seconds
   * @returns {boolean} whether the line was taken
   */
  say(line, now) {
    const priority = line.priority ?? BARK.INFO;
    const last = this.lastSpokenAt.get(line.id) ?? -Infinity;
    if (now - last < (line.cooldown ?? 12)) return false;
    // A line only cuts in over something strictly less important than itself.
    if (this.current && priority <= this.currentPriority) return false;

    this.lastSpokenAt.set(line.id, now);
    this.subtitle = line.text;
    this.subtitleTimer = Math.max(2.2, line.text.length * 0.055);

    if (!this.enabled || !this.supported) {
      // Subtitle-only: hold the "speaking" slot for roughly as long as the
      // line would have taken, so barks still queue sensibly.
      this.current = line.id;
      this.currentPriority = priority;
      this.pendingRelease = this.subtitleTimer;
      return true;
    }

    try {
      if (this.current) window.speechSynthesis.cancel();
      const u = new window.SpeechSynthesisUtterance(line.text);
      if (this.voice) u.voice = this.voice;
      u.rate = 1.06;
      u.pitch = line.priority >= BARK.URGENT ? 1.12 : 0.95;
      u.volume = 0.85;
      u.onend = () => {
        if (this.current === line.id) {
          this.current = null;
          this.currentPriority = -1;
          this.onClick?.(false);
        }
      };
      u.onerror = u.onend;
      this.current = line.id;
      this.currentPriority = priority;
      this.pendingRelease = 0;
      this.onClick?.(true);
      window.speechSynthesis.speak(u);
    } catch {
      this.current = null;
      this.currentPriority = -1;
    }
    return true;
  }

  update(dt) {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle = null;
    }
    // Only used on the subtitle-only path; the speech path releases on `onend`.
    if (this.pendingRelease > 0) {
      this.pendingRelease -= dt;
      if (this.pendingRelease <= 0) {
        this.current = null;
        this.currentPriority = -1;
      }
    }
  }
}
