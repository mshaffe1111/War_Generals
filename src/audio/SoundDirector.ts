import type {
  AppOptions,
  AudioEraMode,
  BattleResolutionKind,
  ClashPublicStakes,
} from '../core/types';

/**
 * Block 3 Procedural WebAudio Score, Mechanical/Warfield Foley, LFO Ambiance & Haptics Engine (`SoundDirector.ts`).
 *
 * Deterministic Zero-Network Signal Graph (0 external MP3/OGG 404s on GitHub Pages):
 *   ├── `ambianceGain` (LFO Canvas Wind + Sparse Raindrops + Oil-Lantern Crackle + 1Hz Watch Escapement)
 *   ├── `musicGain`    (1980s Piezo-Synth 1/8->1/16 Arpeggio | 1970s Snare Press-Roll & Timpani + Brass Chords / Taps)
 *   └── `sfxGain`      (Tabletop Wood/Brass Foley + Drawer/UI Detents + Warfield Artillery, Gunfire & Explosions)
 *          │
 *          ├── Battle Signals route through `arbiterBattleBus` -> `arbiterAnalyser` (`fftSize = 512`,
 *          │   `getByteTimeDomainData` & `getByteFrequencyData` @ 60 FPS for 3D CRT + 3D Vacuum-Tube Equalizer!)
 *          ▼
 *     `vacuumDuckBus` (drops to `-infinity dB` during Strachan Pre-Verdict Vacuum; bypassed by `heartbeatBus`)
 *          ├──> Procedural Warm-Room & Canyon Stereo `ConvolverNode` (`2.1s` impulse response)
 *          └──> `2x` Oversampled `tanh` Tube `WaveShaperNode` -> `62Hz` Sub-Bass Shelf
 *                    └──> Master `DynamicsCompressorNode` -> `masterGain` -> `ctx.destination`
 */
export class SoundDirector {
  private ctx: AudioContext | null = null;

  // 4 Independent Mixer Gain Buses + Battle Telemetry & Vacuum Buses
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambianceGain: GainNode | null = null;

  private arbiterBattleBus: GainNode | null = null;
  private arbiterAnalyser: AnalyserNode | null = null;
  private vacuumDuckBus: GainNode | null = null;
  private heartbeatBypassBus: GainNode | null = null;

  private convolver: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private saturator: WaveShaperNode | null = null;
  private subShelf: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private whiteNoiseCache: AudioBuffer | null = null;
  private pinkBrownCache: AudioBuffer | null = null;

  private muted = false;
  private masterVol = 0.9;
  private musicVol = 0.85;
  private sfxVol = 0.95;
  private ambianceVol = 0.75;
  private hapticsEnabled = true;
  private eraMode: AudioEraMode = '1980s';

  private ambienceStarted = false;
  private inBattleVacuum = false;
  private turnWarningUrgent = false;
  private ambienceTimer: number | null = null;
  private watchHalfSecTick = 0;
  private activeCleanupFns: Array<() => void> = [];

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // 1. Master Brickwall Peak Limiter / DynamicsCompressor (protects mobile phone speakers!)
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -11.5;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 8.5;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.16;

      // 2. Cinema Sub-Bass Shelf (`62Hz`, `+4.8dB`) + Analog Tube `WaveShaperNode`
      this.subShelf = ctx.createBiquadFilter();
      this.subShelf.type = 'lowshelf';
      this.subShelf.frequency.value = 62;
      this.subShelf.gain.value = 4.8;

      this.saturator = ctx.createWaveShaper();
      this.saturator.curve = this.buildAnalogSaturationCurve(1.75);
      this.saturator.oversample = '2x';

      // 3. Procedural Stereo Warm War-Room & Canyon Convolution Reverb (`2.05s`)
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = this.buildWarmWarRoomImpulse(ctx, 2.05);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.34;

      // 4. Four Independent Gain Buses (`Master`, `Music`, `SFX`, `Ambiance`)
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.88;

      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = this.musicVol;

      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = this.sfxVol;

      this.ambianceGain = ctx.createGain();
      this.ambianceGain.gain.value = this.ambianceVol * 0.32;

      // 5. Dedicated Arbiter Battle Bus + `fftSize = 512` `AnalyserNode` for 60 FPS 3D CRT & Vacuum Tubes!
      this.arbiterBattleBus = ctx.createGain();
      this.arbiterBattleBus.gain.value = 1.0;

      this.arbiterAnalyser = ctx.createAnalyser();
      this.arbiterAnalyser.fftSize = 512;
      this.arbiterAnalyser.smoothingTimeConstant = 0.58;

      // 6. Vacuum Ducking Bus (silences ambiance/reverb during the Strachan Heartbeat Drop!)
      this.vacuumDuckBus = ctx.createGain();
      this.vacuumDuckBus.gain.value = 1.0;

      this.heartbeatBypassBus = ctx.createGain();
      this.heartbeatBypassBus.gain.value = 1.0;

      // Connect 4-Bus + Analyser Graph:
      // - Battle Music & Battle SFX feed `arbiterBattleBus` -> `arbiterAnalyser` -> `vacuumDuckBus`
      // - Tabletop/UI SFX & Ambiance also feed `vacuumDuckBus`
      // - `heartbeatBypassBus` feeds BOTH `arbiterAnalyser` (so heartbeat pulses the 3D CRT/Tubes!) AND `saturator` directly!
      this.arbiterBattleBus.connect(this.arbiterAnalyser);
      this.arbiterAnalyser.connect(this.vacuumDuckBus);

      this.musicGain.connect(this.arbiterBattleBus);
      this.sfxGain.connect(this.arbiterBattleBus);
      this.ambianceGain.connect(this.vacuumDuckBus);

