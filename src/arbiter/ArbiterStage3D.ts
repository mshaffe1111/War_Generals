import * as THREE from 'three';
import type { SoundDirector } from '../audio/SoundDirector';
import type { ArbiterVerdict, BattleResolutionKind, HudBannerState } from '../core/types';
import {
  ARBITER_BAY_CENTER_Z,
  gridToWorld,
  makeRoundedRectPath,
  type MeshFactory,
} from '../graphics/MeshFactory';

const PAD_X = 1.06;

interface PadRig {
  readonly bezelGroup: THREE.Group;
  readonly pistonGroup: THREE.Group;
  readonly pistonOuterSleeve: THREE.Mesh;
  readonly pistonInnerRam: THREE.Mesh;
  readonly trapdoorPivot: THREE.Group;
  readonly padMat: THREE.MeshPhysicalMaterial;
  readonly stepMat: THREE.MeshPhysicalMaterial;
  readonly contactRingMat: THREE.MeshBasicMaterial;
  readonly victoryHaloMat: THREE.MeshBasicMaterial;
  readonly chuteRimMat: THREE.MeshBasicMaterial;
  readonly pieceSocket: THREE.Group;
  readonly coilSpring: THREE.Group;
}

interface DomeRig {
  readonly group: THREE.Group;
  readonly filamentMesh: THREE.Mesh;
  readonly filamentMat: THREE.MeshStandardMaterial;
  readonly glassMat: THREE.MeshPhysicalMaterial;
  readonly pointLight: THREE.PointLight;
  readonly glowSprite: THREE.Sprite;
  readonly glowMat: THREE.SpriteMaterial;
  readonly baseColor: 'RED' | 'AMBER';
}

interface TubeMeterRig {
  readonly helixMesh: THREE.Mesh;
  readonly helixMat: THREE.MeshBasicMaterial;
  readonly tubeGlowSprite: THREE.Sprite;
  readonly glassMat: THREE.MeshPhysicalMaterial;
  readonly barMats: THREE.MeshBasicMaterial[];
}

interface PlasmaRibbon {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
}

interface ParticleItem {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Soft radial-falloff optical glow texture for Fresnel domes (ZERO `ConeGeometry` shapes!).
 */
function createRadialGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 2, c, c, c);
  g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.24, 'rgba(255, 235, 200, 0.58)');
  g.addColorStop(0.58, 'rgba(255, 195, 130, 0.16)');
  g.addColorStop(1.0, 'rgba(255, 160, 80, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Builds a 3D helical curve (`TubeGeometry`) for vacuum-tube & Fresnel tungsten filaments.
 */
function createHelixTubeGeometry(
  radius: number,
  height: number,
  turns: number,
  tubeRadius: number
): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const steps = turns * 14;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const ang = u * turns * Math.PI * 2;
    pts.push(
      new THREE.Vector3(
        Math.cos(ang) * radius,
        (u - 0.5) * height,
        Math.sin(ang) * radius
      )
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, steps, tubeRadius, 8, false);
}

/**
 * Rounded stepped-ring Fresnel glass dome (`LatheGeometry`) — zero flat cones!
 */
function createSteppedFresnelDomeGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.195, 0.0),
    new THREE.Vector2(0.195, 0.055),
    new THREE.Vector2(0.178, 0.068),
    new THREE.Vector2(0.184, 0.115),
    new THREE.Vector2(0.166, 0.128),
    new THREE.Vector2(0.172, 0.175),
    new THREE.Vector2(0.152, 0.19),
    new THREE.Vector2(0.156, 0.23),
  ];
  // Smooth hemispherical crown
  const crownSteps = 8;
  for (let i = 1; i <= crownSteps; i++) {
    const a = (i / crownSteps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * 0.152, 0.23 + Math.sin(a) * 0.125));
  }
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.computeVertexNormals();
  return geo;
}

/**
 * GLSL Multi-Strand Additive Plasma Ribbon Shader (`AdditiveBlending` + white-gold core + amber corona).
 */
