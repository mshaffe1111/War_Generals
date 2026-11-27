import {
  BOARD_COLS,
  BOARD_ROWS,
  ORDERED_RANKS,
  RANK_SPECS,
  buildStandardArmyRoster,
  type Faction,
  type RankId,
} from './ranks';
import type { AudioEraMode, DeploymentPresetId, GridCoord } from './types';

/**
 * Canonical Spec Alias Constants (`FIVE_STAR` .. `FLAG`) mapped 1:1 to `RankId`
 * so zero split-brain rank catalogs can ever exist across modules.
 */
export const SALPAKAN_RANK_ALIASES = {
  FIVE_STAR: 'GEN_5',
  FOUR_STAR: 'GEN_4',
  THREE_STAR: 'GEN_3',
  TWO_STAR: 'GEN_2',
  ONE_STAR: 'GEN_1',
  COLONEL: 'COLONEL',
  LT_COLONEL: 'LT_COLONEL',
  MAJOR: 'MAJOR',
  CAPTAIN: 'CAPTAIN',
  FIRST_LT: 'LT_1ST',
  SECOND_LT: 'LT_2ND',
  SERGEANT: 'SERGEANT',
  PRIVATE: 'PRIVATE',
  SPY: 'SPY',
  FLAG: 'FLAG',
} as const satisfies Record<string, RankId>;

export type ClashPairOutcome = 'ATTACKER' | 'DEFENDER' | 'SPLIT';

export const PLAYER_HOME_ROWS: readonly number[] = [5, 6, 7]; // Bottom 3 rows nearest player (`27` squares)
export const ENEMY_HOME_ROWS: readonly number[] = [0, 1, 2]; // Top 3 rows nearest Warfield trench (`27` squares)
export const ARMY_PIECE_TOTAL = 21;

export interface DeploymentSlot {
  readonly col: number;
  readonly row: number;
  readonly rank: RankId;
}

export interface BlueprintSaveSlot {
  readonly slotIndex: number; // 0..4
  readonly label: string;
  readonly savedAt: number;
  readonly slots: readonly DeploymentSlot[];
}

const BLUEPRINT_STORAGE_KEY = 'war_generals_custom_blueprints_v1';

/**
 * Deterministic Official War Generals (Salpakan) Clash Resolution Matrix (`resolveClash`).
 *
 * Verified Laws:
 *  1. Flag-on-Flag Exception: If `attacker === 'FLAG' && defender === 'FLAG'`, the aggressing `ATTACKER` wins!
 *  2. Any non-Flag challenging `FLAG` captures it (`ATTACKER`); moving `FLAG` into any non-Flag loses (`DEFENDER`).
 *  3. Equal Ranks (`attacker === defender` for all other 14 ranks, incl. `SPY == SPY` & `PRIVATE == PRIVATE`): `SPLIT`.
 *  4. `SPY` eliminates all Officers (`SERGEANT`..`GEN_5`); `PRIVATE` is the ONLY piece that eliminates `SPY` (either direction).
 *  5. Officer / Private hierarchy: higher numeric seniority (`14` down to `2`) eliminates lower.
 */
export function resolveClash(attacker: RankId, defender: RankId): ClashPairOutcome {
  if (defender === 'FLAG') {
    return 'ATTACKER';
  }
  if (attacker === 'FLAG') {
    return 'DEFENDER';
  }
  if (attacker === defender) {
    return 'SPLIT';
  }
  if (attacker === 'SPY') {
    return defender === 'PRIVATE' ? 'DEFENDER' : 'ATTACKER';
  }
  if (defender === 'SPY') {
    return attacker === 'PRIVATE' ? 'ATTACKER' : 'DEFENDER';
  }
  const attPow = RANK_SPECS[attacker].seniority;
  const defPow = RANK_SPECS[defender].seniority;
  if (attPow > defPow) return 'ATTACKER';
  if (defPow > attPow) return 'DEFENDER';
  return 'SPLIT';
}

export function isPlayerHomeSquare(col: number, row: number): boolean {
  return col >= 0 && col < BOARD_COLS && row >= 5 && row <= 7;
}

export function isOrthogonalSingleStep(from: GridCoord, to: GridCoord): boolean {
  if (to.col < 0 || to.col >= BOARD_COLS || to.row < 0 || to.row >= BOARD_ROWS) return false;
  return Math.abs(from.col - to.col) + Math.abs(from.row - to.row) === 1;
}