      this.vacuumDuckBus.connect(this.saturator);
      this.vacuumDuckBus.connect(this.reverbSend);
      this.reverbSend.connect(this.convolver);
      this.convolver.connect(this.saturator);

      this.heartbeatBypassBus.connect(this.saturator);
      this.heartbeatBypassBus.connect(this.arbiterAnalyser);

      this.saturator.connect(this.subShelf);
      this.subShelf.connect(this.compressor);
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      this.buildCachedNoiseBuffers(ctx);
      this.startWarRoomAmbience(ctx);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /**
   * Synchronizes all 4 independent mixer buses (`Master`, `Music`, `SFX`, `Ambiance`), Era Mode, & Haptics.
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
    >
  ): void {
    this.muted = opts.audioMuted;
    this.masterVol = opts.masterVolume;
    this.musicVol = opts.musicVolume;
    this.sfxVol = opts.sfxVolume;
    this.ambianceVol = opts.ambianceVolume;
    this.hapticsEnabled = opts.hapticsEnabled;
    this.eraMode = opts.eraMode;

    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain?.gain.setTargetAtTime(this.muted ? 0 : this.masterVol * 0.92, t, 0.02);
    this.musicGain?.gain.setTargetAtTime(this.musicVol, t, 0.03);
    this.sfxGain?.gain.setTargetAtTime(this.sfxVol, t, 0.03);
    this.ambianceGain?.gain.setTargetAtTime(this.ambianceVol * 0.32, t, 0.05);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.masterVol * 0.92, this.ctx.currentTime, 0.02);
    }
  }

  public setEraMode(mode: AudioEraMode): void {
    this.eraMode = mode;
  }

  /**
   * Toggles final 10-second turn-warning urgency on the 1Hz mechanical pocket-watch escapement!
   */
  public setTurnWarningUrgent(urgent: boolean): void {
    this.turnWarningUrgent = urgent;
  }

