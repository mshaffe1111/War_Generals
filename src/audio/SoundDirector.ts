import type {
  AudioEraMode,
  BattleResolutionKind,
  ClashPublicStakes,
} from '../core/types';

/**
 * AAA Cinema & Battlefield WebAudio Sound Engine (`SoundDirector.ts`).
 *
 * Acoustic Signal Chain:
 *   [Dry Combat Bus + Sub-Bass LFE Shelf (62Hz +5.5dB)]
 *      ├──> Analog Tube WaveShaper (`tanh` soft-clipping harmonic warmth & punch)
 *      └──> Stereo Battlefield Canyon Convolver (`2.1s` stereo impulse response with 18ms/34ms bunker reflections)
 *            └──> Vacuum Ducking Bus (drops to `-infinity dB` during Strachan Pre-Verdict Vacuum!)
 *      └──> Heartbeat & Bullet-Time Bypass Bus (plays crystal-clear inside the dead-air vacuum!)
 *            └──> Master Limiter/Compressor -> Live `AnalyserNode` (feeds 3D Bunker CRT) -> Destination
 *
 * Signature Dramatic Features:
 *   1. Living War-Room Command Ambience (subtle distant horizon artillery rumble + ticking brass pocket watch)
 *   2. DEFCON Stakes & Doctrine Signatures (Zimmer C2 Brass Braaam on DEFCON 1; Sonar Ping on Covert Spy)
 *   3. Asymmetric Aggressor Barrage + Brass Shell Casings + *Dunkirk* Accelerating Shepard-Tone Riser
 *   4. Sloped-Armor "Brick-Wall" Glacis Deflection Clang + Stereo Doppler Ricochet
 *   5. "The Strachan Vacuum": Sudden total room/reverb silence + visceral `52Hz` human `LUB-DUB` Heartbeat + Bullet-Time Air Warp
 *   6. Multi-Stage Wave-Shaped Explosions, Delayed `MUTUAL_SPLIT` Thermal Cook-Off, & Harmonized Brass Fanfares
 */
export class SoundDirector {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private combatBus: GainNode | null = null;
  private vacuumBypassBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private saturator: WaveShaperNode | null = null;
  private subShelf: BiquadFilterNode | null = null;
  private ambientBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timeDomainBuf: Float32Array<ArrayBuffer> | null = null;

  private noiseBufferCache: AudioBuffer | null = null;
  private brownBufferCache: AudioBuffer | null = null;

  private muted = false;
  private eraMode: AudioEraMode = '1980s';
  private ambienceStarted = false;
  private watchTickTimer: number | null = null;
  private inBattleVacuum = false;
  private activeCleanupFns: Array<() => void> = [];

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // 1. Master Brickwall Peak Tamer
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -11;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.16;

      // 2. Sub-Bass Cinema LFE Shelf (`62Hz`, `+5.2dB`)
      this.subShelf = ctx.createBiquadFilter();
      this.subShelf.type = 'lowshelf';
      this.subShelf.frequency.value = 62;
      this.subShelf.gain.value = 5.2;

      // 3. Analog Tape / Tube Saturation (`tanh` soft-clipping curve so cannons & brass hit with harmonic meat!)
      this.saturator = ctx.createWaveShaper();
      this.saturator.curve = this.buildAnalogSaturationCurve(1.85);
      this.saturator.oversample = '2x';

      // 4. Stereo Battlefield Canyon + Bunker Slapback Convolution Reverb (`2.1s`)
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = this.buildStereoBattlefieldImpulse(ctx, 2.1);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.34;

      // 5. Combat Bus (ducks instantly to 0 during the Strachan Dead-Air Vacuum!)
      this.combatBus = ctx.createGain();
      this.combatBus.gain.value = 1.0;

      // 6. Vacuum-Bypass Bus (carries the isolated 52Hz Heartbeat & Bullet-Time Shell inside the silence!)
      this.vacuumBypassBus = ctx.createGain();
      this.vacuumBypassBus.gain.value = 1.0;

