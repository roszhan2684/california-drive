// Fully synthesized WebAudio sound design (no sample assets):
// layered flat-six engine, tires, wind, road, rain, horn, impacts, indicator ticks,
// city/coast/forest ambience, Doppler traffic hum, tunnel reverb and a generative "radio" station.

import type { Surface } from '../physics/world.ts';

export interface AudioFrame {
  dt: number;
  engineOn: boolean;
  rpm: number;
  throttle: number;
  load: number;
  limiter: boolean;
  speed: number;
  /** Max normalized tire slip (1 = peak grip). */
  slip: number;
  slideSpeed: number;
  surface: Surface;
  interior: boolean;
  inTunnel: boolean;
  rain: number;
  urban: number;
  coastal: number;
  forest: number;
  /** Nearest traffic: distance (m), closing speed (m/s), pan (-1..1). */
  traffic: { d: number; closing: number; pan: number }[];
  night: number;
  /** Nearest responding emergency vehicle (siren), if any. */
  siren?: { d: number; closing: number; pan: number; kind: 'police' | 'ambulance' | 'fire' } | null;
}

function noiseBuffer(ctx: BaseAudioContext, seconds = 2, brown = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverbSend!: GainNode;
  private interiorLP!: BiquadFilterNode;
  private engineOsc: OscillatorNode[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engineShaper!: WaveShaperNode;
  private engineNoiseBP!: BiquadFilterNode;
  private engineNoiseGain!: GainNode;
  private rumbleLFO!: OscillatorNode;
  private rumbleDepth!: GainNode;
  private tireBP!: BiquadFilterNode;
  private tireGain!: GainNode;
  private gravelGain!: GainNode;
  private windLP!: BiquadFilterNode;
  private windGain!: GainNode;
  private roadLP!: BiquadFilterNode;
  private roadGain!: GainNode;
  private rainGain!: GainNode;
  private rainHP!: BiquadFilterNode;
  private ambCity!: GainNode;
  private ambSea!: GainNode;
  private ambForest!: GainNode;
  private hornGain!: GainNode;
  private siren: { osc: OscillatorNode[]; gain: GainNode; pan: StereoPannerNode; bp: BiquadFilterNode } | null = null;
  private trafficVoices: { osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode; lp: BiquadFilterNode }[] = [];
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private shiftDip = 0;
  private time = 0;
  private nextAmbientEvent = 6;
  private musicOn = false;
  private musicTimer: number | null = null;
  private nextBeat = 0;
  private beat = 0;
  volumes = { master: 0.8, music: 0.45, sfx: 0.9 };
  private hornOn = false;
  private started = false;
  private engineGains: GainNode[] = [];
  private profile: { tone: 'inline6' | 'flat6'; turbo: boolean } = { tone: 'flat6', turbo: false };
  private turboOsc!: OscillatorNode;
  private turboGain!: GainNode;
  private boost = 0;
  private lastThrottle = 0;
  private whineOsc!: OscillatorNode;
  private whineGain!: GainNode;
  private sealBP!: BiquadFilterNode;
  private sealGain!: GainNode;
  private cabinShelf!: BiquadFilterNode;

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 3, true);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.interiorLP = ctx.createBiquadFilter();
    this.interiorLP.type = 'lowpass';
    this.interiorLP.frequency.value = 20000;
    // cockpit: low-shelf "boom" (cabin resonance) after the interior low-pass
    this.cabinShelf = ctx.createBiquadFilter();
    this.cabinShelf.type = 'lowshelf';
    this.cabinShelf.frequency.value = 160;
    this.cabinShelf.gain.value = 0;
    this.sfx.connect(this.interiorLP).connect(this.cabinShelf).connect(this.master);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.6, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.05;
    this.sfx.connect(this.reverbSend).connect(conv).connect(this.master);

    // engine: saw (firing), square (2nd harmonic), sine sub, filtered noise (intake/combustion)
    this.engineShaper = ctx.createWaveShaper();
    this.engineShaper.curve = softClip(3);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1.4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const engMix = ctx.createGain();
    const rumble = ctx.createGain();
    engMix.connect(rumble).connect(this.engineShaper).connect(this.engineFilter).connect(this.engineGain).connect(this.sfx);
    const types: [OscillatorType, number, number][] = [['sawtooth', 1, 0.5], ['square', 2, 0.16], ['sine', 0.5, 0.6], ['sawtooth', 1.5, 0.12]];
    for (const [type, , g] of types) {
      const o = ctx.createOscillator();
      o.type = type;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(engMix);
      o.start();
      this.engineOsc.push(o);
      this.engineGains.push(og);
    }
    // turbo spool whistle
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain).connect(this.sfx);
    this.turboOsc.start();
    // drivetrain gear whine: pitch follows the propshaft (wheel speed × final drive × gear teeth)
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.sfx);
    this.whineOsc.start();
    // door-seal wind whistle (cockpit only): resonant band of noise that rises with speed
    const sn = this.loopNoise(this.noise);
    this.sealBP = ctx.createBiquadFilter();
    this.sealBP.type = 'bandpass';
    this.sealBP.Q.value = 9;
    this.sealGain = ctx.createGain();
    this.sealGain.gain.value = 0;
    sn.connect(this.sealBP).connect(this.sealGain).connect(this.master);
    this.rumbleLFO = ctx.createOscillator();
    this.rumbleDepth = ctx.createGain();
    this.rumbleDepth.gain.value = 0.25;
    rumble.gain.value = 0.8;
    this.rumbleLFO.connect(this.rumbleDepth).connect(rumble.gain);
    this.rumbleLFO.start();
    const en = this.loopNoise(this.noise);
    this.engineNoiseBP = ctx.createBiquadFilter();
    this.engineNoiseBP.type = 'bandpass';
    this.engineNoiseBP.Q.value = 2;
    this.engineNoiseGain = ctx.createGain();
    en.connect(this.engineNoiseBP).connect(this.engineNoiseGain).connect(this.engineFilter);

    // tires
    const tn = this.loopNoise(this.noise);
    this.tireBP = ctx.createBiquadFilter();
    this.tireBP.type = 'bandpass';
    this.tireBP.Q.value = 7;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    tn.connect(this.tireBP).connect(this.tireGain).connect(this.sfx);
    const gn = this.loopNoise(this.brown);
    const glp = ctx.createBiquadFilter();
    glp.type = 'lowpass';
    glp.frequency.value = 900;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    gn.connect(glp).connect(this.gravelGain).connect(this.sfx);
    // wind + road
    const wn = this.loopNoise(this.noise);
    this.windLP = ctx.createBiquadFilter();
    this.windLP.type = 'lowpass';
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wn.connect(this.windLP).connect(this.windGain).connect(this.master);
    const rn = this.loopNoise(this.brown);
    this.roadLP = ctx.createBiquadFilter();
    this.roadLP.type = 'lowpass';
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    rn.connect(this.roadLP).connect(this.roadGain).connect(this.sfx);
    // rain
    const rr = this.loopNoise(this.noise);
    this.rainHP = ctx.createBiquadFilter();
    this.rainHP.type = 'highpass';
    this.rainHP.frequency.value = 1800;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rr.connect(this.rainHP).connect(this.rainGain).connect(this.master);
    // ambience beds
    const mkBed = (buf: AudioBuffer, type: BiquadFilterType, f: number) => {
      const s = this.loopNoise(buf);
      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(flt).connect(g).connect(this.master);
      return g;
    };
    this.ambCity = mkBed(this.brown, 'lowpass', 380);
    this.ambSea = mkBed(this.brown, 'lowpass', 700);
    this.ambForest = mkBed(this.noise, 'bandpass', 3200);
    // horn
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hbp = ctx.createBiquadFilter();
    hbp.type = 'bandpass';
    hbp.frequency.value = 900;
    hbp.Q.value = 1.2;
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hbp);
      o.start();
    }
    hbp.connect(this.hornGain).connect(this.sfx);
    // traffic voices (Doppler)
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(lp).connect(gain).connect(pan).connect(this.sfx);
      osc.start();
      this.trafficVoices.push({ osc, gain, pan, lp });
    }
    // emergency siren: two detuned square-ish voices through a horn-like band-pass
    {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      const osc = [0, 1].map((k) => {
        const o = ctx.createOscillator();
        o.type = k ? 'square' : 'triangle';
        o.frequency.value = 700;
        o.detune.value = k ? 7 : 0;
        o.connect(bp);
        o.start();
        return o;
      });
      bp.connect(gain).connect(pan).connect(this.sfx);
      this.siren = { osc, gain, pan, bp };
    }
    this.applyVolumes();
    this.started = true;
    this.setEngineProfile(this.profile);
  }

  private loopNoise(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random() * 0.5;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicOn ? this.volumes.music * 0.5 : 0, t, 0.2);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    this.ctx?.resume();
  }

  /** Current modelled turbo boost (0..1), for the HUD gauge. */
  get boostLevel(): number {
    return this.profile.turbo ? this.boost : 0;
  }

  /** Inline-six (smoother, more even harmonics) vs flat-six (raspier odd orders); optional turbo layer. */
  setEngineProfile(p: { tone: 'inline6' | 'flat6'; turbo: boolean }) {
    this.profile = p;
    if (!this.ctx || !this.engineGains.length) return;
    const gains = p.tone === 'inline6' ? [0.4, 0.07, 0.62, 0.05] : [0.5, 0.16, 0.6, 0.12];
    this.engineGains.forEach((g, i) => g.gain.setTargetAtTime(gains[i], this.ctx!.currentTime, 0.05));
    this.engineShaper.curve = softClip(p.tone === 'inline6' ? 2.2 : 3);
  }

  /** Blow-off valve "pssh" on lift-off under boost. */
  private blowOff(level: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    s.connect(bp).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + 0.45);
  }

  shift() {
    this.shiftDip = 0.09;
  }

  horn(on: boolean) {
    this.hornOn = on;
  }

  /** Short starter whine before the engine catches. */
  starter() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(260, t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 900;
    o.connect(lp).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.65);
  }

  tick(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = on ? 3200 : 2400;
    bp.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    s.connect(bp).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 0.04);
  }

  impact(strength: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = Math.min(1, strength);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1400;
    hp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + k * 0.3);
    s.connect(hp).connect(g).connect(this.sfx);
    s.start(t);
    s.stop(t + 0.7);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9 * k, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** Overrun crackle/pop (triggered by the world so flames and sound stay in sync). */
  crackle(level: number) {
    if (this.ctx && this.started) this.pop(level);
  }

  private pop(level: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500 + Math.random() * 900;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.05);
    s.connect(bp).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + 0.12);
  }

  private chirp(f: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private distantHorn() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 0.02);
    g.gain.setValueAtTime(0.025, t + 0.35);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    lp.connect(g).connect(this.master);
    for (const f of [392, 466]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * (0.9 + Math.random() * 0.2);
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.42);
    }
  }

  update(f: AudioFrame) {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const t = ctx.currentTime;
    this.time += f.dt;
    const TC = 0.03;
    // engine
    const rpm = Math.max(0, f.rpm);
    const fire = (rpm / 60) * 3;
    const ratios = [1, 2, 0.5, 1.5];
    this.engineOsc.forEach((o, i) => o.frequency.setTargetAtTime(Math.max(8, fire * ratios[i]), t, 0.015));
    this.rumbleLFO.frequency.setTargetAtTime(Math.max(1, fire * 0.5), t, 0.02);
    const rpmF = Math.min(1, rpm / 8000);
    const load = Math.max(f.throttle, f.load * 0.8);
    // outside you hear more exhaust rasp (brighter); inside the firewall and glass take the top off
    this.engineFilter.frequency.setTargetAtTime(380 + rpmF * 2600 + load * 2400 + (f.interior ? 0 : 600), t, TC);
    this.engineNoiseBP.frequency.setTargetAtTime(400 + fire * 3, t, TC);
    this.engineNoiseGain.gain.setTargetAtTime(0.08 + load * 0.25, t, TC);
    this.shiftDip = Math.max(0, this.shiftDip - f.dt);
    let eg = f.engineOn || rpm > 200 ? (0.18 + load * 0.22 + rpmF * 0.12) : 0;
    if (this.shiftDip > 0) eg *= 0.35;
    if (f.limiter) eg *= 0.6 + Math.random() * 0.4;
    if (f.interior) eg *= 0.85;
    this.engineGain.gain.setTargetAtTime(eg * Math.min(1, rpm / 600), t, TC);
    // turbo: boost builds with load and rpm (with spool lag), whistle follows shaft speed, blow-off on lift
    if (this.profile.turbo && f.engineOn) {
      const want = Math.min(1, f.throttle * Math.max(0, (rpm - 1500) / 3500));
      this.boost += (want - this.boost) * Math.min(1, f.dt * (want > this.boost ? 1.8 : 6));
      this.turboOsc.frequency.setTargetAtTime(1800 + this.boost * 2600 + rpmF * 1400, t, 0.05);
      this.turboGain.gain.setTargetAtTime(this.boost * 0.018 * (f.interior ? 0.6 : 1), t, 0.05);
      if (this.lastThrottle > 0.6 && f.throttle < 0.15 && this.boost > 0.45) this.blowOff(this.boost);
    } else if (this.turboGain) this.turboGain.gain.setTargetAtTime(0, t, 0.05);
    this.lastThrottle = f.throttle;

    // tires & surfaces
    const hard = f.surface === 'asphalt' || f.surface === 'concrete' || f.surface === 'cobble';
    const squeal = hard ? Math.max(0, Math.min(1, (f.slip - 0.85) * 1.6)) * Math.min(1, f.slideSpeed / 2.5) : 0;
    this.tireGain.gain.setTargetAtTime(squeal * 0.35, t, 0.05);
    this.tireBP.frequency.setTargetAtTime(650 + squeal * 450 + Math.sin(this.time * 23) * 60, t, 0.03);
    const loose = !hard ? Math.min(1, f.speed / 15) : 0;
    this.gravelGain.gain.setTargetAtTime(loose * 0.25 + (f.surface === 'cobble' ? Math.min(1, f.speed / 20) * 0.1 : 0), t, 0.1);
    const spd = Math.min(1, f.speed / 70);
    const inT = f.interior ? 0.35 : 1;
    this.windGain.gain.setTargetAtTime(spd * spd * 0.35 * inT, t, 0.1);
    this.windLP.frequency.setTargetAtTime(300 + spd * 2200, t, 0.1);
    this.roadGain.gain.setTargetAtTime(Math.min(1, f.speed / 30) * 0.22 * (f.interior ? 1.3 : 1), t, 0.1);
    // gear whine: ~31-tooth ring gear on a 3.15 final drive, 0.34 m tyre
    const shaftHz = (f.speed / 0.34) * 3.15 / (Math.PI * 2);
    this.whineOsc.frequency.setTargetAtTime(Math.max(20, shaftHz * 31), t, 0.04);
    const whine = Math.min(1, f.speed / 12) * (0.35 + Math.abs(f.throttle - 0.15) * 0.65);
    this.whineGain.gain.setTargetAtTime(whine * (f.interior ? 0.011 : 0.004), t, 0.08);
    // door seals whistle with speed², with a slow gust flutter
    const seal = f.interior ? Math.pow(Math.max(0, (f.speed - 18) / 50), 2) : 0;
    this.sealBP.frequency.setTargetAtTime(2200 + spd * 1800 + Math.sin(this.time * 1.7) * 140, t, 0.1);
    this.sealGain.gain.setTargetAtTime(Math.min(0.06, seal * 0.05 * (0.85 + 0.15 * Math.sin(this.time * 0.9))), t, 0.15);
    this.cabinShelf.gain.setTargetAtTime(f.interior ? 6 : 0, t, 0.1);
    this.roadLP.frequency.setTargetAtTime(180 + spd * 500, t, 0.1);
    this.rainGain.gain.setTargetAtTime(f.rain * (f.interior ? 0.16 : 0.12), t, 0.4);
    this.rainHP.frequency.setTargetAtTime(f.interior ? 600 : 1800, t, 0.4);
    this.interiorLP.frequency.setTargetAtTime(f.interior ? 2600 : 20000, t, 0.08);
    this.reverbSend.gain.setTargetAtTime(f.inTunnel ? 0.55 : 0.04, t, 0.25);
    this.hornGain.gain.setTargetAtTime(this.hornOn ? 0.22 : 0, t, 0.01);

    // ambience
    this.ambCity.gain.setTargetAtTime(f.urban * 0.05 * (1 - f.night * 0.4), t, 0.5);
    this.ambSea.gain.setTargetAtTime(f.coastal * (0.03 + 0.02 * Math.sin(this.time * 0.35)), t, 0.5);
    this.ambForest.gain.setTargetAtTime(f.forest * 0.006, t, 0.5);
    this.nextAmbientEvent -= f.dt;
    if (this.nextAmbientEvent <= 0) {
      this.nextAmbientEvent = 8 + Math.random() * 18;
      if (f.urban > 0.3 && Math.random() < 0.6) this.distantHorn();
      if (f.forest > 0.3 && f.night < 0.5) for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.chirp(2400 + Math.random() * 1200, 0.08, 0.02), i * 140);
      if (f.coastal > 0.3 && f.night < 0.6 && Math.random() < 0.5) this.chirp(1700, 0.25, 0.012);
    }
    // siren with Doppler: police wail, ambulance hi-lo, fire engine slow wail
    if (this.siren) {
      const sr = f.siren;
      if (!sr || sr.d > 260) this.siren.gain.gain.setTargetAtTime(0, t, 0.25);
      else {
        const dop = 343 / Math.max(200, 343 - sr.closing);
        const ph = this.time;
        const base = sr.kind === 'ambulance' ? (Math.floor(ph / 0.62) % 2 ? 770 : 960)
          : sr.kind === 'fire' ? 520 + 520 * (0.5 - 0.5 * Math.cos((ph * Math.PI * 2) / 6))
          : 640 + 680 * (0.5 - 0.5 * Math.cos((ph * Math.PI * 2) / 3.6));
        for (const o of this.siren.osc) o.frequency.setTargetAtTime(base * dop, t, 0.02);
        this.siren.bp.frequency.setTargetAtTime(base * dop * 1.1, t, 0.05);
        this.siren.gain.gain.setTargetAtTime(Math.min(0.06, 5 / (sr.d + 30)) * (f.interior ? 0.45 : 1) * (f.inTunnel ? 1.4 : 1), t, 0.12);
        this.siren.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, sr.pan)), t, 0.05);
      }
    }
    // traffic voices with Doppler
    this.trafficVoices.forEach((v, i) => {
      const tr = f.traffic[i];
      if (!tr || tr.d > 90) { v.gain.gain.setTargetAtTime(0, t, 0.2); return; }
      const dop = 343 / Math.max(200, 343 - tr.closing);
      v.osc.frequency.setTargetAtTime(62 * dop, t, 0.05);
      v.lp.frequency.setTargetAtTime(320 * dop, t, 0.05);
      v.gain.gain.setTargetAtTime(Math.min(0.12, 2.2 / (tr.d + 4)) * (f.interior ? 0.5 : 1), t, 0.1);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, tr.pan)), t, 0.05);
    });
  }

  // ------------------------------------------------------------ generative radio
  setMusic(on: boolean) {
    this.musicOn = on;
    this.applyVolumes();
    if (!this.ctx) return;
    if (on && this.musicTimer === null) {
      this.nextBeat = this.ctx.currentTime + 0.1;
      this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
    } else if (!on && this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    const spb = 60 / 92 / 2; // eighth notes at 92 bpm
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextBeat < ctx.currentTime + 0.25) {
      const b = this.beat;
      const t = this.nextBeat;
      const chord = chords[Math.floor(b / 16) % 4];
      if (b % 16 === 0) for (const n of chord) this.note(mtof(n), t, spb * 15, 'sawtooth', 0.035, 1100);
      if (b % 2 === 0) this.note(mtof(chord[0] - 24 + (b % 8 === 6 ? 7 : 0)), t, spb * 1.6, 'triangle', 0.13, 600);
      if (b % 4 === 0) this.kick(t);
      if (b % 2 === 1) this.hat(t, b % 4 === 3 ? 0.05 : 0.025);
      if (b % 8 === 4) this.snare(t);
      if (b % 3 === 0 && Math.random() < 0.4) this.note(mtof(chord[Math.floor(Math.random() * 3)] + 12), t, spb * 0.9, 'square', 0.02, 2500);
      this.beat++;
      this.nextBeat += spb;
    }
  }

  private note(f: number, t: number, dur: number, type: OscillatorType, g: number, cutoff: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 12;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = cutoff;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(g, t + Math.min(0.08, dur * 0.2));
    gn.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.15);
    o.connect(lp).connect(gn).connect(this.musicBus);
    o.start(t);
    o.stop(t + dur + 0.5);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(t: number, g0: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(g0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(hp).connect(g).connect(this.musicBus);
    s.start(t, Math.random());
    s.stop(t + 0.06);
  }

  private snare(t: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    s.connect(bp).connect(g).connect(this.musicBus);
    s.start(t, Math.random());
    s.stop(t + 0.2);
  }

  dispose() {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.ctx?.close();
    this.ctx = null;
  }
}
