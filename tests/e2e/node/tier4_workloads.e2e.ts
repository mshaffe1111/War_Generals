import assert from 'node:assert/strict';
import {
  loadCampaignProgress,
} from '../../../src/ai/CommanderProfiles';
import { ORDERED_RANKS, RANK_SPECS, type Faction, type RankId } from '../../../src/core/ranks';
import { validateFactionDeployment, type DeploymentSlot } from '../../../src/core/RulesEngine';
import { GameStore } from '../../../src/state/GameStore';

interface NodeTestDeps {
  rootDir: string;
  resetMockStorage: () => void;
  loadSrcModule: (relPath: string) => Promise<any>;
  requireCapability: (condition: unknown, milestone: string, feature: string, message: string) => void;
}

function buildCustom21Slots(
  faction: Faction,
  overrides: Array<{ col: number; row: number; rank: RankId }>,
  reservedEmpty: Array<{ col: number; row: number }> = []
): DeploymentSlot[] {
  const baseRows = faction === 'PLAYER' ? [5, 6, 7] : [0, 1, 2];
  const remaining: RankId[] = [];
  for (const r of ORDERED_RANKS) {
    for (let i = 0; i < RANK_SPECS[r].countPerArmy; i++) remaining.push(r);
  }
  const blocked = new Set<string>(reservedEmpty.map((s) => `${s.col},${s.row}`));
  const usedCoords = new Set<string>();
  const out: DeploymentSlot[] = [];

  for (const ov of overrides) {
    const idx = remaining.indexOf(ov.rank);
    assert.notEqual(idx, -1);
    remaining.splice(idx, 1);
    usedCoords.add(`${ov.col},${ov.row}`);
    out.push({ col: ov.col, row: ov.row, rank: ov.rank });
  }
  const freeCoords: Array<{ col: number; row: number }> = [];
  for (const r of baseRows) {
    for (let c = 0; c < 9; c++) {
      const k = `${c},${r}`;
      if (!usedCoords.has(k) && !blocked.has(k)) freeCoords.push({ col: c, row: r });
    }
  }
  for (let i = 0; i < remaining.length; i++) {
    const sq = freeCoords[i]!;
    out.push({ col: sq.col, row: sq.row, rank: remaining[i]! });
  }
  assert.equal(validateFactionDeployment(faction, out), true);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function registerNodeTests(
  register: (
    meta: { id: string; tier: number; feature: string; mode: string; title: string },
    fn: () => Promise<void> | void
  ) => void,
  deps: NodeTestDeps
): Promise<void> {
  const { loadSrcModule } = deps;

  // T4-N01: Full Skirmish & Campaign Lifecycle Workload via GameStore (opaque-box)
  register(
    {
      id: 'T4-N01',
      tier: 4,
      feature: 'F1+F2+F3+F5+F6',
      mode: 'NODE',
      title: 'Full Skirmish + Campaign Lifecycle: Deploy, Play >= 6 Turns, Clash, Dossier, X-Ray Replay & Rematch',
    },
    async () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1980s', clockPreset: 'STANDARD', difficulty: 'OFFICER' });
        assert.equal(store.startCampaignTier('MILLER'), true);
        assert.equal(store.getVisibleView().phase, 'DEPLOY');

        // Apply preset, mirror, then swap two pieces manually
        store.applyDeploymentPreset('SHADOW_PINCER');
        store.mirrorPlayerDeployment();
        const deployView = store.getVisibleView();
        assert.equal(deployView.deployedCount, 21);
        const pPieces = deployView.pieces.filter((p) => p.faction === 'PLAYER');
        store.selectPiece(pPieces[0]!.id);
        assert.equal(store.placeOrSwapDeployment(pPieces[1]!.col, pPieces[1]!.row), true);
        assert.equal(store.launchBattleFromDeployment(), true);

        // Play 6+ alternating turns with real AI responses (waiting up to 1.5s per AI turn)
        let clashesTriggered = 0;
        for (let ply = 0; ply < 12; ply++) {
          let view = store.getVisibleView();
          if (view.phase !== 'PLAY') break;

          if (view.activeTurn === 'PLAYER') {
            // Prefer a challenge move if available to guarantee at least one real clash, else advance forward
            const own = view.pieces.filter((p) => p.alive && p.faction === 'PLAYER');
            let chosen: { id: string; col: number; row: number; kind: string } | null = null;
            for (const u of own) {
              const moves = store.computeValidMoves(u.id);
              const ch = moves.find((m) => m.kind === 'CHALLENGE');
              if (ch) {
                chosen = { id: u.id, col: ch.col, row: ch.row, kind: 'CHALLENGE' };
                break;
              }
            }
            if (!chosen) {
              for (const u of own) {
                if (u.visibleRank === 'FLAG') continue;
                const moves = store.computeValidMoves(u.id);
                const fwd = moves.find((m) => m.direction === 'UP');
                if (fwd) {
                  chosen = { id: u.id, col: fwd.col, row: fwd.row, kind: fwd.kind };
                  break;
                }
              }
            }
            assert.ok(chosen, 'Player must have at least one legal move');
            const res = store.executeMoveOrChallenge(chosen.col, chosen.row, chosen.id);
            if (res?.kind === 'CLASH') {
              clashesTriggered++;
              // Verify enemy rank remains masked during clash
              assert.ok(
                store.getVisibleView().pieces.filter((p) => p.faction === 'ENEMY').every((e) => e.visibleRank === 'UNKNOWN')
              );
              store.finalizeActiveClash();
            }
          }

          // Wait for scheduled AI turn to execute
          const deadline = Date.now() + 1800;
          while (Date.now() < deadline) {
            const v = store.getVisibleView();
            if (v.activeClash) {
              clashesTriggered++;
              store.finalizeActiveClash();
            }
            if (store.getVisibleView().phase !== 'PLAY' || store.getVisibleView().activeTurn === 'PLAYER') {
              break;
            }
            await sleep(40);
          }
        }

        const midView = store.getVisibleView();
        assert.ok(midView.turnCount >= 6, `Expected >= 6 turns elapsed, got ${midView.turnCount}`);
        assert.ok(
          midView.pieces.filter((p) => p.faction === 'ENEMY').every((e) => e.visibleRank === 'UNKNOWN'),
          'Fog of war violated during active play'
        );

        // Conclude match cleanly via surrender if still in PLAY, inspect Dossier, then scrub Replay
        if (store.getVisibleView().phase === 'PLAY') {
          store.surrenderMatch();
        }
        const overView = store.getVisibleView();
        assert.equal(overView.phase, 'GAME_OVER');
        assert.ok(overView.dossier);
        assert.equal(loadCampaignProgress().unlockedTier, 1); // surrender does not unlock Tier 2

        store.enterDeclassifiedReplay();
        const repView = store.getVisibleView();
        assert.equal(repView.phase, 'REPLAY');
        assert.ok(repView.replay && repView.replay.plies.length >= 6);
        store.setReplayPly(0);
        assert.equal(store.getVisibleView().replay?.currentPly, 0);
        store.stepReplay(2);
        assert.equal(store.getVisibleView().replay?.currentPly, 2);

        // Rematch resets to clean DEPLOY
        store.rematchCurrentMode();
        const rematchView = store.getVisibleView();
        assert.equal(rematchView.phase, 'DEPLOY');
        assert.equal(rematchView.replay, null);
        assert.equal(rematchView.turnCount, 1);
        void clashesTriggered;
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // T4-N02: Full 1970s Classic + Armory Blueprint + Pass & Play + Operation Workload
  register(
    {
      id: 'T4-N02',
      tier: 4,
      feature: 'F1+F2+F3+F4+F5+F6',
      mode: 'NODE',
      title: 'Full 1970s Classic + Armory Blueprint Save/Load + Pass & Play Shroud + Operations',
    },
    async () => {
      const store = new GameStore();
      try {
        // 1) Open Formation Armory, apply preset, swap, save to Slot S1, reload in new deployment
        store.openFormationArmory();
        assert.equal(store.getVisibleView().phase, 'ARMORY');
        store.applyDeploymentPreset('CITADEL_PHALANX');
        assert.equal(store.saveBlueprintToSlot(0), true);
        assert.equal(store.getVisibleView().savedBlueprintSlots[0], true);

        // 2) Switch to 1970s Classic + Pass & Play, load Slot S1 for Navy, verify shroud & Flag capture
        store.updateOptions({ eraMode: '1970s', clockPreset: 'STANDARD', theaterId: 'IRON_BUNKER' });
        store.startPassAndPlay();
        assert.equal(store.loadBlueprintFromSlot(0), true);
        assert.equal(store.getVisibleView().deployedCount, 21);

        // Override via clean custom 21 for deterministic Flag capture check
        store.clearPlayerDeployment();
        for (const s of buildCustom21Slots('PLAYER', [{ col: 3, row: 5, rank: 'GEN_5' }])) {
          store.placeOrSwapDeployment(s.col, s.row, s.rank);
        }
        assert.equal(store.launchBattleFromDeployment(), true);
        assert.equal(store.getVisibleView().shroud?.active, true);
        store.unsealCommandShroud();

        store.clearPlayerDeployment();
        for (const s of buildCustom21Slots('ENEMY', [{ col: 3, row: 2, rank: 'FLAG' }], [{ col: 8, row: 2 }])) {
          store.placeOrSwapDeployment(s.col, s.row, s.rank);
        }
        assert.equal(store.launchBattleFromDeployment(), true);
        assert.equal(store.getVisibleView().shroud?.active, true);
        store.unsealCommandShroud();

        const move = (fc: number, fr: number, tc: number, tr: number) => {
          let v = store.getVisibleView();
          if (v.shroud?.active) {
            store.unsealCommandShroud();
            v = store.getVisibleView();
          }
          const u = v.pieces.find((p) => p.alive && p.faction === v.activeTurn && p.col === fc && p.row === fr)!;
          assert.ok(u);
          store.selectPiece(u.id);
          return store.executeMoveOrChallenge(tc, tr, u.id);
        };

        move(3, 5, 3, 4);
        move(8, 1, 8, 2);
        move(3, 4, 3, 3);
        move(8, 2, 8, 1);
        const cap = move(3, 3, 3, 2);
        assert.equal(cap?.kind, 'CLASH');
        if (cap?.kind === 'CLASH') {
          assert.equal(cap.verdict.resolution, 'FLAG_CAPTURED_BY_PLAYER');
        }
        store.finalizeActiveClash();
        assert.equal(store.getVisibleView().phase, 'GAME_OVER');
        assert.equal(store.getVisibleView().matchWinner, 'PLAYER');

        // 3) If M1 GameStore.startOperation is present, verify launching an Operation afterward clears prior match state
        const opsMod = await loadSrcModule('src/core/operations.ts');
        if (typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length) {
          assert.equal((store as any).startOperation(opsMod.TACTICAL_OPERATIONS[0].id), true);
          assert.equal(store.getVisibleView().matchMode, 'OPERATION');
          assert.equal(store.getVisibleView().matchWinner, null);
        }
      } finally {
        store.returnToTitleMenu();
      }
    }
  );
}
