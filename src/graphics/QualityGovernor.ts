import type { QualityProfile, QualitySnapshot, QualityTier, ResolvedQualityTier } from '../core/types';

export interface QualityPreset {
  readonly dprCap: number;
  readonly shadowMapSize: number;
  readonly enableLanternShadow: boolean;
  readonly enableRimShadow: boolean;
  readonly enableBloom: boolean;
  readonly enableDoF: boolean;
  readonly targetFps: number;
}

export const QUALITY_PRESETS: Readonly<Record<ResolvedQualityTier, QualityPreset>> = {
  ULTRA: {
    dprCap: 2.0,
    shadowMapSize: 2048,
    enableLanternShadow: true,
    enableRimShadow: true,
    enableBloom: true,
    enableDoF: true,
    targetFps: 60,
  },
  HIGH: {
    dprCap: 1.5,
    shadowMapSize: 1024,
    enableLanternShadow: false,
    enableRimShadow: false,
    enableBloom: true,
    enableDoF: true,
    targetFps: 60,
  },
  BALANCED: {
    dprCap: 1.15,
    shadowMapSize: 1024,
    enableLanternShadow: false,
    enableRimShadow: false,
    enableBloom: true,
    enableDoF: false,
    targetFps: 60,
  },
  BATTERY_SAVER: {
    dprCap: 0.85,
    shadowMapSize: 0,
    enableLanternShadow: false,
    enableRimShadow: false,
    enableBloom: false,
    enableDoF: false,
    targetFps: 30,
  },
};

const TIER_ORDER: readonly ResolvedQualityTier[] = [
  'ULTRA',
  'HIGH',
  'BALANCED',
  'BATTERY_SAVER',
];

const WINDOW_SIZE = 60;
const STEP_DOWN_DT_THRESHOLD = 1 / 48;
const STEP_UP_DT_THRESHOLD = 1 / 57;
const STEP_DOWN_COOLDOWN_SEC = 2.5;
const STEP_UP_COOLDOWN_SEC = 1.95;

export class QualityGovernor {
  private requestedMode: QualityTier = 'AUTO';
  private autoBaselineTier: ResolvedQualityTier = 'HIGH';
  private resolvedTier: ResolvedQualityTier = 'HIGH';

  private readonly dtWindow: number[] = [];
  private framesSinceEval = 0;
  private elapsedSinceChangeSec = STEP_DOWN_COOLDOWN_SEC;
  private hasChangedOnce = false;
  private healthyStepUpWindows = 0;
  private measuredFps = 60;

  constructor(initialMode: QualityTier = 'AUTO') {
    this.setRequestedMode(initialMode);
  }

