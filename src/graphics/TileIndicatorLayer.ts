import * as THREE from 'three';
import type { MoveDirection, ValidMoveTarget } from '../core/types';
import { gridToWorld, makeRoundedRectPath } from './MeshFactory';

/**
 * Translucent Holographic Floor Move & Challenge Indicators (`ref_gameplay_main.jpg`):
 * - Valid moves: translucent glowing cyan holographic floor squares (`opacity: 0.28` fill +
 *   crisp glowing cyan border + clean flat translucent cyan directional arrow).
 * - Selected wedge: sleek glowing cyan holographic base ring.
 * - Adjacent enemies: pulsing crimson-gold holographic target squares + diagonal saber corner ticks.
 */
export class TileIndicatorLayer {
  public readonly root = new THREE.Group();

  private readonly selectedRing: THREE.Mesh;
  private readonly selectedFill: THREE.Mesh;
  private readonly movePool: THREE.Group[] = [];
  private readonly challengePool: THREE.Group[] = [];

  private readonly cyanFloorFillMat: THREE.MeshBasicMaterial;
  private readonly cyanBorderMat: THREE.MeshBasicMaterial;
  private readonly cyanArrowMat: THREE.MeshBasicMaterial;
  private readonly crimsonFloorFillMat: THREE.MeshBasicMaterial;
  private readonly crimsonBorderMat: THREE.MeshBasicMaterial;
  private readonly goldTickMat: THREE.MeshBasicMaterial;

  private readonly floorFillGeo: THREE.BufferGeometry;
  private readonly thinBorderGeo: THREE.BufferGeometry;
  private readonly arrowGeo: THREE.BufferGeometry;

