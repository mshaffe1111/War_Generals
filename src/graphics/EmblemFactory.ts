import * as THREE from 'three';
import { RANK_SPECS, type RankId } from '../core/ranks';

export interface EmblemMaterialPalette {
  readonly brass: THREE.MeshPhysicalMaterial;
  readonly silver: THREE.MeshPhysicalMaterial;
  readonly brassRecessed: THREE.MeshPhysicalMaterial;
  readonly contactShadow: THREE.MeshStandardMaterial;
}

/**
 * Builds a true 10-facet 3D pyramidal military star (5 outer tips, 5 inner valleys,
 * raised central apex + beveled vertical skirt) so light catches opposing star facets
 * identically to die-struck brass in ref_rank_symbols_4x4.jpg.
 */
function createFacetedStarGeometry(
  outerRadius: number,
  innerRadius: number,
  baseHeight: number,
  apexHeight: number
): THREE.BufferGeometry {
  const positions: number[] = [];

  const pushTri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  const ring: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const zLift = i % 2 === 0 ? baseHeight * 0.92 : baseHeight * 1.15;
    ring.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, z: zLift });
  }

  for (let i = 0; i < 10; i++) {
    const curr = ring[i]!;
    const next = ring[(i + 1) % 10]!;
    // Top pyramidal facet meeting at proud center apex
    pushTri(0, 0, apexHeight, curr.x, curr.y, curr.z, next.x, next.y, next.z);
    // Beveled perimeter skirt down to z = 0
    const s = 1.05;
    pushTri(curr.x * s, curr.y * s, 0, next.x * s, next.y * s, 0, next.x, next.y, next.z);
    pushTri(curr.x * s, curr.y * s, 0, next.x, next.y, next.z, curr.x, curr.y, curr.z);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a crisp roof-ridged 3D military chevron (`^`) whose upper & lower slopes meet
 * along a raised spine so light separates top & bottom facets like ref_battle_act1_lockin.jpg.
 */
function createRidgedChevronGeometry(
  halfWidth: number,
  peakRise: number,
  bandThickness: number,
  ridgeZ: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const pushQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    pushTri(a, b, c);
    pushTri(a, c, d);
  };

  const midHalf = bandThickness * 0.5;
  const edgeZ = ridgeZ * 0.28;

  // Left arm -> center peak -> right arm
  const topPeak = new THREE.Vector3(0, peakRise + midHalf, edgeZ);
  const spinePeak = new THREE.Vector3(0, peakRise, ridgeZ);
  const botPeak = new THREE.Vector3(0, peakRise - midHalf, edgeZ);

  const leftTop = new THREE.Vector3(-halfWidth, -peakRise * 0.35 + midHalf, edgeZ);
  const leftSpine = new THREE.Vector3(-halfWidth, -peakRise * 0.35, ridgeZ * 0.88);
  const leftBot = new THREE.Vector3(-halfWidth, -peakRise * 0.35 - midHalf, edgeZ);

  const rightTop = new THREE.Vector3(halfWidth, -peakRise * 0.35 + midHalf, edgeZ);
  const rightSpine = new THREE.Vector3(halfWidth, -peakRise * 0.35, ridgeZ * 0.88);
  const rightBot = new THREE.Vector3(halfWidth, -peakRise * 0.35 - midHalf, edgeZ);

  // Left upper & lower roof facets
  pushQuad(leftSpine, spinePeak, topPeak, leftTop);
  pushQuad(leftBot, botPeak, spinePeak, leftSpine);

  // Right upper & lower roof facets
  pushQuad(spinePeak, rightSpine, rightTop, topPeak);
  pushQuad(botPeak, rightBot, rightSpine, spinePeak);

  // Side skirts to z = 0
  const z0 = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.y, 0);
  pushQuad(z0(leftTop), leftTop, topPeak, z0(topPeak));
  pushQuad(z0(topPeak), topPeak, rightTop, z0(rightTop));
  pushQuad(z0(rightBot), rightBot, botPeak, z0(botPeak));
  pushQuad(z0(botPeak), botPeak, leftBot, z0(leftBot));
  // Left & right end caps
  pushTri(z0(leftBot), leftBot, leftSpine);
  pushTri(z0(leftBot), leftSpine, leftTop);
  pushTri(z0(leftBot), leftTop, z0(leftTop));

  pushTri(z0(rightTop), rightTop, rightSpine);
  pushTri(z0(rightTop), rightSpine, rightBot);
  pushTri(z0(rightTop), rightBot, z0(rightBot));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function extrudeShape(
  shape: THREE.Shape,
  depth = 0.016,
  bevelThickness = 0.008,
  bevelSize = 0.006,
  bevelSegments = 3
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments: 20,
  });
  geo.computeVertexNormals();
  return geo;
}

function createRoundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

/**
 * Botanical 7-lobed Oak Leaf + proud raised central petiole & radial veins
 * matching Lt. Colonel (Silver) and Major (Brass) in ref_rank_symbols_4x4.jpg.
 */
function buildOakLeafGroup(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();

  const leaf = new THREE.Shape();
  // Start at base of leaf blade above stem
  const pts: Array<[number, number]> = [
    [0.0, -0.11],
    [0.055, -0.125],
    [0.125, -0.095],
    [0.145, -0.055],
    [0.085, -0.035], // lower right sinus
    [0.165, 0.01],
    [0.18, 0.06],
    [0.105, 0.065], // mid right sinus
    [0.15, 0.12],
    [0.12, 0.165],
    [0.06, 0.135], // upper right sinus
    [0.042, 0.195],
    [0.0, 0.215], // apex lobe
    [-0.042, 0.195],
    [-0.06, 0.135],
    [-0.12, 0.165],
    [-0.15, 0.12],
    [-0.105, 0.065],
    [-0.18, 0.06],
    [-0.165, 0.01],
    [-0.085, -0.035],
    [-0.145, -0.055],
    [-0.125, -0.095],
    [-0.055, -0.125],
  ];

  leaf.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) {
    const curr = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const mx = (curr[0] + next[0]) * 0.5;
    const my = (curr[1] + next[1]) * 0.5;
    leaf.quadraticCurveTo(curr[0], curr[1], mx, my);
  }
  leaf.closePath();

  const bladeMesh = new THREE.Mesh(extrudeShape(leaf, 0.015, 0.008, 0.006, 4), mat);
  g.add(bladeMesh);

  // Dark oxidized relief shadow grooves flanking veins so Silver & Brass Oak Leaf veins pop crisply!
  const veinGrooveMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2a2f38'),
    metalness: 0.55,
    roughness: 0.62,
  });

  // Raised central stem / midrib + 6 lateral veins
  const stemBack = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.34, 6, 10), veinGrooveMat);
  stemBack.position.set(0, -0.015, 0.018);
  stemBack.scale.set(1, 1, 0.45);
  g.add(stemBack);

  const stemGeo = new THREE.CapsuleGeometry(0.011, 0.34, 6, 10);
  const stem = new THREE.Mesh(stemGeo, mat);
  stem.position.set(0, -0.015, 0.025);
  stem.scale.set(1, 1, 0.75);
  g.add(stem);

  const veinSpecs = [
    { x: 0.058, y: -0.055, rot: -0.95, len: 0.1 },
    { x: -0.058, y: -0.055, rot: 0.95, len: 0.1 },
    { x: 0.068, y: 0.025, rot: -0.82, len: 0.12 },
    { x: -0.068, y: 0.025, rot: 0.82, len: 0.12 },
    { x: 0.052, y: 0.1, rot: -0.68, len: 0.09 },
    { x: -0.052, y: 0.1, rot: 0.68, len: 0.09 },
  ];
  for (const v of veinSpecs) {
    const vBack = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, v.len, 5, 8), veinGrooveMat);
    vBack.position.set(v.x, v.y, 0.018);
    vBack.rotation.z = v.rot;
    vBack.scale.set(1, 1, 0.45);
    g.add(vBack);

    const vein = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, v.len, 5, 8), mat);
    vein.position.set(v.x, v.y, 0.025);
    vein.rotation.z = v.rot;
    vein.scale.set(1, 1, 0.65);
    g.add(vein);
  }

  return g;
}

/**
 * Multi-layered Spread War Eagle matching Colonel (Brushed Silver) in ref_rank_symbols_4x4.jpg:
 * Feathered swept wings, fanned tail, eagle head & beak, talons, and proud striped central shield.
 */
