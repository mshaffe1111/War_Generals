// Opaque-box WebGL2, WebAudio, Layout, Projection & CDP Session Helpers for War Generals E2E Browser Suites
// Strictly public-surface: NEVER accesses `#truthPieces` or injects fake victories.

import assert from 'node:assert/strict';

export const RANKS_15 = [
  'GEN_5',
  'GEN_4',
  'GEN_3',
  'GEN_2',
  'GEN_1',
  'COLONEL',
  'LT_COLONEL',
  'MAJOR',
  'CAPTAIN',
  'LT_1ST',
  'LT_2ND',
  'SERGEANT',
  'PRIVATE',
  'SPY',
  'FLAG',
];

export const THEATERS_4 = ['FIELD_HQ', 'PACIFIC_BRIDGE', 'IRON_BUNKER', 'NIGHT_OPS'];
export const CHOREOGRAPHIES_6 = [
  'INFANTRY',
  'RECON_STEALTH',
  'ARMOR_ARTILLERY',
  'HIGH_COMMAND',
  'MUTUAL_SPLIT',
  'FLAG_BREACH',
];
export const QUALITY_TIERS_5 = ['AUTO', 'ULTRA', 'HIGH', 'BALANCED', 'BATTERY_SAVER'];

export const DEFAULT_PRESETS = {
  MOBILE_PORTRAIT: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, hasTouch: true },
  MOBILE_LANDSCAPE: { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, hasTouch: true },
  DESKTOP_LAPTOP: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, hasTouch: false },
  DESKTOP_WIDE: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, hasTouch: false },
};

export function resolvePreset(ctx, name) {
  return (ctx?.VIEWPORT_PRESETS && ctx.VIEWPORT_PRESETS[name]) || DEFAULT_PRESETS[name];
}

