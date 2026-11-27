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
 */
export interface VisiblePieceView {
  readonly id: string;
  readonly faction: Faction;
  readonly visibleRank: RankId | 'UNKNOWN';
  readonly col: number;
  readonly row: number;
  readonly alive: boolean;
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
}

export type CameraMode = 'PLAY' | 'ARBITER' | 'INSPECT_16';

export type AudioEraMode = '1980s' | '1970s';
export type ArbiterSpeedMode = '1x' | '1.75x';
export type RenderQualityMode = 'ULTRA' | 'BALANCED';

export interface AppOptions {
  audioMuted: boolean;
  eraMode: AudioEraMode;
  arbiterSpeed: ArbiterSpeedMode;
  renderQuality: RenderQualityMode;
}

export type HudBannerState =
  | 'TACTICAL COMMAND'
  | 'SELECT TARGET'
  | 'CLASH LOCK-IN'
  | 'ARBITRATING'
  | 'BATTLE WINNER'
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