export function formatAlgebraicCoord(col: number, row: number): string {
  const file = String.fromCharCode(65 + Math.max(0, Math.min(8, col)));
  const rankFromPlayer = BOARD_ROWS - row; // row 7 -> 1, row 0 -> 8
  return `${file}${rankFromPlayer}`;
}

/**
 * Evaluates Back-Row Flag Traverse Victory dynamically per active Era Ruleset:
 * - Player goal row = `0` (Enemy back rank); Enemy goal row = `7` (Player back rank).
 * - `1980s` Electronic Ruleset: Reaching the opposite back row wins immediately if no enemy piece is orthogonally adjacent
 *   (or if already unchallenged on the back row).
 * - `1970s` Classic Ruleset: Deferred 1-turn adjacency check — if an enemy piece is orthogonally adjacent when the Flag steps
 *   onto the back row, the opponent gets 1 turn to capture it; if uncaptured when turn returns (or zero adjacent enemies), victory!
 */
export function checkBackRowFlagTraverse(
  pieces: ReadonlyArray<{
    faction: Faction;
    trueRank: RankId;
    col: number;
    row: number;
    alive: boolean;
  }>,
  justMovedFaction: Faction,
  eraMode: AudioEraMode,
  flagAlreadySurvivedTurnOnGoalRow: boolean
): Faction | null {
  for (const p of pieces) {
    if (!p.alive || p.trueRank !== 'FLAG') continue;
    const goalRow = p.faction === 'PLAYER' ? 0 : BOARD_ROWS - 1;
    if (p.row !== goalRow) continue;

    const hasAdjacentEnemy = pieces.some(
      (other) =>
        other.alive &&
        other.faction !== p.faction &&
        Math.abs(other.col - p.col) + Math.abs(other.row - p.row) === 1
    );

    if (eraMode === '1980s') {
      // 1980s Electronic instant win upon safely reaching opposite back row (or surviving to own turn)
      if (!hasAdjacentEnemy || flagAlreadySurvivedTurnOnGoalRow || p.faction === justMovedFaction) {
        return p.faction;
      }
    } else {
      // 1970s Classic deferred check: immediate if zero adjacent enemies, otherwise must survive opponent's response turn!
      if (!hasAdjacentEnemy || flagAlreadySurvivedTurnOnGoalRow) {
        return p.faction;
      }
    }
  }
  return null;
}

/**
 * Verifies a 21-piece deployment has exact legal Salpakan quantities on unique home-row squares.
 */
export function validatePlayerDeployment(slots: readonly DeploymentSlot[]): boolean {
  if (slots.length !== ARMY_PIECE_TOTAL) return false;
  const seenCoords = new Set<string>();
  const counts = new Map<RankId, number>();

  for (const s of slots) {
    if (!isPlayerHomeSquare(s.col, s.row)) return false;
    const key = `${s.col},${s.row}`;
    if (seenCoords.has(key)) return false;
    seenCoords.add(key);
    counts.set(s.rank, (counts.get(s.rank) ?? 0) + 1);
  }

  for (const r of ORDERED_RANKS) {
    if ((counts.get(r) ?? 0) !== RANK_SPECS[r].countPerArmy) return false;
  }
  return true;
}

/**
 * Four Authentic Tournament Formations (`21` pieces across Player Home Rows `5..7`, leaving `6` tactical lanes):
 *  1. `VACCINATION` — Balanced central spearhead (`5★`, `4★`, `Colonel` core) with flanked `Spies`
 *  2. `MOTHERSHIP`  — Fortified back-corner `Flag` ringed by `Privates` (anti-Spy screen) + roaming `Spy` escorts
 *  3. `IRON_BLITZ`  — `5★`, `4★`, and `Spy` triad on frontline `Row 5` for immediate center dominance
 *  4. `MIRAGE_DECOY`— Heavily guarded fake "Flag" (`Private` at `B1`) on left wing; real `Flag` disguised unguarded on right flank!
 */
