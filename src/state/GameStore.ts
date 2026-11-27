import { AIBeliefState } from '../ai/AIBeliefState';
import { resolveArbiterChallenge } from '../arbiter/ArbiterResolver';
import {
  BOARD_COLS,
  BOARD_ROWS,
  buildStandardArmyRoster,
  type Faction,
  type RankId,
} from '../core/ranks';
import type {
  AppOptions,
  ArbiterVerdict,
  CameraMode,
  CasualtyView,
  HudBannerState,
  MoveDirection,
  PlayerVisibleView,
  TruthPieceRecord,
  ValidMoveTarget,
  VisiblePieceView,
} from '../core/types';

export type StoreListener = (view: PlayerVisibleView, options: Readonly<AppOptions>) => void;

export type ShowcasePreset = 'PLAYER_WIN' | 'ENEMY_WIN' | 'MUTUAL_SPLIT' | 'FLAG_CAPTURE';

/**
 * Encapsulated State Vault.
 * `#truthPieces` is a hard ECMAScript private field: neither UI, Renderer, nor AI can read enemy `trueRank`.
 */
export class GameStore {
  #truthPieces = new Map<string, TruthPieceRecord>();
  #playerCasualties: CasualtyView[] = [];
  #enemyCasualties: CasualtyView[] = [];

  private selectedPieceId: string | null = null;
  private activeClash: ArbiterVerdict | null = null;
  private banner: HudBannerState = 'TACTICAL COMMAND';
  private cameraMode: CameraMode = 'PLAY';
  private turnCount = 1;
  private matchWinner: Faction | null = null;
  private interactionLocked = false;

  private readonly aiBelief = new AIBeliefState();
  private readonly listeners = new Set<StoreListener>();

  private options: AppOptions = {
    audioMuted: false,
    eraMode: '1980s',
    arbiterSpeed: '1x',
    renderQuality: 'ULTRA',
  };

  constructor() {
    this.resetSandbox();
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

  public resetSandbox(): void {
    this.#truthPieces.clear();
    this.#playerCasualties = [];
    this.#enemyCasualties = [];
    this.selectedPieceId = null;
    this.activeClash = null;
    this.banner = 'TACTICAL COMMAND';
    this.cameraMode = 'PLAY';
    this.turnCount = 1;
    this.matchWinner = null;
    this.interactionLocked = false;

    // Curated tactical formation placing all 15 distinct Player ranks cleanly in view,
    // with Blue Sergeant positioned at (4, 4) opposite an Enemy Scout at (4, 3) for immediate clash testing.
    const playerFormation: Array<{ col: number; row: number; rank: RankId }> = [
      // Vanguard & frontline officers
      { col: 4, row: 4, rank: 'SERGEANT' },
      { col: 1, row: 5, rank: 'PRIVATE' },
      { col: 2, row: 5, rank: 'SPY' },
      { col: 3, row: 5, rank: 'GEN_5' },
      { col: 5, row: 5, rank: 'COLONEL' },
      { col: 6, row: 5, rank: 'SPY' },
      { col: 7, row: 5, rank: 'PRIVATE' },
      // Second line: core officer corps (Brass & Silver contrast)
      { col: 0, row: 6, rank: 'PRIVATE' },
      { col: 1, row: 6, rank: 'GEN_4' },
      { col: 2, row: 6, rank: 'GEN_3' },
      { col: 3, row: 6, rank: 'LT_COLONEL' },
      { col: 4, row: 6, rank: 'MAJOR' },
      { col: 5, row: 6, rank: 'CAPTAIN' },
      { col: 6, row: 6, rank: 'GEN_2' },
      { col: 7, row: 6, rank: 'GEN_1' },
      { col: 8, row: 6, rank: 'PRIVATE' },
      // Rear guard & Flag protection
      { col: 1, row: 7, rank: 'LT_1ST' },
      { col: 3, row: 7, rank: 'PRIVATE' },
      { col: 4, row: 7, rank: 'FLAG' },
      { col: 5, row: 7, rank: 'PRIVATE' },
      { col: 7, row: 7, rank: 'LT_2ND' },
    ];

    const enemyRoster = buildStandardArmyRoster();
    // Deterministic tactical enemy deployment (21 pieces)
    const enemyCoords: Array<{ col: number; row: number; rank: RankId }> = [
      { col: 4, row: 3, rank: 'PRIVATE' }, // Forward scout opposite Blue Sergeant (Sergeant wins!)
      { col: 3, row: 4, rank: 'SERGEANT' }, // Adjacent to (3,5) 5★ or (4,4) Sergeant (Equal split if Sergeant attacks left!)
      { col: 1, row: 2, rank: 'PRIVATE' },
      { col: 2, row: 2, rank: 'CAPTAIN' },
      { col: 3, row: 2, rank: 'COLONEL' },
      { col: 5, row: 2, rank: 'MAJOR' },
      { col: 6, row: 2, rank: 'SPY' },
      { col: 7, row: 2, rank: 'PRIVATE' },
      { col: 0, row: 1, rank: 'PRIVATE' },
      { col: 1, row: 1, rank: 'LT_1ST' },
      { col: 2, row: 1, rank: 'GEN_3' },
      { col: 3, row: 1, rank: 'GEN_5' },
      { col: 4, row: 1, rank: 'GEN_4' },
      { col: 5, row: 1, rank: 'LT_COLONEL' },
      { col: 6, row: 1, rank: 'GEN_2' },
      { col: 7, row: 1, rank: 'LT_2ND' },
      { col: 8, row: 1, rank: 'PRIVATE' },
      { col: 1, row: 0, rank: 'PRIVATE' },
      { col: 3, row: 0, rank: 'SPY' },
      { col: 4, row: 0, rank: 'FLAG' },
      { col: 6, row: 0, rank: 'GEN_1' },
    ];
    void enemyRoster;

    playerFormation.forEach((slot, idx) => {
      const id = `p_${idx.toString().padStart(2, '0')}`;
      this.#truthPieces.set(id, {
        id,
        faction: 'PLAYER',
        trueRank: slot.rank,
        col: slot.col,
        row: slot.row,
        alive: true,
        hasMoved: false,
        challengesWon: 0,
      });
    });

