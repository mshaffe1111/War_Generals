import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PIECE_COLOR_SPECS } from '../core/pieceColors';
import {
  BOARD_COLS,
  BOARD_ROWS,
  ORDERED_RANKS,
  RANK_SPECS,
  type Faction,
  type RankId,
} from '../core/ranks';
import { getBattleTheater } from '../core/theaters';
import type {
  BattleTheaterSpec,
  BoardFinishMode,
  ManualRankOutcome,
  PieceColorId,
  SuspectTag,
  TheaterId,
} from '../core/types';
import {
  buildAttackMedallionMesh,
  buildRankEmblemMesh,
  type EmblemMaterialPalette,
} from './EmblemFactory';
import {
  createBrushedMetalBumpMap,
  createNavalCompassDialTexture,
  createSlateBumpMap,
  createTacticalPhosphorRadarTexture,
} from './ProceduralTextures';

export const TILE_PITCH = 1.0;
export const GRID_CENTER_Z = 0.85;
export const ARBITER_BAY_CENTER_Z = -4.78;
export const LEFT_WELL_CENTER = new THREE.Vector3(-3.68, -0.28, -4.78);
export const RIGHT_WELL_CENTER = new THREE.Vector3(3.68, -0.28, -4.78);
export const HERO_WEDGE_SCALE = 1.08;

export const WEDGE_EMBLEM_MOUNT = {
  y: 0.36,
  z: 0.116,
  rotXRad: -THREE.MathUtils.degToRad(33.0),
  scale: 0.84,
} as const;

export function gridToWorld(col: number, row: number): THREE.Vector3 {
  const x = (col - (BOARD_COLS - 1) / 2) * TILE_PITCH;
  const z = (row - (BOARD_ROWS - 1) / 2) * TILE_PITCH + GRID_CENTER_Z;
  return new THREE.Vector3(x, 0, z);
}

export interface SharedPBRMaterials {
  readonly walnut: THREE.MeshPhysicalMaterial;
  readonly slateTile: THREE.MeshPhysicalMaterial;
  readonly obsidianGroove: THREE.MeshStandardMaterial;
  readonly brassTrim: THREE.MeshPhysicalMaterial;
  readonly enemyBronzeTrim: THREE.MeshPhysicalMaterial;
  readonly brassRecessed: THREE.MeshPhysicalMaterial;
  readonly silverEmblem: THREE.MeshPhysicalMaterial;
  readonly playerNavy: THREE.MeshPhysicalMaterial;
  readonly playerInset: THREE.MeshStandardMaterial;
  readonly enemyCrimson: THREE.MeshPhysicalMaterial;
  readonly enemyInset: THREE.MeshStandardMaterial;
  readonly velvetNavy: THREE.MeshPhysicalMaterial;
  readonly velvetCrimson: THREE.MeshPhysicalMaterial;
  readonly gunmetal: THREE.MeshPhysicalMaterial;
  readonly darkSteel: THREE.MeshStandardMaterial;
  readonly oiledSpringSteel: THREE.MeshStandardMaterial;
  readonly mudTerrain: THREE.MeshStandardMaterial;
  readonly sandbagBurlap: THREE.MeshStandardMaterial;
  readonly bunkerConcrete: THREE.MeshStandardMaterial;
  readonly emblemPalette: EmblemMaterialPalette;
}

export interface WarRoomEnvironmentRefs {
  readonly root: THREE.Group;
  readonly tableLanternShadowLight: THREE.PointLight;
  readonly lanternLightRight: THREE.PointLight;
  readonly lanternFlameMat: THREE.MeshStandardMaterial;
  readonly tentBackdropMesh: THREE.Mesh;
  readonly tentBackdropMat: THREE.MeshStandardMaterial;
  readonly watchSecondHand: THREE.Object3D;
}

export interface BakedArbiterHardwareParts {
  readonly warfieldArena: THREE.Object3D | null;
}

export interface SceneTheaterRefs {
  readonly scene?: THREE.Scene;
  readonly warRoom?: WarRoomEnvironmentRefs;
  readonly keyLight?: THREE.DirectionalLight;
  readonly rimLight?: THREE.SpotLight;
  readonly ambientLight?: THREE.HemisphereLight;
  readonly factory?: MeshFactory;
}

interface BakedMonolithGeometries {
  body: THREE.BufferGeometry | null;
  brassPlinth: THREE.BufferGeometry | null;
  escutcheon: THREE.BufferGeometry | null;
}

interface LiveWedgeRefs {
  readonly faction: Faction;
  readonly bodyMesh: THREE.Mesh;
  readonly plinthMesh: THREE.Mesh;
  readonly insetMesh: THREE.Mesh;
}

interface TheaterGroupBundle {
  readonly backdrop: THREE.Group;
  readonly props: THREE.Group;
}

export function makeRoundedRectPath(
  cx: number,
  cz: number,
  w: number,
  d: number,
  r: number,
  asShape = false
): THREE.Shape | THREE.Path {
  const sy = -cz;
  const hw = w / 2;
  const hd = d / 2;
  const p = asShape ? new THREE.Shape() : new THREE.Path();
  p.moveTo(cx - hw + r, sy - hd);
  p.lineTo(cx + hw - r, sy - hd);
  p.quadraticCurveTo(cx + hw, sy - hd, cx + hw, sy - hd + r);
  p.lineTo(cx + hw, sy + hd - r);
  p.quadraticCurveTo(cx + hw, sy + hd, cx + hw - r, sy + hd);
  p.lineTo(cx - hw + r, sy + hd);
  p.quadraticCurveTo(cx - hw, sy + hd, cx - hw, sy + hd - r);
  p.lineTo(cx - hw, sy - hd + r);
  p.quadraticCurveTo(cx - hw, sy - hd, cx - hw + r, sy - hd);
  return p;
}

function createExtrudedRoundedSlab(
  w: number,
  h: number,
  d: number,
  cornerR: number,
  bevelSize = 0.025,
  bevelSegments = 3
): THREE.BufferGeometry {
  const shape = makeRoundedRectPath(0, 0, w, d, cornerR, true) as THREE.Shape;
  const innerDepth = Math.max(0.004, h - bevelSize * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerDepth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments,
    curveSegments: 16,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -innerDepth * 0.5, 0);
  geo.computeVertexNormals();
  return geo;
}

