import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BOARD_COLS, BOARD_ROWS, ORDERED_RANKS, type Faction, type RankId } from '../core/ranks';
import {
  buildAttackMedallionMesh,
  buildRankEmblemMesh,
  type EmblemMaterialPalette,
} from './EmblemFactory';
import {
  createBrushedMetalBumpMap,
  createSlateBumpMap,
  createWalnutTextures,
} from './ProceduralTextures';

export const TILE_PITCH = 1.0;
export const GRID_CENTER_Z = 0.85;
export const ARBITER_BAY_CENTER_Z = -4.78;
export const LEFT_WELL_CENTER = new THREE.Vector3(-3.68, -0.28, -4.78);
export const RIGHT_WELL_CENTER = new THREE.Vector3(3.68, -0.28, -4.78);
export const INSPECT_STAGE_ORIGIN = new THREE.Vector3(-22.0, 0.0, 0.0);

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
  readonly brassRecessed: THREE.MeshPhysicalMaterial;
  readonly silverEmblem: THREE.MeshPhysicalMaterial;
  readonly playerNavy: THREE.MeshPhysicalMaterial;
  readonly enemyCrimson: THREE.MeshPhysicalMaterial;
  readonly velvetNavy: THREE.MeshPhysicalMaterial;
  readonly velvetCrimson: THREE.MeshPhysicalMaterial;
  readonly gunmetal: THREE.MeshPhysicalMaterial;
  readonly darkSteel: THREE.MeshStandardMaterial;
  readonly emblemPalette: EmblemMaterialPalette;
}

export interface WarRoomEnvironmentRefs {
  readonly root: THREE.Group;
  readonly lanternLightLeft: THREE.PointLight;
  readonly lanternLightRight: THREE.PointLight;
}

function extrudeRoundedShapeWithHoles(
  shape: THREE.Shape,
  depth: number,
  bevelThickness: number,
  bevelSize: number,
  bevelSegments = 4,
  uvScale = 0.1
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments: 20,
  });
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * uvScale + 0.5, uv.getY(i) * uvScale + 0.5);
    }
    uv.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
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

export class MeshFactory {
  public readonly materials: SharedPBRMaterials;
  private readonly wedgeBodyGeo: THREE.BufferGeometry;
  private glbShutterTemplate: THREE.Object3D | null = null;

