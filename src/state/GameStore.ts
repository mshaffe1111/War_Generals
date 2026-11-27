import { AIBeliefState } from '../ai/AIBeliefState';
import {
  AIStrategist,
  type AIOwnPieceInfo,
  type ObservedPlayerPieceInfo,
} from '../ai/AIStrategist';
import { resolveArbiterChallenge } from '../arbiter/ArbiterResolver';
import {
  BOARD_COLS,
  BOARD_ROWS,
  ORDERED_RANKS,
  RANK_SPECS,
  type Faction,
  type RankId,
} from '../core/ranks';
import {
  ARMY_PIECE_TOTAL,
  TOURNAMENT_PRESETS,
  checkBackRowFlagTraverse,
  computeUnplacedCounts,
  formatAlgebraicCoord,
  generateEnemyTournamentDeployment,
  generateSmartAutoDeploy,
  isPlayerHomeSquare,
  loadCustomBlueprintSlots,
  mirrorDeploymentLR,
  saveCustomBlueprintSlot,
  validatePlayerDeployment,
  type DeploymentSlot,
} from '../core/RulesEngine';
import type {
  AppOptions,
  ArbiterVerdict,
  CameraMode,
  CasualtyView,
  ClashPublicStakes,
  DefconTier,
  DeploymentPresetId,
  HudBannerState,
  MatchPhase,
  MoveDirection,
  PlayerCombatDoctrine,
  PlayerVisibleView,
  ReplayPieceSnapshot,
  ReplayPlyEntry,
  SuspectTag,
  TruthPieceRecord,
  ValidMoveTarget,
  VisiblePieceView,
} from '../core/types';

export type StoreListener = (view: PlayerVisibleView, options: Readonly<AppOptions>) => void;

export type ShowcasePreset =
  | 'PLAYER_WIN'
  | 'ENEMY_WIN'
  | 'SPY_INTERCEPT'
  | 'MUTUAL_SPLIT'
  | 'FLAG_CAPTURE';

function computePublicClashStakes(
  playerPiece: Pick<TruthPieceRecord, 'trueRank' | 'challengesWon' | 'row'>,
  enemyPiece: Pick<TruthPieceRecord, 'challengesWon' | 'hasMoved' | 'row'>,
  attackerFaction: Faction,
  totalAlivePieces: number
): ClashPublicStakes {
  const pRank = playerPiece.trueRank;
  const playerDoctrine: PlayerCombatDoctrine =
    pRank === 'FLAG'
      ? 'FLAG_LAST_STAND'
      : pRank === 'SPY'
        ? 'COVERT_SPY'
        : pRank === 'GEN_5' ||
            pRank === 'GEN_4' ||
            pRank === 'GEN_3' ||
            pRank === 'GEN_2' ||
            pRank === 'GEN_1' ||
            pRank === 'COLONEL'
          ? 'HIGH_COMMAND'
          : 'INFANTRY';

  const isEnemyInitiatedAmbush = attackerFaction === 'ENEMY';
  const enemyUnmovedBackRow = !enemyPiece.hasMoved && enemyPiece.row <= 1;

  let defcon: DefconTier = 3;
  if (
    pRank === 'GEN_5' ||
    pRank === 'GEN_4' ||
    pRank === 'GEN_3' ||
    pRank === 'FLAG' ||
    enemyPiece.challengesWon >= 2 ||
    enemyUnmovedBackRow ||
    playerPiece.row >= 7 ||
    (isEnemyInitiatedAmbush && playerDoctrine === 'HIGH_COMMAND')
  ) {
    defcon = 1;
  } else if (
    pRank === 'SPY' ||
    pRank === 'GEN_2' ||
    pRank === 'GEN_1' ||
    pRank === 'COLONEL' ||
    pRank === 'LT_COLONEL' ||
    pRank === 'MAJOR' ||
    enemyPiece.challengesWon >= 1 ||
    isEnemyInitiatedAmbush ||
    totalAlivePieces <= 16
  ) {
    defcon = 2;
  }

  return {
    defcon,
    playerDoctrine,
    isEnemyInitiatedAmbush,
    playerPublicKills: playerPiece.challengesWon,
    enemyPublicKills: enemyPiece.challengesWon,
    enemyUnmovedBackRow,
  };
}

/**
 * Encapsulated State & Replay Vault (`GameStore.ts`).
 * - `#truthPieces` and `#replayPlies` are hard ECMAScript private fields:
 *   enemy `trueRank` is NEVER exposed during `DEPLOY` or `PLAY`, and is declassified ONLY in `REPLAY`!
 */
export class GameStore {
  #truthPieces = new Map<string, TruthPieceRecord>();
  #playerCasualties: CasualtyView[] = [];
  #enemyCasualties: CasualtyView[] = [];
  #replayPlies: ReplayPlyEntry[] = [];

  private phase: MatchPhase = 'DEPLOY';
  private activeTurn: Faction = 'PLAYER';
  private selectedPieceId: string | null = null;
  private selectedDeployRank: RankId | null = 'GEN_5';
  private suspectTags = new Map<string, SuspectTag>();
  private activeClash: ArbiterVerdict | null = null;
  private banner: HudBannerState = 'TACTICAL DEPLOYMENT';
  private cameraMode: CameraMode = 'PLAY';
  private turnCount = 1;
  private matchWinner: Faction | null = null;
  private winReason: string | null = null;
  private interactionLocked = false;
  private playerIdCounter = 0;

  // Classic 1970s 1-turn deferred back-row Flag traverse tracking
  private flagPendingGoalFaction: Faction | null = null;

  // Declassified Replay Scrubber State
  private replayCurrentPly = 0;
  private replayPlaying = false;
  private replayTimer: number | null = null;
  private aiTurnTimer: number | null = null;

  private readonly aiBelief = new AIBeliefState();
  private readonly aiStrategist = new AIStrategist();
  private readonly listeners = new Set<StoreListener>();

  public onAIClashTriggered?: (verdict: ArbiterVerdict) => void;
  public onAIQuietMove?: (publicKills: number) => void;

