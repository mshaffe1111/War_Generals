import * as THREE from 'three';
import type { MoveDirection, ValidMoveTarget } from '../core/types';
import { gridToWorld, makeRoundedRectPath } from './MeshFactory';

/**
 * Crisp Holographic Floor Move Outlines & Challenge Reticles (`ref_gameplay_main.jpg`):
 * - Valid moves: glowing cyan rounded-square tile outlines (`AdditiveBlending`) + subtle translucent
 *   holographic floor sheen (`opacity: 0.14`) + crisp glowing cyan directional chevron-arrow.
 * - Selected wedge: glowing cyan holographic base ring.
 * - Orthogonally adjacent enemies: pulsing crimson-gold perimeter brackets + elevated crossed-saber reticle ring.
 */
export class TileIndicatorLayer {
  public readonly root = new THREE.Group();

  private readonly selectedRing: THREE.Mesh;
  private readonly selectedOuterGlow: THREE.Mesh;
  private readonly movePool: THREE.Group[] = [];
  private readonly challengePool: THREE.Group[] = [];

  private readonly cyanFloorFillMat: THREE.MeshBasicMaterial;
  private readonly cyanBorderMat: THREE.MeshBasicMaterial;
  private readonly cyanArrowMat: THREE.MeshBasicMaterial;
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

    // Sleek flat directional arrow (`ref_gameplay_main.jpg`)
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

    const ringGeo = new THREE.RingGeometry(0.39, 0.45, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectedRing = new THREE.Mesh(ringGeo, this.cyanBorderMat);
    this.selectedRing.position.y = 0.016;
    this.selectedRing.visible = false;
    this.root.add(this.selectedRing);

    const glowRingGeo = new THREE.RingGeometry(0.34, 0.49, 48);
    glowRingGeo.rotateX(-Math.PI / 2);
    this.selectedOuterGlow = new THREE.Mesh(glowRingGeo, this.cyanFloorFillMat);
    this.selectedOuterGlow.position.y = 0.012;
    this.selectedOuterGlow.visible = false;
    this.root.add(this.selectedOuterGlow);
  }

  public sync(
    selectedCoord: { col: number; row: number } | null,
    validMoves: readonly ValidMoveTarget[],
    visible: boolean
  ): void {
    this.root.visible = visible;
    if (!visible || !selectedCoord) {
      this.selectedRing.visible = false;
      this.selectedOuterGlow.visible = false;
      this.hideAllPools();
      return;
    }

    const selWorld = gridToWorld(selectedCoord.col, selectedCoord.row);
    this.selectedRing.position.set(selWorld.x, 0.016, selWorld.z);
    this.selectedOuterGlow.position.set(selWorld.x, 0.012, selWorld.z);
    this.selectedRing.visible = true;
    this.selectedOuterGlow.visible = true;

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
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 4.2);
    this.cyanFloorFillMat.opacity = 0.11 + 0.06 * pulse;
    this.cyanBorderMat.opacity = 0.78 + 0.2 * pulse;
    this.cyanArrowMat.opacity = 0.74 + 0.22 * pulse;

    const alertPulse = 0.5 + 0.5 * Math.sin(elapsedSec * 6.2);
    this.crimsonFloorFillMat.opacity = 0.14 + 0.08 * alertPulse;
    this.crimsonBorderMat.opacity = 0.76 + 0.22 * alertPulse;
    this.goldSaberMat.opacity = 0.8 + 0.2 * (1 - alertPulse * 0.35);

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

    // 4 Corner diagonal crossed-saber ticks extending past the wedge base footprint (`0.38..0.52`)
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
