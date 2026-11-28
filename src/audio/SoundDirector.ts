import { MusicSequencer, type MusicPhase, type MusicTelemetry } from './MusicSequencer';
import type {
  AppOptions,
  ArbiterVerdict,
  AudioEraMode,
  BattleChoreographyKind,
  BattleResolutionKind,
  ClashPublicStakes,
  MatchPhase,
  TheaterId,
} from '../core/types';

export interface AudioDirectorTelemetry {
  eraMode: AudioEraMode;
  theaterId: TheaterId;
  musicPhase: MusicPhase;
  tension: number;
  inVacuum: boolean;
  activeSequenceNodes: number;
  disposed: boolean;
  music: MusicTelemetry | null;
}

/**
 * AAA Dual-Era WebAudio Synthesizer, Adaptive Score & Headroom-Protected Mastering Engine (`SoundDirector.ts`).
 *
 * Signal Graph (Zero external MP3/OGG 404s, zero `heartbeatBypassBus` double-summing, zero clipping):
 *   ├── `musicGain` (`MusicSequencer` + battle fanfare/brass/snare/timpani) ─┐
 *   ├── `sfxGain` (Dual-era Bakelite/Walnut foley + 6 battle choreographies) ─┼─► `arbiterBattleBus` ─► `vacuumDuckBus`
 *   └── `ambianceGain` (4-Theater LFO wind/hull/bunker/radar + watch + rain) ─────────────────────────┘         │
 *                                                                         ┌───────────────────────────────────┘
 *   `vacuumDuckBus` ──► `preMasterSum` (dry) + `reverbSend(0.26)` ──► `convolver(normalize=false)` ──► `reverbReturnGain` ──► `preMasterSum`
 *   `heartbeatBypassBus` ───────────────────────────────────────────────────────────────────────────────────────────────► `preMasterSum`
 *
 *   [Isolated Sidechain Tap] `arbiterBattleBus` + `heartbeatBypassBus` ─► `arbiterAnalyser(512)` ─► `analyserSink(0)` ─► `dest`
 *
 *   `preMasterSum` ─► `subsonicHPF(28Hz)` ─► `subShelf(62Hz, +2.2dB)` ─► `glueComp(3:1)`
 *                  ─► `preClipGain(0.25)` ─► `softClipShaper(K=4.0, a=0.96)` ─► `brickwallLimiter(-1dB)` ─► `masterGain` ─► `dest`
 */
export class SoundDirector {
  private ctx: AudioContext | null = null;

  // Core 6 GainNodes (created first in `unlock()` to preserve WebAudio spy bus ordering)
  private reverbSend: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambianceGain: GainNode | null = null;
  private arbiterBattleBus: GainNode | null = null;

  // Secondary routing, mastering & sidechain nodes (created after the first 6 GainNodes)
  private vacuumDuckBus: GainNode | null = null;
  private heartbeatBypassBus: GainNode | null = null;
  private preMasterSum: GainNode | null = null;
  private reverbReturnGain: GainNode | null = null;
  private preClipGain: GainNode | null = null;
  private analyserSink: GainNode | null = null;

  private arbiterAnalyser: AnalyserNode | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbImpulseBuffer: AudioBuffer | null = null;
  private subsonicHPF: BiquadFilterNode | null = null;
  private subShelf: BiquadFilterNode | null = null;
  private glueComp: DynamicsCompressorNode | null = null;
  private saturator: WaveShaperNode | null = null;
  private brickwallLimiter: DynamicsCompressorNode | null = null;

  // Adaptive score & continuous theater ambiance nodes
  private musicSequencer: MusicSequencer | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windLfo: OscillatorNode | null = null;
  private windLfoDepth: GainNode | null = null;
  private windGain: GainNode | null = null;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private ambianceContinuousNodes: AudioNode[] = [];
  private ambianceContinuousSources: AudioScheduledSourceNode[] = [];

  private whiteNoiseCache: AudioBuffer | null = null;
  private pinkBrownCache: AudioBuffer | null = null;

  private muted = false;
  private masterVol = 0.9;
  private musicVol = 0.85;
  private sfxVol = 0.95;
  private ambianceVol = 0.75;
  private hapticsEnabled = true;
  private eraMode: AudioEraMode = '1980s';
  private theaterId: TheaterId = 'FIELD_HQ';

  private musicPhase: MusicPhase = 'TITLE';
  private musicTension = 0.2;
  private baseMusicTension = 0.2;

  private ambienceStarted = false;
  private inBattleVacuum = false;
  private turnWarningUrgent = false;
  private disposed = false;
  private ambienceTimer: number | null = null;
  private watchHalfSecTick = 0;
  private ambiancePulseTick = 0;

  // Monotonic sequence cancellation token & full node/timer cleanup registry
  private activeSeqToken = 0;
  private readonly activeCleanupFns = new Set<() => void>();

  // Coordination guard when `playClashChoreography` & `playAct1LockIn`..`playAct3Outcome` are invoked together
  private activeChoreography: BattleChoreographyKind = 'INFANTRY';
  private activeVerdict: ArbiterVerdict | null = null;
  private lastChoreographyMs = -1;
  private choreographyAutoTimers: Array<() => void> = [];
  private actExecutedForSeq = {
    act1: false,
    act2A: false,
    act2B: false,
    act3: false,
  };

