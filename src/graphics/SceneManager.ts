import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ArbiterStage3D } from '../arbiter/ArbiterStage3D';
import type { SoundDirector } from '../audio/SoundDirector';
import { BOARD_COLS, BOARD_ROWS } from '../core/ranks';
import type {
  AppOptions,
  ArbiterVerdict,
  CameraMode,
  CasualtyView,
  PlayerVisibleView,
  VisiblePieceView,
} from '../core/types';
import type { GameStore } from '../state/GameStore';
import {
  ARBITER_BAY_CENTER_Z,
  GRID_CENTER_Z,
  gridToWorld,
  INSPECT_STAGE_ORIGIN,
  LEFT_WELL_CENTER,
  MeshFactory,
  RIGHT_WELL_CENTER,
  TILE_PITCH,
  type WarRoomEnvironmentRefs,
} from './MeshFactory';
import { createStudioLanternEnvMap } from './ProceduralTextures';
import { TileIndicatorLayer } from './TileIndicatorLayer';
import { createTabletopTiltShiftPass } from './TiltShiftDoFPass';

interface PieceVisualInstance {
  readonly id: string;
  readonly group: THREE.Group;
  renderedKey: string;
  targetPos: THREE.Vector3;
}

/**
 * Full-Viewport Clean-Plate Background Quad (`war_room_backdrop.jpg`, 571x1024):
 * - Preserves exact `object-fit: cover` aspect framing on `412x915` through `9:16`.
 * - Smoothly dims cleanly to `35%` brightness (`uBrightness = 0.35`) during Arbiter clashes!
 */
