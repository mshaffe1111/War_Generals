import * as THREE from 'three';
import { RANK_SPECS, type RankId } from '../core/ranks';

export interface EmblemMaterialPalette {
  readonly brass: THREE.MeshPhysicalMaterial;
  readonly silver: THREE.MeshPhysicalMaterial;
  readonly brassRecessed: THREE.MeshPhysicalMaterial;
  readonly contactShadow: THREE.MeshStandardMaterial;
}

type AtlasCellId = RankId | 'ATTACK_MEDALLION';

const ATLAS_CELL_COORDS: Readonly<Record<AtlasCellId, readonly [col: number, row: number]>> = {
  GEN_5: [0, 0],
  GEN_4: [1, 0],
  GEN_3: [2, 0],
  GEN_2: [3, 0],
  GEN_1: [0, 1],
  COLONEL: [1, 1],
  LT_COLONEL: [2, 1],
  MAJOR: [3, 1],
  CAPTAIN: [0, 2],
  LT_1ST: [1, 2],
  LT_2ND: [2, 2],
  SERGEANT: [3, 2],
  PRIVATE: [0, 3],
  SPY: [1, 3],
  FLAG: [2, 3],
  ATTACK_MEDALLION: [3, 3],
};

interface SharedAtlasMaterials {
  brassCap: THREE.MeshPhysicalMaterial;
  brassSide: THREE.MeshStandardMaterial;
  silverCap: THREE.MeshPhysicalMaterial;
  silverSide: THREE.MeshStandardMaterial;
  aoShadow: THREE.MeshBasicMaterial;
}

let cachedAtlasMats: SharedAtlasMaterials | null = null;
const cellGeometryCache = new Map<string, THREE.BufferGeometry>();

function getSharedAtlasMaterials(maxAnisotropy = 16): SharedAtlasMaterials {
  if (cachedAtlasMats) return cachedAtlasMats;

  const loader = new THREE.TextureLoader();

  const masterRef = loader.load('./textures/ref_rank_symbols_4x4.jpg');
  masterRef.colorSpace = THREE.SRGBColorSpace;

  const cutoutTex = loader.load('./textures/rank_atlas_cutout.png');
  cutoutTex.colorSpace = THREE.SRGBColorSpace;
  cutoutTex.anisotropy = maxAnisotropy;
  cutoutTex.minFilter = THREE.LinearMipmapLinearFilter;
  cutoutTex.magFilter = THREE.LinearFilter;

  const normalTex = loader.load('./textures/rank_atlas_normal.png');
  normalTex.colorSpace = THREE.NoColorSpace;
  normalTex.anisotropy = maxAnisotropy;
  normalTex.minFilter = THREE.LinearMipmapLinearFilter;
  normalTex.magFilter = THREE.LinearFilter;

  // Warm Die-Struck Antique Brass (`#E4B656`) with subtle self-illuminated gold-leaf sheen
  // so rank emblems stay 100% crisp and legible even inside deep chiaroscuro shadows!
  const brassCap = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#E8BA5A'),
    map: cutoutTex,
    emissive: new THREE.Color('#D89B38'),
    emissiveMap: cutoutTex,
    emissiveIntensity: 0.34,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(2.05, 2.05),
    metalness: 0.88,
    roughness: 0.24,
    clearcoat: 0.14,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.92,
    alphaTest: 0.46,
    alphaToCoverage: true,
    side: THREE.FrontSide,
  });

  const brassSide = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7A5418'),
    map: cutoutTex,
    emissive: new THREE.Color('#5E3E0E'),
    emissiveMap: cutoutTex,
    emissiveIntensity: 0.22,
    metalness: 0.86,
    roughness: 0.36,
    envMapIntensity: 0.65,
    alphaTest: 0.46,
    alphaToCoverage: true,
  });

  // Crisp Brushed Sterling Silver (`#D6E0EC`) with subtle self-illuminated silver sheen (zero bloom halo!)
  const silverCap = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#D6E0EC'),
    map: cutoutTex,
    emissive: new THREE.Color('#A8B8CE'),
    emissiveMap: cutoutTex,
    emissiveIntensity: 0.32,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(2.05, 2.05),
    metalness: 0.86,
    roughness: 0.27,
    clearcoat: 0.1,
    clearcoatRoughness: 0.26,
    envMapIntensity: 0.72,
    alphaTest: 0.46,
    alphaToCoverage: true,
    side: THREE.FrontSide,
  });

  const silverSide = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#4B5463'),
    map: cutoutTex,
    metalness: 0.88,
    roughness: 0.36,
    envMapIntensity: 0.68,
    alphaTest: 0.44,
    alphaToCoverage: true,
  });

  const aoShadow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.015, 0.02, 0.035),
    map: cutoutTex,
    alphaTest: 0.38,
    alphaToCoverage: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });

  cachedAtlasMats = { brassCap, brassSide, silverCap, silverSide, aoShadow };
  return cachedAtlasMats;
}

