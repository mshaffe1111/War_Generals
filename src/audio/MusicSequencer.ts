import type { AudioEraMode } from '../core/types';

export type MusicPhase = 'TITLE' | 'DEPLOY' | 'PLAY' | 'ARBITER' | 'VICTORY' | 'DEFEAT';

export interface MusicTelemetry {
  phase: MusicPhase;
  eraMode: AudioEraMode;
  tension: number;
  bpm: number;
  activeVoices: number;
  running: boolean;
  ducked: boolean;
  disposed: boolean;
}

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.12;
const MAX_ACTIVE_VOICES = 8;
const SEQUENCER_NOMINAL_GAIN = 0.62;

/**
 * Procedural Adaptive Background Score (`MusicSequencer.ts`).
 *
 * Uses a 25ms WebAudio lookahead scheduler (`0.12s` scheduling horizon) gated strictly on
 * `ctx.state === 'running' && !paused && !muted && !disposed`, snapping `nextNoteTime`
 * forward on resume/visibility wake to prevent note pileups.
 *
 * Dual-Era Idioms:
 * - `1980s`: Juno minor-9th pads, 2-op FM/piezo pulse bass, syncopated arpeggios, crisp electro hats.
 * - `1970s`: Formant-filtered dual-sawtooth French horns, pizzicato timpani, brushed military snare.
 * - Vertical Tension (`tension >= 0.75` in `PLAY`): +1 semitone modulation (`D minor -> Eb minor`).
 */
export class MusicSequencer {
  private readonly ctx: AudioContext;
  private readonly sequencerGain: GainNode;
  private readonly noiseBuffer: AudioBuffer;
  private readonly activeVoiceCleanups = new Set<() => void>();

  private phase: MusicPhase = 'TITLE';
  private eraMode: AudioEraMode = '1980s';
  private tension = 0.2;
  private muted = false;
  private arbiterDucked = false;
  private currentDucked = false;
  private paused = false;
  private running = false;
  private disposed = false;

  private schedulerTimer: number | null = null;
  private nextNoteTime = 0;
  private stepIndex = 0;
  private barIndex = 0;
  private victoryCycles = 0;

  private readonly onVisibilityChange: (() => void) | null = null;

  constructor(ctx: AudioContext, destMusicGain: AudioNode) {
    this.ctx = ctx;
    this.sequencerGain = ctx.createGain();
    this.sequencerGain.gain.value = SEQUENCER_NOMINAL_GAIN;
    this.sequencerGain.connect(destMusicGain);

    this.noiseBuffer = this.buildNoiseBuffer(ctx);

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.paused = Boolean(document.hidden);
      this.onVisibilityChange = () => {
        if (this.disposed) return;
        this.paused = Boolean(document.hidden);
        if (!this.paused && this.ctx.state === 'running') {
          this.nextNoteTime = this.ctx.currentTime + 0.05;
        }
      };
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  public start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    if (this.schedulerTimer === null && typeof window !== 'undefined') {
      this.schedulerTimer = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
    }
  }

  public setState(phase: MusicPhase, tension?: number, eraMode?: AudioEraMode): void {
    if (this.disposed) return;
    const prevPhase = this.phase;
    this.phase = phase;
    if (tension !== undefined && Number.isFinite(tension)) {
      this.tension = Math.max(0, Math.min(1, tension));
    }
    if (eraMode !== undefined) {
      this.eraMode = eraMode;
    }

    if (prevPhase !== phase) {
      this.stepIndex = 0;
      this.barIndex = 0;
      this.victoryCycles = 0;
      if (this.ctx.state === 'running') {
        this.nextNoteTime = Math.max(this.nextNoteTime, this.ctx.currentTime + 0.04);
      }
    }

    const shouldDuck = phase === 'ARBITER' || this.arbiterDucked;
    if (shouldDuck !== this.currentDucked) {
      this.applyDuckEnvelope(shouldDuck);
    }

    if (!this.running && phase !== 'ARBITER') {
      this.start();
    }
  }

  public setEraMode(eraMode: AudioEraMode): void {
    if (this.disposed) return;
    this.eraMode = eraMode;
  }

  public setTension(tension: number): void {
    if (this.disposed || !Number.isFinite(tension)) return;
    this.tension = Math.max(0, Math.min(1, tension));
  }

