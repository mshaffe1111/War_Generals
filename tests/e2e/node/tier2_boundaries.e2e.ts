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
  loadCampaignProgress,
  recordCampaignMatchResult,
} from '../../../src/ai/CommanderProfiles';
import { resolveArbiterChallenge } from '../../../src/arbiter/ArbiterResolver';
import {
  BOARD_COLS,
  BOARD_ROWS,
  ORDERED_RANKS,
  RANK_SPECS,
  type Faction,
  type RankId,
} from '../../../src/core/ranks';
import {
  computePositionRepetitionKey,
  hasAnyLegalMoves,
  loadCustomBlueprintSlots,
  validateFactionDeployment,
  type DeploymentSlot,
} from '../../../src/core/RulesEngine';
import { GameStore } from '../../../src/state/GameStore';
import { SettingsStore } from '../../../src/state/SettingsStore';

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
  for (let i = 0; i < remaining.length; i++) {
    const sq = freeCoords[i]!;
    out.push({ col: sq.col, row: sq.row, rank: remaining[i]! });
  }
  assert.equal(validateFactionDeployment(faction, out), true);
  return out;
}

function deployPassAndPlay(
  store: GameStore,
  navyOverrides: Array<{ col: number; row: number; rank: RankId }>,
  crimsonOverrides: Array<{ col: number; row: number; rank: RankId }>,
  navyEmpty: Array<{ col: number; row: number }> = [],
  crimsonEmpty: Array<{ col: number; row: number }> = []
): void {
  store.startPassAndPlay();
  store.clearPlayerDeployment();
  for (const s of buildCustom21Slots('PLAYER', navyOverrides, navyEmpty)) {
    assert.equal(store.placeOrSwapDeployment(s.col, s.row, s.rank), true);
  }
  assert.equal(store.launchBattleFromDeployment(), true);
  store.unsealCommandShroud();

  store.clearPlayerDeployment();
  for (const s of buildCustom21Slots('ENEMY', crimsonOverrides, crimsonEmpty)) {
    assert.equal(store.placeOrSwapDeployment(s.col, s.row, s.rank), true);
  }
  assert.equal(store.launchBattleFromDeployment(), true);
  store.unsealCommandShroud();
}

function stepMove(store: GameStore, fromCol: number, fromRow: number, toCol: number, toRow: number) {
  let v = store.getVisibleView();
  if (v.shroud?.active) {
    store.unsealCommandShroud();
    v = store.getVisibleView();
  }
  const p = v.pieces.find((u) => u.alive && u.faction === v.activeTurn && u.col === fromCol && u.row === fromRow);
  assert.ok(p, `No ${v.activeTurn} piece at (${fromCol},${fromRow})`);
  store.selectPiece(p.id);
  const res = store.executeMoveOrChallenge(toCol, toRow, p.id);
  assert.ok(res, `Illegal move (${fromCol},${fromRow}) -> (${toCol},${toRow})`);
  return res;
}

