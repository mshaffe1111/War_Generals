import crypto from 'node:crypto';
import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

interface PackageJsonShape {
  version?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as PackageJsonShape;

const appVersion = typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.2.0';
const builtAt = new Date().toISOString();
const buildId = `${appVersion}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const versionPayload = JSON.stringify(
  {
    version: appVersion,
    buildId,
    builtAt,
  },
  null,
  2
);

function versionManifestPlugin(): Plugin {
  return {
    name: 'war-generals-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: versionPayload,
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cleanPath = (req.url ?? '').split('?')[0];
        if (req.method === 'GET' && cleanPath.endsWith('/version.json')) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(versionPayload);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  plugins: [versionManifestPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
