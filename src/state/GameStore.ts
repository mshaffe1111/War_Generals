import {
  BeliefMatrixAI,
  type AIOwnUnitState,
  type ObservedPlayerUnitState,
  type PublicClashOutcomeForAI,
} from '../ai/BeliefMatrixAI';
import {
  generateCommanderDeployment,
  getCommanderProfile,
  loadCampaignProgress,
  recordCampaignMatchResult,
  recordPostMatchPlayerTendencies,
  type CampaignProgressState,
  type CommanderId,
} from '../ai/CommanderProfiles';
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
  isFactionHomeSquare,
  loadCustomBlueprintSlots,
  mirrorDeploymentLR,
  projectPresetForFaction,
  resolveClash,
  saveCustomBlueprintSlot,
  validateFactionDeployment,
  type DeploymentSlot,
} from '../core/RulesEngine';
import type {
  AppOptions,
  ArbiterVerdict,
  AudioEraMode,
  CameraMode,
  CasualtyView,
  ClashPublicStakes,
  CommandShroudState,
  DefconTier,
  DeploymentPresetId,
  FieldManualEntry,
  HudBannerState,
  IntelLedgerSummary,
  ManualRankOutcome,
  MatchDossierSummary,
  MatchMode,
  MatchPhase,
  MoveDirection,
  PlayerCombatDoctrine,
  PlayerVisibleView,
  PublicCombatLogEntry,
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

const MATCH_CLOCK_DEFAULT_SEC = 600; // 10:00
const TURN_CLOCK_DEFAULT_SEC = 45; // 00:45

function formatClockMMSS(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

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
 * Encapsulated State, Mode & Replay Vault (`GameStore.ts`).
 * - `#truthPieces` and `#replayPlies` are hard ECMAScript private fields:
 *   opponent `trueRank` is NEVER exposed during `DEPLOY` or `PLAY`, and is declassified ONLY in `REPLAY`!
 */
export class GameStore {
  #truthPieces = new Map<string, TruthPieceRecord>();
  #playerCasualties: CasualtyView[] = [];
  #enemyCasualties: CasualtyView[] = [];
  #replayPlies: ReplayPlyEntry[] = [];

  private phase: MatchPhase = 'TITLE';
  private matchMode: MatchMode = 'SKIRMISH';
  private viewingFaction: Faction = 'PLAYER';
  private activeTurn: Faction = 'PLAYER';
  private commanderId: CommanderId = 'MILLER';
  private campaign: CampaignProgressState = loadCampaignProgress();
  private initialPlayerDeploySlots: DeploymentSlot[] = [];

  private matchClockSec = MATCH_CLOCK_DEFAULT_SEC;
  private turnClockSec = TURN_CLOCK_DEFAULT_SEC;
  private clockInterval: number | null = null;

  private shroud: CommandShroudState | null = null;
  private publicLog: PublicCombatLogEntry[] = [];
  private dossier: MatchDossierSummary | null = null;
  private manualSelectedRank: RankId = 'SPY';

  private selectedPieceId: string | null = null;
  private selectedDeployRank: RankId | null = 'GEN_5';
  private suspectTags = new Map<string, SuspectTag>();
  private activeClash: ArbiterVerdict | null = null;
  private banner: HudBannerState = 'WAR GENERALS';
  private cameraMode: CameraMode = 'TITLE';
  private turnCount = 1;
  private clashesWonByPlayer = 0;
  private clashesWonByEnemy = 0;
  private matchWinner: Faction | null = null;
  private winReason: string | null = null;
  private interactionLocked = false;
  private pieceIdCounter = 0;

  // Classic 1970s 1-turn deferred back-row Flag traverse tracking
  private flagPendingGoalFaction: Faction | null = null;

  // Declassified Replay Scrubber State
  private replayCurrentPly = 0;
  private replayPlaying = false;
  private replayTimer: number | null = null;
  private aiTurnTimer: number | null = null;

  private readonly beliefAI = new BeliefMatrixAI();
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
    this.returnToTitleMenu();
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
          : this.phase === 'ARMORY'
            ? 'FORMATION ARMORY'
            : this.selectedPieceId
              ? 'SELECT TARGET'
              : 'TACTICAL COMMAND';
    }
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Block 5: Live 3D Start Screen & All 6 Primary Game Modes
  // ---------------------------------------------------------------------------

  /**
   * Boots or returns to the **Live 3D Start Screen (`TITLE`)**, staging an active mid-game
   * Salpakan war-room battlefield underneath the slow low-angle orbital camera!
   */
  public returnToTitleMenu(): void {
    this.clearTimers();
    this.campaign = loadCampaignProgress();
    this.#truthPieces.clear();
    this.#playerCasualties = [];
    this.#enemyCasualties = [];
    this.suspectTags.clear();
    this.shroud = null;
    this.dossier = null;
    this.activeClash = null;
    this.selectedPieceId = null;
    this.selectedDeployRank = null;
    this.matchWinner = null;
    this.winReason = null;
    this.interactionLocked = false;
    this.viewingFaction = 'PLAYER';
    this.phase = 'TITLE';
    this.cameraMode = 'TITLE';
    this.banner = 'WAR GENERALS';

    this.stageMidGameAttractBoard();
    this.emit();
  }

  public setSelectedCommander(commanderId: CommanderId): void {
    this.commanderId = commanderId;
    this.emit();
  }

  /**
   * 1. PLAY SKIRMISH (Commander AI + Era Ruleset -> Mobilization)
   */
  public startSkirmish(commanderId?: CommanderId, eraMode?: AudioEraMode): void {
    if (commanderId) this.commanderId = commanderId;
    if (eraMode) this.options = { ...this.options, eraMode };
    this.matchMode = 'SKIRMISH';
    this.startNewDeployment();
  }

  /**
   * 2. COMMAND CAMPAIGN (6-Tier Gauntlet across all 6 Rival AI Generals)
   */
  public startCampaignTier(commanderId: CommanderId): boolean {
    const profile = getCommanderProfile(commanderId);
    this.campaign = loadCampaignProgress();
    if (profile.tier > this.campaign.unlockedTier) return false;
    this.commanderId = commanderId;
    this.matchMode = 'CAMPAIGN';
    this.startNewDeployment();
    return true;
  }

  /**
   * 3. PASS & PLAY (2P LOCAL) with Full-Screen Brass Privacy Command Shroud!
   */
  public startPassAndPlay(): void {
    this.matchMode = 'PASS_AND_PLAY';
    this.clearTimers();
    this.#truthPieces.clear();
    this.#playerCasualties = [];
    this.#enemyCasualties = [];
    this.#replayPlies = [];
    this.publicLog = [];
    this.suspectTags.clear();
    this.dossier = null;
    this.shroud = null;

    this.phase = 'DEPLOY';
    this.viewingFaction = 'PLAYER';
    this.activeTurn = 'PLAYER';
    this.selectedPieceId = null;
    this.selectedDeployRank = 'GEN_5';
    this.activeClash = null;
    this.cameraMode = 'PLAY';
    this.banner = 'TACTICAL DEPLOYMENT';
    this.turnCount = 1;
    this.clashesWonByPlayer = 0;
    this.clashesWonByEnemy = 0;
    this.matchWinner = null;
    this.winReason = null;
    this.interactionLocked = false;
    this.flagPendingGoalFaction = null;
    this.pieceIdCounter = 0;

    this.emit();
  }

  public unsealCommandShroud(): void {
    if (!this.shroud?.active) return;
    const nextFaction = this.shroud.nextFaction;
    this.viewingFaction = nextFaction;
    this.shroud = null;

    if (this.phase === 'DEPLOY') {
      this.selectedDeployRank = 'GEN_5';
      this.selectedPieceId = null;
      this.banner = 'TACTICAL DEPLOYMENT';
    } else if (this.phase === 'PLAY') {
      this.banner = 'TACTICAL COMMAND';
      this.turnClockSec = TURN_CLOCK_DEFAULT_SEC;
    }
    this.emit();
  }

  /**
   * 4. FORMATION ARMORY (Offline 21-Unit Blueprint Workshop)
   */
  public openFormationArmory(): void {
    this.clearTimers();
    this.matchMode = 'SKIRMISH';
    this.#truthPieces.clear();
    this.#playerCasualties = [];
    this.#enemyCasualties = [];
    this.suspectTags.clear();
    this.shroud = null;
    this.dossier = null;
    this.activeClash = null;
    this.viewingFaction = 'PLAYER';
    this.phase = 'ARMORY';
    this.cameraMode = 'PLAY';
    this.banner = 'FORMATION ARMORY';
    this.selectedPieceId = null;
    this.selectedDeployRank = null;
    this.pieceIdCounter = 0;

    // Pre-populate Saved Slot 1 if present, else Vaccination so player can immediately inspect & edit!
    const saved = loadCustomBlueprintSlots()[0];
    this.setFactionDeploymentSlots('PLAYER', saved ? saved.slots : TOURNAMENT_PRESETS.VACCINATION);
    this.emit();
  }

  /**
   * 5. FIELD MANUAL & RANKS (Interactive 3D 15-Wedge Hierarchy & Spy/Private Triangle Viewer)
   */
  public openFieldManual(initialRank: RankId = 'SPY'): void {
    this.clearTimers();
    this.shroud = null;
    this.activeClash = null;
    this.selectedPieceId = null;
    this.phase = 'FIELD_MANUAL';
    this.cameraMode = 'FIELD_MANUAL';
    this.banner = 'FIELD MANUAL & RANKS';
    this.manualSelectedRank = initialRank;
    this.emit();
  }

  public selectFieldManualRank(rank: RankId): void {
    this.manualSelectedRank = rank;
    if (this.phase !== 'FIELD_MANUAL') {
      this.phase = 'FIELD_MANUAL';
      this.cameraMode = 'FIELD_MANUAL';
      this.banner = 'FIELD MANUAL & RANKS';
    }
    this.emit();
  }

  public rematchCurrentMode(): void {
    if (this.matchMode === 'PASS_AND_PLAY') {
      this.startPassAndPlay();
    } else {
      this.startNewDeployment();
    }
  }

  /**
   * 2-Step Hold-to-Confirm Surrender (`SURRENDER` dock control)
   */
  public surrenderMatch(): void {
    if (this.phase !== 'PLAY' || this.matchWinner) return;
    const forfeiting = this.matchMode === 'PASS_AND_PLAY' ? this.activeTurn : 'PLAYER';
    const winner: Faction = forfeiting === 'PLAYER' ? 'ENEMY' : 'PLAYER';
    this.declareMatchWinner(
      winner,
      winner === 'PLAYER' ? 'FLAG CAPTURED — VICTORY' : 'FLAG LOST — DEFEAT',
      'Commander Forfeited',
      forfeiting === 'PLAYER'
        ? 'Navy High Command signed instrument of surrender'
        : 'Crimson High Command signed instrument of surrender'
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Tactical Deployment Drawer, Presets & Custom Blueprints
  // ---------------------------------------------------------------------------

  public startNewDeployment(initialPreset?: DeploymentPresetId): void {
    this.clearTimers();
    if (this.matchMode === 'PASS_AND_PLAY' && !initialPreset) {
      this.startPassAndPlay();
      return;
    }
    this.#truthPieces.clear();
    this.#playerCasualties = [];
    this.#enemyCasualties = [];
    this.#replayPlies = [];
    this.publicLog = [];
    this.suspectTags.clear();
    this.shroud = null;
    this.dossier = null;

    this.phase = 'DEPLOY';
    this.viewingFaction = 'PLAYER';
    this.activeTurn = 'PLAYER';
    this.selectedPieceId = null;
    this.selectedDeployRank = 'GEN_5';
    this.activeClash = null;
    this.cameraMode = 'PLAY';
    this.banner = 'TACTICAL DEPLOYMENT';
    this.turnCount = 1;
    this.clashesWonByPlayer = 0;
    this.clashesWonByEnemy = 0;
    this.matchClockSec = MATCH_CLOCK_DEFAULT_SEC;
    this.turnClockSec = TURN_CLOCK_DEFAULT_SEC;
    this.matchWinner = null;
    this.winReason = null;
    this.interactionLocked = false;
    this.flagPendingGoalFaction = null;
    this.pieceIdCounter = 0;

    // Deploy Enemy AI army on Rows 0..2 using active Commander's procedural randomized setup!
    const enemySlots = generateCommanderDeployment(this.commanderId);
    this.setFactionDeploymentSlots('ENEMY', enemySlots);

    if (initialPreset) {
      this.setFactionDeploymentSlots('PLAYER', TOURNAMENT_PRESETS[initialPreset]);
      this.selectedDeployRank = null;
    }

    this.emit();
  }

  public resetSandbox(): void {
    this.startNewDeployment();
  }

  private isEditableDeployPhase(): boolean {
    return this.phase === 'DEPLOY' || this.phase === 'ARMORY';
  }

  public selectDeployRank(rank: RankId | null): void {
    if (!this.isEditableDeployPhase()) return;
    this.selectedDeployRank = rank;
    this.selectedPieceId = null;
    this.emit();
  }

  public applyDeploymentPreset(preset: DeploymentPresetId): void {
    if (!this.isEditableDeployPhase()) return;
    const fac = this.viewingFaction;
    const projected = projectPresetForFaction(fac, TOURNAMENT_PRESETS[preset]);
    this.setFactionDeploymentSlots(fac, projected);
    this.selectedDeployRank = null;
    this.selectedPieceId = null;
    this.emit();
  }

  public autoDeployPlayer(): void {
    if (!this.isEditableDeployPhase()) return;
    const fac = this.viewingFaction;
    const base = generateSmartAutoDeploy();
    this.setFactionDeploymentSlots(fac, projectPresetForFaction(fac, base));
    this.selectedDeployRank = null;
    this.selectedPieceId = null;
    this.emit();
  }

  public clearPlayerDeployment(): void {
    if (!this.isEditableDeployPhase()) return;
    const fac = this.viewingFaction;
    for (const [id, rec] of Array.from(this.#truthPieces.entries())) {
      if (rec.faction === fac) {
        this.#truthPieces.delete(id);
      }
    }
    this.selectedPieceId = null;
    this.selectedDeployRank = 'GEN_5';
    this.emit();
  }

  public mirrorPlayerDeployment(): void {
    if (!this.isEditableDeployPhase()) return;
    const fac = this.viewingFaction;
    const current = this.getFactionDeploymentSlots(fac);
    if (current.length === 0) return;
    this.setFactionDeploymentSlots(fac, mirrorDeploymentLR(current));
    this.emit();
  }

  public saveBlueprintToSlot(slotIndex: number): boolean {
    const fac = this.viewingFaction;
    const current = this.getFactionDeploymentSlots(fac);
    if (!validateFactionDeployment(fac, current)) return false;
    // Normalize into canonical Player coordinates (Rows 5..7) before persisting
    const normalized =
      fac === 'PLAYER'
        ? current
        : current.map((s) => ({
            col: BOARD_COLS - 1 - s.col,
            row: BOARD_ROWS - 1 - s.row,
            rank: s.rank,
          }));
    saveCustomBlueprintSlot(slotIndex, normalized);
    this.emit();
    return true;
  }

  public loadBlueprintFromSlot(slotIndex: number): boolean {
    if (!this.isEditableDeployPhase()) return false;
    const all = loadCustomBlueprintSlots();
    const target = all[slotIndex];
    if (!target) return false;
    const fac = this.viewingFaction;
    this.setFactionDeploymentSlots(fac, projectPresetForFaction(fac, target.slots));
    this.selectedDeployRank = null;
    this.selectedPieceId = null;
    this.emit();
    return true;
  }

  public placeOrSwapDeployment(
    col: number,
    row: number,
    explicitRank?: RankId,
    draggedPieceId?: string
  ): boolean {
    if (!this.isEditableDeployPhase()) return false;
    const fac = this.viewingFaction;
    if (!isFactionHomeSquare(fac, col, row)) return false;

    const occupant = this.findAliveAt(col, row);

    // Case 1: Moving/swapping an already-placed piece of viewingFaction
    const movingId =
      draggedPieceId ?? (!explicitRank && !this.selectedDeployRank ? this.selectedPieceId : null);
    if (movingId) {
      const movingPiece = this.#truthPieces.get(movingId);
      if (!movingPiece || movingPiece.faction !== fac) return false;
      if (movingPiece.col === col && movingPiece.row === row) {
        this.selectedPieceId = null;
        this.emit();
        return false;
      }
      if (occupant && occupant.faction === fac) {
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

    // Case 2: Placing from Mobilization Crate
    const rankToPlace = explicitRank ?? this.selectedDeployRank;
    if (!rankToPlace) {
      if (occupant && occupant.faction === fac) {
        this.selectedPieceId = occupant.id;
        this.emit();
      }
      return false;
    }

    const unplaced = computeUnplacedCounts(this.getFactionDeploymentSlots(fac));
    if (unplaced[rankToPlace] <= 0) {
      if (occupant && occupant.faction === fac) {
        this.selectedDeployRank = null;
        this.selectedPieceId = occupant.id;
        this.emit();
      }
      return false;
    }

    if (occupant && occupant.faction === fac) {
      (occupant as { trueRank: RankId }).trueRank = rankToPlace;
    } else if (!occupant) {
      const prefix = fac === 'PLAYER' ? 'p' : 'e';
      const id = `${prefix}_${(this.pieceIdCounter++).toString().padStart(2, '0')}`;
      this.#truthPieces.set(id, {
        id,
        faction: fac,
        trueRank: rankToPlace,
        col,
        row,
        alive: true,
        hasMoved: false,
        challengesWon: 0,
      });
    }

    const nextUnplaced = computeUnplacedCounts(this.getFactionDeploymentSlots(fac));
    if (nextUnplaced[rankToPlace] <= 0) {
      this.selectedDeployRank = ORDERED_RANKS.find((r) => nextUnplaced[r] > 0) ?? null;
    }
    this.selectedPieceId = null;
    this.emit();
    return true;
  }

  public removeDeployedPiece(pieceId: string): boolean {
    if (!this.isEditableDeployPhase()) return false;
    const fac = this.viewingFaction;
    const rec = this.#truthPieces.get(pieceId);
    if (!rec || rec.faction !== fac) return false;
    const rank = rec.trueRank;
    this.#truthPieces.delete(pieceId);
    if (this.selectedPieceId === pieceId) this.selectedPieceId = null;
    this.selectedDeployRank = rank;
    this.emit();
    return true;
  }

  /**
   * Launches active battle (or transitions via Brass Command Shroud to Player 2 Deployment in 2P Local;
   * or transitions Armory formation directly into a live Skirmish test!).
   */
  public launchBattleFromDeployment(): boolean {
    if (this.phase === 'ARMORY') {
      const playerSlots = this.getFactionDeploymentSlots('PLAYER');
      if (!validateFactionDeployment('PLAYER', playerSlots)) return false;
      this.matchMode = 'SKIRMISH';
      this.setFactionDeploymentSlots('ENEMY', generateCommanderDeployment(this.commanderId));
      this.phase = 'DEPLOY';
    }

    if (this.phase !== 'DEPLOY') return false;
    const fac = this.viewingFaction;
    const slots = this.getFactionDeploymentSlots(fac);
    if (!validateFactionDeployment(fac, slots)) return false;

    // 2P Pass & Play Step 1: Navy finished -> Engage Brass Command Shroud for Crimson Deployment!
    if (this.matchMode === 'PASS_AND_PLAY' && fac === 'PLAYER') {
      this.selectedPieceId = null;
      this.selectedDeployRank = null;
      this.shroud = {
        active: true,
        nextFaction: 'ENEMY',
        headline: 'PASS DEVICE TO CRIMSON COMMANDER',
        subline: 'Navy 21-unit formation sealed. Unseal to deploy Crimson forces on your home rows.',
      };
      this.emit();
      return true;
    }

    this.phase = 'PLAY';
    this.activeTurn = 'PLAYER';
    this.turnCount = 1;
    this.selectedDeployRank = null;
    this.matchClockSec = MATCH_CLOCK_DEFAULT_SEC;
    this.turnClockSec = TURN_CLOCK_DEFAULT_SEC;

    this.initialPlayerDeploySlots = this.getFactionDeploymentSlots('PLAYER').map((s) => ({
      ...s,
    }));

    const publicPlayerInitialSquares = Array.from(this.#truthPieces.values())
      .filter((p) => p.faction === 'PLAYER' && p.alive)
      .map((p) => ({ id: p.id, col: p.col, row: p.row }));
    const aiInitialUnits = this.collectAIUnitStates();
    this.beliefAI.initializeMatch(publicPlayerInitialSquares, aiInitialUnits);

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
    this.publicLog = [
      {
        turn: 0,
        actor: 'SYSTEM',
        text: `Engagement commenced (${this.options.eraMode} Ruleset) — 21 vs. 21`,
        isClash: false,
      },
    ];

    if (this.matchMode === 'PASS_AND_PLAY') {
      this.selectedPieceId = null;
      this.shroud = {
        active: true,
        nextFaction: 'PLAYER',
        headline: 'PASS DEVICE TO NAVY COMMANDER',
        subline: 'Both 21-unit armies deployed. Turn 1 begins upon unsealing.',
      };
    } else {
      this.viewingFaction = 'PLAYER';
      const vanguard =
        Array.from(this.#truthPieces.values()).find(
          (p) => p.faction === 'PLAYER' && p.alive && p.row === 5
        ) ?? null;
      this.selectedPieceId = vanguard?.id ?? null;
      this.banner = this.selectedPieceId ? 'SELECT TARGET' : 'TACTICAL COMMAND';
    }

    this.startMatchClocks();
    this.emit();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Active Play, Clocks, Suspect Tagging & AI / 2P Turn Loop
  // ---------------------------------------------------------------------------

  private startMatchClocks(): void {
    this.stopMatchClocks();
    this.clockInterval = window.setInterval(() => {
      if (
        this.phase !== 'PLAY' ||
        this.interactionLocked ||
        this.shroud?.active ||
        this.cameraMode !== 'PLAY'
      ) {
        return;
      }

      if (this.matchClockSec > 0) {
        this.matchClockSec -= 1;
      }
      if (this.turnClockSec > 0) {
        this.turnClockSec -= 1;
      }

      if (this.matchClockSec <= 0) {
        const pScore = this.computeRemainingForceScore('PLAYER');
        const eScore = this.computeRemainingForceScore('ENEMY');
        const winner: Faction = pScore >= eScore ? 'PLAYER' : 'ENEMY';
        this.declareMatchWinner(
          winner,
          winner === 'PLAYER' ? 'FLAG CAPTURED — VICTORY' : 'FLAG LOST — DEFEAT',
          'Match Clock Expired',
          winner === 'PLAYER'
            ? 'Navy held superior command strength at time limit'
            : 'Crimson held superior command strength at time limit'
        );
        return;
      }

      if (this.turnClockSec <= 0) {
        this.turnClockSec = TURN_CLOCK_DEFAULT_SEC;
        this.executeAutoFallbackMoveForActiveTurn();
        return;
      }

      this.emit();
    }, 1000);
  }

  private stopMatchClocks(): void {
    if (this.clockInterval !== null) {
      window.clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  private executeAutoFallbackMoveForActiveTurn(): void {
    const turnFac = this.activeTurn;
    const ownPieces = Array.from(this.#truthPieces.values()).filter(
      (p) => p.alive && p.faction === turnFac
    );
    for (const unit of ownPieces) {
      if (unit.trueRank === 'FLAG') continue;
      const moves = this.computeValidMovesForFaction(unit.id, turnFac);
      const quiet = moves.find((m) => m.kind === 'MOVE') ?? moves[0];
      if (quiet) {
        this.executeMoveOrChallenge(quiet.col, quiet.row, unit.id);
        return;
      }
    }
  }

  public setCameraMode(mode: CameraMode): void {
    if (this.interactionLocked && mode !== 'ARBITER') return;
    if (mode !== 'REPLAY' && this.phase === 'REPLAY') {
      this.stopReplayAutoPlay();
      this.phase = this.matchWinner ? 'GAME_OVER' : 'PLAY';
    }
    this.cameraMode = mode;
    if (mode === 'INSPECT_16') {
      this.banner = '16-EMBLEM INSPECTION';
    } else if (mode === 'FIELD_MANUAL') {
      this.banner = 'FIELD MANUAL & RANKS';
    } else if (mode === 'PLAY') {
      this.banner =
        this.phase === 'DEPLOY'
          ? 'TACTICAL DEPLOYMENT'
          : this.phase === 'ARMORY'
            ? 'FORMATION ARMORY'
            : this.selectedPieceId
              ? 'SELECT TARGET'
              : 'TACTICAL COMMAND';
    }
    this.emit();
  }

  public selectPiece(pieceId: string | null): void {
    if (this.interactionLocked || this.shroud?.active) return;

    if (this.phase === 'FIELD_MANUAL') {
      return;
    }

    if (this.isEditableDeployPhase()) {
      if (!pieceId) {
        this.selectedPieceId = null;
        this.emit();
        return;
      }
      const p = this.#truthPieces.get(pieceId);
      if (p && p.faction === this.viewingFaction) {
        this.selectedDeployRank = null;
        this.selectedPieceId = this.selectedPieceId === pieceId ? null : pieceId;
        this.emit();
      }
      return;
    }

    const controllableFaction =
      this.matchMode === 'PASS_AND_PLAY' ? this.viewingFaction : 'PLAYER';
    if (this.phase !== 'PLAY' || this.activeTurn !== controllableFaction || this.cameraMode !== 'PLAY') {
      return;
    }

    if (!pieceId) {
      this.selectedPieceId = null;
      this.banner = 'TACTICAL COMMAND';
      this.emit();
      return;
    }
    const piece = this.#truthPieces.get(pieceId);
    if (!piece || !piece.alive || piece.faction !== controllableFaction) {
      return;
    }
    this.selectedPieceId = this.selectedPieceId === pieceId ? null : pieceId;
    this.banner = this.selectedPieceId ? 'SELECT TARGET' : 'TACTICAL COMMAND';
    this.emit();
  }

  public setEnemySuspectTag(pieceId: string, tag: SuspectTag | null): void {
    const rec = this.#truthPieces.get(pieceId);
    if (!rec || !rec.alive || rec.faction === this.viewingFaction) return;
    if (!tag) {
      this.suspectTags.delete(pieceId);
    } else {
      this.suspectTags.set(pieceId, tag);
    }
    this.emit();
  }

  public computeValidMoves(pieceId: string | null): ValidMoveTarget[] {
    const controllableFaction =
      this.matchMode === 'PASS_AND_PLAY' ? this.viewingFaction : 'PLAYER';
    if (!pieceId || this.phase !== 'PLAY' || this.activeTurn !== controllableFaction || this.shroud?.active) {
      return [];
    }
    return this.computeValidMovesForFaction(pieceId, controllableFaction);
  }

  private computeValidMovesForFaction(pieceId: string, faction: Faction): ValidMoveTarget[] {
    const piece = this.#truthPieces.get(pieceId);
    if (!piece || !piece.alive || piece.faction !== faction) return [];

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
      } else if (occupant.faction !== faction) {
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
    const controllableFaction =
      this.matchMode === 'PASS_AND_PLAY' ? this.viewingFaction : 'PLAYER';
    if (
      this.interactionLocked ||
      this.shroud?.active ||
      this.phase !== 'PLAY' ||
      this.activeTurn !== controllableFaction ||
      this.cameraMode !== 'PLAY'
    ) {
      return null;
    }
    const pid = explicitPieceId ?? this.selectedPieceId;
    if (!pid) return null;

    const valid = this.computeValidMovesForFaction(pid, controllableFaction).find(
      (m) => m.col === col && m.row === row
    );
    if (!valid) return null;

    const mover = this.#truthPieces.get(pid);
    if (!mover || !mover.alive) return null;

    const fromCoord = { col: mover.col, row: mover.row };
    const toCoord = { col, row };

    if (valid.kind === 'MOVE') {
      mover.col = col;
      mover.row = row;
      mover.hasMoved = true;

      const facName = mover.faction === 'PLAYER' ? 'Navy' : 'Crimson';
      const algMove = `${formatAlgebraicCoord(fromCoord.col, fromCoord.row)}→${formatAlgebraicCoord(col, row)}`;

      this.recordReplayPly({
        turnNumber: this.turnCount,
        actorFaction: mover.faction,
        summary: `T${this.turnCount}: ${facName} ${RANK_SPECS[mover.trueRank].shortLabel} (${algMove})`,
        fromCoord,
        toCoord,
        wasClash: false,
      });
      this.publicLog.push({
        turn: this.turnCount,
        actor: mover.faction,
        text: `T${this.turnCount} • ${facName} maneuvered ${algMove}`,
        isClash: false,
      });

      if (mover.faction === 'PLAYER' && this.matchMode !== 'PASS_AND_PLAY') {
        this.beliefAI.recordPlayerMove(
          mover.id,
          fromCoord,
          toCoord,
          this.turnCount,
          this.collectAIUnitStates()
        );
      }

      this.selectedPieceId = null;
      this.turnClockSec = TURN_CLOCK_DEFAULT_SEC;

      if (this.evaluateFlagTraverseAfterMove(mover.faction)) {
        return { kind: 'MOVED' };
      }

      this.advanceTurnAfterQuietMove(mover.faction, algMove);
      return { kind: 'MOVED' };
    }

    const defender = valid.targetPieceId ? this.#truthPieces.get(valid.targetPieceId) : undefined;
    if (!defender || !defender.alive) return null;

    return { kind: 'CLASH', verdict: this.initiateClash(mover, defender, toCoord) };
  }

  private advanceTurnAfterQuietMove(justMoved: Faction, algMove: string): void {
    this.turnCount += 1;
    const nextFac: Faction = justMoved === 'PLAYER' ? 'ENEMY' : 'PLAYER';

    // Check 1970s deferred Flag survival for nextFac!
    if (this.checkPending1970sSurvivalWin(nextFac)) {
      return;
    }

    if (this.matchMode === 'PASS_AND_PLAY') {
      this.activeTurn = nextFac;
      const movedLabel = justMoved === 'PLAYER' ? 'Navy' : 'Crimson';
      const nextLabel = nextFac === 'PLAYER' ? 'NAVY' : 'CRIMSON';
      this.shroud = {
        active: true,
        nextFaction: nextFac,
        headline: `PASS DEVICE TO ${nextLabel} COMMANDER`,
        subline: `${movedLabel} maneuvered ${algMove}. Tap UNSEAL COMMAND to begin Turn ${this.turnCount}.`,
      };
      this.emit();
      return;
    }

    if (nextFac === 'ENEMY') {
      this.scheduleEnemyTurn(560);
    } else {
      this.activeTurn = 'PLAYER';
      this.banner = 'TACTICAL COMMAND';
      this.emit();
    }
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

    // In 2P Pass & Play, mask `playerVisibleRank` as `'UNKNOWN'` during the 3-act battle so neither player sees the survivor's face!
    const verdict: ArbiterVerdict = {
      ...baseVerdict,
      playerVisibleRank:
        this.matchMode === 'PASS_AND_PLAY' ? 'UNKNOWN' : baseVerdict.playerVisibleRank,
      stakes,
    };

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
    const sqLabel = formatAlgebraicCoord(toCoord.col, toCoord.row);

    const aiPiece = attacker.faction === 'ENEMY' ? attacker : defender;
    if (this.matchMode !== 'PASS_AND_PLAY') {
      const outcomeForAI: PublicClashOutcomeForAI =
        verdict.resolution === 'MUTUAL_SPLIT'
          ? 'SPLIT'
          : verdict.survivorFaction === 'ENEMY'
            ? 'AI_WON'
            : 'AI_LOST';
      this.beliefAI.recordClashOutcome(
        verdict.playerPieceId,
        aiPiece.id,
        aiPiece.trueRank,
        outcomeForAI,
        this.turnCount
      );
    }

    if (verdict.resolution === 'MUTUAL_SPLIT') {
      this.eliminatePiece(attacker);
      this.eliminatePiece(defender);
    } else if (verdict.survivorId === attacker.id) {
      this.eliminatePiece(defender);
      attacker.col = verdict.contestedCoord.col;
      attacker.row = verdict.contestedCoord.row;
      attacker.hasMoved = true;
      attacker.challengesWon += 1;
      if (attacker.faction === 'PLAYER') this.clashesWonByPlayer += 1;
      else this.clashesWonByEnemy += 1;
    } else {
      this.eliminatePiece(attacker);
      defender.challengesWon += 1;
      if (defender.faction === 'PLAYER') this.clashesWonByPlayer += 1;
      else this.clashesWonByEnemy += 1;
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
      summary: `T${this.turnCount}: ${atkName} vs. ${defName} (${sqLabel}) — ${resText}`,
      fromCoord,
      toCoord,
      wasClash: true,
      resolution: verdict.resolution,
    });

    // Public Rank-Blind Combat Log Entry (`0%` rank leak mid-match!)
    const publicOutcome =
      verdict.resolution === 'MUTUAL_SPLIT'
        ? 'Mutual Elimination (both units lost)'
        : verdict.survivorFaction === 'PLAYER'
          ? 'Navy unit prevailed (ranks sealed)'
          : 'Crimson unit prevailed (ranks sealed)';
    this.publicLog.push({
      turn: this.turnCount,
      actor: attacker.faction,
      text: `T${this.turnCount} • Clash at ${sqLabel} — ${publicOutcome}`,
      isClash: true,
    });

    this.activeClash = null;
    this.cameraMode = 'PLAY';
    this.interactionLocked = false;
    this.turnClockSec = TURN_CLOCK_DEFAULT_SEC;

    if (verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      this.declareMatchWinner(
        'PLAYER',
        'FLAG CAPTURED — VICTORY',
        'Enemy Flag Eliminated',
        `Enemy Flag captured in combat at ${sqLabel}`
      );
      return;
    }
    if (verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY') {
      this.declareMatchWinner(
        'ENEMY',
        'FLAG LOST — DEFEAT',
        'Enemy Flag Eliminated',
        `Navy Flag fell in combat at ${sqLabel}`
      );
      return;
    }

    if (this.evaluateFlagTraverseAfterMove(attacker.faction)) {
      return;
    }

    this.turnCount += 1;
    const nextFac: Faction = attacker.faction === 'PLAYER' ? 'ENEMY' : 'PLAYER';
    if (this.checkPending1970sSurvivalWin(nextFac)) {
      return;
    }

    if (this.matchMode === 'PASS_AND_PLAY') {
      this.activeTurn = nextFac;
      const nextLabel = nextFac === 'PLAYER' ? 'NAVY' : 'CRIMSON';
      this.shroud = {
        active: true,
        nextFaction: nextFac,
        headline: `PASS DEVICE TO ${nextLabel} COMMANDER`,
        subline: `Clash at ${sqLabel}: ${publicOutcome}. Unseal for Turn ${this.turnCount}.`,
      };
      this.emit();
      return;
    }

    if (attacker.faction === 'PLAYER') {
      this.scheduleEnemyTurn(680);
    } else {
      this.activeTurn = 'PLAYER';
      this.banner = 'TACTICAL COMMAND';
      this.emit();
    }
  }

  private scheduleEnemyTurn(delayMs: number): void {
    if (this.phase !== 'PLAY' || this.matchWinner || this.matchMode === 'PASS_AND_PLAY') return;
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

    if (this.checkPending1970sSurvivalWin('ENEMY')) {
      return;
    }

    const aiUnits: AIOwnUnitState[] = [];
    const observedPlayers: ObservedPlayerUnitState[] = [];
    for (const p of this.#truthPieces.values()) {
      if (!p.alive) continue;
      if (p.faction === 'ENEMY') {
        aiUnits.push({
          id: p.id,
          ownRank: p.trueRank,
          col: p.col,
          row: p.row,
          hasMoved: p.hasMoved,
        });
      } else {
        // ZERO Player `trueRank` passed to BeliefMatrixAI!
        observedPlayers.push({
          id: p.id,
          col: p.col,
          row: p.row,
          publicKills: p.challengesWon,
          hasMoved: p.hasMoved,
        });
      }
    }

    const decision = this.beliefAI.chooseCommanderMove(
      aiUnits,
      observedPlayers,
      this.commanderId,
      this.turnCount
    );
    if (!decision) {
      this.declareMatchWinner(
        'PLAYER',
        'FLAG CAPTURED — VICTORY',
        'Enemy Immobilized',
        'Crimson forces had zero legal maneuvers remaining'
      );
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

    const algMove = `${formatAlgebraicCoord(fromCoord.col, fromCoord.row)}→${formatAlgebraicCoord(toCoord.col, toCoord.row)}`;
    this.recordReplayPly({
      turnNumber: this.turnCount,
      actorFaction: 'ENEMY',
      summary: `T${this.turnCount}: Crimson ${RANK_SPECS[mover.trueRank].shortLabel} (${algMove})`,
      fromCoord,
      toCoord,
      wasClash: false,
    });
    this.publicLog.push({
      turn: this.turnCount,
      actor: 'ENEMY',
      text: `T${this.turnCount} • Crimson maneuvered ${algMove}`,
      isClash: false,
    });

    this.turnClockSec = TURN_CLOCK_DEFAULT_SEC;
    if (this.evaluateFlagTraverseAfterMove('ENEMY')) {
      return;
    }

    this.turnCount += 1;
    if (this.checkPending1970sSurvivalWin('PLAYER')) {
      return;
    }

    this.activeTurn = 'PLAYER';
    this.banner = 'TACTICAL COMMAND';
    this.emit();
  }

  private checkPending1970sSurvivalWin(turnStartingFaction: Faction): boolean {
    if (this.flagPendingGoalFaction !== turnStartingFaction) return false;
    const goalRow = turnStartingFaction === 'PLAYER' ? 0 : BOARD_ROWS - 1;
    const survivingFlag = Array.from(this.#truthPieces.values()).find(
      (p) =>
        p.alive && p.faction === turnStartingFaction && p.trueRank === 'FLAG' && p.row === goalRow
    );
    if (survivingFlag) {
      this.declareMatchWinner(
        turnStartingFaction,
        turnStartingFaction === 'PLAYER' ? 'FLAG TRAVERSE — VICTORY' : 'FLAG LOST — DEFEAT',
        'Back-Rank Flag Breakthrough',
        turnStartingFaction === 'PLAYER'
          ? 'Navy Flag survived uncaptured on the Crimson home rank!'
          : 'Crimson Flag survived uncaptured on the Navy home rank!'
      );
      return true;
    }
    this.flagPendingGoalFaction = null;
    return false;
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
        'Back-Rank Flag Breakthrough',
        winner === 'PLAYER'
          ? 'Navy Flag secured the Crimson back rank!'
          : 'Crimson Flag breached the Navy home rank!'
      );
      return true;
    }

    for (const p of all) {
      if (!p.alive || p.trueRank !== 'FLAG') continue;
      const goalRow = p.faction === 'PLAYER' ? 0 : BOARD_ROWS - 1;
      if (p.row === goalRow) {
        this.flagPendingGoalFaction = p.faction;
      }
    }
    return false;
  }

  private declareMatchWinner(
    winner: Faction,
    banner: HudBannerState,
    winMethod: string,
    detailNote: string
  ): void {
    this.clearTimers();
    this.shroud = null;
    this.matchWinner = winner;
    this.winReason = `${winMethod} — ${detailNote}`;
    this.phase = 'GAME_OVER';
    this.banner = banner;
    this.selectedPieceId = null;
    this.interactionLocked = false;

    const playerWon = winner === 'PLAYER';
    if (this.matchMode !== 'PASS_AND_PLAY') {
      // Post-match only: record historical wing tendencies so Marshal Hollis adapts on future matches!
      recordPostMatchPlayerTendencies(this.initialPlayerDeploySlots);
    }

    let medalUnlocked: string | null = null;
    if (this.matchMode === 'CAMPAIGN') {
      const res = recordCampaignMatchResult(this.commanderId, playerWon, this.turnCount);
      this.campaign = res.state;
      medalUnlocked = res.newlyEarnedMedal;
    }

    const highOfficer = this.findHighestSurvivingRankName(winner);
    const elapsedSec = Math.max(1, MATCH_CLOCK_DEFAULT_SEC - this.matchClockSec);

    this.dossier = {
      winner,
      playerWon,
      winnerLabel:
        this.matchMode === 'PASS_AND_PLAY'
          ? winner === 'PLAYER'
            ? 'NAVY COMMAND VICTORY'
            : 'CRIMSON COMMAND VICTORY'
          : playerWon
            ? 'VICTORY — MISSION ACCOMPLISHED'
            : 'DEFEAT — COMMAND FALLEN',
      winMethod,
      detailNote,
      turnsElapsed: this.turnCount,
      clashesWonByPlayer: this.clashesWonByPlayer,
      clashesWonByEnemy: this.clashesWonByEnemy,
      survivingHighOfficer: highOfficer,
      matchDurationFormatted: formatClockMMSS(elapsedSec),
      campaignMedalUnlocked: medalUnlocked,
    };

    this.emit();
  }

  private findHighestSurvivingRankName(faction: Faction): string {
    let bestRank: RankId | null = null;
    let bestPow = -1;
    for (const p of this.#truthPieces.values()) {
      if (!p.alive || p.faction !== faction) continue;
      const pow = p.trueRank === 'SPY' ? 2.5 : RANK_SPECS[p.trueRank].seniority;
      if (pow > bestPow) {
        bestPow = pow;
        bestRank = p.trueRank;
      }
    }
    return bestRank ? RANK_SPECS[bestRank].name : 'None';
  }

  private computeRemainingForceScore(faction: Faction): number {
    let total = 0;
    for (const p of this.#truthPieces.values()) {
      if (!p.alive || p.faction !== faction) continue;
      total += p.trueRank === 'SPY' ? 9 : p.trueRank === 'FLAG' ? 25 : RANK_SPECS[p.trueRank].seniority;
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // Showcase Clash Archetypes
  // ---------------------------------------------------------------------------

  public triggerShowcaseClash(preset: ShowcasePreset): ArbiterVerdict | null {
    if (this.interactionLocked) return null;
    this.clearTimers();
    this.shroud = null;
    this.matchMode = 'SKIRMISH';
    this.viewingFaction = 'PLAYER';

    if (this.phase !== 'PLAY') {
      this.startNewDeployment('VACCINATION');
      this.launchBattleFromDeployment();
    }
    if (this.cameraMode !== 'PLAY') {
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
    this.shroud = null;
    if (this.#replayPlies.length === 0) {
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
    const viewFac = this.viewingFaction;
    const shroudMaskAll = Boolean(this.shroud?.active);
    const pieces: VisiblePieceView[] = [];
    let deployedCount = 0;

    let ownOfficersAlive = 0;
    let ownPrivatesAlive = 0;
    let ownSpiesAlive = 0;
    let ownFlagAlive = false;
    let enemyUnconfirmedAlive = 0;
    let enemyVeteranCount = 0;
    let enemyTaggedCount = 0;

    for (const record of this.#truthPieces.values()) {
      if (!record.alive) continue;
      const isOwn = record.faction === viewFac;
      if (isOwn) {
        deployedCount += 1;
        if (record.trueRank === 'PRIVATE') ownPrivatesAlive += 1;
        else if (record.trueRank === 'SPY') ownSpiesAlive += 1;
        else if (record.trueRank === 'FLAG') ownFlagAlive = true;
        else ownOfficersAlive += 1;
      } else {
        enemyUnconfirmedAlive += 1;
        if (record.challengesWon > 0) enemyVeteranCount += 1;
        if (this.suspectTags.has(record.id)) enemyTaggedCount += 1;
      }

      pieces.push({
        id: record.id,
        faction: record.faction,
        // During Command Shroud, ALL 42 wedges mask as 'UNKNOWN' so zero ranks leak during handoff!
        visibleRank: !shroudMaskAll && isOwn ? record.trueRank : 'UNKNOWN',
        col: record.col,
        row: record.row,
        alive: record.alive,
        publicKills: record.challengesWon,
        hasMoved: record.hasMoved,
        suspectTag: !isOwn ? (this.suspectTags.get(record.id) ?? null) : null,
      });
    }

    const activeDeploySlots = this.getFactionDeploymentSlots(viewFac);
    const unplacedCounts = computeUnplacedCounts(activeDeploySlots);
    const savedSlots = loadCustomBlueprintSlots().map((s) => s !== null);

    const ownCasualties =
      viewFac === 'PLAYER' ? this.#playerCasualties.length : this.#enemyCasualties.length;
    const oppCasualties =
      viewFac === 'PLAYER' ? this.#enemyCasualties.length : this.#playerCasualties.length;

    const intelLedger: IntelLedgerSummary = {
      ownOfficersAlive,
      ownPrivatesAlive,
      ownSpiesAlive,
      ownFlagAlive,
      ownCasualtiesTotal: ownCasualties,
      enemyUnconfirmedAlive,
      enemyEliminatedTotal: oppCasualties,
      enemyVeteranCount,
      enemyTaggedCount,
    };

    const manualEntries: FieldManualEntry[] = ORDERED_RANKS.map((r, idx) => {
      const col = 2 + (idx % 5);
      const row = 2 + Math.floor(idx / 5);
      let outcome: ManualRankOutcome;
      if (r === this.manualSelectedRank) {
        outcome =
          r === 'FLAG' ? 'FLAG_ATTACK_WIN' : 'SELECTED';
      } else {
        const res = resolveClash(this.manualSelectedRank, r);
        outcome = res === 'ATTACKER' ? 'DEFEATS' : res === 'DEFENDER' ? 'THREAT' : 'SPLIT';
      }
      return { rank: r, col, row, outcome };
    });

    // Mask casualties appropriately when viewingFaction flips in 2P Pass & Play
    const projPlayerCas = this.#playerCasualties.map((c) => ({
      ...c,
      visibleRank: !shroudMaskAll && viewFac === 'PLAYER' ? c.visibleRank : 'UNKNOWN',
    }));
    const projEnemyCas = this.#enemyCasualties.map((c) => ({
      ...c,
      visibleRank: 'UNKNOWN' as const,
    }));

    return {
      phase: this.phase,
      matchMode: this.matchMode,
      viewingFaction: viewFac,
      activeTurn: this.activeTurn,
      commanderId: this.commanderId,
      campaign: this.campaign,
      matchClockSec: this.matchClockSec,
      turnClockSec: this.turnClockSec,
      turnClockMaxSec: TURN_CLOCK_DEFAULT_SEC,
      shroud: this.shroud,
      publicLog: this.publicLog,
      intelLedger,
      dossier: this.dossier,
      manualSelectedRank: this.manualSelectedRank,
      manualEntries,
      pieces,
      playerCasualties: projPlayerCas,
      enemyCasualties: projEnemyCas,
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
  // Internal Helpers & Live 3D Start Screen Attract Staging
  // ---------------------------------------------------------------------------

  private stageMidGameAttractBoard(): void {
    this.pieceIdCounter = 0;
    this.setFactionDeploymentSlots('PLAYER', TOURNAMENT_PRESETS.IRON_BLITZ);
    this.setFactionDeploymentSlots('ENEMY', generateEnemyTournamentDeployment('MOTHERSHIP'));

    // Advance several vanguard units into No-Man's-Land (`Rows 3..4`) + add veteran Ghost-Ace pips & sunken casualties!
    const all = Array.from(this.#truthPieces.values());
    const pGen5 = all.find((p) => p.faction === 'PLAYER' && p.trueRank === 'GEN_5');
    if (pGen5) {
      pGen5.row = 4;
      pGen5.challengesWon = 2;
      pGen5.hasMoved = true;
    }
    const pSpy = all.find((p) => p.faction === 'PLAYER' && p.trueRank === 'SPY');
    if (pSpy) {
      pSpy.row = 4;
      pSpy.col = 5;
      pSpy.challengesWon = 1;
      pSpy.hasMoved = true;
    }
    const eFront = all.filter((p) => p.faction === 'ENEMY' && p.row === 2);
    if (eFront[1]) {
      eFront[1].row = 3;
      eFront[1].challengesWon = 2;
      eFront[1].hasMoved = true;
    }
    if (eFront[3]) {
      eFront[3].row = 3;
      eFront[3].challengesWon = 1;
      eFront[3].hasMoved = true;
    }

    // Populate 2 sunken casualties per velvet well for authentic mid-war atmosphere
    const pLost = all.find((p) => p.faction === 'PLAYER' && p.trueRank === 'PRIVATE');
    if (pLost) this.eliminatePiece(pLost);
    const eLost = all.find((p) => p.faction === 'ENEMY' && p.trueRank === 'PRIVATE');
    if (eLost) this.eliminatePiece(eLost);
  }

  private getFactionDeploymentSlots(faction: Faction): DeploymentSlot[] {
    const slots: DeploymentSlot[] = [];
    for (const r of this.#truthPieces.values()) {
      if (r.alive && r.faction === faction) {
        slots.push({ col: r.col, row: r.row, rank: r.trueRank });
      }
    }
    return slots;
  }

  private setFactionDeploymentSlots(faction: Faction, slots: readonly DeploymentSlot[]): void {
    for (const [id, rec] of Array.from(this.#truthPieces.entries())) {
      if (rec.faction === faction) {
        this.#truthPieces.delete(id);
      }
    }
    const prefix = faction === 'PLAYER' ? 'p' : 'e';
    slots.forEach((s) => {
      const id = `${prefix}_${(this.pieceIdCounter++).toString().padStart(2, '0')}`;
      this.#truthPieces.set(id, {
        id,
        faction,
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
    if (this.getFactionDeploymentSlots('PLAYER').length < ARMY_PIECE_TOTAL) {
      this.setFactionDeploymentSlots('PLAYER', TOURNAMENT_PRESETS.IRON_BLITZ);
    }
    if (this.getFactionDeploymentSlots('ENEMY').length < ARMY_PIECE_TOTAL) {
      this.setFactionDeploymentSlots('ENEMY', generateEnemyTournamentDeployment('MOTHERSHIP'));
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

  private collectAIUnitStates(): AIOwnUnitState[] {
    const out: AIOwnUnitState[] = [];
    for (const p of this.#truthPieces.values()) {
      if (p.alive && p.faction === 'ENEMY') {
        out.push({
          id: p.id,
          ownRank: p.trueRank,
          col: p.col,
          row: p.row,
          hasMoved: p.hasMoved,
        });
      }
    }
    return out;
  }

  private findAliveAt(col: number, row: number): TruthPieceRecord | undefined {
    for (const p of this.#truthPieces.values()) {
      if (p.alive && p.col === col && p.row === row) return p;
    }
    return undefined;
  }

  private clearTimers(): void {
    this.stopMatchClocks();
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
