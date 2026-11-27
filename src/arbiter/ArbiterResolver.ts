import { RANK_SPECS, type Faction, type RankId } from '../core/ranks';
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

type PairOutcome = 'ATTACKER' | 'DEFENDER' | 'SPLIT';

/**
 * Pure official War Generals (Salpakan) rank comparison.
 * Executed strictly inside the Electronic Arbiter vault.
 */
export function compareSalpakanRanks(attacker: RankId, defender: RankId): PairOutcome {
  // Rule 5: Flag interactions
  if (defender === 'FLAG') {
    // Any piece challenging the enemy Flag captures it—including an aggressor Flag!
    return 'ATTACKER';
  }
  if (attacker === 'FLAG') {
    // Moving Flag challenging any non-Flag enemy piece is eliminated
    return 'DEFENDER';
  }

  // Rule 4: Equal ranks eliminate both (including Spy vs Spy and Private vs Private)
  if (attacker === defender) {
    return 'SPLIT';
  }

  // Rule 2 & 3: Spy vs Private and Spy vs Officers
  if (attacker === 'SPY') {
    return defender === 'PRIVATE' ? 'DEFENDER' : 'ATTACKER';
  }
  if (defender === 'SPY') {
    return attacker === 'PRIVATE' ? 'ATTACKER' : 'DEFENDER';
  }

  // Rule 1: Standard Officer / Private seniority comparison
  const attSeniority = RANK_SPECS[attacker].seniority;
  const defSeniority = RANK_SPECS[defender].seniority;
  if (attSeniority > defSeniority) return 'ATTACKER';
  if (defSeniority > attSeniority) return 'DEFENDER';
  return 'SPLIT';
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
