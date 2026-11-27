import { type Faction, type RankId } from '../core/ranks';
import { resolveClash, type ClashPairOutcome } from '../core/RulesEngine';
import type { ArbiterVerdict, BattleResolutionKind, GridCoord } from '../core/types';

export interface ArbiterChallengeInput {
  readonly contestedCoord: GridCoord;
  readonly attackerId: string;
  readonly attackerFaction: Faction;
  readonly attackerTrueRank: RankId;
  readonly defenderId: string;
  readonly defenderFaction: Faction;
  readonly defenderTrueRank: RankId;
}

/**
 * Delegates directly to `RulesEngine.resolveClash` (Single Canonical Resolution Contract).
 */
export function compareSalpakanRanks(attacker: RankId, defender: RankId): ClashPairOutcome {
  return resolveClash(attacker, defender);
}

export function resolveArbiterChallenge(input: ArbiterChallengeInput): ArbiterVerdict {
  const pairOutcome = compareSalpakanRanks(input.attackerTrueRank, input.defenderTrueRank);

  const playerIsAttacker = input.attackerFaction === 'PLAYER';
  const playerPieceId = playerIsAttacker ? input.attackerId : input.defenderId;
  const playerVisibleRank = playerIsAttacker ? input.attackerTrueRank : input.defenderTrueRank;
  const enemyPieceId = playerIsAttacker ? input.defenderId : input.attackerId;

  let resolution: BattleResolutionKind;
  let survivorId: string | null = null;
  let survivorFaction: Faction | null = null;

  if (pairOutcome === 'SPLIT') {
    resolution = 'MUTUAL_SPLIT';
  } else {
    const winnerFaction = pairOutcome === 'ATTACKER' ? input.attackerFaction : input.defenderFaction;
    const loserTrueRank = pairOutcome === 'ATTACKER' ? input.defenderTrueRank : input.attackerTrueRank;
    survivorId = pairOutcome === 'ATTACKER' ? input.attackerId : input.defenderId;
    survivorFaction = winnerFaction;

    if (loserTrueRank === 'FLAG') {
      resolution =
        winnerFaction === 'PLAYER' ? 'FLAG_CAPTURED_BY_PLAYER' : 'FLAG_CAPTURED_BY_ENEMY';
    } else {
      resolution = winnerFaction === 'PLAYER' ? 'PLAYER_WINS' : 'ENEMY_WINS';
    }
  }

  return {
    resolution,
    contestedCoord: input.contestedCoord,
    attackerId: input.attackerId,
    attackerFaction: input.attackerFaction,
    defenderId: input.defenderId,
    defenderFaction: input.defenderFaction,
    playerPieceId,
    playerVisibleRank,
    enemyPieceId,
    survivorId,
    survivorFaction,
  };
}