export function getBaseUrl(ctx) {
  return ctx?.serverUrl || ctx?.baseUrl;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a browser test inside an isolated Edge CDP tab (fast ~30ms target creation inside shared Edge browser).
 * Automatically navigates to the app URL, installs optional WebAudio spy, asserts zero console/page/404 errors,
 * and closes the tab cleanly in `finally`.
 */
export async function withSession(ctx, presetOrName, opts, fn) {
  let options = opts;
  let callback = fn;
  if (typeof opts === 'function') {
    callback = opts;
    options = {};
  }
  const {
    allowErrors = false,
    allow404 = false,
    skipInitialLoad = false,
    installAudioSpy = false,
    fresh = true,
  } = options || {};

  const preset =
    typeof presetOrName === 'string'
      ? resolvePreset(ctx, presetOrName)
      : presetOrName || resolvePreset(ctx, 'MOBILE_PORTRAIT');

  const createFn = ctx?.createSession
    ? (p) => ctx.createSession(p, { fresh })
    : (p) => ctx.browser.createSession(p, { fresh });

  const baseUrl = getBaseUrl(ctx);
  const rawSession = await createFn(preset);
  const origGetRect = rawSession.getRect.bind(rawSession);
  const session = {
    ...rawSession,
    getRect: async (sel) => {
      const r = await origGetRect(sel);
      if (!r) return null;
      return {
        ...r,
        left: r.x,
        top: r.y,
        right: r.x + r.width,
        bottom: r.y + r.height,
      };
    },
  };

  try {
    if (!skipInitialLoad) {
      await session.goto(baseUrl, { waitUntilLoad: true, timeoutMs: 12000 }).catch(() => {});
      try {
        await waitForTitleScreen(session, 14000);
      } catch {
        // Recover from rare transient headless tab-boot stall before failing
        await session.goto(baseUrl, { waitUntilLoad: false, timeoutMs: 15000 }).catch(() => {});
        await waitForTitleScreen(session, 14000);
      }
      if (installAudioSpy) {
        await installWebAudioSpy(session);
      }
    }

    const res = await callback(session);
    if (!allowErrors) {
      await assertNoConsoleOrPageErrors(session, { allow404 });
    }
    return res;
  } finally {
    try {
      await session.clearInterceptions().catch(() => {});
      await session.close();
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function waitForTitleScreen(session, timeoutMs = 25000) {
  await session.waitFor(
    () => {
      const title = document.querySelector('#title-screen');
      const canvas = document.querySelector('#canvas-host canvas');
      if (!title || title.hasAttribute('hidden')) return false;
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 10 && rect.height > 10 && Boolean(window.__WAR_GENERALS_STAGE__);
    },
    { timeoutMs, intervalMs: 50 }
  );
}

export async function reloadToTitle(session, timeoutMs = 25000) {
  await session.evaluate(() => {
    window.__WG_PRE_RELOAD__ = true;
  });
  await session.reload({ waitUntilLoad: false, timeoutMs });
  await session.waitFor(() => !window.__WG_PRE_RELOAD__, { timeoutMs, intervalMs: 50 });
  await waitForTitleScreen(session, timeoutMs);
}

export async function assertNoConsoleOrPageErrors(session, { allow404 = false } = {}) {
  const errs = await session.getErrors();
  const pageErrors = errs?.pageErrors || [];
  const consoleErrors = errs?.consoleErrors || [];
  const failedRequests = errs?.failedRequests || [];

  assert.equal(pageErrors.length, 0, `Uncaught pageErrors: ${JSON.stringify(pageErrors)}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${JSON.stringify(consoleErrors)}`);
  if (!allow404) {
    const realFails = failedRequests.filter((r) => {
      const url = typeof r === 'string' ? r : r?.url || '';
      return !url.includes('fonts.googleapis.com') && !url.includes('fonts.gstatic.com');
    });
    assert.equal(realFails.length, 0, `Unexpected failed network requests: ${JSON.stringify(realFails)}`);
  }
}

export async function getStageCapabilities(session) {
  return session.evaluate(() => {
    const stage = window.__WAR_GENERALS_STAGE__ || {};
    const keys = Object.keys(stage);
    const hasOpsBtn = Boolean(
      document.querySelector('#btn-menu-operations, [data-menu-operations], [data-mode="OPERATION"]')
    );
    const hasTheaterUi = Boolean(
      document.querySelector('#seg-theater, [data-theater], #select-theater')
    );
    const hasSkipBtn = Boolean(
      document.querySelector('#btn-skip-cutscene, [data-skip-cutscene], .arbiter-skip-btn') ||
        Array.from(document.querySelectorAll('button')).some((b) => /\bskip\b/i.test(b.textContent || ''))
    );
    const hasResetCamBtn = Boolean(
      document.querySelector('#btn-reset-camera, [data-reset-camera], #btn-cam-reset')
    );
    const hasFrameModeUi = Boolean(
      document.querySelector('#seg-frame-mode, [data-frame-mode], [data-viewport-frame]')
    );
    const hasTelemetry = typeof (stage.getTelemetry || stage.getStageTelemetry || stage.getSnapshot) === 'function';
    const hasQualityControls =
      document.querySelectorAll('#seg-quality button').length >= 4 ||
      Boolean(document.querySelector('[data-quality="AUTO"]'));
    const has8Presets = document.querySelectorAll('[data-dep-preset]').length >= 8;
    const hasImgPortraits = document.querySelectorAll('.cmd-portrait-box img').length >= 6;
    const hasImgRanks = document.querySelectorAll('#mob-chip-grid img, .crate-rank-chip img').length >= 15;

    return {
      stageKeys: keys,
      hasSetTheater: typeof stage.setTheater === 'function',
      hasResetCameraOrbit: typeof stage.resetCameraOrbit === 'function',
      hasSetViewportFrameMode: typeof stage.setViewportFrameMode === 'function',
      hasSkipArbiterCutscene: typeof stage.skipArbiterCutscene === 'function',
      hasGetTelemetry: hasTelemetry,
      hasProjectBoardCoord: typeof (stage.projectBoardCoord || stage.projectTileToScreen) === 'function',
      hasSimulateFrameDt: typeof (stage.simulateFrameDt || stage.injectFrameDt) === 'function',
      hasOpsBtn,
      hasTheaterUi,
      hasSkipBtn,
      hasResetCamBtn,
      hasFrameModeUi,
      hasQualityControls,
      has8Presets,
      hasImgPortraits,
      hasImgRanks,
    };
  });
}

export async function getStageTelemetry(session) {
  return session.evaluate(() => {
    const stage = window.__WAR_GENERALS_STAGE__ || {};
    const fn = stage.getTelemetry || stage.getStageTelemetry || stage.getSnapshot;
    if (typeof fn !== 'function') return null;
    return fn.call(stage);
  });
}

export async function findVisibleSelector(session, selectors) {
  return session.evaluate((sels) => {
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && !el.hasAttribute('hidden')) {
        const st = window.getComputedStyle(el);
        if (st.display !== 'none' && st.visibility !== 'hidden') {
          return sel;
        }
      }
    }
    return null;
  }, selectors);
}

export async function findAnySelector(session, selectors) {
  return session.evaluate((sels) => {
    for (const sel of sels) {
      if (document.querySelector(sel)) return sel;
    }
    return null;
  }, selectors);
}

export async function isVisible(session, selector) {
  return session.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hasAttribute('hidden')) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, selector);
}

export async function getText(session, selector) {
  return session.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || '').trim() : null;
  }, selector);
}

export async function startSkirmishToDeploy(session, { commander = 'MILLER', era = null, difficulty = null } = {}) {
  await session.clickSelector('#btn-menu-skirmish');
  await session.waitFor(() => {
    const p = document.querySelector('#title-sub-skirmish');
    return p && !p.hasAttribute('hidden');
  });
  if (commander) {
    await session.clickSelector(`[data-skirmish-cmd="${commander}"]`);
  }
  if (era) {
    await session.clickSelector(`#seg-skirmish-era button[data-sk-era="${era}"]`);
  }
  if (difficulty) {
    await session.clickSelector(`#seg-skirmish-diff button[data-sk-diff="${difficulty}"]`);
  }
  await session.clickSelector('#btn-start-skirmish');
  await session.waitFor(() => {
    const d = document.querySelector('#mobilization-drawer');
    return d && !d.hasAttribute('hidden');
  });
}

