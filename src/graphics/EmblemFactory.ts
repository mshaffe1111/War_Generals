import * as THREE from 'three';
import type { RankId } from '../core/ranks';

export interface EmblemMaterialPalette {
  readonly brass: THREE.MeshPhysicalMaterial;
  readonly silver: THREE.MeshPhysicalMaterial;
  readonly brassRecessed: THREE.MeshPhysicalMaterial;
  readonly contactShadow: THREE.MeshStandardMaterial;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, builder: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = builder();
  geoCache.set(key, g);
  return g;
}

function createRoundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  const cr = Math.min(r, hw * 0.9, hh * 0.9);
  s.moveTo(-hw + cr, -hh);
  s.lineTo(hw - cr, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + cr);
  s.lineTo(hw, hh - cr);
  s.quadraticCurveTo(hw, hh, hw - cr, hh);
  s.lineTo(-hw + cr, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - cr);
  s.lineTo(-hw, -hh + cr);
  s.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
  return s;
}

function createStarShape(points: number, outerR: number, innerR: number): THREE.Shape {
  const s = new THREE.Shape();
  const total = points * 2;
  for (let i = 0; i < total; i++) {
    const a = (i / total) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function createRingShape(outerR: number, innerR: number): THREE.Shape {
  const outer = new THREE.Shape();
  outer.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  outer.holes.push(hole);
  return outer;
}

function createChevronShape(halfWidth: number, height: number, thickness: number): THREE.Shape {
  const s = new THREE.Shape();
  const apexY = height * 0.55;
  const baseY = -height * 0.45;
  const innerApexY = apexY - thickness * 1.18;
  const innerBaseY = baseY;
  const innerHalfW = Math.max(0.02, halfWidth - thickness * 0.92);

  s.moveTo(0, apexY);
  s.lineTo(halfWidth, baseY);
  s.lineTo(innerHalfW, innerBaseY);
  s.lineTo(0, innerApexY);
  s.lineTo(-innerHalfW, innerBaseY);
  s.lineTo(-halfWidth, baseY);
  s.closePath();
  return s;
}

function createOakLeafShape(): THREE.Shape {
  const s = new THREE.Shape();
  // Classic symmetric 5-lobe military oak leaf centered around (0, 0), height ~0.34, width ~0.26
  s.moveTo(0, -0.17);
  s.bezierCurveTo(0.014, -0.13, 0.016, -0.11, 0.022, -0.105);
  // Lower right lobe
  s.bezierCurveTo(0.068, -0.115, 0.112, -0.095, 0.116, -0.055);
  s.bezierCurveTo(0.118, -0.028, 0.088, -0.014, 0.064, -0.012);
  // Middle right lobe
  s.bezierCurveTo(0.108, -0.002, 0.145, 0.028, 0.138, 0.072);
  s.bezierCurveTo(0.132, 0.102, 0.092, 0.108, 0.058, 0.094);
  // Upper right lobe
  s.bezierCurveTo(0.084, 0.118, 0.088, 0.155, 0.052, 0.172);
  // Terminal apex lobe
  s.bezierCurveTo(0.026, 0.184, 0.014, 0.198, 0, 0.205);
  s.bezierCurveTo(-0.014, 0.198, -0.026, 0.184, -0.052, 0.172);
  // Upper left lobe
  s.bezierCurveTo(-0.088, 0.155, -0.084, 0.118, -0.058, 0.094);
  // Middle left lobe
  s.bezierCurveTo(-0.092, 0.108, -0.132, 0.102, -0.138, 0.072);
  s.bezierCurveTo(-0.145, 0.028, -0.108, -0.002, -0.064, -0.012);
  // Lower left lobe
  s.bezierCurveTo(-0.088, -0.014, -0.118, -0.028, -0.116, -0.055);
  s.bezierCurveTo(-0.112, -0.095, -0.068, -0.115, -0.022, -0.105);
  s.bezierCurveTo(-0.016, -0.11, -0.014, -0.13, 0, -0.17);
  s.closePath();
  return s;
}

function createShieldShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w * 0.5;
  const hh = h * 0.5;
  s.moveTo(-hw, hh);
  s.lineTo(hw, hh);
  s.lineTo(hw, -hh * 0.15);
  s.quadraticCurveTo(hw * 0.86, -hh * 0.72, 0, -hh);
  s.quadraticCurveTo(-hw * 0.86, -hh * 0.72, -hw, -hh * 0.15);
  s.closePath();
  return s;
}

function createEagleWingShape(side: 1 | -1): THREE.Shape {
  const s = new THREE.Shape();
  const sx = side;
  s.moveTo(sx * 0.032, 0.042);
  s.bezierCurveTo(sx * 0.07, 0.115, sx * 0.155, 0.155, sx * 0.215, 0.135);
  s.lineTo(sx * 0.195, 0.088);
  s.lineTo(sx * 0.21, 0.075);
  s.lineTo(sx * 0.178, 0.042);
  s.lineTo(sx * 0.192, 0.026);
  s.lineTo(sx * 0.152, -0.004);
  s.lineTo(sx * 0.162, -0.018);
  s.lineTo(sx * 0.115, -0.042);
  s.bezierCurveTo(sx * 0.075, -0.042, sx * 0.045, -0.025, sx * 0.03, -0.01);
  s.closePath();
  return s;
}

function createEagleHeadShape(): THREE.Shape {
  const s = new THREE.Shape();
  // Clean solid heraldic eagle head & hooked beak facing left (CCW)
  s.moveTo(-0.024, 0.036);
  s.lineTo(0.026, 0.036);
  s.lineTo(0.026, 0.122);
  s.lineTo(-0.028, 0.132);
  s.lineTo(-0.074, 0.114);
  s.lineTo(-0.062, 0.096);
  s.lineTo(-0.024, 0.102);
  s.closePath();
  return s;
}

function createEagleTailShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.034, -0.068);
  s.lineTo(0.034, -0.068);
  s.lineTo(0.055, -0.152);
  s.lineTo(0.022, -0.136);
  s.lineTo(0, -0.165);
  s.lineTo(-0.022, -0.136);
  s.lineTo(-0.055, -0.152);
  s.closePath();
  return s;
}

