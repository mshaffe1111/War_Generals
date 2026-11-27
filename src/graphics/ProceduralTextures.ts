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
 * Calibrated warm studio + dual tent-lantern HDRI environment map via PMREMGenerator.
 * Peak panel luminances are balanced so brushed brass (#C8963E) & brushed silver (#C9CFD6)
 * gleam with crisp specular facet separation without exceeding bloom threshold!
 */
export function createStudioLanternEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x120f0d);

  // Overhead warm softbox positioned forward-above for 68 deg sloped insignias & brass trims
  const keyPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.95, 1.72, 1.42), side: THREE.DoubleSide })
  );
  keyPanel.position.set(0, 11, 7.5);
  keyPanel.lookAt(0, 0, 0);
  envScene.add(keyPanel);

  // Crisp narrow specular strip for bevel facet separation without blooming flat surfaces
  const glintStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 1.8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.45, 2.25, 1.95), side: THREE.DoubleSide })
  );
  glintStrip.position.set(0, 8.5, 11.5);
  glintStrip.lookAt(0, 0, 0);
  envScene.add(glintStrip);

  // Left cool-silver fill strip
  const leftRim = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.05, 1.22, 1.48), side: THREE.DoubleSide })
  );
  leftRim.position.set(-13, 5, 2);
  leftRim.lookAt(0, 0, 0);
  envScene.add(leftRim);

  // Right warm-gold fill strip
  const rightRim = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.38, 1.12, 0.84), side: THREE.DoubleSide })
  );
  rightRim.position.set(13, 5, 3);
  rightRim.lookAt(0, 0, 0);
  envScene.add(rightRim);

  // Twin rear 2700K oil lantern warm accents
  const lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.1, 1.18, 0.42) });
  const lanternL = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), lanternMat);
  lanternL.position.set(-6, 3.5, -12);
  envScene.add(lanternL);

  const lanternR = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), lanternMat);
  lanternR.position.set(6.5, 4.0, -13);
  envScene.add(lanternR);

  // Warm walnut bounce floor
  const bounceFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.38, 0.26, 0.17), side: THREE.DoubleSide })
  );
  bounceFloor.position.set(0, -8, 0);
  bounceFloor.rotation.x = -Math.PI / 2;
  envScene.add(bounceFloor);

  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  return rt.texture;
}

/**
 * Smooth, fine-pored oiled American black walnut matching `ref_board_empty.webp`
 * (zero harsh zebra banding).
 */
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

      // Subtle low-contrast cathedral walnut figure running vertically along cabinet length
      const warp = fbm(u * 3.2, v * 1.4, 4) * 1.35;
      const softWave = 0.5 + 0.5 * Math.sin((u * 6.5 + warp) * Math.PI);
      const fineStreak = fbm(u * 42.0, v * 5.5, 3);
      const microPore = valueNoise(u * 130.0, v * 18.0);

      const tone = softWave * 0.42 + fineStreak * 0.42 + microPore * 0.16;
      const clamped = Math.max(0, Math.min(1, tone));

      // Deep oiled walnut (#342115 .. #583924) matching `ref_board_empty.webp`
      const r = Math.round(50 + clamped * 40);
      const g = Math.round(32 + clamped * 26);
      const b = Math.round(20 + clamped * 16);

      const idx = (y * size + x) * 4;
      cImg.data[idx] = r;
      cImg.data[idx + 1] = g;
      cImg.data[idx + 2] = b;
      cImg.data[idx + 3] = 255;

      const bumpVal = Math.round(Math.max(0, Math.min(255, (0.5 + (fineStreak - 0.5) * 0.45 + (microPore - 0.5) * 0.35) * 255)));
      bImg.data[idx] = bumpVal;
      bImg.data[idx + 1] = bumpVal;
      bImg.data[idx + 2] = bumpVal;
      bImg.data[idx + 3] = 255;

      const roughVal = Math.round(90 + (1 - clamped) * 28);
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
  map.repeat.set(1.0, 1.0);

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(1.0, 1.0);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(1.0, 1.0);

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
      const val = Math.round(Math.max(0, Math.min(255, (0.45 + rowStreak * 0.35 + fine * 0.3) * 255)));
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

/**
 * Moody aged sepia topological war map (`#8b7958` base so lantern/key lights never blow out white!).
 */
export function createTopologicalMapTexture(seedOffset = 0): THREE.CanvasTexture {
  const w = 512;
  const h = 384;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 30, w * 0.5, h * 0.5, w * 0.72);
  grad.addColorStop(0, '#9a8764');
  grad.addColorStop(0.7, '#827050');
  grad.addColorStop(1, '#66553b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(38, 26, 14, 0.78)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(21, 21, w - 42, h - 42);

  ctx.strokeStyle = 'rgba(42, 30, 18, 0.28)';
  ctx.lineWidth = 1;
  for (let gx = 64; gx < w - 24; gx += 48) {
    ctx.beginPath();
    ctx.moveTo(gx, 22);
    ctx.lineTo(gx, h - 22);
    ctx.stroke();
  }
  for (let gy = 64; gy < h - 24; gy += 48) {
    ctx.beginPath();
    ctx.moveTo(22, gy);
    ctx.lineTo(w - 22, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(38, 25, 12, 0.68)';
  ctx.lineWidth = 1.8;
  const centers = [
    { cx: 150 + seedOffset * 35, cy: 155, rx: 95, ry: 68 },
    { cx: 345 - seedOffset * 25, cy: 210, rx: 110, ry: 78 },
    { cx: 245, cy: 110 + seedOffset * 40, rx: 64, ry: 46 },
  ];
  for (const c of centers) {
    for (let ring = 1; ring <= 6; ring++) {
      const scale = ring / 6;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.14) {
        const wobble = 1 + 0.16 * Math.sin(a * 3 + ring + seedOffset) + 0.08 * Math.cos(a * 5 - ring);
        const px = c.cx + Math.cos(a) * c.rx * scale * wobble;
        const py = c.cy + Math.sin(a) * c.ry * scale * wobble;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  const rx = w - 68;
  const ry = 68;
  ctx.strokeStyle = 'rgba(32, 20, 10, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(rx, ry, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rx, ry - 30);
  ctx.lineTo(rx, ry + 30);
  ctx.moveTo(rx - 30, ry);
  ctx.lineTo(rx + 30, ry);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWatchDialTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, size * 0.48);
  grad.addColorStop(0, '#d8ceb8');
  grad.addColorStop(0.85, '#c2b498');
  grad.addColorStop(1, '#98886a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#241d15';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.43, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 60; i++) {
    const ang = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const rOuter = size * 0.42;
    const rInner = major ? size * 0.35 : size * 0.39;
    ctx.lineWidth = major ? 3 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rInner, cy + Math.sin(ang) * rInner);
    ctx.lineTo(cx + Math.cos(ang) * rOuter, cy + Math.sin(ang) * rOuter);
    ctx.stroke();
  }

  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - 28, cy - 34);
  ctx.stroke();

  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + 46, cy - 26);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSoftSmokeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(38, 42, 48, 0.55)');
  g.addColorStop(0.5, 'rgba(24, 27, 32, 0.25)');
  g.addColorStop(1, 'rgba(12, 14, 18, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