export async function deployPresetAndLaunch(session, preset = 'VACCINATION') {
  await session.clickSelector(`[data-dep-preset="${preset}"]`);
  await session.waitFor(() => {
    const pill = document.querySelector('#mob-count-pill');
    const btn = document.querySelector('#btn-launch-battle');
    return pill && pill.textContent?.trim() === '21 / 21' && btn && !btn.disabled;
  });
  await session.clickSelector('#btn-launch-battle');
  await session.waitFor(() => {
    const trio = document.querySelector('#play-top-trio');
    const dock = document.querySelector('#play-bottom-dock');
    const shroud = document.querySelector('#command-shroud');
    const inPlay = trio && !trio.hasAttribute('hidden') && dock && !dock.hasAttribute('hidden');
    const inShroud = shroud && !shroud.hasAttribute('hidden');
    return Boolean(inPlay || inShroud);
  });
  await sleep(450);
}

export async function startPlayViaUI(session, opts = {}) {
  await startSkirmishToDeploy(session, opts);
  await deployPresetAndLaunch(session, opts.preset || 'VACCINATION');
}

export async function waitForTurnActive(session, timeoutMs = 15000) {
  await session.waitFor(
    () => {
      const dock = document.querySelector('#play-bottom-dock');
      const turnText = document.querySelector('#text-turn-state')?.textContent?.trim() || '';
      if (!dock || dock.hasAttribute('hidden')) return false;
      return turnText === 'YOUR TURN' || turnText === 'NAVY TURN' || turnText === 'CRIMSON TURN';
    },
    { timeoutMs, intervalMs: 80 }
  );
  // Allow Three.js exponential camera damper (speed 8.5) to settle after DEPLOY -> PLAY or ARBITER -> PLAY
  await sleep(450);
}

export async function waitForArbiterResolved(session, timeoutMs = 15000) {
  await session.waitFor(
    () => {
      const dock = document.querySelector('#play-bottom-dock');
      const dossier = document.querySelector('#dossier-card');
      const shroud = document.querySelector('#command-shroud');
      const dockVis = dock && !dock.hasAttribute('hidden');
      const dosVis = dossier && !dossier.hasAttribute('hidden');
      const shroudVis = shroud && !shroud.hasAttribute('hidden');
      return Boolean(dockVis || dosVis || shroudVis);
    },
    { timeoutMs, intervalMs: 80 }
  );
}

export async function performTwoStepSurrender(session) {
  await session.clickSelector('#btn-dock-surrender');
  await session.waitFor(
    () => document.querySelector('#btn-dock-surrender')?.getAttribute('data-armed') === 'true',
    { timeoutMs: 5000, intervalMs: 40 }
  );
  const r = await session.getRect('#btn-dock-surrender');
  await session.longPress(r.cx, r.cy, 1150);
  await session.waitFor(
    () => !document.querySelector('#dossier-card')?.hasAttribute('hidden'),
    { timeoutMs: 8000, intervalMs: 60 }
  );
}

/**
 * Projects a visual board coordinate (vCol in 0..8, vRow in 0..7) at height worldY
 * to browser client coordinates (x, y) using live stage projection if present,
 * otherwise exact SceneManager camera math.
 */
