import * as THREE from 'three';
import type { SoundDirector } from '../audio/SoundDirector';
import { buildRankEmblemMesh } from '../graphics/EmblemFactory';
import type { ArbiterVerdict, BattleChoreographyKind, HudBannerState } from '../core/types';
import {
  ARBITER_BAY_CENTER_Z,
  type BakedArbiterHardwareParts,
  gridToWorld,
  type MeshFactory,
  WEDGE_EMBLEM_MOUNT,
} from '../graphics/MeshFactory';
import {
  type ChoreographyVisualProfile,
  computeChoreographyTimeline,
  computeFlagTraverseMarchPose,
  resolveBattleChoreographyProfile,
  resolveChoreographyLockBanner,
} from './BattleChoreographies';

const BASTION_X = 1.34;
const BASTION_Z = 0.12;
const BASTION_SURFACE_Y = -0.085;

export interface BattleCameraShot {
  readonly pos: THREE.Vector3;
  readonly look: THREE.Vector3;
  readonly fov: number;
  readonly dampSpeed: number;
  readonly roomDim: number;
  readonly redAlertGlow: number;
}

interface PlumeBillow {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  readonly offset: THREE.Vector3;
  readonly driftVel: THREE.Vector3;
  readonly baseScale: number;
  readonly phaseDelay: number;
}

interface ShrapnelItem {
  readonly mesh: THREE.Mesh;
  readonly origin: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly spin: THREE.Vector3;
  active: boolean;
}

interface TracerBolt {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  readonly fromLeft: boolean;
  readonly yOff: number;
  readonly zOff: number;
  readonly phaseOffset: number;
}

// ---------------------------------------------------------------------------
// Sculpted PBR & Shader Geometry Builders (Zero Raw Primitives / Unlit Materials)
// ---------------------------------------------------------------------------

function createRoundedRectShape(w: number, h: number, radius: number): THREE.Shape {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const r = Math.min(radius, hw * 0.45, hh * 0.45);
  const s = new THREE.Shape();
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

function createBeveledSlabGeo(
  w: number,
  h: number,
  d: number,
  radius = 0.014,
  bevel = 0.008
): THREE.ExtrudeGeometry {
  const b = Math.min(bevel, h * 0.35, w * 0.15, d * 0.15);
  const innerDepth = Math.max(0.004, h - b * 2);
  const shape = createRoundedRectShape(Math.max(0.01, w - b * 2), Math.max(0.01, d - b * 2), radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerDepth,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function createBeveledRingGeo(
  outerR: number,
  innerR: number,
  depth = 0.014,
  bevel = 0.004,
  curveSegs = 40
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, Math.max(0.01, innerR), 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: curveSegs,
  });
  geo.rotateX(-Math.PI / 2);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function createHexShieldRingGeo(
  outerR: number,
  innerR: number,
  depth = 0.022,
  bevel = 0.007
): THREE.ExtrudeGeometry {
  const sides = 8;
  const shape = new THREE.Shape();
  const hole = new THREE.Path();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / 8;
    const ox = Math.cos(a) * outerR;
    const oy = Math.sin(a) * outerR;
    if (i === 0) shape.moveTo(ox, oy);
    else shape.lineTo(ox, oy);
  }
  shape.closePath();

  for (let i = sides - 1; i >= 0; i--) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / 8;
    const ix = Math.cos(a) * innerR;
    const iy = Math.sin(a) * innerR;
    if (i === sides - 1) hole.moveTo(ix, iy);
    else hole.lineTo(ix, iy);
  }
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function createCenteredQuadGeo(w: number, h: number): THREE.BufferGeometry {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const positions = new Float32Array([
    -hw, -hh, 0,
     hw, -hh, 0,
     hw,  hh, 0,
    -hw,  hh, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

function createCenteredDiscGeo(radius: number, segs = 32): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * radius, 0, s * radius);
    normals.push(0, 1, 0);
    uvs.push(0.5 + c * 0.5, 0.5 + s * 0.5);
    if (i > 0) {
      indices.push(0, i, i + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function createCurvedPhosphorGeo(
  w: number,
  h: number,
  segX = 14,
  segY = 6,
  bulge = 0.018
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let iy = 0; iy <= segY; iy++) {
    const v = iy / segY;
    const py = (v - 0.5) * h;
    const curveV = Math.cos((v - 0.5) * Math.PI * 0.8);
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const px = (u - 0.5) * w;
      const curveU = Math.cos((u - 0.5) * Math.PI * 0.85);
      const pz = bulge * curveU * curveV;
      positions.push(px, py, pz);
      uvs.push(u, v);
    }
  }
  const row = segX + 1;
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createCrtBezelFrameGeo(
  outerW: number,
  outerH: number,
  innerW: number,
  innerH: number,
  depth = 0.085,
  bevel = 0.016
): THREE.ExtrudeGeometry {
  const outer = createRoundedRectShape(outerW, outerH, 0.042);
  const hw = innerW * 0.5;
  const hh = innerH * 0.5;
  const r = 0.022;
  const hole = new THREE.Path();
  hole.moveTo(-hw + r, -hh);
  hole.lineTo(-hw, -hh + r);
  hole.lineTo(-hw, hh - r);
  hole.lineTo(-hw + r, hh);
  hole.lineTo(hw - r, hh);
  hole.lineTo(hw, hh - r);
  hole.lineTo(hw, -hh + r);
  hole.lineTo(hw - r, -hh);
  hole.closePath();
  outer.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(outer, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function createCrtVisorAwningGeo(width: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.08, -0.02);
  s.lineTo(0.08, -0.045);
  s.lineTo(0.08, 0.01);
  s.lineTo(-0.08, 0.03);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  geo.rotateY(Math.PI / 2);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function createRotaryDialGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.036, 0.0),
    new THREE.Vector2(0.036, 0.012),
    new THREE.Vector2(0.028, 0.016),
    new THREE.Vector2(0.028, 0.03),
    new THREE.Vector2(0.022, 0.035),
    new THREE.Vector2(0.0, 0.035),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createRivetGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.014, 0.0),
    new THREE.Vector2(0.014, 0.006),
    new THREE.Vector2(0.009, 0.012),
    new THREE.Vector2(0.0, 0.013),
  ];
  const geo = new THREE.LatheGeometry(pts, 12);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createTubeSocketGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.052, 0.0),
    new THREE.Vector2(0.052, 0.012),
    new THREE.Vector2(0.045, 0.018),
    new THREE.Vector2(0.045, 0.034),
    new THREE.Vector2(0.038, 0.038),
    new THREE.Vector2(0.0, 0.038),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.computeVertexNormals();
  return geo;
}

function createTubeGlassGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.034, 0.0),
    new THREE.Vector2(0.037, 0.024),
    new THREE.Vector2(0.036, 0.178),
    new THREE.Vector2(0.031, 0.205),
    new THREE.Vector2(0.018, 0.222),
    new THREE.Vector2(0.007, 0.232),
    new THREE.Vector2(0.0, 0.235),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.computeVertexNormals();
  return geo;
}

function createTubeCapGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.028, 0.0),
    new THREE.Vector2(0.026, 0.012),
    new THREE.Vector2(0.016, 0.018),
    new THREE.Vector2(0.0, 0.02),
  ];
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.computeVertexNormals();
  return geo;
}

function createTubeFilamentGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, -0.085),
    new THREE.Vector2(0.021, -0.085),
    new THREE.Vector2(0.021, -0.068),
    new THREE.Vector2(0.015, -0.062),
    new THREE.Vector2(0.015, 0.062),
    new THREE.Vector2(0.02, 0.072),
    new THREE.Vector2(0.016, 0.085),
    new THREE.Vector2(0.0, 0.085),
  ];
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.translate(0, 0.085, 0);
  geo.computeVertexNormals();
  return geo;
}

function createGyroCoreGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, -0.068),
    new THREE.Vector2(0.035, -0.024),
    new THREE.Vector2(0.066, 0.0),
    new THREE.Vector2(0.035, 0.024),
    new THREE.Vector2(0.0, 0.068),
  ];
  const geo = new THREE.LatheGeometry(pts, 10);
  geo.computeVertexNormals();
  return geo;
}

function createSabotPenetratorGeo(): THREE.LatheGeometry {
  // Oriented along +X (nose at +0.16, tail at -0.14)
  const pts = [
    new THREE.Vector2(0.0, -0.14),
    new THREE.Vector2(0.018, -0.14),
    new THREE.Vector2(0.024, -0.08),
    new THREE.Vector2(0.024, 0.02),
    new THREE.Vector2(0.019, 0.075),
    new THREE.Vector2(0.009, 0.125),
    new THREE.Vector2(0.002, 0.16),
    new THREE.Vector2(0.0, 0.162),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.rotateZ(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createSabotDrivingBandGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.023, -0.055),
    new THREE.Vector2(0.03, -0.048),
    new THREE.Vector2(0.03, -0.022),
    new THREE.Vector2(0.023, -0.015),
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.rotateZ(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createSabotFinGeo(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.135, 0.016);
  s.lineTo(-0.078, 0.016);
  s.lineTo(-0.095, 0.056);
  s.lineTo(-0.138, 0.052);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.005,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -0.0025);
  geo.computeVertexNormals();
  return geo;
}

function createMachVaporConeGeo(): THREE.LatheGeometry {
  // Flared supersonic Prandtl-Glauert cone opening rearward along -X
  const pts = [
    new THREE.Vector2(0.032, 0.075),
    new THREE.Vector2(0.068, 0.025),
    new THREE.Vector2(0.115, -0.025),
    new THREE.Vector2(0.148, -0.065),
  ];
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.rotateZ(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createTaperedDartGeo(length = 0.4, radius = 0.015): THREE.LatheGeometry {
  const h = length * 0.5;
  const pts = [
    new THREE.Vector2(0.0, -h),
    new THREE.Vector2(radius * 0.55, -h * 0.55),
    new THREE.Vector2(radius, h * 0.45),
    new THREE.Vector2(radius * 0.65, h * 0.82),
    new THREE.Vector2(0.0, h),
  ];
  const geo = new THREE.LatheGeometry(pts, 10);
  geo.rotateZ(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createNeedleSparkGeo(length = 0.34, radius = 0.012): THREE.LatheGeometry {
  const h = length * 0.5;
  const pts = [
    new THREE.Vector2(0.0, -h),
    new THREE.Vector2(radius * 0.5, -h * 0.4),
    new THREE.Vector2(radius, h * 0.55),
    new THREE.Vector2(0.0, h),
  ];
  const geo = new THREE.LatheGeometry(pts, 8);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createArtilleryShellGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, -0.68),
    new THREE.Vector2(0.016, -0.45),
    new THREE.Vector2(0.048, 0.15),
    new THREE.Vector2(0.056, 0.42),
    new THREE.Vector2(0.036, 0.58),
    new THREE.Vector2(0.0, 0.68),
  ];
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.computeVertexNormals();
  return geo;
}

function createEnergyLanceGeo(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, -1.25),
    new THREE.Vector2(0.06, -1.05),
    new THREE.Vector2(0.088, 0.0),
    new THREE.Vector2(0.056, 1.05),
    new THREE.Vector2(0.0, 1.25),
  ];
  const geo = new THREE.LatheGeometry(pts, 16);
  geo.rotateZ(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createShrapnelPlateGeo(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.058, -0.032);
  s.lineTo(0.048, -0.042);
  s.lineTo(0.068, 0.018);
  s.lineTo(-0.014, 0.048);
  s.lineTo(-0.064, 0.012);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.018,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 1,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Custom ShaderMaterials
// ---------------------------------------------------------------------------

function createEnergyFadeShaderMaterial(
  rgb: THREE.Color,
  opacity = 1.0,
  additive = true,
  doubleSided = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: rgb.clone() },
      uOpacity: { value: opacity },
      uCoreBoost: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uCoreBoost;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float rim = 1.0 - abs(dot(n, v));
        float core = mix(0.75, 1.35, 1.0 - rim * 0.45) * uCoreBoost;
        float a = clamp(uOpacity, 0.0, 1.0);
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uColor * core, a);
      }
    `,
    transparent: true,
    depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    toneMapped: false,
  });
}

function createCrtPhosphorShaderMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vec3 tex = texture2D(uMap, vUv).rgb;
        float scan = 0.94 + 0.06 * sin(vUv.y * 190.0 + uTime * 3.0);
        vec2 c = (vUv - 0.5) * 2.0;
        float vig = clamp(1.0 - dot(c * vec2(0.55, 0.72), c * vec2(0.55, 0.72)) * 0.45, 0.58, 1.0);
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float fresnel = pow(1.0 - max(0.0, dot(n, v)), 3.2);
        vec3 glassTint = vec3(0.18, 0.24, 0.22) * fresnel * 0.42;
        gl_FragColor = vec4(tex * scan * vig + glassTint, 1.0);
      }
    `,
    toneMapped: false,
  });
}

function createReconLaserShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0.35, 2.45, 1.85) },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float pulse = 0.65 + 0.35 * sin(vUv.x * 24.0 - uTime * 14.0);
        float a = pulse * uOpacity;
        if (a <= 0.005) discard;
        gl_FragColor = vec4(uColor * (0.9 + 0.5 * pulse), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createTraverseBridgeShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(2.45, 1.92, 0.62) },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
      uDirection: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uDirection;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        float lane = abs(vLocalPos.z) / 0.16;
        float chevron = abs(fract((vLocalPos.x * uDirection * 2.2) - uTime * 2.6 + lane * 0.45) - 0.5) * 2.0;
        float stripe = smoothstep(0.45, 0.92, chevron);
        float edge = smoothstep(1.0, 0.72, lane);
        float a = (0.28 + 0.72 * stripe) * edge * uOpacity;
        if (a <= 0.005) discard;
        gl_FragColor = vec4(uColor * (0.85 + 0.85 * stripe), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createWarfieldExplosionPlumeMaterial(
  seed: number,
  isSmokeLayer = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPhase: { value: 0.0 },
      uSeed: { value: seed },
      uTime: { value: 0.0 },
      uSmokeOnly: { value: isSmokeLayer ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float scaleX = length(vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]));
        float scaleY = length(vec3(modelMatrix[1][0], modelMatrix[1][1], modelMatrix[1][2]));
        mvCenter.xy += position.xy * vec2(scaleX, scaleY);
        gl_Position = projectionMatrix * mvCenter;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPhase;
      uniform float uSeed;
      uniform float uTime;
      uniform float uSmokeOnly;
      varying vec2 vUv;

      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7) + uSeed * 13.7);
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.54;
        for (int i = 0; i < 3; i++) {
          v += a * vnoise(p);
          p = p * 2.07 + vec2(1.7, -2.3);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float turb = fbm(p * 3.1 + vec2(0.0, -uTime * 2.1));
        float eroded = 1.0 - r - (turb - 0.45) * 0.72;
        float mask = smoothstep(0.0, 0.34, eroded);
        if (mask <= 0.005) discard;

        if (uSmokeOnly > 0.5) {
          float underRim = clamp((0.5 - vUv.y) * 1.4, 0.0, 1.0) * (1.0 - uPhase);
          vec3 darkSoot = vec3(0.022, 0.021, 0.025) + 0.042 * turb + vec3(0.32, 0.09, 0.02) * underRim * turb;
          float sFade = smoothstep(1.0, 0.55, uPhase);
          gl_FragColor = vec4(darkSoot, mask * sFade * 0.92);
          return;
        }

        float coreMask = pow(clamp(1.0 - r * 1.25, 0.0, 1.0), 2.1);
        float heat = clamp((1.0 - uPhase * 1.45) * (0.3 + 0.9 * turb * coreMask) + coreMask * (0.48 - uPhase * 0.55), 0.0, 1.2);

        vec3 sootCol = vec3(0.024, 0.022, 0.026) + 0.04 * turb;
        vec3 magmaRed = vec3(0.92, 0.14, 0.02);
        vec3 fireOrange = vec3(1.62, 0.58, 0.07);
        vec3 flashCore = vec3(2.35, 1.68, 0.6);

        vec3 col = sootCol;
        col = mix(col, magmaRed, smoothstep(0.26, 0.5, heat));
        col = mix(col, fireOrange, smoothstep(0.5, 0.8, heat));
        col = mix(col, flashCore, smoothstep(0.8, 1.08, heat));

        float fadeOut = smoothstep(1.0, 0.58, uPhase);
        float alpha = mask * fadeOut * 0.94;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function createShockwaveRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0.0 },
      uColor: { value: new THREE.Color(2.4, 1.45, 0.45) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length((vUv - 0.5) * 2.0);
        float ringR = mix(0.08, 0.96, pow(uProgress, 0.62));
        float band = exp(-pow((r - ringR) / 0.085, 2.0));
        float fade = pow(clamp(1.0 - uProgress, 0.0, 1.0), 1.45);
        float a = band * fade;
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor * a * 1.4, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createGaussianLightShaftMaterial(rgb: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: rgb.clone() },
      uOpacity: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float xNorm = (vUv.x - 0.5) * 2.0;
        float spread = mix(0.36, 1.0, vUv.y);
        float xs = xNorm / spread;
        float horiz = exp(-xs * xs * 4.2) * smoothstep(1.0, 0.68, abs(xNorm));
        float vert = smoothstep(0.0, 0.08, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.35);
        float a = horiz * vert * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * Sculpted 3D War Cinema & 6-Choreography Electronic Arbiter Stage (`ArbiterStage3D.ts`)
 */
export class ArbiterStage3D {
  public readonly root = new THREE.Group();
  public readonly worldMedallionGroup = new THREE.Group();

  private readonly factory: MeshFactory;
  private readonly sound: SoundDirector;

  private readonly arenaMount = new THREE.Group();
  private readonly leftBastionRingMat: THREE.ShaderMaterial;
  private readonly rightBastionRingMat: THREE.ShaderMaterial;

  // 3D Diegetic Frontline Suppression Tug-of-War Gauge across No-Man's-Land
  private readonly frontlineGroup = new THREE.Group();
  private readonly blueFrontlineBar: THREE.Mesh;
  private readonly crimsonFrontlineBar: THREE.Mesh;
  private readonly blueFrontlineMat: THREE.ShaderMaterial;
  private readonly crimsonFrontlineMat: THREE.ShaderMaterial;
  private readonly frontlineSparkNode: THREE.Mesh;
  private readonly armorDeflectShield: THREE.Mesh;
  private readonly armorDeflectMat: THREE.ShaderMaterial;

  // Bullet-Time 88mm APFSDS Sabot Shell + Supersonic Mach Vapor Cone
  private readonly bulletTimeShellGroup = new THREE.Group();
  private readonly machConeMat: THREE.ShaderMaterial;

  // Bunker Tactical Comms CRT (`512x192`) + 8 Sculpted Vacuum-Tube Equalizer Columns
  private readonly crtCanvas: HTMLCanvasElement;
  private readonly crtCtx: CanvasRenderingContext2D;
  private readonly crtTexture: THREE.CanvasTexture;
  private readonly crtScreenMat: THREE.ShaderMaterial;
  private readonly timeDomainBytes = new Uint8Array(new ArrayBuffer(256));
  private readonly frequencyBytes = new Uint8Array(new ArrayBuffer(256));
  private readonly vacuumTubes: Array<{
    readonly filament: THREE.Mesh;
    readonly mat: THREE.MeshStandardMaterial;
  }> = [];

  private readonly leftMuzzleStar: THREE.Group;
  private readonly rightMuzzleStar: THREE.Group;
  private readonly muzzleFlashLight: THREE.PointLight;
  private readonly explosionLight: THREE.PointLight;

  private readonly tracers: TracerBolt[] = [];
  private readonly flakPuffs: PlumeBillow[] = [];
  private readonly incomingShells: THREE.Mesh[] = [];
  private readonly heatBeamMesh: THREE.Mesh;
  private readonly heatBeamMat: THREE.ShaderMaterial;

  private readonly reconSweepGroup = new THREE.Group();
  private readonly reconLaserMat: THREE.ShaderMaterial;
  private readonly reconReticle: THREE.Mesh;
  private readonly traverseBridgeGroup = new THREE.Group();
  private readonly traverseBridgeMat: THREE.ShaderMaterial;

  private readonly shockwaves: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }> = [];
  private readonly explosionPlumes: PlumeBillow[] = [];
  private readonly shrapnelPool: ShrapnelItem[] = [];
  private readonly sparkPool: ShrapnelItem[] = [];
  private readonly scorchDecalLeft: THREE.Mesh;
  private readonly scorchDecalRight: THREE.Mesh;
  private readonly scorchTexture: THREE.CanvasTexture;

  private readonly winnerSpotLight: THREE.SpotLight;
  private readonly winnerShaftMesh: THREE.Mesh;
  private readonly winnerShaftMat: THREE.ShaderMaterial;

  private readonly medallionMesh: THREE.Group;
  private readonly fxRegistry: THREE.Object3D[] = [];
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  private playerStageWedge: THREE.Group | null = null;
  private enemyStageWedge: THREE.Group | null = null;
  private capturedFlagEmblem: THREE.Group | null = null;
  private playerStartWorld = new THREE.Vector3();
  private enemyStartWorld = new THREE.Vector3();

  private activeVerdict: ArbiterVerdict | null = null;
  private activeProfile: ChoreographyVisualProfile | null = null;
  private finisherVariant = 0;
  private clashCounter = 0;

  private tAct1End = 0.76;
  private tPushEnd = 1.95;
  private tVerdict = 2.45;
  private tTotalEnd = 4.35;

  private elapsed = 0;
  private lastLiveStepMs = 0;
  private speedScale = 1;
  private overdriveHeld = false;
  private pausedForDebug = false;
  private pushAudioTriggered = false;
  private vacuumAudioTriggered = false;
  private act3Triggered = false;
  private delayedSplitBannerTriggered = false;
  private onBannerChange?: (banner: HudBannerState) => void;
  private onSequenceComplete?: () => void;

  private cameraShakeOffset = new THREE.Vector3();
  private readonly camShotPos = new THREE.Vector3();
  private readonly camShotLook = new THREE.Vector3();
  private lastCrtMode = '';
  private lastCrtDrawSec = -1;

  constructor(factory: MeshFactory, sound: SoundDirector) {
    this.factory = factory;
    this.sound = sound;

    this.root.position.set(0, 0, ARBITER_BAY_CENTER_Z);

    const fbFloorGeo = createBeveledSlabGeo(4.96, 0.12, 2.0, 0.08, 0.022);
    this.disposableGeometries.push(fbFloorGeo);
    const fbFloor = new THREE.Mesh(fbFloorGeo, this.factory.materials.mudTerrain);
    fbFloor.position.set(0, -0.28, 0);
    fbFloor.receiveShadow = true;
    this.arenaMount.add(fbFloor);
    this.root.add(this.arenaMount);

    const bastionRingGeo = createBeveledRingGeo(0.5, 0.42, 0.012, 0.004, 44);
    this.disposableGeometries.push(bastionRingGeo);

    this.leftBastionRingMat = createEnergyFadeShaderMaterial(
      new THREE.Color(0.32, 1.9, 2.4),
      0.22,
      true,
      true
    );
    this.disposableMaterials.push(this.leftBastionRingMat);
    const lRing = new THREE.Mesh(bastionRingGeo, this.leftBastionRingMat);
    lRing.position.set(-BASTION_X, BASTION_SURFACE_Y + 0.008, BASTION_Z);
    this.root.add(lRing);

    this.rightBastionRingMat = createEnergyFadeShaderMaterial(
      new THREE.Color(2.35, 0.28, 0.36),
      0.22,
      true,
      true
    );
    this.disposableMaterials.push(this.rightBastionRingMat);
    const rRing = new THREE.Mesh(bastionRingGeo, this.rightBastionRingMat);
    rRing.position.set(BASTION_X, BASTION_SURFACE_Y + 0.008, BASTION_Z);
    this.root.add(rRing);

    // Sculpted 3D Diegetic Frontline Tug-of-War Gauge (`x = -1.06 .. +1.06`)
    this.frontlineGroup.position.set(0, BASTION_SURFACE_Y + 0.025, BASTION_Z + 0.42);
    const railBackGeo = createBeveledSlabGeo(2.18, 0.022, 0.082, 0.014, 0.006);
    this.disposableGeometries.push(railBackGeo);
    const railBack = new THREE.Mesh(railBackGeo, this.factory.materials.darkSteel);
    railBack.castShadow = true;
    railBack.receiveShadow = true;
    this.frontlineGroup.add(railBack);

    const detentGeo = createBeveledSlabGeo(0.032, 0.036, 0.116, 0.006, 0.005);
    this.disposableGeometries.push(detentGeo);
    for (const dx of [-1.05, -0.525, 0, 0.525, 1.05]) {
      const pip = new THREE.Mesh(detentGeo, this.factory.materials.brassTrim);
      pip.position.x = dx;
      pip.castShadow = true;
      this.frontlineGroup.add(pip);
    }

    const barGeo = createBeveledSlabGeo(1.0, 0.028, 0.052, 0.01, 0.006);
    barGeo.translate(0.5, 0, 0);
    this.disposableGeometries.push(barGeo);
    this.blueFrontlineMat = createEnergyFadeShaderMaterial(
      new THREE.Color(0.35, 1.85, 2.55),
      0.96,
      false,
      false
    );
    this.disposableMaterials.push(this.blueFrontlineMat);
    this.blueFrontlineBar = new THREE.Mesh(barGeo, this.blueFrontlineMat);
    this.blueFrontlineBar.position.set(-1.05, 0.008, 0);

    const rBarGeo = createBeveledSlabGeo(1.0, 0.028, 0.052, 0.01, 0.006);
    rBarGeo.translate(-0.5, 0, 0);
    this.disposableGeometries.push(rBarGeo);
    this.crimsonFrontlineMat = createEnergyFadeShaderMaterial(
      new THREE.Color(2.55, 0.34, 0.42),
      0.96,
      false,
      false
    );
    this.disposableMaterials.push(this.crimsonFrontlineMat);
    this.crimsonFrontlineBar = new THREE.Mesh(rBarGeo, this.crimsonFrontlineMat);
    this.crimsonFrontlineBar.position.set(1.05, 0.008, 0);

    const gyroGeo = createGyroCoreGeo();
    this.disposableGeometries.push(gyroGeo);
    const sparkNodeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(1.0, 0.85, 0.45),
      emissive: new THREE.Color(2.9, 2.35, 1.2),
      emissiveIntensity: 1.5,
      metalness: 0.72,
      roughness: 0.22,
      toneMapped: false,
    });
    this.disposableMaterials.push(sparkNodeMat);
    this.frontlineSparkNode = new THREE.Mesh(gyroGeo, sparkNodeMat);
    this.frontlineSparkNode.position.y = 0.024;
    this.frontlineGroup.add(
      this.blueFrontlineBar,
      this.crimsonFrontlineBar,
      this.frontlineSparkNode
    );
    this.frontlineGroup.visible = false;
    this.root.add(this.frontlineGroup);
    this.fxRegistry.push(this.frontlineGroup);

    // Sculpted Octagonal Glacis Armor Deflection Shield Flash
    this.armorDeflectMat = createEnergyFadeShaderMaterial(
      new THREE.Color(2.8, 2.1, 0.75),
      0.0,
      true,
      true
    );
    this.disposableMaterials.push(this.armorDeflectMat);
    const shieldGeo = createHexShieldRingGeo(0.36, 0.22, 0.022, 0.007);
    this.disposableGeometries.push(shieldGeo);
    this.armorDeflectShield = new THREE.Mesh(shieldGeo, this.armorDeflectMat);
    this.armorDeflectShield.visible = false;
    this.root.add(this.armorDeflectShield);
    this.fxRegistry.push(this.armorDeflectShield);

    // Sculpted Multi-Part 88mm APFSDS Sabot Shell + Supersonic Prandtl-Glauert Mach Vapor Cone
    const sabotPenGeo = createSabotPenetratorGeo();
    const sabotBandGeo = createSabotDrivingBandGeo();
    const sabotFinGeo = createSabotFinGeo();
    const machConeGeo = createMachVaporConeGeo();
    this.disposableGeometries.push(sabotPenGeo, sabotBandGeo, sabotFinGeo, machConeGeo);

    const sabotGlowMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#d29a48'),
      emissive: new THREE.Color(2.2, 1.45, 0.45),
      emissiveIntensity: 1.35,
      metalness: 0.86,
      roughness: 0.22,
      toneMapped: false,
    });
    this.disposableMaterials.push(sabotGlowMat);

    const apProjectile = new THREE.Mesh(sabotPenGeo, sabotGlowMat);
    const drivingBand = new THREE.Mesh(sabotBandGeo, this.factory.materials.brassTrim);
    this.bulletTimeShellGroup.add(apProjectile, drivingBand);
    for (let f = 0; f < 4; f++) {
      const fin = new THREE.Mesh(sabotFinGeo, this.factory.materials.darkSteel);
      fin.rotation.x = (f * Math.PI) / 2;
      this.bulletTimeShellGroup.add(fin);
    }

    this.machConeMat = createEnergyFadeShaderMaterial(
      new THREE.Color(2.2, 1.55, 0.65),
      0.72,
      true,
      true
    );
    this.disposableMaterials.push(this.machConeMat);
    const machCone = new THREE.Mesh(machConeGeo, this.machConeMat);
    machCone.position.x = 0.02;
    this.bulletTimeShellGroup.add(machCone);
    this.bulletTimeShellGroup.visible = false;
    this.root.add(this.bulletTimeShellGroup);
    this.fxRegistry.push(this.bulletTimeShellGroup);

    // Scorched Blast Crater Decals
    const scorchCanvas = document.createElement('canvas');
    scorchCanvas.width = 128;
    scorchCanvas.height = 128;
    const sCtx = scorchCanvas.getContext('2d')!;
    const sGrad = sCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
    sGrad.addColorStop(0, 'rgba(255, 110, 20, 0.92)');
    sGrad.addColorStop(0.28, 'rgba(18, 12, 10, 0.95)');
    sGrad.addColorStop(0.7, 'rgba(10, 8, 7, 0.72)');
    sGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 128, 128);
    this.scorchTexture = new THREE.CanvasTexture(scorchCanvas);
    const scorchMat = new THREE.MeshStandardMaterial({
      map: this.scorchTexture,
      transparent: true,
      depthWrite: false,
      roughness: 0.98,
      metalness: 0.04,
      emissive: new THREE.Color('#2a0d04'),
      emissiveIntensity: 0.45,
    });
    this.disposableMaterials.push(scorchMat);
    const scorchGeo = createCenteredDiscGeo(0.625, 36);
    this.disposableGeometries.push(scorchGeo);
    this.scorchDecalLeft = new THREE.Mesh(scorchGeo, scorchMat);
    this.scorchDecalLeft.position.set(-BASTION_X, BASTION_SURFACE_Y + 0.012, BASTION_Z);
    this.scorchDecalLeft.visible = false;
    this.scorchDecalRight = new THREE.Mesh(scorchGeo, scorchMat);
    this.scorchDecalRight.position.set(BASTION_X, BASTION_SURFACE_Y + 0.012, BASTION_Z);
    this.scorchDecalRight.visible = false;
    this.root.add(this.scorchDecalLeft, this.scorchDecalRight);
    this.fxRegistry.push(this.scorchDecalLeft, this.scorchDecalRight);

    // Sculpted Armored 3D CRT Housing + Brass Rotary Dials + Curved Phosphor Screen
    this.crtCanvas = document.createElement('canvas');
    this.crtCanvas.width = 512;
    this.crtCanvas.height = 192;
    this.crtCtx = this.crtCanvas.getContext('2d')!;
    this.crtTexture = new THREE.CanvasTexture(this.crtCanvas);
    this.crtTexture.colorSpace = THREE.SRGBColorSpace;
    this.crtScreenMat = createCrtPhosphorShaderMaterial(this.crtTexture);
    this.disposableMaterials.push(this.crtScreenMat);

    const crtGroup = new THREE.Group();
    crtGroup.position.set(0, 0.08, -0.37);

    const crtScreenGeo = createCurvedPhosphorGeo(1.22, 0.27, 14, 6, 0.018);
    const crtFrameGeo = createCrtBezelFrameGeo(1.38, 0.39, 1.21, 0.26, 0.085, 0.016);
    const crtHoodGeo = createCrtVisorAwningGeo(1.36);
    const dialGeo = createRotaryDialGeo();
    const rivetGeo = createRivetGeo();
    this.disposableGeometries.push(crtScreenGeo, crtFrameGeo, crtHoodGeo, dialGeo, rivetGeo);

    const crtScreen = new THREE.Mesh(crtScreenGeo, this.crtScreenMat);
    crtScreen.position.set(0, 0, 0.016);
    const crtFrame = new THREE.Mesh(crtFrameGeo, this.factory.materials.gunmetal);
    crtFrame.position.set(0, 0, -0.018);
    crtFrame.castShadow = true;
    crtFrame.receiveShadow = true;

    const crtHood = new THREE.Mesh(crtHoodGeo, this.factory.materials.darkSteel);
    crtHood.position.set(0, 0.19, 0.032);
    crtHood.castShadow = true;

    crtGroup.add(crtScreen, crtFrame, crtHood);

    for (const dx of [-0.65, 0.65]) {
      const dial = new THREE.Mesh(dialGeo, this.factory.materials.brassTrim);
      dial.position.set(dx, -0.11, 0.036);
      dial.castShadow = true;
      crtGroup.add(dial);
    }
    for (const [rx, ry] of [
      [-0.65, 0.155],
      [0.65, 0.155],
      [-0.65, -0.155],
      [0.65, -0.155],
    ] as const) {
      const rivet = new THREE.Mesh(rivetGeo, this.factory.materials.brassTrim);
      rivet.position.set(rx, ry, 0.034);
      crtGroup.add(rivet);
    }

    this.root.add(crtGroup);

    // 8 Sculpted Vacuum-Tube Equalizer Columns
    const tubeSocketGeo = createTubeSocketGeo();
    const tubeGlassGeo = createTubeGlassGeo();
    const tubeCapGeo = createTubeCapGeo();
    const filGeo = createTubeFilamentGeo();
    this.disposableGeometries.push(tubeSocketGeo, tubeGlassGeo, tubeCapGeo, filGeo);

    const tubeGlassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#2a221b'),
      transparent: true,
      opacity: 0.36,
      roughness: 0.12,
      metalness: 0.05,
      clearcoat: 1.0,
    });
    this.disposableMaterials.push(tubeGlassMat);

    for (let i = 0; i < 8; i++) {
      const tx = -0.525 + (i / 7) * 1.05;
      const tz = -0.45;
      const baseY = 0.255;

      const socket = new THREE.Mesh(tubeSocketGeo, this.factory.materials.brassTrim);
      socket.position.set(tx, baseY, tz);
      socket.castShadow = true;

      const glass = new THREE.Mesh(tubeGlassGeo, tubeGlassMat);
      glass.position.set(tx, baseY + 0.015, tz);

      const cap = new THREE.Mesh(tubeCapGeo, this.factory.materials.brassTrim);
      cap.position.set(tx, baseY + 0.236, tz);

      const filMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#ffbe58'),
        emissive: new THREE.Color(1.8, 1.05, 0.28),
        emissiveIntensity: 1.4,
        roughness: 0.3,
        metalness: 0.25,
        toneMapped: false,
      });
      this.disposableMaterials.push(filMat);

      const filament = new THREE.Mesh(filGeo, filMat);
      filament.position.set(tx, baseY + 0.015, tz);
      filament.scale.y = 0.14;

      this.root.add(socket, glass, cap, filament);
      this.vacuumTubes.push({ filament, mat: filMat });
    }

    this.renderBunkerRadarStandby();

    this.muzzleFlashLight = new THREE.PointLight(0xffa838, 0, 7.5, 1.5);
    this.root.add(this.muzzleFlashLight);

    this.explosionLight = new THREE.PointLight(0xffb448, 0, 16.0, 1.35);
    this.root.add(this.explosionLight);

    this.leftMuzzleStar = this.build3DMuzzleStar(new THREE.Color(2.8, 1.95, 0.65));
    this.rightMuzzleStar = this.build3DMuzzleStar(new THREE.Color(2.9, 1.35, 0.45));
    this.root.add(this.leftMuzzleStar, this.rightMuzzleStar);
    this.fxRegistry.push(this.leftMuzzleStar, this.rightMuzzleStar);

    // Sculpted Tapered Tracer Darts
    const tracerGeo = createTaperedDartGeo(0.4, 0.014);
    this.disposableGeometries.push(tracerGeo);
    for (let i = 0; i < 28; i++) {
      const fromLeft = i % 2 === 0;
      const mat = createEnergyFadeShaderMaterial(
        fromLeft ? new THREE.Color(2.6, 2.05, 0.72) : new THREE.Color(2.8, 0.95, 0.42),
        0.95,
        true,
        false
      );
      this.disposableMaterials.push(mat);
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.fxRegistry.push(mesh);
      this.tracers.push({
        mesh,
        mat,
        fromLeft,
        yOff: 0.16 + ((i * 19) % 7) * 0.06,
        zOff: BASTION_Z + (((i * 11) % 5) - 2) * 0.085,
        phaseOffset: i * 0.17,
      });
    }

    // Flak Puffs
    const flakGeo = createCenteredQuadGeo(0.85, 0.85);
    this.disposableGeometries.push(flakGeo);
    for (let i = 0; i < 4; i++) {
      const mat = createWarfieldExplosionPlumeMaterial(10.5 + i * 7.3);
      this.disposableMaterials.push(mat);
      const mesh = new THREE.Mesh(flakGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.fxRegistry.push(mesh);
      this.flakPuffs.push({
        mesh,
        mat,
        offset: new THREE.Vector3(
          (i - 1.5) * 0.42,
          0.05,
          BASTION_Z + (i % 2 === 0 ? -0.18 : 0.16)
        ),
        driftVel: new THREE.Vector3(0, 0.55, 0),
        baseScale: 0.72,
        phaseDelay: 0.92 + i * 0.28,
      });
    }

    // Sculpted Incoming 105mm Artillery Shells
    const shellGeo = createArtilleryShellGeo();
    this.disposableGeometries.push(shellGeo);
    const shellMat = createEnergyFadeShaderMaterial(new THREE.Color(3.0, 1.95, 0.65), 0.95, true, false);
    this.disposableMaterials.push(shellMat);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.visible = false;
      this.root.add(m);
      this.fxRegistry.push(m);
      this.incomingShells.push(m);
    }

    // Sculpted High-Command Thermal Energy Lance
    this.heatBeamMat = createEnergyFadeShaderMaterial(new THREE.Color(3.2, 2.1, 0.65), 0.0, true, false);
    this.disposableMaterials.push(this.heatBeamMat);
    const beamGeo = createEnergyLanceGeo();
    this.disposableGeometries.push(beamGeo);
    this.heatBeamMesh = new THREE.Mesh(beamGeo, this.heatBeamMat);
    this.heatBeamMesh.position.set(0, 0.34, BASTION_Z);
    this.heatBeamMesh.visible = false;
    this.root.add(this.heatBeamMesh);
    this.fxRegistry.push(this.heatBeamMesh);

    // RECON_STEALTH Laser Triangulation & Cipher Reticle Group
    this.reconLaserMat = createReconLaserShaderMaterial();
    this.disposableMaterials.push(this.reconLaserMat);
    const laserCurveA = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-BASTION_X + 0.25, 0.34, BASTION_Z - 0.14),
      new THREE.Vector3(0, 0.42, BASTION_Z - 0.04),
      new THREE.Vector3(BASTION_X - 0.25, 0.26, BASTION_Z + 0.04),
    ]);
    const laserCurveB = new THREE.CatmullRomCurve3([
      new THREE.Vector3(BASTION_X - 0.25, 0.34, BASTION_Z + 0.14),
      new THREE.Vector3(0, 0.24, BASTION_Z + 0.06),
      new THREE.Vector3(-BASTION_X + 0.25, 0.26, BASTION_Z - 0.04),
    ]);
    const laserGeoA = new THREE.TubeGeometry(laserCurveA, 24, 0.011, 8, false);
    const laserGeoB = new THREE.TubeGeometry(laserCurveB, 24, 0.011, 8, false);
    const reticleGeo = createHexShieldRingGeo(0.42, 0.35, 0.014, 0.004);
    reticleGeo.rotateX(-Math.PI / 2);
    this.disposableGeometries.push(laserGeoA, laserGeoB, reticleGeo);
    const beamA = new THREE.Mesh(laserGeoA, this.reconLaserMat);
    const beamB = new THREE.Mesh(laserGeoB, this.reconLaserMat);
    this.reconReticle = new THREE.Mesh(reticleGeo, this.reconLaserMat);
    this.reconReticle.position.set(0, BASTION_SURFACE_Y + 0.04, BASTION_Z);
    this.reconSweepGroup.add(beamA, beamB, this.reconReticle);
    this.reconSweepGroup.visible = false;
    this.root.add(this.reconSweepGroup);
    this.fxRegistry.push(this.reconSweepGroup);

    // FLAG_BREACH Traverse Victory March Bridge Group
    this.traverseBridgeMat = createTraverseBridgeShaderMaterial();
    this.disposableMaterials.push(this.traverseBridgeMat);
    const bridgeDeckGeo = createBeveledSlabGeo(2.85, 0.026, 0.34, 0.025, 0.007);
    const bridgeChevronGeo = createBeveledSlabGeo(2.74, 0.008, 0.3, 0.018, 0.002);
    this.disposableGeometries.push(bridgeDeckGeo, bridgeChevronGeo);
    const bridgeDeck = new THREE.Mesh(bridgeDeckGeo, this.factory.materials.brassTrim);
    const bridgeChevron = new THREE.Mesh(bridgeChevronGeo, this.traverseBridgeMat);
    bridgeChevron.position.y = 0.018;
    this.traverseBridgeGroup.add(bridgeDeck, bridgeChevron);
    this.traverseBridgeGroup.position.set(0, BASTION_SURFACE_Y + 0.016, BASTION_Z);
    this.traverseBridgeGroup.visible = false;
    this.root.add(this.traverseBridgeGroup);
    this.fxRegistry.push(this.traverseBridgeGroup);

    // Shockwave Rings
    const swGeo = createCenteredQuadGeo(3.4, 3.4);
    swGeo.rotateX(-Math.PI / 2);
    this.disposableGeometries.push(swGeo);
    for (let i = 0; i < 2; i++) {
      const mat = createShockwaveRingMaterial();
      this.disposableMaterials.push(mat);
      const mesh = new THREE.Mesh(swGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.fxRegistry.push(mesh);
      this.shockwaves.push({ mesh, mat });
    }

    // Explosion Plumes
    const plumeGeo = createCenteredQuadGeo(1.0, 1.0);
    this.disposableGeometries.push(plumeGeo);
    for (let i = 0; i < 20; i++) {
      const localIdx = i % 10;
      const isBlackSmoke = localIdx >= 4;
      const mat = createWarfieldExplosionPlumeMaterial(i * 3.71 + 1.1, isBlackSmoke);
      this.disposableMaterials.push(mat);
      const mesh = new THREE.Mesh(plumeGeo, mat);
      mesh.renderOrder = isBlackSmoke ? 12 : 10;
      mesh.visible = false;
      this.root.add(mesh);
      this.fxRegistry.push(mesh);
      const ang = localIdx * 1.95;
      const rad = localIdx < 2 ? 0.0 : 0.18 + (localIdx % 4) * 0.12;
      this.explosionPlumes.push({
        mesh,
        mat,
        offset: new THREE.Vector3(
          Math.cos(ang) * rad,
          (isBlackSmoke ? 0.24 : 0.08) + localIdx * 0.085,
          Math.sin(ang) * rad * 0.75 + (isBlackSmoke ? 0.12 : -0.04)
        ),
        driftVel: new THREE.Vector3(
          Math.cos(ang) * 0.28,
          0.95 + (localIdx % 5) * 0.28,
          Math.sin(ang) * 0.18
        ),
        baseScale: isBlackSmoke ? 1.15 + (localIdx % 3) * 0.25 : 1.05,
        phaseDelay: localIdx * 0.022,
      });
    }

    // Sculpted Beveled Armor Shrapnel Plates
    const shardGeo = createShrapnelPlateGeo();
    this.disposableGeometries.push(shardGeo);
    const charredArmorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#15181F'),
      metalness: 0.82,
      roughness: 0.42,
    });
    this.disposableMaterials.push(charredArmorMat);
    for (let i = 0; i < 32; i++) {
      const mesh = new THREE.Mesh(shardGeo, charredArmorMat);
      mesh.scale.set(1.25, 0.55 + (i % 3) * 0.2, 0.9);
      mesh.castShadow = i < 6;
      mesh.visible = false;
      this.root.add(mesh);
      this.fxRegistry.push(mesh);
      const a = (i / 32) * Math.PI * 2 + i * 0.31;
      const spd = 2.2 + (i % 6) * 0.75;
      this.shrapnelPool.push({
        mesh,
        origin: new THREE.Vector3(),
        vel: new THREE.Vector3(Math.cos(a) * spd, 2.4 + (i % 5) * 0.85, Math.sin(a) * spd),
        spin: new THREE.Vector3(6 + (i % 7) * 3, 8 - (i % 5) * 3, 5 + (i % 4) * 4),
        active: false,
      });
    }

    // Sculpted Needle Ember Sparks
    const sparkMat = createEnergyFadeShaderMaterial(
      new THREE.Color(2.9, 1.85, 0.55),
      0.95,
      true,
      false
    );
    this.disposableMaterials.push(sparkMat);
    const sparkGeo = createNeedleSparkGeo(0.34, 0.012);
    this.disposableGeometries.push(sparkGeo);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.fxRegistry.push(mesh);
      const a = (i / 48) * Math.PI * 2 + i * 0.47;
      const spd = 3.2 + (i % 7) * 0.9;
      this.sparkPool.push({
        mesh,
        origin: new THREE.Vector3(),
        vel: new THREE.Vector3(Math.cos(a) * spd, 1.8 + (i % 6) * 0.7, Math.sin(a) * spd),
        spin: new THREE.Vector3(),
        active: false,
      });
    }

    this.winnerSpotLight = new THREE.SpotLight(0xffcf66, 0, 10.0, Math.PI / 5.0, 0.75, 1.2);
    this.winnerSpotLight.position.set(-BASTION_X - 0.6, 4.4, 0.8);
    this.root.add(this.winnerSpotLight, this.winnerSpotLight.target);

    this.winnerShaftMat = createGaussianLightShaftMaterial(new THREE.Color(1.95, 1.38, 0.42));
    this.disposableMaterials.push(this.winnerShaftMat);
    const shaftGeo = createCenteredQuadGeo(2.1, 5.4);
    shaftGeo.translate(0, 2.55, 0);
    this.disposableGeometries.push(shaftGeo);
    this.winnerShaftMesh = new THREE.Mesh(shaftGeo, this.winnerShaftMat);
    this.winnerShaftMesh.visible = false;
    this.root.add(this.winnerShaftMesh);
    this.fxRegistry.push(this.winnerShaftMesh);

    this.medallionMesh = this.factory.createAttackMedallion();
    this.worldMedallionGroup.add(this.medallionMesh);
    this.worldMedallionGroup.visible = false;
    this.fxRegistry.push(this.worldMedallionGroup);

    this.resetToIdle();
  }

  private build3DMuzzleStar(col: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    const mat = createGaussianLightShaftMaterial(col);
    mat.uniforms['uOpacity']!.value = 0.95;
    this.disposableMaterials.push(mat);

    const jetGeo = createCenteredQuadGeo(0.24, 0.58);
    jetGeo.translate(0, 0.29, 0);
    jetGeo.rotateZ(-Math.PI / 2);
    this.disposableGeometries.push(jetGeo);

    const planeA = new THREE.Mesh(jetGeo, mat);
    const planeB = new THREE.Mesh(jetGeo, mat);
    planeB.rotation.x = Math.PI / 2;
    g.add(planeA, planeB);
    g.visible = false;
    return g;
  }

  public applyBakedHardwareParts(parts: BakedArbiterHardwareParts): void {
    if (parts.warfieldArena) {
      this.arenaMount.clear();
      const arena = parts.warfieldArena.clone(true);
      arena.position.set(0, 0, 0);
      this.arenaMount.add(arena);
    }
  }

  public get isBusy(): boolean {
    return this.activeVerdict !== null;
  }

  public getActiveChoreography(): BattleChoreographyKind | null {
    return this.activeVerdict?.choreography ?? null;
  }

  public getVisibleFxCount(): number {
    let count = 0;
    for (const obj of this.fxRegistry) {
      if (obj.visible) count += 1;
    }
    return count;
  }

  public setOverdriveHeld(held: boolean): void {
    this.overdriveHeld = held;
  }

  public skipToVerdictAct3(): boolean {
    if (!this.activeVerdict || this.elapsed >= this.tVerdict - 0.05) {
      return false;
    }
    this.sound.stopActiveSequence();
    this.pushAudioTriggered = true;
    this.vacuumAudioTriggered = true;
    this.elapsed = this.tVerdict - 0.01;
    return true;
  }

  public skipToComplete(): boolean {
    if (!this.activeVerdict) return false;
    const done = this.onSequenceComplete;
    this.resetToIdle();
    done?.();
    return true;
  }

  public getCameraShakeOffset(): THREE.Vector3 {
    return this.cameraShakeOffset;
  }

  public getBattleCameraPose(isLandscape: boolean, aspect: number): BattleCameraShot {
    const verdict = this.activeVerdict;
    const profile = this.activeProfile;
    const defcon = verdict?.stakes?.defcon ?? 3;
    const t = this.elapsed;

    const wideFov = isLandscape
      ? 39
      : aspect < 0.52
        ? THREE.MathUtils.clamp(55 * (0.49 / aspect), 54, 60)
        : 49;
    const widePosX = 0;
    const widePosY = isLandscape ? 2.72 : 3.02;
    const widePosZ = isLandscape ? 1.52 : 1.92;
    const wideLookZ = ARBITER_BAY_CENTER_Z - (isLandscape ? 0.18 : 0.12);

    if (!verdict || !profile) {
      return {
        pos: this.camShotPos.set(widePosX, widePosY, widePosZ),
        look: this.camShotLook.set(0, 0.14, wideLookZ),
        fov: wideFov,
        dampSpeed: 8.5,
        roomDim: 0.62,
        redAlertGlow: 0,
      };
    }

    const bias = profile.cameraBias;

    if (t < this.tPushEnd) {
      const u = THREE.MathUtils.clamp(t / Math.max(0.2, this.tPushEnd), 0, 1);
      const playerAttacking = verdict.attackerFaction === 'PLAYER';
      const sign = playerAttacking ? -1 : 1;
      const startX = sign * (isLandscape ? 1.85 : 1.32) * bias.shot1SideBiasX;
      const endX = sign * (isLandscape ? 1.45 : 1.05) * bias.shot1SideBiasX;
      const camX = THREE.MathUtils.lerp(startX, endX, u);
      const camY = THREE.MathUtils.lerp(isLandscape ? 1.78 : 2.32, isLandscape ? 1.56 : 2.06, u);
      const camZ = THREE.MathUtils.lerp(isLandscape ? -0.95 : 0.72, isLandscape ? -1.35 : 0.28, u);

      const lookX = profile.isFlagTraverse ? THREE.MathUtils.lerp(-sign * 0.4, 0, u) : -sign * 0.22;
      const lookY = 0.14;
      const lookZ = ARBITER_BAY_CENTER_Z + 0.04;

      return {
        pos: this.camShotPos.set(camX, camY, camZ),
        look: this.camShotLook.set(lookX, lookY, lookZ),
        fov: (isLandscape ? 36 : Math.min(50, wideFov - 2)) + bias.shot1FovDelta,
        dampSpeed: 9.5,
        roomDim: defcon === 1 ? 0.36 : 0.56,
        redAlertGlow: defcon === 1 ? 1.0 : bias.shot2RedAlertBoost * 0.4,
      };
    }

    if (t < this.tVerdict) {
      const vacU = THREE.MathUtils.clamp(
        (t - this.tPushEnd) / Math.max(0.15, this.tVerdict - this.tPushEnd),
        0,
        1
      );
      const orbitX = Math.sin((vacU - 0.5) * 0.85) * bias.shot2OrbitAmp;
      const camY = isLandscape ? 1.58 : 2.08;
      const camZ = isLandscape ? -0.55 : 0.58;
      return {
        pos: this.camShotPos.set(orbitX, camY, camZ),
        look: this.camShotLook.set(0, 0.15, ARBITER_BAY_CENTER_Z + 0.06),
        fov: isLandscape ? 34 : Math.min(47, wideFov - 4),
        dampSpeed: 12.5,
        roomDim: bias.shot2RoomDim,
        redAlertGlow: (defcon === 1 ? 1.35 : 0.45) + bias.shot2RedAlertBoost,
      };
    }

    return {
      pos: this.camShotPos.set(widePosX, widePosY, widePosZ),
      look: this.camShotLook.set(0, 0.14, wideLookZ),
      fov: wideFov,
      dampSpeed: 18.5,
      roomDim: 0.52,
      redAlertGlow: bias.shot2RedAlertBoost * 0.25,
    };
  }

  public startBattleSequence(
    verdict: ArbiterVerdict,
    playerOriginWorld: THREE.Vector3,
    enemyOriginWorld: THREE.Vector3,
    speedScale: number,
    onBannerChange: (banner: HudBannerState) => void,
    onComplete: () => void
  ): void {
    this.cleanupStageWedges();

    const profile = resolveBattleChoreographyProfile(verdict);
    const timeline = computeChoreographyTimeline(verdict, profile);
    this.activeVerdict = verdict;
    this.activeProfile = profile;

    this.tAct1End = timeline.tAct1End;
    this.tPushEnd = timeline.tPushEnd;
    this.tVerdict = timeline.tVerdict;
    this.tTotalEnd = timeline.tTotalEnd;

    if (profile.enableIncomingSalvo) {
      this.finisherVariant = 1;
    } else if (profile.enableHeatLance) {
      this.finisherVariant = 2;
    } else {
      this.finisherVariant = this.clashCounter % 3;
    }
    this.clashCounter += 1;

    this.elapsed = 0;
    this.lastLiveStepMs = performance.now();
    this.speedScale = speedScale;
    this.pausedForDebug = false;
    this.pushAudioTriggered = false;
    this.vacuumAudioTriggered = false;
    this.act3Triggered = false;
    this.delayedSplitBannerTriggered = false;
    this.lastCrtMode = '';
    this.lastCrtDrawSec = -1;
    this.onBannerChange = onBannerChange;
    this.onSequenceComplete = onComplete;

    this.playerStartWorld.copy(playerOriginWorld);
    this.enemyStartWorld.copy(enemyOriginWorld);

    const pKills = verdict.stakes?.playerPublicKills ?? 0;
    const eKills = verdict.stakes?.enemyPublicKills ?? 0;

    if (profile.isFlagTraverse) {
      if (verdict.attackerFaction === 'PLAYER') {
        this.playerStageWedge = this.factory.createCommandWedge(
          'PLAYER',
          verdict.playerVisibleRank,
          pKills
        );
        this.root.add(this.playerStageWedge);
      } else {
        // Strict Fog-of-War: Enemy Flag Traverse stays 100% masked ('UNKNOWN')!
        this.enemyStageWedge = this.factory.createCommandWedge('ENEMY', 'UNKNOWN', eKills);
        this.root.add(this.enemyStageWedge);
      }
    } else {
      this.playerStageWedge = this.factory.createCommandWedge(
        'PLAYER',
        verdict.playerVisibleRank,
        pKills
      );
      this.enemyStageWedge = this.factory.createCommandWedge('ENEMY', 'UNKNOWN', eKills);

      if (verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER') {
        this.capturedFlagEmblem = buildRankEmblemMesh('FLAG', this.factory.materials.emblemPalette);
        this.capturedFlagEmblem.scale.setScalar(WEDGE_EMBLEM_MOUNT.scale);
        this.capturedFlagEmblem.position.set(0, WEDGE_EMBLEM_MOUNT.y, WEDGE_EMBLEM_MOUNT.z);
        this.capturedFlagEmblem.rotation.x = WEDGE_EMBLEM_MOUNT.rotXRad;
        this.capturedFlagEmblem.visible = false;
        this.enemyStageWedge.add(this.capturedFlagEmblem);
      }

      this.root.add(this.playerStageWedge, this.enemyStageWedge);
    }

    const ceremonialSq = gridToWorld(4, 0);
    this.worldMedallionGroup.position.set(ceremonialSq.x, 0, ceremonialSq.z);
    this.medallionMesh.position.set(0, 0, 0);
    this.medallionMesh.rotation.set(0, 0, 0);
    this.worldMedallionGroup.visible = true;

    onBannerChange(resolveChoreographyLockBanner(verdict));
    this.sound.playClashChoreography(verdict, speedScale);
    this.applyPoseAtTime(0);
  }

  public scrubToActTime(actSeconds: number): void {
    if (!this.activeVerdict) return;
    this.pausedForDebug = true;
    this.elapsed = actSeconds;
    if (actSeconds >= this.tAct1End && actSeconds < this.tPushEnd) {
      this.onBannerChange?.('ARBITRATING');
    } else if (actSeconds >= this.tPushEnd && actSeconds < this.tVerdict) {
      this.onBannerChange?.(
        this.isDefenderReversal(this.activeVerdict)
          ? 'ARMOR DEFLECTED — COUNTER!'
          : 'TARGET LOCKED — HEARTBEAT'
      );
    } else if (actSeconds >= this.tVerdict) {
      this.onBannerChange?.(this.computeFinalBanner(this.activeVerdict));
    }
    this.applyPoseAtTime(actSeconds);
  }

  public update(dt: number, totalElapsedSec: number): void {
    this.crtScreenMat.uniforms['uTime']!.value = totalElapsedSec;

    if (!this.activeVerdict) {
      this.cameraShakeOffset.set(0, 0, 0);
      for (let i = 0; i < this.vacuumTubes.length; i++) {
        const tube = this.vacuumTubes[i]!;
        const wave = 0.5 + 0.5 * Math.sin(totalElapsedSec * 2.15 + i * 0.68);
        tube.filament.scale.y = 0.22 + 0.24 * wave;
        const glow = 1.45 + 0.78 * wave;
        tube.mat.emissive.setRGB(glow, glow * 0.56, glow * 0.16);
      }
      return;
    }

    if (!this.pausedForDebug) {
      const nowMs = performance.now();
      const wallDt =
        this.lastLiveStepMs > 0 ? Math.max(dt, (nowMs - this.lastLiveStepMs) * 0.001) : dt;
      this.lastLiveStepMs = nowMs;
      const maxStep = this.speedScale > 1.5 ? 0.55 : 0.25;
      const effectiveDt = Math.min(maxStep, wallDt);
      const overdriveMul = this.overdriveHeld && this.elapsed < this.tVerdict ? 2.15 : 1.0;
      this.elapsed += effectiveDt * this.speedScale * overdriveMul;
    } else {
      this.lastLiveStepMs = 0;
    }

    const t = this.elapsed;
    const verdict = this.activeVerdict;
    const effSpeed = this.speedScale * (this.overdriveHeld ? 2.15 : 1.0);

    if (!this.pausedForDebug && !this.pushAudioTriggered && t >= this.tAct1End) {
      this.pushAudioTriggered = true;
      this.onBannerChange?.('ARBITRATING');
      this.sound.playAct2SuppressionPush(
        (this.tPushEnd - this.tAct1End) / effSpeed,
        verdict.attackerFaction === 'PLAYER',
        verdict.stakes?.defcon ?? 3
      );
    }

    if (!this.pausedForDebug && !this.vacuumAudioTriggered && t >= this.tPushEnd) {
      this.vacuumAudioTriggered = true;
      const reversal = this.isDefenderReversal(verdict);
      this.onBannerChange?.(
        reversal ? 'ARMOR DEFLECTED — COUNTER!' : 'TARGET LOCKED — HEARTBEAT'
      );
      const defPan = verdict.defenderFaction === 'PLAYER' ? -0.52 : 0.52;
      this.sound.playStrachanVacuumAndHeartbeat(
        (this.tVerdict - this.tPushEnd) / effSpeed,
        reversal,
        defPan
      );
    }

    if (!this.pausedForDebug && !this.act3Triggered && t >= this.tVerdict) {
      this.act3Triggered = true;
      const isSpyIntercept =
        verdict.playerVisibleRank === 'PRIVATE' && verdict.resolution === 'PLAYER_WINS';

      if (verdict.resolution === 'MUTUAL_SPLIT') {
        this.onBannerChange?.('TARGET HIT...');
      } else {
        this.onBannerChange?.(this.computeFinalBanner(verdict));
      }
      this.sound.playAct3Outcome(verdict.resolution, isSpyIntercept);
    }

    if (
      !this.pausedForDebug &&
      !this.delayedSplitBannerTriggered &&
      verdict.resolution === 'MUTUAL_SPLIT' &&
      t >= this.tVerdict + 0.46
    ) {
      this.delayedSplitBannerTriggered = true;
      this.onBannerChange?.('MUTUAL ELIMINATION');
    }

    this.applyPoseAtTime(t, totalElapsedSec);

    if (!this.pausedForDebug && t >= this.tTotalEnd) {
      const done = this.onSequenceComplete;
      this.resetToIdle();
      done?.();
    }
  }

  public resetToIdle(): void {
    this.sound.stopActiveSequence();
    this.cleanupStageWedges();
    this.activeVerdict = null;
    this.activeProfile = null;
    this.onBannerChange = undefined;
    this.onSequenceComplete = undefined;
    this.pausedForDebug = false;
    this.lastLiveStepMs = 0;
    this.overdriveHeld = false;
    this.pushAudioTriggered = false;
    this.vacuumAudioTriggered = false;
    this.act3Triggered = false;
    this.delayedSplitBannerTriggered = false;
    this.cameraShakeOffset.set(0, 0, 0);

    this.leftBastionRingMat.uniforms['uOpacity']!.value = 0.22;
    this.rightBastionRingMat.uniforms['uOpacity']!.value = 0.22;
    this.muzzleFlashLight.intensity = 0;
    this.explosionLight.intensity = 0;
    this.winnerSpotLight.intensity = 0;

    for (const fx of this.fxRegistry) {
      fx.visible = false;
    }

    this.renderBunkerRadarStandby();
  }

  public dispose(): void {
    this.resetToIdle();
    this.crtTexture.dispose();
    this.scorchTexture.dispose();
    for (const g of this.disposableGeometries) {
      g.dispose();
    }
    for (const m of this.disposableMaterials) {
      m.dispose();
    }
  }

  private isDefenderReversal(verdict: ArbiterVerdict): boolean {
    if (verdict.isFlagTraverseVictory) return false;
    if (verdict.resolution === 'PLAYER_WINS' && verdict.attackerFaction === 'ENEMY') return true;
    if (verdict.resolution === 'ENEMY_WINS' && verdict.attackerFaction === 'PLAYER') return true;
    return false;
  }

  private computeFinalBanner(verdict: ArbiterVerdict): HudBannerState {
    if (verdict.isFlagTraverseVictory) {
      return verdict.attackerFaction === 'PLAYER'
        ? 'FLAG TRAVERSE — VICTORY'
        : 'FLAG LOST — DEFEAT';
    }
    if (verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER') return 'FLAG CAPTURED — VICTORY';
    if (verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY') return 'FLAG LOST — DEFEAT';
    if (verdict.resolution === 'MUTUAL_SPLIT') return 'MUTUAL ELIMINATION';
    if (verdict.playerVisibleRank === 'PRIVATE' && verdict.resolution === 'PLAYER_WINS') {
      return 'SPY INTERCEPTED — VICTORY';
    }
    return 'BATTLE WINNER';
  }

  private applyPoseAtTime(t: number, clockSec = t): void {
    const verdict = this.activeVerdict;
    const profile = this.activeProfile;
    if (!verdict || !profile) return;

    this.muzzleFlashLight.intensity = 0;
    this.explosionLight.intensity = 0;
    this.winnerSpotLight.intensity = 0;
    for (const fx of this.fxRegistry) {
      if (fx !== this.worldMedallionGroup) fx.visible = false;
    }

    const playerAttacks = verdict.attackerFaction === 'PLAYER';

    // 1. Attack Medallion Drop (`0.0s .. 0.26s`, strictly preserving medallionY > 0.02 at t=0.25s)
    const medDropP = THREE.MathUtils.clamp(t / 0.26, 0, 1);
    const bounce =
      medDropP < 0.78
        ? 1 - (medDropP / 0.78) * (medDropP / 0.78)
        : Math.sin(((medDropP - 0.78) / 0.22) * Math.PI) * 0.08;
    const medY = Math.max(0, bounce * 1.4);
    this.medallionMesh.position.set(0, medY, 0);
    this.medallionMesh.rotation.set(0, 0, 0);

    // Special Branch: Uncontested Flag Traverse Victory March!
    if (profile.isFlagTraverse) {
      this.applyFlagTraversePose(t, clockSec, verdict, profile);
      return;
    }

    const leftBastionLocal = new THREE.Vector3(-BASTION_X, BASTION_SURFACE_Y, BASTION_Z);
    const rightBastionLocal = new THREE.Vector3(BASTION_X, BASTION_SURFACE_Y, BASTION_Z);
    const pStartLocal = this.playerStartWorld.clone().sub(this.root.position);
    const eStartLocal = this.enemyStartWorld.clone().sub(this.root.position);

    const pFlyDur = playerAttacks ? 0.21 : 0.25;
    const eFlyDur = playerAttacks ? 0.25 : 0.21;
    const pDelay = playerAttacks ? 0.02 : 0.11;
    const eDelay = playerAttacks ? 0.11 : 0.02;

    const pFly = 1 - Math.pow(1 - THREE.MathUtils.clamp((t - pDelay) / pFlyDur, 0, 1), 3);
    const eFly = 1 - Math.pow(1 - THREE.MathUtils.clamp((t - eDelay) / eFlyDur, 0, 1), 3);

    const pPos = leftBastionLocal.clone().lerp(pStartLocal, 1 - pFly);
    const ePos = rightBastionLocal.clone().lerp(eStartLocal, 1 - eFly);
    pPos.y += Math.sin(pFly * Math.PI) * 1.1;
    ePos.y += Math.sin(eFly * Math.PI) * 1.1;

    const ringIgnite = THREE.MathUtils.smoothstep(t, 0.16, 0.32);
    this.leftBastionRingMat.uniforms['uOpacity']!.value = THREE.MathUtils.lerp(0.25, 0.96, ringIgnite);
    this.rightBastionRingMat.uniforms['uOpacity']!.value = THREE.MathUtils.lerp(0.25, 0.96, ringIgnite);

    if (this.playerStageWedge && this.enemyStageWedge) {
      this.playerStageWedge.visible = true;
      this.enemyStageWedge.visible = true;
      if (this.capturedFlagEmblem) this.capturedFlagEmblem.visible = false;

      const pStanceZ = playerAttacks ? -0.18 : 0.12;
      const eStanceZ = playerAttacks ? -0.12 : 0.18;
      const pLungeX = playerAttacks ? 0.09 * pFly : -0.05 * pFly;
      const eLungeX = playerAttacks ? 0.05 * eFly : -0.09 * eFly;

      this.playerStageWedge.position.set(pPos.x + pLungeX, pPos.y, pPos.z);
      this.playerStageWedge.rotation.set(0, 0.34, pStanceZ * pFly);

      // Strict Fog-of-War: Enemy wedge always faces away (`Math.PI - 0.34`)
      this.enemyStageWedge.position.set(ePos.x + eLungeX, ePos.y, ePos.z);
      this.enemyStageWedge.rotation.set(0, Math.PI - 0.34, eStanceZ * eFly);

      if (t >= 0.22 && t < this.tAct1End) {
        this.poseBurstSparks(leftBastionLocal, (t - 0.22) * 0.9, 20, 0);
        this.poseBurstSparks(rightBastionLocal, Math.max(0, t - 0.3) * 0.9, 20, 20);
      }

      if (t < this.tAct1End) {
        this.renderBunkerScope('LOCK_IN', 0.5, clockSec, verdict, profile);
      }
    }

    // 3. Act 2A (`tAct1End .. tPushEnd`): Choreography-Customized Tactical Firefight!
    if (t >= this.tAct1End && t < this.tPushEnd) {
      const pushU = (t - this.tAct1End) / Math.max(0.2, this.tPushEnd - this.tAct1End);
      const rawSurge =
        0.5 +
        0.36 *
          (pushU + 0.14 * Math.sin(pushU * Math.PI * 2.5)) *
          (playerAttacks ? 1 : -1);
      const blueShare = THREE.MathUtils.clamp(rawSurge, 0.14, 0.86);
      this.updateFrontlineGauge(blueShare, clockSec);

      const pRecoil =
        Math.max(0, Math.sin(t * (playerAttacks ? 46 : 26))) * (playerAttacks ? 0.055 : 0.03);
      const eRecoil =
        Math.max(0, Math.cos(t * (playerAttacks ? 26 : 46))) * (playerAttacks ? 0.03 : 0.055);
      if (this.playerStageWedge && this.enemyStageWedge) {
        this.playerStageWedge.position.x = -BASTION_X + (playerAttacks ? 0.08 : -0.06) - pRecoil;
        this.enemyStageWedge.position.x = BASTION_X + (playerAttacks ? 0.06 : -0.08) + eRecoil;
      }

      const leftFiring = playerAttacks ? Math.sin(t * 50) > -0.25 : Math.sin(t * 32) > 0.35;
      const rightFiring = !playerAttacks ? Math.cos(t * 50) > -0.25 : Math.cos(t * 32) > 0.35;
      this.leftMuzzleStar.position.set(-0.66, -0.02, BASTION_Z);
      this.rightMuzzleStar.position.set(0.66, -0.02, BASTION_Z);
      this.leftMuzzleStar.visible = leftFiring && !profile.enableReconSweep;
      this.rightMuzzleStar.visible = rightFiring && !profile.enableReconSweep;
      this.leftMuzzleStar.rotation.x = t * 26;
      this.rightMuzzleStar.rotation.y = Math.PI;
      this.rightMuzzleStar.rotation.x = -t * 28;

      if ((leftFiring || rightFiring) && !profile.enableReconSweep) {
        this.muzzleFlashLight.position.set(leftFiring ? -0.55 : 0.55, 0.28, 0.05);
        this.muzzleFlashLight.intensity = 2.4;
      }

      if (profile.enableReconSweep) {
        this.reconSweepGroup.visible = true;
        this.reconLaserMat.uniforms['uOpacity']!.value = 0.85;
        this.reconLaserMat.uniforms['uTime']!.value = clockSec;
        this.reconReticle.rotation.y = clockSec * 3.2;
        this.reconReticle.position.x = THREE.MathUtils.lerp(-0.45, 0.45, 0.5 + 0.5 * Math.sin(pushU * Math.PI * 2));
      }

      let hitCount = 0;
      const pRgb = profile.tracerColorPlayerRGB;
      const eRgb = profile.tracerColorEnemyRGB;
      for (let idx = 0; idx < this.tracers.length; idx++) {
        if (idx % profile.tracerDensityMask !== 0) continue;
        const tr = this.tracers[idx]!;
        const isAggressorBolt = tr.fromLeft === playerAttacks;
        if (!isAggressorBolt && idx % 4 !== 1) continue;

        const cycleU =
          (t * (isAggressorBolt ? 3.8 : 2.3) * profile.tracerSpeedMul + tr.phaseOffset) % 1.0;
        if (cycleU < 0.36) {
          const u = cycleU / 0.36;
          const startX = tr.fromLeft ? -BASTION_X + 0.38 : BASTION_X - 0.38;
          const endX = tr.fromLeft ? BASTION_X - 0.22 : -BASTION_X + 0.22;
          const rgb = tr.fromLeft ? pRgb : eRgb;
          (tr.mat.uniforms['uColor']!.value as THREE.Color).setRGB(rgb[0], rgb[1], rgb[2]);
          tr.mesh.position.set(
            THREE.MathUtils.lerp(startX, endX, u),
            tr.yOff,
            tr.zOff * (1 - u * 0.35)
          );
          tr.mesh.rotation.set(0, 0, 0);
          tr.mesh.visible = true;
          if (u > 0.78 && hitCount < 2) {
            this.poseBurstSparks(
              new THREE.Vector3(endX, tr.yOff - 0.1, BASTION_Z),
              (u - 0.75) * 0.45,
              14,
              hitCount * 16
            );
            hitCount += 1;
          }
        }
      }

      if (profile.enableFlakPuffs) {
        for (const fp of this.flakPuffs) {
          const age = t - fp.phaseDelay;
          if (age >= 0 && age <= 0.65) {
            const ph = age / 0.65;
            fp.mesh.visible = true;
            fp.mesh.position.copy(fp.offset).addScaledVector(fp.driftVel, age);
            fp.mesh.scale.setScalar(fp.baseScale * (0.45 + ph * 0.95));
            fp.mat.uniforms['uPhase']!.value = ph;
            fp.mat.uniforms['uTime']!.value = clockSec;
          }
        }
      }

      if (profile.enableIncomingSalvo && pushU > 0.45) {
        const salvoU = (pushU - 0.45) / 0.55;
        const targetX = playerAttacks ? BASTION_X : -BASTION_X;
        const dir = playerAttacks ? 1 : -1;
        const sh = this.incomingShells[0]!;
        sh.visible = true;
        sh.position.lerpVectors(
          new THREE.Vector3(targetX - dir * 1.1, 3.2, BASTION_Z),
          new THREE.Vector3(targetX, 0.35, BASTION_Z),
          salvoU
        );
        sh.rotation.z = dir * -0.32;
      }

      if (!this.pausedForDebug) {
        const shake = profile.enableReconSweep ? 0.008 : 0.018;
        this.cameraShakeOffset.set(Math.sin(t * 78) * shake, Math.cos(t * 94) * shake, 0);
      }
      this.renderBunkerScope('SUPPRESSION', blueShare, clockSec, verdict, profile);
    }

    // 4. Act 2B (`tPushEnd .. tVerdict`): "THE STRACHAN VACUUM" + `0.08x` BULLET-TIME SABOT SHELL
    if (t >= this.tPushEnd && t < this.tVerdict) {
      const vacU = (t - this.tPushEnd) / Math.max(0.15, this.tVerdict - this.tPushEnd);
      const reversal = this.isDefenderReversal(verdict);

      if (this.playerStageWedge && this.enemyStageWedge) {
        const microShudder = Math.sin(t * 160) * 0.008;
        this.playerStageWedge.position.x = -BASTION_X + microShudder;
        this.enemyStageWedge.position.x = BASTION_X - microShudder;
      }

      const startShare = playerAttacks ? 0.85 : 0.15;
      const targetShare =
        verdict.resolution === 'MUTUAL_SPLIT'
          ? 0.5
          : verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER'
            ? 0.92
            : 0.08;
      const curShare = THREE.MathUtils.lerp(
        startShare,
        targetShare,
        THREE.MathUtils.smoothstep(vacU, 0.0, reversal ? 0.48 : 0.85)
      );
      this.updateFrontlineGauge(curShare, clockSec);

      if (reversal && vacU < 0.48) {
        const defX = verdict.defenderFaction === 'PLAYER' ? -BASTION_X + 0.34 : BASTION_X - 0.34;
        this.armorDeflectShield.visible = true;
        this.armorDeflectShield.position.set(defX, 0.28, BASTION_Z + 0.06);
        this.armorDeflectShield.rotation.y =
          verdict.defenderFaction === 'PLAYER' ? Math.PI * 0.38 : -Math.PI * 0.38;
        this.armorDeflectShield.scale.setScalar(0.65 + vacU * 0.65);
        this.armorDeflectMat.uniforms['uOpacity']!.value = (1 - vacU / 0.48) * 0.68;
        this.poseBurstSparks(new THREE.Vector3(defX, 0.24, BASTION_Z), vacU * 0.65, 16, 0);
      }

      const playerStrikesFatal =
        verdict.resolution === 'PLAYER_WINS' ||
        verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
        (verdict.resolution === 'MUTUAL_SPLIT' && playerAttacks);
      const shellStartX = playerStrikesFatal ? -0.68 : 0.68;
      const shellEndX = playerStrikesFatal ? BASTION_X - 0.26 : -BASTION_X + 0.26;
      const shellProgress = Math.pow(vacU, 0.72);

      this.bulletTimeShellGroup.visible = true;
      this.bulletTimeShellGroup.position.set(
        THREE.MathUtils.lerp(shellStartX, shellEndX, shellProgress),
        0.28,
        BASTION_Z
      );
      this.bulletTimeShellGroup.rotation.y = playerStrikesFatal ? 0 : Math.PI;
      this.bulletTimeShellGroup.rotation.x = t * 18;
      this.machConeMat.uniforms['uOpacity']!.value = 0.55 + 0.35 * Math.sin(vacU * Math.PI);

      this.cameraShakeOffset.set(0, 0, 0);
      this.renderBunkerScope('HEARTBEAT_VACUUM', curShare, clockSec, verdict, profile, vacU);
    }

    // 5. Act 3 (`t >= tVerdict`): DETONATION, DELAYED SPLIT & 180° FLAG UNMASKING
    if (t >= this.tVerdict) {
      const bt = t - this.tVerdict;
      const playerWins =
        verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';
      const enemyWins =
        verdict.resolution === 'ENEMY_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY';
      const isSplit = verdict.resolution === 'MUTUAL_SPLIT';
      const isPlayerFlagCapture = verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';

      if (isSplit) {
        const firstX = playerAttacks ? BASTION_X : -BASTION_X;
        const secondX = playerAttacks ? -BASTION_X : BASTION_X;
        const firstWedge = playerAttacks ? this.enemyStageWedge : this.playerStageWedge;
        const secondWedge = playerAttacks ? this.playerStageWedge : this.enemyStageWedge;
        const firstFaction = playerAttacks ? 'ENEMY' : 'PLAYER';
        const secondFaction = playerAttacks ? 'PLAYER' : 'ENEMY';
        const firstSign = playerAttacks ? 1 : -1;
        const secondSign = -firstSign;

        if (firstX > 0) this.scorchDecalRight.visible = true;
        else this.scorchDecalLeft.visible = true;

        this.poseExplosionSite(0, firstX, bt, clockSec, 0, 10, profile.shockwaveColorRGB);
        this.blastLoserWedgeAndShrapnel(firstWedge, firstFaction, firstX, bt, firstSign, 0, 16);
        this.poseBurstSparks(new THREE.Vector3(firstX, BASTION_SURFACE_Y, BASTION_Z), bt, 24, 0);

        if (bt < 0.46) {
          if (secondWedge) {
            const cookJitter = bt > 0.2 ? Math.sin(bt * 190) * 0.035 : 0;
            secondWedge.visible = true;
            secondWedge.position.set(secondX + cookJitter, BASTION_SURFACE_Y + 0.04, BASTION_Z);
          }
          if (bt > 0.22) {
            this.poseBurstSparks(
              new THREE.Vector3(secondX, BASTION_SURFACE_Y + 0.2, BASTION_Z),
              bt - 0.22,
              18,
              24
            );
          }
          if (!this.pausedForDebug && bt < 0.32) {
            const kick = (1 - bt / 0.32) * 0.095;
            this.cameraShakeOffset.set(Math.sin(bt * 115) * kick, Math.cos(bt * 132) * kick, 0);
          } else {
            this.cameraShakeOffset.set(0, 0, 0);
          }
          this.explosionLight.position.set(firstX, 0.75, -0.05);
          this.explosionLight.intensity = Math.max(0, Math.exp(-bt * 6.0) * 3.6);
          this.renderBunkerScope('GOLD_WIN', playerAttacks ? 1 : 0, clockSec, verdict, profile);
        } else {
          const bt2 = bt - 0.46;
          this.scorchDecalLeft.visible = true;
          this.scorchDecalRight.visible = true;
          this.leftBastionRingMat.uniforms['uOpacity']!.value = 0;
          this.rightBastionRingMat.uniforms['uOpacity']!.value = 0;

          this.poseExplosionSite(1, secondX, bt2, clockSec, 10, 20, profile.shockwaveColorRGB);
          this.blastLoserWedgeAndShrapnel(
            secondWedge,
            secondFaction,
            secondX,
            bt2,
            secondSign,
            16,
            32
          );
          this.poseBurstSparks(
            new THREE.Vector3(secondX, BASTION_SURFACE_Y, BASTION_Z),
            bt2,
            24,
            24
          );

          const jolt = Math.max(0, Math.exp(-bt2 * 7.5)) * 0.12;
          this.medallionMesh.position.set(0, jolt, 0);
          this.medallionMesh.rotation.z = Math.sin(bt2 * 45) * jolt;

          if (!this.pausedForDebug && bt2 < 0.42) {
            const kick2 = (1 - bt2 / 0.42) * 0.12;
            this.cameraShakeOffset.set(Math.sin(bt2 * 125) * kick2, Math.cos(bt2 * 140) * kick2, 0);
          } else {
            this.cameraShakeOffset.set(0, 0, 0);
          }
          this.explosionLight.position.set(secondX, 0.75, -0.05);
          this.explosionLight.intensity = Math.max(0, Math.exp(-bt2 * 6.0) * 3.8);
          this.renderBunkerScope('FLATLINE', 0.5, clockSec, verdict, profile);
        }
        return;
      }

      if (isPlayerFlagCapture && bt < 0.95) {
        const spinU = THREE.MathUtils.smoothstep(bt, 0.0, 0.28);
        if (this.capturedFlagEmblem) this.capturedFlagEmblem.visible = spinU > 0.15;
        if (this.enemyStageWedge) {
          this.enemyStageWedge.visible = true;
          this.enemyStageWedge.position.set(BASTION_X, BASTION_SURFACE_Y + spinU * 0.14, BASTION_Z);
          this.enemyStageWedge.rotation.set(0, Math.PI * (1 - spinU), 0);
        }
        this.winnerSpotLight.position.set(BASTION_X, 4.2, 1.2);
        this.winnerSpotLight.target.position.set(BASTION_X, 0.3, BASTION_Z);
        this.winnerSpotLight.intensity = 9.5;
        this.winnerShaftMesh.visible = true;
        this.winnerShaftMesh.position.set(BASTION_X, 0.02, BASTION_Z);
        this.winnerShaftMat.uniforms['uOpacity']!.value = 0.58;
        this.cameraShakeOffset.set(0, 0, 0);
        this.renderBunkerScope('CROWN', 1.0, clockSec, verdict, profile);
        return;
      }

      const blastBt = isPlayerFlagCapture ? bt - 0.95 : bt;
      if (!this.pausedForDebug && blastBt < 0.45) {
        const kick = (1 - blastBt / 0.45) * 0.115;
        this.cameraShakeOffset.set(
          Math.sin(blastBt * 115) * kick,
          Math.cos(blastBt * 132) * kick,
          0
        );
      } else {
        this.cameraShakeOffset.set(0, 0, 0);
      }

      const winX = playerWins ? -BASTION_X : BASTION_X;
      const loseX = playerWins ? BASTION_X : -BASTION_X;
      const winWedge = playerWins ? this.playerStageWedge : this.enemyStageWedge;
      const loseWedge = playerWins ? this.enemyStageWedge : this.playerStageWedge;
      const loseFaction = playerWins ? 'ENEMY' : 'PLAYER';
      const loseDir = playerWins ? 1 : -1;

      if (playerWins) {
        this.scorchDecalRight.visible = true;
        this.rightBastionRingMat.uniforms['uOpacity']!.value = 0;
        this.leftBastionRingMat.uniforms['uOpacity']!.value = 1.0;
      } else {
        this.scorchDecalLeft.visible = true;
        this.leftBastionRingMat.uniforms['uOpacity']!.value = 0;
        this.rightBastionRingMat.uniforms['uOpacity']!.value = 1.0;
      }

      if ((this.finisherVariant === 2 || profile.enableHeatLance) && blastBt < 0.24) {
        this.heatBeamMesh.visible = true;
        this.heatBeamMat.uniforms['uOpacity']!.value = 1 - blastBt / 0.24;
        this.leftMuzzleStar.visible = playerWins;
        this.rightMuzzleStar.visible = enemyWins;
      }

      if (this.finisherVariant === 1 || profile.enableIncomingSalvo) {
        for (const [sIdx, delay] of [0.12, 0.25].entries()) {
          if (blastBt >= delay - 0.1 && blastBt < delay) {
            const u = (blastBt - (delay - 0.1)) / 0.1;
            const sh = this.incomingShells[sIdx + 1]!;
            sh.visible = true;
            sh.position.lerpVectors(
              new THREE.Vector3(loseX - loseDir * 0.7, 3.5, BASTION_Z + (sIdx - 0.5) * 0.3),
              new THREE.Vector3(loseX + (sIdx - 0.5) * 0.25, 0.2, BASTION_Z),
              u
            );
            sh.rotation.z = loseDir * -0.2;
          }
        }
        this.poseExplosionSite(0, loseX - 0.12, blastBt, clockSec, 0, 12, profile.shockwaveColorRGB);
        if (blastBt >= 0.14) {
          this.poseExplosionSite(
            1,
            loseX + 0.18,
            blastBt - 0.14,
            clockSec,
            12,
            20,
            profile.shockwaveColorRGB
          );
        }
      } else {
        this.poseExplosionSite(0, loseX, blastBt, clockSec, 0, 20, profile.shockwaveColorRGB);
      }

      this.blastLoserWedgeAndShrapnel(loseWedge, loseFaction, loseX, blastBt, loseDir, 0, 32);
      this.poseBurstSparks(new THREE.Vector3(loseX, BASTION_SURFACE_Y, BASTION_Z), blastBt, 48, 0);

      this.explosionLight.position.set(loseX, 0.75, -0.05);
      this.explosionLight.intensity = Math.max(0, Math.exp(-blastBt * 6.2) * 3.8);

      if (winWedge) {
        const recoil = Math.sin(Math.min(1, blastBt / 0.22) * Math.PI) * 0.14;
        const heroLift = THREE.MathUtils.smoothstep(blastBt, 0.18, 0.55) * 0.12;
        winWedge.visible = true;
        winWedge.position.set(winX - loseDir * recoil, BASTION_SURFACE_Y + heroLift, BASTION_Z);
        // Strict Fog-of-War: When ENEMY wins or captures Player Flag, surviving enemy wedge stays at Math.PI - 0.26 (armored rear)
        const baseYaw = playerWins ? 0.26 : Math.PI - 0.26;
        winWedge.rotation.set(0, baseYaw, -loseDir * recoil * 0.8);
      }

      const flareIn = THREE.MathUtils.smoothstep(blastBt, 0.22, 0.62);
      this.winnerSpotLight.position.set(winX - 0.5, 4.4, 0.85);
      this.winnerSpotLight.target.position.set(winX, 0.2, BASTION_Z);
      this.winnerSpotLight.intensity = 8.5 * flareIn;

      const sRgb = profile.shaftColorRGB;
      (this.winnerShaftMat.uniforms['uColor']!.value as THREE.Color).setRGB(sRgb[0], sRgb[1], sRgb[2]);
      this.winnerShaftMesh.visible = flareIn > 0.02;
      this.winnerShaftMesh.position.set(winX, 0.02, BASTION_Z);
      this.winnerShaftMesh.rotation.z = winX < 0 ? 0.15 : -0.15;
      this.winnerShaftMat.uniforms['uOpacity']!.value = 0.52 * flareIn;

      this.renderBunkerScope(
        verdict.resolution.includes('FLAG') ? 'CROWN' : 'GOLD_WIN',
        playerWins ? 1 : 0,
        clockSec,
        verdict,
        profile
      );
    }
  }

  private applyFlagTraversePose(
    t: number,
    clockSec: number,
    verdict: ArbiterVerdict,
    profile: ChoreographyVisualProfile
  ): void {
    const winnerIsPlayer = verdict.attackerFaction === 'PLAYER';
    const wedge = winnerIsPlayer ? this.playerStageWedge : this.enemyStageWedge;

    this.traverseBridgeGroup.visible = true;
    this.traverseBridgeMat.uniforms['uOpacity']!.value = THREE.MathUtils.smoothstep(t, 0.12, 0.45) * 0.92;
    this.traverseBridgeMat.uniforms['uTime']!.value = clockSec;
    this.traverseBridgeMat.uniforms['uDirection']!.value = winnerIsPlayer ? 1.0 : -1.0;
    (this.traverseBridgeMat.uniforms['uColor']!.value as THREE.Color).setRGB(
      profile.shaftColorRGB[0],
      profile.shaftColorRGB[1],
      profile.shaftColorRGB[2]
    );

    const marchU = THREE.MathUtils.clamp((t - 0.2) / Math.max(0.4, this.tVerdict - 0.2), 0, 1);
    const pose = computeFlagTraverseMarchPose(
      marchU,
      winnerIsPlayer,
      BASTION_X,
      BASTION_SURFACE_Y,
      BASTION_Z
    );

    if (wedge) {
      wedge.visible = true;
      wedge.position.set(pose.x, pose.y, pose.z);
      wedge.rotation.set(pose.pitch, pose.yaw, pose.roll);
    }

    this.leftBastionRingMat.uniforms['uOpacity']!.value = winnerIsPlayer ? 0.95 : 0.25;
    this.rightBastionRingMat.uniforms['uOpacity']!.value = winnerIsPlayer ? 0.25 : 0.95;

    if (t < this.tAct1End) {
      this.renderBunkerScope('LOCK_IN', winnerIsPlayer ? 0.8 : 0.2, clockSec, verdict, profile);
    } else if (t < this.tPushEnd) {
      this.updateFrontlineGauge(winnerIsPlayer ? 0.85 : 0.15, clockSec);
      this.renderBunkerScope('SUPPRESSION', winnerIsPlayer ? 0.9 : 0.1, clockSec, verdict, profile);
    } else if (t < this.tVerdict) {
      const vacU = (t - this.tPushEnd) / Math.max(0.15, this.tVerdict - this.tPushEnd);
      this.updateFrontlineGauge(winnerIsPlayer ? 0.96 : 0.04, clockSec);
      this.renderBunkerScope(
        'HEARTBEAT_VACUUM',
        winnerIsPlayer ? 0.96 : 0.04,
        clockSec,
        verdict,
        profile,
        vacU
      );
    } else {
      const bt = t - this.tVerdict;
      const flareIn = THREE.MathUtils.smoothstep(bt, 0.05, 0.45);
      this.winnerSpotLight.position.set(0, 4.4, 0.95);
      this.winnerSpotLight.target.position.set(0, 0.2, BASTION_Z);
      this.winnerSpotLight.intensity = 9.0 * flareIn;

      const sRgb = profile.shaftColorRGB;
      (this.winnerShaftMat.uniforms['uColor']!.value as THREE.Color).setRGB(sRgb[0], sRgb[1], sRgb[2]);
      this.winnerShaftMesh.visible = flareIn > 0.02;
      this.winnerShaftMesh.position.set(0, 0.02, BASTION_Z);
      this.winnerShaftMesh.rotation.z = 0;
      this.winnerShaftMat.uniforms['uOpacity']!.value = 0.6 * flareIn;

      if (bt <= 0.72) {
        this.poseBurstSparks(new THREE.Vector3(-0.7, 0.2, BASTION_Z), bt, 16, 0);
        this.poseBurstSparks(new THREE.Vector3(0.7, 0.2, BASTION_Z), bt, 16, 16);
      }
      this.renderBunkerScope('CROWN', winnerIsPlayer ? 1 : 0, clockSec, verdict, profile);
    }
  }

  private updateFrontlineGauge(blueShare: number, clockSec: number): void {
    this.frontlineGroup.visible = true;
    const totalSpan = 2.1;
    const blueLen = Math.max(0.05, blueShare * totalSpan);
    const redLen = Math.max(0.05, (1 - blueShare) * totalSpan);
    this.blueFrontlineBar.scale.x = blueLen;
    this.crimsonFrontlineBar.scale.x = redLen;
    const nodeX = -1.05 + blueLen;
    this.frontlineSparkNode.position.x = nodeX;
    this.frontlineSparkNode.rotation.y = clockSec * 8;
    const pulse = 0.9 + 0.28 * Math.sin(clockSec * 28);
    this.frontlineSparkNode.scale.setScalar(pulse);
  }

  private poseExplosionSite(
    swIndex: number,
    centerX: number,
    bt: number,
    clockSec: number,
    plumeStart: number,
    plumeEnd: number,
    shockwaveRgb: readonly [number, number, number] = [2.4, 1.45, 0.45]
  ): void {
    const sw = this.shockwaves[swIndex];
    if (sw && bt >= 0 && bt <= 0.62) {
      sw.mesh.visible = true;
      sw.mesh.position.set(centerX, BASTION_SURFACE_Y + 0.03, BASTION_Z);
      sw.mat.uniforms['uProgress']!.value = bt / 0.62;
      (sw.mat.uniforms['uColor']!.value as THREE.Color).setRGB(
        shockwaveRgb[0],
        shockwaveRgb[1],
        shockwaveRgb[2]
      );
    }

    for (let i = plumeStart; i < plumeEnd; i++) {
      const pl = this.explosionPlumes[i]!;
      const age = bt - pl.phaseDelay;
      const maxDur = 1.55;
      if (age >= 0 && age <= maxDur) {
        const ph = age / maxDur;
        pl.mesh.visible = true;
        pl.mesh.position.set(
          centerX + pl.offset.x + pl.driftVel.x * age,
          BASTION_SURFACE_Y + pl.offset.y + pl.driftVel.y * Math.pow(age, 0.78),
          BASTION_Z + pl.offset.z + pl.driftVel.z * age
        );
        const expand = pl.baseScale * (0.38 + 1.35 * Math.pow(ph, 0.55));
        pl.mesh.scale.setScalar(expand);
        pl.mat.uniforms['uPhase']!.value = ph;
        pl.mat.uniforms['uTime']!.value = clockSec;
      }
    }
  }

  private blastLoserWedgeAndShrapnel(
    wedge: THREE.Group | null,
    _faction: 'PLAYER' | 'ENEMY',
    centerX: number,
    bt: number,
    outwardSign: number,
    shardStart: number,
    shardEnd: number
  ): void {
    if (wedge) {
      if (bt < 0.44) {
        wedge.visible = true;
        const g = 9.5;
        wedge.position.set(
          centerX + outwardSign * bt * 0.85,
          BASTION_SURFACE_Y + bt * 2.8 - 0.5 * g * bt * bt,
          BASTION_Z - bt * 0.85
        );
        wedge.rotation.set(bt * 8.2, bt * 5.6, -outwardSign * bt * 9.8);
      } else {
        wedge.visible = false;
      }
    }

    for (let i = shardStart; i < shardEnd; i++) {
      const sh = this.shrapnelPool[i]!;
      if (bt <= 0 || bt > 1.55) {
        sh.mesh.visible = false;
        continue;
      }
      sh.mesh.visible = true;
      const x = centerX + sh.vel.x * bt * 0.68;
      let y = BASTION_SURFACE_Y + 0.22 + sh.vel.y * bt - 4.9 * bt * bt;
      if (y < BASTION_SURFACE_Y + 0.04) {
        y = BASTION_SURFACE_Y + 0.04 + Math.abs(y - (BASTION_SURFACE_Y + 0.04)) * 0.28;
      }
      const z = BASTION_Z + sh.vel.z * bt * 0.68;
      sh.mesh.position.set(x, y, z);
      sh.mesh.rotation.set(sh.spin.x * bt, sh.spin.y * bt, sh.spin.z * bt);
    }
  }

  private poseBurstSparks(
    origin: THREE.Vector3,
    age: number,
    count: number,
    offsetIdx: number
  ): void {
    if (age <= 0 || age > 0.72) return;
    const end = Math.min(this.sparkPool.length, offsetIdx + count);
    for (let i = offsetIdx; i < end; i++) {
      const sp = this.sparkPool[i]!;
      sp.mesh.visible = true;
      const vx = sp.vel.x * 0.62;
      const vy = sp.vel.y - 7.5 * age;
      const vz = sp.vel.z * 0.62;
      const px = origin.x + vx * age;
      const py = Math.max(
        BASTION_SURFACE_Y + 0.02,
        origin.y + 0.18 + sp.vel.y * age - 3.75 * age * age
      );
      const pz = origin.z + vz * age;
      sp.mesh.position.set(px, py, pz);
      sp.mesh.lookAt(px + vx, py + vy, pz + vz);
      const fade = Math.max(0.12, 1 - age / 0.72);
      sp.mesh.scale.set(1, 1, fade);
    }
  }

  private renderBunkerRadarStandby(): void {
    const ctx = this.crtCtx;
    const w = this.crtCanvas.width;
    const h = this.crtCanvas.height;
    ctx.fillStyle = '#040a08';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(229, 185, 104, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, h * 0.5);
    ctx.lineTo(w - 16, h * 0.5);
    ctx.stroke();
    this.crtTexture.needsUpdate = true;

    for (const tb of this.vacuumTubes) {
      tb.filament.scale.y = 0.14;
      tb.mat.emissive.setRGB(0.85, 0.48, 0.14);
    }
  }

  private updateVacuumTubeEqualizer(
    hasFreqData: boolean,
    mode: string,
    clockSec: number
  ): void {
    for (let i = 0; i < this.vacuumTubes.length; i++) {
      const tb = this.vacuumTubes[i]!;
      const binStart = Math.floor(2 + Math.pow(i / 8, 1.55) * 76);
      const binEnd = Math.min(120, binStart + 4 + i * 2);
      let sum = 0;
      if (hasFreqData) {
        for (let b = binStart; b < binEnd; b++) {
          sum += this.frequencyBytes[b]!;
        }
      }
      const avgNorm = hasFreqData ? sum / ((binEnd - binStart) * 255) : 0;
      const fallback =
        mode === 'FLATLINE'
          ? 0.06
          : mode === 'HEARTBEAT_VACUUM'
            ? 0.16 + 0.35 * Math.pow(Math.max(0, Math.sin(clockSec * 8.2)), 6)
            : 0.2 + 0.45 * Math.abs(Math.sin(clockSec * 19 + i * 1.1));
      const level = THREE.MathUtils.clamp(Math.max(avgNorm * 1.25, fallback), 0.08, 1.0);
      tb.filament.scale.y = 0.12 + level * 0.88;

      if (mode === 'HEARTBEAT_VACUUM') {
        tb.mat.emissive.setRGB(2.4 * level + 0.4, 0.32 * level, 0.36 * level);
      } else {
        tb.mat.emissive.setRGB(1.1 + 1.85 * level, 0.55 + 1.15 * level, 0.18 + 0.35 * level);
      }
    }
  }

  private renderBunkerScope(
    mode: 'LOCK_IN' | 'SUPPRESSION' | 'HEARTBEAT_VACUUM' | 'GOLD_WIN' | 'CROWN' | 'FLATLINE',
    blueShare: number,
    clockSec: number,
    verdict: ArbiterVerdict,
    profile: ChoreographyVisualProfile,
    vacProgress = 0
  ): void {
    const ctx = this.crtCtx;
    const w = this.crtCanvas.width;
    const h = this.crtCanvas.height;

    const hasTimeAudio = this.sound.readBattleTimeDomainBytes(this.timeDomainBytes);
    const hasFreqAudio = this.sound.readBattleFrequencyBytes(this.frequencyBytes);
    this.updateVacuumTubeEqualizer(hasFreqAudio, mode, clockSec);

    if (
      !this.pausedForDebug &&
      this.lastCrtMode === mode &&
      Math.abs(clockSec - this.lastCrtDrawSec) < 0.038
    ) {
      return;
    }
    this.lastCrtMode = mode;
    this.lastCrtDrawSec = clockSec;

    ctx.fillStyle = mode === 'HEARTBEAT_VACUUM' ? '#070304' : '#040908';
    ctx.fillRect(0, 0, w, h);

    const midY = h * 0.56;

    const eqBands = 16;
    const barW = (w - 56) / eqBands;
    for (let b = 0; b < eqBands; b++) {
      const bin = Math.min(120, 2 + b * 6);
      const raw = hasFreqAudio ? this.frequencyBytes[bin]! / 255 : 0;
      const syn =
        mode === 'FLATLINE' || mode === 'HEARTBEAT_VACUUM'
          ? 0.04
          : 0.15 + 0.35 * Math.abs(Math.sin(clockSec * 16 + b * 0.9));
      const lvl = Math.min(1, Math.max(raw, syn));
      const bh = lvl * (h * 0.68);
      ctx.fillStyle =
        mode === 'HEARTBEAT_VACUUM'
          ? 'rgba(255, 68, 86, 0.18)'
          : profile.kind === 'RECON_STEALTH'
            ? 'rgba(60, 255, 180, 0.19)'
            : 'rgba(235, 178, 72, 0.19)';
      ctx.fillRect(28 + b * barW + 2, h - 10 - bh, barW - 4, bh);
    }

    if (mode === 'HEARTBEAT_VACUUM') {
      const sweepX = ((vacProgress * 2.0) % 1.0) * w;
      ctx.strokeStyle = verdict.stakes?.defcon === 1 ? '#ff4e5e' : '#58f29c';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (let x = 12; x < w - 12; x += 4) {
        const u = x / w;
        const d1 = (u - 0.32) * 28;
        const d2 = (u - 0.72) * 28;
        const qrs =
          Math.exp(-d1 * d1) * Math.sin(d1 * 4.5) * 62 +
          Math.exp(-d2 * d2) * Math.sin(d2 * 4.5) * 68;
        const fade = x <= sweepX + 40 ? 1.0 : 0.18;
        const y = midY - qrs * fade;
        if (x === 12) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#ffd982';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(
        this.isDefenderReversal(verdict) ? 'COUNTER-BATTERY LOCK' : profile.crtAct2BLabel,
        36,
        32
      );
      this.crtTexture.needsUpdate = true;
      return;
    }

    const grad = ctx.createLinearGradient(16, 0, w - 16, 0);
    if (mode === 'SUPPRESSION' || mode === 'LOCK_IN') {
      grad.addColorStop(0.0, profile.kind === 'RECON_STEALTH' ? '#48ffb8' : '#49c6ff');
      grad.addColorStop(Math.max(0.05, Math.min(0.95, blueShare)), '#ffe884');
      grad.addColorStop(1.0, '#ff4d5e');
    } else {
      grad.addColorStop(0.0, '#ffb02e');
      grad.addColorStop(0.5, '#ffef9c');
      grad.addColorStop(1.0, '#ffb02e');
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    if (mode === 'FLATLINE') {
      ctx.moveTo(14, midY);
      ctx.lineTo(w - 14, midY);
    } else {
      const samples = 96;
      for (let i = 0; i <= samples; i++) {
        const u = i / samples;
        const sIdx = Math.floor(u * (this.timeDomainBytes.length - 1));
        const byteCentered = hasTimeAudio ? (this.timeDomainBytes[sIdx]! - 128) / 128 : 0;
        const synWave =
          0.42 * Math.sin(i * 0.65 + clockSec * 34) * Math.sin(u * Math.PI);
        const amp = Math.abs(byteCentered) > 0.025 ? byteCentered * 1.65 : synWave;
        const x = 16 + u * (w - 32);
        const y = THREE.MathUtils.clamp(midY + amp * (h * 0.38), 38, h - 8);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.fillStyle = mode === 'FLATLINE' ? '#ff6474' : '#e8c478';
    ctx.font = 'bold 20px monospace';
    const label =
      mode === 'LOCK_IN'
        ? profile.crtAct1Label
        : mode === 'SUPPRESSION'
          ? `${profile.crtAct2ALabel} // ${Math.round(blueShare * 100)}%`
          : mode === 'FLATLINE'
            ? 'MUTUAL NEUTRALIZATION'
            : mode === 'CROWN'
              ? profile.crtAct3WinLabel
              : blueShare >= 0.5
                ? profile.crtAct3WinLabel
                : profile.crtAct3LossLabel;
    ctx.fillText(label, 36, 30);

    this.crtTexture.needsUpdate = true;
  }

  private cleanupStageWedges(): void {
    if (this.playerStageWedge) {
      this.root.remove(this.playerStageWedge);
      this.playerStageWedge = null;
    }
    if (this.enemyStageWedge) {
      this.root.remove(this.enemyStageWedge);
      this.enemyStageWedge = null;
    }
    this.capturedFlagEmblem = null;
  }
}
