import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VIEWPORT_PRESETS, launchEdgeBrowser } from './harness/edgeCdp.mjs';
import { runNodeSuites } from './harness/nodeRunner.mjs';
import {
  PendingMilestoneError,
  createSuiteCollector,
  formatSummaryTable,
  requireCapability,
  runRegisteredTests,
  summarizeResults,
} from './harness/resultModel.mjs';
import { startAppServer } from './harness/viteServer.mjs';

function parseArgs(argv) {
  const opts = {
    tiers: [1, 2, 3, 4],
    mode: 'all',
    serve: 'vite',
    swiftshader: false,
    strict: false,
    verbose: false,
    timeoutMs: 25000,
  };

  for (const arg of argv) {
    if (arg.startsWith('--tier=')) {
      const val = arg.slice('--tier='.length).trim().toLowerCase();
      if (val === 'all') {
        opts.tiers = [1, 2, 3, 4];
      } else {
        const parsed = val
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => [1, 2, 3, 4].includes(n));
        if (parsed.length === 0) {
          throw new Error(`Invalid --tier value "${val}". Expected 1|2|3|4|all.`);
        }
        opts.tiers = parsed;
      }
    } else if (arg === '--node-only') {
      opts.mode = 'node';
    } else if (arg === '--browser-only') {
      opts.mode = 'browser';
    } else if (arg.startsWith('--mode=')) {
      const val = arg.slice('--mode='.length).trim().toLowerCase();
      if (!['node', 'browser', 'all'].includes(val)) {
        throw new Error(`Invalid --mode value "${val}". Expected node|browser|all.`);
      }
      opts.mode = val;
    } else if (arg.startsWith('--serve=')) {
      const val = arg.slice('--serve='.length).trim().toLowerCase();
      if (!['vite', 'dist'].includes(val)) {
        throw new Error(`Invalid --serve value "${val}". Expected vite|dist.`);
      }
      opts.serve = val;
    } else if (arg === '--swiftshader') {
      opts.swiftshader = true;
    } else if (arg === '--strict') {
      opts.strict = true;
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg.startsWith('--timeout=')) {
      const n = Number(arg.slice('--timeout='.length));
      if (Number.isFinite(n) && n > 0) opts.timeoutMs = n;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node tests/e2e/run_e2e.mjs [options]',
          '  --tier=1|2|3|4|all   Select tier(s) to run (default: all)',
          '  --mode=node|browser|all | --node-only | --browser-only',
          '  --serve=vite|dist    Serve live src via Vite or static ./dist (default: vite)',
          '  --swiftshader        Use ANGLE SwiftShader software WebGL2 in Edge',
          '  --strict             Treat PENDING_MILESTONE as FAIL',
          '  --verbose, -v        Print per-test output',
        ].join('\n')
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  return opts;
}

async function runBrowserSuites(opts, rootDir) {
  const browserDir = path.resolve(rootDir, 'tests', 'e2e', 'browser');
  if (!fs.existsSync(browserDir)) {
    return [];
  }

  const candidateFiles = [];
  for (const tier of opts.tiers) {
    const files = fs
      .readdirSync(browserDir)
      .filter((f) => f.startsWith(`tier${tier}_`) && f.endsWith('.e2e.mjs'))
      .sort();
    for (const f of files) {
      candidateFiles.push({ tier, file: f, absPath: path.join(browserDir, f) });
    }
  }

  if (candidateFiles.length === 0) {
    return [];
  }

  let server = null;
  let browser = null;
  const activeSessions = new Set();

  const cleanupAll = async () => {
    for (const s of Array.from(activeSessions)) {
      await s.close().catch(() => {});
      activeSessions.delete(s);
    }
    if (browser) {
      const b = browser;
      browser = null;
      await b.close().catch(() => {});
    }
    if (server) {
      const srv = server;
      server = null;
      await srv.close().catch(() => {});
    }
  };

  const onSignal = (sig) => {
    console.error(`\nReceived ${sig}, cleaning up Edge & server...`);
    cleanupAll().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    server = await startAppServer({ rootDir, mode: opts.serve });
    browser = await launchEdgeBrowser({ swiftshader: opts.swiftshader });

    const trackedCreateSession = async (preset, sessionOpts) => {
      const session = await browser.createSession(preset, sessionOpts);
      activeSessions.add(session);
      const origClose = session.close.bind(session);
      session.close = async () => {
        activeSessions.delete(session);
        return origClose();
      };
      return session;
    };

    const ctx = {
      rootDir,
      serverUrl: server.url,
      serveMode: opts.serve,
      swiftshader: opts.swiftshader,
      browser,
      createSession: trackedCreateSession,
      VIEWPORT_PRESETS,
      requireCapability,
      PendingMilestoneError,
    };

    const allBrowserTests = [];
    for (const item of candidateFiles) {
      const mod = await import(pathToFileURL(item.absPath).href);
      if (typeof mod.registerBrowserTests !== 'function') {
        throw new Error(`${item.file} must export function registerBrowserTests(register, ctx)`);
      }
      const collector = createSuiteCollector(item.tier);
      await mod.registerBrowserTests(collector.register, ctx);
      allBrowserTests.push(...collector.tests);
    }

    return await runRegisteredTests(allBrowserTests, {
      timeoutMs: Math.max(opts.timeoutMs, 30000),
      strict: opts.strict,
      verbose: opts.verbose,
      afterEach: async () => {
        // Ensure zero leaked browser tabs between tests
        for (const s of Array.from(activeSessions)) {
          await s.close().catch(() => {});
          activeSessions.delete(s);
        }
      },
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanupAll();
  }
}

async function main() {
  const rootDir = process.cwd();
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const results = [];

  if (opts.mode === 'node' || opts.mode === 'all') {
    if (opts.verbose) {
      console.log(`Running Node/Asset E2E suites (tiers: ${opts.tiers.join(',')})...`);
    }
    const nodeResults = await runNodeSuites({
      rootDir,
      tiers: opts.tiers,
      strict: opts.strict,
      verbose: opts.verbose,
      timeoutMs: 15000,
    });
    results.push(...nodeResults);
  }

  if (opts.mode === 'browser' || opts.mode === 'all') {
    if (opts.verbose) {
      console.log(
        `Running Edge CDP Browser E2E suites (tiers: ${opts.tiers.join(',')}, serve: ${opts.serve}, swiftshader: ${opts.swiftshader})...`
      );
    }
    const browserResults = await runBrowserSuites(opts, rootDir);
    results.push(...browserResults);
  }

  const summary = summarizeResults(results);
  const reportDir = path.resolve(rootDir, 'test-results', 'e2e');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'report.json');

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    options: opts,
    summary,
    results,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(formatSummaryTable(results));
  console.log(
    `Result counts: PASS=${summary.pass}, FAIL=${summary.fail}, PENDING_MILESTONE=${summary.pending} (Total=${summary.total})`
  );
  console.log(`JSON report written to ${path.relative(rootDir, reportPath)}`);

  const exitCode = summary.fail === 0 && summary.pending === 0 ? 0 : 1;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('E2E runner fatal error:', err);
  process.exit(1);
});