    enemyCoords.forEach((slot, idx) => {
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

    const playerIds = Array.from(this.#truthPieces.values())
      .filter((p) => p.faction === 'PLAYER')
      .map((p) => p.id);
    this.aiBelief.initializeUnknownArmy(playerIds);

    // Pre- select the vanguard Sergeant so valid cyan move arrows & crimson saber reticles shine right away
    this.selectedPieceId = 'p_00';
    this.banner = 'SELECT TARGET';
    this.emit();
  }

  public setCameraMode(mode: CameraMode): void {
    if (this.interactionLocked && mode !== 'ARBITER') return;
    this.cameraMode = mode;
    if (mode === 'INSPECT_16') {
      this.banner = '16-EMBLEM INSPECTION';
    } else if (mode === 'PLAY') {
      this.banner = this.selectedPieceId ? 'SELECT TARGET' : 'TACTICAL COMMAND';
    }
    this.emit();
  }

  public selectPiece(pieceId: string | null): void {
    if (this.interactionLocked || this.cameraMode !== 'PLAY') return;
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

  public computeValidMoves(pieceId: string | null): ValidMoveTarget[] {
    if (!pieceId) return [];
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

  /**
   * Executes a move or initiates an Electronic Arbiter clash if stepping onto an enemy wedge.
   * Returns an ArbiterVerdict when a 3-Act battle sequence should be staged.
   */
  public executeMoveOrChallenge(
    col: number,
    row: number
  ): { kind: 'MOVED' } | { kind: 'CLASH'; verdict: ArbiterVerdict } | null {
    if (this.interactionLocked || !this.selectedPieceId || this.cameraMode !== 'PLAY') {
      return null;
    }
    const valid = this.computeValidMoves(this.selectedPieceId).find(
      (m) => m.col === col && m.row === row
    );
    if (!valid) return null;

    const mover = this.#truthPieces.get(this.selectedPieceId);
    if (!mover || !mover.alive) return null;

    if (valid.kind === 'MOVE') {
      mover.col = col;
      mover.row = row;
      mover.hasMoved = true;
      this.turnCount += 1;
      this.selectedPieceId = mover.id;
      this.banner = 'SELECT TARGET';
      this.emit();
      return { kind: 'MOVED' };
    }

    const defender = valid.targetPieceId ? this.#truthPieces.get(valid.targetPieceId) : undefined;
    if (!defender || !defender.alive) return null;

    const verdict = resolveArbiterChallenge({
      contestedCoord: { col, row },
      attackerId: mover.id,
      attackerFaction: mover.faction,
      attackerTrueRank: mover.trueRank,
      defenderId: defender.id,
      defenderFaction: defender.faction,
      defenderTrueRank: defender.trueRank,
    });

    this.interactionLocked = true;
    this.selectedPieceId = null;
    this.activeClash = verdict;
    this.cameraMode = 'ARBITER';
    this.banner = 'CLASH LOCK-IN';
    this.emit();

    return { kind: 'CLASH', verdict };
  }

  /**
   * Showcase trigger from the collapsible Director Pill so all 4 Arbiter outcomes
   * (Player Win, Enemy Win, Mutual Split, Flag Capture) can be tested in 1 tap.
   */
  public triggerShowcaseClash(preset: ShowcasePreset): ArbiterVerdict | null {
    if (this.interactionLocked) return null;
    if (this.cameraMode === 'INSPECT_16') {
      this.cameraMode = 'PLAY';
    }

    // Ensure at least one alive Player piece and one alive Enemy piece exist; reset if depleted
    let playerPiece =
      Array.from(this.#truthPieces.values()).find(
        (p) => p.alive && p.faction === 'PLAYER' && p.trueRank === 'SERGEANT'
      ) ??
      Array.from(this.#truthPieces.values()).find((p) => p.alive && p.faction === 'PLAYER');

    let enemyPiece = Array.from(this.#truthPieces.values()).find(
      (p) => p.alive && p.faction === 'ENEMY' && p.trueRank !== 'FLAG'
    );

    if (!playerPiece || !enemyPiece) {
      this.resetSandbox();
      playerPiece = this.#truthPieces.get('p_00')!;
      enemyPiece = this.#truthPieces.get('e_00')!;
    }

    if (preset === 'PLAYER_WIN') {
      playerPiece.trueRank; // keep visible rank authentic
      // Set enemy truth rank temporarily to a rank defeated by playerPiece (or upgrade player if Flag)
      const pRank = playerPiece.trueRank === 'FLAG' ? 'SERGEANT' : playerPiece.trueRank;
      (playerPiece as { trueRank: RankId }).trueRank = pRank;
      (enemyPiece as { trueRank: RankId }).trueRank = pRank === 'PRIVATE' ? 'SPY' : 'PRIVATE';
    } else if (preset === 'ENEMY_WIN') {
      const pRank = playerPiece.trueRank === 'GEN_5' ? 'SERGEANT' : playerPiece.trueRank;
      (playerPiece as { trueRank: RankId }).trueRank = pRank;
      (enemyPiece as { trueRank: RankId }).trueRank = pRank === 'SPY' ? 'PRIVATE' : 'GEN_5';
    } else if (preset === 'MUTUAL_SPLIT') {
      const pRank = playerPiece.trueRank === 'FLAG' ? 'SERGEANT' : playerPiece.trueRank;
      (playerPiece as { trueRank: RankId }).trueRank = pRank;
      (enemyPiece as { trueRank: RankId }).trueRank = pRank;
    } else if (preset === 'FLAG_CAPTURE') {
      const enemyFlag =
        Array.from(this.#truthPieces.values()).find(
          (p) => p.alive && p.faction === 'ENEMY' && p.trueRank === 'FLAG'
        ) ?? enemyPiece;
      (enemyFlag as { trueRank: RankId }).trueRank = 'FLAG';
      enemyPiece = enemyFlag;
    }

    const contestedCoord = { col: enemyPiece.col, row: enemyPiece.row };
    const verdict = resolveArbiterChallenge({
      contestedCoord,
      attackerId: playerPiece.id,
      attackerFaction: 'PLAYER',
      attackerTrueRank: playerPiece.trueRank,
      defenderId: enemyPiece.id,
      defenderFaction: 'ENEMY',
      defenderTrueRank: enemyPiece.trueRank,
    });

    this.interactionLocked = true;
    this.selectedPieceId = null;
    this.activeClash = verdict;
    this.cameraMode = 'ARBITER';
    this.banner = 'CLASH LOCK-IN';
    this.emit();
    return verdict;
  }

  public setArbiterBanner(banner: HudBannerState): void {
    this.banner = banner;
    this.emit();
  }

  /**
   * Commits the outcome to `#truthPieces` and casualty wells once the 3-Act Electronic Arbiter completes.
   */
  public finalizeActiveClash(): void {
    const verdict = this.activeClash;
    if (!verdict) return;

    const attacker = this.#truthPieces.get(verdict.attackerId);
    const defender = this.#truthPieces.get(verdict.defenderId);
    if (!attacker || !defender) return;

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

    if (verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER') {
      this.matchWinner = 'PLAYER';
      this.banner = 'FLAG CAPTURED — VICTORY';
    } else if (verdict.resolution === 'FLAG_CAPTURED_BY_ENEMY') {
      this.matchWinner = 'ENEMY';
      this.banner = 'FLAG LOST — DEFEAT';
    } else {
      this.banner = 'TACTICAL COMMAND';
    }

    this.turnCount += 1;
    this.activeClash = null;
    this.cameraMode = 'PLAY';
    this.interactionLocked = false;
    this.emit();
  }

  public getVisibleView(): PlayerVisibleView {
    const pieces: VisiblePieceView[] = [];
    for (const record of this.#truthPieces.values()) {
      if (!record.alive) continue;
      pieces.push({
        id: record.id,
        faction: record.faction,
        visibleRank: record.faction === 'PLAYER' ? record.trueRank : 'UNKNOWN',
        col: record.col,
        row: record.row,
        alive: record.alive,
      });
    }

    return {
      pieces,
      playerCasualties: [...this.#playerCasualties],
      enemyCasualties: [...this.#enemyCasualties],
      selectedPieceId: this.selectedPieceId,
      validMoves: this.computeValidMoves(this.selectedPieceId),
      activeClash: this.activeClash,
      banner: this.banner,
      cameraMode: this.cameraMode,
      turnCount: this.turnCount,
      matchWinner: this.matchWinner,
    };
  }

  private eliminatePiece(piece: TruthPieceRecord): void {
    if (!piece.alive) return;
    piece.alive = false;
    if (piece.faction === 'PLAYER') {
      this.#playerCasualties.push({
        id: piece.id,
        faction: 'PLAYER',
        visibleRank: piece.trueRank,
        casualtyIndex: this.#playerCasualties.length,
      });
    } else {
      // Enemy piece enters casualty well face-down: rank stays strictly 'UNKNOWN'!
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

  private emit(): void {
    const view = this.getVisibleView();
    const opts = this.getOptions();
    for (const fn of this.listeners) {
      fn(view, opts);
    }
  }
}
