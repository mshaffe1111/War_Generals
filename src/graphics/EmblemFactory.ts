import * as THREE from 'three';
import { RANK_SPECS, type RankId } from '../core/ranks';

export interface EmblemMaterialPalette {
  readonly brass: THREE.MeshPhysicalMaterial;
  readonly silver: THREE.MeshPhysicalMaterial;
  readonly brassRecessed: THREE.MeshPhysicalMaterial;
  readonly contactShadow: THREE.MeshStandardMaterial;
}

type AtlasCellId = RankId | 'ATTACK_MEDALLION';

/**
 * Exact 4x4 UV grid cell mapping matching `public/textures/ref_rank_symbols_4x4.jpg`
 * (`2048x2048` master atlas + normal + border-flood-fill alpha cutout).
 */
const ATLAS_CELL_COORDS: Readonly<Record<AtlasCellId, readonly [col: number, row: number]>> = {
  GEN_5: [0, 0], // Repaired 5-Star pentagon cluster composited from (0,1) photorealistic star!
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

function getSharedAtlasMaterials(maxAnisotropy = 8): SharedAtlasMaterials {
  if (cachedAtlasMats) return cachedAtlasMats;

  const loader = new THREE.TextureLoader();

  // Also trigger preload of `/textures/ref_rank_symbols_4x4.jpg` so it is hot in browser cache
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

  // Bright Brushed Brass (`#E2B04A`, metalness: 0.92, roughness: 0.22, envMapIntensity: 1.35)
  const brassCap = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#E2B04A'),
    map: cutoutTex,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(1.75, 1.75),
    metalness: 0.92,
    roughness: 0.22,
    clearcoat: 0.16,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.35,
    alphaTest: 0.32,
    transparent: false,
    side: THREE.FrontSide,
  });

  const brassSide = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8C631E'),
    map: cutoutTex,
    metalness: 0.88,
    roughness: 0.36,
    envMapIntensity: 1.1,
    alphaTest: 0.28,
  });

  // Bright Brushed Silver (`#DCE2EA`, metalness: 0.95, roughness: 0.18, envMapIntensity: 1.35)
  const silverCap = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#DCE2EA'),
    map: cutoutTex,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(1.75, 1.75),
    metalness: 0.95,
    roughness: 0.18,
    clearcoat: 0.2,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.35,
    alphaTest: 0.32,
    transparent: false,
    side: THREE.FrontSide,
  });

  const silverSide = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7B8594'),
    map: cutoutTex,
    metalness: 0.9,
    roughness: 0.34,
    envMapIntensity: 1.1,
    alphaTest: 0.28,
  });

  // Contact ambient-occlusion shadow layer sitting flush on the sloped wedge surface
  const aoShadow = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#05080f'),
    alphaMap: cutoutTex,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  // Note: `cutoutTex` RGBA has normalized greyscale in RGB and alpha in A; use custom map+alphaTest shadow
  aoShadow.alphaMap = null;
  aoShadow.map = cutoutTex;
  aoShadow.color.setRGB(0.03, 0.04, 0.07);
  aoShadow.alphaTest = 0.16;

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
  // flipY = true on standard Three.js textures -> row 0 (top) is v in [0.75, 1.0]
  const v0 = 1.0 - (row + 1) * 0.25 + pad;
  const v1 = 1.0 - row * 0.25 - pad;

  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // PlaneGeometry vertex order: (0: top-left, 1: top-right, 2: bottom-left, 3: bottom-right)
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

/**
 * Builds a proud multi-layered 3D metallic relief emblem (`+0.022` thickness) from the `2048x2048`
 * `ref_rank_symbols_4x4.jpg` cutout/normal atlas, scaled to fill **72% of the sloped front wedge face**
 * (`size = 0.50` on the `0.61`-wide front bevel) so every insignia pops from full tabletop height!
 */
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
  const rimGeo = getCellQuadGeometry(cellId, size * 1.016);

  // 1. Flush contact ambient-occlusion shadow (`z = +0.002`)
  const shadow = new THREE.Mesh(rimGeo, mats.aoShadow);
  shadow.position.set(0, -0.008, 0.002);
  root.add(shadow);

  // 2. Stepped 3D metallic extrusion wall layers (`z = +0.006, +0.011, +0.016`)
  for (const zOff of [0.006, 0.011, 0.016]) {
    const wall = new THREE.Mesh(rimGeo, sideMat);
    wall.position.z = zOff;
    wall.castShadow = true;
    wall.receiveShadow = true;
    root.add(wall);
  }

  // 3. Top high-gloss brushed metallic relief face (`z = +0.021`) with `2048x2048` normal map
  const cap = new THREE.Mesh(geo, capMat);
  cap.position.z = 0.021;
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
  // Scale `0.50` fills ~72% of the sloped front wedge face (`68%–75%` target)!
  return buildLayeredAtlasRelief(rankId, spec.metal, 0.5);
}

/**
 * Heavy chamfered brushed-brass Attack Medallion slab embossed with cell `(3, 3)`
 * Crossed Sabers over Target Rings (`2048x2048` normal + cutout relief).
 */
export function buildAttackMedallionMesh(palette: EmblemMaterialPalette): THREE.Group {
  const root = new THREE.Group();

  const slabGeo = new THREE.ExtrudeGeometry(createRoundedRectShape(0.78, 0.78, 0.09), {
    depth: 0.085,
    bevelEnabled: true,
    bevelThickness: 0.026,
    bevelSize: 0.024,
    bevelSegments: 4,
    curveSegments: 18,
  });
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, palette.brass);
  slab.position.y = 0.026;
  slab.castShadow = true;
  slab.receiveShadow = true;
  root.add(slab);

  const innerTrayGeo = new THREE.ExtrudeGeometry(createRoundedRectShape(0.64, 0.64, 0.055), {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 2,
    curveSegments: 14,
  });
  innerTrayGeo.rotateX(-Math.PI / 2);
  const innerTray = new THREE.Mesh(innerTrayGeo, palette.brassRecessed);
  innerTray.position.y = 0.128;
  innerTray.receiveShadow = true;
  root.add(innerTray);

  const sabersRelief = buildLayeredAtlasRelief('ATTACK_MEDALLION', 'BRASS', 0.58);
  sabersRelief.rotation.x = -Math.PI / 2;
  sabersRelief.position.y = 0.136;
  root.add(sabersRelief);

  return root;
}