  constructor() {
    this.cyanFloorFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.08, 0.92, 1.18),
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      toneMapped: false,
    });

    this.cyanBorderMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.22, 1.38, 1.72),
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      toneMapped: false,
    });

    this.cyanArrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.32, 1.48, 1.82),
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });

    this.crimsonFloorFillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.05, 0.08, 0.15),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      toneMapped: false,
    });

    this.crimsonBorderMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.55, 0.16, 0.24),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      toneMapped: false,
    });

    this.goldTickMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.65, 1.18, 0.32),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    });

    // Translucent interior floor pad (`0.88 x 0.88`)
    const fillShape = makeRoundedRectPath(0, 0, 0.86, 0.86, 0.05, true) as THREE.Shape;
    const fGeo = new THREE.ShapeGeometry(fillShape, 10);
    fGeo.rotateX(-Math.PI / 2);
    this.floorFillGeo = fGeo;

    // Crisp razor-thin glowing holographic perimeter frame (`0.90` outer, `0.85` inner)
    const borderShape = makeRoundedRectPath(0, 0, 0.9, 0.9, 0.055, true) as THREE.Shape;
    borderShape.holes.push(makeRoundedRectPath(0, 0, 0.848, 0.848, 0.04) as THREE.Path);
    const bGeo = new THREE.ShapeGeometry(borderShape, 10);
    bGeo.rotateX(-Math.PI / 2);
    this.thinBorderGeo = bGeo;

    // Sleek translucent chevron-arrow (`ref_gameplay_main.jpg`)
    const arr = new THREE.Shape();
    arr.moveTo(0, 0.21);
    arr.lineTo(0.175, -0.01);
    arr.lineTo(0.068, -0.01);
    arr.lineTo(0.068, -0.19);
    arr.lineTo(-0.068, -0.19);
    arr.lineTo(-0.068, -0.01);
    arr.lineTo(-0.175, -0.01);
    arr.closePath();
    const arrGeo = new THREE.ShapeGeometry(arr);
    arrGeo.rotateX(-Math.PI / 2);
    this.arrowGeo = arrGeo;

    // Selected wedge holographic ring + subtle floor glow
    const ringGeo = new THREE.RingGeometry(0.38, 0.435, 44);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectedRing = new THREE.Mesh(ringGeo, this.cyanBorderMat);
    this.selectedRing.position.y = 0.014;
    this.selectedRing.visible = false;
    this.root.add(this.selectedRing);

    const discGeo = new THREE.CircleGeometry(0.38, 36);
    discGeo.rotateX(-Math.PI / 2);
    this.selectedFill = new THREE.Mesh(discGeo, this.cyanFloorFillMat);
    this.selectedFill.position.y = 0.011;
    this.selectedFill.visible = false;
    this.root.add(this.selectedFill);
  }

  public sync(
    selectedCoord: { col: number; row: number } | null,
    validMoves: readonly ValidMoveTarget[],
    visible: boolean
  ): void {
    this.root.visible = visible;
    if (!visible || !selectedCoord) {
      this.selectedRing.visible = false;
      this.selectedFill.visible = false;
      this.hideAllPools();
      return;
    }

    const selWorld = gridToWorld(selectedCoord.col, selectedCoord.row);
    this.selectedRing.position.set(selWorld.x, 0.014, selWorld.z);
    this.selectedFill.position.set(selWorld.x, 0.011, selWorld.z);
    this.selectedRing.visible = true;
    this.selectedFill.visible = true;

    let moveIdx = 0;
    let chalIdx = 0;

    for (const m of validMoves) {
      const w = gridToWorld(m.col, m.row);
      if (m.kind === 'MOVE') {
        const indicator = this.getOrCreateMoveIndicator(moveIdx++);
        indicator.position.set(w.x, 0.012, w.z);
        const arrow = indicator.getObjectByName('dirArrow');
        if (arrow) {
          arrow.rotation.y = this.directionToRotationY(m.direction);
        }
        indicator.visible = true;
      } else {
        const reticle = this.getOrCreateChallengeReticle(chalIdx++);
        reticle.position.set(w.x, 0.015, w.z);
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
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 4.2);
    this.cyanFloorFillMat.opacity = 0.23 + 0.09 * pulse;
    this.cyanBorderMat.opacity = 0.74 + 0.2 * pulse;
    this.cyanArrowMat.opacity = 0.62 + 0.22 * pulse;

    const alertPulse = 0.5 + 0.5 * Math.sin(elapsedSec * 6.0);
    this.crimsonFloorFillMat.opacity = 0.2 + 0.1 * alertPulse;
    this.crimsonBorderMat.opacity = 0.72 + 0.24 * alertPulse;
    this.goldTickMat.opacity = 0.74 + 0.24 * (1 - alertPulse * 0.4);

    for (const r of this.challengePool) {
      if (!r.visible) continue;
      const ring = r.getObjectByName('saberRing');
      if (ring) {
        ring.rotation.y = elapsedSec * 0.7;
        const s = 0.96 + 0.06 * alertPulse;
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

    const border = new THREE.Mesh(this.thinBorderGeo, this.cyanBorderMat);
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

    const outerSq = new THREE.Mesh(this.thinBorderGeo, this.crimsonBorderMat);
    outerSq.position.y = 0.002;
    g.add(outerSq);

    const saberRingGroup = new THREE.Group();
    saberRingGroup.name = 'saberRing';

    const rGeo = new THREE.RingGeometry(0.39, 0.435, 36);
    rGeo.rotateX(-Math.PI / 2);
    saberRingGroup.add(new THREE.Mesh(rGeo, this.goldTickMat));

    const bladeGeo = new THREE.PlaneGeometry(0.052, 0.98);
    bladeGeo.rotateX(-Math.PI / 2);
    const b1 = new THREE.Mesh(bladeGeo, this.goldTickMat);
    b1.rotation.y = Math.PI / 4;
    b1.position.y = 0.005;
    saberRingGroup.add(b1);

    const b2 = new THREE.Mesh(bladeGeo, this.goldTickMat);
    b2.rotation.y = -Math.PI / 4;
    b2.position.y = 0.005;
    saberRingGroup.add(b2);

    g.add(saberRingGroup);
    this.root.add(g);
    this.challengePool.push(g);
    return g;
  }
}
