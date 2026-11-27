import type { CommanderProfile } from '../core/CommanderProfiles';
import { BOARD_COLS, BOARD_ROWS, ORDERED_RANKS, type RankId } from '../core/ranks';
import { resolveClash } from '../core/RulesEngine';
import type { AIBeliefState } from './AIBeliefState';

/**
 * AI-Owned Piece View (AI legally knows its OWN pieces' ranks & coordinates,
 * and sees ONLY public coordinates + public kill counts of Player pieces—ZERO Player `trueRank`!).
 */
export interface AIOwnPieceInfo {
  readonly id: string;
  readonly ownRank: RankId;
  readonly col: number;
  readonly row: number;
}

export interface ObservedPlayerPieceInfo {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly publicKills: number;
  readonly hasMoved: boolean;
}

export interface AIDecision {
  readonly pieceId: string;
  readonly toCol: number;
  readonly toRow: number;
}

/**
 * Non-Cheating Tactical Bayesian AI Strategist (`AIStrategist.ts`).
 * Evaluates expected clash win probability strictly against `AIBeliefState` distributions
 * + positional heuristics (advancing vanguard, protecting Flag, hunting blooded threats with Spies/Generals).
 */
export class AIStrategist {
  public chooseMove(
    aiPieces: readonly AIOwnPieceInfo[],
    playerPieces: readonly ObservedPlayerPieceInfo[],
    belief: AIBeliefState,
    commander?: CommanderProfile
  ): AIDecision | null {
    const jitterSpan = commander?.decisionJitter ?? 3.5;
    const aggMul = commander?.aggressionBias ?? 1.0;
    const spyWeight = commander?.spyHuntWeight ?? 1.0;

    const aiByCoord = new Map<string, AIOwnPieceInfo>();
    for (const a of aiPieces) aiByCoord.set(`${a.col},${a.row}`, a);

    const playerByCoord = new Map<string, ObservedPlayerPieceInfo>();
    for (const p of playerPieces) playerByCoord.set(`${p.col},${p.row}`, p);

    const candidates: Array<{ move: AIDecision; score: number }> = [];
    const dirs = [
      { dc: 0, dr: 1 }, // Advance south toward Player home row 7!
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: -1 },
    ];

    const aiFlag = aiPieces.find((p) => p.ownRank === 'FLAG');

    for (const unit of aiPieces) {
      for (const d of dirs) {
        const nc = unit.col + d.dc;
        const nr = unit.row + d.dr;
        if (nc < 0 || nc >= BOARD_COLS || nr < 0 || nr >= BOARD_ROWS) continue;
        if (aiByCoord.has(`${nc},${nr}`)) continue;

        const targetPlayer = playerByCoord.get(`${nc},${nr}`);
        let score = (Math.random() - 0.5) * jitterSpan;

        if (unit.ownRank === 'FLAG') {
          const adjDanger = playerPieces.some(
            (p) => Math.abs(p.col - unit.col) + Math.abs(p.row - unit.row) === 1
          );
          const nextDanger = playerPieces.some(
            (p) => Math.abs(p.col - nc) + Math.abs(p.row - nr) === 1
          );
          if (nr === BOARD_ROWS - 1 && !nextDanger && !targetPlayer) {
            score += 500;
          } else if (adjDanger && !nextDanger && !targetPlayer) {
            score += 48;
          } else {
            score -= 80;
          }
        } else if (targetPlayer) {
          const expectedWin = this.estimateExpectedClashScore(
            unit.ownRank,
            targetPlayer,
            belief,
            spyWeight
          );
          score += expectedWin * aggMul;

          if (
            aiFlag &&
            Math.abs(targetPlayer.col - aiFlag.col) + Math.abs(targetPlayer.row - aiFlag.row) <= 2
          ) {
            score += 28;
          }
          if (!targetPlayer.hasMoved && targetPlayer.row === 7) {
            score += 34 * aggMul;
          }
        } else {
          if (d.dr > 0) score += 9.5 * aggMul;
          if (d.dr < 0) score -= 5.5;
          score += (4 - Math.abs(nc - 4)) * 0.8;

          if (unit.ownRank === 'SPY' || unit.ownRank === 'GEN_5' || unit.ownRank === 'GEN_4') {
            for (const p of playerPieces) {
              if (p.publicKills >= 1) {
                const distNow = Math.abs(unit.col - p.col) + Math.abs(unit.row - p.row);
                const distNext = Math.abs(nc - p.col) + Math.abs(nr - p.row);
                if (distNext < distNow) score += 6.5 * spyWeight;
              }
            }
          }
        }

        candidates.push({
          move: { pieceId: unit.id, toCol: nc, toRow: nr },
          score,
        });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]!.move;
  }

  private estimateExpectedClashScore(
    aiRank: RankId,
    target: ObservedPlayerPieceInfo,
    belief: AIBeliefState,
    spyWeight = 1.0
  ): number {
    const probs = belief.getPieceProbabilities(target.id);
    let ev = 0;

    for (const pRank of ORDERED_RANKS) {
      const p = probs ? (probs.get(pRank) ?? 1 / 15) : 1 / 15;
      if (p <= 0) continue;
      const res = resolveClash(aiRank, pRank);
      if (pRank === 'FLAG') {
        ev += p * 180;
      } else if (res === 'ATTACKER') {
        ev += p * 32;
      } else if (res === 'SPLIT') {
        ev += p * 4;
      } else {
        const lossCost = aiRank === 'PRIVATE' ? -10 : aiRank === 'SPY' ? -26 : -22;
        ev += p * lossCost;
      }
    }

    if (target.publicKills >= 2 && (aiRank === 'SPY' || aiRank === 'GEN_5')) {
      ev += 24 * spyWeight;
    }
    if (aiRank === 'PRIVATE' && target.publicKills === 0) {
      ev += 14;
    }

    return ev;
  }
}
