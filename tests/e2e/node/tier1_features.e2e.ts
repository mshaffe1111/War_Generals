import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BeliefMatrixAI,
  type AIOwnUnitState,
  type ObservedPlayerUnitState,
} from '../../../src/ai/BeliefMatrixAI';
import {
  COMMANDER_ROSTER,
  generateCommanderDeployment,
  loadCampaignProgress,
  recordCampaignMatchResult,
  recordPostMatchPlayerTendencies,
  type CommanderId,
} from '../../../src/ai/CommanderProfiles';
import { resolveArbiterChallenge } from '../../../src/arbiter/ArbiterResolver';
import {
  BOARD_COLS,
  ORDERED_RANKS,
  RANK_SPECS,
  type Faction,
  type RankId,
} from '../../../src/core/ranks';
import {
  ARMY_PIECE_TOTAL,
  TOURNAMENT_PRESETS,
  validateFactionDeployment,
  validatePlayerDeployment,
  type DeploymentSlot,
} from '../../../src/core/RulesEngine';
import type {
  BattleChoreographyKind,
  MatchMode,
  QualityTier,
  TheaterId,
  ViewportFrameMode,
} from '../../../src/core/types';
import { GameStore } from '../../../src/state/GameStore';
import { CLOCK_PRESET_SPECS, SettingsStore } from '../../../src/state/SettingsStore';

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
    for (let i = 0; i < RANK_SPECS[r].countPerArmy; i++) {
      remaining.push(r);
    }
  }
  const blocked = new Set<string>(reservedEmpty.map((s) => `${s.col},${s.row}`));
  const usedCoords = new Set<string>();
  const out: DeploymentSlot[] = [];

  for (const ov of overrides) {
    const idx = remaining.indexOf(ov.rank);
    assert.notEqual(idx, -1, `Override rank ${ov.rank} exceeded army count`);
    remaining.splice(idx, 1);
    const key = `${ov.col},${ov.row}`;
    assert.equal(usedCoords.has(key), false, `Duplicate override coord ${key}`);
    assert.equal(blocked.has(key), false, `Override coord ${key} was also reserved empty`);
    usedCoords.add(key);
    out.push({ col: ov.col, row: ov.row, rank: ov.rank });
  }

  const freeCoords: Array<{ col: number; row: number }> = [];
  for (const r of baseRows) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const key = `${c},${r}`;
      if (!usedCoords.has(key) && !blocked.has(key)) {
        freeCoords.push({ col: c, row: r });
      }
    }
  }

  assert.ok(freeCoords.length >= remaining.length, 'Too many reservedEmpty squares for 21 pieces');
  for (let i = 0; i < remaining.length; i++) {
    const sq = freeCoords[i]!;
    out.push({ col: sq.col, row: sq.row, rank: remaining[i]! });
  }

  assert.equal(validateFactionDeployment(faction, out), true, 'Custom 21-piece setup must be legal');
  return out;
}

function deployAndLaunchPassAndPlay(
  store: GameStore,
  navyOverrides: Array<{ col: number; row: number; rank: RankId }>,
  crimsonOverrides: Array<{ col: number; row: number; rank: RankId }>,
  navyEmpty: Array<{ col: number; row: number }> = [],
  crimsonEmpty: Array<{ col: number; row: number }> = []
): void {
  store.startPassAndPlay();
  store.clearPlayerDeployment();
  const navySlots = buildCustom21Slots('PLAYER', navyOverrides, navyEmpty);
  for (const s of navySlots) {
    assert.equal(store.placeOrSwapDeployment(s.col, s.row, s.rank), true);
  }
  assert.equal(store.launchBattleFromDeployment(), true);
  assert.equal(store.getVisibleView().shroud?.active, true);
  store.unsealCommandShroud();

  store.clearPlayerDeployment();
  const crimsonSlots = buildCustom21Slots('ENEMY', crimsonOverrides, crimsonEmpty);
  for (const s of crimsonSlots) {
    assert.equal(store.placeOrSwapDeployment(s.col, s.row, s.rank), true);
  }
  assert.equal(store.launchBattleFromDeployment(), true);
  assert.equal(store.getVisibleView().shroud?.active, true);
  store.unsealCommandShroud();
}

function stepTurnMove(
  store: GameStore,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number
) {
  let view = store.getVisibleView();
  if (view.shroud?.active) {
    store.unsealCommandShroud();
    view = store.getVisibleView();
  }
  const piece = view.pieces.find(
    (p) => p.alive && p.faction === view.activeTurn && p.col === fromCol && p.row === fromRow
  );
  assert.ok(piece, `Expected active piece at (${fromCol},${fromRow}) for ${view.activeTurn}`);
  store.selectPiece(piece.id);
  const res = store.executeMoveOrChallenge(toCol, toRow, piece.id);
  assert.ok(res, `Expected legal move (${fromCol},${fromRow}) -> (${toCol},${toRow})`);
  return res;
}

function stepAnyQuietMove(store: GameStore, avoidCols: number[] = [0, 4]): void {
  let view = store.getVisibleView();
  if (view.shroud?.active) {
    store.unsealCommandShroud();
    view = store.getVisibleView();
  }
  const fac = view.activeTurn;
  const avoid = new Set(avoidCols);
  const candidates = view.pieces.filter(
    (p) => p.alive && p.faction === fac && p.visibleRank !== 'FLAG' && !avoid.has(p.col)
  );
  for (const unit of candidates) {
    const moves = store.computeValidMoves(unit.id);
    const quiet = moves.find(
      (m) => m.kind === 'MOVE' && !avoid.has(m.col) && m.row >= 1 && m.row <= 6
    );
    if (quiet) {
      store.selectPiece(unit.id);
      const res = store.executeMoveOrChallenge(quiet.col, quiet.row, unit.id);
      assert.equal(res?.kind, 'MOVED');
      return;
    }
  }
  assert.fail(`No safe quiet move found for ${fac} avoiding cols [${avoidCols.join(',')}]`);
}

function withDeterministicOperationEnv<T>(seed0: number, fn: (flushAiTimers: () => void) => T): T {
  const origRandom = Math.random;
  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;

  let s = seed0 >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let nextHandle = 70000;
  const aiTimers = new Map<number, () => void>();
  const clockIntervals = new Set<number>();

  (globalThis as any).setTimeout = (cb: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    if (ms === 560 || ms === 680) {
      const handle = nextHandle++;
      aiTimers.set(handle, () => cb(...args));
      return handle;
    }
    return origSetTimeout(cb, ms, ...args);
  };
  (globalThis as any).clearTimeout = (handle: any) => {
    if (typeof handle === 'number' && aiTimers.has(handle)) {
      aiTimers.delete(handle);
      return;
    }
    return origClearTimeout(handle);
  };
  (globalThis as any).setInterval = (_cb: (...args: any[]) => void, ms?: number) => {
    if (ms === 1000) {
      const handle = nextHandle++;
      clockIntervals.add(handle);
      return handle;
    }
    return origSetInterval(_cb, ms);
  };
  (globalThis as any).clearInterval = (handle: any) => {
    if (typeof handle === 'number' && clockIntervals.has(handle)) {
      clockIntervals.delete(handle);
      return;
    }
    return origClearInterval(handle);
  };

  const flushAiTimers = () => {
    while (aiTimers.size > 0) {
      const entries = Array.from(aiTimers.entries());
      aiTimers.clear();
      for (const [, cb] of entries) {
        cb();
      }
    }
  };

  try {
    return fn(flushAiTimers);
  } finally {
    aiTimers.clear();
    clockIntervals.clear();
    Math.random = origRandom;
    globalThis.setTimeout = origSetTimeout;
    globalThis.clearTimeout = origClearTimeout;
    globalThis.setInterval = origSetInterval;
    globalThis.clearInterval = origClearInterval;
  }
}

function collectFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