function createDiamondEyeFrameShape(outerW: number, outerH: number, innerW: number, innerH: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, outerH);
  s.quadraticCurveTo(outerW * 0.65, outerH * 0.55, outerW, 0);
  s.quadraticCurveTo(outerW * 0.65, -outerH * 0.55, 0, -outerH);
  s.quadraticCurveTo(-outerW * 0.65, -outerH * 0.55, -outerW, 0);
  s.quadraticCurveTo(-outerW * 0.65, outerH * 0.55, 0, outerH);
  s.closePath();

  const hole = new THREE.Path();
  hole.moveTo(0, innerH);
  hole.quadraticCurveTo(-innerW * 0.62, innerH * 0.52, -innerW, 0);
  hole.quadraticCurveTo(-innerW * 0.62, -innerH * 0.52, 0, -innerH);
  hole.quadraticCurveTo(innerW * 0.62, -innerH * 0.52, innerW, 0);
  hole.quadraticCurveTo(innerW * 0.62, innerH * 0.52, 0, innerH);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

function createDaggerBladeShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.2);
  s.lineTo(0.026, 0.08);
  s.lineTo(0.021, -0.085);
  s.lineTo(-0.021, -0.085);
  s.lineTo(-0.026, 0.08);
  s.closePath();
  return s;
}

function createWavyFlagShape(): THREE.Shape {
  const s = new THREE.Shape();
  // Rippling banner anchored along x = -0.105 .. +0.165, y = -0.01 .. +0.17
  s.moveTo(-0.105, 0.16);
  s.bezierCurveTo(-0.02, 0.19, 0.06, 0.125, 0.165, 0.165);
  s.lineTo(0.145, 0.075);
  s.lineTo(0.175, -0.015);
  s.bezierCurveTo(0.07, -0.045, -0.015, 0.02, -0.105, -0.01);
  s.closePath();
  return s;
}