      // 7. Subtle War-Room Command Ambience Bus
      this.ambientBus = ctx.createGain();
      this.ambientBus.gain.value = 0.22;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.88;

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.52;
      this.timeDomainBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

      // Wire signal graph
      this.combatBus.connect(this.saturator);
      this.combatBus.connect(this.reverbSend);
      this.reverbSend.connect(this.convolver);
      this.convolver.connect(this.saturator);

      this.ambientBus.connect(this.combatBus);
      this.vacuumBypassBus.connect(this.saturator);

      this.saturator.connect(this.subShelf);
      this.subShelf.connect(this.compressor);
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      this.buildCachedNoiseBuffers(ctx);
      this.startWarRoomAmbience(ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.88, this.ctx.currentTime, 0.02);
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
    return peak > 0.003;
  }

  public playSelect(): void {
    this.unlock();
    if (!this.ctx || !this.combatBus || this.muted) return;
    const now = this.ctx.currentTime;
    // Tactile machined-brass detent click + warm walnut resonance
    this.triggerMetallicPing(1480, 0.045, 0.11, now, 0);
    this.triggerTone(280, 145, 0.055, 'triangle', 0.16, now, 1200, 0, this.combatBus);
  }

  public playMoveSlide(veteranKills = 0): void {
    this.unlock();
    if (!this.ctx || !this.combatBus || this.muted) return;
    const now = this.ctx.currentTime;
    const weightMul = veteranKills >= 2 ? 0.76 : 1.0;
    // Velvet-on-slate tactile glide + heavy brass plinth seat thud
    this.triggerFilteredNoise('brown', 0.11, 520 * weightMul, 0.18, now, 1.1, 0, this.combatBus);
    this.triggerTone(
      175 * weightMul,
      58 * weightMul,
      0.11,
      'sine',
      veteranKills >= 2 ? 0.38 : 0.26,
      now + 0.065,
      900,
      0,
      this.combatBus
    );
    this.triggerMetallicPing(1950 * weightMul, 0.04, 0.08, now + 0.068, 0);
  }

  /**
   * Act 1: Trench Lock-In + DEFCON / Doctrine Signature!
   * - DEFCON 1 unleashes a Hans Zimmer C2 Brass Braaam + bunker klaxon pulse.
   * - Covert Spy unleashes a submarine Cold-War Sonar Ping (`1480Hz`) into the canyon reverb.
   * - Heavy artillery breech-bolt `CHK-CLACK` + asymmetric Attacker Lunge vs. Defender Brace slams!
   */
  public playAct1LockIn(speedScale = 1, stakes?: ClashPublicStakes): void {
    this.unlock();
    this.stopActiveSequence();
    if (!this.ctx || !this.combatBus || !this.ambientBus || this.muted) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const inv = 1 / Math.max(0.5, speedScale);
    this.inBattleVacuum = false;
    this.combatBus.gain.cancelScheduledValues(now);
    this.combatBus.gain.setValueAtTime(1.0, now);
    this.ambientBus.gain.setTargetAtTime(0.06, now, 0.08);

    const attackerPan = stakes?.isEnemyInitiatedAmbush ? 0.52 : -0.52;
    const defenderPan = -attackerPan;

    // 1. Heavy Hydraulic Bunker Blast-Gate & Artillery Breech-Bolt (`CHK-CLACK!`)
    this.triggerFilteredNoise('brown', 0.26 * inv, 640, 0.28, now + 0.01, 0.9, 0, this.combatBus);
    this.triggerMetallicPing(980, 0.07, 0.22, now + 0.11 * inv, attackerPan * 0.5);
    this.triggerMetallicPing(1640, 0.09, 0.26, now + 0.18 * inv, attackerPan * 0.5);

    // 2. Asymmetric Lunge Slam (Attacker strikes FIRST) -> Defender Heavy Brace Thud!
    this.triggerTone(148, 36, 0.26, 'sine', 0.52, now + 0.21 * inv, 900, attackerPan, this.combatBus);
    this.triggerFilteredNoise('white', 0.08, 2400, 0.26, now + 0.21 * inv, 1.5, attackerPan, this.combatBus);

    this.triggerTone(112, 32, 0.28, 'sine', 0.48, now + 0.34 * inv, 650, defenderPan, this.combatBus);
    this.triggerFilteredNoise('brown', 0.11, 1200, 0.24, now + 0.34 * inv, 1.2, defenderPan, this.combatBus);

    // 3. Doctrine & DEFCON Signature Stingers!
    if (stakes?.defcon === 1) {
      // Hans Zimmer Saturated Low-Brass "BRAAAM" (`C2 = 65.4Hz` + `C1 = 32.7Hz` sub!)
      this.triggerZimmerBraaam(65.41, 0.88 * inv, 0.36, now + 0.14 * inv);
    } else if (stakes?.playerDoctrine === 'COVERT_SPY') {
      // Cold-War Submarine Sonar Ping (`1480Hz`) echoing through the stereo canyon!
      this.triggerTone(1480, 1472, 0.42, 'sine', 0.22, now + 0.26 * inv, 3800, -0.25, this.combatBus);
      this.triggerTone(2960, 2940, 0.18, 'sine', 0.07, now + 0.26 * inv, 4800, -0.25, this.combatBus);
    } else {
      // Crisp Rangefinder Radar Double-Lock
      this.triggerTone(1240, 1240, 0.055, 'sine', 0.15, now + 0.48 * inv, 3200, 0, this.combatBus);
      this.triggerTone(1660, 1660, 0.075, 'sine', 0.18, now + 0.57 * inv, 3600, 0, this.combatBus);
    }
  }

  /**
   * Act 2A: Asymmetric Firefight + *Dunkirk* Accelerating Shepard-Tone Riser + Brass Shell Casings!
   */
  public playAct2SuppressionPush(
    pushDurSec: number,
    attackerIsPlayer: boolean,
    defcon: 1 | 2 | 3
  ): void {
    this.unlock();
    if (!this.ctx || !this.combatBus || this.muted) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const atkPan = attackerIsPlayer ? -0.58 : 0.58;
    const defPan = -atkPan;

    // 1. *Dunkirk* Accelerating Pocket-Watch / Solenoid Detent Ticks + Rising Shepard-Semitone Tension!
    let tickT = 0.04;
    let step = 0;
    while (tickT < pushDurSec - 0.06) {
      const progress = tickT / Math.max(0.2, pushDurSec);
      const pitch = 680 * Math.pow(2, progress * 0.75);
      this.triggerMetallicPing(pitch, 0.032, 0.1 + progress * 0.12, now + tickT, (step % 2 === 0 ? -1 : 1) * 0.25);
      const interval = Math.max(0.065, 0.21 * (1 - progress * 0.66));
      tickT += interval;
      step += 1;
    }

    // Continuous rising Shepard-like analog tension chord (`sawtooth` through sweeping bandpass)
    const baseFreq = defcon === 1 ? 110 : 146.83;
    for (const harm of [1, 1.5, 2]) {
      const osc = ctx.createOscillator();
      const filt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = this.eraMode === '1980s' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(baseFreq * harm, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * harm * 1.42, now + pushDurSec);

      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(380, now);
      filt.frequency.exponentialRampToValueAtTime(1850, now + pushDurSec);

      g.gain.setValueAtTime(0.002, now);
      g.gain.linearRampToValueAtTime(0.085 / harm, now + pushDurSec * 0.88);
      g.gain.linearRampToValueAtTime(0.001, now + pushDurSec);

      osc.connect(filt);
      filt.connect(g);
      g.connect(this.combatBus);
      osc.start(now);
      osc.stop(now + pushDurSec + 0.03);
      this.activeCleanupFns.push(() => {
        try {
          osc.stop();
        } catch {
          // stopped
        }
      });
    }

    // 2. Heavy Opening Cannon + Concentrated Aggressor Automatic Bursts (driving Frontline to 84%!)
    this.triggerHowitzerShot(now + 0.03, atkPan, 0.85);

    const atkBursts = [0.18, 0.25, 0.32, 0.39, 0.62, 0.68, 0.74, 0.8, 1.04, 1.1, 1.16, 1.22];
    for (const bt of atkBursts) {
      if (bt < pushDurSec - 0.08) {
        this.triggerHeavyGunshotWithCasing(now + bt, atkPan, 0.96);
      }
    }

    // Desperate Defender Return Fire (shorter bursts + metallic armor sparks on defender's glacis!)
    const defBursts = [0.46, 0.53, 0.88, 0.95, 1.3];
    for (const bt of defBursts) {
      if (bt < pushDurSec - 0.1) {
        this.triggerHeavyGunshotWithCasing(now + bt, defPan, 1.16);
      }
    }

    for (const [idx, rt] of [0.29, 0.72, 1.14].entries()) {
      if (rt < pushDurSec - 0.08) {
        this.triggerArmorRicochet(now + rt, defPan, idx % 2 === 0);
      }
    }
  }

  /**
   * Act 2B: "THE STRACHAN VACUUM" & BRICK-WALL ARMOR DEFLECTION!
   * - Instantly cuts `combatBus` (gunfire + room ambience + canyon reverb tail!) to `-infinity dB` dead silence!
   * - If `isReversal`, rings out a massive steel-glacis anvil deflection (`CLANG-ZING!`) right as the vacuum hits!
   * - Plays a visceral `52Hz` flesh-and-bone human `LUB-DUB` Heartbeat inside the dead-air vacuum,
   *   followed by a screaming Doppler incoming 88mm shell whistle!
   */
  public playStrachanVacuumAndHeartbeat(
    vacuumDurSec: number,
    isReversal: boolean,
    defenderPan: number
  ): void {
    this.unlock();
    if (!this.ctx || !this.combatBus || !this.vacuumBypassBus || this.muted) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.inBattleVacuum = true;

    // 1. HARD CUT TO TOTAL ACOUSTIC VACUUM (`-infinity dB` in 18ms!)
    this.combatBus.gain.cancelScheduledValues(now);
    this.combatBus.gain.setValueAtTime(this.combatBus.gain.value, now);
    this.combatBus.gain.linearRampToValueAtTime(0.0001, now + 0.018);

    // 2. If Defender Reversal ("No-Sell" Brick Wall!): Heavy Sloped-Armor Anvil Clang on VacuumBypassBus!
    if (isReversal) {
      this.triggerMetallicPing(620, 0.32, 0.42, now, defenderPan, this.vacuumBypassBus);
      this.triggerMetallicPing(1310, 0.24, 0.34, now + 0.005, defenderPan, this.vacuumBypassBus);
      // Screaming supersonic deflection ricochet across the stereo field!
      this.triggerTone(
        3400,
        690,
        0.26,
        'sine',
        0.24,
        now + 0.015,
        4800,
        -defenderPan * 0.7,
        this.vacuumBypassBus
      );
    } else {
      // Bullet-Time Time-Dilation Sub-Drop (`140Hz -> 28Hz` air vacuum suck!)
      this.triggerTone(145, 28, 0.22, 'sine', 0.44, now, 320, 0, this.vacuumBypassBus);
    }

    // 3. Visceral Human Heartbeat (`LUB-DUB ... LUB-DUB`) inside Pitch-Black Silence!
    const pulse1 = now + Math.min(0.14, vacuumDurSec * 0.18);
    this.triggerHeartbeatLubDub(pulse1, 0.62);
    if (vacuumDurSec >= 0.58) {
      this.triggerHeartbeatLubDub(pulse1 + 0.38, 0.74);
    }

    // 4. Final `220ms` Screaming Incoming 88mm Shell Whistle right before `1.0x` Snap Detonation!
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
    g.gain.exponentialRampToValueAtTime(0.34, whistleStart + whistleDur * 0.92);
    g.gain.linearRampToValueAtTime(0.001, whistleStart + whistleDur);

    osc.connect(filt);
    filt.connect(g);
    g.connect(this.vacuumBypassBus);
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
   * Act 3: Snap Back from Vacuum -> Earth-Shaking Detonation + Twists (`MUTUAL_SPLIT` Cook-Off / `SPY_INTERCEPT` / `FLAG_CAPTURED`)!
   */
  public playAct3Outcome(resolution: BattleResolutionKind, isSpyIntercept = false): void {
    this.unlock();
    if (!this.ctx || !this.combatBus || !this.ambientBus || this.muted) return;
    const now = this.ctx.currentTime;
    this.inBattleVacuum = false;

    // Snap full canyon reverb + saturation combat bus right back to `1.0` for colossal impact!
    this.combatBus.gain.cancelScheduledValues(now);
    this.combatBus.gain.setValueAtTime(1.0, now);
    this.ambientBus.gain.setTargetAtTime(0.22, now + 1.2, 0.6);

    if (resolution === 'MUTUAL_SPLIT') {
      // KUROSAWA DELAYED DOUBLE-KO WHIPLASH!
      // 1) Blast #1 hits Right Bastion at `t = 0.00s`
      this.triggerHeavyExplosion(now, 0.52, 1.05);
      // 2) `0.18s .. 0.44s`: Critical Internal Ammo Cook-Off Runaway Warble on Left Bastion!
      this.triggerTone(620, 2350, 0.26, 'sawtooth', 0.22, now + 0.18, 3400, -0.52, this.combatBus);
      this.triggerMetallicPing(1880, 0.08, 0.24, now + 0.34, -0.52);
      // 3) Blast #2 obliterates Left Bastion at `t = 0.46s` + Twin Split-Medallion Bell Chord!
      this.triggerHeavyExplosion(now + 0.46, -0.52, 1.18);
      this.triggerMetallicPing(880, 0.55, 0.22, now + 0.48, -0.35);
      this.triggerMetallicPing(932.33, 0.55, 0.22, now + 0.48, 0.35); // dissonant minor-second brass split chime!
      return;
    }

    if (
      resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
      resolution === 'FLAG_CAPTURED_BY_ENEMY'
    ) {
      // `0.00s..0.95s`: Ceremonial Spotlight Unmasking Reveal Chime -> `0.95s` 3-Salvo Victory Artillery Barrage!
      const pan = resolution === 'FLAG_CAPTURED_BY_PLAYER' ? 0.48 : -0.48;
      this.triggerMetallicPing(1046.5, 0.55, 0.26, now + 0.04, pan * 0.5);
      this.triggerZimmerBraaam(130.81, 0.85, 0.28, now + 0.05);
      this.triggerHeavyExplosion(now + 0.95, pan * 0.6, 1.02);
      this.triggerHeavyExplosion(now + 1.11, pan, 1.12);
      this.triggerHeavyExplosion(now + 1.27, pan * 0.8, 1.2);
    } else {
      const loserPan = resolution === 'PLAYER_WINS' ? 0.52 : -0.52;
      this.triggerHeavyExplosion(now, loserPan, 1.15);
    }

    // Post-Blast Harmonized Orchestral Brass / Synth Verdict Fanfare!
    const fanStart =
      resolution === 'FLAG_CAPTURED_BY_PLAYER' || resolution === 'FLAG_CAPTURED_BY_ENEMY'
        ? now + 1.35
        : now + 0.3;

    if (resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      // Grand 5-Note Ceremonial Victory Brass Fanfare (C4 - G4 - C5 - E5 - G5 + C3 Bass!)
      this.triggerBrassChord([130.81, 261.63, 392.0], 0.35, 0.24, fanStart);
      this.triggerBrassChord([196.0, 392.0, 493.88], 0.28, 0.24, fanStart + 0.24);
      this.triggerBrassChord([130.81, 261.63, 523.25, 659.25, 783.99], 0.95, 0.3, fanStart + 0.48);
    } else if (isSpyIntercept && resolution === 'PLAYER_WINS') {
      // Bespoke Covert Counter-Intelligence Triumph Sting!
      const notes = [293.66, 369.99, 440.0, 587.33, 739.99];
      notes.forEach((f, i) => {
        this.triggerBrassOrSynthNote(f, 0.38, 0.24, fanStart + i * 0.068);
      });
    } else if (resolution === 'PLAYER_WINS') {
      this.triggerBrassChord([130.81, 261.63, 329.63, 392.0], 0.22, 0.2, fanStart);
      this.triggerBrassChord([130.81, 261.63, 392.0, 523.25], 0.58, 0.25, fanStart + 0.18);
    } else if (resolution === 'ENEMY_WINS' || resolution === 'FLAG_CAPTURED_BY_ENEMY') {
      // Dark Minor-Second Zimmer Low-Brass Dread Chord
      this.triggerZimmerBraaam(87.31, 0.45, 0.26, fanStart);
      this.triggerZimmerBraaam(65.41, 0.78, 0.3, fanStart + 0.22);
    }
  }

  public stopActiveSequence(): void {
    this.inBattleVacuum = false;
    if (this.ctx && this.combatBus) {
      this.combatBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.combatBus.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }
    while (this.activeCleanupFns.length > 0) {
      const fn = this.activeCleanupFns.pop();
      fn?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Acoustic Synthesis & Convolution Primitives
  // ---------------------------------------------------------------------------

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

  private buildStereoBattlefieldImpulse(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * durationSec);
    const impulse = ctx.createBuffer(2, len, rate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const white = Math.random() * 2 - 1;
        // Progressive air absorption (high frequencies decay faster across a canyon)
        const damp = Math.max(0.08, 0.55 * Math.exp(-t * 2.2));
        lp = lp + damp * (white - lp);

        // Distinct early concrete-bunker slapbacks (`19ms` & `37ms`) + smooth canyon tail
        const earlyBoost =
          Math.abs(t - (ch === 0 ? 0.019 : 0.023)) < 0.002 ||
          Math.abs(t - (ch === 0 ? 0.037 : 0.041)) < 0.002
            ? 2.2
            : 1.0;
        const env = Math.pow(1 - t / durationSec, 2.6) * earlyBoost;
        data[i] = lp * env * 0.72;
      }
    }
    return impulse;
  }

  private buildCachedNoiseBuffers(ctx: AudioContext): void {
    const len = ctx.sampleRate * 2;
    this.noiseBufferCache = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brownBufferCache = ctx.createBuffer(1, len, ctx.sampleRate);
    const wData = this.noiseBufferCache.getChannelData(0);
    const bData = this.brownBufferCache.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      wData[i] = w;
      last = (last + 0.045 * w) / 1.045;
      bData[i] = last * 3.4;
    }
  }

  private startWarRoomAmbience(ctx: AudioContext): void {
    if (this.ambienceStarted || !this.ambientBus || !this.brownBufferCache) return;
    this.ambienceStarted = true;

    // 1. Subtle Warm Command-Tent Hearth / Distant Horizon Rumble (`< 95Hz` lowpass)
    const src = ctx.createBufferSource();
    src.buffer = this.brownBufferCache;
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 88;

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.24;

    src.connect(lp);
    lp.connect(rumbleGain);
    rumbleGain.connect(this.ambientBus);
    src.start();

    // 2. Delicate Antique Brass Pocket-Watch Escapement Tick (`1Hz` stereo right, silenced during Vacuum!)
    this.watchTickTimer = window.setInterval(() => {
      if (
        !this.ctx ||
        this.ctx.state !== 'running' ||
        this.muted ||
        this.inBattleVacuum ||
        !this.ambientBus
      ) {
        return;
      }
      const t = this.ctx.currentTime;
      this.triggerMetallicPing(3250, 0.018, 0.032, t, 0.42, this.ambientBus);
      this.triggerMetallicPing(2480, 0.015, 0.02, t + 0.14, 0.42, this.ambientBus);
    }, 1000);
    void this.watchTickTimer;
  }

  private triggerHeartbeatLubDub(startTime: number, gain: number): void {
    if (!this.ctx || !this.vacuumBypassBus) return;
    // "LUB" (deep 58Hz -> 32Hz chest thud)
    this.triggerTone(62, 31, 0.15, 'sine', gain, startTime, 130, 0, this.vacuumBypassBus);
    this.triggerFilteredNoise('brown', 0.09, 95, gain * 0.45, startTime, 1.2, 0, this.vacuumBypassBus);
    // "DUB" (+135ms tighter valve snap 74Hz -> 36Hz)
    this.triggerTone(76, 36, 0.13, 'sine', gain * 0.85, startTime + 0.135, 155, 0, this.vacuumBypassBus);
    this.triggerFilteredNoise('brown', 0.075, 120, gain * 0.35, startTime + 0.135, 1.4, 0, this.vacuumBypassBus);
  }

  private triggerZimmerBraaam(
    fundamentalHz: number,
    dur: number,
    peakGain: number,
    startTime: number
  ): void {
    if (!this.ctx || !this.combatBus) return;
    // 3 detuned sawtooth brass horns + sub-octave sine
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
        this.combatBus
      );
    }
    this.triggerTone(
      fundamentalHz * 0.5,
      fundamentalHz * 0.49,
      dur,
      'sine',
      peakGain * 0.72,
      startTime,
      180,
      0,
      this.combatBus
    );
  }

  private triggerHowitzerShot(startTime: number, pan: number, intensity: number): void {
    if (!this.ctx || !this.combatBus) return;
    this.triggerFilteredNoise('white', 0.035, 2900, 0.42 * intensity, startTime, 0.9, pan, this.combatBus);
    this.triggerFilteredNoise('brown', 0.34, 420, 0.48 * intensity, startTime + 0.005, 0.7, pan, this.combatBus);
    this.triggerTone(135, 30, 0.38, 'sine', 0.54 * intensity, startTime, 320, pan, this.combatBus);
  }

  private triggerHeavyGunshotWithCasing(startTime: number, pan: number, pitchScale: number): void {
    if (!this.ctx || !this.combatBus) return;
    // 1. Supersonic muzzle snap
    this.triggerFilteredNoise(
      'white',
      0.024,
      2700 * pitchScale,
      0.34,
      startTime,
      1.1,
      pan,
      this.combatBus
    );
    // 2. Saturated propellant bark
    this.triggerFilteredNoise(
      'brown',
      0.075,
      740 * pitchScale,
      0.32,
      startTime + 0.003,
      0.85,
      pan,
      this.combatBus
    );
    // 3. Punchy low-end breech thump
    this.triggerTone(190 * pitchScale, 46, 0.06, 'triangle', 0.34, startTime, 1200, pan, this.combatBus);
    // 4. Ejected brass shell casing clinking (`+85ms`)!
    if (Math.random() < 0.55) {
      this.triggerMetallicPing(
        3900 + Math.random() * 900,
        0.028,
        0.045,
        startTime + 0.085,
        pan * 0.85,
        this.combatBus
      );
    }
  }

  private triggerArmorRicochet(startTime: number, pan: number, rising: boolean): void {
    if (!this.ctx || !this.combatBus) return;
    this.triggerMetallicPing(1420, 0.07, 0.16, startTime, pan, this.combatBus);
    this.triggerTone(
      rising ? 980 : 3200,
      rising ? 3350 : 760,
      0.13,
      'sine',
      0.15,
      startTime + 0.006,
      4600,
      -pan * 0.6,
      this.combatBus
    );
  }

  private triggerHeavyExplosion(startTime: number, pan: number, intensity: number): void {
    if (!this.ctx || !this.combatBus) return;

    // 1. Blinding supersonic detonation crack (`0..45ms`)
    this.triggerFilteredNoise(
      'white',
      0.055,
      2800,
      0.58 * intensity,
      startTime,
      0.65,
      pan,
      this.combatBus
    );

    // 2. Earth-shaking chest-cavity LFE sub-drop (`108Hz -> 20Hz`, `0.95s`)
    this.triggerTone(108, 20, 0.95, 'sine', 0.78 * intensity, startTime, 240, pan, this.combatBus);
    this.triggerTone(155, 28, 0.52, 'sawtooth', 0.42 * intensity, startTime, 320, pan, this.combatBus);

    // 3. Rolling saturated canyon blast roar (`1.45s`)
    if (this.brownBufferCache) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.brownBufferCache;

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1650, startTime);
      lp.frequency.exponentialRampToValueAtTime(95, startTime + 1.45);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.66 * intensity, startTime);
      g.gain.exponentialRampToValueAtTime(0.002, startTime + 1.45);

      this.connectWithPan(src, lp, g, pan, this.combatBus);
      src.start(startTime);
      src.stop(startTime + 1.48);
    }

    // 4. Scattering steel shrapnel & falling debris pings (`+0.12s .. +0.68s`)
    for (let s = 0; s < 6; s++) {
      const st = startTime + 0.11 + s * 0.09;
      const sp = Math.max(-0.92, Math.min(0.92, pan + (s % 2 === 0 ? -0.4 : 0.4)));
      const freq = 1350 + ((s * 510) % 1800);
      this.triggerMetallicPing(freq, 0.065, 0.1 * intensity, st, sp, this.combatBus);
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
    if (!this.ctx || !this.combatBus) return;
    const wave: OscillatorType = this.eraMode === '1980s' ? 'sawtooth' : 'triangle';
    const cutoff = this.eraMode === '1980s' ? 2300 : 1550;
    this.triggerTone(freq * 0.996, freq, dur, wave, gainPeak, startTime, cutoff, -0.12, this.combatBus);
    this.triggerTone(
      freq * 1.004,
      freq * 1.001,
      dur,
      wave,
      gainPeak * 0.85,
      startTime,
      cutoff,
      0.12,
      this.combatBus
    );
    this.triggerTone(freq, freq, dur, 'sine', gainPeak * 0.55, startTime, 1800, 0, this.combatBus);
  }

  private triggerMetallicPing(
    baseFreq: number,
    dur: number,
    peakGain: number,
    startTime: number,
    pan: number,
    dest: AudioNode | null = this.combatBus
  ): void {
    if (!this.ctx || !dest) return;
    // Inharmonic metallic partials (`1.0x` + `2.41x`) so brass/steel rings like real metal, not a synth beep!
    this.triggerTone(baseFreq, baseFreq * 0.98, dur, 'triangle', peakGain, startTime, 5800, pan, dest);
    this.triggerTone(
      baseFreq * 2.41,
      baseFreq * 2.36,
      dur * 0.65,
      'sine',
      peakGain * 0.45,
      startTime,
      6800,
      pan,
      dest
    );
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
    if (!this.ctx) return;
    const buf = color === 'brown' ? this.brownBufferCache : this.noiseBufferCache;
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const maxOffset = Math.max(0, buf.duration - dur - 0.05);
    const offset = Math.random() * maxOffset;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(bandFreq, startTime);
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
