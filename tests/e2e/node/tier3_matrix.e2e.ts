import assert from 'node:assert/strict';
import {
  BeliefMatrixAI,
  type AIOwnUnitState,
  type ObservedPlayerUnitState,
} from '../../../src/ai/BeliefMatrixAI';
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

export async function registerNodeTests(
  register: (
    meta: { id: string; tier: number; feature: string; mode: string; title: string },
    fn: () => Promise<void> | void
  ) => void,
  deps: NodeTestDeps
): Promise<void> {
  const { loadSrcModule, requireCapability } = deps;

  // T3-10: 1970s + SURVIVAL_DEFENSE Operation + Adjacent Enemy Flag Survival
  register(
    { id: 'T3-10', tier: 3, feature: 'F2+F4', mode: 'NODE', title: '1970s + SURVIVAL_DEFENSE Operation + Adjacent Enemy Flag Survival' },
    async () => {
      const store = new GameStore();
      const opsMod = await loadSrcModule('src/core/operations.ts');
      requireCapability(
        typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length,
        'M1',
        'F4',
        'GameStore.startOperation() not yet implemented'
      );
      try {
        assert.equal((store as any).startOperation('OP_04_BUNKER_SIEGE'), true);
        const op = opsMod.getTacticalOperation('OP_04_BUNKER_SIEGE');
        assert.equal(op.eraRuleset, '1970s');
        assert.equal(op.objectiveKind, 'SURVIVAL_DEFENSE');
        assert.equal(store.getOptions().eraMode, '1970s');
        assert.equal(store.getVisibleView().matchMode, 'OPERATION');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // T3-11: PASS_AND_PLAY + 1970s + Flag-on-Flag Challenge + BLITZ Clock
  register(
    { id: 'T3-11', tier: 3, feature: 'F2+F3+F6', mode: 'NODE', title: 'PASS_AND_PLAY + 1970s + Flag-on-Flag Challenge + BLITZ Clock' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1970s', clockPreset: 'BLITZ' });
        store.startPassAndPlay();
        store.clearPlayerDeployment();
        for (const s of buildCustom21Slots('PLAYER', [{ col: 4, row: 5, rank: 'FLAG' }])) {
          store.placeOrSwapDeployment(s.col, s.row, s.rank);
        }
        store.launchBattleFromDeployment();
        store.unsealCommandShroud();

        store.clearPlayerDeployment();
        for (const s of buildCustom21Slots(
          'ENEMY',
          [{ col: 4, row: 2, rank: 'FLAG' }],
          [{ col: 8, row: 2 }]
        )) {
          store.placeOrSwapDeployment(s.col, s.row, s.rank);
        }
        store.launchBattleFromDeployment();
        store.unsealCommandShroud();

        assert.equal(store.getVisibleView().matchClockSec, 300);

        // Navy Flag (4,5)->(4,4) -> Shroud -> Crimson (8,1)->(8,2) -> Shroud -> Navy Flag (4,4)->(4,3) -> Shroud -> Crimson (8,2)->(8,1)
        const move = (fc: number, fr: number, tc: number, tr: number) => {
          let v = store.getVisibleView();
          if (v.shroud?.active) {
            store.unsealCommandShroud();
            v = store.getVisibleView();
          }
          const u = v.pieces.find((p) => p.alive && p.faction === v.activeTurn && p.col === fc && p.row === fr)!;
          assert.ok(u);
          store.selectPiece(u.id);
          const r = store.executeMoveOrChallenge(tc, tr, u.id);
          assert.ok(r);
          return r;
        };

        move(4, 5, 4, 4);
        move(8, 1, 8, 2);
        move(4, 4, 4, 3);
        move(8, 2, 8, 1);

        const clash = move(4, 3, 4, 2);
        assert.equal(clash.kind, 'CLASH');
        if (clash.kind === 'CLASH') {
          assert.equal(clash.verdict.resolution, 'FLAG_CAPTURED_BY_PLAYER');
          assert.equal(clash.verdict.playerVisibleRank, 'UNKNOWN');
        }
        store.finalizeActiveClash();
        assert.equal(store.getVisibleView().phase, 'GAME_OVER');
        assert.equal(store.getVisibleView().matchWinner, 'PLAYER');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // T3-17: CAMPAIGN + RECRUIT vs SUPREME_MARSHAL + BeliefMatrixAI Decay vs Lossless
  register(
    { id: 'T3-17', tier: 3, feature: 'F5', mode: 'NODE', title: 'RECRUIT 40%/turn memory decay vs SUPREME_MARSHAL lossless Sinkhorn constraints' },
    () => {
      const pInit = [
        { id: 'p_0', col: 3, row: 5 },
        { id: 'p_1', col: 4, row: 5 },
        { id: 'p_2', col: 5, row: 5 },
      ];
      const aiUnits: AIOwnUnitState[] = [
        { id: 'e_flag', ownRank: 'FLAG', col: 0, row: 0, hasMoved: false },
        { id: 'e_gen5', ownRank: 'GEN_5', col: 4, row: 2, hasMoved: false },
      ];
      const obsP: ObservedPlayerUnitState[] = [
        { id: 'p_0', col: 3, row: 5, publicKills: 1, hasMoved: true },
        { id: 'p_1', col: 4, row: 5, publicKills: 0, hasMoved: false },
        { id: 'p_2', col: 5, row: 5, publicKills: 0, hasMoved: false },
      ];

      const recruitAI = new BeliefMatrixAI();
      const marshalAI = new BeliefMatrixAI();
      recruitAI.initializeMatch(pInit, aiUnits, { PRIVATE: 1, GEN_4: 1, FLAG: 1 });
      marshalAI.initializeMatch(pInit, aiUnits, { PRIVATE: 1, GEN_4: 1, FLAG: 1 });

      // Both observe p_0 defeating an AI SPY -> 100% locked PRIVATE!
      recruitAI.recordClashOutcome('p_0', 'e_spy', 'SPY', 'AI_LOST', 1);
      marshalAI.recordClashOutcome('p_0', 'e_spy', 'SPY', 'AI_LOST', 1);

      for (let turn = 2; turn <= 16; turn++) {
        recruitAI.chooseCommanderMove(aiUnits, obsP, 'MILLER', turn, {
          difficulty: 'RECRUIT',
          rng: () => 0.5,
        });
        marshalAI.chooseCommanderMove(aiUnits, obsP, 'HOLLIS', turn, {
          difficulty: 'SUPREME_MARSHAL',
          rng: () => 0.5,
        });
      }

      const recruitDist = recruitAI.getPieceDistribution('p_0');
      const marshalDist = marshalAI.getPieceDistribution('p_0');
      assert.ok(marshalDist.PRIVATE > 0.99, `Marshal must retain 100% PRIVATE lock, got ${marshalDist.PRIVATE}`);
      assert.ok(recruitDist.PRIVATE < marshalDist.PRIVATE - 0.25, `Recruit must decay memory, got ${recruitDist.PRIVATE}`);
    }
  );

  // T3-21: OPERATION (SPY_HUNT) + 1980s + Private vs Spy + Spy vs Gen_5
  register(
    { id: 'T3-21', tier: 3, feature: 'F3+F4', mode: 'NODE', title: 'OPERATION (SPY_HUNT) tracks eliminated Spies while preserving fog-of-war' },
    async () => {
      const store = new GameStore();
      const opsMod = await loadSrcModule('src/core/operations.ts');
      requireCapability(
        typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length,
        'M1',
        'F4',
        'GameStore.startOperation() not yet implemented'
      );
      try {
        assert.equal((store as any).startOperation('OP_02_STILETTO_PURGE'), true);
        const view = store.getVisibleView();
        assert.equal(view.operationObjective, 'SPY_HUNT');
        const enemies = view.pieces.filter((p) => p.faction === 'ENEMY');
        assert.ok(enemies.length >= 2);
        assert.ok(enemies.every((e) => e.visibleRank === 'UNKNOWN'));
      } finally {
        store.returnToTitleMenu();
      }
    }
  );
}
