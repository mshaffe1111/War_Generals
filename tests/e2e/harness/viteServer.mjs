import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Reserves an OS-assigned free TCP port on `127.0.0.1` via `node:net`.
 *
 * @returns {Promise<number>}
 */
function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      if (!addr || typeof addr === 'string') {
        probe.close(() => reject(new Error('Failed to obtain numeric port from net.Server')));
        return;
      }
      const { port } = addr;
      probe.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(port);
      });
    });
  });
}

/**
 * Starts either a programmatic Vite dev server (`mode === 'vite'`) or a static HTTP
 * server over `./dist` (`mode === 'dist'`) on `127.0.0.1` using an OS-assigned free port.
 *
 * @param {{ rootDir: string, mode?: 'vite' | 'dist' }} opts
 * @returns {Promise<{ url: string, port: number, mode: string, close: () => Promise<void> }>}
 */
export async function startAppServer({ rootDir, mode = 'vite' }) {
  const port = await reserveFreePort();
  const url = `http://127.0.0.1:${port}`;

  if (mode === 'dist') {
    const distDir = path.resolve(rootDir, 'dist');
    if (!fs.existsSync(distDir)) {
      throw new Error(`dist directory not found at ${distDir}. Run "npm run build" first.`);
    }

    const server = http.createServer((req, res) => {
      const reqUrl = (req.url || '/').split('?')[0] || '/';
      let relPath;
      try {
        relPath = decodeURIComponent(reqUrl);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }
      if (relPath === '/' || relPath === '') {
        relPath = '/index.html';
      } else if (!relPath.startsWith('/')) {
        relPath = '/' + relPath;
      }
      const distPrefix = distDir.endsWith(path.sep) ? distDir : distDir + path.sep;
      const candidate = path.resolve(distDir, '.' + relPath);
      if (candidate !== distDir && !candidate.startsWith(distPrefix)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let filePath = candidate;
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    return {
      url,
      port,
      mode: 'dist',
      close: async () => {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(() => resolve()));
      },
    };
  }

  // Default: programmatic Vite dev server
  const viteEntry = path.resolve(rootDir, 'node_modules/vite/dist/node/index.js');
  const viteMod = await import(pathToFileURL(viteEntry).href);
  const viteServer = await viteMod.createServer({
    root: rootDir,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      watch: null,
    },
    plugins: [
      {
        name: 'e2e-disable-watch',
        configResolved(cfg) {
          cfg.server.watch = null;
        },
      },
    ],
    logLevel: 'silent',
  });
  await viteServer.listen();

  return {
    url,
    port,
    mode: 'vite',
    close: async () => {
      await viteServer.watcher?.close?.();
      await viteServer.close();
    },
  };
}
