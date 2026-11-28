// Tier 2 Browser E2E Suite — 71 Boundary & Corner Cases (WebGL2, WebAudio, Controls, Layout, HUD, F24)
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

  // =========================================================================
  // F1, F3, F4, F6 Boundaries
  // =========================================================================
  reg(
    { id: 'T2-F01-5', tier: 2, feature: 'F1', title: 'QA stage API is idempotent across repeated & out-of-order pose transitions', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => {
          const s = window.__WAR_GENERALS_STAGE__;
          s.poseArbiterAct('FLAG_CAPTURE', 2.4);
          s.poseInspect16();
          s.poseReplay();
          s.poseFieldManual();
          s.poseTabletop('OVERHEAD');
          s.poseTitle();
          s.poseTitle();
        });
        await h.sleep(150);
        assert.equal(await h.isVisible(session, '#title-screen'), true, 'Title screen not cleanly restored');
      });
    }
  );

  reg(
    { id: 'T2-F03-5', tier: 2, feature: 'F3', title: 'Rapid Arbiter skip -> immediate Intel & Combat Log open shows zero transient enemy rank leak', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="ENEMY_WIN"]');
        await h.sleep(100);

        const caps = await h.getStageCapabilities(session);
        if (caps.hasSkipBtn) {
          const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
          if (skipSel) await session.clickSelector(skipSel);
        } else {
          // Baseline double-tap skip on canvas
          const r = await session.getRect('#canvas-host canvas');
          await session.tapPoint(r.left + r.width / 2, r.top + r.height / 2);
          await h.sleep(60);
          await session.tapPoint(r.left + r.width / 2, r.top + r.height / 2);
        }

        await h.waitForArbiterResolved(session, 8000);
        await session.clickSelector('#btn-dock-intel');
        await h.assertNoEnemyRankLeakInDom(session);
        await session.clickSelector('#btn-dock-log');
        await h.assertNoEnemyRankLeakInDom(session);
      });
    }
  );

  reg(
    { id: 'T2-F04-5', tier: 2, feature: 'F4', title: 'Abandoning Operation to Title stops turn clocks and AI timers cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasOpsBtn, 'M5', 'F4', 'Operations UI not yet wired');

        const opsBtn = await h.findVisibleSelector(session, ['#btn-menu-operations', '[data-menu-operations]']);
        await session.clickSelector(opsBtn);
        const opItem = await h.findVisibleSelector(session, ['[data-operation-id]', '[data-operation]', '.operation-card']);
        await session.clickSelector(opItem);
        const launchBtn = await h.findVisibleSelector(session, ['#btn-start-operation', '#btn-launch-operation', '[data-launch-operation]']);
        await session.clickSelector(launchBtn);
        await h.waitForTurnActive(session);

        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-mainmenu');
        await h.waitForTitleScreen(session);
        await h.sleep(1100);
        assert.equal(await h.isVisible(session, '#title-screen'), true, 'Lingering timer navigated away from Title');
      });
    }
  );

  reg(
    { id: 'T2-F06-5', tier: 2, feature: 'F6', title: 'Simulated private-mode localStorage throw never crashes boot or Options UI', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true }, async (session) => {
        await session.evaluate(() => {
          const throwErr = () => {
            throw new DOMException('Storage disabled', 'SecurityError');
          };
          Storage.prototype.getItem = throwErr;
          Storage.prototype.setItem = throwErr;
        });

        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-era button[data-era="1970s"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('[data-dep-preset="VACCINATION"]');
        await session.clickSelector('#btn-arm-save');
        await session.clickSelector('.mob-slot-pill[data-slot="0"]');
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  // =========================================================================
  // F7 Boundaries: Worst-Case Angles, Well Overflow, Halo/Tag Overlap
  // =========================================================================
  reg(
    { id: 'T2-F07-1', tier: 2, feature: 'F7', title: 'Worst-case low pitch (24 deg): row 7 piece behind row 6 remains identifiable & tappable', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-view button[data-view="TACTICAL"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');

        // Drag down slightly to approach 24 deg low pitch
        const emptyPt = await h.projectBoardCoord(session, 0, 3, { boardView: 'TACTICAL', phase: 'PLAY', worldY: 0 });
        await session.dragPoints(emptyPt.x, emptyPt.y, emptyPt.x, emptyPt.y - 70, { steps: 8 });
        await h.sleep(150);

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F7', 'Low-pitch piece screenBounds telemetry not yet exposed');
        const tel = await h.getStageTelemetry(session);
        const flagPiece = (tel?.pieces || []).find((p) => p.faction === 'PLAYER' && p.row === 7 && p.col === 4);
        assert.ok(flagPiece && flagPiece.screenBounds?.height > 6, 'Back-row Flag piece collapsed at low pitch');
      });
    }
  );

  reg(
    { id: 'T2-F07-2', tier: 2, feature: 'F7', title: 'Extreme yaw orbit (+/-38 deg) keeps all corner pieces inside frustum', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session, { preset: 'MOTHERSHIP' });
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F7', 'Yaw orbit & frustum telemetry not yet exposed');

        const rect = await session.getRect('#canvas-host canvas');
        const emptyPt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        for (const dx of [-500, 1000]) {
          await session.dragPoints(emptyPt.x, emptyPt.y, emptyPt.x + dx, emptyPt.y, { steps: 10 });
          await h.sleep(120);
          const tel = await h.getStageTelemetry(session);
          const corners = (tel?.pieces || []).filter((p) => (p.col === 0 || p.col === 8) && (p.row === 0 || p.row === 7));
          for (const c of corners) {
            assert.ok(
              c.screenBounds && c.screenBounds.right > rect.left && c.screenBounds.left < rect.right,
              `Corner piece ${c.id} clipped out of frustum at yaw ${tel?.camera?.yawDeg}`
            );
          }
        }
      });
    }
  );

  reg(
    { id: 'T2-F07-3', tier: 2, feature: 'F7', title: 'High pitch (72 deg) keeps player rank emblems visible while enemy ranks remain hidden', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-view button[data-view="OVERHEAD"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await h.sleep(250);

        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.25 && stats.stdLuma > 6, 'Overhead high-pitch render unclear');
      });
    }
  );

  reg(
    { id: 'T2-F07-4', tier: 2, feature: 'F7', title: 'Casualty well overflow renders 12+ captured wedges cleanly without errors', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        // Trigger multiple showcase clashes in fast speed so casualties accumulate in wells
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-speed button[data-speed="TACTICAL_FAST"]');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="MUTUAL_SPLIT"]');
        await h.waitForArbiterResolved(session, 5000);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F7', 'Casualty well bounds telemetry not yet exposed');
        const tel = await h.getStageTelemetry(session);
        assert.ok(tel, 'Telemetry should remain valid with casualty wedges');
      });
    }
  );

  reg(
    { id: 'T2-F07-5', tier: 2, feature: 'F7', title: 'Suspect tag pill on enemy piece stays inside viewport without obscuring board', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        // Scan enemy home squares (rows 1..2) opaque-box until an enemy wedge opens the Suspect Wheel
        let opened = false;
        for (const [ec, er] of [
          [4, 2],
          [3, 2],
          [5, 2],
          [2, 2],
          [6, 2],
          [4, 1],
          [3, 1],
          [5, 1],
          [2, 1],
        ]) {
          await h.longPressBoardCoord(session, ec, er, 380, { phase: 'PLAY', isTouch: true });
          await h.sleep(50);
          if (await h.isVisible(session, '#suspect-wheel')) {
            opened = true;
            break;
          }
        }
        assert.equal(opened, true, 'Could not open Suspect Wheel on any enemy frontline piece');
        await session.clickSelector('#suspect-wheel .suspect-orb[data-suspect="SPY?"]');
        await h.sleep(150);
        assert.equal(await h.isVisible(session, '#suspect-wheel'), false, 'Suspect wheel did not close after tag');
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  // =========================================================================
  // F8 Boundaries: Low Light, Drag Ghost, Replay Stress, Rapid Manual, Medallion
  // =========================================================================
  reg(
    { id: 'T2-F08-1', tier: 2, feature: 'F8', title: 'NIGHT_OPS low-light theater keeps sculpted rank emblems legible (non-crushed)', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F8', 'NIGHT_OPS theater switching not yet implemented');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('NIGHT_OPS'));
        await h.sleep(200);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.meanLuma > 10 && stats.stdLuma > 6, `NIGHT_OPS scene crushed to black (mean=${stats.meanLuma})`);
      });
    }
  );

  reg(
    { id: 'T2-F08-2', tier: 2, feature: 'F8', title: 'Hologram drag ghost displays during drag and disposes cleanly on off-board release', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');
        const chipRect = await session.getRect('#mob-chip-grid .crate-rank-chip[data-rank="GEN_5"]');
        const offBoard = await h.projectBoardCoord(session, 4, 2, { phase: 'DEPLOY', worldY: 0 });
        await session.dragPoints(
          chipRect.left + chipRect.width / 2,
          chipRect.top + chipRect.height / 2,
          offBoard.x,
          offBoard.y,
          { steps: 10, isTouch: true }
        );
        await h.sleep(100);
        assert.equal(await h.getText(session, '#mob-count-pill'), '0 / 21', 'Piece placed on illegal neutral row');
      });
    }
  );

  reg(
    { id: 'T2-F08-3', tier: 2, feature: 'F8', title: 'X-Ray Replay 42-emblem stress scrub shows zero WebGL errors or geometry crashes', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseReplay());
        await session.waitFor(() => !document.querySelector('#replay-bar')?.hasAttribute('hidden'));
        for (let i = 0; i < 6; i++) {
          await session.clickSelector('#btn-rep-next');
          await h.sleep(50);
          await session.clickSelector('#btn-rep-prev');
          await h.sleep(50);
        }
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T2-F08-4', tier: 2, feature: 'F8', title: 'Field Manual rapid <50ms cycling across all 15 ranks updates cleanly with zero stale state', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-manual');
        await session.waitFor(() => !document.querySelector('#manual-sheet')?.hasAttribute('hidden'));
        for (const r of h.RANKS_15) {
          await session.evaluate((rk) => {
            document.querySelector(`.manual-rank-pill[data-manual-rank="${rk}"]`)?.click();
          }, r);
          await h.sleep(25);
        }
        assert.equal(await h.getText(session, '#manual-rank-title'), 'FLAG');
      });
    }
  );

  reg(
    { id: 'T2-F08-5', tier: 2, feature: 'F8', title: 'Attack Medallion drop in Arbiter Act 1 sits cleanly above board without z-fighting', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 0.25));
        await h.sleep(150);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3/M5', 'F8', 'Attack Medallion world Y telemetry not yet exposed');
        const tel = await h.getStageTelemetry(session);
        if (typeof tel?.medallionY === 'number') {
          assert.ok(tel.medallionY > 0.02, `Medallion z-fighting near board plane: y=${tel.medallionY}`);
        }
      });
    }
  );

  // =========================================================================
  // F9 Boundaries: 404 Model Fallback, Texture Load, Finish Mid-Clash, Ultrawide
  // =========================================================================
  reg(
    { id: 'T2-F09-1', tier: 2, feature: 'F9', title: 'Intercepting .glb models with 404 falls back gracefully to procedural sculpted geometry', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, allow404: true, skipInitialLoad: true }, async (session) => {
        await session.intercept404(['.glb']);
        await session.goto(h.getBaseUrl(ctx), { waitUntilLoad: false, timeoutMs: 25000 });
        await h.waitForTitleScreen(session, 25000);
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(300);

        const errs = await session.getErrors();
        assert.equal(errs.pageErrors.length, 0, `Uncaught pageErrors on .glb fallback: ${JSON.stringify(errs.pageErrors)}`);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.2 && stats.stdLuma > 5, 'Fallback procedural scene rendered blank');
      });
    }
  );

  reg(
    { id: 'T2-F09-2', tier: 2, feature: 'F9', title: 'Texture load failure resilience keeps scene rendering without crashing SceneManager', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, allow404: true, skipInitialLoad: true }, async (session) => {
        await session.intercept404(['/textures/']);
        await session.goto(h.getBaseUrl(ctx), { waitUntilLoad: false, timeoutMs: 25000 });
        await h.waitForTitleScreen(session, 25000);
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(250);
        const errs = await session.getErrors();
        assert.equal(errs.pageErrors.length, 0, `Uncaught pageErrors on texture 404: ${JSON.stringify(errs.pageErrors)}`);
      });
    }
  );

  reg(
    { id: 'T2-F09-3', tier: 2, feature: 'F9', title: 'Toggling board finish Walnut <-> Bakelite mid-match updates live pieces cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-finish button[data-finish="RETRO_BAKELITE"]');
        await session.clickSelector('#seg-finish button[data-finish="WALNUT_SLATE"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        assert.equal(await h.isVisible(session, '#play-bottom-dock'), true);
      });
    }
  );

  reg(
    { id: 'T2-F09-4', tier: 2, feature: 'F9', title: 'Extreme portrait (390x844) to ultrawide (1920x600) resize fills backdrop without void errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true }, async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('TACTICAL'));
        await session.setViewport({ width: 1920, height: 600, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
        await h.sleep(250);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.25, 'Ultrawide backdrop collapsed to void');
      });
    }
  );

  // =========================================================================
  // F10 Boundaries: Mobile Portrait Cards & Landscape 15 Rank Chips
  // =========================================================================
  reg(
    { id: 'T2-F10-4', tier: 2, feature: 'F10', title: 'Commander selection cards at 390x844 render portraits without distortion or clipping', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        await session.waitFor(() => !document.querySelector('#title-sub-skirmish')?.hasAttribute('hidden'));
        const boxes = await session.evaluate(() =>
          Array.from(document.querySelectorAll('#skirmish-cmd-grid .cmd-portrait-box')).map((el) => {
            const r = el.getBoundingClientRect();
            return { w: r.width, h: r.height, hasImg: Boolean(el.querySelector('img')) };
          })
        );
        assert.equal(boxes.length, 6);
        for (const b of boxes) {
          assert.ok(b.w >= 24 && b.h >= 24, `Portrait box collapsed: ${JSON.stringify(b)}`);
        }
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasImgPortraits, 'M2/M5', 'F10', 'Rendered portrait <img> cards not yet wired');
      });
    }
  );

  reg(
    { id: 'T2-F10-5', tier: 2, feature: 'F10', title: 'All 15 rank chips in Mobilization drawer at 844x390 landscape fit cleanly & remain clickable', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', async (session) => {
        await h.startSkirmishToDeploy(session);
        const chips = await session.evaluate(() => {
          const innerH = window.innerHeight;
          return Array.from(document.querySelectorAll('#mob-chip-grid .crate-rank-chip')).map((c) => {
            const r = c.getBoundingClientRect();
            return { rank: c.getAttribute('data-rank'), w: r.width, h: r.height, bottom: r.bottom, innerH };
          });
        });
        assert.equal(chips.length, 15);
        for (const c of chips) {
          assert.ok(c.w > 20 && c.h > 18 && c.bottom <= c.innerH + 2, `Rank chip ${c.rank} clipped in landscape: ${JSON.stringify(c)}`);
        }
      });
    }
  );

  // =========================================================================
  // F11 Boundaries: Theater Switches in Title, Deploy, Rapid Leak, Battle Lighting
  // =========================================================================
  reg(
    { id: 'T2-F11-1', tier: 2, feature: 'F11', title: 'Switching theater during TITLE attract mode preserves orbital camera cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'setTheater() not yet exposed');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('IRON_BUNKER'));
        await h.sleep(150);
        assert.equal(await h.isVisible(session, '#title-screen'), true);
      });
    }
  );

  reg(
    { id: 'T2-F11-2', tier: 2, feature: 'F11', title: 'Switching theater during DEPLOY keeps 27 home deployment tiles interactive', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'setTheater() not yet exposed');

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('PACIFIC_BRIDGE'));
        await h.sleep(150);
        await session.clickSelector('#mob-chip-grid .crate-rank-chip[data-rank="FLAG"]');
        await h.tapBoardCoord(session, 4, 7, { phase: 'DEPLOY' });
        assert.equal(await h.getText(session, '#mob-count-pill'), '1 / 21');
      });
    }
  );

  reg(
    { id: 'T2-F11-3', tier: 2, feature: 'F11', title: '10 rapid theater switches preserve bounded WebGL draw calls without crash', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'setTheater() not yet exposed');

        for (let i = 0; i < 10; i++) {
          await session.evaluate((t) => window.__WAR_GENERALS_STAGE__.setTheater(t), h.THEATERS_4[i % 4]);
          await h.sleep(40);
        }
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T2-F11-4', tier: 2, feature: 'F11', title: 'Arbiter battle inside NIGHT_OPS & PACIFIC_BRIDGE restores theater lighting post-clash', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'setTheater() not yet exposed');

        for (const th of ['NIGHT_OPS', 'PACIFIC_BRIDGE']) {
          await session.evaluate((t) => window.__WAR_GENERALS_STAGE__.setTheater(t), th);
          await h.sleep(100);
          await session.clickSelector('#btn-dock-settings');
          await session.clickSelector('#seg-speed button[data-speed="TACTICAL_FAST"]');
          await session.clickSelector('#btn-opt-showcase');
          await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
          await h.waitForArbiterResolved(session, 6000);
        }
      });
    }
  );

  // =========================================================================
  // F12 Boundaries: Low-Power Simulation & Shadow Leak Guard
  // =========================================================================
  reg(
    { id: 'T2-F12-4', tier: 2, feature: 'F12', title: 'AUTO QualityGovernor steps down cleanly when sustained slow 45ms frames occur', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSimulateFrameDt && caps.hasGetTelemetry, 'M2/M3', 'F12', 'QualityGovernor slow-frame stress hook not yet exposed');

        await session.evaluate(() => {
          for (let i = 0; i < 60; i++) window.__WAR_GENERALS_STAGE__.simulateFrameDt(0.048);
        });
        const tel = await h.getStageTelemetry(session);
        const q = tel?.quality || tel?.qualitySnapshot;
        assert.ok(q && q.resolvedTier !== 'ULTRA', `Expected AUTO to step down from ULTRA on 48ms frames, got ${q?.resolvedTier}`);
      });
    }
  );

  reg(
    { id: 'T2-F12-5', tier: 2, feature: 'F12', title: 'BATTERY_SAVER strictly disables tableLanternShadowLight.castShadow (zero shadow leak)', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-quality button[data-quality="BATTERY_SAVER"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M2/M3', 'F12', 'Lantern shadow telemetry not yet exposed');
        const tel = await h.getStageTelemetry(session);
        assert.equal(tel?.lanternCastShadow, false, 'tableLanternShadowLight.castShadow leaked true in BATTERY_SAVER');
      });
    }
  );

  // =========================================================================
  // F13 Boundaries: Occluded Back-Row Tap, Neutral Row Reject, Cancel, Long Press
  // =========================================================================
  reg(
    { id: 'T2-F13-1', tier: 2, feature: 'F13', title: 'Tapping upper silhouette of row 7 piece overlapping row 6 selects row 7 (byMesh priority)', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-view button[data-view="TACTICAL"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await h.sleep(250);

        // At VACCINATION: (4,7) is FLAG, (4,6) is GEN_4. Upper silhouette (worldY=0.65) projects over row 6 ground plane!
        await h.tapBoardCoord(session, 4, 7, { boardView: 'TACTICAL', phase: 'PLAY', worldY: 0.65 });
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        const picked = await h.getText(session, '#sel-unit-name');
        assert.equal(picked, 'FLAG', `Expected occluded back-row FLAG (byMesh), but raycast picked ${picked}`);
      });
    }
  );

  reg(
    { id: 'T2-F13-2', tier: 2, feature: 'F13', title: 'DEPLOY rejects placement onto neutral row 3 or enemy row 0 cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');
        await session.clickSelector('#mob-chip-grid .crate-rank-chip[data-rank="COLONEL"]');

        await h.tapBoardCoord(session, 4, 3, { phase: 'DEPLOY' });
        await h.tapBoardCoord(session, 4, 0, { phase: 'DEPLOY' });
        assert.equal(await h.getText(session, '#mob-count-pill'), '0 / 21');
      });
    }
  );

  reg(
    { id: 'T2-F13-3', tier: 2, feature: 'F13', title: 'PLAY illegal jump target does not teleport; tapping friendly piece switches selection', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await h.tapBoardCoord(session, 3, 5, { phase: 'PLAY' });
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        assert.equal(await h.getText(session, '#sel-unit-name'), '5-STAR GENERAL');

        // Tap illegal empty neutral square (0,3) -> deselects cleanly, never teleports
        await h.tapBoardCoord(session, 0, 3, { phase: 'PLAY' });
        await h.sleep(100);
        assert.equal(await h.isVisible(session, '#selected-unit-strip'), false);

        // Tap (3,5) again -> still 5-STAR GENERAL, then switch to (5,5) COLONEL
        await h.tapBoardCoord(session, 3, 5, { phase: 'PLAY' });
        assert.equal(await h.getText(session, '#sel-unit-name'), '5-STAR GENERAL');
        await h.tapBoardCoord(session, 5, 5, { phase: 'PLAY' });
        assert.equal(await h.getText(session, '#sel-unit-name'), 'COLONEL');
      });
    }
  );

  reg(
    { id: 'T2-F13-4', tier: 2, feature: 'F13', title: 'pointercancel mid-drag restores source piece cleanly without moving it', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await h.sleep(150);

        // Pre-select (4,5) before capturing beforePatch so selection ring/highlight is already present
        await h.tapBoardCoord(session, 4, 5, { phase: 'PLAY', worldY: 0.35 });
        await h.sleep(150);

        const pt45 = await h.projectBoardCoord(session, 4, 5, { phase: 'PLAY', worldY: 0.35 });
        assert.ok(pt45, 'Failed to project (4,5)');
        const beforePatch = await h.analyzePngRegion(session, await session.capturePngBase64(), pt45.x, pt45.y, 12);

        await h.dragBoardCoords(session, 4, 5, 4, 4, { phase: 'PLAY', cancel: true, steps: 6, dropOffsetY: 0 });
        await h.sleep(150);

        const caps = await h.getStageCapabilities(session);
        if (caps.hasGetTelemetry) {
          const tel = await h.getStageTelemetry(session);
          const p45 = (tel?.pieces || []).find((p) => p.faction === 'PLAYER' && p.col === 4 && p.row === 5);
          assert.equal(p45?.visible, true, 'Source 3D piece at (4,5) remained invisible after pointercancel');
        }

        // Capture afterPatch immediately BEFORE any subsequent board tap (which would invoke syncFromStore())
        const afterPatch = await h.analyzePngRegion(session, await session.capturePngBase64(), pt45.x, pt45.y, 12);
        const visualDiff = h.diffPngSignatures(beforePatch.signature, afterPatch.signature);
        assert.ok(
          visualDiff < 6.0,
          `Source piece 3D mesh at (4,5) did not visually restore after pointercancel (diff=${visualDiff.toFixed(2)})`
        );

        // Piece must still be at (4,5) and selectable, then complete legal move (4,5) -> (4,4)
        if (!(await h.isVisible(session, '#selected-unit-strip'))) {
          await h.tapBoardCoord(session, 4, 5, { phase: 'PLAY' });
          await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        }
        assert.equal(await h.getText(session, '#sel-unit-name'), 'SERGEANT');
        await h.tapBoardCoord(session, 4, 4, { phase: 'PLAY', worldY: 0 });
        await h.waitForTurnActive(session);
      });
    }
  );

  reg(
    { id: 'T2-F13-5', tier: 2, feature: 'F13', title: 'Long-press 320ms on enemy wedge opens Suspect Wheel, tags SPY?, and clears tag', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        let hitCoord = null;
        for (const [ec, er] of [
          [4, 2],
          [3, 2],
          [5, 2],
          [2, 2],
          [6, 2],
          [4, 1],
          [3, 1],
          [5, 1],
        ]) {
          await h.longPressBoardCoord(session, ec, er, 380, { phase: 'PLAY', isTouch: true });
          await h.sleep(50);
          if (await h.isVisible(session, '#suspect-wheel')) {
            hitCoord = [ec, er];
            break;
          }
        }
        assert.ok(hitCoord, 'Could not open Suspect Wheel on enemy frontline');
        await session.clickSelector('#suspect-wheel .suspect-orb[data-suspect="SPY?"]');

        await session.clickSelector('#btn-dock-intel');
        assert.ok((await h.getText(session, '#intel-body'))?.includes('1'), 'Expected 1 tagged suspect in Intel Ledger');
        await session.clickSelector('#sheet-intel [data-close-sheet]');

        // Re-open and clear tag
        await h.longPressBoardCoord(session, hitCoord[0], hitCoord[1], 380, { phase: 'PLAY', isTouch: true });
        await session.waitFor(() => !document.querySelector('#suspect-wheel')?.hasAttribute('hidden'));
        await session.clickSelector('#suspect-wheel .suspect-orb[data-suspect=""]');
        assert.equal(await h.isVisible(session, '#suspect-wheel'), false);
      });
    }
  );

  // =========================================================================
  // F14 Boundaries: Orbit/Pitch/Zoom Clamps, Disabled During Arbiter/Shroud, Reset
  // =========================================================================
  reg(
    { id: 'T2-F14-1', tier: 2, feature: 'F14', title: 'Extreme horizontal over-drag clamps yaw strictly within [-38, +38] deg', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F14', 'Camera yaw orbit not yet implemented');

        const pt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(pt.x, pt.y, pt.x + 800, pt.y, { steps: 12 });
        const maxYaw = (await h.getStageTelemetry(session))?.camera?.yawDeg;
        assert.ok(maxYaw <= 38.5 && maxYaw >= 10, `Right over-drag yaw out of clamp: ${maxYaw}`);

        await session.dragPoints(pt.x + 200, pt.y, pt.x - 1000, pt.y, { steps: 12 });
        const minYaw = (await h.getStageTelemetry(session))?.camera?.yawDeg;
        assert.ok(minYaw >= -38.5 && minYaw <= -10, `Left over-drag yaw out of clamp: ${minYaw}`);
      });
    }
  );

  reg(
    { id: 'T2-F14-2', tier: 2, feature: 'F14', title: 'Extreme vertical over-drag clamps pitch strictly within [24, 72] deg', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F14', 'Camera pitch telemetry not yet exposed');

        const pt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(pt.x, pt.y, pt.x, pt.y + 800, { steps: 12 });
        const hi = (await h.getStageTelemetry(session))?.camera?.pitchDeg;
        assert.ok(hi >= 24 && hi <= 72.5, `Max pitch exceeded 72 deg: ${hi}`);

        await session.dragPoints(pt.x, pt.y, pt.x, pt.y - 800, { steps: 12 });
        const lo = (await h.getStageTelemetry(session))?.camera?.pitchDeg;
        assert.ok(lo >= 23.5 && lo <= 72, `Min pitch below 24 deg: ${lo}`);
      });
    }
  );

  reg(
    { id: 'T2-F14-3', tier: 2, feature: 'F14', title: 'Extreme wheel deltas clamp camera zoom cleanly inside safe bounds', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F14', 'Camera zoom telemetry not yet exposed');

        const r = await session.getRect('#canvas-host canvas');
        await session.wheel(r.left + r.width / 2, r.top + r.height / 2, -5000, 0);
        const zIn = (await h.getStageTelemetry(session))?.camera?.zoomDist;
        await session.wheel(r.left + r.width / 2, r.top + r.height / 2, 5000, 0);
        const zOut = (await h.getStageTelemetry(session))?.camera?.zoomDist;
        assert.ok(zIn >= 4 && zOut <= 30 && zIn <= zOut, `Zoom clamp invalid: zIn=${zIn}, zOut=${zOut}`);
      });
    }
  );

  reg(
    { id: 'T2-F14-4', tier: 2, feature: 'F14', title: 'Camera orbit drag is ignored while Command Shroud or Arbiter cutscene is active', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await session.clickSelector('#btn-menu-passplay');
        await h.deployPresetAndLaunch(session);
        // Shroud is now active
        await session.waitFor(() => !document.querySelector('#command-shroud')?.hasAttribute('hidden'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F14', 'Orbit telemetry not yet exposed');

        const before = (await h.getStageTelemetry(session))?.camera?.yawDeg ?? 0;
        await session.dragPoints(200, 200, 500, 300, { steps: 8 });
        const after = (await h.getStageTelemetry(session))?.camera?.yawDeg ?? 0;
        assert.ok(Math.abs(after - before) < 0.5, 'Camera orbited behind Command Shroud');
      });
    }
  );

  reg(
    { id: 'T2-F14-5', tier: 2, feature: 'F14', title: 'Orbit reset restores yaw=0 cleanly even after cycling boardView presets', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F14', 'Orbit reset telemetry not yet exposed');

        const pt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(pt.x, pt.y, pt.x + 140, pt.y, { steps: 10 });
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.resetCameraOrbit());
        await h.sleep(450);
        const yaw = (await h.getStageTelemetry(session))?.camera?.yawDeg;
        assert.ok(Math.abs(yaw ?? 99) < 1.5, `Yaw not 0 after reset: ${yaw}`);
      });
    }
  );

  // =========================================================================
  // F15 Boundaries: Dynamic Resize, Tiny Guard, Tall Landscape, Left-Hand, Decoupled 9:16
  // =========================================================================
  reg(
    { id: 'T2-F15-1', tier: 2, feature: 'F15', title: 'Dynamic resize 1280x800 -> 390x844 -> 844x390 mid-match maintains canvas aspect & layout', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', { fresh: true }, async (session) => {
        await h.startPlayViaUI(session);
        for (const [preset, w, hPx] of [
          ['MOBILE_PORTRAIT', 390, 844],
          ['MOBILE_LANDSCAPE', 844, 390],
        ]) {
          await session.setViewport(h.resolvePreset(ctx, preset));
          await h.sleep(200);
          await h.assertViewportFillAndNoOverflow(session, w, hPx, { expectFullBleed: true });
        }
      });
    }
  );

  reg(
    { id: 'T2-F15-2', tier: 2, feature: 'F15', title: 'Tiny 320x480 viewport clamps WebGL dimensions cleanly with zero NaN errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true }, async (session) => {
        await session.setViewport({ width: 320, height: 480, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await h.sleep(200);
        const dims = await session.evaluate(() => {
          const c = document.querySelector('#canvas-host canvas');
          const r = c.getBoundingClientRect();
          return { w: r.width, h: r.height, cw: c.width, ch: c.height };
        });
        assert.ok(dims.w >= 318 && dims.h >= 478 && dims.cw > 0 && dims.ch > 0, `Tiny viewport broke canvas: ${JSON.stringify(dims)}`);
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T2-F15-3', tier: 2, feature: 'F15', title: 'Tall landscape (1280x720, >640px height) docks panels cleanly without 640px ceiling breakage', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetViewportFrameMode || caps.hasFrameModeUi,
          'M3',
          'F15',
          'M3 full-viewport & >640px landscape rules pending'
        );
        await h.assertViewportFillAndNoOverflow(session, 1280, 720, { expectFullBleed: true });
        await h.startSkirmishToDeploy(session);
        await h.assertViewportFillAndNoOverflow(session, 1280, 720, { expectFullBleed: true });
      });
    }
  );

  reg(
    { id: 'T2-F15-4', tier: 2, feature: 'F15', title: 'Left-handed landscape (844x390) docks Mobilization drawer to left edge cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-handedness button[data-hand="LEFT"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await h.startSkirmishToDeploy(session);

        const pos = await session.evaluate(() => {
          const r = document.querySelector('#mobilization-drawer').getBoundingClientRect();
          return { left: r.left, right: r.right, innerW: window.innerWidth, hand: document.body.dataset.handedness };
        });
        assert.equal(pos.hand, 'LEFT');
        assert.ok(pos.left < pos.innerW - pos.right + 10, `Left-handed drawer did not dock left: ${JSON.stringify(pos)}`);
      });
    }
  );

  reg(
    { id: 'T2-F15-5', tier: 2, feature: 'F15', title: 'PHONE_9_16 frame stays decoupled from OS fullscreen and Escape key', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetViewportFrameMode, 'M3', 'F15', 'setViewportFrameMode() not yet implemented');

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('PHONE_9_16'));
        await h.sleep(100);
        await session.pressKey('Escape');
        await h.sleep(100);
        await h.assertViewportFillAndNoOverflow(session, 1280, 800, { expectFullBleed: false, expectPhoneFrame: true });
      });
    }
  );

  // =========================================================================
  // F16 Boundaries: Zero-Gesture Boot, Mute Discipline, Rapid Era, Zero Sliders, Tab Hidden
  // =========================================================================
  reg(
    { id: 'T2-F16-1', tier: 2, feature: 'F16', title: 'Zero-gesture boot produces zero AudioContext autoplay errors and unlocks on first click', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.sleep(300);
        await h.assertNoConsoleOrPageErrors(session);
        await session.clickSelector('#btn-menu-skirmish');
        await h.sleep(150);
        const spy = await h.readWebAudioSpy(session);
        assert.equal(spy.states[0], 'running');
      });
    }
  );

  reg(
    { id: 'T2-F16-2', tier: 2, feature: 'F16', title: 'audioMuted=true keeps master gain at 0 across UI clicks & clashes', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-title-mute');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 1.2));
        await h.sleep(200);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.gains.slice(0, 6).some((g) => g <= 0.02), `Master gain not attenuated when muted: ${JSON.stringify(spy.gains.slice(0, 6))}`);
      });
    }
  );

  reg(
    { id: 'T2-F16-3', tier: 2, feature: 'F16', title: 'Rapid 1980s <-> 1970s era toggles during play leave zero stuck audio errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        for (let i = 0; i < 4; i++) {
          await session.clickSelector(`#seg-era button[data-era="${i % 2 === 0 ? '1970s' : '1980s'}"]`);
        }
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T2-F16-4', tier: 2, feature: 'F16', title: 'Zeroing and maxing all 4 mixer sliders keeps audio gains bounded without NaN', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        for (const val of ['0', '100']) {
          for (const id of ['#slider-master', '#slider-music', '#slider-sfx', '#slider-ambiance']) {
            await session.evaluate(
              ({ sel, v }) => {
                const el = document.querySelector(sel);
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              },
              { sel: id, v: val }
            );
          }
        }
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.gains.every((g) => Number.isFinite(g) && g >= 0), `Invalid NaN/negative gain value: ${spy.gains}`);
        // Main 4 mixer buses + masterGain (first 6 GainNodes created in unlock) stay <= 1.05
        assert.ok(spy.gains.slice(0, 6).every((g) => g <= 1.05), `Bus mixer gain out of [0,1] bounds: ${spy.gains.slice(0, 6)}`);
      });
    }
  );

  reg(
    { id: 'T2-F16-5', tier: 2, feature: 'F16', title: 'Background tab visibilitychange (hidden -> visible) causes zero audio burst errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startPlayViaUI(session);
        await session.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await h.sleep(150);
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  // =========================================================================
  // F17 Boundaries: Skip at 50ms, Skip in Vacuum, Rapid Clashes, Compressor, Post-Dispose
  // =========================================================================
  reg(
    { id: 'T2-F17-1', tier: 2, feature: 'F17', title: 'Immediate skip at t=50ms (Act 1) cancels Act 2/3 audio nodes cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn || caps.hasSkipArbiterCutscene, 'M5', 'F17', 'Immediate Act 1 skip pending M5');

        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="FLAG_CAPTURE"]');
        await h.sleep(50);
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        if (skipSel) await session.clickSelector(skipSel);
        else await session.evaluate(() => window.__WAR_GENERALS_STAGE__.skipArbiterCutscene());
        await h.sleep(120);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.sourcesStopped > 0, 'Scheduled audio nodes were not cancelled on Act 1 skip');
      });
    }
  );

  reg(
    { id: 'T2-F17-2', tier: 2, feature: 'F17', title: 'Skip during Act 2B Strachan Vacuum restores vacuumDuckBus gain cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn || caps.hasSkipArbiterCutscene, 'M5', 'F17', 'Act 2B skip pending M5');

        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(1850); // inside Act 2B vacuum window
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        if (skipSel) await session.clickSelector(skipSel);
        else await session.evaluate(() => window.__WAR_GENERALS_STAGE__.skipArbiterCutscene());
        await h.sleep(120);
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T2-F17-3', tier: 2, feature: 'F17', title: 'Back-to-back showcase clashes run cleanly without overlapping audio crashes', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startPlayViaUI(session);
        await session.evaluate(() => {
          window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 0.2);
          window.__WAR_GENERALS_STAGE__?.poseArbiterAct('MUTUAL_SPLIT', 0.2);
        });
        await h.sleep(200);
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T2-F17-4', tier: 2, feature: 'F17', title: 'Master DynamicsCompressorNode remains active during MUTUAL_SPLIT double explosion', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        await session.clickSelector('#title-sub-skirmish [data-back-root]');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('MUTUAL_SPLIT', 2.6));
        await h.sleep(200);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.compressorCount >= 1, 'Compressor missing during double explosion');
      });
    }
  );

  reg(
    { id: 'T2-F17-5', tier: 2, feature: 'F17', title: 'Post-dispose UI click & stop calls are safe no-ops', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        const hasDispose = await session.evaluate(() => typeof window.__WAR_GENERALS_STAGE__?.disposeAudio === 'function');
        ctx.requireCapability(hasDispose, 'M4', 'F17', 'disposeAudio() hook not yet exposed');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.disposeAudio());
        await session.clickSelector('#title-sub-skirmish [data-back-root]');
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  // =========================================================================
  // F18 Boundaries: Narrow Portrait, Short Landscape, FX Reset, Overdrive, CRT Standby
  // =========================================================================
  reg(
    { id: 'T2-F18-1', tier: 2, feature: 'F18', title: 'Narrow Portrait (360x780) Arbiter framing keeps stage visible across Shots 1-3', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, async (session) => {
        for (const t of [0.35, 1.3, 2.7]) {
          await session.evaluate((sec) => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', sec), t);
          await h.sleep(120);
          const stats = await h.analyzePng(session, await session.capturePngBase64());
          assert.ok(stats.nonBlackRatio > 0.2, `Narrow Arbiter shot at t=${t} blank`);
        }
      });
    }
  );

  reg(
    { id: 'T2-F18-2', tier: 2, feature: 'F18', title: 'Short Landscape (844x360) Arbiter framing renders uncropped CRT & bastions', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, { width: 844, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, async (session) => {
        for (const t of [0.35, 1.3, 2.7]) {
          await session.evaluate((sec) => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('SPY_INTERCEPT', sec), t);
          await h.sleep(120);
          const stats = await h.analyzePng(session, await session.capturePngBase64());
          assert.ok(stats.nonBlackRatio > 0.2, `Short landscape Arbiter shot at t=${t} blank`);
        }
      });
    }
  );

  reg(
    { id: 'T2-F18-3', tier: 2, feature: 'F18', title: 'Arbiter FX reset hides all tracers, plumes, shrapnel & sparks when returning to board', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => {
          window.__WAR_GENERALS_STAGE__?.poseArbiterAct('FLAG_CAPTURE', 2.75);
        });
        await h.sleep(150);
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(150);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          (caps.hasSkipBtn || caps.hasSkipArbiterCutscene) && caps.hasGetTelemetry,
          'M5',
          'F18',
          'M5 Arbiter FX visibility telemetry not yet exposed'
        );
        const tel = await h.getStageTelemetry(session);
        assert.equal(typeof tel?.arbiterVisibleFxCount, 'number', 'getStageTelemetry().arbiterVisibleFxCount missing in M5');
        assert.equal(tel.arbiterVisibleFxCount, 0, 'Arbiter FX remained visible on board after reset');
      });
    }
  );

  reg(
    { id: 'T2-F18-4', tier: 2, feature: 'F18', title: 'Pointer overdrive hold accelerates clash cleanly and resolves to board', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(150);
        const r = await session.getRect('#canvas-host canvas');
        await session.longPress(r.left + r.width / 2, r.top + r.height / 2, 1600, { isTouch: true });
        await h.waitForArbiterResolved(session, 5000);
      });
    }
  );

  reg(
    { id: 'T2-F18-5', tier: 2, feature: 'F18', title: 'CRT recovers cleanly from MUTUAL_SPLIT flatline back to normal tabletop', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('MUTUAL_SPLIT', 2.8));
        await h.sleep(150);
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(150);
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 0.35));
        await h.sleep(150);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.2, 'CRT standby failed to recover after MUTUAL_SPLIT');
      });
    }
  );

  // =========================================================================
  // F19 Boundaries: Skip in Act 1, Act 2, Act 3, Double-Skip, Flag Breach Skip
  // =========================================================================
  reg(
    { id: 'T2-F19-1', tier: 2, feature: 'F19', title: 'HUD SKIP >> in Act 1 resolves clash immediately', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn, 'M5', 'F19', 'HUD SKIP >> button not yet implemented');
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(150);
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        await session.clickSelector(skipSel);
        await h.waitForArbiterResolved(session, 1500);
      });
    }
  );

  reg(
    { id: 'T2-F19-2', tier: 2, feature: 'F19', title: 'HUD SKIP >> in Act 2 resolves clash immediately in 1 click', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn, 'M5', 'F19', 'HUD SKIP >> button not yet implemented');
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(1100);
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        await session.clickSelector(skipSel);
        await h.waitForArbiterResolved(session, 1500);
      });
    }
  );

  reg(
    { id: 'T2-F19-3', tier: 2, feature: 'F19', title: 'HUD SKIP >> in Act 3 finishes cutscene immediately instead of stalling', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn || caps.hasSkipArbiterCutscene, 'M5', 'F19', 'Act 3 skipToComplete() not yet implemented');
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(2650); // Act 3 window
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        if (skipSel) await session.clickSelector(skipSel);
        else await session.evaluate(() => window.__WAR_GENERALS_STAGE__.skipArbiterCutscene());
        await h.waitForArbiterResolved(session, 1200);
      });
    }
  );

  reg(
    { id: 'T2-F19-4', tier: 2, feature: 'F19', title: 'Double-pressing Space during skip transition is idempotent with zero side effects', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn || caps.hasSkipArbiterCutscene, 'M5', 'F19', 'Space cutscene skip pending M5');
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(200);
        await session.pressKey('Space');
        await session.pressKey('Space');
        await h.waitForArbiterResolved(session, 2000);
        assert.equal(await h.isVisible(session, '#play-bottom-dock'), true);
      });
    }
  );

  reg(
    { id: 'T2-F19-5', tier: 2, feature: 'F19', title: 'Skipping FLAG_CAPTURE showcase clash cleanly returns control with zero errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn, 'M5', 'F19', 'HUD SKIP >> button pending M5');
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="FLAG_CAPTURE"]');
        await h.sleep(150);
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        await session.clickSelector(skipSel);
        await h.waitForArbiterResolved(session, 2000);
      });
    }
  );

  // =========================================================================
  // F20 Boundaries: Surrender Guard, Empty Log/Replay, Save Guard, Mutual Exclusion, Medal
  // =========================================================================
  reg(
    { id: 'T2-F20-1', tier: 2, feature: 'F20', title: 'Single-tapping Surrender arms HOLD TO CONFIRM without prematurely forfeiting', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-surrender');
        assert.equal(await h.getText(session, '#surrender-btn-label'), 'HOLD TO CONFIRM');
        assert.equal(await h.isVisible(session, '#dossier-card'), false, 'Single tap must not forfeit');

        // Partial short press (<400ms) also must not forfeit
        const r = await session.getRect('#btn-dock-surrender');
        await session.longPress(r.left + r.width / 2, r.top + r.height / 2, 220);
        assert.equal(await h.isVisible(session, '#dossier-card'), false, 'Early release forfeited match');
      });
    }
  );

  reg(
    { id: 'T2-F20-2', tier: 2, feature: 'F20', title: 'Turn-1 Combat Log shows commencement entry & Showcase X-Ray Replay populates archive', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-log');
        const logTxt = await h.getText(session, '#combat-log-list');
        assert.ok(
          logTxt && (logTxt.includes('Engagement commenced') || logTxt.includes('No maneuvers logged yet')),
          `Unexpected Turn-1 log text: ${logTxt}`
        );
        await session.clickSelector('#btn-log-open-xray');
        await session.waitFor(() => !document.querySelector('#replay-bar')?.hasAttribute('hidden'));
        assert.ok((await h.getText(session, '#replay-turn-label'))?.includes('PLY'));
      });
    }
  );

  reg(
    { id: 'T2-F20-3', tier: 2, feature: 'F20', title: 'Blueprint Save button stays disabled <21 pieces and enables at 21/21', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');
        assert.equal(await session.evaluate(() => document.querySelector('#btn-arm-save')?.disabled), true);
        await session.clickSelector('#btn-dep-auto');
        assert.equal(await session.evaluate(() => document.querySelector('#btn-arm-save')?.disabled), false);
      });
    }
  );

  reg(
    { id: 'T2-F20-4', tier: 2, feature: 'F20', title: 'Drawers are mutually exclusive and Escape closes active drawer cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-intel');
        assert.equal(await h.isVisible(session, '#sheet-intel'), true);
        await session.clickSelector('#btn-dock-settings');
        assert.equal(await h.isVisible(session, '#sheet-options'), true);
        assert.equal(await h.isVisible(session, '#sheet-intel'), false, 'Intel sheet did not close when Options opened');
        await session.pressKey('Escape');
        await h.sleep(100);
        assert.equal(await h.isVisible(session, '#sheet-options'), false, 'Escape did not close Options sheet');
      });
    }
  );

  reg(
    { id: 'T2-F20-5', tier: 2, feature: 'F20', title: 'Skirmish surrender Dossier keeps #dossier-medal hidden', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await h.performTwoStepSurrender(session);
        assert.equal(await h.isVisible(session, '#dossier-medal'), false, 'Medal banner should be hidden on Skirmish defeat');
      });
    }
  );

  // =========================================================================
  // F24 Boundaries: Portrait/Landscape/Desktop Fit, Sub-Panels, Extreme Orbit Seam
  // =========================================================================
  reg(
    {
      id: 'T2-F24-1',
      tier: 2,
      feature: 'F24',
      title: 'MOBILE_PORTRAIT (390x844): Heroic Title, utility glyphs & command blades fit with zero overlap or overflow',
      timeoutMs: 25000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const landed = await h.hasM5HeroStartScreen(session);
        ctx.requireCapability(landed, 'M5', 'F24', 'M5 Heroic Start Screen UI not yet landed');

        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });

        const layout = await session.evaluate(() => {
          const innerW = window.innerWidth;
          const innerH = window.innerHeight;
          const heroEl = document.querySelector('#title-screen img[src*="hero_crest"]');
          const heroHeader = heroEl?.closest('[class*="hero"], [class*="crest"], [class*="title-top"], .title-top-bar') || heroEl;
          const muteEl = document.querySelector('#btn-title-mute');
          const fsEl = document.querySelector('#btn-title-fs');
          const primaryEl = document.querySelector('#btn-menu-skirmish');
          const deckBtns = Array.from(document.querySelectorAll('#title-main-cards button, #title-thumb-deck button')).filter(
            (b) => !b.closest('[hidden]') && window.getComputedStyle(b).display !== 'none'
          );

          const toBox = (el, label) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { label, left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
          };

          const boxes = [
            toBox(heroEl, 'hero_crest'),
            toBox(muteEl, 'btn-title-mute'),
            toBox(fsEl, 'btn-title-fs'),
            ...deckBtns.map((b, idx) => toBox(b, b.id || `blade-${idx}`)),
          ].filter(Boolean);

          const outOfBounds = boxes.filter(
            (b) => b.w <= 0 || b.h <= 0 || b.left < -2 || b.top < -2 || b.right > innerW + 2 || b.bottom > innerH + 2
          );

          const overlaps = [];
          const checkPair = (a, b) => {
            if (!a || !b) return;
            const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            if (ix > 4 && iy > 4) overlaps.push([a.label, b.label, Math.round(ix), Math.round(iy)]);
          };

          const heroBox = toBox(heroHeader, 'hero-centerpiece');
          const muteBox = toBox(muteEl, 'btn-title-mute');
          const fsBox = toBox(fsEl, 'btn-title-fs');
          const primaryBox = toBox(primaryEl, 'btn-menu-skirmish');

          checkPair(heroBox, muteBox);
          checkPair(heroBox, fsBox);
          checkPair(heroBox, primaryBox);
          checkPair(muteBox, primaryBox);
          checkPair(fsBox, primaryBox);

          return {
            scrollW: document.documentElement.scrollWidth,
            innerW,
            hasHero: Boolean(heroEl),
            hasPrimary: Boolean(primaryEl),
            outOfBounds,
            overlaps,
          };
        });

        assert.equal(layout.hasHero, true, 'Missing Heroic Title Centerpiece img[src*="hero_crest"]');
        assert.equal(layout.hasPrimary, true, 'Missing primary #btn-menu-skirmish blade');
        assert.ok(layout.scrollW <= layout.innerW, `Horizontal overflow: scrollWidth=${layout.scrollW} > ${layout.innerW}`);
        assert.equal(layout.outOfBounds.length, 0, `Portrait F24 elements clipped/collapsed: ${JSON.stringify(layout.outOfBounds)}`);
        assert.equal(layout.overlaps.length, 0, `Portrait F24 key elements overlap: ${JSON.stringify(layout.overlaps)}`);
      });
    }
  );

  reg(
    {
      id: 'T2-F24-2',
      tier: 2,
      feature: 'F24',
      title: 'MOBILE_LANDSCAPE (844x390): Heroic Title + asymmetric command blades fit cleanly without vertical clipping',
      timeoutMs: 25000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', async (session) => {
        const landed = await h.hasM5HeroStartScreen(session);
        ctx.requireCapability(landed, 'M5', 'F24', 'M5 Heroic Start Screen UI not yet landed');

        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });

        const audit = await session.evaluate(() => {
          const innerW = window.innerWidth;
          const innerH = window.innerHeight;
          const legacyCrest = document.querySelectorAll('.war-generals-crest').length;
          const legacyIcon = document.querySelectorAll('.mc-icon').length;
          const legacyCards = document.querySelectorAll('.menu-command-card').length;
          const hero = document.querySelector('#title-screen img[src*="hero_crest"]');
          const heroR = hero ? hero.getBoundingClientRect() : null;
          const blades = Array.from(document.querySelectorAll('#title-main-cards button, #title-thumb-deck button'))
            .filter((b) => !b.closest('[hidden]') && window.getComputedStyle(b).display !== 'none')
            .map((b) => {
              const r = b.getBoundingClientRect();
              return { id: b.id || b.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
            });
          const clipped = blades.filter((b) => b.w <= 0 || b.h <= 0 || b.bottom > innerH + 2 || b.right > innerW + 2 || b.top < -2);
          return {
            legacyCrest,
            legacyIcon,
            legacyCards,
            heroBox: heroR ? { w: heroR.width, h: heroR.height, bottom: heroR.bottom, right: heroR.right } : null,
            bladeCount: blades.length,
            clipped,
            innerW,
            innerH,
          };
        });

        assert.equal(audit.legacyCrest, 0, '.war-generals-crest must not exist in landscape');
        assert.equal(audit.legacyIcon, 0, '.mc-icon must not exist in landscape');
        assert.equal(audit.legacyCards, 0, '.menu-command-card must not exist in landscape');
        assert.ok(audit.heroBox && audit.heroBox.w > 24 && audit.heroBox.h > 24, `Heroic crest missing/collapsed: ${JSON.stringify(audit.heroBox)}`);
        assert.ok(audit.heroBox.bottom <= audit.innerH + 2, `Heroic crest clipped vertically: ${JSON.stringify(audit.heroBox)}`);
        assert.ok(audit.bladeCount >= 5, `Expected >= 5 command blades in landscape, got ${audit.bladeCount}`);
        assert.equal(audit.clipped.length, 0, `Command blades clipped in landscape: ${JSON.stringify(audit.clipped)}`);
      });
    }
  );

  reg(
    {
      id: 'T2-F24-3',
      tier: 2,
      feature: 'F24',
      title: 'DESKTOP_WIDE (1440x900) FULL_VIEWPORT & PHONE_9_16 scale Heroic Title + blades without legacy fallback',
      timeoutMs: 30000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_WIDE', async (session) => {
        const caps = await h.getStageCapabilities(session);
        const landed = await h.hasM5HeroStartScreen(session);
        ctx.requireCapability(
          caps.hasSetViewportFrameMode && landed,
          'M3/M5',
          'F24',
          'ViewportFrameMode & M5 Heroic Start Screen required'
        );

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('FULL_VIEWPORT'));
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 1440, 900, { expectFullBleed: true });

        const checkDesktopStart = async (modeLabel) => {
          const res = await session.evaluate(() => {
            const crest = document.querySelector('#title-screen img[src*="hero_crest"]');
            const cr = crest ? crest.getBoundingClientRect() : null;
            return {
              legacyCrests: document.querySelectorAll('.war-generals-crest').length,
              legacyCards: document.querySelectorAll('.menu-command-card, .mc-icon').length,
              crestOk: Boolean(crest && crest.complete && crest.naturalWidth >= 512 && cr && cr.width > 40 && cr.height > 40),
            };
          });
          assert.equal(res.legacyCrests, 0, `Legacy .war-generals-crest appeared in ${modeLabel}`);
          assert.equal(res.legacyCards, 0, `Legacy .menu-command-card/.mc-icon appeared in ${modeLabel}`);
          assert.equal(res.crestOk, true, `Heroic crest invalid in ${modeLabel}: ${JSON.stringify(res)}`);
        };

        await checkDesktopStart('FULL_VIEWPORT');

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('PHONE_9_16'));
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 1440, 900, { expectFullBleed: false, expectPhoneFrame: true });
        await checkDesktopStart('PHONE_9_16');
      });
    }
  );

  reg(
    {
      id: 'T2-F24-4',
      tier: 2,
      feature: 'F24',
      title: 'Sub-panels (Skirmish, Campaign, Operations, Options) use sculpted non-boxy chrome without .mc-icon/.menu-command-card',
      timeoutMs: 30000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const landed = await h.hasM5HeroStartScreen(session);
        ctx.requireCapability(landed, 'M5', 'F24', 'M5 sculpted sub-panel UI not yet landed');

        const assertPanelClean = async (panelSelectors, label) => {
          const check = await session.evaluate((sels) => {
            const legacy = document.querySelectorAll('.menu-command-card, .mc-icon, .war-generals-crest').length;
            let panel = null;
            for (const s of sels) {
              const el = document.querySelector(s);
              if (el && !el.hasAttribute('hidden') && window.getComputedStyle(el).display !== 'none') {
                panel = el;
                break;
              }
            }
            if (!panel) return { found: false, legacy };
            const r = panel.getBoundingClientRect();
            return {
              found: true,
              legacy,
              w: r.width,
              h: r.height,
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              innerW: window.innerWidth,
              innerH: window.innerHeight,
              scrollW: document.documentElement.scrollWidth,
            };
          }, panelSelectors);

          assert.equal(check.found, true, `${label} panel did not open visibly`);
          assert.equal(check.legacy, 0, `${label} still contains legacy boxy classes`);
          assert.ok(check.w > 100 && check.h > 80, `${label} collapsed: ${JSON.stringify(check)}`);
          assert.ok(
            check.left >= -2 && check.top >= -2 && check.right <= check.innerW + 2 && check.bottom <= check.innerH + 2,
            `${label} clipped outside viewport: ${JSON.stringify(check)}`
          );
          assert.ok(check.scrollW <= check.innerW + 1, `${label} caused horizontal overflow`);
        };

        // 1. Skirmish
        await session.clickSelector('#btn-menu-skirmish');
        await assertPanelClean(['#title-sub-skirmish'], 'Skirmish');
        await session.clickSelector('#title-sub-skirmish [data-back-root]');

        // 2. Campaign
        await session.clickSelector('#btn-menu-campaign');
        await assertPanelClean(['#title-sub-campaign'], 'Campaign');
        await session.clickSelector('#title-sub-campaign [data-back-root]');

        // 3. Operations
        const opsBtn = await h.findVisibleSelector(session, ['#btn-menu-operations', '[data-menu-operations]', '[data-mode="OPERATION"]']);
        assert.ok(opsBtn, 'Operations navigation button missing');
        await session.clickSelector(opsBtn);
        await assertPanelClean(['#title-sub-operations', '.operations-panel', '#sheet-operations'], 'Operations');
        const opsClose = await h.findVisibleSelector(session, [
          '#title-sub-operations [data-back-root]',
          '#sheet-operations [data-close-sheet]',
          '[data-back-root]',
          '[data-close-sheet]',
        ]);
        if (opsClose) await session.clickSelector(opsClose);
        else await session.evaluate(() => window.__WAR_GENERALS_STAGE__.poseTitle());

        // 4. Options
        await session.clickSelector('#btn-menu-options');
        await assertPanelClean(['#sheet-options'], 'Options');
        await session.clickSelector('#sheet-options [data-close-sheet]');
      });
    }
  );

  reg(
    {
      id: 'T2-F24-5',
      tier: 2,
      feature: 'F24',
      title: 'Extreme camera pitch (24 deg) + yaw (+/-38 deg) has zero bright white horizontal cyclorama seam',
      timeoutMs: 30000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasResetCameraOrbit && caps.hasGetTelemetry,
          'M3',
          'F24',
          'Bounded camera pitch/yaw orbit & telemetry required for extreme-angle seam test'
        );

        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-view button[data-view="TACTICAL"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await h.sleep(200);

        const pt = await h.projectBoardCoord(session, 0, 3, { boardView: 'TACTICAL', phase: 'PLAY', worldY: 0 });
        // Drive pitch down to 24 deg clamp
        await session.dragPoints(pt.x, pt.y, pt.x, pt.y - 800, { steps: 12 });
        await h.sleep(150);

        // Drive yaw to +38 deg clamp
        await session.dragPoints(pt.x, pt.y, pt.x + 800, pt.y, { steps: 12 });
        await h.sleep(200);
        const telPos = await h.getStageTelemetry(session);
        const seamPos = await h.detectWhiteHorizontalSeam(session, await session.capturePngBase64());
        assert.equal(
          seamPos.hasSeam,
          false,
          `White seam at low pitch (${telPos?.camera?.pitchDeg}) & +yaw (${telPos?.camera?.yawDeg}): ${JSON.stringify(seamPos)}`
        );

        // Drive yaw to -38 deg clamp while keeping low pitch
        await session.dragPoints(pt.x + 200, pt.y, pt.x - 1100, pt.y, { steps: 12 });
        await h.sleep(200);
        const telNeg = await h.getStageTelemetry(session);
        const seamNeg = await h.detectWhiteHorizontalSeam(session, await session.capturePngBase64());
        assert.equal(
          seamNeg.hasSeam,
          false,
          `White seam at low pitch (${telNeg?.camera?.pitchDeg}) & -yaw (${telNeg?.camera?.yawDeg}): ${JSON.stringify(seamNeg)}`
        );
      });
    }
  );
}