function withMockClockIntervals(run: (tickSeconds: (sec: number) => void) => void): void {
  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;
  let nextHandle = 90000;
  const callbacks = new Map<number, () => void>();

  (globalThis as any).setInterval = (cb: () => void, ms?: number) => {
    if (ms === 1000) {
      const h = nextHandle++;
      callbacks.set(h, cb);
      return h;
    }
    return origSetInterval(cb, ms);
  };
  (globalThis as any).clearInterval = (handle: any) => {
    if (typeof handle === 'number' && callbacks.has(handle)) {
      callbacks.delete(handle);
      return;
    }
    return origClearInterval(handle);
  };

  try {
    run((sec: number) => {
      for (let i = 0; i < sec; i++) {
        for (const cb of Array.from(callbacks.values())) {
          cb();
        }
      }
    });
  } finally {
    globalThis.setInterval = origSetInterval;
    globalThis.clearInterval = origClearInterval;
  }
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

export async function registerNodeTests(
  register: (
    meta: { id: string; tier: number; feature: string; mode: string; title: string },
    fn: () => Promise<void> | void
  ) => void,
  deps: NodeTestDeps
): Promise<void> {
  const { rootDir, loadSrcModule, requireCapability } = deps;

  // =========================================================================
  // F1 Boundaries (T2-F01-1 .. T2-F01-4)
  // =========================================================================
  register(
    { id: 'T2-F01-1', tier: 2, feature: 'F1', mode: 'NODE', title: 'ArbiterVerdict handles omitted optional stakes/isFlagTraverseVictory safely' },
    () => {
      const v = resolveArbiterChallenge({
        contestedCoord: { col: 2, row: 3 },
        attackerId: 'p1',
        attackerFaction: 'PLAYER',
        attackerTrueRank: 'MAJOR',
        defenderId: 'e1',
        defenderFaction: 'ENEMY',
        defenderTrueRank: 'PRIVATE',
      });
      assert.equal(v.stakes, undefined);
      assert.equal(v.isFlagTraverseVictory, undefined);
      assert.equal(v.choreography, 'ARMOR_ARTILLERY');
      const roundtrip = JSON.parse(JSON.stringify(v));
      assert.equal(roundtrip.resolution, 'PLAYER_WINS');
      assert.equal(roundtrip.choreography, 'ARMOR_ARTILLERY');
    }
  );

  register(
    { id: 'T2-F01-2', tier: 2, feature: 'F1', mode: 'NODE', title: 'PASS_AND_PLAY resolveArbiterChallenge SPY vs GEN_5 masks both ranks' },
    () => {
      const v = resolveArbiterChallenge({
        contestedCoord: { col: 4, row: 4 },
        attackerId: 'p_spy',
        attackerFaction: 'PLAYER',
        attackerTrueRank: 'SPY',
        defenderId: 'e_gen5',
        defenderFaction: 'ENEMY',
        defenderTrueRank: 'GEN_5',
        matchMode: 'PASS_AND_PLAY',
        attackerPublicKills: 0,
        defenderPublicKills: 0,
      });
      assert.equal(v.resolution, 'PLAYER_WINS');
      assert.equal(v.playerVisibleRank, 'UNKNOWN');
      assert.notEqual(v.choreography, 'RECON_STEALTH');
      assert.notEqual(v.choreography, 'HIGH_COMMAND');
    }
  );

  register(
    { id: 'T2-F01-3', tier: 2, feature: 'F1', mode: 'NODE', title: 'Invalid TheaterId or QualityTier in storage falls back to FIELD_HQ / AUTO' },
    () => {
      localStorage.setItem(
        'war_generals_settings_v1',
        JSON.stringify({ theaterId: 'MOON_BASE', qualityMode: 'POTATO_9000' })
      );
      const settings = new SettingsStore();
      const opts = settings.get();
      assert.equal(opts.theaterId, 'FIELD_HQ');
      assert.equal(opts.qualityMode, 'AUTO');
    }
  );

  register(
    { id: 'T2-F01-4', tier: 2, feature: 'F1', mode: 'NODE', title: 'startOperation rejects unknown operation ID cleanly without corrupting state' },
    async () => {
      const store = new GameStore();
      const opsMod = await loadSrcModule('src/core/operations.ts');
      requireCapability(
        typeof (store as any).startOperation === 'function' && opsMod?.TACTICAL_OPERATIONS?.length,
        'M1',
        'F1',
        'GameStore.startOperation() not yet implemented'
      );
      try {
        const beforePhase = store.getVisibleView().phase;
        assert.equal((store as any).startOperation('NON_EXISTENT_OP_999'), false);
        assert.equal(store.getVisibleView().phase, beforePhase);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F2 Boundaries (T2-F02-1 .. T2-F02-5)
  // =========================================================================
  register(
    { id: 'T2-F02-1', tier: 2, feature: 'F2', mode: 'NODE', title: 'Flag-only turn clock-0 timeout moves Flag or declares defeat with zero softlock' },
    () => {
      withMockClockIntervals((tickSeconds) => {
        const store = new GameStore();
        try {
          store.updateOptions({ eraMode: '1980s', clockPreset: 'BLITZ' });
          // Navy places killers on row 5 (GEN_5, SPY, PRIVATE) and FLAG safe at (0,7)
          // Crimson places FLAG at (8,0), empty (0,2),(8,1) so pieces can advance cleanly into killers
          deployPassAndPlay(
            store,
            [
              { col: 0, row: 7, rank: 'FLAG' },
              { col: 2, row: 5, rank: 'GEN_5' },
              { col: 4, row: 5, rank: 'SPY' },
              { col: 6, row: 5, rank: 'PRIVATE' },
            ],
            [{ col: 8, row: 0, rank: 'FLAG' }],
            [{ col: 0, row: 5 }, { col: 0, row: 6 }],
            [{ col: 7, row: 0 }, { col: 8, row: 1 }]
          );

          // BFS-routed elimination: route each Crimson non-Flag piece to its guaranteed Navy counter on row 5
          // PRIVATE -> (2,5) GEN_5; SPY -> (6,5) PRIVATE; Officer -> (4,5) SPY
          let navyToggle = false;
          let safety = 0;
          while (safety < 320) {
            safety++;
            let v = store.getVisibleView();
            if (v.phase !== 'PLAY') break;
            if (v.shroud?.active) {
              store.unsealCommandShroud();
              v = store.getVisibleView();
            }
            if (v.activeTurn === 'ENEMY') {
              const nonFlags = v.pieces.filter((p) => p.alive && p.faction === 'ENEMY' && p.visibleRank !== 'FLAG');
              if (nonFlags.length === 0) break;

              const occupied = new Map<string, typeof v.pieces[number]>();
              for (const p of v.pieces) {
                if (p.alive) occupied.set(`${p.col},${p.row}`, p);
              }

              let chosenMove: { id: string; col: number; row: number } | null = null;
              // Prioritize pieces closest to row 5
              const sorted = [...nonFlags].sort((a, b) => b.row - a.row);
              for (const unit of sorted) {
                const targetCol = unit.visibleRank === 'PRIVATE' ? 2 : unit.visibleRank === 'SPY' ? 6 : 4;
                const goalKey = `${targetCol},5`;

                // BFS from unit's current square to (targetCol, 5)
                const queue: Array<{ col: number; row: number; firstStep: { col: number; row: number } | null }> = [
                  { col: unit.col, row: unit.row, firstStep: null },
                ];
                const seen = new Set<string>([`${unit.col},${unit.row}`]);
                const dirs = [
                  [0, 1],
                  [-1, 0],
                  [1, 0],
                  [0, -1],
                ];
                while (queue.length > 0) {
                  const cur = queue.shift()!;
                  for (const [dc, dr] of dirs) {
                    const nc = cur.col + dc!;
                    const nr = cur.row + dr!;
                    if (nc < 0 || nc >= BOARD_COLS || nr < 0 || nr >= BOARD_ROWS) continue;
                    const key = `${nc},${nr}`;
                    if (seen.has(key)) continue;
                    const first = cur.firstStep ?? { col: nc, row: nr };
                    if (key === goalKey) {
                      chosenMove = { id: unit.id, col: first.col, row: first.row };
                      break;
                    }
                    if (!occupied.has(key)) {
                      seen.add(key);
                      queue.push({ col: nc, row: nr, firstStep: first });
                    }
                  }
                  if (chosenMove) break;
                }
                if (chosenMove) break;
              }

              // Fallback: if all direct BFS paths to row 5 counters are blocked by friendly row-2 congestion,
              // move any Crimson piece into an empty square closer to row 4
              if (!chosenMove) {
                for (const unit of sorted) {
                  const moves = store.computeValidMoves(unit.id).filter((m) => m.kind === 'MOVE');
                  if (moves.length > 0) {
                    moves.sort((a, b) => b.row - a.row);
                    chosenMove = { id: unit.id, col: moves[0]!.col, row: moves[0]!.row };
                    break;
                  }
                }
              }

              assert.ok(chosenMove, 'Expected legal Crimson move during setup');
              store.selectPiece(chosenMove.id);
              const r = store.executeMoveOrChallenge(chosenMove.col, chosenMove.row, chosenMove.id);
              if (r?.kind === 'CLASH') store.finalizeActiveClash();
            } else {
              const fromR = navyToggle ? 6 : 7;
              const toR = navyToggle ? 7 : 6;
              const nf = v.pieces.find((p) => p.alive && p.faction === 'PLAYER' && p.col === 0 && p.row === fromR);
              assert.ok(nf);
              store.selectPiece(nf.id);
              const r = store.executeMoveOrChallenge(0, toR, nf.id);
              if (r?.kind === 'CLASH') store.finalizeActiveClash();
              navyToggle = !navyToggle;
            }
          }

          let preTimeoutView = store.getVisibleView();
          if (preTimeoutView.shroud?.active) {
            store.unsealCommandShroud();
            preTimeoutView = store.getVisibleView();
          }
          const crimsonSurvivors = preTimeoutView.pieces.filter((p) => p.alive && p.faction === 'ENEMY');
          assert.equal(crimsonSurvivors.length, 1, 'Crimson should be reduced to Flag-only');
          assert.equal(crimsonSurvivors[0]!.visibleRank, 'FLAG');
          assert.equal(preTimeoutView.activeTurn, 'ENEMY');

          const turnBefore = preTimeoutView.turnCount;
          const flagBefore = { col: crimsonSurvivors[0]!.col, row: crimsonSurvivors[0]!.row };

          // Advance mock clock past 20s BLITZ turn limit
          tickSeconds(22);

          const postView = store.getVisibleView();
          if (postView.activeClash) {
            store.finalizeActiveClash();
          }
          const finalView = store.getVisibleView();
          const flagAfter = finalView.pieces.find((p) => p.id === crimsonSurvivors[0]!.id);
          const movedOrEnded =
            finalView.phase === 'GAME_OVER' ||
            finalView.turnCount > turnBefore ||
            (flagAfter && (flagAfter.col !== flagBefore.col || flagAfter.row !== flagBefore.row));

          assert.equal(
            movedOrEnded,
            true,
            'Flag-only clock-0 timeout softlocked (GameStore.ts:859 skipped FLAG without moving or ending)'
          );
        } finally {
          store.returnToTitleMenu();
        }
      });
    }
  );

  register(
    { id: 'T2-F02-2', tier: 2, feature: 'F2', mode: 'NODE', title: 'Player immobilization helper & cornered Flag non-softlock check' },
    () => {
      // 1) Contract check on RulesEngine.hasAnyLegalMoves
      assert.equal(hasAnyLegalMoves([], 'PLAYER'), false, '0 pieces must report immobilized');

      // Completely boxed-in 72-square PLAYER saturation (0 empty or enemy squares)
      const fullFriendly: Array<{ faction: Faction; col: number; row: number; alive: boolean }> = [];
      for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
          fullFriendly.push({ faction: 'PLAYER', col: c, row: r, alive: true });
        }
      }
      assert.equal(hasAnyLegalMoves(fullFriendly, 'PLAYER'), false);

      // Corner piece surrounded by enemies still HAS legal challenge moves
      assert.equal(
        hasAnyLegalMoves(
          [
            { faction: 'PLAYER', col: 0, row: 7, alive: true },
            { faction: 'ENEMY', col: 1, row: 7, alive: true },
            { faction: 'ENEMY', col: 0, row: 6, alive: true },
          ],
          'PLAYER'
        ),
        true
      );
    }
  );

  register(
    { id: 'T2-F02-3', tier: 2, feature: 'F2', mode: 'NODE', title: 'Stalemate / repetition safeguard adjudicates infinite back-and-forth loops' },
    () => {
      // 1) Verify canonical position repetition key
      const boardA = [
        { id: 'p0', col: 0, row: 7, alive: true },
        { id: 'e0', col: 8, row: 0, alive: true },
      ];
      const boardB = [
        { id: 'e0', col: 8, row: 0, alive: true },
        { id: 'p0', col: 0, row: 7, alive: true },
      ];
      assert.equal(
        computePositionRepetitionKey(boardA, 'PLAYER'),
        computePositionRepetitionKey(boardB, 'PLAYER')
      );

      // 2) Execute repeated back-and-forth plies in GameStore
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1980s', clockPreset: 'UNTIMED' });
        deployPassAndPlay(
          store,
          [{ col: 0, row: 5, rank: 'SERGEANT' }],
          [{ col: 8, row: 2, rank: 'SERGEANT' }]
        );

        let flip = false;
        for (let i = 0; i < 16; i++) {
          if (store.getVisibleView().phase !== 'PLAY') break;
          stepMove(store, 0, flip ? 4 : 5, 0, flip ? 5 : 4);
          if (store.getVisibleView().phase !== 'PLAY') break;
          stepMove(store, 8, flip ? 3 : 2, 8, flip ? 2 : 3);
          flip = !flip;
        }

        const v = store.getVisibleView();
        assert.equal(v.phase, 'GAME_OVER', 'Repetition safeguard did not trigger GAME_OVER after repeated identical positions');
        assert.equal(v.banner, 'STALEMATE ADJUDICATED');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F02-4', tier: 2, feature: 'F2', mode: 'NODE', title: '1970s pending Flag traverse is superseded if Enemy captures Flag on final turn' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1970s', clockPreset: 'UNTIMED' });
        deployPassAndPlay(
          store,
          [{ col: 0, row: 5, rank: 'FLAG' }],
          [
            { col: 1, row: 0, rank: 'PRIVATE' },
            { col: 8, row: 2, rank: 'SERGEANT' },
          ],
          [],
          [
            { col: 0, row: 0 },
            { col: 0, row: 1 },
            { col: 0, row: 2 },
          ]
        );

        let flip = false;
        for (let r = 5; r >= 1; r--) {
          stepMove(store, 0, r, 0, r - 1);
          if (r > 1) {
            stepMove(store, 8, flip ? 3 : 2, 8, flip ? 2 : 3);
            flip = !flip;
          }
        }
        assert.equal(store.getVisibleView().phase, 'PLAY');

        // Crimson adjacent PRIVATE at (1,0) captures Navy FLAG at (0,0) on its final turn!
        const res = stepMove(store, 1, 0, 0, 0);
        assert.equal(res.kind, 'CLASH');
        if (res.kind === 'CLASH') {
          assert.equal(res.verdict.resolution, 'FLAG_CAPTURED_BY_ENEMY');
        }
        store.finalizeActiveClash();

        const finalView = store.getVisibleView();
        assert.equal(finalView.phase, 'GAME_OVER');
        assert.equal(finalView.matchWinner, 'ENEMY');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F02-5', tier: 2, feature: 'F2', mode: 'NODE', title: 'Match clock expiration adjudicates by score & UNTIMED mode never decrements' },
    () => {
      withMockClockIntervals((tickSeconds) => {
        const store = new GameStore();
        try {
          // 1) UNTIMED immunity
          store.updateOptions({ clockPreset: 'UNTIMED' });
          store.startSkirmish('MILLER', '1980s');
          store.applyDeploymentPreset('VACCINATION');
          store.launchBattleFromDeployment();
          tickSeconds(120);
          assert.equal(store.getVisibleView().phase, 'PLAY');
          assert.equal(store.getVisibleView().isUntimed, true);
          assert.equal(store.getVisibleView().matchClockSec, 0);

          // 2) BLITZ match clock expiration via deterministic non-repeating Pass & Play clock ticks
          store.updateOptions({ clockPreset: 'BLITZ' });
          deployPassAndPlay(
            store,
            [{ col: 0, row: 5, rank: 'SERGEANT' }],
            [{ col: 0, row: 2, rank: 'SERGEANT' }]
          );
          let navyCol = 0;
          let navyRow = 5;
          let crimCol = 0;
          let crimRow = 2;
          for (let step = 0; step < 17 && store.getVisibleView().phase === 'PLAY'; step++) {
            if (store.getVisibleView().shroud?.active) {
              store.unsealCommandShroud();
            }
            tickSeconds(19);
            if (store.getVisibleView().phase !== 'PLAY') break;
            if (step % 2 === 0) {
              const nextR = 4;
              const nextC = navyRow === 5 ? 0 : navyCol + 1;
              stepMove(store, navyCol, navyRow, nextC, nextR);
              navyCol = nextC;
              navyRow = nextR;
            } else {
              const nextR = 3;
              const nextC = crimRow === 2 ? 0 : crimCol + 1;
              stepMove(store, crimCol, crimRow, nextC, nextR);
              crimCol = nextC;
              crimRow = nextR;
            }
          }
          if (store.getVisibleView().phase === 'PLAY') {
            if (store.getVisibleView().shroud?.active) {
              store.unsealCommandShroud();
            }
            tickSeconds(20);
          }
          const v = store.getVisibleView();
          assert.equal(v.phase, 'GAME_OVER');
          assert.ok(v.winReason?.includes('Match Clock Expired'), `Expected Match Clock Expired, got ${v.winReason}`);
        } finally {
          store.returnToTitleMenu();
        }
      });
    }
  );

  // =========================================================================
  // F3 Boundaries (T2-F03-1 .. T2-F03-4)
  // =========================================================================
  register(
    { id: 'T2-F03-1', tier: 2, feature: 'F3', mode: 'NODE', title: 'PASS_AND_PLAY clash masks playerDoctrine and banner (no DEFCON 1 / COVERT_SPY leak)' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ eraMode: '1980s', clockPreset: 'UNTIMED' });
        deployPassAndPlay(
          store,
          [{ col: 4, row: 5, rank: 'GEN_5' }],
          [{ col: 4, row: 2, rank: 'SPY' }],
          [],
          [{ col: 4, row: 3 }] // keep lane open
        );
        // Move Navy GEN_5 (4,5)->(4,4), Crimson SPY (4,2)->(4,3), Navy GEN_5 challenges Crimson SPY at (4,3)
        stepMove(store, 4, 5, 4, 4);
        stepMove(store, 4, 2, 4, 3);
        const res = stepMove(store, 4, 4, 4, 3);
        assert.equal(res.kind, 'CLASH');

        const view = store.getVisibleView();
        assert.ok(view.activeClash);
        assert.equal(view.activeClash.playerVisibleRank, 'UNKNOWN');
        assert.equal(
          view.activeClash.stakes?.playerDoctrine,
          'UNKNOWN_DOCTRINE',
          `PASS_AND_PLAY leaked playerDoctrine=${view.activeClash.stakes?.playerDoctrine}`
        );
        assert.notEqual(view.banner, 'DEFCON 1 — HIGH COMMAND ALERT');
        assert.notEqual(view.banner, 'OPERATION STILETTO — COVERT STRIKE');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F03-2', tier: 2, feature: 'F3', mode: 'NODE', title: 'Command Shroud blocks selectPiece, executeMoveOrChallenge, and placeOrSwapDeployment' },
    () => {
      const store = new GameStore();
      try {
        store.startPassAndPlay();
        store.applyDeploymentPreset('VACCINATION');
        store.launchBattleFromDeployment();

        // Now shroud is active for Crimson DEPLOY
        assert.equal(store.getVisibleView().shroud?.active, true);
        assert.equal(store.placeOrSwapDeployment(4, 1, 'GEN_5'), false);

        store.unsealCommandShroud();
        store.applyDeploymentPreset('MOTHERSHIP');
        store.launchBattleFromDeployment();

        // Now shroud is active for Navy PLAY Turn 1
        const view = store.getVisibleView();
        assert.equal(view.shroud?.active, true);
        const piece = view.pieces[0]!;
        store.selectPiece(piece.id);
        assert.equal(store.getVisibleView().selectedPieceId, null);
        assert.equal(store.executeMoveOrChallenge(piece.col, piece.row - 1, piece.id), null);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F03-3', tier: 2, feature: 'F3', mode: 'NODE', title: 'Suspect tag validation rejects own/dead pieces and clears on elimination' },
    () => {
      const store = new GameStore();
      try {
        store.startSkirmish('MILLER', '1980s');
        store.applyDeploymentPreset('VACCINATION');
        store.launchBattleFromDeployment();

        const view = store.getVisibleView();
        const own = view.pieces.find((p) => p.faction === 'PLAYER')!;
        const enemy = view.pieces.find((p) => p.faction === 'ENEMY')!;

        store.setEnemySuspectTag(own.id, 'SPY?');
        assert.equal(store.getVisibleView().intelLedger.enemyTaggedCount, 0);

        store.setEnemySuspectTag('nonexistent_id', 'GEN?');
        assert.equal(store.getVisibleView().intelLedger.enemyTaggedCount, 0);

        store.setEnemySuspectTag(enemy.id, 'SPY?');
        let taggedView = store.getVisibleView();
        assert.equal(taggedView.intelLedger.enemyTaggedCount, 1);
        assert.equal(taggedView.pieces.find((p) => p.id === enemy.id)?.suspectTag, 'SPY?');

        // Clear tag
        store.setEnemySuspectTag(enemy.id, null);
        assert.equal(store.getVisibleView().intelLedger.enemyTaggedCount, 0);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F03-4', tier: 2, feature: 'F3', mode: 'NODE', title: 'MUTUAL_SPLIT keeps enemyCasualties visibleRank UNKNOWN during PLAY' },
    () => {
      const store = new GameStore();
      try {
        const verdict = store.triggerShowcaseClash('MUTUAL_SPLIT');
        assert.ok(verdict);
        assert.equal(verdict.resolution, 'MUTUAL_SPLIT');
        store.finalizeActiveClash();

        const view = store.getVisibleView();
        assert.equal(view.enemyCasualties.length, 1);
        assert.equal(view.enemyCasualties[0]!.visibleRank, 'UNKNOWN');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F4 Boundaries (T2-F04-1 .. T2-F04-4)
  // =========================================================================
  register(
    { id: 'T2-F04-1', tier: 2, feature: 'F4', mode: 'NODE', title: 'Operation turn-limit expiry results in GAME_OVER playerWon === false' },
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
        const op = opsMod.getTacticalOperation('OP_05_BLITZ_CORRIDOR');
        assert.ok(op && op.turnLimit > 0, 'OP_05_BLITZ_CORRIDOR must define positive turnLimit');

        const endView = withDeterministicOperationEnv(0x515151, (flushAiTimers) => {
          store.updateOptions({ clockPreset: 'UNTIMED' });
          assert.equal((store as any).startOperation('OP_05_BLITZ_CORRIDOR'), true);
          assert.equal(store.getVisibleView().operationTurnLimit, op.turnLimit);

          const stepRand = (n: number) => {
            let x = (0x515151 + n * 0x9e3779b9) >>> 0;
            x = Math.imul(x ^ (x >>> 15), 1 | x);
            x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
          };

          let step = 0;
          while (store.getVisibleView().phase === 'PLAY' && step < op.turnLimit + 10) {
            step += 1;
            const v = store.getVisibleView();
            if (v.activeTurn === 'PLAYER') {
              const pFlag = v.pieces.find((p) => p.alive && p.faction === 'PLAYER' && p.visibleRank === 'FLAG');
              const enemies = v.pieces.filter((p) => p.alive && p.faction === 'ENEMY');
              let pickedMove: { id: string; col: number; row: number } | null = null;
              if (pFlag && pFlag.row < 7) {
                const flagMoves = store.computeValidMoves(pFlag.id).filter((m) => m.kind === 'MOVE');
                const safeRetreat = flagMoves
                  .filter((m) => !enemies.some((e) => Math.abs(e.col - m.col) + Math.abs(e.row - m.row) <= 1))
                  .sort((a, b) => b.row - a.row)[0];
                if (
                  safeRetreat &&
                  (safeRetreat.row > pFlag.row ||
                    enemies.some((e) => Math.abs(e.col - pFlag.col) + Math.abs(e.row - pFlag.row) <= 2))
                ) {
                  pickedMove = { id: pFlag.id, col: safeRetreat.col, row: safeRetreat.row };
                }
              }

              if (pickedMove) {
                store.selectPiece(pickedMove.id);
                store.executeMoveOrChallenge(pickedMove.col, pickedMove.row, pickedMove.id);
              } else {
                const candidates = v.pieces.filter(
                  (p) =>
                    p.alive &&
                    p.faction === 'PLAYER' &&
                    p.visibleRank !== 'FLAG' &&
                    store.computeValidMoves(p.id).some((m) => m.kind === 'MOVE' && m.row >= 5)
                );
                const mover = candidates[step % Math.max(1, candidates.length)];
                if (mover) {
                  const mvs = store.computeValidMoves(mover.id).filter((m) => m.kind === 'MOVE' && m.row >= 5);
                  const pick = mvs[Math.floor(stepRand(step) * mvs.length)] ?? mvs[0]!;
                  store.selectPiece(mover.id);
                  store.executeMoveOrChallenge(pick.col, pick.row, mover.id);
                } else {
                  const fallback = v.pieces.find(
                    (p) => p.alive && p.faction === 'PLAYER' && store.computeValidMoves(p.id).length > 0
                  )!;
                  const fm = store.computeValidMoves(fallback.id)[0]!;
                  store.selectPiece(fallback.id);
                  const res = store.executeMoveOrChallenge(fm.col, fm.row, fallback.id);
                  if (res?.kind === 'CLASH') store.finalizeActiveClash();
                }
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
        assert.equal(endView.matchWinner, 'ENEMY');
        assert.equal(endView.dossier?.playerWon, false);
        assert.equal(endView.dossier?.starsEarned, 0);
        assert.equal(endView.banner, 'OPERATION FAILED — TURN LIMIT');
        assert.equal(endView.turnCount, op.turnLimit + 1);
        const prog = opsMod.loadOperationProgress()['OP_05_BLITZ_CORRIDOR'];
        assert.equal(prog.completed, false);
        assert.equal(prog.bestStars, 0);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F04-2', tier: 2, feature: 'F4', mode: 'NODE', title: 'SURVIVAL_DEFENSE loss when Flag is captured before turnLimit' },
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
        const op = opsMod.getTacticalOperation('OP_04_BUNKER_SIEGE');
        assert.equal(op.objectiveKind, 'SURVIVAL_DEFENSE');

        let capturedResolution: string | null = null;
        const v = withDeterministicOperationEnv(0x202020, (flushAiTimers) => {
          store.updateOptions({ clockPreset: 'UNTIMED' });
          assert.equal((store as any).startOperation('OP_04_BUNKER_SIEGE'), true);
          assert.equal(store.getVisibleView().matchMode, 'OPERATION');

          let guard = 0;
          while (store.getVisibleView().phase === 'PLAY' && guard < op.turnLimit + 10) {
            guard += 1;
            const cur = store.getVisibleView();
            if (cur.activeTurn === 'PLAYER') {
              const blocker = cur.pieces.find(
                (p) =>
                  p.alive &&
                  p.faction === 'PLAYER' &&
                  p.visibleRank !== 'FLAG' &&
                  p.col === 1 &&
                  p.row === 6
              );
              if (blocker) {
                const sideMove = store
                  .computeValidMoves(blocker.id)
                  .find((m) => m.kind === 'MOVE' && m.col !== 1);
                if (sideMove) {
                  store.selectPiece(blocker.id);
                  const res = store.executeMoveOrChallenge(sideMove.col, sideMove.row, blocker.id);
                  if (res?.kind === 'CLASH') {
                    capturedResolution = res.verdict.resolution;
                    store.finalizeActiveClash();
                  }
                  continue;
                }
              }

              const flag = cur.pieces.find(
                (p) => p.alive && p.faction === 'PLAYER' && p.visibleRank === 'FLAG'
              );
              if (flag) {
                const moves = store.computeValidMoves(flag.id);
                const pick =
                  moves.find((m) => m.kind === 'CHALLENGE') ??
                  moves.find((m) => m.row < flag.row) ??
                  moves[0];
                if (pick) {
                  store.selectPiece(flag.id);
                  const res = store.executeMoveOrChallenge(pick.col, pick.row, flag.id);
                  if (res?.kind === 'CLASH') {
                    capturedResolution = res.verdict.resolution;
                    store.finalizeActiveClash();
                  }
                  continue;
                }
              }

              const anyP = cur.pieces.find(
                (p) => p.alive && p.faction === 'PLAYER' && store.computeValidMoves(p.id).length > 0
              );
              assert.ok(anyP, 'Expected legal PLAYER move during OP_04_BUNKER_SIEGE');
              const mv = store.computeValidMoves(anyP.id)[0]!;
              store.selectPiece(anyP.id);
              const res = store.executeMoveOrChallenge(mv.col, mv.row, anyP.id);
              if (res?.kind === 'CLASH') {
                capturedResolution = res.verdict.resolution;
                store.finalizeActiveClash();
              }
            } else {
              flushAiTimers();
              const vAfter = store.getVisibleView();
              if (vAfter.activeClash) {
                capturedResolution = vAfter.activeClash.resolution;
                store.finalizeActiveClash();
              }
            }
          }
          return store.getVisibleView();
        });

        assert.equal(capturedResolution, 'FLAG_CAPTURED_BY_ENEMY');
        assert.equal(v.phase, 'GAME_OVER');
        assert.equal(v.matchWinner, 'ENEMY');
        assert.equal(v.dossier?.playerWon, false);
        assert.equal(v.banner, 'FLAG LOST — DEFEAT');
        assert.ok(
          v.turnCount <= op.turnLimit,
          `Flag capture loss must occur before turnLimit=${op.turnLimit}, got ${v.turnCount}`
        );
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F04-3', tier: 2, feature: 'F4', mode: 'NODE', title: 'SPY_HUNT operation configures enemy Spies and player Privates accurately' },
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
        const op = opsMod.getTacticalOperation('OP_02_STILETTO_PURGE');
        assert.equal(op.objectiveKind, 'SPY_HUNT');
        assert.equal(op.enemyPlacements.filter((p: any) => p.rank === 'SPY').length, 2);
        assert.ok(op.playerPlacements.filter((p: any) => p.rank === 'PRIVATE').length >= 3);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F04-4', tier: 2, feature: 'F4', mode: 'NODE', title: 'rematchCurrentMode restarts the exact active Operation cleanly' },
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
        assert.equal((store as any).startOperation('OP_01_IRON_BREAKOUT'), true);
        store.surrenderMatch();
        assert.equal(store.getVisibleView().phase, 'GAME_OVER');
        store.rematchCurrentMode();
        const v = store.getVisibleView();
        assert.equal(v.matchMode, 'OPERATION');
        assert.equal(v.turnCount, 1);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F5 Boundaries (T2-F05-1 .. T2-F05-5)
  // =========================================================================
  register(
    { id: 'T2-F05-1', tier: 2, feature: 'F5', mode: 'NODE', title: 'Locked Campaign tier rejects startCampaignTier and preserves TITLE phase' },
    () => {
      const store = new GameStore();
      try {
        assert.equal(store.getVisibleView().phase, 'TITLE');
        assert.equal(store.startCampaignTier('HOLLIS'), false);
        assert.equal(store.getVisibleView().phase, 'TITLE');
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  register(
    { id: 'T2-F05-2', tier: 2, feature: 'F5', mode: 'NODE', title: 'Campaign loss increments totalLosses without regressing unlockedTier or medals' },
    () => {
      recordCampaignMatchResult('MILLER', true, 19);
      const afterWin = loadCampaignProgress();
      assert.equal(afterWin.unlockedTier, 2);
      assert.equal(afterWin.records.MILLER.medalEarned, true);

      recordCampaignMatchResult('MERCER', false, 24);
      const afterLoss = loadCampaignProgress();
      assert.equal(afterLoss.unlockedTier, 2);
      assert.equal(afterLoss.totalLosses, 1);
      assert.equal(afterLoss.records.MILLER.medalEarned, true);
    }
  );

  register(
    { id: 'T2-F05-3', tier: 2, feature: 'F5', mode: 'NODE', title: 'Corrupt localStorage in campaign & custom blueprints recovers safely' },
    () => {
      localStorage.setItem('war_generals_campaign_v2', '{bad_json');
      localStorage.setItem('war_generals_custom_blueprints_v1', '{not_an_array');
      const camp = loadCampaignProgress();
      assert.equal(camp.unlockedTier, 1);
      const bps = loadCustomBlueprintSlots();
      assert.equal(bps.length, 5);
      assert.ok(bps.every((s) => s === null));

      localStorage.setItem('war_generals_campaign_v2', JSON.stringify({ unlockedTier: 99 }));
      assert.equal(loadCampaignProgress().unlockedTier, 6);
    }
  );

  register(
    { id: 'T2-F05-4', tier: 2, feature: 'F5', mode: 'NODE', title: '4-ply AI loop prevention prevents sterile oscillation on sparse endgame board' },
    () => {
      const ai = new BeliefMatrixAI();
      const aiUnits: AIOwnUnitState[] = [
        { id: 'e_flag', ownRank: 'FLAG', col: 0, row: 0, hasMoved: false },
        { id: 'e_gen', ownRank: 'GEN_5', col: 4, row: 2, hasMoved: true },
      ];
      const playerUnits: ObservedPlayerUnitState[] = [
        { id: 'p_flag', col: 8, row: 7, publicKills: 0, hasMoved: false },
        { id: 'p_gen', col: 4, row: 6, publicKills: 0, hasMoved: true },
      ];
      ai.initializeMatch(
        playerUnits.map((p) => ({ id: p.id, col: p.col, row: p.row })),
        aiUnits,
        { FLAG: 1, GEN_5: 1 }
      );

      const visitedGenCoords: string[] = [];
      for (let t = 1; t <= 12; t++) {
        const dec = ai.chooseCommanderMove(aiUnits, playerUnits, 'HOLLIS', t, {
          difficulty: 'GENERAL',
          rng: () => 0.5,
        });
        assert.ok(dec);
        const unit = aiUnits.find((u) => u.id === dec.pieceId)!;
        ai.recordOwnMoveOrigin(unit.id, { col: unit.col, row: unit.row });
        (unit as { col: number }).col = dec.toCol;
        (unit as { row: number }).row = dec.toRow;
        if (unit.id === 'e_gen') {
          visitedGenCoords.push(`${dec.toCol},${dec.toRow}`);
        }
      }
      // Verify General actually advances toward opponent rather than 2-square ping-ponging
      const uniqueCoords = new Set(visitedGenCoords);
      assert.ok(uniqueCoords.size >= 3, `Expected forward progress, saw only ${visitedGenCoords.join(' -> ')}`);
    }
  );

  register(
    { id: 'T2-F05-5', tier: 2, feature: 'F5', mode: 'NODE', title: 'BeliefMatrixAI.chooseCommanderMove returns null cleanly when boxed in' },
    () => {
      const ai = new BeliefMatrixAI();
      ai.initializeMatch([], []);
      assert.equal(ai.chooseCommanderMove([], [], 'MILLER', 1), null);
    }
  );

  // =========================================================================
  // F6 Boundaries (T2-F06-1 .. T2-F06-4)
  // =========================================================================
  register(
    { id: 'T2-F06-1', tier: 2, feature: 'F6', mode: 'NODE', title: 'SettingsStore clamps out-of-bounds and NaN mixer volumes to [0, 1]' },
    () => {
      const s = new SettingsStore();
      const updated = s.update({
        masterVolume: -5,
        sfxVolume: 99,
        musicVolume: Number.NaN,
        ambianceVolume: 0.42,
      });
      assert.equal(updated.masterVolume, 0);
      assert.equal(updated.sfxVolume, 1);
      assert.equal(updated.musicVolume, 0.85); // falls back to prior valid value
      assert.equal(updated.ambianceVolume, 0.42);
    }
  );

  register(
    { id: 'T2-F06-2', tier: 2, feature: 'F6', mode: 'NODE', title: 'Corrupt war_generals_settings_v1 JSON falls back cleanly to defaults' },
    () => {
      localStorage.setItem('war_generals_settings_v1', '{not_valid_json!!!');
      const s = new SettingsStore();
      assert.equal(s.get().eraMode, '1980s');
      assert.equal(s.get().qualityMode, 'AUTO');
    }
  );

  register(
    { id: 'T2-F06-3', tier: 2, feature: 'F6', mode: 'NODE', title: 'Legacy arbiterSpeed 1.75x and renderQuality BALANCED migrate cleanly' },
    () => {
      localStorage.setItem(
        'war_generals_settings_v1',
        JSON.stringify({ arbiterSpeed: '1.75x', renderQuality: 'BALANCED' })
      );
      const s = new SettingsStore();
      const opts = s.get();
      assert.equal(opts.arbiterSpeed, 'TACTICAL_FAST');
      assert.equal(opts.renderQuality, 'BATTERY_SAVER');
      assert.equal(opts.qualityMode, 'BATTERY_SAVER');
    }
  );

  register(
    { id: 'T2-F06-4', tier: 2, feature: 'F6', mode: 'NODE', title: 'Switching clockPreset mid-match from STANDARD to BLITZ caps clocks <= 300s / 20s' },
    () => {
      const store = new GameStore();
      try {
        store.updateOptions({ clockPreset: 'STANDARD' });
        store.startSkirmish('MILLER', '1980s');
        store.applyDeploymentPreset('VACCINATION');
        store.launchBattleFromDeployment();

        store.updateOptions({ clockPreset: 'BLITZ' });
        const v = store.getVisibleView();
        assert.ok(v.matchClockSec <= 300);
        assert.ok(v.turnClockSec <= 20);
      } finally {
        store.returnToTitleMenu();
      }
    }
  );

  // =========================================================================
  // F9, F10 Boundaries — ASSET Checks (T2-F09-5, T2-F10-1 .. T2-F10-3)
  // =========================================================================
  register(
    { id: 'T2-F09-5', tier: 2, feature: 'F9', mode: 'ASSET', title: 'No inline SVG character portraits or doodle map placeholders in graphics/ or ui/' },
    () => {
      const m5Landed =
        fs.existsSync(path.join(rootDir, 'public/portraits')) &&
        fs.existsSync(path.join(rootDir, 'src/arbiter/BattleChoreographies.ts'));
      requireCapability(m5Landed, 'M5', 'F9', 'M2/M5 portrait SVG removal not yet landed');

      const cmdSrc = fs.readFileSync(path.join(rootDir, 'src/ai/CommanderProfiles.ts'), 'utf8');
      const uiSrc = fs.readFileSync(path.join(rootDir, 'src/ui/UIManager.ts'), 'utf8');
      assert.equal(cmdSrc.includes('<svg'), false);
      assert.equal(uiSrc.includes('portraitSvg'), false);
    }
  );

  register(
    { id: 'T2-F10-1', tier: 2, feature: 'F10', mode: 'ASSET', title: 'All public/portraits/ assets are non-empty valid images <= 2MB' },
    () => {
      const dir = path.join(rootDir, 'public/portraits');
      requireCapability(fs.existsSync(dir), 'M2', 'F10', 'public/portraits/ not yet created in M2');
      for (const cmd of COMMANDER_ROSTER) {
        const lower = cmd.id.toLowerCase();
        const found = ['webp', 'png', 'jpg']
          .map((ext) => path.join(dir, `${lower}.${ext}`))
          .find((p) => fs.existsSync(p));
        assert.ok(found, `Missing portrait for ${cmd.id}`);
        const size = fs.statSync(found).size;
        assert.ok(size > 1024 && size <= 2 * 1024 * 1024, `Invalid portrait size ${size} bytes for ${cmd.id}`);
      }
    }
  );

  register(
    { id: 'T2-F10-2', tier: 2, feature: 'F10', mode: 'ASSET', title: 'public/ranks/ matches ORDERED_RANKS 1:1 with zero missing IDs' },
    () => {
      const dir = path.join(rootDir, 'public/ranks');
      requireCapability(fs.existsSync(dir), 'M2', 'F10', 'public/ranks/ not yet created in M2');
      for (const rank of ORDERED_RANKS) {
        const found = [
          path.join(dir, `${rank.toLowerCase()}.webp`),
          path.join(dir, `${rank.toLowerCase()}.png`),
          path.join(dir, `${rank}.webp`),
          path.join(dir, `${rank}.png`),
        ].find((p) => fs.existsSync(p));
        assert.ok(found, `Missing rank chip asset for ${rank}`);
        assert.ok(fs.statSync(found).size > 256, `Rank chip asset empty for ${rank}`);
      }
    }
  );

  register(
    { id: 'T2-F10-3', tier: 2, feature: 'F10', mode: 'ASSET', title: 'public/manifest.json uses relative ./ paths and raster icons for GitHub Pages' },
    () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'public/manifest.json'), 'utf8'));
      assert.equal(manifest.start_url, './');
      assert.equal(manifest.scope, './');
      const icons: Array<{ src: string }> = manifest.icons || [];
      requireCapability(
        fs.existsSync(path.join(rootDir, 'public/ranks')),
        'M2',
        'F10',
        'manifest.json still uses icon.svg pending M2 raster PWA icon'
      );
      assert.equal(
        icons.some((ic) => ic.src.endsWith('.svg')),
        false,
        'manifest.json must not reference .svg icons after M2'
      );
      for (const ic of icons) {
        assert.ok(ic.src.startsWith('./'), `Manifest icon src must start with ./ (${ic.src})`);
      }
    }
  );

  // =========================================================================
  // F11 & F12 Boundaries (T2-F11-5, T2-F12-1 .. T2-F12-3)
  // =========================================================================
  register(
    { id: 'T2-F11-5', tier: 2, feature: 'F11', mode: 'NODE', title: 'Unknown theaterId in getBattleTheater falls back to FIELD_HQ' },
    async () => {
      const mod = await loadSrcModule('src/core/theaters.ts');
      requireCapability(mod?.getBattleTheater, 'M1', 'F11', 'src/core/theaters.ts missing');
      const spec = mod.getBattleTheater('UNKNOWN_MARS_BASE');
      assert.equal(spec.id, 'FIELD_HQ');
    }
  );

  register(
    { id: 'T2-F12-1', tier: 2, feature: 'F12', mode: 'NODE', title: 'QualityGovernor ignores 0, negative, and NaN dt outliers cleanly' },
    async () => {
      const mod = await loadSrcModule('src/graphics/QualityGovernor.ts');
      requireCapability(mod?.QualityGovernor, 'M2', 'F12', 'src/graphics/QualityGovernor.ts not yet implemented');
      const gov = new mod.QualityGovernor();
      gov.setRequestedMode('AUTO');
      gov.recordFrameDt(0);
      gov.recordFrameDt(-1);
      gov.recordFrameDt(Number.NaN);
      gov.recordFrameDt(Infinity);
      const prof = gov.getActiveProfile();
      assert.ok(['ULTRA', 'HIGH', 'BALANCED', 'BATTERY_SAVER'].includes(prof.resolvedTier));
      assert.equal(Number.isFinite(prof.measuredFps), true);
    }
  );

  register(
    { id: 'T2-F12-2', tier: 2, feature: 'F12', mode: 'NODE', title: 'QualityGovernor AUTO mode resists single 150ms tab-switch spike' },
    async () => {
      const mod = await loadSrcModule('src/graphics/QualityGovernor.ts');
      requireCapability(mod?.QualityGovernor, 'M2', 'F12', 'src/graphics/QualityGovernor.ts not yet implemented');
      const gov = new mod.QualityGovernor();
      gov.setRequestedMode('AUTO');
      for (let i = 0; i < 40; i++) gov.recordFrameDt(0.016);
      const tierBefore = gov.getActiveProfile().resolvedTier;
      gov.recordFrameDt(0.15);
      for (let i = 0; i < 5; i++) gov.recordFrameDt(0.016);
      assert.equal(gov.getActiveProfile().resolvedTier, tierBefore);
    }
  );

  register(
    { id: 'T2-F12-3', tier: 2, feature: 'F12', mode: 'NODE', title: 'QualityGovernor manual ULTRA/BATTERY_SAVER overrides ignore dt changes' },
    async () => {
      const mod = await loadSrcModule('src/graphics/QualityGovernor.ts');
      requireCapability(mod?.QualityGovernor, 'M2', 'F12', 'src/graphics/QualityGovernor.ts not yet implemented');
      const gov = new mod.QualityGovernor();
      gov.setRequestedMode('ULTRA');
      for (let i = 0; i < 120; i++) gov.recordFrameDt(0.08);
      assert.equal(gov.getActiveProfile().resolvedTier, 'ULTRA');

      gov.setRequestedMode('BATTERY_SAVER');
      for (let i = 0; i < 120; i++) gov.recordFrameDt(0.008);
      assert.equal(gov.getActiveProfile().resolvedTier, 'BATTERY_SAVER');
    }
  );
}