function createPlasmaRibbonShader(seed: number, isFork: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uIntensity: { value: 0 },
      uFork: { value: isFork ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform float uFork;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec3 pos = position;
        float u = uv.x;
        // Pin ends tightly (u=0 and u=1) onto the left and right brass electrodes!
        float env = sin(u * 3.14159265);
        float arc1 = sin(u * 19.0 + uTime * 34.0 + uSeed * 5.1) * 0.11;
        float arc2 = cos(u * 43.0 - uTime * 59.0 + uSeed * 11.3) * 0.055;
        float arc3 = sin(u * 83.0 + uTime * 91.0 - uSeed * 7.7) * 0.025;
        float lift = env * 0.08 + (arc1 + arc2 + arc3) * env * (1.0 + uFork * 0.55);

        pos.y += lift;
        pos.z += cos(u * 29.0 + uTime * 47.0 + uSeed * 3.3) * 0.075 * env;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform float uFork;
      varying vec2 vUv;

      void main() {
        float dist = abs(vUv.y - 0.5) * 2.0;
        float endFade = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        float core = exp(-dist * dist * 34.0);
        float corona = exp(-dist * 4.2);

        vec3 coreCol = vec3(2.15, 1.38, 0.28);
        vec3 outerCol = vec3(1.45, 0.62, 0.06);
        vec3 col = coreCol * core + outerCol * corona * 0.65;
        float alpha = (core + corona * 0.52) * endFade * uIntensity * (uFork > 0.5 ? 0.55 : 0.85);
        gl_FragColor = vec4(col * alpha, alpha);
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

  /**
   * Guardrail #3: Strictly scoped clipping plane (`y >= -0.80`) applied ONLY to falling
   * Arbiter stage wedges & downward-hinging trapdoor pads—never touching live board pieces!
   */
  private readonly wellFloorClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.8);

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

  private readonly plasmaRibbons: PlasmaRibbon[] = [];
  private readonly winnerSpotLight: THREE.SpotLight;
  private readonly winnerFloorGlow: THREE.Sprite;
  private readonly winnerFloorGlowMat: THREE.SpriteMaterial;

  private readonly medallionMesh: THREE.Group;

  private playerStageWedge: THREE.Group | null = null;
  private enemyStageWedge: THREE.Group | null = null;
  private playerStartWorld = new THREE.Vector3();
  private enemyStartWorld = new THREE.Vector3();

  private readonly sparks: ParticleItem[] = [];
  private readonly embers: ParticleItem[] = [];

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

    // Subtle localized front instrument fill so chamfered gunmetal & hex bolts gleam cleanly
    const consoleFill = new THREE.PointLight(0xd8e6f8, 2.8, 8.5, 1.35);
    consoleFill.position.set(0, 2.5, 1.6);
    this.root.add(consoleFill);

    const glowTex = createRadialGlowTexture();

    // 1. Deep Dark Mechanical Wells (`y = 0.0` down to `y = -0.86`) & Beveled Gunmetal Deck
    this.buildBaySubDeck();

    // 2. Twin Spring-Loaded Brushed-Brass Pads (`-82 deg` DOWNWARD trapdoor hinge + `+0.38` Brass Piston!)
    this.leftPad = this.buildPadRig(-PAD_X, 'CYAN');
    this.rightPad = this.buildPadRig(PAD_X, 'CRIMSON');
    this.root.add(this.leftPad.bezelGroup, this.rightPad.bezelGroup);

    // 3. Ribbed Cylindrical Gunmetal Shutter docked behind the stage
    this.buildRetractableShutter();
    this.root.add(this.shutterGroup);

    // 4. Chamfered Hard-Surface Gunmetal Chassis + 4 Fresnel Glass Domes + Helical Vacuum Tubes + Curved CRT
    this.crtCanvas = document.createElement('canvas');
    this.crtCanvas.width = 320;
    this.crtCanvas.height = 192;
    this.crtCtx = this.crtCanvas.getContext('2d')!;
    this.crtTexture = new THREE.CanvasTexture(this.crtCanvas);
    this.crtTexture.colorSpace = THREE.SRGBColorSpace;

    const { leftTube, rightTube } = this.buildInstrumentTower(glowTex);
    this.leftTube = leftTube;
    this.rightTube = rightTube;
    this.root.add(this.instrumentTower);

    // 5. Multi-Strand Additive GLSL Plasma Ribbon Arcs (3 primary + 2 secondary forks)
    const span = (PAD_X - 0.5) * 2; // connects inner brass electrodes at `x = ±0.56`
    for (let i = 0; i < 5; i++) {
      const isFork = i >= 3;
      const mat = createPlasmaRibbonShader(i * 1.73 + 0.5, isFork);
      const ribbonGeo = new THREE.PlaneGeometry(span, isFork ? 0.11 : 0.18, 42, 1);
      // Tilt second cross-plane on alternating strands so ribbons have 3D volume from any angle
      if (i % 2 === 1) {
        ribbonGeo.rotateX(0.55);
      } else {
        ribbonGeo.rotateX(-0.35);
      }
      const mesh = new THREE.Mesh(ribbonGeo, mat);
      mesh.position.set(0, 0.17 + (i % 3) * 0.035, 0.08 + (i - 2) * 0.08);
      mesh.visible = false;
      this.root.add(mesh);
      this.plasmaRibbons.push({ mesh, mat });
    }

    // 6. Real Warm Golden Winner SpotLight + Soft Radial Stage Glow (ZERO ConeGeometry!)
    this.winnerSpotLight = new THREE.SpotLight(0xffd269, 0, 7.5, Math.PI / 5.2, 0.78, 1.2);
    this.winnerSpotLight.position.set(-PAD_X, 3.6, 0.65);
    this.root.add(this.winnerSpotLight, this.winnerSpotLight.target);

    this.winnerFloorGlowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color(1.65, 1.18, 0.36),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.winnerFloorGlow = new THREE.Sprite(this.winnerFloorGlowMat);
    this.winnerFloorGlow.scale.set(1.9, 2.3, 1);
    this.winnerFloorGlow.visible = false;
    this.root.add(this.winnerFloorGlow);

    // 7. Heavy Brushed-Brass Attack Medallion
    this.medallionMesh = this.factory.createAttackMedallion();
    this.worldMedallionGroup.visible = false;
    this.worldMedallionGroup.add(this.medallionMesh);

    this.initParticlePools();
    this.resetToIdle();
  }

  public attachBakedShutterIfReady(): void {
    const clone = this.factory.getBakedShutterClone();
    if (!clone) return;
    clone.scale.set(0.92, 0.24, 0.34);
    clone.position.set(0, 0.06, 0);
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

  private scopeMaterialsToWellClipPlane(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m: THREE.Material) => {
            const c = m.clone();
            c.clippingPlanes = [this.wellFloorClipPlane];
            return c;
          });
        } else if (child.material) {
          const c = (child.material as THREE.Material).clone();
          c.clippingPlanes = [this.wellFloorClipPlane];
          child.material = c;
        }
      }
    });
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
    this.scopeMaterialsToWellClipPlane(this.playerStageWedge);
    this.scopeMaterialsToWellClipPlane(this.enemyStageWedge);

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

    // Closed ribbed cylindrical shutter covering the Arbiter bay during normal turns
    this.shutterGroup.position.set(0, -0.02, 0.06);
    this.shutterGroup.scale.set(1, 1, 1.05);

    this.instrumentTower.position.set(0, -0.96, -0.72);
    this.instrumentTower.visible = false;

    this.resetPadRig(this.leftPad, 0.0);
    this.resetPadRig(this.rightPad, 0.0);
    this.leftPad.coilSpring.visible = false;
    this.rightPad.coilSpring.visible = false;

    for (let i = 0; i < this.domes.length; i++) {
      this.setDomePowerState(i, 'OFF', 0);
    }

    this.winnerSpotLight.intensity = 0;
    this.winnerFloorGlow.visible = false;
    for (const r of this.plasmaRibbons) r.mesh.visible = false;
    for (const p of [...this.sparks, ...this.embers]) {
      p.mesh.visible = false;
      p.life = 0;
    }
  }

  private resetPadRig(pad: PadRig, ringGlow: number): void {
    pad.pistonGroup.position.y = 0;
    pad.pistonOuterSleeve.visible = false;
    pad.pistonInnerRam.visible = false;
    pad.trapdoorPivot.rotation.x = 0;
    pad.padMat.color.set('#E2B04A');
    pad.padMat.envMapIntensity = 1.25;
    pad.stepMat.color.set('#946A22');
    pad.stepMat.envMapIntensity = 1.1;
    pad.contactRingMat.opacity = ringGlow;
    pad.victoryHaloMat.opacity = 0;
    pad.chuteRimMat.opacity = 0;
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

    // 2. Ribbed Cylindrical Shutter Retraction (`0.0s .. 0.42s`) behind the stage
    const shutterP = THREE.MathUtils.smoothstep(t, 0.0, 0.42);
    this.shutterGroup.position.set(
      0,
      THREE.MathUtils.lerp(-0.02, 0.06, shutterP),
      THREE.MathUtils.lerp(0.06, -0.86, shutterP)
    );
    this.shutterGroup.scale.set(1, 1, THREE.MathUtils.lerp(1.05, 0.36, shutterP));

    // 3. Act 1 (`0.0s .. 0.9s`): Wedges Arc & Slam onto Spring-Loaded Brass Pads
    if (this.playerStageWedge && this.enemyStageWedge) {
      const flyP = THREE.MathUtils.clamp((t - 0.08) / 0.42, 0, 1);
      const easedFly = 1 - Math.pow(1 - flyP, 3);

      const leftPadWorld = new THREE.Vector3(-PAD_X, 0.06, ARBITER_BAY_CENTER_Z + 0.18);
      const rightPadWorld = new THREE.Vector3(PAD_X, 0.06, ARBITER_BAY_CENTER_Z + 0.18);

      const pOffset = this.playerStartWorld.clone().sub(leftPadWorld).multiplyScalar(1 - easedFly);
      const eOffset = this.enemyStartWorld.clone().sub(rightPadWorld).multiplyScalar(1 - easedFly);
      const arcLift = Math.sin(flyP * Math.PI) * 1.25;

      let impactTiltZ = 0;
      let impactTiltX = 0;
      if (t >= 0.46 && t < 0.95) {
        const settle = 1 - THREE.MathUtils.smoothstep(t, 0.52, 0.92);
        impactTiltZ = 0.22 * settle;
        impactTiltX = 0.11 * settle;
      }

      this.playerStageWedge.visible = true;
      this.enemyStageWedge.visible = true;
      this.playerStageWedge.position.set(pOffset.x, pOffset.y + arcLift, pOffset.z);
      this.playerStageWedge.rotation.set(
        impactTiltX,
        0.18 * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1.15)),
        impactTiltZ
      );

      this.enemyStageWedge.position.set(eOffset.x, eOffset.y + arcLift, eOffset.z);
      this.enemyStageWedge.rotation.set(
        -impactTiltX * 0.7,
        Math.PI - 0.15 * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1.15)),
        -impactTiltZ * 0.75
      );
    }

    const ringIgnite = THREE.MathUtils.smoothstep(t, 0.42, 0.55);
    this.leftPad.contactRingMat.opacity = THREE.MathUtils.lerp(0.15, 0.96, ringIgnite);
    this.rightPad.contactRingMat.opacity = THREE.MathUtils.lerp(0.15, 0.96, ringIgnite);
    this.leftPad.coilSpring.visible = t >= 0.25 && t < 2.72;
    this.rightPad.coilSpring.visible = t >= 0.25 && t < 2.72;

    if ((t >= 0.48 && t <= 0.88 && !this.sparksSpawned) || (this.pausedForDebug && t >= 0.45 && t < 0.9)) {
      this.sparksSpawned = true;
      this.triggerImpactSparks(this.pausedForDebug ? 0.45 : 0);
    } else if (t >= 0.92) {
      for (const s of this.sparks) s.mesh.visible = false;
    }

    if (t >= 0.48 && t <= 0.74 && !this.pausedForDebug) {
      const shakeAmp = (1 - (t - 0.48) / 0.26) * 0.05;
      this.cameraShakeOffset.set(Math.sin(t * 95) * shakeAmp, Math.cos(t * 112) * shakeAmp, 0);
    } else {
      this.cameraShakeOffset.set(0, 0, 0);
    }

    // 4. Act 2 (`0.9s .. 2.7s`): Pad Depression, Rising Beveled Gunmetal Tower, GLSL Plasma Ribbons
    const act2Rise = THREE.MathUtils.smoothstep(t, 0.86, 1.18);
    this.instrumentTower.visible = t >= 0.84;
    this.instrumentTower.position.set(0, THREE.MathUtils.lerp(-0.94, 0.14, act2Rise), -0.74);

    const depress = t >= 0.5 && t < 2.7 ? THREE.MathUtils.smoothstep(t, 0.5, 0.95) * -0.05 : 0;
    this.leftPad.pistonGroup.position.y = depress;
    this.rightPad.pistonGroup.position.y = depress;
    this.leftPad.coilSpring.scale.y = 1 + depress * 2.0;
    this.rightPad.coilSpring.scale.y = 1 + depress * 2.0;
    this.leftPad.pistonOuterSleeve.visible = false;
    this.leftPad.pistonInnerRam.visible = false;
    this.rightPad.pistonOuterSleeve.visible = false;
    this.rightPad.pistonInnerRam.visible = false;
    this.leftPad.trapdoorPivot.rotation.x = 0;
    this.rightPad.trapdoorPivot.rotation.x = 0;
    this.leftPad.padMat.color.set('#E2B04A');
    this.leftPad.padMat.envMapIntensity = 1.25;
    this.leftPad.stepMat.color.set('#946A22');
    this.leftPad.stepMat.envMapIntensity = 1.1;
    this.rightPad.padMat.color.set('#E2B04A');
    this.rightPad.padMat.envMapIntensity = 1.25;
    this.rightPad.stepMat.color.set('#946A22');
    this.rightPad.stepMat.envMapIntensity = 1.1;
    this.leftPad.victoryHaloMat.opacity = 0;
    this.rightPad.victoryHaloMat.opacity = 0;
    this.leftPad.chuteRimMat.opacity = 0;
    this.rightPad.chuteRimMat.opacity = 0;
    this.winnerSpotLight.intensity = 0;
    this.winnerFloorGlow.visible = false;

    // GLSL Multi-Strand Plasma Ribbon Arcs (`0.92s .. 2.68s`)
    const showPlasma = t >= 0.92 && t < 2.69;
    const plasmaEnv = showPlasma
      ? THREE.MathUtils.smoothstep(t, 0.92, 1.06) * (1 - THREE.MathUtils.smoothstep(t, 2.55, 2.69))
      : 0;
    for (const r of this.plasmaRibbons) {
      r.mesh.visible = showPlasma;
      if (showPlasma) {
        r.mat.uniforms['uTime']!.value = clockSec;
        r.mat.uniforms['uIntensity']!.value = 0.58 * plasmaEnv;
      }
    }

    if (t >= 0.88 && t < 2.7) {
      for (let idx = 0; idx < this.domes.length; idx++) {
        const flicker = 0.84 + 0.16 * Math.sin(clockSec * 15 + idx * 1.7);
        this.setDomePowerState(idx, 'ACTIVE', flicker * act2Rise);
      }
      this.updateTubeMeter(this.leftTube, 0.78 + 0.2 * Math.sin(clockSec * 17), true);
      this.updateTubeMeter(this.rightTube, 0.78 + 0.2 * Math.cos(clockSec * 19), true);
      this.renderCrtOscilloscope('ARBITRATING', clockSec);
    } else if (t < 0.88) {
      for (let idx = 0; idx < this.domes.length; idx++) {
        this.setDomePowerState(idx, 'OFF', 0);
      }
    }

    // 5. Act 3 (`2.7s .. 4.1s`):
    //    - Winner: Brushed-brass cylindrical hydraulic piston pushes pad UPWARD `+0.38` units!
    //    - Loser / Mutual Elimination: Brushed-brass pad hinges DOWNWARD `-82 deg` (`+X` rot in Three.js)
    //      INTO the dark recessed mechanical well while the defeated wedge drops straight down under gravity!
    if (t >= 2.7) {
      const act3P = THREE.MathUtils.clamp((t - 2.7) / 0.36, 0, 1);
      const smooth3 = 1 - Math.pow(1 - act3P, 3);
      const dropElapsed = Math.max(0, t - 2.74);

      const playerWins =
        verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';
      const enemyWins =
        verdict.resolution === 'ENEMY_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY';
      const isSplit = verdict.resolution === 'MUTUAL_SPLIT';
      const isFlagCapture =
        verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
        verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY';

      if (playerWins) {
        this.elevateWinningPad(this.leftPad, -PAD_X, this.playerStageWedge, smooth3, clockSec);
        this.hingeDownwardAndDropUnderGravity(
          this.rightPad,
          this.enemyStageWedge,
          smooth3,
          dropElapsed
        );

        // Winner domes lock warm gold; Loser domes turn 100% OFF (intensity=0, filament off, smoked glass)!
        this.setDomePowerState(0, 'GOLD', 1.0);
        this.setDomePowerState(1, 'GOLD', 1.0);
        this.setDomePowerState(2, isFlagCapture ? 'GOLD' : 'OFF', isFlagCapture ? 1.0 : 0.0);
        this.setDomePowerState(3, isFlagCapture ? 'GOLD' : 'OFF', isFlagCapture ? 1.0 : 0.0);
        this.updateTubeMeter(this.leftTube, 1.0, true);
        this.updateTubeMeter(this.rightTube, 0.0, false);

        this.spawnContinuousVictoryEmbers(-PAD_X, dt, this.pausedForDebug);
        this.renderCrtOscilloscope(isFlagCapture ? 'CROWN' : 'GOLD_WIN', clockSec);
      } else if (enemyWins) {
        this.elevateWinningPad(this.rightPad, PAD_X, this.enemyStageWedge, smooth3, clockSec);
        this.hingeDownwardAndDropUnderGravity(
          this.leftPad,
          this.playerStageWedge,
          smooth3,
          dropElapsed
        );

        this.setDomePowerState(0, 'OFF', 0.0);
        this.setDomePowerState(1, 'OFF', 0.0);
        this.setDomePowerState(2, 'GOLD', 1.0);
        this.setDomePowerState(3, 'GOLD', 1.0);
        this.updateTubeMeter(this.leftTube, 0.0, false);
        this.updateTubeMeter(this.rightTube, 1.0, true);

        this.spawnContinuousVictoryEmbers(PAD_X, dt, this.pausedForDebug);
        this.renderCrtOscilloscope('GOLD_WIN', clockSec);
      } else if (isSplit) {
        // MUTUAL ELIMINATION: BOTH brass pads hinge DOWNWARD `-82 deg` into dark pits,
        // BOTH wedges drop straight down under gravity, and ALL 4 Fresnel domes turn 100% OFF!
        this.hingeDownwardAndDropUnderGravity(
          this.leftPad,
          this.playerStageWedge,
          smooth3,
          dropElapsed
        );
        this.hingeDownwardAndDropUnderGravity(
          this.rightPad,
          this.enemyStageWedge,
          smooth3,
          dropElapsed
        );

        for (let i = 0; i < 4; i++) {
          this.setDomePowerState(i, 'OFF', 0.0);
        }
        this.updateTubeMeter(this.leftTube, 0.0, false);
        this.updateTubeMeter(this.rightTube, 0.0, false);
        this.renderCrtOscilloscope('FLATLINE', clockSec);
      }
    }

    if (!this.pausedForDebug) {
      this.stepParticles(dt);
    }
  }

  /**
   * Telescoping cylindrical brushed-brass hydraulic piston elevates the winning pad `+0.38` units!
   */
  private elevateWinningPad(
    pad: PadRig,
    padWorldX: number,
    wedge: THREE.Group | null,
    smooth3: number,
    clockSec: number
  ): void {
    pad.pistonOuterSleeve.visible = true;
    pad.pistonInnerRam.visible = true;
    pad.pistonGroup.position.y = 0.38 * smooth3;
    pad.pistonInnerRam.position.y = 0.16 + 0.19 * smooth3;
    pad.victoryHaloMat.opacity = 0.92 * smooth3;
    pad.contactRingMat.opacity = 0.92;

    this.winnerSpotLight.position.set(padWorldX, 3.8, ARBITER_BAY_CENTER_Z + 0.65);
    this.winnerSpotLight.target.position.set(padWorldX, 0.45, ARBITER_BAY_CENTER_Z + 0.18);
    this.winnerSpotLight.intensity = 18.0 * smooth3;

    this.winnerFloorGlow.visible = true;
    this.winnerFloorGlow.position.set(padWorldX, 0.98, -0.05);
    this.winnerFloorGlowMat.opacity = 0.34 * smooth3;

    if (wedge) {
      wedge.visible = true;
      wedge.position.set(0, 0.02, 0);
      const baseRotY = wedge === this.enemyStageWedge ? Math.PI : 0.22 * smooth3;
      wedge.rotation.set(0, baseRotY + Math.sin(clockSec * 2.2) * 0.025, 0);
    }
  }

  /**
   * CRITICAL FIX: Hinges the brushed-brass pad DOWNWARD (`+82 deg` around `+X` -> `y' < 0` into the `-0.86` deep well!)
   * while the defeated wedge drops straight down (`x = 0, z = 0`) under gravity into dark shadow—ZERO upward flap clipping!
   */
  private hingeDownwardAndDropUnderGravity(
    pad: PadRig,
    wedge: THREE.Group | null,
    smooth3: number,
    dropElapsed: number
  ): void {
    pad.coilSpring.visible = false;
    // Front-lip pivot (`z = +0.48`): negative `-X` rotation (`-82 deg`) pitches the pad DOWNWARD (`y' < 0`)
    // into the dark recessed well with its dark underside facing camera so the open pit stays pitch-dark shadow!
    const hingeProgress = Math.min(1, smooth3 * 1.25);
    pad.trapdoorPivot.rotation.x = -THREE.MathUtils.degToRad(82) * hingeProgress;
    pad.padMat.color.lerpColors(new THREE.Color('#E2B04A'), new THREE.Color('#0a0c10'), hingeProgress);
    pad.padMat.envMapIntensity = THREE.MathUtils.lerp(1.25, 0.04, hingeProgress);
    pad.stepMat.color.lerpColors(new THREE.Color('#946A22'), new THREE.Color('#07090c'), hingeProgress);
    pad.stepMat.envMapIntensity = THREE.MathUtils.lerp(1.1, 0.04, hingeProgress);
    pad.chuteRimMat.opacity = 0.96 * smooth3;
    pad.contactRingMat.opacity = 0.0;

    if (wedge) {
      // Smooth theatrical gravity drop so across `t = 3.0s .. 3.65s` (both Winner & Mutual Elimination!)
      // the falling wedges are clearly visible plunging straight down into dark shadow inside the wells!
      const fallY = -0.76 * Math.pow(Math.min(1.18, dropElapsed / 0.98), 1.55);
      wedge.position.set(0, fallY, 0.03 * Math.min(1, dropElapsed));
      const baseRotY = wedge === this.enemyStageWedge ? Math.PI - 0.16 : 0.16;
      const roll = Math.min(0.26, dropElapsed * 0.36);
      wedge.rotation.set(roll * 0.65, baseRotY, -roll);
      wedge.visible = fallY > -0.86;
    }
  }

  /**
   * Strict Fresnel Dome Power Controller:
   * When `'OFF'`, `PointLight`, tungsten filament, AND radial glow sprite are 100% OFF (`intensity = 0, opacity = 0`),
   * leaving dark smoked glass (`ref_battle_act3_winner.jpg`).
   */
  private setDomePowerState(
    index: number,
    mode: 'ACTIVE' | 'GOLD' | 'OFF',
    factor: number
  ): void {
    const d = this.domes[index];
    if (!d) return;

    if (mode === 'OFF' || factor <= 0.001) {
      d.pointLight.intensity = 0;
      d.filamentMesh.visible = false;
      d.filamentMat.emissiveIntensity = 0;
      d.glowSprite.visible = false;
      d.glowMat.opacity = 0;
      d.glassMat.color.set('#181C24');
      d.glassMat.opacity = 0.68;
      return;
    }

    const isRed = mode === 'ACTIVE' && d.baseColor === 'RED';
    const glassHex = isRed ? '#ff3324' : '#ffbb33';
    const glowRgb = isRed
      ? new THREE.Color(1.9, 0.28, 0.2)
      : new THREE.Color(1.95, 1.35, 0.34);

    d.glassMat.color.set(glassHex);
    d.glassMat.opacity = 0.46; // Guardrail #3 exact spec!

    d.filamentMesh.visible = true;
    d.filamentMat.emissive.copy(glowRgb);
    d.filamentMat.emissiveIntensity = 2.2 * factor;

    d.pointLight.color.set(glassHex);
    d.pointLight.intensity = 2.4 * factor;

    d.glowSprite.visible = true;
    d.glowMat.color.copy(glowRgb);
    d.glowMat.opacity = 0.46 * factor;
  }

  private updateTubeMeter(tube: TubeMeterRig, level: number, lit: boolean): void {
    if (!lit) {
      tube.helixMesh.visible = false;
      tube.tubeGlowSprite.visible = false;
      tube.glassMat.color.set('#141820');
      tube.glassMat.opacity = 0.52;
      for (const m of tube.barMats) m.color.setRGB(0.04, 0.05, 0.07);
      return;
    }
    tube.helixMesh.visible = true;
    tube.helixMat.color.setRGB(2.8, 0.95, 0.16);
    tube.tubeGlowSprite.visible = true;
    tube.glassMat.color.set('#221812');
    tube.glassMat.opacity = 0.24;
    tube.barMats.forEach((m, idx) => {
      const thresh = (idx % 6) / 6;
      const colBias = Math.floor(idx / 6) * 0.14;
      const active = level + colBias * Math.sin(level * 9 + idx) >= thresh;
      if (active) {
        m.color.setRGB(2.05, 1.3, 0.32);
      } else {
        m.color.setRGB(0.14, 0.09, 0.04);
      }
    });
  }

  /**
   * Curved Phosphor Graticule CRT Oscilloscope (`faint green/gold oscilloscope grid + phosphor-bloomed waveform`).
   */
  private renderCrtOscilloscope(
    mode: 'ARBITRATING' | 'GOLD_WIN' | 'CROWN' | 'FLATLINE',
    clockSec: number
  ): void {
    const ctx = this.crtCtx;
    const w = this.crtCanvas.width;
    const h = this.crtCanvas.height;

    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 12, w * 0.5, h * 0.5, w * 0.65);
    bgGrad.addColorStop(0, '#050c0a');
    bgGrad.addColorStop(1, '#020505');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Faint green/gold phosphor oscilloscope graticule grid + center sub-divisions
    ctx.strokeStyle = 'rgba(92, 168, 124, 0.2)';
    ctx.lineWidth = 1;
    for (let gx = 32; gx < w; gx += 32) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 32; gy < h; gy += 32) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(218, 178, 86, 0.26)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    const hasLiveAudio = this.sound.sampleLiveWaveform(this.waveformSample);

    const grad = ctx.createLinearGradient(14, 0, w - 14, 0);
    if (mode === 'ARBITRATING') {
      grad.addColorStop(0.0, '#ffba38');
      grad.addColorStop(0.46, '#ffe885');
      grad.addColorStop(0.55, '#6df4ff');
      grad.addColorStop(1.0, '#28cfff');
    } else if (mode === 'CROWN') {
      grad.addColorStop(0.0, '#ff5969');
      grad.addColorStop(0.5, '#ffe885');
      grad.addColorStop(1.0, '#ff5969');
    } else {
      grad.addColorStop(0.0, '#ffb42e');
      grad.addColorStop(0.5, '#ffec94');
      grad.addColorStop(1.0, '#ffb42e');
    }

    const midY = h * 0.5;
    const pts: Array<[number, number]> = [];

    for (let x = 14; x <= w - 14; x += 3) {
      const u = (x - 14) / (w - 28);
      const env = Math.pow(Math.sin(u * Math.PI), 0.75);
      let amp: number;

      if (mode === 'FLATLINE') {
        amp = Math.sin(u * 20 + clockSec * 8) * 0.03 * env;
      } else {
        const sIdx = Math.min(
          this.waveformSample.length - 1,
          Math.floor(u * (this.waveformSample.length - 1))
        );
        const liveVal = hasLiveAudio ? this.waveformSample[sIdx]! * 2.4 : 0;
        const synthHarmonics =
          Math.sin(u * 96 + clockSec * 33) * 0.5 +
          Math.cos(u * 188 - clockSec * 51) * 0.36 +
          Math.sin(u * 314 + clockSec * 77) * 0.24;
        const sign = x % 6 === 0 ? 1 : -1;
        const combined = Math.abs(liveVal) > 0.18 ? liveVal : synthHarmonics * sign;
        amp = combined * env * (mode === 'CROWN' ? 1.05 : 0.9);
      }

      const py = midY - Math.max(-0.9, Math.min(0.9, amp)) * (h * 0.42);
      pts.push([x, py]);
    }

    // Pass 1: Wide outer phosphor bloom halo; Pass 2: Bright razor-crisp hot beam core!
    for (const [lineW, blur, alpha] of [
      [6.0, 18, 0.48],
      [2.4, 6, 1.0],
    ] as const) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = grad;
      ctx.shadowColor = mode === 'ARBITRATING' ? '#6beeff' : '#ffd257';
      ctx.shadowBlur = blur;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    this.crtTexture.needsUpdate = true;
  }

  private buildBaySubDeck(): void {
    // Deep matte-obsidian outer well enclosure (`y = 0` down to `y = -0.88`)
    const bayTub = new THREE.Mesh(
      new THREE.BoxGeometry(5.06, 0.9, 2.08),
      new THREE.MeshBasicMaterial({ color: 0x040507, side: THREE.BackSide })
    );
    bayTub.position.set(0, -0.46, 0);
    this.root.add(bayTub);

    const deckShape = makeRoundedRectPath(0, 0, 5.04, 2.08, 0.12, true) as THREE.Shape;
    for (const cx of [-PAD_X, PAD_X]) {
      deckShape.holes.push(makeRoundedRectPath(cx, 0.18, 1.32, 1.08, 0.06) as THREE.Path);
    }

    const deckGeo = new THREE.ExtrudeGeometry(deckShape, {
      depth: 0.075,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 3,
    });
    deckGeo.rotateX(-Math.PI / 2);
    const subDeck = new THREE.Mesh(deckGeo, this.factory.materials.darkSteel);
    subDeck.position.y = -0.085;
    subDeck.receiveShadow = true;
    this.root.add(subDeck);
  }

  private buildPadRig(centerX: number, tint: 'CYAN' | 'CRIMSON'): PadRig {
    const bezelGroup = new THREE.Group();
    bezelGroup.position.set(centerX, -0.02, 0.18);

    // Chamfered hard-surface gunmetal pad bezel + 4 3D 6-sided hex bolts!
    const bezelShape = makeRoundedRectPath(0, 0, 1.74, 1.48, 0.09, true) as THREE.Shape;
    bezelShape.holes.push(makeRoundedRectPath(0, 0, 1.32, 1.08, 0.05) as THREE.Path);
    const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 3,
    });
    bezelGeo.rotateX(-Math.PI / 2);
    const bezelMesh = new THREE.Mesh(bezelGeo, this.factory.materials.gunmetal);
    bezelMesh.receiveShadow = true;
    bezelGroup.add(bezelMesh);

    // 4 Machined 6-sided Hex Bolts (`CylinderGeometry(..., 6)`)
    const hexBoltGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.026, 6);
    for (const [sx, sz] of [
      [-0.74, -0.61],
      [0.74, -0.61],
      [-0.74, 0.61],
      [0.74, 0.61],
    ] as const) {
      const bolt = new THREE.Mesh(hexBoltGeo, this.factory.materials.brassTrim);
      bolt.position.set(sx, 0.068, sz);
      bezelGroup.add(bolt);
    }

    // Deep Mechanical Well (`y = 0` down to `y = -0.84`) + Glowing Crimson Inner Rim
    const pitShaft = new THREE.Mesh(
      new THREE.BoxGeometry(1.34, 0.86, 1.1),
      new THREE.MeshStandardMaterial({
        color: 0x05070a,
        roughness: 0.92,
        metalness: 0.25,
        side: THREE.BackSide,
      })
    );
    pitShaft.position.set(0, -0.43, 0);
    bezelGroup.add(pitShaft);

    const chuteRimShape = makeRoundedRectPath(0, 0, 1.31, 1.07, 0.05, true) as THREE.Shape;
    chuteRimShape.holes.push(makeRoundedRectPath(0, 0, 1.23, 0.99, 0.035) as THREE.Path);
    const chuteRimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.2, 0.2, 0.24),
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    const chuteRimGeo = new THREE.ExtrudeGeometry(chuteRimShape, { depth: 0.026, bevelEnabled: false });
    chuteRimGeo.rotateX(-Math.PI / 2);
    const chuteRimMesh = new THREE.Mesh(chuteRimGeo, chuteRimMat);
    chuteRimMesh.position.set(0, -0.015, 0);
    bezelGroup.add(chuteRimMesh);

    // Coiled Brass Plasma Electrode on inner bezel edge (`x_local = ±0.52`) for Act 2 Plasma Ribbons!
    const innerDir = tint === 'CYAN' ? 1 : -1;
    const electrodeGroup = new THREE.Group();
    electrodeGroup.position.set(innerDir * 0.54, 0.08, -0.1);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.045, 0.18, 14),
      this.factory.materials.brassTrim
    );
    post.position.y = 0.06;
    electrodeGroup.add(post);
    for (let c = 0; c < 3; c++) {
      const eCoil = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.012, 8, 16),
        this.factory.materials.brassTrim
      );
      eCoil.rotation.x = Math.PI / 2;
      eCoil.position.y = 0.04 + c * 0.035;
      electrodeGroup.add(eCoil);
    }
    const tipBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 14, 12),
      this.factory.materials.brassTrim
    );
    tipBall.position.y = 0.165;
    electrodeGroup.add(tipBall);
    bezelGroup.add(electrodeGroup);

    // Rear Steel Helical Coil Spring
    const coilSpring = new THREE.Group();
    coilSpring.position.set(innerDir * 0.2, 0.04, -0.56);
    for (let c = 0; c < 6; c++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.022, 8, 18),
        this.factory.materials.silverEmblem
      );
      ring.rotation.x = Math.PI / 2 + 0.14;
      ring.position.y = c * 0.038;
      coilSpring.add(ring);
    }
    bezelGroup.add(coilSpring);

    // Telescoping Cylindrical Brushed-Brass Hydraulic Piston (`+0.38` Up on Win!)
    const pistonOuterSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.31, 0.26, 28),
      this.factory.materials.brassRecessed
    );
    pistonOuterSleeve.position.set(0, 0.08, 0);
    pistonOuterSleeve.visible = false;
    bezelGroup.add(pistonOuterSleeve);

    const pistonInnerRam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.21, 0.22, 0.38, 28),
      this.factory.materials.brassTrim
    );
    pistonInnerRam.position.set(0, 0.2, 0);
    pistonInnerRam.visible = false;
    bezelGroup.add(pistonInnerRam);

    const pistonGroup = new THREE.Group();
    bezelGroup.add(pistonGroup);

    // Front-Lip Trapdoor Hinge Pivot (`z = +0.48` local):
    // Negative `-X` rotation (`-82 deg`) swings the brass pad (`z = -0.48` relative to pivot) DOWNWARD (`y' < 0`)
    // into the dark mechanical well so its bright brass face rotates AWAY from camera into shadow!
    const trapdoorPivot = new THREE.Group();
    trapdoorPivot.position.set(0, 0.02, 0.48);
    pistonGroup.add(trapdoorPivot);

    const padShape = makeRoundedRectPath(0, 0, 1.2, 0.96, 0.06, true) as THREE.Shape;
    const padGeo = new THREE.ExtrudeGeometry(padShape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.014,
      bevelSegments: 3,
    });
    padGeo.rotateX(-Math.PI / 2);
    const padMat = this.factory.materials.brassTrim.clone();
    padMat.clippingPlanes = [this.wellFloorClipPlane];
    const padPlate = new THREE.Mesh(padGeo, padMat);
    padPlate.position.set(0, 0.0, -0.48);
    padPlate.castShadow = true;
    padPlate.receiveShadow = true;
    trapdoorPivot.add(padPlate);

    const stepShape = makeRoundedRectPath(0, 0, 1.02, 0.8, 0.045, true) as THREE.Shape;
    const stepGeo = new THREE.ExtrudeGeometry(stepShape, {
      depth: 0.032,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
    });
    stepGeo.rotateX(-Math.PI / 2);
    const stepMat = this.factory.materials.brassRecessed.clone();
    stepMat.clippingPlanes = [this.wellFloorClipPlane];
    const upperPadStep = new THREE.Mesh(stepGeo, stepMat);
    upperPadStep.position.set(0, 0.058, -0.48);
    upperPadStep.receiveShadow = true;
    trapdoorPivot.add(upperPadStep);

    const contactRingMat = new THREE.MeshBasicMaterial({
      color:
        tint === 'CYAN'
          ? new THREE.Color(0.32, 1.75, 2.2)
          : new THREE.Color(2.15, 0.24, 0.32),
      transparent: true,
      opacity: 0,
      toneMapped: false,
      clippingPlanes: [this.wellFloorClipPlane],
    });
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.022, 12, 36), contactRingMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.set(0, 0.098, -0.48);
    trapdoorPivot.add(ringMesh);

    const victoryHaloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.55, 1.15, 0.34),
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    const vicHalo = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.024, 12, 36), victoryHaloMat);
    vicHalo.rotation.x = Math.PI / 2;
    vicHalo.position.set(0, 0.102, -0.48);
    trapdoorPivot.add(vicHalo);

    const pieceSocket = new THREE.Group();
    pieceSocket.position.set(0, 0.098, 0);
    pistonGroup.add(pieceSocket);

    return {
      bezelGroup,
      pistonGroup,
      pistonOuterSleeve,
      pistonInnerRam,
      trapdoorPivot,
      padMat,
      stepMat,
      contactRingMat,
      victoryHaloMat,
      chuteRimMat,
      pieceSocket,
      coilSpring,
    };
  }

  /**
   * Ribbed Cylindrical Gunmetal Shutter behind the stage.
   */
  private buildRetractableShutter(): void {
    const drumGroup = new THREE.Group();

    // Horizontal cylindrical drum core + 28 machined radial gunmetal ribs
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 4.42, 28),
      this.factory.materials.darkSteel
    );
    cyl.rotation.z = Math.PI / 2;
    cyl.scale.set(0.65, 1, 2.15);
    cyl.position.y = 0.06;
    cyl.receiveShadow = true;
    drumGroup.add(cyl);

    for (let r = -17; r <= 17; r++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.37, 0.024, 10, 24, Math.PI),
        this.factory.materials.gunmetal
      );
      rib.rotation.y = Math.PI / 2;
      rib.scale.set(2.15, 0.68, 1);
      rib.position.set(r * 0.122, 0.06, 0);
      drumGroup.add(rib);
    }

    this.shutterGroup.add(drumGroup);
    this.attachBakedShutterIfReady();
  }

  /**
   * Multi-part Chamfered Dark-Gunmetal Instrument Chassis (`bevelSegments = 4`),
   * Beveled Front Bezels, Corner Hex Bolts, Helical Orange Filament Vacuum Tubes,
   * Curved Phosphor CRT, and 4 Rounded Faceted Fresnel Glass Domes!
   */
  private buildInstrumentTower(glowTex: THREE.Texture): {
    leftTube: TubeMeterRig;
    rightTube: TubeMeterRig;
  } {
    // Chamfered main backplane housing (`ExtrudeGeometry` along Z so front & rear edges are crisp 45-deg chamfers!)
    const frontProfile = new THREE.Shape();
    const hw = 1.82;
    const hh = 0.58;
    const r = 0.09;
    frontProfile.moveTo(-hw + r, -hh);
    frontProfile.lineTo(hw - r, -hh);
    frontProfile.quadraticCurveTo(hw, -hh, hw, -hh + r);
    frontProfile.lineTo(hw, hh - r);
    frontProfile.quadraticCurveTo(hw, hh, hw - r, hh);
    frontProfile.lineTo(-hw + r, hh);
    frontProfile.quadraticCurveTo(-hw, hh, -hw, hh - r);
    frontProfile.lineTo(-hw, -hh + r);
    frontProfile.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

    const chassisGeo = new THREE.ExtrudeGeometry(frontProfile, {
      depth: 0.62,
      bevelEnabled: true,
      bevelThickness: 0.036,
      bevelSize: 0.036,
      bevelSegments: 4,
      curveSegments: 16,
    });
    chassisGeo.computeVertexNormals();
    const chassis = new THREE.Mesh(chassisGeo, this.factory.materials.gunmetal);
    chassis.position.set(0, 0.58, -0.31);
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.instrumentTower.add(chassis);

    // 6 Front-panel 6-sided Hex Bolts on the chamfered gunmetal housing
    const hexGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.025, 6);
    hexGeo.rotateX(Math.PI / 2);
    for (const [bx, by] of [
      [-1.72, 1.06],
      [1.72, 1.06],
      [-1.72, 0.12],
      [1.72, 0.12],
      [-0.74, 1.06],
      [0.74, 1.06],
    ] as const) {
      const b = new THREE.Mesh(hexGeo, this.factory.materials.brassTrim);
      b.position.set(bx, by, 0.355);
      this.instrumentTower.add(b);
    }

    // Central Chamfered Curved CRT Bezel + Convex Dark-Glass Lens
    const crtOuter = new THREE.Shape();
    crtOuter.moveTo(-0.7, -0.44);
    crtOuter.lineTo(0.7, -0.44);
    crtOuter.lineTo(0.7, 0.44);
    crtOuter.lineTo(-0.7, 0.44);
    crtOuter.closePath();
    const crtHole = new THREE.Path();
    crtHole.moveTo(-0.61, -0.37);
    crtHole.lineTo(0.61, -0.37);
    crtHole.lineTo(0.61, 0.37);
    crtHole.lineTo(-0.61, 0.37);
    crtHole.closePath();
    crtOuter.holes.push(crtHole);

    const crtBezelGeo = new THREE.ExtrudeGeometry(crtOuter, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.016,
      bevelSize: 0.016,
      bevelSegments: 3,
    });
    const crtBezel = new THREE.Mesh(crtBezelGeo, this.factory.materials.darkSteel);
    crtBezel.position.set(0, 0.58, 0.33);
    this.instrumentTower.add(crtBezel);

    const crtGeo = new THREE.PlaneGeometry(1.26, 0.78, 18, 12);
    const cPos = crtGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cPos.count; i++) {
      const x = cPos.getX(i) / 0.63;
      const y = cPos.getY(i) / 0.39;
      const bulge = (1 - x * x * 0.36 - y * y * 0.36) * 0.048;
      cPos.setZ(i, bulge);
    }
    crtGeo.computeVertexNormals();

    const crtScreen = new THREE.Mesh(
      crtGeo,
      new THREE.MeshBasicMaterial({ map: this.crtTexture, toneMapped: false })
    );
    crtScreen.position.set(0, 0.58, 0.36);
    this.instrumentTower.add(crtScreen);

    // Specular curved dark-glass cover over CRT (`envMapIntensity: 0.28` so studio panels don't wash out black phosphor!)
    const crtGlass = new THREE.Mesh(
      crtGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0x0a1612,
        transparent: true,
        opacity: 0.12,
        roughness: 0.1,
        metalness: 0.0,
        clearcoat: 0.65,
        envMapIntensity: 0.28,
      })
    );
    crtGlass.position.set(0, 0.58, 0.368);
    this.instrumentTower.add(crtGlass);

    // Left & Right Recessed Vacuum-Tube Bays with 3D Helical Orange Filament Coils!
    const leftTube = this.buildVacuumTubeAlcove(-1.22, glowTex);
    const rightTube = this.buildVacuumTubeAlcove(1.22, glowTex);

    // 4 Rounded Stepped Fresnel Glass Domes (`LatheGeometry` + internal helical filament + PointLight + soft radial glow sprite!)
    const fresnelGeo = createSteppedFresnelDomeGeometry();
    const domeHelixGeo = createHelixTubeGeometry(0.038, 0.14, 5, 0.009);

    const domeSpecs: Array<{ x: number; color: 'RED' | 'AMBER' }> = [
      { x: -1.2, color: 'RED' },
      { x: -0.4, color: 'AMBER' },
      { x: 0.4, color: 'RED' },
      { x: 1.2, color: 'AMBER' },
    ];

    for (const spec of domeSpecs) {
      const dGroup = new THREE.Group();
      dGroup.position.set(spec.x, 1.18, 0.02);

      // Machined gunmetal & brass base collar
      const baseCollar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.25, 0.075, 24),
        this.factory.materials.darkSteel
      );
      baseCollar.position.y = 0.036;
      dGroup.add(baseCollar);

      const brassRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.21, 0.015, 10, 24),
        this.factory.materials.brassTrim
      );
      brassRing.rotation.x = Math.PI / 2;
      brassRing.position.y = 0.072;
      dGroup.add(brassRing);

      // Internal helical tungsten filament
      const filamentMat = new THREE.MeshStandardMaterial({
        color: 0x221108,
        emissive: spec.color === 'RED' ? new THREE.Color('#ff3524') : new THREE.Color('#ffba30'),
        emissiveIntensity: 0,
        roughness: 0.3,
      });
      const filamentMesh = new THREE.Mesh(domeHelixGeo, filamentMat);
      filamentMesh.position.y = 0.16;
      dGroup.add(filamentMesh);

      // Guardrail #3 Fresnel glass dome (`transparent: true, opacity: 0.46, roughness: 0.12, clearcoat: 1.0`)
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: spec.color === 'RED' ? new THREE.Color('#ff3524') : new THREE.Color('#ffba30'),
        transparent: true,
        opacity: 0.46,
        roughness: 0.12,
        metalness: 0.04,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.35,
      });
      const domeMesh = new THREE.Mesh(fresnelGeo, glassMat);
      domeMesh.position.y = 0.065;
      dGroup.add(domeMesh);

      // Real localized PointLight inside dome
      const pointLight = new THREE.PointLight(
        spec.color === 'RED' ? 0xff3524 : 0xffba30,
        0,
        3.6,
        1.6
      );
      pointLight.position.set(0, 0.22, 0.12);
      dGroup.add(pointLight);

      // Soft radial-falloff volumetric glow sprite (ZERO ConeGeometry!)
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: spec.color === 'RED' ? new THREE.Color(1.9, 0.28, 0.2) : new THREE.Color(1.95, 1.35, 0.34),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const glowSprite = new THREE.Sprite(glowMat);
      glowSprite.scale.set(1.25, 1.35, 1);
      glowSprite.position.set(0, 0.28, 0.02);
      glowSprite.visible = false;
      dGroup.add(glowSprite);

      this.instrumentTower.add(dGroup);
      this.domes.push({
        group: dGroup,
        filamentMesh,
        filamentMat,
        glassMat,
        pointLight,
        glowSprite,
        glowMat,
        baseColor: spec.color,
      });
    }

    return { leftTube, rightTube };
  }

  private buildVacuumTubeAlcove(centerX: number, glowTex: THREE.Texture): TubeMeterRig {
    const g = new THREE.Group();
    g.position.set(centerX, 0.58, 0.31);

    const bayOuter = new THREE.Shape();
    bayOuter.moveTo(-0.39, -0.44);
    bayOuter.lineTo(0.39, -0.44);
    bayOuter.lineTo(0.39, 0.44);
    bayOuter.lineTo(-0.39, 0.44);
    bayOuter.closePath();
    const bayHole = new THREE.Path();
    bayHole.moveTo(-0.32, -0.38);
    bayHole.lineTo(0.32, -0.38);
    bayHole.lineTo(0.32, 0.38);
    bayHole.lineTo(-0.32, 0.38);
    bayHole.closePath();
    bayOuter.holes.push(bayHole);

    const bezel = new THREE.Mesh(
      new THREE.ExtrudeGeometry(bayOuter, {
        depth: 0.05,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.012,
        bevelSegments: 3,
      }),
      this.factory.materials.darkSteel
    );
    bezel.position.z = 0.02;
    g.add(bezel);

    const alcoveBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.8, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.92, envMapIntensity: 0.15 })
    );
    g.add(alcoveBack);

    // Upper Half: Open-ended Smoked Glass Vacuum Tube + Vivid 3D Helical Glowing Orange Filament Coil!
    const helixGeo = createHelixTubeGeometry(0.052, 0.22, 5, 0.013);
    const helixMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.8, 0.95, 0.16),
      toneMapped: false,
    });
    const helixMesh = new THREE.Mesh(helixGeo, helixMat);
    helixMesh.position.set(0, 0.18, 0.09);
    g.add(helixMesh);

    const tubeGlowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(1.85, 0.65, 0.12),
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    tubeGlowSprite.scale.set(0.46, 0.5, 1);
    tubeGlowSprite.position.set(0, 0.18, 0.09);
    g.add(tubeGlowSprite);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#221812'),
      transparent: true,
      opacity: 0.24,
      roughness: 0.14,
      metalness: 0.05,
      clearcoat: 0.35,
      envMapIntensity: 0.48,
      depthWrite: false,
    });
    const glassTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 0.28, 22, 1, true),
      glassMat
    );
    glassTube.position.set(0, 0.19, 0.09);
    g.add(glassTube);

    const tubeCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      this.factory.materials.gunmetal
    );
    tubeCap.position.set(0, 0.33, 0.09);
    g.add(tubeCap);

    // Lower Half: 4 columns × 6 rows of segmented warm-amber equalizer bars
    const barMats: THREE.MeshBasicMaterial[] = [];
    const barGeo = new THREE.PlaneGeometry(0.11, 0.034);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 6; row++) {
        const bm = new THREE.MeshBasicMaterial({
          color: new THREE.Color(2.05, 1.3, 0.32),
          toneMapped: false,
        });
        const bar = new THREE.Mesh(barGeo, bm);
        bar.position.set((col - 1.5) * 0.145, -0.33 + row * 0.054, 0.06);
        g.add(bar);
        barMats.push(bm);
      }
    }

    this.instrumentTower.add(g);
    return { helixMesh, helixMat, tubeGlowSprite, glassMat, barMats };
  }

  private initParticlePools(): void {
    const sparkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.3, 1.65, 0.58),
      toneMapped: false,
    });
    const sparkGeo = new THREE.BoxGeometry(0.008, 0.008, 0.34);
    for (let i = 0; i < 42; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.sparks.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0.44 });
    }

    const emberMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.15, 1.52, 0.44),
      toneMapped: false,
    });
    const emberGeo = new THREE.SphereGeometry(0.018, 6, 6);
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(emberGeo, emberMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.embers.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1.15 });
    }
  }

  private triggerImpactSparks(preAdvanceSec = 0): void {
    this.sparks.forEach((p, idx) => {
      const padX = idx < 30 ? -PAD_X : PAD_X;
      const ang = (idx / 30) * Math.PI * 2 + idx * 0.41;
      const spd = 2.2 + (idx % 5) * 0.7;
      p.vel.set(Math.cos(ang) * spd, 0.8 + (idx % 4) * 0.5, Math.sin(ang) * spd);
      p.mesh.position.set(padX + Math.cos(ang) * 0.24, 0.13, 0.18 + Math.sin(ang) * 0.24);
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
          0.46 + (idx / this.embers.length) * 1.9,
          0.18 + Math.sin(a) * r
        );
        e.mesh.visible = true;
      });
      return;
    }
    for (const e of this.embers) {
      if (e.life <= 0 && Math.random() < dt * 24) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.14 + Math.random() * 0.4;
        e.mesh.position.set(centerX + Math.cos(a) * r, 0.44, 0.18 + Math.sin(a) * r);
        e.vel.set(
          (Math.random() - 0.5) * 0.3,
          1.3 + Math.random() * 0.95,
          (Math.random() - 0.5) * 0.3
        );
        e.life = e.maxLife;
        e.mesh.visible = true;
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

    for (const e of this.embers) {
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
