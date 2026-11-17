const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const midi = (note) => 440 * Math.pow(2, (note - 69) / 12);
// Ceiling of the tension layer before the music volume preference is applied.
const TENSION_GAIN = 0.3;

/** All melodies and sound design are synthesized locally; no recording or remote assets. */
export class AudioEngine {
  constructor() {
    this.context = null;
    this.musicVolume = 0.18;
    this.sfxVolume = 0.65;
    this.unlocked = false;
    this.destroyed = false;
    this.nodes = new Set();
    this.seen = new Set();
    this.step = 0;
    this.nextNote = 0;
    this.lastWeapon = null;
    this.tension = 0;
    this.tensionNodes = null;
    this.tensionFadeEnd = 0;
    this.tensionApplied = false;
    this.onVisibility = () => {
      if (!this.context || this.destroyed) return;
      if (document.hidden) {
        this.context.suspend().catch(() => {});
        this.nextNote = 0;
      } else if (this.unlocked) this.unlock();
    };
    this.onGesture = () => {
      if (this.unlocked && this.context?.state !== 'running') this.unlock();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerdown', this.onGesture, { passive: true });
    document.addEventListener('keydown', this.onGesture);
  }
  async unlock() {
    if (this.destroyed || document.hidden) return false;
    try {
      if (!this.context || this.context.state === 'closed') {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return false;
        this.context = new Context({ latencyHint: 'interactive' });
        this.musicGain = this.context.createGain();
        this.sfxGain = this.context.createGain();
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = -15;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.18;
        this.musicGain.connect(compressor);
        this.sfxGain.connect(compressor);
        compressor.connect(this.context.destination);
        this.musicGain.gain.value = this.musicVolume;
        this.sfxGain.gain.value = this.sfxVolume;
        this.noiseBuffer = this.context.createBuffer(
          1,
          Math.ceil(this.context.sampleRate * 2),
          this.context.sampleRate,
        );
        const samples = this.noiseBuffer.getChannelData(0);
        let seed = 91237;
        for (let i = 0; i < samples.length; i++) {
          seed = (seed * 16807) % 2147483647;
          samples[i] = seed / 1073741824 - 1;
        }
        this.context.onstatechange = () => {
          if (this.context?.state !== 'running') this.nextNote = 0;
        };
      }
      this.unlocked = true;
      // resume() is invoked before awaiting, preserving the browser's user-gesture grant.
      if (this.context.state !== 'running') await this.context.resume();
      if (!this.timer) this.timer = window.setInterval(() => this.scheduleMusic(), 100);
      this.applyTension();
      this.scheduleMusic();
      return this.context.state === 'running';
    } catch {
      // Interrupted iOS audio can remain suspended until the next pointer or keyboard gesture.
      return false;
    }
  }
  resetEvents() {
    this.seen.clear();
    this.lastWeapon = null;
  }
  setVolumes(music, sfx) {
    if (Number.isFinite(music)) this.musicVolume = clamp(music, 0, 1);
    if (Number.isFinite(sfx)) this.sfxVolume = clamp(sfx, 0, 1);
    if (!this.context) return;
    const now = this.context.currentTime;
    this.musicGain.gain.setTargetAtTime(this.musicVolume, now, 0.03);
    this.sfxGain.gain.setTargetAtTime(this.sfxVolume, now, 0.03);
  }
  track(node) {
    this.nodes.add(node);
    node.onended = () => {
      this.nodes.delete(node);
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    };
    return node;
  }
  tone(
    frequency,
    duration = 0.15,
    { at, type = 'sine', gain = 0.2, end, music = false, attack = 0.006 } = {},
  ) {
    if (!this.context || this.context.state !== 'running') return;
    const t = at ?? this.context.currentTime;
    const source = this.track(this.context.createOscillator());
    const envelope = this.context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(Math.max(20, frequency), t);
    if (end) source.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(envelope);
    envelope.connect(music ? this.musicGain : this.sfxGain);
    const originalEnded = source.onended;
    source.onended = () => {
      originalEnded();
      envelope.disconnect();
    };
    source.start(t);
    source.stop(t + duration + 0.02);
  }
  noise(
    duration,
    { at, gain = 0.25, filter = 'lowpass', frequency = 1200, end, music = false, attack = 0.003 } = {},
  ) {
    if (!this.context || this.context.state !== 'running') return;
    const t = at ?? this.context.currentTime;
    const source = this.track(this.context.createBufferSource());
    const envelope = this.context.createGain(),
      tone = this.context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    tone.type = filter;
    tone.frequency.setValueAtTime(frequency, t);
    tone.Q.value = 0.7;
    if (end) tone.frequency.exponentialRampToValueAtTime(Math.max(25, end), t + duration);
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(tone);
    tone.connect(envelope);
    envelope.connect(music ? this.musicGain : this.sfxGain);
    const originalEnded = source.onended;
    source.onended = () => {
      originalEnded();
      tone.disconnect();
      envelope.disconnect();
    };
    source.start(t);
    source.stop(t + duration + 0.02);
  }
  scheduleMusic() {
    if (this.destroyed || document.hidden || !this.unlocked || this.context?.state !== 'running') return;
    const now = this.context.currentTime;
    if (!this.nextNote || this.nextNote < now - 0.25) this.nextNote = now + 0.025;
    const tick = 60 / 96 / 2;
    // An original 64-step, lightly syncopated toy-marimba theme in A minor.
    const melody = [
      76,
      null,
      79,
      81,
      null,
      79,
      76,
      null,
      74,
      null,
      72,
      74,
      null,
      76,
      null,
      null,
      76,
      null,
      79,
      83,
      null,
      81,
      79,
      null,
      76,
      74,
      null,
      72,
      null,
      69,
      null,
      null,
      74,
      null,
      77,
      81,
      null,
      79,
      77,
      null,
      74,
      null,
      72,
      74,
      null,
      76,
      null,
      null,
      71,
      null,
      74,
      76,
      null,
      74,
      71,
      null,
      69,
      null,
      72,
      null,
      69,
      null,
      null,
      null,
    ];
    while (this.nextNote < now + 0.2) {
      const step = this.step % 64,
        t = this.nextNote;
      if (this.musicVolume > 0.001) {
        const note = melody[step];
        if (note != null) {
          this.tone(midi(note), 0.2, { at: t, gain: 0.14, type: 'sine', music: true });
          this.tone(midi(note + 12), 0.09, { at: t, gain: 0.025, type: 'sine', music: true });
        }
        if (step % 4 === 0)
          this.tone(midi([45, 45, 50, 52][Math.floor(step / 16)]), 0.27, {
            at: t,
            gain: 0.17,
            type: 'triangle',
            music: true,
          });
        if (step % 4 === 2)
          this.noise(0.065, { at: t, gain: 0.055, filter: 'highpass', frequency: 2500, music: true });
        if (step % 8 === 0) this.tone(115, 0.12, { at: t, end: 52, gain: 0.11, music: true });
        if (this.tensionNodes && (this.tension > 0 || t < this.tensionFadeEnd)) this.scheduleTension(step, t);
      }
      this.step++;
      this.nextNote += tick;
    }
  }
  /** Tension layer, 0–1: a pulsing low ostinato and a soft hi-hat tick under the music
   *  volume, fading in over 1 s and out over 1.5 s. Its four sources are built on first
   *  use and only retuned afterwards; nothing is created per beat. */
  setTension(level) {
    level = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
    if (Math.abs(level - this.tension) < 0.005 && this.tensionApplied) return;
    this.tension = level;
    this.applyTension();
  }
  applyTension() {
    this.tensionApplied = false;
    if (this.destroyed || !this.unlocked || !this.context || this.context.state !== 'running') return;
    // Silence never builds the nodes; a quiet match costs nothing.
    if (this.tension <= 0 && !this.tensionNodes) {
      this.tensionApplied = true;
      return;
    }
    const { gain } = this.ensureTension();
    const now = this.context.currentTime,
      target = this.tension * TENSION_GAIN,
      current = gain.gain.value;
    const seconds = target > current ? 1 : 1.5;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(current, now);
    gain.gain.linearRampToValueAtTime(target, now + seconds);
    this.tensionFadeEnd = now + seconds;
    this.tensionApplied = true;
  }
  ensureTension() {
    if (this.tensionNodes?.context === this.context) return this.tensionNodes;
    const ctx = this.context;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicGain);
    // Ostinato: one sawtooth through a lowpass, its amplitude pulsed by a slow triangle LFO.
    const drone = ctx.createOscillator();
    drone.type = 'sawtooth';
    drone.frequency.value = midi(33);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 240;
    low.Q.value = 1.8;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = (96 / 60) * 2;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(pulse.gain);
    drone.connect(low);
    low.connect(pulse);
    pulse.connect(gain);
    // Hi-hat: the shared noise buffer through a highpass; the music scheduler gates it per eighth note.
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuffer;
    hiss.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 6500;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    hiss.connect(high);
    high.connect(gate);
    gate.connect(gain);
    const at = ctx.currentTime;
    drone.start(at);
    lfo.start(at);
    hiss.start(at);
    this.tensionNodes = { context: ctx, gain, gate, drone, lfo, hiss, pulse, low, high, depth };
    return this.tensionNodes;
  }
  scheduleTension(step, t) {
    if (step % 2) return;
    const { drone, gate } = this.tensionNodes;
    // The ostinato shadows the bass roots an octave down, circling root, fifth and seventh.
    const root = [45, 45, 50, 52][Math.floor(step / 16)] - 12;
    drone.frequency.setValueAtTime(midi(root + [0, 0, 7, 0, 0, 10, 7, 3][(step / 2) % 8]), t);
    const level = step % 4 === 2 ? 0.2 : 0.13;
    gate.gain.cancelScheduledValues(t);
    gate.gain.setValueAtTime(0.0001, t);
    gate.gain.linearRampToValueAtTime(level, t + 0.004);
    gate.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  }
  event(event) {
    if (!event || this.destroyed) return;
    if (event.id != null) {
      if (this.seen.has(event.id)) return;
      this.seen.add(event.id);
      if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
    }
    if (!this.unlocked || document.hidden || this.context?.state !== 'running' || this.sfxVolume <= 0.001)
      return;
    const t = this.context.currentTime;
    if (event.type === 'fire') {
      const name = event.weapon || 'bazooka';
      if (this.lastWeapon?.name !== name || t - this.lastWeapon.time > 0.12) this.weapon(name, t);
      return;
    }
    if (event.type === 'explosion' || event.type === 'explode') {
      const size = clamp((event.radius || 45) / 55, 0.4, 1.6);
      this.noise(0.55 * size, { gain: 0.58, frequency: 1300, end: 90 });
      this.tone(95, 0.34 * size, { end: 28, gain: 0.55, type: 'sine' });
      this.noise(0.12, { gain: 0.2, filter: 'highpass', frequency: 1600 });
    } else if (event.type === 'damage') {
      this.tone(330, 0.12, { end: 190, type: 'triangle', gain: 0.2 });
      this.tone(410, 0.11, { at: t + 0.07, end: 280, type: 'triangle', gain: 0.14 });
    } else if (event.type === 'death' || event.type === 'splash' || event.type === 'drown') {
      this.noise(0.3, { gain: 0.28, filter: 'bandpass', frequency: 1500, end: 300 });
      this.tone(450, 0.24, { gain: 0.18, end: 100 });
    } else if (event.type === 'turn') {
      [72, 79].forEach((n, i) => this.tone(midi(n), 0.2, { at: t + i * 0.1, gain: 0.16 }));
    } else if (event.type === 'suddenDeath') {
      [55, 55, 54].forEach((n, i) =>
        this.tone(midi(n), 0.35, { at: t + i * 0.3, gain: 0.2, type: 'triangle' }),
      );
    } else if (event.type === 'mineTrigger') {
      [0, 0.16, 0.32].forEach((delay) => this.tone(1450, 0.09, { at: t + delay, gain: 0.16 }));
    } else if (event.type === 'ropeBreak') {
      this.noise(0.08, { gain: 0.18, filter: 'highpass', frequency: 2100 });
    } else if (event.type === 'fuelEmpty') {
      this.tone(350, 0.15, { gain: 0.14, end: 180, type: 'triangle' });
    } else if (event.type === 'cratePickup') {
      // A short rising chime: three bright notes and a faint sparkle on top.
      [79, 84, 88].forEach((n, i) =>
        this.tone(midi(n), 0.14, { at: t + i * 0.07, gain: 0.16, type: 'triangle' }),
      );
      this.tone(midi(96), 0.22, { at: t + 0.21, gain: 0.07 });
    } else if (event.type === 'crateDrop') {
      this.noise(0.5, { gain: 0.09, filter: 'bandpass', frequency: 700, end: 1500, attack: 0.12 });
    } else if (event.type === 'crateLand') {
      this.noise(0.12, { gain: 0.2, frequency: 520, end: 120 });
      this.tone(140, 0.11, { end: 70, gain: 0.14, type: 'triangle' });
    } else if (event.type === 'crateDestroyed') {
      this.noise(0.2, { gain: 0.3, filter: 'bandpass', frequency: 900, end: 300 });
      this.tone(230, 0.12, { end: 95, gain: 0.16, type: 'triangle' });
    } else if (event.type === 'jump') {
      this.tone(150, 0.16, { end: 460, gain: 0.15, type: 'triangle' });
    } else if (['rope', 'jetpack', 'teleport', 'girder', 'mine'].includes(event.type)) {
      // Some tools publish a dedicated event as well as fire. Avoid a doubled transient.
      if (this.lastWeapon?.name !== event.type || t - this.lastWeapon.time > 0.12) this.weapon(event.type, t);
    } else if (event.type === 'victory' || event.type === 'finished' || event.type === 'result') {
      [69, 72, 76, 81].forEach((n, i) =>
        this.tone(midi(n), 0.5, { at: t + i * 0.12, gain: 0.18, type: 'triangle' }),
      );
    }
  }
  weapon(name, t = this.context?.currentTime || 0) {
    this.lastWeapon = { name, time: t };
    switch (name) {
      case 'bazooka':
        this.noise(0.28, { gain: 0.45, frequency: 1500, end: 180 });
        this.tone(180, 0.22, { gain: 0.25, end: 50 });
        break;
      case 'grenade':
        this.tone(1100, 0.08, { gain: 0.12, type: 'triangle' });
        this.noise(0.14, { at: t + 0.04, gain: 0.13, filter: 'bandpass', frequency: 500 });
        break;
      case 'cluster':
        [880, 1175, 1568].forEach((f, i) =>
          this.tone(f, 0.09, { at: t + i * 0.035, gain: 0.1, type: 'triangle' }),
        );
        break;
      case 'shotgun':
        this.noise(0.15, { gain: 0.65, frequency: 3400, end: 240 });
        this.tone(110, 0.1, { gain: 0.4, end: 45 });
        this.noise(0.07, { at: t + 0.2, gain: 0.15, filter: 'bandpass', frequency: 1900 });
        break;
      case 'dynamite':
        this.noise(0.6, { gain: 0.12, filter: 'highpass', frequency: 2300, attack: 0.03 });
        this.tone(260, 0.09, { gain: 0.2, end: 170, type: 'triangle' });
        break;
      case 'mine':
        this.tone(180, 0.08, { gain: 0.18, end: 90 });
        this.tone(1300, 0.08, { at: t + 0.13, gain: 0.11, type: 'sine' });
        break;
      case 'bat':
        this.noise(0.18, { gain: 0.25, filter: 'bandpass', frequency: 1900, end: 450 });
        this.tone(250, 0.12, { at: t + 0.08, end: 80, gain: 0.36, type: 'triangle' });
        break;
      case 'airstrike':
        this.noise(1, { gain: 0.28, frequency: 300, end: 1700, attack: 0.15 });
        this.tone(110, 0.9, { end: 220, gain: 0.12, type: 'sawtooth', attack: 0.15 });
        break;
      case 'rope':
        this.tone(1700, 0.2, { end: 600, gain: 0.12 });
        this.noise(0.07, { at: t + 0.16, gain: 0.22, filter: 'bandpass', frequency: 2700 });
        break;
      case 'jetpack':
        this.noise(0.7, { gain: 0.3, frequency: 650, end: 1700, attack: 0.06 });
        this.tone(75, 0.5, { end: 140, gain: 0.12, type: 'sawtooth', attack: 0.04 });
        break;
      case 'teleport':
        [60, 64, 67, 72, 76].forEach((n, i) =>
          this.tone(midi(n), 0.25, { at: t + i * 0.06, gain: 0.16, end: midi(n + 12) }),
        );
        break;
      case 'girder':
        [370, 790, 1270].forEach((f, i) => this.tone(f, 0.24 - i * 0.04, { gain: 0.13, type: 'triangle' }));
        this.noise(0.055, { gain: 0.16, filter: 'highpass', frequency: 2400 });
        break;
      default:
        this.tone(440, 0.1, { gain: 0.12 });
    }
  }
  destroy() {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerdown', this.onGesture);
    document.removeEventListener('keydown', this.onGesture);
    for (const node of this.nodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        /* A finished source is already stopped. */
      }
    }
    if (this.tensionNodes) {
      for (const node of [this.tensionNodes.drone, this.tensionNodes.lfo, this.tensionNodes.hiss]) {
        try {
          node.stop();
        } catch {
          /* Already stopped. */
        }
      }
      try {
        this.tensionNodes.gain.disconnect();
      } catch {
        /* Already disconnected. */
      }
      this.tensionNodes = null;
    }
    this.nodes.clear();
    this.seen.clear();
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.context = null;
  }
}