export const TOURNAMENT_PRESETS: Readonly<Record<DeploymentPresetId, readonly DeploymentSlot[]>> = {
  VACCINATION: [
    // Row 5 (Frontline Vanguard — 7 pieces)
    { col: 1, row: 5, rank: 'PRIVATE' },
    { col: 2, row: 5, rank: 'SPY' },
    { col: 3, row: 5, rank: 'GEN_5' },
    { col: 4, row: 5, rank: 'SERGEANT' },
    { col: 5, row: 5, rank: 'COLONEL' },
    { col: 6, row: 5, rank: 'SPY' },
    { col: 7, row: 5, rank: 'PRIVATE' },
    // Row 6 (Officer Support Line — 9 pieces)
    { col: 0, row: 6, rank: 'PRIVATE' },
    { col: 1, row: 6, rank: 'GEN_3' },
    { col: 2, row: 6, rank: 'LT_COLONEL' },
    { col: 3, row: 6, rank: 'MAJOR' },
    { col: 4, row: 6, rank: 'GEN_4' },
    { col: 5, row: 6, rank: 'CAPTAIN' },
    { col: 6, row: 6, rank: 'GEN_2' },
    { col: 7, row: 6, rank: 'GEN_1' },
    { col: 8, row: 6, rank: 'PRIVATE' },
    // Row 7 (Home Flag & Rear Guard — 5 pieces)
    { col: 1, row: 7, rank: 'LT_1ST' },
    { col: 3, row: 7, rank: 'PRIVATE' },
    { col: 4, row: 7, rank: 'FLAG' },
    { col: 5, row: 7, rank: 'PRIVATE' },
    { col: 7, row: 7, rank: 'LT_2ND' },
  ],

  MOTHERSHIP: [
    // Fortified Right-Corner Flag (`col 7, row 7`) ringed by Privates (`(6,7), (7,6), (8,7)`)!
    { col: 0, row: 5, rank: 'GEN_3' },
    { col: 2, row: 5, rank: 'GEN_5' },
    { col: 3, row: 5, rank: 'SPY' },
    { col: 5, row: 5, rank: 'GEN_4' },
    { col: 6, row: 5, rank: 'SPY' },
    { col: 7, row: 5, rank: 'COLONEL' },
    { col: 8, row: 5, rank: 'PRIVATE' },

    { col: 0, row: 6, rank: 'LT_1ST' },
    { col: 1, row: 6, rank: 'GEN_2' },
    { col: 2, row: 6, rank: 'PRIVATE' },
    { col: 4, row: 6, rank: 'GEN_1' },
    { col: 5, row: 6, rank: 'LT_COLONEL' },
    { col: 6, row: 6, rank: 'MAJOR' },
    { col: 7, row: 6, rank: 'PRIVATE' },
    { col: 8, row: 6, rank: 'CAPTAIN' },

    { col: 1, row: 7, rank: 'LT_2ND' },
    { col: 3, row: 7, rank: 'SERGEANT' },
    { col: 5, row: 7, rank: 'PRIVATE' },
    { col: 6, row: 7, rank: 'PRIVATE' },
    { col: 7, row: 7, rank: 'FLAG' },
    { col: 8, row: 7, rank: 'PRIVATE' },
  ],

  IRON_BLITZ: [
    // Aggressive Row 5 Center Triad (`GEN_5`, `SPY`, `GEN_4`) for immediate center control!
    { col: 0, row: 5, rank: 'CAPTAIN' },
    { col: 1, row: 5, rank: 'COLONEL' },
    { col: 3, row: 5, rank: 'GEN_5' },
    { col: 4, row: 5, rank: 'SPY' },
    { col: 5, row: 5, rank: 'GEN_4' },
    { col: 7, row: 5, rank: 'GEN_3' },
    { col: 8, row: 5, rank: 'LT_COLONEL' },

    { col: 1, row: 6, rank: 'PRIVATE' },
    { col: 2, row: 6, rank: 'GEN_2' },
    { col: 3, row: 6, rank: 'PRIVATE' },
    { col: 4, row: 6, rank: 'MAJOR' },
    { col: 5, row: 6, rank: 'PRIVATE' },
    { col: 6, row: 6, rank: 'SPY' },
    { col: 7, row: 6, rank: 'GEN_1' },

    { col: 0, row: 7, rank: 'LT_2ND' },
    { col: 2, row: 7, rank: 'PRIVATE' },
    { col: 3, row: 7, rank: 'SERGEANT' },
    { col: 4, row: 7, rank: 'PRIVATE' },
    { col: 5, row: 7, rank: 'FLAG' },
    { col: 6, row: 7, rank: 'PRIVATE' },
    { col: 8, row: 7, rank: 'LT_1ST' },
  ],

  MIRAGE_DECOY: [
    // Fake "Fortress" around a decoy Private at `(1, 7)`, while the REAL Flag hides unguarded at `(8, 7)`!
    { col: 0, row: 5, rank: 'GEN_4' },
    { col: 1, row: 5, rank: 'SPY' },
    { col: 2, row: 5, rank: 'GEN_5' },
    { col: 4, row: 5, rank: 'COLONEL' },
    { col: 6, row: 5, rank: 'SPY' },
    { col: 7, row: 5, rank: 'SERGEANT' },

    { col: 0, row: 6, rank: 'PRIVATE' },
    { col: 1, row: 6, rank: 'PRIVATE' },
    { col: 2, row: 6, rank: 'GEN_3' },
    { col: 3, row: 6, rank: 'LT_COLONEL' },
    { col: 4, row: 6, rank: 'GEN_2' },
    { col: 5, row: 6, rank: 'MAJOR' },
    { col: 6, row: 6, rank: 'GEN_1' },
    { col: 8, row: 6, rank: 'LT_2ND' },

    { col: 0, row: 7, rank: 'PRIVATE' },
    { col: 1, row: 7, rank: 'PRIVATE' }, // Decoy Flag!
    { col: 2, row: 7, rank: 'PRIVATE' },
    { col: 4, row: 7, rank: 'CAPTAIN' },
    { col: 5, row: 7, rank: 'LT_1ST' },
    { col: 6, row: 7, rank: 'PRIVATE' },
    { col: 8, row: 7, rank: 'FLAG' }, // Real Mirage Bluff Flag!
  ],
};

