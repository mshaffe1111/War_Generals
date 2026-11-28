import type {
  OperationProgressRecord,
  OperationProgressState,
  TacticalOperationSpec,
} from './types';

const OPERATIONS_STORAGE_KEY = 'war_generals_operations_v1';

export const TACTICAL_OPERATIONS: readonly TacticalOperationSpec[] = [
  {
    id: 'OP_01_IRON_BREAKOUT',
    codeName: 'OP-01 // IRON BREAKOUT',
    title: 'Center-Lane Breakthrough',
    briefing:
      'Break Cadet Miller’s central defense and capture the enemy Flag before reinforcement clocks expire.',
    objectiveSummary: 'Capture the Enemy Flag within 56 plies.',
    theaterId: 'FIELD_HQ',
    eraRuleset: '1980s',
    commanderId: 'MILLER',
    difficulty: 'RECRUIT',
    turnLimit: 56,
    objectiveKind: 'CAPTURE_FLAG',
    playerPlacements: [
      { col: 4, row: 7, rank: 'FLAG' },
      { col: 3, row: 7, rank: 'PRIVATE' },
      { col: 5, row: 7, rank: 'PRIVATE' },
      { col: 2, row: 6, rank: 'COLONEL' },
      { col: 4, row: 6, rank: 'GEN_4' },
      { col: 6, row: 6, rank: 'SPY' },
      { col: 3, row: 5, rank: 'GEN_5' },
      { col: 5, row: 5, rank: 'MAJOR' },
      { col: 1, row: 5, rank: 'PRIVATE' },
      { col: 7, row: 5, rank: 'SERGEANT' },
    ],
    enemyPlacements: [
      { col: 4, row: 0, rank: 'FLAG' },
      { col: 3, row: 0, rank: 'PRIVATE' },
      { col: 5, row: 0, rank: 'PRIVATE' },
      { col: 4, row: 1, rank: 'COLONEL' },
      { col: 2, row: 1, rank: 'GEN_3' },
      { col: 6, row: 1, rank: 'SPY' },
      { col: 3, row: 2, rank: 'CAPTAIN' },
      { col: 5, row: 2, rank: 'GEN_4' },
      { col: 1, row: 2, rank: 'PRIVATE' },
      { col: 7, row: 2, rank: 'LT_1ST' },
    ],
    starThresholds: {
      threeStarMaxTurns: 28,
      twoStarMaxTurns: 42,
    },
  },
  {
    id: 'OP_02_STILETTO_PURGE',
    codeName: 'OP-02 // STILETTO PURGE',
    title: 'Counter-Espionage Sweep',
    briefing:
      'Col. Reyes has infiltrated both Spies behind forward Officer decoys. Deploy your Privates to purge every enemy Spy.',
    objectiveSummary: 'Eliminate both Enemy Spies (or capture the Flag) within 52 plies.',
    theaterId: 'NIGHT_OPS',
    eraRuleset: '1980s',
    commanderId: 'REYES',
    difficulty: 'OFFICER',
    turnLimit: 52,
    objectiveKind: 'SPY_HUNT',
    playerPlacements: [
      { col: 4, row: 7, rank: 'FLAG' },
      { col: 2, row: 6, rank: 'PRIVATE' },
      { col: 4, row: 6, rank: 'PRIVATE' },
      { col: 6, row: 6, rank: 'PRIVATE' },
      { col: 3, row: 5, rank: 'COLONEL' },
      { col: 5, row: 5, rank: 'GEN_3' },
      { col: 1, row: 5, rank: 'PRIVATE' },
      { col: 7, row: 5, rank: 'CAPTAIN' },
      { col: 0, row: 6, rank: 'LT_1ST' },
      { col: 8, row: 6, rank: 'SPY' },
    ],
    enemyPlacements: [
      { col: 4, row: 0, rank: 'FLAG' },
      { col: 3, row: 0, rank: 'PRIVATE' },
      { col: 5, row: 0, rank: 'PRIVATE' },
      { col: 2, row: 2, rank: 'SPY' },
      { col: 6, row: 2, rank: 'SPY' },
      { col: 2, row: 3, rank: 'CAPTAIN' },
      { col: 6, row: 3, rank: 'MAJOR' },
      { col: 4, row: 2, rank: 'GEN_4' },
      { col: 1, row: 1, rank: 'LT_COLONEL' },
      { col: 7, row: 1, rank: 'PRIVATE' },
    ],
    starThresholds: {
      threeStarMaxTurns: 24,
      twoStarMaxTurns: 38,
    },
  },
  {
    id: 'OP_03_MIDNIGHT_TRAVERSE',
    codeName: 'OP-03 // MIDNIGHT TRAVERSE',
    title: 'Flag Runner Extraction',
    briefing:
      'Your Flag stands on the midfield flank with a narrow lane to the enemy back rank. Screen Capt. Mercer’s interceptors and traverse.',
    objectiveSummary: 'Reach the Enemy back rank with your Flag within 44 plies.',
    theaterId: 'PACIFIC_BRIDGE',
    eraRuleset: '1980s',
    commanderId: 'MERCER',
    difficulty: 'OFFICER',
    turnLimit: 44,
    objectiveKind: 'FLAG_TRAVERSE',
    playerPlacements: [
      { col: 7, row: 4, rank: 'FLAG' },
      { col: 7, row: 5, rank: 'GEN_5' },
      { col: 6, row: 4, rank: 'PRIVATE' },
      { col: 8, row: 5, rank: 'SPY' },
      { col: 5, row: 5, rank: 'COLONEL' },
      { col: 2, row: 6, rank: 'PRIVATE' },
      { col: 3, row: 6, rank: 'MAJOR' },
      { col: 4, row: 6, rank: 'CAPTAIN' },
      { col: 1, row: 7, rank: 'SERGEANT' },
    ],
    enemyPlacements: [
      { col: 1, row: 0, rank: 'FLAG' },
      { col: 0, row: 0, rank: 'PRIVATE' },
      { col: 2, row: 0, rank: 'PRIVATE' },
      { col: 7, row: 1, rank: 'LT_COLONEL' },
      { col: 6, row: 2, rank: 'PRIVATE' },
      { col: 8, row: 2, rank: 'SPY' },
      { col: 5, row: 1, rank: 'GEN_4' },
      { col: 3, row: 2, rank: 'GEN_2' },
      { col: 4, row: 3, rank: 'SERGEANT' },
      { col: 1, row: 2, rank: 'CAPTAIN' },
    ],
    starThresholds: {
      threeStarMaxTurns: 20,
      twoStarMaxTurns: 32,
    },
  },
  {
    id: 'OP_04_BUNKER_SIEGE',
    codeName: 'OP-04 // BUNKER SIEGE',
    title: 'Last-Stand Perimeter',
    briefing:
      'Outnumbered 8-to-12 under 1970s Classic rules, hold the bunker perimeter against Gen. Vance’s armored assault for 16 plies.',
    objectiveSummary: 'Keep your Flag alive until Turn 16 ends.',
    theaterId: 'IRON_BUNKER',
    eraRuleset: '1970s',
    commanderId: 'VANCE',
    difficulty: 'GENERAL',
    turnLimit: 16,
    objectiveKind: 'SURVIVAL_DEFENSE',
    playerPlacements: [
      { col: 1, row: 7, rank: 'FLAG' },
      { col: 0, row: 7, rank: 'PRIVATE' },
      { col: 2, row: 7, rank: 'PRIVATE' },
      { col: 1, row: 6, rank: 'PRIVATE' },
      { col: 3, row: 6, rank: 'COLONEL' },
      { col: 2, row: 5, rank: 'SPY' },
      { col: 4, row: 6, rank: 'GEN_3' },
      { col: 0, row: 5, rank: 'MAJOR' },
    ],
    enemyPlacements: [
      { col: 7, row: 0, rank: 'FLAG' },
      { col: 6, row: 0, rank: 'PRIVATE' },
      { col: 8, row: 0, rank: 'PRIVATE' },
      { col: 1, row: 3, rank: 'GEN_5' },
      { col: 2, row: 3, rank: 'GEN_4' },
      { col: 3, row: 3, rank: 'CAPTAIN' },
      { col: 4, row: 3, rank: 'LT_COLONEL' },
      { col: 0, row: 4, rank: 'SERGEANT' },
      { col: 5, row: 2, rank: 'SPY' },
      { col: 6, row: 2, rank: 'GEN_2' },
      { col: 3, row: 2, rank: 'PRIVATE' },
      { col: 7, row: 2, rank: 'MAJOR' },
    ],
    starThresholds: {
      threeStarMaxTurns: 16,
      twoStarMaxTurns: 16,
      threeStarMinSurvivors: 6,
      twoStarMinSurvivors: 4,
    },
  },
  {
    id: 'OP_05_BLITZ_CORRIDOR',
    codeName: 'OP-05 // BLITZ CORRIDOR',
    title: 'High-Tempo Collision',
    briefing:
      'Gen. Vance has committed his 5★ Spearhead forward down the center, thinning his right back-rank lane. Smash his pocketed flank or breach Row 8 within 42 plies.',
    objectiveSummary: 'Capture the Enemy Flag or Traverse within 42 plies.',
    theaterId: 'PACIFIC_BRIDGE',
    eraRuleset: '1980s',
    commanderId: 'VANCE',
    difficulty: 'GENERAL',
    turnLimit: 42,
    objectiveKind: 'BLITZ_BREACH',
    playerPlacements: [
      { col: 6, row: 5, rank: 'FLAG' },
      { col: 5, row: 5, rank: 'PRIVATE' },
      { col: 7, row: 5, rank: 'PRIVATE' },
      { col: 2, row: 4, rank: 'GEN_5' },
      { col: 1, row: 4, rank: 'COLONEL' },
      { col: 3, row: 4, rank: 'PRIVATE' },
      { col: 4, row: 4, rank: 'SPY' },
      { col: 5, row: 4, rank: 'GEN_4' },
      { col: 3, row: 5, rank: 'LT_COLONEL' },
      { col: 4, row: 5, rank: 'MAJOR' },
    ],
    enemyPlacements: [
      { col: 3, row: 0, rank: 'FLAG' },
      { col: 2, row: 0, rank: 'PRIVATE' },
      { col: 4, row: 1, rank: 'COLONEL' },
      { col: 2, row: 2, rank: 'GEN_4' },
      { col: 4, row: 2, rank: 'GEN_5' },
      { col: 5, row: 2, rank: 'SPY' },
      { col: 6, row: 2, rank: 'PRIVATE' },
      { col: 1, row: 2, rank: 'MAJOR' },
      { col: 3, row: 1, rank: 'CAPTAIN' },
      { col: 5, row: 3, rank: 'SERGEANT' },
    ],
    starThresholds: {
      threeStarMaxTurns: 26,
      twoStarMaxTurns: 34,
    },
  },
  {
    id: 'OP_06_BASTION_CRACK',
    codeName: 'OP-06 // BASTION CRACK',
    title: 'Fortress Attrition',
    briefing:
      'Maj. Sterling has fortified the left corner under 1970s rules. Crack his Private-and-Colonel ring without losing your Generals to Spies.',
    objectiveSummary: 'Capture Maj. Sterling’s Flag within 76 plies.',
    theaterId: 'IRON_BUNKER',
    eraRuleset: '1970s',
    commanderId: 'STERLING',
    difficulty: 'GENERAL',
    turnLimit: 76,
    objectiveKind: 'CAPTURE_FLAG',
    playerPlacements: [
      { col: 4, row: 7, rank: 'FLAG' },
      { col: 3, row: 7, rank: 'PRIVATE' },
      { col: 5, row: 7, rank: 'PRIVATE' },
      { col: 1, row: 5, rank: 'PRIVATE' },
      { col: 2, row: 5, rank: 'GEN_5' },
      { col: 3, row: 5, rank: 'SPY' },
      { col: 5, row: 5, rank: 'GEN_4' },
      { col: 6, row: 5, rank: 'PRIVATE' },
      { col: 4, row: 5, rank: 'COLONEL' },
      { col: 0, row: 6, rank: 'MAJOR' },
      { col: 7, row: 6, rank: 'SPY' },
      { col: 8, row: 6, rank: 'GEN_3' },
    ],
    enemyPlacements: [
      { col: 1, row: 0, rank: 'FLAG' },
      { col: 0, row: 0, rank: 'PRIVATE' },
      { col: 2, row: 0, rank: 'PRIVATE' },
      { col: 1, row: 1, rank: 'PRIVATE' },
      { col: 2, row: 1, rank: 'COLONEL' },
      { col: 3, row: 1, rank: 'LT_COLONEL' },
      { col: 3, row: 2, rank: 'GEN_5' },
      { col: 5, row: 2, rank: 'SPY' },
      { col: 6, row: 2, rank: 'GEN_4' },
      { col: 4, row: 2, rank: 'MAJOR' },
      { col: 7, row: 1, rank: 'SPY' },
    ],
    starThresholds: {
      threeStarMaxTurns: 36,
      twoStarMaxTurns: 56,
    },
  },
  {
    id: 'OP_07_GHOST_PROTOCOL',
    codeName: 'OP-07 // GHOST PROTOCOL',
    title: 'Escorted Cell Elimination',
    briefing:
      'Marshal Hollis is operating twin Spy-Private escort cells in blackout conditions. Neutralize both Spies before they assassinate your Command.',
    objectiveSummary: 'Eliminate both Enemy Spies within 56 plies.',
    theaterId: 'NIGHT_OPS',
    eraRuleset: '1970s',
    commanderId: 'HOLLIS',
    difficulty: 'SUPREME_MARSHAL',
    turnLimit: 56,
    objectiveKind: 'SPY_HUNT',
    playerPlacements: [
      { col: 6, row: 7, rank: 'FLAG' },
      { col: 5, row: 7, rank: 'PRIVATE' },
      { col: 7, row: 7, rank: 'PRIVATE' },
      { col: 1, row: 5, rank: 'PRIVATE' },
      { col: 3, row: 5, rank: 'PRIVATE' },
      { col: 4, row: 5, rank: 'GEN_5' },
      { col: 6, row: 5, rank: 'COLONEL' },
      { col: 7, row: 5, rank: 'PRIVATE' },
      { col: 2, row: 6, rank: 'SPY' },
      { col: 5, row: 6, rank: 'GEN_4' },
      { col: 8, row: 6, rank: 'LT_COLONEL' },
    ],
    enemyPlacements: [
      { col: 1, row: 0, rank: 'FLAG' },
      { col: 0, row: 0, rank: 'PRIVATE' },
      { col: 2, row: 0, rank: 'PRIVATE' },
      { col: 2, row: 2, rank: 'SPY' },
      { col: 2, row: 3, rank: 'PRIVATE' },
      { col: 6, row: 2, rank: 'SPY' },
      { col: 6, row: 3, rank: 'PRIVATE' },
      { col: 4, row: 2, rank: 'GEN_5' },
      { col: 3, row: 1, rank: 'GEN_4' },
      { col: 5, row: 1, rank: 'COLONEL' },
      { col: 7, row: 1, rank: 'MAJOR' },
    ],
    starThresholds: {
      threeStarMaxTurns: 26,
      twoStarMaxTurns: 42,
    },
  },
  {
    id: 'OP_08_SOVEREIGN_ENDGAME',
    codeName: 'OP-08 // SOVEREIGN ENDGAME',
    title: '1970s Deferred Bluff Sprint',
    briefing:
      'Under strict 1970s rules, escort your forward Flag across Marshal Hollis’s back rank and survive the final counter-turn.',
    objectiveSummary: 'Traverse your Flag to Row 8 and survive 1 turn (or capture Flag) within 48 plies.',
    theaterId: 'FIELD_HQ',
    eraRuleset: '1970s',
    commanderId: 'HOLLIS',
    difficulty: 'SUPREME_MARSHAL',
    turnLimit: 48,
    objectiveKind: 'FLAG_TRAVERSE',
    playerPlacements: [
      { col: 2, row: 3, rank: 'FLAG' },
      { col: 1, row: 3, rank: 'GEN_5' },
      { col: 3, row: 3, rank: 'PRIVATE' },
      { col: 2, row: 4, rank: 'SPY' },
      { col: 5, row: 4, rank: 'GEN_4' },
      { col: 6, row: 4, rank: 'PRIVATE' },
      { col: 4, row: 5, rank: 'COLONEL' },
      { col: 7, row: 5, rank: 'MAJOR' },
      { col: 0, row: 5, rank: 'CAPTAIN' },
    ],
    enemyPlacements: [
      { col: 7, row: 0, rank: 'FLAG' },
      { col: 6, row: 0, rank: 'PRIVATE' },
      { col: 8, row: 0, rank: 'PRIVATE' },
      { col: 2, row: 1, rank: 'GEN_5' },
      { col: 4, row: 1, rank: 'SPY' },
      { col: 1, row: 2, rank: 'PRIVATE' },
      { col: 3, row: 2, rank: 'LT_COLONEL' },
      { col: 5, row: 2, rank: 'GEN_4' },
      { col: 6, row: 2, rank: 'SPY' },
      { col: 0, row: 2, rank: 'SERGEANT' },
    ],
    starThresholds: {
      threeStarMaxTurns: 22,
      twoStarMaxTurns: 34,
    },
  },
];