function createCurledParchmentGeometry(w: number, d: number, thickness = 0.016): THREE.BufferGeometry {
  const segX = 28;
  const segZ = 18;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const evalHeight = (nx: number, nz: number): number => {
    const edgeCurl = Math.pow(Math.max(0, Math.abs(nx) - 0.65) / 0.35, 2) * 0.055;
    const cornerLift = Math.pow(Math.max(0, Math.abs(nx * nz) - 0.45), 1.6) * 0.045;
    const wave = Math.sin(nx * Math.PI * 1.6 + nz * 0.8) * 0.009;
    return edgeCurl + cornerLift + wave;
  };

  // Top & bottom surfaces
  for (let layer = 0; layer < 2; layer++) {
    const yOff = layer === 0 ? thickness * 0.5 : -thickness * 0.5;
    for (let iz = 0; iz <= segZ; iz++) {
      const vz = iz / segZ;
      const nz = vz * 2 - 1;
      const z = nz * d * 0.5;
      for (let ix = 0; ix <= segX; ix++) {
        const ux = ix / segX;
        const nx = ux * 2 - 1;
        const x = nx * w * 0.5;
        positions.push(x, evalHeight(nx, nz) + yOff, z);
        uvs.push(ux, 1 - vz);
      }
    }
  }

  const stride = segX + 1;
  const botOff = (segZ + 1) * stride;
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const dIdx = c + 1;
      indices.push(a, c, b, b, c, dIdx);

      const ba = botOff + a;
      const bb = botOff + b;
      const bc = botOff + c;
      const bd = botOff + dIdx;
      indices.push(ba, bb, bc, bb, bd, bc);
    }
  }

  // Perimeter thickness skirt
  const stitchEdge = (ringPairs: Array<[number, number]>) => {
    for (let i = 0; i < ringPairs.length - 1; i++) {
      const [t0, b0] = ringPairs[i]!;
      const [t1, b1] = ringPairs[i + 1]!;
      indices.push(t0, b0, t1, t1, b0, b1);
    }
  };
  stitchEdge(Array.from({ length: segX + 1 }, (_, ix) => [ix, botOff + ix]));
  stitchEdge(
    Array.from({ length: segZ + 1 }, (_, iz) => [iz * stride + segX, botOff + iz * stride + segX])
  );
  stitchEdge(
    Array.from({ length: segX + 1 }, (_, ix) => {
      const rx = segX - ix;
      return [segZ * stride + rx, botOff + segZ * stride + rx];
    })
  );
  stitchEdge(
    Array.from({ length: segZ + 1 }, (_, iz) => {
      const rz = segZ - iz;
      return [rz * stride, botOff + rz * stride];
    })
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createWatchDialCanvasTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 8, c, c, c * 0.96);
  g.addColorStop(0, '#e5d9bf');
  g.addColorStop(0.82, '#cbb997');
  g.addColorStop(1, '#8c7b5c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.96, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#241c13';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? 3.2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * (major ? 84 : 97), c + Math.sin(a) * (major ? 84 : 97));
    ctx.lineTo(c + Math.cos(a) * 108, c + Math.sin(a) * 108);
    ctx.stroke();
  }
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c - 26, c - 34);
  ctx.stroke();
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c + 44, c - 24);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTacticalCommandBaizeTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createRadialGradient(512, 512, 60, 512, 512, 700);
  bg.addColorStop(0, '#203028');
  bg.addColorStop(0.65, '#16241d');
  bg.addColorStop(1, '#0c1510');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(225, 182, 92, 0.24)';
  ctx.lineWidth = 1.5;
  const step = 128;
  for (let p = step; p < size; p += step) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(235, 192, 102, 0.36)';
  for (const r of [190, 330, 455]) {
    ctx.lineWidth = r === 330 ? 2.6 : 1.5;
    ctx.beginPath();
    ctx.arc(512, 512, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(512, 32);
  ctx.lineTo(512, 992);
  ctx.moveTo(32, 512);
  ctx.lineTo(992, 512);
  ctx.stroke();

  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const major = deg % 30 === 0;
    const r0 = major ? 434 : 445;
    ctx.lineWidth = major ? 2.4 : 1.2;
    ctx.beginPath();
    ctx.moveTo(512 + Math.cos(a) * r0, 512 + Math.sin(a) * r0);
    ctx.lineTo(512 + Math.cos(a) * 455, 512 + Math.sin(a) * 455);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  return tex;
}

export function applyTheaterVisuals(
  sceneRefs: SceneTheaterRefs,
  theaterId: TheaterId
): BattleTheaterSpec {
  const spec = getBattleTheater(theaterId);

  if (sceneRefs.factory) {
    sceneRefs.factory.applyTheaterVisuals(theaterId, {
      scene: sceneRefs.scene,
      warRoom: sceneRefs.warRoom,
      keyLight: sceneRefs.keyLight,
      rimLight: sceneRefs.rimLight,
      ambientLight: sceneRefs.ambientLight,
    });
    return spec;
  }

  if (sceneRefs.scene) {
    if (sceneRefs.scene.background instanceof THREE.Color) {
      sceneRefs.scene.background.set(spec.sceneBgHex);
    } else {
      sceneRefs.scene.background = new THREE.Color(spec.sceneBgHex);
    }
    if (sceneRefs.scene.fog instanceof THREE.FogExp2) {
      sceneRefs.scene.fog.color.set(spec.fogHex);
      sceneRefs.scene.fog.density = spec.fogDensity;
    } else {
      sceneRefs.scene.fog = new THREE.FogExp2(spec.fogHex, spec.fogDensity);
    }
  }

  if (sceneRefs.keyLight) {
    sceneRefs.keyLight.color.set(spec.keyLightHex);
    sceneRefs.keyLight.intensity = spec.keyLightIntensity;
  }
  if (sceneRefs.rimLight) {
    sceneRefs.rimLight.color.set(spec.rimLightHex);
    sceneRefs.rimLight.intensity = spec.rimLightIntensity;
  }
  if (sceneRefs.ambientLight) {
    sceneRefs.ambientLight.color.set(spec.ambientSkyHex);
    sceneRefs.ambientLight.groundColor.set(spec.ambientGroundHex);
    sceneRefs.ambientLight.intensity = spec.ambientIntensity;
  }
  if (sceneRefs.warRoom) {
    sceneRefs.warRoom.tableLanternShadowLight.color.set(spec.lanternHex);
    sceneRefs.warRoom.tableLanternShadowLight.intensity = spec.lanternIntensity * 2.8;
    sceneRefs.warRoom.lanternLightRight.color.set(spec.rimLightHex);
    sceneRefs.warRoom.lanternLightRight.intensity = spec.lanternIntensity * 1.45;
    sceneRefs.warRoom.tentBackdropMat.color.set(spec.backdropTintHex);
    sceneRefs.warRoom.lanternFlameMat.emissive.set(spec.lanternHex);
  }

  return spec;
}

export class MeshFactory {
  public readonly materials: SharedPBRMaterials;

  private readonly boardContainer = new THREE.Group();
  private readonly tablePropsContainer = new THREE.Group();
  private readonly watchMountGroup = new THREE.Group();
  private readonly tacticalTableMat: THREE.MeshStandardMaterial;
  private readonly oakTimberMat: THREE.MeshStandardMaterial;
  private readonly parchmentScrollMat: THREE.MeshStandardMaterial;
  private readonly lanternGlassMat: THREE.MeshPhysicalMaterial;

  private readonly wedgeAoGeo: THREE.PlaneGeometry;
  private readonly wedgeAoMat: THREE.MeshStandardMaterial;
  private fallbackWedgeGeo: THREE.BufferGeometry;
  private monolithGeos: BakedMonolithGeometries = {
    body: null,
    brassPlinth: null,
    escutcheon: null,
  };
  private readonly liveWedges = new Set<LiveWedgeRefs>();
  private readonly walnutAlbedoTex: THREE.Texture;
  private readonly walnutNormalTex: THREE.Texture;
  private activeBoardFinish: BoardFinishMode = 'WALNUT_SLATE';
  private activePieceColor: PieceColorId = 'NAVY';
  private activeTheaterId: TheaterId = 'FIELD_HQ';
  private activeWarRoomRefs: WarRoomEnvironmentRefs | null = null;
  private theaterBundles: Partial<Record<TheaterId, TheaterGroupBundle>> = {};

  private arbiterParts: BakedArbiterHardwareParts = {
    warfieldArena: null,
  };

  constructor() {
    const loader = new THREE.TextureLoader();

    const walnutAlbedo = loader.load('./textures/walnut_albedo.jpg');
    walnutAlbedo.colorSpace = THREE.SRGBColorSpace;
    walnutAlbedo.wrapS = walnutAlbedo.wrapT = THREE.RepeatWrapping;
    walnutAlbedo.anisotropy = 16;
    this.walnutAlbedoTex = walnutAlbedo;

    const walnutNormal = loader.load('./textures/walnut_normal.jpg');
    walnutNormal.colorSpace = THREE.NoColorSpace;
    walnutNormal.wrapS = walnutNormal.wrapT = THREE.RepeatWrapping;
    walnutNormal.anisotropy = 16;
    this.walnutNormalTex = walnutNormal;

    const velvetAlbedo = loader.load('./textures/velvet_albedo.jpg');
    velvetAlbedo.colorSpace = THREE.SRGBColorSpace;
    velvetAlbedo.anisotropy = 8;

    const velvetNormal = loader.load('./textures/velvet_normal.jpg');
    velvetNormal.colorSpace = THREE.NoColorSpace;
    velvetNormal.anisotropy = 8;

    const oakAlbedo = loader.load('./textures/oak_albedo.jpg');
    oakAlbedo.colorSpace = THREE.SRGBColorSpace;
    oakAlbedo.wrapS = oakAlbedo.wrapT = THREE.RepeatWrapping;

    const oakNormal = loader.load('./textures/oak_normal.jpg');
    oakNormal.colorSpace = THREE.NoColorSpace;
    oakNormal.wrapS = oakNormal.wrapT = THREE.RepeatWrapping;

    const mudAlbedo = loader.load('./textures/mud_albedo.jpg');
    mudAlbedo.colorSpace = THREE.SRGBColorSpace;
    mudAlbedo.wrapS = mudAlbedo.wrapT = THREE.RepeatWrapping;
    mudAlbedo.repeat.set(2, 2);

    const mudNormal = loader.load('./textures/mud_normal.jpg');
    mudNormal.colorSpace = THREE.NoColorSpace;
    mudNormal.wrapS = mudNormal.wrapT = THREE.RepeatWrapping;
    mudNormal.repeat.set(2, 2);

    const metalBump = createBrushedMetalBumpMap(256);
    const slateBump = createSlateBumpMap(256);

    const walnut = new THREE.MeshPhysicalMaterial({
      map: walnutAlbedo,
      normalMap: walnutNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      color: new THREE.Color('#BE9574'),
      roughness: 0.35,
      metalness: 0.02,
      clearcoat: 0.24,
      clearcoatRoughness: 0.24,
      envMapIntensity: 0.35,
    });

    const baizeTex = createTacticalCommandBaizeTexture();
    baizeTex.repeat.set(3.2, 2.4);
    this.tacticalTableMat = new THREE.MeshStandardMaterial({
      map: baizeTex,
      emissiveMap: baizeTex,
      emissive: new THREE.Color('#040a07'),
      emissiveIntensity: 0.45,
      normalMap: velvetNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      color: new THREE.Color('#16281f'),
      roughness: 0.82,
      metalness: 0.08,
      envMapIntensity: 0.2,
    });

    this.oakTimberMat = new THREE.MeshStandardMaterial({
      map: oakAlbedo,
      normalMap: oakNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: new THREE.Color('#8E6A48'),
      roughness: 0.68,
      metalness: 0.04,
      envMapIntensity: 0.22,
    });

    this.parchmentScrollMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#C8B48E'),
      bumpMap: slateBump,
      bumpScale: 0.004,
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.12,
    });

    this.lanternGlassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffcf86'),
      emissive: new THREE.Color('#ff9c3a'),
      emissiveIntensity: 1.55,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      clearcoat: 1.0,
    });

    const brassTrim = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#E6B85C'),
      emissive: new THREE.Color('#5A3D10'),
      emissiveIntensity: 0.28,
      metalness: 0.68,
      roughness: 0.32,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.1,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.72,
    });

    const enemyBronzeTrim = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#C99242'),
      emissive: new THREE.Color('#4A2E0B'),
      emissiveIntensity: 0.24,
      metalness: 0.68,
      roughness: 0.33,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.08,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.68,
    });

    const brassRecessed = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#8E6622'),
      metalness: 0.86,
      roughness: 0.4,
      bumpMap: metalBump,
      bumpScale: 0.006,
      envMapIntensity: 0.5,
    });

    const silverEmblem = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#B4BECB'),
      metalness: 0.84,
      roughness: 0.38,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.02,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.42,
    });

    const emblemBrass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#CFA048'),
      emissive: new THREE.Color('#2a1804'),
      emissiveIntensity: 0.02,
      metalness: 0.72,
      roughness: 0.4,
      bumpMap: metalBump,
      bumpScale: 0.005,
      clearcoat: 0.02,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.4,
    });

    const slateTile = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#232934'),
      roughness: 0.58,
      metalness: 0.08,
      bumpMap: slateBump,
      bumpScale: 0.01,
      clearcoat: 0.05,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.16,
    });

    const obsidianGroove = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#040508'),
      roughness: 0.95,
      metalness: 0.04,
      envMapIntensity: 0.05,
    });

    const playerNavy = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#132A52'),
      roughness: 0.38,
      metalness: 0.08,
      bumpMap: slateBump,
      bumpScale: 0.003,
      clearcoat: 0.18,
      clearcoatRoughness: 0.32,
      sheen: 0.2,
      sheenColor: new THREE.Color('#3b72bf'),
      envMapIntensity: 0.2,
    });

    const playerInset = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#081328'),
      roughness: 0.55,
      metalness: 0.12,
      envMapIntensity: 0.12,
    });

    const enemyCrimson = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#661524'),
      roughness: 0.38,
      metalness: 0.08,
      bumpMap: slateBump,
      bumpScale: 0.003,
      clearcoat: 0.18,
      clearcoatRoughness: 0.32,
      sheen: 0.2,
      sheenColor: new THREE.Color('#b03248'),
      envMapIntensity: 0.2,
    });

    const enemyInset = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2B070E'),
      roughness: 0.55,
      metalness: 0.12,
      envMapIntensity: 0.12,
    });

    const velvetNavy = new THREE.MeshPhysicalMaterial({
      map: velvetAlbedo,
      normalMap: velvetNormal,
      normalScale: new THREE.Vector2(1.4, 1.4),
      color: new THREE.Color('#132E68'),
      roughness: 0.96,
      metalness: 0.0,
      sheen: 0.65,
      sheenRoughness: 0.72,
      sheenColor: new THREE.Color('#3462ba'),
      envMapIntensity: 0.08,
    });

    const velvetCrimson = new THREE.MeshPhysicalMaterial({
      map: velvetAlbedo,
      normalMap: velvetNormal,
      normalScale: new THREE.Vector2(1.4, 1.4),
      color: new THREE.Color('#641326'),
      roughness: 0.96,
      metalness: 0.0,
      sheen: 0.65,
      sheenRoughness: 0.72,
      sheenColor: new THREE.Color('#b8324c'),
      envMapIntensity: 0.08,
    });

    const gunmetal = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#2B313B'),
      metalness: 0.82,
      roughness: 0.34,
      bumpMap: metalBump,
      bumpScale: 0.005,
      clearcoat: 0.12,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.68,
    });

    const darkSteel = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1B2028'),
      metalness: 0.78,
      roughness: 0.36,
      envMapIntensity: 0.58,
    });

    const oiledSpringSteel = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#7B8594'),
      metalness: 0.88,
      roughness: 0.27,
      bumpMap: metalBump,
      bumpScale: 0.004,
      envMapIntensity: 0.72,
    });

    const mudTerrain = new THREE.MeshStandardMaterial({
      map: mudAlbedo,
      normalMap: mudNormal,
      normalScale: new THREE.Vector2(1.9, 1.9),
      color: new THREE.Color('#8a7664'),
      roughness: 0.92,
      metalness: 0.04,
      envMapIntensity: 0.1,
    });

    const sandbagBurlap = new THREE.MeshStandardMaterial({
      map: velvetAlbedo,
      normalMap: velvetNormal,
      normalScale: new THREE.Vector2(1.5, 1.5),
      color: new THREE.Color('#8C7654'),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.12,
    });

    const bunkerConcrete = new THREE.MeshStandardMaterial({
      bumpMap: slateBump,
      bumpScale: 0.014,
      color: new THREE.Color('#2A303A'),
      roughness: 0.58,
      metalness: 0.45,
      envMapIntensity: 0.42,
    });

    const contactShadow = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#04060a'),
      roughness: 0.95,
      metalness: 0.0,
    });

    this.materials = {
      walnut,
      slateTile,
      obsidianGroove,
      brassTrim,
      enemyBronzeTrim,
      brassRecessed,
      silverEmblem,
      playerNavy,
      playerInset,
      enemyCrimson,
      enemyInset,
      velvetNavy,
      velvetCrimson,
      gunmetal,
      darkSteel,
      oiledSpringSteel,
      mudTerrain,
      sandbagBurlap,
      bunkerConcrete,
      emblemPalette: {
        brass: emblemBrass,
        silver: silverEmblem,
        brassRecessed,
        contactShadow,
      },
    };

    const wAoCanvas = document.createElement('canvas');
    wAoCanvas.width = 64;
    wAoCanvas.height = 64;
    const wCtx = wAoCanvas.getContext('2d')!;
    const wGrad = wCtx.createRadialGradient(32, 32, 6, 32, 32, 30);
    wGrad.addColorStop(0, 'rgba(0, 0, 0, 0.94)');
    wGrad.addColorStop(0.68, 'rgba(0, 0, 0, 0.58)');
    wGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    wCtx.fillStyle = wGrad;
    wCtx.fillRect(0, 0, 64, 64);
    this.wedgeAoGeo = new THREE.PlaneGeometry(0.92, 0.78);
    this.wedgeAoGeo.rotateX(-Math.PI / 2);
    this.wedgeAoMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#000000'),
      map: new THREE.CanvasTexture(wAoCanvas),
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });

    this.fallbackWedgeGeo = this.buildFallbackWedgeGeometry();
  }

  public getActiveTheaterId(): TheaterId {
    return this.activeTheaterId;
  }

  public async preloadBakedModels(): Promise<BakedArbiterHardwareParts> {
    const loader = new GLTFLoader();

    const [boardRes, arenaRes, tableRes, wedgeRes, watchRes] = await Promise.allSettled([
      loader.loadAsync('./models/board_cabinet.glb'),
      loader.loadAsync('./models/warfield_arena.glb'),
      loader.loadAsync('./models/war_room_table.glb'),
      loader.loadAsync('./models/command_wedge.glb'),
      loader.loadAsync('./models/pocket_watch.glb'),
    ]);

    if (boardRes.status === 'fulfilled') {
      const scene = boardRes.value.scene;
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        const n = obj.name;
        if (n.includes('Cabinet')) {
          obj.material = this.materials.walnut;
        } else if (n.includes('Brass')) {
          obj.material = this.materials.brassTrim;
          obj.castShadow = !n.includes('Well');
        } else if (n.includes('Slate')) {
          obj.material = this.materials.slateTile;
          obj.castShadow = true;
        } else if (n.includes('NavyVelvet')) {
          obj.material = this.materials.velvetNavy;
          obj.castShadow = false;
        } else if (n.includes('CrimsonVelvet')) {
          obj.material = this.materials.velvetCrimson;
          obj.castShadow = false;
        } else {
          obj.material = this.materials.obsidianGroove;
          obj.castShadow = false;
        }
      });

      // Turned LatheGeometry Brass Corner Pedestal Feet + Knurled Sconce Bezels & Faceted Jewel Lenses
      const footGeo = new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, 0.0),
          new THREE.Vector2(0.56, 0.0),
          new THREE.Vector2(0.56, 0.045),
          new THREE.Vector2(0.49, 0.075),
          new THREE.Vector2(0.45, 0.14),
          new THREE.Vector2(0.48, 0.19),
          new THREE.Vector2(0.44, 0.24),
          new THREE.Vector2(0.0, 0.24),
        ],
        28
      );
      const sconceBezelGeo = new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.145, 0.0),
          new THREE.Vector2(0.145, 0.02),
          new THREE.Vector2(0.125, 0.042),
          new THREE.Vector2(0.088, 0.048),
          new THREE.Vector2(0.075, 0.025),
        ],
        24
      );
      const sconceJewelGeo = new THREE.IcosahedronGeometry(0.064, 0);
      const sconceJewelMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#ffcb70'),
        emissive: new THREE.Color('#ff9628'),
        emissiveIntensity: 1.75,
        roughness: 0.08,
        metalness: 0.1,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        toneMapped: false,
      });

      for (const [fx, fz, cx, cz] of [
        [-4.65, 5.05, -4.82, 5.12],
        [4.65, 5.05, 4.82, 5.12],
        [-4.65, -5.95, -4.82, -6.12],
        [4.65, -5.95, 4.82, -6.12],
      ] as const) {
        const foot = new THREE.Mesh(footGeo, this.materials.brassTrim);
        foot.position.set(fx, -0.7, fz);
        foot.castShadow = true;
        foot.receiveShadow = true;
        scene.add(foot);

        const bezel = new THREE.Mesh(sconceBezelGeo, this.materials.brassTrim);
        bezel.position.set(cx, 0.14, cz);
        bezel.castShadow = true;
        scene.add(bezel);

        const lens = new THREE.Mesh(sconceJewelGeo, sconceJewelMat);
        lens.scale.set(1, 0.72, 1);
        lens.position.set(cx, 0.184, cz);
        scene.add(lens);
      }

      // Sculpted ExtrudeGeometry 4-point Compass-Star Brass Waypoints on the 9x8 slate grid
      const compassStarShape = new THREE.Shape();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? 0.062 : 0.022;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) compassStarShape.moveTo(px, py);
        else compassStarShape.lineTo(px, py);
      }
      compassStarShape.closePath();
      const pipGeo = new THREE.ExtrudeGeometry(compassStarShape, {
        depth: 0.008,
        bevelEnabled: true,
        bevelThickness: 0.004,
        bevelSize: 0.004,
        bevelSegments: 2,
      });
      pipGeo.rotateX(-Math.PI / 2);

      for (const gx of [-1.5, 1.5]) {
        for (const gz of [-1.15, 0.85, 2.85]) {
          const pip = new THREE.Mesh(pipGeo, this.materials.brassTrim);
          pip.position.set(gx, 0.022, gz);
          pip.receiveShadow = true;
          scene.add(pip);
        }
      }

      const altTileMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#303949'),
        roughness: 0.44,
        metalness: 0.14,
        clearcoat: 0.12,
        clearcoatRoughness: 0.35,
        envMapIntensity: 0.26,
        transparent: true,
        opacity: 0.42,
      });
      const altGeo = new THREE.PlaneGeometry(0.89, 0.89);
      altGeo.rotateX(-Math.PI / 2);
      for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
          if ((r + c) % 2 === 0) {
            const p = gridToWorld(c, r);
            const m = new THREE.Mesh(altGeo, altTileMat);
            m.position.set(p.x, 0.021, p.z);
            m.receiveShadow = true;
            scene.add(m);
          }
        }
      }

      this.boardContainer.clear();
      this.boardContainer.add(scene);
    }

    let warfieldArena: THREE.Object3D | null = null;
    if (arenaRes.status === 'fulfilled') {
      warfieldArena = arenaRes.value.scene;
      warfieldArena.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        const n = obj.name;
        if (n.includes('MudTerrain')) {
          obj.material = this.materials.mudTerrain;
        } else if (n.includes('Sandbags')) {
          obj.material = this.materials.sandbagBurlap;
        } else if (n.includes('Brass') || n.includes('Barrels')) {
          obj.material = this.materials.brassTrim;
        } else if (n.includes('TankTraps') || n.includes('Guns')) {
          obj.material = this.materials.darkSteel;
        } else {
          obj.material = this.materials.bunkerConcrete;
        }
      });
    }
    this.arbiterParts = { warfieldArena };

    if (tableRes.status === 'fulfilled') {
      const tScene = tableRes.value.scene;
      tScene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const n = obj.name;
        obj.receiveShadow = true;
        if (n.includes('OakPlanks')) {
          obj.material = this.tacticalTableMat;
          obj.castShadow = false;
        } else if (n.includes('AmmoCrate')) {
          obj.material = this.oakTimberMat;
          obj.castShadow = true;
        } else if (n.includes('LanternGlass')) {
          obj.material = this.lanternGlassMat;
          obj.castShadow = false;
        } else if (n.includes('MapScrolls')) {
          obj.material = this.parchmentScrollMat;
          obj.castShadow = true;
        } else {
          obj.material = this.materials.brassTrim;
          obj.castShadow = true;
        }
      });
      this.tablePropsContainer.clear();
      this.tablePropsContainer.add(tScene);
    }

    // Multi-Part Sculpted Brass-Collared Command Monolith (`WedgeBody`, `WedgeBrassPlinth`, `WedgeEscutcheon`)
    if (wedgeRes.status === 'fulfilled') {
      wedgeRes.value.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (obj.name.includes('BrassPlinth')) {
          this.monolithGeos.brassPlinth = obj.geometry;
        } else if (obj.name.includes('Escutcheon')) {
          this.monolithGeos.escutcheon = obj.geometry;
        } else if (obj.name.includes('Body') || !this.monolithGeos.body) {
          this.monolithGeos.body = obj.geometry;
        }
      });

      for (const ref of this.liveWedges) {
        if (this.monolithGeos.body) {
          ref.bodyMesh.geometry = this.monolithGeos.body;
        }
        if (this.monolithGeos.brassPlinth) {
          ref.plinthMesh.geometry = this.monolithGeos.brassPlinth;
          ref.plinthMesh.visible = true;
        }
        if (this.monolithGeos.escutcheon) {
          ref.insetMesh.geometry = this.monolithGeos.escutcheon;
          ref.insetMesh.visible = true;
        }
      }
      this.liveWedges.clear();
    }

    if (watchRes.status === 'fulfilled') {
      const wScene = watchRes.value.scene;
      wScene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.material = this.materials.brassTrim;
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      const existingFallback = this.watchMountGroup.getObjectByName('fallbackWatchBody');
      if (existingFallback) this.watchMountGroup.remove(existingFallback);
      this.watchMountGroup.add(wScene);
    }

    return this.arbiterParts;
  }

  private buildFallbackWedgeGeometry(): THREE.BufferGeometry {
    // Matches F7 `command_wedge.glb`: 0.735u model height, 57 deg front cant, 78 deg armored rear
    const y0 = 0.0;
    const yShoulder = 0.62;
    const zf0 = 0.295;
    const zb0 = -0.275;
    const zfSh = zf0 - (yShoulder - 0.068) / Math.tan(THREE.MathUtils.degToRad(57.0));
    const zbSh = zb0 + (yShoulder - 0.068) / Math.tan(THREE.MathUtils.degToRad(78.0));

    const rings: Array<[number, number, number, number, number]> = [
      [y0, 0.36, 0.34, zf0, zb0],
      [0.068, 0.352, 0.332, zf0, zb0],
      [yShoulder, 0.258, 0.242, zfSh, zbSh],
      [0.71, 0.194, 0.18, zfSh - 0.022, zbSh + 0.016],
      [0.735, 0.14, 0.13, zfSh - 0.032, zbSh + 0.024],
    ];
    const ringVerts: THREE.Vector3[][] = rings.map(([y, hwf, hwb, zf, zb]) => {
      const c = 0.044 * (hwf / 0.36);
      return [
        new THREE.Vector3(-hwf + c, y, zf),
        new THREE.Vector3(hwf - c, y, zf),
        new THREE.Vector3(hwf, y, zf - c),
        new THREE.Vector3(hwb, y, zb + c),
        new THREE.Vector3(hwb - c, y, zb),
        new THREE.Vector3(-hwb + c, y, zb),
        new THREE.Vector3(-hwb, y, zb + c),
        new THREE.Vector3(-hwf, y, zf - c),
      ];
    });
    const positions: number[] = [];
    const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    for (let r = 0; r < ringVerts.length - 1; r++) {
      const lower = ringVerts[r]!;
      const upper = ringVerts[r + 1]!;
      for (let i = 0; i < 8; i++) {
        const ni = (i + 1) % 8;
        pushTri(lower[i]!, lower[ni]!, upper[ni]!);
        pushTri(lower[i]!, upper[ni]!, upper[i]!);
      }
    }
    const topRing = ringVerts[ringVerts.length - 1]!;
    const topCenter = new THREE.Vector3(0, 0.735, (zfSh + zbSh) * 0.5);
    for (let i = 0; i < 8; i++) {
      pushTri(topCenter, topRing[i]!, topRing[(i + 1) % 8]!);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  public createCommandWedge(
    faction: Faction,
    visibleRank: RankId | 'UNKNOWN',
    publicKills = 0,
    suspectTag: SuspectTag | null = null,
    faceCameraOverride?: boolean
  ): THREE.Group {
    const root = new THREE.Group();
    const isPlayer = faction === 'PLAYER';

    const bodyMat = isPlayer ? this.materials.playerNavy : this.materials.enemyCrimson;
    const plinthMat = isPlayer ? this.materials.brassTrim : this.materials.enemyBronzeTrim;
    const insetMat = isPlayer ? this.materials.playerInset : this.materials.enemyInset;

    const bodyMesh = new THREE.Mesh(this.monolithGeos.body ?? this.fallbackWedgeGeo, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    root.add(bodyMesh);

    const plinthMesh = new THREE.Mesh(
      this.monolithGeos.brassPlinth ?? new THREE.BufferGeometry(),
      plinthMat
    );
    plinthMesh.visible = Boolean(this.monolithGeos.brassPlinth);
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    root.add(plinthMesh);

    const insetMesh = new THREE.Mesh(
      this.monolithGeos.escutcheon ?? new THREE.BufferGeometry(),
      insetMat
    );
    insetMesh.visible = Boolean(this.monolithGeos.escutcheon);
    insetMesh.receiveShadow = true;
    root.add(insetMesh);

    if (!this.monolithGeos.body || !this.monolithGeos.brassPlinth || !this.monolithGeos.escutcheon) {
      this.liveWedges.add({ faction, bodyMesh, plinthMesh, insetMesh });
    }

    const aoDisc = new THREE.Mesh(this.wedgeAoGeo, this.wedgeAoMat);
    aoDisc.name = 'wedgeAoDisc';
    aoDisc.position.set(0.03, 0.004, -0.01);
    root.add(aoDisc);

    if (visibleRank !== 'UNKNOWN') {
      const emblem = buildRankEmblemMesh(visibleRank, this.materials.emblemPalette);
      emblem.scale.setScalar(WEDGE_EMBLEM_MOUNT.scale);
      emblem.position.set(0, WEDGE_EMBLEM_MOUNT.y, WEDGE_EMBLEM_MOUNT.z);
      emblem.rotation.x = WEDGE_EMBLEM_MOUNT.rotXRad;
      root.add(emblem);
    }

    // Sculpted ExtrudeGeometry Metallic Kill Chevrons atop the 0.735u crown (`publicKills >= 1`)
    if (publicKills > 0) {
      const pipCount = Math.min(3, publicKills);
      const chevShape = new THREE.Shape();
      chevShape.moveTo(0, 0.036);
      chevShape.lineTo(0.034, -0.024);
      chevShape.lineTo(0.018, -0.024);
      chevShape.lineTo(0, 0.008);
      chevShape.lineTo(-0.018, -0.024);
      chevShape.lineTo(-0.034, -0.024);
      chevShape.closePath();

      const pipGeo = new THREE.ExtrudeGeometry(chevShape, {
        depth: 0.014,
        bevelEnabled: true,
        bevelThickness: 0.004,
        bevelSize: 0.003,
        bevelSegments: 2,
      });
      pipGeo.translate(0, 0, -0.007);

      const pipMat = new THREE.MeshStandardMaterial({
        color: isPlayer ? new THREE.Color('#f7c654') : new THREE.Color('#ff5d47'),
        emissive: isPlayer ? new THREE.Color('#ffbd3b') : new THREE.Color('#ff3e29'),
        emissiveIntensity: 1.45,
        metalness: 0.72,
        roughness: 0.24,
        toneMapped: false,
      });
      for (let k = 0; k < pipCount; k++) {
        const offset = (k - (pipCount - 1) * 0.5) * 0.092;
        const pip = new THREE.Mesh(pipGeo, pipMat);
        pip.position.set(offset, 0.768, -0.112);
        pip.castShadow = true;
        root.add(pip);
      }

      if (publicKills >= 2) {
        const aceCol = isPlayer ? new THREE.Color(1.9, 1.45, 0.42) : new THREE.Color(2.3, 0.32, 0.38);
        const aceHaloMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#000000'),
          emissive: aceCol,
          emissiveIntensity: 1.0,
          roughness: 1.0,
          metalness: 0.0,
          envMapIntensity: 0.0,
          transparent: true,
          opacity: publicKills >= 3 ? 0.72 : 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const aceHalo = new THREE.Mesh(new THREE.RingGeometry(0.39, 0.445, 32), aceHaloMat);
        aceHalo.rotation.x = -Math.PI / 2;
        aceHalo.position.set(0, 0.012, 0);
        root.add(aceHalo);
      }
    }

    const shouldFaceCamera =
      faceCameraOverride !== undefined ? faceCameraOverride : faction === 'PLAYER';
    if (!shouldFaceCamera) {
      root.rotation.y = Math.PI;
    }

    if (suspectTag) {
      const badge = this.createHolographicPillSprite(suspectTag, 'AMBER');
      badge.position.set(0, 0.96, 0);
      root.add(badge);
    }

    root.scale.setScalar(HERO_WEDGE_SCALE);
    return root;
  }

  public createFieldManualWedge(rank: RankId, outcome: ManualRankOutcome): THREE.Group {
    const holder = new THREE.Group();
    holder.userData['manualRank'] = rank;

    const wedge = this.createCommandWedge('PLAYER', rank, 0, null, true);
    const isSelected = outcome === 'SELECTED' || outcome === 'FLAG_ATTACK_WIN';
    wedge.position.y = isSelected ? 0.14 : 0.0;
    holder.add(wedge);

    const ringColor =
      outcome === 'DEFEATS'
        ? new THREE.Color(0.18, 1.85, 0.95)
        : outcome === 'THREAT'
          ? new THREE.Color(2.15, 0.28, 0.38)
          : isSelected
            ? new THREE.Color(0.42, 1.75, 2.35)
            : new THREE.Color(1.85, 1.42, 0.48);

    const padGeo = new THREE.RingGeometry(0.0, 0.46, 36);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#000000'),
      emissive: ringColor,
      emissiveIntensity: 1.0,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
      transparent: true,
      opacity: isSelected ? 0.24 : outcome === 'SPLIT' ? 0.12 : 0.19,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.027;
    holder.add(pad);

    const haloGeo = new THREE.RingGeometry(0.43, 0.51, 40);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#000000'),
      emissive: ringColor,
      emissiveIntensity: 1.0,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = 0.031;
    holder.add(halo);

    const pillText =
      outcome === 'SELECTED'
        ? `${RANK_SPECS[rank].shortLabel}`
        : outcome === 'FLAG_ATTACK_WIN'
          ? 'WINS ON ATTACK'
          : outcome === 'DEFEATS'
            ? 'DEFEATS'
            : outcome === 'THREAT'
              ? 'THREAT'
              : 'SPLIT';
    const pillTone =
      outcome === 'DEFEATS'
        ? 'EMERALD'
        : outcome === 'THREAT'
          ? 'CRIMSON'
          : isSelected
            ? 'CYAN'
            : 'AMBER';
    const badge = this.createHolographicPillSprite(pillText, pillTone, true);
    badge.position.set(0, isSelected ? 1.12 : 0.96, 0);
    holder.add(badge);

    return holder;
  }

  public createHologramGhostWedge(rank: RankId): THREE.Group {
    const root = new THREE.Group();
    const srcGeo = this.monolithGeos.body ?? this.fallbackWedgeGeo;

    const holoMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#000000'),
      emissive: new THREE.Color(0.18, 1.45, 2.25),
      emissiveIntensity: 1.0,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const shell = new THREE.Mesh(srcGeo, holoMat);
    root.add(shell);

    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(srcGeo, 22),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(0.55, 1.95, 2.6),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    root.add(wire);

    const emblem = buildRankEmblemMesh(rank, this.materials.emblemPalette);
    emblem.scale.setScalar(WEDGE_EMBLEM_MOUNT.scale);
    emblem.position.set(0, WEDGE_EMBLEM_MOUNT.y, WEDGE_EMBLEM_MOUNT.z);
    emblem.rotation.x = WEDGE_EMBLEM_MOUNT.rotXRad;
    root.add(emblem);

    const label = this.createHolographicPillSprite(RANK_SPECS[rank].shortLabel, 'CYAN');
    label.position.set(0, 0.95, 0);
    root.add(label);

    root.scale.setScalar(HERO_WEDGE_SCALE);
    return root;
  }

  public createXRayReplayWedge(faction: Faction, trueRank: RankId, kills = 0): THREE.Group {
    const root = new THREE.Group();
    const isPlayer = faction === 'PLAYER';
    const srcGeo = this.monolithGeos.body ?? this.fallbackWedgeGeo;

    const shellMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#000000'),
      emissive: isPlayer ? new THREE.Color(0.08, 0.72, 1.18) : new THREE.Color(1.18, 0.14, 0.24),
      emissiveIntensity: 1.0,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    root.add(new THREE.Mesh(srcGeo, shellMat));

    const wireMat = new THREE.LineBasicMaterial({
      color: isPlayer ? new THREE.Color(0.35, 1.85, 2.55) : new THREE.Color(2.55, 0.36, 0.48),
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    root.add(new THREE.LineSegments(new THREE.EdgesGeometry(srcGeo, 20), wireMat));

    const emblem = buildRankEmblemMesh(trueRank, this.materials.emblemPalette);
    emblem.scale.setScalar(WEDGE_EMBLEM_MOUNT.scale);
    emblem.position.set(0, WEDGE_EMBLEM_MOUNT.y, WEDGE_EMBLEM_MOUNT.z);
    emblem.rotation.x = WEDGE_EMBLEM_MOUNT.rotXRad;
    root.add(emblem);

    const XRAY_CODE: Readonly<Record<RankId, string>> = {
      GEN_5: '5★',
      GEN_4: '4★',
      GEN_3: '3★',
      GEN_2: '2★',
      GEN_1: '1★',
      COLONEL: 'COL',
      LT_COLONEL: 'LTC',
      MAJOR: 'MAJ',
      CAPTAIN: 'CPT',
      LT_1ST: '1LT',
      LT_2ND: '2LT',
      SERGEANT: 'SGT',
      PRIVATE: 'PVT',
      SPY: 'SPY',
      FLAG: 'FLAG',
    };
    const tagLabel =
      kills > 0 ? `${XRAY_CODE[trueRank]} ★${kills}` : XRAY_CODE[trueRank];
    const pill = this.createHolographicPillSprite(tagLabel, isPlayer ? 'CYAN' : 'CRIMSON', true);
    pill.position.set(0, 0.88, 0);
    root.add(pill);

    root.scale.setScalar(HERO_WEDGE_SCALE);
    return root;
  }

  private createHolographicPillSprite(
    text: string,
    tone: 'AMBER' | 'CYAN' | 'CRIMSON' | 'EMERALD',
    compact = false
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = compact ? 196 : 256;
    canvas.height = 76;
    const ctx = canvas.getContext('2d')!;

    const borderCol =
      tone === 'AMBER'
        ? '#ffc44d'
        : tone === 'EMERALD'
          ? '#34f09e'
          : tone === 'CYAN'
            ? '#4de8ff'
            : '#ff5e72';
    const bgCol =
      tone === 'AMBER'
        ? 'rgba(30, 18, 5, 0.94)'
        : tone === 'EMERALD'
          ? 'rgba(6, 30, 20, 0.92)'
          : tone === 'CYAN'
            ? 'rgba(6, 22, 36, 0.9)'
            : 'rgba(36, 8, 14, 0.92)';
    const textCol =
      tone === 'AMBER'
        ? '#ffebad'
        : tone === 'EMERALD'
          ? '#d4ffec'
          : tone === 'CYAN'
            ? '#e2fbff'
            : '#ffd8de';

    const boxW = canvas.width - 16;
    const midX = canvas.width * 0.5;

    ctx.fillStyle = bgCol;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = compact ? 3.5 : 4.2;
    ctx.beginPath();
    ctx.roundRect(8, 8, boxW, 50, 25);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = borderCol;
    ctx.beginPath();
    ctx.moveTo(midX - 8, 58);
    ctx.lineTo(midX + 8, 58);
    ctx.lineTo(midX, 71);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = textCol;
    ctx.font = compact
      ? '800 27px "Plus Jakarta Sans", system-ui, sans-serif'
      : '800 30px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, midX, 34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    if (compact) {
      sprite.scale.set(0.62, 0.22, 1);
    } else if (tone === 'AMBER') {
      sprite.scale.set(1.06, 0.31, 1);
    } else {
      sprite.scale.set(0.88, 0.26, 1);
    }
    sprite.renderOrder = 25;
    return sprite;
  }

  public createAttackMedallion(): THREE.Group {
    return buildAttackMedallionMesh(this.materials.emblemPalette);
  }

  public applyPieceColor(colorId: PieceColorId): void {
    this.activePieceColor = colorId;
    this.syncPieceMaterials();
  }

  private syncPieceMaterials(): void {
    const isBakelite = this.activeBoardFinish === 'RETRO_BAKELITE';
    const playerSpec = PIECE_COLOR_SPECS[this.activePieceColor];
    const playerFinish = isBakelite ? playerSpec.bakelite : playerSpec.walnut;
    const enemySpec = PIECE_COLOR_SPECS.CRIMSON;
    const enemyFinish = isBakelite ? enemySpec.bakelite : enemySpec.walnut;

    const pBody = this.materials.playerNavy;
    pBody.color.set(playerFinish.albedoHex);
    pBody.roughness = playerFinish.roughness;
    pBody.metalness = playerSpec.metalness;
    pBody.clearcoat = playerFinish.clearcoat;
    pBody.sheenColor.set(playerFinish.sheenHex);
    pBody.envMapIntensity = playerSpec.envMapIntensity;
    pBody.needsUpdate = true;

    const pInset = this.materials.playerInset;
    pInset.color.set(playerFinish.insetHex);
    pInset.needsUpdate = true;

    const eBody = this.materials.enemyCrimson;
    eBody.color.set(enemyFinish.albedoHex);
    eBody.roughness = enemyFinish.roughness;
    eBody.metalness = enemySpec.metalness;
    eBody.clearcoat = enemyFinish.clearcoat;
    eBody.sheenColor.set(enemyFinish.sheenHex);
    eBody.envMapIntensity = enemySpec.envMapIntensity;
    eBody.needsUpdate = true;

    const eInset = this.materials.enemyInset;
    eInset.color.set(enemyFinish.insetHex);
    eInset.needsUpdate = true;
  }

  public applyBoardFinish(finish: BoardFinishMode): void {
    this.activeBoardFinish = finish;
    const theaterSpec = getBattleTheater(this.activeTheaterId);

    const isBakelite = finish === 'RETRO_BAKELITE';
    const cab = this.materials.walnut;
    cab.map = isBakelite ? null : this.walnutAlbedoTex;
    cab.normalMap = isBakelite ? null : this.walnutNormalTex;
    cab.color.set(isBakelite ? '#181c24' : theaterSpec.cabinetTintHex);
    cab.roughness = isBakelite ? 0.22 : 0.35;
    cab.metalness = isBakelite ? 0.14 : 0.02;
    cab.clearcoat = isBakelite ? 0.78 : 0.24;
    cab.needsUpdate = true;

    const tile = this.materials.slateTile;
    tile.color.set(isBakelite ? '#2f394c' : theaterSpec.slateTintHex);
    tile.roughness = isBakelite ? 0.38 : 0.58;
    tile.metalness = isBakelite ? 0.16 : 0.08;
    tile.clearcoat = isBakelite ? 0.35 : 0.05;
    tile.needsUpdate = true;

    this.syncPieceMaterials();
  }

  public applyTheaterVisuals(
    theaterId: TheaterId,
    sceneRefs?: Omit<SceneTheaterRefs, 'factory'>
  ): BattleTheaterSpec {
    this.activeTheaterId = theaterId;
    const spec = getBattleTheater(theaterId);

    this.tacticalTableMat.color.set(spec.tableBaizeHex);
    this.tacticalTableMat.emissive.set(spec.tableBaizeEmissiveHex);
    this.tacticalTableMat.needsUpdate = true;

    this.lanternGlassMat.emissive.set(spec.lanternHex);
    this.lanternGlassMat.color.set(spec.lanternHex);
    this.lanternGlassMat.needsUpdate = true;

    this.applyBoardFinish(this.activeBoardFinish);

    for (const tid of Object.keys(this.theaterBundles) as TheaterId[]) {
      const bundle = this.theaterBundles[tid];
      if (!bundle) continue;
      const active = tid === theaterId;
      bundle.backdrop.visible = active;
      bundle.props.visible = active;
    }

    const warRoom = sceneRefs?.warRoom ?? this.activeWarRoomRefs;
    if (warRoom) {
      warRoom.tableLanternShadowLight.color.set(spec.lanternHex);
      warRoom.tableLanternShadowLight.intensity = spec.lanternIntensity * 2.8;
      warRoom.lanternLightRight.color.set(spec.rimLightHex);
      warRoom.lanternLightRight.intensity = spec.lanternIntensity * 1.45;
      warRoom.tentBackdropMat.color.set(spec.backdropTintHex);
      warRoom.lanternFlameMat.emissive.set(spec.lanternHex);
    }

    if (sceneRefs?.scene) {
      if (sceneRefs.scene.background instanceof THREE.Color) {
        sceneRefs.scene.background.set(spec.sceneBgHex);
      } else {
        sceneRefs.scene.background = new THREE.Color(spec.sceneBgHex);
      }
      if (sceneRefs.scene.fog instanceof THREE.FogExp2) {
        sceneRefs.scene.fog.color.set(spec.fogHex);
        sceneRefs.scene.fog.density = spec.fogDensity;
      } else {
        sceneRefs.scene.fog = new THREE.FogExp2(spec.fogHex, spec.fogDensity);
      }
    }
    if (sceneRefs?.keyLight) {
      sceneRefs.keyLight.color.set(spec.keyLightHex);
      sceneRefs.keyLight.intensity = spec.keyLightIntensity;
    }
    if (sceneRefs?.rimLight) {
      sceneRefs.rimLight.color.set(spec.rimLightHex);
      sceneRefs.rimLight.intensity = spec.rimLightIntensity;
    }
    if (sceneRefs?.ambientLight) {
      sceneRefs.ambientLight.color.set(spec.ambientSkyHex);
      sceneRefs.ambientLight.groundColor.set(spec.ambientGroundHex);
      sceneRefs.ambientLight.intensity = spec.ambientIntensity;
    }

    return spec;
  }

  public withAllTheatersVisible(fn: () => void): void {
    const prev: Array<{ bundle: TheaterGroupBundle; bVis: boolean; pVis: boolean }> = [];
    for (const tid of Object.keys(this.theaterBundles) as TheaterId[]) {
      const bundle = this.theaterBundles[tid];
      if (!bundle) continue;
      prev.push({ bundle, bVis: bundle.backdrop.visible, pVis: bundle.props.visible });
      bundle.backdrop.visible = true;
      bundle.props.visible = true;
    }
    try {
      fn();
    } finally {
      for (const item of prev) {
        item.bundle.backdrop.visible = item.bVis;
        item.bundle.props.visible = item.pVis;
      }
    }
  }

  public createBoardCabinetGroup(): THREE.Group {
    const initBase = new THREE.Mesh(
      createExtrudedRoundedSlab(10.4, 0.68, 12.1, 0.42, 0.05, 4),
      this.materials.walnut
    );
    initBase.position.set(0, -0.25, -0.5);
    initBase.castShadow = true;
    initBase.receiveShadow = true;
    this.boardContainer.add(initBase);
    this.boardContainer.position.y = 0.0;
    return this.boardContainer;
  }

  public createOnBoardInspectionGroup(): THREE.Group {
    const group = new THREE.Group();

    const turnaroundCols = [2, 3, 5, 6];
    const turnaroundAngles = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
    turnaroundCols.forEach((col, idx) => {
      const w = this.createCommandWedge('PLAYER', 'GEN_5');
      w.position.copy(gridToWorld(col, 1));
      w.rotation.y = turnaroundAngles[idx]!;
      group.add(w);
    });

    ORDERED_RANKS.forEach((rankId, i) => {
      const col = 2 + (i % 4);
      const row = 3 + Math.floor(i / 4);
      const w = this.createCommandWedge('PLAYER', rankId);
      w.position.copy(gridToWorld(col, row));
      group.add(w);
    });

    const med = this.createAttackMedallion();
    med.position.copy(gridToWorld(5, 6));
    group.add(med);

    group.visible = false;
    return group;
  }

  private buildTheaterArchitectureAndProps(): Record<TheaterId, TheaterGroupBundle> {
    const createArchRib = (
      spanW: number,
      height: number,
      thick: number,
      depth: number,
      legBottomY = -3.9
    ) => {
      const s = new THREE.Shape();
      const hw = spanW * 0.5;
      s.moveTo(-hw, legBottomY);
      s.lineTo(-hw + thick, legBottomY);
      s.lineTo(-hw + thick, height * 0.55);
      s.quadraticCurveTo(0, height, hw - thick, height * 0.55);
      s.lineTo(hw - thick, legBottomY);
      s.lineTo(hw, legBottomY);
      s.lineTo(hw, height * 0.6);
      s.quadraticCurveTo(0, height + thick * 1.1, -hw, height * 0.6);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {
        depth,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.025,
        bevelSegments: 3,
        curveSegments: 20,
      });
      g.translate(0, 0, -depth * 0.5);
      return g;
    };

    const createDrapedCanopy = (spanW: number, height: number, bottomY = -5.0) => {
      const segX = 36;
      const segY = 14;
      const pos: number[] = [];
      const uvs: number[] = [];
      const idx: number[] = [];
      for (let iy = 0; iy <= segY; iy++) {
        const vy = iy / segY;
        for (let ix = 0; ix <= segX; ix++) {
          const ux = ix / segX;
          const nx = ux * 2 - 1;
          const x = nx * spanW * 0.5;
          const fold = Math.sin(ux * Math.PI * 10) * 0.14 * (1 - vy * 0.45);
          const arch = (1 - nx * nx * 0.16) * height;
          const y = THREE.MathUtils.lerp(bottomY, arch, vy);
          const upperT = Math.max(0, (vy - 0.65) / 0.35);
          const canopyCrownFwd = upperT * upperT * 1.35;
          const z = nx * nx * 1.45 + fold + canopyCrownFwd;
          pos.push(x, y, z);
          uvs.push(ux, vy);
        }
      }
      const stride = segX + 1;
      for (let iy = 0; iy < segY; iy++) {
        for (let ix = 0; ix < segX; ix++) {
          const a = iy * stride + ix;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };

    // 1. FIELD_HQ — Canvas Command Tent Ribs, Draped Canvas Wall & Ridge Poles
    const fieldBackdrop = new THREE.Group();
    const fieldCanvasMat = new THREE.MeshStandardMaterial({
      map: this.materials.sandbagBurlap.map,
      normalMap: this.materials.sandbagBurlap.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      color: new THREE.Color('#2a2821'),
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const canopyMesh = new THREE.Mesh(createDrapedCanopy(30.0, 9.5, -5.0), fieldCanvasMat);
    canopyMesh.receiveShadow = true;
    fieldBackdrop.add(canopyMesh);

    const timberRibGeo = createArchRib(26.5, 6.4, 0.24, 0.26, -3.9);
    for (const rz of [-0.2, 2.2]) {
      const rib = new THREE.Mesh(timberRibGeo, this.oakTimberMat);
      rib.position.set(0, -1.2, rz);
      rib.castShadow = true;
      fieldBackdrop.add(rib);
    }
    const ridgeBeam = new THREE.Mesh(
      createExtrudedRoundedSlab(28.0, 0.24, 0.28, 0.06, 0.02, 2),
      this.oakTimberMat
    );
    ridgeBeam.position.set(0, 4.9, 1.0);
    fieldBackdrop.add(ridgeBeam);

    const fieldProps = new THREE.Group();
    // Brass Map Dividers resting on left war map
    const dividerLegGeo = createExtrudedRoundedSlab(0.032, 0.018, 0.68, 0.008, 0.004, 2);
    for (const ang of [-0.22, 0.22]) {
      const leg = new THREE.Mesh(dividerLegGeo, this.materials.brassTrim);
      leg.position.set(-4.35 + ang * 0.25, -0.625, -7.85);
      leg.rotation.y = 0.4 + ang;
      leg.castShadow = true;
      fieldProps.add(leg);
    }

    // 2. PACIFIC_BRIDGE — Naval CIC Steel Bulkhead, Riveted Stanchions, Center Console & Cross-Mullioned Brass Portholes
    const pacificBackdrop = new THREE.Group();
    const pacificBulkheadMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(getBattleTheater('PACIFIC_BRIDGE').backdropTintHex),
      bumpMap: this.materials.gunmetal.bumpMap,
      bumpScale: 0.008,
      roughness: 0.64,
      metalness: 0.44,
      envMapIntensity: 0.3,
      side: THREE.DoubleSide,
    });
    const bulkheadWall = new THREE.Mesh(createDrapedCanopy(30.0, 9.5, -5.0), pacificBulkheadMat);
    bulkheadWall.receiveShadow = true;
    pacificBackdrop.add(bulkheadWall);

    const steelRibGeo = createArchRib(27.0, 6.4, 0.28, 0.3, -3.9);
    for (const rz of [-0.1, 2.0]) {
      const rib = new THREE.Mesh(steelRibGeo, this.materials.gunmetal);
      rib.position.set(0, -1.2, rz);
      pacificBackdrop.add(rib);
    }

    // Riveted vertical steel I-beam stanchions + horizontal waist & transom girders
    const stanchionGeo = createExtrudedRoundedSlab(0.24, 9.2, 0.32, 0.035, 0.018, 2);
    for (const sx of [-3.45, -1.45, 1.45, 3.45]) {
      const stanchion = new THREE.Mesh(stanchionGeo, this.materials.gunmetal);
      stanchion.position.set(sx, 0.6, 0.3 + sx * sx * 0.012);
      pacificBackdrop.add(stanchion);
    }

    const girderGeo = createExtrudedRoundedSlab(14.5, 0.22, 0.3, 0.035, 0.018, 2);
    for (const gy of [-0.32, 1.62]) {
      const girder = new THREE.Mesh(girderGeo, this.materials.gunmetal);
      girder.position.set(0, gy, 0.34);
      pacificBackdrop.add(girder);
    }

    const rivetGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.042, 0.0),
        new THREE.Vector2(0.038, 0.018),
        new THREE.Vector2(0.02, 0.032),
        new THREE.Vector2(0.0, 0.036),
      ],
      10
    );
    rivetGeo.rotateX(Math.PI / 2);
    for (const rx of [-3.45, -2.45, -1.45, -0.72, 0.72, 1.45, 2.45, 3.45]) {
      for (const ry of [-0.32, 1.62]) {
        const rivet = new THREE.Mesh(rivetGeo, this.materials.brassRecessed);
        rivet.position.set(rx, ry, 0.5);
        pacificBackdrop.add(rivet);
      }
    }

    // Center bay recessed CIC armored heading/compass bulkhead panel
    const cicPanelOuter = new THREE.Mesh(
      createExtrudedRoundedSlab(2.38, 1.44, 0.16, 0.08, 0.022, 3),
      this.materials.darkSteel
    );
    cicPanelOuter.position.set(0, 0.64, 0.3);
    pacificBackdrop.add(cicPanelOuter);

    const cicPanelBezel = new THREE.Mesh(
      createExtrudedRoundedSlab(2.04, 1.12, 0.12, 0.05, 0.016, 2),
      this.materials.brassRecessed
    );
    cicPanelBezel.position.set(0, 0.64, 0.35);
    pacificBackdrop.add(cicPanelBezel);

    const cicDialCanvas = document.createElement('canvas');
    cicDialCanvas.width = 512;
    cicDialCanvas.height = 256;
    const cCtx = cicDialCanvas.getContext('2d')!;
    const cicGrad = cCtx.createLinearGradient(0, 0, 0, 256);
    cicGrad.addColorStop(0, '#091420');
    cicGrad.addColorStop(1, '#112236');
    cCtx.fillStyle = cicGrad;
    cCtx.fillRect(0, 0, 512, 256);
    cCtx.strokeStyle = 'rgba(92, 225, 230, 0.38)';
    cCtx.lineWidth = 2;
    cCtx.strokeRect(14, 14, 484, 228);
    cCtx.beginPath();
    cCtx.arc(256, 144, 72, Math.PI, 0);
    cCtx.stroke();
    for (let deg = 0; deg <= 180; deg += 15) {
      const a = Math.PI + (deg * Math.PI) / 180;
      const major = deg % 45 === 0;
      cCtx.lineWidth = major ? 2.6 : 1.3;
      cCtx.beginPath();
      cCtx.moveTo(256 + Math.cos(a) * (major ? 58 : 64), 144 + Math.sin(a) * (major ? 58 : 64));
      cCtx.lineTo(256 + Math.cos(a) * 74, 144 + Math.sin(a) * 74);
      cCtx.stroke();
    }
    cCtx.fillStyle = 'rgba(229, 185, 104, 0.72)';
    cCtx.font = 'bold 18px monospace';
    cCtx.textAlign = 'center';
    cCtx.fillText('FLAGSHIP CIC // SECTOR 04', 256, 48);
    cCtx.fillStyle = 'rgba(92, 225, 230, 0.58)';
    cCtx.font = 'bold 14px monospace';
    cCtx.fillText('HDG 285°  •  SEA STATE 2', 256, 206);
    const cicDialTex = new THREE.CanvasTexture(cicDialCanvas);
    cicDialTex.colorSpace = THREE.SRGBColorSpace;
    cicDialTex.anisotropy = 4;
    const cicPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.86, 0.94),
      new THREE.MeshStandardMaterial({
        map: cicDialTex,
        emissiveMap: cicDialTex,
        emissive: new THREE.Color('#4ab6c4'),
        emissiveIntensity: 0.36,
        roughness: 0.34,
        metalness: 0.24,
      })
    );
    cicPlate.position.set(0, 0.64, 0.436);
    pacificBackdrop.add(cicPlate);

    for (const bx of [-1.02, 1.02]) {
      for (const by of [0.06, 1.22]) {
        const bolt = new THREE.Mesh(rivetGeo, this.materials.brassTrim);
        bolt.position.set(bx, by, 0.428);
        pacificBackdrop.add(bolt);
      }
    }

    // Procedural ocean-night horizon glass for flanked cross-mullioned portholes
    const portholeCanvas = document.createElement('canvas');
    portholeCanvas.width = 256;
    portholeCanvas.height = 256;
    const pCtx = portholeCanvas.getContext('2d')!;
    const skyG = pCtx.createLinearGradient(0, 0, 0, 146);
    skyG.addColorStop(0, '#040c18');
    skyG.addColorStop(1, '#0d2b48');
    pCtx.fillStyle = skyG;
    pCtx.fillRect(0, 0, 256, 146);
    const seaG = pCtx.createLinearGradient(0, 146, 0, 256);
    seaG.addColorStop(0, '#092238');
    seaG.addColorStop(1, '#020810');
    pCtx.fillStyle = seaG;
    pCtx.fillRect(0, 146, 256, 110);
    pCtx.strokeStyle = 'rgba(130, 210, 255, 0.42)';
    pCtx.lineWidth = 2;
    pCtx.beginPath();
    pCtx.moveTo(0, 146);
    pCtx.lineTo(256, 146);
    pCtx.stroke();
    pCtx.fillStyle = 'rgba(215, 236, 255, 0.65)';
    pCtx.beginPath();
    pCtx.arc(172, 68, 7, 0, Math.PI * 2);
    pCtx.fill();
    pCtx.strokeStyle = 'rgba(130, 210, 255, 0.25)';
    pCtx.lineWidth = 1.5;
    for (let y = 156; y < 240; y += 12) {
      const w = 18 + (y - 156) * 0.45;
      pCtx.beginPath();
      pCtx.moveTo(172 - w, y);
      pCtx.lineTo(172 + w, y);
      pCtx.stroke();
    }
    const portholeTex = new THREE.CanvasTexture(portholeCanvas);
    portholeTex.colorSpace = THREE.SRGBColorSpace;

    const portholeRingGeo = new THREE.TorusGeometry(0.68, 0.085, 14, 32);
    const portholeGasketGeo = new THREE.TorusGeometry(0.57, 0.032, 10, 28);
    const portholeGlassGeo = new THREE.CircleGeometry(0.6, 32);
    const mullionHorizGeo = createExtrudedRoundedSlab(1.18, 0.064, 0.064, 0.014, 0.008, 2);
    const mullionVertGeo = createExtrudedRoundedSlab(0.064, 1.18, 0.064, 0.014, 0.008, 2);
    const doggingLugGeo = createExtrudedRoundedSlab(0.095, 0.055, 0.085, 0.014, 0.008, 2);
    const portholeGlassMat = new THREE.MeshPhysicalMaterial({
      map: portholeTex,
      emissiveMap: portholeTex,
      emissive: new THREE.Color('#2c6d9c'),
      emissiveIntensity: 0.38,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
    });
    for (const px of [-2.4, 2.4]) {
      const portGroup = new THREE.Group();
      portGroup.name = 'PacificPortholeAssembly';
      portGroup.position.set(px, 0.64, 0.44 + px * px * 0.015);

      const frame = new THREE.Mesh(portholeRingGeo, this.materials.brassTrim);
      portGroup.add(frame);

      const gasket = new THREE.Mesh(portholeGasketGeo, this.materials.darkSteel);
      gasket.position.z = 0.02;
      portGroup.add(gasket);

      const pane = new THREE.Mesh(portholeGlassGeo, portholeGlassMat);
      pane.position.z = -0.02;
      portGroup.add(pane);

      const barH = new THREE.Mesh(mullionHorizGeo, this.materials.darkSteel);
      barH.position.z = 0.025;
      portGroup.add(barH);

      const barV = new THREE.Mesh(mullionVertGeo, this.materials.darkSteel);
      barV.position.z = 0.025;
      portGroup.add(barV);

      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const lug = new THREE.Mesh(doggingLugGeo, this.materials.brassRecessed);
        lug.position.set(Math.cos(ang) * 0.72, Math.sin(ang) * 0.72, 0.02);
        lug.rotation.z = ang;
        portGroup.add(lug);
      }

      pacificBackdrop.add(portGroup);
    }

    const pacificProps = new THREE.Group();
    // 3D Brass Ship's Gyro-Compass Binnacle on table right
    const gyroBase = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, 0.0),
          new THREE.Vector2(0.46, 0.0),
          new THREE.Vector2(0.42, 0.08),
          new THREE.Vector2(0.24, 0.16),
          new THREE.Vector2(0.32, 0.34),
          new THREE.Vector2(0.42, 0.42),
          new THREE.Vector2(0.38, 0.46),
        ],
        28
      ),
      this.materials.brassTrim
    );
    gyroBase.position.set(7.6, -0.68, -4.4);
    gyroBase.castShadow = true;
    pacificProps.add(gyroBase);

    const gyroDial = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 32),
      new THREE.MeshStandardMaterial({
        map: createNavalCompassDialTexture(256),
        emissive: new THREE.Color('#19647a'),
        emissiveIntensity: 0.45,
        roughness: 0.35,
      })
    );
    gyroDial.rotation.x = -Math.PI / 2;
    gyroDial.position.set(7.6, -0.23, -4.4);
    pacificProps.add(gyroDial);

    const gimbalRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.41, 0.025, 12, 32),
      this.materials.silverEmblem
    );
    gimbalRing.rotation.x = Math.PI / 2 + 0.18;
    gimbalRing.position.set(7.6, -0.21, -4.4);
    pacificProps.add(gimbalRing);

    // 3. IRON_BUNKER — Sloped Concrete Casemate Arches, Observation Slit & I-Beams
    const bunkerBackdrop = new THREE.Group();
    const bunkerWallMat = new THREE.MeshStandardMaterial({
      bumpMap: this.materials.bunkerConcrete.bumpMap,
      bumpScale: 0.014,
      color: new THREE.Color(getBattleTheater('IRON_BUNKER').backdropTintHex),
      roughness: 0.68,
      metalness: 0.34,
      envMapIntensity: 0.3,
      side: THREE.DoubleSide,
    });
    const casemateWall = new THREE.Mesh(createDrapedCanopy(30.0, 9.5, -5.0), bunkerWallMat);
    casemateWall.receiveShadow = true;
    bunkerBackdrop.add(casemateWall);

    const bunkerArchGeo = createArchRib(26.8, 6.3, 0.46, 0.55, -3.9);
    for (const rz of [-0.1, 2.1]) {
      const arch = new THREE.Mesh(bunkerArchGeo, this.materials.bunkerConcrete);
      arch.position.set(0, -1.2, rz);
      bunkerBackdrop.add(arch);
    }
    // Armored Observation Embrasure Slit
    const slitGlowMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2a1c14'),
      emissive: new THREE.Color('#ff7a3c'),
      emissiveIntensity: 0.85,
      roughness: 0.4,
    });
    const slitMesh = new THREE.Mesh(
      createExtrudedRoundedSlab(11.5, 0.42, 0.18, 0.04, 0.02, 2),
      slitGlowMat
    );
    slitMesh.position.set(0, 1.7, 0.36);
    bunkerBackdrop.add(slitMesh);

    const slitFrame = new THREE.Mesh(
      createExtrudedRoundedSlab(12.1, 0.22, 0.45, 0.05, 0.02, 2),
      this.materials.darkSteel
    );
    slitFrame.position.set(0, 1.38, 0.44);
    bunkerBackdrop.add(slitFrame);

    const bunkerProps = new THREE.Group();
    // Turned Brass Artillery Shell Casings standing beside bay
    const shellGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.145, 0.0),
        new THREE.Vector2(0.145, 0.04),
        new THREE.Vector2(0.12, 0.06),
        new THREE.Vector2(0.115, 0.54),
        new THREE.Vector2(0.085, 0.64),
        new THREE.Vector2(0.075, 0.72),
        new THREE.Vector2(0.0, 0.72),
      ],
      24
    );
    for (const [sx, sz] of [
      [-7.4, -4.3],
      [-7.85, -4.8],
      [-7.25, -4.95],
    ] as const) {
      const casing = new THREE.Mesh(shellGeo, this.materials.brassTrim);
      casing.position.set(sx, -0.68, sz);
      casing.castShadow = true;
      bunkerProps.add(casing);
    }

    // Oak & Steel Field Radio Set on table right
    const radioBox = new THREE.Mesh(
      createExtrudedRoundedSlab(1.15, 0.56, 0.72, 0.06, 0.02, 3),
      this.oakTimberMat
    );
    radioBox.position.set(7.65, -0.4, -4.5);
    radioBox.rotation.y = -0.35;
    radioBox.castShadow = true;
    bunkerProps.add(radioBox);

    const radioPlate = new THREE.Mesh(
      createExtrudedRoundedSlab(0.96, 0.04, 0.54, 0.03, 0.01, 2),
      this.materials.gunmetal
    );
    radioPlate.position.set(7.65, -0.11, -4.5);
    radioPlate.rotation.y = -0.35;
    bunkerProps.add(radioPlate);

    // 4. NIGHT_OPS — Parabolic Radar Mast, Grounded Sandbag Parapet & Phosphor Scope
    const nightBackdrop = new THREE.Group();
    const nightWallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(getBattleTheater('NIGHT_OPS').backdropTintHex),
      bumpMap: this.materials.bunkerConcrete.bumpMap,
      bumpScale: 0.01,
      roughness: 0.86,
      metalness: 0.16,
      envMapIntensity: 0.22,
      side: THREE.DoubleSide,
    });
    const nightWall = new THREE.Mesh(createDrapedCanopy(30.0, 9.5, -5.0), nightWallMat);
    nightWall.receiveShadow = true;
    nightBackdrop.add(nightWall);

    // Parabolic Radar Dish Silhouette
    const dishGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.45, 0.05),
        new THREE.Vector2(0.95, 0.2),
        new THREE.Vector2(1.45, 0.45),
        new THREE.Vector2(1.85, 0.78),
        new THREE.Vector2(1.9, 0.82),
      ],
      32
    );
    const dishMesh = new THREE.Mesh(dishGeo, this.materials.darkSteel);
    dishMesh.rotation.x = Math.PI * 0.36;
    dishMesh.position.set(-4.5, 2.25, 0.55);
    nightBackdrop.add(dishMesh);

    const mastPillar = new THREE.Mesh(
      createExtrudedRoundedSlab(0.32, 7.2, 0.32, 0.05, 0.02, 2),
      this.materials.gunmetal
    );
    mastPillar.position.set(-4.5, -1.5, 0.35);
    nightBackdrop.add(mastPillar);

    const nightProps = new THREE.Group();
    // Sandbagged Recon Parapet anchored directly onto the tabletop (`y = -0.685`) behind the war maps
    const parapetGeo = createExtrudedRoundedSlab(18.0, 0.65, 0.55, 0.14, 0.04, 3);
    const parapet = new THREE.Mesh(parapetGeo, this.materials.sandbagBurlap);
    parapet.position.set(0, -0.44, -10.6);
    parapet.castShadow = true;
    parapet.receiveShadow = true;
    nightProps.add(parapet);
    // Glowing Emerald-Phosphor Tactical Radar Scope on table right
    const scopeBody = new THREE.Mesh(
      createExtrudedRoundedSlab(1.05, 0.42, 1.05, 0.12, 0.03, 3),
      this.materials.gunmetal
    );
    scopeBody.position.set(7.65, -0.47, -4.45);
    scopeBody.rotation.y = -0.32;
    scopeBody.castShadow = true;
    nightProps.add(scopeBody);

    const scopeScreen = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 32),
      new THREE.MeshStandardMaterial({
        map: createTacticalPhosphorRadarTexture(256),
        emissive: new THREE.Color('#28d488'),
        emissiveMap: createTacticalPhosphorRadarTexture(256),
        emissiveIntensity: 1.15,
        roughness: 0.2,
      })
    );
    scopeScreen.rotation.x = -Math.PI / 2;
    scopeScreen.position.set(7.65, -0.255, -4.45);
    nightProps.add(scopeScreen);

    const cipherBox = new THREE.Mesh(
      createExtrudedRoundedSlab(0.88, 0.26, 0.64, 0.05, 0.02, 2),
      this.oakTimberMat
    );
    cipherBox.position.set(-7.55, -0.55, -4.55);
    cipherBox.rotation.y = 0.28;
    cipherBox.castShadow = true;
    nightProps.add(cipherBox);

    return {
      FIELD_HQ: { backdrop: fieldBackdrop, props: fieldProps },
      PACIFIC_BRIDGE: { backdrop: pacificBackdrop, props: pacificProps },
      IRON_BUNKER: { backdrop: bunkerBackdrop, props: bunkerProps },
      NIGHT_OPS: { backdrop: nightBackdrop, props: nightProps },
    };
  }

  public createWarRoomEnvironment(): WarRoomEnvironmentRefs {
    const root = new THREE.Group();
    const loader = new THREE.TextureLoader();

    // Sculpted Beveled Tabletop Fallback (ExtrudeGeometry — zero raw BoxGeometry!)
    const fbTable = new THREE.Mesh(
      createExtrudedRoundedSlab(50, 0.34, 34, 0.6, 0.04, 3),
      this.tacticalTableMat
    );
    fbTable.position.set(0, -0.855, 2.0);
    fbTable.receiveShadow = true;
    this.tablePropsContainer.add(fbTable);
    root.add(this.tablePropsContainer);

    // Contact AO Shadow Pad underneath the elevated Walnut & Brass Board
    const aoCanvas = document.createElement('canvas');
    aoCanvas.width = 128;
    aoCanvas.height = 128;
    const aoCtx = aoCanvas.getContext('2d')!;
    const aoGrad = aoCtx.createRadialGradient(64, 64, 22, 64, 64, 63);
    aoGrad.addColorStop(0, 'rgba(0,0,0,0.97)');
    aoGrad.addColorStop(0.78, 'rgba(0,0,0,0.82)');
    aoGrad.addColorStop(1, 'rgba(0,0,0,0.0)');
    aoCtx.fillStyle = aoGrad;
    aoCtx.fillRect(0, 0, 128, 128);
    const aoPad = new THREE.Mesh(
      new THREE.PlaneGeometry(12.8, 14.4),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#000000'),
        map: new THREE.CanvasTexture(aoCanvas),
        roughness: 1.0,
        metalness: 0.0,
        envMapIntensity: 0.0,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    aoPad.rotation.x = -Math.PI / 2;
    aoPad.position.set(0.35, -0.68, -0.4);
    root.add(aoPad);

    // Sculpted Curled Parchment Tactical War Maps + Turned Brass Map Weights
    const mapNormalTex = loader.load('./textures/war_map_normal.jpg');
    mapNormalTex.colorSpace = THREE.NoColorSpace;
    mapNormalTex.anisotropy = 8;

    const mapTexL = loader.load('./textures/vintage_war_map_left.jpg');
    mapTexL.colorSpace = THREE.SRGBColorSpace;
    mapTexL.anisotropy = 16;
    const mapMatL = new THREE.MeshStandardMaterial({
      map: mapTexL,
      normalMap: mapNormalTex,
      normalScale: new THREE.Vector2(0.45, 0.45),
      color: new THREE.Color('#B8A588'),
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.12,
    });

    const mapTexR = loader.load('./textures/vintage_war_map_right.jpg');
    mapTexR.colorSpace = THREE.SRGBColorSpace;
    mapTexR.anisotropy = 16;
    const mapMatR = new THREE.MeshStandardMaterial({
      map: mapTexR,
      normalMap: mapNormalTex,
      normalScale: new THREE.Vector2(0.45, 0.45),
      color: new THREE.Color('#B4A184'),
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.12,
    });

    const mapLeft = new THREE.Mesh(createCurledParchmentGeometry(5.8, 4.2, 0.018), mapMatL);
    mapLeft.position.set(-2.95, -0.668, -8.85);
    mapLeft.rotation.y = 0.14;
    mapLeft.castShadow = true;
    mapLeft.receiveShadow = true;
    root.add(mapLeft);

    const mapRight = new THREE.Mesh(createCurledParchmentGeometry(5.9, 4.25, 0.018), mapMatR);
    mapRight.position.set(3.05, -0.662, -8.75);
    mapRight.rotation.y = Math.PI - 0.16;
    mapRight.castShadow = true;
    mapRight.receiveShadow = true;
    root.add(mapRight);

    // Turned-Brass Map Paperweights holding down curled map corners
    const weightGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.18, 0.0),
        new THREE.Vector2(0.18, 0.05),
        new THREE.Vector2(0.14, 0.09),
        new THREE.Vector2(0.06, 0.13),
        new THREE.Vector2(0.08, 0.17),
        new THREE.Vector2(0.0, 0.19),
      ],
      20
    );
    for (const [wx, wz] of [
      [-5.35, -7.25],
      [5.45, -7.15],
    ] as const) {
      const weight = new THREE.Mesh(weightGeo, this.materials.brassTrim);
      weight.position.set(wx, -0.64, wz);
      weight.castShadow = true;
      root.add(weight);
    }

    // Sculpted Brass Pocket Watch (LatheGeometry stepped case + ExtrudeGeometry spade hand + arbor pin + glass crystal)
    this.watchMountGroup.position.set(6.05, -0.662, -6.55);
    this.watchMountGroup.rotation.y = -0.45;
    this.watchMountGroup.scale.setScalar(0.92);

    const fallbackWatch = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, 0.0),
          new THREE.Vector2(0.66, 0.0),
          new THREE.Vector2(0.73, 0.05),
          new THREE.Vector2(0.74, 0.17),
          new THREE.Vector2(0.70, 0.22),
          new THREE.Vector2(0.62, 0.24),
          new THREE.Vector2(0.61, 0.224),
        ],
        36
      ),
      this.materials.brassTrim
    );
    fallbackWatch.name = 'fallbackWatchBody';
    fallbackWatch.castShadow = true;
    fallbackWatch.receiveShadow = true;
    this.watchMountGroup.add(fallbackWatch);

    const dialMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.61, 36),
      new THREE.MeshStandardMaterial({
        map: createWatchDialCanvasTexture(),
        roughness: 0.46,
        envMapIntensity: 0.2,
      })
    );
    dialMesh.rotation.x = -Math.PI / 2;
    dialMesh.position.y = 0.228;
    this.watchMountGroup.add(dialMesh);

    const watchSecondPivot = new THREE.Group();
    watchSecondPivot.position.set(0, 0.232, 0);

    // Sculpted Spade Second Hand + Counterweight
    const handShape = new THREE.Shape();
    handShape.moveTo(-0.012, -0.11);
    handShape.lineTo(0.012, -0.11);
    handShape.lineTo(0.008, 0.32);
    handShape.lineTo(0.024, 0.36);
    handShape.lineTo(0.0, 0.45);
    handShape.lineTo(-0.024, 0.36);
    handShape.lineTo(-0.008, 0.32);
    handShape.closePath();
    const handGeo = new THREE.ExtrudeGeometry(handShape, {
      depth: 0.005,
      bevelEnabled: true,
      bevelThickness: 0.002,
      bevelSize: 0.002,
      bevelSegments: 2,
    });
    handGeo.rotateX(-Math.PI / 2);
    const secondNeedle = new THREE.Mesh(handGeo, this.materials.brassRecessed);
    secondNeedle.castShadow = true;
    watchSecondPivot.add(secondNeedle);

    // Central Turned-Brass Arbor Pin seated flush on dial
    const arborPin = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.036, 0.0),
          new THREE.Vector2(0.036, 0.008),
          new THREE.Vector2(0.02, 0.014),
          new THREE.Vector2(0.0, 0.018),
        ],
        16
      ),
      this.materials.brassTrim
    );
    arborPin.position.y = -0.003;
    watchSecondPivot.add(arborPin);
    this.watchMountGroup.add(watchSecondPivot);

    // Domed Physical Watch Crystal
    const crystalGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.268),
        new THREE.Vector2(0.24, 0.264),
        new THREE.Vector2(0.46, 0.252),
        new THREE.Vector2(0.615, 0.232),
      ],
      32
    );
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#eef6ff'),
      roughness: 0.04,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.22,
      ior: 1.52,
      depthWrite: false,
    });
    const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
    this.watchMountGroup.add(crystalMesh);
    root.add(this.watchMountGroup);

    // Sculpted Teardrop Lantern Flame + Turned Brass Burner Collar (MeshStandardMaterial — ZERO MeshBasicMaterial!)
    const burnerCollar = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.16, 0.0),
          new THREE.Vector2(0.18, 0.04),
          new THREE.Vector2(0.12, 0.09),
          new THREE.Vector2(0.075, 0.11),
          new THREE.Vector2(0.05, 0.11),
        ],
        20
      ),
      this.materials.brassTrim
    );
    burnerCollar.position.set(-6.65, 0.28, -6.55);
    root.add(burnerCollar);

    const lanternFlameMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(2.6, 1.65, 0.52),
      emissive: new THREE.Color('#ff9c3a'),
      emissiveIntensity: 2.15,
      roughness: 0.25,
      metalness: 0.0,
      toneMapped: false,
    });
    const flameGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.068, 0.03),
        new THREE.Vector2(0.092, 0.09),
        new THREE.Vector2(0.072, 0.16),
        new THREE.Vector2(0.034, 0.23),
        new THREE.Vector2(0.0, 0.285),
      ],
      18
    );
    const flameCore = new THREE.Mesh(flameGeo, lanternFlameMat);
    flameCore.position.set(-6.65, 0.37, -6.55);
    root.add(flameCore);

    const tableLanternShadowLight = new THREE.PointLight(0xff9c3a, 7.5, 24, 1.4);
    tableLanternShadowLight.position.set(-6.65, 0.84, -6.55);
    tableLanternShadowLight.castShadow = true;
    tableLanternShadowLight.shadow.mapSize.set(1024, 1024);
    tableLanternShadowLight.shadow.bias = -0.0006;
    root.add(tableLanternShadowLight);

    const lanternLightRight = new THREE.PointLight(0xff9434, 3.8, 22, 1.5);
    lanternLightRight.position.set(4.2, 2.8, -9.5);
    root.add(lanternLightRight);

    // 3D Sculpted War-Room Architecture & 4 Toggleable Battle Theaters (replaces single flat tent_cyclorama.png plane!)
    // Isolated anchor mesh: SceneManager mutates tentBackdropMat.color & tentBackdropMesh.position.y every frame,
    // while each theater wall uses its own dedicated dark PBR material so ZERO white bar or washout can occur!
    const tentBackdropMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1c2430'),
      roughness: 0.84,
      metalness: 0.18,
      envMapIntensity: 0.28,
      side: THREE.DoubleSide,
    });
    const cycMesh = new THREE.Mesh(new THREE.BufferGeometry(), tentBackdropMat);
    cycMesh.name = 'WarRoomBackdropAnchor';
    cycMesh.position.set(0, 3.15, -11.4);

    this.theaterBundles = this.buildTheaterArchitectureAndProps();
    for (const tid of Object.keys(this.theaterBundles) as TheaterId[]) {
      const b = this.theaterBundles[tid]!;
      cycMesh.add(b.backdrop);
      root.add(b.props);
    }
    root.add(cycMesh);

    const refs: WarRoomEnvironmentRefs = {
      root,
      tableLanternShadowLight,
      lanternLightRight,
      lanternFlameMat,
      tentBackdropMesh: cycMesh,
      tentBackdropMat,
      watchSecondHand: watchSecondPivot,
    };
    this.activeWarRoomRefs = refs;
    this.applyTheaterVisuals(this.activeTheaterId, { warRoom: refs });

    return refs;
  }
}
