import { PIECE_COLOR_ORDER } from '../core/pieceColors';
import type {
  AppOptions,
  ArbiterSpeedMode,
  AudioEraMode,
  BoardFinishMode,
  BoardViewAngle,
  ClockPresetMode,
  DifficultyTier,
  HandednessMode,
  PieceColorId,
  QualityTier,
  RenderQualityMode,
  TheaterId,
  ViewportFrameMode,
} from '../core/types';

const SETTINGS_STORAGE_KEY = 'war_generals_settings_v1';

export interface ClockPresetTimings {
  readonly isUntimed: boolean;
  readonly matchSec: number;
  readonly turnSec: number;
  readonly label: string;
}

export const CLOCK_PRESET_SPECS: Readonly<Record<ClockPresetMode, ClockPresetTimings>> = {
  BLITZ: {
    isUntimed: false,
    matchSec: 300, // 05:00
    turnSec: 20, // 00:20
    label: 'Blitz (5m / 20s)',
  },
  STANDARD: {
    isUntimed: false,
    matchSec: 600, // 10:00
    turnSec: 45, // 00:45
    label: 'Standard (10m / 45s)',
  },
  UNTIMED: {
    isUntimed: true,
    matchSec: 0,
    turnSec: 0,
    label: 'Untimed Casual',
  },
};

export const DEFAULT_APP_OPTIONS: Readonly<AppOptions> = {
  audioMuted: false,
  masterVolume: 0.9,
  musicVolume: 0.85,
  sfxVolume: 0.95,
  ambianceVolume: 0.75,
  hapticsEnabled: true,
  eraMode: '1980s', // 1980s Electronic Edition default per Block 7 §1.B
  boardFinish: 'WALNUT_SLATE',
  pieceColor: 'NAVY',
  difficulty: 'GENERAL',
  handedness: 'RIGHT',
  arbiterSpeed: 'THEATRICAL',
  clockPreset: 'STANDARD',
  renderQuality: 'ULTRA',
  qualityMode: 'AUTO',
  viewportFrameMode: 'FULL_VIEWPORT',
  theaterId: 'FIELD_HQ',
  cameraSensitivity: 1.0,
  cameraInvertOrbit: false,
  boardView: 'COMMAND',
};

function isOneOf<T extends string>(val: unknown, allowed: readonly T[]): val is T {
  return typeof val === 'string' && (allowed as readonly string[]).includes(val);
}

function clampUnit(val: unknown, fallback: number): number {
  if (typeof val !== 'number' || Number.isNaN(val)) return fallback;
  return Math.max(0, Math.min(1, val));
}