function buildColonelEagleGroup(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const oxidizedSilver = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#303742'),
    metalness: 0.62,
    roughness: 0.55,
  });

  // Wing builder (mirrored for left & right)
  for (const dir of [-1, 1]) {
    const wing = new THREE.Shape();
    wing.moveTo(dir * 0.03, 0.02);
    wing.quadraticCurveTo(dir * 0.11, 0.1, dir * 0.22, 0.18);
    // Scalloped primary feather tips stepping down outer wing edge
    wing.lineTo(dir * 0.205, 0.125);
    wing.lineTo(dir * 0.215, 0.11);
    wing.lineTo(dir * 0.185, 0.075);
    wing.lineTo(dir * 0.192, 0.06);
    wing.lineTo(dir * 0.16, 0.03);
    wing.lineTo(dir * 0.165, 0.015);
    wing.lineTo(dir * 0.128, -0.012);
    wing.lineTo(dir * 0.095, -0.032);
    wing.lineTo(dir * 0.04, -0.035);
    wing.closePath();

    const wingMesh = new THREE.Mesh(extrudeShape(wing, 0.014, 0.007, 0.005, 3), mat);
    g.add(wingMesh);

    // Individual raised covert feather ridges on upper wing
    for (let f = 0; f < 4; f++) {
      const feather = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0085, 0.075 - f * 0.01, 5, 8),
        mat
      );
      feather.position.set(dir * (0.095 + f * 0.026), 0.038 + f * 0.024, 0.019);
      feather.rotation.z = dir * (-0.72 - f * 0.06);
      feather.scale.set(1, 1, 0.65);
      g.add(feather);
    }

    // Outstretched talons + olive/arrow bundle
    const talon = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.075, 5, 8), mat);
    talon.position.set(dir * 0.082, -0.095, 0.014);
    talon.rotation.z = dir * 0.85;
    g.add(talon);
  }

  // Fanned tail feathers at bottom
  for (let t = -2; t <= 2; t++) {
    const tailFeather = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.075, 5, 8), mat);
    tailFeather.position.set(t * 0.017, -0.135 + Math.abs(t) * 0.006, 0.012);
    tailFeather.rotation.z = t * 0.19;
    tailFeather.scale.set(1, 1, 0.65);
    g.add(tailFeather);
  }

  // Eagle neck, head & hooked beak (facing viewer's left like ref_rank_symbols_4x4.jpg)
  const headShape = new THREE.Shape();
  headShape.moveTo(-0.028, 0.055);
  headShape.lineTo(0.028, 0.055);
  headShape.quadraticCurveTo(0.034, 0.115, 0.01, 0.145);
  headShape.quadraticCurveTo(-0.02, 0.155, -0.052, 0.132); // hooked eagle beak left
  headShape.lineTo(-0.034, 0.115);
  headShape.quadraticCurveTo(-0.032, 0.085, -0.028, 0.055);
  const headMesh = new THREE.Mesh(extrudeShape(headShape, 0.018, 0.007, 0.005, 3), mat);
  headMesh.position.z = 0.006;
  g.add(headMesh);

  // Proud central heraldic escutcheon shield (oxidized recessed field + bright silver chief & stripes!)
  const shield = new THREE.Shape();
  shield.moveTo(-0.056, 0.055);
  shield.lineTo(0.056, 0.055);
  shield.lineTo(0.056, -0.035);
  shield.quadraticCurveTo(0.052, -0.085, 0.0, -0.108);
  shield.quadraticCurveTo(-0.052, -0.085, -0.056, -0.035);
  shield.closePath();
  const shieldMesh = new THREE.Mesh(extrudeShape(shield, 0.02, 0.006, 0.004, 3), oxidizedSilver);
  shieldMesh.position.z = 0.008;
  g.add(shieldMesh);

  // Chief header bar + 4 vertical stripes on shield
  const chiefBar = new THREE.Mesh(
    extrudeShape(createRoundedRectShape(0.104, 0.03, 0.005), 0.01, 0.003, 0.003, 2),
    mat
  );
  chiefBar.position.set(0, 0.038, 0.03);
  g.add(chiefBar);

  for (const sx of [-0.033, -0.011, 0.011, 0.033]) {
    const pale = new THREE.Mesh(
      extrudeShape(createRoundedRectShape(0.012, 0.082, 0.003), 0.009, 0.002, 0.002, 2),
      mat
    );
    pale.position.set(sx, -0.028, 0.03);
    g.add(pale);
  }

  return g;
}

/**
 * Crossed Daggers matching Spy emblem in ref_rank_symbols_4x4.jpg.
 */