  constructor() {
    const walnutTex = createWalnutTextures(512);
    const metalBump = createBrushedMetalBumpMap(256);
    const slateBump = createSlateBumpMap(256);

    const walnut = new THREE.MeshPhysicalMaterial({
      map: walnutTex.map,
      bumpMap: walnutTex.bumpMap,
      bumpScale: 0.009,
      roughnessMap: walnutTex.roughnessMap,
      color: new THREE.Color('#6E472C'),
      roughness: 0.44,
      metalness: 0.02,
      clearcoat: 0.14,
      clearcoatRoughness: 0.34,
      envMapIntensity: 0.42,
    });

    const brassTrim = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#E2B04A'),
      metalness: 0.92,
      roughness: 0.24,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.1,
      clearcoatRoughness: 0.26,
      envMapIntensity: 1.25,
    });

    const brassRecessed = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#946A22'),
      metalness: 0.88,
      roughness: 0.34,
      bumpMap: metalBump,
      bumpScale: 0.006,
      envMapIntensity: 1.1,
    });

    const silverEmblem = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#DCE2EA'),
      metalness: 0.95,
      roughness: 0.18,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.14,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.35,
    });

    const slateTile = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#222730'),
      roughness: 0.58,
      metalness: 0.08,
      bumpMap: slateBump,
      bumpScale: 0.007,
      clearcoat: 0.06,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.45,
    });

    const obsidianGroove = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#090B0F'),
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.2,
    });

    const playerNavy = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#162B4C'),
      roughness: 0.42,
      metalness: 0.06,
      bumpMap: slateBump,
      bumpScale: 0.003,
      clearcoat: 0.1,
      clearcoatRoughness: 0.36,
      sheen: 0.2,
      sheenColor: new THREE.Color('#3b68ab'),
      envMapIntensity: 0.45,
    });

    const enemyCrimson = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#5E1723'),
      roughness: 0.42,
      metalness: 0.06,
      bumpMap: slateBump,
      bumpScale: 0.003,
      clearcoat: 0.1,
      clearcoatRoughness: 0.36,
      sheen: 0.2,
      sheenColor: new THREE.Color('#a13347'),
      envMapIntensity: 0.45,
    });

    const velvetNavy = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#0B1833'),
      roughness: 0.9,
      metalness: 0.0,
      bumpMap: slateBump,
      bumpScale: 0.014,
      sheen: 0.85,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color('#2a4e91'),
      envMapIntensity: 0.25,
    });

    const velvetCrimson = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#3B0D18'),
      roughness: 0.9,
      metalness: 0.0,
      bumpMap: slateBump,
      bumpScale: 0.014,
      sheen: 0.85,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color('#8a283d'),
      envMapIntensity: 0.25,
    });

    const gunmetal = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#39424F'),
      metalness: 0.84,
      roughness: 0.28,
      bumpMap: metalBump,
      bumpScale: 0.005,
      clearcoat: 0.18,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.35,
    });

    const darkSteel = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#232933'),
      metalness: 0.78,
      roughness: 0.34,
      envMapIntensity: 1.35,
    });

    const contactShadow = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#070b12'),
      roughness: 0.95,
      metalness: 0.0,
    });

    this.materials = {
      walnut,
      slateTile,
      obsidianGroove,
      brassTrim,
      brassRecessed,
      silverEmblem,
      playerNavy,
      enemyCrimson,
      velvetNavy,
      velvetCrimson,
      gunmetal,
      darkSteel,
      emblemPalette: {
        brass: brassTrim,
        silver: silverEmblem,
        brassRecessed,
        contactShadow,
      },
    };

    this.wedgeBodyGeo = this.buildPrecisionWedgeGeometry();
  }

  public async preloadBakedModels(): Promise<void> {
    const loader = new GLTFLoader();
    try {
      const shutterGltf = await loader.loadAsync('./models/arbiter_shutter.glb');
      this.glbShutterTemplate = shutterGltf.scene;
    } catch {
      this.glbShutterTemplate = null;
    }
  }

  public getBakedShutterClone(): THREE.Object3D | null {
    return this.glbShutterTemplate ? this.glbShutterTemplate.clone(true) : null;
  }

  private buildPrecisionWedgeGeometry(): THREE.BufferGeometry {
    const rings: Array<[number, number, number, number, number]> = [
      [0.0, 0.34, 0.322, 0.255, -0.246],
      [0.045, 0.37, 0.35, 0.275, -0.265],
      [0.828, 0.254, 0.24, -0.041, -0.099],
      [0.86, 0.23, 0.218, -0.056, -0.112],
    ];

    const ringVerts: THREE.Vector3[][] = rings.map(([y, hwf, hwb, zf, zb]) => {
      const c = 0.044 * (hwf / 0.37);
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
    const pushQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      pushTri(a, b, c);
      pushTri(a, c, d);
    };

    for (let r = 0; r < ringVerts.length - 1; r++) {
      const lower = ringVerts[r]!;
      const upper = ringVerts[r + 1]!;
      for (let i = 0; i < 8; i++) {
        const ni = (i + 1) % 8;
        pushQuad(lower[i]!, lower[ni]!, upper[ni]!, upper[i]!);
      }
    }

    const topRing = ringVerts[ringVerts.length - 1]!;
    const topCenter = new THREE.Vector3(0, 0.862, -0.084);
    for (let i = 0; i < 8; i++) {
      const ni = (i + 1) % 8;
      pushTri(topCenter, topRing[i]!, topRing[ni]!);
    }

    const botRing = ringVerts[0]!;
    const botCenter = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const ni = (i + 1) % 8;
      pushTri(botCenter, botRing[ni]!, botRing[i]!);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  public createCommandWedge(
    faction: Faction,
    visibleRank: RankId | 'UNKNOWN'
  ): THREE.Group {
    const root = new THREE.Group();
    const bodyMat =
      faction === 'PLAYER' ? this.materials.playerNavy : this.materials.enemyCrimson;

    const body = new THREE.Mesh(this.wedgeBodyGeo, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);

    if (visibleRank !== 'UNKNOWN') {
      const emblem = buildRankEmblemMesh(visibleRank, this.materials.emblemPalette);
      // Centered cleanly on the 68.0 deg sloped front face at 72% face scale!
      emblem.position.set(0, 0.435, 0.118);
      emblem.rotation.x = -THREE.MathUtils.degToRad(22.0);
      root.add(emblem);
    }

    if (faction === 'ENEMY') {
      root.rotation.y = Math.PI;
    }

    return root;
  }

  public createAttackMedallion(): THREE.Group {
    return buildAttackMedallionMesh(this.materials.emblemPalette);
  }

  public createBoardCabinetGroup(): THREE.Group {
    const boardGroup = new THREE.Group();

    // 1. Lower stepped walnut plinth (`10.56 × 12.24`) with full open pocket under Arbiter bay
    const lowerShape = makeRoundedRectPath(0, -0.5, 10.56, 12.24, 0.48, true) as THREE.Shape;
    lowerShape.holes.push(
      makeRoundedRectPath(0, ARBITER_BAY_CENTER_Z, 5.1, 2.1, 0.15) as THREE.Path
    );
    const lowerGeo = extrudeRoundedShapeWithHoles(lowerShape, 0.34, 0.045, 0.045, 4, 0.095);
    const lowerMesh = new THREE.Mesh(lowerGeo, this.materials.walnut);
    lowerMesh.position.y = -0.68;
    lowerMesh.castShadow = true;
    lowerMesh.receiveShadow = true;
    boardGroup.add(lowerMesh);

    // 2. Upper mitered walnut deck (`10.02 × 11.70`) with 4 precision cutouts
    const deckShape = makeRoundedRectPath(0, -0.5, 10.02, 11.7, 0.36, true) as THREE.Shape;
    deckShape.holes.push(
      makeRoundedRectPath(0, GRID_CENTER_Z, 9.16, 8.16, 0.16) as THREE.Path,
      makeRoundedRectPath(LEFT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.42, 2.14, 0.14) as THREE.Path,
      makeRoundedRectPath(0, ARBITER_BAY_CENTER_Z, 5.14, 2.14, 0.16) as THREE.Path,
      makeRoundedRectPath(RIGHT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.42, 2.14, 0.14) as THREE.Path
    );
    const deckGeo = extrudeRoundedShapeWithHoles(deckShape, 0.31, 0.035, 0.035, 4, 0.095);
    const deckMesh = new THREE.Mesh(deckGeo, this.materials.walnut);
    deckMesh.position.y = -0.34;
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    boardGroup.add(deckMesh);

    // 3. Gleaming Flush Brushed-Brass Perimeter Collars (`#E2B04A`)
    const addBrassCollar = (
      cx: number,
      cz: number,
      outerW: number,
      outerD: number,
      bandWidth: number,
      radius: number
    ) => {
      const collar = makeRoundedRectPath(cx, cz, outerW, outerD, radius, true) as THREE.Shape;
      collar.holes.push(
        makeRoundedRectPath(
          cx,
          cz,
          outerW - bandWidth * 2,
          outerD - bandWidth * 2,
          Math.max(0.04, radius - bandWidth * 0.7)
        ) as THREE.Path
      );
      const geo = extrudeRoundedShapeWithHoles(collar, 0.034, 0.009, 0.009, 3, 0.25);
      const mesh = new THREE.Mesh(geo, this.materials.brassTrim);
      mesh.position.y = -0.02;
      mesh.receiveShadow = true;
      boardGroup.add(mesh);
    };

    addBrassCollar(0, GRID_CENTER_Z, 9.28, 8.28, 0.115, 0.17);
    addBrassCollar(LEFT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.52, 2.24, 0.085, 0.15);
    addBrassCollar(0, ARBITER_BAY_CENTER_Z, 5.24, 2.24, 0.09, 0.17);
    addBrassCollar(RIGHT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.52, 2.24, 0.085, 0.15);

    // 4. Recessed Matte-Obsidian Groove Bed beneath the 9x8 Grid
    const grooveBed = new THREE.Mesh(
      new THREE.BoxGeometry(9.08, 0.08, 8.08),
      this.materials.obsidianGroove
    );
    grooveBed.position.set(0, -0.085, GRID_CENTER_Z);
    grooveBed.receiveShadow = true;
    boardGroup.add(grooveBed);

    // 5. 72 Individual `0.97 × 0.97` Chamfered Slate Squares via InstancedMesh
    const tileShape = makeRoundedRectPath(0, 0, 0.95, 0.95, 0.03, true) as THREE.Shape;
    const singleTileGeo = extrudeRoundedShapeWithHoles(tileShape, 0.055, 0.013, 0.013, 3, 0.5);
    const tileInstanced = new THREE.InstancedMesh(
      singleTileGeo,
      this.materials.slateTile,
      BOARD_COLS * BOARD_ROWS
    );
    tileInstanced.receiveShadow = true;
    tileInstanced.castShadow = false;

    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const pos = gridToWorld(col, row);
        dummy.position.set(pos.x, -0.064, pos.z);
        dummy.updateMatrix();
        tileInstanced.setMatrixAt(idx++, dummy.matrix);
      }
    }
    tileInstanced.instanceMatrix.needsUpdate = true;
    boardGroup.add(tileInstanced);

    // 6. Twin Velvet Casualty Wells
    const wellPadGeo = extrudeRoundedShapeWithHoles(
      makeRoundedRectPath(0, 0, 1.34, 2.06, 0.1, true) as THREE.Shape,
      0.05,
      0.012,
      0.012,
      2
    );
    const navyWellFloor = new THREE.Mesh(wellPadGeo, this.materials.velvetNavy);
    navyWellFloor.position.set(LEFT_WELL_CENTER.x, -0.34, ARBITER_BAY_CENTER_Z);
    navyWellFloor.receiveShadow = true;
    boardGroup.add(navyWellFloor);

    const crimsonWellFloor = new THREE.Mesh(wellPadGeo, this.materials.velvetCrimson);
    crimsonWellFloor.position.set(RIGHT_WELL_CENTER.x, -0.34, ARBITER_BAY_CENTER_Z);
    crimsonWellFloor.receiveShadow = true;
    boardGroup.add(crimsonWellFloor);

    for (const wx of [LEFT_WELL_CENTER.x, RIGHT_WELL_CENTER.x]) {
      const linerShape = makeRoundedRectPath(
        wx,
        ARBITER_BAY_CENTER_Z,
        1.44,
        2.16,
        0.14,
        true
      ) as THREE.Shape;
      linerShape.holes.push(
        makeRoundedRectPath(wx, ARBITER_BAY_CENTER_Z, 1.32, 2.04, 0.1) as THREE.Path
      );
      const liner = new THREE.Mesh(
        extrudeRoundedShapeWithHoles(linerShape, 0.3, 0.005, 0.005, 1),
        this.materials.obsidianGroove
      );
      liner.position.y = -0.33;
      boardGroup.add(liner);
    }

    return boardGroup;
  }

  /**
   * Guardrail #1: Zero cartoon background primitives or opaque wood slabs!
   * Uses a transparent `THREE.ShadowMaterial({ opacity: 0.62 })` shadow-catcher plane directly
   * beneath the walnut cabinet so real 3D shadows fall onto `war_room_backdrop.jpg`'s oak planks,
   * paired with warm off-screen flickering 2700K lantern `PointLight` pools.
   */
  public createWarRoomEnvironment(): WarRoomEnvironmentRefs {
    const root = new THREE.Group();

    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 36),
      new THREE.ShadowMaterial({ opacity: 0.62 })
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.set(0, -0.682, -0.5);
    shadowCatcher.receiveShadow = true;
    root.add(shadowCatcher);

    // Off-screen warm 2700K flickering lantern PointLight pools illuminating rear brass & walnut edges
    const lanternLightLeft = new THREE.PointLight(0xff9b3d, 6.5, 22, 1.5);
    lanternLightLeft.position.set(-4.8, 3.8, -8.8);
    root.add(lanternLightLeft);

    const lanternLightRight = new THREE.PointLight(0xff9636, 5.8, 22, 1.5);
    lanternLightRight.position.set(5.0, 4.2, -9.2);
    root.add(lanternLightRight);

    return {
      root,
      lanternLightLeft,
      lanternLightRight,
    };
  }

  public createInspectionGalleryStage(): THREE.Group {
    const stage = new THREE.Group();
    stage.position.copy(INSPECT_STAGE_ORIGIN);

    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(6.6, 0.26, 8.8),
      this.materials.walnut
    );
    backing.position.set(0, -0.15, -0.25);
    backing.castShadow = true;
    backing.receiveShadow = true;
    stage.add(backing);

    const innerSlate = new THREE.Mesh(
      new THREE.BoxGeometry(6.1, 0.08, 8.3),
      this.materials.slateTile
    );
    innerSlate.position.set(0, -0.01, -0.25);
    innerSlate.receiveShadow = true;
    stage.add(innerSlate);

    const turnaroundAngles = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
    turnaroundAngles.forEach((ry, idx) => {
      const w = this.createCommandWedge('PLAYER', 'GEN_5');
      w.position.set((idx - 1.5) * 1.16, 0.03, -3.05);
      w.rotation.y = ry;
      stage.add(w);
    });

    ORDERED_RANKS.forEach((rankId, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = (col - 1.5) * 1.16;
      const z = -1.6 + row * 1.22;

      const holder = new THREE.Group();
      holder.position.set(x, 0.04, z);
      holder.rotation.x = -0.44;
      const wedge = this.createCommandWedge('PLAYER', rankId);
      holder.add(wedge);
      stage.add(holder);
    });

    const medHolder = new THREE.Group();
    medHolder.position.set(1.5 * 1.16, 0.34, -1.6 + 3 * 1.22);
    medHolder.rotation.x = 0.72;
    medHolder.add(this.createAttackMedallion());
    stage.add(medHolder);

    return stage;
  }
}
