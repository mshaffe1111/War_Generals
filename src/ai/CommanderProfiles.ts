import { BOARD_COLS, ORDERED_RANKS, RANK_SPECS, type RankId } from '../core/ranks';
import type { DeploymentSlot } from '../core/RulesEngine';
import type { AudioEraMode, TheaterId } from '../core/types';

export type CommanderId =
  | 'MILLER'
  | 'MERCER'
  | 'STERLING'
  | 'REYES'
  | 'VANCE'
  | 'HOLLIS';

export type WingZone = 'LEFT' | 'CENTER' | 'RIGHT';

export interface PlayerTendencyMemory {
  matchesObserved: number;
  flagWingCounts: Record<WingZone, number>;
  blitzWingCounts: Record<WingZone, number>;
}

const TENDENCY_STORAGE_KEY = 'war_generals_player_tendencies_v1';
const CAMPAIGN_STORAGE_KEY = 'war_generals_campaign_v2';

export function loadPlayerTendencies(): PlayerTendencyMemory {
  const empty: PlayerTendencyMemory = {
    matchesObserved: 0,
    flagWingCounts: { LEFT: 0, CENTER: 0, RIGHT: 0 },
    blitzWingCounts: { LEFT: 0, CENTER: 0, RIGHT: 0 },
  };
  try {
    const raw = localStorage.getItem(TENDENCY_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PlayerTendencyMemory>;
    if (typeof parsed.matchesObserved === 'number') {
      empty.matchesObserved = Math.max(0, parsed.matchesObserved);
    }
    if (parsed.flagWingCounts) {
      empty.flagWingCounts = {
        LEFT: Number(parsed.flagWingCounts.LEFT) || 0,
        CENTER: Number(parsed.flagWingCounts.CENTER) || 0,
        RIGHT: Number(parsed.flagWingCounts.RIGHT) || 0,
      };
    }
    if (parsed.blitzWingCounts) {
      empty.blitzWingCounts = {
        LEFT: Number(parsed.blitzWingCounts.LEFT) || 0,
        CENTER: Number(parsed.blitzWingCounts.CENTER) || 0,
        RIGHT: Number(parsed.blitzWingCounts.RIGHT) || 0,
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

export function recordPostMatchPlayerTendencies(
  playerInitialSlots: readonly DeploymentSlot[]
): void {
  if (playerInitialSlots.length === 0) return;
  const mem = loadPlayerTendencies();
  mem.matchesObserved += 1;

  const colToWing = (col: number): WingZone =>
    col <= 2 ? 'LEFT' : col <= 5 ? 'CENTER' : 'RIGHT';

  const flagSlot = playerInitialSlots.find((s) => s.rank === 'FLAG');
  if (flagSlot) {
    mem.flagWingCounts[colToWing(flagSlot.col)] += 1;
  }

  for (const s of playerInitialSlots) {
    if (s.rank === 'GEN_5' || s.rank === 'GEN_4' || s.rank === 'SPY') {
      mem.blitzWingCounts[colToWing(s.col)] += 1;
    }
  }

  try {
    localStorage.setItem(TENDENCY_STORAGE_KEY, JSON.stringify(mem));
  } catch {
    // Ignore storage quota limits
  }
}

export interface CommanderUtilityWeights {
  /** Expectimax ply depth (`2` or `3`) */
  readonly searchDepth: 2 | 3;
  /** Number of determinized world samples per Expectimax evaluation */
  readonly worldSamples: number;
  /** Score noise (`0` = ruthless precision, higher = occasional human inaccuracy) */
  readonly decisionNoise: number;
  /** Forward positional tempo multiplier */
  readonly aggressionWeight: number;
  /** Defensive perimeter & Flag survival priority */
  readonly flagSafetyWeight: number;
  /** Spy protection & sacrificial mid-officer probing synergy */
  readonly spyAssassinWeight: number;
  /** Willingness to sacrifice Captains/Majors to unmask unknown frontline threats */
  readonly probeSacrificeWeight: number;
  /** Early-turn (`T1..T10`) push of 5★/4★/3★ Generals across Row 3 */
  readonly earlySpearheadWeight: number;
  /** Probability/appetite for psychological bluffs (fake Private Flag-sprints & motionless 5★ decoy) */
  readonly bluffRate: number;
  /** Bonus for pairing Spies within escort range of friendly Privates */
  readonly spyPrivateEscortWeight: number;
}

export interface CommanderMissionModifier {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly recommendedEra: AudioEraMode;
  readonly turnPar: number;
}

export interface CommanderStarThresholds {
  readonly threeStarMaxTurns: number;
  readonly twoStarMaxTurns: number;
}

export interface CommanderProfile {
  readonly id: CommanderId;
  readonly tier: number; // 1..6
  readonly fullName: string;
  readonly moniker: string;
  readonly rankAbbrev: string;
  readonly accentHex: string;
  readonly summary: string;
  readonly tacticalBriefing: string;
  readonly theaterId: TheaterId;
  readonly medalName: string;
  readonly portraitUrl: string;
  readonly missionModifier: CommanderMissionModifier;
  readonly starThresholds: CommanderStarThresholds;
  readonly weights: CommanderUtilityWeights;
}

export const COMMANDER_ROSTER: readonly CommanderProfile[] = [
  {
    id: 'MILLER',
    tier: 1,
    fullName: 'Cadet Miller',
    moniker: 'The Textbook',
    rankAbbrev: 'CDT',
    accentHex: '#7cc6fe',
    summary: 'Straightforward frontline probing, balanced defensive Flag cluster, low bluff rate.',
    tacticalBriefing:
      'Miller anchors his Flag behind a textbook twin-Private guard on the center files and advances methodically down Columns C–G.',
    theaterId: 'FIELD_HQ',
    medalName: 'Academy Merit Star',
    portraitUrl: './portraits/miller.webp',
    missionModifier: {
      id: 'TEXTBOOK_DRILL',
      label: 'Cadet Proving Ground',
      description: 'Balanced center lanes with predictable back-row Flag discipline.',
      recommendedEra: '1980s',
      turnPar: 26,
    },
    starThresholds: { threeStarMaxTurns: 20, twoStarMaxTurns: 32 },
    weights: {
      searchDepth: 2,
      worldSamples: 3,
      decisionNoise: 5.4,
      aggressionWeight: 0.9,
      flagSafetyWeight: 1.1,
      spyAssassinWeight: 0.8,
      probeSacrificeWeight: 0.85,
      earlySpearheadWeight: 0.75,
      bluffRate: 0.05,
      spyPrivateEscortWeight: 0.6,
    },
  },
  {
    id: 'MERCER',
    tier: 2,
    fullName: 'Capt. Mercer',
    moniker: 'The Mirage',
    rankAbbrev: 'CPT',
    accentHex: '#5ce1e6',
    summary: 'Fakes wing Flag runs with Privates and hides the real Flag on unorthodox Row-2 squares.',
    tacticalBriefing:
      'Mercer constructs a decoy fortress around a Private on one flank while slipping Privates and Sergeants down the outer rails.',
    theaterId: 'PACIFIC_BRIDGE',
    medalName: 'Mirage Cipher Cross',
    portraitUrl: './portraits/mercer.webp',
    missionModifier: {
      id: 'DECOY_SCREEN',
      label: 'Double-Wing Mirage',
      description: 'Expect aggressive edge-column bluff sprinters and Row-2 Flag concealment.',
      recommendedEra: '1980s',
      turnPar: 30,
    },
    starThresholds: { threeStarMaxTurns: 24, twoStarMaxTurns: 36 },
    weights: {
      searchDepth: 2,
      worldSamples: 5,
      decisionNoise: 3.1,
      aggressionWeight: 1.08,
      flagSafetyWeight: 1.15,
      spyAssassinWeight: 1.15,
      probeSacrificeWeight: 1.0,
      earlySpearheadWeight: 0.95,
      bluffRate: 0.44,
      spyPrivateEscortWeight: 0.85,
    },
  },
  {
    id: 'STERLING',
    tier: 3,
    fullName: 'Maj. Sterling',
    moniker: 'Iron Bastion',
    rankAbbrev: 'MAJ',
    accentHex: '#e5b968',
    summary: 'Builds layered Private + Colonel perimeters around the Flag and grinds attrition splits.',
    tacticalBriefing:
      'Sterling interlocks Privates and Colonels into a tight corner bastion and welcomes equal-rank mutual eliminations.',
    theaterId: 'IRON_BUNKER',
    medalName: 'Iron Bastion Shield',
    portraitUrl: './portraits/sterling.webp',
    missionModifier: {
      id: 'ATTRITION_WALL',
      label: 'Iron Bastion Perimeter',
      description: 'Dense anti-Spy Private screens around the Flag; avoid reckless lone General pushes.',
      recommendedEra: '1970s',
      turnPar: 34,
    },
    starThresholds: { threeStarMaxTurns: 26, twoStarMaxTurns: 40 },
    weights: {
      searchDepth: 2,
      worldSamples: 6,
      decisionNoise: 2.2,
      aggressionWeight: 0.86,
      flagSafetyWeight: 1.65,
      spyAssassinWeight: 1.1,
      probeSacrificeWeight: 0.95,
      earlySpearheadWeight: 0.8,
      bluffRate: 0.16,
      spyPrivateEscortWeight: 1.15,
    },
  },
  {
    id: 'REYES',
    tier: 4,
    fullName: 'Col. Reyes',
    moniker: 'Shadow Dagger',
    rankAbbrev: 'COL',
    accentHex: '#c77dff',
    summary: 'Uses Captains/Majors as sacrificial probes to unmask player Officers for shadowed Spies.',
    tacticalBriefing:
      'Reyes leads with mid-tier Officers directly in front of lurking Spies. Every clash you win on Row 3 paints a target for her Spy counter-strike.',
    theaterId: 'NIGHT_OPS',
    medalName: 'Obsidian Stiletto',
    portraitUrl: './portraits/reyes.webp',
    missionModifier: {
      id: 'SHADOW_OVERWATCH',
      label: 'Overwatch Assassination',
      description: 'Forward Officer probes backed by twin Spy cells waiting on adjacent files.',
      recommendedEra: '1980s',
      turnPar: 34,
    },
    starThresholds: { threeStarMaxTurns: 26, twoStarMaxTurns: 42 },
    weights: {
      searchDepth: 3,
      worldSamples: 7,
      decisionNoise: 1.5,
      aggressionWeight: 1.12,
      flagSafetyWeight: 1.25,
      spyAssassinWeight: 1.75,
      probeSacrificeWeight: 1.55,
      earlySpearheadWeight: 1.0,
      bluffRate: 0.28,
      spyPrivateEscortWeight: 1.35,
    },
  },
  {
    id: 'VANCE',
    tier: 5,
    fullName: 'Gen. Vance',
    moniker: 'Spearhead',
    rankAbbrev: 'GEN',
    accentHex: '#ff6b7a',
    summary: 'High-tempo blitz—pushes 5★, 4★, and 3★ Generals across Row 3 early to collapse space.',
    tacticalBriefing:
      'Vance commits his top three Generals into a narrow armored wedge by Turn 6. Anchor your Spies behind Privates before he reaches Row 5.',
    theaterId: 'IRON_BUNKER',
    medalName: 'Crimson Spearhead Order',
    portraitUrl: './portraits/vance.webp',
    missionModifier: {
      id: 'ARMORED_BLITZ',
      label: 'Heavy Wedge Blitz',
      description: 'Coordinated 5★/4★/3★ forward spearhead punching down central lanes.',
      recommendedEra: '1980s',
      turnPar: 32,
    },
    starThresholds: { threeStarMaxTurns: 24, twoStarMaxTurns: 38 },
    weights: {
      searchDepth: 3,
      worldSamples: 8,
      decisionNoise: 0.95,
      aggressionWeight: 1.48,
      flagSafetyWeight: 1.18,
      spyAssassinWeight: 1.28,
      probeSacrificeWeight: 1.15,
      earlySpearheadWeight: 1.85,
      bluffRate: 0.22,
      spyPrivateEscortWeight: 1.1,
    },
  },
  {
    id: 'HOLLIS',
    tier: 6,
    fullName: 'Marshal Hollis',
    moniker: 'Grand Strategist',
    rankAbbrev: 'MSH',
    accentHex: '#ffd166',
    summary: 'Full Sinkhorn Bayesian memory, Spy-Private escorts, bluff detection & adaptive counter-setups.',
    tacticalBriefing:
      'Hollis adapts to your historical opening wings, baits with a motionless 5★ decoy, and hunts high-entropy threats with escorted Spies.',
    theaterId: 'NIGHT_OPS',
    medalName: 'Sovereign Grand Strategist Star',
    portraitUrl: './portraits/hollis.webp',
    missionModifier: {
      id: 'BAYESIAN_SOVEREIGN',
      label: 'Adaptive Grand Strategy',
      description: '3-ply Information-Set Expectimax with entropy-targeted Spy-Private cells.',
      recommendedEra: '1970s',
      turnPar: 38,
    },
    starThresholds: { threeStarMaxTurns: 28, twoStarMaxTurns: 44 },
    weights: {
      searchDepth: 3,
      worldSamples: 10,
      decisionNoise: 0.2,
      aggressionWeight: 1.24,
      flagSafetyWeight: 1.5,
      spyAssassinWeight: 1.65,
      probeSacrificeWeight: 1.35,
      earlySpearheadWeight: 1.3,
      bluffRate: 0.34,
      spyPrivateEscortWeight: 1.75,
    },
  },
];

export function getCommanderProfile(id: CommanderId): CommanderProfile {
  return COMMANDER_ROSTER.find((c) => c.id === id) ?? COMMANDER_ROSTER[0]!;
}

// -----------------------------------------------------------------------------
// Procedural Commander Deployment Generator (`Rows 0..2`, Randomized Perturbations!)
// -----------------------------------------------------------------------------

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Generates a legal 21-piece Enemy AI deployment on Enemy Home Rows `0..2` (`27` squares, `6` open tactical lanes)
 * tailored to the Commander's doctrine AND perturbed stochastically so no two setups ever repeat!
 */
export function generateCommanderDeployment(
  commanderId: CommanderId,
  tendencies: PlayerTendencyMemory = loadPlayerTendencies(),
  rng: () => number = Math.random
): DeploymentSlot[] {
  const placed = new Map<string, RankId>();
  const remaining: RankId[] = [];
  for (const r of ORDERED_RANKS) {
    for (let k = 0; k < RANK_SPECS[r].countPerArmy; k++) {
      remaining.push(r);
    }
  }

  const takeRank = (target: RankId): boolean => {
    const idx = remaining.indexOf(target);
    if (idx === -1) return false;
    remaining.splice(idx, 1);
    return true;
  };

  const put = (col: number, row: number, rank: RankId): boolean => {
    const c = Math.max(0, Math.min(BOARD_COLS - 1, col));
    const r = Math.max(0, Math.min(2, row));
    const key = `${c},${r}`;
    if (placed.has(key)) return false;
    if (!takeRank(rank)) return false;
    placed.set(key, rank);
    return true;
  };

  const mirror = rng() < 0.5;
  const mapCol = (c: number) => (mirror ? BOARD_COLS - 1 - c : c);

  if (commanderId === 'MILLER') {
    // Textbook: Center-ish back-row Flag (`col 3..5, row 0`) guarded by 2 Privates + balanced frontline
    const flagCol = 3 + Math.floor(rng() * 3);
    put(flagCol, 0, 'FLAG');
    put(Math.max(0, flagCol - 1), 0, 'PRIVATE');
    put(Math.min(8, flagCol + 1), 0, 'PRIVATE');
    put(flagCol, 1, 'COLONEL');
    put(mapCol(2), 2, 'PRIVATE');
    put(mapCol(4), 2, 'PRIVATE');
    put(mapCol(6), 2, 'PRIVATE');
    put(mapCol(3), 1, 'GEN_5');
    put(mapCol(5), 1, 'GEN_4');
    put(mapCol(1), 1, 'SPY');
    put(mapCol(7), 1, 'SPY');
  } else if (commanderId === 'MERCER') {
    // The Mirage: Unorthodox SECOND-ROW real Flag (`row 1`) + heavily guarded fake Private decoy on opposite wing `row 0`!
    const realCol = mapCol(rng() < 0.5 ? 6 : 7);
    put(realCol, 1, 'FLAG'); // Second-row Mirage Flag!
    put(realCol, 2, 'PRIVATE'); // Subtle shield ahead
    // Fake "Fortress" around a Private decoy on opposite corner!
    put(mapCol(1), 0, 'PRIVATE');
    put(mapCol(0), 0, 'PRIVATE');
    put(mapCol(2), 0, 'PRIVATE');
    put(mapCol(1), 1, 'LT_COLONEL');
    // Edge-file bluff sprinters + flanking Spies
    put(mapCol(0), 2, 'PRIVATE');
    put(mapCol(8), 2, 'SERGEANT');
    put(mapCol(3), 2, 'GEN_5');
    put(mapCol(5), 2, 'SPY');
    put(mapCol(2), 2, 'SPY');
  } else if (commanderId === 'STERLING') {
    // Iron Bastion: Layered Private + Colonel + Lt. Colonel perimeter around fortified corner Flag!
    const corner = mapCol(rng() < 0.5 ? 1 : 2);
    put(corner, 0, 'FLAG');
    put(corner - (mirror ? -1 : 1), 0, 'PRIVATE');
    put(corner + (mirror ? -1 : 1), 0, 'PRIVATE');
    put(corner, 1, 'PRIVATE');
    put(mapCol(3), 1, 'COLONEL');
    put(mapCol(4), 1, 'LT_COLONEL');
    put(mapCol(2), 2, 'PRIVATE');
    put(mapCol(5), 2, 'GEN_5');
    put(mapCol(6), 2, 'GEN_4');
    put(mapCol(4), 2, 'SPY');
    put(mapCol(7), 1, 'SPY');
  } else if (commanderId === 'REYES') {
    // Shadow Dagger: Mid-rank Captain/Major/1st-Lt sacrificial probes on Row 2 with twin Spies directly shadowing on Row 1!
    const fCol = mapCol(1 + Math.floor(rng() * 2));
    put(fCol, 0, 'FLAG');
    put(Math.max(0, fCol - 1), 0, 'PRIVATE');
    put(Math.min(8, fCol + 1), 0, 'PRIVATE');

    const laneA = 2 + Math.floor(rng() * 2);
    const laneB = 5 + Math.floor(rng() * 2);
    put(laneA, 2, 'CAPTAIN');
    put(laneA, 1, 'SPY'); // Shadowed Spy #1!
    put(laneB, 2, 'MAJOR');
    put(laneB, 1, 'SPY'); // Shadowed Spy #2!
    put(4, 2, 'LT_1ST');
    put(4, 1, 'GEN_5');
    put(mapCol(7), 2, 'GEN_4');
  } else if (commanderId === 'VANCE') {
    // Spearhead: High-tempo blitz — 5★, 4★, and 3★ Generals poised on Frontline Row 2 to storm Row 3 immediately!
    const fCol = mapCol(7);
    put(fCol, 0, 'FLAG');
    put(mapCol(6), 0, 'PRIVATE');
    put(mapCol(8), 0, 'PRIVATE');
    put(fCol, 1, 'PRIVATE');

    const blitzCols = shuffleInPlace([2, 3, 4, 5, 6], rng);
    put(blitzCols[0]!, 2, 'GEN_5');
    put(blitzCols[1]!, 2, 'GEN_4');
    put(blitzCols[2]!, 2, 'GEN_3');
    put(blitzCols[3]!, 2, 'SPY');
    put(blitzCols[4]!, 2, 'COLONEL');
    put(blitzCols[0]!, 1, 'SPY');
  } else {
    // Marshal Hollis ("Grand Strategist"):
    // 1. Reads historical Player Blitz/Flag tendencies to position Flag on safest wing & aim Spy-Private Escort Pairs at player's favored high-officer wing!
    // 2. Parks `GEN_5` on `Row 0` as a motionless "Fake Flag" trap!
    const bCounts = tendencies.blitzWingCounts;
    const playerFavBlitz: WingZone =
      bCounts.LEFT >= bCounts.CENTER && bCounts.LEFT >= bCounts.RIGHT
        ? 'LEFT'
        : bCounts.RIGHT >= bCounts.CENTER
          ? 'RIGHT'
          : 'CENTER';

    // Place Hollis's real Flag away from player's heaviest blitz wing
    const safeFlagCols =
      playerFavBlitz === 'LEFT' ? [6, 7] : playerFavBlitz === 'RIGHT' ? [1, 2] : rng() < 0.5 ? [1, 2] : [6, 7];
    const hFlagCol = safeFlagCols[Math.floor(rng() * safeFlagCols.length)]!;
    put(hFlagCol, 0, 'FLAG');
    put(Math.max(0, hFlagCol - 1), 0, 'PRIVATE');
    put(Math.min(8, hFlagCol + 1), 0, 'PRIVATE');

    // Park 5-Star General on Row 0 opposite the real Flag as a motionless "Flag Bluff" ambush!
    const decoyFlagCol = hFlagCol <= 3 ? 7 : 1;
    put(decoyFlagCol, 0, 'GEN_5');

    // Aim Spy + Private Escort Pair #1 directly into player's favored blitz wing!
    const hunterCol =
      playerFavBlitz === 'LEFT' ? 1 : playerFavBlitz === 'RIGHT' ? 7 : 4;
    put(hunterCol, 1, 'SPY');
    put(hunterCol, 2, 'PRIVATE'); // Private escort shields Spy from enemy Privates!

    // Spy + Private Escort Pair #2 on central/flank axis
    const secondSpyCol = hunterCol === 4 ? (rng() < 0.5 ? 2 : 6) : 4;
    put(secondSpyCol, 1, 'SPY');
    put(secondSpyCol, 2, 'PRIVATE');

    put(3, 2, 'GEN_4');
    put(5, 2, 'GEN_3');
  }

  // Distribute remaining pieces across random available Enemy Home Squares (`Rows 0..2`), leaving 6 vacant lanes!
  const allCoords: Array<{ col: number; row: number }> = [];
  for (let r = 0; r <= 2; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (!placed.has(`${c},${r}`)) {
        allCoords.push({ col: c, row: r });
      }
    }
  }
  shuffleInPlace(allCoords, rng);
  shuffleInPlace(remaining, rng);

  for (let i = 0; i < remaining.length && i < allCoords.length; i++) {
    const sq = allCoords[i]!;
    placed.set(`${sq.col},${sq.row}`, remaining[i]!);
  }

  const result: DeploymentSlot[] = [];
  for (const [key, rank] of placed.entries()) {
    const [cStr, rStr] = key.split(',');
    result.push({ col: Number(cStr), row: Number(rStr), rank });
  }
  return result;
}

// -----------------------------------------------------------------------------
// Persistent 6-Tier Campaign Progression (`war_generals_campaign_v2`)
// -----------------------------------------------------------------------------

export interface CommanderCampaignRecord {
  wins: number;
  losses: number;
  bestTurns: number | null;
  medalEarned: boolean;
  stars: number; // 0..3
}

export interface CampaignProgressState {
  unlockedTier: number; // 1..6
  totalWins: number;
  totalLosses: number;
  records: Record<CommanderId, CommanderCampaignRecord>;
}

function createDefaultCampaignState(): CampaignProgressState {
  return {
    unlockedTier: 1,
    totalWins: 0,
    totalLosses: 0,
    records: {
      MILLER: { wins: 0, losses: 0, bestTurns: null, medalEarned: false, stars: 0 },
      MERCER: { wins: 0, losses: 0, bestTurns: null, medalEarned: false, stars: 0 },
      STERLING: { wins: 0, losses: 0, bestTurns: null, medalEarned: false, stars: 0 },
      REYES: { wins: 0, losses: 0, bestTurns: null, medalEarned: false, stars: 0 },
      VANCE: { wins: 0, losses: 0, bestTurns: null, medalEarned: false, stars: 0 },
      HOLLIS: { wins: 0, losses: 0, bestTurns: null, medalEarned: false, stars: 0 },
    },
  };
}

export function loadCampaignProgress(): CampaignProgressState {
  const fallback = createDefaultCampaignState();
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(CAMPAIGN_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CampaignProgressState>;
    if (typeof parsed.unlockedTier === 'number') {
      fallback.unlockedTier = Math.max(1, Math.min(6, Math.floor(parsed.unlockedTier)));
    }
    if (typeof parsed.totalWins === 'number') fallback.totalWins = Math.max(0, parsed.totalWins);
    if (typeof parsed.totalLosses === 'number') fallback.totalLosses = Math.max(0, parsed.totalLosses);
    if (parsed.records && typeof parsed.records === 'object') {
      for (const c of COMMANDER_ROSTER) {
        const rec = parsed.records[c.id];
        if (rec) {
          const rawStars = Number(rec.stars);
          const stars = Number.isFinite(rawStars)
            ? Math.max(0, Math.min(3, Math.floor(rawStars)))
            : rec.medalEarned
              ? 1
              : 0;
          fallback.records[c.id] = {
            wins: Math.max(0, Number(rec.wins) || 0),
            losses: Math.max(0, Number(rec.losses) || 0),
            bestTurns: typeof rec.bestTurns === 'number' ? rec.bestTurns : null,
            medalEarned: Boolean(rec.medalEarned),
            stars,
          };
        }
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function recordCampaignMatchResult(
  commanderId: CommanderId,
  playerWon: boolean,
  turnsElapsed: number
): { state: CampaignProgressState; newlyEarnedMedal: string | null; starsEarned: 0 | 1 | 2 | 3 } {
  const state = loadCampaignProgress();
  const profile = getCommanderProfile(commanderId);
  const rec = state.records[commanderId];
  let newlyEarnedMedal: string | null = null;
  let starsEarned: 0 | 1 | 2 | 3 = 0;

  if (playerWon) {
    state.totalWins += 1;
    rec.wins += 1;
    rec.bestTurns = rec.bestTurns === null ? turnsElapsed : Math.min(rec.bestTurns, turnsElapsed);
    starsEarned =
      turnsElapsed <= profile.starThresholds.threeStarMaxTurns
        ? 3
        : turnsElapsed <= profile.starThresholds.twoStarMaxTurns
          ? 2
          : 1;
    rec.stars = Math.max(rec.stars, starsEarned);
    if (!rec.medalEarned) {
      rec.medalEarned = true;
      newlyEarnedMedal = profile.medalName;
    }
    if (profile.tier >= state.unlockedTier && state.unlockedTier < 6) {
      state.unlockedTier = profile.tier + 1;
    }
  } else {
    state.totalLosses += 1;
    rec.losses += 1;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage quota restrictions
  }
  return { state, newlyEarnedMedal, starsEarned };
}
