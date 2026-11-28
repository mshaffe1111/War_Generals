import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ORDERED_RANKS, type RankId } from '../src/core/ranks';
import { buildRankEmblemMesh, type EmblemMaterialPalette } from '../src/graphics/EmblemFactory';
import { WEDGE_EMBLEM_MOUNT } from '../src/graphics/MeshFactory';
import {
  createBrushedMetalBumpMap,
  createSlateBumpMap,
  createStudioLanternEnvMap,
} from '../src/graphics/ProceduralTextures';

type CommanderKey = 'MILLER' | 'MERCER' | 'STERLING' | 'REYES' | 'VANCE' | 'HOLLIS';

interface StudioJobResult {
  readonly count: number;
}

function makeOctagonShape(radius: number, innerRadius?: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  if (innerRadius !== undefined) {
    const h = new THREE.Path();
    for (let i = 7; i >= 0; i--) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * innerRadius;
      const y = Math.sin(a) * innerRadius;
      if (i === 7) h.moveTo(x, y);
      else h.lineTo(x, y);
    }
    h.closePath();
    s.holes.push(h);
  }
  return s;
}

function createRoundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w * 0.5;
  const hh = h * 0.5;
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

function buildSculptedHeadGeometry(): THREE.BufferGeometry {
  // Anatomical multi-ring sculpted bust head with strong jawline, cheekbones, orbital brow, and chin
  const rings: Array<{ y: number; rx: number; rz: number; zOff: number; jawPinch: number; browBump: number }> = [
    { y: -0.25, rx: 0.115, rz: 0.125, zOff: -0.015, jawPinch: 0.1, browBump: 0.0 },
    { y: -0.20, rx: 0.135, rz: 0.165, zOff: 0.025, jawPinch: 0.36, browBump: 0.0 }, // chin & jaw base
    { y: -0.11, rx: 0.168, rz: 0.195, zOff: 0.022, jawPinch: 0.28, browBump: 0.0 }, // lower jaw
    { y: -0.02, rx: 0.188, rz: 0.212, zOff: 0.018, jawPinch: 0.16, browBump: 0.015 }, // cheekbones & mid-nose
    { y: 0.06, rx: 0.192, rz: 0.218, zOff: 0.015, jawPinch: 0.1, browBump: 0.032 }, // brow ridge
    { y: 0.14, rx: 0.190, rz: 0.215, zOff: 0.004, jawPinch: 0.0, browBump: 0.01 }, // forehead
    { y: 0.23, rx: 0.155, rz: 0.180, zOff: -0.01, jawPinch: 0.0, browBump: 0.0 },
    { y: 0.29, rx: 0.075, rz: 0.095, zOff: -0.015, jawPinch: 0.0, browBump: 0.0 },
  ];
  const segs = 36;
  const positions: number[] = [];
  const indices: number[] = [];

  for (const rg of rings) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const sinA = Math.sin(a);
      const cosA = Math.cos(a);
      // Forward face is +Z (sinA > 0)
      const fwd = Math.max(0, sinA);
      const noseRidge = Math.pow(fwd, 12) * (rg.y >= -0.08 && rg.y <= 0.07 ? 0.048 : 0.0);
      const brow = Math.pow(fwd, 3) * rg.browBump;
      const eyeSocket =
        rg.y >= -0.01 && rg.y <= 0.04
          ? -Math.exp(-Math.pow((Math.abs(cosA) - 0.36) / 0.14, 2)) * fwd * 0.022
          : 0.0;
      const jawTaper = 1.0 - rg.jawPinch * Math.pow(fwd, 2) * (1.0 - Math.abs(cosA) * 0.5);
      const x = cosA * rg.rx * jawTaper;
      const z = rg.zOff + sinA * rg.rz + noseRidge + brow + eyeSocket;
      positions.push(x, rg.y, z);
    }
  }
  const botIdx = positions.length / 3;
  positions.push(0, -0.26, -0.015);
  const topIdx = positions.length / 3;
  positions.push(0, 0.31, -0.015);

  for (let i = 0; i < segs; i++) {
    const ni = (i + 1) % segs;
    indices.push(botIdx, ni, i);
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const o0 = r * segs;
    const o1 = (r + 1) * segs;
    for (let i = 0; i < segs; i++) {
      const ni = (i + 1) % segs;
      indices.push(o0 + i, o0 + ni, o1 + ni, o0 + i, o1 + ni, o1 + i);
    }
  }
  const lastO = (rings.length - 1) * segs;
  for (let i = 0; i < segs; i++) {
    const ni = (i + 1) % segs;
    indices.push(topIdx, lastO + i, lastO + ni);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function buildCommanderBustDiorama(
  id: CommanderKey,
  accentHex: string,
  palette: EmblemMaterialPalette,
  metalBump: THREE.Texture,
  slateBump: THREE.Texture
): THREE.Group {
  const root = new THREE.Group();
  const accent = new THREE.Color(accentHex);

  const uniformColorMap: Record<CommanderKey, string> = {
    MILLER: '#182b4a',
    MERCER: '#142d3e',
    STERLING: '#2d3028',
    REYES: '#1d162a',
    VANCE: '#2d181e',
    HOLLIS: '#161b26',
  };

  // Sculpted Museum Cast-Bronze / Brushed-Pewter Bust Material (rich warm metallic sculpture, never flat black!)
  const bustBronzeMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(id === 'MERCER' || id === 'REYES' ? '#9ea8b8' : '#b8945e'),
    metalness: 0.78,
    roughness: 0.32,
    bumpMap: metalBump,
    bumpScale: 0.003,
    clearcoat: 0.14,
    clearcoatRoughness: 0.28,
    envMapIntensity: 0.95,
  });

  const tunicMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(uniformColorMap[id]),
    roughness: 0.5,
    metalness: 0.16,
    bumpMap: slateBump,
    bumpScale: 0.004,
    sheen: 0.5,
    sheenColor: accent.clone().multiplyScalar(0.9),
    envMapIntensity: 0.36,
  });

  const frameSlateMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0c1118'),
    roughness: 0.65,
    metalness: 0.25,
    bumpMap: slateBump,
    bumpScale: 0.006,
  });

  const accentGlowMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 1.65,
    roughness: 0.2,
    metalness: 0.4,
    toneMapped: false,
  });

  // 1. Chamfered Octagonal Studio Shadow-Box Frame & Recessed Backdrop
  const backPlateGeo = new THREE.ExtrudeGeometry(makeOctagonShape(1.42), {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  const backPlate = new THREE.Mesh(backPlateGeo, frameSlateMat);
  backPlate.position.z = -0.45;
  backPlate.receiveShadow = true;
  root.add(backPlate);

  const bezelGeo = new THREE.ExtrudeGeometry(makeOctagonShape(1.44, 1.24), {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 3,
  });
  const bezel = new THREE.Mesh(bezelGeo, palette.brass);
  bezel.position.z = -0.34;
  bezel.castShadow = true;
  root.add(bezel);

  const innerRingGeo = new THREE.TorusGeometry(0.95, 0.016, 12, 48);
  const innerRing = new THREE.Mesh(innerRingGeo, palette.brassRecessed);
  innerRing.position.set(0, 0.05, -0.32);
  root.add(innerRing);

  const accentArcGeo = new THREE.TorusGeometry(1.03, 0.012, 10, 48, Math.PI * 0.72);
  const accentArc = new THREE.Mesh(accentArcGeo, accentGlowMat);
  accentArc.position.set(0, 0.05, -0.31);
  accentArc.rotation.z = Math.PI * 0.14;
  root.add(accentArc);

  // 2. Sculpted Officer Bust Torso, Collar, Epaulets & Anatomical Sculpted Head
  const bust = new THREE.Group();
  bust.position.set(0, -0.94, 0.04);
  bust.scale.setScalar(1.2);

  const torsoPts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.78, 0.0),
    new THREE.Vector2(0.76, 0.24),
    new THREE.Vector2(0.68, 0.44),
    new THREE.Vector2(0.42, 0.56),
    new THREE.Vector2(0.22, 0.62),
    new THREE.Vector2(0.18, 0.72),
    new THREE.Vector2(0.0, 0.74),
  ];
  const torsoGeo = new THREE.LatheGeometry(torsoPts, 32);
  torsoGeo.scale(1.06, 1.0, 0.56);
  const torso = new THREE.Mesh(torsoGeo, tunicMat);
  torso.castShadow = true;
  torso.receiveShadow = true;
  bust.add(torso);

  // Tailored High Collar + Lapels + Sculpted Chest Breastplate Sash
  const collarGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.2, 0.58),
      new THREE.Vector2(0.23, 0.66),
      new THREE.Vector2(0.22, 0.77),
      new THREE.Vector2(0.18, 0.78),
    ],
    24
  );
  collarGeo.scale(1.02, 1.0, 0.92);
  const collar = new THREE.Mesh(collarGeo, tunicMat);
  bust.add(collar);

  const lapelGeo = new THREE.ExtrudeGeometry(createRoundedRect(0.16, 0.34, 0.025), {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  for (const dir of [-1, 1] as const) {
    const lapel = new THREE.Mesh(lapelGeo, tunicMat);
    lapel.position.set(dir * 0.14, 0.44, 0.25);
    lapel.rotation.set(-0.26, dir * 0.2, -dir * 0.32);
    bust.add(lapel);

    const ep = new THREE.Mesh(
      new THREE.ExtrudeGeometry(createRoundedRect(0.28, 0.13, 0.03), {
        depth: 0.03,
        bevelEnabled: true,
        bevelThickness: 0.01,
        bevelSize: 0.01,
        bevelSegments: 2,
      }),
      palette.brass
    );
    ep.position.set(dir * 0.5, 0.53, 0.0);
    ep.rotation.set(-Math.PI / 2 + 0.1, 0, -dir * 0.24);
    ep.castShadow = true;
    bust.add(ep);
  }

  // Sculpted Anatomical Bronze/Pewter Head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.98, 0.03);

  const cranium = new THREE.Mesh(buildSculptedHeadGeometry(), bustBronzeMat);
  cranium.castShadow = true;
  cranium.receiveShadow = true;
  headGroup.add(cranium);

  // 3. Per-Commander Signature 3D Headgear, Optics & Chest Rank Hardware (seated flush on chest at z = 0.43+)
  if (id === 'MILLER') {
    const capCrown = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.195, 0.0),
          new THREE.Vector2(0.215, 0.08),
          new THREE.Vector2(0.275, 0.21),
          new THREE.Vector2(0.0, 0.24),
        ],
        28
      ),
      tunicMat
    );
    capCrown.position.set(0, 0.11, 0.0);
    capCrown.rotation.x = -0.14;
    headGroup.add(capCrown);

    const visor = new THREE.Mesh(
      new THREE.ExtrudeGeometry(createRoundedRect(0.3, 0.15, 0.07), {
        depth: 0.016,
        bevelEnabled: true,
        bevelThickness: 0.006,
        bevelSize: 0.006,
        bevelSegments: 2,
      }),
      palette.contactShadow
    );
    visor.rotation.x = Math.PI / 2 + 0.18;
    visor.position.set(0, 0.12, 0.17);
    headGroup.add(visor);

    const capStar = buildRankEmblemMesh('GEN_1', palette);
    capStar.scale.setScalar(0.26);
    capStar.position.set(0, 0.22, 0.24);
    headGroup.add(capStar);

    const chestEmblem = buildRankEmblemMesh('PRIVATE', palette);
    chestEmblem.scale.setScalar(0.68);
    chestEmblem.position.set(0, 0.26, 0.415);
    chestEmblem.rotation.x = -0.22;
    bust.add(chestEmblem);
  } else if (id === 'MERCER') {
    const capCrown = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.195, 0.0),
          new THREE.Vector2(0.22, 0.08),
          new THREE.Vector2(0.29, 0.21),
          new THREE.Vector2(0.0, 0.23),
        ],
        28
      ),
      tunicMat
    );
    capCrown.position.set(0, 0.11, 0.0);
    capCrown.rotation.x = -0.12;
    headGroup.add(capCrown);

    const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.018, 10, 32), palette.silver);
    band.rotation.x = Math.PI / 2 - 0.12;
    band.position.set(0, 0.12, 0.01);
    headGroup.add(band);

    for (const gx of [-0.075, 0.075]) {
      const goggleRim = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.015, 12, 24), palette.brass);
      goggleRim.position.set(gx, 0.045, 0.228);
      headGroup.add(goggleRim);

      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.048, 20), accentGlowMat);
      lens.position.set(gx, 0.045, 0.23);
      headGroup.add(lens);
    }

    const chestEmblem = buildRankEmblemMesh('CAPTAIN', palette);
    chestEmblem.scale.setScalar(0.7);
    chestEmblem.position.set(0, 0.26, 0.42);
    chestEmblem.rotation.x = -0.22;
    bust.add(chestEmblem);
  } else if (id === 'STERLING') {
    const helmet = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.265, -0.02),
          new THREE.Vector2(0.255, 0.02),
          new THREE.Vector2(0.235, 0.14),
          new THREE.Vector2(0.195, 0.25),
          new THREE.Vector2(0.0, 0.30),
        ],
        32
      ),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#3b4036'),
        metalness: 0.65,
        roughness: 0.38,
        bumpMap: metalBump,
        bumpScale: 0.005,
      })
    );
    helmet.position.set(0, 0.07, 0.0);
    helmet.scale.set(1.0, 1.0, 1.08);
    headGroup.add(helmet);

    const gorget = new THREE.Mesh(
      new THREE.ExtrudeGeometry(createRoundedRect(0.64, 0.2, 0.07), {
        depth: 0.14,
        bevelEnabled: true,
        bevelThickness: 0.022,
        bevelSize: 0.018,
        bevelSegments: 3,
      }),
      palette.brassRecessed
    );
    gorget.position.set(0, 0.42, 0.22);
    gorget.rotation.x = -0.35;
    bust.add(gorget);

    const chestEmblem = buildRankEmblemMesh('MAJOR', palette);
    chestEmblem.scale.setScalar(0.72);
    chestEmblem.position.set(0, 0.26, 0.43);
    chestEmblem.rotation.x = -0.22;
    bust.add(chestEmblem);
  } else if (id === 'REYES') {
    const beret = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.205, 0.0),
          new THREE.Vector2(0.265, 0.07),
          new THREE.Vector2(0.255, 0.16),
          new THREE.Vector2(0.0, 0.19),
        ],
        28
      ),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#27183c'),
        roughness: 0.88,
        sheen: 0.7,
        sheenColor: accent,
      })
    );
    beret.position.set(0.05, 0.13, 0.01);
    beret.rotation.set(-0.1, 0.0, -0.32);
    headGroup.add(beret);

    const flash = buildRankEmblemMesh('COLONEL', palette);
    flash.scale.setScalar(0.3);
    flash.position.set(-0.07, 0.2, 0.215);
    headGroup.add(flash);

    const chestEmblem = buildRankEmblemMesh('SPY', palette);
    chestEmblem.scale.setScalar(0.75);
    chestEmblem.position.set(0, 0.26, 0.42);
    chestEmblem.rotation.x = -0.22;
    bust.add(chestEmblem);
  } else if (id === 'VANCE') {
    const tankerShell = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.235, -0.05),
          new THREE.Vector2(0.24, 0.12),
          new THREE.Vector2(0.185, 0.24),
          new THREE.Vector2(0.0, 0.28),
        ],
        28
      ),
      palette.brassRecessed
    );
    tankerShell.position.set(0, 0.07, 0.0);
    headGroup.add(tankerShell);

    for (const dir of [-1, 1] as const) {
      const earPod = new THREE.Mesh(
        new THREE.LatheGeometry(
          [
            new THREE.Vector2(0.0, 0.0),
            new THREE.Vector2(0.085, 0.02),
            new THREE.Vector2(0.085, 0.06),
            new THREE.Vector2(0.0, 0.07),
          ],
          18
        ),
        palette.brass
      );
      earPod.rotation.z = dir * (Math.PI / 2);
      earPod.position.set(dir * 0.215, 0.02, 0.0);
      headGroup.add(earPod);
    }

    for (const gx of [-0.075, 0.075]) {
      const gRim = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.015, 12, 24), palette.brass);
      gRim.position.set(gx, 0.15, 0.252);
      gRim.rotation.x = -0.18;
      headGroup.add(gRim);
    }

    const chestEmblem = buildRankEmblemMesh('SERGEANT', palette);
    chestEmblem.scale.setScalar(0.76);
    chestEmblem.position.set(0, 0.26, 0.42);
    chestEmblem.rotation.x = -0.22;
    bust.add(chestEmblem);
  } else {
    const cap = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.2, 0.0),
          new THREE.Vector2(0.23, 0.1),
          new THREE.Vector2(0.32, 0.23),
          new THREE.Vector2(0.0, 0.26),
        ],
        32
      ),
      tunicMat
    );
    cap.position.set(0, 0.12, 0.0);
    cap.rotation.x = -0.15;
    headGroup.add(cap);

    const goldBand = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.02, 12, 32), palette.brass);
    goldBand.rotation.x = Math.PI / 2 - 0.15;
    goldBand.position.set(0, 0.135, 0.01);
    headGroup.add(goldBand);

    const visor = new THREE.Mesh(
      new THREE.ExtrudeGeometry(createRoundedRect(0.32, 0.16, 0.075), {
        depth: 0.018,
        bevelEnabled: true,
        bevelThickness: 0.007,
        bevelSize: 0.007,
        bevelSegments: 2,
      }),
      palette.brass
    );
    visor.rotation.x = Math.PI / 2 + 0.2;
    visor.position.set(0, 0.115, 0.18);
    headGroup.add(visor);

    const monocle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 10, 24), palette.brass);
    monocle.position.set(0.075, 0.025, 0.235);
    headGroup.add(monocle);

    const capCrest = buildRankEmblemMesh('GEN_5', palette);
    capCrest.scale.setScalar(0.28);
    capCrest.position.set(0, 0.23, 0.24);
    headGroup.add(capCrest);

    const chestEmblem = buildRankEmblemMesh('GEN_5', palette);
    chestEmblem.scale.setScalar(0.8);
    chestEmblem.position.set(0, 0.26, 0.425);
    chestEmblem.rotation.x = -0.22;
    bust.add(chestEmblem);
  }

  bust.add(headGroup);
  root.add(bust);
  return root;
}

