import * as THREE from 'three';
import { BOARD_COLS } from '../core/ranks';
import { PLAYER_HOME_ROWS } from '../core/RulesEngine';
import type { GridCoord, MoveDirection, ValidMoveTarget } from '../core/types';
import { gridToWorld, makeRoundedRectPath } from './MeshFactory';

/**
 * Crisp 3D Tactical Floor Overlays (`TileIndicatorLayer.ts`):
 *  1. Deployment Mode: 27 glowing cyan home-row square outlines (`Rows 5..7`) + active hover highlight!
 *  2. Active Play Mode: Selected cyan ring + directional orthogonal move arrows (`↑ ↓ ← →`) + pulsing crimson-gold enemy reticles!
 *  3. Declassified Replay Mode: Sweeping tactical scanner grid + ply trajectory vector & clash ring!
 */
export class TileIndicatorLayer {
  public readonly root = new THREE.Group();

  private readonly deployGridGroup = new THREE.Group();
  private readonly deployTileMeshes = new Map<string, THREE.Mesh>();
  private readonly hoverTileMesh: THREE.Mesh;

  private readonly replayScannerGroup = new THREE.Group();
  private readonly replayScanBar: THREE.Mesh;
  private readonly replayFromRing: THREE.Mesh;
  private readonly replayToRing: THREE.Mesh;
  private readonly replayMoveBeam: THREE.Mesh;

  private readonly selectedRing: THREE.Mesh;
  private readonly selectedOuterGlow: THREE.Mesh;
  private readonly movePool: THREE.Group[] = [];
  private readonly challengePool: THREE.Group[] = [];

  private readonly cyanFloorFillMat: THREE.MeshBasicMaterial;
  private readonly cyanBorderMat: THREE.MeshBasicMaterial;
  private readonly cyanArrowMat: THREE.MeshBasicMaterial;
  private readonly deployEmptyMat: THREE.MeshBasicMaterial;
  private readonly deployFilledMat: THREE.MeshBasicMaterial;
  private readonly hoverGoldMat: THREE.MeshBasicMaterial;
  private readonly crimsonFloorFillMat: THREE.MeshBasicMaterial;
  private readonly crimsonBorderMat: THREE.MeshBasicMaterial;
  private readonly goldSaberMat: THREE.MeshBasicMaterial;

  private readonly floorFillGeo: THREE.BufferGeometry;
  private readonly crispBorderGeo: THREE.BufferGeometry;
  private readonly arrowGeo: THREE.BufferGeometry;

