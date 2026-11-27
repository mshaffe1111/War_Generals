import * as THREE from 'three';
import type { SoundDirector } from '../audio/SoundDirector';
import type { ArbiterVerdict, BattleResolutionKind, HudBannerState } from '../core/types';
import {
  ARBITER_BAY_CENTER_Z,
  type BakedArbiterHardwareParts,
  gridToWorld,
  type MeshFactory,
} from '../graphics/MeshFactory';

const BASTION_X = 1.34;
const BASTION_Z = 0.12;
const BASTION_SURFACE_Y = -0.085;

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
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly fireTime: number;
  readonly flightDur: number;
}

/**
 * Custom Procedural FBM Volumetric Fireball-to-Black-Gunsmoke GLSL Shader!
 * - `uPhase` (`0..1`):
 *    - `0.00..0.22`: Blinding white-yellow core -> molten orange detonation flash
 *    - `0.22..0.55`: Churning crimson-amber fireball veined with dark soot cracks
 *    - `0.55..1.00`: Thick, billowing charcoal battle-smoke fading smoothly into air
 */
function createWarfieldExplosionPlumeMaterial(seed: number, isSmokeLayer = false): THREE.ShaderMaterial {
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

        // Outer/Upper Smoke Layer = thick rolling dark charcoal gunsmoke rim-lit by subtle warm underglow!
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

export class ArbiterStage3D {
  public readonly root = new THREE.Group();
  public readonly worldMedallionGroup = new THREE.Group();

  private readonly factory: MeshFactory;
  private readonly sound: SoundDirector;

  private readonly arenaMount = new THREE.Group();
  private readonly leftBastionRingMat: THREE.MeshBasicMaterial;
  private readonly rightBastionRingMat: THREE.MeshBasicMaterial;
  private readonly targetLockReticle: THREE.Mesh;
  private readonly targetLockMat: THREE.MeshBasicMaterial;

  // Bunker Tactical Field-Scope CRT + Twin Armored Visor Slits
  private readonly crtCanvas: HTMLCanvasElement;
  private readonly crtCtx: CanvasRenderingContext2D;
  private readonly crtTexture: THREE.CanvasTexture;
  private readonly waveformSample = new Float32Array(256);

  // Live-Fire Muzzle Stars, Tracers, Incoming Artillery Shell, Heat Beam, Shockwaves, Plumes & Shrapnel!
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
  private playerStartWorld = new THREE.Vector3();
  private enemyStartWorld = new THREE.Vector3();

  private activeVerdict: ArbiterVerdict | null = null;
  private finisherVariant = 0; // 0 = Artillery Bunker-Buster | 1 = Multi-Rocket Barrage | 2 = Point-Blank Tank Blast
  private clashCounter = 0;
  private elapsed = 0;
  private speedScale = 1;
  private pausedForDebug = false;
  private act2Triggered = false;
  private act3Triggered = false;
  private onBannerChange?: (banner: HudBannerState) => void;
  private onSequenceComplete?: () => void;

  private cameraShakeOffset = new THREE.Vector3();

  constructor(factory: MeshFactory, sound: SoundDirector) {
    this.factory = factory;
    this.sound = sound;

    this.root.position.set(0, 0, ARBITER_BAY_CENTER_Z);

    // Fallback sunken dark trench basin until `warfield_arena.glb` swaps in (<80ms)
    const fbFloor = new THREE.Mesh(
      new THREE.BoxGeometry(4.96, 0.12, 2.0),
      this.factory.materials.mudTerrain
    );
    fbFloor.position.set(0, -0.28, 0);
    fbFloor.receiveShadow = true;
    this.arenaMount.add(fbFloor);
    this.root.add(this.arenaMount);

    // Tactical Cyan & Crimson Laser Rangefinder Rings atop the Left & Right Sandbagged Bastions
    this.leftBastionRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.32, 1.9, 2.4),
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const lRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 44),
      this.leftBastionRingMat
    );
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
    const rRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 44),
      this.rightBastionRingMat
    );
    rRing.rotation.x = -Math.PI / 2;
    rRing.position.set(BASTION_X, BASTION_SURFACE_Y + 0.008, BASTION_Z);
    this.root.add(rRing);

    // Pulsing Artillery Target-Lock Crosshair Reticle
    this.targetLockMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.6, 0.35, 0.25),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const lockGeo = new THREE.RingGeometry(0.54, 0.61, 36);
    lockGeo.rotateX(-Math.PI / 2);
    this.targetLockReticle = new THREE.Mesh(lockGeo, this.targetLockMat);
    this.targetLockReticle.visible = false;
    this.root.add(this.targetLockReticle);

    // Scorched Blast Crater Decals for Post-Explosion Aftermath
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

    // Rear Bunker Recessed Tactical Comms CRT (`z = -0.44, y = 0.08`)
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

    // Dynamic Combat Lights (Muzzle Flash + Colossal Explosion PointLight)
    this.muzzleFlashLight = new THREE.PointLight(0xffa838, 0, 7.5, 1.5);
    this.root.add(this.muzzleFlashLight);

    this.explosionLight = new THREE.PointLight(0xffb448, 0, 16.0, 1.35);
    this.root.add(this.explosionLight);

    // 3D Crossed-Cone Star Muzzle Flashes
    this.leftMuzzleStar = this.build3DMuzzleStar(new THREE.Color(2.8, 1.95, 0.65));
    this.leftMuzzleStar.position.set(-BASTION_X + 0.42, 0.32, BASTION_Z + 0.04);
    this.rightMuzzleStar = this.build3DMuzzleStar(new THREE.Color(2.9, 1.35, 0.45));
    this.rightMuzzleStar.position.set(BASTION_X - 0.42, 0.32, BASTION_Z - 0.04);
    this.root.add(this.leftMuzzleStar, this.rightMuzzleStar);

    // 28 High-Velocity Ballistic Tracer Rounds
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

      const startX = fromLeft ? -BASTION_X + 0.38 : BASTION_X - 0.38;
      const endX = fromLeft ? BASTION_X - 0.25 : -BASTION_X + 0.25;
      const yOff = 0.16 + ((i * 19) % 7) * 0.065;
      const zOff = BASTION_Z + (((i * 11) % 5) - 2) * 0.09;

      this.tracers.push({
        mesh,
        start: new THREE.Vector3(startX, yOff, zOff),
        end: new THREE.Vector3(endX, yOff + (((i * 7) % 3) - 1) * 0.06, zOff * 0.6),
        fireTime: 0.96 + (i / 28) * 1.62 + (i % 3) * 0.025,
        flightDur: 0.095,
      });
    }

    // 4 No-Man's-Land Flak / Mortar Airburst Plumes (Act 2)
    const flakGeo = new THREE.PlaneGeometry(0.85, 0.85);
    for (let i = 0; i < 4; i++) {
      const mat = createWarfieldExplosionPlumeMaterial(10.5 + i * 7.3);
      const mesh = new THREE.Mesh(flakGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.flakPuffs.push({
        mesh,
        mat,
        offset: new THREE.Vector3((i - 1.5) * 0.42, 0.05, BASTION_Z + (i % 2 === 0 ? -0.18 : 0.16)),
        driftVel: new THREE.Vector3(0, 0.55, 0),
        baseScale: 0.72,
        phaseDelay: 1.12 + i * 0.38,
      });
    }

    // 3 Supersonic Incoming Artillery / Rocket Streaks
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

    // Point-Blank Armor-Piercing Tank Blast Beam (Finisher Variant 2)
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

    // 2 Expanding Supersonic Ground Shockwave Rings
    const swGeo = new THREE.PlaneGeometry(3.4, 3.4);
    swGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const mat = createShockwaveRingMaterial();
      const mesh = new THREE.Mesh(swGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.shockwaves.push({ mesh, mat });
    }

    // 20 Multi-Billow Volumetric GLSL Plumes: 4 inner Fire Cores + 6 Foreground/Upper Thick Black Soot Billows per site!
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

    // 32 Jagged Matte Charred-Iron Armor Shrapnel Shards (`emissive = 0` so NEVER bright red rectangles!)
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

    // Golden Battlefield Flare / Victory Spotlight Shaft
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
    this.worldMedallionGroup.visible = false;
    this.worldMedallionGroup.add(this.medallionMesh);

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
    // Rotate through 3 dramatic Warfield Finishers (`0`: Artillery Bunker-Buster, `1`: Rocket Barrage, `2`: Tank Blast)
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
    this.act2Triggered = false;
    this.act3Triggered = false;
    this.onBannerChange = onBannerChange;
    this.onSequenceComplete = onComplete;

    this.playerStartWorld.copy(playerOriginWorld);
    this.enemyStartWorld.copy(enemyOriginWorld);

    this.playerStageWedge = this.factory.createCommandWedge('PLAYER', verdict.playerVisibleRank);
    this.enemyStageWedge = this.factory.createCommandWedge('ENEMY', 'UNKNOWN');
    this.root.add(this.playerStageWedge, this.enemyStageWedge);

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
    if (actSeconds >= 0.95 && actSeconds < 2.8) {
      this.onBannerChange?.('ARBITRATING');
    } else if (actSeconds >= 2.8) {
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

    if (!this.pausedForDebug && !this.act2Triggered && t >= 0.95) {
      this.act2Triggered = true;
      this.onBannerChange?.('ARBITRATING');
      this.sound.playAct2Arbitrating((2.8 - 0.95) / this.speedScale);
    }

    if (!this.pausedForDebug && !this.act3Triggered && t >= 2.8) {
      this.act3Triggered = true;
      this.onBannerChange?.(this.verdictToAct3Banner(this.activeVerdict.resolution));
      this.sound.playAct3Outcome(this.activeVerdict.resolution);
    }

    this.applyPoseAtTime(t, totalElapsedSec);

    if (!this.pausedForDebug && t >= 4.5) {
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

    this.leftBastionRingMat.opacity = 0.22;
    this.rightBastionRingMat.opacity = 0.22;
    this.targetLockReticle.visible = false;
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

  private applyPoseAtTime(t: number, clockSec = t): void {
    const verdict = this.activeVerdict;
    if (!verdict) return;

    // Reset transient visibility before evaluating analytical frame state `t`
    this.leftMuzzleStar.visible = false;
    this.rightMuzzleStar.visible = false;
    this.muzzleFlashLight.intensity = 0;
    this.explosionLight.intensity = 0;
    this.winnerSpotLight.intensity = 0;
    this.winnerShaftMesh.visible = false;
    this.heatBeamMesh.visible = false;
    this.targetLockReticle.visible = false;
    this.scorchDecalLeft.visible = false;
    this.scorchDecalRight.visible = false;
    for (const tr of this.tracers) tr.mesh.visible = false;
    for (const fp of this.flakPuffs) fp.mesh.visible = false;
    for (const sh of this.incomingShells) sh.visible = false;
    for (const sw of this.shockwaves) sw.mesh.visible = false;
    for (const pl of this.explosionPlumes) pl.mesh.visible = false;
    for (const s of [...this.shrapnelPool, ...this.sparkPool]) s.mesh.visible = false;

    // 1. Attack Medallion Drop (`0.0s .. 0.28s`)
    const medDropP = THREE.MathUtils.clamp(t / 0.28, 0, 1);
    const bounce =
      medDropP < 0.78
        ? 1 - (medDropP / 0.78) * (medDropP / 0.78)
        : Math.sin(((medDropP - 0.78) / 0.22) * Math.PI) * 0.08;
    this.medallionMesh.position.y = Math.max(0, bounce * 1.4);

    // 2. Act 1 (`0.0s .. 0.95s`): Forces Drop Into Sandbagged Bastions + Earth/Spark Impact!
    const flyP = THREE.MathUtils.clamp((t - 0.02) / 0.22, 0, 1);
    const easedFly = 1 - Math.pow(1 - flyP, 3);
    const arcLift = Math.sin(flyP * Math.PI) * 1.15;

    const leftBastionLocal = new THREE.Vector3(-BASTION_X, BASTION_SURFACE_Y, BASTION_Z);
    const rightBastionLocal = new THREE.Vector3(BASTION_X, BASTION_SURFACE_Y, BASTION_Z);

    const pStartLocal = this.playerStartWorld.clone().sub(this.root.position);
    const eStartLocal = this.enemyStartWorld.clone().sub(this.root.position);

    const pPos = leftBastionLocal.clone().lerp(pStartLocal, 1 - easedFly);
    const ePos = rightBastionLocal.clone().lerp(eStartLocal, 1 - easedFly);
    pPos.y += arcLift;
    ePos.y += arcLift;

    const ringIgnite = THREE.MathUtils.smoothstep(t, 0.18, 0.3);
    this.leftBastionRingMat.opacity = THREE.MathUtils.lerp(0.25, 0.96, ringIgnite);
    this.rightBastionRingMat.opacity = THREE.MathUtils.lerp(0.25, 0.96, ringIgnite);

    // Aggressive inward-angled firing stance across No-Man's-Land!
    if (this.playerStageWedge && this.enemyStageWedge) {
      this.playerStageWedge.visible = true;
      this.enemyStageWedge.visible = true;

      let pTiltZ = 0;
      let eTiltZ = 0;
      if (t >= 0.22 && t < 0.95) {
        const imp = 1 - THREE.MathUtils.smoothstep(t, 0.58, 0.92);
        pTiltZ = 0.22 * imp;
        eTiltZ = -0.18 * imp;
        this.poseBurstSparks(leftBastionLocal, (t - 0.22) * 0.9, 24, 0);
        this.poseBurstSparks(rightBastionLocal, Math.max(0, t - 0.28) * 0.9, 18, 24);
      }

      this.playerStageWedge.position.copy(pPos);
      this.playerStageWedge.rotation.set(0, 0.34, pTiltZ);

      this.enemyStageWedge.position.copy(ePos);
      this.enemyStageWedge.rotation.set(0, Math.PI - 0.34, eTiltZ);

      if (t < 0.95) {
        this.renderSpikedCrtOscilloscope('ARBITRATING', clockSec);
      }
    }

    // 3. Act 2 (`0.95s .. 2.80s`): Fierce Gunfire Exchange, Tracers, Ricochets, Mortar Geysers & Incoming Shell!
    if (t >= 0.95 && t < 2.8) {
      const pRecoil = Math.max(0, Math.sin(t * 38)) * 0.04;
      const eRecoil = Math.max(0, Math.cos(t * 42)) * 0.04;
      if (this.playerStageWedge && this.enemyStageWedge) {
        this.playerStageWedge.position.x = -BASTION_X - pRecoil;
        this.enemyStageWedge.position.x = BASTION_X + eRecoil;
      }

      // Feathered Volumetric Muzzle Flame Jets from BOTH Sandbagged Cannon Emplacements (`x = +/-0.62, y = -0.04`)!
      const leftFiring = Math.sin(t * 44) > -0.15;
      const rightFiring = Math.cos(t * 48) > -0.15;
      this.leftMuzzleStar.position.set(-0.66, -0.02, BASTION_Z);
      this.rightMuzzleStar.position.set(0.66, -0.02, BASTION_Z);
      this.leftMuzzleStar.visible = leftFiring;
      this.rightMuzzleStar.visible = rightFiring;
      this.leftMuzzleStar.rotation.x = t * 25;
      this.rightMuzzleStar.rotation.y = Math.PI;
      this.rightMuzzleStar.rotation.x = -t * 27;

      if (leftFiring || rightFiring) {
        this.muzzleFlashLight.position.set(leftFiring ? -0.55 : 0.55, 0.28, 0.05);
        this.muzzleFlashLight.intensity = 2.2;
      }

      // Simultaneous Multi-Round Ballistic Tracer Crossfire + Armor Ricochet Sparks!
      let hitCount = 0;
      for (let idx = 0; idx < this.tracers.length; idx++) {
        const tr = this.tracers[idx]!;
        const cycleU = ((t * 3.4 + idx * 0.19) % 1.0);
        if (cycleU < 0.36) {
          const u = cycleU / 0.36;
          tr.mesh.position.lerpVectors(tr.start, tr.end, u);
          tr.mesh.lookAt(tr.end);
          tr.mesh.rotateY(Math.PI / 2);
          tr.mesh.visible = true;
          if (u > 0.78 && hitCount < 2) {
            this.poseBurstSparks(tr.end, (u - 0.75) * 0.45, 12, hitCount * 14);
            hitCount += 1;
          }
        }
      }

      // Close-Call Mortar / Flak Plumes in No-Man's-Land
      for (const fp of this.flakPuffs) {
        const age = t - fp.phaseDelay;
        if (age >= 0 && age <= 0.68) {
          const ph = age / 0.68;
          fp.mesh.visible = true;
          fp.mesh.position.copy(fp.offset).addScaledVector(fp.driftVel, age);
          const s = fp.baseScale * (0.45 + ph * 0.95);
          fp.mesh.scale.setScalar(s);
          fp.mat.uniforms['uPhase']!.value = ph;
          fp.mat.uniforms['uTime']!.value = clockSec;
        }
      }

      // Tightening Artillery Target-Lock Reticle (`2.15s .. 2.80s`) — patrols No-Man's-Land keeping suspense high!
      if (t >= 2.15) {
        const lockP = (t - 2.15) / 0.65;
        const sweepX = Math.sin(lockP * Math.PI * 3.5) * BASTION_X * (1 - lockP * 0.35);
        this.targetLockReticle.visible = true;
        this.targetLockReticle.position.set(sweepX, BASTION_SURFACE_Y + 0.03, BASTION_Z);
        const sc = 1.25 - lockP * 0.45;
        this.targetLockReticle.scale.setScalar(sc);
        this.targetLockMat.opacity = 0.55 + 0.45 * Math.sin(t * 32);
      }

      // Incoming Supersonic Artillery Shell Streak (`2.68s .. 2.80s`)
      if (t >= 2.68 && this.finisherVariant !== 2) {
        const sp = (t - 2.68) / 0.12;
        const targetX = this.getPrimaryBlastTargetX(verdict.resolution);
        const shell = this.incomingShells[0]!;
        shell.visible = true;
        const startPos = new THREE.Vector3(targetX - 0.85, 3.8, BASTION_Z - 0.3);
        const endPos = new THREE.Vector3(targetX, 0.25, BASTION_Z);
        shell.position.lerpVectors(startPos, endPos, sp);
        shell.rotation.z = -0.22;
      }

      if (!this.pausedForDebug) {
        const shake = 0.018;
        this.cameraShakeOffset.set(Math.sin(t * 78) * shake, Math.cos(t * 94) * shake, 0);
      }
      this.renderSpikedCrtOscilloscope('ARBITRATING', clockSec);
    }

    // 4. Act 3 (`2.80s .. 4.50s`): SPECTACULAR WARFIELD EXPLOSION, SHOCKWAVE & SHRAPNEL!
    if (t >= 2.8) {
      const bt = t - 2.8;
      const playerWins =
        verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';
      const enemyWins =
        verdict.resolution === 'ENEMY_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY';
      const isSplit = verdict.resolution === 'MUTUAL_SPLIT';

      // Heavy detonation camera shock-kick (`0.0s .. 0.42s` of Act 3)
      if (!this.pausedForDebug && bt < 0.45) {
        const kick = (1 - bt / 0.45) * 0.11;
        this.cameraShakeOffset.set(Math.sin(bt * 115) * kick, Math.cos(bt * 132) * kick, 0);
      } else {
        this.cameraShakeOffset.set(0, 0, 0);
      }

      if (isSplit) {
        // TWIN SYNCHRONIZED BUNKER-BUSTER DETONATION ON BOTH BASTIONS!
        this.scorchDecalLeft.visible = true;
        this.scorchDecalRight.visible = true;
        this.leftBastionRingMat.opacity = 0;
        this.rightBastionRingMat.opacity = 0;

        this.poseExplosionSite(0, -BASTION_X, bt, clockSec, 0, 10);
        this.poseExplosionSite(1, BASTION_X, Math.max(0, bt - 0.09), clockSec, 10, 20);

        this.blastLoserWedgeAndShrapnel(
          this.playerStageWedge,
          'PLAYER',
          -BASTION_X,
          bt,
          -1,
          0,
          16
        );
        this.blastLoserWedgeAndShrapnel(
          this.enemyStageWedge,
          'ENEMY',
          BASTION_X,
          Math.max(0, bt - 0.09),
          1,
          16,
          32
        );
        this.poseBurstSparks(leftBastionLocal, bt, 24, 0);
        this.poseBurstSparks(rightBastionLocal, Math.max(0, bt - 0.09), 24, 24);

        this.explosionLight.position.set(0, 0.75, -0.05);
        this.explosionLight.intensity = Math.max(0, Math.exp(-bt * 6.0) * 3.6);
        this.renderSpikedCrtOscilloscope('FLATLINE', clockSec);
      } else {
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

        // Finisher Variant 2: Point-Blank Armor-Piercing Tank Blast Beam (`bt = 0.00..0.18s`)
        if (this.finisherVariant === 2 && bt < 0.2) {
          this.heatBeamMesh.visible = true;
          this.heatBeamMat.opacity = 1 - bt / 0.2;
          this.leftMuzzleStar.visible = playerWins;
          this.rightMuzzleStar.visible = enemyWins;
        }

        // Finisher Variant 1: Staggered Multi-Rocket Salvo (`bt = 0.0, 0.14, 0.28s`)
        if (this.finisherVariant === 1) {
          for (const [sIdx, delay] of [0.12, 0.25].entries()) {
            if (bt >= delay - 0.1 && bt < delay) {
              const u = (bt - (delay - 0.1)) / 0.1;
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
          this.poseExplosionSite(0, loseX - 0.12, bt, clockSec, 0, 12);
          if (bt >= 0.14) {
            this.poseExplosionSite(1, loseX + 0.18, bt - 0.14, clockSec, 12, 20);
          }
        } else {
          // Finisher Variant 0 & 2: Colossal 20-Billow Fireball-to-Black-Smoke Column!
          this.poseExplosionSite(0, loseX, bt, clockSec, 0, 20);
        }

        this.blastLoserWedgeAndShrapnel(
          loseWedge,
          loseFaction,
          loseX,
          bt,
          loseDir,
          0,
          32
        );
        this.poseBurstSparks(new THREE.Vector3(loseX, BASTION_SURFACE_Y, BASTION_Z), bt, 48, 0);

        this.explosionLight.position.set(loseX, 0.75, -0.05);
        this.explosionLight.intensity = Math.max(0, Math.exp(-bt * 6.2) * 3.8);

        // Surviving Victorious Wedge: Absorbs Shockwave Recoil -> Illuminated by Golden Battlefield Flare!
        if (winWedge) {
          const recoil = Math.sin(Math.min(1, bt / 0.22) * Math.PI) * 0.14;
          const heroLift = THREE.MathUtils.smoothstep(bt, 0.18, 0.55) * 0.12;
          winWedge.visible = true;
          winWedge.position.set(
            winX - loseDir * recoil,
            BASTION_SURFACE_Y + heroLift,
            BASTION_Z
          );
          const baseYaw = playerWins ? 0.26 : Math.PI - 0.26;
          winWedge.rotation.set(0, baseYaw, -loseDir * recoil * 0.8);
        }

        const flareIn = THREE.MathUtils.smoothstep(bt, 0.22, 0.62);
        this.winnerSpotLight.position.set(winX - 0.5, 4.4, 0.85);
        this.winnerSpotLight.target.position.set(winX, 0.2, BASTION_Z);
        this.winnerSpotLight.intensity = 8.5 * flareIn;

        this.winnerShaftMesh.visible = flareIn > 0.02;
        this.winnerShaftMesh.position.set(winX, 0.02, BASTION_Z);
        this.winnerShaftMesh.rotation.z = winX < 0 ? 0.15 : -0.15;
        this.winnerShaftMat.uniforms['uOpacity']!.value = 0.52 * flareIn;

        this.renderSpikedCrtOscilloscope(
          verdict.resolution.includes('FLAG') ? 'CROWN' : 'GOLD_WIN',
          clockSec
        );
      }
    }
  }

  private getPrimaryBlastTargetX(res: BattleResolutionKind): number {
    if (res === 'PLAYER_WINS' || res === 'FLAG_CAPTURED_BY_PLAYER') return BASTION_X;
    if (res === 'ENEMY_WINS' || res === 'FLAG_CAPTURED_BY_ENEMY') return -BASTION_X;
    return 0;
  }

  private poseExplosionSite(
    swIndex: number,
    centerX: number,
    bt: number,
    clockSec: number,
    plumeStart: number,
    plumeEnd: number
  ): void {
    // 1. Supersonic Ground Shockwave Ring (`0.0s .. 0.62s`)
    const sw = this.shockwaves[swIndex];
    if (sw && bt >= 0 && bt <= 0.62) {
      sw.mesh.visible = true;
      sw.mesh.position.set(centerX, BASTION_SURFACE_Y + 0.03, BASTION_Z);
      sw.mat.uniforms['uProgress']!.value = bt / 0.62;
    }

    // 2. Multi-Billow Volumetric GLSL Fireball -> Churning Black Gunsmoke (`0.0s .. 1.65s`)
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
    // Blow the defeated wedge upward & backward inside the viewport before shattering into black smoke!
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
        // Bounce once across the cratered battlefield!
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
      const py = Math.max(BASTION_SURFACE_Y + 0.02, origin.y + 0.18 + sp.vel.y * age - 3.75 * age * age);
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

  private renderSpikedCrtOscilloscope(
    mode: 'ARBITRATING' | 'GOLD_WIN' | 'CROWN' | 'FLATLINE',
    clockSec: number
  ): void {
    const ctx = this.crtCtx;
    const w = this.crtCanvas.width;
    const h = this.crtCanvas.height;

    ctx.fillStyle = '#040908';
    ctx.fillRect(0, 0, w, h);

    const hasLiveAudio = this.sound.sampleLiveWaveform(this.waveformSample);
    const grad = ctx.createLinearGradient(16, 0, w - 16, 0);
    if (mode === 'ARBITRATING') {
      grad.addColorStop(0.0, '#ffae2e');
      grad.addColorStop(0.5, '#ffe884');
      grad.addColorStop(1.0, '#ff5848');
    } else {
      grad.addColorStop(0.0, '#ffb02e');
      grad.addColorStop(0.5, '#ffef9c');
      grad.addColorStop(1.0, '#ffb02e');
    }

    const midY = h * 0.5;
    const spikes = 84;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(14, midY);
    ctx.lineTo(w - 14, midY);

    if (mode !== 'FLATLINE') {
      for (let i = 0; i <= spikes; i++) {
        const u = i / spikes;
        const sIdx = Math.floor(u * (this.waveformSample.length - 1));
        const live = hasLiveAudio ? Math.abs(this.waveformSample[sIdx]!) * 2.2 : 0;
        const syn =
          0.25 +
          0.65 * Math.abs(Math.sin(i * 17.3 + clockSec * 32)) * Math.sin(u * Math.PI);
        const hh = Math.min(h * 0.44, Math.max(live, syn) * h * 0.42);
        const x = 14 + u * (w - 28);
        ctx.moveTo(x, midY - hh);
        ctx.lineTo(x, midY + hh);
      }
    }
    ctx.stroke();
    this.crtTexture.needsUpdate = true;
  }

  private verdictToAct3Banner(res: BattleResolutionKind): HudBannerState {
    switch (res) {
      case 'FLAG_CAPTURED_BY_PLAYER':
      case 'FLAG_CAPTURED_BY_ENEMY':
        return 'FLAG CAPTURED — VICTORY';
      case 'MUTUAL_SPLIT':
        return 'MUTUAL ELIMINATION';
      case 'PLAYER_WINS':
      case 'ENEMY_WINS':
        return 'BATTLE WINNER';
    }
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
  }
}
