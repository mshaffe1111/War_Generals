import type { SoundDirector } from '../audio/SoundDirector';
import { ORDERED_RANKS, RANK_SPECS, type RankId } from '../core/ranks';
import { ARMY_PIECE_TOTAL } from '../core/RulesEngine';
import type {
  AppOptions,
  ArbiterVerdict,
  BoardViewAngle,
  DeploymentPresetId,
  PlayerVisibleView,
  SuspectTag,
} from '../core/types';
import type { GameStore, ShowcasePreset } from '../state/GameStore';

const VIEW_DEGREE_BADGE: Readonly<Record<BoardViewAngle, string>> = {
  COMMAND: '40°',
  TACTICAL: '32°',
  OVERHEAD: '62°',
};

const COMPACT_CHIP_LABEL: Readonly<Record<RankId, string>> = {
  GEN_5: '5★',
  GEN_4: '4★',
  GEN_3: '3★',
  GEN_2: '2★',
  GEN_1: '1★',
  COLONEL: 'COL',
  LT_COLONEL: 'LTC',
  MAJOR: 'MAJ',
  CAPTAIN: 'CPT',
  LT_1ST: '1LT',
  LT_2ND: '2LT',
  SERGEANT: 'SGT',
  PRIVATE: 'PVT',
  SPY: 'SPY',
  FLAG: 'FLG',
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

export interface HudCallbacks {
  readonly onTriggerVerdict: (verdict: ArbiterVerdict) => void;
  readonly onStartCrateDrag: (rank: RankId, clientX: number, clientY: number) => void;
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly sound: SoundDirector;
  private readonly callbacks: HudCallbacks;

  private showcaseOpen = false;
  private optionsOpen = false;
  private fullscreenActive = false;
  private saveSlotArmed = false;
  private suspectTargetPieceId: string | null = null;

  private readonly spatialHeader: HTMLElement;
  private readonly spatialTitle: HTMLElement;
  private readonly showcaseOrb: HTMLButtonElement;
  private readonly viewOrb: HTMLButtonElement;
  private readonly viewBadge: HTMLElement;
  private readonly fullscreenOrb: HTMLButtonElement;
  private readonly optionsOrb: HTMLButtonElement;
  private readonly showcaseSheet: HTMLElement;
  private readonly optionsSheet: HTMLElement;

  // Deployment Crate Drawer Elements
  private readonly mobilizationDrawer: HTMLElement;
  private readonly deployCountBadge: HTMLElement;
  private readonly saveModeBtn: HTMLButtonElement;
  private readonly rankChipContainer: HTMLElement;
  private readonly launchBattleBtn: HTMLButtonElement;

  // Radial Suspect Wheel
  private readonly suspectWheel: HTMLElement;

  // Game Over & Declassified Replay Scrubber
  private readonly gameOverBar: HTMLElement;
  private readonly gameOverReason: HTMLElement;
  private readonly replayBar: HTMLElement;
  private readonly replayTicker: HTMLElement;
  private readonly replayTurnLabel: HTMLElement;
  private readonly replaySlider: HTMLInputElement;
  private readonly replayPlayBtn: HTMLButtonElement;

  // Active Play Bottom Dynamic Island & Tallies
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
    callbacks: HudCallbacks
  ) {
    this.root = root;
    this.store = store;
    this.sound = sound;
    this.callbacks = callbacks;

    const chipsHtml = ORDERED_RANKS.map((r) => {
      const spec = RANK_SPECS[r];
      return `
        <button type="button" class="crate-rank-chip" data-rank="${r}" title="${spec.name}">
          <span class="chip-metal-dot" data-metal="${spec.metal}"></span>
          <span class="chip-code">${COMPACT_CHIP_LABEL[r]}</span>
          <span class="chip-qty" data-qty-for="${r}">×${spec.countPerArmy}</span>
        </button>
      `;
    }).join('');

    const suspectOptions: Array<{ label: string; tag: SuspectTag | '' }> = [
      { label: 'SPY?', tag: 'SPY?' },
      { label: 'GEN?', tag: 'GEN?' },
      { label: 'OFF?', tag: 'OFF?' },
      { label: 'PVT?', tag: 'PVT?' },
      { label: 'FLAG?', tag: 'FLAG?' },
      { label: '✕', tag: '' },
    ];
    const wheelButtonsHtml = suspectOptions
      .map((opt, idx) => {
        const ang = (idx / suspectOptions.length) * Math.PI * 2 - Math.PI / 2;
        const rx = Math.round(Math.cos(ang) * 58);
        const ry = Math.round(Math.sin(ang) * 58);
        return `
          <button
            type="button"
            class="suspect-orb"
            data-suspect="${opt.tag}"
            style="transform: translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px));"
          >${opt.label}</button>
        `;
      })
      .join('');

    this.root.innerHTML = `
      <div class="hud-top-stack">
        <div class="hud-top-row">
          <div class="hud-orb-cluster">
            <button type="button" class="hud-orb" id="btn-showcase" aria-label="Battle Arena Showcase" title="Battle Showcase, Replay & Rank Gallery">
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
            <button type="button" class="pill-action" id="btn-xray-replay" data-tone="cyan">Declassified X-Ray</button>
            <button type="button" class="pill-action" id="btn-inspect-16" data-tone="cyan">16-Rank Gallery</button>
            <button type="button" class="pill-action" id="btn-reset-board">New Deployment</button>
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
            <span>Era Score</span>
            <div class="seg-track" id="seg-era">
              <button type="button" data-era="1980s">1980s Synth</button>
              <button type="button" data-era="1970s">1970s Brass</button>
            </div>
          </div>
          <div class="setting-row">
            <span>Music</span>
            <input type="range" class="bus-slider" id="slider-music" min="0" max="100" step="5" value="85" aria-label="Music Bus Volume" />
          </div>
          <div class="setting-row">
            <span>SFX</span>
            <input type="range" class="bus-slider" id="slider-sfx" min="0" max="100" step="5" value="95" aria-label="SFX Bus Volume" />
          </div>
          <div class="setting-row">
            <span>Ambiance</span>
            <input type="range" class="bus-slider" id="slider-ambiance" min="0" max="100" step="5" value="75" aria-label="Ambiance Bus Volume" />
          </div>
          <div class="setting-row">
            <span>Haptics</span>
            <div class="seg-track" id="seg-haptics">
              <button type="button" data-haptics="true">On</button>
              <button type="button" data-haptics="false">Off</button>
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
            <span>Master</span>
            <div class="seg-track" id="seg-mute">
              <button type="button" data-mute="false">On</button>
              <button type="button" data-mute="true">Mute</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Radial Brass Deduction Wheel (320ms Long-Press or Double-Tap on Enemy Wedge) -->
      <div class="suspect-wheel" id="suspect-wheel" hidden>
        <div class="suspect-wheel-hub">TAG</div>
        ${wheelButtonsHtml}
      </div>

      <div class="hud-bottom-stack">
        <!-- Pre-Match Velvet Mobilization Crate Drawer -->
        <div class="mobilization-drawer" id="mobilization-drawer" hidden>
          <div class="mob-top-bar">
            <div class="mob-title-group">
              <span class="mob-label">MOBILIZATION</span>
              <span class="mob-count-pill" id="mob-count-pill">0 / 21</span>
            </div>
            <div class="mob-util-group">
              <button type="button" class="mob-mini-pill" id="btn-dep-auto" data-tone="cyan">Auto</button>
              <button type="button" class="mob-mini-pill" id="btn-dep-mirror">Mirror ⇄</button>
              <button type="button" class="mob-mini-pill" id="btn-dep-clear">Clear</button>
            </div>
          </div>

          <div class="mob-toolbar-rows">
            <div class="mob-preset-row">
              <button type="button" class="mob-preset-pill" data-dep-preset="VACCINATION">Vaccination</button>
              <button type="button" class="mob-preset-pill" data-dep-preset="MOTHERSHIP">Mothership</button>
              <button type="button" class="mob-preset-pill" data-dep-preset="IRON_BLITZ">Iron Blitz</button>
              <button type="button" class="mob-preset-pill" data-dep-preset="MIRAGE_DECOY">Mirage</button>
            </div>
            <div class="mob-blueprint-row">
              <span class="mob-sub-label">SLOTS</span>
              <div class="mob-slot-group">
                <button type="button" class="mob-slot-save-toggle" id="btn-arm-save" title="Save current 21/21 formation into Slot 1–5">Save</button>
                <button type="button" class="mob-slot-pill" data-slot="0">S1</button>
                <button type="button" class="mob-slot-pill" data-slot="1">S2</button>
                <button type="button" class="mob-slot-pill" data-slot="2">S3</button>
                <button type="button" class="mob-slot-pill" data-slot="3">S4</button>
                <button type="button" class="mob-slot-pill" data-slot="4">S5</button>
              </div>
            </div>
          </div>

          <div class="mob-chip-grid" id="mob-chip-grid">
            ${chipsHtml}
          </div>

          <button type="button" class="mob-launch-btn" id="btn-launch-battle" disabled>
            DEPLOY 21 UNITS TO LAUNCH
          </button>
        </div>

        <!-- Post-Match Outcome Capsule -->
        <div class="gameover-capsule" id="gameover-bar" hidden>
          <div class="gameover-reason" id="gameover-reason">Enemy Flag eliminated in combat</div>
          <div class="gameover-actions">
            <button type="button" class="pill-action" id="btn-gameover-replay" data-tone="cyan">Declassified X-Ray Replay</button>
            <button type="button" class="pill-action" id="btn-gameover-new" data-tone="gold">New Deployment</button>
          </div>
        </div>

        <!-- Post-Match Declassified X-Ray Replay Theater Scrubber -->
        <div class="replay-capsule" id="replay-bar" hidden>
          <div class="replay-top-row">
            <span class="replay-turn-badge" id="replay-turn-label">PLY 0 / 0</span>
            <span class="replay-ticker" id="replay-ticker">T0: Armies Deployed</span>
          </div>
          <input type="range" class="bus-slider replay-scrubber" id="replay-slider" min="0" max="1" step="1" value="0" aria-label="Replay Timeline Scrubber" />
          <div class="replay-controls-row">
            <button type="button" class="hud-orb replay-orb" id="btn-rep-start" title="First Turn">|&lt;</button>
            <button type="button" class="hud-orb replay-orb" id="btn-rep-prev" title="Previous Turn">&lt;</button>
            <button type="button" class="hud-orb replay-orb" id="btn-rep-play" data-active="false" title="Play / Pause">▶</button>
            <button type="button" class="hud-orb replay-orb" id="btn-rep-next" title="Next Turn">&gt;</button>
            <button type="button" class="hud-orb replay-orb" id="btn-rep-end" title="Final Turn">&gt;|</button>
            <button type="button" class="pill-action" id="btn-rep-exit" data-tone="gold">New Match</button>
          </div>
        </div>

        <!-- Active Play Bottom Dynamic Island + Corner Tallies -->
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

    this.mobilizationDrawer = this.root.querySelector('#mobilization-drawer')!;
    this.deployCountBadge = this.root.querySelector('#mob-count-pill')!;
    this.saveModeBtn = this.root.querySelector('#btn-arm-save')!;
    this.rankChipContainer = this.root.querySelector('#mob-chip-grid')!;
    this.launchBattleBtn = this.root.querySelector('#btn-launch-battle')!;

    this.suspectWheel = this.root.querySelector('#suspect-wheel')!;

    this.gameOverBar = this.root.querySelector('#gameover-bar')!;
    this.gameOverReason = this.root.querySelector('#gameover-reason')!;
    this.replayBar = this.root.querySelector('#replay-bar')!;
    this.replayTicker = this.root.querySelector('#replay-ticker')!;
    this.replayTurnLabel = this.root.querySelector('#replay-turn-label')!;
    this.replaySlider = this.root.querySelector('#replay-slider')!;
    this.replayPlayBtn = this.root.querySelector('#btn-rep-play')!;

    this.bottomZone = this.root.querySelector('#hud-bottom-zone')!;
    this.islandEl = this.root.querySelector('#hud-island')!;
    this.islandNameEl = this.root.querySelector('#island-rank-name')!;
    this.islandRuleEl = this.root.querySelector('#island-rule')!;
    this.tallyNavyVal = this.root.querySelector('#tally-navy-val')!;
    this.tallyCrimsonVal = this.root.querySelector('#tally-crimson-val')!;

    this.bindEvents();
  }

  public openSuspectWheel(pieceId: string, clientX: number, clientY: number): void {
    this.suspectTargetPieceId = pieceId;
    const hostRect = this.root.getBoundingClientRect();
    const localX = THREE.ClampCoord(clientX - hostRect.left, 82, Math.max(82, hostRect.width - 82));
    const localY = THREE.ClampCoord(clientY - hostRect.top, 82, Math.max(82, hostRect.height - 82));
    this.suspectWheel.style.left = `${localX}px`;
    this.suspectWheel.style.top = `${localY}px`;
    this.suspectWheel.hidden = false;
  }

  public closeSuspectWheel(): void {
    this.suspectTargetPieceId = null;
    this.suspectWheel.hidden = true;
  }

  public render(view: PlayerVisibleView, options: Readonly<AppOptions>): void {
    const inArbiter = view.cameraMode === 'ARBITER';
    const inInspect = view.cameraMode === 'INSPECT_16';
    const inDeploy = view.phase === 'DEPLOY' && !inInspect && !inArbiter;
    const inReplay = view.phase === 'REPLAY' && !inInspect;
    const inGameOver = view.phase === 'GAME_OVER' && !inInspect && !inArbiter;

    if (view.banner === 'TACTICAL COMMAND' || view.banner === 'SELECT TARGET') {
      this.spatialTitle.textContent = 'WAR GENERALS';
    } else if (view.banner === 'ARBITRATING') {
      this.spatialTitle.textContent = 'LIVE FIRE EXCHANGE';
    } else if (view.banner === 'DECLASSIFIED X-RAY REPLAY') {
      this.spatialTitle.textContent = 'DECLASSIFIED REPLAY';
    } else {
      this.spatialTitle.textContent = view.banner;
    }

    if (
      view.banner === 'BATTLE WINNER' ||
      view.banner === 'SPY INTERCEPTED — VICTORY' ||
      view.banner === 'FLAG CAPTURED — VICTORY' ||
      view.banner === 'FLAG TRAVERSE — VICTORY'
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
      this.closeSuspectWheel();
    }

    this.viewBadge.textContent = VIEW_DEGREE_BADGE[options.boardView];
    this.showcaseOrb.dataset['active'] = String(this.showcaseOpen || inInspect || inReplay);
    this.fullscreenOrb.dataset['active'] = String(this.fullscreenActive);
    this.fullscreenOrb.innerHTML = this.fullscreenActive
      ? ICON_FULLSCREEN_EXIT
      : ICON_FULLSCREEN_ENTER;
    this.fullscreenOrb.setAttribute(
      'aria-label',
      this.fullscreenActive ? 'Exit Fullscreen' : 'Enter Fullscreen'
    );
    this.optionsOrb.dataset['active'] = String(this.optionsOpen);
    this.showcaseSheet.hidden = !this.showcaseOpen;
    this.optionsSheet.hidden = !this.optionsOpen;

    // 1. Sync Pre-Match Mobilization Crate Drawer
    this.mobilizationDrawer.hidden = !inDeploy;
    if (inDeploy) {
      const ready = view.deployedCount === ARMY_PIECE_TOTAL;
      this.deployCountBadge.textContent = `${view.deployedCount} / ${ARMY_PIECE_TOTAL}`;
      this.deployCountBadge.dataset['ready'] = String(ready);

      if (!ready) this.saveSlotArmed = false;
      this.saveModeBtn.dataset['armed'] = String(this.saveSlotArmed);
      this.saveModeBtn.disabled = !ready;

      this.mobilizationDrawer
        .querySelectorAll<HTMLButtonElement>('.mob-slot-pill')
        .forEach((btn) => {
          const idx = Number(btn.dataset['slot'] ?? 0);
          btn.dataset['saved'] = String(Boolean(view.savedBlueprintSlots[idx]));
        });

      this.rankChipContainer
        .querySelectorAll<HTMLButtonElement>('.crate-rank-chip')
        .forEach((chip) => {
          const r = chip.dataset['rank'] as RankId;
          const rem = view.unplacedCounts[r] ?? 0;
          chip.dataset['selected'] = String(view.selectedDeployRank === r && rem > 0);
          chip.dataset['depleted'] = String(rem <= 0);
          const qtyEl = chip.querySelector<HTMLElement>(`[data-qty-for="${r}"]`);
          if (qtyEl) qtyEl.textContent = `×${rem}`;
        });

      this.launchBattleBtn.disabled = !ready;
      this.launchBattleBtn.textContent = ready
        ? 'READY TO LAUNCH — ENGAGE'
        : `DEPLOY ${ARMY_PIECE_TOTAL - view.deployedCount} MORE TO LAUNCH`;
    }

    // 2. Sync Post-Match Outcome Capsule
    this.gameOverBar.hidden = !inGameOver;
    if (inGameOver) {
      this.gameOverReason.textContent = view.winReason ?? 'Match Concluded';
    }

    // 3. Sync Declassified X-Ray Replay Scrubber
    this.replayBar.hidden = !inReplay || !view.replay;
    if (inReplay && view.replay) {
      const rep = view.replay;
      const curEntry = rep.plies[rep.currentPly];
      this.replayTurnLabel.textContent = `PLY ${rep.currentPly} / ${rep.maxPly}`;
      this.replayTicker.textContent = curEntry?.summary ?? 'Declassified Log';
      this.replaySlider.max = String(Math.max(1, rep.maxPly));
      this.replaySlider.value = String(rep.currentPly);
      this.replayPlayBtn.textContent = rep.playing ? '❚❚' : '▶';
      this.replayPlayBtn.dataset['active'] = String(rep.playing);
    }

    // 4. Sync Active Play Bottom Zone
    const showPlayBottom = !inArbiter && !inDeploy && !inReplay && !inGameOver;
    this.bottomZone.hidden = !showPlayBottom;
    this.bottomZone.dataset['hidden'] = String(!showPlayBottom);

    const navyAlive = Math.max(0, ARMY_PIECE_TOTAL - view.playerCasualties.length);
    const crimsonAlive = Math.max(0, ARMY_PIECE_TOTAL - view.enemyCasualties.length);
    this.tallyNavyVal.textContent = String(navyAlive);
    this.tallyCrimsonVal.textContent = String(crimsonAlive);

    if (inInspect) {
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
      inspectBtn.textContent = inInspect ? 'Back to Board' : '16-Rank Gallery';
    }

    this.syncSeg('#seg-fullscreen button', 'fs', String(this.fullscreenActive));
    this.syncSeg('#seg-view button', 'view', options.boardView);
    this.syncSeg('#seg-era button', 'era', options.eraMode);
    this.syncSeg('#seg-haptics button', 'haptics', String(options.hapticsEnabled));
    this.syncSeg('#seg-speed button', 'speed', options.arbiterSpeed);
    this.syncSeg('#seg-quality button', 'quality', options.renderQuality);
    this.syncSeg('#seg-mute button', 'mute', String(options.audioMuted));

    const mSlider = this.root.querySelector<HTMLInputElement>('#slider-music');
    if (mSlider) mSlider.value = String(Math.round(options.musicVolume * 100));
    const sSlider = this.root.querySelector<HTMLInputElement>('#slider-sfx');
    if (sSlider) sSlider.value = String(Math.round(options.sfxVolume * 100));
    const aSlider = this.root.querySelector<HTMLInputElement>('#slider-ambiance');
    if (aSlider) aSlider.value = String(Math.round(options.ambianceVolume * 100));
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
          void docEl.requestFullscreen().catch(() => {});
        } else if (typeof docEl.webkitRequestFullscreen === 'function') {
          void docEl.webkitRequestFullscreen();
        }
      } catch {
        // Fallback CSS full-bleed already active
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
      this.showcaseOpen = !this.showcaseOpen;
      if (this.showcaseOpen) this.optionsOpen = false;
      this.closeSuspectWheel();
      this.sound.playDrawerSlide(this.showcaseOpen);
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.viewOrb.addEventListener('click', () => {
      this.sound.playUiClick();
      this.store.cycleBoardView();
    });

    this.fullscreenOrb.addEventListener('click', () => {
      this.sound.playUiClick();
      this.setFullscreenState(!this.fullscreenActive);
    });

    this.optionsOrb.addEventListener('click', () => {
      this.optionsOpen = !this.optionsOpen;
      if (this.optionsOpen) this.showcaseOpen = false;
      this.closeSuspectWheel();
      this.sound.playDrawerSlide(this.optionsOpen);
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    // Dismiss Radial Suspect Wheel when tapping outside it
    window.addEventListener('pointerdown', (ev) => {
      if (!this.suspectWheel.hidden && !this.suspectWheel.contains(ev.target as Node)) {
        this.closeSuspectWheel();
      }
    });

    this.suspectWheel.querySelectorAll<HTMLButtonElement>('.suspect-orb').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const raw = btn.dataset['suspect'] ?? '';
        const tag = raw ? (raw as SuspectTag) : null;
        if (this.suspectTargetPieceId) {
          this.sound.playMagneticSnap();
          this.sound.vibrate(10);
          this.store.setEnemySuspectTag(this.suspectTargetPieceId, tag);
        }
        this.closeSuspectWheel();
      });
    });

    // Mobilization Crate Drawer Controls & Drag-Out Gesture!
    this.root.querySelector('#btn-dep-auto')?.addEventListener('click', () => {
      this.sound.playDrawerSlide(true);
      this.store.autoDeployPlayer();
    });

    this.root.querySelector('#btn-dep-mirror')?.addEventListener('click', () => {
      this.sound.playMagneticSnap();
      this.sound.vibrate(10);
      this.store.mirrorPlayerDeployment();
    });

    this.root.querySelector('#btn-dep-clear')?.addEventListener('click', () => {
      this.sound.playDrawerSlide(false);
      this.store.clearPlayerDeployment();
    });

    this.mobilizationDrawer
      .querySelectorAll<HTMLButtonElement>('[data-dep-preset]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.dataset['depPreset'] as DeploymentPresetId;
          this.sound.playDrawerSlide(true);
          this.store.applyDeploymentPreset(preset);
        });
      });

    this.saveModeBtn.addEventListener('click', () => {
      this.sound.playUiClick();
      this.saveSlotArmed = !this.saveSlotArmed;
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.mobilizationDrawer.querySelectorAll<HTMLButtonElement>('.mob-slot-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slotIdx = Number(btn.dataset['slot'] ?? 0);
        const view = this.store.getVisibleView();
        // Save if Save mode is armed OR if 21/21 deployed and tapping an empty slot!
        if (this.saveSlotArmed || (view.deployedCount === ARMY_PIECE_TOTAL && !view.savedBlueprintSlots[slotIdx])) {
          if (this.store.saveBlueprintToSlot(slotIdx)) {
            this.saveSlotArmed = false;
            this.sound.playMagneticSnap();
            this.sound.vibrate(18);
            this.render(this.store.getVisibleView(), this.store.getOptions());
          }
        } else if (this.store.loadBlueprintFromSlot(slotIdx)) {
          this.sound.playDrawerSlide(true);
        }
      });
    });

    // Rank Chip Tap + Direct Upward Drag-Out into 3D Hologram!
    this.rankChipContainer
      .querySelectorAll<HTMLButtonElement>('.crate-rank-chip')
      .forEach((chip) => {
        let chipDownId: number | null = null;
        let sx = 0;
        let sy = 0;
        let dragStarted = false;

        chip.addEventListener('pointerdown', (ev: PointerEvent) => {
          const rank = chip.dataset['rank'] as RankId;
          const rem = this.store.getVisibleView().unplacedCounts[rank] ?? 0;
          if (rem <= 0) return;
          this.sound.unlock();
          chipDownId = ev.pointerId;
          sx = ev.clientX;
          sy = ev.clientY;
          dragStarted = false;
        });

        window.addEventListener('pointermove', (ev: PointerEvent) => {
          if (chipDownId !== ev.pointerId || dragStarted) return;
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 9) {
            dragStarted = true;
            chipDownId = null;
            const rank = chip.dataset['rank'] as RankId;
            this.callbacks.onStartCrateDrag(rank, ev.clientX, ev.clientY);
          }
        });

        const endChipTouch = (ev: PointerEvent) => {
          if (chipDownId !== ev.pointerId) return;
          chipDownId = null;
          if (!dragStarted) {
            const rank = chip.dataset['rank'] as RankId;
            this.sound.playPiecePickup();
            this.store.selectDeployRank(rank);
          }
        };
        window.addEventListener('pointerup', endChipTouch);
        window.addEventListener('pointercancel', () => {
          chipDownId = null;
        });
      });

    this.launchBattleBtn.addEventListener('click', () => {
      if (this.store.launchBattleFromDeployment()) {
        this.sound.playDrawerSlide(false);
        this.sound.vibrate([25, 30, 45]);
      }
    });

    // Game-Over & Declassified X-Ray Replay Controls
    const openReplay = () => {
      this.showcaseOpen = false;
      this.optionsOpen = false;
      this.sound.playDrawerSlide(true);
      this.store.enterDeclassifiedReplay();
    };
    this.root.querySelector('#btn-xray-replay')?.addEventListener('click', openReplay);
    this.root.querySelector('#btn-gameover-replay')?.addEventListener('click', openReplay);

    const startFreshDeploy = () => {
      this.showcaseOpen = false;
      this.optionsOpen = false;
      this.sound.playDrawerSlide(true);
      this.store.startNewDeployment();
    };
    this.root.querySelector('#btn-gameover-new')?.addEventListener('click', startFreshDeploy);
    this.root.querySelector('#btn-rep-exit')?.addEventListener('click', startFreshDeploy);

    this.replaySlider.addEventListener('input', () => {
      this.sound.playUiClick();
      this.store.setReplayPly(Number(this.replaySlider.value));
    });
    this.root.querySelector('#btn-rep-start')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.store.setReplayPly(0);
    });
    this.root.querySelector('#btn-rep-prev')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.store.stepReplay(-1);
    });
    this.replayPlayBtn.addEventListener('click', () => {
      this.sound.playUiClick();
      this.store.toggleReplayAutoPlay();
    });
    this.root.querySelector('#btn-rep-next')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.store.stepReplay(1);
    });
    this.root.querySelector('#btn-rep-end')?.addEventListener('click', () => {
      this.sound.playUiClick();
      const maxPly = this.store.getVisibleView().replay?.maxPly ?? 0;
      this.store.setReplayPly(maxPly);
    });

    const onFsChange = () => {
      const doc = document as WebkitDocument;
      const osActive = Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
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
        this.sound.playUiClick();
        this.setFullscreenState(!this.fullscreenActive);
      } else if (ev.key === 'Escape') {
        this.closeSuspectWheel();
        if (this.fullscreenActive) this.setFullscreenState(false);
      }
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-fullscreen button').forEach((b) => {
      b.addEventListener('click', () => {
        const wantFs = b.dataset['fs'] === 'true';
        this.sound.playUiClick();
        this.setFullscreenState(wantFs);
      });
    });

    this.showcaseSheet.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset['preset'] as ShowcasePreset;
        this.showcaseOpen = false;
        const verdict = this.store.triggerShowcaseClash(preset);
        if (verdict) {
          this.callbacks.onTriggerVerdict(verdict);
        }
      });
    });

    this.root.querySelector('#btn-inspect-16')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.showcaseOpen = false;
      const cur = this.store.getVisibleView().cameraMode;
      this.store.setCameraMode(cur === 'INSPECT_16' ? 'PLAY' : 'INSPECT_16');
    });

    this.root.querySelector('#btn-reset-board')?.addEventListener('click', startFreshDeploy);

    this.root.querySelectorAll<HTMLButtonElement>('#seg-view button').forEach((b) => {
      b.addEventListener('click', () => {
        const boardView = b.dataset['view'] as BoardViewAngle;
        this.sound.playUiClick();
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
        this.sound.playUiClick();
        this.store.updateOptions({ eraMode: era });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-speed button').forEach((b) => {
      b.addEventListener('click', () => {
        const speed = b.dataset['speed'] as AppOptions['arbiterSpeed'];
        this.sound.playUiClick();
        this.store.updateOptions({ arbiterSpeed: speed });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-quality button').forEach((b) => {
      b.addEventListener('click', () => {
        const quality = b.dataset['quality'] as AppOptions['renderQuality'];
        this.sound.playUiClick();
        this.store.updateOptions({ renderQuality: quality });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-mute button').forEach((b) => {
      b.addEventListener('click', () => {
        const muted = b.dataset['mute'] === 'true';
        this.sound.setMuted(muted);
        if (!muted) this.sound.playUiClick();
        this.store.updateOptions({ audioMuted: muted });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-haptics button').forEach((b) => {
      b.addEventListener('click', () => {
        const hapticsEnabled = b.dataset['haptics'] === 'true';
        this.store.updateOptions({ hapticsEnabled });
        if (hapticsEnabled) this.sound.playUiClick();
      });
    });

    const bindBusSlider = (id: string, key: 'musicVolume' | 'sfxVolume' | 'ambianceVolume') => {
      const el = this.root.querySelector<HTMLInputElement>(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const val = Math.max(0, Math.min(1, Number(el.value) / 100));
        this.sound.unlock();
        this.store.updateOptions({ [key]: val });
      });
      el.addEventListener('change', () => {
        this.sound.playUiClick();
      });
    };
    bindBusSlider('#slider-music', 'musicVolume');
    bindBusSlider('#slider-sfx', 'sfxVolume');
    bindBusSlider('#slider-ambiance', 'ambianceVolume');
  }

  private syncSeg(selector: string, dataKey: string, expected: string): void {
    this.root.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.dataset['selected'] = String(btn.dataset[dataKey] === expected);
    });
  }
}

const THREE = {
  ClampCoord: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
};