  /**
   * Safe Mobile Haptic Choreography Wrapper (`navigator.vibrate`):
   * Graceful no-op on iOS Safari / desktop; crisp tactile pulses on Android Chrome / Pixel hardware.
   */
  public vibrate(pattern: number | number[]): void {
    if (!this.hapticsEnabled || this.muted) return;
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
    if (!this.arbiterAnalyser || !this.ctx || this.ctx.state !== 'running' || this.muted) {
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
    if (!this.arbiterAnalyser || !this.ctx || this.ctx.state !== 'running' || this.muted) {
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
  // Section 3: Tactile Tabletop & UI Foley (`10ms` / `18ms` Haptics)
  // ---------------------------------------------------------------------------

  /**
   * UI Controls: Micro-machined brass detent click (`1800Hz` impulse, `18ms`) with subtle pitch variation.
   */
  public playUiClick(): void {
    this.unlock();
    this.vibrate(10);
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const pitchVar = 0.94 + Math.random() * 0.12;
    this.triggerTone(
      1800 * pitchVar,
      1420 * pitchVar,
      0.018,
      'triangle',
      0.16,
      now,
      5400,
      0,
      this.sfxGain
    );
    this.triggerFilteredNoise('white', 0.012, 3200 * pitchVar, 0.08, now, 2.5, 0, this.sfxGain);
  }

  /**
   * Piece Pick-Up: Crisp wooden fingertip tap + subtle brass insignia ring (`2400Hz` damped sine micro-ping).
   */
  public playPiecePickup(): void {
    this.unlock();
    this.vibrate(10);
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Crisp walnut fingertip tap
    this.triggerTone(430, 155, 0.038, 'triangle', 0.22, now, 1600, 0, this.sfxGain);
    this.triggerFilteredNoise('white', 0.016, 1950, 0.11, now, 2.0, 0, this.sfxGain);
    // Subtle `2400Hz` damped sine brass-insignia micro-ping!
    this.triggerTone(2400, 2385, 0.075, 'sine', 0.095, now + 0.006, 5200, 0, this.sfxGain);
  }

  /**
   * Legacy alias routing straight to `playUiClick` for HUD controls.
   */
  public playSelect(): void {
    this.playUiClick();
  }

  /**
   * Orthogonal Tile Slide & Drop (`90ms` slate friction whoosh + `115Hz` polymer-on-slate thud + `800Hz` bevel click).
   */
  public playMoveSlide(veteranKills = 0): void {
    this.unlock();
    this.vibrate(18);
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const weightMul = veteranKills >= 2 ? 0.82 : 1.0;

    // 1. `90ms` low-pass filtered slate friction whoosh (`880Hz -> 250Hz`)
    this.triggerSweptNoise(
      'brown',
      0.09,
      880 * weightMul,
      250 * weightMul,
      0.22,
      now,
      1.3,
      0,
      this.sfxGain
    );

    // 2. Weighted matte polymer-on-slate thud (`115Hz` pitch-envelope drop) + `800Hz` bevel click!
    const dropTime = now + 0.078;
    this.triggerTone(
      115 * weightMul,
      38 * weightMul,
      0.095,
      'sine',
      veteranKills >= 2 ? 0.42 : 0.3,
      dropTime,
      620,
      0,
      this.sfxGain
    );
    this.triggerTone(
      800 * weightMul,
      540 * weightMul,
      0.026,
      'triangle',
      0.16,
      dropTime,
      2800,
      0,
      this.sfxGain
    );
  }

  /**
   * Mobilization / HUD Drawer: Velvet-damped wooden drawer slide + magnetic snap click!
   */
  public playDrawerSlide(opening = true): void {
    this.unlock();
    this.vibrate(10);
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const fStart = opening ? 260 : 520;
    const fEnd = opening ? 520 : 240;
    this.triggerSweptNoise('brown', 0.14, fStart, fEnd, 0.18, now, 1.4, 0, this.sfxGain);
    // Neodymium magnetic latch snap at travel end (`+115ms`)
    this.playMagneticSnap(now + 0.115);
  }

  public playMagneticSnap(atTime?: number): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const t = atTime ?? this.ctx.currentTime;
    this.triggerTone(2180, 1450, 0.022, 'triangle', 0.13, t, 4800, 0, this.sfxGain);
    this.triggerTone(340, 120, 0.03, 'sine', 0.14, t, 900, 0, this.sfxGain);
  }

  // ---------------------------------------------------------------------------
  // Section 4: 3-Act Dual-Era Score + Warfield Ballistics + Heartbeat Vacuum
  // ---------------------------------------------------------------------------

  /**
   * Act 1 Lock-In (`0.0s – 0.78s`):
   * - Haptics: `[35, 45, 40]`
   * - Motorized gunmetal shutter/servo whirr (`220Hz -> 340Hz` filtered saw)
   * - Heavy brass Attack Medallion slam onto slate
   * - Twin staggered spring-loaded brass pad impacts (`75Hz` sub-punch + coil-spring resonance + high-voltage spark snap)
   */
  public playAct1LockIn(speedScale = 1, stakes?: ClashPublicStakes): void {
    this.unlock();
    this.stopActiveSequence();
    this.vibrate([35, 45, 40]);
    if (!this.ctx || !this.sfxGain || !this.musicGain || !this.vacuumDuckBus || this.muted) return;

    const now = this.ctx.currentTime;
    const inv = 1 / Math.max(0.5, speedScale);
    this.inBattleVacuum = false;
    this.turnWarningUrgent = false;
    this.vacuumDuckBus.gain.cancelScheduledValues(now);
    this.vacuumDuckBus.gain.setValueAtTime(1.0, now);

    const atkPan = stakes?.isEnemyInitiatedAmbush ? 0.52 : -0.52;
    const defPan = -atkPan;

    // 1. Motorized gunmetal servo/shutter whirr (`220Hz -> 340Hz` filtered sawtooth)
    this.triggerTone(220, 340, 0.28 * inv, 'sawtooth', 0.18, now + 0.01, 1150, 0, this.sfxGain);
    this.triggerFilteredNoise('brown', 0.24 * inv, 620, 0.22, now + 0.01, 1.0, 0, this.sfxGain);

    // 2. Heavy brushed-brass Attack Medallion slam onto slate (`+0.16s`)
    this.triggerTone(135, 42, 0.14, 'sine', 0.38, now + 0.16 * inv, 680, 0, this.sfxGain);
    this.triggerMetallicPing(1940, 0.09, 0.22, now + 0.16 * inv, 0, this.sfxGain);

    // 3. Twin staggered spring-loaded brass pad impacts (`75Hz` sub-punch + coil-spring chirp + HV spark snap!)
    for (const [idx, delay] of ([0.22 * inv, 0.34 * inv] as const).entries()) {
      const pan = idx === 0 ? atkPan : defPan;
      // 75Hz sub-punch
      this.triggerTone(78, 30, 0.26, 'sine', 0.54, now + delay, 320, pan, this.sfxGain);
      // Metallic coil-spring resonance (`520Hz -> 880Hz` harmonic bounce)
      this.triggerTone(520, 880, 0.11, 'triangle', 0.16, now + delay + 0.01, 2900, pan, this.sfxGain);
      // High-voltage contact spark snap!
      this.triggerFilteredNoise('white', 0.035, 3600, 0.24, now + delay + 0.012, 2.2, pan, this.sfxGain);
    }

    // 4. DEFCON 1 / Covert Spy Musical Signature on `musicGain`!
    if (stakes?.defcon === 1) {
      this.triggerZimmerBraaam(73.42, 0.78 * inv, 0.34, now + 0.14 * inv, this.musicGain); // D2 Braaam!
    } else if (stakes?.playerDoctrine === 'COVERT_SPY') {
      this.triggerTone(1480, 1472, 0.42, 'sine', 0.2, now + 0.26 * inv, 3800, -0.25, this.musicGain);
    }
  }

  /**
   * Act 2A Arbitrating Escalation (`0.78s – tPushEnd`):
   * - Haptics: `[12, 60, 12, 50, 15, 40, 20]`
   * - `1980s` Mode: Dual-oscillator analog piezo-synth tension arpeggio (`1/8 -> 1/16` notes) + throbbing `55Hz` bass pulse + Jacob's-ladder arc sizzle + Warfield gunfire!
   * - `1970s` Mode: Tight military snare press-roll crescendo + deep orchestral timpani heartbeats + tense brass swells + Warfield cannon salvos!
   */
  public playAct2SuppressionPush(
    pushDurSec: number,
    attackerIsPlayer: boolean,
    defcon: 1 | 2 | 3
  ): void {
    this.unlock();
    this.vibrate([12, 60, 12, 50, 15, 40, 20]);
    if (!this.ctx || !this.musicGain || !this.sfxGain || this.muted) return;

    const now = this.ctx.currentTime;
    const atkPan = attackerIsPlayer ? -0.58 : 0.58;
    const defPan = -atkPan;

    if (this.eraMode === '1980s') {
      // 1980s ELECTRONIC MODE:
      // A) Escalating Dual-Oscillator Analog Piezo-Synth Tension Arpeggio (`1/8` `175ms` -> `1/16` `82ms`!)
      const arpNotes = [146.83, 174.61, 220.0, 233.08, 293.66, 349.23, 440.0, 466.16]; // D minor / Bb6 tension!
      let tCursor = 0.02;
      let step = 0;
      while (tCursor < pushDurSec - 0.05) {
        const prog = tCursor / Math.max(0.2, pushDurSec);
        const noteDur = Math.max(0.078, 0.175 * (1 - prog * 0.54)); // 1/8 -> 1/16 acceleration!
        const freq = arpNotes[step % arpNotes.length]! * (defcon === 1 ? 1.0 : 1.0);
        const pan = (step % 2 === 0 ? -1 : 1) * 0.32;
        // Dual detuned piezo sawtooth + square oscillators
        this.triggerTone(
          freq * 0.997,
          freq,
          noteDur * 0.88,
          'sawtooth',
          0.11 + prog * 0.09,
          now + tCursor,
          1400 + prog * 2200,
          pan,
          this.musicGain
        );
        this.triggerTone(
          freq * 1.004,
          freq,
          noteDur * 0.82,
          'square',
          0.07 + prog * 0.06,
          now + tCursor,
          1800 + prog * 1800,
          -pan,
          this.musicGain
        );
        tCursor += noteDur;
        step += 1;
      }

      // B) Throbbing `55Hz` Analog Bass Pulse
      let bassT = 0.0;
      while (bassT < pushDurSec - 0.08) {
        this.triggerTone(55, 52, 0.19, 'sawtooth', 0.26, now + bassT, 240, 0, this.musicGain);
        bassT += 0.22;
      }

      // C) Crackling Electrical Jacob's-Ladder Arc Sizzle (`sfxGain`)
      for (let a = 0; a < 7; a++) {
        const at = (a / 7) * (pushDurSec - 0.12);
        const arcPan = (a % 2 === 0 ? -1 : 1) * 0.38;
        this.triggerSweptNoise('white', 0.09, 2200, 4800, 0.12, now + at, 3.6, arcPan, this.sfxGain);
      }
    } else {
      // 1970s CLASSIC BRASS & SNARE MODE:
      // A) Tight Military Snare Press-Roll Crescendo (`24ms -> 13ms` rudimental buzz strokes!)
      let rollT = 0.02;
      let stroke = 0;
      while (rollT < pushDurSec - 0.03) {
        const prog = rollT / Math.max(0.2, pushDurSec);
        const gain = 0.05 + Math.pow(prog, 1.55) * 0.24;
        const pan = (stroke % 2 === 0 ? -1 : 1) * 0.16;
        // Snare wire rattle + drumhead snap
        this.triggerFilteredNoise('white', 0.026, 2650, gain, now + rollT, 1.4, pan, this.musicGain);
        this.triggerTone(215, 145, 0.022, 'triangle', gain * 0.75, now + rollT, 1100, pan, this.musicGain);
        rollT += Math.max(0.014, 0.026 * (1 - prog * 0.44));
        stroke += 1;
      }

      // B) Deep Orchestral Timpani Heartbeats (`D2 = 73.4Hz` & `A1 = 55Hz`)
      for (const [idx, tt] of [0.05, 0.38, 0.7, 0.98, 1.24].entries()) {
        if (tt < pushDurSec - 0.08) {
          const f = idx % 2 === 0 ? 73.42 : 55.0;
          this.triggerTone(f * 1.06, f, 0.28, 'sine', 0.36, now + tt, 260, 0, this.musicGain);
        }
      }

      // C) Tense Orchestral Brass Swell (`D3 + F3 + Ab3` diminished tension cluster!)
      for (const bf of [146.83, 174.61, 207.65]) {
        this.triggerBrassSwell(bf, pushDurSec * 0.94, 0.14, now + 0.04);
      }
    }

    // Layered Warfield Ballistics (`sfxGain`): Opening Howitzer + Directional Automatic Bursts + Armor Ricochets!
    this.triggerHowitzerShot(now + 0.03, atkPan, 0.78);

    const atkBursts = [0.18, 0.25, 0.32, 0.62, 0.69, 0.76, 1.04, 1.11, 1.18];
    for (const bt of atkBursts) {
      if (bt < pushDurSec - 0.08) {
        this.triggerHeavyGunshotWithCasing(now + bt, atkPan, 0.96);
      }
    }
    for (const bt of [0.46, 0.53, 0.88, 0.95]) {
      if (bt < pushDurSec - 0.1) {
        this.triggerHeavyGunshotWithCasing(now + bt, defPan, 1.16);
      }
    }
    for (const [idx, rt] of [0.34, 0.82].entries()) {
      if (rt < pushDurSec - 0.08) {
        this.triggerArmorRicochet(now + rt, defPan, idx % 2 === 0);
      }
    }
  }

  /**
   * Act 2B: "THE STRACHAN VACUUM" + `52Hz` Heartbeat + Sloped-Armor Deflection + Doppler `88mm` Shell!
   */
  public playStrachanVacuumAndHeartbeat(
    vacuumDurSec: number,
    isReversal: boolean,
    defenderPan: number
  ): void {
    this.unlock();
    if (!this.ctx || !this.vacuumDuckBus || !this.heartbeatBypassBus || this.muted) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.inBattleVacuum = true;

    // 1. Instant `-60dB` Vacuum Drop across Ambiance, Music & Reverberant SFX!
    this.vacuumDuckBus.gain.cancelScheduledValues(now);
    this.vacuumDuckBus.gain.setValueAtTime(this.vacuumDuckBus.gain.value, now);
    this.vacuumDuckBus.gain.linearRampToValueAtTime(0.0001, now + 0.018);

    // 2. Brick-Wall Armor Glacis Deflection Clang (on Reversals) OR Bullet-Time Sub-Drop!
    if (isReversal) {
      this.vibrate([25, 30, 25]);
      this.triggerMetallicPing(620, 0.32, 0.42, now, defenderPan, this.heartbeatBypassBus);
      this.triggerMetallicPing(1310, 0.24, 0.34, now + 0.005, defenderPan, this.heartbeatBypassBus);
      this.triggerTone(
        3400,
        690,
        0.26,
        'sine',
        0.24,
        now + 0.015,
        4800,
        -defenderPan * 0.7,
        this.heartbeatBypassBus
      );
    } else {
      this.triggerTone(145, 28, 0.22, 'sine', 0.42, now, 320, 0, this.heartbeatBypassBus);
    }

    // 3. Flesh-and-Bone `52Hz` Human Heartbeat (`LUB-DUB`) inside Pitch-Black Silence!
    const pulse1 = now + Math.min(0.14, vacuumDurSec * 0.18);
    this.triggerHeartbeatLubDub(pulse1, 0.65);
    if (vacuumDurSec >= 0.58) {
      this.triggerHeartbeatLubDub(pulse1 + 0.38, 0.76);
    }

    // 4. Screaming Incoming Doppler `88mm` Shell Whistle right before Act 3 Verdict!
    const whistleDur = Math.min(0.26, vacuumDurSec * 0.42);
    const whistleStart = now + Math.max(0.08, vacuumDurSec - whistleDur);
    const osc = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2150, whistleStart);
    osc.frequency.exponentialRampToValueAtTime(240, whistleStart + whistleDur);

    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(1900, whistleStart);
    filt.frequency.exponentialRampToValueAtTime(360, whistleStart + whistleDur);
    filt.Q.value = 3.8;

    g.gain.setValueAtTime(0.002, whistleStart);
    g.gain.exponentialRampToValueAtTime(0.32, whistleStart + whistleDur * 0.92);
    g.gain.linearRampToValueAtTime(0.001, whistleStart + whistleDur);

    osc.connect(filt);
    filt.connect(g);
    g.connect(this.heartbeatBypassBus);
    osc.start(whistleStart);
    osc.stop(whistleStart + whistleDur + 0.02);

    this.activeCleanupFns.push(() => {
      try {
        osc.stop();
      } catch {
        // stopped
      }
    });
  }

  /**
   * Act 3 Verdict (`t >= tVerdict`):
   * - Haptics: `[65, 30, 90]`
   * - Player Wins: Pneumatic hydraulic lift hiss + triumphant warm brass fifth chord (`D3–A3–F#4–D5`) + crystalline chime + right-channel relay clunk/blast!
   * - Player Loses (`ENEMY_WINS`): Low minor brass sting + power-down capacitor whine (`600Hz -> 45Hz`) + left-channel blast/drop!
   * - Mutual Split: Delayed 2-stage Kurosawa blast + dual electrical overload pop + twin clunks + hollow bronze gong decay!
   * - Match Victory / Defeat: Full Ceremonial Brass Fanfare (`FLAG_CAPTURED_BY_PLAYER`) or Solemn Solo Reverberant Bugle *Taps* (`FLAG_CAPTURED_BY_ENEMY`)!
   */
  public playAct3Outcome(resolution: BattleResolutionKind, isSpyIntercept = false): void {
    this.unlock();
    this.vibrate([65, 30, 90]);
    if (!this.ctx || !this.sfxGain || !this.musicGain || !this.vacuumDuckBus || this.muted) return;

    const now = this.ctx.currentTime;
    this.inBattleVacuum = false;
    this.vacuumDuckBus.gain.cancelScheduledValues(now);
    this.vacuumDuckBus.gain.setValueAtTime(1.0, now);

    // 1. MUTUAL SPLIT: Kurosawa Delayed Double-KO + Dual Electrical Overload Pop + Twin Clunks + Hollow Bronze Gong!
    if (resolution === 'MUTUAL_SPLIT') {
      this.triggerHeavyExplosion(now, 0.52, 1.02);
      // Thermal runaway / electrical overload arc warble before 2nd blast (`0.18s..0.44s`)
      this.triggerTone(620, 2350, 0.26, 'sawtooth', 0.2, now + 0.18, 3400, -0.52, this.sfxGain);
      // Dual electrical overload pop + Blast #2 + Twin mechanical clunks (`+0.46s`)
      this.triggerFilteredNoise('white', 0.04, 4200, 0.36, now + 0.45, 2.0, -0.45, this.sfxGain);
      this.triggerFilteredNoise('white', 0.04, 4200, 0.36, now + 0.46, 2.0, 0.45, this.sfxGain);
      this.triggerHeavyExplosion(now + 0.46, -0.52, 1.14);
      this.triggerTone(95, 34, 0.18, 'triangle', 0.38, now + 0.48, 480, -0.5, this.sfxGain);
      this.triggerTone(95, 34, 0.18, 'triangle', 0.38, now + 0.5, 480, 0.5, this.sfxGain);
      // Neutral Hollow Bronze Gong Decay (`1.85s` inharmonic FM bell resonance!)
      this.triggerHollowGong(now + 0.5, 1.85, 0.26);
      return;
    }

    // 2. PLAYER WINS CLASH (`PLAYER_WINS`)
    if (resolution === 'PLAYER_WINS') {
      // Right-channel detonation + power-cut relay clunk & drop thud (`pan = +0.52`)
      this.triggerHeavyExplosion(now, 0.52, 1.12);
      this.triggerMetallicPing(740, 0.06, 0.22, now + 0.08, 0.55, this.sfxGain);
      this.triggerTone(105, 34, 0.22, 'sine', 0.38, now + 0.12, 420, 0.55, this.sfxGain);

      // Left-channel pneumatic hydraulic lift hiss (`pan = -0.38`)
      this.triggerSweptNoise('white', 0.26, 1600, 3800, 0.14, now + 0.16, 1.8, -0.38, this.sfxGain);

      // Triumphant Warm Brass Fifth/Major Chord (`D3–A3–F#4–D5` = `146.83, 220.0, 369.99, 587.33Hz`) + Crystalline Chime!
      const fanStart = now + 0.24;
      if (isSpyIntercept) {
        const notes = [293.66, 369.99, 440.0, 587.33, 739.99];
        notes.forEach((f, i) => {
          this.triggerBrassOrSynthNote(f, 0.4, 0.22, fanStart + i * 0.065);
        });
      } else {
        this.triggerBrassChord([146.83, 220.0, 369.99, 587.33], 0.72, 0.3, fanStart);
      }
      // Crystalline victory chime (`D6 = 1174.66Hz` & `A6 = 1760Hz`)
      this.triggerTone(1174.66, 1174.66, 0.65, 'sine', 0.11, fanStart + 0.08, 6500, -0.2, this.musicGain);
      this.triggerTone(1760.0, 1760.0, 0.55, 'sine', 0.08, fanStart + 0.15, 7200, 0.2, this.musicGain);
      return;
    }

    // 3. PLAYER LOSES CLASH (`ENEMY_WINS`)
    if (resolution === 'ENEMY_WINS') {
      // Left-channel detonation + trapdoor drop thud (`pan = -0.52`)
      this.triggerHeavyExplosion(now, -0.52, 1.12);
      this.triggerTone(98, 30, 0.24, 'sine', 0.42, now + 0.12, 380, -0.52, this.sfxGain);

      // Power-down capacitor whine (`600Hz -> 45Hz`, `0.68s`)
      this.triggerTone(600, 45, 0.68, 'sawtooth', 0.18, now + 0.14, 1600, -0.42, this.sfxGain);

      // Low Minor Brass Sting (`D2–F2–Ab2–Db3`)
      this.triggerBrassChord([73.42, 87.31, 103.83, 138.59], 0.78, 0.28, now + 0.26);
      return;
    }

    // 4. MATCH VICTORY (`FLAG_CAPTURED_BY_PLAYER`): `0.95s` Unmasking Reveal + 3-Salvo Salute + Full Ceremonial Brass Fanfare!
    if (resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      this.triggerMetallicPing(1174.66, 0.55, 0.24, now + 0.04, 0.25, this.sfxGain);
      this.triggerZimmerBraaam(146.83, 0.85, 0.26, now + 0.05, this.musicGain);
      this.triggerHeavyExplosion(now + 0.95, 0.3, 1.0);
      this.triggerHeavyExplosion(now + 1.11, 0.5, 1.1);
      this.triggerHeavyExplosion(now + 1.27, 0.4, 1.18);

      const f0 = now + 1.34;
      this.triggerBrassChord([146.83, 220.0, 293.66], 0.28, 0.24, f0);
      this.triggerBrassChord([196.0, 293.66, 392.0], 0.26, 0.25, f0 + 0.24);
      this.triggerBrassChord([220.0, 329.63, 440.0], 0.28, 0.26, f0 + 0.48);
      this.triggerBrassChord([146.83, 220.0, 369.99, 440.0, 587.33], 1.15, 0.34, f0 + 0.74);
      return;
    }

    // 5. MATCH DEFEAT (`FLAG_CAPTURED_BY_ENEMY`): Detonation + Power-Down + Solemn Solo Reverberant Bugle *Taps*!
    this.triggerHeavyExplosion(now, -0.48, 1.1);
    this.triggerTone(600, 45, 0.65, 'sawtooth', 0.16, now + 0.12, 1400, -0.4, this.sfxGain);
    this.playSoloBugleTaps(now + 0.62);
  }

  public stopActiveSequence(): void {
    this.inBattleVacuum = false;
    if (this.ctx && this.vacuumDuckBus) {
      this.vacuumDuckBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.vacuumDuckBus.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }
    while (this.activeCleanupFns.length > 0) {
      const fn = this.activeCleanupFns.pop();
      fn?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Section 2: Continuous LFO Canvas Tent Wind, Rain, Lantern Crackle & Watch
  // ---------------------------------------------------------------------------

  private startWarRoomAmbience(ctx: AudioContext): void {
    if (this.ambienceStarted || !this.ambianceGain || !this.pinkBrownCache) return;
    this.ambienceStarted = true;

    // 1. Canvas Command Tent Night Wind (Pink/Brown noise sculpted with slow `0.11Hz` LFO lowpass modulation!)
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
    windLfo.frequency.value = 0.11; // 9-second breathing night wind gust cycle against canvas!
    windLfoDepth.gain.value = 115;
    windLfo.connect(windLfoDepth);
    windLfoDepth.connect(windFilter.frequency);

    const windGain = ctx.createGain();
    windGain.gain.value = 0.28;

    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ambianceGain);

    windSrc.start();
    windLfo.start();

    // 2. 500ms Stochastic Scheduler for Sparse Raindrop Patter, Oil-Lantern Wick Crackle & 1Hz Watch Escapement!
    this.ambienceTimer = window.setInterval(() => {
      if (
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

      // A) 1Hz Mechanical Pocket-Watch Escapement (`+0.48` stereo right; double-time & brighter during final 10s warning!)
      if (this.watchHalfSecTick === 0 || this.turnWarningUrgent) {
        const gainMul = this.turnWarningUrgent ? 1.85 : 1.0;
        this.triggerMetallicPing(3280, 0.016, 0.035 * gainMul, now, 0.48, this.ambianceGain);
        this.triggerMetallicPing(2490, 0.014, 0.022 * gainMul, now + 0.12, 0.48, this.ambianceGain);
      }

      // B) Sparse Soft Raindrop Patter on Canvas Tent Roof (`~35%` chance per 500ms)
      if (Math.random() < 0.36) {
        const drops = 1 + Math.floor(Math.random() * 2);
        for (let d = 0; d < drops; d++) {
          const dt = Math.random() * 0.42;
          const pan = (Math.random() * 2 - 1) * 0.78;
          const pitch = 680 + Math.random() * 720;
          this.triggerFilteredNoise('brown', 0.028, pitch, 0.055, now + dt, 2.8, pan, this.ambianceGain);
        }
      }

      // C) Subtle Warm Oil-Lantern Wick Crackle (`-0.55` stereo left, matching 3D brass hurricane lantern!)
      if (Math.random() < 0.28) {
        const ct = Math.random() * 0.35;
        this.triggerFilteredNoise('white', 0.01, 2900 + Math.random() * 1400, 0.032, now + ct, 3.2, -0.55, this.ambianceGain);
      }
    }, 500);
    void this.ambienceTimer;
  }

  // ---------------------------------------------------------------------------
  // Internal Synthesis & Impulse Builders
  // ---------------------------------------------------------------------------

  private playSoloBugleTaps(startTime: number): void {
    if (!this.ctx || !this.musicGain) return;
    // Authentic solemn opening phrase of *Taps* (`A3 ... A3 -> D4 ...... A3 -> D4 -> F#4 ......`)
    const phrase: Array<{ freq: number; offset: number; dur: number; gain: number }> = [
      { freq: 220.0, offset: 0.0, dur: 0.38, gain: 0.18 },
      { freq: 220.0, offset: 0.4, dur: 0.18, gain: 0.2 },
      { freq: 293.66, offset: 0.6, dur: 0.85, gain: 0.25 },
      { freq: 220.0, offset: 1.52, dur: 0.22, gain: 0.19 },
      { freq: 293.66, offset: 1.76, dur: 0.22, gain: 0.22 },
      { freq: 369.99, offset: 2.0, dur: 1.15, gain: 0.26 },
    ];
    for (const n of phrase) {
      const t = startTime + n.offset;
      // Warm solo brass cornet formant (`sawtooth` low-passed at `1150Hz` + fundamental `sine`)
      this.triggerTone(n.freq * 0.996, n.freq, n.dur, 'sawtooth', n.gain, t, 1150, 0, this.musicGain);
      this.triggerTone(n.freq, n.freq, n.dur, 'sine', n.gain * 0.7, t, 1400, 0, this.musicGain);
    }
  }

  private triggerHollowGong(startTime: number, dur: number, peakGain: number): void {
    if (!this.ctx || !this.musicGain) return;
    const partials = [110.0, 156.2, 234.3, 321.8, 468.0];
    partials.forEach((f, idx) => {
      const g = peakGain / (1 + idx * 0.65);
      this.triggerTone(f * 1.008, f * 0.994, dur * (1 - idx * 0.1), 'sine', g, startTime, 2800, 0, this.musicGain!);
    });
  }

  private triggerBrassSwell(freq: number, dur: number, peakGain: number, startTime: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const filt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.linearRampToValueAtTime(freq * 1.015, startTime + dur);

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(420, startTime);
    filt.frequency.exponentialRampToValueAtTime(1650, startTime + dur);

    g.gain.setValueAtTime(0.002, startTime);
    g.gain.exponentialRampToValueAtTime(peakGain, startTime + dur * 0.9);
    g.gain.linearRampToValueAtTime(0.001, startTime + dur);

    osc.connect(filt);
    filt.connect(g);
    g.connect(this.musicGain);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
    this.activeCleanupFns.push(() => {
      try {
        osc.stop();
      } catch {
        // stopped
      }
    });
  }

  private buildAnalogSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
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
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const white = Math.random() * 2 - 1;
        const damp = Math.max(0.07, 0.52 * Math.exp(-t * 2.3));
        lp = lp + damp * (white - lp);
        const earlyBoost =
          Math.abs(t - (ch === 0 ? 0.018 : 0.022)) < 0.002 ||
          Math.abs(t - (ch === 0 ? 0.036 : 0.04)) < 0.002
            ? 2.1
            : 1.0;
        const env = Math.pow(1 - t / durationSec, 2.55) * earlyBoost;
        data[i] = lp * env * 0.72;
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
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      wData[i] = w;
      last = (last + 0.05 * w) / 1.05;
      bData[i] = last * 3.3;
    }
  }

  private triggerHeartbeatLubDub(startTime: number, gain: number): void {
    if (!this.ctx || !this.heartbeatBypassBus) return;
    this.triggerTone(62, 31, 0.15, 'sine', gain, startTime, 130, 0, this.heartbeatBypassBus);
    this.triggerFilteredNoise('brown', 0.09, 95, gain * 0.45, startTime, 1.2, 0, this.heartbeatBypassBus);
    this.triggerTone(76, 36, 0.13, 'sine', gain * 0.85, startTime + 0.135, 155, 0, this.heartbeatBypassBus);
    this.triggerFilteredNoise('brown', 0.075, 120, gain * 0.35, startTime + 0.135, 1.4, 0, this.heartbeatBypassBus);
  }

  private triggerZimmerBraaam(
    fundamentalHz: number,
    dur: number,
    peakGain: number,
    startTime: number,
    dest: AudioNode
  ): void {
    if (!this.ctx) return;
    for (const detune of [0.993, 1.0, 1.007]) {
      this.triggerTone(
        fundamentalHz * detune,
        fundamentalHz * detune * 0.985,
        dur,
        'sawtooth',
        peakGain * 0.42,
        startTime,
        920,
        0,
        dest
      );
    }
    this.triggerTone(fundamentalHz * 0.5, fundamentalHz * 0.49, dur, 'sine', peakGain * 0.72, startTime, 180, 0, dest);
  }

  private triggerHowitzerShot(startTime: number, pan: number, intensity: number): void {
    if (!this.ctx || !this.sfxGain) return;
    this.triggerFilteredNoise('white', 0.035, 2900, 0.4 * intensity, startTime, 0.9, pan, this.sfxGain);
    this.triggerFilteredNoise('brown', 0.32, 420, 0.45 * intensity, startTime + 0.005, 0.7, pan, this.sfxGain);
    this.triggerTone(135, 30, 0.36, 'sine', 0.5 * intensity, startTime, 320, pan, this.sfxGain);
  }

  private triggerHeavyGunshotWithCasing(startTime: number, pan: number, pitchScale: number): void {
    if (!this.ctx || !this.sfxGain) return;
    this.triggerFilteredNoise('white', 0.024, 2700 * pitchScale, 0.3, startTime, 1.1, pan, this.sfxGain);
    this.triggerFilteredNoise('brown', 0.07, 740 * pitchScale, 0.28, startTime + 0.003, 0.85, pan, this.sfxGain);
    this.triggerTone(190 * pitchScale, 46, 0.058, 'triangle', 0.3, startTime, 1200, pan, this.sfxGain);
    if (Math.random() < 0.5) {
      this.triggerMetallicPing(3900 + Math.random() * 900, 0.026, 0.04, startTime + 0.085, pan * 0.85, this.sfxGain);
    }
  }

  private triggerArmorRicochet(startTime: number, pan: number, rising: boolean): void {
    if (!this.ctx || !this.sfxGain) return;
    this.triggerMetallicPing(1420, 0.07, 0.15, startTime, pan, this.sfxGain);
    this.triggerTone(
      rising ? 980 : 3200,
      rising ? 3350 : 760,
      0.13,
      'sine',
      0.14,
      startTime + 0.006,
      4600,
      -pan * 0.6,
      this.sfxGain
    );
  }

  private triggerHeavyExplosion(startTime: number, pan: number, intensity: number): void {
    if (!this.ctx || !this.sfxGain) return;
    this.triggerFilteredNoise('white', 0.055, 2800, 0.56 * intensity, startTime, 0.65, pan, this.sfxGain);
    this.triggerTone(108, 20, 0.92, 'sine', 0.76 * intensity, startTime, 240, pan, this.sfxGain);
    this.triggerTone(155, 28, 0.5, 'sawtooth', 0.4 * intensity, startTime, 320, pan, this.sfxGain);

    if (this.pinkBrownCache) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.pinkBrownCache;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1650, startTime);
      lp.frequency.exponentialRampToValueAtTime(95, startTime + 1.4);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.64 * intensity, startTime);
      g.gain.exponentialRampToValueAtTime(0.002, startTime + 1.4);

