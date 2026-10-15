// Procedural horror audio: everything is synthesised with the Web Audio API
// (oscillators, filtered noise, FM, waveshaping, a generated reverb impulse).
// Spatial sounds use HRTF PannerNodes positioned in world space; the listener
// follows the camera. The context is created/resumed on the first user gesture.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.nextBeat = 0;
    this.nextHallucination = 0;
    this.proximity = 0;
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
    this.played = 0; // sounds started (diagnostics / verification)
  }

  get running() { return this.ctx?.state === 'running'; }

  /** Call from any user gesture (click / key). Safe to call repeatedly. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this.build();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      console.warn('[audio] unavailable:', e);
      this.enabled = false;
    }
  }

  build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut).connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startAmbience();
  }

  /** Decaying stereo noise: a large stone house. */
  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  // ---- building blocks --------------------------------------------------------

  now() { return this.ctx.currentTime; }

  /** Route a source chain: optional world position, optional reverb send. Returns the input gain. */
  out({ pos = null, reverb = 0.25, gain = 1, ref = 2, rolloff = 1.1 } = {}) {
    const ctx = this.ctx;
    this.played++;
    const g = ctx.createGain();
    g.gain.value = gain;
    let tail = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.maxDistance = 80;
      p.rolloffFactor = rolloff;
      setPos(p, pos.x, pos.y ?? 1.5, pos.z);
      g.connect(p);
      tail = p;
    }
    tail.connect(this.sfx);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      tail.connect(send).connect(this.reverb);
    }
    return g;
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  osc(type, freq, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Attack / decay envelope on a fresh gain node. */
  env(t, attack, decay, peak = 1, shape = 'exp') {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (shape === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    else g.gain.linearRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  distortion(amount) {
    const ws = this.ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    ws.curve = curve;
    return ws;
  }

  /** A position just behind the listener's left or right ear. */
  behindEar(side) {
    const l = this.listener;
    const rx = -l.fz, rz = l.fx; // right vector
    return { x: l.x - l.fx * 0.7 + rx * side * 0.6, y: l.y + 0.1, z: l.z - l.fz * 0.7 + rz * side * 0.6 };
  }

  // ---- ambience, proximity heartbeat, sub-bass ---------------------------------

  startAmbience() {
    const ctx = this.ctx;
    const t = this.now();
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.05;
    this.droneFilter = this.filter('lowpass', 180, 2);
    this.droneFilter.connect(this.droneGain).connect(this.master);
    for (const [type, f] of [['sawtooth', 55], ['sawtooth', 55.7], ['triangle', 82.4], ['sine', 36.7]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start(t);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain).connect(this.droneFilter.frequency);
    lfo.start(t);

    // Draughts through the house.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airF = this.filter('bandpass', 700, 0.6);
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.012;
    air.connect(airF).connect(this.airGain).connect(this.master);
    air.start(t);
    const airLfo = ctx.createOscillator();
    airLfo.frequency.value = 0.11;
    const airLfoG = ctx.createGain();
    airLfoG.gain.value = 350;
    airLfo.connect(airLfoG).connect(airF.frequency);
    airLfo.start(t);

    // Sub-bass thrum: 40–60 Hz, driven by Amalgam proximity.
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = 40;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.master);
    this.sub.start(t);
  }

  /** One muffled lub-dub, heard inside your own head. */
  heartbeat(t, volume) {
    for (const [offset, v] of [[0, 1], [0.2, 0.65]]) {
      const tt = t + offset;
      const o = this.osc('sine', 62, tt, 0.25);
      o.frequency.exponentialRampToValueAtTime(34, tt + 0.16);
      const g = this.env(tt, 0.012, 0.2, volume * v);
      o.connect(g).connect(this.filter('lowpass', 160)).connect(this.master);
    }
  }

  /**
   * Per frame.
   * @param listener {x,y,z,fx,fz}  camera position + horizontal forward
   * @param m        { dist, hunting, stalking, awake } about the Amalgam on our floor (dist Infinity if not)
   */
  update(dt, listener, m) {
    if (!this.running || this.epilogue) return;
    this.listener = listener;
    const ctx = this.ctx, t = this.now();
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.x, t, 0.02);
      L.positionY.setTargetAtTime(listener.y, t, 0.02);
      L.positionZ.setTargetAtTime(listener.z, t, 0.02);
      L.forwardX.setTargetAtTime(listener.fx, t, 0.02);
      L.forwardY.setTargetAtTime(0, t, 0.02);
      L.forwardZ.setTargetAtTime(listener.fz, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(listener.x, listener.y, listener.z);
      L.setOrientation(listener.fx, 0, listener.fz, 0, 1, 0);
    }

    // 18 units → 3 units maps to 0 → 1.
    const k = clamp01((18 - m.dist) / 15);
    const target = m.hunting ? Math.max(k, 0.35) : k;
    this.proximity += (target - this.proximity) * Math.min(1, dt * 2);
    const p = this.proximity;
    this.subGain.gain.setTargetAtTime(p * 0.45, t, 0.3);
    this.sub.frequency.setTargetAtTime(40 + p * 20, t, 0.3);
    this.droneGain.gain.setTargetAtTime(0.045 + p * 0.05, t, 0.5);
    this.droneFilter.frequency.setTargetAtTime(160 + p * 400, t, 0.5);

    if (p > 0.04 && t >= this.nextBeat) {
      const bpm = 58 + p * 110;
      this.heartbeat(t + 0.02, 0.15 + p * 0.6);
      this.nextBeat = t + 60 / bpm;
    }

    // Auditory hallucinations while it stalks nearby.
    if (m.stalking && m.dist < 26 && t >= this.nextHallucination) {
      if (this.nextHallucination > 0) {
        if (Math.random() < 0.55) this.whisper(Math.random() < 0.5 ? -1 : 1);
        else this.knocks({ x: listener.x + rand(-2, 2), y: listener.y + 2.4, z: listener.z + rand(-2, 2) });
      }
      this.nextHallucination = t + rand(14, 30);
    }
  }

  // ---- the Amalgam ------------------------------------------------------------------

  /** Wet, clicking footfall (and sometimes dragging claws). */
  monsterStep(pos, hunting) {
    if (!this.running) return;
    const t = this.now();
    const vol = hunting ? 1 : 0.6;
    const o = this.out({ pos, reverb: 0.2, gain: vol });
    // wet slap
    const n = this.noiseSrc(t, 0.12);
    n.connect(this.filter('bandpass', rand(1800, 2800), 2.5)).connect(this.env(t, 0.004, 0.09, 0.9)).connect(o);
    // bone click
    const c = this.osc('square', rand(1400, 2200), t + 0.03, 0.02);
    c.connect(this.env(t + 0.03, 0.001, 0.02, 0.25)).connect(o);
    // weight
    const th = this.osc('sine', 95, t, 0.15);
    th.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    th.connect(this.env(t, 0.005, 0.13, 0.9)).connect(o);
    if (!hunting && Math.random() < 0.3) this.claws(pos);
  }

  claws(pos) {
    const t = this.now() + 0.05;
    const o = this.out({ pos, reverb: 0.3, gain: 0.5 });
    const n = this.noiseSrc(t, 0.7);
    const f = this.filter('bandpass', 900, 9);
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1300, t + 0.6);
    n.connect(f).connect(this.env(t, 0.15, 0.5, 0.8, 'lin')).connect(o);
  }

  /** The Black Magic shriek: FM screech + dissonant square + swept noise, distorted, huge tail. */
  shriek(pos, { volume = 1, length = 1.9, pitch = 1 } = {}) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ pos, reverb: 0.9, gain: volume, ref: 6, rolloff: 0.6 });
    const bus = this.ctx.createGain();
    const shaper = this.distortion(60);
    const lp = this.filter('lowpass', 6500, 0.7);
    const amp = this.env(t, 0.04, length, 0.8);
    bus.connect(shaper).connect(lp).connect(amp).connect(o);

    const car = this.osc('sawtooth', 700 * pitch, t, length + 0.2);
    car.frequency.linearRampToValueAtTime(1650 * pitch, t + 0.25);
    car.frequency.exponentialRampToValueAtTime(820 * pitch, t + length);
    const mod = this.osc('sine', 310 * pitch, t, length + 0.2);
    const modG = this.ctx.createGain();
    modG.gain.setValueAtTime(900, t);
    modG.gain.linearRampToValueAtTime(250, t + length);
    mod.connect(modG).connect(car.frequency);
    car.connect(bus);

    const sq = this.osc('square', 1245 * pitch, t, length + 0.2);
    sq.detune.setValueAtTime(0, t);
    sq.detune.linearRampToValueAtTime(-700, t + length);
    const vib = this.osc('sine', 9, t, length);
    const vibG = this.ctx.createGain();
    vibG.gain.value = 40;
    vib.connect(vibG).connect(sq.frequency);
    const sqG = this.ctx.createGain();
    sqG.gain.value = 0.35;
    sq.connect(sqG).connect(bus);

    const n = this.noiseSrc(t, length + 0.2);
    const bp = this.filter('bandpass', 3000, 6);
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(650, t + length);
    const nG = this.ctx.createGain();
    nG.gain.value = 0.9;
    n.connect(bp).connect(nG).connect(bus);
  }

  /** Three rapid knocks in the ceiling above you. */
  knocks(pos) {
    const t0 = this.now() + 0.05;
    const o = this.out({ pos, reverb: 0.45, gain: 0.9 });
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.17;
      const s = this.osc('sine', 150, t, 0.1);
      s.frequency.exponentialRampToValueAtTime(70, t + 0.08);
      s.connect(this.env(t, 0.002, 0.09, 1)).connect(o);
      this.noiseSrc(t, 0.04).connect(this.filter('bandpass', 420, 3)).connect(this.env(t, 0.001, 0.035, 0.7)).connect(o);
    }
  }

  /** Breathy, formant-shifting whisper right behind one ear. */
  whisper(side) {
    const t = this.now() + 0.05;
    const dur = rand(1.1, 1.8);
    const o = this.out({ pos: this.behindEar(side), reverb: 0.1, gain: 0.55, ref: 0.5, rolloff: 1.5 });
    const src = this.noiseSrc(t, dur);
    const sum = this.ctx.createGain();
    for (let i = 0; i < 3; i++) {
      const f = this.filter('bandpass', rand(500, 2600), 9);
      for (let s = 0; s < 8; s++) f.frequency.linearRampToValueAtTime(rand(450, 2800), t + (s / 8) * dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      for (let s = 0; s < 10; s++) g.gain.linearRampToValueAtTime(Math.random() < 0.7 ? rand(0.3, 1) : 0, t + (s / 10) * dur);
      src.connect(f).connect(g).connect(sum);
    }
    sum.connect(this.filter('highpass', 300)).connect(this.env(t, 0.2, dur, 1, 'lin')).connect(o);
  }

  /** Low sting when it starts hunting you. */
  huntStinger() {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ reverb: 0.5, gain: 0.5 });
    const lp = this.filter('lowpass', 300, 4);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    lp.frequency.exponentialRampToValueAtTime(400, t + 1.4);
    lp.connect(this.env(t, 0.02, 1.4, 1)).connect(o);
    for (const f of [110, 116.5, 155.6, 220.3]) this.osc('sawtooth', f, t, 1.5).connect(lp);
  }

  /** Close-up capture jumpscare. */
  jumpscare() {
    if (!this.running) return;
    this.shriek(null, { volume: 1.3, length: 1.1, pitch: 1.2 });
    const t = this.now();
    const o = this.out({ reverb: 0.2, gain: 1 });
    const s = this.osc('sine', 55, t, 0.8);
    s.frequency.exponentialRampToValueAtTime(30, t + 0.7);
    s.connect(this.env(t, 0.005, 0.75, 1)).connect(o);
    this.noiseSrc(t, 0.5).connect(this.filter('lowpass', 1200)).connect(this.env(t, 0.002, 0.45, 0.9)).connect(o);
  }

  hauntSting() {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ reverb: 0.7, gain: 0.22 });
    const s = this.osc('sine', 1760, t, 2.5);
    s.frequency.linearRampToValueAtTime(1735, t + 2.4);
    s.connect(this.env(t, 0.6, 1.8, 0.5, 'lin')).connect(o);
    const b = this.osc('sine', 41, t, 1.5);
    b.connect(this.env(t, 0.01, 1.4, 0.9)).connect(o);
  }

  // ---- world events -------------------------------------------------------------------

  /** The Tome awakening gong: inharmonic bronze, long beating decay. */
  gong() {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ reverb: 0.8, gain: 0.7 });
    for (const [f, v, d] of [[65, 1, 7], [65.6, 0.6, 7], [97.4, 0.5, 5], [131.7, 0.45, 4.5], [174.3, 0.3, 3.5], [233.9, 0.22, 3], [312, 0.12, 2.2]]) {
      this.osc('sine', f, t, d).connect(this.env(t, 0.01, d, v)).connect(o);
    }
    this.noiseSrc(t, 0.2).connect(this.filter('lowpass', 900)).connect(this.env(t, 0.002, 0.18, 0.6)).connect(o);
  }

  heartTell(pos, volume) {
    if (!this.running) return;
    const t = this.now();
    for (const [offset, v] of [[0, 1], [0.21, 0.6]]) {
      const o = this.out({ pos, reverb: 0.15, gain: volume * v, ref: 1, rolloff: 1.6 });
      const s = this.osc('sine', 70, t + offset, 0.2);
      s.frequency.exponentialRampToValueAtTime(42, t + offset + 0.15);
      s.connect(this.filter('lowpass', 200)).connect(this.env(t + offset, 0.01, 0.17, 1)).connect(o);
    }
  }

  heartDestroyed(pos) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ pos, reverb: 0.6, gain: 1, ref: 4 });
    this.noiseSrc(t, 0.5).connect(this.filter('bandpass', 1100, 1.5)).connect(this.env(t, 0.003, 0.4, 1)).connect(o);
    const s = this.osc('sine', 120, t, 1.2);
    s.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    s.connect(this.env(t, 0.005, 1.1, 1)).connect(o);
    // last, slowing heartbeat
    this.heartTell(pos, 1);
  }

  gate(pos, open) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ pos, reverb: 0.55, gain: 0.9, ref: 3 });
    for (const [f, d] of [[182, 0.9], [417, 0.7], [733, 0.55], [1129, 0.4], [1611, 0.3]]) {
      this.osc('sine', f * (open ? 1 : 0.85), t, d).connect(this.env(t, 0.002, d, 0.35)).connect(o);
    }
    this.noiseSrc(t, 0.06).connect(this.filter('highpass', 2500)).connect(this.env(t, 0.001, 0.05, 0.8)).connect(o);
    for (let i = 0; i < 6; i++) {
      const tt = t + 0.08 + i * rand(0.05, 0.09);
      this.noiseSrc(tt, 0.03).connect(this.filter('bandpass', rand(2500, 4000), 6)).connect(this.env(tt, 0.001, 0.03, 0.5)).connect(o);
    }
  }

  /** Metal grinding while someone works the lock. */
  lockScrape(pos) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ pos, reverb: 0.3, gain: 0.35 });
    const f = this.filter('bandpass', rand(1500, 2600), 12);
    this.noiseSrc(t, 0.25).connect(f).connect(this.env(t, 0.03, 0.2, 1, 'lin')).connect(o);
  }

  ping(pos) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ pos, reverb: 0.6, gain: 0.6, ref: 6, rolloff: 0.5 });
    const s = this.osc('sine', 520, t, 1.2);
    s.frequency.linearRampToValueAtTime(690, t + 0.35);
    s.frequency.linearRampToValueAtTime(500, t + 1.1);
    s.connect(this.env(t, 0.08, 1.05, 0.8, 'lin')).connect(o);
  }

  playerStep(stone, speed) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ reverb: 0.12, gain: 0.08 + Math.min(1, speed / 5.6) * 0.12 });
    this.noiseSrc(t, 0.08).connect(this.filter('bandpass', stone ? 520 : 300, 1.5)).connect(this.env(t, 0.003, 0.07, 1)).connect(o);
    const th = this.osc('sine', stone ? 120 : 85, t, 0.08);
    th.connect(this.env(t, 0.002, 0.07, 0.5)).connect(o);
  }

  // ---- the seven spells ------------------------------------------------------------------

  spell(ability, pos) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ pos, reverb: 0.4, gain: 0.8, ref: 3 });
    switch (ability) {
      case 'psychic_torment': {
        // A swelling, detuned dread that cuts off sharply.
        const lp = this.filter('lowpass', 200, 6);
        lp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
        lp.connect(this.env(t, 0.4, 0.25, 0.9, 'lin')).connect(o);
        this.noiseSrc(t, 0.7).connect(lp);
        for (const f of [55, 58.3, 82.4]) this.osc('sawtooth', f, t, 0.7).connect(lp);
        break;
      }
      case 'ignis_blast': {
        const bp = this.filter('bandpass', 400, 1.2);
        bp.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
        this.noiseSrc(t, 0.5).connect(bp).connect(this.env(t, 0.03, 0.45, 1)).connect(o);
        for (let i = 0; i < 8; i++) {
          const tt = t + rand(0, 0.4);
          this.noiseSrc(tt, 0.02).connect(this.filter('highpass', 3000)).connect(this.env(tt, 0.001, 0.015, 0.6)).connect(o);
        }
        break;
      }
      case 'tidal_surge': {
        const lp = this.filter('lowpass', 500, 1);
        lp.frequency.linearRampToValueAtTime(2600, t + 0.35);
        lp.frequency.linearRampToValueAtTime(350, t + 0.9);
        this.noiseSrc(t, 1).connect(lp).connect(this.env(t, 0.25, 0.7, 1, 'lin')).connect(o);
        for (let i = 0; i < 6; i++) {
          const tt = t + rand(0.1, 0.8);
          const b = this.osc('sine', rand(400, 900), tt, 0.06);
          b.frequency.exponentialRampToValueAtTime(rand(900, 1500), tt + 0.05);
          b.connect(this.env(tt, 0.003, 0.05, 0.25)).connect(o);
        }
        break;
      }
      case 'terra_spike': {
        this.noiseSrc(t, 1.2).connect(this.filter('lowpass', 160, 1)).connect(this.env(t, 0.03, 1.1, 1.2)).connect(o);
        this.osc('sine', 45, t, 1).connect(this.env(t, 0.02, 0.9, 0.9)).connect(o);
        for (let i = 0; i < 5; i++) {
          const tt = t + i * rand(0.04, 0.09);
          this.noiseSrc(tt, 0.05).connect(this.filter('bandpass', rand(1200, 2200), 2)).connect(this.env(tt, 0.001, 0.05, 0.7)).connect(o);
        }
        break;
      }
      case 'gale_force': {
        const bp = this.filter('bandpass', 300, 2);
        bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
        bp.frequency.exponentialRampToValueAtTime(600, t + 0.9);
        const trem = this.osc('sine', 13, t, 0.9);
        const tg = this.ctx.createGain();
        tg.gain.value = 0.4;
        const amp = this.env(t, 0.05, 0.85, 1, 'lin');
        trem.connect(tg).connect(amp.gain);
        this.noiseSrc(t, 0.95).connect(bp).connect(amp).connect(o);
        break;
      }
      case 'sacred_bind': {
        for (const f of [880, 1108.7, 1318.5, 1760, 2217.5]) {
          this.osc('sine', f * rand(0.998, 1.002), t, 1.8).connect(this.env(t, 0.005, 1.7, 0.22)).connect(o);
        }
        this.noiseSrc(t, 0.3).connect(this.filter('highpass', 6000)).connect(this.env(t, 0.002, 0.28, 0.5)).connect(o);
        break;
      }
      case 'aegis_void': {
        const car = this.osc('sine', 220, t, 1.1);
        const mod = this.osc('sine', 331, t, 1.1);
        const mg = this.ctx.createGain();
        mg.gain.setValueAtTime(20, t);
        mg.gain.linearRampToValueAtTime(600, t + 0.5);
        mg.gain.linearRampToValueAtTime(40, t + 1.0);
        mod.connect(mg).connect(car.frequency);
        car.connect(this.env(t, 0.25, 0.8, 0.5, 'lin')).connect(o);
        this.osc('triangle', 1760, t, 0.9).connect(this.env(t, 0.4, 0.5, 0.08, 'lin')).connect(o);
        break;
      }
    }
  }

  // ---- building blocks for the grimoire -----------------------------------------------

  whoosh(pos, f0, f1, dur, { q = 1.5, gain = 0.8, reverb = 0.35, type = 'bandpass' } = {}) {
    const t = this.now();
    const o = this.out({ pos, reverb, gain, ref: 3 });
    const f = this.filter(type, f0, q);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    this.noiseSrc(t, dur).connect(f).connect(this.env(t, dur * 0.25, dur * 0.75, 1, 'lin')).connect(o);
  }

  boom(pos, f = 80, dur = 0.6, gain = 1) {
    const t = this.now();
    const o = this.out({ pos, reverb: 0.5, gain, ref: 3 });
    const s = this.osc('sine', f, t, dur);
    s.frequency.exponentialRampToValueAtTime(f * 0.35, t + dur * 0.9);
    s.connect(this.env(t, 0.003, dur, 1)).connect(o);
    this.noiseSrc(t, dur).connect(this.filter('lowpass', f * 10)).connect(this.env(t, 0.003, dur * 0.9, 0.8)).connect(o);
  }

  chime(pos, freqs, dur = 1.4, gain = 0.25, type = 'sine') {
    const t = this.now();
    const o = this.out({ pos, reverb: 0.6, gain, ref: 3 });
    freqs.forEach((f, i) => this.osc(type, f * rand(0.998, 1.002), t + i * 0.015, dur).connect(this.env(t + i * 0.015, 0.005, dur, 1)).connect(o));
  }

  crackle(pos, dur = 0.5, n = 10, gain = 0.6) {
    const t = this.now();
    const o = this.out({ pos, reverb: 0.2, gain, ref: 2 });
    for (let i = 0; i < n; i++) {
      const tt = t + rand(0, dur);
      this.noiseSrc(tt, 0.02).connect(this.filter('highpass', rand(2000, 5000))).connect(this.env(tt, 0.001, 0.015, rand(0.3, 1))).connect(o);
    }
  }

  rumble(pos, dur = 1.2, gain = 1) {
    const t = this.now();
    const o = this.out({ pos, reverb: 0.4, gain, ref: 4 });
    this.noiseSrc(t, dur).connect(this.filter('lowpass', 150)).connect(this.env(t, 0.05, dur, 1.2)).connect(o);
    this.osc('sine', 42, t, dur).connect(this.env(t, 0.05, dur, 0.9)).connect(o);
  }

  roar(pos, fire) {
    const t = this.now();
    const o = this.out({ pos, reverb: 0.7, gain: 1, ref: 6, rolloff: 0.6 });
    const lp = this.filter('lowpass', fire ? 900 : 2200, 3);
    lp.frequency.linearRampToValueAtTime(fire ? 2600 : 4000, t + 0.5);
    lp.frequency.exponentialRampToValueAtTime(300, t + 2.2);
    lp.connect(this.distortion(fire ? 40 : 8)).connect(this.env(t, 0.15, 2.1, 1)).connect(o);
    const saw = this.osc('sawtooth', fire ? 85 : 140, t, 2.4);
    saw.frequency.linearRampToValueAtTime(fire ? 60 : 210, t + 2.2);
    const trem = this.osc('sine', fire ? 23 : 9, t, 2.4);
    const tg = this.ctx.createGain();
    tg.gain.value = fire ? 18 : 60;
    trem.connect(tg).connect(saw.frequency);
    saw.connect(lp);
    this.noiseSrc(t, 2.4).connect(lp);
  }

  /** Spells beyond the original seven + every Ultimate. */
  grimoire(ability, pos) {
    switch (ability) {
      case 'dimension_slash': this.whoosh(pos, 3000, 200, 0.4, { q: 4, gain: 0.9 }); this.chime(pos, [233, 247], 0.6, 0.2, 'sawtooth'); break;
      case 'black_hole': this.whoosh(pos, 120, 2400, 1.6, { type: 'lowpass', gain: 1, reverb: 0.7 }); this.boom(pos, 45, 2.5, 0.9); break;
      case 'shadow_step': this.whoosh(pos, 2000, 200, 0.6, { q: 0.7, gain: 0.6 }); break;
      case 'abyssal_mind_fracture': this.rumble(pos, 1.5, 1); this.chime(pos, [55, 58.3, 77.8, 110.4], 3, 0.4, 'sawtooth'); break;
      case 'calidus_brachium': for (let i = 0; i < 3; i++) setTimeout(() => { this.boom(pos, 120, 0.35, 0.8); this.crackle(pos, 0.3, 8); }, i * 200); break;
      case 'sol_linea': this.whoosh(pos, 600, 4000, 0.5, { q: 3, gain: 1 }); this.chime(pos, [1046.5, 1568], 0.8, 0.2, 'sawtooth'); this.crackle(pos, 1.5, 30, 0.5); break;
      case 'phoenix_aura': this.whoosh(pos, 300, 2000, 0.9, { gain: 0.8 }); this.crackle(pos, 1, 20); break;
      case 'fiendfyre_dragon': this.roar(pos, true); this.crackle(pos, 2, 50, 0.8); break;
      case 'water_spear': this.whoosh(pos, 1200, 6000, 0.3, { q: 6, gain: 0.8 }); break;
      case 'sea_cradle': this.whoosh(pos, 400, 1400, 1, { type: 'lowpass', gain: 0.7 }); this.chime(pos, [392, 523, 659], 1.2, 0.15); break;
      case 'riptide_vortex': this.chime(pos, [587, 880, 1174], 0.9, 0.18); break;
      case 'abyssal_deluge': this.rumble(pos, 3, 1.2); this.whoosh(pos, 200, 1500, 3, { type: 'lowpass', gain: 1.2, reverb: 0.8 }); break;
      case 'devils_snare': this.crackle(pos, 0.8, 40, 0.9); this.rumble(pos, 0.6, 0.6); break;
      case 'golem_boulder': this.rumble(pos, 0.5, 0.8); this.whoosh(pos, 300, 120, 0.5, { gain: 0.6 }); break;
      case 'granite_skin': this.crackle(pos, 0.6, 25, 0.8); this.boom(pos, 70, 0.4, 0.6); break;
      case 'yggdrasil': this.rumble(pos, 2.5, 1); this.chime(pos, [261.6, 329.6, 392, 523.3, 659.3], 3.5, 0.3); break;
      case 'kamaitachi': for (let i = 0; i < 3; i++) setTimeout(() => this.whoosh(pos, 4000, 800, 0.25, { q: 5, gain: 0.7 }), i * 150); break;
      case 'zephyr_tailwind': this.whoosh(pos, 500, 2500, 1.2, { q: 1, gain: 0.8 }); break;
      case 'vacuum_tempest': this.whoosh(pos, 3000, 150, 1.2, { q: 2, gain: 1 }); this.boom(pos, 60, 0.8, 0.6); break;
      case 'sylph_dragon': this.roar(pos, false); this.whoosh(pos, 300, 3000, 2.5, { q: 0.8, gain: 1 }); break;
      case 'arrows_of_judgment': for (let i = 0; i < 5; i++) setTimeout(() => this.chime(pos, [1318.5 + i * 100, 1760 + i * 120], 0.4, 0.15), 350 + i * 150); break;
      case 'patronus_beacon': this.chime(pos, [523.3, 659.3, 784, 1046.5, 1318.5], 2.5, 0.25); break;
      case 'flash_step': this.whoosh(pos, 6000, 1500, 0.2, { q: 2, gain: 0.7 }); this.chime(pos, [1760, 2637], 0.5, 0.15); break;
      case 'dawn_sacred_order': this.choir(); break;
      case 'black_slash': this.whoosh(pos, 1500, 300, 0.4, { q: 3, gain: 1 }); this.boom(pos, 90, 0.3, 0.6); break;
      case 'null_zone': this.chime(pos, [110, 116.5], 2, 0.3, 'triangle'); break;
      case 'bull_thrust': this.whoosh(pos, 400, 100, 0.4, { type: 'lowpass', gain: 1 }); this.boom(pos, 80, 0.5, 1); break;
      case 'devil_union': this.chime(null, [55, 82.4, 110, 164.8], 3, 0.5, 'sawtooth'); this.whoosh(null, 100, 1500, 2, { type: 'lowpass', gain: 1, reverb: 0.8 }); break;
    }
  }

  /** Dawn: a swelling major choir (formant-filtered saws). */
  choir() {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ reverb: 0.9, gain: 0.35 });
    for (const f of [261.6, 329.6, 392, 523.3, 659.3]) {
      const v = this.osc('sawtooth', f, t, 6);
      const vib = this.osc('sine', 5 + Math.random(), t, 6);
      const vg = this.ctx.createGain();
      vg.gain.value = f * 0.006;
      vib.connect(vg).connect(v.frequency);
      const formant = this.filter('bandpass', 900, 3);
      v.connect(formant).connect(this.env(t, 1.6, 4.2, 0.6, 'lin')).connect(o);
    }
  }

  lumos(on) {
    if (!this.running) return;
    if (on) {
      this.chime(null, [1568, 2093, 3136], 0.7, 0.12);
      this.whoosh(null, 800, 5000, 0.25, { q: 1, gain: 0.25, reverb: 0.1 });
    } else this.whoosh(null, 3000, 400, 0.25, { q: 1, gain: 0.2, reverb: 0.1 });
  }

  monsterAttack(kind, pos) {
    if (!this.running) return;
    switch (kind) {
      case 'claw': this.whoosh(pos, 2500, 500, 0.25, { q: 3, gain: 1 }); this.crackle(pos, 0.1, 5, 1); break;
      case 'shockwave': this.boom(pos, 55, 1.2, 1.3); this.rumble(pos, 1, 0.8); break;
      case 'tendril': this.whoosh(pos, 900, 200, 0.35, { q: 6, gain: 1 }); break;
      case 'smash': this.boom(pos, 70, 0.7, 1.1); this.crackle(pos, 0.4, 25, 1); break;
    }
  }

  hurt(amount) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ reverb: 0.1, gain: Math.min(1, 0.4 + amount / 40) });
    const s = this.osc('sine', 70, t, 0.4);
    s.frequency.exponentialRampToValueAtTime(35, t + 0.35);
    s.connect(this.env(t, 0.003, 0.35, 1)).connect(o);
    this.noiseSrc(t, 0.2).connect(this.filter('bandpass', 700, 1)).connect(this.env(t, 0.002, 0.15, 0.7)).connect(o);
  }

  fruit() { if (this.running) this.chime(null, [784, 987.8, 1174.7, 1568], 1.2, 0.25); }

  /** Water lapping while the mansion is flooded. */
  setFlooded(on) {
    if (!this.running) return;
    if (on && !this.floodNodes) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = this.filter('lowpass', 500, 1);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.4;
      const lg = this.ctx.createGain();
      lg.gain.value = 0.05;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(this.master);
      src.start();
      lfo.start();
      g.gain.setTargetAtTime(0.12, this.now(), 1);
      this.floodNodes = { src, g, lfo };
    } else if (!on && this.floodNodes) {
      const { src, g, lfo } = this.floodNodes;
      g.gain.setTargetAtTime(0, this.now(), 0.8);
      src.stop(this.now() + 3);
      lfo.stop(this.now() + 3);
      this.floodNodes = null;
    }
  }

  // ---- Phase III ---------------------------------------------------------------------

  mastery(id, pos) {
    if (!this.running) return;
    switch (id) {
      case 'm_fire_dragon': this.roar(pos, true); break;
      case 'm_wind_dragon': this.roar(pos, false); break;
      case 'm_water_deluge': this.grimoire('tidal_surge', pos); this.whoosh(pos, 200, 2000, 1.2, { type: 'lowpass', gain: 1 }); break;
      case 'm_earth_pillars': this.rumble(pos, 1.2, 1.2); this.crackle(pos, 0.6, 30, 1); break;
      case 'm_white_chains': this.chime(pos, [880, 1108.7, 1318.5, 1760], 2, 0.3); break;
      case 'm_black_torment': this.shriek(pos, { volume: 0.7, length: 1.2, pitch: 0.8 }); break;
      case 'm_antimagic_slash': this.grimoire('black_slash', pos); break;
    }
  }

  bossCue(kind, pos) {
    if (!this.running) return;
    if (kind === 'volley') this.whoosh(pos, 180, 900, 0.7, { q: 2, gain: 0.9 });
    if (kind === 'wave') { this.boom(pos, 45, 1.4, 1.3); this.rumble(pos, 1.2, 1); }
    if (kind === 'charge') this.shriek(pos, { volume: 0.6, length: 0.8, pitch: 0.6 });
    if (kind === 'ward') this.chime(pos, [110, 116.5, 164.8], 2.5, 0.4, 'sawtooth');
    if (kind === 'portal') { this.rumble(pos, 4, 1.5); this.shriek(pos, { volume: 0.8, length: 3, pitch: 0.5 }); }
    if (kind === 'sealing') { this.shriek(pos, { volume: 1.2, length: 3.2, pitch: 0.9 }); this.boom(pos, 35, 3, 1.5); }
  }

  /** A low choral hum that swells with the Forbidden Spell. */
  chant(level) {
    if (!this.running) return;
    if (!this.chantNodes && level > 0) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const f = this.filter('bandpass', 700, 2);
      for (const hz of [98, 146.8, 196, 293.7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz * rand(0.997, 1.003);
        o.connect(f);
        o.start();
      }
      f.connect(g).connect(this.reverb);
      g.connect(this.master);
      this.chantNodes = { g };
    }
    this.chantNodes?.g.gain.setTargetAtTime(level * 0.12, this.now(), 0.3);
  }

  mergeSound() {
    if (!this.running) return;
    this.choir();
    this.whoosh(null, 100, 6000, 3, { type: 'lowpass', gain: 1, reverb: 0.9 });
    this.boom(null, 40, 3, 1.2);
  }

  /** Phase IV: the horror falls silent; warm harp + pads + birdsong. */
  epilogueMusic() {
    if (!this.running) return;
    const t = this.now();
    this.droneGain?.gain.setTargetAtTime(0, t, 1);
    this.subGain?.gain.setTargetAtTime(0, t, 0.5);
    this.airGain?.gain.setTargetAtTime(0.004, t, 2);
    this.chantNodes?.g.gain.setTargetAtTime(0, t, 0.5);
    this.proximity = 0;
    this.epilogue = true;
    const music = this.ctx.createGain();
    music.gain.value = 0;
    music.gain.setTargetAtTime(0.5, t + 1.5, 2);
    music.connect(this.master);
    const send = this.ctx.createGain();
    send.gain.value = 0.35;
    music.connect(send).connect(this.reverb);
    this.music = music;
    const chords = [[261.6, 329.6, 392], [196, 246.9, 293.7], [220, 261.6, 329.6], [174.6, 220, 261.6]]; // C G Am F
    const bar = 3.2;
    let step = 0;
    const schedule = () => {
      if (!this.epilogue || !this.ctx) return;
      const now = this.now();
      const chord = chords[step % chords.length];
      // Pad
      const lp = this.filter('lowpass', 1100, 0.5);
      const pad = this.ctx.createGain();
      pad.gain.setValueAtTime(0.0001, now);
      pad.gain.linearRampToValueAtTime(0.09, now + 1);
      pad.gain.linearRampToValueAtTime(0.0001, now + bar + 0.8);
      lp.connect(pad).connect(music);
      for (const f of chord) for (const d of [-4, 4]) {
        const o = this.osc('sawtooth', f / 2, now, bar + 1);
        o.detune.value = d;
        o.connect(lp);
      }
      // Harp arpeggio (plucked partials)
      const notes = [...chord, chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[1] * 2, chord[0] * 2];
      notes.forEach((f, i) => {
        const tt = now + i * (bar / notes.length);
        for (const [mult, amp] of [[1, 0.22], [2, 0.07], [3, 0.03]]) {
          this.osc('sine', f * mult, tt, 2).connect(this.env(tt, 0.004, 1.8, amp)).connect(music);
        }
      });
      // Birdsong
      for (let b = 0; b < 3; b++) {
        if (Math.random() < 0.6) {
          const tt = now + rand(0, bar);
          const o = this.osc('sine', rand(2400, 3600), tt, 0.3);
          o.frequency.exponentialRampToValueAtTime(rand(3000, 4800), tt + 0.08);
          o.frequency.exponentialRampToValueAtTime(rand(2200, 3200), tt + 0.18);
          o.connect(this.env(tt, 0.01, 0.2, 0.05)).connect(music);
        }
      }
      step++;
      this.musicTimer = setTimeout(schedule, bar * 1000);
    };
    schedule();
  }

  stopEpilogueMusic() {
    this.epilogue = false;
    clearTimeout(this.musicTimer);
    this.music?.gain.setTargetAtTime(0, this.now(), 0.5);
  }

  fireImpact(pos) {
    if (!this.running) return;
    const t = this.now();
    const o = this.out({ pos, reverb: 0.5, gain: 1, ref: 3 });
    const s = this.osc('sine', 85, t, 0.6);
    s.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    s.connect(this.env(t, 0.003, 0.55, 1)).connect(o);
    this.noiseSrc(t, 0.7).connect(this.filter('lowpass', 900)).connect(this.env(t, 0.003, 0.65, 0.9)).connect(o);
  }

  dispose() {
    this.epilogue = false;
    clearTimeout(this.musicTimer);
    try { this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
  }
}

function setPos(panner, x, y, z) {
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
}
