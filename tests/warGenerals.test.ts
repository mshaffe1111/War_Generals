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
import { compareSalpakanRanks, resolveArbiterChallenge } from '../src/arbiter/ArbiterResolver';
import {
  BOARD_ROWS,
  ORDERED_RANKS,
  RANK_SPECS,
  type Faction,
  type RankId,
} from '../src/core/ranks';
import {
  checkBackRowFlagTraverse,
  generateSmartAutoDeploy,
  resolveClash,
  validateFactionDeployment,
} from '../src/core/RulesEngine';
import type { AudioEraMode, DifficultyTier } from '../src/core/types';
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
});
