import { ORDERED_RANKS, RANK_SPECS, type RankId } from '../core/ranks';
import type { ArbiterVerdict } from '../core/types';

/**
 * Non-cheating AI Belief Engine (Block 1 Architectural Contract).
 * Consumes ONLY public piece IDs, public movements, and rank-blind ArbiterVerdict outcomes.
 * Architecturally incapable of importing or reading TruthPieceRecord.
 */
export class AIBeliefState {
  private readonly weights = new Map<string, Map<RankId, number>>();

  public initializeUnknownArmy(playerPieceIds: readonly string[]): void {
    this.weights.clear();
    const totalPieces = playerPieceIds.length || 21;
    for (const id of playerPieceIds) {
      const dist = new Map<RankId, number>();
      for (const rank of ORDERED_RANKS) {
        dist.set(rank, RANK_SPECS[rank].countPerArmy / totalPieces);
      }
      this.weights.set(id, dist);
    }
  }

  /**
   * Updates probability distribution for a player piece after observing a clash against
   * one of the AI's OWN known pieces (`aiOwnRank`).
   */
  public recordObservedClash(verdict: ArbiterVerdict, aiOwnRank: RankId): void {
    const dist = this.weights.get(verdict.playerPieceId);
    if (!dist) return;

    if (verdict.resolution === 'MUTUAL_SPLIT') {
      for (const rank of ORDERED_RANKS) {
        dist.set(rank, rank === aiOwnRank ? 1 : 0);
      }
      return;
    }

    const playerWon =
      verdict.resolution === 'PLAYER_WINS' || verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER';

    for (const candidate of ORDERED_RANKS) {
      const current = dist.get(candidate) ?? 0;
      if (current === 0) continue;
      const compatible = this.isCandidateConsistent(
        candidate,
        aiOwnRank,
        verdict.attackerFaction === 'PLAYER',
        playerWon
      );
      if (!compatible) {
        dist.set(candidate, 0);
      }
    }
    this.normalize(dist);
  }

  public getPieceProbabilities(pieceId: string): ReadonlyMap<RankId, number> | undefined {
    return this.weights.get(pieceId);
  }

  private isCandidateConsistent(
    playerCandidate: RankId,
    aiRank: RankId,
    playerAttacked: boolean,
    playerWon: boolean
  ): boolean {
    if (aiRank === 'FLAG') return playerWon;
    if (playerCandidate === 'FLAG') return !playerWon;
    if (playerCandidate === aiRank) return false;
    if (playerCandidate === 'SPY') {
      return aiRank === 'PRIVATE' ? !playerWon : playerWon;
    }
    if (aiRank === 'SPY') {
      return playerCandidate === 'PRIVATE' ? playerWon : !playerWon;
    }
    const pSen = RANK_SPECS[playerCandidate].seniority;
    const aSen = RANK_SPECS[aiRank].seniority;
    if (playerAttacked || !playerAttacked) {
      return playerWon ? pSen > aSen : aSen > pSen;
    }
    return false;
  }

  private normalize(dist: Map<RankId, number>): void {
    let sum = 0;
    for (const val of dist.values()) sum += val;
    if (sum <= 0) return;
    for (const [k, val] of dist.entries()) {
      dist.set(k, val / sum);
    }
  }
}
