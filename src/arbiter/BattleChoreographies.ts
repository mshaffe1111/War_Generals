import * as THREE from 'three';
import type {
  ArbiterVerdict,
  BattleChoreographyKind,
  HudBannerState,
} from '../core/types';

/**
 * Pure Visual & Camera Choreography Profiles for War Generals (Salpakan).
 *
 * STRICT INFORMATION ASYMMETRY CONTRACT:
 * - Consumes exclusively public `ArbiterVerdict` fields (`choreography`, `resolution`,
 *   `isFlagTraverseVictory`, `attackerFaction`, `playerVisibleRank`, `stakes`).
 * - NEVER reads or infers hidden enemy rank or private truth records.
 */

export interface ChoreographyCameraBias {
  readonly shot1SideBiasX: number;
  readonly shot1FovDelta: number;
  readonly shot2OrbitAmp: number;
  readonly shot2RoomDim: number;
  readonly shot2RedAlertBoost: number;
}

export interface ChoreographyVisualProfile {
  readonly kind: BattleChoreographyKind;
  readonly isFlagTraverse: boolean;
  readonly act1Dur: number;
  readonly pushDurByDefcon: readonly [number, number, number];
  readonly vacuumDurByDefcon: readonly [number, number, number];
  readonly act3Dur: number;
  readonly tracerSpeedMul: number;
  readonly tracerDensityMask: number;
  readonly tracerColorPlayerRGB: readonly [number, number, number];
  readonly tracerColorEnemyRGB: readonly [number, number, number];
  readonly enableFlakPuffs: boolean;
  readonly enableReconSweep: boolean;
  readonly enableHeatLance: boolean;
  readonly enableIncomingSalvo: boolean;
  readonly enableTraverseBridge: boolean;
  readonly shockwaveColorRGB: readonly [number, number, number];
  readonly shaftColorRGB: readonly [number, number, number];
  readonly crtAct1Label: string;
  readonly crtAct2ALabel: string;
  readonly crtAct2BLabel: string;
  readonly crtAct3WinLabel: string;
  readonly crtAct3LossLabel: string;
  readonly cameraBias: ChoreographyCameraBias;
}

export interface ChoreographyTimeline {
  readonly tAct1End: number;
  readonly tPushEnd: number;
  readonly tVerdict: number;
  readonly tTotalEnd: number;
}

