export class PendingMilestoneError extends Error {
  /**
   * @param {string} milestone
   * @param {string} feature
   * @param {string} message
   */
  constructor(milestone, feature, message) {
    const label = feature ? `${milestone} / ${feature}` : milestone;
    super(`[${label}] ${message}`);
    this.name = 'PendingMilestoneError';
    this.milestone = milestone;
    this.feature = feature;
  }
}

/**
 * Asserts that an M1–M5 capability/contract exists before executing assertions.
 * When missing, throws `PendingMilestoneError` so the runner classifies the test
 * as `PENDING_MILESTONE` (or `FAIL` under `--strict` / M6 gate).
 *
 * @param {unknown} condition
 * @param {string} milestone
 * @param {string} feature
 * @param {string} message
 */
export function requireCapability(condition, milestone, feature, message) {
  if (!condition) {
    throw new PendingMilestoneError(milestone, feature, message);
  }
}

/**
 * Creates a test collector bound to a default tier number (1..4).
 *
 * @param {number} defaultTier
 */
export function createSuiteCollector(defaultTier = 1) {
  /** @type {Array<{ id: string, tier: number, feature: string, mode: string, title: string, fn: Function }>} */
  const tests = [];

  /**
   * @param {{ id: string, tier?: number, feature?: string, mode?: string, title?: string, name?: string }} meta
   * @param {Function} fn
   */
  function register(meta, fn) {
    if (!meta || !meta.id) {
      throw new Error('Test registration requires meta.id');
    }
    if (typeof fn !== 'function') {
      throw new Error(`Test ${meta.id} requires a test function`);
    }
    tests.push({
      id: String(meta.id),
      tier: Number(meta.tier ?? defaultTier),
      feature: String(meta.feature ?? 'GENERAL'),
      mode: String(meta.mode ?? 'NODE').toUpperCase(),
      title: String(meta.title ?? meta.name ?? meta.id),
      fn,
    });
  }

  return { tests, register };
}

/**
 * Runs registered tests sequentially with a strict per-test `Promise.race` timeout guard.
 *
 * @param {Array<{ id: string, tier: number, feature: string, mode: string, title: string, fn: Function }>} tests
 * @param {{ timeoutMs?: number, strict?: boolean, verbose?: boolean, beforeEach?: Function, afterEach?: Function, contextFactory?: Function }} [options]
 */
