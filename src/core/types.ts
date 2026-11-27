import type { Faction, RankId } from './ranks';

export interface GridCoord {
  readonly col: number; // 0..8 (left to right, A..I)
  readonly row: number; // 0..7 (0..2 = Enemy home rows, 3..4 = Neutral, 5..7 = Player home rows)
}

export type MoveDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type MatchPhase = 'DEPLOY' | 'PLAY' | 'GAME_OVER' | 'REPLAY';
export type SuspectTag = 'SPY?' | 'GEN?' | 'PVT?' | 'OFF?' | 'FLAG?';
export type DeploymentPresetId = 'VACCINATION' | 'MOTHERSHIP' | 'IRON_BLITZ' | 'MIRAGE_DECOY';

export interface ValidMoveTarget {
  readonly col: number;
  readonly row: number;
  readonly direction: MoveDirection;
  readonly kind: 'MOVE' | 'CHALLENGE';
  readonly targetPieceId?: string;
}

/**
 * ARBITER-ONLY TRUTH RECORD.
 * Strictly encapsulated inside GameStore's private vault—never exported to UI, Renderer, or AI during active play.
 */
export interface TruthPieceRecord {
  readonly id: string;
  readonly faction: Faction;
  readonly trueRank: RankId;
  col: number;
  row: number;
  alive: boolean;
  hasMoved: boolean;
  challengesWon: number;
}

/**
 * PLAYER-VISIBLE PIECE PROJECTION.
 * Enemy wedges ALWAYS carry visibleRank: 'UNKNOWN' during active play (`DEPLOY` / `PLAY`).
 */
export interface VisiblePieceView {
  readonly id: string;
  readonly faction: Faction;
  readonly visibleRank: RankId | 'UNKNOWN';
  readonly col: number;
  readonly row: number;
  readonly alive: boolean;
  readonly publicKills: number;
  readonly hasMoved: boolean;
  readonly suspectTag: SuspectTag | null;
}

export interface CasualtyView {
  readonly id: string;
  readonly faction: Faction;
  readonly visibleRank: RankId | 'UNKNOWN';
  readonly casualtyIndex: number;
}

export type BattleResolutionKind =
  | 'PLAYER_WINS'
  | 'ENEMY_WINS'
  | 'MUTUAL_SPLIT'
  | 'FLAG_CAPTURED_BY_PLAYER'
  | 'FLAG_CAPTURED_BY_ENEMY';

export type DefconTier = 1 | 2 | 3;
export type PlayerCombatDoctrine =
  | 'HIGH_COMMAND'
  | 'COVERT_SPY'
  | 'INFANTRY'
  | 'FLAG_LAST_STAND';

export interface ClashPublicStakes {
  readonly defcon: DefconTier;
  readonly playerDoctrine: PlayerCombatDoctrine;
  readonly isEnemyInitiatedAmbush: boolean;
  readonly playerPublicKills: number;
  readonly enemyPublicKills: number;
  readonly enemyUnmovedBackRow: boolean;
}

export interface ArbiterVerdict {
  readonly resolution: BattleResolutionKind;
  readonly contestedCoord: GridCoord;
  readonly attackerId: string;
  readonly attackerFaction: Faction;
  readonly defenderId: string;
  readonly defenderFaction: Faction;
  readonly playerPieceId: string;
  readonly playerVisibleRank: RankId;
  readonly enemyPieceId: string;
  readonly survivorId: string | null;
  readonly survivorFaction: Faction | null;
  readonly stakes?: ClashPublicStakes;
}

// -----------------------------------------------------------------------------
// Post-Match Declassified X-Ray Replay Contracts (Unlocked ONLY after Match End / Demo)
// -----------------------------------------------------------------------------

export interface ReplayPieceSnapshot {
  readonly id: string;
  readonly faction: Faction;
  readonly trueRank: RankId;
  readonly col: number;
  readonly row: number;
  readonly alive: boolean;
  readonly kills: number;
}

export interface ReplayPlyEntry {
  readonly plyIndex: number; // 0 = initial deployment, 1..N = turns
  readonly turnNumber: number;
  readonly actorFaction: Faction | 'SYSTEM';
  readonly summary: string;
  readonly fromCoord: GridCoord | null;
  readonly toCoord: GridCoord | null;
  readonly wasClash: boolean;
  readonly resolution?: BattleResolutionKind;
  readonly boardSnapshot: readonly ReplayPieceSnapshot[];
}

export interface DeclassifiedReplayView {
  readonly currentPly: number;
  readonly maxPly: number;
  readonly playing: boolean;
  readonly plies: readonly ReplayPlyEntry[];
}

export type CameraMode = 'PLAY' | 'ARBITER' | 'INSPECT_16' | 'REPLAY';

export type BoardViewAngle = 'COMMAND' | 'TACTICAL' | 'OVERHEAD';
export type AudioEraMode = '1980s' | '1970s';
export type ArbiterSpeedMode = '1x' | '1.75x';
export type RenderQualityMode = 'ULTRA' | 'BALANCED';

export interface AppOptions {
  audioMuted: boolean;
  musicVolume: number;
  sfxVolume: number;
  ambianceVolume: number;
  hapticsEnabled: boolean;
  eraMode: AudioEraMode;
  arbiterSpeed: ArbiterSpeedMode;
  renderQuality: RenderQualityMode;
  boardView: BoardViewAngle;
}

export type HudBannerState =
  | 'TACTICAL DEPLOYMENT'
  | 'TACTICAL COMMAND'
  | 'ENEMY MANEUVERING...'
  | 'SELECT TARGET'
  | 'CLASH LOCK-IN'
  | 'DEFCON 1 — HIGH COMMAND ALERT'
  | 'OPERATION STILETTO — COVERT STRIKE'
  | 'ENEMY AMBUSH — BRACE!'
  | 'ARBITRATING'
  | 'TARGET LOCKED — HEARTBEAT'
  | 'ARMOR DEFLECTED — COUNTER!'
  | 'TARGET HIT...'
  | 'BATTLE WINNER'
  | 'SPY INTERCEPTED — VICTORY'
  | 'MUTUAL ELIMINATION'
  | 'FLAG CAPTURED — VICTORY'
  | 'FLAG TRAVERSE — VICTORY'
  | 'FLAG LOST — DEFEAT'
  | 'DECLASSIFIED X-RAY REPLAY'
  | '16-EMBLEM INSPECTION';

export interface PlayerVisibleView {
  readonly phase: MatchPhase;
  readonly activeTurn: Faction;
  readonly pieces: readonly VisiblePieceView[];
  readonly playerCasualties: readonly CasualtyView[];
  readonly enemyCasualties: readonly CasualtyView[];
  readonly selectedPieceId: string | null;
  readonly selectedDeployRank: RankId | null;
  readonly deployedCount: number;
  readonly unplacedCounts: Readonly<Record<RankId, number>>;
  readonly savedBlueprintSlots: readonly boolean[];
  readonly validMoves: readonly ValidMoveTarget[];
  readonly activeClash: ArbiterVerdict | null;
  readonly banner: HudBannerState;
  readonly cameraMode: CameraMode;
  readonly turnCount: number;
  readonly matchWinner: Faction | null;
  readonly winReason: string | null;
  readonly replay: DeclassifiedReplayView | null;
}
