#!/usr/bin/env node
/**
 * F10 Ultra-HD Studio-Rendered Art Generator (`tools/render_studio_art.mjs`)
 * Bundles `tools/studio_art_scene.ts` via esbuild, launches Headless Microsoft Edge WebGL2
 * at 2x supersampling, saves raw PNGs to scratch temp dir, and Lanczos-downsamples via Pillow:
 *   - `public/portraits/{miller,mercer,sterling,reyes,vance,hollis}.webp` (512x512)
 *   - `public/ranks/{GEN_5..FLAG,UNKNOWN}.webp` (256x256)
 *   - `public/icon-512.png` (512x512) & `public/icon-192.png` (192x192)
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const TMP_ROOT =
  process.env.STUDIO_ART_TMP ||
  path.join(os.tmpdir(), 'war-generals-studio-art');
const EDGE_USER_DATA = path.join(TMP_ROOT, 'edge_profile');
const RAW_DIR = path.join(TMP_ROOT, 'raw');

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findEdge() {
  for (const p of EDGE_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Microsoft Edge (msedge.exe) not found');
}

async function run() {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(EDGE_USER_DATA, { recursive: true });

  const bundlePath = path.join(TMP_ROOT, 'studio_art_scene.bundle.js');
  const esbuildJs = path.join(ROOT_DIR, 'node_modules', 'esbuild', 'bin', 'esbuild');
  execFileSync(
    process.execPath,
    [
      esbuildJs,
      path.join(__dirname, 'studio_art_scene.ts'),
      '--bundle',
      '--format=esm',
      '--platform=browser',
      `--outfile=${bundlePath}`,
    ],
    { cwd: ROOT_DIR, stdio: 'inherit' }
  );

  const includePortraits = process.argv.includes('--include-portraits');
  const expectedCount = includePortraits ? 23 : 17;
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>War Generals Studio Art Renderer</title></head>
<body style="margin:0;background:#080b11;color:#fff;font-family:monospace;">
  <div id="status">INIT</div>
  <script>window.__STUDIO_INCLUDE_PORTRAITS__ = ${includePortraits ? 'true' : 'false'};</script>
  <script type="module" src="/studio_art_scene.bundle.js"></script>
</body>
</html>`;

  const savedFiles = [];
  let doneResolve;
  const donePromise = new Promise((resolve) => {
    doneResolve = resolve;
  });

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && reqUrl.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/studio_art_scene.bundle.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(bundlePath));
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname.startsWith('/models/')) {
      const filePath = path.join(PUBLIC_DIR, reqUrl.pathname.slice(1));
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
        res.end(fs.readFileSync(filePath));
        return;
      }
    }
    if (req.method === 'POST' && reqUrl.pathname === '/save') {
      const name = reqUrl.searchParams.get('name');
      if (!name) {
        res.writeHead(400);
        res.end('missing name');
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dataUrl = Buffer.concat(chunks).toString('utf8');
        const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const outPath = path.join(RAW_DIR, name);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
        savedFiles.push(name);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        if (savedFiles.length >= expectedCount) {
          doneResolve();
        }
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/`;

  const edgeExe = findEdge();
  const edgeProc = spawn(
    edgeExe,
    [
      '--headless=new',
      '--disable-gpu-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${EDGE_USER_DATA}`,
      '--window-size=1024,1024',
      url,
    ],
    { stdio: 'ignore' }
  );

  try {
    await Promise.race([
      donePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout waiting for renders (${savedFiles.length}/${expectedCount} saved)`)), 60000)
      ),
    ]);
  } finally {
    try {
      edgeProc.kill();
    } catch {
      // ignore
    }
    server.close();
  }

  console.log(`Rendered ${savedFiles.length} supersampled studio PNGs. Downsampling via Pillow...`);

  const pyScript = `
import os
from PIL import Image

raw_dir = ${JSON.stringify(RAW_DIR)}
pub_dir = ${JSON.stringify(PUBLIC_DIR)}

os.makedirs(os.path.join(pub_dir, 'portraits'), exist_ok=True)
os.makedirs(os.path.join(pub_dir, 'ranks'), exist_ok=True)

portraits_dir = os.path.join(raw_dir, 'portraits')
if os.path.isdir(portraits_dir):
    for f in sorted(os.listdir(portraits_dir)):
        stem = os.path.splitext(f)[0]
        im = Image.open(os.path.join(portraits_dir, f)).convert('RGBA')
        im = im.resize((512, 512), Image.Resampling.LANCZOS)
        out = os.path.join(pub_dir, 'portraits', stem + '.webp')
        im.save(out, 'WEBP', quality=94, method=6)
        print('Wrote', out)

for f in sorted(os.listdir(os.path.join(raw_dir, 'ranks'))):
    stem = os.path.splitext(f)[0]
    im = Image.open(os.path.join(raw_dir, 'ranks', f)).convert('RGBA')
    im = im.resize((256, 256), Image.Resampling.LANCZOS)
    out = os.path.join(pub_dir, 'ranks', stem + '.webp')
    im.save(out, 'WEBP', quality=94, method=6)
    print('Wrote', out)

icon_im = Image.open(os.path.join(raw_dir, 'icon.png')).convert('RGBA')
icon_im.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(pub_dir, 'icon-512.png'), 'PNG', optimize=True)
icon_im.resize((192, 192), Image.Resampling.LANCZOS).save(os.path.join(pub_dir, 'icon-192.png'), 'PNG', optimize=True)
print('Wrote icon-512.png & icon-192.png')
`;
  execFileSync('python', ['-c', pyScript], { cwd: ROOT_DIR, stdio: 'inherit' });
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  } catch {
    // Non-fatal Windows Edge profile handle release delay
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
