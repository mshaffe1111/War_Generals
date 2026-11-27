import { BOARD_COLS, BOARD_ROWS, ORDERED_RANKS, RANK_SPECS, type Faction, type RankId } from '../core/ranks';
import { resolveClash } from '../core/RulesEngine';
import type { AudioEraMode, DifficultyTier, GridCoord } from '../core/types';
import {
  getCommanderProfile,
  type CommanderId,
  type CommanderProfile,
  type CommanderUtilityWeights,
} from './CommanderProfiles';

/**
 * ZERO-CHEAT INFORMATION-SET LAW (`src/ai/BeliefMatrixAI.ts`):
 * - Consumes EXCLUSIVELY public observable events:
 *   1. Initial occupied squares `(row, col)` of the 21 Player pieces
 *   2. Public orthogonal moves `(pieceId, fromCoord, toCoord, turnNumber)`
 *   3. Public clash coordinates & outcomes (`AI_WON`, `AI_LOST`, `SPLIT`) paired ONLY with the AI's OWN known rank
 * - NEVER imports or accesses `TruthPieceRecord` or `playerPiece.trueRank`!
 */

export type PublicClashOutcomeForAI = 'AI_WON' | 'AI_LOST' | 'SPLIT';

export interface PublicPlayerInitialSquare {
  readonly id: string;
  readonly col: number;
  readonly row: number;
}

export interface AIOwnUnitState {
  readonly id: string;
  readonly ownRank: RankId;
  readonly col: number;
  readonly row: number;
  readonly hasMoved: boolean;
}

export interface ObservedPlayerUnitState {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly publicKills: number;
  readonly hasMoved: boolean;
}

export interface AIMoveDecision {
  readonly pieceId: string;
  readonly toCol: number;
  readonly toRow: number;
  readonly isBluffManeuver?: boolean;
}

interface TrackedPlayerPieceMeta {
  readonly id: string;
  readonly initialCol: number;
  readonly initialRow: number;
  col: number;
  row: number;
  alive: boolean;
  movesCount: number;
  evadedContactMoves: number;
  chasedHighOfficerMoves: number;
  stationaryBackRankBoostAppliedTurn: number;
}

const NUM_RANKS = ORDERED_RANKS.length; // 15
const RANK_INDEX: Readonly<Record<RankId, number>> = {
  GEN_5: 0,
  GEN_4: 1,
  GEN_3: 2,
  GEN_2: 3,
  GEN_1: 4,
  COLONEL: 5,
  LT_COLONEL: 6,
  MAJOR: 7,
  CAPTAIN: 8,
  LT_1ST: 9,
  LT_2ND: 10,
  SERGEANT: 11,
  PRIVATE: 12,
  SPY: 13,
  FLAG: 14,
};

const PIECE_MATERIAL_VALUE: Readonly<Record<RankId, number>> = {
  GEN_5: 95,
  GEN_4: 82,
  GEN_3: 70,
  GEN_2: 60,
  GEN_1: 52,
  COLONEL: 44,
  LT_COLONEL: 37,
  MAJOR: 31,
  CAPTAIN: 26,
  LT_1ST: 21,
  LT_2ND: 17,
  SERGEANT: 13,
  PRIVATE: 16, // High strategic value as the ONLY Spy-killer!
  SPY: 78, // Lethal officer assassin
  FLAG: 900,
};

const PLAYER_HOME_BACK_ROW = 7; // Player's deepest home row (`Row 7` in grid space)
const PLAYER_BREAKTHROUGH_GOAL_ROW = 0; // AI's deepest home row (`Row 0` in grid space)
const AI_HOME_BACK_ROW = 0;
const AI_SPEARHEAD_CROSS_ROW = 3;

function isOfficerRank(rank: RankId): boolean {
  return rank !== 'PRIVATE' && rank !== 'SPY' && rank !== 'FLAG';
}

/**
 * Dynamic `21 × 15` Sinkhorn-Knopp Bayesian Belief Matrix + 2-to-3 Ply Information-Set Expectimax & Bluff Engine.
 */
export class BeliefMatrixAI {
  /** Row-stochastic probability vector `P(piece_i == rank_r)` for every tracked Player piece */
  private readonly matrix = new Map<string, Float64Array>();
  /** Hard impossibility mask (`0` = mathematically impossible, `1` = plausible) so Sinkhorn never resurrects eliminated ranks */
  private readonly possibleMask = new Map<string, Uint8Array>();
  /** Remaining unseen Player rank pool `C_r` initialized to `[1,1,1,1,1,1,1,1,1,1,1,1,6,2,1]` */
  private readonly remainingPool = new Float64Array(NUM_RANKS);
  private readonly meta = new Map<string, TrackedPlayerPieceMeta>();

  /** Confirmed AI high-officer coordinates that survived a clash (so AI knows the Player knows an AI threat is there!) */
  private readonly exposedAIHighOfficerIds = new Set<string>();
  /** Designated bluff sprinter piece ID (Private/Sergeant faking an edge-file Flag run) */
  private designatedBluffRunnerId: string | null = null;
  /** Designated motionless Row-0 `FIVE_STAR` decoy pretending to be the AI Flag */
  private designatedBackRankDecoyId: string | null = null;
  /** Anti-oscillation origin square memory (`pieceId -> previous square`) to prevent sterile 2-tile shuffling */
  private readonly lastVacatedSquare = new Map<string, GridCoord>();

