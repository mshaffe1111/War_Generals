import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ArbiterStage3D } from '../arbiter/ArbiterStage3D';
import type { SoundDirector } from '../audio/SoundDirector';
import { BOARD_COLS, BOARD_ROWS, ORDERED_RANKS, type Faction, type RankId } from '../core/ranks';
import { isFactionHomeSquare } from '../core/RulesEngine';
import { getBattleTheater } from '../core/theaters';
import type {
  AppOptions,
  ArbiterVerdict,
  BattleTheaterSpec,
  BoardViewAngle,
  CameraMode,
  CasualtyView,
  FieldManualEntry,
  MatchPhase,
  MoveDirection,
  PlayerVisibleView,
  QualitySnapshot,
  QualityTier,
  ReplayPlyEntry,
  TheaterId,
  ValidMoveTarget,
  ViewportFrameMode,
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
import { QualityGovernor } from './QualityGovernor';
import { TileIndicatorLayer } from './TileIndicatorLayer';
import { createTabletopTiltShiftPass } from './TiltShiftDoFPass';

interface PieceVisualInstance {
  readonly id: string;
  readonly group: THREE.Group;
  renderedKey: string;
  targetPos: THREE.Vector3;
}

interface ActiveHologramDrag {
  readonly mode: 'CRATE_DEPLOY' | 'BOARD_DEPLOY' | 'BOARD_PLAY';
  readonly rank: RankId;
  readonly sourcePieceId?: string;
  readonly ghostGroup: THREE.Group;
  hoverCoord: { col: number; row: number } | null;
}

export class SceneManager {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly factory: MeshFactory;
  public readonly arbiterStage: ArbiterStage3D;

  public onOpenSuspectWheel?: (pieceId: string, clientX: number, clientY: number) => void;

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
  private tacticalApronMat: THREE.MeshStandardMaterial | null = null;
  private readonly enclosureDisposables: Array<{ dispose: () => void }> = [];

  private readonly boardPiecesRoot = new THREE.Group();
  private readonly tilePickCollidersRoot = new THREE.Group();
  private readonly replayPiecesRoot = new THREE.Group();
  private readonly fieldManualRoot = new THREE.Group();
  private readonly dragGhostRoot = new THREE.Group();
  private readonly onBoardInspectGroup: THREE.Group;
  private readonly casualtyPiecesRoot = new THREE.Group();
  private readonly indicatorLayer = new TileIndicatorLayer();
  private readonly raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.022);
  private readonly pickColliderMat = new THREE.MeshStandardMaterial({
    visible: false,
    depthWrite: false,
    colorWrite: false,
  });
  private readonly pieceColliderGeo = new THREE.CylinderGeometry(0.24, 0.36, 0.44, 8);

  private readonly pieceVisuals = new Map<string, PieceVisualInstance>();
  private readonly casualtyVisuals = new Map<string, THREE.Group>();
  private renderedReplayKey = '';
  private renderedManualKey = '';

  private readonly qualityGovernor: QualityGovernor;
  private activeQualityProfile: QualitySnapshot;
  private pendingQualityApply = false;
  private activeTheaterId: TheaterId = 'FIELD_HQ';
  private lastSyncedTheaterId: TheaterId | null = null;
  private activeTheaterSpec: BattleTheaterSpec = getBattleTheater('FIELD_HQ');
  private isDisposed = false;
  private viewportFrameMode: ViewportFrameMode = 'FULL_VIEWPORT';
  private lastSyncedViewportFrameMode: ViewportFrameMode | null = null;
  private lastSyncedPhase: MatchPhase | null = null;
  private lastSyncedCameraMode: CameraMode | null = null;

  private phase: MatchPhase = 'TITLE';
  private viewingFaction: Faction = 'PLAYER';
  private cameraMode: CameraMode = 'TITLE';
  private boardView: BoardViewAngle = 'COMMAND';
  private handedness: AppOptions['handedness'] = 'RIGHT';
  private selectedPieceId: string | null = null;
  private turnClockSec = 45;
  private isUntimed = false;
  private userPitchDeltaDeg = 0;
  private userYawDeltaDeg = 0;
  private userZoomFactor = 1.0;
  private cameraSensitivity = 1.0;
  private cameraInvertOrbit = false;
  private lastAppliedPitchDeg = 41.0;
  private lastCameraDistance = 11.4;

  private activeDrag: ActiveHologramDrag | null = null;

  private readonly defaultBgColor = new THREE.Color('#06080c');
  private readonly replayBgColor = new THREE.Color('#020a16');

  private readonly camCurrentPos = new THREE.Vector3(0, 5.15, 11.4);
  private readonly camCurrentLook = new THREE.Vector3(0, 0.05, 0.35);
  private readonly camTargetPos = new THREE.Vector3(0, 5.15, 11.4);
  private readonly camTargetLook = new THREE.Vector3(0, 0.05, 0.35);
  private roomDimFactor = 1.0;
  private targetRoomDimFactor = 1.0;

  private readonly clock = new THREE.Clock();
  private totalElapsed = 0;
  private frameAccumSec = 0;
  private lastArbiterTapTime = 0;
  private rafId = 0;
  private resizeObserver: ResizeObserver;
  private readonly inputAbort = new AbortController();
  private stageHooksAttached = false;

  constructor(host: HTMLElement, store: GameStore, sound: SoundDirector) {
    this.host = host;
    this.store = store;
    this.sound = sound;
    const initTheaterId = store.getVisibleView().theaterId;
    this.activeTheaterId = initTheaterId;
    this.activeTheaterSpec = getBattleTheater(initTheaterId);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.qualityGovernor = new QualityGovernor('AUTO');
    this.qualityGovernor.probeCapabilities(this.renderer.getContext());
    this.activeQualityProfile = this.qualityGovernor.getActiveProfile();

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.activeQualityProfile.dprCap)
    );
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.defaultBgColor.clone();
    this.scene.fog = new THREE.FogExp2(
      this.activeTheaterSpec.fogHex,
      this.activeTheaterSpec.fogDensity
    );

    this.scene.environment = createStudioLanternEnvMap(this.renderer);

    this.camera = new THREE.PerspectiveCamera(48, 9 / 16, 0.25, 95);
    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);

    this.keyShadowLight = new THREE.DirectionalLight(0xffe0b5, 3.25);
    this.keyShadowLight.position.set(-9.2, 6.8, 5.2);
    this.keyShadowLight.target.position.set(0.4, -0.2, -0.6);
    this.keyShadowLight.castShadow = true;
    const initShadowSize = Math.max(512, this.activeQualityProfile.shadowMapSize || 1024);
    this.keyShadowLight.shadow.mapSize.set(initShadowSize, initShadowSize);
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

    this.rimShadowSpot = new THREE.SpotLight(0xffb86b, 4.2, 42, Math.PI / 3.2, 0.72, 0.85);
    this.rimShadowSpot.position.set(8.5, 8.2, -10.5);
    this.rimShadowSpot.target.position.set(0, -0.1, 0.5);
    this.rimShadowSpot.castShadow = this.activeQualityProfile.enableRimShadow;
    const initRimSize = Math.min(2048, initShadowSize);
    this.rimShadowSpot.shadow.mapSize.set(initRimSize, initRimSize);
    this.rimShadowSpot.shadow.bias = -0.0003;
    this.rimShadowSpot.shadow.normalBias = 0.01;
    this.scene.add(this.rimShadowSpot, this.rimShadowSpot.target);

    this.insigniaCatchLight = new THREE.DirectionalLight(0xfff0d6, 0.88);
    this.insigniaCatchLight.position.set(1.6, 4.4, 14.5);
    this.insigniaCatchLight.target.position.set(0, 0.35, 0.8);
    this.scene.add(this.insigniaCatchLight, this.insigniaCatchLight.target);

    this.selectedPieceLight = new THREE.PointLight(0xffe6b0, 0.0, 2.05, 2.0);
    this.scene.add(this.selectedPieceLight);

    this.ambientFill = new THREE.HemisphereLight(0xd8e4f8, 0x05070c, 0.19);
    this.scene.add(this.ambientFill);

    this.arbiterHeroSpot = new THREE.SpotLight(0xffe0b2, 0.0, 18, Math.PI / 3.4, 0.78, 1.25);
    this.arbiterHeroSpot.castShadow = false;
    this.arbiterHeroSpot.position.set(-1.5, 5.8, 1.0);
    this.arbiterHeroSpot.target.position.set(0, -0.1, ARBITER_BAY_CENTER_Z + 0.1);
    this.scene.add(this.arbiterHeroSpot, this.arbiterHeroSpot.target);

    this.factory = new MeshFactory();
    this.warRoom = this.factory.createWarRoomEnvironment();
    const wallScaleX = 1.65;
    const wallScaleY = 1.14;
    this.warRoom.tentBackdropMesh.scale.set(wallScaleX, wallScaleY, 1.0);
    const applyCounterScale = (obj: THREE.Object3D): void => {
      if (obj.name === 'PacificPortholeAssembly') {
        obj.scale.set(1 / wallScaleX, 1 / wallScaleY, 1);
        return;
      }
      if (
        obj instanceof THREE.Mesh &&
        (obj.geometry instanceof THREE.TorusGeometry ||
          obj.geometry instanceof THREE.CircleGeometry ||
          obj.geometry instanceof THREE.LatheGeometry)
      ) {
        obj.scale.set(1 / wallScaleX, 1 / wallScaleY, 1);
      }
      for (const child of obj.children) {
        applyCounterScale(child);
      }
    };
    applyCounterScale(this.warRoom.tentBackdropMesh);
    this.buildSeamlessTheaterEnclosure();
    this.scene.add(this.warRoom.root);
    this.scene.add(this.factory.createBoardCabinetGroup());

    this.onBoardInspectGroup = this.factory.createOnBoardInspectionGroup();
    this.scene.add(this.onBoardInspectGroup);

    this.arbiterStage = new ArbiterStage3D(this.factory, this.sound);
    this.scene.add(this.arbiterStage.root);
    this.scene.add(this.arbiterStage.worldMedallionGroup);

    this.pieceColliderGeo.translate(0, 0.22, 0);
    const tilePickGeo = new THREE.PlaneGeometry(0.96, 0.96);
    tilePickGeo.rotateX(-Math.PI / 2);
    for (let vRow = 0; vRow < BOARD_ROWS; vRow++) {
      for (let vCol = 0; vCol < BOARD_COLS; vCol++) {
        const w = gridToWorld(vCol, vRow);
        const tilePick = new THREE.Mesh(tilePickGeo, this.pickColliderMat);
        tilePick.name = 'tilePickCollider';
        tilePick.position.set(w.x, 0.022, w.z);
        tilePick.castShadow = false;
        tilePick.receiveShadow = false;
        tilePick.userData['vCol'] = vCol;
        tilePick.userData['vRow'] = vRow;
        this.tilePickCollidersRoot.add(tilePick);
      }
    }
    this.scene.add(this.tilePickCollidersRoot);

    this.scene.add(this.indicatorLayer.root);
    this.scene.add(this.boardPiecesRoot);
    this.scene.add(this.replayPiecesRoot);
    this.scene.add(this.fieldManualRoot);
    this.scene.add(this.dragGhostRoot);
    this.scene.add(this.casualtyPiecesRoot);

    void this.factory.preloadBakedModels().then((parts) => {
      if (this.isDisposed) return;
      this.arbiterStage.applyBakedHardwareParts(parts);
      this.factory.applyTheaterVisuals(this.activeTheaterId, {
        scene: this.scene,
        warRoom: this.warRoom,
        keyLight: this.keyShadowLight,
        rimLight: this.rimShadowSpot,
        ambientLight: this.ambientFill,
      });
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

    this.applyQualityProfile();
    this.setTheater(this.activeTheaterId);
    this.lastSyncedTheaterId = this.activeTheaterId;
    this.handleResize();
    this.factory.withAllTheatersVisible(() => {
      this.renderer.compile(this.scene, this.camera);
    });
    this.clock.getDelta();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.host);

    this.bindPointerInput();
    queueMicrotask(() => this.attachStageDebugHooks());
  }

  public setTheater(theaterId: TheaterId): void {
    this.attachStageDebugHooks();
    const spec = this.factory.applyTheaterVisuals(theaterId, {
      scene: this.scene,
      warRoom: this.warRoom,
      keyLight: this.keyShadowLight,
      rimLight: this.rimShadowSpot,
      ambientLight: this.ambientFill,
    });
    this.activeTheaterId = spec.id;
    this.activeTheaterSpec = spec;
    this.defaultBgColor.set(spec.sceneBgHex);
    this.sound.setTheaterAmbiance(spec.id);

    if (this.tacticalApronMat) {
      this.tacticalApronMat.color
        .set(spec.tableBaizeHex)
        .lerp(new THREE.Color(spec.ambientGroundHex), 0.45);
      this.tacticalApronMat.emissive.set(spec.tableBaizeEmissiveHex);
    }

    const isReplay = this.phase === 'REPLAY' || this.cameraMode === 'REPLAY';
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(isReplay ? this.replayBgColor : this.defaultBgColor);
    }
    if (this.scene.fog instanceof THREE.FogExp2 && !isReplay) {
      this.scene.fog.color.set(spec.fogHex);
      this.scene.fog.density = spec.fogDensity;
    }
    this.applyLightingAndCamera();
    this.composer.render();
    this.clock.getDelta();
  }

  private buildSeamlessTheaterEnclosure(): void {
    this.tacticalApronMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.activeTheaterSpec.tableBaizeHex).lerp(
        new THREE.Color(this.activeTheaterSpec.ambientGroundHex),
        0.45
      ),
      emissive: new THREE.Color(this.activeTheaterSpec.tableBaizeEmissiveHex),
      emissiveIntensity: 0.4,
      roughness: 0.92,
      metalness: 0.04,
      envMapIntensity: 0.12,
    });
    const apronGeo = new THREE.CylinderGeometry(52, 52, 0.3, 64);
    const apronMesh = new THREE.Mesh(apronGeo, this.tacticalApronMat);
    apronMesh.name = 'WarRoomFloorApron';
    // Top sits at y = -0.735 (strictly below -0.685 tabletop and -0.711 plank V-grooves)
    apronMesh.position.set(0, -0.885, 2.0);
    apronMesh.receiveShadow = true;
    apronMesh.castShadow = false;
    this.warRoom.root.add(apronMesh);

    const createWingGeo = (side: -1 | 1): THREE.BufferGeometry => {
      const segU = 24;
      const segY = 14;
      const pos: number[] = [];
      const uvs: number[] = [];
      const idx: number[] = [];
      for (let iy = 0; iy <= segY; iy++) {
        const vy = iy / segY;
        const upperT = Math.max(0, (vy - 0.65) / 0.35);
        for (let iu = 0; iu <= segU; iu++) {
          const u = iu / segU;
          const theta = u * Math.PI * 0.65;
          const sinT = Math.sin(theta);
          const x = side * (15.0 + 7.5 * sinT);
          const archY = THREE.MathUtils.lerp(7.98, 12.2, u);
          const botY = THREE.MathUtils.lerp(-5.0, -6.5, u);
          const y = THREE.MathUtils.lerp(botY, archY, vy);
          const fold = Math.sin(u * Math.PI * 6) * 0.08 * Math.sin(u * Math.PI) * (1 - vy * 0.45);
          const z =
            1.45 +
            (2.9 / 15.0) * 7.5 * sinT +
            34.0 * (1 - Math.cos(u * Math.PI * 0.5)) +
            upperT * upperT * 1.35 * (1 - u * 0.4) +
            fold;
          pos.push(x, y, z);
          uvs.push(side > 0 ? 1.0 - u : u, vy);
        }
      }
      const stride = segU + 1;
      for (let iy = 0; iy < segY; iy++) {
        for (let iu = 0; iu < segU; iu++) {
          const a = iy * stride + iu;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          if (side > 0) {
            idx.push(a, b, c, b, d, c);
          } else {
            idx.push(a, c, b, b, c, d);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };

    const leftWingGeo = createWingGeo(-1);
    const rightWingGeo = createWingGeo(1);
    this.enclosureDisposables.push(this.tacticalApronMat, apronGeo, leftWingGeo, rightWingGeo);

    for (const backdropGroup of this.warRoom.tentBackdropMesh.children) {
      if (!(backdropGroup instanceof THREE.Group)) continue;
      const wallMesh = backdropGroup.children.find(
        (ch): ch is THREE.Mesh =>
          ch instanceof THREE.Mesh &&
          ch.material instanceof THREE.MeshStandardMaterial &&
          ch.material.side === THREE.DoubleSide
      );
      if (!wallMesh) continue;

      const leftWing = new THREE.Mesh(leftWingGeo, wallMesh.material);
      leftWing.name = 'CanopyWrapWingLeft';
      leftWing.receiveShadow = true;

      const rightWing = new THREE.Mesh(rightWingGeo, wallMesh.material);
      rightWing.name = 'CanopyWrapWingRight';
      rightWing.receiveShadow = true;

      backdropGroup.add(leftWing, rightWing);
    }
  }

  public setQualityMode(mode: QualityTier): void {
    this.attachStageDebugHooks();
    this.qualityGovernor.setRequestedMode(mode);
    this.applyQualityProfile();
  }

  public getQualitySnapshot(): QualitySnapshot {
    return this.qualityGovernor.getSnapshot();
  }

  public simulateFrameDt(dtSec: number): QualitySnapshot {
    this.attachStageDebugHooks();
    const changed = this.qualityGovernor.recordFrameDt(dtSec);
    if (changed) {
      this.applyQualityProfile();
    } else {
      this.activeQualityProfile = this.qualityGovernor.getActiveProfile();
    }
    return this.activeQualityProfile;
  }

  public setViewportFrameMode(mode: ViewportFrameMode): void {
    this.attachStageDebugHooks();
    if (this.viewportFrameMode === mode && document.body.classList.contains('frame-phone-9-16') === (mode === 'PHONE_9_16')) {
      return;
    }
    this.viewportFrameMode = mode;
    document.body.classList.toggle('frame-phone-9-16', mode === 'PHONE_9_16');
    this.handleResize();
  }

  public resetCameraOrbit(): void {
    this.attachStageDebugHooks();
    this.userYawDeltaDeg = 0;
    this.userPitchDeltaDeg = 0;
    this.userZoomFactor = 1.0;
    this.updateCameraTargets(this.cameraMode);
  }

  public setCameraPreferences(sensitivity: number, invertOrbit: boolean): void {
    this.cameraSensitivity = THREE.MathUtils.clamp(sensitivity, 0.35, 2.5);
    this.cameraInvertOrbit = invertOrbit;
  }

  public skipArbiterCutscene(): boolean {
    this.attachStageDebugHooks();
    if (!this.arbiterStage.isBusy) return false;
    const stageAny = this.arbiterStage as unknown as { skipToComplete?: () => boolean };
    if (typeof stageAny.skipToComplete === 'function') {
      return stageAny.skipToComplete();
    }
    this.sound.stopActiveSequence();
    this.arbiterStage.resetToIdle();
    this.store.finalizeActiveClash();
    return true;
  }

  public projectBoardCoord(
    vCol: number,
    vRow: number,
    worldY = 0.08
  ): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.camera.updateMatrixWorld();
    const w = gridToWorld(vCol, vRow);
    const pt = new THREE.Vector3(w.x, worldY, w.z).project(this.camera);
    if (pt.z < -1 || pt.z > 1) return null;
    return {
      x: rect.left + (pt.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - pt.y) * 0.5 * rect.height,
    };
  }

  /**
   * Non-cheating stage telemetry for multi-viewport QA & QualityGovernor checks.
   * Reads exclusively from `PlayerVisibleView` (enemy ranks remain `'UNKNOWN'`).
   */
  public getStageTelemetry(): Record<string, unknown> {
    const view = this.store.getVisibleView();
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();

    const cornerPt = new THREE.Vector3();
    const pieceBox = new THREE.Box3();
    const childBox = new THREE.Box3();
    const piecesTelemetry =
      this.cameraMode === 'FIELD_MANUAL'
        ? (() => {
            this.fieldManualRoot.updateWorldMatrix(true, true);
            return this.fieldManualRoot.children.map((holder, idx) => {
              const rankId =
                (holder.userData['manualRank'] as RankId | undefined) ??
                view.manualEntries[idx]?.rank ??
                'PRIVATE';
              const col = idx % 5;
              const row = Math.floor(idx / 5);

              let worldBounds: {
                minX: number;
                maxX: number;
                minY: number;
                maxY: number;
                minZ: number;
                maxZ: number;
              } | null = null;
              pieceBox.makeEmpty();
              holder.traverse((obj) => {
                if (
                  obj instanceof THREE.Mesh &&
                  obj.name !== 'pieceCollider' &&
                  obj.name !== 'wedgeAoDisc' &&
                  obj.name !== 'pieceHalo'
                ) {
                  childBox.setFromObject(obj);
                  pieceBox.union(childBox);
                }
              });
              if (!pieceBox.isEmpty()) {
                worldBounds = {
                  minX: Number(pieceBox.min.x.toFixed(4)),
                  maxX: Number(pieceBox.max.x.toFixed(4)),
                  minY: Number(pieceBox.min.y.toFixed(4)),
                  maxY: Number(pieceBox.max.y.toFixed(4)),
                  minZ: Number(pieceBox.min.z.toFixed(4)),
                  maxZ: Number(pieceBox.max.z.toFixed(4)),
                };
              }

              let minX = Infinity;
              let maxX = -Infinity;
              let minY = Infinity;
              let maxY = -Infinity;
              let inFront = false;
              if (rect.width > 0 && rect.height > 0) {
                const xs = worldBounds
                  ? [worldBounds.minX, worldBounds.maxX]
                  : [holder.position.x - 0.51, holder.position.x + 0.51];
                const ys = worldBounds ? [worldBounds.minY, worldBounds.maxY] : [0.02, 0.92];
                const zs = worldBounds
                  ? [worldBounds.minZ, worldBounds.maxZ]
                  : [holder.position.z - 0.51, holder.position.z + 0.51];
                for (const wx of xs) {
                  for (const wy of ys) {
                    for (const wz of zs) {
                      cornerPt.set(wx, wy, wz).project(this.camera);
                      if (cornerPt.z >= -1 && cornerPt.z <= 1) inFront = true;
                      const sx = rect.left + (cornerPt.x + 1) * 0.5 * rect.width;
                      const sy = rect.top + (1 - cornerPt.y) * 0.5 * rect.height;
                      if (sx < minX) minX = sx;
                      if (sx > maxX) maxX = sx;
                      if (sy < minY) minY = sy;
                      if (sy > maxY) maxY = sy;
                    }
                  }
                }
              }

              const screenBounds =
                inFront && Number.isFinite(minX)
                  ? {
                      left: Number(minX.toFixed(1)),
                      right: Number(maxX.toFixed(1)),
                      top: Number(minY.toFixed(1)),
                      bottom: Number(maxY.toFixed(1)),
                      width: Number(Math.max(0, maxX - minX).toFixed(1)),
                      height: Number(Math.max(0, maxY - minY).toFixed(1)),
                    }
                  : null;

              return {
                id: `manual_${rankId}`,
                faction: 'PLAYER' as Faction,
                visibleRank: rankId,
                col,
                row,
                visualCol: col,
                visualRow: row,
                visible: this.fieldManualRoot.visible && holder.visible,
                rotationY: Number(holder.rotation.y.toFixed(4)),
                worldBounds,
                screenBounds,
              };
            });
          })()
        : view.pieces.map((p) => {
      const vis = this.logicalToVisualCoord(p.col, p.row);
      const inst = this.pieceVisuals.get(p.id);
      const basePos = inst ? inst.group.position : gridToWorld(vis.col, vis.row);

      let worldBounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
      } | null = null;
      let rotationY = p.faction === view.viewingFaction ? 0 : Math.PI;

      if (inst) {
        inst.group.updateWorldMatrix(true, true);
        rotationY = Number(inst.group.rotation.y.toFixed(4));
        pieceBox.makeEmpty();
        inst.group.traverse((obj) => {
          if (
            obj instanceof THREE.Mesh &&
            obj.name !== 'pieceCollider' &&
            obj.name !== 'wedgeAoDisc' &&
            obj.name !== 'pieceHalo'
          ) {
            childBox.setFromObject(obj);
            pieceBox.union(childBox);
          }
        });
        if (!pieceBox.isEmpty()) {
          worldBounds = {
            minX: Number(pieceBox.min.x.toFixed(4)),
            maxX: Number(pieceBox.max.x.toFixed(4)),
            minY: Number(pieceBox.min.y.toFixed(4)),
            maxY: Number(pieceBox.max.y.toFixed(4)),
            minZ: Number(pieceBox.min.z.toFixed(4)),
            maxZ: Number(pieceBox.max.z.toFixed(4)),
          };
        }
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let inFront = false;

      if (rect.width > 0 && rect.height > 0) {
        const dxHalf = 0.36;
        const dzHalf = 0.28;
        const ys = [0.02, 0.78];
        for (const ox of [-dxHalf, dxHalf]) {
          for (const oz of [-dzHalf, dzHalf]) {
            for (const oy of ys) {
              cornerPt.set(basePos.x + ox, basePos.y + oy, basePos.z + oz).project(this.camera);
              if (cornerPt.z >= -1 && cornerPt.z <= 1) inFront = true;
              const sx = rect.left + (cornerPt.x + 1) * 0.5 * rect.width;
              const sy = rect.top + (1 - cornerPt.y) * 0.5 * rect.height;
              if (sx < minX) minX = sx;
              if (sx > maxX) maxX = sx;
              if (sy < minY) minY = sy;
              if (sy > maxY) maxY = sy;
            }
          }
        }
      }

      const screenBounds =
        inFront && Number.isFinite(minX)
          ? {
              left: Number(minX.toFixed(1)),
              right: Number(maxX.toFixed(1)),
              top: Number(minY.toFixed(1)),
              bottom: Number(maxY.toFixed(1)),
              width: Number(Math.max(0, maxX - minX).toFixed(1)),
              height: Number(Math.max(0, maxY - minY).toFixed(1)),
            }
          : null;

      return {
        id: p.id,
        faction: p.faction,
        visibleRank: p.visibleRank,
        col: p.col,
        row: p.row,
        visualCol: vis.col,
        visualRow: vis.row,
        visible: inst ? inst.group.visible : false,
        rotationY,
        worldBounds,
        screenBounds,
      };
    });

    const inspect16Emblems: Array<{ rank: string; depth: number }> = [];
    if (this.onBoardInspectGroup.visible || this.cameraMode === 'INSPECT_16') {
      this.onBoardInspectGroup.updateWorldMatrix(true, true);
      const galleryItems = this.onBoardInspectGroup.children.slice(4, 20);
      galleryItems.forEach((child, idx) => {
        pieceBox.setFromObject(child);
        const depth = pieceBox.isEmpty()
          ? 0
          : Number(Math.max(0, pieceBox.max.z - pieceBox.min.z).toFixed(4));
        const rankLabel = idx < ORDERED_RANKS.length ? ORDERED_RANKS[idx]! : 'MEDALLION';
        inspect16Emblems.push({ rank: rankLabel, depth });
      });
    }

    const medChild = this.arbiterStage.worldMedallionGroup.children[0];
    const medallionY = this.arbiterStage.worldMedallionGroup.visible
      ? Number(
          (
            this.arbiterStage.worldMedallionGroup.position.y +
            (medChild ? medChild.position.y : 0)
          ).toFixed(4)
        )
      : 0;

    return {
      theaterId: this.activeTheaterId,
      fogHex:
        this.scene.fog instanceof THREE.FogExp2
          ? `#${this.scene.fog.color.getHexString()}`
          : this.activeTheaterSpec.fogHex,
      quality: this.activeQualityProfile,
      qualitySnapshot: this.activeQualityProfile,
      lanternCastShadow: this.warRoom.tableLanternShadowLight.castShadow,
      viewportFrameMode: this.viewportFrameMode,
      camera: {
        yawDeg: Number(this.userYawDeltaDeg.toFixed(2)),
        pitchDeg: Number(this.lastAppliedPitchDeg.toFixed(2)),
        zoomDist: Number(this.lastCameraDistance.toFixed(2)),
        fovDeg: Number(this.camera.fov.toFixed(2)),
        mode: this.cameraMode,
      },
      medallionY,
      inspect16Emblems,
      pieces: piecesTelemetry,
    };
  }

  private attachStageDebugHooks(): void {
    if (this.stageHooksAttached || typeof window === 'undefined') return;
    const win = window as unknown as { __WAR_GENERALS_STAGE__?: Record<string, unknown> };
    const stage = win.__WAR_GENERALS_STAGE__;
    if (!stage) return;
    this.stageHooksAttached = true;

    if (typeof stage['setTheater'] !== 'function') {
      stage['setTheater'] = (id: TheaterId) => this.setTheater(id);
    }
    if (typeof stage['resetCameraOrbit'] !== 'function') {
      stage['resetCameraOrbit'] = () => this.resetCameraOrbit();
    }
    if (typeof stage['setViewportFrameMode'] !== 'function') {
      stage['setViewportFrameMode'] = (mode: ViewportFrameMode) => this.setViewportFrameMode(mode);
    }
    if (typeof stage['setQualityMode'] !== 'function') {
      stage['setQualityMode'] = (mode: QualityTier) => this.setQualityMode(mode);
    }
    if (typeof stage['simulateFrameDt'] !== 'function') {
      stage['simulateFrameDt'] = (dtSec: number) => this.simulateFrameDt(dtSec);
    }
    if (typeof stage['skipArbiterCutscene'] !== 'function') {
      stage['skipArbiterCutscene'] = () => this.skipArbiterCutscene();
    }
    if (typeof stage['projectBoardCoord'] !== 'function') {
      stage['projectBoardCoord'] = (vCol: number, vRow: number, worldY = 0.08) =>
        this.projectBoardCoord(vCol, vRow, worldY);
    }
    if (typeof stage['getTelemetry'] !== 'function') {
      stage['getTelemetry'] = () => this.getStageTelemetry();
    }
    if (typeof stage['getStageTelemetry'] !== 'function') {
      stage['getStageTelemetry'] = () => this.getStageTelemetry();
    }
  }

  private applyQualityProfile(): void {
    const profile = this.qualityGovernor.getActiveProfile();
    this.activeQualityProfile = profile;

    const desiredDpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);
    if (Math.abs(this.renderer.getPixelRatio() - desiredDpr) > 0.01) {
      this.renderer.setPixelRatio(desiredDpr);
      this.handleResize();
    }

    const shadowsOn = profile.shadowMapSize > 0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = shadowsOn;
    if (!shadowsOn) {
      this.renderer.shadowMap.needsUpdate = false;
    } else {
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.keyShadowLight.castShadow = true;
    if (shadowsOn && this.keyShadowLight.shadow.mapSize.x !== profile.shadowMapSize) {
      this.keyShadowLight.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      this.keyShadowLight.shadow.map?.dispose();
      this.keyShadowLight.shadow.map = null;
    }

    this.warRoom.tableLanternShadowLight.castShadow = profile.enableLanternShadow && shadowsOn;
    this.rimShadowSpot.castShadow = profile.enableRimShadow && shadowsOn;
    if (shadowsOn && profile.enableRimShadow) {
      const rimSize = Math.min(2048, profile.shadowMapSize);
      if (this.rimShadowSpot.shadow.mapSize.x !== rimSize) {
        this.rimShadowSpot.shadow.mapSize.set(rimSize, rimSize);
        this.rimShadowSpot.shadow.map?.dispose();
        this.rimShadowSpot.shadow.map = null;
      }
    }

    this.bloomPass.enabled = profile.enableBloom;
    this.tiltShiftPass.enabled =
      profile.enableDoF &&
      this.cameraMode !== 'INSPECT_16' &&
      this.cameraMode !== 'REPLAY' &&
      this.cameraMode !== 'FIELD_MANUAL';
  }

  /**
   * Coordinate rotation helper for 2P Pass & Play (`viewingFaction === 'ENEMY'` spins board 180°
   * so the active player's home rows ALWAYS sit at `visualRow 5..7` in front of their thumb!).
   */
  private logicalToVisualCoord(col: number, row: number): { col: number; row: number } {
    if (this.viewingFaction === 'ENEMY') {
      return { col: BOARD_COLS - 1 - col, row: BOARD_ROWS - 1 - row };
    }
    return { col, row };
  }

  private visualToLogicalCoord(vCol: number, vRow: number): { col: number; row: number } {
    if (this.viewingFaction === 'ENEMY') {
      return { col: BOARD_COLS - 1 - vCol, row: BOARD_ROWS - 1 - vRow };
    }
    return { col: vCol, row: vRow };
  }

  private logicalToVisualDir(dir: MoveDirection): MoveDirection {
    if (this.viewingFaction !== 'ENEMY') return dir;
    if (dir === 'UP') return 'DOWN';
    if (dir === 'DOWN') return 'UP';
    if (dir === 'LEFT') return 'RIGHT';
    return 'LEFT';
  }

  private isDeployLikePhase(): boolean {
    return this.phase === 'DEPLOY' || this.phase === 'ARMORY';
  }

  /**
   * Starts a lifted `+28px` Cyan Holographic Projection Drag directly out of the HTML Mobilization Crate!
   */
  public beginCrateDrag(rank: RankId, clientX: number, clientY: number): void {
    if (!this.isDeployLikePhase() || this.cameraMode !== 'PLAY') return;
    this.clearActiveDrag();
    this.sound.playPiecePickup();

    const ghost = this.factory.createHologramGhostWedge(rank);
    this.dragGhostRoot.add(ghost);
    this.activeDrag = {
      mode: 'CRATE_DEPLOY',
      rank,
      ghostGroup: ghost,
      hoverCoord: null,
    };
    this.updateHologramDragPosition(clientX, clientY);
  }

  public syncFromStore(view: PlayerVisibleView, options: Readonly<AppOptions>): void {
    this.attachStageDebugHooks();

    this.handedness = options.handedness;
    this.factory.applyPieceColor(view.playerPieceColor);
    this.factory.applyBoardFinish(options.boardFinish);
    this.setCameraPreferences(options.cameraSensitivity, options.cameraInvertOrbit);

    const desiredQuality: QualityTier =
      options.qualityMode ??
      (options.renderQuality === 'BATTERY_SAVER' ? 'BATTERY_SAVER' : 'AUTO');
    if (this.activeQualityProfile.requestedMode !== desiredQuality) {
      this.qualityGovernor.setRequestedMode(desiredQuality);
    }

    if (this.lastSyncedViewportFrameMode !== options.viewportFrameMode) {
      this.lastSyncedViewportFrameMode = options.viewportFrameMode;
      if (options.viewportFrameMode !== this.viewportFrameMode) {
        this.setViewportFrameMode(options.viewportFrameMode);
      }
    }

    if (this.lastSyncedTheaterId !== view.theaterId) {
      this.lastSyncedTheaterId = view.theaterId;
      if (view.theaterId !== this.activeTheaterId) {
        this.setTheater(view.theaterId);
      }
    }

    if (this.boardView !== options.boardView) {
      this.boardView = options.boardView;
      this.userPitchDeltaDeg = 0;
    }

    this.phase = view.phase;
    this.viewingFaction = view.viewingFaction;
    this.selectedPieceId = view.selectedPieceId;
    this.turnClockSec = view.turnClockSec;
    this.isUntimed = view.isUntimed;
    this.cameraMode = view.cameraMode;
    if (this.arbiterStage.isBusy) {
      this.pendingQualityApply = true;
    } else {
      this.pendingQualityApply = false;
      this.applyQualityProfile();
    }
    this.updateCameraTargets(view.cameraMode);

    if (this.lastSyncedPhase !== view.phase || this.lastSyncedCameraMode !== view.cameraMode) {
      this.lastSyncedPhase = view.phase;
      this.lastSyncedCameraMode = view.cameraMode;
      this.sound.setPhase(view.cameraMode === 'ARBITER' ? 'ARBITER' : view.phase);
    }

    const isReplay = view.phase === 'REPLAY' || view.cameraMode === 'REPLAY';
    const isFieldManual = view.phase === 'FIELD_MANUAL' || view.cameraMode === 'FIELD_MANUAL';
    const isInspect = view.cameraMode === 'INSPECT_16';

    this.targetRoomDimFactor =
      view.cameraMode === 'ARBITER' ? 0.56 : isReplay ? 0.34 : view.phase === 'TITLE' ? 0.92 : 1.0;
    (this.scene.background as THREE.Color).copy(
      isReplay ? this.replayBgColor : this.defaultBgColor
    );
    if (this.scene.fog instanceof THREE.FogExp2) {
      if (isReplay) {
        this.scene.fog.color.set('#020a16');
        this.scene.fog.density = 0.014;
      } else {
        this.scene.fog.color.set(this.activeTheaterSpec.fogHex);
        this.scene.fog.density = this.activeTheaterSpec.fogDensity;
      }
    }

    this.onBoardInspectGroup.visible = isInspect;
    this.fieldManualRoot.visible = isFieldManual;
    this.replayPiecesRoot.visible = isReplay;
    this.boardPiecesRoot.visible =
      !isInspect && !isFieldManual && !isReplay && (view.cameraMode === 'PLAY' || view.cameraMode === 'TITLE');
    this.casualtyPiecesRoot.visible = !isInspect && !isFieldManual && !isReplay;

    if (isFieldManual) {
      this.syncFieldManualScene(view.manualSelectedRank, view.manualEntries);
      this.indicatorLayer.syncReplayOverlay(false, null, null, false);
      this.indicatorLayer.syncDeploymentGrid(false, new Set(), null);
      this.indicatorLayer.sync(null, [], false);
      return;
    }

    if (isReplay && view.replay) {
      this.syncDeclassifiedReplayScene(view.replay.plies[view.replay.currentPly]);
      this.indicatorLayer.syncDeploymentGrid(false, new Set(), null);
      this.indicatorLayer.sync(null, [], false);
      return;
    } else {
      this.indicatorLayer.syncReplayOverlay(false, null, null, false);
    }

    const activeIds = new Set<string>();
    const clashingIds = new Set<string>();
    if (view.activeClash) {
      clashingIds.add(view.activeClash.attackerId);
      clashingIds.add(view.activeClash.defenderId);
    }

    const occupiedHomeKeys = new Set<string>();
    for (const p of view.pieces) {
      activeIds.add(p.id);
      const vis = this.logicalToVisualCoord(p.col, p.row);
      if (p.faction === view.viewingFaction) {
        occupiedHomeKeys.add(`${vis.col},${vis.row}`);
      }
      const inst = this.getOrCreatePieceVisual(p, view.viewingFaction, Boolean(view.shroud?.active));
      inst.targetPos.copy(gridToWorld(vis.col, vis.row));
      inst.group.visible =
        !clashingIds.has(p.id) && this.activeDrag?.sourcePieceId !== p.id;
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
    const selectedVis = selectedPiece
      ? this.logicalToVisualCoord(selectedPiece.col, selectedPiece.row)
      : null;

    if (this.isDeployLikePhase() && view.cameraMode === 'PLAY' && !view.shroud?.active) {
      this.indicatorLayer.sync(null, [], false);
      this.indicatorLayer.syncDeploymentGrid(true, occupiedHomeKeys, selectedVis);
    } else {
      this.indicatorLayer.syncDeploymentGrid(false, occupiedHomeKeys, null);
      const visMoves: ValidMoveTarget[] = view.validMoves.map((m) => {
        const vm = this.logicalToVisualCoord(m.col, m.row);
        return {
          ...m,
          col: vm.col,
          row: vm.row,
          direction: this.logicalToVisualDir(m.direction),
        };
      });
      this.indicatorLayer.sync(
        selectedVis,
        visMoves,
        view.cameraMode === 'PLAY' &&
          view.phase === 'PLAY' &&
          !view.activeClash &&
          !view.shroud?.active
      );
    }
  }

  private syncFieldManualScene(
    selectedRank: RankId,
    entries: readonly FieldManualEntry[]
  ): void {
    const key = `${selectedRank}:${entries.length}`;
    if (this.renderedManualKey === key) return;
    this.renderedManualKey = key;
    this.fieldManualRoot.clear();

    // 5 columns × 3 rows centered cleanly inside the 9×8 slate grid (`x = -3.2 .. +3.2`, `z = -1.35 .. +2.45`)!
    const colWorldX = [-3.2, -1.6, 0.0, 1.6, 3.2];
    const rowWorldZ = [-1.35, 0.55, 2.45];

    entries.forEach((entry, idx) => {
      const cx = colWorldX[idx % 5]!;
      const rz = rowWorldZ[Math.floor(idx / 5)]!;
      const wedge = this.factory.createFieldManualWedge(entry.rank, entry.outcome);
      wedge.position.set(cx, 0, rz);
      this.fieldManualRoot.add(wedge);
    });
  }

  private syncDeclassifiedReplayScene(ply: ReplayPlyEntry | undefined): void {
    if (!ply) return;
    const key = `${ply.plyIndex}:${ply.boardSnapshot.length}`;
    if (this.renderedReplayKey !== key) {
      this.renderedReplayKey = key;
      this.replayPiecesRoot.clear();
      for (const snap of ply.boardSnapshot) {
        if (!snap.alive) continue;
        const xWedge = this.factory.createXRayReplayWedge(
          snap.faction,
          snap.trueRank,
          snap.kills
        );
        xWedge.position.copy(gridToWorld(snap.col, snap.row));
        this.replayPiecesRoot.add(xWedge);
      }
    }
    this.indicatorLayer.syncReplayOverlay(true, ply.fromCoord, ply.toCoord, ply.wasClash);
  }

  public triggerArbiterSequence(verdict: ArbiterVerdict): void {
    this.clearActiveDrag();
    const playerVisual = this.pieceVisuals.get(verdict.playerPieceId);
    const enemyVisual = this.pieceVisuals.get(verdict.enemyPieceId);

    const pOrigin = playerVisual ? playerVisual.group.position.clone() : gridToWorld(4, 5);
    const eOrigin = enemyVisual
      ? enemyVisual.group.position.clone()
      : gridToWorld(verdict.contestedCoord.col, verdict.contestedCoord.row);

    // `THEATRICAL` = Full `4.0s` 3-Act Show (`1.0x`); `TACTICAL_FAST` = Accelerated `1.6s` Blitz Clash (`2.55x`)!
    const speed = this.store.getOptions().arbiterSpeed === 'TACTICAL_FAST' ? 2.55 : 1.0;

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
    this.clock.getDelta();
  }

  public startLoop(): void {
    this.attachStageDebugHooks();
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const rawDt = Math.min(0.08, this.clock.getDelta());

      if (this.qualityGovernor.recordFrameDt(rawDt)) {
        if (this.arbiterStage.isBusy) {
          this.pendingQualityApply = true;
        } else {
          this.pendingQualityApply = false;
          this.applyQualityProfile();
        }
      } else {
        if (this.pendingQualityApply && !this.arbiterStage.isBusy) {
          this.pendingQualityApply = false;
          this.applyQualityProfile();
        } else {
          this.activeQualityProfile = this.qualityGovernor.getActiveProfile();
        }
      }

      // Enforce genuine 30 FPS cap when QualityGovernor targets 30 FPS (`BATTERY_SAVER`)!
      if (this.activeQualityProfile.targetFps <= 30) {
        this.frameAccumSec += rawDt;
        if (this.frameAccumSec < 1 / 31) {
          return;
        }
        const steppedDt = Math.min(0.06, this.frameAccumSec);
        this.frameAccumSec = 0;
        this.totalElapsed += steppedDt;
        this.stepFrame(steppedDt, this.totalElapsed);
      } else {
        this.frameAccumSec = 0;
        const dt = Math.min(0.05, rawDt);
        this.totalElapsed += dt;
        this.stepFrame(dt, this.totalElapsed);
      }
    };
    this.clock.start();
    tick();
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.rafId);
    this.inputAbort.abort();
    this.resizeObserver.disconnect();
    for (const item of this.enclosureDisposables) {
      item.dispose();
    }
    this.enclosureDisposables.length = 0;
    this.tacticalApronMat = null;
    this.renderer.dispose();
  }

  private stepFrame(dt: number, elapsed: number): void {
    const discreteSec = Math.floor(elapsed);
    const tickFrac = Math.min(1, (elapsed - discreteSec) * 8);
    this.warRoom.watchSecondHand.rotation.y = -((discreteSec + tickFrac) / 60) * Math.PI * 2;

    const flickerL =
      1.0 + 0.045 * Math.sin(elapsed * 7.4) + 0.03 * Math.sin(elapsed * 18.1 + 1.2);
    const flickerR =
      1.0 + 0.04 * Math.cos(elapsed * 6.3 + 0.7) + 0.025 * Math.sin(elapsed * 14.9);

    const spec = this.activeTheaterSpec;
    const lanternBaseL = spec.lanternIntensity * 2.8;
    const lanternBaseR = spec.lanternIntensity * 1.45;
    this.warRoom.tableLanternShadowLight.color.set(spec.lanternHex);
    this.warRoom.tableLanternShadowLight.intensity =
      lanternBaseL * flickerL * (0.76 + 0.24 * this.roomDimFactor);
    this.warRoom.lanternLightRight.color.set(spec.rimLightHex);
    this.warRoom.lanternLightRight.intensity =
      lanternBaseR * flickerR * (0.72 + 0.28 * this.roomDimFactor);

    const flameBase = new THREE.Color(spec.lanternHex);
    this.warRoom.lanternFlameMat.color.setRGB(
      Math.max(0.45, flameBase.r * 2.5) * flickerL,
      Math.max(0.35, flameBase.g * 2.2) * flickerL,
      Math.max(0.22, flameBase.b * 2.0) * flickerL
    );
    this.warRoom.lanternFlameMat.emissive.set(spec.lanternHex);

    this.arbiterStage.update(dt, elapsed);
    this.indicatorLayer.update(elapsed);

    // Sync final-10-second Round Timer urgency tick with SoundDirector (disabled in Untimed Casual)!
    if (
      this.cameraMode === 'PLAY' &&
      this.phase === 'PLAY' &&
      !this.arbiterStage.isBusy &&
      !this.isUntimed
    ) {
      this.sound.setTurnWarningUrgent(this.turnClockSec <= 10);
    } else {
      this.sound.setTurnWarningUrgent(false);
    }

    const pieceSlide = 1 - Math.exp(-dt * 14.0);
    const pieceHoverSlide = 1 - Math.exp(-dt * 24.0);
    let foundSelPos: THREE.Vector3 | null = null;
    for (const inst of this.pieceVisuals.values()) {
      const isSel = inst.id === this.selectedPieceId && this.cameraMode === 'PLAY';
      const hoverY = isSel ? 0.08 : 0.0;
      inst.group.position.x = THREE.MathUtils.lerp(inst.group.position.x, inst.targetPos.x, pieceSlide);
      inst.group.position.z = THREE.MathUtils.lerp(inst.group.position.z, inst.targetPos.z, pieceSlide);
      inst.group.position.y = THREE.MathUtils.lerp(inst.group.position.y, hoverY, pieceHoverSlide);
      if (isSel) {
        foundSelPos = inst.group.position;
      }
    }

    if (foundSelPos) {
      this.selectedPieceLight.position.set(foundSelPos.x, foundSelPos.y + 1.15, foundSelPos.z + 0.36);
      this.selectedPieceLight.intensity = 1.45;
    } else {
      this.selectedPieceLight.intensity = THREE.MathUtils.lerp(
        this.selectedPieceLight.intensity,
        0,
        pieceSlide
      );
    }

    let desiredCamSpeed = this.cameraMode === 'INSPECT_16' ? 12.0 : 8.5;

    if (this.cameraMode === 'TITLE') {
      // Live 3D Start Screen: Slow, low-angle cinematic orbital drift across the active mid-game board!
      const rect = this.host.getBoundingClientRect();
      const aspect = Math.max(0.38, (rect.width || 412) / Math.max(1, rect.height || 915));
      const isLandscape = aspect >= 0.88;
      const orbAngle = Math.sin(elapsed * 0.18) * 0.46;
      const radius = isLandscape ? 9.6 : 11.4;
      const camY = (isLandscape ? 4.15 : 4.85) + Math.sin(elapsed * 0.27) * 0.25;
      const lookShiftX = isLandscape ? 1.85 : 0.0;
      this.camTargetPos.set(
        lookShiftX + Math.sin(orbAngle) * radius * 0.62,
        camY,
        Math.cos(orbAngle) * radius
      );
      this.camTargetLook.set(lookShiftX + Math.sin(elapsed * 0.14) * 0.35, -0.08, -0.35);
      desiredCamSpeed = 3.2;
      this.arbiterHeroSpot.color.setHex(0xffe0b2);
    } else if (this.cameraMode === 'ARBITER') {
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
    const spec = this.activeTheaterSpec;
    const isReplay = this.phase === 'REPLAY' || this.cameraMode === 'REPLAY';
    if (isReplay) {
      this.keyShadowLight.color.setHex(0x6cd4ff);
      this.keyShadowLight.intensity = 1.45;
      this.insigniaCatchLight.intensity = 0.95;
      this.rimShadowSpot.color.setHex(0x6cd4ff);
      this.rimShadowSpot.intensity = 4.2 * this.roomDimFactor;
      this.ambientFill.intensity = 0.24;
      this.arbiterHeroSpot.intensity = 0;
      this.warRoom.tentBackdropMat.color.setRGB(0.18, 0.17, 0.16);
      if (this.tacticalApronMat) {
        this.tacticalApronMat.color.set('#08101c');
        this.tacticalApronMat.emissive.set('#02060c');
      }
    } else {
      this.keyShadowLight.color.set(spec.keyLightHex);
      this.keyShadowLight.intensity =
        spec.keyLightIntensity * THREE.MathUtils.lerp(0.66, 1.0, this.roomDimFactor);
      this.insigniaCatchLight.intensity = THREE.MathUtils.lerp(0.55, 0.92, this.roomDimFactor);
      this.rimShadowSpot.color.set(spec.rimLightHex);
      this.rimShadowSpot.intensity = spec.rimLightIntensity * this.roomDimFactor;
      this.ambientFill.color.set(spec.ambientSkyHex);
      this.ambientFill.groundColor.set(spec.ambientGroundHex);
      this.ambientFill.intensity =
        spec.ambientIntensity * 0.24 * THREE.MathUtils.lerp(0.68, 1.0, this.roomDimFactor);
      this.arbiterHeroSpot.intensity = (1 - this.roomDimFactor) * 2.1;

      const tentBright = THREE.MathUtils.lerp(0.75, 1.0, this.roomDimFactor);
      this.warRoom.tentBackdropMat.color.set(spec.backdropTintHex).multiplyScalar(tentBright);
      if (this.tacticalApronMat) {
        this.tacticalApronMat.color
          .set(spec.tableBaizeHex)
          .lerp(new THREE.Color(spec.ambientGroundHex), 0.45)
          .multiplyScalar(tentBright);
        this.tacticalApronMat.emissive.set(spec.tableBaizeEmissiveHex);
      }
    }

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
    this.warRoom.tentBackdropMesh.position.y = THREE.MathUtils.clamp(yAtUpper - 1.4, 2.5, 3.75);
  }

  private getBasePitchDeg(): number {
    const rect = this.host.getBoundingClientRect();
    const aspect = Math.max(0.38, (rect.width || 412) / Math.max(1, rect.height || 915));
    const isLandscape = aspect >= 0.88;
    const inDeploy = this.isDeployLikePhase() && this.cameraMode === 'PLAY';
    const inReplay = this.phase === 'REPLAY' || this.cameraMode === 'REPLAY';
    const inGameOver = this.phase === 'GAME_OVER' && this.cameraMode === 'PLAY';
    if (isLandscape) {
      const rightPanelOpen = inDeploy || inGameOver;
      if (this.boardView === 'COMMAND') return rightPanelOpen ? 47.0 : inReplay ? 45.0 : 43.0;
      return this.boardView === 'TACTICAL' ? 32.5 : 62.0;
    }
    if (this.boardView === 'COMMAND') return inDeploy ? 46.0 : inReplay ? 48.0 : 41.0;
    return this.boardView === 'TACTICAL' ? 32.5 : 62.0;
  }

  private updateCameraTargets(mode: CameraMode): void {
    const rect = this.host.getBoundingClientRect();
    const aspect = Math.max(0.38, (rect.width || 412) / Math.max(1, rect.height || 915));
    const isLandscape = aspect >= 0.88;
    const inDeploy = this.isDeployLikePhase() && mode === 'PLAY';
    const inReplay = this.phase === 'REPLAY' || mode === 'REPLAY';
    const inGameOver = this.phase === 'GAME_OVER' && mode === 'PLAY';

    if (mode === 'TITLE') {
      this.camera.fov = isLandscape ? 38 : 44;
      this.camera.updateProjectionMatrix();
      const shiftX = isLandscape ? 1.85 : 0.0;
      this.camTargetPos.set(shiftX + 1.8, isLandscape ? 4.2 : 4.85, isLandscape ? 9.4 : 11.2);
      this.camTargetLook.set(shiftX, -0.08, -0.35);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.06, 0.88);
    } else if (mode === 'ARBITER') {
      const shot = this.arbiterStage.getBattleCameraPose(isLandscape, aspect);
      this.camera.fov = shot.fov;
      this.camera.updateProjectionMatrix();
      this.camTargetPos.copy(shot.pos);
      this.camTargetLook.copy(shot.look);
      this.targetRoomDimFactor = shot.roomDim;
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.04, 0.86);
    } else if (mode === 'FIELD_MANUAL') {
      const fov = isLandscape ? 36 : 43;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      if (isLandscape) {
        const vw = Math.max(320, rect.width || 1280);
        const vh = Math.max(240, rect.height || 800);
        const panelReservePx =
          vh <= 640 ? Math.min(362, vw * 0.42) + 26 : Math.min(392, vw * 0.38) + 32;
        const outerMarginPx = vh <= 640 ? 20 : 28;
        const safeMinPx = this.handedness === 'LEFT' ? panelReservePx : outerMarginPx;
        const safeMaxPx = this.handedness === 'LEFT' ? vw - outerMarginPx : vw - panelReservePx;
        const safeCenterNdcX = (safeMinPx + safeMaxPx) / vw - 1;
        const safeHalfNdcW = Math.max(0.24, (safeMaxPx - safeMinPx) / vw);

        const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(fov * 0.5));
        const pitchRad = THREE.MathUtils.degToRad(46.0);
        const frontDepthOffset = 2.22 * Math.cos(pitchRad) + 0.7 * Math.sin(pitchRad);
        const distH = frontDepthOffset + 3.75 / (tanHalfFov * aspect * safeHalfNdcW);
        const distV = 5.4 / (2 * tanHalfFov);
        const dist = THREE.MathUtils.clamp(Math.max(distH, distV, 11.4), 11.4, 16.5);
        const lookX = -safeCenterNdcX * (dist - frontDepthOffset) * tanHalfFov * aspect;

        this.camTargetLook.set(lookX, 0.08, 0.55);
        this.camTargetPos.set(
          lookX,
          0.08 + Math.sin(pitchRad) * dist,
          0.55 + Math.cos(pitchRad) * dist
        );
      } else {
        // Compute exact aspect-aware distance so all 5 columns (`width = 8.4`) fit 100% uncropped in 9:16 Portrait!
        const halfFov = THREE.MathUtils.degToRad(fov * 0.5);
        const dist = Math.max(13.2, 8.55 / (2 * Math.tan(halfFov) * aspect));
        const pitch = THREE.MathUtils.degToRad(47.0);
        const lookZ = 2.15;
        this.camTargetLook.set(0, -0.05, lookZ);
        this.camTargetPos.set(0, Math.sin(pitch) * dist, lookZ + Math.cos(pitch) * dist);
      }
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.02, 0.98);
    } else if (mode === 'INSPECT_16') {
      const fov = isLandscape ? 34 : aspect < 0.52 ? 42 : 38;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetLook.set(-0.5, 0.22, isLandscape ? 0.25 : 0.65);
      this.camTargetPos.set(-0.5, isLandscape ? 9.4 : 8.6, isLandscape ? 9.2 : 8.95);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.02, 0.98);
    } else if (isLandscape) {
      const rightPanelOpen = inDeploy || inGameOver;
      const shortLandscapePlay =
        !rightPanelOpen && !inReplay && (rect.height || 915) <= 640;
      const landscapePresets: Record<
        BoardViewAngle,
        { pitchDeg: number; fovDeg: number; heightOcc: number; lookZ: number }
      > = {
        COMMAND: {
          pitchDeg: rightPanelOpen ? 47.0 : inReplay ? 45.0 : 43.0,
          fovDeg: 38,
          heightOcc: rightPanelOpen ? 0.76 : inReplay ? 0.72 : shortLandscapePlay ? 0.75 : 0.8,
          lookZ: rightPanelOpen ? -0.15 : inReplay ? 0.85 : shortLandscapePlay ? 0.2 : -0.1,
        },
        TACTICAL: {
          pitchDeg: 32.5,
          fovDeg: 38,
          heightOcc: inReplay ? 0.72 : shortLandscapePlay ? 0.74 : 0.78,
          lookZ: inReplay ? 0.85 : shortLandscapePlay ? 0.3 : 0.1,
        },
        OVERHEAD: {
          pitchDeg: 62.0,
          fovDeg: 36,
          heightOcc: inReplay ? 0.73 : shortLandscapePlay ? 0.76 : 0.8,
          lookZ: inReplay ? 0.75 : shortLandscapePlay ? 0.05 : -0.35,
        },
      };
      const lSpec = landscapePresets[this.boardView];
      const finalPitchDeg = THREE.MathUtils.clamp(
        lSpec.pitchDeg + this.userPitchDeltaDeg,
        24.0,
        72.0
      );
      this.lastAppliedPitchDeg = finalPitchDeg;
      this.camera.fov = lSpec.fovDeg;
      this.camera.updateProjectionMatrix();

      const halfFovRad = THREE.MathUtils.degToRad(lSpec.fovDeg * 0.5);
      const tanHalfFov = Math.tan(halfFovRad);
      const pitchRad = THREE.MathUtils.degToRad(finalPitchDeg);
      const yawDeg = inReplay || inGameOver ? 0 : this.userYawDeltaDeg;
      const zoom = inReplay || inGameOver ? 1.0 : this.userZoomFactor;
      const yawRad = THREE.MathUtils.degToRad(yawDeg);
      const absYaw = Math.abs(yawRad);

      const boardW = 11.2;
      const boardD = 12.36;
      const effW = boardW * Math.cos(absYaw) + boardD * Math.sin(absYaw);
      const effD = boardD * Math.cos(absYaw) + boardW * Math.sin(absYaw);
      const projBoardH = effD * Math.sin(pitchRad) + 1.05 * Math.cos(pitchRad);
      const effectiveAspect = rightPanelOpen
        ? aspect * 0.62
        : shortLandscapePlay
          ? aspect * 0.74
          : aspect;
      const rHeight = projBoardH / lSpec.heightOcc / (2 * tanHalfFov);
      const rWidth = effW / (2 * tanHalfFov * effectiveAspect);

      const pieceHalfW = 4.55 * Math.cos(absYaw) + 4.2 * Math.sin(absYaw);
      const pieceHalfD = 4.2 * Math.cos(absYaw) + 4.55 * Math.sin(absYaw);
      const rPerspV =
        (pieceHalfD * (Math.sin(pitchRad) / 0.9 + Math.cos(pitchRad) * tanHalfFov)) / tanHalfFov;
      const rPerspH =
        (pieceHalfW / (0.92 * effectiveAspect) + pieceHalfD * Math.cos(pitchRad) * tanHalfFov) /
        tanHalfFov;
      const rPersp = Math.max(rPerspV, rPerspH);

      const baseDist = Math.max(rHeight, rWidth, rPersp);
      const rDist = THREE.MathUtils.clamp(baseDist * zoom, 5.5, 29.2);
      this.lastCameraDistance = rDist;

      const handSign = this.handedness === 'LEFT' ? -1 : 1;
      const lookX = rightPanelOpen ? 2.55 * handSign : shortLandscapePlay ? 1.55 * handSign : 0;
      const lookY = -0.12;
      const horizDist = rDist * Math.cos(pitchRad);
      this.camTargetLook.set(lookX, lookY, lSpec.lookZ);
      this.camTargetPos.set(
        lookX + horizDist * Math.sin(yawRad),
        lookY + rDist * Math.sin(pitchRad),
        lSpec.lookZ + horizDist * Math.cos(yawRad)
      );
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.04, 0.92);
    } else {
      // Portrait Safe-Zone Framing:
      // - `DEPLOY` / `ARMORY` / `GAME_OVER`: lift `frontNdcY` above lower 42% thumb sheet (`-0.22`)
      // - `REPLAY`: `-0.50`
      // - `PLAY`: `-0.68` so 78%+ of screen showcases the 3D board cleanly above the compact bottom dock!
      const bottomLock =
        inDeploy || inGameOver ? -0.22 : inReplay ? -0.5 : -0.68;
      const presetSpec: Record<
        BoardViewAngle,
        { pitchDeg: number; fovDeg: number; widthOcc: number; frontNdcY: number }
      > = {
        COMMAND: {
          pitchDeg: inDeploy ? 46.0 : inReplay ? 48.0 : 41.0,
          fovDeg: 43,
          widthOcc: 0.98,
          frontNdcY: bottomLock,
        },
        TACTICAL: { pitchDeg: 32.5, fovDeg: 46, widthOcc: 0.98, frontNdcY: bottomLock },
        OVERHEAD: { pitchDeg: 62.0, fovDeg: 41, widthOcc: 0.965, frontNdcY: bottomLock },
      };

      const spec = presetSpec[this.boardView];
      const finalPitchDeg = THREE.MathUtils.clamp(
        spec.pitchDeg + this.userPitchDeltaDeg,
        24.0,
        72.0
      );
      this.lastAppliedPitchDeg = finalPitchDeg;
      this.camera.fov = spec.fovDeg;
      this.camera.updateProjectionMatrix();

      const halfFovRad = THREE.MathUtils.degToRad(spec.fovDeg * 0.5);
      const pitchRad = THREE.MathUtils.degToRad(finalPitchDeg);
      const bolsterWidth = 10.18;

      const zEyeFront = bolsterWidth / spec.widthOcc / (2 * Math.tan(halfFovRad) * aspect);
      const yEyeFront = spec.frontNdcY * zEyeFront * Math.tan(halfFovRad);

      const sinP = Math.sin(pitchRad);
      const cosP = Math.cos(pitchRad);
      const frontY = -0.55;
      const frontZ = 5.65;

      const camY0 = frontY - (zEyeFront * -sinP + yEyeFront * cosP);
      const camZ0 = frontZ - (zEyeFront * -cosP + yEyeFront * -sinP);
      const lookY0 = camY0 - sinP * zEyeFront;
      const lookZ0 = camZ0 - cosP * zEyeFront;

      const yawDeg = inReplay || inGameOver ? 0 : this.userYawDeltaDeg;
      const zoom = inReplay || inGameOver ? 1.0 : this.userZoomFactor;
      const yawRad = THREE.MathUtils.degToRad(yawDeg);
      const absYaw = Math.abs(yawRad);

      if (absYaw < 0.0005 && Math.abs(zoom - 1.0) < 0.0005) {
        this.camTargetPos.set(0, camY0, camZ0);
        this.camTargetLook.set(0, lookY0, lookZ0);
        this.lastCameraDistance = zEyeFront;
      } else {
        const pivotY = lookY0;
        const pivotZ = THREE.MathUtils.lerp(lookZ0, GRID_CENTER_Z, Math.min(1, absYaw / 0.25));
        const dy0 = camY0 - pivotY;
        const dz0 = camZ0 - pivotZ;
        const baseDist = Math.hypot(dy0, dz0);
        const effHalfW = 5.09 * Math.cos(absYaw) + 4.9 * Math.sin(absYaw);
        const yawPullback = Math.max(1.0, (effHalfW / 5.09) * 1.04);
        const dist = THREE.MathUtils.clamp(baseDist * yawPullback * zoom, 5.5, 42.0);
        const horizDist = dist * cosP;
        this.camTargetLook.set(0, pivotY, pivotZ);
        this.camTargetPos.set(
          horizDist * Math.sin(yawRad),
          pivotY + dist * sinP,
          pivotZ + horizDist * Math.cos(yawRad)
        );
        this.lastCameraDistance = dist;
      }
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.04, 0.9);
    }
  }

  private getOrCreatePieceVisual(
    p: VisiblePieceView,
    viewingFaction: Faction,
    shrouded: boolean
  ): PieceVisualInstance {
    const faceCam = !shrouded && p.faction === viewingFaction;
    const key = `${p.faction}:${p.visibleRank}:k${p.publicKills}:tag${p.suspectTag ?? ''}:fc${faceCam}`;
    const existing = this.pieceVisuals.get(p.id);
    if (existing && existing.renderedKey === key) {
      return existing;
    }
    const vis = this.logicalToVisualCoord(p.col, p.row);
    const prevPos = existing ? existing.group.position.clone() : gridToWorld(vis.col, vis.row);
    if (existing) {
      this.boardPiecesRoot.remove(existing.group);
    }

    const group = this.factory.createCommandWedge(
      p.faction,
      p.visibleRank,
      p.publicKills,
      p.suspectTag,
      faceCam
    );
    group.traverse((obj) => {
      if (
        obj.name === 'wedgeAoDisc' ||
        obj.name === 'pieceHalo' ||
        obj instanceof THREE.Sprite ||
        obj instanceof THREE.LineSegments ||
        ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).geometry instanceof THREE.RingGeometry)
      ) {
        obj.raycast = () => {};
      }
    });
    const collider = new THREE.Mesh(this.pieceColliderGeo, this.pickColliderMat);
    collider.name = 'pieceCollider';
    collider.userData['pieceId'] = p.id;
    collider.castShadow = false;
    collider.receiveShadow = false;
    group.add(collider);

    group.userData['pieceId'] = p.id;
    group.position.copy(prevPos);
    this.boardPiecesRoot.add(group);

    const inst: PieceVisualInstance = {
      id: p.id,
      group,
      renderedKey: key,
      targetPos: gridToWorld(vis.col, vis.row),
    };
    this.pieceVisuals.set(p.id, inst);
    return inst;
  }

  private syncCasualties(list: readonly CasualtyView[], side: 'LEFT' | 'RIGHT'): void {
    const wellCenter = side === 'LEFT' ? LEFT_WELL_CENTER : RIGHT_WELL_CENTER;
    for (const item of list) {
      const key = `${side}:${item.id}:${item.visibleRank}`;
      if (this.casualtyVisuals.has(key)) continue;

      const wedge = this.factory.createCommandWedge(
        item.faction,
        item.visibleRank,
        0,
        null,
        item.visibleRank !== 'UNKNOWN'
      );
      wedge.scale.setScalar(0.64);

      const idx = item.casualtyIndex;
      const col = idx % 2;
      const row = Math.floor(idx / 2) % 3;
      const layer = Math.floor(idx / 6);

      const ox = (col - 0.5) * 0.44;
      const oz = (row - 1) * 0.52;
      const oy = -0.29 + layer * 0.24;

      wedge.position.set(wellCenter.x + ox, oy, wellCenter.z + oz);
      const baseYaw = item.visibleRank === 'UNKNOWN' ? Math.PI : 0;
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

  // ---------------------------------------------------------------------------
  // Pointer, `+28px` Lifted Hologram Drag, Field Manual Tap & `320ms` Suspect Wheel
  // ---------------------------------------------------------------------------

  private screenToBoardWorld(clientX: number, clientY: number, outWorld: THREE.Vector3): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster.ray.intersectPlane(this.raycastPlane, outWorld) !== null;
  }

  private updateHologramDragPosition(clientX: number, clientY: number): void {
    const drag = this.activeDrag;
    if (!drag) return;
    const worldPt = new THREE.Vector3();
    const yOffset = drag.mode === 'CRATE_DEPLOY' ? -28 : 0;
    if (!this.screenToBoardWorld(clientX, clientY + yOffset, worldPt)) return;

    drag.ghostGroup.position.set(worldPt.x, 0.34, worldPt.z);

    const vCol = Math.round(worldPt.x / TILE_PITCH + (BOARD_COLS - 1) / 2);
    const vRow = Math.round((worldPt.z - GRID_CENTER_Z) / TILE_PITCH + (BOARD_ROWS - 1) / 2);
    const logical = this.visualToLogicalCoord(vCol, vRow);

    if (drag.mode === 'CRATE_DEPLOY' || drag.mode === 'BOARD_DEPLOY') {
      if (isFactionHomeSquare(this.viewingFaction, logical.col, logical.row)) {
        drag.hoverCoord = logical;
        const snapped = gridToWorld(vCol, vRow);
        drag.ghostGroup.position.set(snapped.x, 0.34, snapped.z);
        this.indicatorLayer.setDragHoverCoord({ col: vCol, row: vRow });
      } else {
        drag.hoverCoord = null;
        this.indicatorLayer.setDragHoverCoord(null);
      }
    } else if (drag.mode === 'BOARD_PLAY' && drag.sourcePieceId) {
      const valid = this.store
        .computeValidMoves(drag.sourcePieceId)
        .find((m) => m.col === logical.col && m.row === logical.row);
      if (valid) {
        drag.hoverCoord = logical;
        const snapped = gridToWorld(vCol, vRow);
        drag.ghostGroup.position.set(snapped.x, 0.34, snapped.z);
        this.indicatorLayer.setDragHoverCoord({ col: vCol, row: vRow });
      } else {
        drag.hoverCoord = null;
        this.indicatorLayer.setDragHoverCoord(null);
      }
    }
  }

  private finishActiveDrag(clientX: number, clientY: number): void {
    const drag = this.activeDrag;
    if (!drag) return;
    this.updateHologramDragPosition(clientX, clientY);
    const target = drag.hoverCoord;
    this.clearActiveDrag();

    if (drag.mode === 'CRATE_DEPLOY') {
      if (target && this.store.placeOrSwapDeployment(target.col, target.row, drag.rank)) {
        this.sound.playMoveSlide();
        this.sound.playMagneticSnap();
      }
    } else if (drag.mode === 'BOARD_DEPLOY' && drag.sourcePieceId) {
      if (target) {
        if (
          this.store.placeOrSwapDeployment(target.col, target.row, undefined, drag.sourcePieceId)
        ) {
          this.sound.playMoveSlide();
          this.sound.playMagneticSnap();
        }
      } else {
        const pt = new THREE.Vector3();
        if (this.screenToBoardWorld(clientX, clientY, pt)) {
          const vRow = Math.round((pt.z - GRID_CENTER_Z) / TILE_PITCH + (BOARD_ROWS - 1) / 2);
          if (vRow > 7 && this.store.removeDeployedPiece(drag.sourcePieceId)) {
            this.sound.playUiClick();
          } else {
            this.syncFromStore(this.store.getVisibleView(), this.store.getOptions());
          }
        }
      }
    } else if (drag.mode === 'BOARD_PLAY' && drag.sourcePieceId && target) {
      const outcome = this.store.executeMoveOrChallenge(
        target.col,
        target.row,
        drag.sourcePieceId
      );
      if (outcome) {
        if (outcome.kind === 'MOVED') {
          this.sound.playMoveSlide();
        } else {
          this.triggerArbiterSequence(outcome.verdict);
        }
      } else {
        this.syncFromStore(this.store.getVisibleView(), this.store.getOptions());
      }
    } else {
      this.syncFromStore(this.store.getVisibleView(), this.store.getOptions());
    }
  }

  private clearActiveDrag(): void {
    if (!this.activeDrag) return;
    const sourceId = this.activeDrag.sourcePieceId;
    this.dragGhostRoot.clear();
    this.activeDrag = null;
    this.indicatorLayer.setDragHoverCoord(null);
    if (sourceId) {
      const srcInst = this.pieceVisuals.get(sourceId);
      if (srcInst) {
        srcInst.group.visible = true;
        srcInst.group.position.x = srcInst.targetPos.x;
        srcInst.group.position.z = srcInst.targetPos.z;
        const isSel = sourceId === this.selectedPieceId && this.cameraMode === 'PLAY';
        srcInst.group.position.y = isSel ? 0.08 : 0.0;
      }
      this.composer.render();
    }
  }

  private bindPointerInput(): void {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();
    const signal = this.inputAbort.signal;

    let pointerIdDown: number | null = null;
    let downButton = 0;
    let downX = 0;
    let downY = 0;
    let startPitchDelta = 0;
    let startYawDelta = 0;
    let draggedCamera = false;
    let candidateBoardPiece: VisiblePieceView | null = null;
    let longPressTimer: number | null = null;
    let longPressTriggered = false;
    let lastEnemyTapId: string | null = null;
    let lastEnemyTapTime = 0;

    const activePointers = new Map<number, { x: number; y: number }>();
    let prevPinchDist: number | null = null;

    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const isOrbitAllowed = (): boolean => {
      const v = this.store.getVisibleView();
      return (
        !this.arbiterStage.isBusy &&
        this.cameraMode === 'PLAY' &&
        this.phase !== 'TITLE' &&
        this.phase !== 'REPLAY' &&
        this.phase !== 'GAME_OVER' &&
        this.phase !== 'FIELD_MANUAL' &&
        !v.shroud?.active
      );
    };

    const raycastFieldManualRank = (clientX: number, clientY: number): RankId | null => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, this.camera);
      const hits = raycaster.intersectObjects(this.fieldManualRoot.children, true);
      for (const h of hits) {
        let cur: THREE.Object3D | null = h.object;
        while (cur) {
          if (typeof cur.userData['manualRank'] === 'string') {
            return cur.userData['manualRank'] as RankId;
          }
          cur = cur.parent;
        }
      }
      return null;
    };

    const raycastBoardPieceAndCoord = (
      clientX: number,
      clientY: number
    ): {
      piece: VisiblePieceView | null;
      coord: { col: number; row: number } | null;
      moveTargetCoord: { col: number; row: number } | null;
    } => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return { piece: null, coord: null, moveTargetCoord: null };
      }

      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, this.camera);

      const view = this.store.getVisibleView();
      const hits = raycaster.intersectObjects(this.boardPiecesRoot.children, true);
      const orderedPieceHits: Array<{
        piece: VisiblePieceView;
        localHitY: number;
      }> = [];
      const seenPieceIds = new Set<string>();
      for (const h of hits) {
        let cur: THREE.Object3D | null = h.object;
        let pid: string | null = null;
        while (cur) {
          if (typeof cur.userData['pieceId'] === 'string') {
            pid = cur.userData['pieceId'];
            break;
          }
          cur = cur.parent;
        }
        if (!pid || seenPieceIds.has(pid)) continue;
        seenPieceIds.add(pid);
        const pieceObj = view.pieces.find((p) => p.id === pid);
        const inst = this.pieceVisuals.get(pid);
        if (!pieceObj || !inst || !inst.group.visible) continue;
        const localHitY = h.point.y - inst.group.position.y;
        orderedPieceHits.push({ piece: pieceObj, localHitY });
        if (orderedPieceHits.length >= 2) break;
      }

      let byMesh: VisiblePieceView | undefined = orderedPieceHits[0]?.piece;
      if (orderedPieceHits.length >= 2) {
        const front = orderedPieceHits[0]!;
        const back = orderedPieceHits[1]!;
        if (front.localHitY >= 0.665 && back.localHitY <= 0.48) {
          byMesh = back.piece;
        }
      }

      let coord: { col: number; row: number } | null = null;
      const tileHits = raycaster.intersectObjects(this.tilePickCollidersRoot.children, false);
      if (tileHits.length > 0) {
        const ud = tileHits[0]!.object.userData;
        if (typeof ud['vCol'] === 'number' && typeof ud['vRow'] === 'number') {
          coord = this.visualToLogicalCoord(ud['vCol'], ud['vRow']);
        }
      } else if (raycaster.ray.intersectPlane(this.raycastPlane, hitPoint)) {
        const vCol = Math.round(hitPoint.x / TILE_PITCH + (BOARD_COLS - 1) / 2);
        const vRow = Math.round((hitPoint.z - GRID_CENTER_Z) / TILE_PITCH + (BOARD_ROWS - 1) / 2);
        if (vCol >= 0 && vCol < BOARD_COLS && vRow >= 0 && vRow < BOARD_ROWS) {
          coord = this.visualToLogicalCoord(vCol, vRow);
        }
      }

      const byCoord = coord
        ? view.pieces.find((p) => p.col === coord.col && p.row === coord.row)
        : undefined;

      // Priority Rule (a): In PLAY with an active selection, valid move/challenge targets win cleanly.
      if (this.phase === 'PLAY' && view.selectedPieceId) {
        const validByCoord = coord
          ? view.validMoves.find((m) => m.col === coord.col && m.row === coord.row)
          : undefined;
        const validByMesh = byMesh
          ? view.validMoves.find(
              (m) =>
                m.targetPieceId === byMesh.id ||
                (m.col === byMesh.col && m.row === byMesh.row)
            )
          : undefined;

        if (validByCoord && byMesh?.id !== view.selectedPieceId) {
          const targetCoord = { col: validByCoord.col, row: validByCoord.row };
          return {
            piece: byMesh ?? byCoord ?? null,
            coord: targetCoord,
            moveTargetCoord: targetCoord,
          };
        }
        if (validByMesh) {
          const targetCoord = { col: validByMesh.col, row: validByMesh.row };
          return {
            piece: byMesh ?? null,
            coord: targetCoord,
            moveTargetCoord: targetCoord,
          };
        }
      }

      // Priority Rule (b): Front-most byMesh strictly precedes background y=0.022 byCoord!
      return {
        piece: byMesh ?? byCoord ?? null,
        coord,
        moveTargetCoord: null,
      };
    };

    this.renderer.domElement.addEventListener(
      'contextmenu',
      (ev: MouseEvent) => {
        ev.preventDefault();
      },
      { signal }
    );

    this.renderer.domElement.addEventListener(
      'wheel',
      (ev: WheelEvent) => {
        if (!isOrbitAllowed()) return;
        ev.preventDefault();
        const sens = THREE.MathUtils.clamp(this.cameraSensitivity, 0.35, 2.5);
        const delta = THREE.MathUtils.clamp(ev.deltaY, -360, 360);
        this.userZoomFactor = THREE.MathUtils.clamp(
          this.userZoomFactor * Math.exp(delta * 0.0012 * sens),
          0.68,
          1.35
        );
        this.updateCameraTargets(this.cameraMode);
      },
      { passive: false, signal }
    );

    this.renderer.domElement.addEventListener(
      'pointerdown',
      (ev: PointerEvent) => {
        this.sound.unlock();
        try {
          this.renderer.domElement.setPointerCapture(ev.pointerId);
        } catch {
          // Ignore synthetic/unsupported capture
        }
        activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

        if (activePointers.size === 2) {
          cancelLongPress();
          candidateBoardPiece = null;
          pointerIdDown = null;
          draggedCamera = false;
          const pts = Array.from(activePointers.values());
          prevPinchDist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
          return;
        }

        if (this.arbiterStage.isBusy) {
          const nowMs = performance.now();
          if (nowMs - this.lastArbiterTapTime < 360) {
            // Double-tap during Act 1 / Act 2 skips straight to Act 3 Verdict!
            this.lastArbiterTapTime = 0;
            this.arbiterStage.skipToVerdictAct3();
            return;
          }
          this.lastArbiterTapTime = nowMs;
          this.arbiterStage.setOverdriveHeld(true);
          return;
        }

        if (this.cameraMode === 'FIELD_MANUAL' || this.phase === 'FIELD_MANUAL') {
          const rankHit = raycastFieldManualRank(ev.clientX, ev.clientY);
          if (rankHit) {
            this.sound.playPiecePickup();
            this.store.selectFieldManualRank(rankHit);
          }
          return;
        }

        const view = this.store.getVisibleView();
        if (
          this.cameraMode !== 'PLAY' ||
          this.phase === 'REPLAY' ||
          this.phase === 'GAME_OVER' ||
          this.phase === 'TITLE' ||
          view.shroud?.active
        ) {
          return;
        }

        pointerIdDown = ev.pointerId;
        downButton = ev.button;
        downX = ev.clientX;
        downY = ev.clientY;
        startPitchDelta = this.userPitchDeltaDeg;
        startYawDelta = this.userYawDeltaDeg;
        draggedCamera = false;
        longPressTriggered = false;

        if (ev.button === 2) {
          candidateBoardPiece = null;
          return;
        }

        const { piece } = raycastBoardPieceAndCoord(ev.clientX, ev.clientY);
        candidateBoardPiece = piece && piece.faction === view.viewingFaction ? piece : null;

        // 320ms Long-Press Detector on Unmarked Opponent Pieces -> Opens Radial Suspect Wheel!
        if (piece && piece.faction !== view.viewingFaction && this.phase === 'PLAY') {
          const enemyId = piece.id;
          const sx = ev.clientX;
          const sy = ev.clientY;
          cancelLongPress();
          longPressTimer = window.setTimeout(() => {
            longPressTimer = null;
            longPressTriggered = true;
            this.sound.playUiClick();
            this.onOpenSuspectWheel?.(enemyId, sx, sy);
          }, 320);
        }
      },
      { signal }
    );

    window.addEventListener(
      'pointermove',
      (ev: PointerEvent) => {
        if (activePointers.has(ev.pointerId)) {
          activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        }

        if (activePointers.size === 2) {
          if (!isOrbitAllowed()) return;
          const pts = Array.from(activePointers.values());
          const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
          if (prevPinchDist !== null && prevPinchDist > 8 && dist > 8) {
            const ratio = prevPinchDist / dist;
            this.userZoomFactor = THREE.MathUtils.clamp(
              this.userZoomFactor * ratio,
              0.68,
              1.35
            );
            this.updateCameraTargets(this.cameraMode);
          }
          prevPinchDist = dist;
          return;
        }

        if (this.activeDrag) {
          this.updateHologramDragPosition(ev.clientX, ev.clientY);
          return;
        }
        if (pointerIdDown !== ev.pointerId || this.arbiterStage.isBusy || this.cameraMode !== 'PLAY') {
          return;
        }

        const dy = ev.clientY - downY;
        const dx = ev.clientX - downX;
        const moveDist = Math.hypot(dx, dy);
        if (moveDist > 8) {
          cancelLongPress();
        }

        const view = this.store.getVisibleView();
        if (
          downButton !== 2 &&
          candidateBoardPiece &&
          candidateBoardPiece.visibleRank !== 'UNKNOWN' &&
          moveDist > 9 &&
          (this.isDeployLikePhase() ||
            (this.phase === 'PLAY' && view.activeTurn === view.viewingFaction))
        ) {
          const rank = candidateBoardPiece.visibleRank;
          const pid = candidateBoardPiece.id;
          candidateBoardPiece = null;
          this.sound.playPiecePickup();
          if (this.phase === 'PLAY' && view.selectedPieceId !== pid) {
            this.store.selectPiece(pid);
          }
          const ghost = this.factory.createHologramGhostWedge(rank);
          this.dragGhostRoot.add(ghost);
          const srcInst = this.pieceVisuals.get(pid);
          if (srcInst) srcInst.group.visible = false;

          this.activeDrag = {
            mode: this.isDeployLikePhase() ? 'BOARD_DEPLOY' : 'BOARD_PLAY',
            rank,
            sourcePieceId: pid,
            ghostGroup: ghost,
            hoverCoord: null,
          };
          this.updateHologramDragPosition(ev.clientX, ev.clientY);
          return;
        }

        if ((downButton === 2 || !candidateBoardPiece) && !draggedCamera && moveDist > 8) {
          draggedCamera = true;
        }
        if (draggedCamera && isOrbitAllowed()) {
          const sens = THREE.MathUtils.clamp(this.cameraSensitivity, 0.35, 2.5);
          const invSign = this.cameraInvertOrbit ? -1 : 1;
          const basePitch = this.getBasePitchDeg();
          this.userYawDeltaDeg = THREE.MathUtils.clamp(
            startYawDelta + dx * 0.16 * sens * invSign,
            -38.0,
            38.0
          );
          this.userPitchDeltaDeg = THREE.MathUtils.clamp(
            startPitchDelta + dy * 0.14 * sens,
            24.0 - basePitch,
            72.0 - basePitch
          );
          this.updateCameraTargets('PLAY');
        }
      },
      { signal }
    );

    const releasePointerTracking = (ev: PointerEvent) => {
      activePointers.delete(ev.pointerId);
      if (activePointers.size < 2) {
        prevPinchDist = null;
      }
      try {
        if (this.renderer.domElement.hasPointerCapture(ev.pointerId)) {
          this.renderer.domElement.releasePointerCapture(ev.pointerId);
        }
      } catch {
        // Ignore
      }
    };

    const onPointerRelease = (ev: PointerEvent) => {
      releasePointerTracking(ev);
      cancelLongPress();
      this.arbiterStage.setOverdriveHeld(false);

      if (this.activeDrag) {
        pointerIdDown = null;
        candidateBoardPiece = null;
        this.finishActiveDrag(ev.clientX, ev.clientY);
        return;
      }

      if (pointerIdDown !== ev.pointerId) return;
      const wasDrag = draggedCamera;
      const btn = downButton;
      pointerIdDown = null;
      candidateBoardPiece = null;
      draggedCamera = false;

      const view = this.store.getVisibleView();
      if (
        btn === 2 ||
        longPressTriggered ||
        wasDrag ||
        this.arbiterStage.isBusy ||
        this.cameraMode !== 'PLAY' ||
        view.shroud?.active
      ) {
        return;
      }

      const { piece, coord, moveTargetCoord } = raycastBoardPieceAndCoord(ev.clientX, ev.clientY);
      const ownFac = view.viewingFaction;

      // DEPLOYMENT & ARMORY PHASE TAP FLOW
      if (this.isDeployLikePhase()) {
        if (view.selectedPieceId && piece && piece.id === view.selectedPieceId) {
          this.sound.playUiClick();
          this.store.selectPiece(null);
          return;
        }
        const deployCoord = piece && piece.faction === ownFac ? { col: piece.col, row: piece.row } : coord;
        if (deployCoord && isFactionHomeSquare(ownFac, deployCoord.col, deployCoord.row)) {
          if (piece && piece.faction === ownFac && !view.selectedDeployRank && !view.selectedPieceId) {
            this.sound.playPiecePickup();
            this.store.selectPiece(piece.id);
            return;
          }
          if (this.store.placeOrSwapDeployment(deployCoord.col, deployCoord.row)) {
            this.sound.playMoveSlide();
            this.sound.playMagneticSnap();
            return;
          }
          if (piece && piece.faction === ownFac) {
            this.sound.playPiecePickup();
            this.store.selectPiece(piece.id);
          }
        }
        return;
      }

      // ACTIVE PLAY PHASE TAP FLOW + `< 320ms` DOUBLE-TAP OPPONENT SUSPECT TAGGING!
      if (this.phase === 'PLAY') {
        if (piece && piece.faction !== ownFac) {
          const nowMs = performance.now();
          if (lastEnemyTapId === piece.id && nowMs - lastEnemyTapTime < 320) {
            lastEnemyTapId = null;
            this.sound.playUiClick();
            this.onOpenSuspectWheel?.(piece.id, ev.clientX, ev.clientY);
            return;
          }
          lastEnemyTapId = piece.id;
          lastEnemyTapTime = nowMs;
        } else {
          lastEnemyTapId = null;
        }

        if (moveTargetCoord) {
          const outcome = this.store.executeMoveOrChallenge(
            moveTargetCoord.col,
            moveTargetCoord.row
          );
          if (outcome) {
            if (outcome.kind === 'MOVED') {
              const movedPiece = this.store
                .getVisibleView()
                .pieces.find(
                  (p) => p.col === moveTargetCoord.col && p.row === moveTargetCoord.row
                );
              this.sound.playMoveSlide(movedPiece?.publicKills ?? 0);
            } else {
              this.triggerArbiterSequence(outcome.verdict);
            }
            return;
          }
        }

        if (piece && piece.faction === ownFac) {
          const deselecting = view.selectedPieceId === piece.id;
          if (deselecting) {
            this.sound.playUiClick();
          } else {
            this.sound.playPiecePickup();
          }
          this.store.selectPiece(piece.id);
        } else if (!piece || piece.faction === ownFac) {
          this.store.selectPiece(null);
        }
      }
    };

    window.addEventListener('pointerup', onPointerRelease, { signal });
    window.addEventListener(
      'pointercancel',
      (ev: PointerEvent) => {
        releasePointerTracking(ev);
        cancelLongPress();
        this.arbiterStage.setOverdriveHeld(false);
        const hadActiveDrag = Boolean(this.activeDrag);
        this.clearActiveDrag();
        pointerIdDown = null;
        candidateBoardPiece = null;
        draggedCamera = false;
        if (hadActiveDrag) {
          this.syncFromStore(this.store.getVisibleView(), this.store.getOptions());
        }
      },
      { signal }
    );
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
    this.snapCameraImmediately();
    this.composer.render();
    this.clock.getDelta();
  }
}