  constructor() {
    this.cyanFloorFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.06, 0.72, 0.98),
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.cyanBorderMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.28, 1.55, 1.95),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.cyanArrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.42, 1.65, 2.05),
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.deployEmptyMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.22, 1.45, 1.95),
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.deployFilledMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.25, 0.95, 1.35),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.hoverGoldMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 1.85, 0.55),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.crimsonFloorFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.25, 0.1, 0.18),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.crimsonBorderMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.85, 0.22, 0.3),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.goldSaberMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.9, 1.38, 0.38),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const fillShape = makeRoundedRectPath(0, 0, 0.86, 0.86, 0.055, true) as THREE.Shape;
    const fGeo = new THREE.ShapeGeometry(fillShape, 10);
    fGeo.rotateX(-Math.PI / 2);
    this.floorFillGeo = fGeo;

    const borderShape = makeRoundedRectPath(0, 0, 0.91, 0.91, 0.06, true) as THREE.Shape;
    borderShape.holes.push(makeRoundedRectPath(0, 0, 0.842, 0.842, 0.042) as THREE.Path);
    const bGeo = new THREE.ShapeGeometry(borderShape, 10);
    bGeo.rotateX(-Math.PI / 2);
    this.crispBorderGeo = bGeo;

    const arr = new THREE.Shape();
    arr.moveTo(0, 0.22);
    arr.lineTo(0.18, 0.0);
    arr.lineTo(0.066, 0.0);
    arr.lineTo(0.066, -0.19);
    arr.lineTo(-0.066, -0.19);
    arr.lineTo(-0.066, 0.0);
    arr.lineTo(-0.18, 0.0);
    arr.closePath();
    const arrGeo = new THREE.ShapeGeometry(arr);
    arrGeo.rotateX(-Math.PI / 2);
    this.arrowGeo = arrGeo;

    // 1. Build 27 Glowing Cyan Deployment Home Squares (`Rows 5..7`, `Cols 0..8`)
    // Positioned at `y = 0.029` cleanly above `board_cabinet.glb` slate tile surface (`y = 0.021`)!
    const deployPadFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.08, 0.85, 1.25),
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (const r of PLAYER_HOME_ROWS) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const w = gridToWorld(c, r);
        const pad = new THREE.Mesh(this.floorFillGeo, deployPadFillMat);
        pad.position.set(w.x, 0.026, w.z);
        this.deployGridGroup.add(pad);

        const outline = new THREE.Mesh(this.crispBorderGeo, this.deployEmptyMat);
        outline.position.set(w.x, 0.029, w.z);
        this.deployGridGroup.add(outline);
        this.deployTileMeshes.set(`${c},${r}`, outline);
      }
    }
    this.deployGridGroup.visible = false;
    this.root.add(this.deployGridGroup);

    this.hoverTileMesh = new THREE.Mesh(this.crispBorderGeo, this.hoverGoldMat);
    this.hoverTileMesh.scale.setScalar(1.03);
    this.hoverTileMesh.position.y = 0.035;
    this.hoverTileMesh.visible = false;
    this.root.add(this.hoverTileMesh);

    // 2. Build Declassified X-Ray Tactical Scanner Overlay & Trajectory Indicator
    const scanGeo = new THREE.PlaneGeometry(9.05, 0.26);
    scanGeo.rotateX(-Math.PI / 2);
    this.replayScanBar = new THREE.Mesh(
      scanGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.18, 1.35, 2.2),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.replayFromRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.39, 36).rotateX(-Math.PI / 2),
      this.cyanBorderMat
    );
    this.replayToRing = new THREE.Mesh(this.crispBorderGeo, this.hoverGoldMat);
    const beamGeo = new THREE.PlaneGeometry(0.075, 1.0);
    beamGeo.rotateX(-Math.PI / 2);
    this.replayMoveBeam = new THREE.Mesh(beamGeo, this.hoverGoldMat);

    this.replayScannerGroup.add(
      this.replayScanBar,
      this.replayFromRing,
      this.replayToRing,
      this.replayMoveBeam
    );
    this.replayScannerGroup.visible = false;
    this.root.add(this.replayScannerGroup);

    const ringGeo = new THREE.RingGeometry(0.39, 0.45, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectedRing = new THREE.Mesh(ringGeo, this.cyanBorderMat);
    this.selectedRing.position.y = 0.031;
    this.selectedRing.visible = false;
    this.root.add(this.selectedRing);

    const glowRingGeo = new THREE.RingGeometry(0.34, 0.49, 48);
    glowRingGeo.rotateX(-Math.PI / 2);
    this.selectedOuterGlow = new THREE.Mesh(glowRingGeo, this.cyanFloorFillMat);
    this.selectedOuterGlow.position.y = 0.027;
    this.selectedOuterGlow.visible = false;
    this.root.add(this.selectedOuterGlow);
  }

  public syncDeploymentGrid(
    active: boolean,
    occupiedKeys: ReadonlySet<string>,
    selectedCoord: GridCoord | null
  ): void {
    this.deployGridGroup.visible = active;
    if (!active) return;
    for (const [key, mesh] of this.deployTileMeshes.entries()) {
      mesh.material = occupiedKeys.has(key) ? this.deployFilledMat : this.deployEmptyMat;
    }
    if (selectedCoord) {
      const w = gridToWorld(selectedCoord.col, selectedCoord.row);
      this.selectedRing.position.set(w.x, 0.032, w.z);
      this.selectedOuterGlow.position.set(w.x, 0.028, w.z);
      this.selectedRing.visible = true;
      this.selectedOuterGlow.visible = true;
    }
  }

  public setDragHoverCoord(coord: GridCoord | null): void {
    if (!coord) {
      this.hoverTileMesh.visible = false;
      return;
    }
    const w = gridToWorld(coord.col, coord.row);
    this.hoverTileMesh.position.set(w.x, 0.036, w.z);
    this.hoverTileMesh.visible = true;
  }

  public syncReplayOverlay(
    active: boolean,
    fromCoord: GridCoord | null,
    toCoord: GridCoord | null,
    wasClash: boolean
  ): void {
    this.replayScannerGroup.visible = active;
    if (!active) return;

    if (fromCoord && toCoord) {
      const wf = gridToWorld(fromCoord.col, fromCoord.row);
      const wt = gridToWorld(toCoord.col, toCoord.row);
      this.replayFromRing.position.set(wf.x, 0.031, wf.z);
      this.replayFromRing.visible = true;

      this.replayToRing.position.set(wt.x, 0.033, wt.z);
      this.replayToRing.material = wasClash ? this.crimsonBorderMat : this.hoverGoldMat;
      this.replayToRing.visible = true;

      const midX = (wf.x + wt.x) * 0.5;
      const midZ = (wf.z + wt.z) * 0.5;
      const len = Math.hypot(wt.x - wf.x, wt.z - wf.z);
      this.replayMoveBeam.position.set(midX, 0.03, midZ);
      this.replayMoveBeam.scale.set(1, 1, Math.max(0.1, len));
      this.replayMoveBeam.rotation.y = Math.atan2(wt.x - wf.x, wt.z - wf.z);
      this.replayMoveBeam.visible = true;
    } else {
      this.replayFromRing.visible = false;
      this.replayToRing.visible = false;
      this.replayMoveBeam.visible = false;
    }
  }

  public sync(
    selectedCoord: { col: number; row: number } | null,
    validMoves: readonly ValidMoveTarget[],
    visible: boolean
  ): void {
    if (!visible || !selectedCoord) {
      if (!this.deployGridGroup.visible) {
        this.selectedRing.visible = false;
        this.selectedOuterGlow.visible = false;
      }
      this.hideAllPools();
      return;
    }

    const selWorld = gridToWorld(selectedCoord.col, selectedCoord.row);
    this.selectedRing.position.set(selWorld.x, 0.031, selWorld.z);
    this.selectedOuterGlow.position.set(selWorld.x, 0.027, selWorld.z);
    this.selectedRing.visible = true;
    this.selectedOuterGlow.visible = true;

    let moveIdx = 0;
    let chalIdx = 0;

    for (const m of validMoves) {
      const w = gridToWorld(m.col, m.row);
      if (m.kind === 'MOVE') {
        const indicator = this.getOrCreateMoveIndicator(moveIdx++);
        indicator.position.set(w.x, 0.028, w.z);
        const arrow = indicator.getObjectByName('dirArrow');
        if (arrow) {
          arrow.rotation.y = this.directionToRotationY(m.direction);
        }
        indicator.visible = true;
      } else {
        const reticle = this.getOrCreateChallengeReticle(chalIdx++);
        reticle.position.set(w.x, 0.03, w.z);
        reticle.visible = true;
      }
    }

    for (let i = moveIdx; i < this.movePool.length; i++) {
      this.movePool[i]!.visible = false;
    }
    for (let i = chalIdx; i < this.challengePool.length; i++) {
      this.challengePool[i]!.visible = false;
    }
  }

  public update(elapsedSec: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 4.2);
    this.cyanFloorFillMat.opacity = 0.11 + 0.06 * pulse;
    this.cyanBorderMat.opacity = 0.78 + 0.2 * pulse;
    this.cyanArrowMat.opacity = 0.74 + 0.22 * pulse;
    this.deployEmptyMat.opacity = 0.52 + 0.34 * pulse;

    const alertPulse = 0.5 + 0.5 * Math.sin(elapsedSec * 6.2);
    this.crimsonFloorFillMat.opacity = 0.14 + 0.08 * alertPulse;
    this.crimsonBorderMat.opacity = 0.76 + 0.22 * alertPulse;
    this.goldSaberMat.opacity = 0.8 + 0.2 * (1 - alertPulse * 0.35);

    if (this.replayScannerGroup.visible) {
      // Smooth tactical radar sweep across the 9x8 board (`z = -2.8 .. +4.5`)!
      const sweepU = (elapsedSec * 0.28) % 1.0;
      this.replayScanBar.position.set(0, 0.025, -2.85 + sweepU * 7.4);
    }

    for (const r of this.challengePool) {
      if (!r.visible) continue;
      const ring = r.getObjectByName('saberRing');
      if (ring) {
        ring.rotation.y = elapsedSec * 0.75;
        const s = 0.97 + 0.05 * alertPulse;
        ring.scale.set(s, 1, s);
      }
    }
  }

  private hideAllPools(): void {
    for (const m of this.movePool) m.visible = false;
    for (const c of this.challengePool) c.visible = false;
  }

  private directionToRotationY(dir: MoveDirection): number {
    switch (dir) {
      case 'UP':
        return 0;
      case 'DOWN':
        return Math.PI;
      case 'LEFT':
        return Math.PI / 2;
      case 'RIGHT':
        return -Math.PI / 2;
    }
  }

  private getOrCreateMoveIndicator(index: number): THREE.Group {
    if (this.movePool[index]) return this.movePool[index]!;
    const g = new THREE.Group();

    const fill = new THREE.Mesh(this.floorFillGeo, this.cyanFloorFillMat);
    g.add(fill);

    const border = new THREE.Mesh(this.crispBorderGeo, this.cyanBorderMat);
    border.position.y = 0.002;
    g.add(border);

    const arrow = new THREE.Mesh(this.arrowGeo, this.cyanArrowMat);
    arrow.name = 'dirArrow';
    arrow.position.y = 0.005;
    g.add(arrow);

    this.root.add(g);
    this.movePool.push(g);
    return g;
  }

  private getOrCreateChallengeReticle(index: number): THREE.Group {
    if (this.challengePool[index]) return this.challengePool[index]!;
    const g = new THREE.Group();

    const fill = new THREE.Mesh(this.floorFillGeo, this.crimsonFloorFillMat);
    g.add(fill);

    const outerSq = new THREE.Mesh(this.crispBorderGeo, this.crimsonBorderMat);
    outerSq.position.y = 0.003;
    g.add(outerSq);

    const saberRingGroup = new THREE.Group();
    saberRingGroup.name = 'saberRing';
    saberRingGroup.position.y = 0.008;

    const rGeo = new THREE.RingGeometry(0.41, 0.46, 40);
    rGeo.rotateX(-Math.PI / 2);
    saberRingGroup.add(new THREE.Mesh(rGeo, this.goldSaberMat));

    const tickGeo = new THREE.PlaneGeometry(0.048, 0.22);
    tickGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + (i * Math.PI) / 2;
      const tick = new THREE.Mesh(tickGeo, this.goldSaberMat);
      tick.position.set(Math.sin(ang) * 0.43, 0.004, Math.cos(ang) * 0.43);
      tick.rotation.y = ang;
      saberRingGroup.add(tick);
    }

    g.add(saberRingGroup);
    this.root.add(g);
    this.challengePool.push(g);
    return g;
  }
}