function createBackdropPlateMesh(): {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
} {
  const loader = new THREE.TextureLoader();
  const tex = loader.load('./textures/war_room_backdrop.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uViewAspect: { value: 412 / 915 },
      uImgAspect: { value: 571 / 1024 },
      uBrightness: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uViewAspect;
      uniform float uImgAspect;
      uniform float uBrightness;
      varying vec2 vUv;

      void main() {
        vec2 uv = vUv;
        if (uViewAspect < uImgAspect) {
          float scale = uViewAspect / uImgAspect;
          uv.x = (uv.x - 0.5) * scale + 0.5;
        } else {
          float scale = uImgAspect / uViewAspect;
          uv.y = (uv.y - 0.5) * scale + 0.5;
        }

        vec4 srgb = texture2D(uMap, uv);
        // Subtle vignette toward extreme corners + pre-exposure scaling for OutputPass ACESFilmic
        float vig = 1.0 - 0.16 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
        vec3 linearCol = pow(srgb.rgb, vec3(2.2)) * uBrightness * vig * 0.82;
        gl_FragColor = vec4(linearCol, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, mat };
}

export class SceneManager {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly factory: MeshFactory;
  public readonly arbiterStage: ArbiterStage3D;

  private readonly host: HTMLElement;
  private readonly store: GameStore;
  private readonly sound: SoundDirector;

  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly tiltShiftPass: ReturnType<typeof createTabletopTiltShiftPass>;
  private readonly backdropMat: THREE.ShaderMaterial;

  private readonly tabletopKeySpot: THREE.SpotLight;
  private readonly slateFrontFill: THREE.DirectionalLight;
  private readonly warmBackRim: THREE.DirectionalLight;
  private readonly ambientFill: THREE.HemisphereLight;
  private readonly arbiterHeroSpot: THREE.SpotLight;
  private readonly warRoom: WarRoomEnvironmentRefs;

  private readonly boardPiecesRoot = new THREE.Group();
  private readonly casualtyPiecesRoot = new THREE.Group();
  private readonly indicatorLayer = new TileIndicatorLayer();
  private readonly raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly pieceVisuals = new Map<string, PieceVisualInstance>();
  private readonly casualtyVisuals = new Map<string, THREE.Group>();

  private cameraMode: CameraMode = 'PLAY';
  private readonly camCurrentPos = new THREE.Vector3(0, 21.5, 11.2);
  private readonly camCurrentLook = new THREE.Vector3(0, -0.2, -0.45);
  private readonly camTargetPos = new THREE.Vector3(0, 21.5, 11.2);
  private readonly camTargetLook = new THREE.Vector3(0, -0.2, -0.45);
  private roomDimFactor = 1.0;
  private targetRoomDimFactor = 1.0;
  private plateBrightness = 1.0;
  private targetPlateBrightness = 1.0;

  private readonly clock = new THREE.Clock();
  private totalElapsed = 0;
  private rafId = 0;
  private resizeObserver: ResizeObserver;

  constructor(host: HTMLElement, store: GameStore, sound: SoundDirector) {
    this.host = host;
    this.store = store;
    this.sound = sound;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Guardrail #3: Enable local clipping (scoped strictly to Arbiter well meshes!)
    this.renderer.localClippingEnabled = true;
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // High-contrast warm RoomEnvironment + lantern HDRI via PMREMGenerator
    this.scene.environment = createStudioLanternEnvMap(this.renderer);

    // Guardrail #1: Clean-plate `war_room_backdrop.jpg` background quad
    const backdrop = createBackdropPlateMesh();
    this.backdropMat = backdrop.mat;
    this.scene.add(backdrop.mesh);

    this.camera = new THREE.PerspectiveCamera(40, 9 / 16, 0.25, 95);
    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);

    // 1. Warm 3200K Overhead Tabletop Key SpotLight (`2048x2048` soft shadows onto ShadowMaterial plane!)
    this.tabletopKeySpot = new THREE.SpotLight(0xffe3be, 2.65, 58, Math.PI / 3.1, 0.58, 0.35);
    this.tabletopKeySpot.position.set(3.2, 21.5, 6.8);
    this.tabletopKeySpot.target.position.set(0, -0.35, -0.45);
    this.tabletopKeySpot.castShadow = true;
    this.tabletopKeySpot.shadow.mapSize.set(2048, 2048);
    this.tabletopKeySpot.shadow.camera.near = 8.0;
    this.tabletopKeySpot.shadow.camera.far = 38.0;
    this.tabletopKeySpot.shadow.bias = -0.00035;
    this.tabletopKeySpot.shadow.normalBias = 0.016;
    this.scene.add(this.tabletopKeySpot, this.tabletopKeySpot.target);

    // 2. Cool-Slate Front Fill Light sculpting the `68 deg` front wedge bevels & 72% metallic reliefs
    this.slateFrontFill = new THREE.DirectionalLight(0xa2c0e2, 0.92);
    this.slateFrontFill.position.set(-2.5, 9.5, 13.5);
    this.scene.add(this.slateFrontFill);

    // 3. Warm Back-Rim Kicker sculpting chamfered slate tile edges, brass collars & wedge top caps
    this.warmBackRim = new THREE.DirectionalLight(0xffb464, 1.05);
    this.warmBackRim.position.set(4.5, 8.5, -12.5);
    this.scene.add(this.warmBackRim);

    this.ambientFill = new THREE.HemisphereLight(0xffebd2, 0x1e2838, 0.48);
    this.scene.add(this.ambientFill);

    // Dedicated warm hero spotlight focused on the Electronic Arbiter during clashes
    this.arbiterHeroSpot = new THREE.SpotLight(0xffe4bc, 0.0, 22, Math.PI / 3.2, 0.65, 1.25);
    this.arbiterHeroSpot.castShadow = false;
    this.arbiterHeroSpot.position.set(0, 7.4, 1.4);
    this.arbiterHeroSpot.target.position.set(0, 0.12, ARBITER_BAY_CENTER_Z + 0.55);
    this.scene.add(this.arbiterHeroSpot, this.arbiterHeroSpot.target);

    this.factory = new MeshFactory();
    this.warRoom = this.factory.createWarRoomEnvironment();
    this.scene.add(this.warRoom.root);
    this.scene.add(this.factory.createBoardCabinetGroup());
    this.scene.add(this.factory.createInspectionGalleryStage());

    this.arbiterStage = new ArbiterStage3D(this.factory, this.sound);
    this.scene.add(this.arbiterStage.root);
    this.scene.add(this.arbiterStage.worldMedallionGroup);

    this.scene.add(this.indicatorLayer.root);
    this.scene.add(this.boardPiecesRoot);
    this.scene.add(this.casualtyPiecesRoot);

    void this.factory.preloadBakedModels().then(() => {
      this.arbiterStage.attachBakedShutterIfReady();
    });

    const initRect = this.host.getBoundingClientRect();
    const w = Math.max(1, initRect.width || 412);
    const h = Math.max(1, initRect.height || 915);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.38, 0.28, 1.58);
    this.composer.addPass(this.bloomPass);

    this.composer.addPass(new OutputPass());

    this.tiltShiftPass = createTabletopTiltShiftPass();
    this.composer.addPass(this.tiltShiftPass);

    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.host);

    this.bindPointerInput();
  }

  public syncFromStore(view: PlayerVisibleView, options: Readonly<AppOptions>): void {
    const maxDpr = options.renderQuality === 'ULTRA' ? 2.5 : 1.5;
    const desiredDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (Math.abs(this.renderer.getPixelRatio() - desiredDpr) > 0.01) {
      this.renderer.setPixelRatio(desiredDpr);
      this.handleResize();
    }
    this.tiltShiftPass.enabled =
      options.renderQuality === 'ULTRA' && view.cameraMode !== 'INSPECT_16';

    this.cameraMode = view.cameraMode;
    this.updateCameraTargets(view.cameraMode);

    // Guardrail #1: Dim `war_room_backdrop.jpg` cleanly to 35% brightness during Arbiter clashes!
    this.targetRoomDimFactor = view.cameraMode === 'ARBITER' ? 0.45 : 1.0;
    this.targetPlateBrightness = view.cameraMode === 'ARBITER' ? 0.35 : 1.0;

    this.boardPiecesRoot.visible = view.cameraMode !== 'ARBITER';
    const activeIds = new Set<string>();
    const clashingIds = new Set<string>();
    if (view.activeClash) {
      clashingIds.add(view.activeClash.attackerId);
      clashingIds.add(view.activeClash.defenderId);
    }

    for (const p of view.pieces) {
      activeIds.add(p.id);
      const inst = this.getOrCreatePieceVisual(p);
      inst.targetPos.copy(gridToWorld(p.col, p.row));
      inst.group.visible = !clashingIds.has(p.id);
    }

    for (const [id, inst] of this.pieceVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.boardPiecesRoot.remove(inst.group);
        this.pieceVisuals.delete(id);
      }
    }

    this.syncCasualties(view.playerCasualties, 'LEFT');
    this.syncCasualties(view.enemyCasualties, 'RIGHT');

    const selectedPiece = view.selectedPieceId
      ? view.pieces.find((p) => p.id === view.selectedPieceId)
      : undefined;
    this.indicatorLayer.sync(
      selectedPiece ? { col: selectedPiece.col, row: selectedPiece.row } : null,
      view.validMoves,
      view.cameraMode === 'PLAY' && !view.activeClash
    );
  }

  public triggerArbiterSequence(verdict: ArbiterVerdict): void {
    const playerVisual = this.pieceVisuals.get(verdict.playerPieceId);
    const enemyVisual = this.pieceVisuals.get(verdict.enemyPieceId);

    const pOrigin = playerVisual ? playerVisual.group.position.clone() : gridToWorld(4, 4);
    const eOrigin = enemyVisual
      ? enemyVisual.group.position.clone()
      : gridToWorld(verdict.contestedCoord.col, verdict.contestedCoord.row);

    const speed = this.store.getOptions().arbiterSpeed === '1.75x' ? 1.75 : 1.0;

    this.arbiterStage.startBattleSequence(
      verdict,
      pOrigin,
      eOrigin,
      speed,
      (banner) => this.store.setArbiterBanner(banner),
      () => this.store.finalizeActiveClash()
    );

    const ceremonialSq = gridToWorld(4, 0);
    this.arbiterStage.worldMedallionGroup.position.set(ceremonialSq.x, 0, ceremonialSq.z);
    this.updateCameraTargets('ARBITER');
  }

  public snapCameraImmediately(): void {
    this.camCurrentPos.copy(this.camTargetPos);
    this.camCurrentLook.copy(this.camTargetLook);
    this.roomDimFactor = this.targetRoomDimFactor;
    this.plateBrightness = this.targetPlateBrightness;
    this.applyLightingAndCamera();
  }

  public startLoop(): void {
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.totalElapsed += dt;
      this.stepFrame(dt, this.totalElapsed);
    };
    this.clock.start();
    tick();
  }

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  private stepFrame(dt: number, elapsed: number): void {
    const flickerL =
      1.0 + 0.08 * Math.sin(elapsed * 7.1) + 0.05 * Math.sin(elapsed * 17.3 + 1.2);
    const flickerR =
      1.0 + 0.07 * Math.cos(elapsed * 6.3 + 0.7) + 0.05 * Math.sin(elapsed * 14.9);
    this.warRoom.lanternLightLeft.intensity = 6.5 * flickerL * this.roomDimFactor;
    this.warRoom.lanternLightRight.intensity = 5.8 * flickerR * this.roomDimFactor;

    const damp = 1 - Math.exp(-dt * 7.0);
    this.roomDimFactor = THREE.MathUtils.lerp(this.roomDimFactor, this.targetRoomDimFactor, damp);
    this.plateBrightness = THREE.MathUtils.lerp(
      this.plateBrightness,
      this.targetPlateBrightness,
      damp
    );

    this.arbiterStage.update(dt, elapsed);
    this.indicatorLayer.update(elapsed);

    const pieceSlide = 1 - Math.exp(-dt * 14.0);
    for (const inst of this.pieceVisuals.values()) {
      inst.group.position.lerp(inst.targetPos, pieceSlide);
    }

    const speed = this.cameraMode === 'INSPECT_16' ? 14.0 : 8.5;
    const camDamp = 1 - Math.exp(-dt * speed);
    this.camCurrentPos.lerp(this.camTargetPos, camDamp);
    this.camCurrentLook.lerp(this.camTargetLook, camDamp);

    this.applyLightingAndCamera();
    this.composer.render();
  }

  private applyLightingAndCamera(): void {
    this.tabletopKeySpot.intensity = 1.65 * this.roomDimFactor;
    this.slateFrontFill.intensity = 0.55 * this.roomDimFactor;
    this.warmBackRim.intensity = 0.65 * this.roomDimFactor;
    this.ambientFill.intensity = 0.36 * this.roomDimFactor;
    this.arbiterHeroSpot.intensity = (1 - this.roomDimFactor) * 4.2;
    this.backdropMat.uniforms['uBrightness']!.value = this.plateBrightness;

    const shake = this.arbiterStage.getCameraShakeOffset();
    this.camera.position.copy(this.camCurrentPos).add(shake);
    this.camera.lookAt(this.camCurrentLook);
  }

  /**
   * Analytical Viewport Framing:
   * In `PLAY` mode, solves exact camera distance `R` from viewport `aspect` so the oiled walnut
   * board (`width = 10.56`) spans **93.5% of viewport width** (`92%–95%`) and **63%–67% of 9:16 height**
   * dead-center horizontally with zero wasted dead space!
   */
  private updateCameraTargets(mode: CameraMode): void {
    const rect = this.host.getBoundingClientRect();
    const aspect = Math.max(0.38, (rect.width || 412) / Math.max(1, rect.height || 915));

    if (mode === 'ARBITER') {
      const fov = aspect < 0.52 ? THREE.MathUtils.clamp(54 * (0.48 / aspect), 53, 59) : 50;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetPos.set(0, 4.75, 2.3);
      this.camTargetLook.set(0, 0.14, ARBITER_BAY_CENTER_Z + 0.32);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.03, 0.78);
    } else if (mode === 'INSPECT_16') {
      const fov = aspect < 0.52 ? THREE.MathUtils.clamp(47 * (0.48 / aspect), 47, 52) : 44;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetPos.set(INSPECT_STAGE_ORIGIN.x, 12.2, INSPECT_STAGE_ORIGIN.z + 5.7);
      this.camTargetLook.set(INSPECT_STAGE_ORIGIN.x, 0.1, INSPECT_STAGE_ORIGIN.z - 0.35);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.02, 0.98);
    } else {
      // Analytical `93.5%` horizontal width solver (`92%–95%` target!):
      const fovDeg = 40;
      this.camera.fov = fovDeg;
      this.camera.updateProjectionMatrix();

      const halfFovRad = THREE.MathUtils.degToRad(fovDeg * 0.5);
      const pitchRad = THREE.MathUtils.degToRad(62.5);
      const targetWidthOccupancy = 0.935; // 93.5% of viewport width!
      const boardOuterWidth = 10.56;
      const frontViewWidth = boardOuterWidth / targetWidthOccupancy;

      // Distance to front widest edge (`z = +5.55` vs lookAt `z = -0.35`, deltaZ = 5.90)
      const rFront = frontViewWidth / (2 * Math.tan(halfFovRad) * aspect);
      const rCenter = rFront + 5.9 * Math.cos(pitchRad);

      const lookY = -0.22;
      const lookZ = -0.35;
      this.camTargetLook.set(0, lookY, lookZ);
      this.camTargetPos.set(
        0,
        lookY + rCenter * Math.sin(pitchRad),
        lookZ + rCenter * Math.cos(pitchRad)
      );
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.05, 0.84);
    }
  }

  private getOrCreatePieceVisual(p: VisiblePieceView): PieceVisualInstance {
    const key = `${p.faction}:${p.visibleRank}`;
    const existing = this.pieceVisuals.get(p.id);
    if (existing && existing.renderedKey === key) {
      return existing;
    }
    if (existing) {
      this.boardPiecesRoot.remove(existing.group);
    }

    const group = this.factory.createCommandWedge(p.faction, p.visibleRank);
    group.userData['pieceId'] = p.id;
    const worldPos = gridToWorld(p.col, p.row);
    group.position.copy(worldPos);
    this.boardPiecesRoot.add(group);

    const inst: PieceVisualInstance = {
      id: p.id,
      group,
      renderedKey: key,
      targetPos: worldPos.clone(),
    };
    this.pieceVisuals.set(p.id, inst);
    return inst;
  }

  private syncCasualties(list: readonly CasualtyView[], side: 'LEFT' | 'RIGHT'): void {
    const wellCenter = side === 'LEFT' ? LEFT_WELL_CENTER : RIGHT_WELL_CENTER;
    for (const item of list) {
      const key = `${side}:${item.id}`;
      if (this.casualtyVisuals.has(key)) continue;

      const wedge = this.factory.createCommandWedge(item.faction, item.visibleRank);
      wedge.scale.setScalar(0.76);

      const idx = item.casualtyIndex;
      const col = idx % 2;
      const row = Math.floor(idx / 2) % 3;
      const layer = Math.floor(idx / 6);

      const ox = (col - 0.5) * 0.52 + Math.sin(idx * 2.3) * 0.05;
      const oz = (row - 1) * 0.58 + Math.cos(idx * 1.9) * 0.05;
      const oy = 0.09 + layer * 0.22;

      wedge.position.set(wellCenter.x + ox, wellCenter.y + oy, wellCenter.z + oz);
      if (item.faction === 'ENEMY') {
        wedge.rotation.set(Math.PI / 2 - 0.35, Math.sin(idx * 1.7) * 0.4, 0.12);
      } else {
        wedge.rotation.set(-Math.PI / 2 + 0.42, Math.cos(idx * 1.3) * 0.35, -0.1);
      }

      this.casualtyPiecesRoot.add(wedge);
      this.casualtyVisuals.set(key, wedge);
    }

    if (list.length === 0) {
      for (const [key, mesh] of Array.from(this.casualtyVisuals.entries())) {
        if (key.startsWith(`${side}:`)) {
          this.casualtyPiecesRoot.remove(mesh);
          this.casualtyVisuals.delete(key);
        }
      }
    }
  }

  private bindPointerInput(): void {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();

    this.renderer.domElement.addEventListener('pointerdown', (ev: PointerEvent) => {
      this.sound.unlock();
      if (this.arbiterStage.isBusy || this.cameraMode !== 'PLAY') return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(ndc, this.camera);

      const hits = raycaster.intersectObjects(this.boardPiecesRoot.children, true);
      let hitPieceId: string | null = null;
      if (hits.length > 0) {
        let cur: THREE.Object3D | null = hits[0]!.object;
        while (cur) {
          if (typeof cur.userData['pieceId'] === 'string') {
            hitPieceId = cur.userData['pieceId'];
            break;
          }
          cur = cur.parent;
        }
      }

      if (raycaster.ray.intersectPlane(this.raycastPlane, hitPoint)) {
        const col = Math.round(hitPoint.x / TILE_PITCH + (BOARD_COLS - 1) / 2);
        const row = Math.round((hitPoint.z - GRID_CENTER_Z) / TILE_PITCH + (BOARD_ROWS - 1) / 2);

        if (col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS) {
          const outcome = this.store.executeMoveOrChallenge(col, row);
          if (outcome) {
            if (outcome.kind === 'MOVED') {
              this.sound.playMoveSlide();
            } else {
              this.triggerArbiterSequence(outcome.verdict);
            }
            return;
          }

          const view = this.store.getVisibleView();
          const tilePlayerPiece = view.pieces.find(
            (p) => p.faction === 'PLAYER' && p.col === col && p.row === row
          );
          const chosenId = tilePlayerPiece?.id ?? hitPieceId;
          if (chosenId) {
            this.sound.playSelect();
            this.store.selectPiece(chosenId);
            return;
          }
        }
      }

      if (hitPieceId) {
        this.sound.playSelect();
        this.store.selectPiece(hitPieceId);
      } else {
        this.store.selectPiece(null);
      }
    });
  }

  private handleResize(): void {
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));

    this.camera.aspect = w / h;
    this.backdropMat.uniforms['uViewAspect']!.value = w / h;
    this.updateCameraTargets(this.cameraMode);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);

    const dpr = this.renderer.getPixelRatio();
    (this.tiltShiftPass.uniforms['uResolution']!.value as THREE.Vector2).set(w * dpr, h * dpr);
  }
}