  public unlock(): void {
    if (this.disposed) return;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // FIRST 6 GAIN NODES CREATED IN `unlock()` (exact order required by `installWebAudioSpy` audits):
      // 1. `reverbSend`
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.26;

      // 2. `masterGain`
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.masterVol * 0.92;

      // 3. `musicGain`
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = this.musicVol * 0.64;

      // 4. `sfxGain`
      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = this.sfxVol * 0.72;

      // 5. `ambianceGain`
      this.ambianceGain = ctx.createGain();
      this.ambianceGain.gain.value = this.ambianceVol * 0.24;

      // 6. `arbiterBattleBus`
      this.arbiterBattleBus = ctx.createGain();
      this.arbiterBattleBus.gain.value = 1.0;

      // Secondary internal GainNodes (created strictly AFTER the first 6!)
      this.vacuumDuckBus = ctx.createGain();
      this.vacuumDuckBus.gain.value = 1.0;

      this.heartbeatBypassBus = ctx.createGain();
      this.heartbeatBypassBus.gain.value = 1.0;

      this.preMasterSum = ctx.createGain();
      this.preMasterSum.gain.value = 1.0;

      this.reverbReturnGain = ctx.createGain();
      this.reverbReturnGain.gain.value = 1.0;

      this.preClipGain = ctx.createGain();
      this.preClipGain.gain.value = 0.25; // 1 / K where K = 4.0

      this.analyserSink = ctx.createGain();
      this.analyserSink.gain.value = 0.0;

      // AnalyserNode (`fftSize = 512`) on isolated silent-sink sidechain
      this.arbiterAnalyser = ctx.createAnalyser();
      this.arbiterAnalyser.fftSize = 512;
      this.arbiterAnalyser.smoothingTimeConstant = 0.58;

      // Procedural Stereo Convolution Reverb (`normalize = false` BEFORE assigning buffer!)
      this.reverbImpulseBuffer = this.buildWarmWarRoomImpulse(ctx, 2.05);
      this.convolver = ctx.createConvolver();
      this.convolver.normalize = false;
      this.convolver.buffer = this.reverbImpulseBuffer;

      // Mastering Chain: HPF -> SubShelf -> GlueComp -> PreClip -> SoftClipper -> BrickwallLimiter -> MasterGain
      this.subsonicHPF = ctx.createBiquadFilter();
      this.subsonicHPF.type = 'highpass';
      this.subsonicHPF.frequency.value = 28;
      this.subsonicHPF.Q.value = 0.7;

      this.subShelf = ctx.createBiquadFilter();
      this.subShelf.type = 'lowshelf';
      this.subShelf.frequency.value = 62;
      this.subShelf.gain.value = 2.2;

      this.glueComp = ctx.createDynamicsCompressor();
      this.glueComp.threshold.value = -14;
      this.glueComp.knee.value = 12;
      this.glueComp.ratio.value = 3.0;
      this.glueComp.attack.value = 0.012;
      this.glueComp.release.value = 0.22;

      this.saturator = ctx.createWaveShaper();
      this.saturator.curve = this.buildSoftClipCurve(4.0, 0.96);
      this.saturator.oversample = '2x';

      this.brickwallLimiter = ctx.createDynamicsCompressor();
      this.brickwallLimiter.threshold.value = -1.0;
      this.brickwallLimiter.knee.value = 0;
      this.brickwallLimiter.ratio.value = 20.0;
      this.brickwallLimiter.attack.value = 0.001;
      this.brickwallLimiter.release.value = 0.08;

      // Connect Signal Graph
      this.musicGain.connect(this.arbiterBattleBus);
      this.sfxGain.connect(this.arbiterBattleBus);

      this.arbiterBattleBus.connect(this.vacuumDuckBus);
      this.ambianceGain.connect(this.vacuumDuckBus);

      this.vacuumDuckBus.connect(this.preMasterSum);
      this.vacuumDuckBus.connect(this.reverbSend);
      this.reverbSend.connect(this.convolver);
      this.convolver.connect(this.reverbReturnGain);
      this.reverbReturnGain.connect(this.preMasterSum);

      // Single clean path for `heartbeatBypassBus` (no double-sum through `vacuumDuckBus`!)
      this.heartbeatBypassBus.connect(this.preMasterSum);

      // Isolated sidechain analyser tap (keeps Chromium/WebKit AnalyserNode live at 0 audio output)
      this.arbiterBattleBus.connect(this.arbiterAnalyser);
      this.heartbeatBypassBus.connect(this.arbiterAnalyser);
      this.arbiterAnalyser.connect(this.analyserSink);
      this.analyserSink.connect(ctx.destination);

      // Mastering pipeline
      this.preMasterSum.connect(this.subsonicHPF);
      this.subsonicHPF.connect(this.subShelf);
      this.subShelf.connect(this.glueComp);
      this.glueComp.connect(this.preClipGain);
      this.preClipGain.connect(this.saturator);
      this.saturator.connect(this.brickwallLimiter);
      this.brickwallLimiter.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      this.buildCachedNoiseBuffers(ctx);
      this.startWarRoomAmbience(ctx);
      this.applyTheaterParameters(this.theaterId);

      // Initialize Adaptive MusicSequencer routed into `musicGain`
      this.musicSequencer = new MusicSequencer(ctx, this.musicGain);
      this.musicSequencer.setMuted(this.muted);
      this.musicSequencer.setState(this.musicPhase, this.musicTension, this.eraMode);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx
        .resume()
        .then(() => {
          if (!this.disposed) {
            this.musicSequencer?.notifyResumed();
          }
        })
        .catch(() => {
          // Graceful no-op when AudioContext resume is blocked or running under OfflineAudioContext
        });
    } else if (this.ctx.state === 'running') {
      this.musicSequencer?.notifyResumed();
    }
  }

  /**
   * Synchronizes all 4 independent mixer buses (`Master`, `Music`, `SFX`, `Ambiance`), Era Mode, Haptics & optional Theater.
   */
  public syncOptions(
    opts: Pick<
      AppOptions,
      | 'audioMuted'
      | 'masterVolume'
      | 'musicVolume'
      | 'sfxVolume'
      | 'ambianceVolume'
      | 'hapticsEnabled'
      | 'eraMode'
    > & { theaterId?: TheaterId }
  ): void {
    if (this.disposed) return;

    this.muted = opts.audioMuted;
    this.masterVol = opts.masterVolume;
    this.musicVol = opts.musicVolume;
    this.sfxVol = opts.sfxVolume;
    this.ambianceVol = opts.ambianceVolume;
    this.hapticsEnabled = opts.hapticsEnabled;
    this.eraMode = opts.eraMode;

    this.musicSequencer?.setEraMode(opts.eraMode);
    this.musicSequencer?.setMuted(opts.audioMuted);

    if (opts.theaterId && opts.theaterId !== this.theaterId) {
      this.setTheaterAmbiance(opts.theaterId);
    }

    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain?.gain.setTargetAtTime(this.muted ? 0 : this.masterVol * 0.92, t, 0.012);
    this.musicGain?.gain.setTargetAtTime(this.musicVol * 0.64, t, 0.025);
    this.sfxGain?.gain.setTargetAtTime(this.sfxVol * 0.72, t, 0.025);
    this.ambianceGain?.gain.setTargetAtTime(this.ambianceVol * 0.24, t, 0.035);
  }

  public setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.muted = muted;
    this.musicSequencer?.setMuted(muted);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.masterVol * 0.92, this.ctx.currentTime, 0.012);
    }
  }

  public setEraMode(mode: AudioEraMode): void {
    if (this.disposed) return;
    this.eraMode = mode;
    this.musicSequencer?.setEraMode(mode);
  }

  public setTheaterAmbiance(theaterId: TheaterId): void {
    if (this.disposed) return;
    this.theaterId = theaterId;
    if (this.ctx) {
      this.applyTheaterParameters(theaterId);
    }
  }

  public setMusicContext(ctx: {
    phase?: MusicPhase;
    tension?: number;
    eraMode?: AudioEraMode;
  }): void {
    if (this.disposed) return;
    if (ctx.phase !== undefined) this.musicPhase = ctx.phase;
    if (ctx.tension !== undefined && Number.isFinite(ctx.tension)) {
      this.baseMusicTension = Math.max(0, Math.min(1, ctx.tension));
    }
    this.musicTension =
      this.musicPhase === 'PLAY' && this.turnWarningUrgent
        ? Math.max(this.baseMusicTension, 0.82)
        : this.baseMusicTension;
    if (ctx.eraMode !== undefined) this.eraMode = ctx.eraMode;
    this.musicSequencer?.setState(this.musicPhase, this.musicTension, this.eraMode);
  }

  public setPhase(phase: MatchPhase | 'ARBITER'): void {
    if (this.disposed) return;
    let mapped: MusicPhase;
    switch (phase) {
      case 'DEPLOY':
      case 'ARMORY':
        mapped = 'DEPLOY';
        break;
      case 'PLAY':
        mapped = 'PLAY';
        break;
      case 'ARBITER':
        mapped = 'ARBITER';
        break;
      case 'GAME_OVER':
        mapped = this.musicPhase === 'VICTORY' || this.musicPhase === 'DEFEAT' ? this.musicPhase : 'DEFEAT';
        break;
      case 'TITLE':
      case 'REPLAY':
      case 'FIELD_MANUAL':
      default:
        mapped = 'TITLE';
        break;
    }
    this.setMusicContext({ phase: mapped });
  }

  public playPhaseTransition(phase: MatchPhase): void {
    if (this.disposed) return;
    this.setPhase(phase);
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (phase === 'PLAY') {
      if (this.eraMode === '1980s') {
        this.triggerFmSynthTone(440, 1.0, 1.4, 0.14, 0.08, now, 0, this.sfxGain);
        this.triggerFmSynthTone(659.25, 1.0, 1.1, 0.16, 0.08, now + 0.07, 0.2, this.sfxGain);
      } else {
        this.triggerTone(293.66, 293.66, 0.14, 'sawtooth', 0.09, now, 1300, -0.15, this.sfxGain);
        this.triggerTone(440.0, 440.0, 0.18, 'sawtooth', 0.09, now + 0.07, 1500, 0.15, this.sfxGain);
      }
    } else if (phase === 'DEPLOY') {
      this.playDrawerSlide(true);
    }
  }

  public getAudioTelemetry(): AudioDirectorTelemetry {
    return {
      eraMode: this.eraMode,
      theaterId: this.theaterId,
      musicPhase: this.musicPhase,
      tension: this.musicTension,
      inVacuum: this.inBattleVacuum,
      activeSequenceNodes: this.activeCleanupFns.size,
      disposed: this.disposed,
      music: this.musicSequencer?.getTelemetry() ?? null,
    };
  }

  /**
   * Toggles final 10-second turn-warning urgency on the 1Hz mechanical pocket-watch escapement & score tension!
   */
  public setTurnWarningUrgent(urgent: boolean): void {
    if (this.disposed || urgent === this.turnWarningUrgent) return;
    this.turnWarningUrgent = urgent;
    if (this.musicPhase === 'PLAY') {
      this.musicTension = urgent ? Math.max(this.baseMusicTension, 0.82) : this.baseMusicTension;
      this.musicSequencer?.setState(this.musicPhase, this.musicTension, this.eraMode);
    }
  }

  /**
   * Safe Mobile Haptic Choreography Wrapper (`navigator.vibrate`):
   * Graceful no-op on iOS Safari / desktop; crisp tactile pulses on Android Chrome / Pixel hardware.
   */
  public vibrate(pattern: number | number[]): void {
    if (this.disposed || !this.hapticsEnabled || this.muted) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Graceful no-op when blocked or unsupported
    }
  }

  // ---------------------------------------------------------------------------
  // 60 FPS Arbiter `AnalyserNode` Telemetry (`getByteTimeDomainData` & `getByteFrequencyData`)
  // ---------------------------------------------------------------------------

  public readBattleTimeDomainBytes(out: Uint8Array<ArrayBuffer>): boolean {
    if (this.disposed || !this.arbiterAnalyser || !this.ctx || this.ctx.state !== 'running' || this.muted) {
      return false;
    }
    this.arbiterAnalyser.getByteTimeDomainData(out);
    let maxDev = 0;
    for (let i = 0; i < out.length; i++) {
      const dev = Math.abs(out[i]! - 128);
      if (dev > maxDev) maxDev = dev;
    }
    return maxDev > 2;
  }

  public readBattleFrequencyBytes(out: Uint8Array<ArrayBuffer>): boolean {
    if (this.disposed || !this.arbiterAnalyser || !this.ctx || this.ctx.state !== 'running' || this.muted) {
      return false;
    }
    this.arbiterAnalyser.getByteFrequencyData(out);
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i]! > peak) peak = out[i]!;
    }
    return peak > 6;
  }

  // ---------------------------------------------------------------------------
  // Section 3: Tactile Dual-Era Tabletop & UI Foley (`1980s` Bakelite/Piezo vs `1970s` Walnut/Brass)
  // ---------------------------------------------------------------------------

  public playUiClick(): void {
    if (this.disposed) return;
    this.unlock();
    this.vibrate(10);
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const pitchVar = 0.94 + Math.random() * 0.12;

    if (this.eraMode === '1980s') {
      // Crisp Bakelite piezo detent (`2200 -> 2900Hz` 14ms FM chirp)
      this.triggerFmSynthTone(2250 * pitchVar, 1.3, 1.5, 0.014, 0.12, now, 0, this.sfxGain);
      this.triggerFilteredNoise('white', 0.01, 4100 * pitchVar, 0.075, now, 3.0, 0, this.sfxGain);
    } else {
      // Warm mechanical brass-and-walnut detent click
      this.triggerTone(1420 * pitchVar, 980 * pitchVar, 0.02, 'sawtooth', 0.1, now, 2800, 0, this.sfxGain);
      this.triggerTone(210 * pitchVar, 115 * pitchVar, 0.018, 'sine', 0.13, now, 680, 0, this.sfxGain);
      this.triggerFilteredNoise('brown', 0.014, 1850 * pitchVar, 0.07, now, 2.2, 0, this.sfxGain);
    }
  }

  public playPiecePickup(): void {
    if (this.disposed) return;
    this.unlock();
    this.vibrate(10);
    if (this.musicPhase === 'TITLE') {
      this.setMusicContext({ phase: 'DEPLOY', tension: 0.25 });
    }
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;

    if (this.eraMode === '1980s') {
      // Hollow ABS/Bakelite body tap + crisp plastic click + electronic status blip
      this.triggerTone(1050, 420, 0.028, 'sine', 0.2, now, 2200, 0, this.sfxGain);
      this.triggerFilteredNoise('white', 0.014, 2600, 0.11, now, 2.4, 0, this.sfxGain);
      this.triggerFmSynthTone(2680, 1.0, 0.8, 0.055, 0.065, now + 0.005, 0, this.sfxGain);
    } else {
      // Warm oiled walnut body thump + damped `2400Hz` brass insignia micro-ping
      this.triggerTone(340, 125, 0.042, 'sine', 0.24, now, 1100, 0, this.sfxGain);
      this.triggerFilteredNoise('brown', 0.018, 1550, 0.1, now, 1.8, 0, this.sfxGain);
      this.triggerTone(2400, 2382, 0.075, 'sine', 0.095, now + 0.006, 4600, 0, this.sfxGain);
    }
  }

  public playSelect(): void {
    this.playUiClick();
  }

  public playMoveSlide(veteranKills = 0): void {
    if (this.disposed) return;
    this.unlock();
    this.vibrate(18);
    if (this.musicPhase === 'TITLE' || this.musicPhase === 'DEPLOY') {
      this.setMusicContext({ phase: 'PLAY', tension: Math.max(0.28, this.baseMusicTension) });
    } else if (this.musicPhase === 'PLAY') {
      const bump = veteranKills >= 2 ? 0.08 : 0.03;
      this.setMusicContext({ tension: Math.min(0.92, this.baseMusicTension + bump) });
    }
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const weightMul = veteranKills >= 2 ? 0.84 : 1.0;

    if (this.eraMode === '1980s') {
      // Bakelite glide on brushed console + crisp ABS impact clack
      this.triggerSweptNoise('white', 0.075, 1350 * weightMul, 460 * weightMul, 0.12, now, 1.6, 0, this.sfxGain);
      const dropTime = now + 0.068;
      this.triggerTone(155 * weightMul, 54 * weightMul, 0.078, 'sine', veteranKills >= 2 ? 0.36 : 0.26, dropTime, 760, 0, this.sfxGain);
      this.triggerFmSynthTone(1120 * weightMul, 1.0, 0.9, 0.024, 0.12, dropTime, 0, this.sfxGain);
    } else {
      // Velvet-damped slate brush + weighted walnut thud + wood bevel click
      this.triggerSweptNoise('brown', 0.095, 760 * weightMul, 210 * weightMul, 0.2, now, 1.3, 0, this.sfxGain);
      const dropTime = now + 0.078;
      this.triggerTone(108 * weightMul, 36 * weightMul, 0.098, 'sine', veteranKills >= 2 ? 0.4 : 0.3, dropTime, 540, 0, this.sfxGain);
      this.triggerTone(680 * weightMul, 420 * weightMul, 0.028, 'sawtooth', 0.11, dropTime, 1900, 0, this.sfxGain);
    }
  }

  public playDrawerSlide(opening = true): void {
    if (this.disposed) return;
    this.unlock();
    this.vibrate(10);
    if (opening && this.musicPhase === 'TITLE') {
      this.setMusicContext({ phase: 'DEPLOY', tension: 0.22 });
    }
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;

    if (this.eraMode === '1980s') {
      const fStart = opening ? 360 : 740;
      const fEnd = opening ? 780 : 320;
      this.triggerSweptNoise('white', 0.12, fStart, fEnd, 0.11, now, 1.8, 0, this.sfxGain);
      this.triggerTone(opening ? 180 : 250, opening ? 260 : 165, 0.11, 'sawtooth', 0.06, now, 950, 0, this.sfxGain);
    } else {
      const fStart = opening ? 220 : 460;
      const fEnd = opening ? 460 : 210;
      this.triggerSweptNoise('brown', 0.14, fStart, fEnd, 0.18, now, 1.4, 0, this.sfxGain);
    }
    this.playMagneticSnap(now + 0.115);
  }

  public playMagneticSnap(atTime?: number): void {
    if (this.disposed || !this.ctx || !this.sfxGain || this.muted) return;
    const t = atTime ?? this.ctx.currentTime;
    if (this.eraMode === '1980s') {
      // Solenoid relay snap
      this.triggerFmSynthTone(2550, 1.2, 1.3, 0.018, 0.11, t, 0, this.sfxGain);
      this.triggerTone(220, 95, 0.026, 'sine', 0.14, t, 760, 0, this.sfxGain);
    } else {
      // Mechanical brass clasp click + walnut settle
      this.triggerTone(1850, 1220, 0.024, 'sawtooth', 0.09, t, 3600, 0, this.sfxGain);
      this.triggerTone(290, 110, 0.032, 'sine', 0.15, t, 820, 0, this.sfxGain);
    }
  }

  // ---------------------------------------------------------------------------
  // Section 4: Battle Choreography & 3-Act Dual-Era Soundscapes
  // ---------------------------------------------------------------------------

  /**
   * Unified M4 Clash Soundscape Entry Point for all 6 `BattleChoreographyKind` values
   * (`INFANTRY`, `RECON_STEALTH`, `ARMOR_ARTILLERY`, `HIGH_COMMAND`, `MUTUAL_SPLIT`, `FLAG_BREACH`).
   * Consumes strictly public `ArbiterVerdict` fields — NEVER reads `enemy.trueRank`.
   */
  public playClashChoreography(verdict: ArbiterVerdict, speedScale = 1): void {
    if (this.disposed) return;
    this.unlock();
    this.stopActiveSequence();
    this.setMusicContext({ phase: 'ARBITER' });
    this.musicSequencer?.setArbiterDuck(true);

    this.activeChoreography = verdict.choreography;
    this.activeVerdict = verdict;
    this.lastChoreographyMs = Date.now();

    if (!this.ctx || !this.sfxGain || !this.musicGain || !this.vacuumDuckBus || this.muted) return;

    const seqToken = this.activeSeqToken;
    const effSpeed = Math.max(0.5, speedScale);
    const defcon = verdict.stakes?.defcon ?? 3;
    const tAct1End = 0.76 / effSpeed;
    const pushDur = (defcon === 1 ? 1.48 : defcon === 2 ? 1.28 : 1.06) / effSpeed;
    const vacuumDur = (defcon === 1 ? 0.82 : defcon === 2 ? 0.56 : 0.42) / effSpeed;
    const attackerIsPlayer = verdict.attackerFaction === 'PLAYER';
    const defPan = verdict.defenderFaction === 'PLAYER' ? -0.52 : 0.52;
    const isReversal =
      (verdict.attackerFaction === 'PLAYER' && verdict.resolution === 'ENEMY_WINS') ||
      (verdict.attackerFaction === 'ENEMY' && verdict.resolution === 'PLAYER_WINS');
    const isSpyIntercept =
      verdict.playerVisibleRank === 'PRIVATE' && verdict.resolution === 'PLAYER_WINS';

    this.executeAct1(tAct1End, effSpeed, verdict.choreography, verdict.stakes, seqToken);

    const t2 = this.registerSequenceTimeout(tAct1End * 1000, seqToken, () => {
      this.executeAct2A(pushDur, attackerIsPlayer, defcon, verdict.choreography, seqToken);
    });
    const t3 = this.registerSequenceTimeout((tAct1End + pushDur) * 1000, seqToken, () => {
      this.executeAct2B(vacuumDur, isReversal, defPan, verdict.choreography, seqToken);
    });
    const t4 = this.registerSequenceTimeout((tAct1End + pushDur + vacuumDur) * 1000, seqToken, () => {
      this.executeAct3(
        verdict.resolution,
        isSpyIntercept,
        verdict.choreography,
        Boolean(verdict.isFlagTraverseVictory),
        seqToken
      );
    });
    this.choreographyAutoTimers.push(t2, t3, t4);
  }

  public playAct1LockIn(speedScale = 1, stakes?: ClashPublicStakes): void {
    if (this.disposed) return;
    this.unlock();

    // If `playClashChoreography` already launched Act 1 for this active clash, do not double-trigger or wipe it!
    const justTriggeredChoreography =
      this.activeVerdict !== null &&
      this.actExecutedForSeq.act1 &&
      !this.actExecutedForSeq.act3 &&
      this.lastChoreographyMs >= 0 &&
      Date.now() - this.lastChoreographyMs <= 250;
    if (justTriggeredChoreography) {
      return;
    }

    this.stopActiveSequence();
    this.setMusicContext({ phase: 'ARBITER' });
    this.musicSequencer?.setArbiterDuck(true);
    this.activeVerdict = null;
    this.activeChoreography = this.inferChoreographyFromStakes(stakes);

    if (!this.ctx || !this.sfxGain || !this.musicGain || !this.vacuumDuckBus || this.muted) return;
    const effSpeed = Math.max(0.5, speedScale);
    this.executeAct1(0.76 / effSpeed, effSpeed, this.activeChoreography, stakes, this.activeSeqToken);
  }

  public playAct2SuppressionPush(
    pushDurSec: number,
    attackerIsPlayer: boolean,
    defcon: 1 | 2 | 3
  ): void {
    if (this.disposed) return;
    this.unlock();
    if (!this.ctx || !this.musicGain || !this.sfxGain || this.muted) return;

    const choreo =
      this.activeVerdict?.choreography ??
      (defcon === 1 && this.activeChoreography === 'INFANTRY' ? 'HIGH_COMMAND' : this.activeChoreography);
    this.executeAct2A(pushDurSec, attackerIsPlayer, defcon, choreo, this.activeSeqToken);
  }

  public playStrachanVacuumAndHeartbeat(
    vacuumDurSec: number,
    isReversal: boolean,
    defenderPan: number
  ): void {
    if (this.disposed) return;
    this.unlock();
    if (!this.ctx || !this.vacuumDuckBus || !this.heartbeatBypassBus || this.muted) return;

    this.executeAct2B(
      vacuumDurSec,
      isReversal,
      defenderPan,
      this.activeVerdict?.choreography ?? this.activeChoreography,
      this.activeSeqToken
    );
  }

  public playAct3Outcome(resolution: BattleResolutionKind, isSpyIntercept = false): void {
    if (this.disposed) return;
    this.unlock();
    if (!this.ctx || !this.sfxGain || !this.musicGain || !this.vacuumDuckBus || this.muted) {
      if (!this.actExecutedForSeq.act3) {
        this.actExecutedForSeq.act3 = true;
        this.updateMusicAfterOutcome(resolution);
      }
      return;
    }

    const choreo =
      resolution === 'MUTUAL_SPLIT'
        ? 'MUTUAL_SPLIT'
        : resolution === 'FLAG_CAPTURED_BY_PLAYER' || resolution === 'FLAG_CAPTURED_BY_ENEMY'
          ? 'FLAG_BREACH'
          : this.activeVerdict?.choreography ?? this.activeChoreography;

    this.executeAct3(
      resolution,
      isSpyIntercept,
      choreo,
      Boolean(this.activeVerdict?.isFlagTraverseVictory),
      this.activeSeqToken
    );
  }

  public stopActiveSequence(): void {
    if (this.disposed) return;
    this.activeSeqToken += 1;
    this.inBattleVacuum = false;
    this.activeVerdict = null;
    this.lastChoreographyMs = -1;
    this.cancelChoreographyAutoTimers();
    this.actExecutedForSeq = {
      act1: false,
      act2A: false,
      act2B: false,
      act3: false,
    };

    const fns = Array.from(this.activeCleanupFns);
    this.activeCleanupFns.clear();
    for (const fn of fns) {
      fn();
    }

    if (this.ctx && this.vacuumDuckBus) {
      const now = this.ctx.currentTime;
      const cur = Math.max(0.0001, this.vacuumDuckBus.gain.value);
      this.vacuumDuckBus.gain.cancelScheduledValues(now);
      this.vacuumDuckBus.gain.setValueAtTime(cur, now);
      this.vacuumDuckBus.gain.linearRampToValueAtTime(1.0, now + 0.025);
    }

    // Flush the ringing ConvolverNode synchronously so skipped explosions leave zero 2s reverb tail,
    // while preserving reverb for all subsequent cues!
    if (this.ctx && this.reverbSend) {
      const now = this.ctx.currentTime;
      this.reverbSend.gain.cancelScheduledValues(now);
      this.reverbSend.gain.setValueAtTime(0.0001, now);
      this.reverbSend.gain.setValueAtTime(0.0001, now + 0.02);
      this.reverbSend.gain.linearRampToValueAtTime(0.26, now + 0.05);
    }
    if (this.ctx && this.reverbReturnGain) {
      const now = this.ctx.currentTime;
      this.reverbReturnGain.gain.cancelScheduledValues(now);
      this.reverbReturnGain.gain.setValueAtTime(0.0001, now);
      this.reverbReturnGain.gain.setValueAtTime(0.0001, now + 0.025);
      this.reverbReturnGain.gain.linearRampToValueAtTime(1.0, now + 0.055);
    }
    if (this.ctx && this.reverbSend && this.reverbReturnGain && this.reverbImpulseBuffer) {
      const oldConvolver = this.convolver;
      try {
        this.reverbSend.disconnect();
      } catch {
        // already disconnected
      }
      if (oldConvolver) {
        try {
          oldConvolver.disconnect();
        } catch {
          // already disconnected
        }
      }
      const freshConvolver = this.ctx.createConvolver();
      freshConvolver.normalize = false;
      freshConvolver.buffer = this.reverbImpulseBuffer;
      this.reverbSend.connect(freshConvolver);
      freshConvolver.connect(this.reverbReturnGain);
      this.convolver = freshConvolver;
    }

    this.musicSequencer?.setArbiterDuck(false);
    if (this.musicPhase === 'ARBITER') {
      this.setMusicContext({ phase: 'PLAY' });
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.stopActiveSequence();
    this.disposed = true;

    this.musicSequencer?.dispose();
    this.musicSequencer = null;

    if (this.ambienceTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.ambienceTimer);
      this.ambienceTimer = null;
    }

    for (const src of this.ambianceContinuousSources) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.ambianceContinuousSources = [];

    for (const node of this.ambianceContinuousNodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.ambianceContinuousNodes = [];

    const busNodes: Array<AudioNode | null> = [
      this.reverbSend,
      this.convolver,
      this.reverbReturnGain,
      this.musicGain,
      this.sfxGain,
      this.ambianceGain,
      this.arbiterBattleBus,
      this.vacuumDuckBus,
      this.heartbeatBypassBus,
      this.preMasterSum,
      this.subsonicHPF,
      this.subShelf,
      this.glueComp,
      this.preClipGain,
      this.saturator,
      this.brickwallLimiter,
      this.masterGain,
      this.arbiterAnalyser,
      this.analyserSink,
    ];
    for (const node of busNodes) {
      try {
        node?.disconnect();
      } catch {
        // already disconnected
      }
    }

    const ctx = this.ctx;
    this.ctx = null;
    this.ambienceStarted = false;
    this.whiteNoiseCache = null;
    this.pinkBrownCache = null;
    this.reverbImpulseBuffer = null;
    this.windFilter = null;
    this.windLfo = null;
    this.windLfoDepth = null;
    this.windGain = null;
    this.droneOsc1 = null;
    this.droneOsc2 = null;
    this.droneFilter = null;
    this.droneGain = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.ambianceGain = null;
    this.reverbSend = null;
    this.reverbReturnGain = null;
    this.arbiterBattleBus = null;
    this.vacuumDuckBus = null;
    this.heartbeatBypassBus = null;
    this.preMasterSum = null;
    this.preClipGain = null;
    this.analyserSink = null;
    this.arbiterAnalyser = null;
    this.convolver = null;
    this.subsonicHPF = null;
    this.subShelf = null;
    this.glueComp = null;
    this.saturator = null;
    this.brickwallLimiter = null;

    if (ctx) {
      try {
        void ctx.close().catch(() => {});
      } catch {
        // ignore close failure
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shared Act 1 / 2A / 2B / 3 Builders (All 6 BattleChoreographyKind Profiles)
  // ---------------------------------------------------------------------------

  private inferChoreographyFromStakes(stakes?: ClashPublicStakes): BattleChoreographyKind {
    if (!stakes) return 'INFANTRY';
    if (stakes.playerDoctrine === 'FLAG_LAST_STAND') return 'FLAG_BREACH';
    if (stakes.playerDoctrine === 'COVERT_SPY') return 'RECON_STEALTH';
    if (stakes.playerDoctrine === 'HIGH_COMMAND' || stakes.defcon === 1) return 'HIGH_COMMAND';
    return 'INFANTRY';
  }

  private cancelChoreographyAutoTimers(): void {
    for (const cancel of this.choreographyAutoTimers) {
      cancel();
    }
    this.choreographyAutoTimers = [];
  }

  private executeAct1(
    _act1DurSec: number,
    speedScale: number,
    choreography: BattleChoreographyKind,
    stakes: ClashPublicStakes | undefined,
    seqToken: number
  ): void {
    if (
      this.disposed ||
      seqToken !== this.activeSeqToken ||
      this.actExecutedForSeq.act1 ||
      !this.ctx ||
      !this.sfxGain ||
      !this.musicGain ||
      !this.vacuumDuckBus
    ) {
      return;
    }
    this.actExecutedForSeq.act1 = true;
    this.vibrate([35, 45, 40]);

    const now = this.ctx.currentTime;
    const inv = 1 / Math.max(0.5, speedScale);
    this.inBattleVacuum = false;
    this.turnWarningUrgent = false;
    this.vacuumDuckBus.gain.cancelScheduledValues(now);
    this.vacuumDuckBus.gain.setValueAtTime(1.0, now);

    const atkPan = stakes?.isEnemyInitiatedAmbush ? 0.52 : -0.52;
    const defPan = -atkPan;

    // 1. Era-Specific Servo / Shutter Lock-In
    if (this.eraMode === '1980s') {
      // CRT degauss swell + crisp solenoid relay + FM lock chime
      this.triggerTone(120, 58, 0.34 * inv, 'sine', 0.18, now, 320, 0, this.sfxGain, seqToken);
      this.triggerTone(240, 380, 0.24 * inv, 'sawtooth', 0.14, now + 0.01, 1350, 0, this.sfxGain, seqToken);
      this.triggerFmSynthTone(880, 1.0, 1.2, 0.14, 0.1, now + 0.08 * inv, -0.2, this.sfxGain, seqToken);
      this.triggerFmSynthTone(1320, 1.0, 1.0, 0.16, 0.09, now + 0.14 * inv, 0.2, this.sfxGain, seqToken);
    } else {
      // Heavy walnut/slate slam + mechanical brass shutter clack + D2 timpani + horn lock
      this.triggerTone(195, 310, 0.26 * inv, 'sawtooth', 0.14, now + 0.01, 980, 0, this.sfxGain, seqToken);
      this.triggerFilteredNoise('brown', 0.22 * inv, 540, 0.2, now + 0.01, 1.1, 0, this.sfxGain, seqToken);
      this.triggerTone(78, 73.42, 0.28 * inv, 'sine', 0.26, now + 0.12 * inv, 260, 0, this.musicGain, seqToken);
    }

    // 2. Brushed-brass Attack Medallion slam + Twin staggered bastion impacts
    this.triggerTone(135, 42, 0.14, 'sine', 0.32, now + 0.16 * inv, 680, 0, this.sfxGain, seqToken);
    this.triggerMetallicPing(1940, 0.09, 0.19, now + 0.16 * inv, 0, this.sfxGain, seqToken);

    for (const [idx, delay] of ([0.22 * inv, 0.34 * inv] as const).entries()) {
      const pan = idx === 0 ? atkPan : defPan;
      this.triggerTone(78, 30, 0.25, 'sine', 0.42, now + delay, 320, pan, this.sfxGain, seqToken);
      this.triggerTone(520, 880, 0.1, 'sawtooth', 0.1, now + delay + 0.01, 2400, pan, this.sfxGain, seqToken);
      this.triggerFilteredNoise('white', 0.032, 3600, 0.18, now + delay + 0.012, 2.2, pan, this.sfxGain, seqToken);
    }

    // 3. Choreography-specific Act 1 Signature
    if (choreography === 'HIGH_COMMAND' || stakes?.defcon === 1) {
      this.triggerZimmerBraaam(73.42, 0.72 * inv, 0.26, now + 0.14 * inv, this.musicGain, seqToken);
      this.triggerFmSynthTone(1100, 1.5, 2.0, 0.09, 0.08, now + 0.38 * inv, 0, this.sfxGain, seqToken);
    } else if (choreography === 'RECON_STEALTH') {
      this.triggerTone(1480, 1472, 0.38 * inv, 'sine', 0.14, now + 0.2 * inv, 3800, -0.25, this.musicGain, seqToken);
      this.triggerSweptNoise('white', 0.11, 5200, 1800, 0.11, now + 0.26 * inv, 2.8, 0.3, this.sfxGain, seqToken);
    } else if (choreography === 'ARMOR_ARTILLERY') {
      // Hydraulic turret servo groan
      this.triggerTone(68, 84, 0.44 * inv, 'sawtooth', 0.16, now + 0.1 * inv, 340, -0.28, this.sfxGain, seqToken);
      this.triggerFilteredNoise('brown', 0.36 * inv, 140, 0.18, now + 0.12 * inv, 1.5, -0.28, this.sfxGain, seqToken);
    } else if (choreography === 'FLAG_BREACH') {
      // Urgent DEFCON breach klaxon pulse (`880 <-> 660Hz`)
      this.triggerTone(880, 880, 0.14 * inv, 'sawtooth', 0.13, now + 0.12 * inv, 2100, 0, this.musicGain, seqToken);
      this.triggerTone(660, 660, 0.16 * inv, 'sawtooth', 0.13, now + 0.28 * inv, 1800, 0, this.musicGain, seqToken);
    }
  }

  private executeAct2A(
    pushDurSec: number,
    attackerIsPlayer: boolean,
    defcon: 1 | 2 | 3,
    choreography: BattleChoreographyKind,
    seqToken: number
  ): void {
    if (
      this.disposed ||
      seqToken !== this.activeSeqToken ||
      this.actExecutedForSeq.act2A ||
      !this.ctx ||
      !this.musicGain ||
      !this.sfxGain
    ) {
      return;
    }
    this.actExecutedForSeq.act2A = true;
    this.vibrate([12, 60, 12, 50, 15, 40, 20]);

    const now = this.ctx.currentTime;
    const atkPan = attackerIsPlayer ? -0.58 : 0.58;
    const defPan = -atkPan;

    // A) Era-Specific Musical Escalation
    if (this.eraMode === '1980s') {
      const arpNotes = [146.83, 174.61, 220.0, 233.08, 293.66, 349.23, 440.0, 466.16];
      let tCursor = 0.02;
      let step = 0;
      while (tCursor < pushDurSec - 0.05) {
        const prog = tCursor / Math.max(0.2, pushDurSec);
        const noteDur = Math.max(0.078, 0.175 * (1 - prog * 0.54));
        const freq = arpNotes[step % arpNotes.length]! * (defcon === 1 ? 1.05946 : 1.0);
        const pan = (step % 2 === 0 ? -1 : 1) * 0.32;
        this.triggerFmSynthTone(freq, 1.0, 1.2 + prog, noteDur * 0.85, 0.08 + prog * 0.05, now + tCursor, pan, this.musicGain, seqToken);
        this.triggerTone(freq * 1.004, freq, noteDur * 0.78, 'square', 0.045 + prog * 0.04, now + tCursor, 1800 + prog * 1600, -pan, this.musicGain, seqToken);
        tCursor += noteDur;
        step += 1;
      }

      let bassT = 0.0;
      while (bassT < pushDurSec - 0.08) {
        this.triggerTone(55, 52, 0.18, 'sawtooth', 0.18, now + bassT, 240, 0, this.musicGain, seqToken);
        bassT += 0.22;
      }

      for (let a = 0; a < 7; a++) {
        const at = (a / 7) * (pushDurSec - 0.12);
        const arcPan = (a % 2 === 0 ? -1 : 1) * 0.38;
        this.triggerSweptNoise('white', 0.09, 2200, 4800, 0.09, now + at, 3.6, arcPan, this.sfxGain, seqToken);
      }
    } else {
      // 1970s: Tight rudimental military snare press-roll + deep timpani + rich formant brass swell
      let rollT = 0.02;
      let stroke = 0;
      while (rollT < pushDurSec - 0.03) {
        const prog = rollT / Math.max(0.2, pushDurSec);
        const gain = 0.045 + Math.pow(prog, 1.55) * 0.18;
        const pan = (stroke % 2 === 0 ? -1 : 1) * 0.16;
        this.triggerFilteredNoise('white', 0.026, 2650, gain, now + rollT, 1.4, pan, this.musicGain, seqToken);
        this.triggerTone(215, 145, 0.022, 'sine', gain * 0.7, now + rollT, 1100, pan, this.musicGain, seqToken);
        rollT += Math.max(0.014, 0.026 * (1 - prog * 0.44));
        stroke += 1;
      }

      for (const [idx, tt] of [0.05, 0.38, 0.7, 0.98, 1.24].entries()) {
        if (tt < pushDurSec - 0.08) {
          const f = idx % 2 === 0 ? 73.42 : 55.0;
          this.triggerTone(f * 1.07, f, 0.28, 'sine', 0.28, now + tt, 260, 0, this.musicGain, seqToken);
        }
      }

      for (const bf of [146.83, 174.61, 207.65]) {
        this.triggerBrassSwell(bf, pushDurSec * 0.94, 0.1, now + 0.04, seqToken);
      }
    }

    // B) Choreography-Differentiated Combat Ballistics (`sfxGain`)
    if (choreography === 'RECON_STEALTH') {
      // Suppressed 18ms high-Q carbine/pistol shots + sonar/radio shimmer (ZERO heavy howitzer)
      for (const bt of [0.14, 0.28, 0.44, 0.66, 0.84, 1.02]) {
        if (bt < pushDurSec - 0.08) {
          const pan = bt % 0.28 < 0.14 ? atkPan : defPan;
          this.triggerSweptNoise('white', 0.018, 1800, 650, 0.16, now + bt, 3.8, pan, this.sfxGain, seqToken);
          this.triggerTone(240, 95, 0.022, 'sine', 0.15, now + bt, 820, pan, this.sfxGain, seqToken);
        }
      }
      this.triggerTone(1480, 1476, 0.35, 'sine', 0.08, now + 0.12, 3400, -0.3, this.musicGain, seqToken);
      this.triggerTone(2220, 2212, 0.3, 'sine', 0.06, now + 0.36, 4200, 0.3, this.musicGain, seqToken);
      return;
    }

    if (choreography === 'ARMOR_ARTILLERY') {
      // Booming 105mm howitzer barrages + sloped-armor ricochets
      this.triggerHowitzerShot(now + 0.03, atkPan, 0.72, seqToken);
      if (pushDurSec > 0.75) {
        this.triggerHowitzerShot(now + 0.56, defPan, 0.68, seqToken);
      }
      for (const [idx, rt] of [0.28, 0.48, 0.82, 1.05].entries()) {
        if (rt < pushDurSec - 0.08) {
          this.triggerArmorRicochet(now + rt, idx % 2 === 0 ? defPan : atkPan, idx % 2 === 0, seqToken);
        }
      }
      return;
    }

    if (choreography === 'HIGH_COMMAND') {
      // Heavy command airstrike thunder + brass/synth barrage + artillery
      this.triggerHowitzerShot(now + 0.03, atkPan, 0.76, seqToken);
      this.triggerZimmerBraaam(55.0, Math.min(0.85, pushDurSec * 0.68), 0.24, now + 0.06, this.musicGain, seqToken);
      for (const bt of [0.22, 0.36, 0.64, 0.78, 1.02]) {
        if (bt < pushDurSec - 0.08) {
          this.triggerHeavyGunshotWithCasing(now + bt, bt % 0.4 < 0.2 ? atkPan : defPan, 0.94, seqToken);
        }
      }
      this.triggerArmorRicochet(now + 0.48, defPan, true, seqToken);
      return;
    }

    if (choreography === 'FLAG_BREACH') {
      // Urgent breach siren pulses + rapid assault fire
      for (let s = 0; s < 3; s++) {
        const st = now + 0.06 + s * 0.38;
        if (st < now + pushDurSec - 0.14) {
          this.triggerTone(s % 2 === 0 ? 880 : 660, s % 2 === 0 ? 660 : 880, 0.22, 'sawtooth', 0.09, st, 2200, 0, this.musicGain, seqToken);
        }
      }
      this.triggerHowitzerShot(now + 0.04, atkPan, 0.65, seqToken);
      for (const bt of [0.2, 0.28, 0.54, 0.62, 0.92, 1.0]) {
        if (bt < pushDurSec - 0.08) {
          this.triggerHeavyGunshotWithCasing(now + bt, atkPan, 1.02, seqToken);
        }
      }
      return;
    }

    // INFANTRY & MUTUAL_SPLIT: Rapid small-arms bursts, brass casing clinks & counterfire
    if (choreography === 'MUTUAL_SPLIT') {
      this.triggerHowitzerShot(now + 0.03, atkPan, 0.55, seqToken);
      this.triggerHowitzerShot(now + 0.07, defPan, 0.55, seqToken);
    }
    const atkBursts = [0.14, 0.21, 0.28, 0.58, 0.65, 0.72, 1.0, 1.07, 1.14];
    for (const bt of atkBursts) {
      if (bt < pushDurSec - 0.08) {
        this.triggerHeavyGunshotWithCasing(now + bt, atkPan, 0.98, seqToken);
      }
    }
    for (const bt of [0.42, 0.49, 0.84, 0.91]) {
      if (bt < pushDurSec - 0.1) {
        this.triggerHeavyGunshotWithCasing(now + bt, defPan, 1.16, seqToken);
      }
    }
    for (const [idx, rt] of [0.34, 0.82].entries()) {
      if (rt < pushDurSec - 0.08) {
        this.triggerArmorRicochet(now + rt, defPan, idx % 2 === 0, seqToken);
      }
    }
  }

  private executeAct2B(
    vacuumDurSec: number,
    isReversal: boolean,
    defenderPan: number,
    choreography: BattleChoreographyKind,
    seqToken: number
  ): void {
    if (
      this.disposed ||
      seqToken !== this.activeSeqToken ||
      this.actExecutedForSeq.act2B ||
      !this.ctx ||
      !this.vacuumDuckBus ||
      !this.heartbeatBypassBus
    ) {
      return;
    }
    this.actExecutedForSeq.act2B = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.inBattleVacuum = true;

    // 1. Instant -60dB Vacuum Drop across Ambiance, Music & Reverberant SFX
    this.vacuumDuckBus.gain.cancelScheduledValues(now);
    this.vacuumDuckBus.gain.setValueAtTime(Math.max(0.0001, this.vacuumDuckBus.gain.value), now);
    this.vacuumDuckBus.gain.linearRampToValueAtTime(0.0001, now + 0.018);

    // 2. Deflection Clang OR Clinical/Stealth/Sub-Drop
    if (isReversal) {
      this.vibrate([25, 30, 25]);
      this.triggerMetallicPing(620, 0.3, 0.34, now, defenderPan, this.heartbeatBypassBus, seqToken);
      this.triggerMetallicPing(1310, 0.22, 0.28, now + 0.005, defenderPan, this.heartbeatBypassBus, seqToken);
      this.triggerTone(3400, 690, 0.24, 'sine', 0.2, now + 0.015, 4800, -defenderPan * 0.7, this.heartbeatBypassBus, seqToken);
    } else if (choreography === 'RECON_STEALTH') {
      // Blade/garrote metallic swish + clinical sub-drop
      this.triggerSweptNoise('white', 0.18, 5200, 1800, 0.16, now, 3.2, defenderPan, this.heartbeatBypassBus, seqToken);
      this.triggerTone(125, 30, 0.2, 'sine', 0.3, now + 0.02, 280, 0, this.heartbeatBypassBus, seqToken);
    } else {
      this.triggerTone(145, 28, 0.22, 'sine', 0.34, now, 320, 0, this.heartbeatBypassBus, seqToken);
    }

    // 3. 52Hz Human Heartbeat (`LUB-DUB`) inside the Strachan Silence Vacuum
    const pulse1 = now + Math.min(0.14, vacuumDurSec * 0.18);
    this.triggerHeartbeatLubDub(pulse1, 0.56, seqToken);
    if (vacuumDurSec >= 0.58) {
      this.triggerHeartbeatLubDub(pulse1 + 0.38, 0.64, seqToken);
    }

    // 4. Incoming Doppler 88mm Shell Whistle (or Suppressed Stealth Whir for RECON_STEALTH)
    const whistleDur = Math.min(0.26, vacuumDurSec * 0.42);
    const whistleStart = now + Math.max(0.08, vacuumDurSec - whistleDur);
    const osc = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc.type = choreography === 'RECON_STEALTH' ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(choreography === 'RECON_STEALTH' ? 1480 : 2150, whistleStart);
    osc.frequency.exponentialRampToValueAtTime(choreography === 'RECON_STEALTH' ? 420 : 240, whistleStart + whistleDur);

    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(1900, whistleStart);
    filt.frequency.exponentialRampToValueAtTime(360, whistleStart + whistleDur);
    filt.Q.value = 3.8;

    g.gain.setValueAtTime(0.002, whistleStart);
    g.gain.exponentialRampToValueAtTime(0.24, whistleStart + whistleDur * 0.92);
    g.gain.linearRampToValueAtTime(0.001, whistleStart + whistleDur);

    osc.connect(filt);
    filt.connect(g);
    g.connect(this.heartbeatBypassBus);
    this.registerSequenceNode(osc, g, [filt], seqToken, whistleStart);
    osc.start(whistleStart);
    osc.stop(whistleStart + whistleDur + 0.02);
  }

  private executeAct3(
    resolution: BattleResolutionKind,
    isSpyIntercept: boolean,
    choreography: BattleChoreographyKind,
    isFlagTraverseVictory: boolean,
    seqToken: number
  ): void {
    if (
      this.disposed ||
      seqToken !== this.activeSeqToken ||
      this.actExecutedForSeq.act3 ||
      !this.ctx ||
      !this.sfxGain ||
      !this.musicGain ||
      !this.vacuumDuckBus
    ) {
      return;
    }
    this.actExecutedForSeq.act3 = true;
    this.vibrate([65, 30, 90]);

    const now = this.ctx.currentTime;
    this.inBattleVacuum = false;
    this.vacuumDuckBus.gain.cancelScheduledValues(now);
    this.vacuumDuckBus.gain.setValueAtTime(1.0, now);

    // 1. MUTUAL SPLIT: Kurosawa Delayed Double-KO + Thermal Runaway + Twin Clunks + Hollow Bronze Gong
    if (resolution === 'MUTUAL_SPLIT' || choreography === 'MUTUAL_SPLIT') {
      this.triggerHeavyExplosion(now, 0.52, 0.78, 0.9, seqToken);
      this.triggerTone(620, 2350, 0.26, 'sawtooth', 0.14, now + 0.18, 3400, -0.52, this.sfxGain, seqToken);
      this.triggerFilteredNoise('white', 0.04, 4200, 0.24, now + 0.45, 2.0, -0.45, this.sfxGain, seqToken);
      this.triggerFilteredNoise('white', 0.04, 4200, 0.24, now + 0.46, 2.0, 0.45, this.sfxGain, seqToken);
      this.triggerHeavyExplosion(now + 0.46, -0.52, 0.84, 1.15, seqToken);
      this.triggerTone(95, 34, 0.18, 'sine', 0.28, now + 0.48, 480, -0.5, this.sfxGain, seqToken);
      this.triggerTone(95, 34, 0.18, 'sine', 0.28, now + 0.5, 480, 0.5, this.sfxGain, seqToken);
      this.triggerHollowGong(now + 0.5, 1.85, 0.22, seqToken);
      this.updateMusicAfterOutcome(resolution);
      return;
    }

    // 2. PLAYER WINS CLASH (`PLAYER_WINS`)
    if (resolution === 'PLAYER_WINS') {
      if (choreography === 'RECON_STEALTH') {
        // Clinical suppressed kill + high-frequency intercept chime
        this.triggerSweptNoise('white', 0.04, 2400, 420, 0.22, now, 2.0, 0.45, this.sfxGain, seqToken);
        this.triggerTone(96, 28, 0.22, 'sine', 0.34, now + 0.01, 280, 0.45, this.sfxGain, seqToken);
        this.triggerMetallicPing(1480, 0.14, 0.16, now + 0.06, 0.45, this.sfxGain, seqToken);
      } else if (choreography === 'INFANTRY') {
        // Single mortar/grenade blast (`120->32Hz`)
        this.triggerTone(120, 32, 0.38, 'sine', 0.38, now, 340, 0.45, this.sfxGain, seqToken);
        this.triggerFilteredNoise('brown', 0.32, 420, 0.28, now, 1.1, 0.45, this.sfxGain, seqToken);
        this.triggerMetallicPing(740, 0.06, 0.16, now + 0.08, 0.52, this.sfxGain, seqToken);
      } else {
        this.triggerHeavyExplosion(now, 0.52, choreography === 'HIGH_COMMAND' ? 0.92 : 0.82, 1.1, seqToken);
        this.triggerMetallicPing(740, 0.06, 0.18, now + 0.08, 0.55, this.sfxGain, seqToken);
        this.triggerTone(105, 34, 0.22, 'sine', 0.3, now + 0.12, 420, 0.55, this.sfxGain, seqToken);
      }

      // Pneumatic lift hiss
      this.triggerSweptNoise('white', 0.24, 1600, 3800, 0.1, now + 0.16, 1.8, -0.38, this.sfxGain, seqToken);

      const fanStart = now + 0.24;
      if (isSpyIntercept || choreography === 'RECON_STEALTH') {
        const notes = [293.66, 369.99, 440.0, 587.33, 739.99];
        notes.forEach((f, i) => {
          this.triggerBrassOrSynthNote(f, 0.38, 0.15, fanStart + i * 0.065, seqToken);
        });
      } else {
        this.triggerBrassChord([146.83, 220.0, 369.99, 587.33], 0.7, 0.22, fanStart, seqToken);
      }
      this.triggerTone(1174.66, 1174.66, 0.62, 'sine', 0.085, fanStart + 0.08, 6500, -0.2, this.musicGain, seqToken);
      this.triggerTone(1760.0, 1760.0, 0.52, 'sine', 0.065, fanStart + 0.15, 7200, 0.2, this.musicGain, seqToken);
      this.updateMusicAfterOutcome(resolution);
      return;
    }

    // 3. PLAYER LOSES CLASH (`ENEMY_WINS`)
    if (resolution === 'ENEMY_WINS') {
      if (choreography === 'RECON_STEALTH') {
        this.triggerSweptNoise('white', 0.05, 2100, 380, 0.2, now, 2.0, -0.48, this.sfxGain, seqToken);
        this.triggerTone(88, 26, 0.24, 'sine', 0.34, now, 280, -0.48, this.sfxGain, seqToken);
      } else {
        this.triggerHeavyExplosion(now, -0.52, 0.82, 1.1, seqToken);
        this.triggerTone(98, 30, 0.24, 'sine', 0.32, now + 0.12, 380, -0.52, this.sfxGain, seqToken);
      }

      this.triggerTone(600, 45, 0.65, 'sawtooth', 0.13, now + 0.14, 1600, -0.42, this.sfxGain, seqToken);
      this.triggerBrassChord([73.42, 87.31, 103.83, 138.59], 0.74, 0.21, now + 0.26, seqToken);
      this.updateMusicAfterOutcome(resolution);
      return;
    }

    // 4. MATCH VICTORY (`FLAG_CAPTURED_BY_PLAYER` or Flag Traverse)
    if (resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      this.triggerMetallicPing(1174.66, 0.55, 0.18, now + 0.04, 0.25, this.sfxGain, seqToken);
      this.triggerZimmerBraaam(146.83, 0.82, 0.19, now + 0.05, this.musicGain, seqToken);

      // Headroom-calibrated 3-Salvo Salute (`0.68, 0.76, 0.86` with tighter decay on salvos 1-2)
      if (!isFlagTraverseVictory) {
        this.triggerHeavyExplosion(now + 0.95, 0.3, 0.68, 0.85, seqToken);
        this.triggerHeavyExplosion(now + 1.11, 0.5, 0.76, 0.85, seqToken);
        this.triggerHeavyExplosion(now + 1.27, 0.4, 0.86, 1.25, seqToken);
      } else {
        this.triggerHowitzerShot(now + 0.95, 0.3, 0.68, seqToken);
        this.triggerHowitzerShot(now + 1.15, -0.3, 0.74, seqToken);
      }

      const f0 = now + 1.34;
      this.triggerBrassChord([146.83, 220.0, 293.66], 0.28, 0.18, f0, seqToken);
      this.triggerBrassChord([196.0, 293.66, 392.0], 0.26, 0.19, f0 + 0.24, seqToken);
      this.triggerBrassChord([220.0, 329.63, 440.0], 0.28, 0.2, f0 + 0.48, seqToken);
      this.triggerBrassChord([146.83, 220.0, 369.99, 440.0, 587.33], 1.15, 0.24, f0 + 0.74, seqToken);
      this.updateMusicAfterOutcome(resolution);
      return;
    }

    // 5. MATCH DEFEAT (`FLAG_CAPTURED_BY_ENEMY`)
    this.triggerHeavyExplosion(now, -0.48, 0.8, 1.05, seqToken);
    this.triggerTone(600, 45, 0.65, 'sawtooth', 0.13, now + 0.12, 1400, -0.4, this.sfxGain, seqToken);
    this.playSoloBugleTaps(now + 0.62, seqToken);
    this.updateMusicAfterOutcome(resolution);
  }

  private updateMusicAfterOutcome(resolution: BattleResolutionKind): void {
    this.musicSequencer?.setArbiterDuck(false);
    if (resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      this.setMusicContext({ phase: 'VICTORY', tension: 0.5 });
    } else if (resolution === 'FLAG_CAPTURED_BY_ENEMY') {
      this.setMusicContext({ phase: 'DEFEAT', tension: 0.2 });
    } else {
      this.setMusicContext({ phase: 'PLAY' });
    }
  }

  // ---------------------------------------------------------------------------
  // Section 2: Continuous 4-Theater LFO Ambiance, Drones & Stochastic Events
  // ---------------------------------------------------------------------------

  private startWarRoomAmbience(ctx: AudioContext): void {
    if (this.ambienceStarted || !this.ambianceGain || !this.pinkBrownCache) return;
    this.ambienceStarted = true;

    // 1. Primary Theater Wind / Ocean / Casemate / Midnight Breeze Noise Bed
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.pinkBrownCache;
    windSrc.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 235;
    windFilter.Q.value = 1.15;

    const windLfo = ctx.createOscillator();
    const windLfoDepth = ctx.createGain();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.11;
    windLfoDepth.gain.value = 115;
    windLfo.connect(windLfoDepth);
    windLfoDepth.connect(windFilter.frequency);

    const windGain = ctx.createGain();
    windGain.gain.value = 0.24;

    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ambianceGain);

    windSrc.start();
    windLfo.start();

    this.windFilter = windFilter;
    this.windLfo = windLfo;
    this.windLfoDepth = windLfoDepth;
    this.windGain = windGain;
    this.ambianceContinuousSources.push(windSrc, windLfo);
    this.ambianceContinuousNodes.push(windFilter, windLfoDepth, windGain);

    // 2. Theater Sub-Hull / Bunker Generator Drone Layer (smoothly faded to 0 in tent/night theaters)
    const droneOsc1 = ctx.createOscillator();
    const droneOsc2 = ctx.createOscillator();
    const droneFilter = ctx.createBiquadFilter();
    const droneGain = ctx.createGain();

    droneOsc1.type = 'sine';
    droneOsc1.frequency.value = 58;
    droneOsc2.type = 'triangle';
    droneOsc2.frequency.value = 116;

    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 160;

    droneGain.gain.value = 0.0;

    droneOsc1.connect(droneFilter);
    droneOsc2.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(this.ambianceGain);

    droneOsc1.start();
    droneOsc2.start();

    this.droneOsc1 = droneOsc1;
    this.droneOsc2 = droneOsc2;
    this.droneFilter = droneFilter;
    this.droneGain = droneGain;
    this.ambianceContinuousSources.push(droneOsc1, droneOsc2);
    this.ambianceContinuousNodes.push(droneFilter, droneGain);

    // 3. 500ms Stochastic Theater Scheduler
    this.ambienceTimer = window.setInterval(() => {
      if (
        this.disposed ||
        !this.ctx ||
        this.ctx.state !== 'running' ||
        this.muted ||
        this.inBattleVacuum ||
        !this.ambianceGain
      ) {
        return;
      }
      const now = this.ctx.currentTime;
      this.watchHalfSecTick = (this.watchHalfSecTick + 1) % 2;
      this.ambiancePulseTick = (this.ambiancePulseTick + 1) % 32;

      // A) 1Hz Watch / Chronometer Escapement (volume scaled by theater)
      if (this.watchHalfSecTick === 0 || this.turnWarningUrgent) {
        const baseWatch = this.theaterId === 'NIGHT_OPS' ? 0.022 : 0.032;
        const gainMul = this.turnWarningUrgent ? 1.8 : 1.0;
        if (this.eraMode === '1980s') {
          this.triggerTone(3420, 3100, 0.012, 'sine', baseWatch * gainMul, now, 5200, 0.48, this.ambianceGain);
        } else {
          this.triggerMetallicPing(3280, 0.016, baseWatch * gainMul, now, 0.48, this.ambianceGain);
          this.triggerMetallicPing(2490, 0.014, baseWatch * 0.65 * gainMul, now + 0.12, 0.48, this.ambianceGain);
        }
      }

      // B) Theater-Specific Environment Events
      if (this.theaterId === 'FIELD_HQ') {
        if (Math.random() < 0.36) {
          const drops = 1 + Math.floor(Math.random() * 2);
          for (let d = 0; d < drops; d++) {
            const dt = Math.random() * 0.42;
            const pan = (Math.random() * 2 - 1) * 0.78;
            const pitch = 680 + Math.random() * 720;
            this.triggerFilteredNoise('brown', 0.028, pitch, 0.05, now + dt, 2.8, pan, this.ambianceGain);
          }
        }
        if (Math.random() < 0.28) {
          const ct = Math.random() * 0.35;
          this.triggerFilteredNoise('white', 0.01, 2900 + Math.random() * 1400, 0.03, now + ct, 3.2, -0.55, this.ambianceGain);
        }
      } else if (this.theaterId === 'PACIFIC_BRIDGE') {
        // Rhythmic hydrophone SONAR ping every ~4.5s (tick % 9 === 0)
        if (this.ambiancePulseTick % 9 === 0) {
          this.triggerTone(1320, 1316, 0.62, 'sine', 0.055, now + 0.04, 2400, -0.35, this.ambianceGain);
        }
        // Subtle hull creak
        if (Math.random() < 0.18) {
          this.triggerSweptNoise('brown', 0.14, 190, 120, 0.04, now + 0.1, 3.2, 0.35, this.ambianceGain);
        }
      } else if (this.theaterId === 'IRON_BUNKER') {
        // Distant muffled artillery thuds every ~5.5s
        if (this.ambiancePulseTick % 11 === 0) {
          const pan = (Math.random() * 2 - 1) * 0.6;
          this.triggerTone(85, 28, 0.42, 'sine', 0.12, now + 0.08, 160, pan, this.ambianceGain);
          this.triggerFilteredNoise('brown', 0.35, 140, 0.09, now + 0.08, 1.0, pan, this.ambianceGain);
        }
        // Dry relay / thermostat click
        if (Math.random() < 0.22) {
          this.triggerFilteredNoise('white', 0.009, 2400, 0.032, now + Math.random() * 0.3, 2.6, -0.42, this.ambianceGain);
        }
      } else if (this.theaterId === 'NIGHT_OPS') {
        // Periodic 1900Hz radar phosphor blip + shortwave static dust every ~3.0s
        if (this.ambiancePulseTick % 6 === 0) {
          this.triggerTone(1900, 1894, 0.09, 'sine', 0.04, now + 0.05, 3200, -0.32, this.ambianceGain);
          this.triggerFilteredNoise('white', 0.05, 2600, 0.025, now + 0.18, 4.0, 0.38, this.ambianceGain);
        }
      }
    }, 500);
  }

  private applyTheaterParameters(theaterId: TheaterId): void {
    if (!this.ctx || !this.windFilter || !this.windLfo || !this.windLfoDepth || !this.windGain) return;
    if (!this.droneOsc1 || !this.droneOsc2 || !this.droneFilter || !this.droneGain) return;

    const now = this.ctx.currentTime;
    switch (theaterId) {
      case 'PACIFIC_BRIDGE':
        this.windFilter.frequency.setTargetAtTime(460, now, 0.2);
        this.windLfo.frequency.setTargetAtTime(0.08, now, 0.2);
        this.windLfoDepth.gain.setTargetAtTime(180, now, 0.2);
        this.windGain.gain.setTargetAtTime(0.22, now, 0.2);
        this.droneOsc1.frequency.setTargetAtTime(58, now, 0.15);
        this.droneOsc2.frequency.setTargetAtTime(116, now, 0.15);
        this.droneFilter.frequency.setTargetAtTime(160, now, 0.15);
        this.droneGain.gain.setTargetAtTime(0.045, now, 0.25);
        break;
      case 'IRON_BUNKER':
        this.windFilter.frequency.setTargetAtTime(180, now, 0.2);
        this.windLfo.frequency.setTargetAtTime(0.06, now, 0.2);
        this.windLfoDepth.gain.setTargetAtTime(55, now, 0.2);
        this.windGain.gain.setTargetAtTime(0.16, now, 0.2);
        this.droneOsc1.frequency.setTargetAtTime(48, now, 0.15);
        this.droneOsc2.frequency.setTargetAtTime(96, now, 0.15);
        this.droneFilter.frequency.setTargetAtTime(145, now, 0.15);
        this.droneGain.gain.setTargetAtTime(0.055, now, 0.25);
        break;
      case 'NIGHT_OPS':
        this.windFilter.frequency.setTargetAtTime(380, now, 0.2);
        this.windLfo.frequency.setTargetAtTime(0.15, now, 0.2);
        this.windLfoDepth.gain.setTargetAtTime(95, now, 0.2);
        this.windGain.gain.setTargetAtTime(0.15, now, 0.2);
        this.droneGain.gain.setTargetAtTime(0.0, now, 0.25);
        break;
      case 'FIELD_HQ':
      default:
        this.windFilter.frequency.setTargetAtTime(235, now, 0.2);
        this.windLfo.frequency.setTargetAtTime(0.11, now, 0.2);
        this.windLfoDepth.gain.setTargetAtTime(115, now, 0.2);
        this.windGain.gain.setTargetAtTime(0.24, now, 0.2);
        this.droneGain.gain.setTargetAtTime(0.0, now, 0.25);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Sequence Tracking & Synthesis Builders
  // ---------------------------------------------------------------------------

  private registerSequenceNode(
    source: AudioScheduledSourceNode,
    gainNode: GainNode,
    extraNodes: AudioNode[],
    seqToken?: number,
    scheduledStartTime?: number
  ): void {
    const disconnectAll = () => {
      try {
        source.disconnect();
      } catch {
        // ignore
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

    if (seqToken !== undefined && (this.disposed || seqToken !== this.activeSeqToken)) {
      try {
        source.stop();
      } catch {
        // ignore
      }
      disconnectAll();
      return;
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.activeCleanupFns.delete(cleanup);
      const ctx = this.ctx;
      if (ctx) {
        const now = ctx.currentTime;
        const notStartedYet = scheduledStartTime !== undefined && now < scheduledStartTime - 0.001;
        try {
          gainNode.gain.cancelScheduledValues(now);
          if (notStartedYet) {
            gainNode.gain.setValueAtTime(0.0001, now);
          } else {
            const curVal = Math.min(0.35, Math.max(0.0001, gainNode.gain.value));
            gainNode.gain.setValueAtTime(curVal, now);
            gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.008);
          }
        } catch {
          // ignore
        }
        try {
          source.stop(notStartedYet ? now : now + 0.01);
        } catch {
          // already stopped
        }
      } else {
        try {
          source.stop();
        } catch {
          // ignore
        }
      }
      if (typeof window !== 'undefined') {
        window.setTimeout(disconnectAll, 20);
      } else {
        disconnectAll();
      }
    };

    if (seqToken !== undefined) {
      this.activeCleanupFns.add(cleanup);
    }

    source.onended = () => {
      if (cleaned) return;
      cleaned = true;
      if (seqToken !== undefined) {
        this.activeCleanupFns.delete(cleanup);
      }
      disconnectAll();
    };
  }

  private registerSequenceTimeout(delayMs: number, seqToken: number, fn: () => void): () => void {
    if (this.disposed || seqToken !== this.activeSeqToken || typeof window === 'undefined') {
      return () => {};
    }
    let firedOrCancelled = false;
    let id = 0;
    const cancel = () => {
      if (firedOrCancelled) return;
      firedOrCancelled = true;
      this.activeCleanupFns.delete(cancel);
      window.clearTimeout(id);
    };
    id = window.setTimeout(() => {
      if (firedOrCancelled) return;
      firedOrCancelled = true;
      this.activeCleanupFns.delete(cancel);
      if (this.disposed || seqToken !== this.activeSeqToken) return;
      fn();
    }, Math.max(0, delayMs));
    this.activeCleanupFns.add(cancel);
    return cancel;
  }

  private playSoloBugleTaps(startTime: number, seqToken?: number): void {
    if (!this.ctx || !this.musicGain) return;
    const phrase: Array<{ freq: number; offset: number; dur: number; gain: number }> = [
      { freq: 220.0, offset: 0.0, dur: 0.38, gain: 0.14 },
      { freq: 220.0, offset: 0.4, dur: 0.18, gain: 0.15 },
      { freq: 293.66, offset: 0.6, dur: 0.85, gain: 0.18 },
      { freq: 220.0, offset: 1.52, dur: 0.22, gain: 0.14 },
      { freq: 293.66, offset: 1.76, dur: 0.22, gain: 0.16 },
      { freq: 369.99, offset: 2.0, dur: 1.15, gain: 0.19 },
    ];
    for (const n of phrase) {
      this.triggerBrassOrSynthNote(n.freq, n.dur, n.gain, startTime + n.offset, seqToken);
    }
  }

  private triggerHollowGong(
    startTime: number,
    dur: number,
    peakGain: number,
    seqToken?: number
  ): void {
    if (!this.ctx || !this.musicGain) return;
    const partials = [110.0, 156.2, 234.3, 321.8, 468.0];
    partials.forEach((f, idx) => {
      const g = peakGain / (1 + idx * 0.65);
      this.triggerTone(f * 1.008, f * 0.994, dur * (1 - idx * 0.1), 'sine', g, startTime, 2800, 0, this.musicGain!, seqToken);
    });
  }

  private triggerBrassSwell(
    freq: number,
    dur: number,
    peakGain: number,
    startTime: number,
    seqToken?: number
  ): void {
    if (!this.ctx || !this.musicGain) return;
    for (const detune of [0.996, 1.004]) {
      const osc = this.ctx.createOscillator();
      const filt = this.ctx.createBiquadFilter();
      const formant = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq * detune, startTime);
      osc.frequency.linearRampToValueAtTime(freq * detune * 1.012, startTime + dur);

      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(380, startTime);
      filt.frequency.exponentialRampToValueAtTime(1750, startTime + dur);

      formant.type = 'peaking';
      formant.frequency.setValueAtTime(760, startTime);
      formant.Q.value = 2.2;
      formant.gain.value = 4.0;

      g.gain.setValueAtTime(0.002, startTime);
      g.gain.exponentialRampToValueAtTime(peakGain * 0.55, startTime + dur * 0.9);
      g.gain.linearRampToValueAtTime(0.001, startTime + dur);

      osc.connect(filt);
      filt.connect(formant);
      formant.connect(g);
      g.connect(this.musicGain);
      this.registerSequenceNode(osc, g, [filt, formant], seqToken, startTime);
      osc.start(startTime);
      osc.stop(startTime + dur + 0.02);
    }
  }

  /**
   * Wide-domain soft-clip curve:
   * With `preClipGain = 1 / K`, input `x in [-K, K]` maps to `u = x / K in [-1, 1]`.
   * `curve[i] = a * tanh((K * u) / a)` gives 0 dB slope at x=0 and peak `<= a < 1.0`.
   */
  private buildSoftClipCurve(k: number, a: number): Float32Array<ArrayBuffer> {
    const samples = 2048;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    for (let i = 0; i < samples; i++) {
      const u = (i * 2) / (samples - 1) - 1;
      curve[i] = a * Math.tanh((k * u) / a);
    }
    return curve;
  }

  private buildWarmWarRoomImpulse(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * durationSec);
    const impulse = ctx.createBuffer(2, len, rate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      let energy = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const white = Math.random() * 2 - 1;
        const damp = Math.max(0.07, 0.52 * Math.exp(-t * 2.3));
        lp = lp + damp * (white - lp);
        const earlyBoost =
          Math.abs(t - (ch === 0 ? 0.018 : 0.022)) < 0.002 ||
          Math.abs(t - (ch === 0 ? 0.036 : 0.04)) < 0.002
            ? 1.6
            : 1.0;
        const env = Math.pow(1 - t / durationSec, 2.55) * earlyBoost;
        const sample = lp * env;
        data[i] = sample;
        energy += sample * sample;
      }
      // Energy-normalize IR so total convolution power gain equals ~0.42 (-7.5 dB before reverbSend)
      // rather than raw un-normalized sqrt(N) (+23 dB) boom!
      const normScale = 0.62 / Math.max(1e-4, Math.sqrt(energy));
      for (let i = 0; i < len; i++) {
        data[i] = data[i]! * normScale;
      }
    }
    return impulse;
  }

  private buildCachedNoiseBuffers(ctx: AudioContext): void {
    const len = ctx.sampleRate * 3;
    this.whiteNoiseCache = ctx.createBuffer(1, len, ctx.sampleRate);
    this.pinkBrownCache = ctx.createBuffer(1, len, ctx.sampleRate);
    const wData = this.whiteNoiseCache.getChannelData(0);
    const bData = this.pinkBrownCache.getChannelData(0);
    let last = 0;
    let maxAbs = 0.0001;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      wData[i] = w * 0.92;
      last = (last + 0.05 * w) / 1.05;
      bData[i] = last;
      const abs = Math.abs(last);
      if (abs > maxAbs) maxAbs = abs;
    }
    // Peak-normalize pink/brown buffer to <= 0.92 to prevent downstream saturator railing
    const scale = 0.92 / maxAbs;
    for (let i = 0; i < len; i++) {
      bData[i] = bData[i]! * scale;
    }
  }

  private triggerHeartbeatLubDub(startTime: number, gain: number, seqToken?: number): void {
    if (!this.ctx || !this.heartbeatBypassBus) return;
    this.triggerTone(62, 31, 0.15, 'sine', gain, startTime, 130, 0, this.heartbeatBypassBus, seqToken);
    this.triggerFilteredNoise('brown', 0.09, 95, gain * 0.45, startTime, 1.2, 0, this.heartbeatBypassBus, seqToken);
    this.triggerTone(76, 36, 0.13, 'sine', gain * 0.85, startTime + 0.135, 155, 0, this.heartbeatBypassBus, seqToken);
    this.triggerFilteredNoise('brown', 0.075, 120, gain * 0.35, startTime + 0.135, 1.4, 0, this.heartbeatBypassBus, seqToken);
  }

  private triggerZimmerBraaam(
    fundamentalHz: number,
    dur: number,
    peakGain: number,
    startTime: number,
    dest: AudioNode,
    seqToken?: number
  ): void {
    if (!this.ctx) return;
    for (const detune of [0.993, 1.0, 1.007]) {
      this.triggerTone(
        fundamentalHz * detune,
        fundamentalHz * detune * 0.985,
        dur,
        'sawtooth',
        peakGain * 0.38,
        startTime,
        920,
        0,
        dest,
        seqToken
      );
    }
    this.triggerTone(fundamentalHz * 0.5, fundamentalHz * 0.49, dur, 'sine', peakGain * 0.65, startTime, 180, 0, dest, seqToken);
  }

  private triggerHowitzerShot(
    startTime: number,
    pan: number,
    intensity: number,
    seqToken?: number
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    this.triggerFilteredNoise('white', 0.035, 2900, 0.28 * intensity, startTime, 0.9, pan, this.sfxGain, seqToken);
    this.triggerFilteredNoise('brown', 0.32, 420, 0.32 * intensity, startTime + 0.005, 0.7, pan, this.sfxGain, seqToken);
    this.triggerTone(135, 30, 0.36, 'sine', 0.36 * intensity, startTime, 320, pan, this.sfxGain, seqToken);
  }

  private triggerHeavyGunshotWithCasing(
    startTime: number,
    pan: number,
    pitchScale: number,
    seqToken?: number
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    this.triggerFilteredNoise('white', 0.024, 2700 * pitchScale, 0.22, startTime, 1.1, pan, this.sfxGain, seqToken);
    this.triggerFilteredNoise('brown', 0.07, 740 * pitchScale, 0.2, startTime + 0.003, 0.85, pan, this.sfxGain, seqToken);
    this.triggerTone(190 * pitchScale, 46, 0.058, 'sine', 0.22, startTime, 1200, pan, this.sfxGain, seqToken);
    if (Math.random() < 0.5) {
      this.triggerMetallicPing(3900 + Math.random() * 900, 0.026, 0.035, startTime + 0.085, pan * 0.85, this.sfxGain, seqToken);
    }
  }

  private triggerArmorRicochet(
    startTime: number,
    pan: number,
    rising: boolean,
    seqToken?: number
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    this.triggerMetallicPing(1420, 0.07, 0.12, startTime, pan, this.sfxGain, seqToken);
    this.triggerTone(
      rising ? 980 : 3200,
      rising ? 3350 : 760,
      0.13,
      'sine',
      0.11,
      startTime + 0.006,
      4600,
      -pan * 0.6,
      this.sfxGain,
      seqToken
    );
  }

  private triggerHeavyExplosion(
    startTime: number,
    pan: number,
    intensity: number,
    decaySec = 1.2,
    seqToken?: number
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const d = Math.max(0.55, decaySec);
    this.triggerFilteredNoise('white', 0.055, 2800, 0.26 * intensity, startTime, 0.65, pan, this.sfxGain, seqToken);
    this.triggerTone(108, 20, Math.min(0.88, d * 0.72), 'sine', 0.36 * intensity, startTime, 240, pan, this.sfxGain, seqToken);
    this.triggerTone(155, 28, Math.min(0.46, d * 0.42), 'sawtooth', 0.19 * intensity, startTime, 320, pan, this.sfxGain, seqToken);

    if (this.pinkBrownCache) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.pinkBrownCache;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1650, startTime);
      lp.frequency.exponentialRampToValueAtTime(95, startTime + d);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.28 * intensity, startTime);
      g.gain.exponentialRampToValueAtTime(0.002, startTime + d);

      const extras = this.connectWithPan(src, lp, g, pan, this.sfxGain);
      this.registerSequenceNode(src, g, [lp, ...extras], seqToken, startTime);
      src.start(startTime, 0, d + 0.05);
    }

    for (let s = 0; s < 5; s++) {
      const st = startTime + 0.11 + s * 0.09;
      const sp = Math.max(-0.92, Math.min(0.92, pan + (s % 2 === 0 ? -0.4 : 0.4)));
      const freq = 1350 + ((s * 510) % 1800);
      this.triggerMetallicPing(freq, 0.065, 0.055 * intensity, st, sp, this.sfxGain, seqToken);
    }
  }

  private triggerBrassChord(
    freqs: readonly number[],
    dur: number,
    totalGain: number,
    startTime: number,
    seqToken?: number
  ): void {
    const perNote = totalGain / Math.max(1, Math.sqrt(freqs.length));
    for (const f of freqs) {
      this.triggerBrassOrSynthNote(f, dur, perNote, startTime, seqToken);
    }
  }

  /**
   * Deeply Differentiated Dual-Era Brass Voice:
   * - `1980s`: 2-Op FM Synth Brass (carrier sawtooth + modulator FM index `1.8 -> 0.35` over `120ms` + chorus pair + `2400Hz` LP).
   * - `1970s`: Formant Orchestral Brass (dual detuned `sawtooth` `±0.4%`, `-1.2% -> 0%` `28ms` lip scoop, delayed `5.4Hz` vibrato LFO,
   *   `380 -> 2200Hz` LP sweep, parallel `720Hz`/`1180Hz` bell formants, and `18ms` breath-chiff noise burst).
   */
  private triggerBrassOrSynthNote(
    freq: number,
    dur: number,
    gainPeak: number,
    startTime: number,
    seqToken?: number
  ): void {
    if (!this.ctx || !this.musicGain) return;

    if (this.eraMode === '1980s') {
      this.triggerFmSynthTone(freq * 0.996, 1.0, 1.8, dur, gainPeak * 0.62, startTime, -0.16, this.musicGain, seqToken);
      this.triggerFmSynthTone(freq * 1.004, 1.0, 1.6, dur, gainPeak * 0.56, startTime, 0.16, this.musicGain, seqToken);
      return;
    }

    // 1970s Classic Formant Orchestral Brass
    const ctx = this.ctx;
    // Breath-chiff transient (`18ms` filtered white noise)
    this.triggerFilteredNoise('white', 0.018, 2200, gainPeak * 0.32, startTime, 1.8, 0, this.musicGain, seqToken);

    // Delayed `5.4Hz` lip vibrato LFO shared across the dual sawtooth voices
    const vibLfo = ctx.createOscillator();
    const vibDepth = ctx.createGain();
    vibLfo.type = 'sine';
    vibLfo.frequency.setValueAtTime(5.4, startTime);
    vibDepth.gain.setValueAtTime(0.0, startTime);
    vibDepth.gain.setValueAtTime(0.0, startTime + Math.min(0.12, dur * 0.3));
    vibDepth.gain.linearRampToValueAtTime(freq * 0.0055, startTime + Math.min(0.24, dur * 0.6));

    for (const [idx, detune] of ([0.996, 1.004] as const).entries()) {
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const formant1 = ctx.createBiquadFilter();
      const formant2 = ctx.createBiquadFilter();
      const g = ctx.createGain();

      osc.type = 'sawtooth';
      const targetHz = freq * detune;
      // `-1.2% -> 0%` `28ms` lip scoop
      osc.frequency.setValueAtTime(Math.max(20, targetHz * 0.988), startTime);
      osc.frequency.linearRampToValueAtTime(Math.max(20, targetHz), startTime + Math.min(0.028, dur * 0.2));
      vibLfo.connect(vibDepth);
      vibDepth.connect(osc.frequency);

      // LP brass flare (`380 -> 2200Hz` over `45ms`)
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(380, startTime);
      lp.frequency.exponentialRampToValueAtTime(2200, startTime + Math.min(0.045, dur * 0.3));
      lp.Q.value = 1.1;

      // Parallel bell formants (`720Hz` + `1180Hz`)
      formant1.type = 'peaking';
      formant1.frequency.setValueAtTime(720, startTime);
      formant1.Q.value = 2.6;
      formant1.gain.value = 4.5;

      formant2.type = 'peaking';
      formant2.frequency.setValueAtTime(1180, startTime);
      formant2.Q.value = 3.0;
      formant2.gain.value = 3.2;

      g.gain.setValueAtTime(0.0008, startTime);
      g.gain.linearRampToValueAtTime(gainPeak * (idx === 0 ? 0.56 : 0.5), startTime + Math.min(0.032, dur * 0.25));
      g.gain.exponentialRampToValueAtTime(0.0006, startTime + dur);

      osc.connect(lp);
      lp.connect(formant1);
      formant1.connect(formant2);
      formant2.connect(g);
      const extras = this.connectWithPan(g, g, g, idx === 0 ? -0.14 : 0.14, this.musicGain, true);
      this.registerSequenceNode(osc, g, [lp, formant1, formant2, ...extras], seqToken, startTime);
      osc.start(startTime);
      osc.stop(startTime + dur + 0.02);
    }

    this.registerSequenceNode(vibLfo, vibDepth, [], seqToken, startTime);
    vibLfo.start(startTime);
    vibLfo.stop(startTime + dur + 0.02);
  }

  private triggerFmSynthTone(
    freq: number,
    modRatio: number,
    modIndex: number,
    dur: number,
    peakGain: number,
    startTime: number,
    pan: number,
    dest: AudioNode,
    seqToken?: number
  ): void {
    if (!this.ctx) return;
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(Math.max(20, freq), startTime);

    mod.type = 'sine';
    mod.frequency.setValueAtTime(Math.max(20, freq * modRatio), startTime);
    modGain.gain.setValueAtTime(freq * modIndex, startTime);
    modGain.gain.exponentialRampToValueAtTime(Math.max(4, freq * 0.32), startTime + Math.min(0.14, dur * 0.7));

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, startTime);

    g.gain.setValueAtTime(0.0008, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.015, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0006, startTime + dur);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const extras = this.connectWithPan(carrier, lp, g, pan, dest);
    this.registerSequenceNode(carrier, g, [lp, modGain, ...extras], seqToken, startTime);
    this.registerSequenceNode(mod, modGain, [], seqToken, startTime);
    carrier.start(startTime);
    mod.start(startTime);
    carrier.stop(startTime + dur + 0.02);
    mod.stop(startTime + dur + 0.02);
  }

  private triggerMetallicPing(
    baseFreq: number,
    dur: number,
    peakGain: number,
    startTime: number,
    pan: number,
    dest: AudioNode | null = this.sfxGain,
    seqToken?: number
  ): void {
    if (!this.ctx || !dest) return;
    this.triggerTone(baseFreq, baseFreq * 0.98, dur, 'sine', peakGain, startTime, 5800, pan, dest, seqToken);
    this.triggerTone(baseFreq * 2.41, baseFreq * 2.36, dur * 0.65, 'sine', peakGain * 0.45, startTime, 6800, pan, dest, seqToken);
  }

  private triggerTone(
    startFreq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    peakGain: number,
    startTime: number,
    lowpassHz: number,
    pan: number,
    dest: AudioNode,
    seqToken?: number
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const filt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(18, startFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, endFreq), startTime + dur);

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(lowpassHz, startTime);

    g.gain.setValueAtTime(0.0008, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.014, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0006, startTime + dur);

    const extras = this.connectWithPan(osc, filt, g, pan, dest);
    this.registerSequenceNode(osc, g, [filt, ...extras], seqToken, startTime);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private triggerFilteredNoise(
    color: 'white' | 'brown',
    dur: number,
    bandFreq: number,
    peakGain: number,
    startTime: number,
    q: number,
    pan: number,
    dest: AudioNode,
    seqToken?: number
  ): void {
    this.triggerSweptNoise(color, dur, bandFreq, bandFreq, peakGain, startTime, q, pan, dest, seqToken);
  }

  private triggerSweptNoise(
    color: 'white' | 'brown',
    dur: number,
    startBandHz: number,
    endBandHz: number,
    peakGain: number,
    startTime: number,
    q: number,
    pan: number,
    dest: AudioNode,
    seqToken?: number
  ): void {
    if (!this.ctx) return;
    const buf = color === 'brown' ? this.pinkBrownCache : this.whiteNoiseCache;
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const maxOffset = Math.max(0, buf.duration - dur - 0.05);
    const offset = Math.random() * maxOffset;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(Math.max(40, startBandHz), startTime);
    if (Math.abs(startBandHz - endBandHz) > 1) {
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, endBandHz), startTime + dur);
    }
    filt.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peakGain, startTime);
    g.gain.exponentialRampToValueAtTime(0.0008, startTime + dur);

    const extras = this.connectWithPan(src, filt, g, pan, dest);
    this.registerSequenceNode(src, g, [filt, ...extras], seqToken, startTime);
    src.start(startTime, offset, dur + 0.02);
  }

  private connectWithPan(
    source: AudioNode,
    filter: AudioNode,
    gain: GainNode,
    pan: number,
    dest: AudioNode,
    skipSourceToFilter = false
  ): AudioNode[] {
    if (!this.ctx) return [];
    if (!skipSourceToFilter) {
      source.connect(filter);
      filter.connect(gain);
    }
    if (Math.abs(pan) > 0.01 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(dest);
      return [panner];
    }
    gain.connect(dest);
    return [];
  }
}
