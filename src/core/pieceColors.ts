export type PieceColorId = 'NAVY' | 'GREY' | 'BROWN' | 'GREEN' | 'LIGHT_BLUE';
export type EnemyPieceColorId = 'CRIMSON' | PieceColorId;

export interface PieceColorFinishSpec {
  readonly albedoHex: string;
  readonly insetHex: string;
  readonly sheenHex: string;
  readonly roughness: number;
  readonly clearcoat: number;
}

export interface PieceColorSpec {
  readonly id: EnemyPieceColorId;
  readonly label: string;
  readonly shortLabel: string;
  readonly upperLabel: string;
  readonly swatchHex: string;
  readonly swatchHighlightHex: string;
  readonly metalness: number;
  readonly envMapIntensity: number;
  readonly walnut: PieceColorFinishSpec;
  readonly bakelite: PieceColorFinishSpec;
}

export const PIECE_COLOR_ORDER: readonly PieceColorId[] = [
  'NAVY',
  'GREY',
  'BROWN',
  'GREEN',
  'LIGHT_BLUE',
];

export const PIECE_COLOR_SPECS: Readonly<Record<EnemyPieceColorId, PieceColorSpec>> = {
  NAVY: {
    id: 'NAVY',
    label: 'Navy',
    shortLabel: 'Navy',
    upperLabel: 'NAVY',
    swatchHex: '#1a3b70',
    swatchHighlightHex: '#4f84db',
    metalness: 0.08,
    envMapIntensity: 0.2,
    walnut: {
      albedoHex: '#132A52',
      insetHex: '#081328',
      sheenHex: '#3b72bf',
      roughness: 0.38,
      clearcoat: 0.18,
    },
    bakelite: {
      albedoHex: '#1546a6',
      insetHex: '#091f4d',
      sheenHex: '#4c8aff',
      roughness: 0.26,
      clearcoat: 0.52,
    },
  },
  GREY: {
    id: 'GREY',
    label: 'Grey',
    shortLabel: 'Grey',
    upperLabel: 'GREY',
    swatchHex: '#5c6674',
    swatchHighlightHex: '#9aa8ba',
    metalness: 0.32,
    envMapIntensity: 0.26,
    walnut: {
      albedoHex: '#5C6674',
      insetHex: '#2B323C',
      sheenHex: '#9aa8ba',
      roughness: 0.36,
      clearcoat: 0.22,
    },
    bakelite: {
      albedoHex: '#6E7B8C',
      insetHex: '#333C48',
      sheenHex: '#9aa8ba',
      roughness: 0.24,
      clearcoat: 0.54,
    },
  },
  BROWN: {
    id: 'BROWN',
    label: 'Brown',
    shortLabel: 'Brown',
    upperLabel: 'BROWN',
    swatchHex: '#6e4427',
    swatchHighlightHex: '#b2764e',
    metalness: 0.06,
    envMapIntensity: 0.2,
    walnut: {
      albedoHex: '#5A331E',
      insetHex: '#2B150B',
      sheenHex: '#9c5d38',
      roughness: 0.38,
      clearcoat: 0.24,
    },
    bakelite: {
      albedoHex: '#7A4224',
      insetHex: '#381B0E',
      sheenHex: '#9c5d38',
      roughness: 0.24,
      clearcoat: 0.58,
    },
  },
  GREEN: {
    id: 'GREEN',
    label: 'Green',
    shortLabel: 'Green',
    upperLabel: 'GREEN',
    swatchHex: '#3d5c35',
    swatchHighlightHex: '#6ba25d',
    metalness: 0.08,
    envMapIntensity: 0.2,
    walnut: {
      albedoHex: '#2A4A28',
      insetHex: '#142513',
      sheenHex: '#5ea052',
      roughness: 0.4,
      clearcoat: 0.16,
    },
    bakelite: {
      albedoHex: '#336230',
      insetHex: '#183017',
      sheenHex: '#5ea052',
      roughness: 0.26,
      clearcoat: 0.5,
    },
  },
  LIGHT_BLUE: {
    id: 'LIGHT_BLUE',
    label: 'Light Blue',
    shortLabel: 'Sky',
    upperLabel: 'LIGHT BLUE',
    swatchHex: '#4186bd',
    swatchHighlightHex: '#88cbfa',
    metalness: 0.1,
    envMapIntensity: 0.22,
    walnut: {
      albedoHex: '#3678A8',
      insetHex: '#183B58',
      sheenHex: '#7ec8ff',
      roughness: 0.35,
      clearcoat: 0.24,
    },
    bakelite: {
      albedoHex: '#4192CC',
      insetHex: '#1D486C',
      sheenHex: '#7ec8ff',
      roughness: 0.24,
      clearcoat: 0.54,
    },
  },
  CRIMSON: {
    id: 'CRIMSON',
    label: 'Crimson',
    shortLabel: 'Crimson',
    upperLabel: 'CRIMSON',
    swatchHex: '#8f1c2e',
    swatchHighlightHex: '#d64e64',
    metalness: 0.08,
    envMapIntensity: 0.2,
    walnut: {
      albedoHex: '#661524',
      insetHex: '#2B070E',
      sheenHex: '#b03248',
      roughness: 0.38,
      clearcoat: 0.18,
    },
    bakelite: {
      albedoHex: '#9e192a',
      insetHex: '#380812',
      sheenHex: '#b03248',
      roughness: 0.26,
      clearcoat: 0.52,
    },
  },
};
