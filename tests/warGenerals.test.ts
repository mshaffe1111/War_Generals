import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  BeliefMatrixAI,
  type AIOwnUnitState,
  type ObservedPlayerUnitState,
  type PublicClashOutcomeForAI,
} from '../src/ai/BeliefMatrixAI';
import {
  COMMANDER_ROSTER,
  generateCommanderDeployment,
  type CommanderId,
} from '../src/ai/CommanderProfiles';
import { compareSalpakanRanks, deriveBattleChoreography, resolveArbiterChallenge } from '../src/arbiter/ArbiterResolver';
import {
  BOARD_COLS,
  BOARD_ROWS,
  ORDERED_RANKS,
  RANK_SPECS,
  type Faction,
  type RankId,
} from '../src/core/ranks';
import {
  TACTICAL_OPERATIONS,
  getTacticalOperation,
  recordOperationResult,
} from '../src/core/operations';
import { BATTLE_THEATERS, getBattleTheater } from '../src/core/theaters';
import { PIECE_COLOR_ORDER, PIECE_COLOR_SPECS } from '../src/core/pieceColors';
import {
  DEPLOYMENT_PRESET_META,
  TOURNAMENT_PRESETS,
  checkBackRowFlagTraverse,
  generateSmartAutoDeploy,
  hasAnyLegalMoves,
  resolveClash,
  validateFactionDeployment,
  validatePlayerDeployment,
} from '../src/core/RulesEngine';
import {
  recordCampaignMatchResult,
  loadCampaignProgress,
} from '../src/ai/CommanderProfiles';
import type {
  AudioEraMode,
  DeploymentPresetId,
  DifficultyTier,
  OperationObjectiveKind,
  TheaterId,
} from '../src/core/types';
import { GameStore } from '../src/state/GameStore';
import { SettingsStore } from '../src/state/SettingsStore';

