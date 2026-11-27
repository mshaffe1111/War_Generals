export type Faction = 'PLAYER' | 'ENEMY';

export type RankId =
  | 'GEN_5'
  | 'GEN_4'
  | 'GEN_3'
  | 'GEN_2'
  | 'GEN_1'
  | 'COLONEL'
  | 'LT_COLONEL'
  | 'MAJOR'
  | 'CAPTAIN'
  | 'LT_1ST'
  | 'LT_2ND'
  | 'SERGEANT'
  | 'PRIVATE'
  | 'SPY'
  | 'FLAG';

export type EmblemMetal = 'BRASS' | 'SILVER';

export interface RankSpec {
  readonly id: RankId;
  readonly name: string;
  readonly shortLabel: string;
  readonly metal: EmblemMetal;
  /** Numeric seniority for standard officer/enlisted comparison (14 highest .. 2 Private, 0 special) */
  readonly seniority: number;
  readonly countPerArmy: number;
  readonly tacticalRule: string;
}

export const RANK_SPECS: Readonly<Record<RankId, RankSpec>> = {
  GEN_5: {
    id: 'GEN_5',
    name: '5-Star General',
    shortLabel: '5★ GEN',
    metal: 'BRASS',
    seniority: 14,
    countPerArmy: 1,
    tacticalRule: 'Outranks all officers & Privates • Vulnerable only to Spy',
  },
  GEN_4: {
    id: 'GEN_4',
    name: '4-Star General',
    shortLabel: '4★ GEN',
    metal: 'BRASS',
    seniority: 13,
    countPerArmy: 1,
    tacticalRule: 'Outranks 3★ & below • Vulnerable to 5★ & Spy',
  },
  GEN_3: {
    id: 'GEN_3',
    name: '3-Star General',
    shortLabel: '3★ GEN',
    metal: 'BRASS',
    seniority: 12,
    countPerArmy: 1,
    tacticalRule: 'Outranks 2★ & below • Vulnerable to 4★–5★ & Spy',
  },
  GEN_2: {
    id: 'GEN_2',
    name: '2-Star General',
    shortLabel: '2★ GEN',
    metal: 'BRASS',
    seniority: 11,
    countPerArmy: 1,
    tacticalRule: 'Outranks 1★ & below • Vulnerable to 3★–5★ & Spy',
  },
  GEN_1: {
    id: 'GEN_1',
    name: '1-Star General',
    shortLabel: '1★ GEN',
    metal: 'BRASS',
    seniority: 10,
    countPerArmy: 1,
    tacticalRule: 'Outranks Colonel & below • Vulnerable to 2★–5★ & Spy',
  },
  COLONEL: {
    id: 'COLONEL',
    name: 'Colonel',
    shortLabel: 'COLONEL',
    metal: 'SILVER',
    seniority: 9,
    countPerArmy: 1,
    tacticalRule: 'Outranks Lt. Colonel & below • Vulnerable to Generals & Spy',
  },
  LT_COLONEL: {
    id: 'LT_COLONEL',
    name: 'Lt. Colonel',
    shortLabel: 'LT. COL',
    metal: 'SILVER',
    seniority: 8,
    countPerArmy: 1,
    tacticalRule: 'Outranks Major & below • Vulnerable to Colonel+ & Spy',
  },
  MAJOR: {
    id: 'MAJOR',
    name: 'Major',
    shortLabel: 'MAJOR',
    metal: 'BRASS',
    seniority: 7,
    countPerArmy: 1,
    tacticalRule: 'Outranks Captain & below • Vulnerable to Lt. Col+ & Spy',
  },
  CAPTAIN: {
    id: 'CAPTAIN',
    name: 'Captain',
    shortLabel: 'CAPTAIN',
    metal: 'SILVER',
    seniority: 6,
    countPerArmy: 1,
    tacticalRule: 'Outranks 1st Lt. & below • Vulnerable to Major+ & Spy',
  },
  LT_1ST: {
    id: 'LT_1ST',
    name: '1st Lieutenant',
    shortLabel: '1ST LT',
    metal: 'SILVER',
    seniority: 5,
    countPerArmy: 1,
    tacticalRule: 'Outranks 2nd Lt. & below • Vulnerable to Captain+ & Spy',
  },
  LT_2ND: {
    id: 'LT_2ND',
    name: '2nd Lieutenant',
    shortLabel: '2ND LT',
    metal: 'BRASS',
    seniority: 4,
    countPerArmy: 1,
    tacticalRule: 'Outranks Sergeant & Private • Vulnerable to 1st Lt.+ & Spy',
  },
  SERGEANT: {
    id: 'SERGEANT',
    name: 'Sergeant',
    shortLabel: 'SERGEANT',
    metal: 'BRASS',
    seniority: 3,
    countPerArmy: 1,
    tacticalRule: 'Outranks Private • Vulnerable to 2nd Lt.+ & Spy',
  },
  PRIVATE: {
    id: 'PRIVATE',
    name: 'Private',
    shortLabel: 'PRIVATE',
    metal: 'BRASS',
    seniority: 2,
    countPerArmy: 6,
    tacticalRule: 'Eliminates enemy Spy & Flag • Outranked by all Officers',
  },
  SPY: {
    id: 'SPY',
    name: 'Spy',
    shortLabel: 'SPY',
    metal: 'BRASS',
    seniority: 0,
    countPerArmy: 2,
    tacticalRule: 'Eliminates all Officers (Sgt–5★) & Flag • Eliminated ONLY by Private',
  },
  FLAG: {
    id: 'FLAG',
    name: 'Flag',
    shortLabel: 'FLAG',
    metal: 'BRASS',
    seniority: 0,
    countPerArmy: 1,
    tacticalRule: 'Command Objective • Captures defending Flag if attacking; lost to all others',
  },
};

export const ORDERED_RANKS: readonly RankId[] = [
  'GEN_5',
  'GEN_4',
  'GEN_3',
  'GEN_2',
  'GEN_1',
  'COLONEL',
  'LT_COLONEL',
  'MAJOR',
  'CAPTAIN',
  'LT_1ST',
  'LT_2ND',
  'SERGEANT',
  'PRIVATE',
  'SPY',
  'FLAG',
];

export const BOARD_COLS = 9;
export const BOARD_ROWS = 8;

export function buildStandardArmyRoster(): RankId[] {
  const roster: RankId[] = [];
  for (const rankId of ORDERED_RANKS) {
    const count = RANK_SPECS[rankId].countPerArmy;
    for (let i = 0; i < count; i++) {
      roster.push(rankId);
    }
  }
  return roster;
}