  /**
   * Initializes the `21 × 15` Belief Matrix strictly from public initial coordinates `(row, col)`.
   */
  public initializeMatch(
    playerInitialSquares: readonly PublicPlayerInitialSquare[],
    aiInitialUnits: readonly AIOwnUnitState[] = []
  ): void {
    this.matrix.clear();
    this.possibleMask.clear();
    this.meta.clear();
    this.exposedAIHighOfficerIds.clear();
    this.lastVacatedSquare.clear();
    this.designatedBluffRunnerId = null;
    this.designatedBackRankDecoyId = null;

    for (let r = 0; r < NUM_RANKS; r++) {
      this.remainingPool[r] = RANK_SPECS[ORDERED_RANKS[r]!].countPerArmy;
    }

    const n = Math.max(1, playerInitialSquares.length);
    for (const sq of playerInitialSquares) {
      const vec = new Float64Array(NUM_RANKS);
      const mask = new Uint8Array(NUM_RANKS);
      for (let r = 0; r < NUM_RANKS; r++) {
        mask[r] = 1;
        vec[r] = this.remainingPool[r]! / n;
      }
      // Subtle opening spatial prior: back-row pieces (`row 7`) have slightly higher initial Flag prior than frontline (`row 5`)
      if (sq.row === PLAYER_HOME_BACK_ROW) {
        vec[RANK_INDEX.FLAG] *= 1.55;
      } else if (sq.row === 5) {
        vec[RANK_INDEX.FLAG] *= 0.45;
      }

      this.matrix.set(sq.id, vec);
      this.possibleMask.set(sq.id, mask);
      this.meta.set(sq.id, {
        id: sq.id,
        initialCol: sq.col,
        initialRow: sq.row,
        col: sq.col,
        row: sq.row,
        alive: true,
        movesCount: 0,
        evadedContactMoves: 0,
        chasedHighOfficerMoves: 0,
        stationaryBackRankBoostAppliedTurn: 0,
      });
    }

    // Designate optional AI psychological bluff units from AI's own roster:
    // 1. Edge-column Private or Sergeant (`col 0` or `col 8`) for fake Flag-sprint bluffs
    const edgeRunner = aiInitialUnits.find(
      (u) =>
        (u.ownRank === 'PRIVATE' || u.ownRank === 'SERGEANT') &&
        (u.col === 0 || u.col === BOARD_COLS - 1)
    );
    this.designatedBluffRunnerId = edgeRunner?.id ?? null;

    // 2. Back-row `GEN_5` (`row 0`) parked motionless pretending to be AI's Flag!
    const backGen5 = aiInitialUnits.find(
      (u) => u.ownRank === 'GEN_5' && u.row === AI_HOME_BACK_ROW
    );
    this.designatedBackRankDecoyId = backGen5?.id ?? null;

    this.runSinkhornKnopp();
  }

  /**
   * Records a public orthogonal move by a Player piece & updates spatial/behavioral Bayesian weights (§2.2).
   */
  public recordPlayerMove(
    pieceId: string,
    from: GridCoord,
    to: GridCoord,
    turnNumber: number,
    aiUnits: readonly AIOwnUnitState[]
  ): void {
    const m = this.meta.get(pieceId);
    const vec = this.matrix.get(pieceId);
    const mask = this.possibleMask.get(pieceId);
    if (!m || !vec || !mask || !m.alive) return;

    m.col = to.col;
    m.row = to.row;
    m.movesCount += 1;

    const adjacentToAnyAI = aiUnits.some(
      (ai) => Math.abs(ai.col - to.col) + Math.abs(ai.row - to.row) === 1
    );

    // Heuristic A: Marching aggressively toward `PLAYER_BREAKTHROUGH_GOAL_ROW` down an open file while avoiding adjacent contact!
    if (to.row < from.row && !adjacentToAnyAI) {
      m.evadedContactMoves += 1;
      const distToGoal = Math.max(0, to.row - PLAYER_BREAKTHROUGH_GOAL_ROW);
      const proximityBoost = distToGoal <= 3 ? 1.55 : 1.38;
      if (mask[RANK_INDEX.FLAG]) vec[RANK_INDEX.FLAG] *= proximityBoost;
      if (mask[RANK_INDEX.SPY]) vec[RANK_INDEX.SPY] *= 1.28;
    }

    // Heuristic B: Actively chasing an exposed/blooded AI high officer (`GEN_5`..`COLONEL`) -> boost `SPY` & `GEN_5`!
    for (const ai of aiUnits) {
      if (!this.exposedAIHighOfficerIds.has(ai.id)) continue;
      const prevDist = Math.abs(from.col - ai.col) + Math.abs(from.row - ai.row);
      const nextDist = Math.abs(to.col - ai.col) + Math.abs(to.row - ai.row);
      if (nextDist < prevDist) {
        m.chasedHighOfficerMoves += 1;
        if (mask[RANK_INDEX.SPY]) vec[RANK_INDEX.SPY] *= 1.45;
        if (mask[RANK_INDEX.GEN_5]) vec[RANK_INDEX.GEN_5] *= 1.32;
      }
    }

    this.applyStationaryBackRankHeuristics(turnNumber);
    this.runSinkhornKnopp();
  }

