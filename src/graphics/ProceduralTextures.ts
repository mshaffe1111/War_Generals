import * as THREE from 'three';

export interface WalnutTextureSet {
  readonly map: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.CanvasTexture;
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise(x * freq, y * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return val;
}

/**
 * Generates a high-contrast warm studio + lantern HDRI environment map using Three.js's
 * `RoomEnvironment` augmented with warm 2700K–3200K reflector panels via `PMREMGenerator`
 * so brushed brass (#E2B04A), brushed silver (#DCE2EA), chamfered slate, and oiled walnut
 * exhibit crisp, authentic metallic edge speculars (`envMapIntensity = 1.35`).
 */
export function createStudioLanternEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // Bespoke Dark Chiaroscuro War-Room Specular Rig (NO milky white RoomEnvironment walls that wash out piece faces & shadows!):
  // Deep obsidian ambient enclosure punctuated by crisp warm-gold & cool-steel grazing specular strips so brushed brass,
  // pewter silver, and beveled edges gleam sharply while shadows and Midnight Navy/Crimson armor stay ultra-rich!
  const darkStudio = new THREE.Scene();
  darkStudio.background = new THREE.Color(0.14, 0.11, 0.08);

  // Broad warm-gold overhead canopy so horizontal `0.85`-metallic brass plinths & medallions gleam warm gold!
  const canopy = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.45, 1.12, 0.72), side: THREE.DoubleSide })
  );
  canopy.position.set(0, 11.0, 2.0);
  canopy.lookAt(0, 0, 0);
  darkStudio.add(canopy);

  const keyStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 2.8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.95, 1.75), side: THREE.DoubleSide })
  );
  keyStrip.position.set(-8.5, 8.2, 3.5);
  keyStrip.lookAt(0, 0, 0);
  darkStudio.add(keyStrip);

  const rimStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 1.6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.9, 3.6), side: THREE.DoubleSide })
  );
  rimStrip.position.set(8.0, 6.5, -5.5);
  rimStrip.lookAt(0, 0, 0);
  darkStudio.add(rimStrip);

  const lanternOrbL = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 2.4, 0.85) })
  );
  lanternOrbL.position.set(-6.5, 2.8, -8.5);
  darkStudio.add(lanternOrbL);

  const lanternOrbR = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.1, 0.78) })
  );
  lanternOrbR.position.set(6.5, 3.2, -8.5);
  darkStudio.add(lanternOrbR);

  const rt = pmrem.fromScene(darkStudio, 0.03);
  pmrem.dispose();
  return rt.texture;
}

export function createWalnutTextures(size = 512): WalnutTextureSet {
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const cImg = cCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const warp = fbm(u * 2.8, v * 1.3, 4) * 1.2;
      const wave = 0.5 + 0.5 * Math.sin((u * 5.2 + warp) * Math.PI);
      const fineStreak = fbm(u * 38.0, v * 5.0, 3);
      const microPore = valueNoise(u * 125.0, v * 16.0);

      const tone = wave * 0.4 + fineStreak * 0.44 + microPore * 0.16;
      const clamped = Math.max(0, Math.min(1, tone));

      // Warm satin oiled American walnut (#472c1b .. #7a4e31)
      const r = Math.round(68 + clamped * 54);
      const g = Math.round(42 + clamped * 36);
      const b = Math.round(25 + clamped * 22);

      const idx = (y * size + x) * 4;
      cImg.data[idx] = r;
      cImg.data[idx + 1] = g;
      cImg.data[idx + 2] = b;
      cImg.data[idx + 3] = 255;

      const bumpVal = Math.round(
        Math.max(
          0,
          Math.min(255, (0.5 + (fineStreak - 0.5) * 0.45 + (microPore - 0.5) * 0.35) * 255)
        )
      );
      bImg.data[idx] = bumpVal;
      bImg.data[idx + 1] = bumpVal;
      bImg.data[idx + 2] = bumpVal;
      bImg.data[idx + 3] = 255;

      const roughVal = Math.round(80 + (1 - clamped) * 30);
      rImg.data[idx] = roughVal;
      rImg.data[idx + 1] = roughVal;
      rImg.data[idx + 2] = roughVal;
      rImg.data[idx + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  return { map, bumpMap, roughnessMap };
}

export function createBrushedMetalBumpMap(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const rowStreak = hash2(y * 1.7, 3.1) * 0.45;
    for (let x = 0; x < size; x++) {
      const fine = valueNoise(x * 0.14, y * 1.9);
      const val = Math.round(
        Math.max(0, Math.min(255, (0.45 + rowStreak * 0.35 + fine * 0.3) * 255))
      );
      const idx = (y * size + x) * 4;
      img.data[idx] = val;
      img.data[idx + 1] = val;
      img.data[idx + 2] = val;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export function createSlateBumpMap(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * 14, (y / size) * 14, 4);
      const micro = hash2(x, y) * 0.16;
      const val = Math.round(Math.max(0, Math.min(255, (n * 0.84 + micro) * 255)));
      const idx = (y * size + x) * 4;
      img.data[idx] = val;
      img.data[idx + 1] = val;
      img.data[idx + 2] = val;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createSoftSmokeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(32, 36, 42, 0.42)');
  g.addColorStop(0.5, 'rgba(20, 23, 28, 0.18)');
  g.addColorStop(1, 'rgba(10, 12, 16, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