function createCurvedSaberBladeShape(): THREE.Shape {
  const s = new THREE.Shape();
  // Curved cavalry saber blade pointing upward (+Y), total length ~0.46
  s.moveTo(-0.016, -0.09);
  s.lineTo(0.016, -0.09);
  s.bezierCurveTo(0.026, 0.06, 0.052, 0.19, 0.095, 0.31);
  //Clipped saber tip
  s.lineTo(0.066, 0.345);
  s.bezierCurveTo(0.024, 0.21, 0.0, 0.07, -0.016, -0.09);
  s.closePath();
  return s;
}

function createSaberGuardShape(): THREE.Shape {
  const s = new THREE.Shape();
  // Sculpted D-guard + cross-quillon
  s.moveTo(-0.062, -0.088);
  s.lineTo(0.062, -0.088);
  s.lineTo(0.056, -0.108);
  s.bezierCurveTo(0.054, -0.175, 0.038, -0.22, 0.012, -0.225);
  s.lineTo(-0.016, -0.225);
  s.lineTo(-0.016, -0.108);
  s.lineTo(-0.056, -0.108);
  s.closePath();

  const hole = new THREE.Path();
  hole.moveTo(0.012, -0.114);
  hole.lineTo(0.036, -0.114);
  hole.bezierCurveTo(0.038, -0.165, 0.028, -0.198, 0.012, -0.204);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

function extrude(
  key: string,
  shapeFactory: () => THREE.Shape,
  depth: number,
  bevelThickness: number,
  bevelSize: number,
  bevelSegments = 3,
  curveSegments = 16
): THREE.BufferGeometry {
  return cachedGeo(key, () => {
    const g = new THREE.ExtrudeGeometry(shapeFactory(), {
      depth,
      bevelEnabled: bevelThickness > 0 && bevelSize > 0,
      bevelThickness,
      bevelSize,
      bevelSegments,
      curveSegments,
    });
    g.computeVertexNormals();
    return g;
  });
}

function addMesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildTwoTierStar(
  root: THREE.Group,
  keySuffix: string,
  outerR: number,
  x: number,
  y: number,
  z: number,
  topMat: THREE.Material,
  baseMat: THREE.Material
): void {
  const innerR = outerR * 0.4;
  const baseGeo = extrude(
    `star_base_${keySuffix}_${outerR.toFixed(3)}`,
    () => createStarShape(5, outerR * 1.07, innerR * 1.12),
    0.012,
    0.004,
    0.004,
    2,
    8
  );
  const topGeo = extrude(
    `star_top_${keySuffix}_${outerR.toFixed(3)}`,
    () => createStarShape(5, outerR * 0.92, innerR * 0.94),
    0.018,
    0.008,
    0.006,
    3,
    8
  );
  const bossGeo = cachedGeo(`star_boss_${outerR.toFixed(3)}`, () => {
    const pts = [
      new THREE.Vector2(0.0, 0.008),
      new THREE.Vector2(outerR * 0.16, 0.006),
      new THREE.Vector2(outerR * 0.22, 0.0),
    ];
    const g = new THREE.LatheGeometry(pts, 14);
    g.rotateX(Math.PI / 2);
    return g;
  });

  addMesh(root, baseGeo, baseMat, x, y, z + 0.002);
  addMesh(root, topGeo, topMat, x, y, z + 0.011);
  addMesh(root, bossGeo, topMat, x, y, z + 0.032);
}

export function buildRankEmblemMesh(
  rankId: RankId,
  palette: EmblemMaterialPalette
): THREE.Group {
  const root = new THREE.Group();
  root.name = `RankEmblem_${rankId}`;

  switch (rankId) {
    case 'GEN_5': {
      const ringGeo = extrude('gen5_ring', () => createRingShape(0.188, 0.168), 0.008, 0.003, 0.003, 2, 28);
      addMesh(root, ringGeo, palette.brassRecessed, 0, 0, 0.002);
      const orbitR = 0.118;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
        buildTwoTierStar(
          root,
          'g5',
          0.064,
          Math.cos(a) * orbitR,
          Math.sin(a) * orbitR,
          0.004,
          palette.brass,
          palette.brassRecessed
        );
      }
      const centerBossGeo = extrude('gen5_center', () => createStarShape(5, 0.036, 0.016), 0.01, 0.004, 0.003, 2, 8);
      addMesh(root, centerBossGeo, palette.brassRecessed, 0, 0, 0.006);
      break;
    }

    case 'GEN_4': {
      const frameGeo = extrude('gen4_frame', () => createRoundedRectShape(0.28, 0.28, 0.04), 0.006, 0.003, 0.003, 2, 12);
      addMesh(root, frameGeo, palette.contactShadow, 0, 0, 0.001);
      const coords: Array<[number, number]> = [
        [-0.092, 0.092],
        [0.092, 0.092],
        [-0.092, -0.092],
        [0.092, -0.092],
      ];
      for (const [sx, sy] of coords) {
        buildTwoTierStar(root, 'g4', 0.072, sx, sy, 0.005, palette.brass, palette.brassRecessed);
      }
      break;
    }

    case 'GEN_3': {
      const coords: Array<[number, number]> = [
        [0, 0.104],
        [-0.102, -0.08],
        [0.102, -0.08],
      ];
      for (const [sx, sy] of coords) {
        buildTwoTierStar(root, 'g3', 0.08, sx, sy, 0.004, palette.brass, palette.brassRecessed);
      }
      break;
    }

    case 'GEN_2': {
      buildTwoTierStar(root, 'g2', 0.094, -0.105, 0, 0.004, palette.brass, palette.brassRecessed);
      buildTwoTierStar(root, 'g2', 0.094, 0.105, 0, 0.004, palette.brass, palette.brassRecessed);
      break;
    }

    case 'GEN_1': {
      const backingRingGeo = extrude('gen1_ring', () => createRingShape(0.185, 0.166), 0.008, 0.003, 0.003, 2, 28);
      addMesh(root, backingRingGeo, palette.brassRecessed, 0, 0, 0.002);
      buildTwoTierStar(root, 'g1', 0.155, 0, 0, 0.004, palette.brass, palette.brassRecessed);
      break;
    }

    case 'COLONEL': {
      // Spread-Wing Silver War Eagle with Chest Shield, Tail Fan, and Arrow Bundle
      const tailGeo = extrude('col_tail', createEagleTailShape, 0.012, 0.004, 0.004, 2, 8);
      addMesh(root, tailGeo, palette.silver, 0, 0, 0.005);

      const wingLGeo = extrude('col_wing_l', () => createEagleWingShape(-1), 0.016, 0.006, 0.005, 3, 12);
      const wingRGeo = extrude('col_wing_r', () => createEagleWingShape(1), 0.016, 0.006, 0.005, 3, 12);
      const wL = addMesh(root, wingLGeo, palette.silver, 0, 0, 0.008);
      const wR = addMesh(root, wingRGeo, palette.silver, 0, 0, 0.008);
      wL.rotation.y = 0.08;
      wR.rotation.y = -0.08;

      const headGeo = extrude('col_head', createEagleHeadShape, 0.018, 0.006, 0.005, 3, 12);
      addMesh(root, headGeo, palette.silver, 0, 0, 0.011);

      const shieldBaseGeo = extrude('col_shield_base', () => createShieldShape(0.086, 0.118), 0.016, 0.005, 0.004, 3, 10);
      addMesh(root, shieldBaseGeo, palette.brassRecessed, 0, -0.008, 0.015);

      const shieldFaceGeo = extrude('col_shield_face', () => createShieldShape(0.068, 0.095), 0.01, 0.004, 0.003, 2, 10);
      addMesh(root, shieldFaceGeo, palette.silver, 0, -0.006, 0.028);

      // Horizontal talons / arrow bar
      const arrowBarGeo = extrude('col_arrows', () => createRoundedRectShape(0.18, 0.016, 0.006), 0.012, 0.004, 0.003, 2, 8);
      addMesh(root, arrowBarGeo, palette.brassRecessed, 0, -0.075, 0.014);
      break;
    }

    case 'LT_COLONEL':
    case 'MAJOR': {
      const leafMat = rankId === 'LT_COLONEL' ? palette.silver : palette.brass;
      const underLeafGeo = extrude('oak_under', createOakLeafShape, 0.01, 0.004, 0.004, 2, 16);
      const mainLeafGeo = extrude('oak_main', createOakLeafShape, 0.018, 0.007, 0.005, 3, 16);
      addMesh(root, underLeafGeo, palette.brassRecessed, 0, -0.006, 0.003);
      addMesh(root, mainLeafGeo, leafMat, 0, -0.006, 0.009);

      // Raised central midrib + angled lateral veins (seated cleanly above mainLeaf front face at z = 0.034)
      const ribGeo = extrude('oak_midrib', () => createRoundedRectShape(0.016, 0.29, 0.006), 0.009, 0.003, 0.003, 2, 8);
      addMesh(root, ribGeo, palette.brassRecessed, 0, 0.015, 0.032);

      const veinGeo = extrude('oak_vein', () => createRoundedRectShape(0.088, 0.011, 0.004), 0.007, 0.002, 0.002, 2, 6);
      for (const [vx, vy, rot] of [
        [-0.044, -0.032, -0.52],
        [0.044, -0.032, 0.52],
        [-0.048, 0.046, -0.48],
        [0.048, 0.046, 0.48],
      ] as const) {
        const v = addMesh(root, veinGeo, palette.brassRecessed, vx, vy, 0.032);
        v.rotation.z = rot;
      }
      break;
    }

    case 'CAPTAIN': {
      const bridgeGeo = extrude('cpt_bridge', () => createRoundedRectShape(0.18, 0.024, 0.006), 0.012, 0.004, 0.003, 2, 8);
      addMesh(root, bridgeGeo, palette.brassRecessed, 0, 0.086, 0.007);
      addMesh(root, bridgeGeo, palette.brassRecessed, 0, -0.086, 0.007);

      const barBaseGeo = extrude('cpt_bar_base', () => createRoundedRectShape(0.09, 0.31, 0.014), 0.014, 0.005, 0.004, 2, 10);
      const barTopGeo = extrude('cpt_bar_top', () => createRoundedRectShape(0.068, 0.282, 0.01), 0.014, 0.006, 0.005, 3, 10);
      for (const bx of [-0.072, 0.072]) {
        addMesh(root, barBaseGeo, palette.brassRecessed, bx, 0, 0.004);
        addMesh(root, barTopGeo, palette.silver, bx, 0, 0.016);
      }
      break;
    }

    case 'LT_1ST':
    case 'LT_2ND': {
      const barMat = rankId === 'LT_1ST' ? palette.silver : palette.brass;
      const baseGeo = extrude('lt_base', () => createRoundedRectShape(0.132, 0.33, 0.018), 0.014, 0.005, 0.004, 2, 10);
      const topGeo = extrude('lt_top', () => createRoundedRectShape(0.104, 0.296, 0.014), 0.016, 0.007, 0.005, 3, 10);
      const ridgeGeo = extrude('lt_ridge', () => createRoundedRectShape(0.036, 0.23, 0.008), 0.008, 0.003, 0.003, 2, 8);

      addMesh(root, baseGeo, palette.brassRecessed, 0, 0, 0.004);
      addMesh(root, topGeo, barMat, 0, 0, 0.016);
      addMesh(root, ridgeGeo, palette.brassRecessed, 0, 0, 0.032);
      break;
    }

    case 'SERGEANT': {
      const shieldGeo = extrude('sgt_shield', () => createShieldShape(0.32, 0.34), 0.008, 0.004, 0.004, 2, 10);
      addMesh(root, shieldGeo, palette.contactShadow, 0, -0.008, 0.002);

      const chevGeo = extrude('sgt_chev', () => createChevronShape(0.148, 0.115, 0.034), 0.018, 0.006, 0.005, 3, 8);
      for (const cy of [0.095, 0.015, -0.065]) {
        addMesh(root, chevGeo, palette.brass, 0, cy, 0.01);
      }
      break;
    }

    case 'PRIVATE': {
      const backGeo = extrude('pvt_back', () => createChevronShape(0.178, 0.22, 0.058), 0.012, 0.004, 0.004, 2, 8);
      const mainGeo = extrude('pvt_main', () => createChevronShape(0.164, 0.195, 0.048), 0.02, 0.007, 0.005, 3, 8);
      addMesh(root, backGeo, palette.brassRecessed, 0, -0.01, 0.004);
      addMesh(root, mainGeo, palette.brass, 0, -0.006, 0.013);
      break;
    }

    case 'SPY': {
      // Sculpted Cipher Diamond-Eye + Obsidian Lens + Vertical Stiletto Dagger
      const eyeFrameGeo = extrude(
        'spy_eye_frame',
        () => createDiamondEyeFrameShape(0.185, 0.125, 0.128, 0.076),
        0.016,
        0.006,
        0.005,
        3,
        14
      );
      addMesh(root, eyeFrameGeo, palette.brass, 0, 0, 0.006);

      const pupilDiskGeo = cachedGeo('spy_pupil', () => {
        const g = new THREE.CylinderGeometry(0.068, 0.072, 0.012, 24);
        g.rotateX(Math.PI / 2);
        return g;
      });
      addMesh(root, pupilDiskGeo, palette.contactShadow, 0, 0, 0.008);

      const irisRingGeo = extrude('spy_iris_ring', () => createRingShape(0.066, 0.046), 0.008, 0.003, 0.003, 2, 20);
      addMesh(root, irisRingGeo, palette.brassRecessed, 0, 0, 0.013);

      const bladeGeo = extrude('spy_blade', createDaggerBladeShape, 0.014, 0.005, 0.004, 2, 8);
      addMesh(root, bladeGeo, palette.silver, 0, 0.005, 0.018);

      const guardGeo = extrude('spy_guard', () => createRoundedRectShape(0.135, 0.024, 0.008), 0.016, 0.005, 0.004, 2, 8);
      addMesh(root, guardGeo, palette.brass, 0, -0.088, 0.02);

      const gripGeo = extrude('spy_grip', () => createRoundedRectShape(0.026, 0.075, 0.008), 0.014, 0.004, 0.003, 2, 8);
      addMesh(root, gripGeo, palette.brassRecessed, 0, -0.138, 0.018);

      const pommelGeo = cachedGeo('spy_pommel', () => {
        const pts = [
          new THREE.Vector2(0, -0.016),
          new THREE.Vector2(0.022, -0.006),
          new THREE.Vector2(0.022, 0.008),
          new THREE.Vector2(0, 0.016),
        ];
        const g = new THREE.LatheGeometry(pts, 14);
        g.rotateX(Math.PI / 2);
        return g;
      });
      addMesh(root, pommelGeo, palette.brass, 0, -0.184, 0.022);
      break;
    }

    case 'FLAG': {
      // Turned Lathe Flagstaff + Spherical Finial + Wavy Battle Standard + Star Canton Crest
      const staffGeo = cachedGeo('flag_staff', () => {
        const pts = [
          new THREE.Vector2(0.028, -0.185),
          new THREE.Vector2(0.028, -0.168),
          new THREE.Vector2(0.014, -0.162),
          new THREE.Vector2(0.012, 0.165),
          new THREE.Vector2(0.022, 0.175),
          new THREE.Vector2(0.024, 0.192),
          new THREE.Vector2(0.0, 0.21),
        ];
        const g = new THREE.LatheGeometry(pts, 16);
        const nAttr = g.getAttribute('normal');
        if (nAttr) {
          for (let i = 0; i < nAttr.count; i++) {
            const nx = nAttr.getX(i);
            const ny = nAttr.getY(i);
            const nz = nAttr.getZ(i);
            const len = Math.hypot(nx, ny, nz);
            if (len > 1e-6) {
              nAttr.setXYZ(i, nx / len, ny / len, nz / len);
            } else {
              nAttr.setXYZ(i, 0, 1, 0);
            }
          }
          nAttr.needsUpdate = true;
        }
        return g;
      });
      addMesh(root, staffGeo, palette.brass, -0.118, 0, 0.016);

      const bannerBackGeo = extrude('flag_banner_back', createWavyFlagShape, 0.012, 0.004, 0.004, 2, 18);
      addMesh(root, bannerBackGeo, palette.brassRecessed, 0, 0, 0.006);

      const bannerFrontGeo = extrude('flag_banner_front', createWavyFlagShape, 0.012, 0.005, 0.004, 3, 18);
      const bannerFront = addMesh(root, bannerFrontGeo, palette.brass, 0, 0, 0.014);
      bannerFront.scale.set(0.94, 0.88, 1);
      bannerFront.position.set(0.003, 0.01, 0.015);

      const cantonStarGeo = extrude('flag_star', () => createStarShape(5, 0.044, 0.019), 0.009, 0.003, 0.003, 2, 8);
      addMesh(root, cantonStarGeo, palette.silver, -0.025, 0.088, 0.028);
      break;
    }
  }

  return root;
}