export async function runRegisteredTests(tests, options = {}) {
  const {
    timeoutMs = 15000,
    strict = false,
    verbose = false,
    beforeEach,
    afterEach,
    contextFactory,
  } = options;

  const results = [];

  for (const test of tests) {
    const startedAt = Date.now();
    let timer = null;
    let status = 'PASS';
    let errorMessage = null;
    let errorStack = null;
    let milestone = null;

    try {
      if (beforeEach) {
        await beforeEach(test);
      }

      const ctx = contextFactory ? await contextFactory(test) : undefined;

      const execPromise = Promise.resolve().then(() => test.fn(ctx));
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Test ${test.id} timed out after ${timeoutMs}ms (possible softlock or hang)`));
        }, timeoutMs);
      });

      await Promise.race([execPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof PendingMilestoneError || err?.name === 'PendingMilestoneError') {
        milestone = err.milestone ?? null;
        if (strict) {
          status = 'FAIL';
          errorMessage = `[STRICT] ${err.message}`;
          errorStack = err.stack ?? null;
        } else {
          status = 'PENDING_MILESTONE';
          errorMessage = err.message;
        }
      } else {
        status = 'FAIL';
        errorMessage = err instanceof Error ? err.message : String(err);
        errorStack = err instanceof Error ? err.stack ?? null : null;
      }
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (afterEach) {
        try {
          await afterEach(test, status);
        } catch (cleanupErr) {
          if (status === 'PASS') {
            status = 'FAIL';
            errorMessage = `afterEach cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`;
          }
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    const entry = {
      id: test.id,
      tier: test.tier,
      feature: test.feature,
      mode: test.mode,
      title: test.title,
      status,
      milestone,
      durationMs,
      error: errorMessage,
      stack: status === 'FAIL' ? errorStack : null,
    };
    results.push(entry);

    if (verbose || status === 'FAIL') {
      const icon = status === 'PASS' ? 'PASS' : status === 'PENDING_MILESTONE' ? 'PEND' : 'FAIL';
      const suffix = errorMessage ? ` — ${errorMessage}` : '';
      console.log(`  [${icon}] ${entry.id} (${entry.mode}, ${entry.durationMs}ms): ${entry.title}${suffix}`);
    }
  }

  return results;
}

/**
 * Computes aggregate counts across tiers and execution modes.
 *
 * @param {Array<{ tier: number, mode: string, status: string, durationMs: number }>} results
 */
export function summarizeResults(results) {
  const byTier = {};
  const byMode = {};
  let pass = 0;
  let fail = 0;
  let pending = 0;
  let durationMs = 0;

  for (const r of results) {
    durationMs += r.durationMs || 0;
    const tierKey = String(r.tier);
    if (!byTier[tierKey]) {
      byTier[tierKey] = { total: 0, pass: 0, fail: 0, pending: 0, durationMs: 0 };
    }
    const modeKey = String(r.mode || 'UNKNOWN');
    if (!byMode[modeKey]) {
      byMode[modeKey] = { total: 0, pass: 0, fail: 0, pending: 0, durationMs: 0 };
    }

    byTier[tierKey].total += 1;
    byTier[tierKey].durationMs += r.durationMs || 0;
    byMode[modeKey].total += 1;
    byMode[modeKey].durationMs += r.durationMs || 0;

    if (r.status === 'PASS') {
      pass += 1;
      byTier[tierKey].pass += 1;
      byMode[modeKey].pass += 1;
    } else if (r.status === 'PENDING_MILESTONE') {
      pending += 1;
      byTier[tierKey].pending += 1;
      byMode[modeKey].pending += 1;
    } else {
      fail += 1;
      byTier[tierKey].fail += 1;
      byMode[modeKey].fail += 1;
    }
  }

  return {
    total: results.length,
    pass,
    fail,
    pending,
    durationMs,
    byTier,
    byMode,
  };
}

/**
 * Formats a concise multi-tier summary table + failure/pending breakdown.
 *
 * @param {Array<{ id: string, tier: number, mode: string, title: string, status: string, durationMs: number, error: string | null }>} results
 */
export function formatSummaryTable(results) {
  const s = summarizeResults(results);
  const lines = [];
  lines.push('');
  lines.push('=== War Generals (Salpakan) E2E Summary ===');
  lines.push('Tier     | Total |  PASS |  FAIL |  PEND | Time(ms)');
  lines.push('---------+-------+-------+-------+-------+---------');

  const tierKeys = Object.keys(s.byTier).sort((a, b) => Number(a) - Number(b));
  for (const k of tierKeys) {
    const t = s.byTier[k];
    lines.push(
      `Tier ${k.padEnd(3)} | ${String(t.total).padStart(5)} | ${String(t.pass).padStart(5)} | ${String(t.fail).padStart(5)} | ${String(t.pending).padStart(5)} | ${String(t.durationMs).padStart(8)}`
    );
  }
  lines.push('---------+-------+-------+-------+-------+---------');
  lines.push(
    `TOTAL    | ${String(s.total).padStart(5)} | ${String(s.pass).padStart(5)} | ${String(s.fail).padStart(5)} | ${String(s.pending).padStart(5)} | ${String(s.durationMs).padStart(8)}`
  );

  const failures = results.filter((r) => r.status === 'FAIL');
  if (failures.length > 0) {
    lines.push('');
    lines.push(`Failures (${failures.length}):`);
    for (const f of failures) {
      lines.push(`  - [${f.id}] (${f.mode}) ${f.title}: ${f.error}`);
    }
  }

  const pendings = results.filter((r) => r.status === 'PENDING_MILESTONE');
  if (pendings.length > 0) {
    lines.push('');
    lines.push(`Pending Milestones (${pendings.length}):`);
    for (const p of pendings) {
      lines.push(`  - [${p.id}] ${p.error}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