function buildSpyDaggersGroup(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();

  const makeSingleDagger = (): THREE.Group => {
    const d = new THREE.Group();
    // Double-edged tapered diamond-section blade
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0.215);
    bladeShape.quadraticCurveTo(0.026, 0.12, 0.024, -0.035);
    bladeShape.lineTo(-0.024, -0.035);
    bladeShape.quadraticCurveTo(-0.026, 0.12, 0, 0.215);
    const blade = new THREE.Mesh(extrudeShape(bladeShape, 0.013, 0.007, 0.005, 3), mat);
    d.add(blade);

    // Central fuller spine
    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.22, 4), mat);
    spine.position.set(0, 0.08, 0.018);
    spine.scale.set(0.85, 1, 0.65);
    d.add(spine);

    // Crossguard
    const guard = new THREE.Mesh(
      extrudeShape(createRoundedRectShape(0.095, 0.022, 0.007), 0.018, 0.005, 0.004, 2),
      mat
    );
    guard.position.set(0, -0.045, 0.002);
    d.add(guard);

    // Ribbed hilt grip (3 rings) + pommel
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 12), mat);
      ring.position.set(0, -0.075 - r * 0.026, 0.012);
      ring.scale.set(1, 1, 0.72);
      d.add(ring);
    }
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.016, 0.022, 12), mat);
    pommel.position.set(0, -0.155, 0.012);
    pommel.scale.set(1, 1, 0.75);
    d.add(pommel);

    return d;
  };

  const d1 = makeSingleDagger();
  d1.rotation.z = -Math.PI / 4;
  g.add(d1);

  const d2 = makeSingleDagger();
  d2.rotation.z = Math.PI / 4;
  d2.position.z = 0.006; // subtle overlap at center crossing
  g.add(d2);

  return g;
}

/**
 * Waving Banner on Angled Pole matching Flag emblem in ref_rank_symbols_4x4.jpg.
 */
function buildFlagGroup(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const assembly = new THREE.Group();
  assembly.rotation.z = 0.14; // slight classic flagpole tilt matching ref_rank_symbols_4x4.jpg

  // Pole + finial ball
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.37, 14), mat);
  pole.position.set(-0.115, -0.01, 0.014);
  assembly.add(pole);

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.021, 14, 12), mat);
  finial.position.set(-0.115, 0.185, 0.016);
  assembly.add(finial);

  // S-wave sculpted 3D banner mesh
  const segX = 22;
  const segY = 12;
  const bannerW = 0.235;
  const bannerH = 0.165;
  const topGeo = new THREE.PlaneGeometry(bannerW, bannerH, segX, segY);
  const pos = topGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = (x + bannerW / 2) / bannerW; // 0 at pole .. 1 at fly edge
    const waveY = Math.sin(u * Math.PI * 2.0) * 0.018;
    const waveZ = Math.sin(u * Math.PI * 2.0) * 0.014 + 0.018;
    pos.setY(i, y + waveY);
    pos.setZ(i, waveZ);
  }
  topGeo.computeVertexNormals();

  // Give banner solid beveled thickness by pairing front surface + rim + back
  const bannerShape = new THREE.Shape();
  for (let i = 0; i <= segX; i++) {
    const u = i / segX;
    const x = -0.105 + u * bannerW;
    const y = 0.145 + Math.sin(u * Math.PI * 2.0) * 0.022;
    if (i === 0) bannerShape.moveTo(x, y);
    else bannerShape.lineTo(x, y);
  }
  for (let i = segX; i >= 0; i--) {
    const u = i / segX;
    const x = -0.105 + u * bannerW;
    const y = -0.015 + Math.sin(u * Math.PI * 2.0) * 0.022;
    bannerShape.lineTo(x, y);
  }
  bannerShape.closePath();

  const bannerGeo = extrudeShape(bannerShape, 0.014, 0.007, 0.005, 3);
  const bPos = bannerGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const x = bPos.getX(i);
    const u = Math.max(0, Math.min(1, (x + 0.105) / bannerW));
    bPos.setZ(i, bPos.getZ(i) + Math.sin(u * Math.PI * 2.0) * 0.011);
  }
  bannerGeo.computeVertexNormals();

  const bannerMesh = new THREE.Mesh(bannerGeo, mat);
  assembly.add(bannerMesh);

  g.add(assembly);
  return g;
}