export async function projectBoardCoord(
  session,
  vCol,
  vRow,
  { worldY = 0.08, boardView = 'COMMAND', phase = 'PLAY', handedness = 'RIGHT' } = {}
) {
  return session.evaluate(
    ({ c, r, wy, bv, ph, hand }) => {
      const stage = window.__WAR_GENERALS_STAGE__ || {};
      const projFn = stage.projectBoardCoord || stage.projectTileToScreen;
      if (typeof projFn === 'function') {
        const pt = projFn.call(stage, c, r, wy);
        if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
          return { x: pt.x, y: pt.y, source: 'stage' };
        }
      }

      const canvas = document.querySelector('#canvas-host canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const aspect = Math.max(0.38, rect.width / Math.max(1, rect.height));
      const isLandscape = aspect >= 0.88;
      const inDeploy = ph === 'DEPLOY' || ph === 'ARMORY';
      const inReplay = ph === 'REPLAY';
      const inGameOver = ph === 'GAME_OVER';

      let camPos;
      let camLook;
      let fovDeg;

      if (isLandscape) {
        const rightPanelOpen = inDeploy || inGameOver;
        const presets = {
          COMMAND: {
            pitchDeg: rightPanelOpen ? 47.0 : inReplay ? 45.0 : 43.0,
            fovDeg: 38,
            heightOcc: rightPanelOpen ? 0.76 : inReplay ? 0.72 : 0.8,
            lookZ: rightPanelOpen ? -0.15 : inReplay ? 0.85 : -0.1,
          },
          TACTICAL: {
            pitchDeg: 32.5,
            fovDeg: 38,
            heightOcc: inReplay ? 0.72 : 0.78,
            lookZ: inReplay ? 0.85 : 0.1,
          },
          OVERHEAD: {
            pitchDeg: 62.0,
            fovDeg: 36,
            heightOcc: inReplay ? 0.73 : 0.8,
            lookZ: inReplay ? 0.75 : -0.35,
          },
        };
        const spec = presets[bv] || presets.COMMAND;
        fovDeg = spec.fovDeg;
        const pitchRad = (spec.pitchDeg * Math.PI) / 180;
        const halfFov = ((fovDeg * 0.5) * Math.PI) / 180;
        const projBoardH = 12.36 * Math.sin(pitchRad) + 1.05 * Math.cos(pitchRad);
        const effAspect = rightPanelOpen ? aspect * 0.62 : aspect;
        const rHeight = projBoardH / spec.heightOcc / (2 * Math.tan(halfFov));
        const rWidth = 11.2 / (2 * Math.tan(halfFov) * effAspect);
        const rDist = Math.max(rHeight, rWidth);
        const handSign = hand === 'LEFT' ? -1 : 1;
        const lookX = rightPanelOpen ? 2.55 * handSign : 0;
        const lookY = -0.12;
        camLook = [lookX, lookY, spec.lookZ];
        camPos = [lookX, lookY + rDist * Math.sin(pitchRad), spec.lookZ + rDist * Math.cos(pitchRad)];
      } else {
        const bottomLock = inDeploy || inGameOver ? -0.22 : inReplay ? -0.5 : -0.68;
        const presets = {
          COMMAND: { pitchDeg: inDeploy ? 46.0 : inReplay ? 48.0 : 41.0, fovDeg: 43, widthOcc: 0.98 },
          TACTICAL: { pitchDeg: 32.5, fovDeg: 46, widthOcc: 0.98 },
          OVERHEAD: { pitchDeg: 62.0, fovDeg: 41, widthOcc: 0.965 },
        };
        const spec = presets[bv] || presets.COMMAND;
        fovDeg = spec.fovDeg;
        const halfFov = ((fovDeg * 0.5) * Math.PI) / 180;
        const pitchRad = (spec.pitchDeg * Math.PI) / 180;
        const zEyeFront = 10.18 / spec.widthOcc / (2 * Math.tan(halfFov) * aspect);
        const yEyeFront = bottomLock * zEyeFront * Math.tan(halfFov);
        const sinP = Math.sin(pitchRad);
        const cosP = Math.cos(pitchRad);
        const camY = -0.55 - (zEyeFront * -sinP + yEyeFront * cosP);
        const camZ = 5.65 - (zEyeFront * -cosP + yEyeFront * -sinP);
        camPos = [0, camY, camZ];
        camLook = [0, camY - sinP * zEyeFront, camZ - cosP * zEyeFront];
      }

      const wx = (c - 4) * 1.0;
      const wz = (r - 3.5) * 1.0 + 0.85;
      const wp = [wx, wy, wz];

      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const norm = (v) => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };

      const fwd = norm(sub(camLook, camPos));
      const right = norm(cross(fwd, [0, 1, 0]));
      const up = cross(right, fwd);

      const rel = sub(wp, camPos);
      const cx = dot(rel, right);
      const cy = dot(rel, up);
      const cz = dot(rel, fwd);
      if (cz <= 0.1) return null;

      const tanHalfFov = Math.tan(((fovDeg * 0.5) * Math.PI) / 180);
      const ndcY = cy / (cz * tanHalfFov);
      const ndcX = cx / (cz * tanHalfFov * aspect);

      return {
        x: rect.left + ((ndcX + 1) * 0.5) * rect.width,
        y: rect.top + ((1 - ndcY) * 0.5) * rect.height,
        source: 'math',
      };
    },
    { c: vCol, r: vRow, wy: worldY, bv: boardView, ph: phase, hand: handedness }
  );
}

export async function tapBoardCoord(session, vCol, vRow, opts = {}) {
  const pt = await projectBoardCoord(session, vCol, vRow, opts);
  assert.ok(pt, `Failed to project board coordinate (${vCol}, ${vRow})`);
  await session.tapPoint(pt.x, pt.y, opts.isTouch !== undefined ? { isTouch: opts.isTouch } : undefined);
  return pt;
}

export async function dragBoardCoords(session, c1, r1, c2, r2, opts = {}) {
  const p1 = await projectBoardCoord(session, c1, r1, opts);
  const p2 = await projectBoardCoord(session, c2, r2, { ...opts, worldY: opts.dropWorldY ?? 0 });
  assert.ok(p1 && p2, `Failed to project drag coordinates (${c1},${r1}) -> (${c2},${r2})`);
  const dropOffsetY = opts.dropOffsetY ?? 0;
  const dragOpts = {
    steps: opts.steps ?? 12,
    holdBeforeMoveMs: opts.holdBeforeMoveMs ?? 40,
    cancel: opts.cancel ?? false,
  };
  if (opts.isTouch !== undefined) dragOpts.isTouch = opts.isTouch;
  await session.dragPoints(p1.x, p1.y, p2.x, p2.y + dropOffsetY, dragOpts);
  return { p1, p2 };
}