export interface FlagTraverseMarchPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export function resolveBattleChoreographyProfile(
  verdict: ArbiterVerdict
): ChoreographyVisualProfile {
  const isFlagTraverse = Boolean(verdict.isFlagTraverseVictory);
  const isSpyIntercept =
    verdict.playerVisibleRank === 'PRIVATE' && verdict.resolution === 'PLAYER_WINS';

  switch (verdict.choreography) {
    case 'RECON_STEALTH':
      return {
        kind: 'RECON_STEALTH',
        isFlagTraverse: false,
        act1Dur: 0.72,
        pushDurByDefcon: [1.46, 1.26, 1.04],
        vacuumDurByDefcon: [0.8, 0.56, 0.42],
        act3Dur: 1.8,
        tracerSpeedMul: 1.62,
        tracerDensityMask: 2,
        tracerColorPlayerRGB: [0.38, 2.45, 1.88],
        tracerColorEnemyRGB: [2.75, 0.62, 0.78],
        enableFlakPuffs: false,
        enableReconSweep: true,
        enableHeatLance: false,
        enableIncomingSalvo: false,
        enableTraverseBridge: false,
        shockwaveColorRGB: [0.42, 2.25, 1.75],
        shaftColorRGB: [0.48, 2.15, 1.82],
        crtAct1Label: 'COVERT INFILTRATION',
        crtAct2ALabel: 'CIPHER TRIANGULATION',
        crtAct2BLabel: 'SILENCED INTERCEPT',
        crtAct3WinLabel: 'AGENT EXTRACTED',
        crtAct3LossLabel: 'COVER BLOWN',
        cameraBias: {
          shot1SideBiasX: 0.82,
          shot1FovDelta: -3,
          shot2OrbitAmp: 0.36,
          shot2RoomDim: 0.12,
          shot2RedAlertBoost: 0.08,
        },
      };

    case 'ARMOR_ARTILLERY':
      return {
        kind: 'ARMOR_ARTILLERY',
        isFlagTraverse: false,
        act1Dur: 0.76,
        pushDurByDefcon: [1.48, 1.28, 1.06],
        vacuumDurByDefcon: [0.82, 0.56, 0.42],
        act3Dur: 1.85,
        tracerSpeedMul: 0.92,
        tracerDensityMask: 1,
        tracerColorPlayerRGB: [2.55, 1.92, 0.65],
        tracerColorEnemyRGB: [2.85, 0.88, 0.38],
        enableFlakPuffs: true,
        enableReconSweep: false,
        enableHeatLance: false,
        enableIncomingSalvo: true,
        enableTraverseBridge: false,
        shockwaveColorRGB: [2.55, 1.48, 0.44],
        shaftColorRGB: [2.15, 1.52, 0.48],
        crtAct1Label: 'BATTERY RANGE LOCK',
        crtAct2ALabel: '105MM SUPPRESSION',
        crtAct2BLabel: 'APFSDS SABOT LOCK',
        crtAct3WinLabel: 'TARGET DEMOLISHED',
        crtAct3LossLabel: 'ARMOR BREACHED',
        cameraBias: {
          shot1SideBiasX: 1.12,
          shot1FovDelta: 1,
          shot2OrbitAmp: 0.54,
          shot2RoomDim: 0.18,
          shot2RedAlertBoost: 0.12,
        },
      };

    case 'HIGH_COMMAND':
      return {
        kind: 'HIGH_COMMAND',
        isFlagTraverse: false,
        act1Dur: 0.78,
        pushDurByDefcon: [1.48, 1.28, 1.08],
        vacuumDurByDefcon: [0.82, 0.58, 0.44],
        act3Dur: 1.9,
        tracerSpeedMul: 1.15,
        tracerDensityMask: 1,
        tracerColorPlayerRGB: [1.15, 2.35, 2.75],
        tracerColorEnemyRGB: [2.95, 0.52, 0.62],
        enableFlakPuffs: true,
        enableReconSweep: false,
        enableHeatLance: true,
        enableIncomingSalvo: false,
        enableTraverseBridge: false,
        shockwaveColorRGB: [2.75, 1.62, 0.52],
        shaftColorRGB: [2.45, 1.75, 0.54],
        crtAct1Label: 'DEFCON 1 // COMMAND',
        crtAct2ALabel: 'STRATEGIC OVERMATCH',
        crtAct2BLabel: 'THERMAL LANCE LOCK',
        crtAct3WinLabel: 'COMMAND SUPREMACY',
        crtAct3LossLabel: 'HQ OVERRUN',
        cameraBias: {
          shot1SideBiasX: 1.04,
          shot1FovDelta: 2,
          shot2OrbitAmp: 0.58,
          shot2RoomDim: 0.13,
          shot2RedAlertBoost: 0.36,
        },
      };

    case 'MUTUAL_SPLIT':
      return {
        kind: 'MUTUAL_SPLIT',
        isFlagTraverse: false,
        act1Dur: 0.68,
        pushDurByDefcon: [1.14, 1.04, 0.92],
        vacuumDurByDefcon: [0.48, 0.42, 0.36],
        act3Dur: 1.75,
        tracerSpeedMul: 1.18,
        tracerDensityMask: 1,
        tracerColorPlayerRGB: [2.45, 1.95, 0.78],
        tracerColorEnemyRGB: [2.75, 0.85, 0.52],
        enableFlakPuffs: true,
        enableReconSweep: false,
        enableHeatLance: false,
        enableIncomingSalvo: false,
        enableTraverseBridge: false,
        shockwaveColorRGB: [2.65, 1.12, 0.42],
        shaftColorRGB: [1.95, 1.38, 0.42],
        crtAct1Label: 'SYMMETRIC DEADLOCK',
        crtAct2ALabel: 'CROSSFIRE EQUILIBRIUM',
        crtAct2BLabel: 'DUAL IMPACT LOCK',
        crtAct3WinLabel: 'MUTUAL NEUTRALIZATION',
        crtAct3LossLabel: 'MUTUAL NEUTRALIZATION',
        cameraBias: {
          shot1SideBiasX: 0.96,
          shot1FovDelta: 0,
          shot2OrbitAmp: 0.34,
          shot2RoomDim: 0.16,
          shot2RedAlertBoost: 0.2,
        },
      };

    case 'FLAG_BREACH':
      if (isFlagTraverse) {
        const playerWins = verdict.attackerFaction === 'PLAYER';
        return {
          kind: 'FLAG_BREACH',
          isFlagTraverse: true,
          act1Dur: 0.72,
          pushDurByDefcon: [1.32, 1.18, 1.04],
          vacuumDurByDefcon: [0.68, 0.52, 0.4],
          act3Dur: 2.35,
          tracerSpeedMul: 1.0,
          tracerDensityMask: 2,
          tracerColorPlayerRGB: [2.65, 2.08, 0.72],
          tracerColorEnemyRGB: [2.8, 0.52, 0.62],
          enableFlakPuffs: false,
          enableReconSweep: false,
          enableHeatLance: false,
          enableIncomingSalvo: false,
          enableTraverseBridge: true,
          shockwaveColorRGB: playerWins ? [2.65, 2.02, 0.68] : [2.65, 0.48, 0.58],
          shaftColorRGB: playerWins ? [2.45, 1.88, 0.58] : [2.45, 0.52, 0.58],
          crtAct1Label: 'BACK-RANK BREACH',
          crtAct2ALabel: 'FLAG TRAVERSE CORRIDOR',
          crtAct2BLabel: playerWins ? 'STANDARD UNCONTESTED' : 'PERIMETER BREACHED',
          crtAct3WinLabel: 'VICTORY STANDARD SECURED',
          crtAct3LossLabel: 'NAVY PERIMETER BREACHED',
          cameraBias: {
            shot1SideBiasX: 0.9,
            shot1FovDelta: 1,
            shot2OrbitAmp: 0.28,
            shot2RoomDim: 0.22,
            shot2RedAlertBoost: playerWins ? 0.0 : 0.35,
          },
        };
      }
      return {
        kind: 'FLAG_BREACH',
        isFlagTraverse: false,
        act1Dur: 0.76,
        pushDurByDefcon: [1.48, 1.28, 1.06],
        vacuumDurByDefcon: [0.82, 0.56, 0.42],
        act3Dur: 2.65,
        tracerSpeedMul: 1.12,
        tracerDensityMask: 1,
        tracerColorPlayerRGB: [2.65, 2.05, 0.72],
        tracerColorEnemyRGB: [2.85, 0.68, 0.45],
        enableFlakPuffs: true,
        enableReconSweep: false,
        enableHeatLance: false,
        enableIncomingSalvo: verdict.resolution === 'FLAG_CAPTURED_BY_PLAYER',
        enableTraverseBridge: false,
        shockwaveColorRGB: [2.75, 1.88, 0.56],
        shaftColorRGB: [2.45, 1.85, 0.58],
        crtAct1Label: 'COMMAND HQ BREACH',
        crtAct2ALabel: 'CITADEL ASSAULT',
        crtAct2BLabel: 'STANDARD INTERCEPT',
        crtAct3WinLabel: 'ENEMY FLAG UNMASKED',
        crtAct3LossLabel: 'NAVY FLAG LOST',
        cameraBias: {
          shot1SideBiasX: 1.0,
          shot1FovDelta: 1,
          shot2OrbitAmp: 0.46,
          shot2RoomDim: 0.16,
          shot2RedAlertBoost: 0.28,
        },
      };

    case 'INFANTRY':
    default:
      return {
        kind: 'INFANTRY',
        isFlagTraverse: false,
        act1Dur: 0.76,
        pushDurByDefcon: [1.48, 1.28, 1.06],
        vacuumDurByDefcon: [0.82, 0.56, 0.42],
        act3Dur: 1.75,
        tracerSpeedMul: 1.38,
        tracerDensityMask: 1,
        tracerColorPlayerRGB: isSpyIntercept ? [0.48, 2.38, 1.65] : [2.6, 2.05, 0.72],
        tracerColorEnemyRGB: [2.8, 0.95, 0.42],
        enableFlakPuffs: false,
        enableReconSweep: false,
        enableHeatLance: false,
        enableIncomingSalvo: false,
        enableTraverseBridge: false,
        shockwaveColorRGB: isSpyIntercept ? [0.45, 2.35, 1.45] : [2.25, 1.38, 0.46],
        shaftColorRGB: isSpyIntercept ? [0.48, 2.28, 1.48] : [1.95, 1.38, 0.42],
        crtAct1Label: 'FRONTLINE SKIRMISH',
        crtAct2ALabel: isSpyIntercept ? 'COUNTER-INTEL SWEEP' : 'SMALL-ARMS CROSSFIRE',
        crtAct2BLabel: isSpyIntercept ? 'SPY INTERCEPT LOCK' : 'CRITICAL LOCK // 88MM',
        crtAct3WinLabel: isSpyIntercept ? 'SPY INTERCEPTED' : 'SECTOR SECURED',
        crtAct3LossLabel: 'UNIT OVERRUN',
        cameraBias: {
          shot1SideBiasX: 0.98,
          shot1FovDelta: 0,
          shot2OrbitAmp: 0.48,
          shot2RoomDim: 0.18,
          shot2RedAlertBoost: 0.0,
        },
      };
  }
}