/**
 * Crossed Sabers over Concentric Target Rings (16th Emblem / Attack Medallion relief).
 */
export function buildCrossedSabersRelief(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();

  // Concentric double target rings
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.013, 12, 36), mat);
  outerRing.position.z = 0.012;
  outerRing.scale.set(1, 1, 0.7);
  g.add(outerRing);

  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.011, 12, 32), mat);
  innerRing.position.z = 0.012;
  innerRing.scale.set(1, 1, 0.7);
  g.add(innerRing);

  const makeSaber = (mirrorGuard: number): THREE.Group => {
    const s = new THREE.Group();
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0.245);
    bladeShape.quadraticCurveTo(0.026 * mirrorGuard, 0.11, 0.016, -0.085);
    bladeShape.lineTo(-0.014, -0.085);
    bladeShape.quadraticCurveTo(0.002 * mirrorGuard, 0.11, 0, 0.245);
    const blade = new THREE.Mesh(extrudeShape(bladeShape, 0.014, 0.006, 0.004, 3), mat);
    s.add(blade);

    // Crossbar + curved D-guard bow + grip
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.09, 10), mat);
    grip.position.set(0, -0.135, 0.012);
    s.add(grip);

    const guardBow = new THREE.Mesh(
      new THREE.TorusGeometry(0.044, 0.0085, 10, 20, Math.PI),
      mat
    );
    guardBow.position.set(0.006 * mirrorGuard, -0.132, 0.014);
    guardBow.rotation.z = mirrorGuard > 0 ? -Math.PI / 2 : Math.PI / 2;
    s.add(guardBow);

    const quillon = new THREE.Mesh(
      extrudeShape(createRoundedRectShape(0.078, 0.016, 0.005), 0.014, 0.004, 0.003, 2),
      mat
    );
    quillon.position.set(0, -0.09, 0.006);
    s.add(quillon);

    return s;
  };

  const s1 = makeSaber(1);
  s1.rotation.z = -Math.PI / 4;
  s1.position.z = 0.012;
  g.add(s1);

  const s2 = makeSaber(-1);
  s2.rotation.z = Math.PI / 4;
  s2.position.z = 0.018;
  g.add(s2);

  return g;
}

/**
 * Heavy chamfered brushed-brass Attack Medallion slab dropped onto the contested grid square
 * during Act 1–3 (`ref_battle_act1_lockin.jpg`).
 */
export function buildAttackMedallionMesh(palette: EmblemMaterialPalette): THREE.Group {
  const root = new THREE.Group();

  // Outer chamfered rounded-square brass slab
  const baseShape = createRoundedRectShape(0.76, 0.76, 0.085);
  const slabGeo = extrudeShape(baseShape, 0.085, 0.026, 0.024, 4);
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, palette.brass);
  slab.position.y = 0.026;
  slab.castShadow = true;
  slab.receiveShadow = true;
  root.add(slab);

  // Stepped recessed inner tray for crisp rim framing
  const innerTrayGeo = extrudeShape(createRoundedRectShape(0.62, 0.62, 0.05), 0.012, 0.006, 0.006, 2);
  innerTrayGeo.rotateX(-Math.PI / 2);
  const innerTray = new THREE.Mesh(innerTrayGeo, palette.brassRecessed);
  innerTray.position.y = 0.128;
  innerTray.receiveShadow = true;
  root.add(innerTray);

  // Embossed Crossed Sabers + Target Rings lying proud on top face
  const relief = buildCrossedSabersRelief(palette.brass);
  relief.rotation.x = -Math.PI / 2;
  relief.scale.setScalar(1.18);
  relief.position.y = 0.138;
  relief.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  root.add(relief);

  return root;
}

/**
 * Constructs any of the 15 official metallic 3D Rank Reliefs (proud +0.018 mount)
 * matching ref_rank_symbols_4x4.jpg.
 */
