import { type Faction, type RankId } from '../core/ranks';
import { resolveClash, type ClashPairOutcome } from '../core/RulesEngine';
import type {
  ArbiterVerdict,
  BattleChoreographyKind,
  BattleResolutionKind,
  GridCoord,
  MatchMode,
} from '../core/types';

export interface ArbiterChallengeInput {
  readonly contestedCoord: GridCoord;
  readonly attackerId: string;
  readonly attackerFaction: Faction;
  readonly attackerTrueRank: RankId;
  readonly defenderId: string;
  readonly defenderFaction: Faction;
  readonly defenderTrueRank: RankId;
  readonly matchMode?: MatchMode;
  readonly attackerPublicKills?: number;
  readonly defenderPublicKills?: number;
}

/**
 * Delegates directly to `RulesEngine.resolveClash` (Single Canonical Resolution Contract).
 */
export function compareSalpakanRanks(attacker: RankId, defender: RankId): ClashPairOutcome {
  return resolveClash(attacker, defender);
}

/**
 * STRICT FOG-OF-WAR CHOREOGRAPHY DERIVATION:
 * Never reads `enemy.trueRank`!
 * - Flag captures / Flag traverses -> `'FLAG_BREACH'`
 * - Mutual splits -> `'MUTUAL_SPLIT'`
 * - `PASS_AND_PLAY` (or `'UNKNOWN'` visible rank) -> derived strictly from public kill counts
 * - Single-player -> derived strictly from `playerVisibleRank`
 */
export function deriveBattleChoreography(params: {
  resolution: BattleResolutionKind;
  playerVisibleRank: RankId | 'UNKNOWN';
  matchMode: MatchMode;
  isFlagTraverseVictory?: boolean;
  publicKillsMax?: number;
}): BattleChoreographyKind {
  if (
    params.isFlagTraverseVictory ||
    params.resolution === 'FLAG_CAPTURED_BY_PLAYER' ||
    params.resolution === 'FLAG_CAPTURED_BY_ENEMY'
  ) {
    return 'FLAG_BREACH';
  }
  if (params.resolution === 'MUTUAL_SPLIT') {
    return 'MUTUAL_SPLIT';
  }
  if (params.matchMode === 'PASS_AND_PLAY' || params.playerVisibleRank === 'UNKNOWN') {
    const kills = params.publicKillsMax ?? 0;
    if (kills >= 2) return 'HIGH_COMMAND';
    if (kills >= 1) return 'ARMOR_ARTILLERY';
    return 'INFANTRY';
  }

  switch (params.playerVisibleRank) {
    case 'FLAG':
      return 'FLAG_BREACH';
    case 'SPY':
      return 'RECON_STEALTH';
    case 'GEN_5':
    case 'GEN_4':
    case 'GEN_3':
    case 'GEN_2':
    case 'GEN_1':
      return 'HIGH_COMMAND';
    case 'COLONEL':
    case 'LT_COLONEL':
    case 'MAJOR':
      return 'ARMOR_ARTILLERY';
    case 'CAPTAIN':
    case 'LT_1ST':
    case 'LT_2ND':
    case 'SERGEANT':
    case 'PRIVATE':
      return 'INFANTRY';
  }
}

export function resolveArbiterChallenge(input: ArbiterChallengeInput): ArbiterVerdict {
  const pairOutcome = compareSalpakanRanks(input.attackerTrueRank, input.defenderTrueRank);
  const matchMode: MatchMode = input.matchMode ?? 'SKIRMISH';

  const playerIsAttacker = input.attackerFaction === 'PLAYER';
  const playerPieceId = playerIsAttacker ? input.attackerId : input.defenderId;
  const rawPlayerRank = playerIsAttacker ? input.attackerTrueRank : input.defenderTrueRank;
  const playerVisibleRank: RankId | 'UNKNOWN' =
    matchMode === 'PASS_AND_PLAY' ? 'UNKNOWN' : rawPlayerRank;
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

  const publicKillsMax = Math.max(
    input.attackerPublicKills ?? 0,
    input.defenderPublicKills ?? 0
  );
  const choreography = deriveBattleChoreography({
    resolution,
    playerVisibleRank,
    matchMode,
    publicKillsMax,
  });

  return {
    resolution,
    choreography,
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
