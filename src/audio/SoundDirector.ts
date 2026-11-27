import type { AudioEraMode, BattleResolutionKind } from '../core/types';

/**
 * Dual-Era Procedural WebAudio Synthesizer & Live CRT Waveform Driver (`SoundDirector.ts`).
 * - Default `'1980s'`: Electro-Mechanical Hybrid (weighted slate/brass foley + warm analog vacuum-tube
 *   dual oscillators, relay ticks, and high-voltage arc crackle).
 * - Optional `'1970s'`: Military Command Acoustics (tight snare press-rolls, resonant timpani, and brass stingers).
 * Both profiles route directly through a real-time `AnalyserNode` driving the Arbiter's curved CRT oscilloscope!
 */
export class SoundDirector {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timeDomainBuf: Float32Array<ArrayBuffer> | null = null;

  private muted = false;
  private eraMode: AudioEraMode = '1980s';
  private activeCleanupFns: Array<() => void> = [];

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.65;
      this.timeDomainBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

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
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.02);
    }
  }

  public setEraMode(mode: AudioEraMode): void {
    this.eraMode = mode;
  }

  /**
   * Copies real-time `AnalyserNode` time-domain samples into `out` (`-1..+1`).
   * Returns `true` if live audio signal is active, or `false` if silent/uninitialized.
   */
  public sampleLiveWaveform(out: Float32Array): boolean {
    if (!this.analyser || !this.timeDomainBuf || !this.ctx || this.ctx.state !== 'running' || this.muted) {
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
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.triggerTone(520, 780, 0.055, 'triangle', 0.14, now);
    this.triggerNoiseBurst(0.025, 1800, 0.08, now);
  }

  public playMoveSlide(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Soft resin-on-slate slide followed by crisp placement clack
    this.triggerNoiseBurst(0.09, 650, 0.09, now);
    this.triggerTone(195, 118, 0.075, 'sine', 0.22, now + 0.07);
    this.triggerNoiseBurst(0.03, 2100, 0.14, now + 0.07);
  }

  /**
   * Act 1 (`0.0s – 0.9s`): Heavy brass Attack Medallion thud + gunmetal shutter whir + twin pad slams & sparks!
   */
  public playAct1LockIn(speedScale = 1): void {
    this.unlock();
    this.stopActiveSequence();
    if (!this.ctx || !this.masterGain || this.muted) return;

    const inv = 1 / speedScale;
    const now = this.ctx.currentTime;

    // Brass Attack Medallion heavy metallic drop onto slate
    this.triggerTone(165, 82, 0.18 * inv, 'sine', 0.34, now + 0.04 * inv);
    this.triggerTone(1140, 1120, 0.22 * inv, 'triangle', 0.1, now + 0.04 * inv);

    // Motorized ribbed shutter retraction servo sweep
    this.triggerTone(140, 310, 0.32 * inv, 'sawtooth', 0.11, now + 0.12 * inv, 900);

    // Left (Player) & Right (Enemy) spring-pad slams + spark crackles
    for (const offset of [0.42 * inv, 0.54 * inv]) {
      this.triggerTone(145, 58, 0.14, 'triangle', 0.32, now + offset);
      this.triggerNoiseBurst(0.11, 3200, 0.22, now + offset);
      if (this.eraMode === '1980s') {
        this.triggerTone(980, 420, 0.09, 'square', 0.09, now + offset + 0.015, 2400);
      }
    }
  }

  /**
   * Act 2 (`0.9s – 2.7s`): Sustained arbitration tension driving the live CRT oscilloscope!
   */
  public playAct2Arbitrating(durationSec: number): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const end = now + durationSec;

    if (this.eraMode === '1980s') {
      // Warm 1980s dual-oscillator vacuum-tube sweep + LFO modulation + relay clicks + arc crackle
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      oscA.type = 'sawtooth';
      oscB.type = 'triangle';
      oscA.frequency.setValueAtTime(118, now);
      oscA.frequency.exponentialRampToValueAtTime(295, end);
      oscB.frequency.setValueAtTime(177, now);
      oscB.frequency.exponentialRampToValueAtTime(442, end);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(15, now);
      lfo.frequency.linearRampToValueAtTime(28, end);
      lfoGain.gain.value = 26;
      lfo.connect(lfoGain);
      lfoGain.connect(oscA.frequency);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(620, now);
      filter.frequency.exponentialRampToValueAtTime(1850, end);
      filter.Q.value = 2.4;

      env.gain.setValueAtTime(0.01, now);
      env.gain.linearRampToValueAtTime(0.24, now + 0.12);
      env.gain.setValueAtTime(0.26, Math.max(now + 0.14, end - 0.08));
      env.gain.linearRampToValueAtTime(0.001, end);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(env);
      env.connect(this.masterGain);

      oscA.start(now);
      oscB.start(now);
      lfo.start(now);
      oscA.stop(end + 0.02);
      oscB.stop(end + 0.02);
      lfo.stop(end + 0.02);

      // Electromagnetic relay clicks & high-voltage arc bursts
      const steps = Math.max(6, Math.floor(durationSec * 16));
      for (let i = 0; i < steps; i++) {
        const t = now + (i / steps) * durationSec;
        const pitch = 740 + ((i * 193) % 880);
        this.triggerTone(pitch, pitch * 0.85, 0.028, 'square', 0.075, t, 2200);
        if (i % 2 === 0) {
          this.triggerNoiseBurst(0.035, 2900, 0.11, t + 0.01);
        }
      }

      this.activeCleanupFns.push(() => {
        try {
          oscA.stop();
          oscB.stop();
          lfo.stop();
        } catch {
          // already stopped
        }
      });
    } else {
      // '1970s' Salpakan Military Command Profile: Crescendo snare press-roll + resonant timpani!
      const rollHits = Math.max(12, Math.floor(durationSec * 28));
      for (let i = 0; i < rollHits; i++) {
        const frac = i / rollHits;
        const t = now + frac * durationSec;
        const crescendo = 0.06 + frac * 0.18;
        this.triggerNoiseBurst(0.032, 1650 + frac * 700, crescendo, t);
        if (i % 7 === 0) {
          // Timpani strike
          const drumPitch = i % 14 === 0 ? 98 : 73.4;
          this.triggerTone(drumPitch * 1.18, drumPitch, 0.22, 'sine', 0.28, t);
        }
      }
    }
  }

  /**
   * Act 3 (`2.7s – 4.1s`): Victory elevation fanfare, Defeat capacitor drop, or Mutual Split overload!
   */
  public playAct3Outcome(resolution: BattleResolutionKind): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Mechanical trapdoor latch clack
    this.triggerNoiseBurst(0.055, 1400, 0.22, now + 0.06);
    this.triggerTone(130, 54, 0.16, 'triangle', 0.26, now + 0.08);

    if (resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      const notes = [261.63, 329.63, 392.0, 523.25, 659.25];
      notes.forEach((freq, i) => {
        this.triggerBrassOrSynthNote(freq, 0.36, 0.22, now + i * 0.09);
      });
    } else if (resolution === 'PLAYER_WINS') {
      const notes = [261.63, 329.63, 392.0, 523.25];
      notes.forEach((freq, i) => {
        this.triggerBrassOrSynthNote(freq, 0.28, 0.2, now + i * 0.075);
      });
    } else if (resolution === 'MUTUAL_SPLIT') {
      // Overload breaker flash + dual chute release
      this.triggerNoiseBurst(0.18, 2600, 0.3, now);
      this.triggerTone(440, 110, 0.32, 'sawtooth', 0.22, now, 1400);
      this.triggerTone(311.13, 77.78, 0.32, 'square', 0.16, now + 0.03, 1200);
    } else {
      // ENEMY_WINS or FLAG_CAPTURED_BY_ENEMY
      if (this.eraMode === '1980s') {
        this.triggerTone(310, 62, 0.52, 'sawtooth', 0.24, now, 900);
        this.triggerTone(233, 46, 0.52, 'triangle', 0.2, now + 0.04, 700);
      } else {
        this.triggerBrassOrSynthNote(196.0, 0.32, 0.22, now);
        this.triggerBrassOrSynthNote(138.59, 0.55, 0.24, now + 0.18);
      }
    }
  }

  public stopActiveSequence(): void {
    while (this.activeCleanupFns.length > 0) {
      const fn = this.activeCleanupFns.pop();
      fn?.();
    }
  }

  private triggerBrassOrSynthNote(
    freq: number,
    dur: number,
    gainPeak: number,
    startTime: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
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
    lowpassHz = 3600
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const filt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, startFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + dur);

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(lowpassHz, startTime);

    g.gain.setValueAtTime(0.001, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.018, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0008, startTime + dur);

    osc.connect(filt);
    filt.connect(g);
    g.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private triggerNoiseBurst(
    dur: number,
    bandFreq: number,
    peakGain: number,
    startTime: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
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
    filt.Q.value = 1.6;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peakGain, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

    src.connect(filt);
    filt.connect(g);
    g.connect(this.masterGain);

    src.start(startTime);
    src.stop(startTime + dur + 0.01);
  }
}
