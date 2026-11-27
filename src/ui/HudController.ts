import type { SoundDirector } from '../audio/SoundDirector';
import { RANK_SPECS } from '../core/ranks';
import type { AppOptions, ArbiterVerdict, BoardViewAngle, PlayerVisibleView } from '../core/types';
import type { GameStore, ShowcasePreset } from '../state/GameStore';

const VIEW_DEGREE_BADGE: Readonly<Record<BoardViewAngle, string>> = {
  COMMAND: '40°',
  TACTICAL: '32°',
  OVERHEAD: '62°',
};

const ICON_FULLSCREEN_ENTER = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
`;

const ICON_FULLSCREEN_EXIT = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
`;

interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitHTMLElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly sound: SoundDirector;
  private readonly onTriggerVerdict: (verdict: ArbiterVerdict) => void;

  private showcaseOpen = false;
  private optionsOpen = false;
  private fullscreenActive = false;

  private readonly spatialHeader: HTMLElement;
  private readonly spatialTitle: HTMLElement;
  private readonly showcaseOrb: HTMLButtonElement;
  private readonly viewOrb: HTMLButtonElement;
  private readonly viewBadge: HTMLElement;
  private readonly fullscreenOrb: HTMLButtonElement;
  private readonly optionsOrb: HTMLButtonElement;
  private readonly showcaseSheet: HTMLElement;
  private readonly optionsSheet: HTMLElement;
  private readonly bottomZone: HTMLElement;
  private readonly islandEl: HTMLElement;
  private readonly islandNameEl: HTMLElement;
  private readonly islandRuleEl: HTMLElement;
  private readonly tallyNavyVal: HTMLElement;
  private readonly tallyCrimsonVal: HTMLElement;

  constructor(
    root: HTMLElement,
    store: GameStore,
    sound: SoundDirector,
    onTriggerVerdict: (verdict: ArbiterVerdict) => void
  ) {
    this.root = root;
    this.store = store;
    this.sound = sound;
    this.onTriggerVerdict = onTriggerVerdict;

    this.root.innerHTML = `
      <div class="hud-top-stack">
        <div class="hud-top-row">
          <div class="hud-orb-cluster">
            <button type="button" class="hud-orb" id="btn-showcase" aria-label="Battle Arena Showcase" title="Battle Showcase & Rank Gallery">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
                <path d="m13 19 6-6" />
                <path d="m16 16 4 4" />
                <path d="m19 21 2-2" />
                <path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
                <path d="m11 19-6-6" />
                <path d="m8 16-4 4" />
                <path d="m5 21-2-2" />
              </svg>
            </button>
          </div>

          <div class="hud-spatial-header" id="hud-spatial-header">
            <div class="hud-spatial-title" id="hud-spatial-title">WAR GENERALS</div>
            <div class="hud-spatial-accent"></div>
          </div>

          <div class="hud-orb-cluster">
            <button type="button" class="hud-orb" id="btn-view" aria-label="Cycle Camera Angle" title="Tilt Camera (32° Low / 40° Hero / 62° Top — or drag vertically)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span class="hud-orb-badge" id="hud-view-badge">40°</span>
            </button>
            <button type="button" class="hud-orb" id="btn-fullscreen" aria-label="Toggle Fullscreen" title="Toggle Fullscreen (F)">
              ${ICON_FULLSCREEN_ENTER}
            </button>
            <button type="button" class="hud-orb" id="btn-options" aria-label="Settings" title="Settings">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="17" x2="20" y2="17" />
                <circle cx="9" cy="7" r="2.5" />
                <circle cx="15" cy="17" r="2.5" />
              </svg>
            </button>
          </div>
        </div>

        <div class="hud-sheet" id="drawer-showcase" hidden>
          <div class="pill-grid">
            <button type="button" class="pill-action" data-preset="PLAYER_WIN" data-tone="gold">Artillery Win</button>
            <button type="button" class="pill-action" data-preset="ENEMY_WIN" data-tone="crimson">Ambush Reversal!</button>
            <button type="button" class="pill-action" data-preset="SPY_INTERCEPT" data-tone="cyan">Spy Intercept!</button>
            <button type="button" class="pill-action" data-preset="MUTUAL_SPLIT" data-tone="crimson">Delayed Double-KO</button>
            <button type="button" class="pill-action" data-preset="FLAG_CAPTURE" data-tone="gold">Flag Unmasking</button>
            <button type="button" class="pill-action" id="btn-inspect-16" data-tone="cyan">16-Rank Gallery</button>
            <button type="button" class="pill-action" id="btn-reset-board">Reset Formation</button>
          </div>
        </div>

        <div class="hud-sheet" id="drawer-options" hidden>
          <div class="setting-row">
            <span>Display</span>
            <div class="seg-track" id="seg-fullscreen">
              <button type="button" data-fs="false">Framed</button>
              <button type="button" data-fs="true">Fullscreen</button>
            </div>
          </div>
          <div class="setting-row">
            <span>Camera</span>
            <div class="seg-track" id="seg-view">
              <button type="button" data-view="COMMAND">40° Hero</button>
              <button type="button" data-view="TACTICAL">32° Low</button>
              <button type="button" data-view="OVERHEAD">62° Top</button>
            </div>
          </div>
          <div class="setting-row">
            <span>Audio</span>
            <div class="seg-track" id="seg-era">
              <button type="button" data-era="1980s">Warfield</button>
              <button type="button" data-era="1970s">Brass</button>
            </div>
          </div>
          <div class="setting-row">
            <span>Pace</span>
            <div class="seg-track" id="seg-speed">
              <button type="button" data-speed="1x">1x</button>
              <button type="button" data-speed="1.75x">1.75x</button>
            </div>
          </div>
          <div class="setting-row">
            <span>Quality</span>
            <div class="seg-track" id="seg-quality">
              <button type="button" data-quality="ULTRA">Ultra</button>
              <button type="button" data-quality="BALANCED">60Hz</button>
            </div>
          </div>
          <div class="setting-row">
            <span>Sound</span>
            <div class="seg-track" id="seg-mute">
              <button type="button" data-mute="false">On</button>
              <button type="button" data-mute="true">Mute</button>
            </div>
          </div>
        </div>
      </div>

      <div class="hud-bottom-zone" id="hud-bottom-zone">
        <div class="hud-corner-tally" title="Navy Forces Remaining">
          <span class="tally-dot navy"></span>
          <span id="tally-navy-val">21</span>
        </div>

        <div class="hud-dynamic-island" id="hud-island" data-empty="true">
          <div class="island-rank-name" id="island-rank-name">SERGEANT</div>
          <div class="island-rule" id="island-rule">Outranks Private</div>
        </div>

        <div class="hud-corner-tally" title="Crimson Forces Remaining">
          <span id="tally-crimson-val">21</span>
          <span class="tally-dot crimson"></span>
        </div>
      </div>
    `;

    this.spatialHeader = this.root.querySelector('#hud-spatial-header')!;
    this.spatialTitle = this.root.querySelector('#hud-spatial-title')!;
    this.showcaseOrb = this.root.querySelector('#btn-showcase')!;
    this.viewOrb = this.root.querySelector('#btn-view')!;
    this.viewBadge = this.root.querySelector('#hud-view-badge')!;
    this.fullscreenOrb = this.root.querySelector('#btn-fullscreen')!;
    this.optionsOrb = this.root.querySelector('#btn-options')!;
    this.showcaseSheet = this.root.querySelector('#drawer-showcase')!;
    this.optionsSheet = this.root.querySelector('#drawer-options')!;
    this.bottomZone = this.root.querySelector('#hud-bottom-zone')!;
    this.islandEl = this.root.querySelector('#hud-island')!;
    this.islandNameEl = this.root.querySelector('#island-rank-name')!;
    this.islandRuleEl = this.root.querySelector('#island-rule')!;
    this.tallyNavyVal = this.root.querySelector('#tally-navy-val')!;
    this.tallyCrimsonVal = this.root.querySelector('#tally-crimson-val')!;

    this.bindEvents();
  }

  public render(view: PlayerVisibleView, options: Readonly<AppOptions>): void {
    const inArbiter = view.cameraMode === 'ARBITER';

    // Keep top spatial title refined & atmospheric during normal play; dramatic during Warfield clashes!
    if (view.banner === 'TACTICAL COMMAND' || view.banner === 'SELECT TARGET') {
      this.spatialTitle.textContent = 'WAR GENERALS';
    } else if (view.banner === 'ARBITRATING') {
      this.spatialTitle.textContent = 'LIVE FIRE EXCHANGE';
    } else {
      this.spatialTitle.textContent = view.banner;
    }

    if (
      view.banner === 'BATTLE WINNER' ||
      view.banner === 'SPY INTERCEPTED — VICTORY' ||
      view.banner === 'FLAG CAPTURED — VICTORY'
    ) {
      this.spatialHeader.dataset['alert'] = 'gold';
    } else if (
      view.banner === 'MUTUAL ELIMINATION' ||
      view.banner === 'FLAG LOST — DEFEAT' ||
      view.banner === 'DEFCON 1 — HIGH COMMAND ALERT' ||
      view.banner === 'ENEMY AMBUSH — BRACE!' ||
      view.banner === 'ARMOR DEFLECTED — COUNTER!' ||
      view.banner === 'TARGET LOCKED — HEARTBEAT'
    ) {
      this.spatialHeader.dataset['alert'] = 'crimson';
    } else {
      delete this.spatialHeader.dataset['alert'];
    }

    this.showcaseOrb.style.visibility = inArbiter ? 'hidden' : 'visible';
    this.viewOrb.style.visibility = inArbiter ? 'hidden' : 'visible';
    this.fullscreenOrb.style.visibility = inArbiter ? 'hidden' : 'visible';
    this.optionsOrb.style.visibility = inArbiter ? 'hidden' : 'visible';
    if (inArbiter) {
      this.showcaseOpen = false;
      this.optionsOpen = false;
    }

    this.viewBadge.textContent = VIEW_DEGREE_BADGE[options.boardView];
    this.showcaseOrb.dataset['active'] = String(this.showcaseOpen || view.cameraMode === 'INSPECT_16');
    this.fullscreenOrb.dataset['active'] = String(this.fullscreenActive);
    this.fullscreenOrb.innerHTML = this.fullscreenActive ? ICON_FULLSCREEN_EXIT : ICON_FULLSCREEN_ENTER;
    this.fullscreenOrb.setAttribute(
      'aria-label',
      this.fullscreenActive ? 'Exit Fullscreen' : 'Enter Fullscreen'
    );
    this.optionsOrb.dataset['active'] = String(this.optionsOpen);
    this.showcaseSheet.hidden = !this.showcaseOpen;
    this.optionsSheet.hidden = !this.optionsOpen;

    this.bottomZone.dataset['hidden'] = String(inArbiter);
    const navyAlive = Math.max(0, 21 - view.playerCasualties.length);
    const crimsonAlive = Math.max(0, 21 - view.enemyCasualties.length);
    this.tallyNavyVal.textContent = String(navyAlive);
    this.tallyCrimsonVal.textContent = String(crimsonAlive);

    if (view.cameraMode === 'INSPECT_16') {
      this.islandEl.dataset['empty'] = 'false';
      this.islandNameEl.innerHTML = `<span class="island-metal-pip" data-metal="BRASS"></span> 16 RANK RELIEFS`;
      this.islandRuleEl.textContent = '4-Angle Wedge Turnaround & Insignias';
    } else if (view.selectedPieceId) {
      const sel = view.pieces.find((p) => p.id === view.selectedPieceId);
      if (sel && sel.visibleRank !== 'UNKNOWN') {
        const spec = RANK_SPECS[sel.visibleRank];
        this.islandEl.dataset['empty'] = 'false';
        this.islandNameEl.innerHTML = `<span class="island-metal-pip" data-metal="${spec.metal}"></span> ${spec.name}`;
        this.islandRuleEl.textContent = spec.tacticalRule;
      } else {
        this.islandEl.dataset['empty'] = 'true';
      }
    } else {
      this.islandEl.dataset['empty'] = 'true';
    }

    const inspectBtn = this.root.querySelector<HTMLButtonElement>('#btn-inspect-16');
    if (inspectBtn) {
      inspectBtn.textContent =
        view.cameraMode === 'INSPECT_16' ? 'Back to Board' : '16-Rank Gallery';
    }

    this.syncSeg('#seg-fullscreen button', 'fs', String(this.fullscreenActive));
    this.syncSeg('#seg-view button', 'view', options.boardView);
    this.syncSeg('#seg-era button', 'era', options.eraMode);
    this.syncSeg('#seg-speed button', 'speed', options.arbiterSpeed);
    this.syncSeg('#seg-quality button', 'quality', options.renderQuality);
    this.syncSeg('#seg-mute button', 'mute', String(options.audioMuted));
  }

  private setFullscreenState(desired: boolean): void {
    this.fullscreenActive = desired;
    document.body.classList.toggle('is-fullscreen', desired);

    const doc = document as WebkitDocument;
    const docEl = document.documentElement as WebkitHTMLElement;
    const osFsElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

    if (desired && !osFsElement) {
      try {
        if (typeof docEl.requestFullscreen === 'function') {
          void docEl.requestFullscreen().catch(() => {
            // In embedded webviews / iOS Safari where OS fullscreen is restricted,
            // `body.is-fullscreen` still expands `#app-chassis` to 100vw x 100dvh edge-to-edge!
          });
        } else if (typeof docEl.webkitRequestFullscreen === 'function') {
          void docEl.webkitRequestFullscreen();
        }
      } catch {
        // Fallback to full-viewport CSS expansion already active
      }
    } else if (!desired && osFsElement) {
      try {
        if (typeof doc.exitFullscreen === 'function') {
          void doc.exitFullscreen().catch(() => {});
        } else if (typeof doc.webkitExitFullscreen === 'function') {
          void doc.webkitExitFullscreen();
        }
      } catch {
        // Ignore
      }
    }

    this.render(this.store.getVisibleView(), this.store.getOptions());
  }

  private bindEvents(): void {
    this.showcaseOrb.addEventListener('click', () => {
      this.sound.playSelect();
      this.showcaseOpen = !this.showcaseOpen;
      if (this.showcaseOpen) this.optionsOpen = false;
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.viewOrb.addEventListener('click', () => {
      this.sound.playSelect();
      this.store.cycleBoardView();
    });

    this.fullscreenOrb.addEventListener('click', () => {
      this.sound.playSelect();
      this.setFullscreenState(!this.fullscreenActive);
    });

    this.optionsOrb.addEventListener('click', () => {
      this.sound.playSelect();
      this.optionsOpen = !this.optionsOpen;
      if (this.optionsOpen) this.showcaseOpen = false;
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    const onFsChange = () => {
      const doc = document as WebkitDocument;
      const osActive = Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
      // If user exited OS fullscreen via Esc key, sync state back to framed cleanly
      if (!osActive && this.fullscreenActive) {
        this.fullscreenActive = false;
        document.body.classList.remove('is-fullscreen');
        this.render(this.store.getVisibleView(), this.store.getOptions());
      } else if (osActive && !this.fullscreenActive) {
        this.fullscreenActive = true;
        document.body.classList.add('is-fullscreen');
        this.render(this.store.getVisibleView(), this.store.getOptions());
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    window.addEventListener('keydown', (ev) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'f' || ev.key === 'F') {
        this.sound.playSelect();
        this.setFullscreenState(!this.fullscreenActive);
      } else if (ev.key === 'Escape' && this.fullscreenActive) {
        this.setFullscreenState(false);
      }
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-fullscreen button').forEach((b) => {
      b.addEventListener('click', () => {
        const wantFs = b.dataset['fs'] === 'true';
        this.sound.playSelect();
        this.setFullscreenState(wantFs);
      });
    });

    this.showcaseSheet.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset['preset'] as ShowcasePreset;
        this.showcaseOpen = false;
        const verdict = this.store.triggerShowcaseClash(preset);
        if (verdict) {
          this.onTriggerVerdict(verdict);
        }
      });
    });

    this.root.querySelector('#btn-inspect-16')?.addEventListener('click', () => {
      this.sound.playSelect();
      this.showcaseOpen = false;
      const cur = this.store.getVisibleView().cameraMode;
      this.store.setCameraMode(cur === 'INSPECT_16' ? 'PLAY' : 'INSPECT_16');
    });

    this.root.querySelector('#btn-reset-board')?.addEventListener('click', () => {
      this.sound.playSelect();
      this.showcaseOpen = false;
      this.store.resetSandbox();
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-view button').forEach((b) => {
      b.addEventListener('click', () => {
        const boardView = b.dataset['view'] as BoardViewAngle;
        this.sound.playSelect();
        if (this.store.getVisibleView().cameraMode === 'INSPECT_16') {
          this.store.setCameraMode('PLAY');
        }
        this.store.updateOptions({ boardView });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-era button').forEach((b) => {
      b.addEventListener('click', () => {
        const era = b.dataset['era'] as AppOptions['eraMode'];
        this.sound.setEraMode(era);
        this.sound.playSelect();
        this.store.updateOptions({ eraMode: era });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-speed button').forEach((b) => {
      b.addEventListener('click', () => {
        const speed = b.dataset['speed'] as AppOptions['arbiterSpeed'];
        this.sound.playSelect();
        this.store.updateOptions({ arbiterSpeed: speed });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-quality button').forEach((b) => {
      b.addEventListener('click', () => {
        const quality = b.dataset['quality'] as AppOptions['renderQuality'];
        this.sound.playSelect();
        this.store.updateOptions({ renderQuality: quality });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-mute button').forEach((b) => {
      b.addEventListener('click', () => {
        const muted = b.dataset['mute'] === 'true';
        this.sound.setMuted(muted);
        if (!muted) this.sound.playSelect();
        this.store.updateOptions({ audioMuted: muted });
      });
    });
  }

  private syncSeg(selector: string, dataKey: string, expected: string): void {
    this.root.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.dataset['selected'] = String(btn.dataset[dataKey] === expected);
    });
  }
}
