import type { Faction, RankId } from './ranks';

export interface GridCoord {
  readonly col: number; // 0..8 (left to right)
  readonly row: number; // 0..7 (0 = top enemy home row, 7 = bottom player home row)
}

export type MoveDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface ValidMoveTarget {
  readonly col: number;
  readonly row: number;
  readonly direction: MoveDirection;
  readonly kind: 'MOVE' | 'CHALLENGE';
  readonly targetPieceId?: string;
}

/**
 * ARBITER-ONLY TRUTH RECORD.
 * Strictly encapsulated inside GameStore's private vault—never exported to UI, Renderer, or AI.
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
 * Enemy wedges ALWAYS carry visibleRank: 'UNKNOWN' during active play.
 * `publicKills` and `hasMoved` are 100% public board history witnessed by both players (0% rank leak).
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

/**
 * 100% Cheat-Proof Public Stakes Metadata (`0.0` bits of `enemy.trueRank`!).
 * Computed strictly from Player-known rank + public board/kill history BEFORE consulting verdict.
 */
export interface ClashPublicStakes {
  readonly defcon: DefconTier;
  readonly playerDoctrine: PlayerCombatDoctrine;
  readonly isEnemyInitiatedAmbush: boolean;
  readonly playerPublicKills: number;
  readonly enemyPublicKills: number;
  readonly enemyUnmovedBackRow: boolean;
}

/**
 * Rank-blind verdict emitted by the Electronic Arbiter.
 * Neither player learns the surviving enemy's rank—only who survived or split!
 */
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

export type CameraMode = 'PLAY' | 'ARBITER' | 'INSPECT_16';

export type BoardViewAngle = 'COMMAND' | 'TACTICAL' | 'OVERHEAD';
export type AudioEraMode = '1980s' | '1970s';
export type ArbiterSpeedMode = '1x' | '1.75x';
export type RenderQualityMode = 'ULTRA' | 'BALANCED';

export interface AppOptions {
  audioMuted: boolean;
  musicVolume: number; // 0..1 independent Music bus gain
  sfxVolume: number; // 0..1 independent SFX bus gain
  ambianceVolume: number; // 0..1 independent War-Room Ambiance bus gain
  hapticsEnabled: boolean; // Mobile `navigator.vibrate` tactile pulses
  eraMode: AudioEraMode;
  arbiterSpeed: ArbiterSpeedMode;
  renderQuality: RenderQualityMode;
  boardView: BoardViewAngle;
}

export type HudBannerState =
  | 'TACTICAL COMMAND'
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
  | 'FLAG LOST — DEFEAT'
  | '16-EMBLEM INSPECTION';

export interface PlayerVisibleView {
  readonly pieces: readonly VisiblePieceView[];
  readonly playerCasualties: readonly CasualtyView[];
  readonly enemyCasualties: readonly CasualtyView[];
  readonly selectedPieceId: string | null;
  readonly validMoves: readonly ValidMoveTarget[];
  readonly activeClash: ArbiterVerdict | null;
  readonly banner: HudBannerState;
  readonly cameraMode: CameraMode;
  readonly turnCount: number;
  readonly matchWinner: Faction | null;
}