async function main(): Promise<void> {
  const statusEl = document.getElementById('status')!;
  const size = 1024;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = createStudioLanternEnvMap(renderer);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size, size), 0.22, 0.3, 1.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const keyLight = new THREE.DirectionalLight('#ffe4bc', 3.4);
  keyLight.position.set(-3.2, 4.4, 4.8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0002;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#8ab8e8', 1.15);
  fillLight.position.set(3.5, 1.8, 3.6);
  scene.add(fillLight);

  const rimLight = new THREE.SpotLight('#ffb85e', 5.2, 20, Math.PI / 3, 0.65, 1.0);
  rimLight.position.set(2.4, 3.2, -3.4);
  scene.add(rimLight, rimLight.target);

  const hemi = new THREE.HemisphereLight('#7894b8', '#14110e', 0.65);
  scene.add(hemi);

  const metalBump = createBrushedMetalBumpMap(256);
  const slateBump = createSlateBumpMap(256);

  const palette: EmblemMaterialPalette = {
    brass: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#E8B95B'),
      emissive: new THREE.Color('#4d330c'),
      emissiveIntensity: 0.26,
      metalness: 0.78,
      roughness: 0.26,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.14,
      envMapIntensity: 0.95,
    }),
    silver: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#CFD8E4'),
      metalness: 0.9,
      roughness: 0.24,
      bumpMap: metalBump,
      bumpScale: 0.004,
      clearcoat: 0.12,
      envMapIntensity: 0.88,
    }),
    brassRecessed: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#8E6622'),
      metalness: 0.86,
      roughness: 0.36,
      bumpMap: metalBump,
      bumpScale: 0.006,
      envMapIntensity: 0.72,
    }),
    contactShadow: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#06080d'),
      roughness: 0.92,
      metalness: 0.04,
    }),
  };

  const stageRoot = new THREE.Group();
  scene.add(stageRoot);

  const gltfLoader = new GLTFLoader();
  const wedgeGltf = await gltfLoader.loadAsync('/models/command_wedge.glb');

  const savePng = async (outRelPath: string, renderSize: number) => {
    renderer.setSize(renderSize, renderSize, false);
    composer.setSize(renderSize, renderSize);
    bloom.setSize(renderSize, renderSize);
    composer.render();
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const resp = await fetch(`/save?name=${encodeURIComponent(outRelPath)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: dataUrl,
    });
    if (!resp.ok) throw new Error(`Failed saving ${outRelPath}: ${resp.status}`);
  };

  let count = 0;

  // --- 1. Render 6 Commander Portraits (`1024x1024` -> `public/portraits/*.webp` @ 512x512) ---
  const commanders: Array<{ key: CommanderKey; file: string; accent: string }> = [
    { key: 'MILLER', file: 'miller', accent: '#7cc6fe' },
    { key: 'MERCER', file: 'mercer', accent: '#5ce1e6' },
    { key: 'STERLING', file: 'sterling', accent: '#e5b968' },
    { key: 'REYES', file: 'reyes', accent: '#c77dff' },
    { key: 'VANCE', file: 'vance', accent: '#ff6b7a' },
    { key: 'HOLLIS', file: 'hollis', accent: '#ffd166' },
  ];

  scene.background = new THREE.Color('#080b11');
  camera.fov = 33;
  camera.updateProjectionMatrix();
  camera.position.set(0.18, 0.16, 4.95);
  camera.lookAt(0, -0.02, 0);

  const includePortraits = Boolean(
    (window as unknown as { __STUDIO_INCLUDE_PORTRAITS__?: boolean }).__STUDIO_INCLUDE_PORTRAITS__
  );
  if (includePortraits) {
    for (const cmd of commanders) {
      stageRoot.clear();
      rimLight.color.set(cmd.accent);
      rimLight.intensity = 6.2;
      const diorama = buildCommanderBustDiorama(cmd.key, cmd.accent, palette, metalBump, slateBump);
      diorama.rotation.y = -0.06;
      stageRoot.add(diorama);
      await savePng(`portraits/${cmd.file}.png`, 1024);
      count += 1;
    }
  }

  // --- 2. Render 16 Rank Chips (`512x512` -> `public/ranks/*.webp` @ 256x256) ---
  const navyPlinthMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0d1d3b'),
    roughness: 0.38,
    metalness: 0.12,
    bumpMap: slateBump,
    bumpScale: 0.004,
    clearcoat: 0.25,
  });
  const crimsonMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#661524'),
    roughness: 0.36,
    metalness: 0.08,
    bumpMap: slateBump,
    bumpScale: 0.003,
    clearcoat: 0.2,
  });
  const bronzeMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#C99242'),
    metalness: 0.72,
    roughness: 0.3,
    bumpMap: metalBump,
    bumpScale: 0.004,
  });

  scene.background = new THREE.Color('#070b12');
  rimLight.color.set('#f5c060');
  rimLight.intensity = 4.6;

  for (const rankId of ORDERED_RANKS) {
    stageRoot.clear();
    camera.fov = 28;
    camera.updateProjectionMatrix();
    camera.position.set(0, -0.16, 1.38);
    camera.lookAt(0, 0, 0);

    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(makeOctagonShape(0.285, 0.255), {
        depth: 0.032,
        bevelEnabled: true,
        bevelThickness: 0.008,
        bevelSize: 0.007,
        bevelSegments: 3,
      }),
      palette.brass
    );
    frame.position.z = -0.022;
    stageRoot.add(frame);

    const backPlate = new THREE.Mesh(
      new THREE.ExtrudeGeometry(makeOctagonShape(0.268), {
        depth: 0.02,
        bevelEnabled: false,
      }),
      navyPlinthMat
    );
    backPlate.position.z = -0.026;
    backPlate.receiveShadow = true;
    stageRoot.add(backPlate);

    const emblem = buildRankEmblemMesh(rankId, palette);
    emblem.scale.setScalar(rankId === 'COLONEL' ? 0.88 : 0.96);
    emblem.position.z = 0.004;
    stageRoot.add(emblem);

    await savePng(`ranks/${rankId}.png`, 512);
    count += 1;
  }

  // UNKNOWN chip: 180-deg armored crimson rear silhouette of F7 command_wedge.glb
  stageRoot.clear();
  camera.fov = 30;
  camera.updateProjectionMatrix();
  camera.position.set(0.24, 0.64, 1.92);
  camera.lookAt(0, 0.36, 0);
  rimLight.color.set('#ff4d63');
  rimLight.intensity = 5.4;

  const unknownWedge = wedgeGltf.scene.clone(true);
  unknownWedge.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.name.includes('BrassPlinth')) obj.material = bronzeMat;
    else if (obj.name.includes('Escutcheon')) obj.material = palette.contactShadow;
    else obj.material = crimsonMat;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  unknownWedge.rotation.y = Math.PI - 0.16;
  stageRoot.add(unknownWedge);
  await savePng('ranks/UNKNOWN.png', 512);
  count += 1;

  // --- 3. Render PWA Icon (`1024x1024` -> `public/icon-512.png` & `public/icon-192.png`) ---
  stageRoot.clear();
  scene.background = new THREE.Color('#090d14');
  rimLight.color.set('#ffb84d');
  rimLight.intensity = 5.8;
  camera.fov = 30;
  camera.updateProjectionMatrix();
  camera.position.set(0.45, 0.85, 1.85);
  camera.lookAt(0, 0.34, 0.04);

  const iconPlinth = new THREE.Mesh(
    new THREE.ExtrudeGeometry(makeOctagonShape(0.68), {
      depth: 0.075,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.018,
      bevelSegments: 3,
    }),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#3b2416'),
      roughness: 0.34,
      clearcoat: 0.4,
    })
  );
  iconPlinth.rotation.x = -Math.PI / 2;
  iconPlinth.position.y = -0.085;
  iconPlinth.receiveShadow = true;
  stageRoot.add(iconPlinth);

  const iconBrassRing = new THREE.Mesh(
    new THREE.ExtrudeGeometry(makeOctagonShape(0.64, 0.59), {
      depth: 0.025,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
    }),
    palette.brass
  );
  iconBrassRing.rotation.x = -Math.PI / 2;
  iconBrassRing.position.y = -0.005;
  stageRoot.add(iconBrassRing);

  const heroWedge = wedgeGltf.scene.clone(true);
  heroWedge.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.name.includes('BrassPlinth')) obj.material = palette.brass;
    else if (obj.name.includes('Escutcheon')) obj.material = palette.contactShadow;
    else obj.material = navyPlinthMat;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  const fiveStar = buildRankEmblemMesh('GEN_5', palette);
  fiveStar.scale.setScalar(WEDGE_EMBLEM_MOUNT.scale);
  fiveStar.position.set(0, WEDGE_EMBLEM_MOUNT.y, WEDGE_EMBLEM_MOUNT.z);
  fiveStar.rotation.x = WEDGE_EMBLEM_MOUNT.rotXRad;
  heroWedge.add(fiveStar);
  heroWedge.rotation.y = -0.22;
  heroWedge.scale.setScalar(1.06);
  stageRoot.add(heroWedge);

  await savePng('icon.png', 1024);
  count += 1;

  const result: StudioJobResult = { count };
  statusEl.textContent = `DONE:${result.count}`;
  (window as unknown as { __STUDIO_DONE__?: StudioJobResult }).__STUDIO_DONE__ = result;
}

main().catch((err) => {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = `ERROR:${String(err)}`;
  console.error(err);
});
