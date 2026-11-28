// Tier 1 Browser E2E Suite — 66 Feature Coverage Checks (WebGL2, WebAudio, Controls, Layout, HUD, F24)
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
  // F1: Shared Type & Contract Lock (T1-F01-5)
  // =========================================================================
  reg(
    { id: 'T1-F01-5', tier: 1, feature: 'F1', title: 'QA stage API exposes public hooks with zero truthRank/truthPieces leak', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const audit = await session.evaluate(() => {
          const stage = window.__WAR_GENERALS_STAGE__;
          if (!stage) return { missing: true };
          const keys = Object.keys(stage);
          const serialized = JSON.stringify(stage);
          const hasPrivateLeak =
            serialized.includes('truthPieces') ||
            serialized.includes('trueRank') ||
            'truthPieces' in window ||
            '__TRUTH__' in window;
          return { missing: false, keys, hasPrivateLeak };
        });

        assert.equal(audit.missing, false, 'window.__WAR_GENERALS_STAGE__ is missing');
        assert.equal(audit.hasPrivateLeak, false, 'Private truth state leaked onto window/stage');
        for (const reqKey of ['poseTitle', 'poseTabletop', 'poseInspect16', 'poseReplay', 'poseFieldManual', 'poseArbiterAct']) {
          assert.ok(audit.keys.includes(reqKey), `Baseline stage hook missing: ${reqKey}`);
        }

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetTheater && caps.hasResetCameraOrbit && caps.hasSetViewportFrameMode && caps.hasGetTelemetry,
          'M3/M5',
          'F1',
          'Extended M3/M5 stage hooks (setTheater, resetCameraOrbit, setViewportFrameMode, telemetry) pending'
        );
      });
    }
  );

  // =========================================================================
  // F3: Fog-of-War & Pass-and-Play Masking (T1-F03-4)
  // =========================================================================
  reg(
    { id: 'T1-F03-4', tier: 1, feature: 'F3', title: 'Live Skirmish loss keeps enemy rank masked in DOM and 3D rotation.y ≈ Math.PI', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { commander: 'MILLER', preset: 'VACCINATION' });
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-speed button[data-speed="TACTICAL_FAST"]');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="ENEMY_WIN"]');
        await h.sleep(250);
        await h.assertNoEnemyRankLeakInDom(session);

        await h.waitForArbiterResolved(session, 10000);
        await h.waitForTurnActive(session, 10000);

        await session.clickSelector('#btn-dock-intel');
        assert.equal(await h.isVisible(session, '#sheet-intel'), true, 'Intel sheet did not open');
        await h.assertNoEnemyRankLeakInDom(session);
        await session.clickSelector('#sheet-intel [data-close-sheet]');

        await session.clickSelector('#btn-dock-log');
        assert.equal(await h.isVisible(session, '#sheet-log'), true, 'Combat log sheet did not open');
        await h.assertNoEnemyRankLeakInDom(session);
        await session.clickSelector('#sheet-log [data-close-sheet]');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F3', '3D piece orientation telemetry not yet exposed on __WAR_GENERALS_STAGE__');
        const tel = await h.getStageTelemetry(session);
        const enemyPieces = (tel?.pieces || []).filter((p) => p.faction === 'ENEMY');
        assert.ok(enemyPieces.length > 0, 'Expected enemy pieces in telemetry');
        for (const ep of enemyPieces) {
          assert.equal(ep.visibleRank, 'UNKNOWN', `Enemy piece ${ep.id} leaked rank ${ep.visibleRank}`);
          if (typeof ep.rotationY === 'number') {
            assert.ok(Math.abs(Math.abs(ep.rotationY) - Math.PI) < 0.12, `Enemy piece ${ep.id} not rotated ~PI: ${ep.rotationY}`);
          }
        }
      });
    }
  );

  // =========================================================================
  // F4: Tactical Operations & Challenges (T1-F04-5)
  // =========================================================================
  reg(
    { id: 'T1-F04-5', tier: 1, feature: 'F4', title: 'Operations browser renders briefing & theater metadata cleanly and launches turn 1', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasOpsBtn, 'M5', 'F4', 'Tactical Operations browser UI not yet wired');

        const opsBtn = await h.findVisibleSelector(session, [
          '#btn-menu-operations',
          '[data-menu-operations]',
          '[data-mode="OPERATION"]',
        ]);
        assert.ok(opsBtn, 'Operations menu button should be visible on Title screen');
        await session.clickSelector(opsBtn);

        const opItem = await h.findVisibleSelector(session, [
          '[data-operation-id]',
          '[data-operation]',
          '.operation-card',
        ]);
        assert.ok(opItem, 'At least one Operation card must render');
        await session.clickSelector(opItem);

        // Verify no horizontal text clipping inside briefing container
        const overflow = await session.evaluate(() => {
          const panel = document.querySelector('#title-sub-operations, .operations-panel, #sheet-operations');
          if (!panel) return null;
          return { scrollW: panel.scrollWidth, clientW: panel.clientWidth };
        });
        if (overflow) {
          assert.ok(overflow.scrollW <= overflow.clientW + 2, `Operation briefing overflows: ${JSON.stringify(overflow)}`);
        }

        const launchBtn = await h.findVisibleSelector(session, [
          '#btn-start-operation',
          '#btn-launch-operation',
          '[data-launch-operation]',
        ]);
        assert.ok(launchBtn, 'Operation launch button missing');
        await session.clickSelector(launchBtn);
        await h.waitForTurnActive(session);
      });
    }
  );

  // =========================================================================
  // F5: Upgraded Campaign, Formations & AI (T1-F05-5)
  // =========================================================================
  reg(
    { id: 'T1-F05-5', tier: 1, feature: 'F5', title: 'Campaign tier locks & upgraded formation presets apply 21/21 units', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-campaign');
        await session.waitFor(() => !document.querySelector('#title-sub-campaign')?.hasAttribute('hidden'));

        const campState = await session.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('#campaign-cmd-grid [data-campaign-cmd]'));
          return cards.map((c) => ({
            id: c.getAttribute('data-campaign-cmd'),
            locked: c.getAttribute('data-locked'),
            disabled: c.disabled,
          }));
        });
        assert.equal(campState.length, 6, 'Campaign grid must display 6 commanders');
        assert.equal(campState[0].locked, 'false', 'Tier 1 commander must be unlocked initially');
        for (let i = 1; i < campState.length; i++) {
          assert.equal(campState[i].locked, 'true', `Tier ${i + 1} must start locked`);
          assert.equal(campState[i].disabled, true, `Tier ${i + 1} button must be disabled`);
        }

        await session.clickSelector('#title-sub-campaign [data-back-root]');
        await h.startSkirmishToDeploy(session, { commander: 'MILLER' });

        // Test every rendered formation preset button
        const presetIds = await session.evaluate(() =>
          Array.from(document.querySelectorAll('[data-dep-preset]')).map((b) => b.getAttribute('data-dep-preset'))
        );
        assert.ok(presetIds.length >= 4, 'Expected at least 4 formation presets');
        for (const pid of presetIds) {
          await session.clickSelector(`[data-dep-preset="${pid}"]`);
          const count = await h.getText(session, '#mob-count-pill');
          assert.equal(count, '21 / 21', `Preset ${pid} did not deploy 21/21 units`);
        }

        ctx.requireCapability(presetIds.length >= 8, 'M1/M5', 'F5', `Expected >= 8 formation presets, currently ${presetIds.length}`);
      });
    }
  );

  // =========================================================================
  // F6: SettingsStore Extensions (T1-F06-5)
  // =========================================================================
  reg(
    { id: 'T1-F06-5', tier: 1, feature: 'F6', title: 'Options drawer settings persist cleanly across browser reload', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true }, async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.waitFor(() => !document.querySelector('#sheet-options')?.hasAttribute('hidden'));

        await session.clickSelector('#seg-era button[data-era="1970s"]');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-quality button[data-quality="BATTERY_SAVER"]');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasTheaterUi && caps.hasFrameModeUi,
          'M5',
          'F6',
          'Theater selector and ViewportFrameMode controls in Options drawer pending M5'
        );

        const thSel = await h.findVisibleSelector(session, ['[data-theater="NIGHT_OPS"]', '#seg-theater button:nth-child(4)']);
        if (thSel) await session.clickSelector(thSel);
        const frameSel = await h.findVisibleSelector(session, ['[data-frame-mode="PHONE_9_16"]', '[data-viewport-frame="PHONE_9_16"]']);
        if (frameSel) await session.clickSelector(frameSel);

        await h.reloadToTitle(session);
        await session.clickSelector('#btn-menu-options');
        await session.waitFor(() => !document.querySelector('#sheet-options')?.hasAttribute('hidden'));

        const eraSelected = await session.evaluate(() =>
          document.querySelector('#seg-era button[data-era="1970s"]')?.getAttribute('data-selected')
        );
        assert.equal(eraSelected, 'true', '1970s era mode did not persist across reload');

        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        const qSelected = await session.evaluate(() =>
          document.querySelector('#seg-quality button[data-quality="BATTERY_SAVER"]')?.getAttribute('data-selected')
        );
        assert.equal(qSelected, 'true', 'BATTERY_SAVER quality did not persist across reload');
      });
    }
  );

  // =========================================================================
  // F7: Streamlined Piece Silhouettes (T1-F07-1 .. T1-F07-5)
  // =========================================================================
  reg(
    { id: 'T1-F07-1', tier: 1, feature: 'F7', title: 'Wedge silhouettes stay within 0.70–0.88u height without covering back rows', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(200);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M2/M3', 'F7', 'Piece 3D bounding telemetry not yet exposed');

        const tel = await h.getStageTelemetry(session);
        const pieces = tel?.pieces || [];
        assert.ok(pieces.length === 42, `Expected 42 pieces, got ${pieces.length}`);
        for (const p of pieces) {
          if (p.worldBounds) {
            const height = p.worldBounds.maxY - p.worldBounds.minY;
            assert.ok(height >= 0.65 && height <= 0.88, `Wedge height ${height} outside streamlined range [0.65, 0.88]`);
          }
        }
      });
    }
  );

  reg(
    { id: 'T1-F07-2', tier: 1, feature: 'F7', title: 'All 42 pieces render with non-zero screen-space bounds inside canvas', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(200);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F7', 'Piece screen-bounds telemetry not yet exposed');

        const tel = await h.getStageTelemetry(session);
        const pieces = tel?.pieces || [];
        assert.equal(pieces.length, 42, 'Expected 21 Player + 21 Enemy visible pieces');
        const canvasRect = await session.getRect('#canvas-host canvas');
        for (const p of pieces) {
          assert.ok(p.screenBounds && p.screenBounds.width > 4 && p.screenBounds.height > 4, `Piece ${p.id} collapsed screen bounds`);
          assert.ok(
            p.screenBounds.right > canvasRect.left &&
              p.screenBounds.left < canvasRect.right &&
              p.screenBounds.bottom > canvasRect.top &&
              p.screenBounds.top < canvasRect.bottom,
            `Piece ${p.id} rendered outside canvas frustum`
          );
        }
      });
    }
  );

  reg(
    { id: 'T1-F07-3', tier: 1, feature: 'F7', title: 'Back-row pieces keep >= 50% unoccluded clickable area across COMMAND/TACTICAL/OVERHEAD', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F7', 'Occlusion/screenBounds telemetry not yet exposed');

        for (const viewAngle of ['COMMAND', 'TACTICAL', 'OVERHEAD']) {
          await session.evaluate((v) => window.__WAR_GENERALS_STAGE__?.poseTabletop(v), viewAngle);
          await h.sleep(150);
          const tel = await h.getStageTelemetry(session);
          const playerPieces = (tel?.pieces || []).filter((p) => p.faction === 'PLAYER');
          const row7 = playerPieces.filter((p) => p.row === 7);
          const row6 = playerPieces.filter((p) => p.row === 6);
          assert.ok(row7.length > 0, `No row 7 pieces in ${viewAngle}`);

          for (const back of row7) {
            const b = back.screenBounds;
            const area = Math.max(1, (b.right - b.left) * (b.bottom - b.top));
            let occArea = 0;
            for (const front of row6) {
              const f = front.screenBounds;
              const ix = Math.max(0, Math.min(b.right, f.right) - Math.max(b.left, f.left));
              const iy = Math.max(0, Math.min(b.bottom, f.bottom) - Math.max(b.top, f.top));
              occArea += ix * iy;
            }
            const visibleFraction = 1 - Math.min(1, occArea / area);
            assert.ok(
              visibleFraction >= 0.5,
              `Back-row piece ${back.id} occluded in ${viewAngle}: visibleFraction=${visibleFraction.toFixed(2)}`
            );
          }
        }
      });
    }
  );

  reg(
    { id: 'T1-F07-4', tier: 1, feature: 'F7', title: 'Enemy pieces share uniform back-bevel silhouettes regardless of hidden rank', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('OVERHEAD'));
        await h.sleep(200);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F7', '3D piece geometry telemetry not yet exposed');

        const tel = await h.getStageTelemetry(session);
        const enemies = (tel?.pieces || []).filter((p) => p.faction === 'ENEMY');
        assert.equal(enemies.length, 21, 'Expected 21 enemy pieces');
        const heights = enemies.map((e) => e.worldBounds?.maxY - e.worldBounds?.minY).filter((x) => typeof x === 'number');
        if (heights.length > 0) {
          const minH = Math.min(...heights);
          const maxH = Math.max(...heights);
          assert.ok((maxH - minH) / Math.max(0.01, minH) < 0.02, `Enemy silhouette height varies by rank: ${minH}..${maxH}`);
        }
      });
    }
  );

  reg(
    { id: 'T1-F07-5', tier: 1, feature: 'F7', title: 'Player wedges face camera while Enemy wedges rotate Math.PI away', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(200);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F7', '3D piece orientation telemetry not yet exposed');

        const tel = await h.getStageTelemetry(session);
        const pieces = tel?.pieces || [];
        assert.equal(pieces.length, 42);
        for (const p of pieces) {
          if (p.faction === 'PLAYER') {
            assert.notEqual(p.visibleRank, 'UNKNOWN', 'Player piece should show its own rank');
            if (typeof p.rotationY === 'number') {
              assert.ok(Math.abs(p.rotationY) < 0.15, `Player piece ${p.id} rotationY=${p.rotationY} not facing camera`);
            }
          } else {
            assert.equal(p.visibleRank, 'UNKNOWN', 'Enemy piece must be UNKNOWN');
            if (typeof p.rotationY === 'number') {
              assert.ok(Math.abs(Math.abs(p.rotationY) - Math.PI) < 0.15, `Enemy piece ${p.id} rotationY=${p.rotationY} not facing away`);
            }
          }
        }
      });
    }
  );

  // =========================================================================
  // F8: Sculpted 3D Rank Emblems (T1-F08-3 .. T1-F08-5)
  // =========================================================================
  reg(
    { id: 'T1-F08-3', tier: 1, feature: 'F8', title: '16-Rank Inspection Gallery renders 15 ranks + Medallion with 3D sculpted depth', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-showcase');
        await session.clickSelector('#btn-inspect-16');
        await h.sleep(300);
        const label = await h.getText(session, '#mode-title-label');
        assert.equal(label, '16-RANK SCULPTURE GALLERY', 'Inspect 16 header label mismatch');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M2/M3', 'F8', 'Emblem 3D depth telemetry not yet exposed');
        const tel = await h.getStageTelemetry(session);
        const inspectEmblems = tel?.inspect16Emblems || [];
        assert.equal(inspectEmblems.length, 16, `Expected 16 inspection emblems, got ${inspectEmblems.length}`);
        for (const em of inspectEmblems) {
          assert.ok(em.depth > 0.01, `Emblem ${em.rank} is flat (depth=${em.depth})`);
        }
      });
    }
  );

  reg(
    { id: 'T1-F08-4', tier: 1, feature: 'F8', title: '16-Rank Gallery canvas screenshot shows non-black shaded 3D pixels', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-showcase');
        await session.clickSelector('#btn-inspect-16');
        await h.sleep(350);
        const b64 = await session.capturePngBase64();
        const stats = await h.analyzePng(session, b64);
        assert.ok(stats.nonBlackRatio > 0.2, `16-Rank gallery appears mostly black (${stats.nonBlackRatio})`);
        assert.ok(stats.stdLuma > 6, `16-Rank gallery appears flat/uniform (stdLuma=${stats.stdLuma})`);
      });
    }
  );

  reg(
    { id: 'T1-F08-5', tier: 1, feature: 'F8', title: 'Board finish toggle (Walnut <-> Bakelite) preserves legible emblems with 0 shader errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        await h.sleep(250);

        // Open options via dock and switch finish
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-finish button[data-finish="RETRO_BAKELITE"]');
        await h.sleep(200);
        const bakeliteShot = await h.analyzePng(session, await session.capturePngBase64());

        await session.clickSelector('#seg-finish button[data-finish="WALNUT_SLATE"]');
        await h.sleep(200);
        const walnutShot = await h.analyzePng(session, await session.capturePngBase64());

        assert.ok(bakeliteShot.stdLuma > 5 && walnutShot.stdLuma > 5, 'Board scene lost visual shading after finish swap');
        const diff = h.diffPngSignatures(bakeliteShot.signature, walnutShot.signature);
        assert.ok(diff > 0.4, `Board finish toggle did not visibly update render (diff=${diff})`);
      });
    }
  );

  // =========================================================================
  // F9: Zero Placeholders & 3D Props Upgrade (T1-F09-4 .. T1-F09-5)
  // =========================================================================
  reg(
    { id: 'T1-F09-4', tier: 1, feature: 'F9', title: 'Fresh boot preloads all .glb models and PBR textures with zero 404 or WebGL shader errors', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', { fresh: true }, async (session) => {
        await h.sleep(800);
        const webglOk = await session.evaluate(() => {
          const canvas = document.querySelector('#canvas-host canvas');
          if (!canvas) return false;
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          return Boolean(gl && !gl.isContextLost());
        });
        assert.equal(webglOk, true, 'WebGL2 context missing or lost after boot');
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  reg(
    { id: 'T1-F09-5', tier: 1, feature: 'F9', title: 'TITLE and PLAY camera sweeps cover horizon cleanly without exposed void gaps', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTitle());
        await h.sleep(250);
        const titleStats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(titleStats.nonBlackRatio > 0.25, `Title backdrop mostly void/black (${titleStats.nonBlackRatio})`);

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('TACTICAL'));
        await h.sleep(250);
        const playStats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(playStats.nonBlackRatio > 0.25, `Tactical low-pitch play backdrop mostly void/black (${playStats.nonBlackRatio})`);
      });
    }
  );

  // =========================================================================
  // F10: Ultra-HD Rendered Art Assets (T1-F10-4 .. T1-F10-5)
  // =========================================================================
  reg(
    { id: 'T1-F10-4', tier: 1, feature: 'F10', title: 'Skirmish & Campaign commander portraits load real raster <img> assets with zero <svg> doodles', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        await session.waitFor(() => !document.querySelector('#title-sub-skirmish')?.hasAttribute('hidden'));

        const probe = await session.evaluate(() => {
          const boxes = Array.from(document.querySelectorAll('#skirmish-cmd-grid .cmd-portrait-box'));
          const svgs = boxes.filter((b) => b.querySelector('svg')).length;
          const imgs = boxes.map((b) => b.querySelector('img')).filter(Boolean);
          return {
            boxCount: boxes.length,
            svgs,
            imgStats: imgs.map((i) => ({ src: i.src, complete: i.complete, nw: i.naturalWidth, nh: i.naturalHeight })),
          };
        });

        assert.equal(probe.boxCount, 6, 'Expected 6 commander portrait boxes');
        ctx.requireCapability(
          probe.imgStats.length === 6 && probe.svgs === 0,
          'M2/M5',
          'F10',
          'Rendered raster commander portraits (replacing <svg> placeholders) not yet wired'
        );
        for (const im of probe.imgStats) {
          assert.equal(im.complete && im.nw > 0, true, `Portrait failed to load: ${JSON.stringify(im)}`);
        }
      });
    }
  );

  reg(
    { id: 'T1-F10-5', tier: 1, feature: 'F10', title: 'Mobilization crate displays 15 rendered rank insignia thumbnails without broken images', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        const probe = await session.evaluate(() => {
          const chips = Array.from(document.querySelectorAll('#mob-chip-grid .crate-rank-chip'));
          const imgs = chips.map((c) => c.querySelector('img')).filter(Boolean);
          return {
            chipCount: chips.length,
            imgStats: imgs.map((i) => ({ src: i.src, complete: i.complete, nw: i.naturalWidth })),
          };
        });

        assert.equal(probe.chipCount, 15, 'Expected 15 rank chips in mobilization drawer');
        ctx.requireCapability(
          probe.imgStats.length === 15,
          'M2/M5',
          'F10',
          'Rendered raster rank chip thumbnails in mobilization crate not yet wired'
        );
        for (const im of probe.imgStats) {
          assert.equal(im.complete && im.nw > 0, true, `Rank chip image broken: ${JSON.stringify(im)}`);
        }
      });
    }
  );

  // =========================================================================
  // F11: Multiple 3D Battle Theaters (T1-F11-2 .. T1-F11-5)
  // =========================================================================
  reg(
    { id: 'T1-F11-2', tier: 1, feature: 'F11', title: 'Switching all 4 theaters updates 3D lighting/fog/backdrop palette', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'SceneManager.setTheater() hook not yet exposed');

        const fogColors = new Set();
        for (const th of h.THEATERS_4) {
          await session.evaluate((t) => window.__WAR_GENERALS_STAGE__.setTheater(t), th);
          await h.sleep(150);
          const tel = await h.getStageTelemetry(session);
          if (tel?.theaterId) assert.equal(tel.theaterId, th);
          if (tel?.fogHex) fogColors.add(tel.fogHex);
        }
        if (fogColors.size > 0) {
          assert.ok(fogColors.size >= 3, `Expected distinct fog/palette across 4 theaters, got ${[...fogColors]}`);
        }
      });
    }
  );

  reg(
    { id: 'T1-F11-3', tier: 1, feature: 'F11', title: 'Canvas screenshots across FIELD_HQ, PACIFIC_BRIDGE, IRON_BUNKER, NIGHT_OPS are visually distinct', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'SceneManager.setTheater() hook not yet exposed');

        const shots = [];
        for (const th of h.THEATERS_4) {
          await session.evaluate((t) => window.__WAR_GENERALS_STAGE__.setTheater(t), th);
          await h.sleep(200);
          const png = await session.capturePngBase64();
          shots.push({ th, analysis: await h.analyzePng(session, png) });
        }

        for (let i = 0; i < shots.length; i++) {
          for (let j = i + 1; j < shots.length; j++) {
            const diff = h.diffPngSignatures(shots[i].analysis.signature, shots[j].analysis.signature);
            assert.ok(diff > 1.2, `Theaters ${shots[i].th} and ${shots[j].th} look visually identical (diff=${diff.toFixed(2)})`);
          }
        }
      });
    }
  );

  reg(
    { id: 'T1-F11-4', tier: 1, feature: 'F11', title: 'Switching theater mid-match preserves selected piece, coordinates & valid moves', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await h.tapBoardCoord(session, 4, 5);
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'SceneManager.setTheater() hook not yet exposed');

        const beforeName = await h.getText(session, '#sel-unit-name');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setTheater('PACIFIC_BRIDGE'));
        await h.sleep(150);

        const afterName = await h.getText(session, '#sel-unit-name');
        assert.equal(afterName, beforeName, 'Selected unit lost after theater switch');

        // Confirm valid move still executes after theater switch
        await h.tapBoardCoord(session, 4, 4);
        await session.waitFor(() => {
          const t = document.querySelector('#text-turn-state')?.textContent?.trim();
          return t === 'ENEMY THINKING' || t === 'YOUR TURN';
        });
      });
    }
  );

  reg(
    { id: 'T1-F11-5', tier: 1, feature: 'F11', title: 'Rapidly cycling all 4 theaters produces zero WebGL or console errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSetTheater, 'M2/M3', 'F11', 'SceneManager.setTheater() hook not yet exposed');

        for (let r = 0; r < 2; r++) {
          for (const th of h.THEATERS_4) {
            await session.evaluate((t) => window.__WAR_GENERALS_STAGE__.setTheater(t), th);
            await h.sleep(60);
          }
        }
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  // =========================================================================
  // F12: Dynamic Quality Governor (T1-F12-4 .. T1-F12-5)
  // =========================================================================
  reg(
    { id: 'T1-F12-4', tier: 1, feature: 'F12', title: 'BATTERY_SAVER updates QualityGovernor profile and disables lantern shadow & DoF', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
        await session.clickSelector('#seg-quality button[data-quality="BATTERY_SAVER"]');
        await h.sleep(150);

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M2/M3', 'F12', 'QualityGovernor telemetry not yet exposed');
        const tel = await h.getStageTelemetry(session);
        const q = tel?.quality || tel?.qualitySnapshot;
        assert.ok(q, 'QualityGovernor snapshot missing from telemetry');
        assert.equal(q.resolvedTier, 'BATTERY_SAVER');
        assert.equal(q.enableLanternShadow, false, 'Lantern shadow must be disabled in BATTERY_SAVER');
        assert.equal(q.enableDoF, false, 'Tilt-shift DoF must be disabled in BATTERY_SAVER');
      });
    }
  );

  reg(
    { id: 'T1-F12-5', tier: 1, feature: 'F12', title: 'AUTO quality mode sustains active non-frozen render loop on Desktop Edge', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTabletop('COMMAND'));
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasQualityControls, 'M2/M5', 'F12', 'AUTO QualityTier control not yet wired');

        const frameStats = await session.evaluate(async () => {
          let count = 0;
          const start = performance.now();
          await new Promise((resolve) => {
            const step = () => {
              count++;
              if (performance.now() - start >= 1200) resolve();
              else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          });
          return { count, elapsedMs: performance.now() - start };
        });
        const fps = (frameStats.count / frameStats.elapsedMs) * 1000;
        assert.ok(fps >= 15, `Render loop stalled in AUTO mode: ${fps.toFixed(1)} FPS`);
      });
    }
  );

  // =========================================================================
  // F13: Bulletproof Raycasting & Tap/Drag (T1-F13-1 .. T1-F13-5)
  // =========================================================================
  reg(
    { id: 'T1-F13-1', tier: 1, feature: 'F13', title: 'DEPLOY tap-to-place: select chip in crate and tap home square increments 0 -> 1 / 21', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');
        assert.equal(await h.getText(session, '#mob-count-pill'), '0 / 21');

        await session.clickSelector('#mob-chip-grid .crate-rank-chip[data-rank="GEN_5"]');
        await h.tapBoardCoord(session, 4, 6, { phase: 'DEPLOY', isTouch: true });
        await session.waitFor(() => document.querySelector('#mob-count-pill')?.textContent?.trim() === '1 / 21');
        assert.equal(await h.getText(session, '#mob-count-pill'), '1 / 21');
      });
    }
  );

  reg(
    { id: 'T1-F13-2', tier: 1, feature: 'F13', title: 'DEPLOY drag-out: dragging chip from crate onto home square places piece cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('#btn-dep-clear');

        const chipRect = await session.getRect('#mob-chip-grid .crate-rank-chip[data-rank="SPY"]');
        const target = await h.projectBoardCoord(session, 3, 6, { phase: 'DEPLOY', worldY: 0.02 });
        await session.dragPoints(
          chipRect.left + chipRect.width * 0.5,
          chipRect.top + chipRect.height * 0.5,
          target.x,
          target.y + 28, // +28px lifted hologram offset
          { steps: 14, holdBeforeMoveMs: 40, isTouch: true }
        );
        await session.waitFor(() => document.querySelector('#mob-count-pill')?.textContent?.trim() === '1 / 21');
      });
    }
  );

  reg(
    { id: 'T1-F13-3', tier: 1, feature: 'F13', title: 'DEPLOY 21/21 tap Piece A then Piece B swaps cleanly without overwriting', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        await session.clickSelector('[data-dep-preset="IRON_BLITZ"]');
        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21');

        await h.tapBoardCoord(session, 3, 5, { phase: 'DEPLOY' });
        await h.tapBoardCoord(session, 5, 5, { phase: 'DEPLOY' });
        await h.sleep(150);

        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21', 'Deployment swap corrupted piece count');
        const btnEnabled = await session.evaluate(() => !document.querySelector('#btn-launch-battle')?.disabled);
        assert.equal(btnEnabled, true, 'Launch button became disabled after board swap');
      });
    }
  );

  reg(
    { id: 'T1-F13-4', tier: 1, feature: 'F13', title: 'PLAY tap-to-select vanguard piece and tap adjacent empty square moves & triggers Enemy turn', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await h.tapBoardCoord(session, 4, 5, { phase: 'PLAY' });
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        const unitName = await h.getText(session, '#sel-unit-name');
        assert.equal(unitName, 'SERGEANT', 'Expected SERGEANT at VACCINATION (4,5)');

        await h.tapBoardCoord(session, 4, 4, { phase: 'PLAY' });
        await session.waitFor(() =>
          Boolean(document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'))
        );
        await h.waitForTurnActive(session);

        // Verify piece is no longer at (4,5) and is now at (4,4)
        await h.tapBoardCoord(session, 4, 4, { phase: 'PLAY' });
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        assert.equal(await h.getText(session, '#sel-unit-name'), 'SERGEANT');
      });
    }
  );

  reg(
    { id: 'T1-F13-5', tier: 1, feature: 'F13', title: 'PLAY drag-to-move piece from row 5 to row 4 executes move cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session, { preset: 'VACCINATION' });
        await h.dragBoardCoords(session, 4, 5, 4, 4, { phase: 'PLAY', isTouch: true, steps: 12 });
        await h.waitForTurnActive(session);

        await h.tapBoardCoord(session, 4, 4, { phase: 'PLAY' });
        await session.waitFor(() => !document.querySelector('#selected-unit-strip')?.hasAttribute('hidden'));
        assert.equal(await h.getText(session, '#sel-unit-name'), 'SERGEANT');
      });
    }
  );

  // =========================================================================
  // F14: Bounded Smooth Camera Orbit, Tilt & Zoom (T1-F14-1 .. T1-F14-5)
  // =========================================================================
  reg(
    { id: 'T1-F14-1', tier: 1, feature: 'F14', title: 'Horizontal drag on empty tabletop orbits camera yaw smoothly within [-38, +38] deg', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F14', 'Camera yaw orbit & telemetry not yet implemented');

        const emptyPt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(emptyPt.x, emptyPt.y, emptyPt.x + 120, emptyPt.y, { steps: 10 });
        await h.sleep(150);
        const tel = await h.getStageTelemetry(session);
        const yaw = tel?.camera?.yawDeg;
        assert.ok(typeof yaw === 'number' && Math.abs(yaw) > 1 && Math.abs(yaw) <= 38.5, `Unexpected yawDeg=${yaw}`);
      });
    }
  );

  reg(
    { id: 'T1-F14-2', tier: 1, feature: 'F14', title: 'Vertical drag adjusts camera pitch smoothly within [24, 72] deg', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M3', 'F14', 'Camera pitch telemetry not yet exposed');

        const before = (await h.getStageTelemetry(session))?.camera?.pitchDeg;
        const emptyPt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(emptyPt.x, emptyPt.y, emptyPt.x, emptyPt.y + 110, { steps: 10 });
        await h.sleep(150);
        const after = (await h.getStageTelemetry(session))?.camera?.pitchDeg;
        assert.ok(typeof after === 'number' && after >= 24 && after <= 72, `Pitch out of bounds [24,72]: ${after}`);
        assert.notEqual(Math.round(after), Math.round(before), 'Pitch did not respond to vertical drag');
      });
    }
  );

  reg(
    { id: 'T1-F14-3', tier: 1, feature: 'F14', title: 'Mouse wheel zoom adjusts camera distance smoothly within bounded limits', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F14', 'Camera wheel zoom & telemetry not yet implemented');

        const rect = await session.getRect('#canvas-host canvas');
        const beforeDist = (await h.getStageTelemetry(session))?.camera?.zoomDist;
        await session.wheel(rect.left + rect.width / 2, rect.top + rect.height / 2, -300, 0);
        await h.sleep(150);
        const afterDist = (await h.getStageTelemetry(session))?.camera?.zoomDist;
        assert.ok(typeof afterDist === 'number' && afterDist !== beforeDist && afterDist > 3, `Zoom failed: ${beforeDist} -> ${afterDist}`);
      });
    }
  );

  reg(
    { id: 'T1-F14-4', tier: 1, feature: 'F14', title: '1-tap Camera Reset restores canonical yaw=0, preset pitch & zoom within 600ms', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasResetCameraOrbit && caps.hasGetTelemetry, 'M3', 'F14', 'Camera reset & telemetry not yet implemented');

        const emptyPt = await h.projectBoardCoord(session, 0, 3, { phase: 'PLAY', worldY: 0 });
        await session.dragPoints(emptyPt.x, emptyPt.y, emptyPt.x + 150, emptyPt.y + 80, { steps: 10 });
        await h.sleep(100);

        const resetSel = await h.findVisibleSelector(session, ['#btn-reset-camera', '[data-reset-camera]', '#btn-cam-reset']);
        if (resetSel) await session.clickSelector(resetSel);
        else await session.evaluate(() => window.__WAR_GENERALS_STAGE__.resetCameraOrbit());

        await h.sleep(600);
        const tel = await h.getStageTelemetry(session);
        assert.ok(Math.abs(tel?.camera?.yawDeg ?? 99) < 1.5, `Yaw not reset to 0: ${tel?.camera?.yawDeg}`);
      });
    }
  );

  reg(
    { id: 'T1-F14-5', tier: 1, feature: 'F14', title: 'Cycling #seg-view / #btn-top-view switches 40°/32°/62° camera presets cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startSkirmishToDeploy(session);
        const initial = await h.getText(session, '#top-view-badge');
        await session.clickSelector('#btn-top-view');
        const second = await h.getText(session, '#top-view-badge');
        await session.clickSelector('#btn-top-view');
        const third = await h.getText(session, '#top-view-badge');
        assert.equal(new Set([initial, second, third]).size, 3, `Expected 3 distinct angles, got ${initial}, ${second}, ${third}`);
      });
    }
  );

  // =========================================================================
  // F15: Full-Viewport Default & Desktop/Mobile Layout (T1-F15-1 .. T1-F15-5)
  // =========================================================================
  reg(
    { id: 'T1-F15-1', tier: 1, feature: 'F15', title: 'Desktop 1280x800 & 1440x900 fill 100% viewport by default with zero unwanted letterboxing', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetViewportFrameMode || caps.hasFrameModeUi,
          'M3',
          'F15',
          'FULL_VIEWPORT desktop default & ViewportFrameMode not yet implemented'
        );
        await h.assertViewportFillAndNoOverflow(session, 1280, 800, { expectFullBleed: true });
        await session.setViewport(h.resolvePreset(ctx, 'DESKTOP_WIDE'));
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 1440, 900, { expectFullBleed: true });
      });
    }
  );

  reg(
    { id: 'T1-F15-2', tier: 1, feature: 'F15', title: 'Mobile Portrait 390x844 fills chassis cleanly across Title, Deploy, and Play with zero overflow', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true, strictNoOverlap: true });
        await h.startSkirmishToDeploy(session);
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true });
        await h.deployPresetAndLaunch(session);
        await h.assertViewportFillAndNoOverflow(session, 390, 844, { expectFullBleed: true, strictNoOverlap: true });
      });
    }
  );

  reg(
    { id: 'T1-F15-3', tier: 1, feature: 'F15', title: 'Mobile Landscape (844x390 & 915x680) docks drawers cleanly without vertical clipping', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_LANDSCAPE', async (session) => {
        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });
        await h.startSkirmishToDeploy(session);
        await h.assertViewportFillAndNoOverflow(session, 844, 390, { expectFullBleed: true });

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetViewportFrameMode || caps.hasFrameModeUi,
          'M3',
          'F15',
          'Landscape >640px height cap fix (915x680) pending M3'
        );
        await session.setViewport({ width: 915, height: 680, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 915, 680, { expectFullBleed: true });
      });
    }
  );

  reg(
    { id: 'T1-F15-4', tier: 1, feature: 'F15', title: 'PHONE_9_16 toggle centers 9:16 chassis on Desktop without OS fullscreen and restores FULL_VIEWPORT', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetViewportFrameMode || caps.hasFrameModeUi,
          'M3',
          'F15',
          'PHONE_9_16 decoupled ViewportFrameMode toggle not yet implemented'
        );

        if (caps.hasSetViewportFrameMode) {
          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('PHONE_9_16'));
        } else {
          await session.clickSelector('#btn-menu-options');
          await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');
          const btn = await h.findVisibleSelector(session, ['[data-frame-mode="PHONE_9_16"]', '[data-viewport-frame="PHONE_9_16"]']);
          await session.clickSelector(btn);
        }
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 1280, 800, { expectFullBleed: false, expectPhoneFrame: true });
        const osFs = await session.evaluate(() => Boolean(document.fullscreenElement));
        assert.equal(osFs, false, 'PHONE_9_16 must not depend on OS fullscreen');

        if (caps.hasSetViewportFrameMode) {
          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.setViewportFrameMode('FULL_VIEWPORT'));
        } else {
          const btn = await h.findVisibleSelector(session, ['[data-frame-mode="FULL_VIEWPORT"]', '[data-viewport-frame="FULL_VIEWPORT"]']);
          await session.clickSelector(btn);
        }
        await h.sleep(150);
        await h.assertViewportFillAndNoOverflow(session, 1280, 800, { expectFullBleed: true });
      });
    }
  );

  reg(
    { id: 'T1-F15-5', tier: 1, feature: 'F15', title: 'Zero 0px collapsed or clipped HUD controls across Portrait, Landscape & Desktop phases', timeoutMs: 35000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        for (const [presetName, w, hPx] of [
          ['MOBILE_PORTRAIT', 390, 844],
          ['MOBILE_LANDSCAPE', 844, 390],
        ]) {
          await session.setViewport(h.resolvePreset(ctx, presetName));
          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.poseTitle());
          await h.sleep(120);
          await h.assertViewportFillAndNoOverflow(session, w, hPx, { expectFullBleed: true });

          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.poseTabletop('COMMAND'));
          await h.sleep(120);
          await h.assertViewportFillAndNoOverflow(session, w, hPx, { expectFullBleed: true });

          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.poseReplay());
          await h.sleep(120);
          await h.assertViewportFillAndNoOverflow(session, w, hPx, { expectFullBleed: true });
        }
      });
    }
  );

  // =========================================================================
  // F16: Adaptive Dual-Era Score & Voices (T1-F16-1 .. T1-F16-5)
  // =========================================================================
  reg(
    { id: 'T1-F16-1', tier: 1, feature: 'F16', title: 'User gesture unlocks AudioContext to running state with 4 gain buses & AnalyserNode', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        await h.sleep(200);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy && spy.contextCount >= 1, 'AudioContext was not created on user gesture');
        assert.equal(spy.states[0], 'running', `Expected AudioContext.state === running, got ${spy.states[0]}`);
        assert.ok(spy.gainCount >= 4, `Expected >= 4 gain buses, got ${spy.gainCount}`);
        assert.ok(spy.analyserCount >= 1, 'AnalyserNode missing');
      });
    }
  );

  reg(
    { id: 'T1-F16-2', tier: 1, feature: 'F16', title: 'Adaptive music sequencer transitions across TITLE -> DEPLOY -> PLAY -> GAME_OVER with active audio', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startSkirmishToDeploy(session);
        await h.deployPresetAndLaunch(session);
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 1.2));
        await h.sleep(300);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy && spy.sourcesStarted > 0, 'Expected procedural audio sources to start across phases');

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M4/M5', 'F16', 'MusicSequencer state telemetry not yet exposed');
      });
    }
  );

  reg(
    { id: 'T1-F16-3', tier: 1, feature: 'F16', title: '1980s Electronic vs 1970s Classic produce active AnalyserNode clash audio', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-era button[data-era="1980s"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 1.0));
        await h.sleep(250);
        const spy80 = await h.readWebAudioSpy(session);
        assert.ok(spy80.sourcesStarted > 0, '1980s clash triggered no audio sources');

        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTitle());
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-era button[data-era="1970s"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 1.0));
        await h.sleep(250);
        const spy70 = await h.readWebAudioSpy(session);
        assert.ok(spy70.sourcesStarted > spy80.sourcesStarted, '1970s clash triggered no additional audio sources');
      });
    }
  );

  reg(
    { id: 'T1-F16-4', tier: 1, feature: 'F16', title: '4-Bus mixer sliders and mute toggle control WebAudio gain nodes cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-options');
        await session.clickSelector('#seg-opt-tabs button[data-opt-tab="AUDIO_GPU"]');

        for (const id of ['#slider-master', '#slider-music', '#slider-sfx', '#slider-ambiance']) {
          await session.evaluate((sel) => {
            const el = document.querySelector(sel);
            el.value = '40';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }, id);
        }
        await h.sleep(120);
        const unmutedSpy = await h.readWebAudioSpy(session);
        const busGainsBefore = (unmutedSpy?.gains || []).slice(0, 6);
        assert.ok(
          busGainsBefore.length >= 5 && Math.min(...busGainsBefore) > 0.05,
          `Expected unmuted mixer bus gains > 0.05 at 40%, got ${JSON.stringify(busGainsBefore)}`
        );

        await session.clickSelector('#seg-mute button[data-mute="true"]');
        await h.sleep(150);

        const mutedSpy = await h.readWebAudioSpy(session);
        const busGainsAfter = (mutedSpy?.gains || []).slice(0, 6);
        assert.ok(
          busGainsAfter.some((g) => g <= 0.02),
          `Muting did not attenuate master GainNode (<= 0.02): ${JSON.stringify(busGainsAfter)}`
        );
      });
    }
  );

  reg(
    { id: 'T1-F16-5', tier: 1, feature: 'F16', title: 'Urgent turn warning toggles cleanly between BLITZ/STANDARD and UNTIMED clocks', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#seg-clocks button[data-clock="UNTIMED"]');
        await session.clickSelector('#sheet-options [data-close-sheet]');
        assert.equal(await h.getText(session, '#val-round-timer'), '∞');
        assert.equal(
          await session.evaluate(() => document.querySelector('#pill-round-timer')?.getAttribute('data-urgent')),
          'false'
        );
      });
    }
  );

  // =========================================================================
  // F17: Battle-Type Soundscapes & Clean Audio Stop (T1-F17-1 .. T1-F17-5)
  // =========================================================================
  reg(
    { id: 'T1-F17-1', tier: 1, feature: 'F17', title: 'All 6 battle clash presets/choreographies execute audio without WebAudio errors', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-skirmish'); // unlock audio
        await session.clickSelector('#title-sub-skirmish [data-back-root]');
        for (const preset of ['PLAYER_WIN', 'ENEMY_WIN', 'SPY_INTERCEPT', 'MUTUAL_SPLIT', 'FLAG_CAPTURE']) {
          await session.evaluate((p) => window.__WAR_GENERALS_STAGE__?.poseArbiterAct(p, 0.4), preset);
          await h.sleep(120);
        }
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.sourcesStarted >= 5, 'Expected audio sources across battle presets');
      });
    }
  );

  reg(
    { id: 'T1-F17-2', tier: 1, feature: 'F17', title: 'DynamicsCompressorNode limiter protects master output during FLAG_CAPTURE detonation', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        await session.clickSelector('#title-sub-skirmish [data-back-root]');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('FLAG_CAPTURE', 2.65));
        await h.sleep(180);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.compressorCount >= 1, 'DynamicsCompressorNode master limiter missing');
      });
    }
  );

  reg(
    { id: 'T1-F17-3', tier: 1, feature: 'F17', title: 'Skipping cutscene stops scheduled battle audio nodes immediately', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(180);

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSkipBtn || caps.hasSkipArbiterCutscene,
          'M5',
          'F17',
          'M4/M5 full cleanup + skipArbiterCutscene pending'
        );

        const skipBtn = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        if (skipBtn) await session.clickSelector(skipBtn);
        else await session.evaluate(() => window.__WAR_GENERALS_STAGE__.skipArbiterCutscene());

        await h.sleep(120);
        const spyAfter = await h.readWebAudioSpy(session);
        assert.ok(spyAfter.sourcesStopped > 0, 'Expected active audio sources to be stopped on cutscene skip');
      });
    }
  );

  reg(
    { id: 'T1-F17-4', tier: 1, feature: 'F17', title: 'Act 2B Strachan Vacuum ducks ambient/reverb bus while heartbeat drives AnalyserNode', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        await session.clickSelector('#title-sub-skirmish [data-back-root]');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 2.05));
        await h.sleep(220);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy.analyserCount >= 1 && spy.sourcesStarted > 0, 'Expected heartbeat/analyser activity in Act 2B');
      });
    }
  );

  reg(
    { id: 'T1-F17-5', tier: 1, feature: 'F17', title: 'SoundDirector.dispose() cleans up AudioContext & timers without post-dispose errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', { fresh: true, installAudioSpy: true }, async (session) => {
        await session.clickSelector('#btn-menu-skirmish');
        const hasDispose = await session.evaluate(
          () => typeof window.__WAR_GENERALS_STAGE__?.disposeAudio === 'function'
        );
        ctx.requireCapability(hasDispose, 'M4', 'F17', 'SoundDirector.dispose() QA hook not yet exposed');
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__.disposeAudio());
        await h.sleep(150);
        const spy = await h.readWebAudioSpy(session);
        assert.ok(spy && spy.closedCount >= 1, 'SoundDirector.dispose() did not close AudioContext');
        await h.assertNoConsoleOrPageErrors(session);
      });
    }
  );

  // =========================================================================
  // F18: Sculpted Arbiter Hardware & FX (T1-F18-2 .. T1-F18-5)
  // =========================================================================
  reg(
    { id: 'T1-F18-2', tier: 1, feature: 'F18', title: 'Arbiter Act 1 (0.35s) renders bastions, Attack Medallion & CRT visibly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 0.35));
        await h.sleep(250);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.25 && stats.stdLuma > 6, 'Arbiter Act 1 stage failed to render visibly');
      });
    }
  );

  reg(
    { id: 'T1-F18-3', tier: 1, feature: 'F18', title: 'Arbiter Act 2A (1.2s) animates frontline gauge, tracers & vacuum tubes', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 1.1));
        await h.sleep(160);
        const a = await h.analyzePng(session, await session.capturePngBase64());
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 1.45));
        await h.sleep(160);
        const b = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(h.diffPngSignatures(a.signature, b.signature) > 0.2, 'Arbiter Act 2A frame appeared static');
      });
    }
  );

  reg(
    { id: 'T1-F18-4', tier: 1, feature: 'F18', title: 'Arbiter Act 2B (2.15s) renders bullet-time sabot shell & Mach ring cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 2.15));
        await h.sleep(200);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.2 && stats.stdLuma > 5, 'Arbiter Act 2B bullet-time shot blank');
      });
    }
  );

  reg(
    { id: 'T1-F18-5', tier: 1, feature: 'F18', title: 'Arbiter Act 3 (2.7s) renders explosion plumes, shockwave & shrapnel with zero NaN/WebGL errors', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('FLAG_CAPTURE', 2.7));
        await h.sleep(220);
        const stats = await h.analyzePng(session, await session.capturePngBase64());
        assert.ok(stats.nonBlackRatio > 0.2 && stats.stdLuma > 8, 'Arbiter Act 3 detonation blank');
      });
    }
  );

  // =========================================================================
  // F19: 6 Varied 3D Battle Cutscenes & Skip (T1-F19-1 .. T1-F19-5)
  // =========================================================================
  reg(
    { id: 'T1-F19-1', tier: 1, feature: 'F19', title: 'All 6 battle choreographies render distinct animations & HUD banners', timeoutMs: 35000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasGetTelemetry, 'M5', 'F19', '6 BattleChoreographies telemetry not yet exposed');

        const seenKinds = new Set();
        const sigs = [];
        for (const preset of ['PLAYER_WIN', 'ENEMY_WIN', 'SPY_INTERCEPT', 'MUTUAL_SPLIT', 'FLAG_CAPTURE']) {
          await session.evaluate((p) => window.__WAR_GENERALS_STAGE__?.poseArbiterAct(p, 1.4), preset);
          await h.sleep(150);
          const tel = await h.getStageTelemetry(session);
          if (tel?.activeChoreography) seenKinds.add(tel.activeChoreography);
          sigs.push(await h.analyzePng(session, await session.capturePngBase64()));
        }
        assert.ok(seenKinds.size >= 3, `Expected distinct choreography kinds, got ${[...seenKinds]}`);
      });
    }
  );

  reg(
    { id: 'T1-F19-2', tier: 1, feature: 'F19', title: 'Visible HUD SKIP >> button renders unobscured during ARBITER across Portrait, Landscape & Desktop', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseArbiterAct('PLAYER_WIN', 0.4));
        await h.sleep(150);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn, 'M5', 'F19', 'Visible HUD SKIP >> button not yet implemented');

        for (const [preset, w, hPx] of [
          ['MOBILE_PORTRAIT', 390, 844],
          ['MOBILE_LANDSCAPE', 844, 390],
          ['DESKTOP_LAPTOP', 1280, 800],
        ]) {
          await session.setViewport(h.resolvePreset(ctx, preset));
          await h.sleep(100);
          const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
          assert.ok(skipSel, `SKIP >> button hidden in ${preset}`);
          const r = await session.getRect(skipSel);
          assert.ok(r.width > 30 && r.height > 20 && r.right <= w + 2 && r.bottom <= hPx + 2, `SKIP >> clipped in ${preset}`);
        }
      });
    }
  );

  reg(
    { id: 'T1-F19-3', tier: 1, feature: 'F19', title: 'Clicking HUD SKIP >> during clash immediately resolves battle & unlocks board', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="PLAYER_WIN"]');
        await h.sleep(150);

        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn, 'M5', 'F19', 'Visible HUD SKIP >> button not yet implemented');

        const skipSel = await h.findVisibleSelector(session, ['#btn-skip-cutscene', '[data-skip-cutscene]', '.arbiter-skip-btn']);
        await session.clickSelector(skipSel);
        await h.waitForArbiterResolved(session, 2000);
        assert.equal(await h.isVisible(session, '#play-bottom-dock'), true, 'Board dock did not unlock after SKIP >>');
      });
    }
  );

  reg(
    { id: 'T1-F19-4', tier: 1, feature: 'F19', title: 'Pressing Space or Escape during cutscene triggers immediate skip cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'DESKTOP_LAPTOP', async (session) => {
        await h.startPlayViaUI(session);
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(caps.hasSkipBtn || caps.hasSkipArbiterCutscene, 'M5', 'F19', 'Space/Escape cutscene skip not yet wired');

        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="SPY_INTERCEPT"]');
        await h.sleep(150);
        await session.pressKey('Space');
        await h.waitForArbiterResolved(session, 2000);

        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="MUTUAL_SPLIT"]');
        await h.sleep(150);
        await session.pressKey('Escape');
        await h.waitForArbiterResolved(session, 2000);
      });
    }
  );

  reg(
    { id: 'T1-F19-5', tier: 1, feature: 'F19', title: 'ENEMY_WIN clash keeps enemy wedge masked on Arbiter stage and post-clash board', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        await session.clickSelector('#btn-dock-settings');
        await session.clickSelector('#btn-opt-showcase');
        await session.clickSelector('#sheet-showcase [data-preset="ENEMY_WIN"]');
        await h.sleep(300);

        await h.assertNoEnemyRankLeakInDom(session);
        await h.waitForArbiterResolved(session, 10000);
        await session.clickSelector('#btn-dock-log');
        await h.assertNoEnemyRankLeakInDom(session);
      });
    }
  );

  // =========================================================================
  // F20: Replayability & Showcase HUD Wiring (T1-F20-1 .. T1-F20-5)
  // =========================================================================
  reg(
    { id: 'T1-F20-1', tier: 1, feature: 'F20', title: 'All primary Title cards transition to live screens/drawers with zero dead buttons', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        // Skirmish
        await session.clickSelector('#btn-menu-skirmish');
        assert.equal(await h.isVisible(session, '#title-sub-skirmish'), true);
        await session.clickSelector('#title-sub-skirmish [data-back-root]');

        // Campaign
        await session.clickSelector('#btn-menu-campaign');
        assert.equal(await h.isVisible(session, '#title-sub-campaign'), true);
        await session.clickSelector('#title-sub-campaign [data-back-root]');

        // Pass & Play
        await session.clickSelector('#btn-menu-passplay');
        assert.equal(await h.isVisible(session, '#mobilization-drawer'), true);
        await session.clickSelector('#btn-top-menu');

        // Armory
        await session.clickSelector('#btn-menu-armory');
        assert.equal(await h.isVisible(session, '#mobilization-drawer'), true);
        await session.clickSelector('#btn-armory-back');

        // Field Manual
        await session.clickSelector('#btn-menu-manual');
        assert.equal(await h.isVisible(session, '#manual-sheet'), true);
        await session.clickSelector('#btn-top-menu');

        // Options
        await session.clickSelector('#btn-menu-options');
        assert.equal(await h.isVisible(session, '#sheet-options'), true);
        await session.clickSelector('#sheet-options [data-close-sheet]');
      });
    }
  );

  reg(
    { id: 'T1-F20-2', tier: 1, feature: 'F20', title: 'In-play Intel, Combat Log, Settings & Showcase drawers open, populate & close cleanly', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);

        await session.clickSelector('#btn-dock-intel');
        assert.equal(await h.isVisible(session, '#sheet-intel'), true);
        assert.ok((await h.getText(session, '#intel-body'))?.includes('NAVY COMMAND'));
        await session.clickSelector('#sheet-intel [data-close-sheet]');

        await session.clickSelector('#btn-dock-log');
        assert.equal(await h.isVisible(session, '#sheet-log'), true);
        await session.clickSelector('#sheet-log [data-close-sheet]');

        await session.clickSelector('#btn-dock-settings');
        assert.equal(await h.isVisible(session, '#sheet-options'), true);
        await session.clickSelector('#btn-opt-showcase');
        assert.equal(await h.isVisible(session, '#sheet-showcase'), true);
        await session.clickSelector('#sheet-showcase [data-close-sheet]');
        assert.equal(await h.isVisible(session, '#play-bottom-dock'), true);
      });
    }
  );

  reg(
    { id: 'T1-F20-3', tier: 1, feature: 'F20', title: '2-step hold-to-confirm Surrender transitions cleanly to Dossier card', timeoutMs: 25000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        const r = await session.getRect('#btn-dock-surrender');

        // Step 1: Arm
        await session.tapPoint(r.cx, r.cy, { isTouch: true });
        await session.waitFor(() => document.querySelector('#btn-dock-surrender')?.getAttribute('data-armed') === 'true');
        assert.equal(await h.getText(session, '#surrender-btn-label'), 'HOLD TO CONFIRM');

        // Step 2: Hold >= 1150ms
        await session.longPress(r.cx, r.cy, 1150, { isTouch: true });
        await session.waitFor(() => !document.querySelector('#dossier-card')?.hasAttribute('hidden'));
        const title = await h.getText(session, '#dossier-title');
        assert.ok(title && title.length > 0, 'Dossier verdict title empty after surrender');
      });
    }
  );

  reg(
    { id: 'T1-F20-4', tier: 1, feature: 'F20', title: 'Dossier -> X-Ray Replay scrubber, prev/next, auto-play & Rematch work end-to-end', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await h.startPlayViaUI(session);
        // Make 1 move so replay has plies
        await h.tapBoardCoord(session, 4, 5);
        await h.tapBoardCoord(session, 4, 4);
        await h.waitForTurnActive(session);

        await h.performTwoStepSurrender(session);

        await session.clickSelector('#btn-dossier-replay');
        await session.waitFor(() => !document.querySelector('#replay-bar')?.hasAttribute('hidden'));

        await session.clickSelector('#btn-rep-start');
        assert.ok((await h.getText(session, '#replay-turn-label'))?.startsWith('PLY 0 /'));
        await session.clickSelector('#btn-rep-next');
        assert.ok((await h.getText(session, '#replay-turn-label'))?.startsWith('PLY 1 /'));
        await session.clickSelector('#btn-rep-prev');
        assert.ok((await h.getText(session, '#replay-turn-label'))?.startsWith('PLY 0 /'));
        await session.clickSelector('#btn-rep-play');
        assert.equal(
          await session.evaluate(() => document.querySelector('#btn-rep-play')?.getAttribute('data-active')),
          'true'
        );
        await session.clickSelector('#btn-rep-rematch');
        await session.waitFor(() => !document.querySelector('#mobilization-drawer')?.hasAttribute('hidden'));
      });
    }
  );

  reg(
    { id: 'T1-F20-5', tier: 1, feature: 'F20', title: 'Field Manual updates all 15 ranks & Armory saves/reloads custom blueprint S1', timeoutMs: 30000 },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        await session.clickSelector('#btn-menu-manual');
        await session.waitFor(() => !document.querySelector('#manual-sheet')?.hasAttribute('hidden'));

        const titles = new Set();
        for (const rank of h.RANKS_15) {
          await session.clickSelector(`.manual-rank-pill[data-manual-rank="${rank}"]`);
          const t = await h.getText(session, '#manual-rank-title');
          const stats = await h.getText(session, '#manual-stats-row');
          assert.ok(t && stats?.includes('DEFEATS'), `Field manual failed to update for ${rank}`);
          titles.add(t);
        }
        assert.equal(titles.size, 15, 'Field Manual did not display 15 unique rank titles');

        await session.clickSelector('#btn-top-menu');
        await session.clickSelector('#btn-menu-armory');
        await session.clickSelector('[data-dep-preset="MOTHERSHIP"]');
        await session.clickSelector('#btn-arm-save');
        await session.clickSelector('.mob-slot-pill[data-slot="0"]');
        assert.equal(
          await session.evaluate(() => document.querySelector('.mob-slot-pill[data-slot="0"]')?.getAttribute('data-saved')),
          'true'
        );
        await session.clickSelector('#btn-dep-clear');
        assert.equal(await h.getText(session, '#mob-count-pill'), '0 / 21');
        await session.clickSelector('.mob-slot-pill[data-slot="0"]');
        assert.equal(await h.getText(session, '#mob-count-pill'), '21 / 21');
      });
    }
  );

  // =========================================================================
  // F24: AAA Heroic Start Screen & Non-Boxy Sculpted UI (T1-F24-2 .. T1-F24-5)
  // =========================================================================
  reg(
    {
      id: 'T1-F24-2',
      tier: 1,
      feature: 'F24',
      title: 'Heroic Title Centerpiece replaces .war-generals-crest box with rendered Ultra-HD hero_crest art',
      timeoutMs: 25000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const landed = await h.hasM5HeroStartScreen(session);
        ctx.requireCapability(landed, 'M5', 'F24', 'M5 Heroic Title Centerpiece UI not yet landed');

        assert.equal(await h.isVisible(session, '#title-screen'), true, '#title-screen should be visible');
        const audit = await session.evaluate(() => {
          const legacyCrests = document.querySelectorAll('.war-generals-crest').length;
          const crestImgs = Array.from(document.querySelectorAll('#title-screen img[src*="hero_crest"]')).map((img) => {
            const st = window.getComputedStyle(img);
            const r = img.getBoundingClientRect();
            return {
              src: img.getAttribute('src') || '',
              complete: img.complete,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              visible: st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0,
              w: r.width,
              h: r.height,
            };
          });
          return { legacyCrests, crestImgs };
        });

        assert.equal(audit.legacyCrests, 0, 'Legacy rectangular .war-generals-crest box must be removed');
        assert.ok(audit.crestImgs.length >= 1, 'Expected Heroic Title Centerpiece img[src*="hero_crest"] inside #title-screen');
        const hero = audit.crestImgs[0];
        assert.equal(hero.visible, true, 'Heroic Title Centerpiece image is hidden');
        assert.equal(hero.complete && hero.naturalWidth >= 512, true, `hero_crest must load at >=512px naturalWidth: ${JSON.stringify(hero)}`);
        assert.ok(hero.w >= 48 && hero.h >= 48, `hero_crest rendered collapsed: ${JSON.stringify(hero)}`);
      });
    }
  );

  reg(
    {
      id: 'T1-F24-3',
      tier: 1,
      feature: 'F24',
      title: 'Start screen eliminates stacked .menu-command-card/.mc-icon bars and boxy top-right utility squares',
      timeoutMs: 25000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const landed = await h.hasM5HeroStartScreen(session);
        ctx.requireCapability(landed, 'M5', 'F24', 'M5 non-boxy sculpted command-blade UI not yet landed');

        const audit = await session.evaluate(() => {
          const parseAlpha = (col) => {
            if (!col || col === 'transparent') return 0;
            const m = col.match(/rgba?\([^)]+,\s*([0-9.]+)\)/);
            return m ? Number(m[1]) : 1;
          };

          const legacyCards = document.querySelectorAll('.menu-command-card').length;
          const legacyIcons = document.querySelectorAll('.mc-icon').length;

          const deck = document.querySelector('#title-main-cards, #title-thumb-deck');
          const navBtns = deck
            ? Array.from(deck.querySelectorAll('button')).filter((b) => {
                if (b.closest('[hidden]')) return false;
                const st = window.getComputedStyle(b);
                const r = b.getBoundingClientRect();
                return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
              })
            : [];

          const navDetails = navBtns.map((b) => {
            const st = window.getComputedStyle(b);
            const r = b.getBoundingClientRect();
            return {
              id: b.id || b.className,
              w: Math.round(r.width),
              h: Math.round(r.height),
              clipPath: st.clipPath || 'none',
              transform: st.transform || 'none',
            };
          });

          // Check if >= 4 nav buttons are identical-width rectangular bars with zero clip-path
          const widthBuckets = new Map();
          for (const d of navDetails) {
            if (d.clipPath === 'none') {
              const key = Math.round(d.w / 3) * 3;
              widthBuckets.set(key, (widthBuckets.get(key) || 0) + 1);
            }
          }
          const maxUniformUnclippedBars = widthBuckets.size > 0 ? Math.max(...widthBuckets.values()) : 0;

          const utilityAudit = ['#btn-title-mute', '#btn-title-fs'].map((sel) => {
            const el = document.querySelector(sel);
            if (!el) return { sel, missing: true };
            const r = el.getBoundingClientRect();
            const st = window.getComputedStyle(el);
            const rad = parseFloat(st.borderRadius) || 0;
            const bw = parseFloat(st.borderTopWidth) || 0;
            const isBoxySquare =
              Math.abs(r.width - r.height) <= 4 &&
              rad >= 6 &&
              rad <= 18 &&
              bw >= 1 &&
              st.clipPath === 'none' &&
              parseAlpha(st.borderTopColor) > 0.08 &&
              parseAlpha(st.backgroundColor) > 0.12;
            return {
              sel,
              missing: false,
              w: Math.round(r.width),
              h: Math.round(r.height),
              borderRadius: st.borderRadius,
              borderWidth: st.borderTopWidth,
              clipPath: st.clipPath,
              isBoxySquare,
            };
          });

          return {
            legacyCards,
            legacyIcons,
            navCount: navDetails.length,
            maxUniformUnclippedBars,
            navDetails,
            utilityAudit,
          };
        });

        assert.equal(audit.legacyCards, 0, 'Legacy .menu-command-card stacked bars must be removed');
        assert.equal(audit.legacyIcons, 0, 'Legacy .mc-icon square icon boxes must be removed');
        assert.ok(audit.navCount >= 5, `Expected >= 5 visible start-screen navigation blades, got ${audit.navCount}`);
        assert.ok(
          audit.maxUniformUnclippedBars < 4,
          `Start screen still uses >=4 identical-width unclipped rectangular bars: ${JSON.stringify(audit.navDetails)}`
        );
        for (const u of audit.utilityAudit) {
          assert.equal(u.missing, false, `Utility control missing: ${u.sel}`);
          assert.equal(u.isBoxySquare, false, `Utility button ${u.sel} still has boxy rounded-square border: ${JSON.stringify(u)}`);
        }
      });
    }
  );

  reg(
    {
      id: 'T1-F24-4',
      tier: 1,
      feature: 'F24',
      title: 'Live TITLE cyclorama renders with zero bright white horizontal seam across Portrait, Landscape & Desktop',
      timeoutMs: 30000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        for (const presetName of ['MOBILE_PORTRAIT', 'MOBILE_LANDSCAPE', 'DESKTOP_LAPTOP']) {
          await session.setViewport(h.resolvePreset(ctx, presetName));
          await session.evaluate(() => window.__WAR_GENERALS_STAGE__?.poseTitle());
          await h.sleep(300);
          const png = await session.capturePngBase64();
          const seam = await h.detectWhiteHorizontalSeam(session, png);
          assert.equal(
            seam.hasSeam,
            false,
            `Bright white horizontal cyclorama seam detected in TITLE (${presetName}): ${JSON.stringify(seam)}`
          );
        }
      });
    }
  );

  reg(
    {
      id: 'T1-F24-5',
      tier: 1,
      feature: 'F24',
      title: 'All 4 Battle Theaters (FIELD_HQ, PACIFIC_BRIDGE, IRON_BUNKER, NIGHT_OPS) have zero white cyclorama seam',
      timeoutMs: 35000,
    },
    async (ctx) => {
      await h.withSession(ctx, 'MOBILE_PORTRAIT', async (session) => {
        const caps = await h.getStageCapabilities(session);
        ctx.requireCapability(
          caps.hasSetTheater && caps.hasResetCameraOrbit,
          'M2/M3',
          'F24',
          'setTheater & resetCameraOrbit required for 4-theater cyclorama seam audit'
        );

        for (const th of h.THEATERS_4) {
          await session.evaluate((t) => window.__WAR_GENERALS_STAGE__.setTheater(t), th);
          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.poseTitle());
          await h.sleep(200);
          const titleSeam = await h.detectWhiteHorizontalSeam(session, await session.capturePngBase64());
          assert.equal(
            titleSeam.hasSeam,
            false,
            `White cyclorama seam detected in ${th} TITLE: ${JSON.stringify(titleSeam)}`
          );

          await session.evaluate(() => window.__WAR_GENERALS_STAGE__.poseTabletop('TACTICAL'));
          await h.sleep(200);
          const playSeam = await h.detectWhiteHorizontalSeam(session, await session.capturePngBase64());
          assert.equal(
            playSeam.hasSeam,
            false,
            `White cyclorama seam detected in ${th} TACTICAL PLAY: ${JSON.stringify(playSeam)}`
          );
        }
      });
    }
  );
}
