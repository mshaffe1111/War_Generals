// Tier 3 Browser E2E Suite — 21 Cross-Feature Pairwise Combinations
// IDs: T3-01..09, T3-12..16, T3-18..20, T3-22..25
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
    { id: 'T3-01', tier: 3, feature: 'F11+F16+F19', title: '1970s + NIGHT_OPS + RECON_STEALTH + SKIP (Act 2)', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { era: '1970s', preset: 'VACCINATION' });
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetTheater && (caps.hasSkipBtn || caps.hasSkipArbiterCutscene),
          'M2/M5',
          'F11+F19',
          'NIGHT_OPS setTheater + Act 2 skip pending M2/M5'
        );
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('NIGHT_OPS'));
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="SPY_INTERCEPT"]');
        await h.sleep(1000);
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        if (skipSel) await session.clickSelector(skipSel);
        else await session.evaluate(() => window.__WAR_GENERALS_STAGE__.skipArbiterCutscene());
        await h.waitForArbiterResolved(session, 2000);
        assert.equal(await session.evaluate(() => document.body.dataset.era), '1970s');
      });
    }
  );

  reg(
    { id: 'T3-02', tier: 3, feature: 'F4+F12+F13+F15', title: 'OPERATION + BATTERY_SAVER + Mobile Landscape (844x390) + Drag Move', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasOpsBtn && caps.hasGetTelemetry, 'M5', 'F4+F12', 'Operations UI & Quality telemetry pending M5');

        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-quality button[data-quality="BATTERY_SAVER"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');

        const opsBtn = await h.findVisibleSelector(session, ['#btn-menu-operations', '[data-menu-operations]']);
        await session.clickSelector(opsBtn);
        const opItem = await h.findVisibleSelector(session, ['[data-operation-id]', '[data-operation]', '.operation-card']);
        await session.clickSelector(opItem);
        const launchBtn = await h.findVisibleSelector(session, ['#btn-start-operation', '#btn-launch-operation', '[data-launch-operation]']);
        await session.clickSelector(launchBtn);
        await h.waitForTurnActive(session);
        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });

        const tel = await h.getStageTelemetry(session);
        assert.equal(tel?.lanternCastShadow, false, 'BATTERY_SAVER must disable lantern shadow in Operation');
      });
    }
  );

  reg(
    { id: 'T3-03', tier: 3, feature: 'F3+F5+F14+F15', title: 'CAMPAIGN + FULL_VIEWPORT (1280x800) + Yaw Orbit + ENEMY_WINS Fog-of-War', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetViewportFrameMode && caps.hasResetCameraOrbit,
          'M3',
          'F14+F15',
          'Full-viewport desktop & yaw orbit pending M3'
        );
        await h.assertViewportFillAndNoOverflow(session, 1280, 800, { expectFullBleed: true });

        await session.clickSelector('#btn-menu-campaign');
        await session.clickSelector('#btn-launch-campaign');
        await h.deployPresetAndLaunch(session, 'VACCINATION');

        const pt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(pt.x, pt.y, pt.x + 120, pt.y, { steps: 10 });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="ENEMY_WIN"]');
        await h.waitForArbiterResolved(session, 8000);
        await session.clickSelector('#btn-dock-log');
        await h.assertNoEnemyRankLeakInDom(session);
      });
    }
  );

  reg(
    { id: 'T3-04', tier: 3, feature: 'F3+F9+F19', title: 'PASS_AND_PLAY + 1980s + RETRO_BAKELITE + MUTUAL_SPLIT', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-era button[data-era="1980s"]');
        await session.clickSelector('#seg-finish button[data-finish="RETRO_BAKELITE"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');

        await session.clickSelector('#btn-menu-passplay');
        await session.clickSelector('[data-dep-preset="VACCINATION"]');
        await session.clickSelector('#btn-launch-battle');
        await session.waitFor(() => !document.querySelector('#command-shroud')?.hasAttribute('hidden'));
        await h.assertNoEnemyRankLeakInDom(session);

        await session.clickSelector('#btn-unseal-shroud');
        await session.clickSelector('[data-dep-preset="MOTHERSHIP"]');
        await session.clickSelector('#btn-launch-battle');
        await session.waitFor(() => !document.querySelector('#command-shroud')?.hasAttribute('hidden'));
        await session.clickSelector('#btn-unseal-shroud');
        await h.waitForTurnActive(session);

        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="MUTUAL_SPLIT"]');
        await h.waitForArbiterResolved(session, 15000);
        await h.assertNoEnemyRankLeakInDom(session);
      });
    }
  );

  reg(
    { id: 'T3-05', tier: 3, feature: 'F11+F19', title: 'SKIRMISH + PACIFIC_BRIDGE + HIGH_COMMAND + TACTICAL_FAST + Space Skip', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetTheater && (caps.hasSkipBtn || caps.hasSkipArbiterCutscene),
          'M2/M5',
          'F11+F19',
          'PACIFIC_BRIDGE theater + Space skip pending M2/M5'
        );
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('PACIFIC_BRIDGE'));
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-speed button[data-speed="TACTICAL_FAST"]');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(150);
        await session.pressKey('Space');
        await h.waitForArbiterResolved(session, 2000);
      });
    }
  );

  reg(
    { id: 'T3-06', tier: 3, feature: 'F11+F13+F14+F15', title: 'IRON_BUNKER + PHONE_9_16 + LEFT Handedness + OVERHEAD (62 deg) + Drag Deploy', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetViewportFrameMode && caps.hasSetTheater, 'M2/M3', 'F11+F15', 'PHONE_9_16 & IRON_BUNKER pending M2/M3');

        await session.evaluate(() => {
          window.__WAR_GENERALS_STAGE__.setViewportFrameMode('PHONE_9_16');
          window.__WAR_GENERALS_STAGE__.setTheater('IRON_BUNKER');
        });
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-handedness button[data-hand="LEFT"]');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-view button[data-view="OVERHEAD"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');

        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');
        const chipRect = await session.getRect('#mob-chip-grid .crate-rank-chip[data-rank="GEN_5"]');
        const target = await h.projectBoardCoord(session, 4, 6, { boardView: 'OVERHEAD', phase: 'DEPLOY', handedness: 'LEFT', worldY: 0.02 });
        await session.dragPoints(chipRect.left + chipRect.width / 2, chipRect.top + chipRect.height / 2, target.x, target.y + 28, { steps: 12 });
        await h.assertViewportFillAndNoOverflow(session, 1280, 800, { expectFullBleed: false, expectPhoneFrame: true });
      });
    }
  );

  reg(
    { id: 'T3-07', tier: 3, feature: 'F6+F16+F19', title: '1970s + BLITZ Clock + ARMOR_ARTILLERY + AUDIO_MUTED + Esc Skip', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-title-mute');
        await h.startPlayViaUI(session, { era: '1970s' });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-clocks button[data-clock="BLITZ"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn || caps.hasSkipArbiterCutscene, 'M5', 'F19', 'Escape skip pending M5');

        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(150);
        await session.pressKey('Escape');
        await h.waitForArbiterResolved(session, 2000);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.gains.slice(0, 6).some((g) => g <= 0.02), `Audio should remain muted: ${JSON.stringify(spy.gains.slice(0, 6))}`);
      });
    }
  );

  reg(
    { id: 'T3-08', tier: 3, feature: 'F4+F15', title: 'OPERATION (FLAG_TRAVERSE) + 1980s + Mobile Portrait (390x844)', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasOpsBtn, 'M5', 'F4', 'Operations UI pending M5');
        const opsBtn = await h.findVisibleSelector(session, ['#btn-menu-operations', '[data-menu-operations]']);
        await session.clickSelector(opsBtn);
        const travOp = await h.findVisibleSelector(session, ['[data-objective="FLAG_TRAVERSE"]', '[data-operation-id]', '.operation-card']);
        await session.clickSelector(travOp);
        const launchBtn = await h.findVisibleSelector(session, ['#btn-start-operation', '#btn-launch-operation', '[data-launch-operation]']);
        await session.clickSelector(launchBtn);
        await h.waitForTurnActive(session);
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });
      });
    }
  );

  reg(
    { id: 'T3-09', tier: 3, feature: 'F2+F5+F19', title: '1970s + HOLLIS (SUPREME_MARSHAL) + UNTIMED + FLAG_BREACH', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { commander: 'HOLLIS', era: '1970s', difficulty: 'SUPREME_MARSHAL' });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-clocks button[data-clock="UNTIMED"]');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="FLAG_CAPTURE"]');
        await h.waitForArbiterResolved(session, 15000);
        assert.equal(await h.getText(session, '#val-countdown'), '∞');
      });
    }
  );

  reg(
    { id: 'T3-12', tier: 3, feature: 'F12+F20', title: 'FIELD_HQ + AUTO Quality (Slow Frame Injection) + X-Ray Replay 42 pieces', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseReplay());
        await session.waitFor(() => !document.querySelector('#replay-bar')?.hasAttribute('hidden'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSimulateFrameDt && caps.hasGetTelemetry, 'M2/M3', 'F12', 'QualityGovernor telemetry pending');

        await session.evaluate(() => {
          for (let i = 0; i < 60; i++) window.__WAR_GENERALS_STAGE__.simulateFrameDt(0.05);
        });
        const tel = await h.getStageTelemetry(session);
        assert.notEqual(tel?.quality?.resolvedTier, 'ULTRA');
        await session.clickSelector('#btn-rep-next');
      });
    }
  );

  reg(
    { id: 'T3-13', tier: 3, feature: 'F11+F13+F14', title: 'NIGHT_OPS + TACTICAL (32 deg) + Yaw Orbit + Occluded row 7 tap + Suspect Wheel', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater && caps.hasResetCameraOrbit, 'M2/M3', 'F11+F14', 'NIGHT_OPS + Yaw Orbit pending');

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('NIGHT_OPS'));
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-view button[data-view="TACTICAL"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await h.sleep(200);

        await h.tapBoardCoord(session, 4, 7, { boardView: 'TACTICAL', phase: 'PLAY', worldY: 0.65 });
        assert.equal(await h.getText(session, '#sel-unit-name'), 'FLAG');
        let opened = false;
        for (const [ec, er] of [
          [4, 2],
          [3, 2],
          [5, 2],
          [2, 2],
          [4, 1],
          [3, 1],
          [5, 1],
        ]) {
          await h.longPressBoardCoord(session, ec, er, 380, { boardView: 'TACTICAL', phase: 'PLAY', isTouch: true });
          await h.sleep(50);
          if (await h.isVisible(session, '#suspect-wheel')) {
            opened = true;
            break;
          }
        }
        assert.equal(opened, true, 'Suspect Wheel did not open on enemy piece');
        await session.clickSelector('#suspect-wheel .suspect-orb[data-suspect="GEN?"]');
      });
    }
  );

  reg(
    { id: 'T3-14', tier: 3, feature: 'F5+F11+F20', title: 'ARMORY + Custom Blueprint S1 + Mirror + Launch Skirmish + PACIFIC_BRIDGE', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-armory');
        await session.clickSelector('[data-dep-preset="IRON_BLITZ"]');
        await session.clickSelector('#btn-dep-mirror');
        await session.clickSelector('#btn-arm-save');
        await session.clickSelector('.mob-slot-pill[data-slot="0"]');
        await session.clickSelector('#btn-launch-battle');
        await h.waitForTurnActive(session);

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'setTheater() pending M2/M3');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('PACIFIC_BRIDGE'));
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T3-15', tier: 3, feature: 'F5+F20', title: 'CAMPAIGN (Tier 1) -> Dossier -> X-Ray Replay -> Rematch', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-campaign');
        await session.clickSelector('#btn-launch-campaign');
        await h.deployPresetAndLaunch(session, 'VACCINATION');

        await h.performTwoStepSurrender(session);

        await session.clickSelector('#btn-dossier-replay');
        await session.waitFor(() => !document.querySelector('#replay-bar')?.hasAttribute('hidden'));
        await session.clickSelector('#btn-rep-rematch');
        await session.waitFor(() => !document.querySelector('#mobilization-drawer')?.hasAttribute('hidden'));
      });
    }
  );

  reg(
    { id: 'T3-16', tier: 3, feature: 'F15+F18', title: 'Dynamic Resize (1280x800 -> 390x844 -> 844x390) during active ARBITER cutscene', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', { fresh: true }, async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 1.25));
        for (const [preset, w, hPx] of [
          ['MOBILE_PORTRAIT', 390, 844],
          ['MOBILE_LANDSCAPE', 844, 390],
        ]) {
          await session.setViewport(h.resolvePreset(ctx, preset));
          await h.sleep(150);
          const stats = await h.analyzePng(session, await session.capturePngBase64());
          assert.ok(stats.nonBlackRatio > 0.2, `Arbiter blank after resize to ${w}x${hPx}`);
        }
      });
    }
  );

  reg(
    { id: 'T3-18', tier: 3, feature: 'F16+F17+F19', title: '1980s + 4-Bus Mixer (Music 0, SFX 100) + Act 2 + SKIP >> stops SFX cleanly', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.evaluate(() => {
          const m = document.querySelector('#slider-music');
          m.value = '0';
          m.dispatchEvent(new Event('input', { bubbles: true }));
          const s = document.querySelector('#slider-sfx');
          s.value = '100';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await session.clickSelector('#sheet-options [data-close-sheet]');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn, 'M5', 'F17+F19', 'HUD SKIP >> button pending M5');

        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(1000);
        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        await session.clickSelector(skipSel);
        await h.waitForArbiterResolved(session, 2000);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.sourcesStopped > 0);
      });
    }
  );

  reg(
    { id: 'T3-19', tier: 3, feature: 'F9+F15+F20', title: 'FIELD_MANUAL + RETRO_BAKELITE + Mobile Landscape (844x390)', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-finish button[data-finish="RETRO_BAKELITE"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await session.clickSelector('#btn-menu-manual');
        await session.waitFor(() => !document.querySelector('#manual-sheet')?.hasAttribute('hidden'));
        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });
        await session.clickSelector('.manual-rank-pill[data-manual-rank="PRIVATE"]');
        assert.equal(await h.getText(session, '#manual-rank-title'), 'PRIVATE');
      });
    }
  );

  reg(
    { id: 'T3-20', tier: 3, feature: 'F8+F11+F12+F14', title: 'INSPECT_16 + IRON_BUNKER + ULTRA Quality + Camera Reset', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater && caps.hasResetCameraOrbit, 'M2/M3', 'F11+F14', 'IRON_BUNKER & resetCameraOrbit pending');
        await session.evaluate(() => {
          window.__WAR_GENERALS_STAGE__.setTheater('IRON_BUNKER');
          window.__WAR_GENERALS_STAGE__.poseInspect16();
        });
        await h.sleep(250);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.2, 'Inspect 16 in IRON_BUNKER rendered black');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.resetCameraOrbit());
      });
    }
  );

  reg(
    { id: 'T3-22', tier: 3, feature: 'F3+F20', title: 'PLAY + Intel Ledger + AI Turn completes + Combat Log updates live without leak', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await h.tapBoardCoord(session, 4, 5);
        await h.tapBoardCoord(session, 4, 4);
        await h.waitForTurnActive(session);

        await session.clickSelector('#btn-dock-intel');
        await h.assertNoEnemyRankLeakInDom(session);
        await session.clickSelector('#btn-dock-log');
        const rows = await session.evaluate(() => document.querySelectorAll('#combat-log-list .log-row').length);
        assert.ok(rows >= 2, `Expected >= 2 public log rows after player+AI turns, got ${rows}`);
        await h.assertNoEnemyRankLeakInDom(session);
      });
    }
  );

  reg(
    { id: 'T3-23', tier: 3, feature: 'F13+F20', title: 'DEPLOY Clear + Crate Drag + Board Swap + Auto-fill + Launch Turn 1', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');

        const chipRect = await session.getRect('#mob-chip-grid .crate-rank-chip[data-rank="FLAG"]');
        const t1 = await h.projectBoardCoord(session, 4, 7, { phase: 'DEPLOY', worldY: 0.02 });
        await session.dragPoints(chipRect.left + chipRect.width / 2, chipRect.top + chipRect.height / 2, t1.x, t1.y + 28, { steps: 12 });
        assert.equal(await h.getText(session, '#mob-count-pill'), '1 / 21');

        await session.clickSelector('#btn-dep-auto');
        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21');

        // Swap two placed pieces on row 5
        await h.tapBoardCoord(session, 3, 5, { phase: 'DEPLOY' });
        await h.tapBoardCoord(session, 5, 5, { phase: 'DEPLOY' });
        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21');

        await session.clickSelector('#btn-launch-battle');
        await h.waitForTurnActive(session);
      });
    }
  );

  reg(
    { id: 'T3-24', tier: 3, feature: 'F2+F5+F6+F20', title: 'SKIRMISH (REYES) + 1970s + BLITZ + 2-Step Hold Surrender', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { commander: 'REYES', era: '1970s', preset: 'MOTHERSHIP' });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-clocks button[data-clock="BLITZ"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await h.sleep(1100);
        const timerTxt = await h.getText(session, '#val-countdown');
        assert.ok(timerTxt && timerTxt.startsWith('04:'), `Expected Blitz clock ticking below 05:00, got ${timerTxt}`);

        await h.performTwoStepSurrender(session);
      });
    }
  );

  reg(
    {
      id: 'T3-25',
      tier: 3,
      feature: 'F11+F14+F15+F24',
      title: 'NIGHT_OPS + DESKTOP_WIDE (1440x900) + TITLE Heroic Centerpiece + 24 deg pitch / +38 deg yaw',
      timeoutMs: 35000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_WIDE', async (session) => {
        const caps = await h.getStageCapabilities(session);
        const landed = await h.hasM5HeroStartScreen(session);
        ctx.requireCapability(
          caps.hasSetTheater && caps.hasResetCameraOrbit && landed,
          'M3/M5',
          'F11+F14+F24',
          'NIGHT_OPS + camera orbit + M5 Heroic Title Centerpiece required'
        );

        if (caps.hasSetViewportFrameMode) {
          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('FULL_VIEWPORT'));
        }
        await session.evaluate(() => {
          window.__WAR_GENERALS_STAGE__.setTheater('NIGHT_OPS');
          window.__WAR_GENERALS_STAGE__.poseTitle();
        });
        await h.sleep(250);
        await h.assertViewportFillAndNoOverflow(session, 1440, 900, { expectFullBleed: true });

        const uiAudit = await session.evaluate(() => {
          const hero = document.querySelector('#title-screen img[src*="hero_crest"]');
          return {
            legacyCount: document.querySelectorAll('.war-generals-crest, .menu-command-card, .mc-icon').length,
            heroOk: Boolean(hero && hero.complete && hero.naturalWidth >= 512),
          };
        });
        assert.equal(uiAudit.legacyCount, 0, 'Legacy boxy UI classes found in T3-25');
        assert.equal(uiAudit.heroOk, true, 'Heroic Title Centerpiece img[src*="hero_crest"] missing or unloaded');

        const titleSeam = await h.detectWhiteHorizontalSeam(session, await session.capturePngBase64());
        assert.equal(titleSeam.hasSeam, false, `White cyclorama seam in NIGHT_OPS TITLE (1440x900): ${JSON.stringify(titleSeam)}`);

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.poseTabletop('TACTICAL'));
        await h.sleep(200);
        const pt = await h.projectBoardCoord(session, 0, 3, { boardView: 'TACTICAL', phase: 'PLAY', worldY: 0 });
        await session.dragPoints(pt.x, pt.y, pt.x + 800, pt.y - 800, { steps: 12 });
        await h.sleep(200);
        const playSeam = await h.detectWhiteHorizontalSeam(session, await session.capturePngBase64());
        assert.equal(playSeam.hasSeam, false, `White cyclorama seam in NIGHT_OPS 24deg/+38deg PLAY: ${JSON.stringify(playSeam)}`);
      });
    }
  );
}