  public setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.muted = muted;
    if (muted) {
      this.stopActiveVoices();
    } else if (this.ctx.state === 'running') {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }
  }

  public setArbiterDuck(ducked: boolean): void {
    if (this.disposed) return;
    this.arbiterDucked = ducked;
    const shouldDuck = ducked || this.phase === 'ARBITER';
    if (shouldDuck !== this.currentDucked) {
      this.applyDuckEnvelope(shouldDuck);
    }
    if (!ducked && this.ctx.state === 'running') {
      this.nextNoteTime = Math.max(this.nextNoteTime, this.ctx.currentTime + 0.05);
    }
  }

  public notifyResumed(): void {
    if (this.disposed) return;
    if (this.ctx.state === 'running') {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }
    if (!this.running) {
      this.start();
    }
  }

  public stop(): void {
    if (this.disposed) return;
    this.running = false;
    if (this.schedulerTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.stopActiveVoices();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.arbiterDucked = false;
    this.currentDucked = false;

    if (this.schedulerTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }

    this.stopActiveVoices();
    try {
      this.sequencerGain.disconnect();
    } catch {
      // already disconnected
    }
  }

  public getTelemetry(): MusicTelemetry {
    return {
      phase: this.phase,
      eraMode: this.eraMode,
      tension: this.tension,
      bpm: Math.round(this.computeBpm()),
      activeVoices: this.activeVoiceCleanups.size,
      running: this.running,
      ducked: this.arbiterDucked || this.phase === 'ARBITER',
      disposed: this.disposed,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal Lookahead Scheduler
  // ---------------------------------------------------------------------------

  private applyDuckEnvelope(duck: boolean): void {
    this.currentDucked = duck;
    const now = this.ctx.currentTime;
    const g = this.sequencerGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0008, g.value), now);
    if (duck) {
      g.linearRampToValueAtTime(0.0008, now + 0.06);
    } else {
      g.linearRampToValueAtTime(SEQUENCER_NOMINAL_GAIN, now + 0.45);
    }
  }

  private computeBpm(): number {
    switch (this.phase) {
      case 'TITLE':
        return this.eraMode === '1980s' ? 84 : 76;
      case 'DEPLOY':
        return this.eraMode === '1980s' ? 96 : 92;
      case 'PLAY':
        return this.eraMode === '1980s'
          ? 98 + this.tension * 34
          : 90 + this.tension * 30;
      case 'VICTORY':
        return this.eraMode === '1980s' ? 112 : 108;
      case 'DEFEAT':
        return this.eraMode === '1980s' ? 66 : 62;
      case 'ARBITER':
        return 112;
    }
  }

  private tick(): void {
    if (
      this.disposed ||
      !this.running ||
      this.paused ||
      this.muted ||
      this.arbiterDucked ||
      this.phase === 'ARBITER' ||
      this.ctx.state !== 'running'
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    // Prevent note pileups if thread stalled or tab woke from background
    if (this.nextNoteTime < now - 0.05) {
      this.nextNoteTime = now + 0.04;
    }

    const bpm = this.computeBpm();
    const sixteenthDur = 60 / bpm / 4;

    let guard = 0;
    while (this.nextNoteTime < now + SCHEDULE_AHEAD_SEC && guard < 6) {
      this.scheduleStep(this.stepIndex, this.barIndex, this.nextNoteTime, sixteenthDur);
      this.nextNoteTime += sixteenthDur;
      this.stepIndex = (this.stepIndex + 1) % 16;
      if (this.stepIndex === 0) {
        this.barIndex = (this.barIndex + 1) % 16;
        if (this.phase === 'VICTORY' || this.phase === 'DEFEAT') {
          this.victoryCycles += 1;
        }
      }
      guard += 1;
    }
  }

  private scheduleStep(step: number, bar: number, time: number, stepDur: number): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;

    // Millionaire-inspired +1 semitone modulation when PLAY tension >= 0.75
    const semitoneMul = this.phase === 'PLAY' && this.tension >= 0.75 ? Math.pow(2, 1 / 12) : 1.0;

    if (this.eraMode === '1980s') {
      this.schedule1980sStep(step, bar, time, stepDur, semitoneMul);
    } else {
      this.schedule1970sStep(step, bar, time, stepDur, semitoneMul);
    }
  }

  // ---------------------------------------------------------------------------
  // 1980s Electronic Score (Juno Pad + 2-Op FM Bass/Arp + Electro Percussion)
  // ---------------------------------------------------------------------------

  private schedule1980sStep(
    step: number,
    bar: number,
    time: number,
    stepDur: number,
    semi: number
  ): void {
    if (this.phase === 'TITLE') {
      // Juno minor-9th pad every 2 bars on step 0
      if (step === 0 && bar % 2 === 0) {
        const barDur = stepDur * 30;
        const padNotes = [146.83, 220.0, 329.63, 349.23]; // Dm9
        for (const f of padNotes) {
          this.spawnJunoPadVoice(f, barDur, 0.052, time);
        }
      }
      // Subtle FM radar ping on offbeat 8ths
      if (step === 6 || step === 14) {
        const pingHz = bar % 2 === 0 ? 440.0 : 523.25;
        this.spawnFmVoice(pingHz, stepDur * 1.9, 0.038, time, 1.4, -0.25 + (step === 14 ? 0.5 : 0));
      }
      return;
    }

    if (this.phase === 'DEPLOY') {
      // Muted 16th FM pulse bass
      const bassLine = [73.42, 73.42, 55.0, 73.42, 87.31, 73.42, 82.41, 55.0];
      if (step % 2 === 0) {
        const f = bassLine[(step / 2) % bassLine.length]!;
        this.spawnPulseBass(f, stepDur * 1.4, 0.11, time, 520);
      }
      // Crisp electro hat ticks on offbeat 16ths
      if (step % 4 === 2) {
        this.spawnElectroHat(time, 0.032, 7400);
      }
      // Sparse FM bell cues
      if (step === 0 || step === 10) {
        const bellNotes = [293.66, 349.23, 440.0, 523.25];
        const bellHz = bellNotes[(bar + (step === 10 ? 2 : 0)) % bellNotes.length]!;
        this.spawnFmVoice(bellHz, stepDur * 2.2, 0.048, time, 1.8, step === 0 ? -0.3 : 0.3);
      }
      return;
    }

    if (this.phase === 'PLAY') {
      // Syncopated pulse bass (D2 -> F2 -> G2 -> A2 / Bb2)
      const bassPattern = [
        73.42, 0, 73.42, 87.31,
        98.0, 0, 110.0, 73.42,
        116.54, 0, 110.0, 87.31,
        73.42, 0, 65.41, 55.0,
      ];
      const bassHz = bassPattern[step]!;
      if (bassHz > 0) {
        this.spawnPulseBass(
          bassHz * semi,
          stepDur * (this.tension > 0.6 ? 1.15 : 1.45),
          0.11 + this.tension * 0.04,
          time,
          560 + this.tension * 420
        );
      }

      // Crisp hi-hats
      if (step % 2 === 1 && (step % 4 === 3 || this.tension >= 0.45)) {
        this.spawnElectroHat(time, 0.025 + this.tension * 0.022, 7600);
      }

      // Syncopated 2-op FM arpeggio when tension >= 0.35
      if (this.tension >= 0.35 && (step % 2 === 0 || this.tension >= 0.7)) {
        const arp = [293.66, 349.23, 440.0, 466.16, 587.33, 440.0, 349.23, 329.63];
        const f = arp[(step + bar) % arp.length]! * semi;
        const pan = (step % 2 === 0 ? -1 : 1) * 0.32;
        this.spawnFmVoice(f, stepDur * 1.1, 0.045 + this.tension * 0.035, time, 1.6, pan);
      }

      // Tritone high-tension DEFCON sonar pulse above 0.75
      if (this.tension >= 0.75 && (step === 0 || step === 8)) {
        const tritone = step === 0 ? 466.16 : 622.25; // Bb4 / Eb5 tension
        this.spawnFmVoice(tritone, stepDur * 2.1, 0.05, time, 2.2, step === 0 ? -0.4 : 0.4);
      }
      return;
    }

    if (this.phase === 'VICTORY') {
      const fade = this.victoryCycles >= 2 ? 0.48 : 1.0;
      const roots = [146.83, 196.0, 220.0, 146.83]; // D - G - A - D
      const root = roots[bar % roots.length]!;
      if (step === 0 || step === 6 || step === 12) {
        this.spawnFmVoice(root * 2, stepDur * 3.5, 0.075 * fade, time, 1.5, -0.2);
        this.spawnFmVoice(root * 3, stepDur * 3.2, 0.055 * fade, time, 1.2, 0.2);
      }
      if (step % 2 === 0) {
        const arp = [root * 2, root * 2.5, root * 3, root * 4];
        this.spawnFmVoice(arp[(step / 2) % arp.length]!, stepDur * 1.3, 0.045 * fade, time, 1.1, 0);
      }
      return;
    }

    // DEFEAT: Slow Dm -> Bb -> Gm -> A7sus4 analog lament
    const fade = this.victoryCycles >= 2 ? 0.55 : 1.0;
    const prog = [
      [146.83, 220.0, 261.63],
      [116.54, 174.61, 233.08],
      [98.0, 146.83, 196.0],
      [110.0, 164.81, 220.0],
    ];
    if (step === 0) {
      const chord = prog[bar % prog.length]!;
      for (const f of chord) {
        this.spawnJunoPadVoice(f, stepDur * 14, 0.048 * fade, time);
      }
      this.spawnPulseBass(chord[0]! * 0.5, stepDur * 12, 0.085 * fade, time, 280);
    }
  }

  // ---------------------------------------------------------------------------
  // 1970s Classic Score (Formant Brass + Pizzicato Timpani + Brushed Snare)
  // ---------------------------------------------------------------------------

  private schedule1970sStep(
    step: number,
    bar: number,
    time: number,
    stepDur: number,
    semi: number
  ): void {
    if (this.phase === 'TITLE') {
      // Deep French-horn pedal every 2 bars
      if (step === 0 && bar % 2 === 0) {
        this.spawnFormantHornVoice(73.42, stepDur * 28, 0.065, time, -0.18); // D2
        this.spawnFormantHornVoice(110.0, stepDur * 28, 0.055, time, 0.18); // A2
      }
      // Muffled timpani heartbeat on beats 1 and 3
      if (step === 0 || step === 8) {
        this.spawnTimpaniVoice(step === 0 ? 73.42 : 55.0, 0.28, 0.095, time);
      }
      return;
    }

    if (this.phase === 'DEPLOY') {
      // Brushed military snare cadence (1 e & a 2 & 3 & 4 e &)
      if (step === 0 || step === 4 || step === 6 || step === 8 || step === 12 || step === 14 || step === 15) {
        const accent = step === 0 || step === 8 ? 0.075 : 0.042;
        this.spawnBrushedSnare(time, accent, step === 15 ? -0.15 : 0.15);
      }
      // Pizzicato timpani bass
      if (step === 0 || step === 8 || step === 12) {
        const notes = [73.42, 55.0, 87.31, 82.41];
        this.spawnTimpaniVoice(notes[(bar + (step === 8 ? 1 : 0)) % notes.length]!, 0.22, 0.11, time);
      }
      if (step === 0 && bar % 2 === 0) {
        this.spawnFormantHornVoice(146.83, stepDur * 10, 0.052, time, -0.2);
        this.spawnFormantHornVoice(220.0, stepDur * 10, 0.045, time, 0.2);
      }
      return;
    }

    if (this.phase === 'PLAY') {
      // Military snare ostinato scaled with tension
      const hitSnare =
        step === 0 ||
        step === 4 ||
        step === 8 ||
        step === 12 ||
        (this.tension >= 0.35 && (step === 6 || step === 14)) ||
        (this.tension >= 0.65 && (step === 3 || step === 11 || step === 15));
      if (hitSnare) {
        const accent = step === 0 || step === 8 ? 0.085 : 0.045 + this.tension * 0.03;
        this.spawnBrushedSnare(time, accent, step % 2 === 0 ? -0.14 : 0.14);
      }

      // Timpani downbeats
      if (step === 0 || step === 6 || (this.tension >= 0.5 && step === 10)) {
        const f = (step === 0 ? 73.42 : step === 6 ? 55.0 : 87.31) * semi;
        this.spawnTimpaniVoice(f, 0.24, 0.11 + this.tension * 0.04, time);
      }

      // Formant brass stabs when tension >= 0.4
      if (this.tension >= 0.4 && (step === 0 || (this.tension >= 0.7 && step === 10))) {
        const stabA = 146.83 * semi;
        const stabB = (this.tension >= 0.75 ? 207.65 : 220.0) * semi; // Diminished/tritone vs fifth
        this.spawnFormantHornVoice(stabA, stepDur * 3.5, 0.062, time, -0.22);
        this.spawnFormantHornVoice(stabB, stepDur * 3.5, 0.052, time, 0.22);
      }
      return;
    }

    if (this.phase === 'VICTORY') {
      const fade = this.victoryCycles >= 2 ? 0.48 : 1.0;
      const roots = [146.83, 196.0, 220.0, 146.83];
      const root = roots[bar % roots.length]!;
      if (step === 0 || step === 8) {
        this.spawnFormantHornVoice(root, stepDur * 6, 0.068 * fade, time, -0.22);
        this.spawnFormantHornVoice(root * 1.5, stepDur * 6, 0.056 * fade, time, 0.22);
        this.spawnTimpaniVoice(root * 0.5, 0.28, 0.11 * fade, time);
      }
      if (step === 0 || step === 4 || step === 6 || step === 8 || step === 12 || step === 14) {
        this.spawnBrushedSnare(time, 0.058 * fade, 0);
      }
      return;
    }

    // DEFEAT: Solo muted horn elegy
    const fade = this.victoryCycles >= 2 ? 0.55 : 1.0;
    const elegy = [146.83, 130.81, 116.54, 110.0]; // D3 -> C3 -> Bb2 -> A2
    if (step === 0) {
      this.spawnFormantHornVoice(elegy[bar % elegy.length]!, stepDur * 13, 0.068 * fade, time, 0);
      this.spawnTimpaniVoice(55.0, 0.36, 0.075 * fade, time);
    }
  }

  // ---------------------------------------------------------------------------
  // Voice Builders (Voice-Capped & Self-Disconnecting via `onended`)
  // ---------------------------------------------------------------------------

  private registerVoice(
    source: AudioScheduledSourceNode,
    gainNode: GainNode,
    extraNodes: AudioNode[],
    pairedSources: AudioScheduledSourceNode[] = []
  ): void {
    let cleaned = false;
    const disconnectAll = () => {
      try {
        source.disconnect();
      } catch {
        // ignore
      }
      for (const ps of pairedSources) {
        try {
          ps.disconnect();
        } catch {
          // ignore
        }
      }
      try {
        gainNode.disconnect();
      } catch {
        // ignore
      }
      for (const n of extraNodes) {
        try {
          n.disconnect();
        } catch {
          // ignore
        }
      }
    };

    const forceStop = () => {
      if (cleaned) return;
      cleaned = true;
      this.activeVoiceCleanups.delete(forceStop);
      const now = this.ctx.currentTime;
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(Math.max(0.0001, gainNode.gain.value), now);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.008);
      } catch {
        // ignore
      }
      try {
        source.stop(now + 0.01);
      } catch {
        // already stopped
      }
      for (const ps of pairedSources) {
        try {
          ps.stop(now + 0.01);
        } catch {
          // already stopped
        }
      }
      if (typeof window !== 'undefined') {
        window.setTimeout(disconnectAll, 20);
      } else {
        disconnectAll();
      }
    };

    this.activeVoiceCleanups.add(forceStop);
    source.onended = () => {
      if (cleaned) return;
      cleaned = true;
      this.activeVoiceCleanups.delete(forceStop);
      disconnectAll();
    };
  }

  private stopActiveVoices(): void {
    const fns = Array.from(this.activeVoiceCleanups);
    for (const fn of fns) {
      fn();
    }
    this.activeVoiceCleanups.clear();
  }

  private connectOutput(node: AudioNode, pan: number): AudioNode[] {
    if (Math.abs(pan) > 0.02 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      panner.connect(this.sequencerGain);
      return [panner];
    }
    node.connect(this.sequencerGain);
    return [];
  }

  private spawnJunoPadVoice(freq: number, dur: number, peakGain: number, startTime: number): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * (0.996 + Math.random() * 0.008), startTime);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(680, startTime);
    lp.frequency.linearRampToValueAtTime(1350, startTime + dur * 0.45);
    lp.frequency.linearRampToValueAtTime(720, startTime + dur);
    lp.Q.value = 1.2;

    g.gain.setValueAtTime(0.0005, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.28, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0005, startTime + dur);

    osc.connect(lp);
    lp.connect(g);
    const extras = this.connectOutput(g, 0);
    extras.push(lp);

    this.registerVoice(osc, g, extras);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private spawnFmVoice(
    freq: number,
    dur: number,
    peakGain: number,
    startTime: number,
    modRatio: number,
    pan: number
  ): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, startTime);

    mod.type = 'sine';
    mod.frequency.setValueAtTime(freq * modRatio, startTime);
    modGain.gain.setValueAtTime(freq * 1.4, startTime);
    modGain.gain.exponentialRampToValueAtTime(Math.max(4, freq * 0.2), startTime + dur * 0.75);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2800, startTime);

    g.gain.setValueAtTime(0.0005, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, startTime + dur);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(lp);
    lp.connect(g);
    const extras = this.connectOutput(g, pan);
    extras.push(lp, modGain);

    this.registerVoice(carrier, g, extras, [mod]);
    carrier.start(startTime);
    mod.start(startTime);
    carrier.stop(startTime + dur + 0.02);
    mod.stop(startTime + dur + 0.02);
  }

  private spawnPulseBass(
    freq: number,
    dur: number,
    peakGain: number,
    startTime: number,
    cutoffHz: number
  ): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, startTime);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoffHz, startTime);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, cutoffHz * 0.45), startTime + dur);
    lp.Q.value = 2.2;

    g.gain.setValueAtTime(0.0006, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0006, startTime + dur);

    osc.connect(lp);
    lp.connect(g);
    const extras = this.connectOutput(g, 0);
    extras.push(lp);

    this.registerVoice(osc, g, extras);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private spawnElectroHat(startTime: number, peakGain: number, hpfHz: number): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(hpfHz, startTime);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peakGain, startTime);
    g.gain.exponentialRampToValueAtTime(0.0005, startTime + 0.038);

    src.connect(hpf);
    hpf.connect(g);
    const extras = this.connectOutput(g, 0.25);
    extras.push(hpf);

    this.registerVoice(src, g, extras);
    src.start(startTime, Math.random() * 0.6, 0.045);
  }

  private spawnFormantHornVoice(
    freq: number,
    dur: number,
    peakGain: number,
    startTime: number,
    pan: number
  ): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const formant = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = 'sawtooth';
    // Subtle lip-scoop intonation into pitch
    osc.frequency.setValueAtTime(freq * 0.988, startTime);
    osc.frequency.linearRampToValueAtTime(freq, startTime + Math.min(0.035, dur * 0.2));

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(380, startTime);
    lp.frequency.exponentialRampToValueAtTime(1450, startTime + Math.min(0.08, dur * 0.35));
    lp.Q.value = 1.1;

    formant.type = 'peaking';
    formant.frequency.setValueAtTime(760, startTime);
    formant.Q.value = 2.4;
    formant.gain.value = 4.2;

    g.gain.setValueAtTime(0.0005, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.055, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0005, startTime + dur);

    osc.connect(lp);
    lp.connect(formant);
    formant.connect(g);
    const extras = this.connectOutput(g, pan);
    extras.push(lp, formant);

    this.registerVoice(osc, g, extras);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private spawnTimpaniVoice(
    freq: number,
    dur: number,
    peakGain: number,
    startTime: number
  ): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.09, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, freq), startTime + Math.min(0.11, dur * 0.45));

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(280, startTime);

    g.gain.setValueAtTime(0.0005, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, startTime + dur);

    osc.connect(lp);
    lp.connect(g);
    const extras = this.connectOutput(g, 0);
    extras.push(lp);

    this.registerVoice(osc, g, extras);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private spawnBrushedSnare(startTime: number, peakGain: number, pan: number): void {
    if (this.activeVoiceCleanups.size >= MAX_ACTIVE_VOICES) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2350, startTime);
    bp.Q.value = 1.4;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peakGain, startTime);
    g.gain.exponentialRampToValueAtTime(0.0005, startTime + 0.055);

    src.connect(bp);
    bp.connect(g);
    const extras = this.connectOutput(g, pan);
    extras.push(bp);

    this.registerVoice(src, g, extras);
    src.start(startTime, Math.random() * 0.6, 0.065);
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }
}
