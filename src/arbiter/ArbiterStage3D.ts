import * as THREE from 'three';
import type { SoundDirector } from '../audio/SoundDirector';
import { buildRankEmblemMesh } from '../graphics/EmblemFactory';
import type { ArbiterVerdict, HudBannerState } from '../core/types';
import {
  ARBITER_BAY_CENTER_Z,
  type BakedArbiterHardwareParts,
  gridToWorld,
  type MeshFactory,
} from '../graphics/MeshFactory';

const BASTION_X = 1.34;
const BASTION_Z = 0.12;
const BASTION_SURFACE_Y = -0.085;

export interface BattleCameraShot {
  readonly pos: THREE.Vector3;
  readonly look: THREE.Vector3;
  readonly fov: number;
  readonly dampSpeed: number;
  readonly roomDim: number;
  readonly redAlertGlow: number;
}

interface PlumeBillow {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  readonly offset: THREE.Vector3;
  readonly driftVel: THREE.Vector3;
  readonly baseScale: number;
  readonly phaseDelay: number;
}

interface ShrapnelItem {
  readonly mesh: THREE.Mesh;
  readonly origin: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly spin: THREE.Vector3;
  active: boolean;
}

interface TracerBolt {
  readonly mesh: THREE.Mesh;
  readonly fromLeft: boolean;
  readonly yOff: number;
  readonly zOff: number;
  readonly phaseOffset: number;
}

