import './styles/shell.css';
import { SoundDirector } from './audio/SoundDirector';
import { SceneManager } from './graphics/SceneManager';
import { GameStore, type ShowcasePreset } from './state/GameStore';
import { HudController } from './ui/HudController';

const canvasHost = document.getElementById('canvas-host');
const hudRoot = document.getElementById('hud-root');

if (!canvasHost || !hudRoot) {
  throw new Error('War Generals shell containers (#canvas-host / #hud-root) missing.');
}

const store = new GameStore();
const sound = new SoundDirector();
const sceneManager = new SceneManager(canvasHost, store, sound);

const hud = new HudController(hudRoot, store, sound, {
  onTriggerVerdict: (verdict) => {
    sceneManager.triggerArbiterSequence(verdict);
  },
  onStartCrateDrag: (rank, clientX, clientY) => {
    sceneManager.beginCrateDrag(rank, clientX, clientY);
  },
});

sceneManager.onOpenSuspectWheel = (pieceId, clientX, clientY) => {
  hud.openSuspectWheel(pieceId, clientX, clientY);
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
  hud.render(view, options);
});

sceneManager.snapCameraImmediately();
sceneManager.startLoop();

// Deterministic Visual QA / Stage Inspection API (never exposes `#truthPieces`)
declare global {
  interface Window {
    __WAR_GENERALS_STAGE__?: {
      poseTabletop: (boardView?: 'COMMAND' | 'TACTICAL' | 'OVERHEAD') => void;
      poseInspect16: () => void;
      poseReplay: () => void;
      poseArbiterAct: (preset: ShowcasePreset, actSeconds: number) => void;
    };
  }
}

window.__WAR_GENERALS_STAGE__ = {
  poseTabletop: (boardView = 'COMMAND') => {
    sceneManager.arbiterStage.resetToIdle();
    store.startNewDeployment('VACCINATION');
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
  poseArbiterAct: (preset: ShowcasePreset, actSeconds: number) => {
    sceneManager.arbiterStage.resetToIdle();
    store.startNewDeployment('VACCINATION');
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