export function buildAttackMedallionMesh(palette: EmblemMaterialPalette): THREE.Group {
  const root = new THREE.Group();
  root.name = 'AttackMedallion';

  // Chamfered antique-brass slab filling the center-top square
  const slabGeo = extrude(
    'medallion_slab',
    () => createRoundedRectShape(0.88, 0.88, 0.1),
    0.088,
    0.028,
    0.026,
    5,
    20
  );
  const slab = new THREE.Mesh(slabGeo, palette.brass);
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = 0.028;
  slab.castShadow = true;
  slab.receiveShadow = true;
  root.add(slab);

  const innerTrayGeo = extrude(
    'medallion_tray',
    () => createRoundedRectShape(0.73, 0.73, 0.06),
    0.012,
    0.005,
    0.005,
    2,
    14
  );
  const innerTray = new THREE.Mesh(innerTrayGeo, palette.brassRecessed);
  innerTray.rotation.x = -Math.PI / 2;
  innerTray.position.y = 0.132;
  innerTray.castShadow = true;
  innerTray.receiveShadow = true;
  root.add(innerTray);

  // Sculpted 3D Crossed Cavalry Sabers + Outer Ring + Central Starburst Boss
  const relief = new THREE.Group();
  relief.rotation.x = -Math.PI / 2;
  relief.position.y = 0.146;

  const crestRingGeo = extrude('medallion_ring', () => createRingShape(0.285, 0.25), 0.01, 0.004, 0.004, 2, 32);
  addMesh(relief, crestRingGeo, palette.brassRecessed, 0, 0, 0.002);

  const bladeGeo = extrude('medallion_saber_blade', createCurvedSaberBladeShape, 0.014, 0.005, 0.004, 3, 14);
  const guardGeo = extrude('medallion_saber_guard', createSaberGuardShape, 0.018, 0.005, 0.004, 2, 12);
  const gripGeo = extrude('medallion_saber_grip', () => createRoundedRectShape(0.024, 0.115, 0.008), 0.015, 0.004, 0.003, 2, 8);

  for (const dir of [-1, 1] as const) {
    const saber = new THREE.Group();
    saber.rotation.z = dir * THREE.MathUtils.degToRad(42);
    saber.scale.x = dir;
    addMesh(saber, bladeGeo, palette.silver, 0, -0.02, 0.01);
    addMesh(saber, guardGeo, palette.brass, 0, -0.02, 0.008);
    addMesh(saber, gripGeo, palette.brassRecessed, 0, -0.175, 0.009);
    relief.add(saber);
  }

  const burstGeo = extrude('medallion_starburst', () => createStarShape(8, 0.092, 0.044), 0.016, 0.006, 0.005, 3, 10);
  addMesh(relief, burstGeo, palette.brass, 0, 0.01, 0.022);

  const centerDomeGeo = cachedGeo('medallion_boss_dome', () => {
    const pts = [
      new THREE.Vector2(0, 0.022),
      new THREE.Vector2(0.028, 0.016),
      new THREE.Vector2(0.042, 0),
    ];
    const g = new THREE.LatheGeometry(pts, 18);
    g.rotateX(Math.PI / 2);
    return g;
  });
  addMesh(relief, centerDomeGeo, palette.silver, 0, 0.01, 0.036);

  root.add(relief);
  return root;
}
