import './styles/shell.css';
import { SoundDirector } from './audio/SoundDirector';
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

sceneManager.snapCameraImmediately();
sceneManager.startLoop();

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
};