export async function longPressBoardCoord(session, vCol, vRow, holdMs = 380, opts = {}) {
  const pt = await projectBoardCoord(session, vCol, vRow, opts);
  assert.ok(pt, `Failed to project board coordinate (${vCol}, ${vRow}) for longPress`);
  await session.longPress(pt.x, pt.y, holdMs, opts.isTouch !== undefined ? { isTouch: opts.isTouch } : undefined);
  return pt;
}

export async function assertViewportFillAndNoOverflow(
  session,
  expectedW,
  expectedH,
  { expectFullBleed = true, expectPhoneFrame = false, strictNoOverlap = false } = {}
) {
  const m = await session.evaluate(() => {
    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    const docEl = document.documentElement;
    const chassis = document.querySelector('#app-chassis');
    const canvas = document.querySelector('#canvas-host canvas');
    const chassisRect = chassis ? chassis.getBoundingClientRect() : null;
    const canvasRect = canvas ? canvas.getBoundingClientRect() : null;

    const candidates = Array.from(
      document.querySelectorAll(
        'button, .menu-command-card, .dock-btn, .clock-pill, .state-banner-pill, .crate-rank-chip, .manual-rank-pill'
      )
    );
    const collapsed = [];
    const clipped = [];
    const visibleButtons = [];

    for (const el of candidates) {
      if (el.closest('[hidden]')) continue;
      let cur = el;
      let isHidden = false;
      while (cur && cur !== document.body) {
        if (cur.hasAttribute('hidden')) {
          isHidden = true;
          break;
        }
        const st = window.getComputedStyle(cur);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') {
          isHidden = true;
          break;
        }
        cur = cur.parentElement;
      }
      if (isHidden) continue;

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        collapsed.push({ id: el.id || el.className, w: r.width, h: r.height });
      } else {
        if (r.left < -3 || r.top < -3 || r.right > innerW + 3 || r.bottom > innerH + 3) {
          clipped.push({
            id: el.id || el.className,
            left: Math.round(r.left),
            top: Math.round(r.top),
            right: Math.round(r.right),
            bottom: Math.round(r.bottom),
            innerW,
            innerH,
          });
        }
        visibleButtons.push({
          id: el.id || el.className,
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        });
      }
    }

    const overlaps = [];
    for (let i = 0; i < visibleButtons.length; i++) {
      for (let j = i + 1; j < visibleButtons.length; j++) {
        const a = visibleButtons[i];
        const b = visibleButtons[j];
        const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (ix > 4 && iy > 4) {
          overlaps.push([a.id, b.id]);
        }
      }
    }

    return {
      innerW,
      innerH,
      scrollW: docEl.scrollWidth,
      scrollH: docEl.scrollHeight,
      chassisRect: chassisRect
        ? {
            x: chassisRect.left,
            y: chassisRect.top,
            w: chassisRect.width,
            h: chassisRect.height,
          }
        : null,
      canvasRect: canvasRect
        ? {
            x: canvasRect.left,
            y: canvasRect.top,
            w: canvasRect.width,
            h: canvasRect.height,
            cw: canvas.width,
            ch: canvas.height,
          }
        : null,
      collapsed,
      clipped,
      overlaps,
    };
  });

  assert.ok(Math.abs(m.innerW - expectedW) <= 2, `Expected innerWidth ~${expectedW}, got ${m.innerW}`);
  assert.ok(Math.abs(m.innerH - expectedH) <= 2, `Expected innerHeight ~${expectedH}, got ${m.innerH}`);
  assert.ok(m.scrollW <= m.innerW + 1, `Horizontal overflow: scrollWidth=${m.scrollW} > innerWidth=${m.innerW}`);
  assert.ok(m.chassisRect, '#app-chassis missing');
  assert.ok(m.canvasRect, '<canvas> missing');
  assert.ok(m.canvasRect.cw > 0 && m.canvasRect.ch > 0, 'WebGL canvas backing dimensions are 0');

  if (expectFullBleed) {
    assert.ok(
      Math.abs(m.chassisRect.w - m.innerW) <= 3 && Math.abs(m.chassisRect.h - m.innerH) <= 3,
      `Expected full-bleed #app-chassis (${m.innerW}x${m.innerH}), got ${m.chassisRect.w}x${m.chassisRect.h}`
    );
    assert.ok(
      Math.abs(m.canvasRect.w - m.chassisRect.w) <= 3 && Math.abs(m.canvasRect.h - m.chassisRect.h) <= 3,
      `Canvas (${m.canvasRect.w}x${m.canvasRect.h}) does not fill #app-chassis (${m.chassisRect.w}x${m.chassisRect.h})`
    );
  }

  if (expectPhoneFrame) {
    const ratio = m.chassisRect.w / Math.max(1, m.chassisRect.h);
    assert.ok(
      ratio >= 0.53 && ratio <= 0.59,
      `Expected ~9:16 phone chassis aspect (0.5625), got ${ratio.toFixed(3)} (${m.chassisRect.w}x${m.chassisRect.h})`
    );
  }

  assert.equal(m.collapsed.length, 0, `Collapsed 0px HUD elements found: ${JSON.stringify(m.collapsed)}`);
  assert.equal(m.clipped.length, 0, `Clipped HUD elements outside viewport: ${JSON.stringify(m.clipped)}`);
  if (strictNoOverlap) {
    assert.equal(m.overlaps.length, 0, `Overlapping HUD elements: ${JSON.stringify(m.overlaps)}`);
  }
  return m;
}

