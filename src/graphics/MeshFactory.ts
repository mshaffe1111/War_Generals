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
  createTopologicalMapTexture,
  createWalnutTextures,
  createWatchDialTexture,
} from './ProceduralTextures';

export const TILE_PITCH = 1.0;
export const GRID_CENTER_Z = 0.85;
export const ARBITER_BAY_CENTER_Z = -4.78;
export const LEFT_WELL_CENTER = new THREE.Vector3(-3.68, -0.28, -4.78);
export const RIGHT_WELL_CENTER = new THREE.Vector3(3.68, -0.28, -4.78);
export const INSPECT_STAGE_ORIGIN = new THREE.Vector3(-18.0, 0.0, 0.0);

export function gridToWorld(col: number, row: number): THREE.Vector3 {
  const x = (col - (BOARD_COLS - 1) / 2) * TILE_PITCH;
  const z = (row - (BOARD_ROWS - 1) / 2) * TILE_PITCH + GRID_CENTER_Z;
  return new THREE.Vector3(x, 0, z);
}

export interface SharedPBRMaterials {
  readonly walnut: THREE.MeshPhysicalMaterial;
  readonly slateTile: THREE.MeshStandardMaterial;
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
  readonly watchSecondHand: THREE.Object3D;
}

function extrudeRoundedShapeWithHoles(
  shape: THREE.Shape,
  depth: number,
  bevelThickness: number,
  bevelSize: number,
  bevelSegments = 3,
  uvScale = 0.1
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments: 18,
  });
  geo.rotateX(-Math.PI / 2);
  // Normalize world-space UVs so walnut woodgrain flows continuously across the whole 10.5-unit cabinet
  // with ZERO vertical plank-seam striping on beveled rails!
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
  // Note: ExtrudeGeometry is rotated -90 deg around X (`(x, y) -> (x, 0, -y)`),
  // so shape Y maps to `-Z` in world space! Using `sy = -cz` places cutouts at exact world `cz`.
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
  private wedgeBodyGeo: THREE.BufferGeometry;
  private glbShutterTemplate: THREE.Object3D | null = null;

  constructor() {
    const walnutTex = createWalnutTextures(512);
    const metalBump = createBrushedMetalBumpMap(256);
    const slateBump = createSlateBumpMap(256);

    const walnut = new THREE.MeshPhysicalMaterial({
      map: walnutTex.map,
      bumpMap: walnutTex.bumpMap,
      bumpScale: 0.008,
      roughnessMap: walnutTex.roughnessMap,
      roughness: 0.4,
      metalness: 0.02,
      clearcoat: 0.22,
      clearcoatRoughness: 0.26,
      envMapIntensity: 0.9,
    });

    const brassTrim = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#C8963E'),
      metalness: 0.92,
      roughness: 0.26,
      bumpMap: metalBump,
      bumpScale: 0.005,
      clearcoat: 0.12,
      clearcoatRoughness: 0.26,
      envMapIntensity: 1.15,
    });

    const brassRecessed = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#8E6422'),
      metalness: 0.88,
      roughness: 0.36,
      bumpMap: metalBump,
      bumpScale: 0.007,
      envMapIntensity: 0.95,
    });

    const silverEmblem = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#B5BEC9'),
      metalness: 0.9,
      roughness: 0.27,
      bumpMap: metalBump,
      bumpScale: 0.005,
      clearcoat: 0.08,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.88,
    });

    const slateTile = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2B3038'),
      roughness: 0.62,
      metalness: 0.05,
      bumpMap: slateBump,
      bumpScale: 0.008,
      envMapIntensity: 0.85,
    });

    const obsidianGroove = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0E1116'),
      roughness: 0.85,
      metalness: 0.04,
    });

    const playerNavy = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#182B49'),
      roughness: 0.46,
      metalness: 0.06,
      bumpMap: slateBump,
      bumpScale: 0.004,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
      sheen: 0.22,
      sheenColor: new THREE.Color('#3c629c'),
      envMapIntensity: 1.05,
    });

    const enemyCrimson = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#5E1924'),
      roughness: 0.46,
      metalness: 0.06,
      bumpMap: slateBump,
      bumpScale: 0.004,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
      sheen: 0.22,
      sheenColor: new THREE.Color('#a33648'),
      envMapIntensity: 1.05,
    });

    const velvetNavy = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#0D1B36'),
      roughness: 0.88,
      metalness: 0.0,
      bumpMap: slateBump,
      bumpScale: 0.015,
      sheen: 0.85,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color('#2d5296'),
    });

    const velvetCrimson = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#3B0E18'),
      roughness: 0.88,
      metalness: 0.0,
      bumpMap: slateBump,
      bumpScale: 0.015,
      sheen: 0.85,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color('#8f2c40'),
    });

    const gunmetal = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#545F6E'),
      metalness: 0.72,
      roughness: 0.34,
      bumpMap: metalBump,
      bumpScale: 0.006,
      clearcoat: 0.14,
      envMapIntensity: 1.3,
    });

    const darkSteel = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#38404C'),
      metalness: 0.65,
      roughness: 0.38,
    });

    const contactShadow = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#090d14'),
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

  /**
   * Loads Blender-baked `.glb` models from `./models/` if available, seamlessly pairing
   * them with our calibrated PBR materials & CAD rank reliefs.
   */
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

  /**
   * CAD-beveled Command Wedge matching ref_piece_turnaround.jpg:
   * - Tapered trapezoidal footprint
   * - Exact 68.0 deg sloped front insignia face (+Z)
   * - Exact 78.0 deg steeper completely blank rear shield face (-Z)
   * - Chamfered side bevels, plinth skirt, and flat chamfered top cap
   */
  private buildPrecisionWedgeGeometry(): THREE.BufferGeometry {
    // 5 vertical cross-section rings lofted with smooth chamfer transitions
    // Ring parameters: [y, halfWidthFront, halfWidthBack, zFront, zBack]
    const rings: Array<[number, number, number, number, number]> = [
      [0.0, 0.335, 0.318, 0.252, -0.244],
      [0.045, 0.365, 0.346, 0.275, -0.265], // bottom plinth ridge
      [0.828, 0.246, 0.234, -0.041, -0.099], // upper shoulder right below top chamfer
      [0.86, 0.222, 0.212, -0.056, -0.112], // chamfered flat top cap
    ];

    // Each ring has 8 perimeter vertices (chamfered corners!) so side bevels catch distinct rim highlights
    const ringVerts: THREE.Vector3[][] = rings.map(([y, hwf, hwb, zf, zb]) => {
      const c = 0.042 * (hwf / 0.365); // corner chamfer inset proportional to width
      return [
        new THREE.Vector3(-hwf + c, y, zf), // 0: front-left inner
        new THREE.Vector3(hwf - c, y, zf), // 1: front-right inner
        new THREE.Vector3(hwf, y, zf - c), // 2: right-front bevel
        new THREE.Vector3(hwb, y, zb + c), // 3: right-back bevel
        new THREE.Vector3(hwb - c, y, zb), // 4: back-right inner
        new THREE.Vector3(-hwb + c, y, zb), // 5: back-left inner
        new THREE.Vector3(-hwb, y, zb + c), // 6: left-back bevel
        new THREE.Vector3(-hwf, y, zf - c), // 7: left-front bevel
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

    // Top cap fan
    const topRing = ringVerts[ringVerts.length - 1]!;
    const topCenter = new THREE.Vector3(0, 0.862, -0.084);
    for (let i = 0; i < 8; i++) {
      const ni = (i + 1) % 8;
      pushTri(topCenter, topRing[i]!, topRing[ni]!);
    }

    // Bottom cap fan
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

  /**
   * Builds a complete Command Wedge mesh:
   * - PLAYER: Cobalt-Navy (#182B49) facing camera (+Z) with proud 3D metallic rank relief
   * - ENEMY (`visibleRank === 'UNKNOWN'`): Crimson-Burgundy (#5E1924) rotated 180 deg so only blank rear shield is visible!
   */
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
      // Analytic mount onto exact 68.0 deg front slope:
      // At y = 0.445, surface z = 0.275 - (0.445 - 0.045) * cot(68 deg) = 0.275 - 0.400 * 0.4040 = +0.1134
      emblem.position.set(0, 0.445, 0.114);
      emblem.rotation.x = -THREE.MathUtils.degToRad(22.0);
      root.add(emblem);
    }

    if (faction === 'ENEMY') {
      // Rotate 180 deg so enemy wedge shows ONLY its steeper 78 deg unmarked rear shield face!
      root.rotation.y = Math.PI;
    }

    return root;
  }

  public createAttackMedallion(): THREE.Group {
    return buildAttackMedallionMesh(this.materials.emblemPalette);
  }

  /**
   * Builds the Oiled Walnut 9×8 Board Cabinet, Flush Brushed-Brass Trim Collars,
   * 72 Instanced Chamfered Slate Squares over Obsidian Grooves, and Twin Velvet Casualty Wells
   * matching ref_board_empty.jpg.
   */
  public createBoardCabinetGroup(): THREE.Group {
    const boardGroup = new THREE.Group();

    // 1. Lower stepped walnut plinth (`10.6 × 12.25`) with full open pocket under the entire Arbiter bay
    //    so trapdoor chutes NEVER expose extruded walnut walls!
    const lowerShape = makeRoundedRectPath(0, -0.5, 10.56, 12.24, 0.48, true) as THREE.Shape;
    lowerShape.holes.push(
      makeRoundedRectPath(0, ARBITER_BAY_CENTER_Z, 5.1, 2.1, 0.15) as THREE.Path
    );
    const lowerGeo = extrudeRoundedShapeWithHoles(lowerShape, 0.34, 0.045, 0.045, 4);
    const lowerMesh = new THREE.Mesh(lowerGeo, this.materials.walnut);
    lowerMesh.position.y = -0.68;
    lowerMesh.castShadow = true;
    lowerMesh.receiveShadow = true;
    boardGroup.add(lowerMesh);

    // 2. Upper mitered walnut deck (`10.04 × 11.72`) with 4 precision cutouts:
    //    (a) 9x8 Slate Playfield, (b) Left Casualty Well, (c) Center Arbiter Dock, (d) Right Casualty Well
    const deckShape = makeRoundedRectPath(0, -0.5, 10.02, 11.7, 0.36, true) as THREE.Shape;
    deckShape.holes.push(
      makeRoundedRectPath(0, GRID_CENTER_Z, 9.16, 8.16, 0.16) as THREE.Path,
      makeRoundedRectPath(LEFT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.42, 2.14, 0.14) as THREE.Path,
      makeRoundedRectPath(0, ARBITER_BAY_CENTER_Z, 5.14, 2.14, 0.16) as THREE.Path,
      makeRoundedRectPath(RIGHT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.42, 2.14, 0.14) as THREE.Path
    );
    const deckGeo = extrudeRoundedShapeWithHoles(deckShape, 0.31, 0.035, 0.035, 4);
    const deckMesh = new THREE.Mesh(deckGeo, this.materials.walnut);
    deckMesh.position.y = -0.34;
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    boardGroup.add(deckMesh);

    // 3. Flush Brushed-Brass Perimeter Collars around Playfield + 3 Top Cutouts (`ref_board_empty.jpg`)
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
      const geo = extrudeRoundedShapeWithHoles(collar, 0.032, 0.008, 0.008, 3);
      const mesh = new THREE.Mesh(geo, this.materials.brassTrim);
      mesh.position.y = -0.022;
      mesh.receiveShadow = true;
      boardGroup.add(mesh);
    };

    addBrassCollar(0, GRID_CENTER_Z, 9.26, 8.26, 0.11, 0.17);
    addBrassCollar(LEFT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.5, 2.22, 0.08, 0.15);
    addBrassCollar(0, ARBITER_BAY_CENTER_Z, 5.22, 2.22, 0.085, 0.17);
    addBrassCollar(RIGHT_WELL_CENTER.x, ARBITER_BAY_CENTER_Z, 1.5, 2.22, 0.08, 0.15);

    // 4. Recessed Matte-Obsidian Groove Bed beneath the 9x8 Grid
    const grooveBed = new THREE.Mesh(
      new THREE.BoxGeometry(9.08, 0.08, 8.08),
      this.materials.obsidianGroove
    );
    grooveBed.position.set(0, -0.085, GRID_CENTER_Z);
    grooveBed.receiveShadow = true;
    boardGroup.add(grooveBed);

    // 5. 72 Individual `0.97 × 0.97` Beveled Matte Charcoal-Slate Tiles via InstancedMesh (`9 Cols × 8 Rows`)
    const tileShape = makeRoundedRectPath(0, 0, 0.952, 0.952, 0.028, true) as THREE.Shape;
    const singleTileGeo = extrudeRoundedShapeWithHoles(tileShape, 0.055, 0.011, 0.011, 2);
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

    // 6. Twin Velvet Casualty Wells (Left Cobalt-Navy, Right Crimson-Burgundy)
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

    // Inner dark walnut walls lining both wells so velvet depth reads cleanly
    for (const wx of [LEFT_WELL_CENTER.x, RIGHT_WELL_CENTER.x]) {
      const linerShape = makeRoundedRectPath(wx, ARBITER_BAY_CENTER_Z, 1.44, 2.16, 0.14, true) as THREE.Shape;
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
   * Builds the surrounding War-Room Campaign Table, Parchment Topological War Maps,
   * Beveled Brass-and-Glass Pocket Watch with live ticking second hand, Spiral Field Notebook,
   * and Canvas Command Tent illuminated by two flickering 2700K Oil Lanterns.
   */
  public createWarRoomEnvironment(): WarRoomEnvironmentRefs {
    const root = new THREE.Group();

    // 1. Weathered Oak Campaign Table Plank Surface
    const oakMat = new THREE.MeshStandardMaterial({
      map: this.materials.walnut.map,
      bumpMap: this.materials.walnut.bumpMap,
      bumpScale: 0.024,
      color: new THREE.Color('#8a6b4e'),
      roughness: 0.72,
      metalness: 0.02,
    });
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(34, 0.6, 28), oakMat);
    tableTop.position.set(0, -1.01, -2.5);
    tableTop.receiveShadow = true;
    root.add(tableTop);

    // 2. Two Angled Parchment Topological War Maps behind & flanking the cabinet (`ref_battle_act1_lockin.jpg`)
    const mapMatLeft = new THREE.MeshStandardMaterial({
      map: createTopologicalMapTexture(0),
      roughness: 0.86,
      metalness: 0.0,
    });
    const mapLeft = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.018, 5.2), mapMatLeft);
    mapLeft.position.set(-3.3, -0.695, -8.4);
    mapLeft.rotation.y = 0.11;
    mapLeft.receiveShadow = true;
    root.add(mapLeft);

    const mapMatRight = new THREE.MeshStandardMaterial({
      map: createTopologicalMapTexture(2.3),
      roughness: 0.86,
      metalness: 0.0,
    });
    const mapRight = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.018, 5.4), mapMatRight);
    mapRight.position.set(3.4, -0.685, -8.25);
    mapRight.rotation.y = -0.14;
    mapRight.receiveShadow = true;
    root.add(mapRight);

    // 3. Beveled Brass-and-Glass Pocket Watch cleanly above top-right cabinet corner (`ref_battle_act1_lockin.jpg`)
    const watchGroup = new THREE.Group();
    watchGroup.position.set(4.55, -0.58, -8.05);
    watchGroup.rotation.y = -0.38;

    const watchCase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.75, 0.2, 36),
      this.materials.brassTrim
    );
    watchCase.castShadow = true;
    watchCase.receiveShadow = true;
    watchGroup.add(watchCase);

    const watchBezel = new THREE.Mesh(
      new THREE.TorusGeometry(0.69, 0.055, 14, 36),
      this.materials.brassTrim
    );
    watchBezel.rotation.x = Math.PI / 2;
    watchBezel.position.y = 0.1;
    watchGroup.add(watchBezel);

    // Crown stem & bow ring at 12 o'clock
    const crownStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.22, 12),
      this.materials.brassTrim
    );
    crownStem.rotation.x = Math.PI / 2;
    crownStem.position.set(0, 0.04, -0.82);
    watchGroup.add(crownStem);

    const crownBow = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.025, 10, 24),
      this.materials.brassTrim
    );
    crownBow.rotation.x = Math.PI / 2;
    crownBow.position.set(0, 0.04, -0.96);
    watchGroup.add(crownBow);

    const dialMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.65, 36),
      new THREE.MeshStandardMaterial({
        map: createWatchDialTexture(),
        roughness: 0.42,
        metalness: 0.05,
      })
    );
    dialMesh.rotation.x = -Math.PI / 2;
    dialMesh.position.y = 0.103;
    watchGroup.add(dialMesh);

    const watchSecondPivot = new THREE.Group();
    watchSecondPivot.position.set(0, 0.118, 0);
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.01, 0.52),
      this.materials.brassRecessed
    );
    needle.position.z = -0.18;
    watchSecondPivot.add(needle);
    watchGroup.add(watchSecondPivot);

    const watchGlass = new THREE.Mesh(
      new THREE.SphereGeometry(0.67, 28, 16, 0, Math.PI * 2, 0, 0.42),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.24,
        roughness: 0.06,
        metalness: 0.0,
        clearcoat: 1.0,
      })
    );
    watchGlass.position.y = -0.49;
    watchGroup.add(watchGlass);
    root.add(watchGroup);

    // 4. Spiral Field Notebook tucked cleanly on outer right table margin (no stray white sliver at 412px!)
    const notebookGroup = new THREE.Group();
    notebookGroup.position.set(7.45, -0.63, 0.8);
    notebookGroup.rotation.y = -0.12;

    const coverMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2c3329'),
      roughness: 0.78,
    });
    const pageMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#dfd5bc'),
      roughness: 0.85,
    });
    const notebookCover = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.11, 2.75), coverMat);
    notebookCover.castShadow = true;
    notebookCover.receiveShadow = true;
    notebookGroup.add(notebookCover);

    const notebookPages = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.05, 2.64), pageMat);
    notebookPages.position.set(0.03, 0.065, 0);
    notebookGroup.add(notebookPages);

    for (let s = 0; s < 14; s++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.065, 0.013, 8, 16),
        this.materials.brassTrim
      );
      coil.position.set(-0.9, 0.05, -1.18 + s * 0.18);
      coil.rotation.y = Math.PI / 2;
      notebookGroup.add(coil);
    }
    root.add(notebookGroup);

    // 5. Draped Canvas Command Tent Flaps & Rear Crates + Twin Warm 2700K Oil Lanterns (`ref_battle_act1_lockin.jpg`)
    const tentCanvasMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#3b3226'),
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const darkInteriorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0c0a08'),
      roughness: 0.98,
    });

    const tentBackWall = new THREE.Mesh(new THREE.PlaneGeometry(36, 22), darkInteriorMat);
    tentBackWall.position.set(0, 5.5, -18.5);
    root.add(tentBackWall);

    // Parted draped canvas tent curtains framing top-left and top-right
    for (const side of [-1, 1]) {
      const drapeGeo = new THREE.CylinderGeometry(1.6, 3.6, 15.5, 20, 8, true, 0, Math.PI * 1.15);
      const pos = drapeGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const fold = Math.sin(pos.getX(i) * 3.4 + y * 0.35) * 0.18;
        pos.setZ(i, pos.getZ(i) + fold);
      }
      drapeGeo.computeVertexNormals();
      const drape = new THREE.Mesh(drapeGeo, tentCanvasMat);
      drape.position.set(side * 5.6, 5.2, -14.2);
      drape.rotation.z = side * 0.24;
      drape.rotation.y = side > 0 ? Math.PI * 0.65 : -Math.PI * 0.15;
      root.add(drape);
    }

    const buildOilLantern = (x: number, y: number, z: number, scale: number): THREE.PointLight => {
      const lGroup = new THREE.Group();
      lGroup.position.set(x, y, z);
      lGroup.scale.setScalar(scale);

      // Wooden crate pedestal
      const crate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 2.2), oakMat);
      crate.position.y = -1.0;
      lGroup.add(crate);

      // Brass lantern base + cap + wire guards
      const fount = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.62, 0.36, 20),
        this.materials.brassRecessed
      );
      fount.position.y = 0.18;
      lGroup.add(fount);

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.46, 18, 16),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(1.42, 0.88, 0.38),
          toneMapped: false,
        })
      );
      globe.scale.set(1, 1.35, 1);
      globe.position.y = 0.82;
      lGroup.add(globe);

      const hood = new THREE.Mesh(
        new THREE.ConeGeometry(0.58, 0.42, 20),
        this.materials.darkSteel
      );
      hood.position.y = 1.52;
      lGroup.add(hood);

      const light = new THREE.PointLight(0xff9636, 3.6, 15, 1.8);
      light.position.set(0, 0.9, 0.4);
      lGroup.add(light);

      root.add(lGroup);
      return light;
    };

    const lanternLightLeft = buildOilLantern(-3.2, 0.55, -13.2, 0.92);
    const lanternLightRight = buildOilLantern(3.4, 1.25, -14.8, 0.76);

    return {
      root,
      lanternLightLeft,
      lanternLightRight,
      watchSecondHand: watchSecondPivot,
    };
  }

  /**
   * Dedicated 4×4 Studio Inspection Plinth (`INSPECT_16` camera mode) showcasing all
   * 15 Metallic Rank Insignias on Navy Wedges + the 16th Attack Medallion in exact
   * `ref_rank_symbols_4x4.jpg` 4×4 grid order, plus a 4-angle Piece Turnaround row above!
   */
  public createInspectionGalleryStage(): THREE.Group {
    const stage = new THREE.Group();
    stage.position.copy(INSPECT_STAGE_ORIGIN);

    // Full studio table mat under & behind the inspection plinth so zero black background split appears!
    const studioFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      this.materials.walnut
    );
    studioFloor.rotation.x = -Math.PI / 2;
    studioFloor.position.set(0, -0.28, -2.0);
    stage.add(studioFloor);

    // Wide matte slate & walnut backing board so zero dark void shows at any corner in 412x915!
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(6.6, 0.26, 8.8),
      this.materials.walnut
    );
    backing.position.set(0, -0.15, -0.25);
    backing.receiveShadow = true;
    stage.add(backing);

    const innerSlate = new THREE.Mesh(
      new THREE.BoxGeometry(6.1, 0.08, 8.3),
      this.materials.slateTile
    );
    innerSlate.position.set(0, -0.01, -0.25);
    innerSlate.receiveShadow = true;
    stage.add(innerSlate);

    // Top Row (`z = -3.05`): 4-Angle Command Wedge Turnaround matching `ref_piece_turnaround.jpg`!
    const turnaroundAngles = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
    turnaroundAngles.forEach((ry, idx) => {
      const w = this.createCommandWedge('PLAYER', 'GEN_5');
      w.position.set((idx - 1.5) * 1.16, 0.03, -3.05);
      w.rotation.y = ry;
      stage.add(w);
    });

    // Lower 4×4 Grid (`z = -1.60 .. +2.12`): All 15 Rank Insignias + 16th Attack Medallion
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

    // 16th slot (col 3, row 3): Attack Medallion tilted cleanly toward macro camera
    const medHolder = new THREE.Group();
    medHolder.position.set(1.5 * 1.16, 0.34, -1.6 + 3 * 1.22);
    medHolder.rotation.x = 0.72;
    medHolder.add(this.createAttackMedallion());
    stage.add(medHolder);

    return stage;
  }
}