export function buildRankEmblemMesh(
  rankId: RankId,
  palette: EmblemMaterialPalette
): THREE.Group {
  const spec = RANK_SPECS[rankId];
  const mat = spec.metal === 'SILVER' ? palette.silver : palette.brass;
  const group = new THREE.Group();

  const addStarCluster = (coords: Array<[number, number]>, rOuter: number) => {
    const starGeo = createFacetedStarGeometry(rOuter, rOuter * 0.4, 0.013, 0.038);
    for (const [x, y] of coords) {
      const m = new THREE.Mesh(starGeo, mat);
      m.position.set(x, y, 0);
      group.add(m);
    }
  };

  switch (rankId) {
    case 'GEN_5': {
      // Crisp 5-Star Pentagon Cluster (unmistakable 5 stars!)
      const R = 0.108;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        const ang = Math.PI / 2 + (i * Math.PI * 2) / 5;
        pts.push([Math.cos(ang) * R, Math.sin(ang) * R - 0.008]);
      }
      addStarCluster(pts, 0.064);
      break;
    }
    case 'GEN_4': {
      // 4-Star Diamond
      addStarCluster(
        [
          [0, 0.115],
          [-0.105, 0],
          [0.105, 0],
          [0, -0.115],
        ],
        0.068
      );
      break;
    }
    case 'GEN_3': {
      // 3-Star Triangle
      addStarCluster(
        [
          [0, 0.095],
          [-0.095, -0.075],
          [0.095, -0.075],
        ],
        0.074
      );
      break;
    }
    case 'GEN_2': {
      // 2-Star Pair
      addStarCluster(
        [
          [-0.092, 0],
          [0.092, 0],
        ],
        0.08
      );
      break;
    }
    case 'GEN_1': {
      // Single Bold Star
      addStarCluster([[0, 0]], 0.145);
      break;
    }
    case 'COLONEL': {
      group.add(buildColonelEagleGroup(mat));
      break;
    }
    case 'LT_COLONEL':
    case 'MAJOR': {
      group.add(buildOakLeafGroup(mat));
      break;
    }
    case 'CAPTAIN': {
      // Twin Linked Silver Vertical Bars
      const barGeo = extrudeShape(createRoundedRectShape(0.082, 0.3, 0.01), 0.02, 0.009, 0.007, 3);
      const leftBar = new THREE.Mesh(barGeo, mat);
      leftBar.position.set(-0.088, 0, 0);
      group.add(leftBar);

      const rightBar = new THREE.Mesh(barGeo, mat);
      rightBar.position.set(0.088, 0, 0);
      group.add(rightBar);

      for (const cy of [0.082, -0.082]) {
        const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 12), mat);
        bridge.rotation.z = Math.PI / 2;
        bridge.position.set(0, cy, 0.014);
        group.add(bridge);
      }
      break;
    }
    case 'LT_1ST': {
      // Single Beveled Silver Vertical Bar
      const barGeo = extrudeShape(createRoundedRectShape(0.092, 0.31, 0.01), 0.022, 0.01, 0.008, 3);
      group.add(new THREE.Mesh(barGeo, mat));
      break;
    }
    case 'LT_2ND': {
      // Framed Brass Vertical Bar (raised outer frame + recessed satin-gold inner panel)
      const outer = createRoundedRectShape(0.125, 0.32, 0.01);
      const hole = createRoundedRectShape(0.072, 0.258, 0.006);
      outer.holes.push(hole);

      const frameMesh = new THREE.Mesh(extrudeShape(outer, 0.024, 0.008, 0.006, 3), mat);
      group.add(frameMesh);

      const innerPanel = new THREE.Mesh(
        extrudeShape(createRoundedRectShape(0.078, 0.264, 0.005), 0.013, 0.004, 0.003, 2),
        palette.brassRecessed
      );
      group.add(innerPanel);
      break;
    }
    case 'SERGEANT': {
      // 3 Stacked Roof-Ridged Chevrons matching ref_battle_act1_lockin.jpg!
      const chevGeo = createRidgedChevronGeometry(0.145, 0.078, 0.044, 0.034);
      for (const dy of [0.09, -0.005, -0.1]) {
        const c = new THREE.Mesh(chevGeo, mat);
        c.position.set(0, dy, 0);
        group.add(c);
      }
      break;
    }
    case 'PRIVATE': {
      // Single Bold Roof-Ridged Chevron
      const chevGeo = createRidgedChevronGeometry(0.165, 0.095, 0.052, 0.038);
      const c = new THREE.Mesh(chevGeo, mat);
      c.position.set(0, -0.01, 0);
      group.add(c);
      break;
    }
    case 'SPY': {
      group.add(buildSpyDaggersGroup(mat));
      break;
    }
    case 'FLAG': {
      group.add(buildFlagGroup(mat));
      break;
    }
  }

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return group;
}
