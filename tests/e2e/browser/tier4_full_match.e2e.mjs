// Tier 4 Browser E2E Suite — 6 Real-World Full End-to-End Application Workloads (T4-01 .. T4-06)
// Strictly opaque-box with isolated fresh browser sessions per workload.
// Contract: export function registerBrowserTests(register, helpers)

import assert from 'node:assert/strict';
import * as localHelpers from './helpers.mjs';

export function registerBrowserTests(register, injectedCtxOrHelpers) {
  const h =
    injectedCtxOrHelpers && typeof injectedCtxOrHelpers.withSession === 'function'
      ? { ...localHelpers, ...injectedCtxOrHelpers }
      : localHelpers;
  const reg = (meta, fn) =>
    register({ mode: 'BROWSER', ...meta }, (runtimeCtx) => fn(runtimeCtx || injectedCtxOrHelpers));

  reg(
    {
      id: 'T4-01',
      tier: 4,
      feature: 'F2+F3+F7+F13+F15+F16+F17+F19+F20',
      title: 'Mobile Portrait (390x844) Full Skirmish Lifecycle: Title -> Deploy -> Moves -> Clash + Skip -> Dossier -> Replay -> Rematch',
      timeoutMs: 60000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });

        // 1. Open Skirmish & configure MILLER / 1980s / GENERAL
        await h.startSkirmishToDeploy(session, { commander: 'MILLER', era: '1980s', difficulty: 'GENERAL' });
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });

        // 2. Auto deploy + manual piece swap on board
        await session.clickSelector('#btn-dep-auto');
        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21');
        await h.tapBoardCoord(session, 2, 5, { phase: 'DEPLOY', isTouch: true });
        await h.tapBoardCoord(session, 6, 5, { phase: 'DEPLOY', isTouch: true });
        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21');

        // 3. Launch battle
        await session.clickSelector('#btn-launch-battle');
        await h.waitForTurnActive(session);
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });

        // 4. Play alternating tap and drag moves on legal frontline squares
        const readPublicTurnProgress = async () => {
          const tel = await h.getStageTelemetry(session);
          if (typeof tel?.turnCount === 'number') return tel.turnCount;
          if (await h.isVisible(session, '#dossier-card')) {
            return Number(await h.getText(session, '#d-stat-turns')) || 0;
          }
          await session.clickSelector('#btn-dock-log');
          await session.waitFor(() => !document.querySelector('#sheet-log')?.hasAttribute('hidden'));
          const maxTurn = await session.evaluate(() => {
            let max = 0;
            for (const row of document.querySelectorAll('#combat-log-list .log-row[data-clash]')) {
              const m = (row.textContent || '').match(/\bT(\d+)\b/);
              if (m) max = Math.max(max, Number(m[1]));
            }
            return max;
          });
          await session.clickSelector('#sheet-log [data-close-sheet]');
          await session.waitFor(() => Boolean(document.querySelector('#sheet-log')?.hasAttribute('hidden')));
          return maxTurn;
        };

        const movedFromRow5 = [];
        let movesMade = 0;
        for (let col = 0; col < 9 && movesMade < 2; col++) {
          await h.tapBoardCoord(session, col, 5, { phase: 'PLAY', isTouch: true });
          await h.sleep(60);
          if (await h.isVisible(session, '#selected-unit-strip')) {
            const beforeTurn = await readPublicTurnProgress();
            if (movesMade % 2 === 0) {
              await h.tapBoardCoord(session, col, 4, { phase: 'PLAY', isTouch: true });
            } else {
              await h.dragBoardCoords(session, col, 5, col, 4, { phase: 'PLAY', isTouch: true, steps: 8 });
            }
            await h.waitForArbiterResolved(session, 10000);
            if (await h.isVisible(session, '#dossier-card')) {
              movesMade++;
              break;
            }
            await h.waitForTurnActive(session, 10000);
            const afterTurn = await readPublicTurnProgress();
            assert.ok(afterTurn > beforeTurn, `Turn did not advance after row-5 move (before=${beforeTurn}, after=${afterTurn})`);
            movedFromRow5.push(col);
            movesMade++;
          }
        }
        for (const col of movedFromRow5) {
          if (movesMade >= 4 || (await h.isVisible(session, '#dossier-card'))) break;
          await h.tapBoardCoord(session, col, 4, { phase: 'PLAY', isTouch: true });
          await h.sleep(60);
          if (await h.isVisible(session, '#selected-unit-strip')) {
            const beforeTurn = await readPublicTurnProgress();
            if (movesMade % 2 === 0) {
              await h.tapBoardCoord(session, col, 3, { phase: 'PLAY', isTouch: true });
            } else {
              await h.dragBoardCoords(session, col, 4, col, 3, { phase: 'PLAY', isTouch: true, steps: 8 });
            }
            await h.waitForArbiterResolved(session, 10000);
            if (await h.isVisible(session, '#dossier-card')) {
              movesMade++;
              break;
            }
            await h.waitForTurnActive(session, 10000);
            const afterTurn = await readPublicTurnProgress();
            assert.ok(afterTurn > beforeTurn, `Turn did not advance after row-4 move (before=${beforeTurn}, after=${afterTurn})`);
            movesMade++;
          }
        }
        assert.ok(movesMade >= 2, `Expected at least 2 alternating tap/drag turns, executed ${movesMade}`);

        // 5. Trigger a full clash and a skipped clash if still in PLAY
        if (!(await h.isVisible(session, '#dossier-card'))) {
          await session.clickSelector('#btn-dock-settings');
          await session.clickSelector('#seg-speed button[data-speed="TACTICAL_FAST"]');
          await session.clickSelector('#btn-opt-showcase');
          await session.clickSelector('#sheet-showcase [data-preset="ENEMY_WIN"]');
          await h.waitForArbiterResolved(session, 6000);
          await h.assertNoEnemyRankLeakInDom(session);

          // Skip clash #2
          await session.clickSelector('#btn-dock-settings');
          await session.clickSelector('#btn-opt-showcase');
          await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
          await h.sleep(150);
          const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
          if (skipSel) {
            await session.clickSelector(skipSel);
          } else {
            const r = await session.getRect('#canvas-host canvas');
            await session.tapPoint(r.left + r.width / 2, r.top + r.height / 2);
            await h.sleep(60);
            await session.tapPoint(r.left + r.width / 2, r.top + r.height / 2);
          }
          await h.waitForArbiterResolved(session, 6000);

          // 6. Complete match via 2-step Surrender -> Dossier
          await h.performTwoStepSurrender(session);
        }

        // 7. Enter X-Ray Replay, scrub & Rematch
        await session.clickSelector('#btn-dossier-replay');
        await session.waitFor(() => !document.querySelector('#replay-bar')?.hasAttribute('hidden'));
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });
        await session.clickSelector('#btn-rep-next');
        await session.clickSelector('#btn-rep-rematch');
        await session.waitFor(() => !document.querySelector('#mobilization-drawer')?.hasAttribute('hidden'));
      });
    }
  );

  reg(
    {
      id: 'T4-02',
      tier: 4,
      feature: 'F4+F11+F12+F13+F14+F15+F20',
      title: 'Mobile Landscape (844x390) Tactical Operation + Night Ops + Battery Saver + Orbit & Camera Reset',
      timeoutMs: 60000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', { fresh: true }, async (session) => {
        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasOpsBtn && caps.hasSetTheater && caps.hasResetCameraOrbit,
          'M2/M3/M5',
          'F4+F11+F14',
          'Operations UI, NIGHT_OPS theater & orbit reset pending M2-M5'
        );

        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-quality button[data-quality="BATTERY_SAVER"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('NIGHT_OPS'));

        const opsBtn = await h.findVisibleSelector(session, ['#btn-menu-operations', '[data-menu-operations]']);
        await session.clickSelector(opsBtn);
        const opItem = await h.findVisibleSelector(session, ['[data-operation-id]', '[data-operation]', '.operation-card']);
        await session.clickSelector(opItem);
        const launchBtn = await h.findVisibleSelector(session, ['#btn-start-operation', '#btn-launch-operation', '[data-launch-operation]']);
        await session.clickSelector(launchBtn);
        await h.waitForTurnActive(session);
        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });

        // Orbit & Camera Reset
        const emptyPt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(emptyPt.x, emptyPt.y, emptyPt.x + 120, emptyPt.y + 40, { steps: 10, isTouch: true });
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.resetCameraOrbit());
        await h.sleep(450);

        const tel = await h.getStageTelemetry(session);
        assert.equal(tel?.lanternCastShadow, false, 'BATTERY_SAVER must keep lantern shadow off');
        assert.ok(Math.abs(tel?.camera?.yawDeg ?? 99) < 1.5, 'Camera reset did not restore yaw');
      });
    }
  );

  reg(
    {
      id: 'T4-03',
      tier: 4,
      feature: 'F1+F5+F10+F11+F15+F18+F19+F20',
      title: 'Desktop (1440x900) Full-Viewport Campaign + Phone 9:16 Toggle + Pacific Bridge + Showcase 6 Cutscenes',
      timeoutMs: 60000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_WIDE', { fresh: true }, async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetViewportFrameMode && caps.hasSetTheater && caps.hasSkipBtn,
          'M2/M3/M5',
          'F11+F15+F19',
          'Full-viewport desktop, Pacific Bridge & HUD SKIP >> pending M2-M5'
        );

        await h.assertViewportFillAndNoOverflow(session, 1440, 900, { expectFullBleed: true });

        await session.clickSelector('#btn-menu-campaign');
        await session.clickSelector('#btn-launch-campaign');
        await session.waitFor(() => !document.querySelector('#mobilization-drawer')?.hasAttribute('hidden'));

        // Toggle PHONE_9_16 and back mid-deploy
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('PHONE_9_16'));
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 1440, 900, { expectFullBleed: false, expectPhoneFrame: true });
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('FULL_VIEWPORT'));
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 1440, 900, { expectFullBleed: true });

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('PACIFIC_BRIDGE'));
        await h.deployPresetAndLaunch(session, 'VACCINATION');

        await h.tapBoardCoord(session, 4, 5);
        await h.tapBoardCoord(session, 4, 4);
        await h.waitForTurnActive(session);

        await session.clickSelector('#btn-dock-intel');
        await h.assertNoEnemyRankLeakInDom(session);
        await session.clickSelector('#btn-dock-log');
        await h.assertNoEnemyRankLeakInDom(session);
        await session.clickSelector('#sheet-log [data-close-sheet]');

        // Test Showcase presets + Space/Esc skip
        for (const [preset, key] of [
          ['PLAYER_WIN', 'Space'],
          ['ENEMY_WIN', 'Escape'],
          ['SPY_INTERCEPT', 'Space'],
          ['MUTUAL_SPLIT', 'Escape'],
          ['FLAG_CAPTURE', 'Space'],
        ]) {
          await session.clickSelector('#btn-dock-settings');
          await session.clickSelector('#btn-opt-showcase');
          await session.clickSelector(`#sheet-showcase [data-preset="${preset}"]`);
          await h.sleep(150);
          await session.pressKey(key);
          await h.waitForArbiterResolved(session, 3000);
        }
      });
    }
  );

  reg(
    {
      id: 'T4-04',
      tier: 4,
      feature: 'F3+F6+F13+F15+F19+F20',
      title: 'Desktop (1280x800) Pass & Play Hotseat 2P Full Flow + Shroud Masking & 180-deg Rotation',
      timeoutMs: 60000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', { fresh: true }, async (session) => {
        await session.clickSelector('#btn-menu-passplay');
        await session.waitFor(() => !document.querySelector('#mobilization-drawer')?.hasAttribute('hidden'));
        assert.equal(await h.getText(session, '#mob-header-label'), 'NAVY CRATE');

        // Navy deploys VACCINATION and passes to Crimson
        await session.clickSelector('[data-dep-preset="VACCINATION"]');
        await session.clickSelector('#btn-launch-battle');
        await session.waitFor(() => !document.querySelector('#command-shroud')?.hasAttribute('hidden'));
        await h.assertNoEnemyRankLeakInDom(session);

        // Unseal Crimson -> deploys MOTHERSHIP -> pass to Navy
        await session.clickSelector('#btn-unseal-shroud');
        assert.equal(await h.getText(session, '#mob-header-label'), 'CRIMSON CRATE');
        await session.clickSelector('[data-dep-preset="MOTHERSHIP"]');
        await session.clickSelector('#btn-launch-battle');
        await session.waitFor(() => !document.querySelector('#command-shroud')?.hasAttribute('hidden'));
        await h.assertNoEnemyRankLeakInDom(session);

        // Turn 1: Navy unseals, moves (4,5)->(4,4), shroud seals for Crimson
        await session.clickSelector('#btn-unseal-shroud');
        await h.waitForTurnActive(session);
        assert.equal(await h.getText(session, '#text-turn-state'), 'NAVY TURN');
        await h.tapBoardCoord(session, 4, 5, { phase: 'PLAY' });
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        await h.tapBoardCoord(session, 4, 4, { phase: 'PLAY', worldY: 0 });
        await session.waitFor(() => !document.querySelector('#command-shroud')?.hasAttribute('hidden'));
        await h.assertNoEnemyRankLeakInDom(session);

        // Turn 2: Crimson unseals (board flipped 180 deg, so Crimson frontline sits at visual row 5!), moves (3,5)->(3,4)
        await session.clickSelector('#btn-unseal-shroud');
        await h.waitForTurnActive(session);
        assert.equal(await h.getText(session, '#text-turn-state'), 'CRIMSON TURN');

        // In MOTHERSHIP, Crimson's rotated row 5 has pieces at visualCols 0, 2, 3, 5, 6, 7, 8
        await h.tapBoardCoord(session, 3, 5, { phase: 'PLAY' });
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        await h.tapBoardCoord(session, 3, 4, { phase: 'PLAY', worldY: 0 });
        await session.waitFor(() => !document.querySelector('#command-shroud')?.hasAttribute('hidden'));
        await h.assertNoEnemyRankLeakInDom(session);
      });
    }
  );

  reg(
    {
      id: 'T4-05',
      tier: 4,
      feature: 'F2+F5+F6+F8+F10+F16+F20',
      title: 'Mobile Portrait (390x844) Field Manual + Armory S1 Save/Reload + 1970s Classic Skirmish',
      timeoutMs: 60000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        // 1. Field Manual checks
        await session.clickSelector('#btn-menu-manual');
        for (const rk of ['SPY', 'PRIVATE', 'GEN_5', 'FLAG']) {
          await session.clickSelector(`.manual-rank-pill[data-manual-rank="${rk}"]`);
          const stats = await h.getText(session, '#manual-stats-row');
          assert.ok(stats && stats.includes('DEFEATS') && stats.includes('THREATS'));
        }
        await session.clickSelector('#btn-top-menu');

        // 2. Armory custom blueprint save to S1
        await session.clickSelector('#btn-menu-armory');
        await session.clickSelector('[data-dep-preset="MIRAGE_DECOY"]');
        await h.tapBoardCoord(session, 0, 5, { phase: 'DEPLOY', isTouch: true });
        await h.tapBoardCoord(session, 2, 5, { phase: 'DEPLOY', isTouch: true });
        await session.clickSelector('#btn-arm-save');
        await session.clickSelector('.mob-slot-pill[data-slot="0"]');
        assert.equal(
          await session.evaluate(() => document.querySelector('.mob-slot-pill[data-slot="0"]')?.getAttribute('data-saved')),
          'true'
        );

        // 3. Reload page & verify S1 blueprint + 1970s options persistence
        await session.clickSelector('#btn-armory-back');
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-era button[data-era="1970s"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');

        await h.reloadToTitle(session);

        await h.startSkirmishToDeploy(session, { commander: 'MERCER' });
        assert.equal(
          await session.evaluate(() => document.querySelector('.mob-slot-pill[data-slot="0"]')?.getAttribute('data-saved')),
          'true',
          'Blueprint S1 lost after reload'
        );
        await session.clickSelector('.mob-slot-pill[data-slot="0"]');
        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21');
        await session.clickSelector('#btn-launch-battle');
        await h.waitForTurnActive(session);
        assert.equal(await session.evaluate(() => document.body.dataset.era), '1970s');
      });
    }
  );

  reg(
    {
      id: 'T4-06',
      tier: 4,
      feature: 'F9+F11+F12+F15+F18+F20',
      title: 'Cross-Viewport Dynamic Resize (1280x800 <-> 390x844 <-> 844x390) + All-4-Theater Tour Under Load',
      timeoutMs: 60000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', { fresh: true }, async (session) => {
        await h.startSkirmishToDeploy(session, { commander: 'MILLER' });
        await session.setViewport(h.resolvePreset(ctx, 'MOBILE_PORTRAIT'));
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });

        await session.setViewport(h.resolvePreset(ctx, 'MOBILE_LANDSCAPE'));
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });

        await h.deployPresetAndLaunch(session, 'VACCINATION');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetTheater && caps.hasSetViewportFrameMode,
          'M2/M3',
          'F11+F15',
          '4-Theater tour & full-viewport resize pending M2/M3'
        );

        const viewports = [
          ['DESKTOP_LAPTOP', 1280, 800],
          ['MOBILE_PORTRAIT', 390, 844],
          ['MOBILE_LANDSCAPE', 844, 390],
          ['DESKTOP_WIDE', 1440, 900],
        ];

        for (let i = 0; i < h.THEATERS_4.length; i++) {
          const th = h.THEATERS_4[i];
          const [vpName, w, hPx] = viewports[i];
          await session.evaluate((t) => window.__WAR_GENERALS_STAGE__.setTheater(t), th);
          await session.setViewport(h.resolvePreset(ctx, vpName));
          await h.sleep(180);
          await h.assertViewportFillAndNoOverflow(session, w, hPx, { expectFullBleed: true });
        }

        // Arbiter resize mid-cutscene
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(200);
        await session.setViewport(h.resolvePreset(ctx, 'MOBILE_PORTRAIT'));
        await h.waitForArbiterResolved(session, 8000);

        // Complete via Replay
        await h.performTwoStepSurrender(session);
        await session.clickSelector('#btn-dossier-replay');
        await session.waitFor(() => !document.querySelector('#replay-bar')?.hasAttribute('hidden'));
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );
}
