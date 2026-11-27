import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  BOARD_COLS,
  BOARD_ROWS,
  ORDERED_RANKS,
  RANK_SPECS,
  type Faction,
  type RankId,
} from '../core/ranks';
import type { SuspectTag } from '../core/types';
import {
  buildAttackMedallionMesh,
  buildRankEmblemMesh,
  type EmblemMaterialPalette,
} from './EmblemFactory';
import {
  createBrushedMetalBumpMap,
  createSlateBumpMap,
} from './ProceduralTextures';

export const TILE_PITCH = 1.0;
export const GRID_CENTER_Z = 0.85;
export const ARBITER_BAY_CENTER_Z = -4.78;
export const LEFT_WELL_CENTER = new THREE.Vector3(-3.68, -0.28, -4.78);
export const RIGHT_WELL_CENTER = new THREE.Vector3(3.68, -0.28, -4.78);
export const HERO_WEDGE_SCALE = 1.13;

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
  readonly lanternFlameMat: THREE.MeshBasicMaterial;
  readonly tentBackdropMesh: THREE.Mesh;
  readonly tentBackdropMat: THREE.MeshBasicMaterial;
  readonly watchSecondHand: THREE.Object3D;
}

export interface BakedArbiterHardwareParts {
  readonly warfieldArena: THREE.Object3D | null;
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

/**
 * Generates an Ultra-HD `1024x1024` Dark Slate-Indigo Tactical Command Baize & Gold Navigation Table Texture!
 * Eliminates "brown wood on brown wood" forever so the warm Oiled-Walnut & Champagne-Brass Game Board
 * pops off the table like an heirloom centerpiece!
 */
function createTacticalCommandBaizeTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createRadialGradient(512, 512, 60, 512, 512, 700);
  bg.addColorStop(0, '#1e2b3c');
  bg.addColorStop(0.65, '#15202e');
  bg.addColorStop(1, '#0c121b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Crisp tactical coordinate grid hairlines & antique-gold azimuth compass rings
  ctx.strokeStyle = 'rgba(225, 182, 92, 0.22)';
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

  // Cardinal crosshairs & degree tick marks around outer azimuth ring
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

export class MeshFactory {
  public readonly materials: SharedPBRMaterials;

  private readonly boardContainer = new THREE.Group();
  private readonly tablePropsContainer = new THREE.Group();
  private readonly watchMountGroup = new THREE.Group();
  private readonly tacticalTableMat: THREE.MeshStandardMaterial;
  private readonly crateSlateMat: THREE.MeshStandardMaterial;
  private readonly parchmentScrollMat: THREE.MeshStandardMaterial;
  private readonly lanternGlassMat: THREE.MeshPhysicalMaterial;

  private readonly wedgeAoGeo: THREE.PlaneGeometry;
  private readonly wedgeAoMat: THREE.MeshBasicMaterial;
  private fallbackWedgeGeo: THREE.BufferGeometry;
  private monolithGeos: BakedMonolithGeometries = {
    body: null,
    brassPlinth: null,
    escutcheon: null,
  };
  private readonly liveWedges = new Set<LiveWedgeRefs>();

  private arbiterParts: BakedArbiterHardwareParts = {
    warfieldArena: null,
  };

  constructor() {
    const loader = new THREE.TextureLoader();

    const walnutAlbedo = loader.load('./textures/walnut_albedo.jpg');
    walnutAlbedo.colorSpace = THREE.SRGBColorSpace;
    walnutAlbedo.wrapS = walnutAlbedo.wrapT = THREE.RepeatWrapping;
    walnutAlbedo.anisotropy = 16;

    const walnutNormal = loader.load('./textures/walnut_normal.jpg');
    walnutNormal.colorSpace = THREE.NoColorSpace;
    walnutNormal.wrapS = walnutNormal.wrapT = THREE.RepeatWrapping;
    walnutNormal.anisotropy = 16;

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

    // Dark Slate-Indigo Tactical Command Baize & Gold Azimuth Chart Table
    const baizeTex = createTacticalCommandBaizeTexture();
    baizeTex.repeat.set(3.2, 2.4);
    this.tacticalTableMat = new THREE.MeshStandardMaterial({
      map: baizeTex,
      emissiveMap: baizeTex,
      emissive: new THREE.Color('#28384d'),
      emissiveIntensity: 0.42,
      normalMap: velvetNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      color: new THREE.Color('#DCE6F2'),
      roughness: 0.8,
      metalness: 0.08,
      envMapIntensity: 0.2,
    });

    this.crateSlateMat = new THREE.MeshStandardMaterial({
      bumpMap: slateBump,
      bumpScale: 0.01,
      color: new THREE.Color('#1E2631'),
      roughness: 0.62,
      metalness: 0.45,
      envMapIntensity: 0.3,
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
      emissive: new THREE.Color('#ff9428'),
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
      roughness: 0.36,
      bumpMap: metalBump,
      bumpScale: 0.006,
      envMapIntensity: 0.65,
    });

    const silverEmblem = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#C4CCD8'),
      metalness: 0.9,
      roughness: 0.28,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.08,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.65,
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

    // Rich, Deep Sculpted Lacquered Cobalt & Imperial Oxblood (low `envMapIntensity` -> zero chalky grey washout!)
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
      map: oakAlbedo,
      normalMap: oakNormal,
      normalScale: new THREE.Vector2(1.8, 1.8),
      color: new THREE.Color('#2E241C'),
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
        brass: brassTrim,
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
    this.wedgeAoMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(wAoCanvas),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });

    this.fallbackWedgeGeo = this.buildFallbackWedgeGeometry();
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

      // Add 4 Machined Solid-Brass Corner Riser Pedestals + 4 Warm-Amber Corner Sconce Pips
      // + 6 Tactical Brass Intersection Star-Diamonds on the 9x8 playfield!
      const footGeo = new THREE.CylinderGeometry(0.46, 0.54, 0.24, 28);
      const sconceCapGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.045, 20);
      const sconceGlowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.4, 1.55, 0.52),
        toneMapped: false,
      });
      const sconceLensGeo = new THREE.SphereGeometry(0.065, 14, 10);

      for (const [fx, fz, cx, cz] of [
        [-4.65, 5.05, -4.82, 5.12],
        [4.65, 5.05, 4.82, 5.12],
        [-4.65, -5.95, -4.82, -6.12],
        [4.65, -5.95, 4.82, -6.12],
      ] as const) {
        const foot = new THREE.Mesh(footGeo, this.materials.brassTrim);
        foot.position.set(fx, -0.58, fz);
        foot.castShadow = true;
        foot.receiveShadow = true;
        scene.add(foot);

        // Corner Brass Sconce Bezel & Warm Amber Jewel Pip on the raised bolster corners!
        const bezel = new THREE.Mesh(sconceCapGeo, this.materials.brassTrim);
        bezel.position.set(cx, 0.16, cz);
        scene.add(bezel);

        const lens = new THREE.Mesh(sconceLensGeo, sconceGlowMat);
        lens.position.set(cx, 0.18, cz);
        scene.add(lens);
      }

      // Delicate Brushed-Brass Tactical Waypoint Diamonds inlaid at key intersections of the 9x8 slate grid
      const pipGeo = new THREE.OctahedronGeometry(0.055, 0);
      pipGeo.scale(1.0, 0.28, 1.0);
      for (const gx of [-1.5, 1.5]) {
        for (const gz of [-1.15, 0.85, 2.85]) {
          const pip = new THREE.Mesh(pipGeo, this.materials.brassTrim);
          pip.position.set(gx, 0.022, gz);
          scene.add(pip);
        }
      }

      // Subtle Alternating Hematite-Sheen Overlay Tiles (`(r + c) % 2 === 0`) so the 9x8 grid reads like
      // a museum onyx-and-slate strategy board instead of uniform grey!
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
          obj.material = this.crateSlateMat;
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

    // 4. Multi-Part Sculpted Brass-Collared Command Monolith (`WedgeBody`, `WedgeBrassPlinth`, `WedgeEscutcheon`)
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
    const rings: Array<[number, number, number, number, number]> = [
      [0.0, 0.34, 0.322, 0.255, -0.246],
      [0.042, 0.368, 0.348, 0.278, -0.266],
      [0.84, 0.254, 0.24, -0.045, -0.098],
      [0.88, 0.23, 0.218, -0.06, -0.112],
    ];
    const ringVerts: THREE.Vector3[][] = rings.map(([y, hwf, hwb, zf, zb]) => {
      const c = 0.044 * (hwf / 0.368);
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
    const topCenter = new THREE.Vector3(0, 0.88, -0.086);
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
    suspectTag: SuspectTag | null = null
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

    this.liveWedges.add({ faction, bodyMesh, plinthMesh, insetMesh });

    const aoDisc = new THREE.Mesh(this.wedgeAoGeo, this.wedgeAoMat);
    aoDisc.name = 'wedgeAoDisc';
    aoDisc.position.set(0.03, 0.004, -0.01);
    root.add(aoDisc);

    if (visibleRank !== 'UNKNOWN') {
      const emblem = buildRankEmblemMesh(visibleRank, this.materials.emblemPalette);
      emblem.scale.setScalar(0.86); // cleanly framed inside the sculpted brass escutcheon shield!
      emblem.position.set(0, 0.456, 0.126);
      emblem.rotation.x = -THREE.MathUtils.degToRad(22.0);
      root.add(emblem);
    }

    // PUBLIC VETERAN "GHOST ACE" BATTLE NOTCHES (`publicKills >= 1` — 0% Rank Leak!):
    // Stamps gleaming 3D diamond kill-pips atop the monolith crown + a menacing crimson/gold
    // veteran induction ring on `2+` kill survivors so unmarked Enemy Aces become dreaded board bosses!
    if (publicKills > 0) {
      const pipCount = Math.min(3, publicKills);
      const pipGeo = new THREE.OctahedronGeometry(0.042, 0);
      pipGeo.scale(1.0, 1.35, 0.75);
      const pipMat = new THREE.MeshBasicMaterial({
        color: isPlayer ? new THREE.Color(2.3, 1.75, 0.55) : new THREE.Color(2.5, 0.52, 0.38),
        toneMapped: false,
      });
      for (let k = 0; k < pipCount; k++) {
        const offset = (k - (pipCount - 1) * 0.5) * 0.115;
        const pip = new THREE.Mesh(pipGeo, pipMat);
        pip.position.set(offset, 0.935, -0.085);
        root.add(pip);
      }

      if (publicKills >= 2) {
        const aceHaloMat = new THREE.MeshBasicMaterial({
          color: isPlayer ? new THREE.Color(1.9, 1.45, 0.42) : new THREE.Color(2.3, 0.32, 0.38),
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

    if (faction === 'ENEMY') {
      root.rotation.y = Math.PI;
    }

    // Floating Amber Holographic Suspect Tag (`SPY?`, `GEN?`, `PVT?`, `OFF?`, `FLAG?`)
    if (suspectTag) {
      const badge = this.createHolographicPillSprite(suspectTag, 'AMBER');
      badge.position.set(0, 1.18, 0);
      root.add(badge);
    }

    root.scale.setScalar(HERO_WEDGE_SCALE);
    return root;
  }

  /**
   * Lifted `+28px` Cyan Holographic Projection Wedge for Thumb Dragging (Deployment & Active Play)!
   */
  public createHologramGhostWedge(rank: RankId): THREE.Group {
    const root = new THREE.Group();
    const srcGeo = this.monolithGeos.body ?? this.fallbackWedgeGeo;

    const holoMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.18, 1.45, 2.25),
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
    emblem.scale.setScalar(0.86);
    emblem.position.set(0, 0.456, 0.126);
    emblem.rotation.x = -THREE.MathUtils.degToRad(22.0);
    root.add(emblem);

    const label = this.createHolographicPillSprite(RANK_SPECS[rank].shortLabel, 'CYAN');
    label.position.set(0, 1.14, 0);
    root.add(label);

    root.scale.setScalar(HERO_WEDGE_SCALE);
    return root;
  }

  /**
   * Post-Match "Declassified" X-Ray Hologram Wireframe Monolith (`ref_declassified_replay.jpg`):
   * Renders BOTH Player (Electric Cyan) and Opponent (Laser Red-Crimson) pieces as translucent
   * X-Ray wireframes with true 3D rank insignias facing forward + floating holographic rank labels!
   */
  public createXRayReplayWedge(faction: Faction, trueRank: RankId, kills = 0): THREE.Group {
    const root = new THREE.Group();
    const isPlayer = faction === 'PLAYER';
    const srcGeo = this.monolithGeos.body ?? this.fallbackWedgeGeo;

    const shellMat = new THREE.MeshBasicMaterial({
      color: isPlayer ? new THREE.Color(0.08, 0.72, 1.18) : new THREE.Color(1.18, 0.14, 0.24),
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

    // Declassified: ALL 42 pieces face their true 3D rank emblem clearly toward the camera!
    const emblem = buildRankEmblemMesh(trueRank, this.materials.emblemPalette);
    emblem.scale.setScalar(0.86);
    emblem.position.set(0, 0.456, 0.126);
    emblem.rotation.x = -THREE.MathUtils.degToRad(22.0);
    root.add(emblem);

    // Compact tactical military codes so adjacent X-Ray pills never overlap in 9-wide formations!
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
    pill.position.set(0, 1.05, 0);
    root.add(pill);

    root.scale.setScalar(HERO_WEDGE_SCALE);
    return root;
  }

  private createHolographicPillSprite(
    text: string,
    tone: 'AMBER' | 'CYAN' | 'CRIMSON',
    compact = false
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = compact ? 184 : 256;
    canvas.height = 76;
    const ctx = canvas.getContext('2d')!;

    const borderCol =
      tone === 'AMBER' ? '#ffc44d' : tone === 'CYAN' ? '#4de8ff' : '#ff5e72';
    const bgCol =
      tone === 'AMBER'
        ? 'rgba(30, 18, 5, 0.94)'
        : tone === 'CYAN'
          ? 'rgba(6, 22, 36, 0.9)'
          : 'rgba(36, 8, 14, 0.9)';
    const textCol =
      tone === 'AMBER' ? '#ffebad' : tone === 'CYAN' ? '#e2fbff' : '#ffd8de';

    const boxW = canvas.width - 16;
    const midX = canvas.width * 0.5;

    ctx.fillStyle = bgCol;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = compact ? 3.5 : 4.2;
    ctx.beginPath();
    ctx.roundRect(8, 8, boxW, 50, 25);
    ctx.fill();
    ctx.stroke();

    // Crisp bottom holographic pointer chevron
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

  public createBoardCabinetGroup(): THREE.Group {
    const initBase = new THREE.Mesh(
      new THREE.BoxGeometry(10.4, 0.68, 12.1),
      this.materials.walnut
    );
    initBase.position.set(0, -0.25, -0.5);
    this.boardContainer.add(initBase);
    // Physically elevate the entire Walnut & Brass Game Board +0.12 above the table on its brass feet!
    this.boardContainer.position.y = 0.0;
    return this.boardContainer;
  }

  /**
   * Builds the On-Board 16-Emblem & 4-Angle Turnaround Collector's Showcase Group:
   * Sits directly on the main `9x8` chamfered slate & walnut board inside the `4096x4096` shadow frustum!
   */
  public createOnBoardInspectionGroup(): THREE.Group {
    const group = new THREE.Group();

    // Row 1 (`cols 2, 3, 5, 6`): 4-Angle Sculpted Command Monolith Turnaround (`0°, 90°, 180° Armored Rear, 270°`)
    const turnaroundCols = [2, 3, 5, 6];
    const turnaroundAngles = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
    turnaroundCols.forEach((col, idx) => {
      const w = this.createCommandWedge('PLAYER', 'GEN_5');
      w.position.copy(gridToWorld(col, 1));
      w.rotation.y = turnaroundAngles[idx]!;
      group.add(w);
    });

    // Rows 3..6 (`cols 2..5` — centered `4x4` museum showcase grid on the slate tiles!):
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

  public createWarRoomEnvironment(): WarRoomEnvironmentRefs {
    const root = new THREE.Group();
    const loader = new THREE.TextureLoader();

    const fbTable = new THREE.Mesh(new THREE.BoxGeometry(50, 0.34, 34), this.tacticalTableMat);
    fbTable.position.set(0, -0.855, 2.0);
    fbTable.receiveShadow = true;
    this.tablePropsContainer.add(fbTable);
    root.add(this.tablePropsContainer);

    // Deep, Crisp Cast-Shadow Plinth Skirt underneath the elevated Walnut & Brass Board!
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
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(aoCanvas),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    aoPad.rotation.x = -Math.PI / 2;
    aoPad.position.set(0.35, -0.68, -0.4);
    root.add(aoPad);

    const mapTexL = loader.load('./textures/vintage_war_map_left.jpg');
    mapTexL.colorSpace = THREE.SRGBColorSpace;
    mapTexL.anisotropy = 8;
    const mapMatL = new THREE.MeshStandardMaterial({
      map: mapTexL,
      color: new THREE.Color('#B4A184'),
      roughness: 0.85,
      metalness: 0.0,
      envMapIntensity: 0.1,
    });

    const mapTexR = loader.load('./textures/vintage_war_map_right.jpg');
    mapTexR.colorSpace = THREE.SRGBColorSpace;
    mapTexR.anisotropy = 8;
    const mapMatR = new THREE.MeshStandardMaterial({
      map: mapTexR,
      color: new THREE.Color('#B09D80'),
      roughness: 0.85,
      metalness: 0.0,
      envMapIntensity: 0.1,
    });

    const mapLeft = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.026, 4.2), mapMatL);
    mapLeft.position.set(-2.95, -0.668, -8.85);
    mapLeft.rotation.y = 0.14;
    mapLeft.castShadow = true;
    mapLeft.receiveShadow = true;
    root.add(mapLeft);

    const mapRight = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.026, 4.25), mapMatR);
    mapRight.position.set(3.05, -0.662, -8.75);
    mapRight.rotation.y = Math.PI - 0.16;
    mapRight.castShadow = true;
    mapRight.receiveShadow = true;
    root.add(mapRight);

    this.watchMountGroup.position.set(6.05, -0.662, -6.55);
    this.watchMountGroup.rotation.y = -0.45;
    this.watchMountGroup.scale.setScalar(0.92);

    const fallbackWatch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.72, 0.22, 32),
      this.materials.brassTrim
    );
    fallbackWatch.name = 'fallbackWatchBody';
    fallbackWatch.position.y = 0.11;
    fallbackWatch.castShadow = true;
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
    watchSecondPivot.position.set(0, 0.235, 0);
    const secondNeedle = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.008, 0.48),
      this.materials.brassRecessed
    );
    secondNeedle.position.z = -0.16;
    watchSecondPivot.add(secondNeedle);
    this.watchMountGroup.add(watchSecondPivot);
    root.add(this.watchMountGroup);

    const lanternFlameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.6, 1.65, 0.52),
      toneMapped: false,
    });
    const flameCore = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), lanternFlameMat);
    flameCore.position.set(-6.65, 0.46, -6.55);
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

    const tentTex = loader.load('./textures/tent_cyclorama.png');
    tentTex.colorSpace = THREE.SRGBColorSpace;
    const tentBackdropMat = new THREE.MeshBasicMaterial({
      map: tentTex,
      color: new THREE.Color(0.85, 0.8, 0.75),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cycGeo = new THREE.PlaneGeometry(26.0, 11.2, 28, 1);
    const cycPos = cycGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cycPos.count; i++) {
      const x = cycPos.getX(i);
      cycPos.setZ(i, x * x * 0.012);
    }
    cycGeo.computeVertexNormals();
    const cycMesh = new THREE.Mesh(cycGeo, tentBackdropMat);
    cycMesh.position.set(0, 3.15, -11.4);
    root.add(cycMesh);

    return {
      root,
      tableLanternShadowLight,
      lanternLightRight,
      lanternFlameMat,
      tentBackdropMesh: cycMesh,
      tentBackdropMat,
      watchSecondHand: watchSecondPivot,
    };
  }
}
