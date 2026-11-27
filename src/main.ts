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
const hud = new HudController(hudRoot, store, sound, (verdict) => {
  sceneManager.triggerArbiterSequence(verdict);
});

store.subscribe((view, options) => {
  sound.setEraMode(options.eraMode);
  sound.setMuted(options.audioMuted);
  sceneManager.syncFromStore(view, options);
  hud.render(view, options);
});

sceneManager.snapCameraImmediately();
sceneManager.startLoop();

// Deterministic Visual QA / Stage Inspection API (never exposes `#truthPieces`)
declare global {
  interface Window {
    __WAR_GENERALS_STAGE__?: {
      poseTabletop: () => void;
      poseInspect16: () => void;
      poseArbiterAct: (preset: ShowcasePreset, actSeconds: number) => void;
    };
  }
}

window.__WAR_GENERALS_STAGE__ = {
  poseTabletop: () => {
    sceneManager.arbiterStage.resetToIdle();
    store.resetSandbox();
    sceneManager.snapCameraImmediately();
  },
  poseInspect16: () => {
    sceneManager.arbiterStage.resetToIdle();
    store.setCameraMode('INSPECT_16');
    sceneManager.snapCameraImmediately();
  },
  poseArbiterAct: (preset: ShowcasePreset, actSeconds: number) => {
    sceneManager.arbiterStage.resetToIdle();
    store.resetSandbox();
    const verdict = store.triggerShowcaseClash(preset);
    if (verdict) {
      sceneManager.triggerArbiterSequence(verdict);
      sceneManager.snapCameraImmediately();
      sceneManager.arbiterStage.scrubToActTime(actSeconds);
    }
  },
};
