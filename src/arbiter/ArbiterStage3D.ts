import * as THREE from 'three';
import type { SoundDirector } from '../audio/SoundDirector';
import type { ArbiterVerdict, BattleResolutionKind, HudBannerState } from '../core/types';
import {
  ARBITER_BAY_CENTER_Z,
  gridToWorld,
  type MeshFactory,
} from '../graphics/MeshFactory';
import { createSoftSmokeTexture } from '../graphics/ProceduralTextures';

const PAD_X = 1.06;

interface PadRig {
  readonly bezelGroup: THREE.Group;
  readonly pistonGroup: THREE.Group;
  readonly pistonRod: THREE.Mesh;
  readonly trapdoorPivot: THREE.Group;
  readonly contactRingMat: THREE.MeshBasicMaterial;
  readonly victoryHaloMat: THREE.MeshBasicMaterial;
  readonly chuteRimMat: THREE.MeshBasicMaterial;
  readonly pieceSocket: THREE.Group;
  readonly coilSpring: THREE.Group;
}

interface DomeRig {
  readonly group: THREE.Group;
  readonly coreMat: THREE.MeshBasicMaterial;
  readonly glassMat: THREE.MeshPhysicalMaterial;
  readonly beamMat: THREE.ShaderMaterial;
  readonly baseColor: 'RED' | 'AMBER';
}

interface TubeMeterRig {
  readonly filamentMat: THREE.MeshBasicMaterial;
  readonly barMats: THREE.MeshBasicMaterial[];
}

interface ParticleItem {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Fresnel-softened volumetric cone shader (`alpha = edgeFade * verticalFade * uOpacity`):
 * Eliminates hard geometric cone triangles and prevents blowing out the elevated winning wedge!
 */
function createVolumetricBeamShader(colorHex: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: colorHex.clone() },
      uOpacity: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
        float rimSoft = pow(facing, 2.35);
        float vFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.08, vUv.y);
        float alpha = rimSoft * vFade * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

export class ArbiterStage3D {
  public readonly root = new THREE.Group();
  public readonly worldMedallionGroup = new THREE.Group();

  private readonly factory: MeshFactory;
  private readonly sound: SoundDirector;

  private readonly shutterGroup = new THREE.Group();
  private readonly instrumentTower = new THREE.Group();
  private readonly leftPad: PadRig;
  private readonly rightPad: PadRig;
  private readonly domes: DomeRig[] = [];
  private readonly leftTube: TubeMeterRig;
  private readonly rightTube: TubeMeterRig;

  private readonly crtCanvas: HTMLCanvasElement;
  private readonly crtCtx: CanvasRenderingContext2D;
  private readonly crtTexture: THREE.CanvasTexture;
  private readonly waveformSample = new Float32Array(256);

  private readonly arcLines: THREE.Line[] = [];
  private readonly arcMat: THREE.LineBasicMaterial;

  private readonly winConeLeft: THREE.Mesh;
  private readonly winConeRight: THREE.Mesh;
  private readonly winConeLeftMat: THREE.ShaderMaterial;
  private readonly winConeRightMat: THREE.ShaderMaterial;

  private readonly medallionMesh: THREE.Group;

  private playerStageWedge: THREE.Group | null = null;
  private enemyStageWedge: THREE.Group | null = null;
  private playerStartWorld = new THREE.Vector3();
  private enemyStartWorld = new THREE.Vector3();

  private readonly sparks: ParticleItem[] = [];
  private readonly embers: ParticleItem[] = [];
  private readonly smokePuffs: ParticleItem[] = [];

  private activeVerdict: ArbiterVerdict | null = null;
  private elapsed = 0;
  private speedScale = 1;
  private pausedForDebug = false;
  private act2Triggered = false;
  private act3Triggered = false;
  private sparksSpawned = false;
  private onBannerChange?: (banner: HudBannerState) => void;
  private onSequenceComplete?: () => void;

  private cameraShakeOffset = new THREE.Vector3();