  /**
   * Records a public clash outcome (`AI_WON`, `AI_LOST`, `SPLIT`) against an AI piece of known `aiOwnRank` (§2.1).
   */
  public recordClashOutcome(
    playerPieceId: string,
    aiPieceId: string,
    aiOwnRank: RankId,
    outcome: PublicClashOutcomeForAI,
    turnNumber: number
  ): void {
    const m = this.meta.get(playerPieceId);
    const vec = this.matrix.get(playerPieceId);
    const mask = this.possibleMask.get(playerPieceId);
    if (!m || !vec || !mask) return;

    if (outcome === 'SPLIT') {
      // Mutual Split: Both pieces eliminated! For all 14 non-Flag ranks, `playerPiece` was 100% equal to `aiOwnRank`.
      m.alive = false;
      const rIdx = RANK_INDEX[aiOwnRank];
      this.remainingPool[rIdx] = Math.max(0, this.remainingPool[rIdx]! - 1.0);
      // If pool for `aiOwnRank` is now exhausted (`0`), zero it out across all surviving player pieces!
      if (this.remainingPool[rIdx]! <= 1e-6) {
        this.zeroRankAcrossAllSurvivors(rIdx);
      }
    } else if (outcome === 'AI_LOST') {
      // Player piece `playerPieceId` SURVIVED and defeated `aiOwnRank`!
      if (aiOwnRank === 'SPY') {
        // LAW 2: ONLY a `PRIVATE` can defeat a `SPY`! 100% certainty lock (`P(i, PRIVATE) = 1.0`)!
        for (let r = 0; r < NUM_RANKS; r++) {
          if (r === RANK_INDEX.PRIVATE) {
            mask[r] = 1;
            vec[r] = 1.0;
          } else {
            mask[r] = 0;
            vec[r] = 0.0;
          }
        }
      } else if (aiOwnRank === 'PRIVATE') {
        // LAW 3: Defeating an AI `PRIVATE` zeroes out `FLAG`, `PRIVATE`, and `SPY` — guaranteed Officer (`SERGEANT..GEN_5`)!
        this.zeroCandidate(vec, mask, RANK_INDEX.FLAG);
        this.zeroCandidate(vec, mask, RANK_INDEX.PRIVATE);
        this.zeroCandidate(vec, mask, RANK_INDEX.SPY);
      } else if (isOfficerRank(aiOwnRank)) {
        // LAW 1: Defeating an AI Officer `X` zeroes out `FLAG`, `PRIVATE`, and all Officers `<= X`; boosts higher Officers & `SPY`!
        const aiSen = RANK_SPECS[aiOwnRank].seniority;
        this.zeroCandidate(vec, mask, RANK_INDEX.FLAG);
        this.zeroCandidate(vec, mask, RANK_INDEX.PRIVATE);
        for (let r = 0; r < NUM_RANKS; r++) {
          const cand = ORDERED_RANKS[r]!;
          if (isOfficerRank(cand) && RANK_SPECS[cand].seniority <= aiSen) {
            this.zeroCandidate(vec, mask, r);
          } else if (mask[r]) {
            if (cand === 'SPY') vec[r] *= 1.45;
            else if (isOfficerRank(cand) && RANK_SPECS[cand].seniority > aiSen) vec[r] *= 1.28;
          }
        }
      }
    } else {
      // `outcome === 'AI_WON'`: AI piece (`aiOwnRank`) defeated & eliminated `playerPieceId`!
      // Without reading `trueRank`, deduce posterior distribution `q` over ranks that lose to `aiOwnRank`
      // (excluding `FLAG` if match continues) and subtract `q` from `remainingPool`!
      if (RANK_SPECS[aiOwnRank].seniority >= RANK_SPECS.COLONEL.seniority) {
        this.exposedAIHighOfficerIds.add(aiPieceId);
      }
      const posterior = new Float64Array(NUM_RANKS);
      let postSum = 0;
      for (let r = 0; r < NUM_RANKS; r++) {
        const cand = ORDERED_RANKS[r]!;
        if (!mask[r] || cand === 'FLAG') continue;
        // Player lost -> `resolveClash(aiOwnRank, cand)` or `resolveClash(cand, aiOwnRank)` resulted in AI winning
        const aiBeatsCand = resolveClash(aiOwnRank, cand) === 'ATTACKER';
        if (aiBeatsCand) {
          posterior[r] = Math.max(1e-4, vec[r]!);
          postSum += posterior[r]!;
        }
      }
      m.alive = false;
      if (postSum > 0) {
        for (let r = 0; r < NUM_RANKS; r++) {
          const delta = posterior[r]! / postSum;
          this.remainingPool[r] = Math.max(0, this.remainingPool[r]! - delta);
          if (this.remainingPool[r]! <= 1e-5) {
            this.remainingPool[r] = 0;
            this.zeroRankAcrossAllSurvivors(r);
          }
        }
      }
    }

    this.applyStationaryBackRankHeuristics(turnNumber);
    this.runSinkhornKnopp();
  }

  /**
   * Returns a read-only snapshot of `P(pieceId == rank)` (`sum_r = 1.0`) for inspection & testing.
   */
  public getPieceDistribution(pieceId: string): Readonly<Record<RankId, number>> | null {
    const vec = this.matrix.get(pieceId);
    if (!vec) return null;
    const out = {} as Record<RankId, number>;
    for (let r = 0; r < NUM_RANKS; r++) {
      out[ORDERED_RANKS[r]!] = vec[r]!;
    }
    return out;
  }