export async function registerNodeTests(
  register: (
    meta: { id: string; tier: number; feature: string; mode: string; title: string },
    fn: () => Promise<void> | void
  ) => void,
  deps: NodeTestDeps
): Promise<void> {
  const { rootDir, resetMockStorage, loadSrcModule, requireCapability } = deps;

  // =========================================================================
  // F1: Shared Type & Contract Lock (T1-F01-1 .. T1-F01-4)
  // =========================================================================
  register(
    { id: 'T1-F01-1', tier: 1, feature: 'F1', mode: 'NODE', title: 'MatchMode union & GameStore mode transitions' },
    async () => {
      const store = new GameStore();
      try {
        const expectedModes: MatchMode[] = ['SKIRMISH', 'CAMPAIGN', 'OPERATION', 'PASS_AND_PLAY'];
        assert.equal(expectedModes.length, 4);

        store.startSkirmish('MILLER', '1980s');
        assert.equal(store.getVisibleView().matchMode, 'SKIRMISH');

        assert.equal(store.startCampaignTier('MILLER'), true);
        assert.equal(store.getVisibleView().matchMode, 'CAMPAIGN');

        store.startPassAndPlay();
        assert.equal(store.getVisibleView().matchMode, 'PASS_AND_PLAY');

        const opsMod = await loadSrcModule('src/core/operations.ts');
        requireCapability(
          typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length,
          'M1',
          'F1',
          'GameStore.startOperation() not yet wired for MatchMode="OPERATION"'
        );
        const firstOpId = opsMod.TACTICAL_OPERATIONS[0].id;
        assert.equal((store as any).startOperation(firstOpId), true);
        assert.equal(store.getVisibleView().matchMode, 'OPERATION');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F01-2', tier: 1, feature: 'F1', mode: 'NODE', title: 'BattleChoreographyKind covers all 6 literals via resolveArbiterChallenge' },
    () => {
      const expected = new Set<BattleChoreographyKind>([
        'INFANTRY',
        'RECON_STEALTH',
        'ARMOR_ARTILLERY',
        'HIGH_COMMAND',
        'MUTUAL_SPLIT',
        'FLAG_BREACH',
      ]);
      const samples: Array<[RankId, RankId, BattleChoreographyKind]> = [
        ['SERGEANT', 'PRIVATE', 'INFANTRY'],
        ['SPY', 'GEN_5', 'RECON_STEALTH'],
        ['COLONEL', 'MAJOR', 'ARMOR_ARTILLERY'],
        ['GEN_5', 'LT_COLONEL', 'HIGH_COMMAND'],
        ['CAPTAIN', 'CAPTAIN', 'MUTUAL_SPLIT'],
        ['PRIVATE', 'FLAG', 'FLAG_BREACH'],
      ];
      const seen = new Set<BattleChoreographyKind>();
      for (const [att, def, kind] of samples) {
        const v = resolveArbiterChallenge({
          contestedCoord: { col: 4, row: 4 },
          attackerId: 'p_01',
          attackerFaction: 'PLAYER',
          attackerTrueRank: att,
          defenderId: 'e_01',
          defenderFaction: 'ENEMY',
          defenderTrueRank: def,
          matchMode: 'SKIRMISH',
        });
        assert.equal(v.choreography, kind);
        seen.add(v.choreography);
      }
      assert.deepEqual(seen, expected);
    }
  );

  register(
    { id: 'T1-F01-3', tier: 1, feature: 'F1', mode: 'NODE', title: 'TheaterId, QualityTier, and ViewportFrameMode accepted by SettingsStore' },
    () => {
      const settings = new SettingsStore();
      const theaters: TheaterId[] = ['FIELD_HQ', 'PACIFIC_BRIDGE', 'IRON_BUNKER', 'NIGHT_OPS'];
      const qualities: QualityTier[] = ['AUTO', 'ULTRA', 'HIGH', 'BALANCED', 'BATTERY_SAVER'];
      const frames: ViewportFrameMode[] = ['FULL_VIEWPORT', 'PHONE_9_16'];

      for (const theaterId of theaters) {
        const next = settings.update({ theaterId });
        assert.equal(next.theaterId, theaterId);
      }
      for (const qualityMode of qualities) {
        const next = settings.update({ qualityMode });
        assert.equal(next.qualityMode, qualityMode);
      }
      for (const viewportFrameMode of frames) {
        const next = settings.update({ viewportFrameMode });
        assert.equal(next.viewportFrameMode, viewportFrameMode);
      }
    }
  );

  register(
    { id: 'T1-F01-4', tier: 1, feature: 'F1', mode: 'NODE', title: 'TACTICAL_OPERATIONS conforms to TacticalOperationSpec contract' },
    async () => {
      const opsMod = await loadSrcModule('src/core/operations.ts');
      requireCapability(opsMod?.TACTICAL_OPERATIONS, 'M1', 'F1', 'src/core/operations.ts not found');
      const ops = opsMod.TACTICAL_OPERATIONS as any[];
      assert.ok(ops.length >= 8);

      const validTheaters = new Set(['FIELD_HQ', 'PACIFIC_BRIDGE', 'IRON_BUNKER', 'NIGHT_OPS']);
      const validEras = new Set(['1980s', '1970s']);
      const validObjs = new Set(['CAPTURE_FLAG', 'FLAG_TRAVERSE', 'SPY_HUNT', 'SURVIVAL_DEFENSE', 'BLITZ_BREACH']);
      const validCmds = new Set(COMMANDER_ROSTER.map((c) => c.id));

      for (const op of ops) {
        assert.ok(typeof op.id === 'string' && op.id.length > 0);
        assert.ok(validTheaters.has(op.theaterId), `Invalid theater ${op.theaterId}`);
        assert.ok(validEras.has(op.eraRuleset), `Invalid era ${op.eraRuleset}`);
        assert.ok(validCmds.has(op.commanderId), `Invalid commander ${op.commanderId}`);
        assert.ok(typeof op.turnLimit === 'number' && op.turnLimit > 0);
        assert.ok(validObjs.has(op.objectiveKind), `Invalid objectiveKind ${op.objectiveKind}`);
        assert.ok(Array.isArray(op.playerPlacements) && op.playerPlacements.length > 0);
        assert.ok(Array.isArray(op.enemyPlacements) && op.enemyPlacements.length > 0);
        assert.ok(op.starThresholds && typeof op.starThresholds.threeStarMaxTurns === 'number');
        assert.ok(typeof op.starThresholds.twoStarMaxTurns === 'number');
      }
    }
  );

  // =========================================================================
  // F2: Salpakan Rules Edge-Case Fixes (T1-F02-1 .. T1-F02-5)
  // =========================================================================
  register(
    { id: 'T1-F02-1', tier: 1, feature: 'F2', mode: 'NODE', title: '1980s Electronic Flag Traverse wins immediately even adjacent to enemy' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1980s', clockPreset: 'UNTIMED' });
        deployAndLaunchPassAndPlay(
          store,
          [{ col: 0, row: 5, rank: 'FLAG' }],
          [{ col: 1, row: 0, rank: 'PRIVATE' }],
          [],
          [
            { col: 0, row: 0 },
            { col: 0, row: 1 },
            { col: 0, row: 2 },
          ]
        );

        for (let r = 5; r >= 1; r--) {
          const res = stepTurnMove(store, 0, r, 0, r - 1);
          if (r === 1) {
            if (res.kind === 'CLASH') {
              assert.equal(res.verdict.isFlagTraverseVictory, true);
              assert.equal(res.verdict.choreography, 'FLAG_BREACH');
              store.finalizeActiveClash();
            }
          } else {
            assert.equal(res.kind, 'MOVED');
            stepAnyQuietMove(store, [0, 1]);
          }
        }

        const view = store.getVisibleView();
        assert.equal(view.phase, 'GAME_OVER');
        assert.equal(view.matchWinner, 'PLAYER');
        assert.equal(view.banner, 'FLAG TRAVERSE — VICTORY');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F02-2', tier: 1, feature: 'F2', mode: 'NODE', title: '1970s Classic uncontested Flag Traverse wins immediately' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1970s', clockPreset: 'UNTIMED' });
        deployAndLaunchPassAndPlay(
          store,
          [{ col: 0, row: 5, rank: 'FLAG' }],
          [],
          [],
          [
            { col: 0, row: 0 },
            { col: 0, row: 1 },
            { col: 0, row: 2 },
            { col: 1, row: 0 }, // ensure 0 adjacent enemies when reaching (0,0)
          ]
        );

        for (let r = 5; r >= 1; r--) {
          const res = stepTurnMove(store, 0, r, 0, r - 1);
          if (r === 1 && res.kind === 'CLASH') {
            assert.equal(res.verdict.isFlagTraverseVictory, true);
            store.finalizeActiveClash();
          } else if (r > 1) {
            stepAnyQuietMove(store, [0, 1]);
          }
        }

        const view = store.getVisibleView();
        assert.equal(view.phase, 'GAME_OVER');
        assert.equal(view.matchWinner, 'PLAYER');
        assert.equal(view.banner, 'FLAG TRAVERSE — VICTORY');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F02-3', tier: 1, feature: 'F2', mode: 'NODE', title: '1970s Classic contested Flag Traverse defers 1 turn silently then wins' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1970s', clockPreset: 'UNTIMED' });
        deployAndLaunchPassAndPlay(
          store,
          [{ col: 0, row: 5, rank: 'FLAG' }],
          [{ col: 1, row: 0, rank: 'GEN_5' }],
          [],
          [
            { col: 0, row: 0 },
            { col: 0, row: 1 },
            { col: 0, row: 2 },
          ]
        );

        for (let r = 5; r >= 1; r--) {
          const res = stepTurnMove(store, 0, r, 0, r - 1);
          if (r === 1 && res.kind === 'CLASH') {
            assert.equal(res.verdict.isFlagTraverseVictory, true);
            store.finalizeActiveClash();
          } else if (r > 1) {
            stepAnyQuietMove(store, [0, 1]);
          }
        }

        const midView = store.getVisibleView();
        assert.equal(midView.phase, 'PLAY', '1970s contested Flag arrival must defer 1 turn');
        assert.equal(midView.matchWinner, null);
        const logText = midView.publicLog.map((e) => e.text).join('\n');
        assert.equal(logText.toLowerCase().includes('flag'), false, 'No Flag alert may leak');

        // Crimson makes a non-capturing move away from col 0/1
        stepAnyQuietMove(store, [0, 1]);

        const endView = store.getVisibleView();
        assert.equal(endView.phase, 'GAME_OVER');
        assert.equal(endView.matchWinner, 'PLAYER');
        assert.equal(endView.banner, 'FLAG TRAVERSE — VICTORY');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F02-4', tier: 1, feature: 'F2', mode: 'NODE', title: 'Flag-on-Flag challenge in live GameStore resolves FLAG_CAPTURED_BY_PLAYER' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1980s', clockPreset: 'UNTIMED' });
        deployAndLaunchPassAndPlay(
          store,
          [{ col: 4, row: 5, rank: 'FLAG' }],
          [{ col: 4, row: 2, rank: 'FLAG' }],
          [],
          [
            { col: 4, row: 0 },
            { col: 4, row: 1 },
          ]
        );

        // Navy Flag (4,5) -> (4,4); Crimson quiet move; Navy Flag (4,4) -> (4,3); Crimson quiet move
        stepTurnMove(store, 4, 5, 4, 4);
        stepAnyQuietMove(store, [4]);
        stepTurnMove(store, 4, 4, 4, 3);
        stepAnyQuietMove(store, [4]);

        const res = stepTurnMove(store, 4, 3, 4, 2);
        assert.equal(res.kind, 'CLASH');
        if (res.kind === 'CLASH') {
          assert.equal(res.verdict.resolution, 'FLAG_CAPTURED_BY_PLAYER');
        }
        store.finalizeActiveClash();

        const view = store.getVisibleView();
        assert.equal(view.phase, 'GAME_OVER');
        assert.equal(view.matchWinner, 'PLAYER');
        assert.equal(view.banner, 'FLAG CAPTURED — VICTORY');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F02-5', tier: 1, feature: 'F2', mode: 'NODE', title: 'Live GameStore Spy/Private triangle and Mutual Split casualty wells' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1980s', clockPreset: 'UNTIMED' });
        // Col 1: SPY vs GEN_5; Col 3: PRIVATE vs SPY; Col 5: COLONEL vs COLONEL
        deployAndLaunchPassAndPlay(
          store,
          [
            { col: 1, row: 5, rank: 'SPY' },
            { col: 3, row: 5, rank: 'PRIVATE' },
            { col: 5, row: 5, rank: 'COLONEL' },
            { col: 0, row: 7, rank: 'FLAG' },
          ],
          [
            { col: 1, row: 2, rank: 'GEN_5' },
            { col: 3, row: 2, rank: 'SPY' },
            { col: 5, row: 2, rank: 'COLONEL' },
            { col: 0, row: 0, rank: 'FLAG' },
          ]
        );

        // Advance Crimson pieces to row 4: (1,2)->(1,3), wait step by step
        const toggle = { flip: false };
        // Turn 1: Navy SPY (1,5)->(1,4); Turn 2: Crimson GEN_5 (1,2)->(1,3)
        stepTurnMove(store, 1, 5, 1, 4);
        stepTurnMove(store, 1, 2, 1, 3);
        // Turn 3: Navy SPY challenges Crimson GEN_5 at (1,3) -> SPY wins
        const clash1 = stepTurnMove(store, 1, 4, 1, 3);
        assert.equal(clash1.kind, 'CLASH');
        if (clash1.kind === 'CLASH') assert.equal(clash1.verdict.resolution, 'PLAYER_WINS');
        store.finalizeActiveClash();
        assert.equal(store.getVisibleView().enemyCasualties.length, 1);

        // Turn 4: Crimson SPY (3,2)->(3,3); Turn 5: Navy PRIVATE (3,5)->(3,4)
        stepTurnMove(store, 3, 2, 3, 3);
        stepTurnMove(store, 3, 5, 3, 4);
        // Turn 6: Crimson SPY challenges Navy PRIVATE at (3,4) -> DEFENDER (PLAYER_WINS)
        const clash2 = stepTurnMove(store, 3, 3, 3, 4);
        assert.equal(clash2.kind, 'CLASH');
        if (clash2.kind === 'CLASH') assert.equal(clash2.verdict.resolution, 'PLAYER_WINS');
        store.finalizeActiveClash();
        assert.equal(store.getVisibleView().enemyCasualties.length, 2);

        // Turn 7: Navy COLONEL (5,5)->(5,4); Turn 8: Crimson COLONEL (5,2)->(5,3)
        stepTurnMove(store, 5, 5, 5, 4);
        stepTurnMove(store, 5, 2, 5, 3);
        // Turn 9: Navy COLONEL challenges Crimson COLONEL at (5,3) -> MUTUAL_SPLIT
        const clash3 = stepTurnMove(store, 5, 4, 5, 3);
        assert.equal(clash3.kind, 'CLASH');
        if (clash3.kind === 'CLASH') assert.equal(clash3.verdict.resolution, 'MUTUAL_SPLIT');
        store.finalizeActiveClash();

        const view = store.getVisibleView();
        assert.equal(view.playerCasualties.length, 1);
        assert.equal(view.enemyCasualties.length, 3);
        assert.equal(view.pieces.length, 38, '42 - 4 eliminated pieces = 38 surviving');
        void toggle;
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F3: Fog-of-War & Pass-and-Play Masking (T1-F03-1, 2, 3, 5)
  // =========================================================================
  register(
    { id: 'T1-F03-1', tier: 1, feature: 'F3', mode: 'NODE', title: 'All enemy pieces and casualties stay UNKNOWN during DEPLOY and PLAY' },
    () => {
      const store = new GameStore();
      try {
        store.startSkirmish('MILLER', '1980s');
        store.applyDeploymentPreset('VACCINATION');
        let view = store.getVisibleView();
        assert.equal(view.phase, 'DEPLOY');
        const deployEnemies = view.pieces.filter((p) => p.faction === 'ENEMY');
        assert.equal(deployEnemies.length, 21);
        assert.ok(deployEnemies.every((e) => e.visibleRank === 'UNKNOWN'));

        store.launchBattleFromDeployment();
        view = store.getVisibleView();
        assert.equal(view.phase, 'PLAY');
        const playEnemies = view.pieces.filter((p) => p.faction === 'ENEMY');
        assert.equal(playEnemies.length, 21);
        assert.ok(playEnemies.every((e) => e.visibleRank === 'UNKNOWN'));
        assert.ok(view.enemyCasualties.every((c) => c.visibleRank === 'UNKNOWN'));
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F03-2', tier: 1, feature: 'F3', mode: 'NODE', title: 'ENEMY_WINS clash leaks zero enemy rank and derives choreography from playerVisibleRank' },
    () => {
      // 1) Pure ArbiterResolver check: COLONEL vs GEN_5 -> ARMOR_ARTILLERY (never HIGH_COMMAND)
      const directVerdict = resolveArbiterChallenge({
        contestedCoord: { col: 3, row: 4 },
        attackerId: 'p_col',
        attackerFaction: 'PLAYER',
        attackerTrueRank: 'COLONEL',
        defenderId: 'e_gen5',
        defenderFaction: 'ENEMY',
        defenderTrueRank: 'GEN_5',
        matchMode: 'SKIRMISH',
      });
      assert.equal(directVerdict.resolution, 'ENEMY_WINS');
      assert.equal(directVerdict.choreography, 'ARMOR_ARTILLERY');
      assert.equal(directVerdict.playerVisibleRank, 'COLONEL');

      // 2) Live GameStore ENEMY_WIN clash check
      const store = new GameStore();
      try {
        const verdict = store.triggerShowcaseClash('ENEMY_WIN');
        assert.ok(verdict);
        assert.equal(verdict.resolution, 'ENEMY_WINS');
        const view = store.getVisibleView();
        assert.ok(view.activeClash);
        const expectedChoreo =
          verdict.playerVisibleRank === 'COLONEL' ? 'ARMOR_ARTILLERY' : 'HIGH_COMMAND';
        assert.equal(verdict.choreography, expectedChoreo);

        store.finalizeActiveClash();
        const postView = store.getVisibleView();
        const serialized = JSON.stringify({
          verdict,
          publicLog: postView.publicLog,
          intelLedger: postView.intelLedger,
        });
        assert.equal(serialized.includes('GEN_5'), false, 'Enemy GEN_5 leaked');
        assert.equal(serialized.includes('5-Star'), false, 'Enemy 5-Star leaked');
        assert.equal(serialized.includes('5★'), false, 'Enemy 5★ leaked');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F03-3', tier: 1, feature: 'F3', mode: 'NODE', title: 'PASS_AND_PLAY Command Shroud masks all 42 pieces and casualties as UNKNOWN' },
    () => {
      const store = new GameStore();
      try {
        store.startPassAndPlay();
        store.applyDeploymentPreset('VACCINATION');
        store.launchBattleFromDeployment();

        let view = store.getVisibleView();
        assert.equal(view.shroud?.active, true);
        assert.ok(view.pieces.every((p) => p.visibleRank === 'UNKNOWN'));

        store.unsealCommandShroud();
        store.applyDeploymentPreset('MOTHERSHIP');
        store.launchBattleFromDeployment();

        view = store.getVisibleView();
        assert.equal(view.shroud?.active, true);
        assert.equal(view.pieces.length, 42);
        assert.ok(view.pieces.every((p) => p.visibleRank === 'UNKNOWN'));
        assert.ok(view.playerCasualties.every((c) => c.visibleRank === 'UNKNOWN'));
        assert.ok(view.enemyCasualties.every((c) => c.visibleRank === 'UNKNOWN'));
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F03-5', tier: 1, feature: 'F3', mode: 'NODE', title: 'True ranks declassified only in REPLAY and cleared on return to PLAY/TITLE' },
    () => {
      const store = new GameStore();
      try {
        store.startSkirmish('MILLER', '1980s');
        store.applyDeploymentPreset('VACCINATION');
        store.launchBattleFromDeployment();
        assert.equal(store.getVisibleView().replay, null);

        store.enterDeclassifiedReplay();
        const repView = store.getVisibleView();
        assert.equal(repView.phase, 'REPLAY');
        assert.ok(repView.replay && repView.replay.plies.length > 0);
        const enemySnaps = repView.replay.plies[0]!.boardSnapshot.filter((p) => p.faction === 'ENEMY');
        assert.ok(enemySnaps.some((p) => p.trueRank === 'FLAG'));

        store.returnToTitleMenu();
        const titleView = store.getVisibleView();
        assert.equal(titleView.phase, 'TITLE');
        assert.equal(titleView.replay, null);
        assert.ok(
          titleView.pieces.filter((p) => p.faction === 'ENEMY').every((p) => p.visibleRank === 'UNKNOWN')
        );
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F4: Tactical Operations & Challenges (T1-F04-1 .. T1-F04-4)
  // =========================================================================
  register(
    { id: 'T1-F04-1', tier: 1, feature: 'F4', mode: 'NODE', title: 'TACTICAL_OPERATIONS has >= 8 ops covering all 5 objective kinds' },
    async () => {
      const opsMod = await loadSrcModule('src/core/operations.ts');
      requireCapability(opsMod?.TACTICAL_OPERATIONS, 'M1', 'F4', 'src/core/operations.ts missing');
      const ops = opsMod.TACTICAL_OPERATIONS as any[];
      assert.ok(ops.length >= 8, `Expected >= 8 operations, got ${ops.length}`);
      const ids = new Set(ops.map((o) => o.id));
      assert.equal(ids.size, ops.length, 'Operation IDs must be unique');

      const kinds = new Set(ops.map((o) => o.objectiveKind));
      for (const k of ['CAPTURE_FLAG', 'FLAG_TRAVERSE', 'SPY_HUNT', 'SURVIVAL_DEFENSE', 'BLITZ_BREACH']) {
        assert.ok(kinds.has(k), `Missing objective kind ${k}`);
      }
    }
  );

  register(
    { id: 'T1-F04-2', tier: 1, feature: 'F4', mode: 'NODE', title: 'startOperation initializes every operation cleanly with masked enemy ranks' },
    async () => {
      const opsMod = await loadSrcModule('src/core/operations.ts');
      const store = new GameStore();
      requireCapability(
        typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length,
        'M1',
        'F4',
        'GameStore.startOperation() not yet implemented'
      );
      try {
        for (const op of opsMod.TACTICAL_OPERATIONS) {
          assert.equal((store as any).startOperation(op.id), true, `Failed starting ${op.id}`);
          const view = store.getVisibleView();
          assert.equal(view.matchMode, 'OPERATION');
          assert.ok(view.phase === 'PLAY' || view.phase === 'DEPLOY');
          const pPieces = view.pieces.filter((p) => p.faction === 'PLAYER');
          const ePieces = view.pieces.filter((p) => p.faction === 'ENEMY');
          assert.equal(pPieces.length, op.playerPlacements.length);
          assert.equal(ePieces.length, op.enemyPlacements.length);
          assert.ok(ePieces.every((e) => e.visibleRank === 'UNKNOWN'));
        }
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F04-3', tier: 1, feature: 'F4', mode: 'NODE', title: 'Completing an Operation awards 1..3 star rating and persists progress' },
    async () => {
      const opsMod = await loadSrcModule('src/core/operations.ts');
      const store = new GameStore();
      requireCapability(
        typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length,
        'M1',
        'F4',
        'GameStore.startOperation() not yet implemented'
      );
      try {
        const op = opsMod.getTacticalOperation('OP_03_MIDNIGHT_TRAVERSE');
        assert.ok(op, 'OP_03_MIDNIGHT_TRAVERSE missing');
        const enemyPool: Partial<Record<RankId, number>> = {};
        for (const ep of op.enemyPlacements) {
          enemyPool[ep.rank as RankId] = (enemyPool[ep.rank as RankId] ?? 0) + 1;
        }

        const trialSeeds = [
          0x1000 + 2 * 7919,
          0x1000 + 4 * 7919,
          0x1000 + 0 * 7919,
          0x1000 + 1 * 7919,
          0x1000 + 3 * 7919,
          0x1000 + 5 * 7919,
        ];
        let winningEndView: ReturnType<GameStore['getVisibleView']> | null = null;

        for (const seed of trialSeeds) {
          resetMockStorage();
          const endView = withDeterministicOperationEnv(seed, (flushAiTimers) => {
            store.updateOptions({ clockPreset: 'UNTIMED' });
            assert.equal((store as any).startOperation('OP_03_MIDNIGHT_TRAVERSE'), true);

            const pAI = new BeliefMatrixAI();
            const initV = store.getVisibleView();
            pAI.initializeMatch(
              initV.pieces
                .filter((p) => p.faction === 'ENEMY')
                .map((p) => ({ id: p.id, col: p.col, row: p.row })),
              initV.pieces
                .filter((p) => p.faction === 'PLAYER')
                .map((p) => ({
                  id: p.id,
                  ownRank: p.visibleRank as RankId,
                  col: p.col,
                  row: p.row,
                  hasMoved: p.hasMoved,
                })),
              enemyPool
            );

            let guard = 0;
            while (store.getVisibleView().phase === 'PLAY' && guard < op.turnLimit + 10) {
              guard += 1;
              const v = store.getVisibleView();
              if (v.activeTurn === 'PLAYER') {
                const own: AIOwnUnitState[] = v.pieces
                  .filter((p) => p.alive && p.faction === 'PLAYER')
                  .map((p) => ({
                    id: p.id,
                    ownRank: p.visibleRank as RankId,
                    col: p.col,
                    row: p.row,
                    hasMoved: p.hasMoved,
                  }));
                const opp: ObservedPlayerUnitState[] = v.pieces
                  .filter((p) => p.alive && p.faction === 'ENEMY')
                  .map((p) => ({
                    id: p.id,
                    col: p.col,
                    row: p.row,
                    publicKills: p.publicKills,
                    hasMoved: p.hasMoved,
                  }));

                let chosen: { pieceId: string; toCol: number; toRow: number } | null = null;
                const pFlag = own.find((u) => u.ownRank === 'FLAG');
                if (pFlag) {
                  const ms = store.computeValidMoves(pFlag.id);
                  const winStep = ms.find((m) => m.kind === 'MOVE' && m.row === 0);
                  if (winStep) {
                    chosen = { pieceId: pFlag.id, toCol: winStep.col, toRow: winStep.row };
                  } else {
                    const upSafe = ms.find(
                      (m) =>
                        m.kind === 'MOVE' &&
                        m.row < pFlag.row &&
                        !opp.some((e) => Math.abs(e.col - m.col) + Math.abs(e.row - m.row) <= 1)
                    );
                    if (upSafe) {
                      chosen = { pieceId: pFlag.id, toCol: upSafe.col, toRow: upSafe.row };
                    }
                  }
                }

                if (!chosen) {
                  const dec = pAI.chooseCommanderMove(own, opp, 'VANCE', v.turnCount, {
                    difficulty: 'SUPREME_MARSHAL',
                    eraMode: op.eraRuleset,
                    aiFaction: 'PLAYER',
                  });
                  if (!dec) break;
                  chosen = dec;
                }

                const mover = own.find((u) => u.id === chosen!.pieceId)!;
                pAI.recordOwnMoveOrigin(mover.id, { col: mover.col, row: mover.row });
                const res = store.executeMoveOrChallenge(chosen.toCol, chosen.toRow, chosen.pieceId);
                if (res?.kind === 'CLASH') {
                  const clash = res.verdict;
                  store.finalizeActiveClash();
                  if (store.getVisibleView().phase === 'PLAY') {
                    const out =
                      clash.resolution === 'MUTUAL_SPLIT'
                        ? 'SPLIT'
                        : clash.survivorFaction === 'PLAYER'
                          ? 'AI_WON'
                          : 'AI_LOST';
                    pAI.recordClashOutcome(clash.enemyPieceId, mover.id, mover.ownRank, out, v.turnCount);
                  }
                }
              } else {
                const beforePieces = v.pieces;
                flushAiTimers();
                const vAfter = store.getVisibleView();
                if (vAfter.activeClash) {
                  const clash = vAfter.activeClash;
                  const pPiece = beforePieces.find((p) => p.id === clash.playerPieceId);
                  store.finalizeActiveClash();
                  if (store.getVisibleView().phase === 'PLAY' && pPiece) {
                    const out =
                      clash.resolution === 'MUTUAL_SPLIT'
                        ? 'SPLIT'
                        : clash.survivorFaction === 'PLAYER'
                          ? 'AI_WON'
                          : 'AI_LOST';
                    pAI.recordClashOutcome(
                      clash.enemyPieceId,
                      pPiece.id,
                      pPiece.visibleRank as RankId,
                      out,
                      vAfter.turnCount
                    );
                  }
                }
              }
            }
            return store.getVisibleView();
          });

          if (endView.phase === 'GAME_OVER' && endView.matchWinner === 'PLAYER') {
            winningEndView = endView;
            break;
          }
          store.returnToTitleMenu();
        }

        assert.ok(winningEndView, 'Expected OP_03_MIDNIGHT_TRAVERSE to finish with PLAYER victory in GameStore');
        assert.equal(winningEndView.phase, 'GAME_OVER');
        assert.equal(winningEndView.matchWinner, 'PLAYER');
        assert.equal(winningEndView.dossier?.playerWon, true);
        assert.equal(winningEndView.dossier?.operationId, 'OP_03_MIDNIGHT_TRAVERSE');
        assert.ok(
          (winningEndView.dossier?.starsEarned ?? 0) >= 1 &&
            (winningEndView.dossier?.starsEarned ?? 0) <= 3,
          `Expected 1..3 stars earned, got ${winningEndView.dossier?.starsEarned}`
        );

        const reloaded = opsMod.loadOperationProgress();
        assert.equal(reloaded['OP_03_MIDNIGHT_TRAVERSE'].completed, true);
        assert.equal(reloaded['OP_03_MIDNIGHT_TRAVERSE'].bestStars, winningEndView.dossier!.starsEarned);
        assert.equal(reloaded['OP_03_MIDNIGHT_TRAVERSE'].bestTurns, winningEndView.turnCount);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T1-F04-4', tier: 1, feature: 'F4', mode: 'NODE', title: 'SURVIVAL_DEFENSE operation awards victory after surviving turnLimit' },
    async () => {
      const opsMod = await loadSrcModule('src/core/operations.ts');
      const store = new GameStore();
      requireCapability(
        typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length,
        'M1',
        'F4',
        'GameStore.startOperation() not yet implemented'
      );
      try {
        const op = opsMod.getTacticalOperation('OP_04_BUNKER_SIEGE');
        assert.equal(op.objectiveKind, 'SURVIVAL_DEFENSE');

        const endView = withDeterministicOperationEnv(0x404040, (flushAiTimers) => {
          store.updateOptions({ clockPreset: 'UNTIMED' });
          assert.equal((store as any).startOperation('OP_04_BUNKER_SIEGE'), true);
          assert.equal(store.getVisibleView().matchMode, 'OPERATION');

          let guard = 0;
          while (store.getVisibleView().phase === 'PLAY' && guard < op.turnLimit + 10) {
            guard += 1;
            const v = store.getVisibleView();
            if (v.activeTurn === 'PLAYER') {
              const gen3 = v.pieces.find((u) => u.alive && u.faction === 'PLAYER' && u.visibleRank === 'GEN_3');
              const mvs = gen3 ? store.computeValidMoves(gen3.id).filter((m) => m.kind === 'MOVE') : [];
              const pick = mvs.find((m) => m.col > gen3!.col) ?? mvs.find((m) => m.row >= 6) ?? mvs[0];
              if (gen3 && pick) {
                store.selectPiece(gen3.id);
                const res = store.executeMoveOrChallenge(pick.col, pick.row, gen3.id);
                if (res?.kind === 'CLASH') store.finalizeActiveClash();
              } else {
                const p = v.pieces.find(
                  (u) => u.alive && u.faction === 'PLAYER' && store.computeValidMoves(u.id).length > 0
                );
                assert.ok(p, 'Expected at least one legal PLAYER move during OP_04_BUNKER_SIEGE');
                const mv = store.computeValidMoves(p.id)[0]!;
                store.selectPiece(p.id);
                const res = store.executeMoveOrChallenge(mv.col, mv.row, p.id);
                if (res?.kind === 'CLASH') store.finalizeActiveClash();
              }
            } else {
              flushAiTimers();
              if (store.getVisibleView().activeClash) {
                store.finalizeActiveClash();
              }
            }
          }
          return store.getVisibleView();
        });

        assert.equal(endView.phase, 'GAME_OVER');
        assert.equal(endView.matchWinner, 'PLAYER');
        assert.equal(endView.banner, 'SIEGE SURVIVED — VICTORY');
        assert.equal(endView.dossier?.playerWon, true);
        assert.ok((endView.dossier?.starsEarned ?? 0) >= 1);
        assert.equal(endView.turnCount, op.turnLimit + 1);
        assert.equal(opsMod.loadOperationProgress()['OP_04_BUNKER_SIEGE'].completed, true);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F5: Upgraded Campaign, Formations & AI (T1-F05-1 .. T1-F05-4)
  // =========================================================================
  register(
    { id: 'T1-F05-1', tier: 1, feature: 'F5', mode: 'NODE', title: 'At least 8 player formations exist and pass validatePlayerDeployment' },
    () => {
      const presetIds = Object.keys(TOURNAMENT_PRESETS) as Array<keyof typeof TOURNAMENT_PRESETS>;
      assert.ok(presetIds.length >= 8, `Expected >= 8 presets, got ${presetIds.length}`);
      for (const id of presetIds) {
        const slots = TOURNAMENT_PRESETS[id];
        assert.equal(slots.length, ARMY_PIECE_TOTAL);
        assert.equal(validatePlayerDeployment(slots), true, `Preset ${id} failed validation`);
      }
    }
  );

  register(
    { id: 'T1-F05-2', tier: 1, feature: 'F5', mode: 'NODE', title: 'Campaign progression unlocks Tier 2, awards medal, and persists bestTurns' },
    () => {
      const initial = loadCampaignProgress();
      assert.equal(initial.unlockedTier, 1);

      const store = new GameStore();
      try {
        assert.equal(store.startCampaignTier('MERCER'), false);
        assert.equal(store.startCampaignTier('MILLER'), true);
      } finally {
        store.returnToTitleMenu();
      }

      const res = recordCampaignMatchResult('MILLER', true, 18);
      assert.equal(res.newlyEarnedMedal, 'Academy Merit Star');
      assert.equal(res.state.unlockedTier, 2);
      assert.equal(res.state.records.MILLER.bestTurns, 18);

      const reloaded = loadCampaignProgress();
      assert.equal(reloaded.unlockedTier, 2);
      assert.equal(reloaded.records.MILLER.medalEarned, true);
    }
  );

  register(
    { id: 'T1-F05-3', tier: 1, feature: 'F5', mode: 'NODE', title: 'All 6 Commanders produce distinct valid setups and legal moves' },
    () => {
      assert.equal(COMMANDER_ROSTER.length, 6);
      const setups = new Map<CommanderId, DeploymentSlot[]>();
      const playerSlots = TOURNAMENT_PRESETS.VACCINATION;

      for (const cmd of COMMANDER_ROSTER) {
        const enemySlots = generateCommanderDeployment(cmd.id);
        assert.equal(validateFactionDeployment('ENEMY', enemySlots), true, `${cmd.id} invalid setup`);
        setups.set(cmd.id, enemySlots);

        const ai = new BeliefMatrixAI();
        const pInit = playerSlots.map((s, idx) => ({ id: `p_${idx}`, col: s.col, row: s.row }));
        const aiUnits: AIOwnUnitState[] = enemySlots.map((s, idx) => ({
          id: `e_${idx}`,
          ownRank: s.rank,
          col: s.col,
          row: s.row,
          hasMoved: false,
        }));
        const obsP: ObservedPlayerUnitState[] = playerSlots.map((s, idx) => ({
          id: `p_${idx}`,
          col: s.col,
          row: s.row,
          publicKills: 0,
          hasMoved: false,
        }));
        ai.initializeMatch(pInit, aiUnits);
        const move = ai.chooseCommanderMove(aiUnits, obsP, cmd.id, 1, {
          difficulty: 'GENERAL',
          eraMode: '1980s',
        });
        assert.ok(move, `${cmd.id} returned null move on open board`);
        const unit = aiUnits.find((u) => u.id === move.pieceId)!;
        assert.ok(unit);
        assert.equal(Math.abs(unit.col - move.toCol) + Math.abs(unit.row - move.toRow), 1);
      }
    }
  );

  register(
    { id: 'T1-F05-4', tier: 1, feature: 'F5', mode: 'NODE', title: 'Doctrine divergence: Vance spearhead vs Sterling safety and Hollis adaptation' },
    () => {
      const pSlots = TOURNAMENT_PRESETS.VACCINATION;
      const pInit = pSlots.map((s, idx) => ({ id: `p_${idx}`, col: s.col, row: s.row }));
      const obsP: ObservedPlayerUnitState[] = pSlots.map((s, idx) => ({
        id: `p_${idx}`,
        col: s.col,
        row: s.row,
        publicKills: 0,
        hasMoved: false,
      }));

      // Shared symmetric Enemy army with GEN_5/GEN_4 at Row 2 and Flag at (1,0)
      const sharedEnemy: AIOwnUnitState[] = [
        { id: 'e_flag', ownRank: 'FLAG', col: 1, row: 0, hasMoved: false },
        { id: 'e_pvt1', ownRank: 'PRIVATE', col: 0, row: 0, hasMoved: false },
        { id: 'e_pvt2', ownRank: 'PRIVATE', col: 2, row: 0, hasMoved: false },
        { id: 'e_col', ownRank: 'COLONEL', col: 1, row: 1, hasMoved: false },
        { id: 'e_gen5', ownRank: 'GEN_5', col: 4, row: 2, hasMoved: false },
        { id: 'e_gen4', ownRank: 'GEN_4', col: 5, row: 2, hasMoved: false },
        { id: 'e_gen3', ownRank: 'GEN_3', col: 3, row: 2, hasMoved: false },
      ];

      let vanceTopGenAdvances = 0;
      let sterlingTopGenAdvances = 0;
      for (let i = 0; i < 6; i++) {
        const vAi = new BeliefMatrixAI();
        vAi.initializeMatch(pInit, sharedEnemy);
        const vMove = vAi.chooseCommanderMove(sharedEnemy, obsP, 'VANCE', 2, {
          difficulty: 'GENERAL',
          rng: () => 0.5,
        });
        if (vMove && (vMove.pieceId === 'e_gen5' || vMove.pieceId === 'e_gen4' || vMove.pieceId === 'e_gen3') && vMove.toRow === 3) {
          vanceTopGenAdvances += 1;
        }

        const sAi = new BeliefMatrixAI();
        sAi.initializeMatch(pInit, sharedEnemy);
        const sMove = sAi.chooseCommanderMove(sharedEnemy, obsP, 'STERLING', 2, {
          difficulty: 'GENERAL',
          rng: () => 0.5,
        });
        if (sMove && (sMove.pieceId === 'e_gen5' || sMove.pieceId === 'e_gen4' || sMove.pieceId === 'e_gen3') && sMove.toRow === 3) {
          sterlingTopGenAdvances += 1;
        }
      }
      assert.ok(
        vanceTopGenAdvances >= sterlingTopGenAdvances,
        `Vance (${vanceTopGenAdvances}) should advance Generals >= Sterling (${sterlingTopGenAdvances})`
      );

      // Hollis tendency adaptation: feed 4 left-wing blitz deployments -> Flag moves to right wing (col >= 5)
      const leftBlitzSlots = TOURNAMENT_PRESETS.SILENT_CORRIDOR;
      for (let m = 0; m < 4; m++) {
        recordPostMatchPlayerTendencies(leftBlitzSlots);
      }
      const hollisSetup = generateCommanderDeployment('HOLLIS', undefined, () => 0.5);
      const hollisFlag = hollisSetup.find((s) => s.rank === 'FLAG')!;
      assert.ok(hollisFlag.col >= 5, `Expected Hollis Flag on right wing vs left blitz, got col=${hollisFlag.col}`);
    }
  );

  // =========================================================================
  // F6: SettingsStore Extensions (T1-F06-1 .. T1-F06-4)
  // =========================================================================
  register(
    { id: 'T1-F06-1', tier: 1, feature: 'F6', mode: 'NODE', title: 'Fresh SettingsStore defaults match M1 contract' },
    () => {
      const s = new SettingsStore();
      const opts = s.get();
      assert.equal(opts.eraMode, '1980s');
      assert.equal(opts.qualityMode, 'AUTO');
      assert.equal(opts.viewportFrameMode, 'FULL_VIEWPORT');
      assert.equal(opts.theaterId, 'FIELD_HQ');
      assert.equal(opts.clockPreset, 'STANDARD');
    }
  );

  register(
    { id: 'T1-F06-2', tier: 1, feature: 'F6', mode: 'NODE', title: 'SettingsStore persists qualityMode, viewportFrameMode, theaterId, camera prefs' },
    () => {
      const s1 = new SettingsStore();
      s1.update({
        qualityMode: 'BALANCED',
        viewportFrameMode: 'PHONE_9_16',
        theaterId: 'NIGHT_OPS',
        cameraSensitivity: 1.55,
        cameraInvertOrbit: true,
      });

      const s2 = new SettingsStore();
      const loaded = s2.get();
      assert.equal(loaded.qualityMode, 'BALANCED');
      assert.equal(loaded.viewportFrameMode, 'PHONE_9_16');
      assert.equal(loaded.theaterId, 'NIGHT_OPS');
      assert.equal(loaded.cameraSensitivity, 1.55);
      assert.equal(loaded.cameraInvertOrbit, true);
    }
  );

  register(
    { id: 'T1-F06-3', tier: 1, feature: 'F6', mode: 'NODE', title: 'SettingsStore.subscribe fires immediately, on update, and unsubscribes cleanly' },
    () => {
      const s = new SettingsStore();
      const seen: TheaterId[] = [];
      const unsub = s.subscribe((opts) => seen.push(opts.theaterId));
      assert.deepEqual(seen, ['FIELD_HQ']);

      s.update({ theaterId: 'PACIFIC_BRIDGE' });
      assert.deepEqual(seen, ['FIELD_HQ', 'PACIFIC_BRIDGE']);

      unsub();
      s.update({ theaterId: 'IRON_BUNKER' });
      assert.deepEqual(seen, ['FIELD_HQ', 'PACIFIC_BRIDGE']);
    }
  );

  register(
    { id: 'T1-F06-4', tier: 1, feature: 'F6', mode: 'NODE', title: 'GameStore.updateOptions switches BLITZ, STANDARD, and UNTIMED clocks' },
    () => {
      const store = new GameStore();
      try {
        store.startSkirmish('MILLER', '1980s');
        store.applyDeploymentPreset('VACCINATION');
        store.launchBattleFromDeployment();

        store.updateOptions({ clockPreset: 'BLITZ' });
        let v = store.getVisibleView();
        assert.equal(v.matchClockSec, CLOCK_PRESET_SPECS.BLITZ.matchSec);
        assert.equal(v.turnClockSec, CLOCK_PRESET_SPECS.BLITZ.turnSec);
        assert.equal(v.isUntimed, false);

        store.updateOptions({ clockPreset: 'UNTIMED' });
        v = store.getVisibleView();
        assert.equal(v.isUntimed, true);

        store.updateOptions({ clockPreset: 'STANDARD' });
        v = store.getVisibleView();
        assert.equal(v.isUntimed, false);
        assert.equal(v.matchClockSec, CLOCK_PRESET_SPECS.STANDARD.matchSec);
        assert.equal(v.turnClockSec, CLOCK_PRESET_SPECS.STANDARD.turnSec);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F8: Sculpted 3D Rank Emblems — ASSET Checks (T1-F08-1 .. T1-F08-2)
  // =========================================================================
  register(
    { id: 'T1-F08-1', tier: 1, feature: 'F8', mode: 'ASSET', title: 'ref_rank_symbols_4x4.jpg removed and unreferenced in src/**' },
    () => {
      const m2RanksLanded =
        fs.existsSync(path.join(rootDir, 'public/ranks')) &&
        fs.existsSync(path.join(rootDir, 'src/graphics/QualityGovernor.ts'));
      requireCapability(
        m2RanksLanded,
        'M2',
        'F8',
        'M2 sculpted 3D rank emblems refactor not yet landed in EmblemFactory.ts'
      );

      const refTex = path.join(rootDir, 'public/textures/ref_rank_symbols_4x4.jpg');
      assert.equal(fs.existsSync(refTex), false, 'public/textures/ref_rank_symbols_4x4.jpg must be deleted');

      const srcFiles = collectFilesRecursive(path.join(rootDir, 'src'));
      for (const f of srcFiles) {
        const text = fs.readFileSync(f, 'utf8');
        assert.equal(
          text.includes('ref_rank_symbols_4x4'),
          false,
          `Found banned reference to ref_rank_symbols_4x4 in ${path.relative(rootDir, f)}`
        );
      }
    }
  );

  register(
    { id: 'T1-F08-2', tier: 1, feature: 'F8', mode: 'ASSET', title: 'EmblemFactory.ts builds 3D beveled geometry instead of PlaneGeometry cutouts' },
    () => {
      const m2RanksLanded =
        fs.existsSync(path.join(rootDir, 'public/ranks')) &&
        fs.existsSync(path.join(rootDir, 'src/graphics/QualityGovernor.ts'));
      requireCapability(m2RanksLanded, 'M2', 'F8', 'M2 sculpted 3D rank emblems not yet landed in EmblemFactory.ts');

      const emblemPath = path.join(rootDir, 'src/graphics/EmblemFactory.ts');
      const emblemSrc = fs.readFileSync(emblemPath, 'utf8');
      assert.equal(emblemSrc.includes('PlaneGeometry'), false, 'PlaneGeometry atlas cutouts banned in EmblemFactory.ts');
      assert.ok(
        emblemSrc.includes('ExtrudeGeometry') ||
          emblemSrc.includes('LatheGeometry') ||
          emblemSrc.includes('CylinderGeometry') ||
          emblemSrc.includes('bevelEnabled'),
        'EmblemFactory.ts must construct 3D sculpted beveled geometry'
      );
    }
  );

  // =========================================================================
  // F9: Zero Placeholders & 3D Props Upgrade — ASSET Checks (T1-F09-1 .. T1-F09-3)
  // =========================================================================
  register(
    { id: 'T1-F09-1', tier: 1, feature: 'F9', mode: 'ASSET', title: 'Zero MeshBasicMaterial on physical 3D scene props in MeshFactory & ArbiterStage3D' },
    () => {
      const m2Landed =
        fs.existsSync(path.join(rootDir, 'src/graphics/QualityGovernor.ts')) &&
        fs.existsSync(path.join(rootDir, 'public/portraits'));
      requireCapability(m2Landed, 'M2', 'F9', 'M2 physical 3D prop upgrade not yet landed in MeshFactory.ts');

      const meshSrc = fs.readFileSync(path.join(rootDir, 'src/graphics/MeshFactory.ts'), 'utf8');
      const allowedFxVars = new Set([
        'wedgeAoMat',
        'aoPad',
        'aceHaloMat',
        'padMat',
        'haloMat',
        'holoMat',
        'shellMat',
        'pipMat',
      ]);
      const bannedPropPatterns = [
        'sconceGlowMat',
        'lanternFlameMat',
        'flameCore',
        'tentBackdropMat',
        'cycMesh',
      ];
      const regex = /new\s+THREE\.MeshBasicMaterial\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(meshSrc)) !== null) {
        const idx = match.index;
        const rawPrefix = meshSrc.slice(Math.max(0, idx - 180), idx);
        const lastSemi = rawPrefix.lastIndexOf(';');
        const stmtPrefix = lastSemi >= 0 ? rawPrefix.slice(lastSemi + 1) : rawPrefix;
        const optionsSlice = meshSrc.slice(idx, Math.min(meshSrc.length, idx + 320));

        for (const banned of bannedPropPatterns) {
          assert.equal(
            stmtPrefix.includes(banned),
            false,
            `Banned MeshBasicMaterial on physical prop (${banned}) in MeshFactory.ts`
          );
        }
        const assignedName = Array.from(allowedFxVars).find((v) => stmtPrefix.includes(v));
        assert.ok(
          assignedName,
          `Disallowed MeshBasicMaterial in MeshFactory.ts near: ${stmtPrefix.trim().slice(-60)}`
        );
        if (assignedName !== 'pipMat') {
          assert.ok(
            optionsSlice.includes('transparent: true') &&
              (optionsSlice.includes('AdditiveBlending') || optionsSlice.includes('depthWrite: false')),
            `Allowlisted FX MeshBasicMaterial (${assignedName}) must remain transparent AO/additive FX`
          );
        }
      }
    }
  );

  register(
    { id: 'T1-F09-2', tier: 1, feature: 'F9', mode: 'ASSET', title: 'Zero raw BoxGeometry used for war maps, watch second hand, or cabinet base' },
    () => {
      const m2Landed =
        fs.existsSync(path.join(rootDir, 'src/graphics/QualityGovernor.ts')) &&
        fs.existsSync(path.join(rootDir, 'public/portraits'));
      requireCapability(m2Landed, 'M2', 'F9', 'M2 sculpted war maps/watch/cabinet upgrade not yet landed');

      const meshSrc = fs.readFileSync(path.join(rootDir, 'src/graphics/MeshFactory.ts'), 'utf8');
      const boxMatches = meshSrc.match(/new\s+THREE\.BoxGeometry\s*\(/g) ?? [];
      assert.equal(boxMatches.length, 0, `Found ${boxMatches.length} raw BoxGeometry usages in MeshFactory.ts`);
    }
  );

  register(
    { id: 'T1-F09-3', tier: 1, feature: 'F9', mode: 'ASSET', title: 'All 5 baked .glb models exist in public/models/ with valid glTF header > 10KB' },
    () => {
      const requiredModels = [
        'board_cabinet.glb',
        'warfield_arena.glb',
        'war_room_table.glb',
        'command_wedge.glb',
        'pocket_watch.glb',
      ];
      for (const name of requiredModels) {
        const full = path.join(rootDir, 'public', 'models', name);
        assert.equal(fs.existsSync(full), true, `Missing model public/models/${name}`);
        const stat = fs.statSync(full);
        assert.ok(stat.size > 10 * 1024, `Model ${name} too small (${stat.size} bytes)`);
        const fd = fs.openSync(full, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        assert.equal(buf.toString('ascii'), 'glTF', `Model ${name} lacks valid glTF magic header`);
      }
    }
  );

  // =========================================================================
  // F10: Ultra-HD Rendered Art Assets — ASSET Checks (T1-F10-1 .. T1-F10-3)
  // =========================================================================
  register(
    { id: 'T1-F10-1', tier: 1, feature: 'F10', mode: 'ASSET', title: 'Rendered commander portraits exist for all 6 commanders and zero inline SVG doodles' },
    () => {
      const portraitsDir = path.join(rootDir, 'public', 'portraits');
      requireCapability(
        fs.existsSync(portraitsDir),
        'M2',
        'F10',
        'M2 rendered portraits in public/portraits/ not yet landed'
      );

      for (const cmd of COMMANDER_ROSTER) {
        const lower = cmd.id.toLowerCase();
        const hasAsset =
          fs.existsSync(path.join(portraitsDir, `${lower}.webp`)) ||
          fs.existsSync(path.join(portraitsDir, `${lower}.png`)) ||
          fs.existsSync(path.join(portraitsDir, `${lower}.jpg`));
        assert.equal(hasAsset, true, `Missing portrait image for commander ${cmd.id} in public/portraits/`);
      }

      const cmdSrc = fs.readFileSync(path.join(rootDir, 'src/ai/CommanderProfiles.ts'), 'utf8');
      const m5Landed = fs.existsSync(path.join(rootDir, 'src/arbiter/BattleChoreographies.ts'));
      if (m5Landed || !cmdSrc.includes('buildCommanderPortraitSvg')) {
        assert.equal(cmdSrc.includes('<svg'), false, 'Inline <svg> portrait strings must be removed from CommanderProfiles.ts');
      } else {
        requireCapability(
          false,
          'M5',
          'F10',
          'M5 removal of inline <svg> portrait fallback in CommanderProfiles.ts not yet landed'
        );
      }
    }
  );

  register(
    { id: 'T1-F10-2', tier: 1, feature: 'F10', mode: 'ASSET', title: 'Rendered rank insignia chips exist for all 15 ranks and manifest uses raster icon PNGs' },
    () => {
      const ranksDir = path.join(rootDir, 'public', 'ranks');
      requireCapability(fs.existsSync(ranksDir), 'M2', 'F10', 'public/ranks/ directory not yet created in M2');

      for (const rank of ORDERED_RANKS) {
        const lower = rank.toLowerCase();
        const hasRankImg =
          fs.existsSync(path.join(ranksDir, `${lower}.webp`)) ||
          fs.existsSync(path.join(ranksDir, `${lower}.png`)) ||
          fs.existsSync(path.join(ranksDir, `${rank}.webp`)) ||
          fs.existsSync(path.join(ranksDir, `${rank}.png`));
        assert.equal(hasRankImg, true, `Missing rank chip asset for ${rank} in public/ranks/`);
      }

      const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'manifest.json'), 'utf8'));
      const icons: Array<{ src: string }> = manifest.icons || [];
      assert.ok(icons.length >= 1);
      assert.equal(
        icons.some((ic) => ic.src.endsWith('.svg')),
        false,
        'manifest.json must reference raster icon*.png instead of icon.svg'
      );
      for (const ic of icons) {
        const clean = ic.src.replace(/^\.\//, '');
        assert.equal(fs.existsSync(path.join(rootDir, 'public', clean)), true, `Manifest icon missing: ${ic.src}`);
      }
    }
  );

  register(
    { id: 'T1-F10-3', tier: 1, feature: 'F10', mode: 'ASSET', title: 'No orphaned unused textures remain in public/textures/' },
    () => {
      const m2RanksLanded =
        fs.existsSync(path.join(rootDir, 'public/ranks')) &&
        fs.existsSync(path.join(rootDir, 'src/graphics/QualityGovernor.ts'));
      requireCapability(m2RanksLanded, 'M2', 'F10', 'M2 texture cleanup not yet landed');

      const texDir = path.join(rootDir, 'public', 'textures');
      const texFiles = fs.readdirSync(texDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      const srcContent = collectFilesRecursive(path.join(rootDir, 'src'))
        .map((p) => fs.readFileSync(p, 'utf8'))
        .join('\n');

      for (const f of texFiles) {
        assert.ok(srcContent.includes(f), `Orphaned unused texture in public/textures/: ${f}`);
      }
    }
  );

  // =========================================================================
  // F11: Multiple 3D Battle Theaters (T1-F11-1)
  // =========================================================================
  register(
    { id: 'T1-F11-1', tier: 1, feature: 'F11', mode: 'NODE', title: 'BATTLE_THEATERS exports all 4 unique theater specs' },
    async () => {
      const mod = await loadSrcModule('src/core/theaters.ts');
      requireCapability(mod?.BATTLE_THEATERS, 'M1', 'F11', 'src/core/theaters.ts not found');
      const theaters = mod.BATTLE_THEATERS as any[];
      assert.equal(theaters.length, 4);

      const expectedIds = new Set(['FIELD_HQ', 'PACIFIC_BRIDGE', 'IRON_BUNKER', 'NIGHT_OPS']);
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();
      const seenStyles = new Set<string>();

      for (const t of theaters) {
        assert.ok(expectedIds.has(t.id), `Unexpected theater id ${t.id}`);
        seenIds.add(t.id);
        seenNames.add(t.name);
        seenStyles.add(t.propAccentStyle);
        assert.ok(typeof t.fogHex === 'string' && t.fogHex.startsWith('#'));
        assert.ok(typeof t.keyLightHex === 'string' && t.keyLightHex.startsWith('#'));
        assert.ok(typeof t.cabinetTintHex === 'string' && t.cabinetTintHex.startsWith('#'));
      }
      assert.equal(seenIds.size, 4);
      assert.equal(seenNames.size, 4);
      assert.equal(seenStyles.size, 4);
    }
  );

  // =========================================================================
  // F12: Dynamic Quality Governor (T1-F12-1 .. T1-F12-3)
  // =========================================================================
  register(
    { id: 'T1-F12-1', tier: 1, feature: 'F12', mode: 'NODE', title: 'QualityGovernor exports required API and supports all 5 QualityTiers' },
    async () => {
      const mod = await loadSrcModule('src/graphics/QualityGovernor.ts');
      requireCapability(mod?.QualityGovernor, 'M2', 'F12', 'src/graphics/QualityGovernor.ts not yet implemented');

      const gov = new mod.QualityGovernor();
      assert.equal(typeof gov.probeCapabilities, 'function');
      assert.equal(typeof gov.setRequestedMode, 'function');
      assert.equal(typeof gov.recordFrameDt, 'function');
      assert.equal(typeof gov.getActiveProfile, 'function');

      const modes: QualityTier[] = ['AUTO', 'ULTRA', 'HIGH', 'BALANCED', 'BATTERY_SAVER'];
      for (const m of modes) {
        gov.setRequestedMode(m);
        const prof = gov.getActiveProfile();
        assert.equal(prof.requestedMode, m);
        assert.ok(['ULTRA', 'HIGH', 'BALANCED', 'BATTERY_SAVER'].includes(prof.resolvedTier));
      }
    }
  );

  register(
    { id: 'T1-F12-2', tier: 1, feature: 'F12', mode: 'NODE', title: 'BATTERY_SAVER disables lantern shadow and DoF with 30 FPS target' },
    async () => {
      const mod = await loadSrcModule('src/graphics/QualityGovernor.ts');
      requireCapability(mod?.QualityGovernor, 'M2', 'F12', 'src/graphics/QualityGovernor.ts not yet implemented');

      const gov = new mod.QualityGovernor();
      gov.setRequestedMode('BATTERY_SAVER');
      const prof = gov.getActiveProfile();
      assert.equal(prof.resolvedTier, 'BATTERY_SAVER');
      assert.equal(prof.enableLanternShadow, false);
      assert.equal(prof.enableDoF, false);
      assert.equal(prof.targetFps, 30);
      assert.ok(prof.dprCap <= 1.5);
    }
  );

  register(
    { id: 'T1-F12-3', tier: 1, feature: 'F12', mode: 'NODE', title: 'AUTO mode sustains 60 FPS on fast dt and steps down smoothly on slow dt' },
    async () => {
      const mod = await loadSrcModule('src/graphics/QualityGovernor.ts');
      requireCapability(mod?.QualityGovernor, 'M2', 'F12', 'src/graphics/QualityGovernor.ts not yet implemented');

      const gov = new mod.QualityGovernor();
      gov.setRequestedMode('AUTO');
      for (let i = 0; i < 60; i++) {
        gov.recordFrameDt(0.016);
      }
      const fastProf = gov.getActiveProfile();
      assert.ok(fastProf.resolvedTier === 'ULTRA' || fastProf.resolvedTier === 'HIGH');

      const seenTransitions: string[] = [fastProf.resolvedTier];
      for (let i = 0; i < 180; i++) {
        gov.recordFrameDt(0.045);
        const t = gov.getActiveProfile().resolvedTier;
        if (seenTransitions[seenTransitions.length - 1] !== t) {
          seenTransitions.push(t);
        }
      }
      const slowProf = gov.getActiveProfile();
      assert.ok(
        slowProf.resolvedTier === 'BALANCED' || slowProf.resolvedTier === 'BATTERY_SAVER',
        `Expected step-down on 0.045s dt, got ${slowProf.resolvedTier}`
      );
      assert.ok(seenTransitions.length <= 4, `Quality oscillation detected: ${seenTransitions.join(' -> ')}`);
    }
  );

  // =========================================================================
  // F18: Sculpted Arbiter Hardware & FX — ASSET Check (T1-F18-1)
  // =========================================================================
  register(
    { id: 'T1-F18-1', tier: 1, feature: 'F18', mode: 'ASSET', title: 'ArbiterStage3D uses sculpted geometry & PBR materials for CRT, sabot shell, and gauge' },
    () => {
      const src = fs.readFileSync(path.join(rootDir, 'src/arbiter/ArbiterStage3D.ts'), 'utf8');
      const m5Landed = fs.existsSync(path.join(rootDir, 'src/arbiter/BattleChoreographies.ts'));
      requireCapability(m5Landed, 'M5', 'F18', 'M5 BattleChoreographies & sculpted ArbiterStage3D not yet landed');

      // Ensure raw placeholder hardware BoxGeometry/MeshBasicMaterial patterns from pre-M5 are replaced
      assert.equal(src.includes('new THREE.BoxGeometry(0.92, 0.36, 0.04)'), false, 'Raw BoxGeometry CRT housing still present');
      assert.equal(src.includes('new THREE.BoxGeometry(2.6, 0.06, 0.04)'), false, 'Raw BoxGeometry frontline gauge bar still present');
    }
  );

  // =========================================================================
  // F24: AAA Heroic Start Screen & Non-Boxy Sculpted UI — ASSET Check (T1-F24-1)
  // =========================================================================
  register(
    { id: 'T1-F24-1', tier: 1, feature: 'F24', mode: 'ASSET', title: 'Heroic Command Seal asset exists in public/portraits/ with >= 512px size and transparent alpha' },
    () => {
      const portraitsDir = path.join(rootDir, 'public', 'portraits');
      requireCapability(
        fs.existsSync(portraitsDir),
        'M2',
        'F24',
        'M2 rendered portraits in public/portraits/ not yet landed'
      );

      const candidates = [
        path.join(portraitsDir, 'hero_crest.png'),
        path.join(portraitsDir, 'hero_crest.webp'),
      ].filter((p) => fs.existsSync(p));

      assert.ok(
        candidates.length >= 1,
        'Missing rendered hero crest asset: public/portraits/hero_crest.png or public/portraits/hero_crest.webp'
      );

      for (const assetPath of candidates) {
        const name = path.basename(assetPath);
        const stat = fs.statSync(assetPath);
        assert.ok(
          stat.size > 10_000 && stat.size <= 4 * 1024 * 1024,
          `${name} size (${stat.size} bytes) must be > 10_000 and <= 4 MiB`
        );

        const buf = fs.readFileSync(assetPath);
        if (assetPath.endsWith('.png')) {
          assert.ok(buf.length >= 33, `${name} truncated PNG header`);
          const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          assert.equal(buf.subarray(0, 8).equals(pngSig), true, `${name} invalid PNG signature`);
          assert.equal(buf.toString('ascii', 12, 16), 'IHDR', `${name} first PNG chunk must be IHDR`);
          assert.ok(buf.readUInt32BE(8) >= 13, `${name} invalid IHDR length`);

          const width = buf.readUInt32BE(16);
          const height = buf.readUInt32BE(20);
          const colorType = buf[25]!;
          assert.ok(width >= 512 && height >= 512, `${name} dimensions ${width}x${height} must be >= 512x512`);

          let hasTrns = false;
          let offset = 8;
          while (offset + 12 <= buf.length) {
            const chunkLen = buf.readUInt32BE(offset);
            const chunkType = buf.toString('ascii', offset + 4, offset + 8);
            if (chunkType === 'tRNS') {
              hasTrns = true;
              break;
            }
            if (chunkType === 'IEND' || chunkLen > buf.length - offset - 12) {
              break;
            }
            offset += 12 + chunkLen;
          }

          assert.ok(
            colorType === 6 || colorType === 4 || hasTrns,
            `${name} must have transparent alpha channel (colorType=${colorType}, tRNS=${hasTrns})`
          );
        } else {
          assert.ok(buf.length >= 30, `${name} truncated WebP header`);
          assert.equal(buf.toString('ascii', 0, 4), 'RIFF', `${name} missing RIFF header`);
          assert.equal(buf.toString('ascii', 8, 12), 'WEBP', `${name} missing WEBP signature`);

          let width = 0;
          let height = 0;
          let hasAlpha = false;
          let chunkKind = '';
          let offset = 12;

          while (offset + 8 <= buf.length) {
            const chunkId = buf.toString('ascii', offset, offset + 4);
            const chunkSize = buf.readUInt32LE(offset + 4);
            const dataOffset = offset + 8;
            if (dataOffset + chunkSize > buf.length) {
              break;
            }

            if (chunkId === 'VP8X') {
              assert.ok(chunkSize >= 10, `${name} truncated VP8X chunk`);
              const flags = buf[dataOffset]!;
              hasAlpha = (flags & 0x10) !== 0;
              width = 1 + (buf[dataOffset + 4]! | (buf[dataOffset + 5]! << 8) | (buf[dataOffset + 6]! << 16));
              height = 1 + (buf[dataOffset + 7]! | (buf[dataOffset + 8]! << 8) | (buf[dataOffset + 9]! << 16));
              chunkKind = 'VP8X';
              break;
            }
            if (chunkId === 'VP8L') {
              assert.ok(chunkSize >= 5, `${name} truncated VP8L chunk`);
              assert.equal(buf[dataOffset], 0x2f, `${name} invalid VP8L signature byte`);
              const bits = buf.readUInt32LE(dataOffset + 1);
              width = (bits & 0x3fff) + 1;
              height = ((bits >> 14) & 0x3fff) + 1;
              hasAlpha = ((bits >> 28) & 1) === 1;
              chunkKind = 'VP8L';
              break;
            }
            if (chunkId === 'VP8 ') {
              assert.ok(chunkSize >= 10, `${name} truncated VP8 chunk`);
              assert.ok(
                buf[dataOffset + 3] === 0x9d &&
                  buf[dataOffset + 4] === 0x01 &&
                  buf[dataOffset + 5] === 0x2a,
                `${name} missing VP8 keyframe start code`
              );
              width = buf.readUInt16LE(dataOffset + 6) & 0x3fff;
              height = buf.readUInt16LE(dataOffset + 8) & 0x3fff;
              hasAlpha = false;
              chunkKind = 'VP8 ';
              break;
            }

            offset = dataOffset + chunkSize + (chunkSize & 1);
          }

          assert.ok(chunkKind.length > 0, `${name} missing VP8X/VP8L/VP8  header chunk`);
          assert.ok(width >= 512 && height >= 512, `${name} (${chunkKind}) dimensions ${width}x${height} must be >= 512x512`);
          assert.equal(
            hasAlpha,
            true,
            `${name} (${chunkKind}) must carry transparent alpha bit`
          );
        }
      }
    }
  );
}
