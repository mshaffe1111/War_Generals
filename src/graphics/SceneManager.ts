import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ArbiterStage3D } from '../arbiter/ArbiterStage3D';
import type { SoundDirector } from '../audio/SoundDirector';
import { BOARD_COLS, BOARD_ROWS, type Faction, type RankId } from '../core/ranks';
import { isFactionHomeSquare } from '../core/RulesEngine';
import type {
  AppOptions,
  ArbiterVerdict,
  BoardViewAngle,
  CameraMode,
  CasualtyView,
  FieldManualEntry,
  MatchPhase,
  MoveDirection,
  PlayerVisibleView,
  ReplayPlyEntry,
  ValidMoveTarget,
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

  private readonly boardPiecesRoot = new THREE.Group();
  private readonly replayPiecesRoot = new THREE.Group();
  private readonly fieldManualRoot = new THREE.Group();
  private readonly dragGhostRoot = new THREE.Group();
  private readonly onBoardInspectGroup: THREE.Group;
  private readonly casualtyPiecesRoot = new THREE.Group();
  private readonly indicatorLayer = new TileIndicatorLayer();
  private readonly raycastPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly pieceVisuals = new Map<string, PieceVisualInstance>();
  private readonly casualtyVisuals = new Map<string, THREE.Group>();
  private renderedReplayKey = '';
  private renderedManualKey = '';

  private phase: MatchPhase = 'TITLE';
  private viewingFaction: Faction = 'PLAYER';
  private cameraMode: CameraMode = 'TITLE';
  private boardView: BoardViewAngle = 'COMMAND';
  private selectedPieceId: string | null = null;
  private turnClockSec = 45;
  private userPitchDeltaDeg = 0;

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
    this.scene.background = this.defaultBgColor.clone();
    this.scene.fog = new THREE.FogExp2('#07090e', 0.012);

    this.scene.environment = createStudioLanternEnvMap(this.renderer);

    this.camera = new THREE.PerspectiveCamera(48, 9 / 16, 0.25, 95);
    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);

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

    this.rimShadowSpot = new THREE.SpotLight(0xffb86b, 4.2, 42, Math.PI / 3.2, 0.72, 0.85);
    this.rimShadowSpot.position.set(8.5, 8.2, -10.5);
    this.rimShadowSpot.target.position.set(0, -0.1, 0.5);
    this.rimShadowSpot.castShadow = true;
    this.rimShadowSpot.shadow.mapSize.set(2048, 2048);
    this.rimShadowSpot.shadow.bias = -0.0003;
    this.rimShadowSpot.shadow.normalBias = 0.01;
    this.scene.add(this.rimShadowSpot, this.rimShadowSpot.target);

    this.insigniaCatchLight = new THREE.DirectionalLight(0xfff0d6, 0.88);
    this.insigniaCatchLight.position.set(1.6, 4.4, 14.5);
    this.insigniaCatchLight.target.position.set(0, 0.35, 0.8);
    this.scene.add(this.insigniaCatchLight, this.insigniaCatchLight.target);

    this.selectedPieceLight = new THREE.PointLight(0xffe6b0, 0.0, 2.05, 2.0);
    this.scene.add(this.selectedPieceLight);

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
    this.scene.add(this.replayPiecesRoot);
    this.scene.add(this.fieldManualRoot);
    this.scene.add(this.dragGhostRoot);
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
    const maxDpr = options.renderQuality === 'ULTRA' ? 2.5 : 1.5;
    const desiredDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (Math.abs(this.renderer.getPixelRatio() - desiredDpr) > 0.01) {
      this.renderer.setPixelRatio(desiredDpr);
      this.handleResize();
    }
    this.tiltShiftPass.enabled =
      options.renderQuality === 'ULTRA' &&
      view.cameraMode !== 'INSPECT_16' &&
      view.cameraMode !== 'REPLAY' &&
      view.cameraMode !== 'FIELD_MANUAL';

    if (this.boardView !== options.boardView) {
      this.boardView = options.boardView;
      this.userPitchDeltaDeg = 0;
    }

    this.phase = view.phase;
    this.viewingFaction = view.viewingFaction;
    this.selectedPieceId = view.selectedPieceId;
    this.turnClockSec = view.turnClockSec;
    this.cameraMode = view.cameraMode;
    this.updateCameraTargets(view.cameraMode);

    const isReplay = view.phase === 'REPLAY' || view.cameraMode === 'REPLAY';
    const isFieldManual = view.phase === 'FIELD_MANUAL' || view.cameraMode === 'FIELD_MANUAL';
    const isInspect = view.cameraMode === 'INSPECT_16';

    this.targetRoomDimFactor =
      view.cameraMode === 'ARBITER' ? 0.56 : isReplay ? 0.34 : view.phase === 'TITLE' ? 0.92 : 1.0;
    (this.scene.background as THREE.Color).copy(
      isReplay ? this.replayBgColor : this.defaultBgColor
    );

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

    // Sync final-10-second Round Timer urgency tick with SoundDirector!
    if (this.cameraMode === 'PLAY' && this.phase === 'PLAY' && !this.arbiterStage.isBusy) {
      this.sound.setTurnWarningUrgent(this.turnClockSec <= 10);
    } else {
      this.sound.setTurnWarningUrgent(false);
    }

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
    const isReplay = this.phase === 'REPLAY' || this.cameraMode === 'REPLAY';
    this.keyShadowLight.color.setHex(isReplay ? 0x6cd4ff : 0xffe0b5);
    this.keyShadowLight.intensity = isReplay
      ? 1.45
      : THREE.MathUtils.lerp(2.15, 3.25, this.roomDimFactor);
    this.insigniaCatchLight.intensity = isReplay
      ? 0.95
      : THREE.MathUtils.lerp(0.55, 0.92, this.roomDimFactor);
    this.rimShadowSpot.intensity = 4.2 * this.roomDimFactor;
    this.ambientFill.intensity = isReplay
      ? 0.24
      : THREE.MathUtils.lerp(0.06, 0.09, this.roomDimFactor);
    this.arbiterHeroSpot.intensity = isReplay ? 0 : (1 - this.roomDimFactor) * 2.1;

    const tentBright = isReplay ? 0.18 : THREE.MathUtils.lerp(0.68, 0.85, this.roomDimFactor);
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
    this.warRoom.tentBackdropMesh.position.y = THREE.MathUtils.clamp(yAtUpper - 1.4, 2.5, 3.75);
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
        this.camTargetLook.set(2.25, 0.12, 0.55);
        this.camTargetPos.set(2.25, 8.2, 8.6);
      } else {
        // Compute exact aspect-aware distance so all 5 columns (`width = 8.4`) fit 100% uncropped in 9:16 Portrait!
        const halfFov = THREE.MathUtils.degToRad(fov * 0.5);
        const dist = Math.max(13.2, 8.55 / (2 * Math.tan(halfFov) * aspect));
        const pitch = THREE.MathUtils.degToRad(47.0);
        const lookZ = 2.15;
        this.camTargetLook.set(0, -0.05, lookZ);
        this.camTargetPos.set(0, Math.sin(pitch) * dist, lookZ + Math.cos(pitch) * dist);
      }
    } else if (mode === 'INSPECT_16') {
      const fov = isLandscape ? 34 : aspect < 0.52 ? 42 : 38;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetLook.set(-0.5, 0.22, isLandscape ? 0.25 : 0.65);
      this.camTargetPos.set(-0.5, isLandscape ? 9.4 : 8.6, isLandscape ? 9.2 : 8.95);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.02, 0.98);
    } else if (isLandscape) {
      const rightPanelOpen = inDeploy || inGameOver;
      const landscapePresets: Record<
        BoardViewAngle,
        { pitchDeg: number; fovDeg: number; heightOcc: number; lookZ: number }
      > = {
        COMMAND: {
          pitchDeg: rightPanelOpen ? 47.0 : inReplay ? 45.0 : 43.0,
          fovDeg: 38,
          heightOcc: rightPanelOpen ? 0.76 : inReplay ? 0.72 : 0.8,
          lookZ: rightPanelOpen ? -0.15 : inReplay ? 0.85 : -0.1,
        },
        TACTICAL: {
          pitchDeg: 32.5,
          fovDeg: 38,
          heightOcc: inReplay ? 0.72 : 0.78,
          lookZ: inReplay ? 0.85 : 0.1,
        },
        OVERHEAD: {
          pitchDeg: 62.0,
          fovDeg: 36,
          heightOcc: inReplay ? 0.73 : 0.8,
          lookZ: inReplay ? 0.75 : -0.35,
        },
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
      const effectiveAspect = rightPanelOpen ? aspect * 0.62 : aspect;
      const rHeight = projBoardH / lSpec.heightOcc / (2 * Math.tan(halfFovRad));
      const rWidth = 11.2 / (2 * Math.tan(halfFovRad) * effectiveAspect);
      const rDist = Math.max(rHeight, rWidth);

      const lookX = rightPanelOpen ? 2.55 : 0;
      const lookY = -0.12;
      this.camTargetLook.set(lookX, lookY, lSpec.lookZ);
      this.camTargetPos.set(
        lookX,
        lookY + rDist * Math.sin(pitchRad),
        lSpec.lookZ + rDist * Math.cos(pitchRad)
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
        70.0
      );
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

      const camY = frontY - (zEyeFront * -sinP + yEyeFront * cosP);
      const camZ = frontZ - (zEyeFront * -cosP + yEyeFront * -sinP);

      this.camTargetPos.set(0, camY, camZ);
      this.camTargetLook.set(0, camY - sinP * zEyeFront, camZ - cosP * zEyeFront);
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
    if (!this.screenToBoardWorld(clientX, clientY - 28, worldPt)) return;

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
    this.dragGhostRoot.clear();
    this.activeDrag = null;
    this.indicatorLayer.setDragHoverCoord(null);
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
    let candidateBoardPiece: VisiblePieceView | null = null;
    let longPressTimer: number | null = null;
    let longPressTriggered = false;
    let lastEnemyTapId: string | null = null;
    let lastEnemyTapTime = 0;

    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
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
    ): { piece: VisiblePieceView | null; coord: { col: number; row: number } | null } => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { piece: null, coord: null };

      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, this.camera);

      const view = this.store.getVisibleView();
      let hitId: string | null = null;
      const hits = raycaster.intersectObjects(this.boardPiecesRoot.children, true);
      if (hits.length > 0) {
        let cur: THREE.Object3D | null = hits[0]!.object;
        while (cur) {
          if (typeof cur.userData['pieceId'] === 'string') {
            hitId = cur.userData['pieceId'];
            break;
          }
          cur = cur.parent;
        }
      }

      let coord: { col: number; row: number } | null = null;
      if (raycaster.ray.intersectPlane(this.raycastPlane, hitPoint)) {
        const vCol = Math.round(hitPoint.x / TILE_PITCH + (BOARD_COLS - 1) / 2);
        const vRow = Math.round((hitPoint.z - GRID_CENTER_Z) / TILE_PITCH + (BOARD_ROWS - 1) / 2);
        if (vCol >= 0 && vCol < BOARD_COLS && vRow >= 0 && vRow < BOARD_ROWS) {
          coord = this.visualToLogicalCoord(vCol, vRow);
        }
      }

      const byCoord = coord
        ? view.pieces.find((p) => p.col === coord.col && p.row === coord.row)
        : undefined;
      const byMesh = hitId ? view.pieces.find((p) => p.id === hitId) : undefined;
      return { piece: byCoord ?? byMesh ?? null, coord };
    };

    this.renderer.domElement.addEventListener('pointerdown', (ev: PointerEvent) => {
      this.sound.unlock();

      if (this.arbiterStage.isBusy) {
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
      downX = ev.clientX;
      downY = ev.clientY;
      startPitchDelta = this.userPitchDeltaDeg;
      draggedCamera = false;
      longPressTriggered = false;

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
    });

    window.addEventListener('pointermove', (ev: PointerEvent) => {
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
      if (moveDist > 10) {
        cancelLongPress();
      }

      const view = this.store.getVisibleView();
      if (
        candidateBoardPiece &&
        candidateBoardPiece.visibleRank !== 'UNKNOWN' &&
        moveDist > 13 &&
        (this.isDeployLikePhase() ||
          (this.phase === 'PLAY' && view.activeTurn === view.viewingFaction))
      ) {
        const rank = candidateBoardPiece.visibleRank;
        const pid = candidateBoardPiece.id;
        candidateBoardPiece = null;
        this.sound.playPiecePickup();
        if (this.phase === 'PLAY') {
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

      if (
        !candidateBoardPiece &&
        !draggedCamera &&
        Math.abs(dy) > 14 &&
        Math.abs(dy) > Math.abs(dx) * 1.25
      ) {
        draggedCamera = true;
      }
      if (draggedCamera) {
        this.userPitchDeltaDeg = THREE.MathUtils.clamp(startPitchDelta + dy * 0.12, -10, 32);
        this.updateCameraTargets('PLAY');
      }
    });

    const onPointerRelease = (ev: PointerEvent) => {
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
      pointerIdDown = null;
      candidateBoardPiece = null;
      draggedCamera = false;

      const view = this.store.getVisibleView();
      if (
        longPressTriggered ||
        wasDrag ||
        this.arbiterStage.isBusy ||
        this.cameraMode !== 'PLAY' ||
        view.shroud?.active
      ) {
        return;
      }

      const { piece, coord } = raycastBoardPieceAndCoord(ev.clientX, ev.clientY);
      const ownFac = view.viewingFaction;

      // DEPLOYMENT & ARMORY PHASE TAP FLOW
      if (this.isDeployLikePhase()) {
        if (coord && isFactionHomeSquare(ownFac, coord.col, coord.row)) {
          if (piece && piece.faction === ownFac && !view.selectedDeployRank && !view.selectedPieceId) {
            this.sound.playPiecePickup();
            this.store.selectPiece(piece.id);
            return;
          }
          if (this.store.placeOrSwapDeployment(coord.col, coord.row)) {
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

        if (coord) {
          const outcome = this.store.executeMoveOrChallenge(coord.col, coord.row);
          if (outcome) {
            if (outcome.kind === 'MOVED') {
              const movedPiece = this.store
                .getVisibleView()
                .pieces.find((p) => p.col === coord.col && p.row === coord.row);
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

    window.addEventListener('pointerup', onPointerRelease);
    window.addEventListener('pointercancel', () => {
      cancelLongPress();
      this.arbiterStage.setOverdriveHeld(false);
      this.clearActiveDrag();
      pointerIdDown = null;
      candidateBoardPiece = null;
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
    this.snapCameraImmediately();
    this.composer.render();
  }
}