function clampRange(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || Number.isNaN(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

/**
 * Persistent `localStorage` Settings & Era Ruleset Store (`src/state/SettingsStore.ts`).
 * Manages Era Edition (`1970s Classic` vs `1980s Electronic`), Board Finish (`Walnut & Slate` vs `1980 Bakelite`),
 * 4 Non-Cheating Difficulty Tiers, Handedness (`Right` / `Left`), Battle Pacing (`4.0s` / `1.6s`),
 * Match/Turn Clocks (`Blitz`, `Standard`, `Untimed`), Graphics/Battery Saver (`Ultra 60FPS` / `Battery 30FPS`),
 * and 4-Bus + Master WebAudio & Haptics.
 */
export class SettingsStore {
  private current: AppOptions;
  private readonly listeners = new Set<(opts: Readonly<AppOptions>) => void>();

  constructor() {
    this.current = this.loadFromStorage();
  }

  public get(): Readonly<AppOptions> {
    return { ...this.current };
  }

  public update(patch: Partial<AppOptions>): Readonly<AppOptions> {
    let nextRenderQuality = patch.renderQuality ?? this.current.renderQuality;
    let nextQualityMode = patch.qualityMode ?? this.current.qualityMode;

    if (patch.qualityMode !== undefined && patch.renderQuality === undefined) {
      nextRenderQuality = patch.qualityMode === 'BATTERY_SAVER' ? 'BATTERY_SAVER' : 'ULTRA';
    } else if (patch.renderQuality !== undefined && patch.qualityMode === undefined) {
      nextQualityMode = patch.renderQuality === 'BATTERY_SAVER' ? 'BATTERY_SAVER' : 'ULTRA';
    }

    this.current = {
      ...this.current,
      ...patch,
      renderQuality: nextRenderQuality,
      qualityMode: nextQualityMode,
      cameraSensitivity:
        patch.cameraSensitivity !== undefined
          ? clampRange(patch.cameraSensitivity, 0.4, 2.0, this.current.cameraSensitivity)
          : this.current.cameraSensitivity,
      masterVolume:
        patch.masterVolume !== undefined
          ? clampUnit(patch.masterVolume, this.current.masterVolume)
          : this.current.masterVolume,
      musicVolume:
        patch.musicVolume !== undefined
          ? clampUnit(patch.musicVolume, this.current.musicVolume)
          : this.current.musicVolume,
      sfxVolume:
        patch.sfxVolume !== undefined
          ? clampUnit(patch.sfxVolume, this.current.sfxVolume)
          : this.current.sfxVolume,
      ambianceVolume:
        patch.ambianceVolume !== undefined
          ? clampUnit(patch.ambianceVolume, this.current.ambianceVolume)
          : this.current.ambianceVolume,
    };
    this.saveToStorage(this.current);
    const snapshot = this.get();
    for (const fn of this.listeners) {
      fn(snapshot);
    }
    return snapshot;
  }

  public subscribe(listener: (opts: Readonly<AppOptions>) => void): () => void {
    this.listeners.add(listener);
    listener(this.get());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private loadFromStorage(): AppOptions {
    const base = { ...DEFAULT_APP_OPTIONS };
    try {
      if (typeof localStorage === 'undefined') return base;
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return base;
      const p = JSON.parse(raw) as Record<string, unknown>;

      if (typeof p['audioMuted'] === 'boolean') base.audioMuted = p['audioMuted'];
      base.masterVolume = clampUnit(p['masterVolume'], base.masterVolume);
      base.musicVolume = clampUnit(p['musicVolume'], base.musicVolume);
      base.sfxVolume = clampUnit(p['sfxVolume'], base.sfxVolume);
      base.ambianceVolume = clampUnit(p['ambianceVolume'], base.ambianceVolume);
      if (typeof p['hapticsEnabled'] === 'boolean') base.hapticsEnabled = p['hapticsEnabled'];

      if (isOneOf<AudioEraMode>(p['eraMode'], ['1980s', '1970s'])) {
        base.eraMode = p['eraMode'];
      }
      if (isOneOf<BoardFinishMode>(p['boardFinish'], ['WALNUT_SLATE', 'RETRO_BAKELITE'])) {
        base.boardFinish = p['boardFinish'];
      }
      if (isOneOf<PieceColorId>(p['pieceColor'], PIECE_COLOR_ORDER)) {
        base.pieceColor = p['pieceColor'];
      }
      if (
        isOneOf<DifficultyTier>(p['difficulty'], [
          'RECRUIT',
          'OFFICER',
          'GENERAL',
          'SUPREME_MARSHAL',
        ])
      ) {
        base.difficulty = p['difficulty'];
      }
      if (isOneOf<HandednessMode>(p['handedness'], ['RIGHT', 'LEFT'])) {
        base.handedness = p['handedness'];
      }
      if (isOneOf<ArbiterSpeedMode>(p['arbiterSpeed'], ['THEATRICAL', 'TACTICAL_FAST'])) {
        base.arbiterSpeed = p['arbiterSpeed'];
      } else if (p['arbiterSpeed'] === '1.75x') {
        base.arbiterSpeed = 'TACTICAL_FAST';
      }
      if (isOneOf<ClockPresetMode>(p['clockPreset'], ['BLITZ', 'STANDARD', 'UNTIMED'])) {
        base.clockPreset = p['clockPreset'];
      }
      if (isOneOf<RenderQualityMode>(p['renderQuality'], ['ULTRA', 'BATTERY_SAVER'])) {
        base.renderQuality = p['renderQuality'];
      } else if (p['renderQuality'] === 'BALANCED') {
        base.renderQuality = 'BATTERY_SAVER';
      }
      if (
        isOneOf<QualityTier>(p['qualityMode'], [
          'AUTO',
          'ULTRA',
          'HIGH',
          'BALANCED',
          'BATTERY_SAVER',
        ])
      ) {
        base.qualityMode = p['qualityMode'];
        if (base.qualityMode === 'BATTERY_SAVER') {
          base.renderQuality = 'BATTERY_SAVER';
        }
      } else if (base.renderQuality === 'BATTERY_SAVER') {
        base.qualityMode = 'BATTERY_SAVER';
      }
      if (isOneOf<ViewportFrameMode>(p['viewportFrameMode'], ['FULL_VIEWPORT', 'PHONE_9_16'])) {
        base.viewportFrameMode = p['viewportFrameMode'];
      }
      if (
        isOneOf<TheaterId>(p['theaterId'], [
          'FIELD_HQ',
          'PACIFIC_BRIDGE',
          'IRON_BUNKER',
          'NIGHT_OPS',
        ])
      ) {
        base.theaterId = p['theaterId'];
      }
      base.cameraSensitivity = clampRange(p['cameraSensitivity'], 0.4, 2.0, base.cameraSensitivity);
      if (typeof p['cameraInvertOrbit'] === 'boolean') {
        base.cameraInvertOrbit = p['cameraInvertOrbit'];
      }
      if (isOneOf<BoardViewAngle>(p['boardView'], ['COMMAND', 'TACTICAL', 'OVERHEAD'])) {
        base.boardView = p['boardView'];
      }

      return base;
    } catch {
      return base;
    }
  }

  private saveToStorage(opts: AppOptions): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(opts));
      }
    } catch {
      // Ignore storage quota limits
    }
  }
}