  public probeCapabilities(
    gl: WebGLRenderingContext | WebGL2RenderingContext | null
  ): ResolvedQualityTier {
    if (!gl) {
      let tier: ResolvedQualityTier = 'HIGH';
      if (typeof navigator !== 'undefined') {
        const cores = navigator.hardwareConcurrency ?? 4;
        const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
        if (cores <= 2 || mem <= 2) {
          tier = 'BATTERY_SAVER';
        } else if (cores <= 4 || mem <= 4) {
          tier = 'BALANCED';
        }
      }
      this.autoBaselineTier = tier;
      if (this.requestedMode === 'AUTO') {
        this.resolvedTier = tier;
      }
      return this.autoBaselineTier;
    }

    const isWebGL2 =
      typeof WebGL2RenderingContext !== 'undefined' &&
      gl instanceof WebGL2RenderingContext;

    let maxTextureSize = 2048;
    try {
      const texParam = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
      if (Number.isFinite(texParam) && texParam > 0) {
        maxTextureSize = texParam;
      }
    } catch {
      maxTextureSize = 2048;
    }

    let rendererStr = '';
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase();
      } else {
        rendererStr = String(gl.getParameter(gl.RENDERER) ?? '').toLowerCase();
      }
    } catch {
      rendererStr = '';
    }

    const isSoftwareRenderer =
      rendererStr.includes('swiftshader') ||
      rendererStr.includes('llvmpipe') ||
      rendererStr.includes('softpipe') ||
      rendererStr.includes('microsoft basic render');

    const isDiscreteDesktopGpu =
      rendererStr.includes('nvidia') ||
      rendererStr.includes('geforce') ||
      rendererStr.includes('rtx') ||
      rendererStr.includes('gtx') ||
      rendererStr.includes('radeon rx') ||
      rendererStr.includes('radeon pro') ||
      rendererStr.includes('radeon(tm) rx');

    const isMobileOrIntegrated =
      rendererStr.includes('mali') ||
      rendererStr.includes('adreno') ||
      rendererStr.includes('powervr') ||
      rendererStr.includes('apple gpu') ||
      rendererStr.includes('intel') ||
      (rendererStr.includes('radeon') && !isDiscreteDesktopGpu);

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isMobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
    const mem =
      typeof navigator !== 'undefined'
        ? ((navigator as { deviceMemory?: number }).deviceMemory ?? 8)
        : 8;

    let baseline: ResolvedQualityTier = 'HIGH';
    if (!isWebGL2 || isSoftwareRenderer || maxTextureSize < 2048) {
      baseline = 'BATTERY_SAVER';
    } else if (isDiscreteDesktopGpu && !isMobileUa && cores >= 6 && mem >= 8 && maxTextureSize >= 8192) {
      baseline = 'ULTRA';
    } else if (isMobileUa && (mem <= 3 || cores <= 4 || isMobileOrIntegrated)) {
      baseline = mem <= 2 ? 'BATTERY_SAVER' : 'BALANCED';
    } else if (maxTextureSize >= 4096) {
      baseline = 'HIGH';
    } else {
      baseline = 'BALANCED';
    }

    this.autoBaselineTier = baseline;
    if (this.requestedMode === 'AUTO') {
      this.resolvedTier = baseline;
    }
    return this.autoBaselineTier;
  }

  public setRequestedMode(mode: QualityTier): void {
    this.requestedMode = mode;
    this.dtWindow.length = 0;
    this.framesSinceEval = 0;
    this.healthyStepUpWindows = 0;
    this.hasChangedOnce = false;
    this.elapsedSinceChangeSec = STEP_DOWN_COOLDOWN_SEC;

    if (mode === 'AUTO') {
      this.resolvedTier = this.autoBaselineTier;
    } else {
      this.resolvedTier = mode;
    }
  }

  public getAutoBaselineTier(): ResolvedQualityTier {
    return this.autoBaselineTier;
  }

  public recordFrameDt(dtSec: number): boolean {
    if (!Number.isFinite(dtSec) || dtSec <= 0) {
      return false;
    }

    const clampedDt = Math.max(1 / 240, Math.min(0.25, dtSec));
    this.dtWindow.push(clampedDt);
    if (this.dtWindow.length > WINDOW_SIZE) {
      this.dtWindow.shift();
    }
    this.framesSinceEval += 1;
    this.elapsedSinceChangeSec += clampedDt;

    let sum = 0;
    for (let i = 0; i < this.dtWindow.length; i++) {
      sum += this.dtWindow[i]!;
    }
    const avgDt = sum / this.dtWindow.length;
    this.measuredFps = Math.max(1, Math.min(240, Math.round(1 / avgDt)));

    if (this.requestedMode !== 'AUTO') {
      return false;
    }

    if (this.dtWindow.length < WINDOW_SIZE || this.framesSinceEval < WINDOW_SIZE) {
      return false;
    }

    this.framesSinceEval = 0;
    const sorted = [...this.dtWindow].sort((a, b) => a - b);
    const p90Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
    const p90Dt = sorted[p90Idx]!;

    const currentIdx = TIER_ORDER.indexOf(this.resolvedTier);
    const baselineIdx = TIER_ORDER.indexOf(this.autoBaselineTier);

    const stepDownReady =
      !this.hasChangedOnce || this.elapsedSinceChangeSec >= STEP_DOWN_COOLDOWN_SEC;

    if (p90Dt > STEP_DOWN_DT_THRESHOLD && stepDownReady && currentIdx < TIER_ORDER.length - 1) {
      this.resolvedTier = TIER_ORDER[currentIdx + 1]!;
      this.dtWindow.length = 0;
      this.healthyStepUpWindows = 0;
      this.elapsedSinceChangeSec = 0;
      this.hasChangedOnce = true;
      return true;
    }

    if (p90Dt < STEP_UP_DT_THRESHOLD && currentIdx > baselineIdx) {
      this.healthyStepUpWindows += 1;
      if (this.healthyStepUpWindows >= 2 && this.elapsedSinceChangeSec >= STEP_UP_COOLDOWN_SEC) {
        this.resolvedTier = TIER_ORDER[currentIdx - 1]!;
        this.dtWindow.length = 0;
        this.healthyStepUpWindows = 0;
        this.elapsedSinceChangeSec = 0;
        this.hasChangedOnce = true;
        return true;
      }
    } else {
      this.healthyStepUpWindows = 0;
    }

    return false;
  }

  public getActiveProfile(): QualityProfile {
    const preset = QUALITY_PRESETS[this.resolvedTier];
    return {
      requestedMode: this.requestedMode,
      resolvedTier: this.resolvedTier,
      dprCap: preset.dprCap,
      shadowMapSize: preset.shadowMapSize,
      enableLanternShadow: preset.enableLanternShadow,
      enableRimShadow: preset.enableRimShadow,
      enableBloom: preset.enableBloom,
      enableDoF: preset.enableDoF,
      targetFps: preset.targetFps,
      measuredFps: this.measuredFps,
    };
  }

  public getSnapshot(): QualitySnapshot {
    return this.getActiveProfile();
  }
}
