import './styles/shell.css';
import { SoundDirector } from './audio/SoundDirector';
import type { QualityTier, TheaterId, ViewportFrameMode } from './core/types';
import { SceneManager } from './graphics/SceneManager';
import { GameStore, type ShowcasePreset } from './state/GameStore';
import { UIManager } from './ui/UIManager';

const canvasHost = document.getElementById('canvas-host');
const hudRoot = document.getElementById('hud-root');

if (!canvasHost || !hudRoot) {
  throw new Error('War Generals shell containers (#canvas-host / #hud-root) missing.');
}

const store = new GameStore();
const sound = new SoundDirector();
const sceneManager = new SceneManager(canvasHost, store, sound);

const ui = new UIManager(hudRoot, store, sound, {
  onTriggerVerdict: (verdict) => {
    sceneManager.triggerArbiterSequence(verdict);
  },
  onStartCrateDrag: (rank, clientX, clientY) => {
    sceneManager.beginCrateDrag(rank, clientX, clientY);
  },
  onSkipArbiter: () => {
    sceneManager.skipArbiterCutscene();
  },
  onResetCamera: () => {
    sceneManager.resetCameraOrbit();
  },
});

sceneManager.onOpenSuspectWheel = (pieceId, clientX, clientY) => {
  ui.openSuspectWheel(pieceId, clientX, clientY);
};

store.onAIClashTriggered = (verdict) => {
  sceneManager.triggerArbiterSequence(verdict);
};

store.onAIQuietMove = (publicKills) => {
  sound.playMoveSlide(publicKills);
};

store.subscribe((view, options) => {
  sound.syncOptions(options);
  sceneManager.syncFromStore(view, options);
  ui.render(view, options);
});

const syncBootTheaterLighting = (snapCamera = false): void => {
  const bootView = store.getVisibleView();
  const bootOpts = store.getOptions();
  sceneManager.setTheater(bootView.theaterId);
  sceneManager.syncFromStore(bootView, bootOpts);
  if (snapCamera) {
    sceneManager.snapCameraImmediately();
  }
};

syncBootTheaterLighting(true);
sceneManager.startLoop();

// Re-sync theater lighting once after async GLB/PMREM boot settles for persisted non-default theaters (e.g. PACIFIC_BRIDGE)
const refreshTitleBootLighting = (): void => {
  if (store.getVisibleView().phase === 'TITLE') {
    syncBootTheaterLighting(false);
  }
};
window.setTimeout(refreshTitleBootLighting, 340);

const buildCombinedTelemetry = (): Record<string, unknown> => ({
  ...sceneManager.getStageTelemetry(),
  activeChoreography: sceneManager.arbiterStage.getActiveChoreography(),
  arbiterVisibleFxCount: sceneManager.arbiterStage.getVisibleFxCount(),
  turnCount: store.getVisibleView().turnCount,
  audio: sound.getAudioTelemetry(),
});

// Deterministic Visual QA / Stage Inspection API (never exposes `#truthPieces`)
declare global {
  interface Window {
    __WAR_GENERALS_STAGE__?: {
      poseTitle: () => void;
      poseTabletop: (boardView?: 'COMMAND' | 'TACTICAL' | 'OVERHEAD') => void;
      poseInspect16: () => void;
      poseReplay: () => void;
      poseFieldManual: () => void;
      poseArbiterAct: (preset: ShowcasePreset, actSeconds: number) => void;
      getTelemetry: () => Record<string, unknown>;
      getStageTelemetry: () => Record<string, unknown>;
      getAudioTelemetry: () => ReturnType<SoundDirector['getAudioTelemetry']>;
      disposeAudio: () => void;
      skipArbiterCutscene: () => boolean;
      setTheater: (id: TheaterId) => void;
      resetCameraOrbit: () => void;
      setViewportFrameMode: (mode: ViewportFrameMode) => void;
      setQualityMode: (mode: QualityTier) => void;
      simulateFrameDt: (dtSec: number) => void;
      projectBoardCoord: (vCol: number, vRow: number, worldY?: number) => { x: number; y: number } | null;
    };
  }
}

window.__WAR_GENERALS_STAGE__ = {
  poseTitle: () => {
    sceneManager.arbiterStage.resetToIdle();
    store.returnToTitleMenu();
    sceneManager.snapCameraImmediately();
  },
  poseTabletop: (boardView = 'COMMAND') => {
    sceneManager.arbiterStage.resetToIdle();
    store.startSkirmish('MILLER');
    store.applyDeploymentPreset('VACCINATION');
    store.launchBattleFromDeployment();
    store.updateOptions({ boardView });
    sceneManager.snapCameraImmediately();
  },
  poseInspect16: () => {
    sceneManager.arbiterStage.resetToIdle();
    store.setCameraMode('INSPECT_16');
    sceneManager.snapCameraImmediately();
  },
  poseReplay: () => {
    sceneManager.arbiterStage.resetToIdle();
    store.enterDeclassifiedReplay();
    sceneManager.snapCameraImmediately();
  },
  poseFieldManual: () => {
    sceneManager.arbiterStage.resetToIdle();
    store.openFieldManual('SPY');
    sceneManager.snapCameraImmediately();
  },
  poseArbiterAct: (preset: ShowcasePreset, actSeconds: number) => {
    sceneManager.arbiterStage.resetToIdle();
    store.startSkirmish('MILLER');
    store.applyDeploymentPreset('VACCINATION');
    store.launchBattleFromDeployment();
    const verdict = store.triggerShowcaseClash(preset);
    if (verdict) {
      sceneManager.triggerArbiterSequence(verdict);
      sceneManager.arbiterStage.scrubToActTime(actSeconds);
      sceneManager.updateCameraForCurrentState();
      sceneManager.snapCameraImmediately();
    }
  },
  getTelemetry: buildCombinedTelemetry,
  getStageTelemetry: buildCombinedTelemetry,
  getAudioTelemetry: () => sound.getAudioTelemetry(),
  disposeAudio: () => {
    sound.dispose();
  },
  skipArbiterCutscene: () => sceneManager.skipArbiterCutscene(),
  setTheater: (id: TheaterId) => sceneManager.setTheater(id),
  resetCameraOrbit: () => sceneManager.resetCameraOrbit(),
  setViewportFrameMode: (mode: ViewportFrameMode) => sceneManager.setViewportFrameMode(mode),
  setQualityMode: (mode: QualityTier) => sceneManager.setQualityMode(mode),
  simulateFrameDt: (dtSec: number) => sceneManager.simulateFrameDt(dtSec),
  projectBoardCoord: (vCol: number, vRow: number, worldY = 0.08) =>
    sceneManager.projectBoardCoord(vCol, vRow, worldY),
};
