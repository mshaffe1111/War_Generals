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
  BoardViewAngle,
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

  private readonly keyShadowLight: THREE.DirectionalLight;
  private readonly insigniaCatchLight: THREE.DirectionalLight;
  private readonly selectedPieceLight: THREE.PointLight;
  private readonly rimShadowSpot: THREE.SpotLight;
  private readonly ambientFill: THREE.HemisphereLight;
  private readonly arbiterHeroSpot: THREE.SpotLight;
  private readonly warRoom: WarRoomEnvironmentRefs;

  private readonly boardPiecesRoot = new THREE.Group();
  private readonly onBoardInspectGroup: THREE.Group;
  private readonly casualtyPiecesRoot = new THREE.Group();
  private readonly indicatorLayer = new TileIndicatorLayer();
  private readonly raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly pieceVisuals = new Map<string, PieceVisualInstance>();
  private readonly casualtyVisuals = new Map<string, THREE.Group>();

  private cameraMode: CameraMode = 'PLAY';
  private boardView: BoardViewAngle = 'COMMAND';
  private selectedPieceId: string | null = null;
  private userPitchDeltaDeg = 0;

  private readonly camCurrentPos = new THREE.Vector3(0, 12.5, 16.5);
  private readonly camCurrentLook = new THREE.Vector3(0, 0.15, -0.55);
  private readonly camTargetPos = new THREE.Vector3(0, 12.5, 16.5);
  private readonly camTargetLook = new THREE.Vector3(0, 0.15, -0.55);
  private roomDimFactor = 1.0;
  private targetRoomDimFactor = 1.0;

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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#06080c');
    this.scene.fog = new THREE.FogExp2('#07090e', 0.012);

    this.scene.environment = createStudioLanternEnvMap(this.renderer);

    this.camera = new THREE.PerspectiveCamera(48, 9 / 16, 0.25, 95);
    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);

    // PURE SHADOW-DRIVEN CHIAROSCURO LIGHTING (Zero unshadowed overhead wash lights!):
    // 1. Primary `4096x4096` Raking Warm Key DirectionalLight (`~34 deg` grazing elevation):
    //    Because non-shadowed ambient/fill is kept near zero (`0.06`), EVERY piece, brass plinth,
    //    escutcheon frame, raised walnut rail, and table prop casts DEEP, VELVETY 3D SHADOWS!
    this.keyShadowLight = new THREE.DirectionalLight(0xffe0b5, 3.25);
    this.keyShadowLight.position.set(-9.2, 6.8, 5.2);
    this.keyShadowLight.target.position.set(0.4, -0.2, -0.6);
    this.keyShadowLight.castShadow = true;
    this.keyShadowLight.shadow.mapSize.set(4096, 4096);
    this.keyShadowLight.shadow.camera.left = -8.4;
    this.keyShadowLight.shadow.camera.right = 8.6;
    this.keyShadowLight.shadow.camera.top = 9.4;
    this.keyShadowLight.shadow.camera.bottom = -8.8;
    this.keyShadowLight.shadow.camera.near = 1.5;
    this.keyShadowLight.shadow.camera.far = 32.0;
    this.keyShadowLight.shadow.bias = -0.0002;
    this.keyShadowLight.shadow.normalBias = 0.008;
    this.keyShadowLight.shadow.radius = 1.8;
    this.scene.add(this.keyShadowLight, this.keyShadowLight.target);

    // 2. Secondary Shadow-Casting Cool-Amber Rim SpotLight (`2048x2048` real shadows!) from Rear-Right:
    //    Sculpts the armored louvers & shoulders of the Enemy Crimson Monoliths without erasing key shadows!
    this.rimShadowSpot = new THREE.SpotLight(0xffb86b, 4.2, 42, Math.PI / 3.2, 0.72, 0.85);
    this.rimShadowSpot.position.set(8.5, 8.2, -10.5);
    this.rimShadowSpot.target.position.set(0, -0.1, 0.5);
    this.rimShadowSpot.castShadow = true;
    this.rimShadowSpot.shadow.mapSize.set(2048, 2048);
    this.rimShadowSpot.shadow.bias = -0.0003;
    this.rimShadowSpot.shadow.normalBias = 0.01;
    this.scene.add(this.rimShadowSpot, this.rimShadowSpot.target);

    // 3. Dedicated Low-Elevation Front Grazing Insignia Catch-Light (`17 deg` above horizontal!):
    //    Hits `68 deg` sloped front rank reliefs at `96%` normal alignment so EVERY rank emblem gleams brightly
    //    anywhere on the board, while barely touching horizontal floor shadows (`sin(17 deg) = 0.29`)!
    this.insigniaCatchLight = new THREE.DirectionalLight(0xfff0d6, 0.88);
    this.insigniaCatchLight.position.set(1.6, 4.4, 14.5);
    this.insigniaCatchLight.target.position.set(0, 0.35, 0.8);
    this.scene.add(this.insigniaCatchLight, this.insigniaCatchLight.target);

    // 4. Dynamic Tracking Hero Spotlight over the Selected / Moving Piece!
    this.selectedPieceLight = new THREE.PointLight(0xffe6b0, 0.0, 2.05, 2.0);
    this.scene.add(this.selectedPieceLight);

    // Restrained `0.09` ambient floor so cast shadows stay dark, rich, and dimensional!
    this.ambientFill = new THREE.HemisphereLight(0xd8e4f8, 0x05070c, 0.09);
    this.scene.add(this.ambientFill);

    this.arbiterHeroSpot = new THREE.SpotLight(0xffe0b2, 0.0, 18, Math.PI / 3.4, 0.78, 1.25);
    this.arbiterHeroSpot.castShadow = false;
    this.arbiterHeroSpot.position.set(-1.5, 5.8, 1.0);
    this.arbiterHeroSpot.target.position.set(0, -0.1, ARBITER_BAY_CENTER_Z + 0.1);
    this.scene.add(this.arbiterHeroSpot, this.arbiterHeroSpot.target);

    this.factory = new MeshFactory();
    this.warRoom = this.factory.createWarRoomEnvironment();
    this.scene.add(this.warRoom.root);
    this.scene.add(this.factory.createBoardCabinetGroup());

    this.onBoardInspectGroup = this.factory.createOnBoardInspectionGroup();
    this.scene.add(this.onBoardInspectGroup);

    this.arbiterStage = new ArbiterStage3D(this.factory, this.sound);
    this.scene.add(this.arbiterStage.root);
    this.scene.add(this.arbiterStage.worldMedallionGroup);

    this.scene.add(this.indicatorLayer.root);
    this.scene.add(this.boardPiecesRoot);
    this.scene.add(this.casualtyPiecesRoot);

    void this.factory.preloadBakedModels().then((parts) => {
      this.arbiterStage.applyBakedHardwareParts(parts);
    });

    const initRect = this.host.getBoundingClientRect();
    const w = Math.max(1, initRect.width || 412);
    const h = Math.max(1, initRect.height || 915);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.25, 2.22);
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

    if (this.boardView !== options.boardView) {
      this.boardView = options.boardView;
      this.userPitchDeltaDeg = 0;
    }

    this.selectedPieceId = view.selectedPieceId;
    this.cameraMode = view.cameraMode;
    this.updateCameraTargets(view.cameraMode);
    this.targetRoomDimFactor = view.cameraMode === 'ARBITER' ? 0.62 : 1.0;

    // On-Board `16-Rank Gallery` hides play pieces cleanly and displays the 4-angle turnaround + 16 reliefs
    // right on the shadowed Walnut & Slate Board!
    this.onBoardInspectGroup.visible = view.cameraMode === 'INSPECT_16';
    this.boardPiecesRoot.visible = view.cameraMode === 'PLAY';
    this.casualtyPiecesRoot.visible = view.cameraMode !== 'INSPECT_16';

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

  public updateCameraForCurrentState(): void {
    this.updateCameraTargets(this.cameraMode);
  }

  public snapCameraImmediately(): void {
    this.updateCameraTargets(this.cameraMode);
    this.camCurrentPos.copy(this.camTargetPos);
    this.camCurrentLook.copy(this.camTargetLook);
    this.roomDimFactor = this.targetRoomDimFactor;
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
    const discreteSec = Math.floor(elapsed);
    const tickFrac = Math.min(1, (elapsed - discreteSec) * 8);
    this.warRoom.watchSecondHand.rotation.y = -((discreteSec + tickFrac) / 60) * Math.PI * 2;

    const flickerL =
      1.0 + 0.09 * Math.sin(elapsed * 7.4) + 0.06 * Math.sin(elapsed * 18.1 + 1.2);
    const flickerR =
      1.0 + 0.07 * Math.cos(elapsed * 6.3 + 0.7) + 0.05 * Math.sin(elapsed * 14.9);
    this.warRoom.tableLanternShadowLight.intensity =
      7.5 * flickerL * (0.76 + 0.24 * this.roomDimFactor);
    this.warRoom.lanternLightRight.intensity =
      3.8 * flickerR * (0.72 + 0.28 * this.roomDimFactor);
    this.warRoom.lanternFlameMat.color.setRGB(
      2.6 * flickerL,
      1.65 * flickerL,
      0.52 * flickerL
    );

    this.arbiterStage.update(dt, elapsed);
    this.indicatorLayer.update(elapsed);

    // Tactile hover levitation + tracking Hero Spotlight on the selected/moving Command Monolith!
    const pieceSlide = 1 - Math.exp(-dt * 14.0);
    let foundSelPos: THREE.Vector3 | null = null;
    for (const inst of this.pieceVisuals.values()) {
      const isSel = inst.id === this.selectedPieceId && this.cameraMode === 'PLAY';
      const hoverY = isSel ? 0.11 + 0.025 * Math.sin(elapsed * 4.2) : 0.0;
      inst.group.position.x = THREE.MathUtils.lerp(inst.group.position.x, inst.targetPos.x, pieceSlide);
      inst.group.position.z = THREE.MathUtils.lerp(inst.group.position.z, inst.targetPos.z, pieceSlide);
      inst.group.position.y = THREE.MathUtils.lerp(inst.group.position.y, hoverY, pieceSlide);
      if (isSel) {
        foundSelPos = inst.group.position;
      }
    }

    if (foundSelPos) {
      this.selectedPieceLight.position.set(foundSelPos.x, foundSelPos.y + 1.15, foundSelPos.z + 0.36);
      this.selectedPieceLight.intensity = 1.45;
    } else {
      this.selectedPieceLight.intensity = THREE.MathUtils.lerp(this.selectedPieceLight.intensity, 0, pieceSlide);
    }

    let desiredCamSpeed = this.cameraMode === 'INSPECT_16' ? 12.0 : 8.5;
    if (this.cameraMode === 'ARBITER') {
      const rect = this.host.getBoundingClientRect();
      const aspect = Math.max(0.38, (rect.width || 412) / Math.max(1, rect.height || 915));
      const shot = this.arbiterStage.getBattleCameraPose(aspect >= 0.88, aspect);
      this.camTargetPos.copy(shot.pos);
      this.camTargetLook.copy(shot.look);
      if (Math.abs(this.camera.fov - shot.fov) > 0.05) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, shot.fov, 1 - Math.exp(-dt * 12));
        this.camera.updateProjectionMatrix();
      }
      this.targetRoomDimFactor = shot.roomDim;
      this.arbiterHeroSpot.color.setHex(shot.redAlertGlow > 0.8 ? 0xff6e54 : 0xffe0b2);
      desiredCamSpeed = shot.dampSpeed;
    } else {
      this.arbiterHeroSpot.color.setHex(0xffe0b2);
    }

    const damp = 1 - Math.exp(-dt * 9.5);
    this.roomDimFactor = THREE.MathUtils.lerp(this.roomDimFactor, this.targetRoomDimFactor, damp);

    const camDamp = 1 - Math.exp(-dt * desiredCamSpeed);
    this.camCurrentPos.lerp(this.camTargetPos, camDamp);
    this.camCurrentLook.lerp(this.camTargetLook, camDamp);

    this.applyLightingAndCamera();
    this.composer.render();
  }

  private applyLightingAndCamera(): void {
    this.keyShadowLight.intensity = THREE.MathUtils.lerp(2.15, 3.25, this.roomDimFactor);
    this.insigniaCatchLight.intensity = THREE.MathUtils.lerp(0.55, 0.92, this.roomDimFactor);
    this.rimShadowSpot.intensity = 4.2 * this.roomDimFactor;
    this.ambientFill.intensity = THREE.MathUtils.lerp(0.06, 0.09, this.roomDimFactor);
    this.arbiterHeroSpot.intensity = (1 - this.roomDimFactor) * 2.1;

    const tentBright = THREE.MathUtils.lerp(0.68, 0.85, this.roomDimFactor);
    this.warRoom.tentBackdropMat.color.setRGB(tentBright, tentBright * 0.95, tentBright * 0.9);

    const shake = this.arbiterStage.getCameraShakeOffset();
    this.camera.position.copy(this.camCurrentPos).add(shake);
    this.camera.lookAt(this.camCurrentLook);

    const dx = this.camCurrentLook.x - this.camCurrentPos.x;
    const dy = this.camCurrentLook.y - this.camCurrentPos.y;
    const dz = this.camCurrentLook.z - this.camCurrentPos.z;
    const pitchCenter = Math.atan2(dy, Math.hypot(dx, dz));
    const upperRayAngle = pitchCenter + THREE.MathUtils.degToRad(this.camera.fov * 0.5 * 0.68);
    const distToCycZ = Math.max(4.0, this.camCurrentPos.z - -11.4);
    const yAtUpper = this.camCurrentPos.y + Math.tan(upperRayAngle) * distToCycZ;
    // Clamp <= 3.75 so the bottom of the 11.2-tall tent cyclorama ALWAYS meets the rear command table horizon (`y = -0.68`) with zero black sky gap!
    this.warRoom.tentBackdropMesh.position.y = THREE.MathUtils.clamp(yAtUpper - 1.4, 2.5, 3.75);
  }

  private updateCameraTargets(mode: CameraMode): void {
    const rect = this.host.getBoundingClientRect();
    const aspect = Math.max(0.38, (rect.width || 412) / Math.max(1, rect.height || 915));
    const isLandscape = aspect >= 0.88;

    if (mode === 'ARBITER') {
      const shot = this.arbiterStage.getBattleCameraPose(isLandscape, aspect);
      this.camera.fov = shot.fov;
      this.camera.updateProjectionMatrix();
      this.camTargetPos.copy(shot.pos);
      this.camTargetLook.copy(shot.look);
      this.targetRoomDimFactor = shot.roomDim;
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.04, 0.86);
    } else if (mode === 'INSPECT_16') {
      const fov = isLandscape ? 34 : aspect < 0.52 ? 42 : 38;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetLook.set(-0.5, 0.22, isLandscape ? 0.25 : 0.65);
      this.camTargetPos.set(-0.5, isLandscape ? 9.4 : 8.6, isLandscape ? 9.2 : 8.95);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.02, 0.98);
    } else if (isLandscape) {
      // FULL-BLEED ANAMORPHIC MOBILE LANDSCAPE FRAMING (`e.g. 915x412` / `844x390`):
      // Height-locks the Walnut & Brass Console to ~81% of vertical height dead-center while naturally
      // showcasing the 3D brass hurricane oil lantern & crate on the left wing and pocket watch & scrolls on the right!
      const landscapePresets: Record<
        BoardViewAngle,
        { pitchDeg: number; fovDeg: number; heightOcc: number; lookZ: number }
      > = {
        COMMAND: { pitchDeg: 43.0, fovDeg: 38, heightOcc: 0.82, lookZ: -0.25 },
        TACTICAL: { pitchDeg: 32.5, fovDeg: 38, heightOcc: 0.8, lookZ: 0.05 },
        OVERHEAD: { pitchDeg: 62.0, fovDeg: 36, heightOcc: 0.83, lookZ: -0.45 },
      };
      const lSpec = landscapePresets[this.boardView];
      const finalPitchDeg = THREE.MathUtils.clamp(
        lSpec.pitchDeg + this.userPitchDeltaDeg,
        24.0,
        70.0
      );
      this.camera.fov = lSpec.fovDeg;
      this.camera.updateProjectionMatrix();

      const halfFovRad = THREE.MathUtils.degToRad(lSpec.fovDeg * 0.5);
      const pitchRad = THREE.MathUtils.degToRad(finalPitchDeg);
      const projBoardH = 12.36 * Math.sin(pitchRad) + 1.05 * Math.cos(pitchRad);
      const rHeight = projBoardH / lSpec.heightOcc / (2 * Math.tan(halfFovRad));
      const rWidth = 11.2 / (2 * Math.tan(halfFovRad) * aspect);
      const rDist = Math.max(rHeight, rWidth);

      const lookY = -0.12;
      this.camTargetLook.set(0, lookY, lSpec.lookZ);
      this.camTargetPos.set(
        0,
        lookY + rDist * Math.sin(pitchRad),
        lSpec.lookZ + rDist * Math.cos(pitchRad)
      );
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.04, 0.92);
    } else {
      // ZERO-WASTED-SPACE ORTHONORMAL BOTTOM-RAIL ANCHOR LOCK (Mobile Portrait `9:16`):
      // Mathematically locks the front walnut cabinet lip (`P_front = (0, -0.55, 5.65)`) to `ndcY = -0.78`
      // (kissing right above the bottom Dynamic Island capsule with ZERO dead space below the board!)
      // while locking the walnut bolster rail (`width = 10.18`) to `97.5%` of viewport width!
      const presetSpec: Record<
        BoardViewAngle,
        { pitchDeg: number; fovDeg: number; widthOcc: number; frontNdcY: number }
      > = {
        COMMAND: { pitchDeg: 40.0, fovDeg: 43, widthOcc: 0.98, frontNdcY: -0.75 },
        TACTICAL: { pitchDeg: 32.5, fovDeg: 46, widthOcc: 0.98, frontNdcY: -0.77 },
        OVERHEAD: { pitchDeg: 62.0, fovDeg: 41, widthOcc: 0.965, frontNdcY: -0.79 },
      };

      const spec = presetSpec[this.boardView];
      const finalPitchDeg = THREE.MathUtils.clamp(
        spec.pitchDeg + this.userPitchDeltaDeg,
        24.0,
        70.0
      );
      this.camera.fov = spec.fovDeg;
      this.camera.updateProjectionMatrix();

      const halfFovRad = THREE.MathUtils.degToRad(spec.fovDeg * 0.5);
      const pitchRad = THREE.MathUtils.degToRad(finalPitchDeg);
      const bolsterWidth = 10.18;

      const zEyeFront =
        bolsterWidth / spec.widthOcc / (2 * Math.tan(halfFovRad) * aspect);
      const yEyeFront = spec.frontNdcY * zEyeFront * Math.tan(halfFovRad);

      // Camera basis in YZ plane: fwd = (0, -sin(p), -cos(p)), up = (0, cos(p), -sin(p))
      const sinP = Math.sin(pitchRad);
      const cosP = Math.cos(pitchRad);
      const frontY = -0.55;
      const frontZ = 5.65;

      const camY = frontY - (zEyeFront * -sinP + yEyeFront * cosP);
      const camZ = frontZ - (zEyeFront * -cosP + yEyeFront * -sinP);

      this.camTargetPos.set(0, camY, camZ);
      this.camTargetLook.set(0, camY - sinP * zEyeFront, camZ - cosP * zEyeFront);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.04, 0.9);
    }
  }

  private getOrCreatePieceVisual(p: VisiblePieceView): PieceVisualInstance {
    const key = `${p.faction}:${p.visibleRank}:k${p.publicKills}`;
    const existing = this.pieceVisuals.get(p.id);
    if (existing && existing.renderedKey === key) {
      return existing;
    }
    const prevPos = existing ? existing.group.position.clone() : gridToWorld(p.col, p.row);
    if (existing) {
      this.boardPiecesRoot.remove(existing.group);
    }

    const group = this.factory.createCommandWedge(p.faction, p.visibleRank, p.publicKills);
    group.userData['pieceId'] = p.id;
    group.position.copy(prevPos);
    this.boardPiecesRoot.add(group);

    const inst: PieceVisualInstance = {
      id: p.id,
      group,
      renderedKey: key,
      targetPos: gridToWorld(p.col, p.row),
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
      wedge.scale.setScalar(0.64);

      const idx = item.casualtyIndex;
      const col = idx % 2;
      const row = Math.floor(idx / 2) % 3;
      const layer = Math.floor(idx / 6);

      const ox = (col - 0.5) * 0.44;
      const oz = (row - 1) * 0.52;
      const oy = -0.29 + layer * 0.24;

      wedge.position.set(wellCenter.x + ox, oy, wellCenter.z + oz);
      const baseYaw = item.faction === 'ENEMY' ? Math.PI : 0;
      wedge.rotation.set(
        Math.sin(idx * 1.7) * 0.08,
        baseYaw + Math.cos(idx * 2.1) * 0.24,
        col === 0 ? 0.09 : -0.09
      );

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

    let pointerIdDown: number | null = null;
    let downX = 0;
    let downY = 0;
    let startPitchDelta = 0;
    let draggedCamera = false;

    this.renderer.domElement.addEventListener('pointerdown', (ev: PointerEvent) => {
      this.sound.unlock();
      if (this.arbiterStage.isBusy) {
        // Diegetic Press-and-Hold Overdrive (`2.15x` fast-march during routine skirmishes!)
        this.arbiterStage.setOverdriveHeld(true);
        return;
      }
      if (this.cameraMode !== 'PLAY') return;
      pointerIdDown = ev.pointerId;
      downX = ev.clientX;
      downY = ev.clientY;
      startPitchDelta = this.userPitchDeltaDeg;
      draggedCamera = false;
    });

    this.renderer.domElement.addEventListener('pointermove', (ev: PointerEvent) => {
      if (pointerIdDown !== ev.pointerId || this.arbiterStage.isBusy || this.cameraMode !== 'PLAY') {
        return;
      }
      const dy = ev.clientY - downY;
      const dx = ev.clientX - downX;
      if (!draggedCamera && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        draggedCamera = true;
      }
      if (draggedCamera) {
        this.userPitchDeltaDeg = THREE.MathUtils.clamp(startPitchDelta + dy * 0.12, -10, 32);
        this.updateCameraTargets('PLAY');
      }
    });

    const clearPointer = (ev: PointerEvent) => {
      this.arbiterStage.setOverdriveHeld(false);
      if (pointerIdDown !== ev.pointerId) return;
      const wasDrag = draggedCamera;
      pointerIdDown = null;
      draggedCamera = false;
      if (wasDrag || this.arbiterStage.isBusy || this.cameraMode !== 'PLAY') return;

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
              const movedPiece = this.store
                .getVisibleView()
                .pieces.find((p) => p.col === col && p.row === row);
              this.sound.playMoveSlide(movedPiece?.publicKills ?? 0);
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
    };

    this.renderer.domElement.addEventListener('pointerup', clearPointer);
    this.renderer.domElement.addEventListener('pointercancel', () => {
      this.arbiterStage.setOverdriveHeld(false);
      pointerIdDown = null;
      draggedCamera = false;
    });
  }

  private handleResize(): void {
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));

    this.camera.aspect = w / h;
    this.updateCameraTargets(this.cameraMode);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);

    const dpr = this.renderer.getPixelRatio();
    (this.tiltShiftPass.uniforms['uResolution']!.value as THREE.Vector2).set(w * dpr, h * dpr);
  }
}