  private options: AppOptions = {
    audioMuted: false,
    musicVolume: 0.85,
    sfxVolume: 0.95,
    ambianceVolume: 0.75,
    hapticsEnabled: true,
    eraMode: '1980s',
    arbiterSpeed: '1x',
    renderQuality: 'ULTRA',
    boardView: 'COMMAND',
  };

  constructor() {
    this.startNewDeployment();
  }

  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.getVisibleView(), this.getOptions());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getOptions(): Readonly<AppOptions> {
    return { ...this.options };
  }

  public updateOptions(patch: Partial<AppOptions>): void {
    this.options = { ...this.options, ...patch };
    this.emit();
  }

  public cycleBoardView(): void {
    const order: AppOptions['boardView'][] = ['COMMAND', 'TACTICAL', 'OVERHEAD'];
    const idx = order.indexOf(this.options.boardView);
    const next = order[(idx + 1) % order.length]!;
    this.options = { ...this.options, boardView: next };
    if (this.cameraMode === 'INSPECT_16') {
      this.cameraMode = 'PLAY';
      this.banner =
        this.phase === 'DEPLOY'
          ? 'TACTICAL DEPLOYMENT'
          : this.selectedPieceId
            ? 'SELECT TARGET'
            : 'TACTICAL COMMAND';
    }
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Tactical Deployment Drawer, Presets & Custom Blueprints
  // ---------------------------------------------------------------------------

  /**
   * Opens a fresh match in **Tactical Deployment Mode**:
   * - Stages Enemy's 21 unmarked wedges across Enemy Home Rows `0..2`.
   * - Highlights Player's 27 Home Squares (`Rows 5..7`) and opens the Mobilization Crate Drawer!
   */
  public startNewDeployment(initialPreset?: DeploymentPresetId): void {
    this.clearTimers();
    this.#truthPieces.clear();
    this.#playerCasualties = [];
    this.#enemyCasualties = [];
    this.#replayPlies = [];
    this.suspectTags.clear();

    this.phase = 'DEPLOY';
    this.activeTurn = 'PLAYER';
    this.selectedPieceId = null;
    this.selectedDeployRank = 'GEN_5';
    this.activeClash = null;
    this.cameraMode = 'PLAY';
    this.banner = 'TACTICAL DEPLOYMENT';
    this.turnCount = 1;
    this.matchWinner = null;
    this.winReason = null;
    this.interactionLocked = false;
    this.flagPendingGoalFaction = null;
    this.playerIdCounter = 0;

    // Deploy Enemy army on Rows 0..2
    const enemySlots = generateEnemyTournamentDeployment();
    enemySlots.forEach((slot, idx) => {
      const id = `e_${idx.toString().padStart(2, '0')}`;
      this.#truthPieces.set(id, {
        id,
        faction: 'ENEMY',
        trueRank: slot.rank,
        col: slot.col,
        row: slot.row,
        alive: true,
        hasMoved: false,
        challengesWon: 0,
      });
    });

    if (initialPreset) {
      this.setPlayerDeploymentSlots(TOURNAMENT_PRESETS[initialPreset]);
    }

    this.emit();
  }

  /**
   * Legacy alias used by Reset button: starts a fresh Tactical Deployment (or quick-deploy).
   */
  public resetSandbox(): void {
    this.startNewDeployment();
  }

  public selectDeployRank(rank: RankId | null): void {
    if (this.phase !== 'DEPLOY') return;
    this.selectedDeployRank = rank;
    this.selectedPieceId = null;
    this.emit();
  }

  public applyDeploymentPreset(preset: DeploymentPresetId): void {
    if (this.phase !== 'DEPLOY') return;
    this.setPlayerDeploymentSlots(TOURNAMENT_PRESETS[preset]);
    this.selectedDeployRank = null;
    this.selectedPieceId = null;
    this.emit();
  }

  public autoDeployPlayer(): void {
    if (this.phase !== 'DEPLOY') return;
    this.setPlayerDeploymentSlots(generateSmartAutoDeploy());
    this.selectedDeployRank = null;
    this.selectedPieceId = null;
    this.emit();
  }

  public clearPlayerDeployment(): void {
    if (this.phase !== 'DEPLOY') return;
    for (const [id, rec] of Array.from(this.#truthPieces.entries())) {
      if (rec.faction === 'PLAYER') {
        this.#truthPieces.delete(id);
      }
    }
    this.selectedPieceId = null;
    this.selectedDeployRank = 'GEN_5';
    this.emit();
  }

  public mirrorPlayerDeployment(): void {
    if (this.phase !== 'DEPLOY') return;
    const current = this.getPlayerDeploymentSlots();
    if (current.length === 0) return;
    const mirrored = mirrorDeploymentLR(current);
    this.setPlayerDeploymentSlots(mirrored);
    this.emit();
  }

  public saveBlueprintToSlot(slotIndex: number): boolean {
    const slots = this.getPlayerDeploymentSlots();
    if (!validatePlayerDeployment(slots)) return false;
    saveCustomBlueprintSlot(slotIndex, slots);
    this.emit();
    return true;
  }

  public loadBlueprintFromSlot(slotIndex: number): boolean {
    if (this.phase !== 'DEPLOY') return false;
    const all = loadCustomBlueprintSlots();
    const target = all[slotIndex];
    if (!target) return false;
    this.setPlayerDeploymentSlots(target.slots);
    this.selectedDeployRank = null;
    this.selectedPieceId = null;
    this.emit();
    return true;
  }

  /**
   * Handles all Deployment Square interactions (`Rows 5..7`):
   * - Dragging from Crate (`explicitRank`) -> places onto empty square OR replaces/swaps existing square!
   * - Dragging an already-placed friendly piece (`draggedPieceId`) -> moves to empty square OR swaps with occupant!
   * - Tap-to-Place / Tap-to-Swap!
   */
  public placeOrSwapDeployment(
    col: number,
    row: number,
    explicitRank?: RankId,
    draggedPieceId?: string
  ): boolean {
    if (this.phase !== 'DEPLOY' || !isPlayerHomeSquare(col, row)) return false;

    const occupant = this.findAliveAt(col, row);

    // Case 1: Dragging or moving an already-placed friendly piece on the board
    const movingId = draggedPieceId ?? (!explicitRank && !this.selectedDeployRank ? this.selectedPieceId : null);
    if (movingId) {
      const movingPiece = this.#truthPieces.get(movingId);
      if (!movingPiece || movingPiece.faction !== 'PLAYER') return false;
      if (movingPiece.col === col && movingPiece.row === row) {
        this.selectedPieceId = null;
        this.emit();
        return false;
      }
      if (occupant && occupant.faction === 'PLAYER') {
        // Smoothly swap their squares!
        const oldCol = movingPiece.col;
        const oldRow = movingPiece.row;
        movingPiece.col = col;
        movingPiece.row = row;
        occupant.col = oldCol;
        occupant.row = oldRow;
      } else if (!occupant) {
        movingPiece.col = col;
        movingPiece.row = row;
      }
      this.selectedPieceId = null;
      this.emit();
      return true;
    }

    // Case 2: Placing a rank from the Mobilization Crate
    const rankToPlace = explicitRank ?? this.selectedDeployRank;
    if (!rankToPlace) {
      if (occupant && occupant.faction === 'PLAYER') {
        this.selectedPieceId = occupant.id;
        this.emit();
      }
      return false;
    }

    const unplaced = computeUnplacedCounts(this.getPlayerDeploymentSlots());
    if (unplaced[rankToPlace] <= 0) {
      // If tapping an occupied square when crate rank is exhausted, select that board piece for swapping
      if (occupant && occupant.faction === 'PLAYER') {
        this.selectedDeployRank = null;
        this.selectedPieceId = occupant.id;
        this.emit();
      }
      return false;
    }

    if (occupant && occupant.faction === 'PLAYER') {
      // Replace occupant's rank (returning old rank to crate)
      (occupant as { trueRank: RankId }).trueRank = rankToPlace;
    } else if (!occupant) {
      const id = `p_${(this.playerIdCounter++).toString().padStart(2, '0')}`;
      this.#truthPieces.set(id, {
        id,
        faction: 'PLAYER',
        trueRank: rankToPlace,
        col,
        row,
        alive: true,
        hasMoved: false,
        challengesWon: 0,
      });
    }

    // Auto-advance `selectedDeployRank` to the next unplaced rank once exhausted!
    const nextUnplaced = computeUnplacedCounts(this.getPlayerDeploymentSlots());
    if (nextUnplaced[rankToPlace] <= 0) {
      this.selectedDeployRank = ORDERED_RANKS.find((r) => nextUnplaced[r] > 0) ?? null;
    }
    this.selectedPieceId = null;
    this.emit();
    return true;
  }

  public removeDeployedPiece(pieceId: string): boolean {
    if (this.phase !== 'DEPLOY') return false;
    const rec = this.#truthPieces.get(pieceId);
    if (!rec || rec.faction !== 'PLAYER') return false;
    const rank = rec.trueRank;
    this.#truthPieces.delete(pieceId);
    if (this.selectedPieceId === pieceId) this.selectedPieceId = null;
    this.selectedDeployRank = rank;
    this.emit();
    return true;
  }

  /**
   * Locks in the 21-piece Player deployment and launches Active Turn Combat (`PLAY` phase)!
   */
  public launchBattleFromDeployment(): boolean {
    if (this.phase !== 'DEPLOY') return false;
    const slots = this.getPlayerDeploymentSlots();
    if (!validatePlayerDeployment(slots)) return false;

    this.phase = 'PLAY';
    this.activeTurn = 'PLAYER';
    this.turnCount = 1;
    this.selectedDeployRank = null;

    const playerIds = Array.from(this.#truthPieces.values())
      .filter((p) => p.faction === 'PLAYER' && p.alive)
      .map((p) => p.id);
    this.aiBelief.initializeUnknownArmy(playerIds);

    // Pre-select a frontline Player piece on Row 5 so directional move arrows shine immediately!
    const vanguard =
      Array.from(this.#truthPieces.values()).find(
        (p) => p.faction === 'PLAYER' && p.alive && p.row === 5
      ) ?? null;
    this.selectedPieceId = vanguard?.id ?? null;
    this.banner = this.selectedPieceId ? 'SELECT TARGET' : 'TACTICAL COMMAND';

    // Record Ply 0 (`Initial Formation`) in `#replayPlies`
    this.#replayPlies = [
      {
        plyIndex: 0,
        turnNumber: 0,
        actorFaction: 'SYSTEM',
        summary: 'T0: Armies Deployed — 42 Units Locked In Position',
        fromCoord: null,
        toCoord: null,
        wasClash: false,
        boardSnapshot: this.captureTruthSnapshot(),
      },
    ];

    this.emit();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Active Play, Suspect Tagging & Non-Cheating AI Turn Loop
  // ---------------------------------------------------------------------------

  public setCameraMode(mode: CameraMode): void {
    if (this.interactionLocked && mode !== 'ARBITER') return;
    if (mode !== 'REPLAY' && this.phase === 'REPLAY') {
      this.stopReplayAutoPlay();
      this.phase = this.matchWinner ? 'GAME_OVER' : 'DEPLOY';
    }
    this.cameraMode = mode;
    if (mode === 'INSPECT_16') {
      this.banner = '16-EMBLEM INSPECTION';
    } else if (mode === 'PLAY') {
      this.banner =
        this.phase === 'DEPLOY'
          ? 'TACTICAL DEPLOYMENT'
          : this.selectedPieceId
            ? 'SELECT TARGET'
            : 'TACTICAL COMMAND';
    }
    this.emit();
  }

  public selectPiece(pieceId: string | null): void {
    if (this.interactionLocked || this.cameraMode !== 'PLAY') return;

    if (this.phase === 'DEPLOY') {
      if (!pieceId) {
        this.selectedPieceId = null;
        this.emit();
        return;
      }
      const p = this.#truthPieces.get(pieceId);
      if (p && p.faction === 'PLAYER') {
        this.selectedDeployRank = null;
        this.selectedPieceId = this.selectedPieceId === pieceId ? null : pieceId;
        this.emit();
      }
      return;
    }

    if (this.phase !== 'PLAY' || this.activeTurn !== 'PLAYER') return;
    if (!pieceId) {
      this.selectedPieceId = null;
      this.banner = 'TACTICAL COMMAND';
      this.emit();
      return;
    }
    const piece = this.#truthPieces.get(pieceId);
    if (!piece || !piece.alive || piece.faction !== 'PLAYER') {
      return;
    }
    this.selectedPieceId = this.selectedPieceId === pieceId ? null : pieceId;
    this.banner = this.selectedPieceId ? 'SELECT TARGET' : 'TACTICAL COMMAND';
    this.emit();
  }

  /**
   * Attaches or clears a Player psychological deduction tag (`SPY?`, `GEN?`, `PVT?`, `OFF?`, `FLAG?`)
   * on an unmarked Enemy piece (`320ms` long-press or double-tap).
   */
  public setEnemySuspectTag(pieceId: string, tag: SuspectTag | null): void {
    const rec = this.#truthPieces.get(pieceId);
    if (!rec || !rec.alive || rec.faction !== 'ENEMY') return;
    if (!tag) {
      this.suspectTags.delete(pieceId);
    } else {
      this.suspectTags.set(pieceId, tag);
    }
    this.emit();
  }

  public computeValidMoves(pieceId: string | null): ValidMoveTarget[] {
    if (!pieceId || this.phase !== 'PLAY' || this.activeTurn !== 'PLAYER') return [];
    const piece = this.#truthPieces.get(pieceId);
    if (!piece || !piece.alive || piece.faction !== 'PLAYER') return [];

    const dirs: Array<{ dc: number; dr: number; direction: MoveDirection }> = [
      { dc: 0, dr: -1, direction: 'UP' },
      { dc: 0, dr: 1, direction: 'DOWN' },
      { dc: -1, dr: 0, direction: 'LEFT' },
      { dc: 1, dr: 0, direction: 'RIGHT' },
    ];

    const results: ValidMoveTarget[] = [];
    for (const d of dirs) {
      const nc = piece.col + d.dc;
      const nr = piece.row + d.dr;
      if (nc < 0 || nc >= BOARD_COLS || nr < 0 || nr >= BOARD_ROWS) continue;

      const occupant = this.findAliveAt(nc, nr);
      if (!occupant) {
        results.push({ col: nc, row: nr, direction: d.direction, kind: 'MOVE' });
      } else if (occupant.faction === 'ENEMY') {
        results.push({
          col: nc,
          row: nr,
          direction: d.direction,
          kind: 'CHALLENGE',
          targetPieceId: occupant.id,
        });
      }
    }
    return results;
  }

  public executeMoveOrChallenge(
    col: number,
    row: number,
    explicitPieceId?: string
  ): { kind: 'MOVED' } | { kind: 'CLASH'; verdict: ArbiterVerdict } | null {
    if (
      this.interactionLocked ||
      this.phase !== 'PLAY' ||
      this.activeTurn !== 'PLAYER' ||
      this.cameraMode !== 'PLAY'
    ) {
      return null;
    }
    const pid = explicitPieceId ?? this.selectedPieceId;
    if (!pid) return null;

    const valid = this.computeValidMoves(pid).find((m) => m.col === col && m.row === row);
    if (!valid) return null;

    const mover = this.#truthPieces.get(pid);
    if (!mover || !mover.alive) return null;

    const fromCoord = { col: mover.col, row: mover.row };
    const toCoord = { col, row };

    if (valid.kind === 'MOVE') {
      mover.col = col;
      mover.row = row;
      mover.hasMoved = true;

      this.recordReplayPly({
        turnNumber: this.turnCount,
        actorFaction: 'PLAYER',
        summary: `T${this.turnCount}: Navy ${RANK_SPECS[mover.trueRank].shortLabel} (${formatAlgebraicCoord(fromCoord.col, fromCoord.row)}→${formatAlgebraicCoord(col, row)})`,
        fromCoord,
        toCoord,
        wasClash: false,
      });

      this.selectedPieceId = null;
      if (this.evaluateFlagTraverseAfterMove('PLAYER')) {
        return { kind: 'MOVED' };
      }

      this.turnCount += 1;
      this.scheduleEnemyTurn(560);
      return { kind: 'MOVED' };
    }

    const defender = valid.targetPieceId ? this.#truthPieces.get(valid.targetPieceId) : undefined;
    if (!defender || !defender.alive) return null;

    return { kind: 'CLASH', verdict: this.initiateClash(mover, defender, toCoord) };
  }

  private initiateClash(
    attacker: TruthPieceRecord,
    defender: TruthPieceRecord,
    contestedCoord: { col: number; row: number }
  ): ArbiterVerdict {
    const totalAlive = Array.from(this.#truthPieces.values()).filter((p) => p.alive).length;
    const playerRec = attacker.faction === 'PLAYER' ? attacker : defender;
    const enemyRec = attacker.faction === 'ENEMY' ? attacker : defender;
    const stakes = computePublicClashStakes(playerRec, enemyRec, attacker.faction, totalAlive);

    const baseVerdict = resolveArbiterChallenge({
      contestedCoord,
      attackerId: attacker.id,
      attackerFaction: attacker.faction,
      attackerTrueRank: attacker.trueRank,
      defenderId: defender.id,
      defenderFaction: defender.faction,
      defenderTrueRank: defender.trueRank,
    });
    const verdict: ArbiterVerdict = { ...baseVerdict, stakes };

    this.interactionLocked = true;
    this.selectedPieceId = null;
    this.activeClash = verdict;
    this.cameraMode = 'ARBITER';
    this.banner =
      stakes.defcon === 1
        ? 'DEFCON 1 — HIGH COMMAND ALERT'
        : stakes.playerDoctrine === 'COVERT_SPY'
          ? 'OPERATION STILETTO — COVERT STRIKE'
          : stakes.isEnemyInitiatedAmbush
            ? 'ENEMY AMBUSH — BRACE!'
            : 'CLASH LOCK-IN';
    this.emit();
    return verdict;
  }

  public finalizeActiveClash(): void {
    const verdict = this.activeClash;
    if (!verdict) return;

    const attacker = this.#truthPieces.get(verdict.attackerId);
    const defender = this.#truthPieces.get(verdict.defenderId);
    if (!attacker || !defender) return;

    const fromCoord = { col: attacker.col, row: attacker.row };
    const toCoord = verdict.contestedCoord;

    const aiPiece = attacker.faction === 'ENEMY' ? attacker : defender;
    this.aiBelief.recordObservedClash(verdict, aiPiece.trueRank);

    if (verdict.resolution === 'MUTUAL_SPLIT') {
      this.eliminatePiece(attacker);
      this.eliminatePiece(defender);
    } else if (verdict.survivorId === attacker.id) {
      this.eliminatePiece(defender);
      attacker.col = verdict.contestedCoord.col;
      attacker.row = verdict.contestedCoord.row;
      attacker.hasMoved = true;
      attacker.challengesWon += 1;
    } else {
      this.eliminatePiece(attacker);
      defender.challengesWon += 1;
    }

    const atkName = `${attacker.faction === 'PLAYER' ? 'Navy' : 'Crimson'} ${RANK_SPECS[attacker.trueRank].shortLabel}`;
    const defName = `${defender.faction === 'PLAYER' ? 'Navy' : 'Crimson'} ${RANK_SPECS[defender.trueRank].shortLabel}`;
    const resText =
      verdict.resolution === 'MUTUAL_SPLIT'
        ? 'Mutual Elimination'
        : verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER'
          ? 'Enemy Flag Captured!'
          : verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY'
            ? 'Navy Flag Captured!'
            : verdict.survivorFaction === 'PLAYER'
              ? 'Navy Wins'
              : 'Crimson Wins';

    this.recordReplayPly({
      turnNumber: this.turnCount,
      actorFaction: attacker.faction,
      summary: `T${this.turnCount}: ${atkName} vs. ${defName} (${formatAlgebraicCoord(toCoord.col, toCoord.row)}) — ${resText}`,
      fromCoord,
      toCoord,
      wasClash: true,
      resolution: verdict.resolution,
    });

    this.activeClash = null;
    this.cameraMode = 'PLAY';
    this.interactionLocked = false;

    if (verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      this.declareMatchWinner('PLAYER', 'FLAG CAPTURED — VICTORY', 'Enemy Flag eliminated in combat');
      return;
    }
    if (verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY') {
      this.declareMatchWinner('ENEMY', 'FLAG LOST — DEFEAT', 'Your Flag fell to Crimson forces');
      return;
    }

    if (this.evaluateFlagTraverseAfterMove(attacker.faction)) {
      return;
    }

    this.turnCount += 1;
    if (attacker.faction === 'PLAYER') {
      // Sacred 680ms Breathable Aftermath Lock before AI moves!
      this.scheduleEnemyTurn(680);
    } else {
      this.activeTurn = 'PLAYER';
      this.banner = 'TACTICAL COMMAND';
      this.emit();
    }
  }

  private scheduleEnemyTurn(delayMs: number): void {
    if (this.phase !== 'PLAY' || this.matchWinner) return;
    this.activeTurn = 'ENEMY';
    this.banner = 'ENEMY MANEUVERING...';
    this.emit();

    if (this.aiTurnTimer !== null) window.clearTimeout(this.aiTurnTimer);
    this.aiTurnTimer = window.setTimeout(() => {
      this.aiTurnTimer = null;
      this.executeEnemyTurnNow();
    }, delayMs);
  }

  private executeEnemyTurnNow(): void {
    if (this.phase !== 'PLAY' || this.activeTurn !== 'ENEMY' || this.interactionLocked) return;

    // 1970s Deferred Back-Row Traverse check at start of turn
    if (this.flagPendingGoalFaction === 'ENEMY') {
      const enemyFlag = Array.from(this.#truthPieces.values()).find(
        (p) => p.alive && p.faction === 'ENEMY' && p.trueRank === 'FLAG' && p.row === BOARD_ROWS - 1
      );
      if (enemyFlag) {
        this.declareMatchWinner('ENEMY', 'FLAG LOST — DEFEAT', 'Crimson Flag secured your home rank');
        return;
      }
      this.flagPendingGoalFaction = null;
    }

    const aiUnits: AIOwnPieceInfo[] = [];
    const observedPlayers: ObservedPlayerPieceInfo[] = [];
    for (const p of this.#truthPieces.values()) {
      if (!p.alive) continue;
      if (p.faction === 'ENEMY') {
        aiUnits.push({ id: p.id, ownRank: p.trueRank, col: p.col, row: p.row });
      } else {
        // ZERO Player `trueRank` passed to AI!
        observedPlayers.push({
          id: p.id,
          col: p.col,
          row: p.row,
          publicKills: p.challengesWon,
          hasMoved: p.hasMoved,
        });
      }
    }

    const decision = this.aiStrategist.chooseMove(aiUnits, observedPlayers, this.aiBelief);
    if (!decision) {
      this.declareMatchWinner('PLAYER', 'FLAG CAPTURED — VICTORY', 'Crimson forces immobilized');
      return;
    }

    const mover = this.#truthPieces.get(decision.pieceId);
    if (!mover || !mover.alive) return;

    const fromCoord = { col: mover.col, row: mover.row };
    const toCoord = { col: decision.toCol, row: decision.toRow };
    const occupant = this.findAliveAt(toCoord.col, toCoord.row);

    if (occupant && occupant.faction === 'PLAYER') {
      const verdict = this.initiateClash(mover, occupant, toCoord);
      this.onAIClashTriggered?.(verdict);
      return;
    }

    mover.col = toCoord.col;
    mover.row = toCoord.row;
    mover.hasMoved = true;
    this.onAIQuietMove?.(mover.challengesWon);

    this.recordReplayPly({
      turnNumber: this.turnCount,
      actorFaction: 'ENEMY',
      summary: `T${this.turnCount}: Crimson ${RANK_SPECS[mover.trueRank].shortLabel} (${formatAlgebraicCoord(fromCoord.col, fromCoord.row)}→${formatAlgebraicCoord(toCoord.col, toCoord.row)})`,
      fromCoord,
      toCoord,
      wasClash: false,
    });

    if (this.evaluateFlagTraverseAfterMove('ENEMY')) {
      return;
    }

    this.turnCount += 1;
    // Check if Player's Flag survived 1970s deferred 1-turn check on Row 0!
    if (this.flagPendingGoalFaction === 'PLAYER') {
      const playerFlag = Array.from(this.#truthPieces.values()).find(
        (p) => p.alive && p.faction === 'PLAYER' && p.trueRank === 'FLAG' && p.row === 0
      );
      if (playerFlag) {
        this.declareMatchWinner(
          'PLAYER',
          'FLAG TRAVERSE — VICTORY',
          'Navy Flag survived on Crimson home rank!'
        );
        return;
      }
      this.flagPendingGoalFaction = null;
    }

    this.activeTurn = 'PLAYER';
    this.banner = 'TACTICAL COMMAND';
    this.emit();
  }

  private evaluateFlagTraverseAfterMove(movedFaction: Faction): boolean {
    const all = Array.from(this.#truthPieces.values());
    const winner = checkBackRowFlagTraverse(
      all,
      movedFaction,
      this.options.eraMode,
      this.flagPendingGoalFaction === movedFaction
    );
    if (winner) {
      this.declareMatchWinner(
        winner,
        winner === 'PLAYER' ? 'FLAG TRAVERSE — VICTORY' : 'FLAG LOST — DEFEAT',
        winner === 'PLAYER'
          ? 'Navy Flag reached the Crimson back row!'
          : 'Crimson Flag breached your home row!'
      );
      return true;
    }

    // Track 1970s Classic 1-turn survival pending flag
    for (const p of all) {
      if (!p.alive || p.trueRank !== 'FLAG') continue;
      const goalRow = p.faction === 'PLAYER' ? 0 : BOARD_ROWS - 1;
      if (p.row === goalRow) {
        this.flagPendingGoalFaction = p.faction;
      }
    }
    return false;
  }

  private declareMatchWinner(winner: Faction, banner: HudBannerState, reason: string): void {
    this.clearTimers();
    this.matchWinner = winner;
    this.winReason = reason;
    this.phase = 'GAME_OVER';
    this.banner = banner;
    this.selectedPieceId = null;
    this.interactionLocked = false;
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Showcase Clash Archetypes (Auto-stages Vaccination if called during DEPLOY!)
  // ---------------------------------------------------------------------------

  public triggerShowcaseClash(preset: ShowcasePreset): ArbiterVerdict | null {
    if (this.interactionLocked) return null;
    this.clearTimers();
    if (this.phase !== 'PLAY') {
      if (this.getPlayerDeploymentSlots().length < ARMY_PIECE_TOTAL) {
        this.setPlayerDeploymentSlots(TOURNAMENT_PRESETS.VACCINATION);
      }
      this.launchBattleFromDeployment();
    }
    if (this.cameraMode === 'INSPECT_16' || this.cameraMode === 'REPLAY') {
      this.cameraMode = 'PLAY';
    }

    let playerPiece =
      Array.from(this.#truthPieces.values()).find(
        (p) => p.alive && p.faction === 'PLAYER' && p.trueRank === 'SERGEANT'
      ) ??
      Array.from(this.#truthPieces.values()).find((p) => p.alive && p.faction === 'PLAYER');

    let enemyPiece = Array.from(this.#truthPieces.values()).find(
      (p) => p.alive && p.faction === 'ENEMY' && p.trueRank !== 'FLAG'
    );

    if (!playerPiece || !enemyPiece) {
      this.startNewDeployment('VACCINATION');
      this.launchBattleFromDeployment();
      playerPiece = Array.from(this.#truthPieces.values()).find((p) => p.faction === 'PLAYER')!;
      enemyPiece = Array.from(this.#truthPieces.values()).find((p) => p.faction === 'ENEMY')!;
    }

    let attackerFaction: Faction = 'PLAYER';

    if (preset === 'PLAYER_WIN') {
      const pRank = playerPiece.trueRank === 'FLAG' ? 'GEN_4' : playerPiece.trueRank;
      (playerPiece as { trueRank: RankId }).trueRank = pRank;
      (enemyPiece as { trueRank: RankId }).trueRank = pRank === 'PRIVATE' ? 'SPY' : 'PRIVATE';
      attackerFaction = 'PLAYER';
    } else if (preset === 'ENEMY_WIN') {
      const pOfficer =
        Array.from(this.#truthPieces.values()).find(
          (p) =>
            p.alive &&
            p.faction === 'PLAYER' &&
            (p.trueRank === 'GEN_4' || p.trueRank === 'COLONEL')
        ) ?? playerPiece;
      playerPiece = pOfficer;
      (enemyPiece as { trueRank: RankId }).trueRank =
        playerPiece.trueRank === 'GEN_5' ? 'SPY' : 'GEN_5';
      enemyPiece.challengesWon = Math.max(2, enemyPiece.challengesWon);
      attackerFaction = 'PLAYER';
    } else if (preset === 'SPY_INTERCEPT') {
      const pPvt =
        Array.from(this.#truthPieces.values()).find(
          (p) => p.alive && p.faction === 'PLAYER' && p.trueRank === 'PRIVATE'
        ) ?? playerPiece;
      playerPiece = pPvt;
      (playerPiece as { trueRank: RankId }).trueRank = 'PRIVATE';
      (enemyPiece as { trueRank: RankId }).trueRank = 'SPY';
      enemyPiece.challengesWon = Math.max(2, enemyPiece.challengesWon);
      attackerFaction = 'ENEMY';
    } else if (preset === 'MUTUAL_SPLIT') {
      const pRank = playerPiece.trueRank === 'FLAG' ? 'COLONEL' : playerPiece.trueRank;
      (playerPiece as { trueRank: RankId }).trueRank = pRank;
      (enemyPiece as { trueRank: RankId }).trueRank = pRank;
      attackerFaction = 'PLAYER';
    } else if (preset === 'FLAG_CAPTURE') {
      const enemyFlag =
        Array.from(this.#truthPieces.values()).find(
          (p) => p.alive && p.faction === 'ENEMY' && p.trueRank === 'FLAG'
        ) ?? enemyPiece;
      (enemyFlag as { trueRank: RankId }).trueRank = 'FLAG';
      enemyPiece = enemyFlag;
      attackerFaction = 'PLAYER';
    }

    const contestedCoord =
      attackerFaction === 'PLAYER'
        ? { col: enemyPiece.col, row: enemyPiece.row }
        : { col: playerPiece.col, row: playerPiece.row };

    const attacker = attackerFaction === 'PLAYER' ? playerPiece : enemyPiece;
    const defender = attackerFaction === 'PLAYER' ? enemyPiece : playerPiece;

    return this.initiateClash(attacker, defender, contestedCoord);
  }

  public setArbiterBanner(banner: HudBannerState): void {
    this.banner = banner;
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Post-Match "Declassified" X-Ray Replay Theater
  // ---------------------------------------------------------------------------

  public enterDeclassifiedReplay(): void {
    this.clearTimers();
    if (this.#replayPlies.length <= 1) {
      this.populateSampleDeclassifiedLog();
    }
    this.phase = 'REPLAY';
    this.cameraMode = 'REPLAY';
    this.banner = 'DECLASSIFIED X-RAY REPLAY';
    this.replayCurrentPly = Math.max(0, this.#replayPlies.length - 1);
    this.replayPlaying = false;
    this.emit();
  }

  public setReplayPly(plyIndex: number): void {
    if (this.phase !== 'REPLAY' || this.#replayPlies.length === 0) return;
    this.replayCurrentPly = Math.max(0, Math.min(this.#replayPlies.length - 1, plyIndex));
    this.emit();
  }

  public stepReplay(delta: number): void {
    this.stopReplayAutoPlay();
    this.setReplayPly(this.replayCurrentPly + delta);
  }

  public toggleReplayAutoPlay(): void {
    if (this.phase !== 'REPLAY' || this.#replayPlies.length === 0) return;
    if (this.replayPlaying) {
      this.stopReplayAutoPlay();
      this.emit();
      return;
    }
    if (this.replayCurrentPly >= this.#replayPlies.length - 1) {
      this.replayCurrentPly = 0;
    }
    this.replayPlaying = true;
    this.replayTimer = window.setInterval(() => {
      if (this.replayCurrentPly < this.#replayPlies.length - 1) {
        this.replayCurrentPly += 1;
        this.emit();
      } else {
        this.stopReplayAutoPlay();
        this.emit();
      }
    }, 1050);
    this.emit();
  }

  private stopReplayAutoPlay(): void {
    this.replayPlaying = false;
    if (this.replayTimer !== null) {
      window.clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Visible View Projection (100% Rank-Blind During DEPLOY & PLAY!)
  // ---------------------------------------------------------------------------

  public getVisibleView(): PlayerVisibleView {
    const pieces: VisiblePieceView[] = [];
    let deployedCount = 0;

    for (const record of this.#truthPieces.values()) {
      if (!record.alive) continue;
      if (record.faction === 'PLAYER') deployedCount += 1;
      pieces.push({
        id: record.id,
        faction: record.faction,
        visibleRank: record.faction === 'PLAYER' ? record.trueRank : 'UNKNOWN',
        col: record.col,
        row: record.row,
        alive: record.alive,
        publicKills: record.challengesWon,
        hasMoved: record.hasMoved,
        suspectTag: record.faction === 'ENEMY' ? (this.suspectTags.get(record.id) ?? null) : null,
      });
    }

    const unplacedCounts = computeUnplacedCounts(this.getPlayerDeploymentSlots());
    const savedSlots = loadCustomBlueprintSlots().map((s) => s !== null);

    return {
      phase: this.phase,
      activeTurn: this.activeTurn,
      pieces,
      playerCasualties: [...this.#playerCasualties],
      enemyCasualties: [...this.#enemyCasualties],
      selectedPieceId: this.selectedPieceId,
      selectedDeployRank: this.selectedDeployRank,
      deployedCount,
      unplacedCounts,
      savedBlueprintSlots: savedSlots,
      validMoves: this.computeValidMoves(this.selectedPieceId),
      activeClash: this.activeClash,
      banner: this.banner,
      cameraMode: this.cameraMode,
      turnCount: this.turnCount,
      matchWinner: this.matchWinner,
      winReason: this.winReason,
      // Declassified Replay is ONLY projected when `phase === 'REPLAY'`!
      replay:
        this.phase === 'REPLAY'
          ? {
              currentPly: this.replayCurrentPly,
              maxPly: Math.max(0, this.#replayPlies.length - 1),
              playing: this.replayPlaying,
              plies: this.#replayPlies,
            }
          : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private getPlayerDeploymentSlots(): DeploymentSlot[] {
    const slots: DeploymentSlot[] = [];
    for (const r of this.#truthPieces.values()) {
      if (r.alive && r.faction === 'PLAYER') {
        slots.push({ col: r.col, row: r.row, rank: r.trueRank });
      }
    }
    return slots;
  }

  private setPlayerDeploymentSlots(slots: readonly DeploymentSlot[]): void {
    for (const [id, rec] of Array.from(this.#truthPieces.entries())) {
      if (rec.faction === 'PLAYER') {
        this.#truthPieces.delete(id);
      }
    }
    slots.forEach((s) => {
      const id = `p_${(this.playerIdCounter++).toString().padStart(2, '0')}`;
      this.#truthPieces.set(id, {
        id,
        faction: 'PLAYER',
        trueRank: s.rank,
        col: s.col,
        row: s.row,
        alive: true,
        hasMoved: false,
        challengesWon: 0,
      });
    });
  }

  private captureTruthSnapshot(): ReplayPieceSnapshot[] {
    const snap: ReplayPieceSnapshot[] = [];
    for (const r of this.#truthPieces.values()) {
      snap.push({
        id: r.id,
        faction: r.faction,
        trueRank: r.trueRank,
        col: r.col,
        row: r.row,
        alive: r.alive,
        kills: r.challengesWon,
      });
    }
    return snap;
  }

  private recordReplayPly(entry: Omit<ReplayPlyEntry, 'plyIndex' | 'boardSnapshot'>): void {
    this.#replayPlies.push({
      ...entry,
      plyIndex: this.#replayPlies.length,
      boardSnapshot: this.captureTruthSnapshot(),
    });
  }

  private populateSampleDeclassifiedLog(): void {
    // Synthesizes a thrilling 6-ply Declassified Tactical Operation when opened as a standalone demo!
    if (this.getPlayerDeploymentSlots().length < ARMY_PIECE_TOTAL) {
      this.setPlayerDeploymentSlots(TOURNAMENT_PRESETS.IRON_BLITZ);
    }
    const baseSnap = this.captureTruthSnapshot().map((p) => ({ ...p }));
    const cloneSnap = (list: ReplayPieceSnapshot[]) => list.map((p) => ({ ...p }));

    const plies: ReplayPlyEntry[] = [
      {
        plyIndex: 0,
        turnNumber: 0,
        actorFaction: 'SYSTEM',
        summary: 'T0: Declassified Archive — Iron Blitz vs. Crimson Fortress',
        fromCoord: null,
        toCoord: null,
        wasClash: false,
        boardSnapshot: cloneSnap(baseSnap),
      },
    ];

    const p5Star = baseSnap.find((p) => p.faction === 'PLAYER' && p.trueRank === 'GEN_5');
    const eFront = baseSnap.find((p) => p.faction === 'ENEMY' && p.row === 2);
    if (p5Star) {
      const f = { col: p5Star.col, row: p5Star.row };
      p5Star.row = Math.max(0, p5Star.row - 1);
      plies.push({
        plyIndex: 1,
        turnNumber: 1,
        actorFaction: 'PLAYER',
        summary: `T1: Navy 5★ GEN (${formatAlgebraicCoord(f.col, f.row)}→${formatAlgebraicCoord(p5Star.col, p5Star.row)})`,
        fromCoord: f,
        toCoord: { col: p5Star.col, row: p5Star.row },
        wasClash: false,
        boardSnapshot: cloneSnap(baseSnap),
      });
    }

    if (eFront && p5Star) {
      const ef = { col: eFront.col, row: eFront.row };
      eFront.col = p5Star.col;
      eFront.row = p5Star.row;
      eFront.alive = false;
      p5Star.kills += 1;
      plies.push({
        plyIndex: 2,
        turnNumber: 2,
        actorFaction: 'ENEMY',
        summary: `T2: Crimson ${RANK_SPECS[eFront.trueRank].shortLabel} vs. Navy 5★ GEN (${formatAlgebraicCoord(p5Star.col, p5Star.row)}) — Navy Wins`,
        fromCoord: ef,
        toCoord: { col: p5Star.col, row: p5Star.row },
        wasClash: true,
        resolution: 'PLAYER_WINS',
        boardSnapshot: cloneSnap(baseSnap),
      });
    }

    const pPvt = baseSnap.find((p) => p.faction === 'PLAYER' && p.trueRank === 'PRIVATE' && p.alive);
    const eSpy = baseSnap.find((p) => p.faction === 'ENEMY' && p.trueRank === 'SPY' && p.alive);
    if (pPvt && eSpy) {
      const pf = { col: pPvt.col, row: pPvt.row };
      pPvt.col = eSpy.col;
      pPvt.row = eSpy.row;
      eSpy.alive = false;
      pPvt.kills += 1;
      plies.push({
        plyIndex: plies.length,
        turnNumber: 3,
        actorFaction: 'PLAYER',
        summary: `T3: Navy PRIVATE vs. Crimson SPY (${formatAlgebraicCoord(eSpy.col, eSpy.row)}) — Spy Intercepted!`,
        fromCoord: pf,
        toCoord: { col: eSpy.col, row: eSpy.row },
        wasClash: true,
        resolution: 'PLAYER_WINS',
        boardSnapshot: cloneSnap(baseSnap),
      });
    }

    const pSpy = baseSnap.find((p) => p.faction === 'PLAYER' && p.trueRank === 'SPY' && p.alive);
    const eFlag = baseSnap.find((p) => p.faction === 'ENEMY' && p.trueRank === 'FLAG');
    if (pSpy && eFlag) {
      const sf = { col: pSpy.col, row: pSpy.row };
      pSpy.col = eFlag.col;
      pSpy.row = eFlag.row;
      eFlag.alive = false;
      pSpy.kills += 1;
      plies.push({
        plyIndex: plies.length,
        turnNumber: 4,
        actorFaction: 'PLAYER',
        summary: `T4: Navy SPY vs. Crimson FLAG (${formatAlgebraicCoord(eFlag.col, eFlag.row)}) — Enemy Flag Captured!`,
        fromCoord: sf,
        toCoord: { col: eFlag.col, row: eFlag.row },
        wasClash: true,
        resolution: 'FLAG_CAPTURED_BY_PLAYER',
        boardSnapshot: cloneSnap(baseSnap),
      });
    }

    this.#replayPlies = plies;
  }

  private eliminatePiece(piece: TruthPieceRecord): void {
    if (!piece.alive) return;
    piece.alive = false;
    this.suspectTags.delete(piece.id);
    if (piece.faction === 'PLAYER') {
      this.#playerCasualties.push({
        id: piece.id,
        faction: 'PLAYER',
        visibleRank: piece.trueRank,
        casualtyIndex: this.#playerCasualties.length,
      });
    } else {
      this.#enemyCasualties.push({
        id: piece.id,
        faction: 'ENEMY',
        visibleRank: 'UNKNOWN',
        casualtyIndex: this.#enemyCasualties.length,
      });
    }
  }

  private findAliveAt(col: number, row: number): TruthPieceRecord | undefined {
    for (const p of this.#truthPieces.values()) {
      if (p.alive && p.col === col && p.row === row) return p;
    }
    return undefined;
  }

  private clearTimers(): void {
    this.stopReplayAutoPlay();
    if (this.aiTurnTimer !== null) {
      window.clearTimeout(this.aiTurnTimer);
      this.aiTurnTimer = null;
    }
  }

  private emit(): void {
    const view = this.getVisibleView();
    const opts = this.getOptions();
    for (const fn of this.listeners) {
      fn(view, opts);
    }
  }
}