export async function analyzePng(session, pngBase64) {
  return session.evaluate(async (b64) => {
    const clean = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
    const img = new Image();
    img.src = clean;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const w = 16;
    const h = 16;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const signature = [];
    let sumLuma = 0;
    let nonBlack = 0;
    const lumas = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      signature.push(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumas.push(luma);
      sumLuma += luma;
      if (r + g + b > 18) nonBlack++;
    }
    const n = lumas.length || 1;
    const meanLuma = sumLuma / n;
    let varSum = 0;
    for (const l of lumas) varSum += (l - meanLuma) ** 2;
    const stdLuma = Math.sqrt(varSum / n);
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      meanLuma,
      stdLuma,
      nonBlackRatio: nonBlack / n,
      signature,
    };
  }, pngBase64);
}

export async function analyzePngRegion(session, pngBase64, cx, cy, halfBox = 18) {
  return session.evaluate(
    async ({ b64, x, y, hb }) => {
      const clean = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
      const img = new Image();
      img.src = clean;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const scaleX = img.naturalWidth / Math.max(1, window.innerWidth);
      const scaleY = img.naturalHeight / Math.max(1, window.innerHeight);
      const natCx = x * scaleX;
      const natCy = y * scaleY;
      const natHalfX = Math.max(1, hb * scaleX);
      const natHalfY = Math.max(1, hb * scaleY);
      const sx = Math.max(0, Math.min(img.naturalWidth - 2, Math.floor(natCx - natHalfX)));
      const sy = Math.max(0, Math.min(img.naturalHeight - 2, Math.floor(natCy - natHalfY)));
      const sw = Math.max(2, Math.min(img.naturalWidth - sx, Math.ceil(natHalfX * 2)));
      const sh = Math.max(2, Math.min(img.naturalHeight - sy, Math.ceil(natHalfY * 2)));

      const w = 16;
      const h = 16;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const signature = [];
      let sumLuma = 0;
      let nonBlack = 0;
      const lumas = [];
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        signature.push(r, g, b);
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lumas.push(luma);
        sumLuma += luma;
        if (r + g + b > 18) nonBlack++;
      }
      const n = lumas.length || 1;
      const meanLuma = sumLuma / n;
      let varSum = 0;
      for (const l of lumas) varSum += (l - meanLuma) ** 2;
      const stdLuma = Math.sqrt(varSum / n);
      return {
        width: sw,
        height: sh,
        meanLuma,
        stdLuma,
        nonBlackRatio: nonBlack / n,
        signature,
      };
    },
    { b64: pngBase64, x: cx, y: cy, hb: halfBox }
  );
}

export function diffPngSignatures(sigA, sigB) {
  const len = Math.min(sigA.length, sigB.length);
  if (len === 0) return 0;
  let total = 0;
  for (let i = 0; i < len; i++) {
    total += Math.abs(sigA[i] - sigB[i]);
  }
  return total / len;
}

export async function installWebAudioSpy(session) {
  await session.evaluate(() => {
    if (window.__WG_AUDIO_SPY__) return;
    const NativeAC = window.AudioContext || window.webkitAudioContext;
    if (!NativeAC) return;

    const spy = {
      contexts: [],
      gainNodes: [],
      compressors: [],
      analysers: [],
      sourcesStarted: 0,
      sourcesStopped: 0,
      activeSources: 0,
      closedCount: 0,
    };

    const WrappedAC = function (...args) {
      const ctx = new NativeAC(...args);
      spy.contexts.push(ctx);

      const origCreateGain = ctx.createGain.bind(ctx);
      ctx.createGain = function () {
        const g = origCreateGain();
        spy.gainNodes.push(g);
        return g;
      };

      const origCreateComp = ctx.createDynamicsCompressor.bind(ctx);
      ctx.createDynamicsCompressor = function () {
        const c = origCreateComp();
        spy.compressors.push(c);
        return c;
      };

      const origCreateAnalyser = ctx.createAnalyser.bind(ctx);
      ctx.createAnalyser = function () {
        const a = origCreateAnalyser();
        spy.analysers.push(a);
        return a;
      };

      const trackSource = (node) => {
        const origStart = node.start.bind(node);
        const origStop = node.stop.bind(node);
        let active = false;
        node.start = function (...sArgs) {
          if (!active) {
            active = true;
            spy.sourcesStarted++;
            spy.activeSources++;
          }
          return origStart(...sArgs);
        };
        node.stop = function (...sArgs) {
          if (active) {
            active = false;
            spy.sourcesStopped++;
            spy.activeSources = Math.max(0, spy.activeSources - 1);
          }
          return origStop(...sArgs);
        };
        node.addEventListener?.('ended', () => {
          if (active) {
            active = false;
            spy.activeSources = Math.max(0, spy.activeSources - 1);
          }
        });
        return node;
      };

      const origCreateOsc = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = function () {
        return trackSource(origCreateOsc());
      };

      const origCreateBufSrc = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = function () {
        return trackSource(origCreateBufSrc());
      };

      const origClose = ctx.close.bind(ctx);
      ctx.close = function () {
        spy.closedCount++;
        return origClose();
      };

      return ctx;
    };
    WrappedAC.prototype = NativeAC.prototype;
    window.AudioContext = WrappedAC;
    if (window.webkitAudioContext) window.webkitAudioContext = WrappedAC;
    window.__WG_AUDIO_SPY__ = spy;
  });
}