export function mirrorDeploymentLR(slots: readonly DeploymentSlot[]): DeploymentSlot[] {
  return slots.map((s) => ({
    col: BOARD_COLS - 1 - s.col,
    row: s.row,
    rank: s.rank,
  }));
}

export function generateSmartAutoDeploy(): DeploymentSlot[] {
  const keys: DeploymentPresetId[] = ['VACCINATION', 'MOTHERSHIP', 'IRON_BLITZ', 'MIRAGE_DECOY'];
  const pick = keys[Math.floor(Math.random() * keys.length)]!;
  const base = TOURNAMENT_PRESETS[pick].map((s) => ({ ...s }));
  return Math.random() < 0.5 ? mirrorDeploymentLR(base) : base;
}

/**
 * Generates an authentic Enemy deployment on Enemy Home Rows `0..2` (`row' = 7 - row`).
 */
export function generateEnemyTournamentDeployment(): DeploymentSlot[] {
  const base = generateSmartAutoDeploy();
  return base.map((s) => ({
    col: BOARD_COLS - 1 - s.col,
    row: BOARD_ROWS - 1 - s.row, // maps 5..7 -> 2..0!
    rank: s.rank,
  }));
}

export function computeUnplacedCounts(placed: readonly DeploymentSlot[]): Record<RankId, number> {
  const full = buildStandardArmyRoster();
  const rem: Record<RankId, number> = {
    GEN_5: 0,
    GEN_4: 0,
    GEN_3: 0,
    GEN_2: 0,
    GEN_1: 0,
    COLONEL: 0,
    LT_COLONEL: 0,
    MAJOR: 0,
    CAPTAIN: 0,
    LT_1ST: 0,
    LT_2ND: 0,
    SERGEANT: 0,
    PRIVATE: 0,
    SPY: 0,
    FLAG: 0,
  };
  for (const r of full) rem[r] += 1;
  for (const p of placed) {
    rem[p.rank] = Math.max(0, rem[p.rank] - 1);
  }
  return rem;
}

export function loadCustomBlueprintSlots(): Array<BlueprintSaveSlot | null> {
  const empty: Array<BlueprintSaveSlot | null> = [null, null, null, null, null];
  try {
    const raw = localStorage.getItem(BLUEPRINT_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return empty;
    return empty.map((_, idx) => {
      const item = parsed[idx] as BlueprintSaveSlot | null | undefined;
      if (item && Array.isArray(item.slots) && validatePlayerDeployment(item.slots)) {
        return item;
      }
      return null;
    });
  } catch {
    return empty;
  }
}

export function saveCustomBlueprintSlot(
  slotIndex: number,
  slots: readonly DeploymentSlot[]
): Array<BlueprintSaveSlot | null> {
  const all = loadCustomBlueprintSlots();
  if (slotIndex < 0 || slotIndex >= 5 || !validatePlayerDeployment(slots)) {
    return all;
  }
  all[slotIndex] = {
    slotIndex,
    label: `S${slotIndex + 1}`,
    savedAt: Date.now(),
    slots: slots.map((s) => ({ col: s.col, row: s.row, rank: s.rank })),
  };
  try {
    localStorage.setItem(BLUEPRINT_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage quota restrictions
  }
  return all;
}