export function computeChoreographyTimeline(
  verdict: ArbiterVerdict,
  profile: ChoreographyVisualProfile
): ChoreographyTimeline {
  const defcon = verdict.stakes?.defcon ?? 3;
  const idx = defcon === 1 ? 0 : defcon === 2 ? 1 : 2;
  const tAct1End = profile.act1Dur;
  const pushDur = profile.pushDurByDefcon[idx];
  const vacuumDur = profile.vacuumDurByDefcon[idx];
  const tPushEnd = tAct1End + pushDur;
  const tVerdict = tPushEnd + vacuumDur;
  const tTotalEnd = tVerdict + profile.act3Dur;
  return { tAct1End, tPushEnd, tVerdict, tTotalEnd };
}

export function computeFlagTraverseMarchPose(
  u: number,
  winnerIsPlayer: boolean,
  bastionX: number,
  surfaceY: number,
  bastionZ: number
): FlagTraverseMarchPose {
  const clamped = THREE.MathUtils.clamp(u, 0, 1);
  const eased = THREE.MathUtils.smoothstep(clamped, 0, 1);
  const startX = winnerIsPlayer ? -bastionX : bastionX;
  const endX = 0;
  const x = THREE.MathUtils.lerp(startX, endX, eased);
  const archLift = Math.sin(eased * Math.PI) * 0.18 + eased * 0.08;
  const strideBob = Math.abs(Math.sin(clamped * Math.PI * 5)) * 0.035;
  const y = surfaceY + archLift + strideBob;
  const z = bastionZ;
  // Strict Fog-of-War: if Enemy wins Flag Traverse, enemy wedge MUST keep `rotation.y ≈ Math.PI` (masked rear)!
  const yaw = winnerIsPlayer
    ? THREE.MathUtils.lerp(0.32, 0.12, eased)
    : Math.PI - THREE.MathUtils.lerp(0.32, 0.12, eased);
  const pitch = 0;
  const roll = Math.sin(clamped * Math.PI * 5) * 0.045;
  return { x, y, z, yaw, pitch, roll };
}

export function resolveChoreographyLockBanner(verdict: ArbiterVerdict): HudBannerState {
  if (verdict.isFlagTraverseVictory) {
    return verdict.attackerFaction === 'PLAYER'
      ? 'FLAG TRAVERSE — VICTORY'
      : 'ENEMY AMBUSH — BRACE!';
  }
  if (verdict.stakes?.defcon === 1) return 'DEFCON 1 — HIGH COMMAND ALERT';
  if (verdict.stakes?.playerDoctrine === 'COVERT_SPY') {
    return 'OPERATION STILETTO — COVERT STRIKE';
  }
  if (verdict.stakes?.isEnemyInitiatedAmbush) return 'ENEMY AMBUSH — BRACE!';
  return 'CLASH LOCK-IN';
}