  public getRemainingPoolSnapshot(): Readonly<Record<RankId, number>> {
    const out = {} as Record<RankId, number>;
    for (let r = 0; r < NUM_RANKS; r++) {
      out[ORDERED_RANKS[r]!] = this.remainingPool[r]!;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Sinkhorn-Knopp Iterative Proportional Scaling (`sum_r P(i,r) = 1`, `sum_i P(i,r) = C_r`)
  // ---------------------------------------------------------------------------

  private zeroCandidate(vec: Float64Array, mask: Uint8Array, rIdx: number): void {
    mask[rIdx] = 0;
    vec[rIdx] = 0;
  }

  private zeroRankAcrossAllSurvivors(rIdx: number): void {
    for (const [id, m] of this.meta.entries()) {
      if (!m.alive) continue;
      const mask = this.possibleMask.get(id);
      const vec = this.matrix.get(id);
      if (mask && vec) {
        mask[rIdx] = 0;
        vec[rIdx] = 0;
      }
    }
  }

  private applyStationaryBackRankHeuristics(turnNumber: number): void {
    // §2.2: Pieces remaining completely stationary on Player's deepest back rank (`Row 7` / spec "Row 0" home rank)
    // up through Turn 15+ receive progressive Bayesian multipliers toward `FLAG` or defensive `PRIVATE`!
    if (turnNumber < 4) return;
    for (const [id, m] of this.meta.entries()) {
      if (!m.alive) continue;
      if (
        m.movesCount === 0 &&
        (m.row === PLAYER_HOME_BACK_ROW || m.row === 0) &&
        turnNumber > m.stationaryBackRankBoostAppliedTurn &&
        turnNumber <= 18
      ) {
        m.stationaryBackRankBoostAppliedTurn = turnNumber;
        const vec = this.matrix.get(id);
        const mask = this.possibleMask.get(id);
        if (!vec || !mask) continue;
        const progress = Math.min(1.0, turnNumber / 15);
        const flagBoost = 1.08 + 0.14 * progress;
        const pvtBoost = 1.04 + 0.08 * progress;
        if (mask[RANK_INDEX.FLAG]) vec[RANK_INDEX.FLAG] *= flagBoost;
        if (mask[RANK_INDEX.PRIVATE]) vec[RANK_INDEX.PRIVATE] *= pvtBoost;
      }
    }
  }

  public runSinkhornKnopp(iterations = 18): void {
    const aliveIds: string[] = [];
    for (const [id, m] of this.meta.entries()) {
      if (m.alive) aliveIds.push(id);
    }
    const nAlive = aliveIds.length;
    if (nAlive === 0) return;

    // Reconcile total `remainingPool` sum to `nAlive` so row & column marginals match (`sum_i 1 == sum_r C_r`)
    let poolSum = 0;
    for (let r = 0; r < NUM_RANKS; r++) poolSum += this.remainingPool[r]!;
    const targetColMarginal = new Float64Array(NUM_RANKS);
    if (poolSum > 1e-6) {
      const scale = nAlive / poolSum;
      for (let r = 0; r < NUM_RANKS; r++) {
        targetColMarginal[r] = this.remainingPool[r]! * scale;
      }
    }

    // Ensure every alive piece has at least one non-zero allowed entry
    for (const id of aliveIds) {
      const vec = this.matrix.get(id)!;
      const mask = this.possibleMask.get(id)!;
      let rowSum = 0;
      for (let r = 0; r < NUM_RANKS; r++) {
        if (!mask[r] || targetColMarginal[r]! <= 1e-7) {
          vec[r] = 0;
        } else if (vec[r]! <= 1e-9) {
          vec[r] = 1e-4;
        }
        rowSum += vec[r]!;
      }
      if (rowSum <= 1e-12) {
        // Fallback safety if contradictory elimination ever occurred: distribute over remaining non-Flag pool
        for (let r = 0; r < NUM_RANKS; r++) {
          if (targetColMarginal[r]! > 1e-6) {
            mask[r] = 1;
            vec[r] = targetColMarginal[r]!;
          }
        }
      }
    }

    // Alternating Sinkhorn-Knopp Row & Column Proportional Scaling
    for (let iter = 0; iter < iterations; iter++) {
      // 1. Column scaling: match `targetColMarginal[r]`
      for (let r = 0; r < NUM_RANKS; r++) {
        const desired = targetColMarginal[r]!;
        if (desired <= 1e-7) continue;
        let colSum = 0;
        for (const id of aliveIds) {
          colSum += this.matrix.get(id)![r]!;
        }
        if (colSum > 1e-9) {
          const factor = desired / colSum;
          for (const id of aliveIds) {
            const vec = this.matrix.get(id)!;
            if (vec[r]! > 0) vec[r] *= factor;
          }
        }
      }

      // 2. Row scaling: enforce exact `sum_r P(i, r) = 1.0`!
      for (const id of aliveIds) {
        const vec = this.matrix.get(id)!;
        let rowSum = 0;
        for (let r = 0; r < NUM_RANKS; r++) rowSum += vec[r]!;
        if (rowSum > 1e-12) {
          const inv = 1.0 / rowSum;
          for (let r = 0; r < NUM_RANKS; r++) vec[r] *= inv;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Plausible World Sampler + 2-to-3 Ply Information-Set Expectimax & Bluff Engine
  // ---------------------------------------------------------------------------

  /**
   * Samples a plausible hidden rank assignment (`id -> RankId`) for all surviving Player pieces
   * directly from the Sinkhorn-normalized `21 × 15` Belief Matrix respecting remaining pool counts.
   */
  public samplePlausibleWorld(rng: () => number = Math.random): Map<string, RankId> {
    const assignment = new Map<string, RankId>();
    const aliveIds: Array<{ id: string; entropy: number }> = [];

    for (const [id, m] of this.meta.entries()) {
      if (!m.alive) continue;
      const vec = this.matrix.get(id)!;
      let ent = 0;
      for (let r = 0; r < NUM_RANKS; r++) {
        const p = vec[r]!;
        if (p > 1e-6) ent -= p * Math.log(p);
      }
      aliveIds.push({ id, entropy: ent });
    }

    // Assign lowest-entropy (most certain, e.g. 100% locked `PRIVATE`) pieces first!
    aliveIds.sort((a, b) => a.entropy - b.entropy);

    const remCounts = new Float64Array(this.remainingPool);
    for (const item of aliveIds) {
      const vec = this.matrix.get(item.id)!;
      let totalW = 0;
      const weights = new Float64Array(NUM_RANKS);
      for (let r = 0; r < NUM_RANKS; r++) {
        if (remCounts[r]! > 0.05 && vec[r]! > 0) {
          weights[r] = vec[r]! * remCounts[r]!;
          totalW += weights[r]!;
        }
      }

      let chosenIdx = RANK_INDEX.PRIVATE;
      if (totalW > 1e-9) {
        let pick = rng() * totalW;
        for (let r = 0; r < NUM_RANKS; r++) {
          pick -= weights[r]!;
          if (pick <= 0) {
            chosenIdx = r;
            break;
          }
        }
      } else {
        // Fallback to highest-probability rank in `vec`
        let bestP = -1;
        for (let r = 0; r < NUM_RANKS; r++) {
          if (vec[r]! > bestP) {
            bestP = vec[r]!;
            chosenIdx = r;
          }
        }
      }

      remCounts[chosenIdx] = Math.max(0, remCounts[chosenIdx]! - 1);
      assignment.set(item.id, ORDERED_RANKS[chosenIdx]!);
    }

    return assignment;
  }

  /**
   * Applies non-cheating **Bayesian Memory Decay** for lower Difficulty Tiers (§2):
   * - `RECRUIT`: `40%` memory decay per turn (forgets older clashes/deductions like a casual human!)
   * - `OFFICER`: `15%` memory decay (`85%` retention)
   * - `GENERAL` & `SUPREME_MARSHAL`: `0%` decay (`100%` lossless Sinkhorn-Knopp memory!)
   */
  public applyTurnMemoryDecay(decayFraction: number): void {
    if (decayFraction <= 0) return;
    const keep = Math.max(0, Math.min(1, 1.0 - decayFraction));
    for (const [id, m] of this.meta.entries()) {
      if (!m.alive) continue;
      const vec = this.matrix.get(id)!;
      const mask = this.possibleMask.get(id)!;
      for (let r = 0; r < NUM_RANKS; r++) {
        const uniformPrior = RANK_SPECS[ORDERED_RANKS[r]!].countPerArmy / 21;
        if (decayFraction >= 0.35) {
          // Casual Recruit forgets older eliminations partially too
          mask[r] = 1;
        }
        if (mask[r]) {
          vec[r] = vec[r]! * keep + uniformPrior * (1.0 - keep);
        }
      }
    }
    this.runSinkhornKnopp(decayFraction >= 0.35 ? 6 : 12);
  }

  /**
   * Records the AI's own committed move origin so consecutive turns avoid sterile `A -> B -> A` oscillation.
   */
  public recordOwnMoveOrigin(pieceId: string, from: GridCoord): void {
    this.lastVacatedSquare.set(pieceId, { col: from.col, row: from.row });
  }

  /**
   * Selects the optimal move for `commanderId` scaled strictly by `difficulty` & `eraMode` (§2–3):
   * - `RECRUIT`: 1-ply search, 40% Bayesian memory decay/turn, zero bluffs
   * - `OFFICER`: 2-ply Expectimax, 85% memory retention
   * - `GENERAL`: Lossless 21×15 Sinkhorn memory, Spy-Private escorting & decoy bluffs
   * - `SUPREME_MARSHAL`: 3-ply Information-Set Expectimax + Monte Carlo world rollouts + 1970s back-row bluff baiting!
   */
  public chooseCommanderMove(
    aiUnits: readonly AIOwnUnitState[],
    playerUnits: readonly ObservedPlayerUnitState[],
    commanderId: CommanderId,
    turnNumber: number,
    options: {
      difficulty?: DifficultyTier;
      eraMode?: AudioEraMode;
      aiFaction?: Faction;
      rng?: () => number;
    } = {}
  ): AIMoveDecision | null {
    const difficulty = options.difficulty ?? 'GENERAL';
    const eraMode = options.eraMode ?? '1980s';
    const aiFaction = options.aiFaction ?? 'ENEMY';
    const rng = options.rng ?? Math.random;

    // Apply Difficulty Memory Retention Curve (0% cheat!)
    if (difficulty === 'RECRUIT') {
      this.applyTurnMemoryDecay(0.4);
    } else if (difficulty === 'OFFICER') {
      this.applyTurnMemoryDecay(0.15);
    }

    const commander = getCommanderProfile(commanderId);
    const baseW = commander.weights;
    const effDepth: 1 | 2 | 3 =
      difficulty === 'RECRUIT'
        ? 1
        : difficulty === 'OFFICER'
          ? 2
          : difficulty === 'SUPREME_MARSHAL'
            ? 3
            : baseW.searchDepth;
    const effSamples =
      difficulty === 'RECRUIT'
        ? 1
        : difficulty === 'OFFICER'
          ? 4
          : difficulty === 'SUPREME_MARSHAL'
            ? 12
            : baseW.worldSamples;
    const effBluffMul =
      difficulty === 'RECRUIT'
        ? 0.0
        : difficulty === 'OFFICER'
          ? 0.45
          : difficulty === 'SUPREME_MARSHAL'
            ? 1.35
            : 1.0;
    const effNoise =
      difficulty === 'RECRUIT'
        ? Math.max(baseW.decisionNoise, 8.5)
        : difficulty === 'OFFICER'
          ? Math.max(baseW.decisionNoise, 3.2)
          : difficulty === 'SUPREME_MARSHAL'
            ? Math.min(baseW.decisionNoise, 0.25)
            : baseW.decisionNoise;

    const W: CommanderUtilityWeights = {
      ...baseW,
      worldSamples: effSamples,
      decisionNoise: effNoise,
      bluffRate: baseW.bluffRate * effBluffMul,
    };

    const forwardDr = aiFaction === 'ENEMY' ? 1 : -1;
    const ownBackRow = aiFaction === 'ENEMY' ? 0 : BOARD_ROWS - 1;
    const oppBackRow = aiFaction === 'ENEMY' ? BOARD_ROWS - 1 : 0;
    const spearheadCrossed = (r: number) =>
      aiFaction === 'ENEMY' ? r >= AI_SPEARHEAD_CROSS_ROW : r <= 4;

    const aiByCoord = new Map<string, AIOwnUnitState>();
    for (const a of aiUnits) aiByCoord.set(`${a.col},${a.row}`, a);

    const playerByCoord = new Map<string, ObservedPlayerUnitState>();
    for (const p of playerUnits) playerByCoord.set(`${p.col},${p.row}`, p);

    const aiFlag = aiUnits.find((a) => a.ownRank === 'FLAG');
    const dirs = [
      { dc: 0, dr: forwardDr },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: -forwardDr },
    ];

    const rootCandidates: Array<{
      decision: AIMoveDecision;
      priorScore: number;
    }> = [];

    for (const unit of aiUnits) {
      const lastVacated = this.lastVacatedSquare.get(unit.id);

      for (const d of dirs) {
        const nc = unit.col + d.dc;
        const nr = unit.row + d.dr;
        if (nc < 0 || nc >= BOARD_COLS || nr < 0 || nr >= BOARD_ROWS) continue;
        if (aiByCoord.has(`${nc},${nr}`)) continue;

        const targetPlayer = playerByCoord.get(`${nc},${nr}`);
        let prior = (rng() - 0.5) * W.decisionNoise;
        let isBluff = false;

        // Prevent sterile 2-square oscillation (`A -> B -> A`) on quiet moves
        if (!targetPlayer && lastVacated && lastVacated.col === nc && lastVacated.row === nr) {
          prior -= 18.5;
        }

        // Psychological Bluff #1: Motionless `FIVE_STAR` parked on own back rank pretending to be Flag!
        if (
          unit.id === this.designatedBackRankDecoyId &&
          unit.row === ownBackRow &&
          !unit.hasMoved &&
          !targetPlayer &&
          turnNumber <= 18 &&
          W.bluffRate >= 0.2
        ) {
          prior -= 26 * W.bluffRate;
        }

        // Psychological Bluff #2: Open edge-column `PRIVATE` or `SERGEANT` mimicking a daring `FLAG` sprint!
        if (
          (unit.id === this.designatedBluffRunnerId ||
            ((unit.ownRank === 'PRIVATE' || unit.ownRank === 'SERGEANT') &&
              (unit.col === 0 || unit.col === BOARD_COLS - 1))) &&
          d.dr === forwardDr &&
          !targetPlayer &&
          W.bluffRate >= 0.12
        ) {
          const enemyAdj = playerUnits.some(
            (p) => Math.abs(p.col - nc) + Math.abs(p.row - nr) === 1
          );
          if (!enemyAdj) {
            prior += 32 * W.bluffRate;
            isBluff = true;
          }
        }

        // Psychological Bluff #3 (Supreme Marshal + 1970s Classic Edition Back-Row Bluff Baiting!):
        // Intentionally step a `GEN_5` or `GEN_4` onto the opponent's back rank adjacent to an enemy unit,
        // mimicking a `1970s` deferred Flag arrival so the opponent panics and attacks into a 5★ General!
        if (
          eraMode === '1970s' &&
          difficulty === 'SUPREME_MARSHAL' &&
          (unit.ownRank === 'GEN_5' || unit.ownRank === 'GEN_4') &&
          nr === oppBackRow &&
          !targetPlayer
        ) {
          const adjOpponent = playerUnits.find(
            (p) => Math.abs(p.col - nc) + Math.abs(p.row - nr) === 1
          );
          if (adjOpponent && this.getRankProbability(adjOpponent.id, 'SPY') < 0.2) {
            prior += 46.0;
            isBluff = true;
          }
        }

        if (unit.ownRank === 'FLAG') {
          const currAdj = playerUnits.some(
            (p) => Math.abs(p.col - unit.col) + Math.abs(p.row - unit.row) === 1
          );
          const nextAdj = playerUnits.some(
            (p) => Math.abs(p.col - nc) + Math.abs(p.row - nr) === 1
          );
          if (nr === oppBackRow && !targetPlayer) {
            // In `1980s` Electronic Mode, stepping onto `oppBackRow` wins INSTANTLY even if `nextAdj` is true!
            if (eraMode === '1980s' || !nextAdj) {
              prior += 900;
            } else if (difficulty === 'SUPREME_MARSHAL' && W.bluffRate > 0.25) {
              // Bold 1970s deferred Flag bluff when opponent likely fears a 5★ General!
              prior += 42;
            } else {
              prior -= 120;
            }
          } else if (currAdj && !nextAdj && !targetPlayer) {
            prior += 85 * W.flagSafetyWeight;
          } else if (d.dr === forwardDr && !nextAdj && !targetPlayer && playerUnits.length <= 9) {
            prior += 32;
          } else {
            prior -= 115 * W.flagSafetyWeight;
          }
        } else if (targetPlayer) {
          prior += this.evaluateBayesianClashUtility(unit, targetPlayer, commander, aiFlag);
        } else {
          if (d.dr === forwardDr) prior += 9.5 * W.aggressionWeight;
          if (d.dr === -forwardDr) prior -= 5.0;
          prior += (4 - Math.abs(nc - 4)) * 0.65;

          // Pull toward nearest opponent units so endgame armies never stall across empty space
          let minEnemyDistNow = 99;
          let minEnemyDistNext = 99;
          for (const p of playerUnits) {
            const dn = Math.abs(unit.col - p.col) + Math.abs(unit.row - p.row);
            const dx = Math.abs(nc - p.col) + Math.abs(nr - p.row);
            if (dn < minEnemyDistNow) minEnemyDistNow = dn;
            if (dx < minEnemyDistNext) minEnemyDistNext = dx;
          }
          if (minEnemyDistNext < minEnemyDistNow) {
            prior += 4.2 * W.aggressionWeight;
          }

          if (
            turnNumber <= 12 &&
            (unit.ownRank === 'GEN_5' || unit.ownRank === 'GEN_4' || unit.ownRank === 'GEN_3') &&
            d.dr === forwardDr &&
            spearheadCrossed(nr)
          ) {
            prior += 18.0 * W.earlySpearheadWeight;
          }

          if (unit.ownRank === 'SPY' && difficulty !== 'RECRUIT') {
            const hasPrivateEscort = aiUnits.some(
              (other) =>
                other.id !== unit.id &&
                other.ownRank === 'PRIVATE' &&
                Math.abs(other.col - nc) + Math.abs(other.row - nr) <= 2
            );
            if (hasPrivateEscort) prior += 10.5 * W.spyPrivateEscortWeight;

            for (const p of playerUnits) {
              const pOff = this.getOfficerProbability(p.id);
              const pPvt = this.getRankProbability(p.id, 'PRIVATE');
              if (pOff > 0.58 && pPvt < 0.2) {
                const dNow = Math.abs(unit.col - p.col) + Math.abs(unit.row - p.row);
                const dNext = Math.abs(nc - p.col) + Math.abs(nr - p.row);
                if (dNext < dNow) prior += 12.0 * W.spyAssassinWeight;
              }
            }
          }

          if (unit.ownRank === 'PRIVATE' && W.spyPrivateEscortWeight > 1.0 && difficulty !== 'RECRUIT') {
            const nearSpy = aiUnits.some(
              (other) =>
                other.ownRank === 'SPY' &&
                Math.abs(other.col - nc) + Math.abs(other.row - nr) === 1
            );
            if (nearSpy && d.dr === forwardDr) prior += 8.0 * W.spyPrivateEscortWeight;
          }

          if (aiFlag) {
            for (const p of playerUnits) {
              const distToFlag = Math.abs(p.col - aiFlag.col) + Math.abs(p.row - aiFlag.row);
              if (distToFlag <= 3) {
                const dNow = Math.abs(unit.col - p.col) + Math.abs(unit.row - p.row);
                const dNext = Math.abs(nc - p.col) + Math.abs(nr - p.row);
                if (dNext < dNow) prior += 16.0 * W.flagSafetyWeight;
              }
            }
          }
        }

        rootCandidates.push({
          decision: {
            pieceId: unit.id,
            toCol: nc,
            toRow: nr,
            isBluffManeuver: isBluff,
          },
          priorScore: prior,
        });
      }
    }

    if (rootCandidates.length === 0) return null;
    rootCandidates.sort((a, b) => b.priorScore - a.priorScore);

    // Recruit (`effDepth === 1`): pure 1-ply decision without multi-ply lookahead!
    if (effDepth === 1) {
      return rootCandidates[0]!.decision;
    }

    // 2-to-3 Ply Information-Set Expectimax (+ Monte Carlo Rollout Tail on `SUPREME_MARSHAL`)
    const beamWidth = Math.min(rootCandidates.length, effDepth === 3 ? 10 : 7);
    const worlds: Map<string, RankId>[] = [];
    for (let k = 0; k < W.worldSamples; k++) {
      worlds.push(this.samplePlausibleWorld(rng));
    }

    let bestDecision = rootCandidates[0]!.decision;
    let bestTotalScore = -Infinity;

    for (let i = 0; i < beamWidth; i++) {
      const cand = rootCandidates[i]!;
      let worldExpectation = 0;

      for (const world of worlds) {
        worldExpectation += this.simulatePly2AndPly3InWorld(
          aiUnits,
          playerUnits,
          world,
          cand.decision,
          W,
          effDepth,
          difficulty === 'SUPREME_MARSHAL',
          ownBackRow,
          eraMode
        );
      }
      const avgFutureValue = worldExpectation / Math.max(1, worlds.length);
      const combinedScore = cand.priorScore + avgFutureValue;

      if (combinedScore > bestTotalScore) {
        bestTotalScore = combinedScore;
        bestDecision = cand.decision;
      }
    }

    return bestDecision;
  }

  private evaluateBayesianClashUtility(
    aiUnit: AIOwnUnitState,
    target: ObservedPlayerUnitState,
    commander: CommanderProfile,
    aiFlag: AIOwnUnitState | undefined
  ): number {
    const W = commander.weights;
    const vec = this.matrix.get(target.id);
    const aiRank = aiUnit.ownRank;
    const aiVal = PIECE_MATERIAL_VALUE[aiRank];

    let expectedTrade = 0;
    for (let r = 0; r < NUM_RANKS; r++) {
      const p = vec ? vec[r]! : 1 / NUM_RANKS;
      if (p <= 1e-6) continue;
      const pRank = ORDERED_RANKS[r]!;
      const pVal = PIECE_MATERIAL_VALUE[pRank];
      const res = resolveClash(aiRank, pRank);

      if (pRank === 'FLAG') {
        expectedTrade += p * 420;
      } else if (res === 'ATTACKER') {
        expectedTrade += p * (pVal * 1.15);
      } else if (res === 'SPLIT') {
        // Maj. Sterling ("Iron Bastion") favors grinding attrition splits when trading equal/mid material
        const splitBias = commander.id === 'STERLING' ? 6.0 : -2.0;
        expectedTrade += p * splitBias;
      } else {
        expectedTrade -= p * (aiVal * 1.25);
      }
    }

    // NEVER recklessly throw an AI `SPY` into an unprobed piece with high `P(PRIVATE)`!
    if (aiRank === 'SPY') {
      const pPrivate = this.getRankProbability(target.id, 'PRIVATE');
      if (pPrivate >= 0.24) {
        expectedTrade -= pPrivate * 135 * W.spyAssassinWeight;
      } else {
        expectedTrade += (1 - pPrivate) * 28 * W.spyAssassinWeight;
      }
    }

    // Col. Reyes ("Shadow Dagger") & Scouting Bonus: Mid-rank Captains/Majors/Privates probing unknown threats!
    if (
      target.publicKills === 0 &&
      (aiRank === 'PRIVATE' || aiRank === 'CAPTAIN' || aiRank === 'MAJOR' || aiRank === 'LT_1ST')
    ) {
      expectedTrade += 15 * W.probeSacrificeWeight;
    }

    //Marshal Hollis Back-Rank Bluff Detection:
    // If an unmoved Player piece sits on Row 7, probe with Private/Officer—don't blindly feed 5★ into a lurking Spy unless P(FLAG) is high!
    if (!target.hasMoved && target.row === PLAYER_HOME_BACK_ROW) {
      const pFlag = this.getRankProbability(target.id, 'FLAG');
      expectedTrade += pFlag * 95;
    }

    // Urgent Flag Defense bonus if target is threatening AI Flag!
    if (
      aiFlag &&
      Math.abs(target.col - aiFlag.col) + Math.abs(target.row - aiFlag.row) <= 2
    ) {
      expectedTrade += 42 * W.flagSafetyWeight;
    }

    return expectedTrade;
  }

  /**
   * Simulates **Ply 2 (Player Optimal Counter-Response)** and **Ply 3 (AI Best Follow-Up / Spy Assassination)**
   * inside a determinized world sampled from the `21 × 15` Belief Matrix!
   */
  private simulatePly2AndPly3InWorld(
    aiUnits: readonly AIOwnUnitState[],
    playerUnits: readonly ObservedPlayerUnitState[],
    world: ReadonlyMap<string, RankId>,
    rootMove: AIMoveDecision,
    W: CommanderUtilityWeights,
    effDepth: 2 | 3 = 3,
    enableMonteCarloRollout = false,
    ownBackRow = 0,
    eraMode: AudioEraMode = '1980s'
  ): number {
    interface SimUnit {
      id: string;
      faction: 'AI' | 'PLAYER';
      rank: RankId;
      col: number;
      row: number;
      alive: boolean;
    }

    const simAI: SimUnit[] = aiUnits.map((u) => ({
      id: u.id,
      faction: 'AI',
      rank: u.ownRank,
      col: u.col,
      row: u.row,
      alive: true,
    }));
    const simP: SimUnit[] = playerUnits.map((p) => ({
      id: p.id,
      faction: 'PLAYER',
      rank: world.get(p.id) ?? 'PRIVATE',
      col: p.col,
      row: p.row,
      alive: true,
    }));

    let boardDelta = 0;

    // Apply Ply 1 (`rootMove` by AI)
    const mover = simAI.find((u) => u.id === rootMove.pieceId);
    if (!mover) return 0;

    const defP = simP.find(
      (p) => p.alive && p.col === rootMove.toCol && p.row === rootMove.toRow
    );
    if (defP) {
      const res = resolveClash(mover.rank, defP.rank);
      if (defP.rank === 'FLAG') return 600;
      if (res === 'ATTACKER') {
        defP.alive = false;
        mover.col = rootMove.toCol;
        mover.row = rootMove.toRow;
        boardDelta += PIECE_MATERIAL_VALUE[defP.rank] * 0.55;
      } else if (res === 'SPLIT') {
        defP.alive = false;
        mover.alive = false;
        boardDelta += (PIECE_MATERIAL_VALUE[defP.rank] - PIECE_MATERIAL_VALUE[mover.rank]) * 0.5;
      } else {
        mover.alive = false;
        boardDelta -= PIECE_MATERIAL_VALUE[mover.rank] * 0.65;
      }
    } else {
      mover.col = rootMove.toCol;
      mover.row = rootMove.toRow;
    }

    // Ply 2 (Min Node): Player picks their strongest immediate tactical capture or Flag threat!
    let worstPlayerSwing = 0;
    let ply2Attacker: SimUnit | null = null;

    for (const p of simP) {
      if (!p.alive) continue;
      // Check if opponent Flag can step onto AI's back row (`ownBackRow`)!
      if (p.rank === 'FLAG' && Math.abs(p.row - ownBackRow) === 1) {
        const occupiedByP = simP.some((o) => o.alive && o.col === p.col && o.row === ownBackRow);
        if (!occupiedByP) {
          const adjDefender = simAI.some(
            (a) => a.alive && Math.abs(a.col - p.col) + Math.abs(a.row - ownBackRow) <= 1
          );
          if (eraMode === '1980s' || !adjDefender) {
            worstPlayerSwing = Math.max(worstPlayerSwing, 520 * W.flagSafetyWeight);
          }
        }
      }

      for (const a of simAI) {
        if (!a.alive) continue;
        if (Math.abs(p.col - a.col) + Math.abs(p.row - a.row) !== 1) continue;
        const res = resolveClash(p.rank, a.rank);
        let swing = 0;
        if (a.rank === 'FLAG') {
          swing = 550 * W.flagSafetyWeight;
        } else if (res === 'ATTACKER') {
          swing = PIECE_MATERIAL_VALUE[a.rank] * 0.85;
        } else if (res === 'SPLIT') {
          swing = (PIECE_MATERIAL_VALUE[a.rank] - PIECE_MATERIAL_VALUE[p.rank]) * 0.45;
        }
        if (swing > worstPlayerSwing) {
          worstPlayerSwing = swing;
          ply2Attacker = p;
        }
      }
    }

    boardDelta -= worstPlayerSwing;

    // Ply 3 (Max Node, enabled when `effDepth === 3`):
    // Check AI's immediate recapture / Spy assassination counter-strike if Player captures at `mover`'s square!
    if (effDepth === 3 && ply2Attacker && mover.alive) {
      let bestRecapture = 0;
      for (const ally of simAI) {
        if (!ally.alive || ally.id === mover.id) continue;
        if (Math.abs(ally.col - mover.col) + Math.abs(ally.row - mover.row) === 1) {
          const counterRes = resolveClash(ally.rank, ply2Attacker.rank);
          if (counterRes === 'ATTACKER') {
            bestRecapture = Math.max(
              bestRecapture,
              PIECE_MATERIAL_VALUE[ply2Attacker.rank] * 0.72
            );
          }
        }
      }
      boardDelta += bestRecapture;
    }

    // Supreme Marshal Monte Carlo Rollout Tail: evaluate remaining material + Spy-vs-General proximity balance!
    if (enableMonteCarloRollout) {
      let tailEval = 0;
      for (const a of simAI) {
        if (!a.alive) continue;
        if (a.rank === 'SPY') {
          for (const p of simP) {
            if (!p.alive) continue;
            if (p.rank === 'GEN_5' || p.rank === 'GEN_4') {
              const d = Math.abs(a.col - p.col) + Math.abs(a.row - p.row);
              tailEval += Math.max(0, 8 - d) * 1.8;
            }
          }
        }
      }
      boardDelta += tailEval;
    }

    return boardDelta;
  }

  private getRankProbability(pieceId: string, rank: RankId): number {
    const vec = this.matrix.get(pieceId);
    if (!vec) return RANK_SPECS[rank].countPerArmy / 21;
    return vec[RANK_INDEX[rank]]!;
  }

  private getOfficerProbability(pieceId: string): number {
    const vec = this.matrix.get(pieceId);
    if (!vec) return 12 / 21;
    let sum = 0;
    for (let r = 0; r < 12; r++) sum += vec[r]!;
    return sum;
  }
}