export function getTacticalOperation(id: string): TacticalOperationSpec | undefined {
  return TACTICAL_OPERATIONS.find((op) => op.id === id);
}

export const getOperationSpec = getTacticalOperation;

function createDefaultOperationProgress(): Record<string, OperationProgressRecord> {
  const out: Record<string, OperationProgressRecord> = {};
  for (const op of TACTICAL_OPERATIONS) {
    out[op.id] = {
      completed: false,
      bestStars: 0,
      bestTurns: null,
      attempts: 0,
    };
  }
  return out;
}

export function loadOperationProgress(): OperationProgressState {
  const fallback = createDefaultOperationProgress();
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(OPERATIONS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, Partial<OperationProgressRecord>> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;

    for (const op of TACTICAL_OPERATIONS) {
      const rec = parsed[op.id];
      if (!rec) continue;
      const rawStars = Number(rec.bestStars);
      const stars: 0 | 1 | 2 | 3 =
        rawStars === 3 ? 3 : rawStars === 2 ? 2 : rawStars === 1 ? 1 : 0;
      fallback[op.id] = {
        completed: Boolean(rec.completed),
        bestStars: stars,
        bestTurns: typeof rec.bestTurns === 'number' ? rec.bestTurns : null,
        attempts: Math.max(0, Number(rec.attempts) || 0),
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function computeOperationStars(
  op: TacticalOperationSpec,
  playerWon: boolean,
  turnsElapsed: number,
  playerSurvivors: number
): 0 | 1 | 2 | 3 {
  if (!playerWon) return 0;
  const th = op.starThresholds;
  if (op.objectiveKind === 'SURVIVAL_DEFENSE') {
    const threeMin = th.threeStarMinSurvivors ?? 6;
    const twoMin = th.twoStarMinSurvivors ?? 4;
    if (playerSurvivors >= threeMin) return 3;
    if (playerSurvivors >= twoMin) return 2;
    return 1;
  }
  if (turnsElapsed <= th.threeStarMaxTurns) return 3;
  if (turnsElapsed <= th.twoStarMaxTurns) return 2;
  return 1;
}

export function recordOperationResult(
  operationId: string,
  playerWon: boolean,
  turnsElapsed: number,
  playerSurvivors = 0
): { state: OperationProgressState; starsEarned: 0 | 1 | 2 | 3 } {
  const mutable = { ...loadOperationProgress() } as Record<string, OperationProgressRecord>;
  const op = getTacticalOperation(operationId);
  const existing = mutable[operationId] ?? {
    completed: false,
    bestStars: 0 as const,
    bestTurns: null,
    attempts: 0,
  };

  const starsEarned = op
    ? computeOperationStars(op, playerWon, turnsElapsed, playerSurvivors)
    : playerWon
      ? (1 as const)
      : (0 as const);

  const nextBestStars = Math.max(existing.bestStars, starsEarned) as 0 | 1 | 2 | 3;

  mutable[operationId] = {
    completed: existing.completed || playerWon,
    bestStars: nextBestStars,
    bestTurns: playerWon
      ? existing.bestTurns === null
        ? turnsElapsed
        : Math.min(existing.bestTurns, turnsElapsed)
      : existing.bestTurns,
    attempts: existing.attempts + 1,
  };

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OPERATIONS_STORAGE_KEY, JSON.stringify(mutable));
    }
  } catch {
    // Ignore storage quota limits
  }

  return { state: mutable, starsEarned };
}
