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

  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
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
  private readonly camCurrentPos = new THREE.Vector3(0, 17.6, 15.8);
  private readonly camCurrentLook = new THREE.Vector3(0, -0.25, -0.75);
  private readonly camTargetPos = new THREE.Vector3(0, 17.6, 15.8);
  private readonly camTargetLook = new THREE.Vector3(0, -0.25, -0.75);
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
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c0a09');
    this.scene.fog = new THREE.FogExp2('#0e0b09', 0.022);

    // Warm procedural studio + dual tent-lantern HDRI via PMREMGenerator
    this.scene.environment = createStudioLanternEnvMap(this.renderer);

    this.camera = new THREE.PerspectiveCamera(50, 9 / 16, 0.25, 85);
    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);

    // Tightly frustum-fitted 2048x2048 tabletop Directional Key Light (calibrated < bloom threshold!)
    this.keyLight = new THREE.DirectionalLight(0xffeed8, 1.55);
    this.keyLight.position.set(5.2, 13.5, 8.2);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 2.0;
    this.keyLight.shadow.camera.far = 32.0;
    this.keyLight.shadow.camera.left = -6.8;
    this.keyLight.shadow.camera.right = 6.8;
    this.keyLight.shadow.camera.top = 7.8;
    this.keyLight.shadow.camera.bottom = -8.2;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.018;
    this.scene.add(this.keyLight);

    // Cool steel rim light to sculpt chamfered edges on Navy & Crimson wedges
    this.rimLight = new THREE.DirectionalLight(0x9ec6f0, 0.72);
    this.rimLight.position.set(-7.5, 9.5, -6.5);
    this.scene.add(this.rimLight);

    this.ambientFill = new THREE.HemisphereLight(0xffe8cc, 0x18202c, 0.52);
    this.scene.add(this.ambientFill);

    // Dedicated warm hero spotlight (shadow-free so the elevated winning wedge never casts a dark shadow onto the CRT!)
    this.arbiterHeroSpot = new THREE.SpotLight(0xffe4bc, 0.0, 20, Math.PI / 3.2, 0.65, 1.3);
    this.arbiterHeroSpot.castShadow = false;
    this.arbiterHeroSpot.position.set(0, 7.2, 1.2);
    this.arbiterHeroSpot.target.position.set(0, 0.1, ARBITER_BAY_CENTER_Z + 0.6);
    this.scene.add(this.arbiterHeroSpot, this.arbiterHeroSpot.target);

    // Build 3D World: War-Room Backdrop, Walnut 9x8 Cabinet, 16-Emblem Inspection Stage, Electronic Arbiter
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

    // Load Blender-baked `.glb` shutter mesh asynchronously and attach cleanly
    void this.factory.preloadBakedModels().then(() => {
      this.arbiterStage.attachBakedShutterIfReady();
    });

    // Post-Processing Pipeline: RenderPass -> UnrealBloomPass(0.82, 0.55, 0.35) -> OutputPass -> TiltShiftDoFPass
    const initRect = this.host.getBoundingClientRect();
    const w = Math.max(1, initRect.width || 412);
    const h = Math.max(1, initRect.height || 915);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Selective Bloom (`threshold: 1.18`) so ONLY HDR emissive rings, tubes, CRT, and sparks glow—
    // NEVER washing out oiled walnut, parchment maps, cobalt-navy wedges, or silver/brass reliefs!
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.3, 1.18);
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
    // 1. Apply render quality & DPR
    const maxDpr = options.renderQuality === 'ULTRA' ? 2.5 : 1.5;
    const desiredDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (Math.abs(this.renderer.getPixelRatio() - desiredDpr) > 0.01) {
      this.renderer.setPixelRatio(desiredDpr);
      this.handleResize();
    }
    this.tiltShiftPass.enabled =
      options.renderQuality === 'ULTRA' && view.cameraMode !== 'INSPECT_16';

    // 2. Camera preset & room light dimming (55% dim during Electronic Arbiter battle!)
    this.cameraMode = view.cameraMode;
    this.updateCameraTargets(view.cameraMode);
    this.targetRoomDimFactor = view.cameraMode === 'ARBITER' ? 0.45 : 1.0;

    // 3. Sync alive board wedges (hide non-clashing board wedges during Arbiter hero close-up so
    //    the foreground Attack Medallion is 100% unobstructed matching `ref_battle_act1..3.webp`!)
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

    // 4. Sync Velvet Casualty Wells (Player = Left Navy Well, Enemy = Right Crimson Well face-down!)
    this.syncCasualties(view.playerCasualties, 'LEFT');
    this.syncCasualties(view.enemyCasualties, 'RIGHT');

    // 5. Sync glowing cyan move outlines/arrows & pulsing crimson-gold saber reticles
    const selectedPiece = view.selectedPieceId
      ? view.pieces.find((p) => p.id === view.selectedPieceId)
      : undefined;
    this.indicatorLayer.sync(
      selectedPiece ? { col: selectedPiece.col, row: selectedPiece.row } : null,
      view.validMoves,
      view.cameraMode === 'PLAY' && !view.activeClash
    );
  }

  /**
   * Starts the 3-Act Electronic Arbiter choreography on the 3D stage and places
   * the heavy brushed-brass Attack Medallion in the hero foreground square `(col=4, row=0)`.
   */
  public triggerArbiterSequence(verdict: ArbiterVerdict): void {
    const playerVisual = this.pieceVisuals.get(verdict.playerPieceId);
    const enemyVisual = this.pieceVisuals.get(verdict.enemyPieceId);

    const pOrigin = playerVisual
      ? playerVisual.group.position.clone()
      : gridToWorld(4, 4);
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

    // Position the heavy chamfered Attack Medallion on the foreground ceremonial challenge tile
    // right in front of the Electronic Arbiter so every battle matches `ref_battle_act1..3.jpg`!
    const ceremonialSq = gridToWorld(4, 0);
    this.arbiterStage.worldMedallionGroup.position.set(ceremonialSq.x, 0, ceremonialSq.z);

    // Snap camera smoothly into the Arbiter close-up
    this.updateCameraTargets('ARBITER');
  }

  public snapCameraImmediately(): void {
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
    // 1. Live pocket watch ticking second hand + subtle 2700K Perlin-like oil lantern flicker!
    const discreteSec = Math.floor(elapsed);
    const tickFrac = Math.min(1, (elapsed - discreteSec) * 8);
    this.warRoom.watchSecondHand.rotation.y = -((discreteSec + tickFrac) / 60) * Math.PI * 2;

    const flickerL =
      1.0 + 0.08 * Math.sin(elapsed * 7.3) + 0.05 * Math.sin(elapsed * 17.9 + 1.2);
    const flickerR =
      1.0 + 0.07 * Math.cos(elapsed * 6.4 + 0.7) + 0.05 * Math.sin(elapsed * 15.1);
    this.warRoom.lanternLightLeft.intensity = 3.6 * flickerL * (0.7 + 0.3 * this.roomDimFactor);
    this.warRoom.lanternLightRight.intensity = 3.2 * flickerR * (0.7 + 0.3 * this.roomDimFactor);

    // 2. Smoothly damp room lighting dim (55% dim during battle!) & hero spot
    const damp = 1 - Math.exp(-dt * 6.5);
    this.roomDimFactor = THREE.MathUtils.lerp(this.roomDimFactor, this.targetRoomDimFactor, damp);
    this.arbiterStage.update(dt, elapsed);
    this.indicatorLayer.update(elapsed);

    // 3. Smoothly slide board pieces to target grid coordinates
    const pieceSlide = 1 - Math.exp(-dt * 14.0);
    for (const inst of this.pieceVisuals.values()) {
      inst.group.position.lerp(inst.targetPos, pieceSlide);
    }

    // 4. Smoothly damp camera position & lookAt target (fast crisp lock for gallery/arbiter cuts)
    const speed = this.cameraMode === 'INSPECT_16' ? 14.0 : 8.5;
    const camDamp = 1 - Math.exp(-dt * speed);
    this.camCurrentPos.lerp(this.camTargetPos, camDamp);
    this.camCurrentLook.lerp(this.camTargetLook, camDamp);

    this.applyLightingAndCamera();
    this.composer.render();
  }

  private applyLightingAndCamera(): void {
    this.keyLight.intensity = 1.55 * this.roomDimFactor;
    this.rimLight.intensity = 0.72 * this.roomDimFactor;
    this.ambientFill.intensity = 0.52 * this.roomDimFactor;
    this.arbiterHeroSpot.intensity = (1 - this.roomDimFactor) * 15.5;

    const shake = this.arbiterStage.getCameraShakeOffset();
    this.camera.position.copy(this.camCurrentPos).add(shake);
    this.camera.lookAt(this.camCurrentLook);
  }

  private updateCameraTargets(mode: CameraMode): void {
    const rect = this.host.getBoundingClientRect();
    const aspect = Math.max(0.38, (rect.width || 412) / Math.max(1, rect.height || 915));

    if (mode === 'ARBITER') {
      // Calibrated for `412x915` (`0.45` aspect) through `9:16` (`0.5625`):
      // Frames the foreground Attack Medallion at bottom-third, BOTH full clashing wedges,
      // ALL 4 Fresnel domes, BOTH flanking Vacuum-Tube VU meters, and the inner casualty wells!
      const fov = aspect < 0.52 ? THREE.MathUtils.clamp(55 * (0.48 / aspect), 54, 60) : 50;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetPos.set(0, 4.85, 2.35);
      this.camTargetLook.set(0, 0.16, ARBITER_BAY_CENTER_Z + 0.35);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.03, 0.78);
    } else if (mode === 'INSPECT_16') {
      // Macro studio gallery framing ALL 4 columns × 5 rows (`4-angle turnaround` + `16 metallic reliefs`)
      // cleanly inside `412x915` with zero side clipping and zero bottom HUD overlap!
      const fov = aspect < 0.52 ? THREE.MathUtils.clamp(47 * (0.48 / aspect), 47, 52) : 44;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetPos.set(INSPECT_STAGE_ORIGIN.x, 12.35, INSPECT_STAGE_ORIGIN.z + 5.75);
      this.camTargetLook.set(INSPECT_STAGE_ORIGIN.x, 0.1, INSPECT_STAGE_ORIGIN.z - 0.35);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.0, 1.0);
    } else {
      // Default 9:16 Tabletop Command Perspective (`ref_gameplay_main.jpg`):
      // Fits all 4 outer beveled walnut rails + oak table margins cleanly inside `412x915`!
      const fov = aspect < 0.52 ? THREE.MathUtils.clamp(52 * (0.49 / aspect), 52, 58) : 50;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.camTargetPos.set(0, 18.6, 15.6);
      this.camTargetLook.set(0, -0.35, -0.7);
      (this.tiltShiftPass.uniforms['uFocusBand']!.value as THREE.Vector2).set(0.06, 0.82);
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

      // Enemy casualties rest face-down (`visibleRank: 'UNKNOWN'`) at organic angles in the crimson velvet well!
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
        // Face-down in crimson velvet so rank stays strictly unrevealed!
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

      // 1. Check direct hit on a 3D Command Wedge first for generous touch ergonomics
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

      // 2. Also intersect y = 0 board plane for empty-tile or adjacent-enemy challenge taps
      if (raycaster.ray.intersectPlane(this.raycastPlane, hitPoint)) {
        const col = Math.round(hitPoint.x / TILE_PITCH + (BOARD_COLS - 1) / 2);
        const row = Math.round((hitPoint.z - GRID_CENTER_Z) / TILE_PITCH + (BOARD_ROWS - 1) / 2);

        if (col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS) {
          // If tapping a valid move or challenge target of the currently selected piece, execute it!
          const outcome = this.store.executeMoveOrChallenge(col, row);
          if (outcome) {
            if (outcome.kind === 'MOVED') {
              this.sound.playMoveSlide();
            } else {
              this.triggerArbiterSequence(outcome.verdict);
            }
            return;
          }

          // Otherwise check if a player piece sits on `(col, row)` or was hit directly
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
    this.updateCameraTargets(this.cameraMode);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);

    const dpr = this.renderer.getPixelRatio();
    (this.tiltShiftPass.uniforms['uResolution']!.value as THREE.Vector2).set(w * dpr, h * dpr);
  }
}
