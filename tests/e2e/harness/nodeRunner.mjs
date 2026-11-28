import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  PendingMilestoneError,
  createSuiteCollector,
  requireCapability,
  runRegisteredTests,
} from './resultModel.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * Installs a clean in-memory `localStorage` shim on `globalThis.localStorage`.
 */
export function installMockStorage() {
  const backing = new Map();
  const shim = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key) {
      const k = String(key);
      return backing.has(k) ? backing.get(k) : null;
    },
    setItem(key, value) {
      backing.set(String(key), String(value));
    },
    removeItem(key) {
      backing.delete(String(key));
    },
    key(index) {
      const keys = Array.from(backing.keys());
      return keys[index] ?? null;
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
    writable: true,
  });

  return () => backing.clear();
}

function resolveEsbuildBin(rootDir) {
  const isWin = process.platform === 'win32';
  const candidate = path.resolve(
    rootDir,
    'node_modules',
    '.bin',
    isWin ? 'esbuild.cmd' : 'esbuild'
  );
  if (fs.existsSync(candidate)) return candidate;
  const fallback = path.resolve(rootDir, 'node_modules', 'esbuild', 'bin', 'esbuild');
  return fallback;
}

async function bundleCjs(rootDir, entryAbs, outAbs) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const esbuildJs = path.resolve(rootDir, 'node_modules', 'esbuild', 'bin', 'esbuild');
  // Execute via current Node binary so Windows .cmd shell wrapper is never required
  await execFileAsync(
    process.execPath,
    [
      esbuildJs,
      entryAbs,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${outAbs}`,
    ],
    { cwd: rootDir }
  );
}

/**
 * Runs all matching Node/Asset `.e2e.ts` test suites (`tests/e2e/node/tier{1..4}*.e2e.ts`).
 *
 * @param {{ rootDir: string, tiers?: number[], strict?: boolean, verbose?: boolean, timeoutMs?: number }} opts
 */
export async function runNodeSuites(opts) {
  const {
    rootDir,
    tiers = [1, 2, 3, 4],
    strict = false,
    verbose = false,
    timeoutMs = 15000,
  } = opts;

  const resetMockStorage = installMockStorage();
  const nodeSuiteDir = path.resolve(rootDir, 'tests', 'e2e', 'node');
  const outRoot = path.resolve(rootDir, 'test-results', 'e2e');
  const modsOutDir = path.join(outRoot, '_mods');
  const loadedMods = new Map();

  /**
   * Dynamically bundles & loads an optional `src/**` module (e.g., `src/core/operations.ts`,
   * `src/core/theaters.ts`, `src/graphics/QualityGovernor.ts`). Returns `null` if the file
   * does not exist yet, allowing tests to report `PENDING_MILESTONE` instead of breaking esbuild.
   *
   * @param {string} relPath
   */
  async function loadSrcModule(relPath) {
    const normalized = relPath.replace(/\\/g, '/');
    if (loadedMods.has(normalized)) {
      return loadedMods.get(normalized);
    }
    const absPath = path.resolve(rootDir, normalized);
    if (!fs.existsSync(absPath)) {
      loadedMods.set(normalized, null);
      return null;
    }
    const safeName = normalized.replace(/[^a-zA-Z0-9._-]/g, '_') + '.cjs';
    const outFile = path.join(modsOutDir, safeName);
    await bundleCjs(rootDir, absPath, outFile);
    delete require.cache[require.resolve(outFile)];
    const mod = require(outFile);
    loadedMods.set(normalized, mod);
    return mod;
  }

  const allTests = [];

  for (const tier of tiers) {
    if (!fs.existsSync(nodeSuiteDir)) break;
    const files = fs
      .readdirSync(nodeSuiteDir)
      .filter((f) => f.startsWith(`tier${tier}_`) && f.endsWith('.e2e.ts'))
      .sort();

    for (const file of files) {
      const entryAbs = path.join(nodeSuiteDir, file);
      const outFile = path.join(outRoot, 'node', file.replace(/\.ts$/, '.cjs'));
      await bundleCjs(rootDir, entryAbs, outFile);
      delete require.cache[require.resolve(outFile)];
      const mod = require(outFile);
      if (typeof mod.registerNodeTests !== 'function') {
        throw new Error(`${file} must export function registerNodeTests(register, deps)`);
      }

      const collector = createSuiteCollector(tier);
      await mod.registerNodeTests(collector.register, {
        rootDir,
        resetMockStorage,
        loadSrcModule,
        requireCapability,
        PendingMilestoneError,
      });
      allTests.push(...collector.tests);
    }
  }

  const results = await runRegisteredTests(allTests, {
    timeoutMs,
    strict,
    verbose,
    beforeEach: () => {
      resetMockStorage();
    },
  });

  return results;
}

export { resolveEsbuildBin };