export async function readWebAudioSpy(session) {
  return session.evaluate(() => {
    const spy = window.__WG_AUDIO_SPY__;
    if (!spy) return null;
    const states = spy.contexts.map((c) => c.state);
    const gains = spy.gainNodes.map((g) => g.gain.value);
    let analyserEnergy = 0;
    let timePeakDeviation = 0;
    for (const a of spy.analysers) {
      const freq = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(freq);
      for (let i = 0; i < freq.length; i++) analyserEnergy += freq[i];
      const td = new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(td);
      for (let i = 0; i < td.length; i++) {
        timePeakDeviation = Math.max(timePeakDeviation, Math.abs(td[i] - 128));
      }
    }
    return {
      contextCount: spy.contexts.length,
      states,
      gainCount: spy.gainNodes.length,
      gains,
      compressorCount: spy.compressors.length,
      analyserCount: spy.analysers.length,
      analyserEnergy,
      timePeakDeviation,
      sourcesStarted: spy.sourcesStarted,
      sourcesStopped: spy.sourcesStopped,
      activeSources: spy.activeSources,
      closedCount: spy.closedCount,
    };
  });
}

export async function assertNoEnemyRankLeakInDom(session) {
  const result = await session.evaluate(() => {
    const rankTerms = [
      '5-star',
      '4-star',
      '3-star',
      '2-star',
      '1-star',
      'lt. colonel',
      '1st lieutenant',
      '2nd lieutenant',
      'colonel',
      'major',
      'captain',
      'sergeant',
      'private',
      'spy',
      'gen_5',
      'gen_4',
      'gen_3',
      'gen_2',
      'gen_1',
      'lt_colonel',
      'lt_1st',
      'lt_2nd',
    ];
    const leaks = [];
    const checkText = (label, text) => {
      const lower = (text || '').toLowerCase();
      for (const term of rankTerms) {
        if (lower.includes(term)) {
          leaks.push({ label, term, snippet: text.slice(0, 120) });
        }
      }
    };

    const banner = document.querySelector('#text-turn-state')?.textContent || '';
    checkText('turn-banner', banner);

    const shroudHeadline = document.querySelector('#shroud-headline')?.textContent || '';
    const shroudSub = document.querySelector('#shroud-subline')?.textContent || '';
    checkText('shroud', `${shroudHeadline} ${shroudSub}`);

    const intelCols = document.querySelectorAll('#intel-body .intel-col');
    if (intelCols.length >= 2) {
      checkText('intel-enemy-col', intelCols[1].textContent || '');
    }

    const logRows = Array.from(document.querySelectorAll('#combat-log-list .log-row'));
    for (const row of logRows) {
      const txt = row.textContent || '';
      const lower = txt.toLowerCase();
      if (lower.includes('enemy') && (lower.includes('wins') || lower.includes('defeated'))) {
        for (const term of rankTerms) {
          if (lower.includes(`enemy ${term}`) || lower.includes(`by ${term}`) || lower.includes(`is ${term}`)) {
            leaks.push({ label: 'combat-log', term, snippet: txt.slice(0, 120) });
          }
        }
      }
    }

    return leaks;
  });

  assert.equal(result.length, 0, `Fog-of-War DOM leak detected: ${JSON.stringify(result)}`);
}

/**
 * Non-self-referential capability probe for M5 Heroic Start Screen & sculpted UI landing.
 * Checks for M5 UI/stage signals (Skip button, Operations UI, Theater selector, or hero_crest asset)
 * rather than checking absence of legacy selectors.
 */
export async function hasM5HeroStartScreen(session) {
  return session.evaluate(() => {
    const stage = window.__WAR_GENERALS_STAGE__ || {};
    const hasSkipBtn = Boolean(
      document.querySelector('#btn-skip-cutscene, [data-skip-cutscene], .arbiter-skip-btn') ||
        Array.from(document.querySelectorAll('button')).some((b) => /\bskip\b/i.test(b.textContent || ''))
    );
    return Boolean(
      hasSkipBtn ||
        typeof stage.skipArbiterCutscene === 'function' ||
        document.querySelector(
          '[data-theater], [data-operation], [data-operation-id], [data-skip-cutscene], #btn-skip-cutscene, #btn-menu-operations, [data-menu-operations], img[src*="hero_crest"]'
        )
    );
  });
}