  constructor(factory: MeshFactory, sound: SoundDirector) {
    this.factory = factory;
    this.sound = sound;

    this.root.position.set(0, 0, ARBITER_BAY_CENTER_Z);

    // Dedicated localized neutral-cool instrument fill light so brushed gunmetal ribs, bezels,
    // coils, and brass hinges read with crisp industrial detail even when war-room lights dim!
    const consoleFill = new THREE.PointLight(0xdce8f8, 3.2, 8.5, 1.3);
    consoleFill.position.set(0, 2.6, 1.45);
    this.root.add(consoleFill);

    // 1. Solid Matte-Obsidian Bay Liner & Gunmetal Sub-Deck so NO woodgrain ever shows inside chutes!
    this.buildBaySubDeck();

    // 2. Twin Spring-Loaded Brushed-Brass Pads (`x = ±1.06`), Hydraulic Pistons & Red-Rimmed Chutes
    this.leftPad = this.buildPadRig(-PAD_X, 'CYAN');
    this.rightPad = this.buildPadRig(PAD_X, 'CRIMSON');
    this.root.add(this.leftPad.bezelGroup, this.rightPad.bezelGroup);

    // 3. Sleek Multi-Ribbed Gunmetal Cylindrical Tambour Shutter (`ref_battle_act1_lockin.webp`)
    this.buildRetractableShutter();
    this.root.add(this.shutterGroup);

    // 4. Rising Rear Instrument Housing: 4 Fresnel Domes + 2 Vacuum Tube VU Meters + Curved CRT Oscilloscope
    this.crtCanvas = document.createElement('canvas');
    this.crtCanvas.width = 256;
    this.crtCanvas.height = 160;
    this.crtCtx = this.crtCanvas.getContext('2d')!;
    this.crtTexture = new THREE.CanvasTexture(this.crtCanvas);
    this.crtTexture.colorSpace = THREE.SRGBColorSpace;

    const { leftTube, rightTube } = this.buildInstrumentTower();
    this.leftTube = leftTube;
    this.rightTube = rightTube;
    this.root.add(this.instrumentTower);

    // 5. Jagged Golden Electrical Relay Arcs crackling across the brass terminals
    this.arcMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(2.2, 1.65, 0.52),
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    for (let i = 0; i < 6; i++) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 14; s++) pts.push(new THREE.Vector3());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, this.arcMat);
      line.visible = false;
      this.root.add(line);
      this.arcLines.push(line);
    }

    // 6. Soft Fresnel Volumetric Golden Victory Spotlight Cones (`ref_battle_act3_winner.webp`)
    // Positioned slightly behind the elevated wedge (`z = -0.14`, `uOpacity = 0.085`) so the Cobalt-Navy
    // paint & 3D brass relief remain rich & saturated inside the golden spotlight aura!
    this.winConeLeftMat = createVolumetricBeamShader(new THREE.Color(1.45, 1.02, 0.32));
    this.winConeRightMat = createVolumetricBeamShader(new THREE.Color(1.45, 1.02, 0.32));
    const coneGeo = new THREE.CylinderGeometry(0.34, 0.68, 4.2, 32, 1, true);
    this.winConeLeft = new THREE.Mesh(coneGeo, this.winConeLeftMat);
    this.winConeLeft.position.set(-PAD_X, 2.38, -0.14);
    this.winConeLeft.rotation.z = 0.08;
    this.winConeLeft.visible = false;
    this.root.add(this.winConeLeft);

    this.winConeRight = new THREE.Mesh(coneGeo, this.winConeRightMat);
    this.winConeRight.position.set(PAD_X, 2.38, -0.14);
    this.winConeRight.rotation.z = -0.08;
    this.winConeRight.visible = false;
    this.root.add(this.winConeRight);

    // 7. Heavy Brushed-Brass Attack Medallion
    this.medallionMesh = this.factory.createAttackMedallion();
    this.worldMedallionGroup.visible = false;
    this.worldMedallionGroup.add(this.medallionMesh);

    this.initParticlePools();
    this.resetToIdle();
  }

  public attachBakedShutterIfReady(): void {
    // Keep our high-detail ribbed tambour shutter housing with 3 status LEDs visible & crisp;
    // attach baked `.glb` inner drum cleanly inside the shutter assembly so zero grey bar artifacts occur!
    const clone = this.factory.getBakedShutterClone();
    if (!clone) return;
    clone.scale.set(0.92, 0.26, 0.36);
    clone.position.set(0, 0.08, 0);
    clone.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.material = this.factory.materials.gunmetal;
        c.castShadow = false;
        c.receiveShadow = true;
      }
    });
    this.shutterGroup.add(clone);
  }

  public get isBusy(): boolean {
    return this.activeVerdict !== null;
  }

  public getCameraShakeOffset(): THREE.Vector3 {
    return this.cameraShakeOffset;
  }

  public startBattleSequence(
    verdict: ArbiterVerdict,
    playerOriginWorld: THREE.Vector3,
    enemyOriginWorld: THREE.Vector3,
    speedScale: number,
    onBannerChange: (banner: HudBannerState) => void,
    onComplete: () => void
  ): void {
    this.cleanupStageWedges();

    this.activeVerdict = verdict;
    this.elapsed = 0;
    this.speedScale = speedScale;
    this.pausedForDebug = false;
    this.act2Triggered = false;
    this.act3Triggered = false;
    this.sparksSpawned = false;
    this.onBannerChange = onBannerChange;
    this.onSequenceComplete = onComplete;

    this.playerStartWorld.copy(playerOriginWorld);
    this.enemyStartWorld.copy(enemyOriginWorld);

    this.playerStageWedge = this.factory.createCommandWedge('PLAYER', verdict.playerVisibleRank);
    this.enemyStageWedge = this.factory.createCommandWedge('ENEMY', 'UNKNOWN');
    this.playerStageWedge.traverse((c) => {
      if (c instanceof THREE.Mesh) c.castShadow = false;
    });
    this.enemyStageWedge.traverse((c) => {
      if (c instanceof THREE.Mesh) c.castShadow = false;
    });
    this.leftPad.pieceSocket.add(this.playerStageWedge);
    this.rightPad.pieceSocket.add(this.enemyStageWedge);

    const ceremonialSq = gridToWorld(4, 0);
    this.worldMedallionGroup.position.set(ceremonialSq.x, 0, ceremonialSq.z);
    this.worldMedallionGroup.visible = true;

    onBannerChange('CLASH LOCK-IN');
    this.sound.playAct1LockIn(speedScale);
    this.applyPoseAtTime(0);
  }

  public scrubToActTime(actSeconds: number): void {
    if (!this.activeVerdict) return;
    this.pausedForDebug = true;
    this.elapsed = actSeconds;
    if (actSeconds >= 0.9 && actSeconds < 2.7) {
      this.onBannerChange?.('ARBITRATING');
    } else if (actSeconds >= 2.7) {
      this.onBannerChange?.(this.verdictToAct3Banner(this.activeVerdict.resolution));
    } else {
      this.onBannerChange?.('CLASH LOCK-IN');
    }
    this.applyPoseAtTime(actSeconds);
  }

  public update(dt: number, totalElapsedSec: number): void {
    if (!this.activeVerdict) {
      this.cameraShakeOffset.set(0, 0, 0);
      return;
    }

    if (!this.pausedForDebug) {
      this.elapsed += dt * this.speedScale;
    }

    const t = this.elapsed;

    if (!this.pausedForDebug && !this.act2Triggered && t >= 0.9) {
      this.act2Triggered = true;
      this.onBannerChange?.('ARBITRATING');
      this.sound.playAct2Arbitrating((2.7 - 0.9) / this.speedScale);
    }

    if (!this.pausedForDebug && !this.act3Triggered && t >= 2.7) {
      this.act3Triggered = true;
      this.onBannerChange?.(this.verdictToAct3Banner(this.activeVerdict.resolution));
      this.sound.playAct3Outcome(this.activeVerdict.resolution);
    }

    this.applyPoseAtTime(t, dt, totalElapsedSec);

    if (!this.pausedForDebug && t >= 4.15) {
      const done = this.onSequenceComplete;
      this.resetToIdle();
      done?.();
    }
  }

  public resetToIdle(): void {
    this.sound.stopActiveSequence();
    this.cleanupStageWedges();
    this.activeVerdict = null;
    this.pausedForDebug = false;
    this.worldMedallionGroup.visible = false;
    this.cameraShakeOffset.set(0, 0, 0);

    // Closed recessed ribbed gunmetal tambour shutter covering the Arbiter bay (`ref_gameplay_main.jpg`)
    this.shutterGroup.position.set(0, -0.04, 0.04);
    this.shutterGroup.scale.set(1, 1, 1.08);

    this.instrumentTower.position.set(0, -0.95, -0.72);
    this.instrumentTower.visible = false;

    this.resetPadRig(this.leftPad, 0.0);
    this.resetPadRig(this.rightPad, 0.0);
    this.leftPad.coilSpring.visible = false;
    this.rightPad.coilSpring.visible = false;

    this.winConeLeft.visible = false;
    this.winConeRight.visible = false;
    for (const line of this.arcLines) line.visible = false;
    for (const p of [...this.sparks, ...this.embers, ...this.smokePuffs]) {
      p.mesh.visible = false;
      p.life = 0;
    }
  }

  private resetPadRig(pad: PadRig, ringGlow: number): void {
    pad.pistonGroup.position.y = 0;
    pad.pistonRod.visible = false;
    pad.trapdoorPivot.rotation.x = 0;
    pad.contactRingMat.opacity = ringGlow;
    pad.victoryHaloMat.opacity = 0;
    pad.chuteRimMat.opacity = 0;
    pad.coilSpring.visible = true;
    pad.coilSpring.scale.y = 1;
  }

  private applyPoseAtTime(t: number, dt = 0.016, clockSec = t): void {
    const verdict = this.activeVerdict;
    if (!verdict) return;

    // 1. Brass Attack Medallion Drop (`0.0s .. 0.32s`)
    const medDropP = THREE.MathUtils.clamp(t / 0.32, 0, 1);
    const bounce =
      medDropP < 0.78
        ? 1 - (medDropP / 0.78) * (medDropP / 0.78)
        : Math.sin(((medDropP - 0.78) / 0.22) * Math.PI) * 0.08;
    this.medallionMesh.position.y = Math.max(0, bounce * 1.55);

    // 2. Ribbed Tambour Shutter Retraction (`0.0s .. 0.42s`) exposing both steel coil springs (`ref_battle_act1_lockin.webp`)
    const shutterP = THREE.MathUtils.smoothstep(t, 0.0, 0.42);
    this.shutterGroup.position.set(
      0,
      THREE.MathUtils.lerp(-0.04, 0.05, shutterP),
      THREE.MathUtils.lerp(0.04, -0.84, shutterP)
    );
    this.shutterGroup.scale.set(1, 1, THREE.MathUtils.lerp(1.08, 0.34, shutterP));

    // 3. Act 1 (`0.0s .. 0.9s`): Wedges Arc & Slam onto Spring-Loaded Brass Pads + Fine Radial Sparks
    if (this.playerStageWedge && this.enemyStageWedge) {
      const flyP = THREE.MathUtils.clamp((t - 0.08) / 0.42, 0, 1);
      const easedFly = 1 - Math.pow(1 - flyP, 3);

      const leftPadWorld = new THREE.Vector3(-PAD_X, 0.06, ARBITER_BAY_CENTER_Z + 0.2);
      const rightPadWorld = new THREE.Vector3(PAD_X, 0.06, ARBITER_BAY_CENTER_Z + 0.2);

      const pOffset = this.playerStartWorld.clone().sub(leftPadWorld).multiplyScalar(1 - easedFly);
      const eOffset = this.enemyStartWorld.clone().sub(rightPadWorld).multiplyScalar(1 - easedFly);
      const arcLift = Math.sin(flyP * Math.PI) * 1.25;

      let impactTiltZ = 0;
      let impactTiltX = 0;
      if (t >= 0.46 && t < 0.95) {
        const settle = 1 - THREE.MathUtils.smoothstep(t, 0.52, 0.92);
        impactTiltZ = 0.24 * settle;
        impactTiltX = 0.12 * settle;
      }

      this.playerStageWedge.visible = true;
      this.enemyStageWedge.visible = true;
      this.playerStageWedge.position.set(pOffset.x, pOffset.y + arcLift, pOffset.z);
      this.playerStageWedge.rotation.set(
        impactTiltX,
        0.2 * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1.15)),
        impactTiltZ
      );

      this.enemyStageWedge.position.set(eOffset.x, eOffset.y + arcLift, eOffset.z);
      this.enemyStageWedge.rotation.set(
        -impactTiltX * 0.7,
        Math.PI - 0.16 * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1.15)),
        -impactTiltZ * 0.75
      );
    }

    const ringIgnite = THREE.MathUtils.smoothstep(t, 0.42, 0.55);
    this.leftPad.contactRingMat.opacity = THREE.MathUtils.lerp(0.15, 0.98, ringIgnite);
    this.rightPad.contactRingMat.opacity = THREE.MathUtils.lerp(0.15, 0.98, ringIgnite);
    this.leftPad.coilSpring.visible = true;
    this.rightPad.coilSpring.visible = true;

    if ((t >= 0.48 && t <= 0.88 && !this.sparksSpawned) || (this.pausedForDebug && t >= 0.45 && t < 0.9)) {
      this.sparksSpawned = true;
      this.triggerImpactSparks(this.pausedForDebug ? 0.45 : 0);
    } else if (t >= 0.92) {
      for (const s of this.sparks) s.mesh.visible = false;
    }

    if (t >= 0.48 && t <= 0.74 && !this.pausedForDebug) {
      const shakeAmp = (1 - (t - 0.48) / 0.26) * 0.055;
      this.cameraShakeOffset.set(Math.sin(t * 95) * shakeAmp, Math.cos(t * 112) * shakeAmp, 0);
    } else {
      this.cameraShakeOffset.set(0, 0, 0);
    }

    // 4. Act 2 (`0.9s .. 2.7s`): Pad Depression, Rising Instrument Tower, Spiky CRT, Relay Lightning
    const act2Rise = THREE.MathUtils.smoothstep(t, 0.86, 1.18);
    this.instrumentTower.visible = t >= 0.84;
    this.instrumentTower.position.set(0, THREE.MathUtils.lerp(-0.92, 0.14, act2Rise), -0.74);

    const depress = t >= 0.5 && t < 2.72 ? THREE.MathUtils.smoothstep(t, 0.5, 0.95) * -0.055 : 0;
    this.leftPad.pistonGroup.position.y = depress;
    this.rightPad.pistonGroup.position.y = depress;
    this.leftPad.coilSpring.scale.y = 1 + depress * 2.2;
    this.rightPad.coilSpring.scale.y = 1 + depress * 2.2;
    this.leftPad.pistonRod.visible = false;
    this.rightPad.pistonRod.visible = false;
    this.leftPad.trapdoorPivot.rotation.x = 0;
    this.rightPad.trapdoorPivot.rotation.x = 0;
    this.leftPad.victoryHaloMat.opacity = 0;
    this.rightPad.victoryHaloMat.opacity = 0;
    this.leftPad.chuteRimMat.opacity = 0;
    this.rightPad.chuteRimMat.opacity = 0;
    this.winConeLeft.visible = false;
    this.winConeRight.visible = false;

    const showArcs =
      (t >= 0.94 && t < 2.72) || (verdict.resolution === 'MUTUAL_SPLIT' && t >= 2.72 && t < 2.95);
    for (let i = 0; i < this.arcLines.length; i++) {
      const line = this.arcLines[i]!;
      line.visible = showArcs;
      if (showArcs) {
        this.updateLightningBolt(line, i, clockSec);
      }
    }
    this.arcMat.opacity = showArcs ? 0.95 : 0;

    if (t >= 0.88 && t < 2.7) {
      for (let idx = 0; idx < this.domes.length; idx++) {
        const d = this.domes[idx]!;
        const flicker = 0.82 + 0.18 * Math.sin(clockSec * 14 + idx * 1.7);
        const col =
          d.baseColor === 'RED'
            ? new THREE.Color(2.0, 0.22, 0.18)
            : new THREE.Color(2.0, 1.32, 0.28);
        d.coreMat.color.copy(col).multiplyScalar(flicker);
        (d.beamMat.uniforms['uColor']!.value as THREE.Color).copy(col);
        d.beamMat.uniforms['uOpacity']!.value = 0.26 * flicker * act2Rise;
      }
      this.updateTubeMeter(this.leftTube, 0.76 + 0.22 * Math.sin(clockSec * 17), true);
      this.updateTubeMeter(this.rightTube, 0.76 + 0.22 * Math.cos(clockSec * 19), true);
      this.renderCrtOscilloscope('ARBITRATING', clockSec);
    }

    // 5. Act 3 (`2.7s .. 4.1s`): Hydraulic Winner Elevation + Hinged Red-Rimmed Trapdoor Chute!
    if (t >= 2.7) {
      const act3P = THREE.MathUtils.clamp((t - 2.7) / 0.42, 0, 1);
      const smooth3 = 1 - Math.pow(1 - act3P, 3);
      // Slower, theatrical chute tumble (`2.76s .. 3.95s`) so at `t ~ 3.2–3.5s` the defeated wedge is
      // dramatically visible tilted mid-fall inside the red-rimmed dark trapdoor chute (`ref_battle_act3_winner.webp`)!
      const dropP = THREE.MathUtils.clamp((t - 2.76) / 1.15, 0, 1);

      const playerWins =
        verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';
      const enemyWins =
        verdict.resolution === 'ENEMY_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY';
      const isSplit = verdict.resolution === 'MUTUAL_SPLIT';
      const isFlagCapture =
        verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
        verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY';

      if (playerWins) {
        this.elevateWinningPad(this.leftPad, this.playerStageWedge, smooth3, clockSec);
        this.winConeLeft.visible = true;
        this.winConeLeftMat.uniforms['uOpacity']!.value = 0.085 * smooth3;
        this.openTrapdoorAndDropLoser(this.rightPad, this.enemyStageWedge, smooth3, dropP);

        this.setDomeVictoryState(0, 'GOLD');
        this.setDomeVictoryState(1, 'GOLD');
        this.setDomeVictoryState(2, isFlagCapture ? 'GOLD' : 'OFF');
        this.setDomeVictoryState(3, isFlagCapture ? 'GOLD' : 'OFF');
        this.updateTubeMeter(this.leftTube, 1.0, true);
        this.updateTubeMeter(this.rightTube, 0.0, false);

        this.spawnContinuousVictoryEmbers(-PAD_X, dt, this.pausedForDebug);
        this.spawnLoserSmoke(PAD_X, dt, this.pausedForDebug);
        this.renderCrtOscilloscope(isFlagCapture ? 'CROWN' : 'GOLD_WIN', clockSec);
      } else if (enemyWins) {
        this.elevateWinningPad(this.rightPad, this.enemyStageWedge, smooth3, clockSec);
        this.winConeRight.visible = true;
        this.winConeRightMat.uniforms['uOpacity']!.value = 0.085 * smooth3;
        this.openTrapdoorAndDropLoser(this.leftPad, this.playerStageWedge, smooth3, dropP);

        this.setDomeVictoryState(0, 'OFF');
        this.setDomeVictoryState(1, 'OFF');
        this.setDomeVictoryState(2, 'GOLD');
        this.setDomeVictoryState(3, 'GOLD');
        this.updateTubeMeter(this.leftTube, 0.0, false);
        this.updateTubeMeter(this.rightTube, 1.0, true);

        this.spawnContinuousVictoryEmbers(PAD_X, dt, this.pausedForDebug);
        this.spawnLoserSmoke(-PAD_X, dt, this.pausedForDebug);
        this.renderCrtOscilloscope('GOLD_WIN', clockSec);
      } else if (isSplit) {
        this.openTrapdoorAndDropLoser(this.leftPad, this.playerStageWedge, smooth3, dropP);
        this.openTrapdoorAndDropLoser(this.rightPad, this.enemyStageWedge, smooth3, dropP);

        const flash = Math.max(0, 1 - (t - 2.7) * 4.5);
        for (let i = 0; i < 4; i++) {
          this.setDomeVictoryState(i, flash > 0.2 ? 'GOLD' : 'OFF');
        }
        this.updateTubeMeter(this.leftTube, flash, flash > 0.2);
        this.updateTubeMeter(this.rightTube, flash, flash > 0.2);
        this.spawnLoserSmoke(-PAD_X, dt, this.pausedForDebug);
        this.spawnLoserSmoke(PAD_X, dt, this.pausedForDebug);
        this.renderCrtOscilloscope('FLATLINE', clockSec);
      }
    }

    if (!this.pausedForDebug) {
      this.stepParticles(dt);
    }
  }

  private elevateWinningPad(
    pad: PadRig,
    wedge: THREE.Group | null,
    smooth3: number,
    clockSec: number
  ): void {
    pad.pistonRod.visible = true;
    pad.pistonGroup.position.y = 0.38 * smooth3;
    pad.victoryHaloMat.opacity = 0.95 * smooth3;
    pad.contactRingMat.opacity = 0.95;
    if (wedge) {
      wedge.position.set(0, 0.02, 0);
      const baseRotY = wedge === this.enemyStageWedge ? Math.PI : 0.26 * smooth3;
      wedge.rotation.set(0, baseRotY + Math.sin(clockSec * 2.2) * 0.03, 0);
    }
  }

  private openTrapdoorAndDropLoser(
    pad: PadRig,
    wedge: THREE.Group | null,
    smooth3: number,
    dropP: number
  ): void {
    pad.coilSpring.visible = smooth3 < 0.2;
    pad.trapdoorPivot.rotation.x = -THREE.MathUtils.degToRad(78) * smooth3;
    pad.chuteRimMat.opacity = 0.98 * smooth3;
    pad.contactRingMat.opacity = 0.0;

    if (wedge) {
      // Dramatic mid-chute catch & slide (`y = -0.22 .. -0.44`) through `dropP = 0.85` so across ALL of Act 3
      // (`BATTLE WINNER` and `MUTUAL ELIMINATION`), the defeated wedge is clearly visible tilted inside
      // the red-rimmed trapdoor pit just like `ref_battle_act3_winner.webp`, plunging clear only at the very end!
      const mainSlide =
        dropP < 0.82
          ? THREE.MathUtils.lerp(-0.08, -0.38, Math.pow(dropP / 0.82, 0.7))
          : THREE.MathUtils.lerp(-0.38, -1.05, (dropP - 0.82) / 0.18);
      wedge.position.set(-0.05 * Math.min(1, dropP * 1.5), mainSlide, 0.08 * Math.min(1, dropP * 1.5));
      const baseRotY = wedge === this.enemyStageWedge ? Math.PI - 0.28 : 0.28;
      const tiltAmt = Math.min(1, dropP * 2.2);
      wedge.rotation.set(0.42 * tiltAmt, baseRotY, -0.48 * tiltAmt);
      wedge.visible = dropP < 0.96;
    }
  }

  private setDomeVictoryState(index: number, mode: 'GOLD' | 'OFF'): void {
    const d = this.domes[index];
    if (!d) return;
    if (mode === 'GOLD') {
      d.coreMat.color.setRGB(2.15, 1.48, 0.38);
      (d.beamMat.uniforms['uColor']!.value as THREE.Color).setRGB(1.9, 1.32, 0.34);
      d.beamMat.uniforms['uOpacity']!.value = 0.28;
    } else {
      d.coreMat.color.setRGB(0.05, 0.05, 0.06);
      d.glassMat.color.setHex(0x1b1e24);
      d.beamMat.uniforms['uOpacity']!.value = 0;
    }
  }

  private updateTubeMeter(tube: TubeMeterRig, level: number, lit: boolean): void {
    if (!lit) {
      tube.filamentMat.color.setRGB(0.06, 0.06, 0.07);
      for (const m of tube.barMats) m.color.setRGB(0.07, 0.07, 0.08);
      return;
    }
    tube.filamentMat.color.setRGB(1.85, 1.08, 0.34);
    tube.barMats.forEach((m, idx) => {
      const thresh = (idx % 6) / 6;
      const colBias = Math.floor(idx / 6) * 0.14;
      const active = level + colBias * Math.sin(level * 9 + idx) >= thresh;
      if (active) {
        m.color.setRGB(1.95, 1.32, 0.38);
      } else {
        m.color.setRGB(0.2, 0.13, 0.06);
      }
    });
  }

  /**
   * High-density spiked dual-color CRT oscilloscope matching `ref_battle_act2_suspense.webp` & `act3`!
   */
  private renderCrtOscilloscope(
    mode: 'ARBITRATING' | 'GOLD_WIN' | 'CROWN' | 'FLATLINE',
    clockSec: number
  ): void {
    const ctx = this.crtCtx;
    const w = this.crtCanvas.width;
    const h = this.crtCanvas.height;

    ctx.fillStyle = '#060b10';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(70, 120, 140, 0.15)';
    ctx.lineWidth = 1;
    for (let gx = 32; gx < w; gx += 32) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 26; gy < h; gy += 26) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const hasLiveAudio = this.sound.sampleLiveWaveform(this.waveformSample);

    const grad = ctx.createLinearGradient(14, 0, w - 14, 0);
    if (mode === 'ARBITRATING') {
      grad.addColorStop(0.0, '#ffb636');
      grad.addColorStop(0.47, '#ffe47e');
      grad.addColorStop(0.55, '#6df4ff');
      grad.addColorStop(1.0, '#27ccff');
    } else if (mode === 'CROWN') {
      grad.addColorStop(0.0, '#ff5969');
      grad.addColorStop(0.5, '#ffe678');
      grad.addColorStop(1.0, '#ff5969');
    } else {
      grad.addColorStop(0.0, '#ffae2b');
      grad.addColorStop(0.5, '#ffe885');
      grad.addColorStop(1.0, '#ffae2b');
    }

    const midY = h * 0.5;

    // Vertical spiked energy bars + crisp connecting trace matching `ref_battle_act2_suspense.webp`!
    ctx.save();
    ctx.strokeStyle = grad;
    ctx.shadowColor = mode === 'ARBITRATING' ? '#6beeff' : '#ffd257';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2.2;
    ctx.beginPath();

    for (let x = 12; x <= w - 12; x += 3) {
      const u = (x - 12) / (w - 24);
      const env = Math.pow(Math.sin(u * Math.PI), 0.75);
      let amp: number;

      if (mode === 'FLATLINE') {
        amp = Math.sin(u * 26 + clockSec * 10) * 0.05 * env;
      } else {
        const sIdx = Math.min(
          this.waveformSample.length - 1,
          Math.floor(u * (this.waveformSample.length - 1))
        );
        const liveVal = hasLiveAudio ? this.waveformSample[sIdx]! * 2.4 : 0;
        const synthHarmonics =
          Math.sin(u * 92 + clockSec * 33) * 0.48 +
          Math.cos(u * 184 - clockSec * 51) * 0.36 +
          Math.sin(u * 310 + clockSec * 77) * 0.24;
        const sign = x % 6 === 0 ? 1 : -1;
        const combined = Math.abs(liveVal) > 0.18 ? liveVal : synthHarmonics * sign;
        amp = combined * env * (mode === 'CROWN' ? 1.05 : 0.88);
      }

      const py = midY - Math.max(-0.9, Math.min(0.9, amp)) * (h * 0.42);
      if (x === 12) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }
    ctx.stroke();
    ctx.restore();

    this.crtTexture.needsUpdate = true;
  }

  private buildBaySubDeck(): void {
    // Deep pitch-black bay liner enclosing the entire Arbiter pocket so walnut NEVER peeks into chutes!
    const bayTub = new THREE.Mesh(
      new THREE.BoxGeometry(5.06, 1.5, 2.08),
      new THREE.MeshBasicMaterial({ color: 0x050608, side: THREE.BackSide })
    );
    bayTub.position.set(0, -0.78, 0);
    this.root.add(bayTub);

    const deckShape = new THREE.Shape();
    const hw = 2.52;
    const hd = 1.04;
    deckShape.moveTo(-hw, -hd);
    deckShape.lineTo(hw, -hd);
    deckShape.lineTo(hw, hd);
    deckShape.lineTo(-hw, hd);
    deckShape.closePath();

    for (const cx of [-PAD_X, PAD_X]) {
      const hole = new THREE.Path();
      const chw = 0.68;
      const chd = 0.56;
      const sy = -0.2;
      hole.moveTo(cx - chw, sy - chd);
      hole.lineTo(cx + chw, sy - chd);
      hole.lineTo(cx + chw, sy + chd);
      hole.lineTo(cx - chw, sy + chd);
      hole.closePath();
      deckShape.holes.push(hole);
    }

    const deckGeo = new THREE.ExtrudeGeometry(deckShape, { depth: 0.08, bevelEnabled: false });
    deckGeo.rotateX(-Math.PI / 2);
    const subDeck = new THREE.Mesh(deckGeo, this.factory.materials.darkSteel);
    subDeck.position.y = -0.09;
    subDeck.receiveShadow = true;
    this.root.add(subDeck);
  }

  private buildPadRig(centerX: number, tint: 'CYAN' | 'CRIMSON'): PadRig {
    const bezelGroup = new THREE.Group();
    bezelGroup.position.set(centerX, -0.02, 0.2);

    const bezelShape = new THREE.Shape();
    bezelShape.moveTo(-0.88, -0.76);
    bezelShape.lineTo(0.88, -0.76);
    bezelShape.lineTo(0.88, 0.76);
    bezelShape.lineTo(-0.88, 0.76);
    bezelShape.closePath();

    const hole = new THREE.Path();
    hole.moveTo(-0.67, -0.55);
    hole.lineTo(0.67, -0.55);
    hole.lineTo(0.67, 0.55);
    hole.lineTo(-0.67, 0.55);
    hole.closePath();
    bezelShape.holes.push(hole);

    const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 2,
    });
    bezelGeo.rotateX(-Math.PI / 2);
    const bezelMesh = new THREE.Mesh(bezelGeo, this.factory.materials.gunmetal);
    bezelMesh.receiveShadow = true;
    bezelGroup.add(bezelMesh);

    const screwGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.02, 12);
    for (const [sx, sz] of [
      [-0.77, -0.65],
      [0.77, -0.65],
      [-0.77, 0.65],
      [0.77, 0.65],
    ] as const) {
      const screw = new THREE.Mesh(screwGeo, this.factory.materials.brassTrim);
      screw.position.set(sx, 0.065, sz);
      bezelGroup.add(screw);
    }

    // Solid pitch-black chute shaft + glowing 3D crimson neon inner collar (`ref_battle_act3_winner.webp`)
    const pitShaft = new THREE.Mesh(
      new THREE.BoxGeometry(1.36, 1.5, 1.12),
      new THREE.MeshBasicMaterial({ color: 0x030406, side: THREE.BackSide })
    );
    pitShaft.position.set(0, -0.76, 0);
    bezelGroup.add(pitShaft);

    const chuteRimShape = new THREE.Shape();
    chuteRimShape.moveTo(-0.66, -0.54);
    chuteRimShape.lineTo(0.66, -0.54);
    chuteRimShape.lineTo(0.66, 0.54);
    chuteRimShape.lineTo(-0.66, 0.54);
    chuteRimShape.closePath();
    const rimHole = new THREE.Path();
    rimHole.moveTo(-0.62, -0.5);
    rimHole.lineTo(0.62, -0.5);
    rimHole.lineTo(0.62, 0.5);
    rimHole.lineTo(-0.62, 0.5);
    rimHole.closePath();
    chuteRimShape.holes.push(rimHole);

    const chuteRimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.1, 0.24, 0.26),
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    const chuteRimGeo = new THREE.ExtrudeGeometry(chuteRimShape, { depth: 0.024, bevelEnabled: false });
    chuteRimGeo.rotateX(-Math.PI / 2);
    const chuteRimMesh = new THREE.Mesh(chuteRimGeo, chuteRimMat);
    chuteRimMesh.position.set(0, 0.01, 0);
    bezelGroup.add(chuteRimMesh);

    // Prominent brushed-steel helical coil spring + brass relay post behind pad (`ref_battle_act1_lockin.webp`)
    const coilSpring = new THREE.Group();
    coilSpring.position.set(tint === 'CYAN' ? 0.18 : -0.18, 0.05, -0.58);
    const steelCoilMat = new THREE.MeshStandardMaterial({
      color: 0xaab4c2,
      metalness: 0.86,
      roughness: 0.28,
    });
    for (let c = 0; c < 6; c++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.024, 8, 18), steelCoilMat);
      ring.rotation.x = Math.PI / 2 + 0.14;
      ring.position.y = c * 0.04;
      coilSpring.add(ring);
    }
    bezelGroup.add(coilSpring);

    const relayPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.065, 0.24, 14),
      this.factory.materials.brassTrim
    );
    relayPost.position.set(tint === 'CYAN' ? 0.5 : -0.5, 0.1, -0.69);
    bezelGroup.add(relayPost);

    // Hydraulic Piston Cylinder
    const pistonRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.3, 0.5, 24),
      this.factory.materials.gunmetal
    );
    pistonRod.position.set(0, 0.18, 0);
    pistonRod.visible = false;
    bezelGroup.add(pistonRod);

    const pistonGroup = new THREE.Group();
    bezelGroup.add(pistonGroup);

    // Rear Trapdoor Hinge Pivot (`z = -0.53`) with beveled brass rim + recessed dark-bronze underside!
    const trapdoorPivot = new THREE.Group();
    trapdoorPivot.position.set(0, 0.03, -0.53);
    pistonGroup.add(trapdoorPivot);

    const padPlate = new THREE.Mesh(
      new THREE.BoxGeometry(1.28, 0.075, 1.04),
      this.factory.materials.brassTrim
    );
    padPlate.position.set(0, 0.02, 0.53);
    padPlate.castShadow = true;
    padPlate.receiveShadow = true;
    trapdoorPivot.add(padPlate);

    // Recessed dark-bronze underside panel so when the trapdoor hinges open 78 deg (`ref_battle_act3_winner.webp`),
    // its underside looks like a machined framed industrial hatch rather than a flat slab!
    const underPanel = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.02, 0.86),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#3a2a14'),
        metalness: 0.72,
        roughness: 0.44,
      })
    );
    underPanel.position.set(0, -0.015, 0.53);
    trapdoorPivot.add(underPanel);

    const upperPadStep = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.042, 0.88),
      this.factory.materials.brassRecessed
    );
    upperPadStep.position.set(0, 0.068, 0.53);
    upperPadStep.receiveShadow = true;
    trapdoorPivot.add(upperPadStep);

    const contactRingMat = new THREE.MeshBasicMaterial({
      color:
        tint === 'CYAN'
          ? new THREE.Color(0.32, 1.75, 2.2)
          : new THREE.Color(2.15, 0.26, 0.34),
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.024, 12, 36), contactRingMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.set(0, 0.095, 0.53);
    trapdoorPivot.add(ringMesh);

    const victoryHaloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.45, 1.08, 0.34),
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    const vicHalo = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.026, 12, 36), victoryHaloMat);
    vicHalo.rotation.x = Math.PI / 2;
    vicHalo.position.set(0, 0.1, 0.53);
    trapdoorPivot.add(vicHalo);

    const pieceSocket = new THREE.Group();
    pieceSocket.position.set(0, 0.096, 0);
    pistonGroup.add(pieceSocket);

    return {
      bezelGroup,
      pistonGroup,
      pistonRod,
      trapdoorPivot,
      contactRingMat,
      victoryHaloMat,
      chuteRimMat,
      pieceSocket,
      coilSpring,
    };
  }

  private buildRetractableShutter(): void {
    const drumGroup = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4.45, 0.34, 1.55),
      this.factory.materials.gunmetal
    );
    body.position.y = 0.08;
    body.castShadow = true;
    body.receiveShadow = true;
    drumGroup.add(body);

    // Alternating raised brushed-steel & recessed gunmetal tambour ribs so every slat catches light!
    for (let r = -17; r <= 17; r++) {
      const rib = new THREE.Mesh(
        new THREE.CylinderGeometry(0.042, 0.042, 1.48, 12),
        this.factory.materials.gunmetal
      );
      rib.rotation.x = Math.PI / 2;
      rib.position.set(r * 0.122, 0.275, 0);
      drumGroup.add(rib);
    }

    // 3 recessed status indicator LEDs along rear lip (`ref_battle_act1_lockin.webp`)
    const ledColors = [0xff3b47, 0x45505e, 0xffca48];
    ledColors.forEach((hex, idx) => {
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 10, 8),
        new THREE.MeshBasicMaterial({ color: hex })
      );
      led.position.set(0.36 + idx * 0.34, 0.21, -0.72);
      drumGroup.add(led);
    });

    this.shutterGroup.add(drumGroup);
    this.attachBakedShutterIfReady();
  }

  private buildInstrumentTower(): { leftTube: TubeMeterRig; rightTube: TubeMeterRig } {
    // Compact `3.56`-wide gunmetal housing so all 4 Fresnel domes + both Vacuum-Tube VU meters
    // fit 100% inside a narrow `412x915` mobile portrait frame!
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(3.56, 1.14, 0.66),
      this.factory.materials.gunmetal
    );
    chassis.position.set(0, 0.56, 0);
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.instrumentTower.add(chassis);

    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.92, 0.12),
      this.factory.materials.darkSteel
    );
    bezel.position.set(0, 0.56, 0.32);
    this.instrumentTower.add(bezel);

    const crtGeo = new THREE.PlaneGeometry(1.26, 0.78, 16, 10);
    const cPos = crtGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cPos.count; i++) {
      const x = cPos.getX(i) / 0.63;
      const y = cPos.getY(i) / 0.39;
      const bulge = (1 - x * x * 0.35 - y * y * 0.35) * 0.042;
      cPos.setZ(i, bulge);
    }
    crtGeo.computeVertexNormals();

    const crtScreen = new THREE.Mesh(
      crtGeo,
      new THREE.MeshBasicMaterial({ map: this.crtTexture, toneMapped: false })
    );
    crtScreen.position.set(0, 0.56, 0.37);
    this.instrumentTower.add(crtScreen);

    for (const [rx, ry] of [
      [-0.65, 0.94],
      [0.65, 0.94],
      [-0.65, 0.18],
      [0.65, 0.18],
    ] as const) {
      const riv = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 8),
        this.factory.materials.brassTrim
      );
      riv.position.set(rx, ry, 0.38);
      this.instrumentTower.add(riv);
    }

    const leftTube = this.buildVacuumTubeAlcove(-1.18);
    const rightTube = this.buildVacuumTubeAlcove(1.18);

    const domeSpecs: Array<{ x: number; color: 'RED' | 'AMBER' }> = [
      { x: -1.18, color: 'RED' },
      { x: -0.4, color: 'AMBER' },
      { x: 0.4, color: 'RED' },
      { x: 1.18, color: 'AMBER' },
    ];

    for (const spec of domeSpecs) {
      const dGroup = new THREE.Group();
      dGroup.position.set(spec.x, 1.13, 0.02);

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.21, 0.24, 0.075, 20),
        this.factory.materials.darkSteel
      );
      collar.position.y = 0.038;
      dGroup.add(collar);

      const coreMat = new THREE.MeshBasicMaterial({
        color: spec.color === 'RED' ? 0xff3322 : 0xffbb33,
        toneMapped: false,
      });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), coreMat);
      core.position.y = 0.16;
      dGroup.add(core);

      const glassMat = new THREE.MeshPhysicalMaterial({
        color: spec.color === 'RED' ? new THREE.Color('#ff3b2f') : new THREE.Color('#ffbe3d'),
        transparent: true,
        opacity: 0.6,
        roughness: 0.14,
        metalness: 0.05,
        clearcoat: 1.0,
      });
      const domeLens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.19, 0.25, 16),
        glassMat
      );
      domeLens.position.y = 0.19;
      dGroup.add(domeLens);

      const domeCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        glassMat
      );
      domeCap.position.y = 0.315;
      dGroup.add(domeCap);

      // Soft Fresnel edge-faded volumetric beacon cone!
      const beamColor =
        spec.color === 'RED'
          ? new THREE.Color(1.6, 0.24, 0.18)
          : new THREE.Color(1.65, 1.15, 0.28);
      const beamMat = createVolumetricBeamShader(beamColor);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.16, 1.95, 24, 1, true), beamMat);
      beam.rotation.z = spec.x * -0.16;
      beam.position.set(spec.x * 0.14, 1.18, -0.08);
      dGroup.add(beam);

      this.instrumentTower.add(dGroup);
      this.domes.push({
        group: dGroup,
        coreMat,
        glassMat,
        beamMat,
        baseColor: spec.color,
      });
    }

    return { leftTube, rightTube };
  }

  private buildVacuumTubeAlcove(centerX: number): TubeMeterRig {
    const g = new THREE.Group();
    g.position.set(centerX, 0.6, 0.3);

    const alcoveBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.88, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0b0f15, roughness: 0.85 })
    );
    g.add(alcoveBack);

    // Upper Half (`y = +0.18`): Clear glass Vacuum Tube with glowing amber filament & metallic anode cap!
    const filamentMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.9, 1.1, 0.32),
      toneMapped: false,
    });
    const filament = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.24, 10), filamentMat);
    filament.position.set(0, 0.19, 0.08);
    g.add(filament);

    const glassTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 0.3, 18),
      new THREE.MeshPhysicalMaterial({
        color: 0xffd9a8,
        transparent: true,
        opacity: 0.22,
        roughness: 0.08,
        clearcoat: 1.0,
      })
    );
    glassTube.position.set(0, 0.2, 0.08);
    g.add(glassTube);

    const tubeCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      this.factory.materials.gunmetal
    );
    tubeCap.position.set(0, 0.35, 0.08);
    g.add(tubeCap);

    // Lower Half (`y = -0.34 .. +0.02`, zero overlap with tube!): 4 columns × 6 rows of crisp amber VU bars!
    const barMats: THREE.MeshBasicMaterial[] = [];
    const barGeo = new THREE.PlaneGeometry(0.12, 0.036);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 6; row++) {
        const bm = new THREE.MeshBasicMaterial({
          color: new THREE.Color(1.95, 1.25, 0.34),
          toneMapped: false,
        });
        const bar = new THREE.Mesh(barGeo, bm);
        bar.position.set((col - 1.5) * 0.155, -0.34 + row * 0.056, 0.06);
        g.add(bar);
        barMats.push(bm);
      }
    }

    this.instrumentTower.add(g);
    return { filamentMat, barMats };
  }

  private updateLightningBolt(line: THREE.Line, boltIdx: number, clockSec: number): void {
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    const zBase = boltIdx < 3 ? -0.32 + boltIdx * 0.14 : 0.14 + (boltIdx - 3) * 0.16;
    const yBase = boltIdx < 3 ? 0.19 : 0.13;
    const xStart = -0.68;
    const xEnd = 0.68;

    for (let i = 0; i < pos.count; i++) {
      const u = i / (pos.count - 1);
      const env = Math.sin(u * Math.PI);
      const jitterY =
        Math.sin(clockSec * 57 + i * 3.7 + boltIdx * 2.1) * 0.16 * env +
        Math.cos(clockSec * 93 - i * 5.3) * 0.08 * env;
      const jitterZ = Math.cos(clockSec * 63 + i * 4.1 + boltIdx) * 0.12 * env;
      pos.setXYZ(
        i,
        THREE.MathUtils.lerp(xStart, xEnd, u),
        yBase + Math.abs(jitterY),
        zBase + jitterZ
      );
    }
    pos.needsUpdate = true;
  }

  private initParticlePools(): void {
    // Razor-thin hot golden-amber metallic grind sparks (`ref_battle_act1_lockin.webp`)
    const sparkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.2, 1.55, 0.55),
      toneMapped: false,
    });
    const sparkGeo = new THREE.BoxGeometry(0.008, 0.008, 0.36);
    for (let i = 0; i < 42; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.sparks.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0.44 });
    }

    const emberMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.1, 1.48, 0.42),
      toneMapped: false,
    });
    const emberGeo = new THREE.SphereGeometry(0.018, 6, 6);
    for (let i = 0; i < 26; i++) {
      const mesh = new THREE.Mesh(emberGeo, emberMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.embers.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1.1 });
    }

    // Soft radial sprite wisps (never hard grey circles!)
    const smokeTex = createSoftSmokeTexture();
    const smokeMat = new THREE.SpriteMaterial({
      map: smokeTex,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    for (let i = 0; i < 12; i++) {
      const sprite = new THREE.Sprite(smokeMat);
      sprite.scale.set(0.42, 0.42, 1);
      sprite.visible = false;
      this.root.add(sprite);
      this.smokePuffs.push({ mesh: sprite, vel: new THREE.Vector3(), life: 0, maxLife: 1.2 });
    }
  }

  private triggerImpactSparks(preAdvanceSec = 0): void {
    this.sparks.forEach((p, idx) => {
      const padX = idx < 32 ? -PAD_X : PAD_X;
      const ang = (idx / 32) * Math.PI * 2 + idx * 0.41;
      const spd = 2.2 + (idx % 5) * 0.7;
      p.vel.set(Math.cos(ang) * spd, 0.8 + (idx % 4) * 0.5, Math.sin(ang) * spd);
      p.mesh.position.set(padX + Math.cos(ang) * 0.24, 0.13, 0.2 + Math.sin(ang) * 0.24);
      if (preAdvanceSec > 0) {
        p.mesh.position.addScaledVector(p.vel, preAdvanceSec * 0.16);
      }
      p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
      p.life = 0.01;
      p.maxLife = 0.42;
      p.mesh.visible = true;
    });
  }

  private spawnContinuousVictoryEmbers(centerX: number, dt: number, staticPose: boolean): void {
    if (staticPose) {
      this.embers.forEach((e, idx) => {
        const a = idx * 1.37;
        const r = 0.16 + (idx % 5) * 0.11;
        e.mesh.position.set(
          centerX + Math.cos(a) * r,
          0.46 + (idx / this.embers.length) * 2.0,
          0.2 + Math.sin(a) * r
        );
        e.mesh.visible = true;
      });
      return;
    }
    for (const e of this.embers) {
      if (e.life <= 0 && Math.random() < dt * 24) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.14 + Math.random() * 0.42;
        e.mesh.position.set(centerX + Math.cos(a) * r, 0.44, 0.2 + Math.sin(a) * r);
        e.vel.set(
          (Math.random() - 0.5) * 0.32,
          1.3 + Math.random() * 1.0,
          (Math.random() - 0.5) * 0.32
        );
        e.life = e.maxLife;
        e.mesh.visible = true;
        break;
      }
    }
  }

  private spawnLoserSmoke(centerX: number, dt: number, staticPose: boolean): void {
    if (staticPose) {
      this.smokePuffs.forEach((s, idx) => {
        s.mesh.position.set(centerX * 0.78 + Math.sin(idx) * 0.18, 1.55 + idx * 0.14, -0.68);
        s.mesh.visible = idx < 5;
      });
      return;
    }
    for (const s of this.smokePuffs) {
      if (s.life <= 0 && Math.random() < dt * 9) {
        s.mesh.position.set(centerX * 0.78 + (Math.random() - 0.5) * 0.3, 1.5, -0.68);
        s.vel.set(
          (Math.random() - 0.5) * 0.15,
          0.65 + Math.random() * 0.3,
          (Math.random() - 0.5) * 0.15
        );
        s.life = s.maxLife;
        s.mesh.visible = true;
        break;
      }
    }
  }

  private stepParticles(dt: number): void {
    for (const p of this.sparks) {
      if (p.life <= 0) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.life = 0;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= 5.8 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
    }

    for (const e of [...this.embers, ...this.smokePuffs]) {
      if (e.life <= 0) continue;
      e.life -= dt;
      if (e.life <= 0) {
        e.mesh.visible = false;
        continue;
      }
      e.mesh.position.addScaledVector(e.vel, dt);
    }
  }

  private verdictToAct3Banner(res: BattleResolutionKind): HudBannerState {
    switch (res) {
      case 'PLAYER_WINS':
      case 'ENEMY_WINS':
        return 'BATTLE WINNER';
      case 'MUTUAL_SPLIT':
        return 'MUTUAL ELIMINATION';
      case 'FLAG_CAPTURED_BY_PLAYER':
        return 'FLAG CAPTURED — VICTORY';
      case 'FLAG_CAPTURED_BY_ENEMY':
        return 'FLAG LOST — DEFEAT';
    }
  }

  private cleanupStageWedges(): void {
    if (this.playerStageWedge) {
      this.leftPad.pieceSocket.remove(this.playerStageWedge);
      this.playerStageWedge = null;
    }
    if (this.enemyStageWedge) {
      this.rightPad.pieceSocket.remove(this.enemyStageWedge);
      this.enemyStageWedge = null;
    }
  }
}