      this.connectWithPan(src, lp, g, pan, this.sfxGain);
      src.start(startTime, 0, 1.45);
    }

    for (let s = 0; s < 5; s++) {
      const st = startTime + 0.11 + s * 0.09;
      const sp = Math.max(-0.92, Math.min(0.92, pan + (s % 2 === 0 ? -0.4 : 0.4)));
      const freq = 1350 + ((s * 510) % 1800);
      this.triggerMetallicPing(freq, 0.065, 0.095 * intensity, st, sp, this.sfxGain);
    }
  }

  private triggerBrassChord(
    freqs: readonly number[],
    dur: number,
    totalGain: number,
    startTime: number
  ): void {
    const perNote = totalGain / Math.max(1, Math.sqrt(freqs.length));
    for (const f of freqs) {
      this.triggerBrassOrSynthNote(f, dur, perNote, startTime);
    }
  }

  private triggerBrassOrSynthNote(
    freq: number,
    dur: number,
    gainPeak: number,
    startTime: number
  ): void {
    if (!this.ctx || !this.musicGain) return;
    const wave: OscillatorType = this.eraMode === '1980s' ? 'sawtooth' : 'triangle';
    const cutoff = this.eraMode === '1980s' ? 2300 : 1550;
    this.triggerTone(freq * 0.996, freq, dur, wave, gainPeak, startTime, cutoff, -0.14, this.musicGain);
    this.triggerTone(freq * 1.004, freq * 1.001, dur, wave, gainPeak * 0.85, startTime, cutoff, 0.14, this.musicGain);
    this.triggerTone(freq, freq, dur, 'sine', gainPeak * 0.55, startTime, 1800, 0, this.musicGain);
  }

  private triggerMetallicPing(
    baseFreq: number,
    dur: number,
    peakGain: number,
    startTime: number,
    pan: number,
    dest: AudioNode | null = this.sfxGain
  ): void {
    if (!this.ctx || !dest) return;
    this.triggerTone(baseFreq, baseFreq * 0.98, dur, 'triangle', peakGain, startTime, 5800, pan, dest);
    this.triggerTone(baseFreq * 2.41, baseFreq * 2.36, dur * 0.65, 'sine', peakGain * 0.45, startTime, 6800, pan, dest);
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
    dest: AudioNode
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

    this.connectWithPan(osc, filt, g, pan, dest);
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
    dest: AudioNode
  ): void {
    this.triggerSweptNoise(color, dur, bandFreq, bandFreq, peakGain, startTime, q, pan, dest);
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
    dest: AudioNode
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

    this.connectWithPan(src, filt, g, pan, dest);
    src.start(startTime, offset, dur + 0.02);
  }

  private connectWithPan(
    source: AudioNode,
    filter: AudioNode,
    gain: GainNode,
    pan: number,
    dest: AudioNode
  ): void {
    if (!this.ctx) return;
    source.connect(filter);
    filter.connect(gain);
    if (Math.abs(pan) > 0.01 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(dest);
    } else {
      gain.connect(dest);
    }
  }
}