function getCellQuadGeometry(cellId: AtlasCellId, size: number): THREE.BufferGeometry {
  const key = `${cellId}:${size.toFixed(3)}`;
  const hit = cellGeometryCache.get(key);
  if (hit) return hit;

  const [col, row] = ATLAS_CELL_COORDS[cellId];
  const pad = 0.004;
  const u0 = col * 0.25 + pad;
  const u1 = (col + 1) * 0.25 - pad;
  const v0 = 1.0 - (row + 1) * 0.25 + pad;
  const v1 = 1.0 - row * 0.25 - pad;

  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  uv.setXY(0, u0, v1);
  uv.setXY(1, u1, v1);
  uv.setXY(2, u0, v0);
  uv.setXY(3, u1, v0);
  uv.needsUpdate = true;

  cellGeometryCache.set(key, geo);
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

function buildLayeredAtlasRelief(
  cellId: AtlasCellId,
  metal: 'BRASS' | 'SILVER',
  size: number
): THREE.Group {
  const mats = getSharedAtlasMaterials();
  const capMat = metal === 'SILVER' ? mats.silverCap : mats.brassCap;
  const sideMat = metal === 'SILVER' ? mats.silverSide : mats.brassSide;

  const root = new THREE.Group();
  const geo = getCellQuadGeometry(cellId, size);
  const rimGeo = getCellQuadGeometry(cellId, size * 1.014);

  const shadow = new THREE.Mesh(rimGeo, mats.aoShadow);
  shadow.position.set(0, -0.012, 0.002);
  root.add(shadow);

  for (const zOff of [0.006, 0.012, 0.018]) {
    const wall = new THREE.Mesh(rimGeo, sideMat);
    wall.position.z = zOff;
    wall.castShadow = true;
    wall.receiveShadow = true;
    root.add(wall);
  }

  const cap = new THREE.Mesh(geo, capMat);
  cap.position.z = 0.023;
  cap.castShadow = true;
  cap.receiveShadow = true;
  root.add(cap);

  return root;
}

export function buildRankEmblemMesh(
  rankId: RankId,
  _palette: EmblemMaterialPalette
): THREE.Group {
  const spec = RANK_SPECS[rankId];
  // 0.515 fills ~72% of the sloped Command Wedge front face (`ref_piece_turnaround.jpg`)
  return buildLayeredAtlasRelief(rankId, spec.metal, 0.515);
}

export function buildAttackMedallionMesh(palette: EmblemMaterialPalette): THREE.Group {
  const root = new THREE.Group();

  // Bold 0.88x0.88 chamfered antique-brass slab filling the center-top square (`ref_battle_act1..3.jpg`)
  const slabGeo = new THREE.ExtrudeGeometry(createRoundedRectShape(0.88, 0.88, 0.1), {
    depth: 0.088,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.026,
    bevelSegments: 5,
    curveSegments: 20,
  });
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, palette.brass);
  slab.position.y = 0.028;
  slab.castShadow = true;
  slab.receiveShadow = true;
  root.add(slab);

  const innerTrayGeo = new THREE.ExtrudeGeometry(createRoundedRectShape(0.73, 0.73, 0.06), {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 2,
    curveSegments: 14,
  });
  innerTrayGeo.rotateX(-Math.PI / 2);
  const innerTray = new THREE.Mesh(innerTrayGeo, palette.brassRecessed);
  innerTray.position.y = 0.132;
  innerTray.receiveShadow = true;
  root.add(innerTray);

  const sabersRelief = buildLayeredAtlasRelief('ATTACK_MEDALLION', 'BRASS', 0.66);
  sabersRelief.rotation.x = -Math.PI / 2;
  sabersRelief.position.y = 0.142;
  root.add(sabersRelief);

  return root;
}
