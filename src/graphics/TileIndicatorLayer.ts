import * as THREE from 'three';
import type { MoveDirection, ValidMoveTarget } from '../core/types';
import { gridToWorld, makeRoundedRectPath } from './MeshFactory';

/**
 * Renders tactile selection & move affordances directly on the 3D slate grid:
 * 1. Glowing cyan base ring around the selected player Command Wedge.
 * 2. Glowing cyan square tile outlines containing flat cyan directional arrows (`UP`/`DOWN`/`LEFT`/`RIGHT`).
 * 3. Pulsing crimson-gold crossed-saber reticles on orthogonally adjacent enemy wedges.
 */
export class TileIndicatorLayer {
  public readonly root = new THREE.Group();

  private readonly selectedRing: THREE.Mesh;
  private readonly movePool: THREE.Group[] = [];
  private readonly challengePool: THREE.Group[] = [];

  private readonly cyanGlowMat: THREE.MeshBasicMaterial;
  private readonly cyanFillMat: THREE.MeshBasicMaterial;
  private readonly crimsonGlowMat: THREE.MeshBasicMaterial;
  private readonly goldGlowMat: THREE.MeshBasicMaterial;

  private readonly squareOutlineGeo: THREE.BufferGeometry;
  private readonly arrowGeo: THREE.BufferGeometry;

  constructor() {
    // HDR colors (> 0.82) trigger subtle selective UnrealBloomPass without washing out slate!
    this.cyanGlowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.28, 1.35, 1.65),
      transparent: true,
      opacity: 0.92,
      toneMapped: false,
    });

    this.cyanFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 1.45, 1.75),
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.crimsonGlowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.45, 0.1, 0.16),
      transparent: true,
      opacity: 0.94,
      toneMapped: false,
    });

    this.goldGlowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.55, 1.08, 0.24),
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    });

    // Selected wedge base ring
    const ringGeo = new THREE.RingGeometry(0.39, 0.455, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectedRing = new THREE.Mesh(ringGeo, this.cyanGlowMat);
    this.selectedRing.position.y = 0.014;
    this.selectedRing.visible = false;
    this.root.add(this.selectedRing);

    // Beveled flat square outline for valid move tiles
    const sqShape = makeRoundedRectPath(0, 0, 0.88, 0.88, 0.06, true) as THREE.Shape;
    sqShape.holes.push(makeRoundedRectPath(0, 0, 0.79, 0.79, 0.035) as THREE.Path);
    const sqGeo = new THREE.ExtrudeGeometry(sqShape, {
      depth: 0.01,
      bevelEnabled: false,
      curveSegments: 10,
    });
    sqGeo.rotateX(-Math.PI / 2);
    this.squareOutlineGeo = sqGeo;

    // Flat directional chevron/arrow pointing -Z (`UP` on board)
    const arr = new THREE.Shape();
    arr.moveTo(0, 0.22); // maps to -Z after rotateX(-PI/2)
    arr.lineTo(0.19, -0.02);
    arr.lineTo(0.08, -0.02);
    arr.lineTo(0.08, -0.2);
    arr.lineTo(-0.08, -0.2);
    arr.lineTo(-0.08, -0.02);
    arr.lineTo(-0.19, -0.02);
    arr.closePath();
    const arrGeo = new THREE.ShapeGeometry(arr);
    arrGeo.rotateX(-Math.PI / 2);
    this.arrowGeo = arrGeo;
  }

  public sync(
    selectedCoord: { col: number; row: number } | null,
    validMoves: readonly ValidMoveTarget[],
    visible: boolean
  ): void {
    this.root.visible = visible;
    if (!visible || !selectedCoord) {
      this.selectedRing.visible = false;
      this.hideAllPools();
      return;
    }

    const selWorld = gridToWorld(selectedCoord.col, selectedCoord.row);
    this.selectedRing.position.set(selWorld.x, 0.015, selWorld.z);
    this.selectedRing.visible = true;

    let moveIdx = 0;
    let chalIdx = 0;

    for (const m of validMoves) {
      const w = gridToWorld(m.col, m.row);
      if (m.kind === 'MOVE') {
        const indicator = this.getOrCreateMoveIndicator(moveIdx++);
        indicator.position.set(w.x, 0.014, w.z);
        const arrow = indicator.getObjectByName('dirArrow');
        if (arrow) {
          arrow.rotation.y = this.directionToRotationY(m.direction);
        }
        indicator.visible = true;
      } else {
        const reticle = this.getOrCreateChallengeReticle(chalIdx++);
        reticle.position.set(w.x, 0.018, w.z);
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
    if (!this.root.visible) return;
    const pulse = 0.82 + 0.18 * Math.sin(elapsedSec * 4.5);
    this.cyanGlowMat.opacity = 0.78 + 0.18 * pulse;
    this.cyanFillMat.opacity = 0.68 + 0.22 * pulse;

    const alertPulse = 0.5 + 0.5 * Math.sin(elapsedSec * 6.2);
    this.crimsonGlowMat.opacity = 0.72 + 0.26 * alertPulse;
    this.goldGlowMat.opacity = 0.75 + 0.25 * (1 - alertPulse * 0.5);

    for (const r of this.challengePool) {
      if (!r.visible) continue;
      const ring = r.getObjectByName('saberRing');
      if (ring) {
        ring.rotation.y = elapsedSec * 0.85;
        const s = 0.96 + 0.07 * alertPulse;
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

    const frame = new THREE.Mesh(this.squareOutlineGeo, this.cyanGlowMat);
    g.add(frame);

    const arrow = new THREE.Mesh(this.arrowGeo, this.cyanFillMat);
    arrow.name = 'dirArrow';
    arrow.position.y = 0.008;
    g.add(arrow);

    this.root.add(g);
    this.movePool.push(g);
    return g;
  }

  private getOrCreateChallengeReticle(index: number): THREE.Group {
    if (this.challengePool[index]) return this.challengePool[index]!;
    const g = new THREE.Group();

    // Outer crimson alert square outline
    const outerSq = new THREE.Mesh(this.squareOutlineGeo, this.crimsonGlowMat);
    g.add(outerSq);

    // Rotating gold target ring + diagonal crossed-saber corner spikes extending outside enemy base!
    const saberRingGroup = new THREE.Group();
    saberRingGroup.name = 'saberRing';

    const rGeo = new THREE.RingGeometry(0.39, 0.455, 36);
    rGeo.rotateX(-Math.PI / 2);
    saberRingGroup.add(new THREE.Mesh(rGeo, this.goldGlowMat));

    const bladeGeo = new THREE.PlaneGeometry(0.075, 1.06);
    bladeGeo.rotateX(-Math.PI / 2);
    const b1 = new THREE.Mesh(bladeGeo, this.goldGlowMat);
    b1.rotation.y = Math.PI / 4;
    b1.position.y = 0.008;
    saberRingGroup.add(b1);

    const b2 = new THREE.Mesh(bladeGeo, this.goldGlowMat);
    b2.rotation.y = -Math.PI / 4;
    b2.position.y = 0.008;
    saberRingGroup.add(b2);

    g.add(saberRingGroup);
    this.root.add(g);
    this.challengePool.push(g);
    return g;
  }
}