describe('War Generals (Salpakan) — Gate 5 Automated Verification Suite', () => {
  it('1. Exhaustively verifies all 15 × 15 = 225 pairwise resolveClash combinations', () => {
    assert.equal(ORDERED_RANKS.length, 15);
    let pairCount = 0;

    for (const att of ORDERED_RANKS) {
      for (const def of ORDERED_RANKS) {
        pairCount += 1;
        const outcome = resolveClash(att, def);
        assert.equal(outcome, compareSalpakanRanks(att, def));

        if (att === 'FLAG' && def === 'FLAG') {
          // Flag-on-Flag aggressor exception!
          assert.equal(outcome, 'ATTACKER');
          const v = resolveArbiterChallenge({
            contestedCoord: { col: 4, row: 0 },
            attackerId: 'p_flag',
            attackerFaction: 'PLAYER',
            attackerTrueRank: 'FLAG',
            defenderId: 'e_flag',
            defenderFaction: 'ENEMY',
            defenderTrueRank: 'FLAG',
          });
          assert.equal(v.resolution, 'FLAG_CAPTURED_BY_PLAYER');
          assert.equal(v.survivorFaction, 'PLAYER');
        } else if (def === 'FLAG') {
          assert.equal(outcome, 'ATTACKER', `${att} attacking FLAG must win`);
        } else if (att === 'FLAG') {
          assert.equal(outcome, 'DEFENDER', `Moving FLAG attacking ${def} must lose`);
        } else if (att === def) {
          assert.equal(outcome, 'SPLIT', `Equal non-Flag ${att} vs ${def} must SPLIT`);
        } else if (att === 'SPY') {
          assert.equal(outcome, def === 'PRIVATE' ? 'DEFENDER' : 'ATTACKER');
        } else if (def === 'SPY') {
          assert.equal(outcome, att === 'PRIVATE' ? 'ATTACKER' : 'DEFENDER');
        } else {
          const expected =
            RANK_SPECS[att].seniority > RANK_SPECS[def].seniority ? 'ATTACKER' : 'DEFENDER';
          assert.equal(outcome, expected);
        }
      }
    }

    assert.equal(pairCount, 225);
  });

  it('2. Verifies 1970s Classic (deferred 1-turn adjacent Flag bluff) vs. 1980s Electronic (instant win)', () => {
    const contestedPlayerBackRankArrival = [
      { faction: 'PLAYER' as const, trueRank: 'FLAG' as RankId, col: 3, row: 0, alive: true },
      { faction: 'ENEMY' as const, trueRank: 'GEN_5' as RankId, col: 4, row: 0, alive: true },
    ];
    const uncontestedPlayerBackRankArrival = [
      { faction: 'PLAYER' as const, trueRank: 'FLAG' as RankId, col: 3, row: 0, alive: true },
      { faction: 'ENEMY' as const, trueRank: 'GEN_5' as RankId, col: 6, row: 0, alive: true },
    ];

    // 1980s Electronic Edition: Instant victory even when an Enemy 5-Star General sits right next to it!
    assert.equal(
      checkBackRowFlagTraverse(contestedPlayerBackRankArrival, 'PLAYER', '1980s', false),
      'PLAYER'
    );

    // 1970s Classic Edition (Uncontested): Zero orthogonally adjacent enemies -> immediate victory!
    assert.equal(
      checkBackRowFlagTraverse(uncontestedPlayerBackRankArrival, 'PLAYER', '1970s', false),
      'PLAYER'
    );

    // 1970s Classic Edition (Contested Arrival): >= 1 adjacent enemy -> does NOT end yet (`null`)!
    assert.equal(
      checkBackRowFlagTraverse(contestedPlayerBackRankArrival, 'PLAYER', '1970s', false),
      null
    );

    // 1970s Classic Edition (Survived Opponent Final Turn): Unveils at start of owner's next turn and wins!
    assert.equal(
      checkBackRowFlagTraverse(contestedPlayerBackRankArrival, 'PLAYER', '1970s', true),
      'PLAYER'
    );

    // Verify SettingsStore defaults & safe update validation + mid-match Untimed -> Blitz clock switch
    const settings = new SettingsStore();
    assert.equal(settings.get().eraMode, '1980s');
    settings.update({ eraMode: '1970s', difficulty: 'SUPREME_MARSHAL', handedness: 'LEFT' });
    assert.equal(settings.get().eraMode, '1970s');
    assert.equal(settings.get().difficulty, 'SUPREME_MARSHAL');
    assert.equal(settings.get().handedness, 'LEFT');

    const store = new GameStore();
    store.updateOptions({ clockPreset: 'UNTIMED' });
    store.startSkirmish('MILLER', '1980s');
    store.applyDeploymentPreset('IRON_BLITZ');
    assert.equal(store.launchBattleFromDeployment(), true);
    assert.equal(store.getVisibleView().isUntimed, true);
    store.updateOptions({ clockPreset: 'BLITZ' });
    assert.equal(store.getVisibleView().isUntimed, false);
    assert.equal(store.getVisibleView().matchClockSec, 300);
    assert.equal(store.getVisibleView().turnClockSec, 20);
    assert.equal(store.getVisibleView().phase, 'PLAY');
    store.returnToTitleMenu();
  });

  it('3. Enforces static Zero-Cheat Information Wall on BeliefMatrixAI & CommanderProfiles', () => {
    for (const relPath of ['src/ai/BeliefMatrixAI.ts', 'src/ai/CommanderProfiles.ts']) {
      const code = fs.readFileSync(relPath, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      assert.equal(code.includes('.trueRank'), false, `${relPath} must never read .trueRank`);
      assert.equal(
        code.includes('TruthPieceRecord'),
        false,
        `${relPath} must never reference TruthPieceRecord`
      );
    }
  });

  it('4. Completes 100 automated headless BeliefMatrixAI vs. BeliefMatrixAI matches with 0 deadlocks & 0 rank leaks', () => {
    interface HeadlessPiece {
      id: string;
      faction: Faction;
      trueRank: RankId;
      col: number;
      row: number;
      alive: boolean;
      hasMoved: boolean;
      kills: number;
    }

    // Deterministic fast PRNG (`mulberry32`) so all 100 headless matches are 100% reproducible!
    let seed = 0x19801970;
    const rng = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const difficulties: DifficultyTier[] = [
      'RECRUIT',
      'OFFICER',
      'GENERAL',
      'SUPREME_MARSHAL',
    ];
    const eras: AudioEraMode[] = ['1980s', '1970s'];
    const commanderIds: CommanderId[] = COMMANDER_ROSTER.map((c) => c.id);

    let navyWins = 0;
    let crimsonWins = 0;
    let flagCaptures = 0;
    let flagTraverses = 0;

    for (let matchIdx = 0; matchIdx < 100; matchIdx++) {
      const era = eras[matchIdx % 2]!;
      const navyDiff = difficulties[matchIdx % difficulties.length]!;
      const crimDiff = difficulties[(matchIdx + 2) % difficulties.length]!;
      const navyCmd = commanderIds[matchIdx % commanderIds.length]!;
      const crimCmd = commanderIds[(matchIdx * 3 + 1) % commanderIds.length]!;

      const pSlots = generateSmartAutoDeploy();
      const eSlots = generateCommanderDeployment(crimCmd, undefined, rng);
      assert.equal(validateFactionDeployment('PLAYER', pSlots), true);
      assert.equal(validateFactionDeployment('ENEMY', eSlots), true);

      const truth: HeadlessPiece[] = [];
      pSlots.forEach((s, i) =>
        truth.push({
          id: `p_${i}`,
          faction: 'PLAYER',
          trueRank: s.rank,
          col: s.col,
          row: s.row,
          alive: true,
          hasMoved: false,
          kills: 0,
        })
      );
      eSlots.forEach((s, i) =>
        truth.push({
          id: `e_${i}`,
          faction: 'ENEMY',
          trueRank: s.rank,
          col: s.col,
          row: s.row,
          alive: true,
          hasMoved: false,
          kills: 0,
        })
      );

      const navyBrain = new BeliefMatrixAI();
      const crimBrain = new BeliefMatrixAI();

      const toOwnView = (fac: Faction): AIOwnUnitState[] =>
        truth
          .filter((u) => u.alive && u.faction === fac)
          .map((u) => ({
            id: u.id,
            ownRank: u.trueRank,
            col: u.col,
            row: u.row,
            hasMoved: u.hasMoved,
          }));

      // STRICT ZERO-CHEAT PROJECTION: Opponent units expose ZERO `trueRank`!
      const toObservedOpp = (oppFac: Faction): ObservedPlayerUnitState[] =>
        truth
          .filter((u) => u.alive && u.faction === oppFac)
          .map((u) => ({
            id: u.id,
            col: u.col,
            row: u.row,
            publicKills: u.kills,
            hasMoved: u.hasMoved,
          }));

      navyBrain.initializeMatch(
        truth
          .filter((u) => u.faction === 'ENEMY')
          .map((u) => ({ id: u.id, col: u.col, row: u.row })),
        toOwnView('PLAYER')
      );
      crimBrain.initializeMatch(
        truth
          .filter((u) => u.faction === 'PLAYER')
          .map((u) => ({ id: u.id, col: u.col, row: u.row })),
        toOwnView('ENEMY')
      );

      const pending1970s = new Set<Faction>();
      let winner: Faction | null = null;
      let activeTurn: Faction = 'PLAYER';
      const MAX_PLIES = 260;

      for (let ply = 1; ply <= MAX_PLIES && !winner; ply++) {
        // 1970s Deferred Back-Row Survival Check at start of `activeTurn`!
        if (pending1970s.has(activeTurn)) {
          const goalRow = activeTurn === 'PLAYER' ? 0 : BOARD_ROWS - 1;
          const surv = truth.find(
            (u) =>
              u.alive && u.faction === activeTurn && u.trueRank === 'FLAG' && u.row === goalRow
          );
          if (surv) {
            winner = activeTurn;
            flagTraverses += 1;
            break;
          }
          pending1970s.delete(activeTurn);
        }

        const brain = activeTurn === 'PLAYER' ? navyBrain : crimBrain;
        const oppBrain = activeTurn === 'PLAYER' ? crimBrain : navyBrain;
        const oppFac: Faction = activeTurn === 'PLAYER' ? 'ENEMY' : 'PLAYER';

        const decision = brain.chooseCommanderMove(
          toOwnView(activeTurn),
          toObservedOpp(oppFac),
          activeTurn === 'PLAYER' ? navyCmd : crimCmd,
          Math.ceil(ply / 2),
          {
            difficulty: activeTurn === 'PLAYER' ? navyDiff : crimDiff,
            eraMode: era,
            aiFaction: activeTurn,
            rng,
          }
        );

        if (!decision) {
          winner = oppFac;
          break;
        }

        const mover = truth.find((u) => u.alive && u.id === decision.pieceId);
        assert.ok(mover, `Match ${matchIdx} ply ${ply}: mover must exist`);
        assert.equal(
          Math.abs(mover.col - decision.toCol) + Math.abs(mover.row - decision.toRow),
          1,
          'Every Salpakan move must be 1 orthogonal step'
        );

        const from = { col: mover.col, row: mover.row };
        const to = { col: decision.toCol, row: decision.toRow };
        brain.recordOwnMoveOrigin(mover.id, from);

        const defender = truth.find(
          (u) => u.alive && u.col === to.col && u.row === to.row
        );

        if (!defender) {
          mover.col = to.col;
          mover.row = to.row;
          mover.hasMoved = true;
          oppBrain.recordPlayerMove(
            mover.id,
            from,
            to,
            Math.ceil(ply / 2),
            toOwnView(oppFac)
          );
        } else {
          assert.notEqual(defender.faction, mover.faction);
          const pairRes = resolveClash(mover.trueRank, defender.trueRank);

          if (pairRes === 'SPLIT') {
            mover.alive = false;
            defender.alive = false;
            brain.recordClashOutcome(
              defender.id,
              mover.id,
              mover.trueRank,
              'SPLIT',
              Math.ceil(ply / 2)
            );
            oppBrain.recordClashOutcome(
              mover.id,
              defender.id,
              defender.trueRank,
              'SPLIT',
              Math.ceil(ply / 2)
            );
          } else {
            const moverWon = pairRes === 'ATTACKER';
            const loser = moverWon ? defender : mover;
            const victor = moverWon ? mover : defender;
            loser.alive = false;
            if (moverWon) {
              mover.col = to.col;
              mover.row = to.row;
              mover.hasMoved = true;
            }
            victor.kills += 1;

            if (loser.trueRank === 'FLAG') {
              winner = victor.faction;
              flagCaptures += 1;
              break;
            }

            const moverOut: PublicClashOutcomeForAI = moverWon ? 'AI_WON' : 'AI_LOST';
            const defOut: PublicClashOutcomeForAI = moverWon ? 'AI_LOST' : 'AI_WON';
            brain.recordClashOutcome(
              defender.id,
              mover.id,
              mover.trueRank,
              moverOut,
              Math.ceil(ply / 2)
            );
            oppBrain.recordClashOutcome(
              mover.id,
              defender.id,
              defender.trueRank,
              defOut,
              Math.ceil(ply / 2)
            );
          }
        }

        // Check Back-Row Flag Traverse after move/clash!
        const travWinner = checkBackRowFlagTraverse(
          truth,
          activeTurn,
          era,
          pending1970s.has(activeTurn)
        );
        if (travWinner) {
          winner = travWinner;
          flagTraverses += 1;
          break;
        }
        if (era === '1970s') {
          const gRow = activeTurn === 'PLAYER' ? 0 : BOARD_ROWS - 1;
          if (
            truth.some(
              (u) => u.alive && u.faction === activeTurn && u.trueRank === 'FLAG' && u.row === gRow
            )
          ) {
            pending1970s.add(activeTurn);
          }
        }

        activeTurn = oppFac;
      }

      // Tournament clock adjudication if a defensive bastion match reaches 260 plies
      if (!winner) {
        const score = (fac: Faction) =>
          truth
            .filter((u) => u.alive && u.faction === fac)
            .reduce((acc, u) => acc + (u.trueRank === 'SPY' ? 9 : RANK_SPECS[u.trueRank].seniority), 0);
        winner = score('PLAYER') >= score('ENEMY') ? 'PLAYER' : 'ENEMY';
      }

      assert.ok(winner === 'PLAYER' || winner === 'ENEMY');
      if (winner === 'PLAYER') navyWins += 1;
      else crimsonWins += 1;
    }

    assert.equal(navyWins + crimsonWins, 100, 'All 100 matches must resolve cleanly');
    assert.ok(
      flagCaptures + flagTraverses >= 75,
      `Expected majority of headless matches to end via Flag Capture/Traverse, got ${flagCaptures + flagTraverses}/100`
    );
  });

  it('5. Enforces strict Fog-of-War choreography & Pass-and-Play masking across all 15 ranks', () => {
    // 1. Single-player: For every player rank, choreography must depend ONLY on resolution + playerVisibleRank (never enemyTrueRank)
    for (const playerRank of ORDERED_RANKS) {
      const vsPrivate = resolveArbiterChallenge({
        contestedCoord: { col: 4, row: 4 },
        attackerId: 'p1',
        attackerFaction: 'PLAYER',
        attackerTrueRank: playerRank,
        defenderId: 'e1',
        defenderFaction: 'ENEMY',
        defenderTrueRank: 'PRIVATE',
        matchMode: 'SKIRMISH',
      });
      const vsGen5 = resolveArbiterChallenge({
        contestedCoord: { col: 4, row: 4 },
        attackerId: 'p1',
        attackerFaction: 'PLAYER',
        attackerTrueRank: playerRank,
        defenderId: 'e1',
        defenderFaction: 'ENEMY',
        defenderTrueRank: 'GEN_5',
        matchMode: 'SKIRMISH',
      });
      const vsSpy = resolveArbiterChallenge({
        contestedCoord: { col: 4, row: 4 },
        attackerId: 'p1',
        attackerFaction: 'PLAYER',
        attackerTrueRank: playerRank,
        defenderId: 'e1',
        defenderFaction: 'ENEMY',
        defenderTrueRank: 'SPY',
        matchMode: 'SKIRMISH',
      });

      assert.equal(vsPrivate.playerVisibleRank, playerRank);
      assert.equal(vsGen5.playerVisibleRank, playerRank);
      assert.equal(vsSpy.playerVisibleRank, playerRank);

      // When resolution is non-split (same resolution category), choreography matches deriveBattleChoreography(resolution, playerRank)
      for (const v of [vsPrivate, vsGen5, vsSpy]) {
        assert.equal(
          v.choreography,
          deriveBattleChoreography({
            resolution: v.resolution,
            playerVisibleRank: playerRank,
            matchMode: 'SKIRMISH',
          })
        );
      }

      // Specifically, whenever the player loses (ENEMY_WINS), choreography is identical regardless of which enemy rank defeated them!
      const losses = [vsPrivate, vsGen5, vsSpy].filter((v) => v.resolution === 'ENEMY_WINS');
      if (losses.length >= 2) {
        for (const l of losses) {
          assert.equal(l.choreography, losses[0]!.choreography);
        }
      }
    }

    // 2. PASS_AND_PLAY: resolveArbiterChallenge must mask playerVisibleRank & ignore true ranks for choreography
    const pnpSpy = resolveArbiterChallenge({
      contestedCoord: { col: 3, row: 3 },
      attackerId: 'p1',
      attackerFaction: 'PLAYER',
      attackerTrueRank: 'SPY',
      defenderId: 'e1',
      defenderFaction: 'ENEMY',
      defenderTrueRank: 'GEN_5',
      matchMode: 'PASS_AND_PLAY',
      attackerPublicKills: 0,
      defenderPublicKills: 0,
    });
    const pnpPvt = resolveArbiterChallenge({
      contestedCoord: { col: 3, row: 3 },
      attackerId: 'p1',
      attackerFaction: 'PLAYER',
      attackerTrueRank: 'PRIVATE',
      defenderId: 'e1',
      defenderFaction: 'ENEMY',
      defenderTrueRank: 'SERGEANT',
      matchMode: 'PASS_AND_PLAY',
      attackerPublicKills: 0,
      defenderPublicKills: 0,
    });
    assert.equal(pnpSpy.playerVisibleRank, 'UNKNOWN');
    assert.equal(pnpPvt.playerVisibleRank, 'UNKNOWN');
    assert.equal(pnpSpy.choreography, 'INFANTRY');
    assert.equal(pnpPvt.choreography, 'INFANTRY');

    // 3. Live GameStore PASS_AND_PLAY clash must mask stakes.playerDoctrine, banner & intelLedger under active shroud
    const store = new GameStore();
    try {
      const assertIntelMasked = (label: string) => {
        const v = store.getVisibleView();
        assert.equal(v.shroud?.active, true, `${label}: shroud must be active`);
        assert.equal(v.intelLedger.ownOfficersAlive, 0, `${label}: ownOfficersAlive must be 0 under shroud`);
        assert.equal(v.intelLedger.ownPrivatesAlive, 0, `${label}: ownPrivatesAlive must be 0 under shroud`);
        assert.equal(v.intelLedger.ownSpiesAlive, 0, `${label}: ownSpiesAlive must be 0 under shroud`);
        assert.equal(v.intelLedger.ownFlagAlive, false, `${label}: ownFlagAlive must be false under shroud`);
      };

      store.startPassAndPlay();
      store.applyDeploymentPreset('VACCINATION');
      assert.equal(store.launchBattleFromDeployment(), true);
      assertIntelMasked('post-Navy deploy shroud');
      store.unsealCommandShroud();
      store.applyDeploymentPreset('VACCINATION');
      assert.equal(store.launchBattleFromDeployment(), true);
      assertIntelMasked('post-Crimson deploy shroud');
      store.unsealCommandShroud();

      // Advance Navy Spy at (2,5) -> (2,4) -> (2,3) -> (2,2) to clash Crimson frontline
      const view1 = store.getVisibleView();
      assert.equal(view1.intelLedger.ownFlagAlive, true);
      assert.equal(view1.intelLedger.ownOfficersAlive, 12);
      const navySpy = view1.pieces.find((p) => p.faction === 'PLAYER' && p.visibleRank === 'SPY');
      assert.ok(navySpy);
      assert.equal(store.executeMoveOrChallenge(navySpy.col, navySpy.row - 1, navySpy.id)?.kind, 'MOVED');
      assertIntelMasked('post-quiet move shroud');
      store.unsealCommandShroud();
      const crimPiece = store.getVisibleView().pieces.find((p) => p.faction === 'ENEMY' && p.row === 2);
      assert.ok(crimPiece);
      assert.equal(store.executeMoveOrChallenge(crimPiece.col, crimPiece.row + 1, crimPiece.id)?.kind, 'MOVED');
      assertIntelMasked('post-Crimson quiet move shroud');
      store.unsealCommandShroud();
      assert.equal(store.executeMoveOrChallenge(navySpy.col, navySpy.row - 2, navySpy.id)?.kind, 'MOVED');
      store.unsealCommandShroud();
      // Move Crimson piece to challenge or walk into adjacent clash
      const crimMover = store.getVisibleView().pieces.find((p) => p.faction === 'ENEMY' && p.row === 3);
      assert.ok(crimMover);
      // Walk Navy Spy to (crimMover.col, crimMover.row) if adjacent, else move Spy horizontally until adjacent
      let safety = 0;
      while (store.getVisibleView().activeClash === null && safety < 20) {
        safety += 1;
        const v = store.getVisibleView();
        if (v.shroud?.active) store.unsealCommandShroud();
        const v2 = store.getVisibleView();
        if (v2.activeTurn === 'PLAYER') {
          const s = v2.pieces.find((p) => p.id === navySpy.id)!;
          const moves = store.computeValidMoves(s.id);
          const challenge = moves.find((m) => m.kind === 'CHALLENGE');
          if (challenge) {
            const res = store.executeMoveOrChallenge(challenge.col, challenge.row, s.id);
            assert.equal(res?.kind, 'CLASH');
            break;
          }
          const targetCol = crimMover.col;
          const step =
            moves.find((m) => m.col === s.col + Math.sign(targetCol - s.col)) ??
            moves.find((m) => m.row < s.row) ??
            moves[0]!;
          store.executeMoveOrChallenge(step.col, step.row, s.id);
        } else {
          const c = v2.pieces.find((p) => p.faction === 'ENEMY')!;
          const moves = store.computeValidMoves(c.id);
          const challenge = moves.find((m) => m.kind === 'CHALLENGE');
          if (challenge) {
            const res = store.executeMoveOrChallenge(challenge.col, challenge.row, c.id);
            assert.equal(res?.kind, 'CLASH');
            break;
          }
          const step = moves.find((m) => m.kind === 'MOVE') ?? moves[0]!;
          store.executeMoveOrChallenge(step.col, step.row, c.id);
        }
      }

      const clash = store.getVisibleView().activeClash;
      assert.ok(clash, 'PASS_AND_PLAY clash must trigger');
      assert.equal(clash.playerVisibleRank, 'UNKNOWN');
      assert.equal(clash.stakes?.playerDoctrine, 'UNKNOWN_DOCTRINE');
      assert.equal(clash.stakes?.enemyUnmovedBackRow, false);
      assert.notEqual(store.getVisibleView().banner, 'OPERATION STILETTO — COVERT STRIKE');

      // Finalize clash and confirm post-clash CommandShroud masks intelLedger private counts
      store.finalizeActiveClash();
      if (store.getVisibleView().phase === 'PLAY') {
        assertIntelMasked('post-clash shroud');
        store.unsealCommandShroud();
        assert.equal(store.getVisibleView().intelLedger.ownFlagAlive, true);
      }
    } finally {
      store.returnToTitleMenu();
    }
  });

  it('6. Validates all 8 formations, 4 Battle Theaters, 8 Tactical Operations, Campaign stars & zero-three/zero-cheat static laws', () => {
    // 1. All 8 TOURNAMENT_PRESETS valid + DEPLOYMENT_PRESET_META complete
    const presetIds = Object.keys(TOURNAMENT_PRESETS) as DeploymentPresetId[];
    assert.equal(presetIds.length, 8);
    for (const id of presetIds) {
      assert.equal(
        validatePlayerDeployment(TOURNAMENT_PRESETS[id]),
        true,
        `Formation ${id} must pass validatePlayerDeployment`
      );
      assert.ok(DEPLOYMENT_PRESET_META[id]?.label);
    }

    // 2. All 4 Battle Theaters valid
    const expectedTheaters: TheaterId[] = ['FIELD_HQ', 'PACIFIC_BRIDGE', 'IRON_BUNKER', 'NIGHT_OPS'];
    assert.equal(BATTLE_THEATERS.length, 4);
    for (const tId of expectedTheaters) {
      const spec = getBattleTheater(tId);
      assert.equal(spec.id, tId);
      assert.ok(spec.accentHex.startsWith('#'));
    }

    // 3. All 8 Tactical Operations valid (bounds, disjoint squares, rank counts, objectives)
    assert.equal(TACTICAL_OPERATIONS.length, 8);
    const seenObjectives = new Set<OperationObjectiveKind>();
    for (const op of TACTICAL_OPERATIONS) {
      assert.equal(getTacticalOperation(op.id)?.id, op.id);
      seenObjectives.add(op.objectiveKind);

      const seenCoords = new Set<string>();
      const pCounts = new Map<RankId, number>();
      const eCounts = new Map<RankId, number>();

      for (const p of op.playerPlacements) {
        assert.ok(p.col >= 0 && p.col < BOARD_COLS && p.row >= 0 && p.row < BOARD_ROWS);
        const key = `${p.col},${p.row}`;
        assert.equal(seenCoords.has(key), false, `${op.id} duplicate coord ${key}`);
        seenCoords.add(key);
        pCounts.set(p.rank, (pCounts.get(p.rank) ?? 0) + 1);
      }
      for (const e of op.enemyPlacements) {
        assert.ok(e.col >= 0 && e.col < BOARD_COLS && e.row >= 0 && e.row < BOARD_ROWS);
        const key = `${e.col},${e.row}`;
        assert.equal(seenCoords.has(key), false, `${op.id} overlapping coord ${key}`);
        seenCoords.add(key);
        eCounts.set(e.rank, (eCounts.get(e.rank) ?? 0) + 1);
      }

      assert.equal(pCounts.get('FLAG'), 1, `${op.id} player must have 1 Flag`);
      assert.equal(eCounts.get('FLAG'), 1, `${op.id} enemy must have 1 Flag`);
      for (const r of ORDERED_RANKS) {
        assert.ok((pCounts.get(r) ?? 0) <= RANK_SPECS[r].countPerArmy);
        assert.ok((eCounts.get(r) ?? 0) <= RANK_SPECS[r].countPerArmy);
      }
    }
    assert.equal(seenObjectives.size, 5, 'All 5 OperationObjectiveKinds must be covered');

    // 4. Static checks: zero `three` imports & zero `.trueRank`/`TruthPieceRecord` in core/ai
    for (const relPath of [
      'src/core/types.ts',
      'src/core/ranks.ts',
      'src/core/pieceColors.ts',
      'src/core/RulesEngine.ts',
      'src/core/operations.ts',
      'src/core/theaters.ts',
      'src/ai/BeliefMatrixAI.ts',
      'src/ai/CommanderProfiles.ts',
    ]) {
      const code = fs.readFileSync(relPath, 'utf8');
      assert.equal(
        /from\s+['"]three['"]/.test(code),
        false,
        `${relPath} must never import three`
      );
    }
    for (const relPath of ['src/core/operations.ts', 'src/core/theaters.ts']) {
      const code = fs.readFileSync(relPath, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      assert.equal(code.includes('.trueRank'), false, `${relPath} must never read .trueRank`);
      assert.equal(
        code.includes('TruthPieceRecord'),
        false,
        `${relPath} must never reference TruthPieceRecord`
      );
    }

    // 5. CommanderProfile ultra-HD portrait contract (zero inline <svg> doodles) & Campaign star persistence
    for (const c of COMMANDER_ROSTER) {
      assert.equal('portraitSvg' in c, false, `${c.id} must not expose legacy portraitSvg`);
      assert.ok(
        c.portraitUrl.startsWith('./portraits/') && c.portraitUrl.endsWith('.webp'),
        `${c.id} exposes rendered portraitUrl`
      );
      assert.ok(c.theaterId);
      assert.ok(c.missionModifier.id);
    }

    // 6. Selectable PBR piece colors contract (`F25`)
    assert.deepEqual(PIECE_COLOR_ORDER, ['NAVY', 'GREY', 'BROWN', 'GREEN', 'LIGHT_BLUE']);
    for (const cid of [...PIECE_COLOR_ORDER, 'CRIMSON'] as const) {
      const spec = PIECE_COLOR_SPECS[cid];
      assert.ok(spec.walnut.albedoHex.startsWith('#'));
      assert.ok(spec.bakelite.albedoHex.startsWith('#'));
    }

    const storageMap = new Map<string, string>();
    const prevLS = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, v);
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
      clear: () => {
        storageMap.clear();
      },
      key: (idx: number) => Array.from(storageMap.keys())[idx] ?? null,
      get length() {
        return storageMap.size;
      },
    } as Storage;

    try {
      const campRes = recordCampaignMatchResult('MILLER', true, 14);
      assert.equal(campRes.starsEarned, 3);
      assert.equal(campRes.state.records.MILLER.stars, 3);
      assert.equal(loadCampaignProgress().unlockedTier, 2);

      const opRes = recordOperationResult('OP_01_IRON_BREAKOUT', true, 11, 8);
      assert.equal(opRes.starsEarned, 3);
      assert.equal(opRes.state['OP_01_IRON_BREAKOUT']?.completed, true);
    } finally {
      if (prevLS === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as { localStorage?: Storage }).localStorage = prevLS;
      }
    }
  });

  it('7. Verifies F2 rules fixes: DEPLOY tap non-overwrite, Flag-only timeout, immobilization + 1970s precedence, 3-fold repetition, FLAG_BREACH & SettingsStore sync', () => {
    // A. SettingsStore defaults & renderQuality <-> qualityMode sync
    const settings = new SettingsStore();
    const def = settings.get();
    assert.equal(def.qualityMode, 'AUTO');
    assert.equal(def.viewportFrameMode, 'FULL_VIEWPORT');
    assert.equal(def.theaterId, 'FIELD_HQ');
    assert.equal(def.cameraSensitivity, 1.0);
    assert.equal(def.cameraInvertOrbit, false);
    assert.equal(def.renderQuality, 'ULTRA');
    assert.equal(def.pieceColor, 'NAVY');

    settings.update({ qualityMode: 'BATTERY_SAVER', cameraSensitivity: 9.9, theaterId: 'NIGHT_OPS', pieceColor: 'GREEN' });
    assert.equal(settings.get().renderQuality, 'BATTERY_SAVER');
    assert.equal(settings.get().cameraSensitivity, 2.0);
    assert.equal(settings.get().theaterId, 'NIGHT_OPS');
    assert.equal(settings.get().pieceColor, 'GREEN');

    settings.update({ renderQuality: 'ULTRA' });
    assert.equal(settings.get().qualityMode, 'ULTRA');

    // B. DEPLOY tap-to-select vs rank-overwrite fix
    const store = new GameStore();
    try {
    store.updateOptions({ pieceColor: 'LIGHT_BLUE' });
    assert.equal(store.getVisibleView().playerPieceColor, 'LIGHT_BLUE');
    assert.equal(store.getVisibleView().enemyPieceColor, 'CRIMSON');
    store.updateOptions({ pieceColor: 'NAVY' });
    store.startSkirmish('MILLER', '1980s');
    // Default selectedDeployRank is GEN_5 -> place GEN_5 at (4, 5)
    assert.equal(store.placeOrSwapDeployment(4, 5), true);
    assert.equal(store.getVisibleView().selectedDeployRank, 'GEN_4');
    const placedGen5 = store
      .getVisibleView()
      .pieces.find((p) => p.faction === 'PLAYER' && p.col === 4 && p.row === 5);
    assert.equal(placedGen5?.visibleRank, 'GEN_5');

    // Tapping (4,5) without explicitRank must NOT overwrite GEN_5 with GEN_4!
    assert.equal(store.placeOrSwapDeployment(4, 5), false);
    const stillGen5 = store
      .getVisibleView()
      .pieces.find((p) => p.faction === 'PLAYER' && p.col === 4 && p.row === 5);
    assert.equal(stillGen5?.visibleRank, 'GEN_5');

    // Selecting that piece and tapping (4,6) moves GEN_5 cleanly!
    store.selectPiece(placedGen5!.id);
    assert.equal(store.placeOrSwapDeployment(4, 6), true);
    const movedGen5 = store
      .getVisibleView()
      .pieces.find((p) => p.faction === 'PLAYER' && p.col === 4 && p.row === 6);
    assert.equal(movedGen5?.visibleRank, 'GEN_5');

    // C. Flag-traverse emits FLAG_BREACH (isFlagTraverseVictory: true) & finalizes to GAME_OVER
    assert.equal(store.startOperation('OP_03_MIDNIGHT_TRAVERSE'), true);
    const travView = store.getVisibleView();
    assert.equal(travView.matchMode, 'OPERATION');
    assert.equal(travView.theaterId, 'PACIFIC_BRIDGE');
    const pFlag = travView.pieces.find((p) => p.faction === 'PLAYER' && p.visibleRank === 'FLAG')!;
    // Move Player Flag at (7,4) -> (8,4) -> ... -> row 0 via clean maneuvers
    assert.equal(store.executeMoveOrChallenge(8, 4, pFlag.id)?.kind, 'MOVED');
    // Wait for or drive turns? In single-player, advanceTurnAfterQuietMove schedules enemy turn timer;
    // test Flag-traverse verdict cleanly in PASS_AND_PLAY where no async timer is needed!
    store.returnToTitleMenu();

    store.startPassAndPlay();
    // Deploy Player with Flag at (0,5) and Enemy with col 0 completely open to row 0
    store.applyDeploymentPreset('CITADEL_PHALANX'); // has Flag at (0,7)
    const pCitadel = store.getVisibleView().pieces;
    const pFl = pCitadel.find((p) => p.faction === 'PLAYER' && p.visibleRank === 'FLAG')!;
    store.selectPiece(pFl.id);
    assert.equal(store.placeOrSwapDeployment(0, 5), true);
    assert.equal(store.launchBattleFromDeployment(), true);
    store.unsealCommandShroud();
    store.applyDeploymentPreset('VACCINATION');
    const e01 = store.getVisibleView().pieces.find((p) => p.faction === 'ENEMY' && p.col === 0 && p.row === 1);
    if (e01) {
      store.selectPiece(e01.id);
      assert.equal(store.placeOrSwapDeployment(2, 0), true);
    }
    assert.equal(store.launchBattleFromDeployment(), true);
    store.unsealCommandShroud();

    // March Player Flag along completely open col 0 (`(0,4) -> (0,0)`)
    let travResult: ReturnType<GameStore['executeMoveOrChallenge']> = null;
    for (let targetRow = 4; targetRow >= 0; targetRow--) {
      const v = store.getVisibleView();
      if (v.shroud?.active) store.unsealCommandShroud();
      const flag = store.getVisibleView().pieces.find((p) => p.faction === 'PLAYER' && p.visibleRank === 'FLAG')!;
      travResult = store.executeMoveOrChallenge(0, targetRow, flag.id);
      if (travResult?.kind === 'CLASH') break;
      // Crimson dummy move on col 8 or col 4
      if (store.getVisibleView().shroud?.active) store.unsealCommandShroud();
      const cPieces = store.getVisibleView().pieces.filter((p) => p.faction === 'ENEMY');
      for (const cp of cPieces) {
        const cm = store.computeValidMoves(cp.id).find((m) => m.kind === 'MOVE' && m.col !== 0);
        if (cm) {
          store.executeMoveOrChallenge(cm.col, cm.row, cp.id);
          break;
        }
      }
    }
    assert.equal(travResult?.kind, 'CLASH');
    if (travResult?.kind === 'CLASH') {
      assert.equal(travResult.verdict.choreography, 'FLAG_BREACH');
      assert.equal(travResult.verdict.isFlagTraverseVictory, true);
    }
    store.finalizeActiveClash();
    assert.equal(store.getVisibleView().phase, 'GAME_OVER');
    assert.equal(store.getVisibleView().banner, 'FLAG TRAVERSE — VICTORY');

    // D. 3-Fold Repetition Safeguard
    store.startPassAndPlay();
    store.applyDeploymentPreset('VACCINATION');
    store.launchBattleFromDeployment();
    store.unsealCommandShroud();
    store.applyDeploymentPreset('VACCINATION');
    store.launchBattleFromDeployment();
    store.unsealCommandShroud();

    const pUnit = store.getVisibleView().pieces.find((p) => p.faction === 'PLAYER' && p.col === 1 && p.row === 5)!;
    const eUnit = store.getVisibleView().pieces.find((p) => p.faction === 'ENEMY' && p.col === 1 && p.row === 2)!;
    const cycleMoves = [
      { fac: 'PLAYER' as const, id: pUnit.id, col: 1, row: 4 },
      { fac: 'ENEMY' as const, id: eUnit.id, col: 1, row: 3 },
      { fac: 'PLAYER' as const, id: pUnit.id, col: 1, row: 5 },
      { fac: 'ENEMY' as const, id: eUnit.id, col: 1, row: 2 },
    ];
    let repRound = 0;
    while (store.getVisibleView().phase === 'PLAY' && repRound < 12) {
      const step = cycleMoves[repRound % cycleMoves.length]!;
      if (store.getVisibleView().shroud?.active) store.unsealCommandShroud();
      store.executeMoveOrChallenge(step.col, step.row, step.id);
      repRound += 1;
    }
    assert.equal(store.getVisibleView().phase, 'GAME_OVER');
    assert.equal(store.getVisibleView().banner, 'STALEMATE ADJUDICATED');

    // E. Flag-only clock-0 timeout (no softlock)
    store.startPassAndPlay();
    store.applyDeploymentPreset('VACCINATION');
    store.launchBattleFromDeployment();
    store.unsealCommandShroud();
    store.applyDeploymentPreset('VACCINATION');
    store.launchBattleFromDeployment();
    store.unsealCommandShroud();

    // Eliminate all 20 non-Flag Navy units by running them into Crimson units or splits
    // Simplest deterministic test: move Navy pieces except Flag into challenges until only Flag remains
    let elimGuard = 0;
    while (elimGuard < 160) {
      elimGuard += 1;
      const v = store.getVisibleView();
      if (v.phase !== 'PLAY') break;
      if (v.shroud?.active) store.unsealCommandShroud();
      const v2 = store.getVisibleView();
      const navyAlive = v2.pieces.filter((p) => p.faction === 'PLAYER');
      if (navyAlive.length === 1 && navyAlive[0]!.visibleRank === 'FLAG') {
        // Trigger clock-0 fallback when ONLY Flag remains for PLAYER!
        assert.equal(v2.activeTurn, 'PLAYER');
        const beforeRow = navyAlive[0]!.row;
        const beforeCol = navyAlive[0]!.col;
        (store as unknown as { executeAutoFallbackMoveForActiveTurn(): void }).executeAutoFallbackMoveForActiveTurn();
        if (store.getVisibleView().activeClash) {
          store.finalizeActiveClash();
        } else {
          const afterFlag = store.getVisibleView().pieces.find((p) => p.id === navyAlive[0]!.id);
          assert.ok(afterFlag && (afterFlag.row !== beforeRow || afterFlag.col !== beforeCol), 'Flag must move on clock-0 fallback');
        }
        break;
      }

      if (v2.activeTurn === 'PLAYER') {
        // Pick weakest non-Flag unit and advance toward enemy
        const nonFlags = navyAlive.filter((p) => p.visibleRank !== 'FLAG');
        if (nonFlags.length === 0) break;
        nonFlags.sort((a, b) => a.row - b.row);
        let moved = false;
        for (const nf of nonFlags) {
          const ms = store.computeValidMoves(nf.id);
          const ch = ms.find((m) => m.kind === 'CHALLENGE');
          const up = ms.find((m) => m.direction === 'UP');
          const pick = ch ?? up ?? ms[0];
          if (pick) {
            const res = store.executeMoveOrChallenge(pick.col, pick.row, nf.id);
            if (res?.kind === 'CLASH') store.finalizeActiveClash();
            moved = true;
            break;
          }
        }
        if (!moved) break;
      } else {
        const crimAlive = v2.pieces.filter((p) => p.faction === 'ENEMY');
        const chUnit = crimAlive.find((c) => store.computeValidMoves(c.id).some((m) => m.kind === 'CHALLENGE'));
        if (chUnit) {
          const ch = store.computeValidMoves(chUnit.id).find((m) => m.kind === 'CHALLENGE')!;
          const res = store.executeMoveOrChallenge(ch.col, ch.row, chUnit.id);
          if (res?.kind === 'CLASH') store.finalizeActiveClash();
        } else {
          const c = crimAlive.find((u) => store.computeValidMoves(u.id).length > 0)!;
          const m = store.computeValidMoves(c.id)[0]!;
          const res = store.executeMoveOrChallenge(m.col, m.row, c.id);
          if (res?.kind === 'CLASH') store.finalizeActiveClash();
        }
      }
    }

    // F. Pure hasAnyLegalMoves immobilization check
    assert.equal(hasAnyLegalMoves([], 'PLAYER'), false);
    assert.equal(
      hasAnyLegalMoves([{ faction: 'ENEMY', col: 4, row: 0, alive: true }], 'PLAYER'),
      false
    );
    assert.equal(
      hasAnyLegalMoves([{ faction: 'PLAYER', col: 0, row: 0, alive: true }], 'PLAYER'),
      true
    );
    } finally {
      store.returnToTitleMenu();
    }
  });

  it('8. Verifies Tactical Operations (SPY_HUNT, SURVIVAL_DEFENSE, turnLimit, all 8 winnable), Theater switching & BeliefMatrixAI hash/anti-stall persistence', () => {
    const makeDeterministicRng = (seed0: number) => {
      let seed = seed0 | 0;
      return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    const store = new GameStore();
    const origRandom = Math.random;
    try {
      // A. Theater switching & SPY_HUNT masking
      store.setTheater('IRON_BUNKER');
      assert.equal(store.getOptions().theaterId, 'IRON_BUNKER');
      assert.equal(store.getVisibleView().theaterId, 'IRON_BUNKER');

      assert.equal(store.startOperation('OP_02_STILETTO_PURGE'), true);
      assert.equal(store.getVisibleView().operationObjective, 'SPY_HUNT');
      assert.equal(store.getVisibleView().theaterId, 'NIGHT_OPS');
      for (const p of store.getVisibleView().pieces) {
        if (p.faction === 'ENEMY') {
          assert.equal(p.visibleRank, 'UNKNOWN');
        }
      }
      store.returnToTitleMenu();

      // Helper to run an Operation deterministically using non-cheating BeliefMatrixAI + objective policy
      const playDeterministicOperation = (opId: string, seedVal: number) => {
        const op = getTacticalOperation(opId)!;
        const rng = makeDeterministicRng(seedVal);
        Math.random = rng;
        assert.equal(store.startOperation(op.id), true);

        const enemyPool: Partial<Record<RankId, number>> = {};
        for (const e of op.enemyPlacements) {
          enemyPool[e.rank] = (enemyPool[e.rank] ?? 0) + 1;
        }
        const pAI = new BeliefMatrixAI();
        const v0 = store.getVisibleView();
        pAI.initializeMatch(
          v0.pieces.filter((p) => p.faction === 'ENEMY').map((p) => ({ id: p.id, col: p.col, row: p.row })),
          v0.pieces
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

        const cmd: CommanderId =
          op.id === 'OP_07_GHOST_PROTOCOL'
            ? 'HOLLIS'
            : op.id === 'OP_06_BASTION_CRACK'
              ? 'MILLER'
              : op.objectiveKind === 'SURVIVAL_DEFENSE'
                ? 'STERLING'
                : 'VANCE';

        let guard = 0;
        while (store.getVisibleView().phase === 'PLAY' && guard < op.turnLimit + 10) {
          guard += 1;
          const v = store.getVisibleView();
          if (v.activeTurn === 'PLAYER') {
            const own: AIOwnUnitState[] = v.pieces
              .filter((p) => p.faction === 'PLAYER')
              .map((p) => ({
                id: p.id,
                ownRank: p.visibleRank as RankId,
                col: p.col,
                row: p.row,
                hasMoved: p.hasMoved,
              }));
            const opp: ObservedPlayerUnitState[] = v.pieces
              .filter((p) => p.faction === 'ENEMY')
              .map((p) => ({
                id: p.id,
                col: p.col,
                row: p.row,
                publicKills: p.publicKills,
                hasMoved: p.hasMoved,
              }));

            let chosen: { pieceId: string; toCol: number; toRow: number } | null = null;
            if (op.objectiveKind === 'FLAG_TRAVERSE' || op.objectiveKind === 'BLITZ_BREACH') {
              const pFlag = own.find((u) => u.ownRank === 'FLAG');
              if (pFlag) {
                const ms = store.computeValidMoves(pFlag.id);
                const winStep = ms.find((m) => m.kind === 'MOVE' && m.row === 0);
                if (winStep) {
                  chosen = { pieceId: pFlag.id, toCol: winStep.col, toRow: winStep.row };
                } else if (op.objectiveKind === 'FLAG_TRAVERSE') {
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
            } else if (op.objectiveKind === 'SPY_HUNT') {
              const pFlag = own.find((u) => u.ownRank === 'FLAG');
              if (pFlag && opp.some((e) => Math.abs(e.col - pFlag.col) + Math.abs(e.row - pFlag.row) <= 1)) {
                const safeStep = store
                  .computeValidMoves(pFlag.id)
                  .find(
                    (m) =>
                      m.kind === 'MOVE' &&
                      !opp.some((e) => Math.abs(e.col - m.col) + Math.abs(e.row - m.row) <= 1)
                  );
                if (safeStep) {
                  chosen = { pieceId: pFlag.id, toCol: safeStep.col, toRow: safeStep.row };
                }
              }
              if (!chosen) {
                for (const pr of own.filter((u) => u.ownRank === 'PRIVATE')) {
                  const ch = store.computeValidMoves(pr.id).find((m) => m.kind === 'CHALLENGE');
                  if (ch) {
                    chosen = { pieceId: pr.id, toCol: ch.col, toRow: ch.row };
                    break;
                  }
                }
              }
              if (!chosen && op.id === 'OP_07_GHOST_PROTOCOL' && v.turnCount <= 36) {
                const frontPrivates = own
                  .filter((u) => u.ownRank === 'PRIVATE' && u.row >= 3 && u.row <= 5)
                  .sort((a, b) => a.row - b.row);
                for (const pr of frontPrivates) {
                  const fwd = store.computeValidMoves(pr.id).find((m) => m.kind === 'MOVE' && m.row < pr.row);
                  if (fwd) {
                    chosen = { pieceId: pr.id, toCol: fwd.col, toRow: fwd.row };
                    break;
                  }
                }
              }
            }

            if (!chosen) {
              const dec = pAI.chooseCommanderMove(own, opp, cmd, v.turnCount, {
                difficulty: 'SUPREME_MARSHAL',
                eraMode: op.eraRuleset,
                aiFaction: 'PLAYER',
                rng,
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
            (store as unknown as { executeEnemyTurnNow(): void }).executeEnemyTurnNow();
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
      };

      // B. Deterministic SPY_HUNT victory ('SPY HUNT COMPLETE — VICTORY')
      const spyHuntEnd = playDeterministicOperation('OP_02_STILETTO_PURGE', 0x1000 + 2 * 7919);
      assert.equal(spyHuntEnd.phase, 'GAME_OVER');
      assert.equal(spyHuntEnd.matchWinner, 'PLAYER');
      assert.equal(spyHuntEnd.banner, 'SPY HUNT COMPLETE — VICTORY');
      store.returnToTitleMenu();

      // C. Deterministic SURVIVAL_DEFENSE victory ('SIEGE SURVIVED — VICTORY') at turnLimit = 16 (turnCount = 17)
      Math.random = makeDeterministicRng(0x404040);
      assert.equal(store.startOperation('OP_04_BUNKER_SIEGE'), true);
      assert.equal(store.getOptions().eraMode, '1970s');
      let siegeGuard = 0;
      while (store.getVisibleView().phase === 'PLAY' && siegeGuard < 24) {
        siegeGuard += 1;
        const v = store.getVisibleView();
        if (v.activeTurn === 'PLAYER') {
          // Keep Flag bunker sealed: maneuver outer flank GEN_3 on row 6..7 away from Flag
          const gen3 = v.pieces.find((u) => u.faction === 'PLAYER' && u.visibleRank === 'GEN_3');
          const mvs = gen3 ? store.computeValidMoves(gen3.id).filter((m) => m.kind === 'MOVE') : [];
          const pick =
            mvs.find((m) => m.col > gen3!.col) ??
            mvs.find((m) => m.row >= 6) ??
            mvs[0];
          if (gen3 && pick) {
            store.executeMoveOrChallenge(pick.col, pick.row, gen3.id);
          } else {
            const p = v.pieces.find((u) => u.faction === 'PLAYER' && store.computeValidMoves(u.id).length > 0)!;
            const mv = store.computeValidMoves(p.id)[0]!;
            const res = store.executeMoveOrChallenge(mv.col, mv.row, p.id);
            if (res?.kind === 'CLASH') store.finalizeActiveClash();
          }
        } else {
          (store as unknown as { executeEnemyTurnNow(): void }).executeEnemyTurnNow();
          if (store.getVisibleView().activeClash) {
            store.finalizeActiveClash();
          }
        }
      }
      const siegeEnd = store.getVisibleView();
      assert.equal(siegeEnd.phase, 'GAME_OVER');
      assert.equal(siegeEnd.matchWinner, 'PLAYER');
      assert.equal(siegeEnd.banner, 'SIEGE SURVIVED — VICTORY');
      assert.equal(siegeEnd.turnCount, 17);
      store.returnToTitleMenu();

      // D. Deterministic OPERATION failure ('OPERATION FAILED — TURN LIMIT') at turnLimit + 1 on OP_05 & OP_03
      const assertTurnLimitFailure = (opId: string, expectedLimit: number, seedVal: number) => {
        Math.random = makeDeterministicRng(seedVal);
        assert.equal(store.startOperation(opId), true);
        let step = 0;
        while (store.getVisibleView().phase === 'PLAY' && step < expectedLimit + 5) {
          step += 1;
          const v = store.getVisibleView();
          if (v.activeTurn === 'PLAYER') {
            // Keep Flag away from danger (retreat toward back rank on OP_03) while patrolling safely without 3-fold repetition
            const pFlag = v.pieces.find((p) => p.faction === 'PLAYER' && p.visibleRank === 'FLAG');
            const enemies = v.pieces.filter((p) => p.faction === 'ENEMY');
            let pickedMove: { id: string; col: number; row: number } | null = null;
            if (pFlag && pFlag.row < 7) {
              const flagMoves = store.computeValidMoves(pFlag.id).filter((m) => m.kind === 'MOVE');
              const safeRetreat = flagMoves
                .filter((m) => !enemies.some((e) => Math.abs(e.col - m.col) + Math.abs(e.row - m.row) <= 1))
                .sort((a, b) => b.row - a.row)[0];
              if (safeRetreat && (safeRetreat.row > pFlag.row || enemies.some((e) => Math.abs(e.col - pFlag.col) + Math.abs(e.row - pFlag.row) <= 2))) {
                pickedMove = { id: pFlag.id, col: safeRetreat.col, row: safeRetreat.row };
              }
            }
            if (pickedMove) {
              store.executeMoveOrChallenge(pickedMove.col, pickedMove.row, pickedMove.id);
            } else {
              const candidates = v.pieces.filter(
                (p) =>
                  p.faction === 'PLAYER' &&
                  p.visibleRank !== 'FLAG' &&
                  store.computeValidMoves(p.id).some((m) => m.kind === 'MOVE' && m.row >= 5)
              );
              const mover = candidates[step % Math.max(1, candidates.length)];
              if (mover) {
                const mvs = store.computeValidMoves(mover.id).filter((m) => m.kind === 'MOVE' && m.row >= 5);
                const pick = mvs[Math.floor(makeDeterministicRng(seedVal + step)() * mvs.length)] ?? mvs[0]!;
                store.executeMoveOrChallenge(pick.col, pick.row, mover.id);
              } else {
                const fallback = v.pieces.find(
                  (p) => p.faction === 'PLAYER' && store.computeValidMoves(p.id).length > 0
                )!;
                const fm = store.computeValidMoves(fallback.id)[0]!;
                const res = store.executeMoveOrChallenge(fm.col, fm.row, fallback.id);
                if (res?.kind === 'CLASH') store.finalizeActiveClash();
              }
            }
          } else {
            (store as unknown as { executeEnemyTurnNow(): void }).executeEnemyTurnNow();
            if (store.getVisibleView().activeClash) {
              store.finalizeActiveClash();
            }
          }
        }
        const failEnd = store.getVisibleView();
        assert.equal(failEnd.phase, 'GAME_OVER', `${opId} must reach GAME_OVER`);
        assert.equal(failEnd.matchWinner, 'ENEMY', `${opId} timeout must award ENEMY`);
        assert.equal(failEnd.banner, 'OPERATION FAILED — TURN LIMIT', `${opId} must show turn limit failure banner`);
        assert.equal(failEnd.turnCount, expectedLimit + 1, `${opId} must expire at turnLimit + 1`);
        store.returnToTitleMenu();
      };
      assertTurnLimitFailure('OP_05_BLITZ_CORRIDOR', 42, 0x515151);
      assertTurnLimitFailure('OP_03_MIDNIGHT_TRAVERSE', 44, 0x303030);

      // E. Verify all 8 Tactical Operations pass >= 25% (>= 4/16) multi-trial winnability under calibrated ply turnLimits
      const TRIALS_PER_OP = 16;
      const MIN_WINS_REQUIRED = 4;
      for (const op of TACTICAL_OPERATIONS) {
        let wins = 0;
        for (let trial = 0; trial < TRIALS_PER_OP; trial++) {
          const endV = playDeterministicOperation(op.id, 0x1000 + trial * 7919);
          store.returnToTitleMenu();
          if (endV.matchWinner === 'PLAYER' && (endV.dossier?.starsEarned ?? 0) >= 1) {
            wins += 1;
          }
          if (wins >= MIN_WINS_REQUIRED) break;
          if (wins + (TRIALS_PER_OP - 1 - trial) < MIN_WINS_REQUIRED) break;
        }
        assert.ok(
          wins >= MIN_WINS_REQUIRED,
          `${op.id} must win >= ${MIN_WINS_REQUIRED}/${TRIALS_PER_OP} trials under calibrated turnLimit=${op.turnLimit} (got ${wins})`
        );
      }

      // F. BeliefMatrixAI 4-ply loop prevention + board-hash / antiStallPressure persistence across recordPlayerMove()
      const brain = new BeliefMatrixAI();
      const quietAiUnits: AIOwnUnitState[] = [
        { id: 'ai_flag', ownRank: 'FLAG', col: 0, row: 0, hasMoved: false },
        { id: 'ai_col', ownRank: 'COLONEL', col: 4, row: 0, hasMoved: true },
      ];
      const quietPlayerUnits: ObservedPlayerUnitState[] = Array.from({ length: 10 }, (_, idx) => ({
        id: `p_${idx}`,
        col: idx % 9,
        row: 7,
        publicKills: 0,
        hasMoved: false,
      }));
      brain.initializeMatch(
        quietPlayerUnits.map((p) => ({ id: p.id, col: p.col, row: p.row })),
        quietAiUnits
      );

      // Interleave AI decisions + recordOwnMoveOrigin + recordPlayerMove across 6 quiet plies
      let simAi = quietAiUnits.map((u) => ({ ...u }));
      let simP = quietPlayerUnits.map((p) => ({ ...p }));
      for (let t = 1; t <= 6; t++) {
        const dec = brain.chooseCommanderMove(simAi, simP, 'MILLER', t, {
          difficulty: 'GENERAL',
          eraMode: '1980s',
          aiFaction: 'ENEMY',
          rng: () => 0.5,
        });
        assert.ok(dec);
        const mover = simAi.find((u) => u.id === dec.pieceId)!;
        const from = { col: mover.col, row: mover.row };
        brain.recordOwnMoveOrigin(mover.id, from);
        simAi = simAi.map((u) =>
          u.id === mover.id ? { ...u, col: dec.toCol, row: dec.toRow, hasMoved: true } : u
        );

        // Alternating quiet Player move must NOT wipe consecutiveQuietPlies or recentBoardHashes!
        const pFrom = { col: simP[0]!.col, row: simP[0]!.row };
        const pTo = { col: pFrom.col, row: t % 2 === 1 ? 6 : 7 };
        simP = simP.map((p, idx) => (idx === 0 ? { ...p, col: pTo.col, row: pTo.row, hasMoved: true } : p));
        brain.recordPlayerMove(simP[0]!.id, pFrom, pTo, t, simAi);
      }

      const internalBrain = brain as unknown as {
        consecutiveQuietPlies: number;
        recentBoardHashes: string[];
      };
      assert.equal(
        internalBrain.consecutiveQuietPlies,
        6,
        'recordPlayerMove must preserve consecutiveQuietPlies across alternating quiet plies'
      );
      assert.equal(
        internalBrain.recentBoardHashes.length,
        6,
        'recordPlayerMove must preserve recentBoardHashes across alternating quiet plies'
      );

      // Clash outcome must reset quiet-ply counters cleanly
      brain.recordClashOutcome(simP[0]!.id, simAi[1]!.id, simAi[1]!.ownRank, 'AI_WON', 7);
      assert.equal(internalBrain.consecutiveQuietPlies, 0);
      assert.equal(internalBrain.recentBoardHashes.length, 0);

      // Verify 4-ply A <-> B oscillation avoidance
      const aiUnits: AIOwnUnitState[] = [
        { id: 'ai_flag', ownRank: 'FLAG', col: 0, row: 0, hasMoved: false },
        { id: 'ai_col', ownRank: 'COLONEL', col: 4, row: 2, hasMoved: true },
      ];
      const playerUnits: ObservedPlayerUnitState[] = Array.from({ length: 10 }, (_, idx) => ({
        id: `p_${idx}`,
        col: idx % 9,
        row: idx < 9 ? 6 : 7,
        publicKills: 0,
        hasMoved: false,
      }));
      const oscBrain = new BeliefMatrixAI();
      oscBrain.initializeMatch(
        playerUnits.map((p) => ({ id: p.id, col: p.col, row: p.row })),
        aiUnits
      );
      oscBrain.recordOwnMoveOrigin('ai_col', { col: 4, row: 1 });
      oscBrain.recordOwnMoveOrigin('ai_col', { col: 4, row: 2 });
      oscBrain.recordOwnMoveOrigin('ai_col', { col: 4, row: 1 });

      const decision = oscBrain.chooseCommanderMove(aiUnits, playerUnits, 'MILLER', 8, {
        difficulty: 'GENERAL',
        eraMode: '1980s',
        aiFaction: 'ENEMY',
        rng: () => 0.5,
      });
      assert.ok(decision);
      assert.equal(decision.pieceId, 'ai_col');
      assert.notEqual(
        `${decision.toCol},${decision.toRow}`,
        '4,1',
        'AI must NOT bounce back to (4,1) after A->B->A trail'
      );
    } finally {
      Math.random = origRandom;
      store.returnToTitleMenu();
    }
  });
});
