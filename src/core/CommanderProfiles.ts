import type { DeploymentPresetId } from './types';

export type CommanderId =
  | 'REYES'
  | 'KORSOVA'
  | 'VANCE'
  | 'TAKAHASHI'
  | 'OCKHAM'
  | 'VALERIUS';

export interface CommanderProfile {
  readonly id: CommanderId;
  readonly tier: number; // 1..6
  readonly callsign: string;
  readonly fullName: string;
  readonly rankTitle: string;
  readonly doctrineName: string;
  readonly summary: string;
  readonly medalName: string;
  readonly preferredPreset: DeploymentPresetId;
  /** Decision score noise: higher = more human mistakes (Tier 1), near-zero = ruthless precision (Tier 6) */
  readonly decisionJitter: number;
  /** Forward vanguard aggression multiplier */
  readonly aggressionBias: number;
  /** Appetite for hunting multi-kill veteran threats with Spies & 5-Star Generals */
  readonly spyHuntWeight: number;
}

export const COMMANDER_ROSTER: readonly CommanderProfile[] = [
  {
    id: 'REYES',
    tier: 1,
    callsign: 'VANGUARD-1',
    fullName: 'Lt. Col. Mateo Reyes',
    rankTitle: '1st Recon Battalion',
    doctrineName: 'Scout & Probe',
    summary: 'Leads with cautious Private recon lines; occasionally telegraphs high officers.',
    medalName: 'Bronze Recon Star',
    preferredPreset: 'VACCINATION',
    decisionJitter: 7.5,
    aggressionBias: 0.85,
    spyHuntWeight: 0.7,
  },
  {
    id: 'KORSOVA',
    tier: 2,
    callsign: 'IRON-SPEAR',
    fullName: 'Col. Elena Korsova',
    rankTitle: 'Armored Shock Brigade',
    doctrineName: 'Frontline Blitz',
    summary: 'Drives 5★ and 4★ Generals straight down center lanes to crush early defenses.',
    medalName: 'Iron Spear Cross',
    preferredPreset: 'IRON_BLITZ',
    decisionJitter: 5.2,
    aggressionBias: 1.35,
    spyHuntWeight: 0.9,
  },
  {
    id: 'VANCE',
    tier: 3,
    callsign: 'MIRAGE-ZERO',
    fullName: 'Brig. Gen. Julian Vance',
    rankTitle: 'Covert Intelligence Wing',
    doctrineName: 'Deception & Spies',
    summary: 'Plants heavily guarded decoy Privates while flanking officers with twin Spies.',
    medalName: 'Obsidian Dagger',
    preferredPreset: 'MIRAGE_DECOY',
    decisionJitter: 3.8,
    aggressionBias: 1.05,
    spyHuntWeight: 1.45,
  },
  {
    id: 'TAKAHASHI',
    tier: 4,
    callsign: 'AEGIS-9',
    fullName: 'Maj. Gen. Kenji Takahashi',
    rankTitle: 'Eastern Bastion Command',
    doctrineName: 'Mothership Bastion',
    summary: 'Rings the Flag with anti-Spy Privates and punishes overextended attackers.',
    medalName: 'Imperial Aegis Crest',
    preferredPreset: 'MOTHERSHIP',
    decisionJitter: 2.6,
    aggressionBias: 0.95,
    spyHuntWeight: 1.25,
  },
  {
    id: 'OCKHAM',
    tier: 5,
    callsign: 'SIGMA-EYE',
    fullName: 'Lt. Gen. Claire Ockham',
    rankTitle: 'War-Room Analytics',
    doctrineName: 'Bayesian Elimination',
    summary: 'Tracks every clash survivor mathematically and isolates unmoved back-row Flag suspects.',
    medalName: 'Silver Arbiter Laurels',
    preferredPreset: 'VACCINATION',
    decisionJitter: 1.35,
    aggressionBias: 1.18,
    spyHuntWeight: 1.55,
  },
  {
    id: 'VALERIUS',
    tier: 6,
    callsign: 'SOVEREIGN',
    fullName: 'Marshal Aurelius Valerius',
    rankTitle: 'Supreme High Command',
    doctrineName: 'Grandmaster Synthesis',
    summary: 'Adapts tournament formations with near-zero tactical error and ruthless Flag breakthroughs.',
    medalName: 'Sovereign Gold Medallion',
    preferredPreset: 'IRON_BLITZ',
    decisionJitter: 0.45,
    aggressionBias: 1.28,
    spyHuntWeight: 1.75,
  },
];

export function getCommanderProfile(id: CommanderId): CommanderProfile {
  return COMMANDER_ROSTER.find((c) => c.id === id) ?? COMMANDER_ROSTER[0]!;
}

export interface CommanderCampaignRecord {
  wins: number;
  losses: number;
  bestTurns: number | null;
  medalEarned: boolean;
}

export interface CampaignProgressState {
  unlockedTier: number; // 1..6
  totalWins: number;
  totalLosses: number;
  records: Record<CommanderId, CommanderCampaignRecord>;
}

const CAMPAIGN_STORAGE_KEY = 'war_generals_campaign_v1';

function createDefaultCampaignState(): CampaignProgressState {
  return {
    unlockedTier: 1,
    totalWins: 0,
    totalLosses: 0,
    records: {
      REYES: { wins: 0, losses: 0, bestTurns: null, medalEarned: false },
      KORSOVA: { wins: 0, losses: 0, bestTurns: null, medalEarned: false },
      VANCE: { wins: 0, losses: 0, bestTurns: null, medalEarned: false },
      TAKAHASHI: { wins: 0, losses: 0, bestTurns: null, medalEarned: false },
      OCKHAM: { wins: 0, losses: 0, bestTurns: null, medalEarned: false },
      VALERIUS: { wins: 0, losses: 0, bestTurns: null, medalEarned: false },
    },
  };
}

export function loadCampaignProgress(): CampaignProgressState {
  const fallback = createDefaultCampaignState();
  try {
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
          fallback.records[c.id] = {
            wins: Math.max(0, Number(rec.wins) || 0),
            losses: Math.max(0, Number(rec.losses) || 0),
            bestTurns: typeof rec.bestTurns === 'number' ? rec.bestTurns : null,
            medalEarned: Boolean(rec.medalEarned),
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
): { state: CampaignProgressState; newlyEarnedMedal: string | null } {
  const state = loadCampaignProgress();
  const profile = getCommanderProfile(commanderId);
  const rec = state.records[commanderId];
  let newlyEarnedMedal: string | null = null;

  if (playerWon) {
    state.totalWins += 1;
    rec.wins += 1;
    rec.bestTurns = rec.bestTurns === null ? turnsElapsed : Math.min(rec.bestTurns, turnsElapsed);
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
    localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota restrictions
  }
  return { state, newlyEarnedMedal };
}