/**
 * Inspects row-by-row luma (0.299R + 0.587G + 0.114B) and near-white pixel runs across the upper
 * 4%..48% band of the rendered WebGL canvas to detect any bright white horizontal cyclorama seam.
 * Calibrated against live TITLE vs PLAY screenshots: flags continuous near-white bands/luma spikes
 * while avoiding false positives on dark war-room tent lighting, warm lantern glow, or HUD text.
 */
export async function detectWhiteHorizontalSeam(session, pngBase64, opts = {}) {
  const {
    topFrac = 0.04,
    bottomFrac = 0.48,
    minWhiteFrac = 0.2,
    minContiguousRunFrac = 0.16,
    spikeLumaThreshold = 205,
    spikeDeltaThreshold = 35,
    cropToCanvas = true,
  } = opts;

  return session.evaluate(
    async ({ b64, topF, botF, minWF, minRF, spikeLuma, spikeDelta, cropCanvas }) => {
      const clean = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
      const img = new Image();
      img.src = clean;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;

      let xStart = Math.floor(w * 0.1);
      let xEnd = Math.ceil(w * 0.9);
      if (cropCanvas) {
        const canvas = document.querySelector('#canvas-host canvas');
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 10) {
            const scaleX = w / Math.max(1, window.innerWidth);
            xStart = Math.max(0, Math.floor((rect.left + rect.width * 0.02) * scaleX));
            xEnd = Math.min(w, Math.ceil((rect.right - rect.width * 0.02) * scaleX));
          }
        }
      }
      const spanW = Math.max(1, xEnd - xStart);
      const yStart = Math.max(0, Math.floor(h * topF));
      const yEnd = Math.min(h - 1, Math.floor(h * botF));

      const rows = [];
      for (let y = yStart; y <= yEnd; y++) {
        let sumLuma = 0;
        let nearWhiteCnt = 0;
        let strictWhiteCnt = 0;
        let curRun = 0;
        let maxRun = 0;

        for (let x = xStart; x < xEnd; x++) {
          const idx = (y * w + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          sumLuma += luma;

          if (r >= 215 && g >= 215 && b >= 215) {
            strictWhiteCnt++;
          }
          const chromaSpread = Math.max(r, g, b) - Math.min(r, g, b);
          const isNearWhite = r >= 200 && g >= 190 && b >= 165 && luma >= 190 && chromaSpread <= 55;
          if (isNearWhite) {
            nearWhiteCnt++;
            curRun++;
            if (curRun > maxRun) maxRun = curRun;
          } else {
            curRun = 0;
          }
        }

        rows.push({
          y,
          yFrac: y / Math.max(1, h),
          meanLuma: sumLuma / spanW,
          whiteFrac: nearWhiteCnt / spanW,
          strictWhiteFrac: strictWhiteCnt / spanW,
          runFrac: maxRun / spanW,
        });
      }

      const neighborOffset = Math.max(6, Math.round(h * 0.015));
      let hasSeam = false;
      let maxRowWhiteFrac = 0;
      let maxRowStrictWhiteFrac = 0;
      let maxRowRunFrac = 0;
      let maxRowLuma = 0;
      let maxLumaSpike = 0;
      let seamRowFrac = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const above = rows[Math.max(0, i - neighborOffset)];
        const below = rows[Math.min(rows.length - 1, i + neighborOffset)];
        const neighborMean = (above.meanLuma + below.meanLuma) * 0.5;
        const spike = row.meanLuma - neighborMean;

        if (row.whiteFrac > maxRowWhiteFrac) maxRowWhiteFrac = row.whiteFrac;
        if (row.strictWhiteFrac > maxRowStrictWhiteFrac) maxRowStrictWhiteFrac = row.strictWhiteFrac;
        if (row.runFrac > maxRowRunFrac) maxRowRunFrac = row.runFrac;
        if (row.meanLuma > maxRowLuma) maxRowLuma = row.meanLuma;
        if (spike > maxLumaSpike) maxLumaSpike = spike;

        const wideBand = row.whiteFrac >= minWF && row.runFrac >= minRF;
        const brightSpike = row.meanLuma >= spikeLuma && spike >= spikeDelta && row.runFrac >= 0.12;
        if (wideBand || brightSpike) {
          if (!hasSeam) {
            seamRowFrac = Number(row.yFrac.toFixed(3));
          }
          hasSeam = true;
        }
      }

      return {
        hasSeam,
        maxRowWhiteFrac: Number(maxRowWhiteFrac.toFixed(4)),
        maxRowStrictWhiteFrac: Number(maxRowStrictWhiteFrac.toFixed(4)),
        maxRowRunFrac: Number(maxRowRunFrac.toFixed(4)),
        maxRowLuma: Number(maxRowLuma.toFixed(2)),
        maxLumaSpike: Number(maxLumaSpike.toFixed(2)),
        seamRowFrac,
      };
    },
    {
      b64: pngBase64,
      topF: topFrac,
      botF: bottomFrac,
      minWF: minWhiteFrac,
      minRF: minContiguousRunFrac,
      spikeLuma: spikeLumaThreshold,
      spikeDelta: spikeDeltaThreshold,
      cropCanvas: cropToCanvas,
    }
  );
}