function createWarfieldExplosionPlumeMaterial(
  seed: number,
  isSmokeLayer = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPhase: { value: 0.0 },
      uSeed: { value: seed },
      uTime: { value: 0.0 },
      uSmokeOnly: { value: isSmokeLayer ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float scaleX = length(vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]));
        float scaleY = length(vec3(modelMatrix[1][0], modelMatrix[1][1], modelMatrix[1][2]));
        mvCenter.xy += position.xy * vec2(scaleX, scaleY);
        gl_Position = projectionMatrix * mvCenter;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPhase;
      uniform float uSeed;
      uniform float uTime;
      uniform float uSmokeOnly;
      varying vec2 vUv;

      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7) + uSeed * 13.7);
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.52;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p = p * 2.07 + vec2(1.7, -2.3);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float turb = fbm(p * 3.1 + vec2(0.0, -uTime * 2.1));
        float eroded = 1.0 - r - (turb - 0.45) * 0.72;
        float mask = smoothstep(0.0, 0.34, eroded);
        if (mask <= 0.005) discard;

        if (uSmokeOnly > 0.5) {
          float underRim = clamp((0.5 - vUv.y) * 1.4, 0.0, 1.0) * (1.0 - uPhase);
          vec3 darkSoot = vec3(0.022, 0.021, 0.025) + 0.042 * turb + vec3(0.32, 0.09, 0.02) * underRim * turb;
          float sFade = smoothstep(1.0, 0.55, uPhase);
          gl_FragColor = vec4(darkSoot, mask * sFade * 0.92);
          return;
        }

        float coreMask = pow(clamp(1.0 - r * 1.25, 0.0, 1.0), 2.1);
        float heat = clamp((1.0 - uPhase * 1.45) * (0.3 + 0.9 * turb * coreMask) + coreMask * (0.48 - uPhase * 0.55), 0.0, 1.2);

        vec3 sootCol = vec3(0.024, 0.022, 0.026) + 0.04 * turb;
        vec3 magmaRed = vec3(0.92, 0.14, 0.02);
        vec3 fireOrange = vec3(1.62, 0.58, 0.07);
        vec3 flashCore = vec3(2.35, 1.68, 0.6);

        vec3 col = sootCol;
        col = mix(col, magmaRed, smoothstep(0.26, 0.5, heat));
        col = mix(col, fireOrange, smoothstep(0.5, 0.8, heat));
        col = mix(col, flashCore, smoothstep(0.8, 1.08, heat));

        float fadeOut = smoothstep(1.0, 0.58, uPhase);
        float alpha = mask * fadeOut * 0.94;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function createShockwaveRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0.0 },
      uColor: { value: new THREE.Color(2.4, 1.45, 0.45) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length((vUv - 0.5) * 2.0);
        float ringR = mix(0.08, 0.96, pow(uProgress, 0.62));
        float band = exp(-pow((r - ringR) / 0.085, 2.0));
        float fade = pow(clamp(1.0 - uProgress, 0.0, 1.0), 1.45);
        float a = band * fade;
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor * a * 1.4, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createGaussianLightShaftMaterial(rgb: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: rgb.clone() },
      uOpacity: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float xNorm = (vUv.x - 0.5) * 2.0;
        float spread = mix(0.36, 1.0, vUv.y);
        float xs = xNorm / spread;
        float horiz = exp(-xs * xs * 4.2) * smoothstep(1.0, 0.68, abs(xNorm));
        float vert = smoothstep(0.0, 0.08, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.35);
        float a = horiz * vert * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * 5-Part War Cinema & Heartbeat Suspense Stage (`ArbiterStage3D.ts`):
 *  1. Asymmetric Lunge-vs-Brace Lock-In + 3D Frontline Suppression Tug-of-War Gauge (`84%` push!)
 *  2. "The Strachan Vacuum": Total acoustic/visual blackout + ECG Heartbeat + `0.08x` Bullet-Time 88mm Shell + Mach Ring
 *  3. "Brick-Wall Ambush Reversal" when Defender wins (Sloped-armor deflection shield + violent counter-battery shell)
 *  4. Kurosawa Delayed `MUTUAL_SPLIT` Double-KO Whiplash + Ceremonial `180°` `FLAG_CAPTURED` Unmasking + `SPY_INTERCEPTED`
 *  5. Dynamic 3-Shot *XCOM / Fury* Over-The-Shoulder Breach/Ambush & Bullet-Time Camera Director + Hold-to-Overdrive (`2.2x`)
 */
export class ArbiterStage3D {
  public readonly root = new THREE.Group();
  public readonly worldMedallionGroup = new THREE.Group();

  private readonly factory: MeshFactory;
  private readonly sound: SoundDirector;

  private readonly arenaMount = new THREE.Group();
  private readonly leftBastionRingMat: THREE.MeshBasicMaterial;
  private readonly rightBastionRingMat: THREE.MeshBasicMaterial;

  // 3D Diegetic Frontline Suppression Tug-of-War Gauge across No-Man's-Land!
  private readonly frontlineGroup = new THREE.Group();
  private readonly blueFrontlineBar: THREE.Mesh;
  private readonly crimsonFrontlineBar: THREE.Mesh;
  private readonly frontlineSparkNode: THREE.Mesh;
  private readonly armorDeflectShield: THREE.Mesh;
  private readonly armorDeflectMat: THREE.MeshBasicMaterial;

  // Bullet-Time 88mm Armor-Piercing Hero Shell + Supersonic Mach Vapor Cone!
  private readonly bulletTimeShellGroup = new THREE.Group();
  private readonly machConeMat: THREE.MeshBasicMaterial;

  // Bunker Tactical Comms & ECG Heartbeat Monitor (`512x192`)
  private readonly crtCanvas: HTMLCanvasElement;
  private readonly crtCtx: CanvasRenderingContext2D;
  private readonly crtTexture: THREE.CanvasTexture;
  private readonly waveformSample = new Float32Array(256);

  private readonly leftMuzzleStar: THREE.Group;
  private readonly rightMuzzleStar: THREE.Group;
  private readonly muzzleFlashLight: THREE.PointLight;
  private readonly explosionLight: THREE.PointLight;

  private readonly tracers: TracerBolt[] = [];
  private readonly flakPuffs: PlumeBillow[] = [];
  private readonly incomingShells: THREE.Mesh[] = [];
  private readonly heatBeamMesh: THREE.Mesh;
  private readonly heatBeamMat: THREE.MeshBasicMaterial;

  private readonly shockwaves: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }> = [];
  private readonly explosionPlumes: PlumeBillow[] = [];
  private readonly shrapnelPool: ShrapnelItem[] = [];
  private readonly sparkPool: ShrapnelItem[] = [];
  private readonly scorchDecalLeft: THREE.Mesh;
  private readonly scorchDecalRight: THREE.Mesh;

  private readonly winnerSpotLight: THREE.SpotLight;
  private readonly winnerShaftMesh: THREE.Mesh;
  private readonly winnerShaftMat: THREE.ShaderMaterial;

  private readonly medallionMesh: THREE.Group;

  private playerStageWedge: THREE.Group | null = null;
  private enemyStageWedge: THREE.Group | null = null;
  private capturedFlagEmblem: THREE.Group | null = null;
  private playerStartWorld = new THREE.Vector3();
  private enemyStartWorld = new THREE.Vector3();

  private activeVerdict: ArbiterVerdict | null = null;
  private finisherVariant = 0;
  private clashCounter = 0;

  // Deterministic Elastic Phase Timestamps (driven 100% by Public DEFCON Tier — zero `enemy.trueRank` leak!)
  private tAct1End = 0.78;
  private tPushEnd = 1.95;
  private tVerdict = 2.45;
  private tTotalEnd = 4.35;

  private elapsed = 0;
  private speedScale = 1;
  private overdriveHeld = false;
  private pausedForDebug = false;
  private pushAudioTriggered = false;
  private vacuumAudioTriggered = false;
  private act3Triggered = false;
  private delayedSplitBannerTriggered = false;
  private onBannerChange?: (banner: HudBannerState) => void;
  private onSequenceComplete?: () => void;

  private cameraShakeOffset = new THREE.Vector3();
  private readonly camShotPos = new THREE.Vector3();
  private readonly camShotLook = new THREE.Vector3();

  constructor(factory: MeshFactory, sound: SoundDirector) {
    this.factory = factory;
    this.sound = sound;

    this.root.position.set(0, 0, ARBITER_BAY_CENTER_Z);

    const fbFloor = new THREE.Mesh(
      new THREE.BoxGeometry(4.96, 0.12, 2.0),
      this.factory.materials.mudTerrain
    );
    fbFloor.position.set(0, -0.28, 0);
    fbFloor.receiveShadow = true;
    this.arenaMount.add(fbFloor);
    this.root.add(this.arenaMount);

    this.leftBastionRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.32, 1.9, 2.4),
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const lRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 44), this.leftBastionRingMat);
    lRing.rotation.x = -Math.PI / 2;
    lRing.position.set(-BASTION_X, BASTION_SURFACE_Y + 0.008, BASTION_Z);
    this.root.add(lRing);

    this.rightBastionRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.35, 0.28, 0.36),
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const rRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 44), this.rightBastionRingMat);
    rRing.rotation.x = -Math.PI / 2;
    rRing.position.set(BASTION_X, BASTION_SURFACE_Y + 0.008, BASTION_Z);
    this.root.add(rRing);

    // 3D Diegetic Frontline Tug-of-War Laser Rail (`x = -1.06 .. +1.06`)
    this.frontlineGroup.position.set(0, BASTION_SURFACE_Y + 0.025, BASTION_Z + 0.42);
    const railBack = new THREE.Mesh(
      new THREE.BoxGeometry(2.18, 0.018, 0.075),
      this.factory.materials.darkSteel
    );
    this.frontlineGroup.add(railBack);

    const detentGeo = new THREE.BoxGeometry(0.028, 0.032, 0.11);
    for (const dx of [-1.05, -0.525, 0, 0.525, 1.05]) {
      const pip = new THREE.Mesh(detentGeo, this.factory.materials.brassTrim);
      pip.position.x = dx;
      this.frontlineGroup.add(pip);
    }

    const barGeo = new THREE.BoxGeometry(1.0, 0.028, 0.052);
    barGeo.translate(0.5, 0, 0); // scale.x grows cleanly from left origin!
    this.blueFrontlineBar = new THREE.Mesh(
      barGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.35, 1.85, 2.55),
        toneMapped: false,
      })
    );
    this.blueFrontlineBar.position.set(-1.05, 0.008, 0);

    const rBarGeo = new THREE.BoxGeometry(1.0, 0.028, 0.052);
    rBarGeo.translate(-0.5, 0, 0); // grows from right origin!
    this.crimsonFrontlineBar = new THREE.Mesh(
      rBarGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.55, 0.34, 0.42),
        toneMapped: false,
      })
    );
    this.crimsonFrontlineBar.position.set(1.05, 0.008, 0);

    this.frontlineSparkNode = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.068, 0),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.9, 2.35, 1.2),
        toneMapped: false,
      })
    );
    this.frontlineSparkNode.position.y = 0.024;
    this.frontlineGroup.add(
      this.blueFrontlineBar,
      this.crimsonFrontlineBar,
      this.frontlineSparkNode
    );
    this.frontlineGroup.visible = false;
    this.root.add(this.frontlineGroup);

    // Sloped-Armor "Brick-Wall" Glacis Deflection Shield Flash!
    this.armorDeflectMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.8, 2.1, 0.75),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.armorDeflectShield = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.36, 28),
      this.armorDeflectMat
    );
    this.armorDeflectShield.visible = false;
    this.root.add(this.armorDeflectShield);

    // `0.08x` Bullet-Time 88mm Armor-Piercing Hero Shell + Supersonic Mach Vapor Ring!
    const apProjectile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.026, 0.26, 14),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.6, 1.75, 0.55),
        toneMapped: false,
      })
    );
    apProjectile.rotation.z = -Math.PI / 2;
    this.machConeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.2, 1.55, 0.65),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const machRing = new THREE.Mesh(new THREE.RingGeometry(0.065, 0.135, 28), this.machConeMat);
    machRing.rotation.y = Math.PI / 2;
    machRing.position.x = 0.04;
    this.bulletTimeShellGroup.add(apProjectile, machRing);
    this.bulletTimeShellGroup.visible = false;
    this.root.add(this.bulletTimeShellGroup);

    // Scorched Blast Crater Decals
    const scorchCanvas = document.createElement('canvas');
    scorchCanvas.width = 128;
    scorchCanvas.height = 128;
    const sCtx = scorchCanvas.getContext('2d')!;
    const sGrad = sCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
    sGrad.addColorStop(0, 'rgba(255, 110, 20, 0.92)');
    sGrad.addColorStop(0.28, 'rgba(18, 12, 10, 0.95)');
    sGrad.addColorStop(0.7, 'rgba(10, 8, 7, 0.72)');
    sGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 128, 128);
    const scorchMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(scorchCanvas),
      transparent: true,
      depthWrite: false,
    });
    const scorchGeo = new THREE.PlaneGeometry(1.25, 1.25);
    scorchGeo.rotateX(-Math.PI / 2);
    this.scorchDecalLeft = new THREE.Mesh(scorchGeo, scorchMat);
    this.scorchDecalLeft.position.set(-BASTION_X, BASTION_SURFACE_Y + 0.012, BASTION_Z);
    this.scorchDecalLeft.visible = false;
    this.scorchDecalRight = new THREE.Mesh(scorchGeo, scorchMat);
    this.scorchDecalRight.position.set(BASTION_X, BASTION_SURFACE_Y + 0.012, BASTION_Z);
    this.scorchDecalRight.visible = false;
    this.root.add(this.scorchDecalLeft, this.scorchDecalRight);

    // Rear Bunker Tactical CRT + ECG Heartbeat Scope
    this.crtCanvas = document.createElement('canvas');
    this.crtCanvas.width = 512;
    this.crtCanvas.height = 192;
    this.crtCtx = this.crtCanvas.getContext('2d')!;
    this.crtTexture = new THREE.CanvasTexture(this.crtCanvas);
    this.crtTexture.colorSpace = THREE.SRGBColorSpace;
    const crtMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.24, 0.28),
      new THREE.MeshBasicMaterial({ map: this.crtTexture, toneMapped: false })
    );
    crtMesh.position.set(0, 0.08, -0.37);
    this.root.add(crtMesh);
    this.renderBunkerRadarStandby();

    this.muzzleFlashLight = new THREE.PointLight(0xffa838, 0, 7.5, 1.5);
    this.root.add(this.muzzleFlashLight);

    this.explosionLight = new THREE.PointLight(0xffb448, 0, 16.0, 1.35);
    this.root.add(this.explosionLight);

    this.leftMuzzleStar = this.build3DMuzzleStar(new THREE.Color(2.8, 1.95, 0.65));
    this.rightMuzzleStar = this.build3DMuzzleStar(new THREE.Color(2.9, 1.35, 0.45));
    this.root.add(this.leftMuzzleStar, this.rightMuzzleStar);

    const tracerGeo = new THREE.BoxGeometry(0.38, 0.018, 0.018);
    const navyTracerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.6, 2.05, 0.72),
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const crimsonTracerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.8, 0.95, 0.42),
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    for (let i = 0; i < 28; i++) {
      const fromLeft = i % 2 === 0;
      const mesh = new THREE.Mesh(tracerGeo, fromLeft ? navyTracerMat : crimsonTracerMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.tracers.push({
        mesh,
        fromLeft,
        yOff: 0.16 + ((i * 19) % 7) * 0.06,
        zOff: BASTION_Z + (((i * 11) % 5) - 2) * 0.085,
        phaseOffset: i * 0.17,
      });
    }

    const flakGeo = new THREE.PlaneGeometry(0.85, 0.85);
    for (let i = 0; i < 4; i++) {
      const mat = createWarfieldExplosionPlumeMaterial(10.5 + i * 7.3);
      const mesh = new THREE.Mesh(flakGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.flakPuffs.push({
        mesh,
        mat,
        offset: new THREE.Vector3(
          (i - 1.5) * 0.42,
          0.05,
          BASTION_Z + (i % 2 === 0 ? -0.18 : 0.16)
        ),
        driftVel: new THREE.Vector3(0, 0.55, 0),
        baseScale: 0.72,
        phaseDelay: 0.92 + i * 0.28,
      });
    }

    const shellGeo = new THREE.CylinderGeometry(0.018, 0.055, 1.35, 10);
    const shellMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.0, 1.95, 0.65),
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.visible = false;
      this.root.add(m);
      this.incomingShells.push(m);
    }

    this.heatBeamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.2, 2.1, 0.65),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const beamGeo = new THREE.CylinderGeometry(0.055, 0.09, 2.5, 14);
    beamGeo.rotateZ(Math.PI / 2);
    this.heatBeamMesh = new THREE.Mesh(beamGeo, this.heatBeamMat);
    this.heatBeamMesh.position.set(0, 0.34, BASTION_Z);
    this.heatBeamMesh.visible = false;
    this.root.add(this.heatBeamMesh);

    const swGeo = new THREE.PlaneGeometry(3.4, 3.4);
    swGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const mat = createShockwaveRingMaterial();
      const mesh = new THREE.Mesh(swGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.shockwaves.push({ mesh, mat });
    }

    const plumeGeo = new THREE.PlaneGeometry(1.0, 1.0);
    for (let i = 0; i < 20; i++) {
      const localIdx = i % 10;
      const isBlackSmoke = localIdx >= 4;
      const mat = createWarfieldExplosionPlumeMaterial(i * 3.71 + 1.1, isBlackSmoke);
      const mesh = new THREE.Mesh(plumeGeo, mat);
      mesh.renderOrder = isBlackSmoke ? 12 : 10;
      mesh.visible = false;
      this.root.add(mesh);
      const ang = localIdx * 1.95;
      const rad = localIdx < 2 ? 0.0 : 0.18 + (localIdx % 4) * 0.12;
      this.explosionPlumes.push({
        mesh,
        mat,
        offset: new THREE.Vector3(
          Math.cos(ang) * rad,
          (isBlackSmoke ? 0.24 : 0.08) + localIdx * 0.085,
          Math.sin(ang) * rad * 0.75 + (isBlackSmoke ? 0.12 : -0.04)
        ),
        driftVel: new THREE.Vector3(
          Math.cos(ang) * 0.28,
          0.95 + (localIdx % 5) * 0.28,
          Math.sin(ang) * 0.18
        ),
        baseScale: isBlackSmoke ? 1.15 + (localIdx % 3) * 0.25 : 1.05,
        phaseDelay: localIdx * 0.022,
      });
    }

    const shardGeo = new THREE.TetrahedronGeometry(0.095, 0);
    const charredArmorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#15181F'),
      metalness: 0.82,
      roughness: 0.42,
    });
    for (let i = 0; i < 32; i++) {
      const mesh = new THREE.Mesh(shardGeo, charredArmorMat);
      mesh.scale.set(1.35, 0.45 + (i % 3) * 0.2, 0.85);
      mesh.castShadow = true;
      mesh.visible = false;
      this.root.add(mesh);
      const a = (i / 32) * Math.PI * 2 + i * 0.31;
      const spd = 2.2 + (i % 6) * 0.75;
      this.shrapnelPool.push({
        mesh,
        origin: new THREE.Vector3(),
        vel: new THREE.Vector3(Math.cos(a) * spd, 2.4 + (i % 5) * 0.85, Math.sin(a) * spd),
        spin: new THREE.Vector3(6 + (i % 7) * 3, 8 - (i % 5) * 3, 5 + (i % 4) * 4),
        active: false,
      });
    }

    const sparkMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.9, 1.85, 0.55),
      toneMapped: false,
    });
    const sparkGeo = new THREE.BoxGeometry(0.016, 0.016, 0.34);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      this.root.add(mesh);
      const a = (i / 48) * Math.PI * 2 + i * 0.47;
      const spd = 3.2 + (i % 7) * 0.9;
      this.sparkPool.push({
        mesh,
        origin: new THREE.Vector3(),
        vel: new THREE.Vector3(Math.cos(a) * spd, 1.8 + (i % 6) * 0.7, Math.sin(a) * spd),
        spin: new THREE.Vector3(),
        active: false,
      });
    }

    this.winnerSpotLight = new THREE.SpotLight(0xffcf66, 0, 10.0, Math.PI / 5.0, 0.75, 1.2);
    this.winnerSpotLight.position.set(-BASTION_X - 0.6, 4.4, 0.8);
    this.root.add(this.winnerSpotLight, this.winnerSpotLight.target);

    this.winnerShaftMat = createGaussianLightShaftMaterial(new THREE.Color(1.95, 1.38, 0.42));
    const shaftGeo = new THREE.PlaneGeometry(2.1, 5.4);
    shaftGeo.translate(0, 2.55, 0);
    this.winnerShaftMesh = new THREE.Mesh(shaftGeo, this.winnerShaftMat);
    this.winnerShaftMesh.visible = false;
    this.root.add(this.winnerShaftMesh);

    this.medallionMesh = this.factory.createAttackMedallion();
    this.worldMedallionGroup.add(this.medallionMesh);
    this.worldMedallionGroup.visible = false;

    this.resetToIdle();
  }

  private build3DMuzzleStar(col: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    const mat = createGaussianLightShaftMaterial(col);
    mat.uniforms['uOpacity']!.value = 0.95;

    const jetGeo = new THREE.PlaneGeometry(0.24, 0.58);
    jetGeo.translate(0, 0.29, 0);
    jetGeo.rotateZ(-Math.PI / 2);

    const planeA = new THREE.Mesh(jetGeo, mat);
    const planeB = new THREE.Mesh(jetGeo, mat);
    planeB.rotation.x = Math.PI / 2;
    g.add(planeA, planeB);
    g.visible = false;
    return g;
  }

  public applyBakedHardwareParts(parts: BakedArbiterHardwareParts): void {
    if (parts.warfieldArena) {
      this.arenaMount.clear();
      const arena = parts.warfieldArena.clone(true);
      arena.position.set(0, 0, 0);
      this.arenaMount.add(arena);
    }
  }

  public get isBusy(): boolean {
    return this.activeVerdict !== null;
  }

  public setOverdriveHeld(held: boolean): void {
    this.overdriveHeld = held;
  }

  public getCameraShakeOffset(): THREE.Vector3 {
    return this.cameraShakeOffset;
  }

  /**
   * Dynamic 3-Shot *XCOM / Fury / Tekken* War Cinema Camera Director!
   * - Shot 1 (`Act 1 + Act 2A`): Asymmetric Over-The-Shoulder Breach Cam (Player initiates) vs. Claustrophobic Ambush Cam (Enemy initiates)
   * - Shot 2 (`Act 2B` Strachan Vacuum): Tight `0.08x` Bullet-Time Macro Orbit tracking the suspended 88mm Armor-Piercing Shell
   * - Shot 3 (`Act 3` Verdict): Snappy pull-back to Wide Hero Arena frame so Fireballs, Delayed Double-KO & Flag Unmasking shine!
   */
  public getBattleCameraPose(isLandscape: boolean, aspect: number): BattleCameraShot {
    const verdict = this.activeVerdict;
    const defcon = verdict?.stakes?.defcon ?? 3;
    const t = this.elapsed;

    // Default Shot 3 / Hero Arena Wide Framing
    const wideFov = isLandscape
      ? 39
      : aspect < 0.52
        ? THREE.MathUtils.clamp(55 * (0.49 / aspect), 54, 60)
        : 49;
    const widePosX = 0;
    const widePosY = isLandscape ? 2.72 : 3.02;
    const widePosZ = isLandscape ? 1.52 : 1.92;
    const wideLookZ = ARBITER_BAY_CENTER_Z - (isLandscape ? 0.18 : 0.12);

    if (!verdict) {
      return {
        pos: this.camShotPos.set(widePosX, widePosY, widePosZ),
        look: this.camShotLook.set(0, 0.14, wideLookZ),
        fov: wideFov,
        dampSpeed: 8.5,
        roomDim: 0.62,
        redAlertGlow: 0,
      };
    }

    // SHOT 1 (`0 .. tPushEnd`): Asymmetric Breach vs. Ambush Over-The-Shoulder Trench Dive!
    // Keeps BOTH clashing monoliths + Frontline Tug-of-War Bar + Bunker CRT cleanly inside 9:16 Portrait AND 16:9 Landscape!
    if (t < this.tPushEnd) {
      const u = THREE.MathUtils.clamp(t / Math.max(0.2, this.tPushEnd), 0, 1);
      const playerAttacking = verdict.attackerFaction === 'PLAYER';
      const sign = playerAttacking ? -1 : 1;
      const startX = sign * (isLandscape ? 1.85 : 1.32);
      const endX = sign * (isLandscape ? 1.45 : 1.05);
      const camX = THREE.MathUtils.lerp(startX, endX, u);
      const camY = THREE.MathUtils.lerp(isLandscape ? 1.78 : 2.32, isLandscape ? 1.56 : 2.06, u);
      const camZ = THREE.MathUtils.lerp(isLandscape ? -0.95 : 0.72, isLandscape ? -1.35 : 0.28, u);

      const lookX = -sign * 0.22;
      const lookY = 0.14;
      const lookZ = ARBITER_BAY_CENTER_Z + 0.04;

      return {
        pos: this.camShotPos.set(camX, camY, camZ),
        look: this.camShotLook.set(lookX, lookY, lookZ),
        fov: isLandscape ? 36 : Math.min(50, wideFov - 2),
        dampSpeed: 9.5,
        roomDim: defcon === 1 ? 0.36 : 0.56,
        redAlertGlow: defcon === 1 ? 1.0 : 0.0,
      };
    }

    // SHOT 2 (`tPushEnd .. tVerdict`): `0.08x` BULLET-TIME HEARTBEAT VACUUM ORBIT!
    // Tight dramatic push-in keeping BOTH bastions (`x = -1.34` & `+1.34`), ECG CRT, and suspended 88mm shell in frame!
    if (t < this.tVerdict) {
      const vacU = THREE.MathUtils.clamp(
        (t - this.tPushEnd) / Math.max(0.15, this.tVerdict - this.tPushEnd),
        0,
        1
      );
      const orbitX = Math.sin((vacU - 0.5) * 0.85) * 0.48;
      const camY = isLandscape ? 1.58 : 2.08;
      const camZ = isLandscape ? -0.55 : 0.58;
      return {
        pos: this.camShotPos.set(orbitX, camY, camZ),
        look: this.camShotLook.set(0, 0.15, ARBITER_BAY_CENTER_Z + 0.06),
        fov: isLandscape ? 34 : Math.min(47, wideFov - 4),
        dampSpeed: 12.5,
        roomDim: 0.18,
        redAlertGlow: defcon === 1 ? 1.35 : 0.45,
      };
    }

    // SHOT 3 (`t >= tVerdict`): Snappy Wide Hero Pull-Back for Colossal Fireball, Delayed Split & Flag Unmasking!
    return {
      pos: this.camShotPos.set(widePosX, widePosY, widePosZ),
      look: this.camShotLook.set(0, 0.14, wideLookZ),
      fov: wideFov,
      dampSpeed: 18.5,
      roomDim: 0.52,
      redAlertGlow: 0,
    };
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
    const defcon = verdict.stakes?.defcon ?? 3;

    // Deterministic Zero-Leak Elastic Timeline (`0.0` bits of `enemy.trueRank`!)
    this.tAct1End = 0.76;
    const pushDur = defcon === 1 ? 1.48 : defcon === 2 ? 1.28 : 1.06;
    const vacuumDur = defcon === 1 ? 0.82 : defcon === 2 ? 0.56 : 0.42;
    this.tPushEnd = this.tAct1End + pushDur;
    this.tVerdict = this.tPushEnd + vacuumDur;
    const act3Dur =
      verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
      verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY'
        ? 2.65
        : verdict.resolution === 'MUTUAL_SPLIT'
          ? 2.15
          : 1.75;
    this.tTotalEnd = this.tVerdict + act3Dur;

    if (
      verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
      verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY'
    ) {
      this.finisherVariant = 1;
    } else {
      this.finisherVariant = this.clashCounter % 3;
    }
    this.clashCounter += 1;

    this.elapsed = 0;
    this.speedScale = speedScale;
    this.pausedForDebug = false;
    this.pushAudioTriggered = false;
    this.vacuumAudioTriggered = false;
    this.act3Triggered = false;
    this.delayedSplitBannerTriggered = false;
    this.onBannerChange = onBannerChange;
    this.onSequenceComplete = onComplete;

    this.playerStartWorld.copy(playerOriginWorld);
    this.enemyStartWorld.copy(enemyOriginWorld);

    const pKills = verdict.stakes?.playerPublicKills ?? 0;
    const eKills = verdict.stakes?.enemyPublicKills ?? 0;
    this.playerStageWedge = this.factory.createCommandWedge(
      'PLAYER',
      verdict.playerVisibleRank,
      pKills
    );
    this.enemyStageWedge = this.factory.createCommandWedge('ENEMY', 'UNKNOWN', eKills);

    // For `FLAG_CAPTURED_BY_PLAYER`, mount the hidden 3D golden `FLAG` emblem onto the enemy wedge's front face
    // (hidden away from camera at `rotation.y = Math.PI` until Act 3's ceremonial `180 deg` spotlight unmasking!)
    if (verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      this.capturedFlagEmblem = buildRankEmblemMesh('FLAG', this.factory.materials.emblemPalette);
      this.capturedFlagEmblem.scale.setScalar(0.86);
      this.capturedFlagEmblem.position.set(0, 0.456, 0.126);
      this.capturedFlagEmblem.rotation.x = -THREE.MathUtils.degToRad(22.0);
      this.capturedFlagEmblem.visible = false;
      this.enemyStageWedge.add(this.capturedFlagEmblem);
    }

    this.root.add(this.playerStageWedge, this.enemyStageWedge);

    const ceremonialSq = gridToWorld(4, 0);
    this.worldMedallionGroup.position.set(ceremonialSq.x, 0, ceremonialSq.z);
    this.medallionMesh.position.set(0, 0, 0);
    this.medallionMesh.rotation.set(0, 0, 0);
    this.worldMedallionGroup.visible = true;

    const lockBanner: HudBannerState =
      defcon === 1
        ? 'DEFCON 1 — HIGH COMMAND ALERT'
        : verdict.stakes?.playerDoctrine === 'COVERT_SPY'
          ? 'OPERATION STILETTO — COVERT STRIKE'
          : verdict.stakes?.isEnemyInitiatedAmbush
            ? 'ENEMY AMBUSH — BRACE!'
            : 'CLASH LOCK-IN';
    onBannerChange(lockBanner);
    this.sound.playAct1LockIn(speedScale, verdict.stakes);
    this.applyPoseAtTime(0);
  }

  public scrubToActTime(actSeconds: number): void {
    if (!this.activeVerdict) return;
    this.pausedForDebug = true;
    this.elapsed = actSeconds;
    if (actSeconds >= this.tAct1End && actSeconds < this.tPushEnd) {
      this.onBannerChange?.('ARBITRATING');
    } else if (actSeconds >= this.tPushEnd && actSeconds < this.tVerdict) {
      this.onBannerChange?.(this.isDefenderReversal(this.activeVerdict)
        ? 'ARMOR DEFLECTED — COUNTER!'
        : 'TARGET LOCKED — HEARTBEAT');
    } else if (actSeconds >= this.tVerdict) {
      this.onBannerChange?.(this.computeFinalBanner(this.activeVerdict));
    }
    this.applyPoseAtTime(actSeconds);
  }

  public update(dt: number, totalElapsedSec: number): void {
    if (!this.activeVerdict) {
      this.cameraShakeOffset.set(0, 0, 0);
      return;
    }

    if (!this.pausedForDebug) {
      // Diegetic Thumb-Hold Overdrive (`2.2x` before verdict, releasing smoothly to `1.0x` at impact!)
      const overdriveMul = this.overdriveHeld && this.elapsed < this.tVerdict ? 2.15 : 1.0;
      this.elapsed += dt * this.speedScale * overdriveMul;
    }

    const t = this.elapsed;
    const verdict = this.activeVerdict;
    const effSpeed = this.speedScale * (this.overdriveHeld ? 2.15 : 1.0);

    // Trigger Act 2A: Asymmetric Aggressor Barrage + Dunkirk Shepard Riser!
    if (!this.pausedForDebug && !this.pushAudioTriggered && t >= this.tAct1End) {
      this.pushAudioTriggered = true;
      this.onBannerChange?.('ARBITRATING');
      this.sound.playAct2SuppressionPush(
        (this.tPushEnd - this.tAct1End) / effSpeed,
        verdict.attackerFaction === 'PLAYER',
        verdict.stakes?.defcon ?? 3
      );
    }

    // Trigger Act 2B: THE STRACHAN VACUUM + Heartbeat + Brick-Wall Armor Deflection!
    if (!this.pausedForDebug && !this.vacuumAudioTriggered && t >= this.tPushEnd) {
      this.vacuumAudioTriggered = true;
      const reversal = this.isDefenderReversal(verdict);
      this.onBannerChange?.(
        reversal ? 'ARMOR DEFLECTED — COUNTER!' : 'TARGET LOCKED — HEARTBEAT'
      );
      const defPan = verdict.defenderFaction === 'PLAYER' ? -0.52 : 0.52;
      this.sound.playStrachanVacuumAndHeartbeat(
        (this.tVerdict - this.tPushEnd) / effSpeed,
        reversal,
        defPan
      );
    }

    // Trigger Act 3: Detonation / Delayed Split / Flag Unmasking / Spy Intercept!
    if (!this.pausedForDebug && !this.act3Triggered && t >= this.tVerdict) {
      this.act3Triggered = true;
      const isSpyIntercept =
        verdict.playerVisibleRank === 'PRIVATE' && verdict.resolution === 'PLAYER_WINS';

      if (verdict.resolution === 'MUTUAL_SPLIT') {
        // Kurosawa False-Victory / False-Defeat Beat (`0.00s..0.46s`): show `TARGET HIT...` first!
        this.onBannerChange?.('TARGET HIT...');
      } else {
        this.onBannerChange?.(this.computeFinalBanner(verdict));
      }
      this.sound.playAct3Outcome(verdict.resolution, isSpyIntercept);
    }

    if (
      !this.pausedForDebug &&
      !this.delayedSplitBannerTriggered &&
      verdict.resolution === 'MUTUAL_SPLIT' &&
      t >= this.tVerdict + 0.46
    ) {
      this.delayedSplitBannerTriggered = true;
      this.onBannerChange?.('MUTUAL ELIMINATION');
    }

    this.applyPoseAtTime(t, totalElapsedSec);

    if (!this.pausedForDebug && t >= this.tTotalEnd) {
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
    this.overdriveHeld = false;
    this.worldMedallionGroup.visible = false;
    this.cameraShakeOffset.set(0, 0, 0);

    this.leftBastionRingMat.opacity = 0.22;
    this.rightBastionRingMat.opacity = 0.22;
    this.frontlineGroup.visible = false;
    this.armorDeflectShield.visible = false;
    this.bulletTimeShellGroup.visible = false;
    this.scorchDecalLeft.visible = false;
    this.scorchDecalRight.visible = false;

    this.leftMuzzleStar.visible = false;
    this.rightMuzzleStar.visible = false;
    this.muzzleFlashLight.intensity = 0;
    this.explosionLight.intensity = 0;
    this.winnerSpotLight.intensity = 0;
    this.winnerShaftMesh.visible = false;
    this.heatBeamMesh.visible = false;

    for (const tr of this.tracers) tr.mesh.visible = false;
    for (const fp of this.flakPuffs) fp.mesh.visible = false;
    for (const sh of this.incomingShells) sh.visible = false;
    for (const sw of this.shockwaves) sw.mesh.visible = false;
    for (const pl of this.explosionPlumes) pl.mesh.visible = false;
    for (const s of [...this.shrapnelPool, ...this.sparkPool]) s.mesh.visible = false;

    this.renderBunkerRadarStandby();
  }

  private isDefenderReversal(verdict: ArbiterVerdict): boolean {
    if (verdict.resolution === 'PLAYER_WINS' && verdict.attackerFaction === 'ENEMY') return true;
    if (verdict.resolution === 'ENEMY_WINS' && verdict.attackerFaction === 'PLAYER') return true;
    return false;
  }

  private computeFinalBanner(verdict: ArbiterVerdict): HudBannerState {
    if (verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER') return 'FLAG CAPTURED — VICTORY';
    if (verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY') return 'FLAG LOST — DEFEAT';
    if (verdict.resolution === 'MUTUAL_SPLIT') return 'MUTUAL ELIMINATION';
    if (verdict.playerVisibleRank === 'PRIVATE' && verdict.resolution === 'PLAYER_WINS') {
      return 'SPY INTERCEPTED — VICTORY';
    }
    return 'BATTLE WINNER';
  }

  private applyPoseAtTime(t: number, clockSec = t): void {
    const verdict = this.activeVerdict;
    if (!verdict) return;

    this.leftMuzzleStar.visible = false;
    this.rightMuzzleStar.visible = false;
    this.muzzleFlashLight.intensity = 0;
    this.explosionLight.intensity = 0;
    this.winnerSpotLight.intensity = 0;
    this.winnerShaftMesh.visible = false;
    this.heatBeamMesh.visible = false;
    this.frontlineGroup.visible = false;
    this.armorDeflectShield.visible = false;
    this.bulletTimeShellGroup.visible = false;
    this.scorchDecalLeft.visible = false;
    this.scorchDecalRight.visible = false;
    for (const tr of this.tracers) tr.mesh.visible = false;
    for (const fp of this.flakPuffs) fp.mesh.visible = false;
    for (const sh of this.incomingShells) sh.visible = false;
    for (const sw of this.shockwaves) sw.mesh.visible = false;
    for (const pl of this.explosionPlumes) pl.mesh.visible = false;
    for (const s of [...this.shrapnelPool, ...this.sparkPool]) s.mesh.visible = false;

    const playerAttacks = verdict.attackerFaction === 'PLAYER';

    // 1. Attack Medallion Drop (`0.0s .. 0.26s`)
    const medDropP = THREE.MathUtils.clamp(t / 0.26, 0, 1);
    const bounce =
      medDropP < 0.78
        ? 1 - (medDropP / 0.78) * (medDropP / 0.78)
        : Math.sin(((medDropP - 0.78) / 0.22) * Math.PI) * 0.08;
    const medY = Math.max(0, bounce * 1.4);
    this.medallionMesh.position.set(0, medY, 0);
    this.medallionMesh.rotation.set(0, 0, 0);

    // 2. Act 1 (`0.0s .. tAct1End`): ASYMMETRIC "LUNGE vs. BRACE" LOCK-IN!
    //    Aggressor slams onto its bastion FIRST (`0.02..0.22s`) leaning +13 deg forward;
    //    Defender lands SECOND (`0.12..0.34s`) skidding back 6cm into an angled defensive guard!
    const pFlyDur = playerAttacks ? 0.21 : 0.25;
    const eFlyDur = playerAttacks ? 0.25 : 0.21;
    const pDelay = playerAttacks ? 0.02 : 0.11;
    const eDelay = playerAttacks ? 0.11 : 0.02;

    const pFly = 1 - Math.pow(1 - THREE.MathUtils.clamp((t - pDelay) / pFlyDur, 0, 1), 3);
    const eFly = 1 - Math.pow(1 - THREE.MathUtils.clamp((t - eDelay) / eFlyDur, 0, 1), 3);

    const leftBastionLocal = new THREE.Vector3(-BASTION_X, BASTION_SURFACE_Y, BASTION_Z);
    const rightBastionLocal = new THREE.Vector3(BASTION_X, BASTION_SURFACE_Y, BASTION_Z);
    const pStartLocal = this.playerStartWorld.clone().sub(this.root.position);
    const eStartLocal = this.enemyStartWorld.clone().sub(this.root.position);

    const pPos = leftBastionLocal.clone().lerp(pStartLocal, 1 - pFly);
    const ePos = rightBastionLocal.clone().lerp(eStartLocal, 1 - eFly);
    pPos.y += Math.sin(pFly * Math.PI) * 1.1;
    ePos.y += Math.sin(eFly * Math.PI) * 1.1;

    const ringIgnite = THREE.MathUtils.smoothstep(t, 0.16, 0.32);
    this.leftBastionRingMat.opacity = THREE.MathUtils.lerp(0.25, 0.96, ringIgnite);
    this.rightBastionRingMat.opacity = THREE.MathUtils.lerp(0.25, 0.96, ringIgnite);

    if (this.playerStageWedge && this.enemyStageWedge) {
      this.playerStageWedge.visible = true;
      this.enemyStageWedge.visible = true;
      if (this.capturedFlagEmblem) this.capturedFlagEmblem.visible = false;

      // Asymmetric Lunge (+0.22 rad forward plow) vs. Brace (-0.12 rad defensive heel-dig)
      const pStanceZ = playerAttacks ? -0.18 : 0.12;
      const eStanceZ = playerAttacks ? -0.12 : 0.18;
      const pLungeX = playerAttacks ? 0.09 * pFly : -0.05 * pFly;
      const eLungeX = playerAttacks ? 0.05 * eFly : -0.09 * eFly;

      this.playerStageWedge.position.set(pPos.x + pLungeX, pPos.y, pPos.z);
      this.playerStageWedge.rotation.set(0, 0.34, pStanceZ * pFly);

      this.enemyStageWedge.position.set(ePos.x + eLungeX, ePos.y, ePos.z);
      this.enemyStageWedge.rotation.set(0, Math.PI - 0.34, eStanceZ * eFly);

      if (t >= 0.22 && t < this.tAct1End) {
        this.poseBurstSparks(leftBastionLocal, (t - 0.22) * 0.9, 20, 0);
        this.poseBurstSparks(rightBastionLocal, Math.max(0, t - 0.3) * 0.9, 20, 20);
      }

      if (t < this.tAct1End) {
        this.renderBunkerScope('LOCK_IN', 0.5, clockSec, verdict);
      }
    }

    // 3. Act 2A (`tAct1End .. tPushEnd`): ASYMMETRIC AGGRESSOR SUPPRESSION PUSH TO `84%`!
    if (t >= this.tAct1End && t < this.tPushEnd) {
      const pushU = (t - this.tAct1End) / Math.max(0.2, this.tPushEnd - this.tAct1End);
      // Non-linear tug-of-war curve: surges to 58%, hits a brief gritty resistance dip to 48%, then drives hard to 84%!
      const rawSurge =
        0.5 +
        0.36 *
          (pushU + 0.14 * Math.sin(pushU * Math.PI * 2.5)) *
          (playerAttacks ? 1 : -1);
      const blueShare = THREE.MathUtils.clamp(rawSurge, 0.14, 0.86);
      this.updateFrontlineGauge(blueShare, clockSec);

      const pRecoil = Math.max(0, Math.sin(t * (playerAttacks ? 46 : 26))) * (playerAttacks ? 0.055 : 0.03);
      const eRecoil = Math.max(0, Math.cos(t * (playerAttacks ? 26 : 46))) * (playerAttacks ? 0.03 : 0.055);
      if (this.playerStageWedge && this.enemyStageWedge) {
        this.playerStageWedge.position.x = -BASTION_X + (playerAttacks ? 0.08 : -0.06) - pRecoil;
        this.enemyStageWedge.position.x = BASTION_X + (playerAttacks ? 0.06 : -0.08) + eRecoil;
      }

      // Aggressor fires relentless heavy muzzle flames; Defender fires shorter counter-bursts!
      const leftFiring = playerAttacks ? Math.sin(t * 50) > -0.25 : Math.sin(t * 32) > 0.35;
      const rightFiring = !playerAttacks ? Math.cos(t * 50) > -0.25 : Math.cos(t * 32) > 0.35;
      this.leftMuzzleStar.position.set(-0.66, -0.02, BASTION_Z);
      this.rightMuzzleStar.position.set(0.66, -0.02, BASTION_Z);
      this.leftMuzzleStar.visible = leftFiring;
      this.rightMuzzleStar.visible = rightFiring;
      this.leftMuzzleStar.rotation.x = t * 26;
      this.rightMuzzleStar.rotation.y = Math.PI;
      this.rightMuzzleStar.rotation.x = -t * 28;

      if (leftFiring || rightFiring) {
        this.muzzleFlashLight.position.set(leftFiring ? -0.55 : 0.55, 0.28, 0.05);
        this.muzzleFlashLight.intensity = 2.4;
      }

      // Directional Asymmetric Tracer Barrage (75% from Aggressor hammering Defender's sloped armor!)
      let hitCount = 0;
      for (let idx = 0; idx < this.tracers.length; idx++) {
        const tr = this.tracers[idx]!;
        const isAggressorBolt = tr.fromLeft === playerAttacks;
        if (!isAggressorBolt && idx % 4 !== 1) continue;

        const cycleU = (t * (isAggressorBolt ? 3.8 : 2.3) + tr.phaseOffset) % 1.0;
        if (cycleU < 0.36) {
          const u = cycleU / 0.36;
          const startX = tr.fromLeft ? -BASTION_X + 0.38 : BASTION_X - 0.38;
          const endX = tr.fromLeft ? BASTION_X - 0.22 : -BASTION_X + 0.22;
          tr.mesh.position.set(
            THREE.MathUtils.lerp(startX, endX, u),
            tr.yOff,
            tr.zOff * (1 - u * 0.35)
          );
          tr.mesh.rotation.set(0, 0, 0);
          tr.mesh.visible = true;
          if (u > 0.78 && hitCount < 2) {
            this.poseBurstSparks(
              new THREE.Vector3(endX, tr.yOff - 0.1, BASTION_Z),
              (u - 0.75) * 0.45,
              14,
              hitCount * 16
            );
            hitCount += 1;
          }
        }
      }

      for (const fp of this.flakPuffs) {
        const age = t - fp.phaseDelay;
        if (age >= 0 && age <= 0.65) {
          const ph = age / 0.65;
          fp.mesh.visible = true;
          fp.mesh.position.copy(fp.offset).addScaledVector(fp.driftVel, age);
          fp.mesh.scale.setScalar(fp.baseScale * (0.45 + ph * 0.95));
          fp.mat.uniforms['uPhase']!.value = ph;
          fp.mat.uniforms['uTime']!.value = clockSec;
        }
      }

      if (!this.pausedForDebug) {
        const shake = 0.018;
        this.cameraShakeOffset.set(Math.sin(t * 78) * shake, Math.cos(t * 94) * shake, 0);
      }
      this.renderBunkerScope('SUPPRESSION', blueShare, clockSec, verdict);
    }

    // 4. Act 2B (`tPushEnd .. tVerdict`): "THE STRACHAN VACUUM" + `0.08x` BULLET-TIME HERO SHELL + REVERSAL!
    if (t >= this.tPushEnd && t < this.tVerdict) {
      const vacU = (t - this.tPushEnd) / Math.max(0.15, this.tVerdict - this.tPushEnd);
      const reversal = this.isDefenderReversal(verdict);

      // Sakurai `60Hz` sub-millimeter tension tremor during the dead-air silence!
      if (this.playerStageWedge && this.enemyStageWedge) {
        const microShudder = Math.sin(t * 160) * 0.008;
        this.playerStageWedge.position.x = -BASTION_X + microShudder;
        this.enemyStageWedge.position.x = BASTION_X - microShudder;
      }

      // If Defender Wins ("Brick-Wall No-Sell"!): Sloped-armor golden shield flash + Frontline snaps across trench!
      const startShare = playerAttacks ? 0.85 : 0.15;
      const targetShare =
        verdict.resolution === 'MUTUAL_SPLIT'
          ? 0.5
          : verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER'
            ? 0.92
            : 0.08;
      const curShare = THREE.MathUtils.lerp(
        startShare,
        targetShare,
        THREE.MathUtils.smoothstep(vacU, 0.0, reversal ? 0.48 : 0.85)
      );
      this.updateFrontlineGauge(curShare, clockSec);

      if (reversal && vacU < 0.48) {
        const defX = verdict.defenderFaction === 'PLAYER' ? -BASTION_X + 0.34 : BASTION_X - 0.34;
        this.armorDeflectShield.visible = true;
        this.armorDeflectShield.position.set(defX, 0.28, BASTION_Z + 0.06);
        this.armorDeflectShield.rotation.y =
          verdict.defenderFaction === 'PLAYER' ? Math.PI * 0.38 : -Math.PI * 0.38;
        this.armorDeflectShield.scale.setScalar(0.65 + vacU * 0.65);
        this.armorDeflectMat.opacity = (1 - vacU / 0.48) * 0.68;
        this.poseBurstSparks(new THREE.Vector3(defX, 0.24, BASTION_Z), vacU * 0.65, 16, 0);
      }

      // `0.08x` BULLET-TIME 88mm ARMOR-PIERCING SHELL + SUPERSONIC MACH CONE!
      const playerStrikesFatal =
        verdict.resolution === 'PLAYER_WINS' ||
        verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
        (verdict.resolution === 'MUTUAL_SPLIT' && playerAttacks);
      const shellStartX = playerStrikesFatal ? -0.68 : 0.68;
      const shellEndX = playerStrikesFatal ? BASTION_X - 0.26 : -BASTION_X + 0.26;
      const shellProgress = Math.pow(vacU, 0.72); // glides smoothly in bullet-time right up to 2mm from impact!

      this.bulletTimeShellGroup.visible = true;
      this.bulletTimeShellGroup.position.set(
        THREE.MathUtils.lerp(shellStartX, shellEndX, shellProgress),
        0.28,
        BASTION_Z
      );
      this.bulletTimeShellGroup.rotation.y = playerStrikesFatal ? 0 : Math.PI;
      this.bulletTimeShellGroup.rotation.x = t * 18; // rifled spin!
      this.machConeMat.opacity = 0.55 + 0.35 * Math.sin(vacU * Math.PI);

      this.cameraShakeOffset.set(0, 0, 0); // Dead-still Leone/Strachan freeze before impact!
      this.renderBunkerScope('HEARTBEAT_VACUUM', curShare, clockSec, verdict, vacU);
    }

    // 5. Act 3 (`t >= tVerdict`): DETONATION, KUROSAWA DELAYED SPLIT & 180° FLAG UNMASKING!
    if (t >= this.tVerdict) {
      const bt = t - this.tVerdict;
      const playerWins =
        verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';
      const enemyWins =
        verdict.resolution === 'ENEMY_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY';
      const isSplit = verdict.resolution === 'MUTUAL_SPLIT';
      const isPlayerFlagCapture = verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';

      if (isSplit) {
        // KUROSAWA CRUEL DELAYED DOUBLE-KO WHIPLASH!
        // `bt = 0.00s..0.46s`: Defender explodes FIRST! Attacker stands upright thinking they won...
        // `bt = 0.46s+`: Secondary ammo cook-off detonates Attacker + shears Brass Medallion in two!
        const firstX = playerAttacks ? BASTION_X : -BASTION_X;
        const secondX = playerAttacks ? -BASTION_X : BASTION_X;
        const firstWedge = playerAttacks ? this.enemyStageWedge : this.playerStageWedge;
        const secondWedge = playerAttacks ? this.playerStageWedge : this.enemyStageWedge;
        const firstFaction = playerAttacks ? 'ENEMY' : 'PLAYER';
        const secondFaction = playerAttacks ? 'PLAYER' : 'ENEMY';
        const firstSign = playerAttacks ? 1 : -1;
        const secondSign = -firstSign;

        if (firstX > 0) this.scorchDecalRight.visible = true;
        else this.scorchDecalLeft.visible = true;

        this.poseExplosionSite(0, firstX, bt, clockSec, 0, 10);
        this.blastLoserWedgeAndShrapnel(firstWedge, firstFaction, firstX, bt, firstSign, 0, 16);
        this.poseBurstSparks(new THREE.Vector3(firstX, BASTION_SURFACE_Y, BASTION_Z), bt, 24, 0);

        if (bt < 0.46) {
          // Apparent survivor stands upright—then begins violently jittering with thermal cook-off sparks at `0.20s`!
          if (secondWedge) {
            const cookJitter = bt > 0.2 ? Math.sin(bt * 190) * 0.035 : 0;
            secondWedge.visible = true;
            secondWedge.position.set(secondX + cookJitter, BASTION_SURFACE_Y + 0.04, BASTION_Z);
          }
          if (bt > 0.22) {
            this.poseBurstSparks(
              new THREE.Vector3(secondX, BASTION_SURFACE_Y + 0.2, BASTION_Z),
              bt - 0.22,
              18,
              24
            );
          }
          if (!this.pausedForDebug && bt < 0.32) {
            const kick = (1 - bt / 0.32) * 0.095;
            this.cameraShakeOffset.set(Math.sin(bt * 115) * kick, Math.cos(bt * 132) * kick, 0);
          } else {
            this.cameraShakeOffset.set(0, 0, 0);
          }
          this.explosionLight.position.set(firstX, 0.75, -0.05);
          this.explosionLight.intensity = Math.max(0, Math.exp(-bt * 6.0) * 3.6);
          this.renderBunkerScope('GOLD_WIN', playerAttacks ? 1 : 0, clockSec, verdict);
        } else {
          // `bt >= 0.46s`: SECONDARY COOK-OFF DETONATION + MAGNETIZED MEDALLION SPLIT!
          const bt2 = bt - 0.46;
          this.scorchDecalLeft.visible = true;
          this.scorchDecalRight.visible = true;
          this.leftBastionRingMat.opacity = 0;
          this.rightBastionRingMat.opacity = 0;

          this.poseExplosionSite(1, secondX, bt2, clockSec, 10, 20);
          this.blastLoserWedgeAndShrapnel(
            secondWedge,
            secondFaction,
            secondX,
            bt2,
            secondSign,
            16,
            32
          );
          this.poseBurstSparks(
            new THREE.Vector3(secondX, BASTION_SURFACE_Y, BASTION_Z),
            bt2,
            24,
            24
          );

          // Secondary blast shockwave jolts the solid brushed-brass Attack Medallion!
          const jolt = Math.max(0, Math.exp(-bt2 * 7.5)) * 0.12;
          this.medallionMesh.position.set(0, jolt, 0);
          this.medallionMesh.rotation.z = Math.sin(bt2 * 45) * jolt;

          if (!this.pausedForDebug && bt2 < 0.42) {
            const kick2 = (1 - bt2 / 0.42) * 0.12;
            this.cameraShakeOffset.set(Math.sin(bt2 * 125) * kick2, Math.cos(bt2 * 140) * kick2, 0);
          } else {
            this.cameraShakeOffset.set(0, 0, 0);
          }
          this.explosionLight.position.set(secondX, 0.75, -0.05);
          this.explosionLight.intensity = Math.max(0, Math.exp(-bt2 * 6.0) * 3.8);
          this.renderBunkerScope('FLATLINE', 0.5, clockSec, verdict);
        }
        return;
      }

      // CEREMONIAL `180°` FLAG UNMASKING (`bt = 0.00s..0.95s`) BEFORE 3-SALVO VICTORY BARRAGE!
      if (isPlayerFlagCapture && bt < 0.95) {
        const spinU = THREE.MathUtils.smoothstep(bt, 0.0, 0.28);
        if (this.capturedFlagEmblem) this.capturedFlagEmblem.visible = spinU > 0.15;
        if (this.enemyStageWedge) {
          this.enemyStageWedge.visible = true;
          this.enemyStageWedge.position.set(BASTION_X, BASTION_SURFACE_Y + spinU * 0.14, BASTION_Z);
          this.enemyStageWedge.rotation.set(0, Math.PI * (1 - spinU), 0);
        }
        this.winnerSpotLight.position.set(BASTION_X, 4.2, 1.2);
        this.winnerSpotLight.target.position.set(BASTION_X, 0.3, BASTION_Z);
        this.winnerSpotLight.intensity = 9.5;
        this.winnerShaftMesh.visible = true;
        this.winnerShaftMesh.position.set(BASTION_X, 0.02, BASTION_Z);
        this.winnerShaftMat.uniforms['uOpacity']!.value = 0.58;
        this.cameraShakeOffset.set(0, 0, 0);
        this.renderBunkerScope('CROWN', 1.0, clockSec, verdict);
        return;
      }

      const blastBt = isPlayerFlagCapture ? bt - 0.95 : bt;
      if (!this.pausedForDebug && blastBt < 0.45) {
        const kick = (1 - blastBt / 0.45) * 0.115;
        this.cameraShakeOffset.set(
          Math.sin(blastBt * 115) * kick,
          Math.cos(blastBt * 132) * kick,
          0
        );
      } else {
        this.cameraShakeOffset.set(0, 0, 0);
      }

      const winX = playerWins ? -BASTION_X : BASTION_X;
      const loseX = playerWins ? BASTION_X : -BASTION_X;
      const winWedge = playerWins ? this.playerStageWedge : this.enemyStageWedge;
      const loseWedge = playerWins ? this.enemyStageWedge : this.playerStageWedge;
      const loseFaction = playerWins ? 'ENEMY' : 'PLAYER';
      const loseDir = playerWins ? 1 : -1;

      if (playerWins) {
        this.scorchDecalRight.visible = true;
        this.rightBastionRingMat.opacity = 0;
        this.leftBastionRingMat.opacity = 1.0;
      } else {
        this.scorchDecalLeft.visible = true;
        this.leftBastionRingMat.opacity = 0;
        this.rightBastionRingMat.opacity = 1.0;
      }

      if (this.finisherVariant === 2 && blastBt < 0.2) {
        this.heatBeamMesh.visible = true;
        this.heatBeamMat.opacity = 1 - blastBt / 0.2;
        this.leftMuzzleStar.visible = playerWins;
        this.rightMuzzleStar.visible = enemyWins;
      }

      if (this.finisherVariant === 1) {
        for (const [sIdx, delay] of [0.12, 0.25].entries()) {
          if (blastBt >= delay - 0.1 && blastBt < delay) {
            const u = (blastBt - (delay - 0.1)) / 0.1;
            const sh = this.incomingShells[sIdx + 1]!;
            sh.visible = true;
            sh.position.lerpVectors(
              new THREE.Vector3(loseX - loseDir * 0.7, 3.5, BASTION_Z + (sIdx - 0.5) * 0.3),
              new THREE.Vector3(loseX + (sIdx - 0.5) * 0.25, 0.2, BASTION_Z),
              u
            );
            sh.rotation.z = loseDir * -0.2;
          }
        }
        this.poseExplosionSite(0, loseX - 0.12, blastBt, clockSec, 0, 12);
        if (blastBt >= 0.14) {
          this.poseExplosionSite(1, loseX + 0.18, blastBt - 0.14, clockSec, 12, 20);
        }
      } else {
        this.poseExplosionSite(0, loseX, blastBt, clockSec, 0, 20);
      }

      this.blastLoserWedgeAndShrapnel(loseWedge, loseFaction, loseX, blastBt, loseDir, 0, 32);
      this.poseBurstSparks(new THREE.Vector3(loseX, BASTION_SURFACE_Y, BASTION_Z), blastBt, 48, 0);

      this.explosionLight.position.set(loseX, 0.75, -0.05);
      this.explosionLight.intensity = Math.max(0, Math.exp(-blastBt * 6.2) * 3.8);

      if (winWedge) {
        const recoil = Math.sin(Math.min(1, blastBt / 0.22) * Math.PI) * 0.14;
        const heroLift = THREE.MathUtils.smoothstep(blastBt, 0.18, 0.55) * 0.12;
        winWedge.visible = true;
        winWedge.position.set(winX - loseDir * recoil, BASTION_SURFACE_Y + heroLift, BASTION_Z);
        const baseYaw = playerWins ? 0.26 : Math.PI - 0.26;
        winWedge.rotation.set(0, baseYaw, -loseDir * recoil * 0.8);
      }

      const flareIn = THREE.MathUtils.smoothstep(blastBt, 0.22, 0.62);
      this.winnerSpotLight.position.set(winX - 0.5, 4.4, 0.85);
      this.winnerSpotLight.target.position.set(winX, 0.2, BASTION_Z);
      this.winnerSpotLight.intensity = 8.5 * flareIn;

      this.winnerShaftMesh.visible = flareIn > 0.02;
      this.winnerShaftMesh.position.set(winX, 0.02, BASTION_Z);
      this.winnerShaftMesh.rotation.z = winX < 0 ? 0.15 : -0.15;
      this.winnerShaftMat.uniforms['uOpacity']!.value = 0.52 * flareIn;

      this.renderBunkerScope(
        verdict.resolution.includes('FLAG') ? 'CROWN' : 'GOLD_WIN',
        playerWins ? 1 : 0,
        clockSec,
        verdict
      );
    }
  }

  private updateFrontlineGauge(blueShare: number, clockSec: number): void {
    this.frontlineGroup.visible = true;
    const totalSpan = 2.1;
    const blueLen = Math.max(0.05, blueShare * totalSpan);
    const redLen = Math.max(0.05, (1 - blueShare) * totalSpan);
    this.blueFrontlineBar.scale.x = blueLen;
    this.crimsonFrontlineBar.scale.x = redLen;
    const nodeX = -1.05 + blueLen;
    this.frontlineSparkNode.position.x = nodeX;
    this.frontlineSparkNode.rotation.y = clockSec * 8;
    const pulse = 0.9 + 0.28 * Math.sin(clockSec * 28);
    this.frontlineSparkNode.scale.setScalar(pulse);
  }

  private poseExplosionSite(
    swIndex: number,
    centerX: number,
    bt: number,
    clockSec: number,
    plumeStart: number,
    plumeEnd: number
  ): void {
    const sw = this.shockwaves[swIndex];
    if (sw && bt >= 0 && bt <= 0.62) {
      sw.mesh.visible = true;
      sw.mesh.position.set(centerX, BASTION_SURFACE_Y + 0.03, BASTION_Z);
      sw.mat.uniforms['uProgress']!.value = bt / 0.62;
    }

    for (let i = plumeStart; i < plumeEnd; i++) {
      const pl = this.explosionPlumes[i]!;
      const age = bt - pl.phaseDelay;
      const maxDur = 1.55;
      if (age >= 0 && age <= maxDur) {
        const ph = age / maxDur;
        pl.mesh.visible = true;
        pl.mesh.position.set(
          centerX + pl.offset.x + pl.driftVel.x * age,
          BASTION_SURFACE_Y + pl.offset.y + pl.driftVel.y * Math.pow(age, 0.78),
          BASTION_Z + pl.offset.z + pl.driftVel.z * age
        );
        const expand = pl.baseScale * (0.38 + 1.35 * Math.pow(ph, 0.55));
        pl.mesh.scale.setScalar(expand);
        pl.mat.uniforms['uPhase']!.value = ph;
        pl.mat.uniforms['uTime']!.value = clockSec;
      }
    }
  }

  private blastLoserWedgeAndShrapnel(
    wedge: THREE.Group | null,
    _faction: 'PLAYER' | 'ENEMY',
    centerX: number,
    bt: number,
    outwardSign: number,
    shardStart: number,
    shardEnd: number
  ): void {
    if (wedge) {
      if (bt < 0.44) {
        wedge.visible = true;
        const g = 9.5;
        wedge.position.set(
          centerX + outwardSign * bt * 0.85,
          BASTION_SURFACE_Y + bt * 2.8 - 0.5 * g * bt * bt,
          BASTION_Z - bt * 0.85
        );
        wedge.rotation.set(bt * 8.2, bt * 5.6, -outwardSign * bt * 9.8);
      } else {
        wedge.visible = false;
      }
    }

    for (let i = shardStart; i < shardEnd; i++) {
      const sh = this.shrapnelPool[i]!;
      if (bt <= 0 || bt > 1.55) {
        sh.mesh.visible = false;
        continue;
      }
      sh.mesh.visible = true;
      const x = centerX + sh.vel.x * bt * 0.68;
      let y = BASTION_SURFACE_Y + 0.22 + sh.vel.y * bt - 4.9 * bt * bt;
      if (y < BASTION_SURFACE_Y + 0.04) {
        y = BASTION_SURFACE_Y + 0.04 + Math.abs(y - (BASTION_SURFACE_Y + 0.04)) * 0.28;
      }
      const z = BASTION_Z + sh.vel.z * bt * 0.68;
      sh.mesh.position.set(x, y, z);
      sh.mesh.rotation.set(sh.spin.x * bt, sh.spin.y * bt, sh.spin.z * bt);
    }
  }

  private poseBurstSparks(
    origin: THREE.Vector3,
    age: number,
    count: number,
    offsetIdx: number
  ): void {
    if (age <= 0 || age > 0.72) return;
    const end = Math.min(this.sparkPool.length, offsetIdx + count);
    for (let i = offsetIdx; i < end; i++) {
      const sp = this.sparkPool[i]!;
      sp.mesh.visible = true;
      const vx = sp.vel.x * 0.62;
      const vy = sp.vel.y - 7.5 * age;
      const vz = sp.vel.z * 0.62;
      const px = origin.x + vx * age;
      const py = Math.max(
        BASTION_SURFACE_Y + 0.02,
        origin.y + 0.18 + sp.vel.y * age - 3.75 * age * age
      );
      const pz = origin.z + vz * age;
      sp.mesh.position.set(px, py, pz);
      sp.mesh.lookAt(px + vx, py + vy, pz + vz);
      const fade = Math.max(0.12, 1 - age / 0.72);
      sp.mesh.scale.set(1, 1, fade);
    }
  }

  private renderBunkerRadarStandby(): void {
    const ctx = this.crtCtx;
    const w = this.crtCanvas.width;
    const h = this.crtCanvas.height;
    ctx.fillStyle = '#040a08';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(229, 185, 104, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, h * 0.5);
    ctx.lineTo(w - 16, h * 0.5);
    ctx.stroke();
    this.crtTexture.needsUpdate = true;
  }

  private renderBunkerScope(
    mode: 'LOCK_IN' | 'SUPPRESSION' | 'HEARTBEAT_VACUUM' | 'GOLD_WIN' | 'CROWN' | 'FLATLINE',
    blueShare: number,
    clockSec: number,
    verdict: ArbiterVerdict,
    vacProgress = 0
  ): void {
    const ctx = this.crtCtx;
    const w = this.crtCanvas.width;
    const h = this.crtCanvas.height;

    ctx.fillStyle = mode === 'HEARTBEAT_VACUUM' ? '#070304' : '#040908';
    ctx.fillRect(0, 0, w, h);

    const midY = h * 0.54;

    if (mode === 'HEARTBEAT_VACUUM') {
      // High-Contrast Hospital / Submarine ECG Heartbeat Trace (`LUB-DUB` QRS Complex!)
      const sweepX = ((vacProgress * 2.0) % 1.0) * w;
      ctx.strokeStyle = verdict.stakes?.defcon === 1 ? '#ff4e5e' : '#58f29c';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (let x = 12; x < w - 12; x += 4) {
        const u = x / w;
        const d1 = (u - 0.32) * 28;
        const d2 = (u - 0.72) * 28;
        const qrs =
          Math.exp(-d1 * d1) * Math.sin(d1 * 4.5) * 62 +
          Math.exp(-d2 * d2) * Math.sin(d2 * 4.5) * 68;
        const fade = x <= sweepX + 40 ? 1.0 : 0.18;
        const y = midY - qrs * fade;
        if (x === 12) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#ffd982';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(
        this.isDefenderReversal(verdict) ? 'COUNTER-BATTERY LOCK' : 'CRITICAL LOCK // 88MM',
        42,
        32
      );
      this.crtTexture.needsUpdate = true;
      return;
    }

    const hasLiveAudio = this.sound.sampleLiveWaveform(this.waveformSample);
    const grad = ctx.createLinearGradient(16, 0, w - 16, 0);
    if (mode === 'SUPPRESSION' || mode === 'LOCK_IN') {
      grad.addColorStop(0.0, '#49c6ff');
      grad.addColorStop(Math.max(0.05, Math.min(0.95, blueShare)), '#ffe884');
      grad.addColorStop(1.0, '#ff4d5e');
    } else {
      grad.addColorStop(0.0, '#ffb02e');
      grad.addColorStop(0.5, '#ffef9c');
      grad.addColorStop(1.0, '#ffb02e');
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(14, midY);
    ctx.lineTo(w - 14, midY);

    if (mode !== 'FLATLINE') {
      const spikes = 84;
      for (let i = 0; i <= spikes; i++) {
        const u = i / spikes;
        const sIdx = Math.floor(u * (this.waveformSample.length - 1));
        const live = hasLiveAudio ? Math.abs(this.waveformSample[sIdx]!) * 2.2 : 0;
        const syn =
          0.22 + 0.65 * Math.abs(Math.sin(i * 17.3 + clockSec * 32)) * Math.sin(u * Math.PI);
        const hh = Math.min(h * 0.42, Math.max(live, syn) * h * 0.4);
        const x = 14 + u * (w - 28);
        ctx.moveTo(x, midY - hh);
        ctx.lineTo(x, midY + hh);
      }
    }
    ctx.stroke();

    ctx.fillStyle = mode === 'FLATLINE' ? '#ff6474' : '#e8c478';
    ctx.font = 'bold 20px monospace';
    const label =
      mode === 'FLATLINE'
        ? 'MUTUAL NEUTRALIZATION'
        : mode === 'CROWN'
          ? 'ENEMY FLAG UNMASKED'
          : `DEFCON ${verdict.stakes?.defcon ?? 3} // ${Math.round(blueShare * 100)}%`;
    ctx.fillText(label, 42, 30);

    this.crtTexture.needsUpdate = true;
  }

  private cleanupStageWedges(): void {
    if (this.playerStageWedge) {
      this.root.remove(this.playerStageWedge);
      this.playerStageWedge = null;
    }
    if (this.enemyStageWedge) {
      this.root.remove(this.enemyStageWedge);
      this.enemyStageWedge = null;
    }
    this.capturedFlagEmblem = null;
  }
}
