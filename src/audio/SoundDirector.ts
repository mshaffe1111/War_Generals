import type { AudioEraMode, BattleResolutionKind } from '../core/types';

/**
 * Dual-Era Battlefield & Electro-Mechanical WebAudio Synthesizer (`SoundDirector.ts`).
 * - Combines tactile tabletop wood/brass foley with visceral Warfield combat audio:
 *   armored blast-door locks, stereo-panned automatic rifle & heavy machine-gun bursts,
 *   metallic armor ricochets, incoming artillery shell whistle, and multi-layered sub-bass
 *   high-explosive detonations—all routed through a master compressor + live `AnalyserNode`
 *   that drives the tactical 3D CRT oscilloscope in real time!
 */
export class SoundDirector {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timeDomainBuf: Float32Array<ArrayBuffer> | null = null;

  private muted = false;
  private eraMode: AudioEraMode = '1980s';
  private activeCleanupFns: Array<() => void> = [];

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.82;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.58;
      this.timeDomainBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.82, this.ctx.currentTime, 0.02);
    }
  }

  public setEraMode(mode: AudioEraMode): void {
    this.eraMode = mode;
  }

  public sampleLiveWaveform(out: Float32Array): boolean {
    if (
      !this.analyser ||
      !this.timeDomainBuf ||
      !this.ctx ||
      this.ctx.state !== 'running' ||
      this.muted
    ) {
      return false;
    }
    this.analyser.getFloatTimeDomainData(this.timeDomainBuf);
    let peak = 0;
    const len = Math.min(out.length, this.timeDomainBuf.length);
    for (let i = 0; i < len; i++) {
      const v = this.timeDomainBuf[i]!;
      out[i] = v;
      const av = Math.abs(v);
      if (av > peak) peak = av;
    }
    return peak > 0.004;
  }

  public playSelect(): void {
    this.unlock();
    if (!this.ctx || !this.compressor || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(540, 820, 0.05, 'triangle', 0.14, now);
    this.triggerNoiseBurst(0.024, 2100, 0.09, now, 2.0);
  }

  public playMoveSlide(): void {
    this.unlock();
    if (!this.ctx || !this.compressor || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerNoiseBurst(0.085, 680, 0.1, now, 1.4);
    this.triggerTone(195, 112, 0.08, 'sine', 0.24, now + 0.068);
    this.triggerNoiseBurst(0.032, 2200, 0.15, now + 0.068, 1.8);
  }

  /**
   * Act 1 (`0.0s – 0.95s`): Armored blast doors parting + artillery breech lock + twin combat slams + radar lock!
   */
  public playAct1LockIn(speedScale = 1): void {
    this.unlock();
    this.stopActiveSequence();
    if (!this.ctx || !this.compressor || this.muted) return;

    const inv = 1 / speedScale;
    const now = this.ctx.currentTime;

    // Heavy armored blast doors parting + hydraulic hiss
    this.triggerNoiseBurst(0.24 * inv, 920, 0.22, now + 0.02, 1.1);
    this.triggerTone(125, 68, 0.24 * inv, 'sawtooth', 0.24, now + 0.02, 720);

    // Metallic artillery breech-bolt rack & lock (`chk-CLACK!`)
    this.triggerNoiseBurst(0.04, 3400, 0.28, now + 0.16 * inv, 2.4);
    this.triggerTone(420, 180, 0.07, 'triangle', 0.26, now + 0.2 * inv);

    // Twin armored pad lock-in slams + sub-bass war drum hit
    for (const [idx, offset] of ([0.22 * inv, 0.31 * inv] as const).entries()) {
      const pan = idx === 0 ? -0.45 : 0.45;
      this.triggerTone(155, 44, 0.2, 'sine', 0.44, now + offset, 1200, pan);
      this.triggerNoiseBurst(0.11, 2800, 0.28, now + offset, 1.6, pan);
    }

    // Tactical target-lock acquisition double-ping
    this.triggerTone(1320, 1320, 0.06, 'sine', 0.14, now + 0.52 * inv);
    this.triggerTone(1760, 1760, 0.08, 'sine', 0.16, now + 0.62 * inv);
  }

  /**
   * Act 2 (`0.95s – 2.80s`): Intense Warfield Firefight!
   * Stereo-panned automatic gunfire bursts, armor-piercing ricochets, close mortar thumps,
   * and a spine-tingling incoming artillery shell whistle ramping into Act 3 detonation!
   */
  public playAct2Arbitrating(durationSec: number): void {
    this.unlock();
    if (!this.ctx || !this.compressor || this.muted) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. Left Squad (Navy) Heavy Assault Bursts (`pan = -0.55`)
    const leftBursts = [0.04, 0.13, 0.22, 0.52, 0.61, 0.7, 0.79, 1.12, 1.21, 1.3];
    for (const bt of leftBursts) {
      if (bt < durationSec - 0.15) {
        this.triggerGunshot(now + bt, -0.55, 1.0);
      }
    }

    // 2. Right Squad (Crimson) Rapid Carbine Counter-Fire (`pan = +0.55`)
    const rightBursts = [0.28, 0.35, 0.42, 0.49, 0.86, 0.93, 1.0, 1.36, 1.43, 1.5, 1.57];
    for (const bt of rightBursts) {
      if (bt < durationSec - 0.12) {
        this.triggerGunshot(now + bt, 0.55, 1.18);
      }
    }

    // 3. Supersonic Bullet Ricochets off Sloped Armor (`zing!`)
    for (const [idx, rt] of [0.24, 0.56, 0.96, 1.28, 1.54].entries()) {
      if (rt < durationSec - 0.1) {
        const pan = idx % 2 === 0 ? 0.35 : -0.35;
        const f0 = idx % 2 === 0 ? 2900 : 1150;
        const f1 = idx % 2 === 0 ? 820 : 3200;
        this.triggerTone(f0, f1, 0.11, 'sine', 0.14, now + rt, 4500, pan);
      }
    }

    // 4. Close-Call Mortar / Flak Sub-Thumps
    for (const mt of [0.38, 0.88, 1.38]) {
      if (mt < durationSec - 0.15) {
        this.triggerTone(105, 32, 0.26, 'sine', 0.38, now + mt, 400);
        this.triggerNoiseBurst(0.18, 420, 0.24, now + mt, 0.9);
      }
    }

    // 5. Final Suspense Builder: Incoming Artillery Shell Scream (`whiiiiiiistle -> BOOM!`)
    const whistleDur = Math.min(0.62, durationSec * 0.36);
    const whistleStart = now + Math.max(0.1, durationSec - whistleDur);
    const osc = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc.type = this.eraMode === '1980s' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(1680, whistleStart);
    osc.frequency.exponentialRampToValueAtTime(310, whistleStart + whistleDur);

    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(1500, whistleStart);
    filt.frequency.exponentialRampToValueAtTime(420, whistleStart + whistleDur);
    filt.Q.value = 3.2;

    g.gain.setValueAtTime(0.005, whistleStart);
    g.gain.exponentialRampToValueAtTime(0.28, whistleStart + whistleDur * 0.92);
    g.gain.linearRampToValueAtTime(0.001, whistleStart + whistleDur);

    osc.connect(filt);
    filt.connect(g);
    g.connect(this.compressor);
    osc.start(whistleStart);
    osc.stop(whistleStart + whistleDur + 0.02);

    this.activeCleanupFns.push(() => {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
    });
  }

  /**
   * Act 3 (`2.80s – 4.45s`): Colossal High-Explosive Warfield Detonation + Shrapnel + Victory/Defeat Fanfare!
   */
  public playAct3Outcome(resolution: BattleResolutionKind): void {
    this.unlock();
    if (!this.ctx || !this.compressor || this.muted) return;
    const now = this.ctx.currentTime;

    if (resolution === 'MUTUAL_SPLIT') {
      // Twin Synchronized Bunker-Buster Double Detonation!
      this.triggerHeavyExplosion(now, -0.45, 1.05);
      this.triggerHeavyExplosion(now + 0.11, 0.45, 1.05);
    } else if (
      resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
      resolution === 'FLAG_CAPTURED_BY_ENEMY'
    ) {
      // Rolling 3-Shell Artillery Barrage!
      const pan = resolution === 'FLAG_CAPTURED_BY_PLAYER' ? 0.45 : -0.45;
      this.triggerHeavyExplosion(now, pan * 0.6, 0.95);
      this.triggerHeavyExplosion(now + 0.14, pan, 1.05);
      this.triggerHeavyExplosion(now + 0.28, pan * 0.8, 1.12);
    } else {
      const loserPan = resolution === 'PLAYER_WINS' ? 0.48 : -0.48;
      this.triggerHeavyExplosion(now, loserPan, 1.08);
    }

    // Post-blast musical verdict stinger rising out of the smoke (`+0.26s`)
    const fanStart = now + 0.26;
    if (resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      const notes = [261.63, 329.63, 392.0, 523.25, 659.25];
      notes.forEach((freq, i) => {
        this.triggerBrassOrSynthNote(freq, 0.42, 0.24, fanStart + i * 0.09);
      });
    } else if (resolution === 'PLAYER_WINS') {
      const notes = [261.63, 329.63, 392.0, 523.25];
      notes.forEach((freq, i) => {
        this.triggerBrassOrSynthNote(freq, 0.34, 0.22, fanStart + i * 0.075);
      });
    } else if (resolution === 'ENEMY_WINS' || resolution === 'FLAG_CAPTURED_BY_ENEMY') {
      this.triggerBrassOrSynthNote(174.61, 0.38, 0.22, fanStart);
      this.triggerBrassOrSynthNote(130.81, 0.62, 0.25, fanStart + 0.18);
    }
  }

  public stopActiveSequence(): void {
    while (this.activeCleanupFns.length > 0) {
      const fn = this.activeCleanupFns.pop();
      fn?.();
    }
  }

  private triggerGunshot(startTime: number, pan: number, pitchScale: number): void {
    if (!this.ctx || !this.compressor) return;
    // 1. Sharp supersonic crack
    this.triggerNoiseBurst(0.026, 2500 * pitchScale, 0.34, startTime, 1.2, pan);
    // 2. Mid-body gunshot bark
    this.triggerNoiseBurst(0.065, 780 * pitchScale, 0.26, startTime + 0.003, 0.85, pan);
    // 3. Punchy low-end propellant thump
    this.triggerTone(
      195 * pitchScale,
      48,
      0.055,
      'triangle',
      0.32,
      startTime,
      1400,
      pan
    );
  }

  private triggerHeavyExplosion(startTime: number, pan: number, intensity: number): void {
    if (!this.ctx || !this.compressor) return;

    // 1. Initial blinding shockwave snap (`0..40ms`)
    this.triggerNoiseBurst(0.05, 3200, 0.55 * intensity, startTime, 0.7, pan);

    // 2. Deep chest-thumping sub-bass detonation boom (`96Hz -> 22Hz`, `0.85s`)
    this.triggerTone(96, 22, 0.85, 'sine', 0.68 * intensity, startTime, 280, pan);
    this.triggerTone(142, 30, 0.48, 'sawtooth', 0.36 * intensity, startTime, 340, pan);

    // 3. Long rolling low-passed explosion roar & billowing debris tail (`1.25s`)
    const dur = 1.25;
    const sampleCount = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < sampleCount; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.06 * white) / 1.06; // warm brown/pink explosion rumble
      ch[i] = last * 3.2;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1450, startTime);
    lp.frequency.exponentialRampToValueAtTime(115, startTime + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.56 * intensity, startTime);
    g.gain.exponentialRampToValueAtTime(0.002, startTime + dur);

    this.connectWithPan(src, lp, g, pan);
    src.start(startTime);
    src.stop(startTime + dur + 0.02);

    // 4. Scattering metallic shrapnel pings (`+0.12s .. +0.55s`)
    for (let s = 0; s < 5; s++) {
      const st = startTime + 0.1 + s * 0.085;
      const sp = Math.max(-0.9, Math.min(0.9, pan + (s % 2 === 0 ? -0.35 : 0.35)));
      const freq = 1650 + ((s * 430) % 1400);
      this.triggerTone(freq, freq * 0.72, 0.045, 'triangle', 0.09 * intensity, st, 4200, sp);
    }
  }

  private triggerBrassOrSynthNote(
    freq: number,
    dur: number,
    gainPeak: number,
    startTime: number
  ): void {
    if (!this.ctx || !this.compressor) return;
    const wave: OscillatorType = this.eraMode === '1980s' ? 'sawtooth' : 'triangle';
    const cutoff = this.eraMode === '1980s' ? 2400 : 1500;
    this.triggerTone(freq * 0.996, freq, dur, wave, gainPeak, startTime, cutoff);
    this.triggerTone(freq * 1.004, freq * 1.002, dur, 'sine', gainPeak * 0.6, startTime);
  }

  private triggerTone(
    startFreq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    peakGain: number,
    startTime: number,
    lowpassHz = 3600,
    pan = 0
  ): void {
    if (!this.ctx || !this.compressor) return;
    const osc = this.ctx.createOscillator();
    const filt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, startFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + dur);

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(lowpassHz, startTime);

    g.gain.setValueAtTime(0.001, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.015, dur * 0.22));
    g.gain.exponentialRampToValueAtTime(0.0008, startTime + dur);

    this.connectWithPan(osc, filt, g, pan);

    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private triggerNoiseBurst(
    dur: number,
    bandFreq: number,
    peakGain: number,
    startTime: number,
    q = 1.6,
    pan = 0
  ): void {
    if (!this.ctx || !this.compressor) return;
    const sampleCount = Math.max(64, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      ch[i] = Math.random() * 2 - 1;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(bandFreq, startTime);
    filt.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peakGain, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

    this.connectWithPan(src, filt, g, pan);

    src.start(startTime);
    src.stop(startTime + dur + 0.01);
  }

  private connectWithPan(
    source: AudioNode,
    filter: AudioNode,
    gain: GainNode,
    pan: number
  ): void {
    if (!this.ctx || !this.compressor) return;
    source.connect(filter);
    filter.connect(gain);
    if (Math.abs(pan) > 0.01 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(this.compressor);
    } else {
      gain.connect(this.compressor);
    }
  }
}
