import type { SoundDirector } from '../audio/SoundDirector';
import {
  COMMANDER_ROSTER,
  getCommanderProfile,
  type CommanderId,
} from '../ai/CommanderProfiles';
import { PIECE_COLOR_ORDER, PIECE_COLOR_SPECS } from '../core/pieceColors';
import { getTacticalOperation, TACTICAL_OPERATIONS } from '../core/operations';
import { ORDERED_RANKS, RANK_SPECS, type RankId } from '../core/ranks';
import {
  ARMY_PIECE_TOTAL,
  DEPLOYMENT_PRESET_META,
  TOURNAMENT_PRESETS,
} from '../core/RulesEngine';
import { BATTLE_THEATERS, getBattleTheater } from '../core/theaters';
import type {
  AppOptions,
  ArbiterVerdict,
  BoardViewAngle,
  DeploymentPresetId,
  PieceColorId,
  PlayerVisibleView,
  QualityTier,
  SuspectTag,
  TheaterId,
  ViewportFrameMode,
} from '../core/types';
import type { GameStore, ShowcasePreset } from '../state/GameStore';

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

const ICON_AUDIO_ON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a10 10 0 0 1 0 14" />
  </svg>
`;

const ICON_AUDIO_MUTED = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
`;

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

const ICON_REFRESH = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <polyline points="21 3 21 9 15 9" />
  </svg>
`;

const LOCAL_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
const LOCAL_BUILD_SHORT = (LOCAL_BUILD_ID.split('-').pop() || LOCAL_BUILD_ID)
  .slice(0, 6)
  .toUpperCase();

interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitHTMLElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

function clampVal(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function renderStarsText(stars: number): string {
  const s = Math.max(0, Math.min(3, stars));
  return `${'★'.repeat(s)}${'☆'.repeat(3 - s)}`;
}

export interface UIManagerCallbacks {
  readonly onTriggerVerdict: (verdict: ArbiterVerdict) => void;
  readonly onStartCrateDrag: (rank: RankId, clientX: number, clientY: number) => void;
  readonly onSkipArbiter?: () => void;
  readonly onResetCamera?: () => void;
}

type TitleSubView = 'ROOT' | 'SKIRMISH' | 'CAMPAIGN' | 'OPERATIONS';
type ActiveDrawer = 'NONE' | 'INTEL' | 'LOG' | 'OPTIONS' | 'SHOWCASE';
type OptionsTab = 'RULES' | 'AUDIO_GPU';

export class UIManager {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly sound: SoundDirector;
  private readonly callbacks: UIManagerCallbacks;

  private titleSubView: TitleSubView = 'ROOT';
  private activeDrawer: ActiveDrawer = 'NONE';
  private optionsTab: OptionsTab = 'RULES';
  private fullscreenActive = false;
  private saveSlotArmed = false;
  private suspectTargetPieceId: string | null = null;
  private selectedOperationId: string = TACTICAL_OPERATIONS[0]!.id;

  // 2-Step Hold-to-Confirm Surrender State + Touch Click-Through Guard
  private surrenderArmedUntil = 0;
  private surrenderHoldRaf = 0;
  private surrenderHoldAccumMs = 0;
  private surrenderLastTickMs = 0;
  private surrenderHoldTicks = 0;
  private surrenderHolding = false;
  private surrenderHoldingPointerId: number | null = null;
  private surrenderClickGuardActive = false;
  private surrenderClickGuardTimer = 0;

  // Cached DOM references
  private readonly titleScreen: HTMLElement;
  private readonly titleMainCards: HTMLElement;
  private readonly titleSkirmishPanel: HTMLElement;
  private readonly titleCampaignPanel: HTMLElement;
  private readonly titleOpsPanel: HTMLElement;
  private readonly skirmishGrid: HTMLElement;
  private readonly campaignGrid: HTMLElement;
  private readonly campaignStatsBadge: HTMLElement;
  private readonly opsGrid: HTMLElement;
  private readonly opsBriefingBox: HTMLElement;
  private readonly opsStatsBadge: HTMLElement;
  private readonly titleFsBtn: HTMLButtonElement;
  private readonly titleMuteBtn: HTMLButtonElement;
  private readonly titleRefreshBtn: HTMLButtonElement;
  private readonly titleUpdateDot: HTMLElement;
  private readonly titleUpdateToast: HTMLElement;
  private updateToastTimer = 0;
  private updateCheckInFlight = false;

  private readonly topUtilityBar: HTMLElement;
  private readonly modeTitleLabel: HTMLElement;
  private readonly topMenuBackBtn: HTMLButtonElement;
  private readonly topViewBtn: HTMLButtonElement;
  private readonly topFsBtn: HTMLButtonElement;
  private readonly topOptionsBtn: HTMLButtonElement;

  private readonly playTopTrio: HTMLElement;
  private readonly countdownVal: HTMLElement;
  private readonly centerStatePill: HTMLElement;
  private readonly centerStateText: HTMLElement;
  private readonly opTurnCounter: HTMLElement;
  private readonly turnProgressFill: HTMLElement;
  private readonly roundTimerPill: HTMLElement;
  private readonly roundTimerVal: HTMLElement;
  private readonly skipCutsceneBtn: HTMLButtonElement;

  private readonly suspectWheel: HTMLElement;
  private readonly shroudOverlay: HTMLElement;
  private readonly shroudBadge: HTMLElement;
  private readonly shroudHeadline: HTMLElement;
  private readonly shroudSubline: HTMLElement;

  private readonly bottomStack: HTMLElement;
  private readonly sheetIntel: HTMLElement;
  private readonly intelBody: HTMLElement;
  private readonly sheetLog: HTMLElement;
  private readonly logList: HTMLElement;
  private readonly sheetOptions: HTMLElement;
  private readonly sheetShowcase: HTMLElement;

  private readonly mobilizationDrawer: HTMLElement;
  private readonly mobHeaderLabel: HTMLElement;
  private readonly deployCountBadge: HTMLElement;
  private readonly saveModeBtn: HTMLButtonElement;
  private readonly rankChipContainer: HTMLElement;
  private readonly launchBattleBtn: HTMLButtonElement;
  private readonly armoryBackBtn: HTMLButtonElement;

  private readonly manualSheet: HTMLElement;
  private readonly manualRankThumb: HTMLImageElement;
  private readonly manualRankTitle: HTMLElement;
  private readonly manualRankRule: HTMLElement;
  private readonly manualStatsRow: HTMLElement;
  private readonly manualChipGrid: HTMLElement;

  private readonly dossierCard: HTMLElement;
  private readonly dossierStamp: HTMLElement;
  private readonly dossierTitle: HTMLElement;
  private readonly dossierMethod: HTMLElement;
  private readonly dossierMedalBanner: HTMLElement;
  private readonly dossierCasualtiesStrip: HTMLElement;
  private readonly dossierStatTurns: HTMLElement;
  private readonly dossierStatClashes: HTMLElement;
  private readonly dossierStatOfficer: HTMLElement;
  private readonly dossierStatTime: HTMLElement;

  private readonly replayBar: HTMLElement;
  private readonly replayTicker: HTMLElement;
  private readonly replayTurnLabel: HTMLElement;
  private readonly replaySlider: HTMLInputElement;
  private readonly replayPlayBtn: HTMLButtonElement;

  private readonly selectedUnitStrip: HTMLElement;
  private readonly selectedUnitName: HTMLElement;
  private readonly selectedUnitRule: HTMLElement;
  private readonly playBottomDock: HTMLElement;
  private readonly surrenderBtn: HTMLButtonElement;
  private readonly surrenderLabel: HTMLElement;
  private readonly surrenderFill: HTMLElement;

  constructor(
    root: HTMLElement,
    store: GameStore,
    sound: SoundDirector,
    callbacks: UIManagerCallbacks
  ) {
    this.root = root;
    this.store = store;
    this.sound = sound;
    this.callbacks = callbacks;

    const chipsHtml = ORDERED_RANKS.map((r) => {
      const spec = RANK_SPECS[r];
      return `
        <button type="button" class="crate-rank-chip" data-rank="${r}" title="${spec.name}">
          <img class="chip-rank-thumb" src="./ranks/${r}.webp" alt="${spec.name}" />
          <span class="chip-code">${COMPACT_CHIP_LABEL[r]}</span>
          <span class="chip-qty" data-qty-for="${r}">×${spec.countPerArmy}</span>
        </button>
      `;
    }).join('');

    const manualChipsHtml = ORDERED_RANKS.map((r) => {
      const spec = RANK_SPECS[r];
      return `
        <button type="button" class="manual-rank-pill" data-manual-rank="${r}">
          <img class="manual-pill-thumb" src="./ranks/${r}.webp" alt="${spec.name}" />
          <span class="manual-pill-code">${COMPACT_CHIP_LABEL[r]}</span>
          <span class="manual-pill-tag" data-manual-tag="${r}">—</span>
        </button>
      `;
    }).join('');

    const presetButtonsHtml = (Object.keys(TOURNAMENT_PRESETS) as DeploymentPresetId[])
      .map((id) => {
        const meta = DEPLOYMENT_PRESET_META[id];
        return `<button type="button" class="mob-preset-pill" data-dep-preset="${id}" title="${meta.summary}">${meta.label}</button>`;
      })
      .join('');

    const theaterButtonsHtml = BATTLE_THEATERS.map(
      (t) => `<button type="button" data-theater="${t.id}" title="${t.subtitle}">${t.name.split(' ')[0]}</button>`
    ).join('');

    const pieceColorSwatchesHtml = PIECE_COLOR_ORDER.map((id) => {
      const c = PIECE_COLOR_SPECS[id];
      return `
        <button type="button" class="piece-swatch-btn" data-piece-color="${c.id}" title="${c.label}">
          <span class="piece-swatch-pip" style="--swatch:${c.swatchHex};--swatch-hi:${c.swatchHighlightHex};"></span>
          <span class="piece-swatch-lbl">${c.shortLabel}</span>
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

    const skirmishCommanderCardsHtml = COMMANDER_ROSTER.map(
      (c) => `
        <button type="button" class="cmd-select-card" data-skirmish-cmd="${c.id}">
          <span class="cmd-portrait-box">
            <img src="${c.portraitUrl}" alt="${c.fullName}" loading="eager" />
          </span>
          <span class="cmd-card-meta">
            <span class="cmd-card-top">
              <span class="cmd-tier-tag">T${c.tier}</span>
              <span class="cmd-doctrine-tag">"${c.moniker}"</span>
            </span>
            <span class="cmd-card-name">${c.fullName}</span>
          </span>
        </button>
      `
    ).join('');

    this.root.innerHTML = `
      <!-- =====================================================================
           1. LIVE 3D HEROIC START SCREEN (Centerpiece Seal + Asymmetric Blades)
           ===================================================================== -->
      <section class="title-screen-layer" id="title-screen">
        <div class="title-top-bar">
          <div class="title-top-spacer" aria-hidden="true"></div>
          <div class="hero-title-centerpiece">
            <svg class="hero-telemetry-arc" viewBox="0 0 260 150" aria-hidden="true">
              <path d="M 30 124 A 108 108 0 0 1 230 124" fill="none" stroke="rgba(229,185,104,0.34)" stroke-width="1" stroke-dasharray="4 6" />
              <path d="M 54 128 A 84 84 0 0 1 206 128" fill="none" stroke="rgba(98,230,255,0.22)" stroke-width="1" />
              <line x1="130" y1="6" x2="130" y2="18" stroke="rgba(229,185,104,0.55)" stroke-width="1.2" />
              <line x1="28" y1="88" x2="38" y2="92" stroke="rgba(229,185,104,0.45)" stroke-width="1.2" />
              <line x1="232" y1="88" x2="222" y2="92" stroke="rgba(229,185,104,0.45)" stroke-width="1.2" />
            </svg>
            <div class="hero-crest-halo">
              <img class="hero-crest-seal" src="./portraits/hero_crest.png" alt="War Generals Command Seal" decoding="sync" />
            </div>
            <div class="hero-title-lockup">
              <div class="crest-kicker">ELECTRONIC STRATEGY • SALPAKAN</div>
              <h1 class="crest-heading">WAR GENERALS</h1>
              <div class="crest-brass-rule">
                <span class="crest-star">★</span>
              </div>
            </div>
          </div>
          <div class="title-utility-orbs">
            <button type="button" class="glass-icon-btn utility-glyph-btn" id="btn-title-refresh" aria-label="Check for updates and refresh" title="Check for Updates">
              ${ICON_REFRESH}
              <span class="update-dot" id="title-update-dot" hidden></span>
            </button>
            <button type="button" class="glass-icon-btn utility-glyph-btn" id="btn-title-mute" aria-label="Toggle Audio" title="Mute / Unmute">
              ${ICON_AUDIO_ON}
            </button>
            <button type="button" class="glass-icon-btn utility-glyph-btn" id="btn-title-fs" aria-label="Toggle Fullscreen" title="Toggle Fullscreen (F)">
              ${ICON_FULLSCREEN_ENTER}
            </button>
          </div>
          <div class="title-update-toast" id="title-update-toast" role="status" aria-live="polite" hidden></div>
        </div>

        <div class="title-thumb-deck" id="title-thumb-deck">
          <!-- Asymmetric Sculpted Command-Blade Composition -->
          <div class="title-card-stack" id="title-main-cards">
            <button type="button" class="cmd-blade cmd-blade-hero cta-sheen" id="btn-menu-skirmish" data-primary="true" data-blade="01">
              <span class="blade-index">01</span>
              <span class="blade-copy">
                <span class="blade-title">PLAY SKIRMISH</span>
                <span class="blade-sub">Commanders &amp; Era Rules → Mobilization</span>
              </span>
              <span class="blade-chevron">›</span>
            </button>

            <button type="button" class="cmd-blade cmd-blade-odd" id="btn-menu-operations" data-menu-operations="true" data-mode="OPERATION" data-blade="02">
              <span class="blade-index">02</span>
              <span class="blade-copy">
                <span class="blade-title">TACTICAL OPS</span>
                <span class="blade-sub">8 Operations &amp; Stars</span>
              </span>
              <span class="blade-chevron">›</span>
            </button>

            <button type="button" class="cmd-blade cmd-blade-even" id="btn-menu-campaign" data-blade="03">
              <span class="blade-index">03</span>
              <span class="blade-copy">
                <span class="blade-title">CAMPAIGN</span>
                <span class="blade-sub" id="menu-campaign-sub">6-Tier Rival Gauntlet</span>
              </span>
              <span class="blade-chevron">›</span>
            </button>

            <button type="button" class="cmd-blade cmd-blade-odd" id="btn-menu-passplay" data-blade="04">
              <span class="blade-index">04</span>
              <span class="blade-copy">
                <span class="blade-title">PASS &amp; PLAY</span>
                <span class="blade-sub">2P Brass Shroud</span>
              </span>
              <span class="blade-chevron">›</span>
            </button>

            <button type="button" class="cmd-blade cmd-blade-even" id="btn-menu-armory" data-blade="05">
              <span class="blade-index">05</span>
              <span class="blade-copy">
                <span class="blade-title">ARMORY</span>
                <span class="blade-sub">21-Unit Blueprints</span>
              </span>
              <span class="blade-chevron">›</span>
            </button>

            <button type="button" class="cmd-blade cmd-blade-odd" id="btn-menu-manual" data-blade="06">
              <span class="blade-index">06</span>
              <span class="blade-copy">
                <span class="blade-title">FIELD MANUAL</span>
                <span class="blade-sub">15-Rank Hierarchy</span>
              </span>
              <span class="blade-chevron">›</span>
            </button>

            <button type="button" class="cmd-blade cmd-blade-even" id="btn-menu-options" data-blade="07">
              <span class="blade-index">07</span>
              <span class="blade-copy">
                <span class="blade-title">OPTIONS</span>
                <span class="blade-sub">Era, Theaters &amp; GPU</span>
              </span>
              <span class="blade-chevron">›</span>
            </button>
          </div>

          <!-- Sub-Panel A: Skirmish Commander, Era & Difficulty Selector -->
          <div class="title-sub-sheet" id="title-sub-skirmish" hidden>
            <div class="sub-sheet-header">
              <span class="sub-sheet-title">SKIRMISH BRIEFING</span>
              <button type="button" class="mini-brass-btn" data-back-root="true">← MENU</button>
            </div>
            <div class="cmd-grid-6" id="skirmish-cmd-grid">
              ${skirmishCommanderCardsHtml}
            </div>
            <div class="cmd-dossier-blurb" id="skirmish-cmd-summary"></div>
            <div class="era-inline-row">
              <span class="era-inline-label">ERA EDITION</span>
              <div class="seg-track" id="seg-skirmish-era">
                <button type="button" data-sk-era="1980s">1980s Electronic</button>
                <button type="button" data-sk-era="1970s">1970s Classic</button>
              </div>
            </div>
            <div class="era-inline-row">
              <span class="era-inline-label">DIFFICULTY</span>
              <div class="seg-track" id="seg-skirmish-diff">
                <button type="button" data-sk-diff="RECRUIT">Recruit</button>
                <button type="button" data-sk-diff="OFFICER">Officer</button>
                <button type="button" data-sk-diff="GENERAL">General</button>
                <button type="button" data-sk-diff="SUPREME_MARSHAL">Marshal</button>
              </div>
            </div>
            <div class="era-inline-row">
              <span class="era-inline-label">PIECE COAT</span>
              <div class="color-swatch-track" id="seg-skirmish-color">
                ${pieceColorSwatchesHtml}
              </div>
            </div>
            <button type="button" class="primary-brass-cta cta-sheen" id="btn-start-skirmish">
              DEPLOY FORCES — MOBILIZE
            </button>
          </div>

          <!-- Sub-Panel B: 6-Tier Command Campaign Gauntlet -->
          <div class="title-sub-sheet" id="title-sub-campaign" hidden>
            <div class="sub-sheet-header">
              <span class="sub-sheet-title">CAMPAIGN</span>
              <span class="mono-stat-pill" id="campaign-stats-badge">0/6 MEDALS • 0/18★ • 0%</span>
              <button type="button" class="mini-brass-btn" data-back-root="true">← MENU</button>
            </div>
            <div class="cmd-grid-6" id="campaign-cmd-grid"></div>
            <div class="cmd-dossier-blurb" id="campaign-cmd-summary"></div>
            <button type="button" class="primary-brass-cta cta-sheen" id="btn-launch-campaign">
              LAUNCH CAMPAIGN OPERATION
            </button>
          </div>

          <!-- Sub-Panel C: 8 Tactical Operations & Challenges -->
          <div class="title-sub-sheet operations-panel" id="title-sub-operations" hidden>
            <div class="sub-sheet-header">
              <span class="sub-sheet-title">TACTICAL OPERATIONS</span>
              <span class="mono-stat-pill" id="ops-stats-badge">0/8 CLEARED • 0★</span>
              <button type="button" class="mini-brass-btn" data-back-root="true">← MENU</button>
            </div>
            <div class="ops-grid" id="ops-grid"></div>
            <div class="cmd-dossier-blurb" id="ops-briefing-box"></div>
            <button type="button" class="primary-brass-cta cta-sheen" id="btn-start-operation" data-launch-operation="true">
              LAUNCH TACTICAL OPERATION
            </button>
          </div>
        </div>
      </section>

      <!-- =====================================================================
           2. TOP UTILITY HEADER (Deployment, Armory, Field Manual, Replay, GameOver)
           ===================================================================== -->
      <header class="hud-utility-header" id="top-utility-bar" hidden>
        <div class="hud-orb-cluster">
          <button type="button" class="mini-brass-btn" id="btn-top-menu" title="Return to Main Menu">
            ← MENU
          </button>
          <button type="button" class="glass-icon-btn" id="btn-showcase" aria-label="Battle Arena Showcase" title="Battle Showcase &amp; Gallery">
            ⚔
          </button>
        </div>

        <div class="hud-spatial-header">
          <div class="hud-spatial-title" id="mode-title-label">TACTICAL DEPLOYMENT</div>
          <div class="hud-spatial-accent"></div>
        </div>

        <div class="hud-orb-cluster">
          <button type="button" class="glass-icon-btn" id="btn-top-cam-reset" data-reset-camera="true" aria-label="Reset Camera Orbit" title="Reset Camera Orbit">
            ⌖
          </button>
          <button type="button" class="glass-icon-btn" id="btn-top-view" aria-label="Cycle Camera Angle" title="Cycle Camera Angle">
            <span id="top-view-badge">40°</span>
          </button>
          <button type="button" class="glass-icon-btn" id="btn-top-fs" aria-label="Toggle Fullscreen" title="Toggle Fullscreen (F)">
            ${ICON_FULLSCREEN_ENTER}
          </button>
          <button type="button" class="glass-icon-btn" id="btn-top-options" aria-label="Options" title="Options">
            ⚙
          </button>
        </div>
      </header>

      <!-- =====================================================================
           3. IN-MATCH SAFE-ZONE TOP TRIO (COUNTDOWN | STATE + BAR | ROUND | CAM RESET)
           ===================================================================== -->
      <header class="play-top-trio" id="play-top-trio" hidden>
        <div class="clock-pill">
          <span class="clock-micro-label">COUNTDOWN</span>
          <span class="clock-mono-val" id="val-countdown">10:00</span>
        </div>

        <div class="state-banner-pill" id="pill-turn-state" data-tone="player">
          <span class="state-banner-text" id="text-turn-state">YOUR TURN</span>
          <span class="op-turn-counter" id="op-turn-counter" hidden></span>
          <div class="turn-progress-track">
            <div class="turn-progress-fill" id="turn-progress-fill"></div>
          </div>
        </div>

        <div class="clock-pill" id="pill-round-timer" data-urgent="false">
          <span class="clock-micro-label">ROUND</span>
          <span class="clock-mono-val" id="val-round-timer">00:45</span>
        </div>

        <button
          type="button"
          class="glass-icon-btn cam-reset-pill"
          id="btn-reset-camera"
          data-reset-camera="true"
          aria-label="Reset Camera Orbit"
          title="Reset Camera Orbit"
        >⌖</button>
      </header>

      <!-- Instant Any-Time Cutscene Skip Pill (Visible whenever cameraMode === 'ARBITER') -->
      <button
        type="button"
        class="arbiter-skip-pill arbiter-skip-btn cta-sheen"
        id="btn-skip-cutscene"
        data-skip-cutscene="true"
        hidden
      >
        SKIP &gt;&gt;
      </button>

      <!-- Radial Brass Deduction Wheel (320ms Hold or Double-Tap on Enemy Wedge) -->
      <div class="suspect-wheel" id="suspect-wheel" hidden>
        <div class="suspect-wheel-hub">TAG</div>
        ${wheelButtonsHtml}
      </div>

      <!-- =====================================================================
           4. PASS & PLAY (2P LOCAL) FULL-SCREEN BRASS PRIVACY COMMAND SHROUD
           ===================================================================== -->
      <section class="command-shroud-overlay" id="command-shroud" hidden>
        <div class="shroud-dossier-card">
          <div class="shroud-seal-badge" id="shroud-badge">EYES ONLY // CLASSIFIED HANDOFF</div>
          <h2 class="shroud-headline" id="shroud-headline">PASS DEVICE TO CRIMSON COMMANDER</h2>
          <p class="shroud-subline" id="shroud-subline">
            Opponent wedge faces are sealed. Tap below only when the next Commander holds the device.
          </p>
          <button type="button" class="primary-brass-cta cta-sheen" id="btn-unseal-shroud">
            UNSEAL COMMAND &amp; CONTINUE
          </button>
        </div>
      </section>

      <!-- =====================================================================
           5. LOWER 42% THUMB-REACH DOCK, SHEETS, CRATE, MANUAL & DOSSIER
           ===================================================================== -->
      <div class="hud-bottom-stack" id="hud-bottom-stack">
        <!-- Pop-up Sheet: Intel Ledger (Zero Enemy Rank Leak!) -->
        <div class="smoked-sheet" id="sheet-intel" hidden>
          <div class="sub-sheet-header">
            <span class="sub-sheet-title">INTEL LEDGER (UNCONFIRMED ENEMY)</span>
            <button type="button" class="mini-brass-btn" data-close-sheet="true">✕</button>
          </div>
          <div class="intel-grid" id="intel-body"></div>
        </div>

        <!-- Pop-up Sheet: Sealed Combat / Declassified Log -->
        <div class="smoked-sheet" id="sheet-log" hidden>
          <div class="sub-sheet-header">
            <span class="sub-sheet-title">OPERATIONAL COMBAT LOG</span>
            <span class="sealed-tag">RANKS SEALED MID-WAR</span>
            <button type="button" class="mini-brass-btn" data-close-sheet="true">✕</button>
          </div>
          <div class="combat-log-list" id="combat-log-list"></div>
          <div class="sheet-footer-row">
            <button type="button" class="mini-brass-btn" id="btn-log-open-xray">
              OPEN X-RAY REPLAY ARCHIVE
            </button>
          </div>
        </div>

        <!-- Pop-up Sheet: Arena Showcase -->
        <div class="smoked-sheet" id="sheet-showcase" hidden>
          <div class="sub-sheet-header">
            <span class="sub-sheet-title">3D BATTLE ARENA SHOWCASE</span>
            <button type="button" class="mini-brass-btn" data-close-sheet="true">✕</button>
          </div>
          <div class="pill-grid">
            <button type="button" class="pill-action" data-preset="PLAYER_WIN" data-tone="gold">Artillery Win</button>
            <button type="button" class="pill-action" data-preset="ENEMY_WIN" data-tone="crimson">Ambush Reversal</button>
            <button type="button" class="pill-action" data-preset="SPY_INTERCEPT" data-tone="cyan">Spy Intercept</button>
            <button type="button" class="pill-action" data-preset="MUTUAL_SPLIT" data-tone="crimson">Double-KO Split</button>
            <button type="button" class="pill-action" data-preset="FLAG_CAPTURE" data-tone="gold">Flag Unmasking</button>
            <button type="button" class="pill-action" id="btn-xray-replay" data-tone="cyan">Declassified X-Ray</button>
            <button type="button" class="pill-action" id="btn-inspect-16" data-tone="cyan">16-Rank Gallery</button>
            <button type="button" class="pill-action" id="btn-showcase-menu">Main Menu</button>
          </div>
        </div>

        <!-- Pop-up Sheet: Options, Era Editions, Theaters, Quality & Audio -->
        <div class="smoked-sheet" id="sheet-options" hidden>
          <div class="sub-sheet-header">
            <div class="seg-track" id="seg-opt-tabs">
              <button type="button" data-opt-tab="RULES" data-selected="true">ERA &amp; UX</button>
              <button type="button" data-opt-tab="AUDIO_GPU">AUDIO &amp; GPU</button>
            </div>
            <div class="hud-orb-cluster">
              <button type="button" class="mini-brass-btn" id="btn-opt-showcase">SHOWCASE</button>
              <button type="button" class="mini-brass-btn" id="btn-opt-mainmenu">MENU</button>
              <button type="button" class="mini-brass-btn" data-close-sheet="true">✕</button>
            </div>
          </div>

          <!-- Tab 1: Era Editions, Difficulty, Handedness, Battle Pacing & Match Clocks -->
          <div class="options-grid" id="opt-pane-rules">
            <div class="setting-row">
              <span>Era Edition</span>
              <div class="seg-track" id="seg-era">
                <button type="button" data-era="1980s" title="Sudden-Death Back-Row Flag Win">1980s Electronic</button>
                <button type="button" data-era="1970s" title="Deferred 1-Turn Adjacent Flag Bluff">1970s Classic</button>
              </div>
            </div>
            <div class="era-rule-callout" id="opt-era-rule-note">
              1980s Sudden-Death: Flag reaching opponent back rank wins immediately.
            </div>
            <div class="setting-row">
              <span>Board Finish</span>
              <div class="seg-track" id="seg-finish">
                <button type="button" data-finish="WALNUT_SLATE">Oiled Walnut</button>
                <button type="button" data-finish="RETRO_BAKELITE">1980 Bakelite</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Piece Color</span>
              <div class="color-swatch-track" id="seg-piece-color">
                ${pieceColorSwatchesHtml}
              </div>
            </div>
            <div class="setting-row">
              <span>Difficulty</span>
              <div class="seg-track" id="seg-difficulty">
                <button type="button" data-diff="RECRUIT">Recruit</button>
                <button type="button" data-diff="OFFICER">Officer</button>
                <button type="button" data-diff="GENERAL">General</button>
                <button type="button" data-diff="SUPREME_MARSHAL">Marshal</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Handedness</span>
              <div class="seg-track" id="seg-handedness">
                <button type="button" data-hand="RIGHT">Right-Hand</button>
                <button type="button" data-hand="LEFT">Left-Hand</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Battle Pacing</span>
              <div class="seg-track" id="seg-speed">
                <button type="button" data-speed="THEATRICAL">Theatrical 4.0s</button>
                <button type="button" data-speed="TACTICAL_FAST">Fast 1.6s</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Match Clocks</span>
              <div class="seg-track" id="seg-clocks">
                <button type="button" data-clock="BLITZ">Blitz 5m</button>
                <button type="button" data-clock="STANDARD">Std 10m</button>
                <button type="button" data-clock="UNTIMED">Untimed</button>
              </div>
            </div>
          </div>

          <!-- Tab 2: Quality Governor (5 Tiers), Battle Theaters, Frame Mode, Camera & Mixer -->
          <div class="options-grid" id="opt-pane-audio" hidden>
            <div class="setting-row">
              <span>Graphics &amp; FPS</span>
              <div class="seg-track seg-track-compact" id="seg-quality">
                <button type="button" data-quality="AUTO">Auto</button>
                <button type="button" data-quality="ULTRA">Ultra</button>
                <button type="button" data-quality="HIGH">High</button>
                <button type="button" data-quality="BALANCED">Bal</button>
                <button type="button" data-quality="BATTERY_SAVER">30fps</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Battle Theater</span>
              <div class="seg-track seg-track-compact" id="seg-theater">
                ${theaterButtonsHtml}
              </div>
            </div>
            <div class="setting-row">
              <span>Viewport Frame</span>
              <div class="hud-orb-cluster">
                <div class="seg-track" id="seg-frame-mode">
                  <button type="button" data-frame-mode="FULL_VIEWPORT" data-viewport-frame="FULL_VIEWPORT">Full</button>
                  <button type="button" data-frame-mode="PHONE_9_16" data-viewport-frame="PHONE_9_16">9:16</button>
                </div>
                <div class="seg-track" id="seg-fullscreen">
                  <button type="button" data-fs="false">Win</button>
                  <button type="button" data-fs="true">FS</button>
                </div>
              </div>
            </div>
            <div class="setting-row">
              <span>Camera &amp; Orbit</span>
              <div class="hud-orb-cluster">
                <div class="seg-track" id="seg-view">
                  <button type="button" data-view="COMMAND">40°</button>
                  <button type="button" data-view="TACTICAL">32°</button>
                  <button type="button" data-view="OVERHEAD">62°</button>
                </div>
                <button type="button" class="mini-brass-btn" id="btn-opt-cam-reset" data-reset-camera="true">Reset</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Master Vol</span>
              <input type="range" class="bus-slider" id="slider-master" min="0" max="100" step="5" value="90" aria-label="Master Volume" />
            </div>
            <div class="setting-row">
              <span>Battle Music</span>
              <input type="range" class="bus-slider" id="slider-music" min="0" max="100" step="5" value="85" aria-label="Battle Music Volume" />
            </div>
            <div class="setting-row">
              <span>Tabletop SFX</span>
              <input type="range" class="bus-slider" id="slider-sfx" min="0" max="100" step="5" value="95" aria-label="Tabletop SFX Volume" />
            </div>
            <div class="setting-row">
              <span>Tent Ambiance</span>
              <input type="range" class="bus-slider" id="slider-ambiance" min="0" max="100" step="5" value="75" aria-label="Tent Ambiance Volume" />
            </div>
            <div class="setting-row">
              <span>Haptics / Mute</span>
              <div class="hud-orb-cluster">
                <div class="seg-track" id="seg-haptics">
                  <button type="button" data-haptics="true">Vib On</button>
                  <button type="button" data-haptics="false">Off</button>
                </div>
                <div class="seg-track" id="seg-mute">
                  <button type="button" data-mute="false">Audio On</button>
                  <button type="button" data-mute="true">Mute</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pre-Match & Armory Smoked-Velvet Mobilization Crate Drawer -->
        <div class="mobilization-drawer" id="mobilization-drawer" hidden>
          <div class="mob-top-bar">
            <div class="mob-title-group">
              <span class="mob-label" id="mob-header-label">MOBILIZATION</span>
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
              ${presetButtonsHtml}
            </div>
            <div class="mob-blueprint-row">
              <span class="mob-sub-label">BLUEPRINTS</span>
              <div class="mob-slot-group">
                <button type="button" class="mob-slot-save-toggle" id="btn-arm-save" title="Save 21/21 formation into Slot 1–5">Save</button>
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

          <div class="mob-cta-row">
            <button type="button" class="mini-brass-btn" id="btn-armory-back" hidden>← MENU</button>
            <button type="button" class="primary-brass-cta cta-sheen" id="btn-launch-battle" disabled>
              DEPLOY 21 UNITS TO LAUNCH
            </button>
          </div>
        </div>

        <!-- Interactive 3D Field Manual & Spy/Private Hierarchy Sheet -->
        <div class="manual-thumb-sheet" id="manual-sheet" hidden>
          <div class="manual-top-row">
            <div class="manual-hero-head">
              <img class="manual-hero-thumb" id="manual-rank-thumb" src="./ranks/SPY.webp" alt="Selected Rank Emblem" />
              <div>
                <div class="manual-rank-title" id="manual-rank-title">SPY (SECRET AGENT)</div>
                <div class="manual-rank-rule" id="manual-rank-rule">
                  Eliminates all Officers (5★ down to Sergeant) &amp; Flag • Eliminated ONLY by Private!
                </div>
              </div>
            </div>
            <div class="manual-legend-badges" id="manual-stats-row"></div>
          </div>
          <div class="manual-chip-grid" id="manual-chip-grid">
            ${manualChipsHtml}
          </div>
        </div>

        <!-- End-of-War Classified Military Dossier Card -->
        <div class="dossier-card" id="dossier-card" hidden>
          <div class="dossier-top-strip">
            <span class="dossier-stamp" id="dossier-stamp">AFTER-ACTION DOSSIER // DECLASSIFIED</span>
          </div>
          <div class="dossier-verdict-title" id="dossier-title">VICTORY — MISSION ACCOMPLISHED</div>
          <div class="dossier-method-line" id="dossier-method">Enemy Flag Eliminated</div>
          <div class="dossier-medal-banner" id="dossier-medal" hidden></div>

          <div class="dossier-telemetry-grid">
            <div class="dossier-stat-cell">
              <span class="d-stat-lbl">TURNS</span>
              <span class="d-stat-val" id="d-stat-turns">12</span>
            </div>
            <div class="dossier-stat-cell">
              <span class="d-stat-lbl">CLASHES WON</span>
              <span class="d-stat-val" id="d-stat-clashes">4</span>
            </div>
            <div class="dossier-stat-cell">
              <span class="d-stat-lbl">HIGH OFFICER</span>
              <span class="d-stat-val" id="d-stat-officer">5-Star General</span>
            </div>
            <div class="dossier-stat-cell">
              <span class="d-stat-lbl">ELAPSED</span>
              <span class="d-stat-val" id="d-stat-time">01:42</span>
            </div>
          </div>

          <div class="dossier-casualties-strip" id="dossier-casualties" hidden></div>

          <div class="dossier-actions-row">
            <button type="button" class="primary-brass-cta cta-sheen" id="btn-dossier-replay">
              DECLASSIFIED X-RAY REPLAY
            </button>
            <div class="dossier-secondary-row">
              <button type="button" class="secondary-glass-btn" id="btn-dossier-rematch">REMATCH</button>
              <button type="button" class="secondary-glass-btn" id="btn-dossier-menu">MAIN MENU</button>
            </div>
          </div>
        </div>

        <!-- Post-Match Declassified X-Ray Replay Scrubber -->
        <div class="replay-capsule" id="replay-bar" hidden>
          <div class="replay-top-row">
            <span class="replay-turn-badge" id="replay-turn-label">PLY 0 / 0</span>
            <span class="replay-ticker" id="replay-ticker">T0: Armies Deployed</span>
          </div>
          <input type="range" class="bus-slider replay-scrubber" id="replay-slider" min="0" max="1" step="1" value="0" aria-label="Replay Timeline Scrubber" />
          <div class="replay-controls-row">
            <button type="button" class="glass-icon-btn replay-orb" id="btn-rep-start" title="First Turn">|&lt;</button>
            <button type="button" class="glass-icon-btn replay-orb" id="btn-rep-prev" title="Previous Turn">&lt;</button>
            <button type="button" class="glass-icon-btn replay-orb" id="btn-rep-play" data-active="false" title="Play / Pause">▶</button>
            <button type="button" class="glass-icon-btn replay-orb" id="btn-rep-next" title="Next Turn">&gt;</button>
            <button type="button" class="glass-icon-btn replay-orb" id="btn-rep-end" title="Final Turn">&gt;|</button>
            <button type="button" class="mini-brass-btn" id="btn-rep-rematch">REMATCH</button>
            <button type="button" class="mini-brass-btn" id="btn-rep-menu">MENU</button>
          </div>
        </div>

        <!-- Selected Friendly Unit Micro-Strip -->
        <div class="selected-unit-strip" id="selected-unit-strip" hidden>
          <span class="sel-unit-name" id="sel-unit-name">5-STAR GENERAL</span>
          <span class="sel-unit-sep">•</span>
          <span class="sel-unit-rule" id="sel-unit-rule">Outranks all officers &amp; Privates</span>
        </div>

        <!-- In-Match Safe-Zone Bottom Dock -->
        <nav class="play-bottom-dock" id="play-bottom-dock" aria-label="Tactical Command Controls" hidden>
          <button type="button" class="dock-btn" id="btn-dock-intel">
            <span class="dock-btn-icon">▤</span>
            <span class="dock-btn-lbl">INTEL LEDGER</span>
          </button>

          <button type="button" class="dock-btn" id="btn-dock-log">
            <span class="dock-btn-icon">≡</span>
            <span class="dock-btn-lbl">DECLASSIFIED LOG</span>
          </button>

          <button type="button" class="dock-btn dock-surrender-btn" id="btn-dock-surrender">
            <span class="surrender-hold-fill" id="surrender-hold-fill"></span>
            <span class="dock-btn-icon">⚑</span>
            <span class="dock-btn-lbl" id="surrender-btn-label">SURRENDER</span>
          </button>

          <button type="button" class="dock-btn dock-gear-btn" id="btn-dock-settings" aria-label="Settings">
            <span class="dock-btn-icon">⚙</span>
            <span class="dock-btn-lbl">SETTINGS</span>
          </button>
        </nav>
      </div>
    `;

    this.titleScreen = this.root.querySelector('#title-screen')!;
    this.titleMainCards = this.root.querySelector('#title-main-cards')!;
    this.titleSkirmishPanel = this.root.querySelector('#title-sub-skirmish')!;
    this.titleCampaignPanel = this.root.querySelector('#title-sub-campaign')!;
    this.titleOpsPanel = this.root.querySelector('#title-sub-operations')!;
    this.skirmishGrid = this.root.querySelector('#skirmish-cmd-grid')!;
    this.campaignGrid = this.root.querySelector('#campaign-cmd-grid')!;
    this.campaignStatsBadge = this.root.querySelector('#campaign-stats-badge')!;
    this.opsGrid = this.root.querySelector('#ops-grid')!;
    this.opsBriefingBox = this.root.querySelector('#ops-briefing-box')!;
    this.opsStatsBadge = this.root.querySelector('#ops-stats-badge')!;
    this.titleFsBtn = this.root.querySelector('#btn-title-fs')!;
    this.titleMuteBtn = this.root.querySelector('#btn-title-mute')!;
    this.titleRefreshBtn = this.root.querySelector('#btn-title-refresh')!;
    this.titleUpdateDot = this.root.querySelector('#title-update-dot')!;
    this.titleUpdateToast = this.root.querySelector('#title-update-toast')!;

    this.topUtilityBar = this.root.querySelector('#top-utility-bar')!;
    this.modeTitleLabel = this.root.querySelector('#mode-title-label')!;
    this.topMenuBackBtn = this.root.querySelector('#btn-top-menu')!;
    this.topViewBtn = this.root.querySelector('#btn-top-view')!;
    this.topFsBtn = this.root.querySelector('#btn-top-fs')!;
    this.topOptionsBtn = this.root.querySelector('#btn-top-options')!;

    this.playTopTrio = this.root.querySelector('#play-top-trio')!;
    this.countdownVal = this.root.querySelector('#val-countdown')!;
    this.centerStatePill = this.root.querySelector('#pill-turn-state')!;
    this.centerStateText = this.root.querySelector('#text-turn-state')!;
    this.opTurnCounter = this.root.querySelector('#op-turn-counter')!;
    this.turnProgressFill = this.root.querySelector('#turn-progress-fill')!;
    this.roundTimerPill = this.root.querySelector('#pill-round-timer')!;
    this.roundTimerVal = this.root.querySelector('#val-round-timer')!;
    this.skipCutsceneBtn = this.root.querySelector('#btn-skip-cutscene')!;

    this.suspectWheel = this.root.querySelector('#suspect-wheel')!;
    this.shroudOverlay = this.root.querySelector('#command-shroud')!;
    this.shroudBadge = this.root.querySelector('#shroud-badge')!;
    this.shroudHeadline = this.root.querySelector('#shroud-headline')!;
    this.shroudSubline = this.root.querySelector('#shroud-subline')!;

    this.bottomStack = this.root.querySelector('#hud-bottom-stack')!;
    this.sheetIntel = this.root.querySelector('#sheet-intel')!;
    this.intelBody = this.root.querySelector('#intel-body')!;
    this.sheetLog = this.root.querySelector('#sheet-log')!;
    this.logList = this.root.querySelector('#combat-log-list')!;
    this.sheetOptions = this.root.querySelector('#sheet-options')!;
    this.sheetShowcase = this.root.querySelector('#sheet-showcase')!;

    this.mobilizationDrawer = this.root.querySelector('#mobilization-drawer')!;
    this.mobHeaderLabel = this.root.querySelector('#mob-header-label')!;
    this.deployCountBadge = this.root.querySelector('#mob-count-pill')!;
    this.saveModeBtn = this.root.querySelector('#btn-arm-save')!;
    this.rankChipContainer = this.root.querySelector('#mob-chip-grid')!;
    this.launchBattleBtn = this.root.querySelector('#btn-launch-battle')!;
    this.armoryBackBtn = this.root.querySelector('#btn-armory-back')!;

    this.manualSheet = this.root.querySelector('#manual-sheet')!;
    this.manualRankThumb = this.root.querySelector('#manual-rank-thumb')!;
    this.manualRankTitle = this.root.querySelector('#manual-rank-title')!;
    this.manualRankRule = this.root.querySelector('#manual-rank-rule')!;
    this.manualStatsRow = this.root.querySelector('#manual-stats-row')!;
    this.manualChipGrid = this.root.querySelector('#manual-chip-grid')!;

    this.dossierCard = this.root.querySelector('#dossier-card')!;
    this.dossierStamp = this.root.querySelector('#dossier-stamp')!;
    this.dossierTitle = this.root.querySelector('#dossier-title')!;
    this.dossierMethod = this.root.querySelector('#dossier-method')!;
    this.dossierMedalBanner = this.root.querySelector('#dossier-medal')!;
    this.dossierCasualtiesStrip = this.root.querySelector('#dossier-casualties')!;
    this.dossierStatTurns = this.root.querySelector('#d-stat-turns')!;
    this.dossierStatClashes = this.root.querySelector('#d-stat-clashes')!;
    this.dossierStatOfficer = this.root.querySelector('#d-stat-officer')!;
    this.dossierStatTime = this.root.querySelector('#d-stat-time')!;

    this.replayBar = this.root.querySelector('#replay-bar')!;
    this.replayTicker = this.root.querySelector('#replay-ticker')!;
    this.replayTurnLabel = this.root.querySelector('#replay-turn-label')!;
    this.replaySlider = this.root.querySelector('#replay-slider')!;
    this.replayPlayBtn = this.root.querySelector('#btn-rep-play')!;

    this.selectedUnitStrip = this.root.querySelector('#selected-unit-strip')!;
    this.selectedUnitName = this.root.querySelector('#sel-unit-name')!;
    this.selectedUnitRule = this.root.querySelector('#sel-unit-rule')!;
    this.playBottomDock = this.root.querySelector('#play-bottom-dock')!;
    this.surrenderBtn = this.root.querySelector('#btn-dock-surrender')!;
    this.surrenderLabel = this.root.querySelector('#surrender-btn-label')!;
    this.surrenderFill = this.root.querySelector('#surrender-hold-fill')!;

    this.bindEvents();
    void this.checkForUpdates(false);
  }

  public openSuspectWheel(pieceId: string, clientX: number, clientY: number): void {
    this.suspectTargetPieceId = pieceId;
    const hostRect = this.root.getBoundingClientRect();
    const localX = clampVal(clientX - hostRect.left, 82, Math.max(82, hostRect.width - 82));
    const localY = clampVal(clientY - hostRect.top, 82, Math.max(82, hostRect.height - 82));
    const dirSign = this.store.getOptions().handedness === 'LEFT' ? -1 : 1;
    const orbs = this.suspectWheel.querySelectorAll<HTMLButtonElement>('.suspect-orb');
    orbs.forEach((btn, idx) => {
      const ang = dirSign * (idx / orbs.length) * Math.PI * 2 - Math.PI / 2;
      const rx = Math.round(Math.cos(ang) * 58);
      const ry = Math.round(Math.sin(ang) * 58);
      btn.style.transform = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`;
    });
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
    // Bug 1 Fix: Hide Start Screen whenever 16-Rank Gallery or Arbiter Showcase is open from TITLE
    const inTitle = view.phase === 'TITLE' && !inInspect && !inArbiter;
    const inPlay = view.phase === 'PLAY' && !inInspect;
    const inDeploy = (view.phase === 'DEPLOY' || view.phase === 'ARMORY') && !inInspect && !inArbiter;
    const inManual = view.phase === 'FIELD_MANUAL' && !inInspect;
    const inReplay = view.phase === 'REPLAY' && !inInspect;
    const inGameOver = view.phase === 'GAME_OVER' && !inInspect && !inArbiter;
    const shrouded = Boolean(view.shroud?.active);

    document.body.dataset['handedness'] = options.handedness;
    document.body.dataset['era'] = options.eraMode;

    // Bug 3 Fix: Preserve SHOWCASE & OPTIONS drawers when a background AI turn triggers ARBITER
    if (inArbiter) {
      if (this.activeDrawer !== 'SHOWCASE' && this.activeDrawer !== 'OPTIONS') {
        this.activeDrawer = 'NONE';
      }
      this.closeSuspectWheel();
    }

    // F19 Any-Time Cutscene Skip Pill
    this.skipCutsceneBtn.hidden = !inArbiter;

    // 1. Live 3D Heroic Start Screen
    this.titleScreen.hidden = !inTitle;
    this.titleScreen.dataset['subview'] = this.titleSubView;
    if (inTitle) {
      this.titleMainCards.hidden = this.titleSubView !== 'ROOT';
      this.titleSkirmishPanel.hidden = this.titleSubView !== 'SKIRMISH';
      this.titleCampaignPanel.hidden = this.titleSubView !== 'CAMPAIGN';
      this.titleOpsPanel.hidden = this.titleSubView !== 'OPERATIONS';
      this.titleMuteBtn.innerHTML = options.audioMuted ? ICON_AUDIO_MUTED : ICON_AUDIO_ON;
      this.titleFsBtn.innerHTML = this.fullscreenActive
        ? ICON_FULLSCREEN_EXIT
        : ICON_FULLSCREEN_ENTER;

      this.syncTitleCampaignAndSkirmish(view, options);
      if (this.titleSubView === 'OPERATIONS') {
        this.syncOperationsPanel(view);
      }
    }

    // 2. Top Utility Header (Non-Title, Non-Play screens — including INSPECT_16 launched from TITLE)
    const showUtilityTop = !inTitle && !inPlay && !inArbiter;
    this.topUtilityBar.hidden = !showUtilityTop;
    if (showUtilityTop) {
      if (inInspect) {
        this.modeTitleLabel.textContent = '16-RANK SCULPTURE GALLERY';
      } else if (view.phase === 'ARMORY') {
        this.modeTitleLabel.textContent = 'FORMATION ARMORY';
      } else if (inManual) {
        this.modeTitleLabel.textContent = 'FIELD MANUAL & RANKS';
      } else if (inReplay) {
        this.modeTitleLabel.textContent = 'DECLASSIFIED REPLAY';
      } else if (inGameOver) {
        this.modeTitleLabel.textContent = 'AFTER-ACTION DOSSIER';
      } else {
        const playerUpper = PIECE_COLOR_SPECS[view.playerPieceColor].upperLabel;
        const facTag =
          view.matchMode === 'PASS_AND_PLAY'
            ? view.viewingFaction === 'PLAYER'
              ? `${playerUpper} DEPLOYMENT`
              : 'CRIMSON DEPLOYMENT'
            : 'TACTICAL DEPLOYMENT';
        this.modeTitleLabel.textContent = facTag;
      }

      const degBadge = this.root.querySelector('#top-view-badge');
      if (degBadge) {
        degBadge.textContent =
          options.boardView === 'COMMAND'
            ? '40°'
            : options.boardView === 'TACTICAL'
              ? '32°'
              : '62°';
      }
      this.topFsBtn.innerHTML = this.fullscreenActive
        ? ICON_FULLSCREEN_EXIT
        : ICON_FULLSCREEN_ENTER;
    }

    // 3. In-Match Top Safe-Zone Trio
    const showTopTrio = inPlay || inArbiter;
    this.playTopTrio.hidden = !showTopTrio;
    if (showTopTrio) {
      if (view.isUntimed) {
        this.countdownVal.textContent = '∞';
        this.roundTimerVal.textContent = '∞';
        this.roundTimerPill.dataset['urgent'] = 'false';
        this.turnProgressFill.style.width = '100%';
      } else {
        this.countdownVal.textContent = formatClock(view.matchClockSec);
        this.roundTimerVal.textContent = formatClock(view.turnClockSec);
        const isUrgent = !inArbiter && view.turnClockSec <= 10;
        this.roundTimerPill.dataset['urgent'] = String(isUrgent);

        const pct = Math.max(0, Math.min(100, (view.turnClockSec / view.turnClockMaxSec) * 100));
        this.turnProgressFill.style.width = `${inArbiter ? 100 : pct}%`;
      }

      if (inArbiter) {
        this.centerStateText.textContent =
          view.banner === 'ARBITRATING' ? 'ARBITRATING' : view.banner;
        this.centerStatePill.dataset['tone'] =
          view.banner.includes('VICTORY') || view.banner === 'BATTLE WINNER' ? 'gold' : 'crimson';
      } else if (view.matchMode === 'PASS_AND_PLAY') {
        const playerUpper = PIECE_COLOR_SPECS[view.playerPieceColor].upperLabel;
        this.centerStateText.textContent =
          view.activeTurn === 'PLAYER' ? `${playerUpper} TURN` : 'CRIMSON TURN';
        this.centerStatePill.dataset['tone'] =
          view.activeTurn === 'PLAYER' ? 'player' : 'enemy';
      } else if (view.activeTurn === 'ENEMY') {
        this.centerStateText.textContent = 'ENEMY THINKING';
        this.centerStatePill.dataset['tone'] = 'enemy';
      } else {
        this.centerStateText.textContent = 'YOUR TURN';
        this.centerStatePill.dataset['tone'] = 'player';
      }

      // Sibling Operation Turn-Limit Counter (keeps `#text-turn-state` strictly pure)
      if (view.matchMode === 'OPERATION' && view.operationTurnLimit !== null && !inArbiter) {
        this.opTurnCounter.hidden = false;
        this.opTurnCounter.textContent = `OP PLY ${view.turnCount} / ${view.operationTurnLimit}`;
      } else {
        this.opTurnCounter.hidden = true;
      }
    }

    // 4. Pass & Play Brass Privacy Command Shroud
    this.shroudOverlay.hidden = !shrouded;
    if (shrouded && view.shroud) {
      const playerUpper = PIECE_COLOR_SPECS[view.playerPieceColor].upperLabel;
      this.shroudBadge.textContent =
        view.shroud.nextFaction === 'PLAYER'
          ? `EYES ONLY // ${playerUpper} HIGH COMMAND`
          : 'EYES ONLY // CRIMSON HIGH COMMAND';
      this.shroudHeadline.textContent = view.shroud.headline;
      this.shroudSubline.textContent = view.shroud.subline;
    }

    // 5. Pop-up Smoked-Glass Sheets
    this.bottomStack.hidden = shrouded;
    this.sheetIntel.hidden = this.activeDrawer !== 'INTEL';
    this.sheetLog.hidden = this.activeDrawer !== 'LOG';
    this.sheetOptions.hidden = this.activeDrawer !== 'OPTIONS';
    this.sheetShowcase.hidden = this.activeDrawer !== 'SHOWCASE';

    if (this.activeDrawer === 'INTEL') {
      this.renderIntelLedger(view);
    }
    if (this.activeDrawer === 'LOG') {
      this.renderCombatLog(view);
    }

    // 6. Mobilization Crate Drawer (hide whenever an overlay drawer is open)
    this.mobilizationDrawer.hidden = !inDeploy || shrouded || this.activeDrawer !== 'NONE';
    if (inDeploy && !shrouded) {
      const playerUpper = PIECE_COLOR_SPECS[view.playerPieceColor].upperLabel;
      const ready = view.deployedCount === ARMY_PIECE_TOTAL;
      const isArmory = view.phase === 'ARMORY';
      this.mobHeaderLabel.textContent = isArmory
        ? 'ARMORY WORKSHOP'
        : view.matchMode === 'PASS_AND_PLAY'
          ? view.viewingFaction === 'PLAYER'
            ? `${playerUpper} CRATE`
            : 'CRIMSON CRATE'
          : 'MOBILIZATION';
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

      this.armoryBackBtn.hidden = !isArmory;
      this.launchBattleBtn.disabled = !ready;
      if (!ready) {
        this.launchBattleBtn.textContent = `DEPLOY ${ARMY_PIECE_TOTAL - view.deployedCount} MORE TO LAUNCH`;
      } else if (isArmory) {
        this.launchBattleBtn.textContent = 'TEST FORMATION IN SKIRMISH';
      } else if (view.matchMode === 'PASS_AND_PLAY' && view.viewingFaction === 'PLAYER') {
        const playerUpper = PIECE_COLOR_SPECS[view.playerPieceColor].upperLabel;
        this.launchBattleBtn.textContent = `SEAL ${playerUpper} & PASS TO CRIMSON`;
      } else {
        this.launchBattleBtn.textContent = 'READY TO LAUNCH — ENGAGE';
      }
    }

    // 7. Interactive 3D Field Manual & Ranks Sheet (hide whenever an overlay drawer is open)
    this.manualSheet.hidden = !inManual || this.activeDrawer !== 'NONE';
    if (inManual) {
      const selSpec = RANK_SPECS[view.manualSelectedRank];
      this.manualRankThumb.src = `./ranks/${view.manualSelectedRank}.webp`;
      this.manualRankThumb.alt = selSpec.name;
      this.manualRankTitle.textContent = selSpec.name.toUpperCase();
      this.manualRankRule.textContent = selSpec.tacticalRule;

      const defeatsCount = view.manualEntries.filter((e) => e.outcome === 'DEFEATS').length;
      const threatsCount = view.manualEntries.filter((e) => e.outcome === 'THREAT').length;
      this.manualStatsRow.innerHTML = `
        <span class="m-badge emerald">DEFEATS ${defeatsCount}</span>
        <span class="m-badge crimson">THREATS ${threatsCount}</span>
      `;

      const byRank = new Map(view.manualEntries.map((e) => [e.rank, e.outcome]));
      this.manualChipGrid
        .querySelectorAll<HTMLButtonElement>('.manual-rank-pill')
        .forEach((pill) => {
          const r = pill.dataset['manualRank'] as RankId;
          const out = byRank.get(r) ?? 'SPLIT';
          pill.dataset['outcome'] = out;
          const tag = pill.querySelector<HTMLElement>(`[data-manual-tag="${r}"]`);
          if (tag) {
            tag.textContent =
              out === 'SELECTED'
                ? 'ACTIVE'
                : out === 'FLAG_ATTACK_WIN'
                  ? 'ATK WIN'
                  : out === 'DEFEATS'
                    ? 'WIN'
                    : out === 'THREAT'
                      ? 'LOSE'
                      : 'SPLIT';
          }
        });
    }

    // 8. End-of-War Classified Military Dossier (hide whenever an overlay drawer is open)
    this.dossierCard.hidden =
      !inGameOver || !view.dossier || shrouded || this.activeDrawer !== 'NONE';
    if (inGameOver && view.dossier) {
      const d = view.dossier;
      this.dossierCard.dataset['victory'] = String(d.playerWon);
      this.dossierStamp.textContent = `CLASSIFIED DOSSIER // ${options.eraMode} RULESET`;
      this.dossierTitle.textContent = d.winnerLabel;
      this.dossierMethod.textContent = `${d.winMethod} • ${d.detailNote}`;
      if (d.campaignMedalUnlocked) {
        this.dossierMedalBanner.hidden = false;
        const starsStr = d.starsEarned ? ` • ${renderStarsText(d.starsEarned)}` : '';
        this.dossierMedalBanner.textContent = `★ CAMPAIGN MEDAL AWARDED: ${d.campaignMedalUnlocked.toUpperCase()}${starsStr}`;
      } else if (d.operationId && d.starsEarned) {
        this.dossierMedalBanner.hidden = false;
        const opSpec = getTacticalOperation(d.operationId);
        this.dossierMedalBanner.textContent = `${opSpec?.codeName ?? 'OPERATION'} CLEARED • ${renderStarsText(d.starsEarned)}`;
      } else {
        this.dossierMedalBanner.hidden = true;
      }
      this.dossierStatTurns.textContent = String(d.turnsElapsed);
      this.dossierStatClashes.textContent = String(
        d.playerWon ? d.clashesWonByPlayer : d.clashesWonByEnemy
      );
      this.dossierStatOfficer.textContent = d.survivingHighOfficer;
      this.dossierStatTime.textContent = d.matchDurationFormatted;

      // Render non-leaking casualty rank thumbnails (`enemyCasualties` strictly uses `UNKNOWN.webp`)
      const pCas = view.playerCasualties.slice(0, 8);
      const eCas = view.enemyCasualties.slice(0, 8);
      if (pCas.length > 0 || eCas.length > 0) {
        this.dossierCasualtiesStrip.hidden = false;
        const playerUpper = PIECE_COLOR_SPECS[view.playerPieceColor].upperLabel;
        const pHtml = pCas
          .map(
            (c) =>
              `<img class="cas-rank-thumb navy" src="./ranks/${c.visibleRank}.webp" alt="${playerUpper} Casualty" />`
          )
          .join('');
        const eHtml = eCas
          .map(
            (c) =>
              `<img class="cas-rank-thumb crimson" src="./ranks/${c.visibleRank}.webp" alt="Enemy Casualty" />`
          )
          .join('');
        this.dossierCasualtiesStrip.innerHTML = `
          <span class="cas-group"><span class="cas-lbl">${playerUpper} LOSSES</span>${pHtml || '<span class="cas-none">0</span>'}</span>
          <span class="cas-group"><span class="cas-lbl">CRIMSON LOSSES</span>${eHtml || '<span class="cas-none">0</span>'}</span>
        `;
      } else {
        this.dossierCasualtiesStrip.hidden = true;
      }
    }

    // 9. Declassified X-Ray Replay Scrubber (hide whenever an overlay drawer is open)
    this.replayBar.hidden = !inReplay || !view.replay || this.activeDrawer !== 'NONE';
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

    // 10. In-Match Safe-Zone Bottom Dock + Selected Unit Strip (hide strip whenever an overlay drawer is open)
    const showPlayDock = inPlay && !inArbiter && !shrouded;
    this.playBottomDock.hidden = !showPlayDock;

    if (showPlayDock && this.activeDrawer === 'NONE' && view.selectedPieceId) {
      const sel = view.pieces.find((p) => p.id === view.selectedPieceId);
      if (sel && sel.visibleRank !== 'UNKNOWN') {
        const spec = RANK_SPECS[sel.visibleRank];
        this.selectedUnitStrip.hidden = false;
        this.selectedUnitName.textContent = spec.name.toUpperCase();
        this.selectedUnitRule.textContent = spec.tacticalRule;
      } else {
        this.selectedUnitStrip.hidden = true;
      }
    } else {
      this.selectedUnitStrip.hidden = true;
    }

    const inspectBtn = this.root.querySelector<HTMLButtonElement>('#btn-inspect-16');
    if (inspectBtn) {
      inspectBtn.textContent = inInspect ? 'Back to Board' : '16-Rank Gallery';
    }

    // Sync Options Tabs & Controls
    const rulesPane = this.root.querySelector<HTMLElement>('#opt-pane-rules');
    const audioPane = this.root.querySelector<HTMLElement>('#opt-pane-audio');
    if (rulesPane) rulesPane.hidden = this.optionsTab !== 'RULES';
    if (audioPane) audioPane.hidden = this.optionsTab !== 'AUDIO_GPU';
    this.syncSeg('#seg-opt-tabs button', 'optTab', this.optionsTab);

    const eraNote = this.root.querySelector<HTMLElement>('#opt-era-rule-note');
    if (eraNote) {
      eraNote.textContent =
        options.eraMode === '1980s'
          ? '1980s Electronic: Flag reaching opponent back rank wins immediately on the spot.'
          : '1970s Classic: Contested Flag on back rank stays unrevealed & must survive 1 opponent turn!';
    }

    const effectiveTheater =
      view.phase === 'PLAY' || view.phase === 'DEPLOY' ? view.theaterId : options.theaterId;

    this.syncSeg('#seg-skirmish-era button', 'skEra', options.eraMode);
    this.syncSeg('#seg-skirmish-diff button', 'skDiff', options.difficulty);
    this.syncSeg('#seg-skirmish-color button', 'pieceColor', options.pieceColor);
    this.syncSeg('#seg-fullscreen button', 'fs', String(this.fullscreenActive));
    this.syncSeg('#seg-frame-mode button', 'frameMode', options.viewportFrameMode);
    this.syncSeg('#seg-view button', 'view', options.boardView);
    this.syncSeg('#seg-era button', 'era', options.eraMode);
    this.syncSeg('#seg-finish button', 'finish', options.boardFinish);
    this.syncSeg('#seg-piece-color button', 'pieceColor', options.pieceColor);
    this.syncSeg('#seg-difficulty button', 'diff', options.difficulty);
    this.syncSeg('#seg-handedness button', 'hand', options.handedness);
    this.syncSeg('#seg-clocks button', 'clock', options.clockPreset);
    this.syncSeg('#seg-quality button', 'quality', options.qualityMode);
    this.syncSeg('#seg-theater button', 'theater', effectiveTheater);
    this.syncSeg('#seg-haptics button', 'haptics', String(options.hapticsEnabled));
    this.syncSeg('#seg-speed button', 'speed', options.arbiterSpeed);
    this.syncSeg('#seg-mute button', 'mute', String(options.audioMuted));

    const masSlider = this.root.querySelector<HTMLInputElement>('#slider-master');
    if (masSlider) masSlider.value = String(Math.round(options.masterVolume * 100));
    const mSlider = this.root.querySelector<HTMLInputElement>('#slider-music');
    if (mSlider) mSlider.value = String(Math.round(options.musicVolume * 100));
    const sSlider = this.root.querySelector<HTMLInputElement>('#slider-sfx');
    if (sSlider) sSlider.value = String(Math.round(options.sfxVolume * 100));
    const aSlider = this.root.querySelector<HTMLInputElement>('#slider-ambiance');
    if (aSlider) aSlider.value = String(Math.round(options.ambianceVolume * 100));
  }

  private syncTitleCampaignAndSkirmish(
    view: PlayerVisibleView,
    _options: Readonly<AppOptions>
  ): void {
    const camp = view.campaign;
    const medalsCount = Object.values(camp.records).filter((r) => r.medalEarned).length;
    const totalStars = Object.values(camp.records).reduce((sum, r) => sum + (r.stars ?? 0), 0);
    const totalGames = camp.totalWins + camp.totalLosses;
    const winPct = totalGames > 0 ? Math.round((camp.totalWins / totalGames) * 100) : 0;

    const menuSub = this.root.querySelector('#menu-campaign-sub');
    if (menuSub) {
      menuSub.textContent = `T${camp.unlockedTier}/6 • ${medalsCount}/6 Medals • ${totalStars}/18★`;
    }
    this.campaignStatsBadge.textContent = `${medalsCount}/6 MEDALS • ${totalStars}/18★ • ${winPct}%`;

    const activeCmd = getCommanderProfile(view.commanderId);
    const activeTheater = getBattleTheater(activeCmd.theaterId);

    if (this.titleSubView === 'SKIRMISH') {
      const skSummary = this.root.querySelector('#skirmish-cmd-summary');
      if (skSummary) {
        skSummary.innerHTML = `
          <span class="cmd-dossier-portrait">
            <img src="${activeCmd.portraitUrl}" alt="${activeCmd.fullName}" />
          </span>
          <span class="cmd-dossier-copy">
            <strong class="cmd-dossier-name">${activeCmd.fullName} — "${activeCmd.moniker}"</strong>
            <span class="cmd-dossier-text">${activeCmd.tacticalBriefing}</span>
          </span>
        `;
      }

      this.skirmishGrid
        .querySelectorAll<HTMLButtonElement>('[data-skirmish-cmd]')
        .forEach((btn) => {
          btn.dataset['selected'] = String(btn.dataset['skirmishCmd'] === view.commanderId);
        });
    }

    if (this.titleSubView === 'CAMPAIGN') {
      const campSummary = this.root.querySelector('#campaign-cmd-summary');
      if (campSummary) {
        campSummary.innerHTML = `
          <span class="cmd-dossier-portrait">
            <img src="${activeCmd.portraitUrl}" alt="${activeCmd.fullName}" />
          </span>
          <span class="cmd-dossier-copy">
            <strong class="cmd-dossier-name">${activeCmd.fullName} • ${activeTheater.name}</strong>
            <span class="cmd-dossier-text">${activeCmd.missionModifier.label}: ${activeCmd.tacticalBriefing}</span>
          </span>
        `;
      }

      this.campaignGrid.innerHTML = COMMANDER_ROSTER.map((c) => {
        const unlocked = c.tier <= camp.unlockedTier;
        const rec = camp.records[c.id];
        const selected = view.commanderId === c.id && unlocked;
        const starsBadge = rec.stars > 0 ? renderStarsText(rec.stars) : rec.medalEarned ? '★ MEDAL' : `"${c.moniker}"`;
        return `
          <button
            type="button"
            class="cmd-select-card"
            data-campaign-cmd="${c.id}"
            data-selected="${selected}"
            data-locked="${!unlocked}"
            ${!unlocked ? 'disabled' : ''}
          >
            <span class="cmd-portrait-box">
              <img src="${c.portraitUrl}" alt="${c.fullName}" loading="eager" />
            </span>
            <span class="cmd-card-meta">
              <span class="cmd-card-top">
                <span class="cmd-tier-tag">${unlocked ? `T${c.tier}` : '🔒'}</span>
                <span class="cmd-doctrine-tag">${starsBadge}</span>
              </span>
              <span class="cmd-card-name">${c.fullName}</span>
            </span>
          </button>
        `;
      }).join('');

      this.campaignGrid
        .querySelectorAll<HTMLButtonElement>('[data-campaign-cmd]')
        .forEach((btn) => {
          btn.addEventListener('click', () => {
            const cid = btn.dataset['campaignCmd'] as CommanderId;
            this.sound.playUiClick();
            this.store.setSelectedCommander(cid);
          });
        });
    }
  }

  private syncOperationsPanel(view: PlayerVisibleView): void {
    const progress = view.operationsProgress;
    let cleared = 0;
    let totalStars = 0;
    for (const op of TACTICAL_OPERATIONS) {
      const rec = progress[op.id];
      if (rec?.completed) cleared += 1;
      totalStars += rec?.bestStars ?? 0;
    }
    this.opsStatsBadge.textContent = `${cleared}/${TACTICAL_OPERATIONS.length} CLEARED • ${totalStars}/${TACTICAL_OPERATIONS.length * 3}★`;

    this.opsGrid.innerHTML = TACTICAL_OPERATIONS.map((op) => {
      const rec = progress[op.id];
      const stars = rec?.bestStars ?? 0;
      const theater = getBattleTheater(op.theaterId);
      const selected = this.selectedOperationId === op.id;
      return `
        <button
          type="button"
          class="op-select-card operation-card"
          data-operation-id="${op.id}"
          data-operation="${op.id}"
          data-objective="${op.objectiveKind}"
          data-selected="${selected}"
        >
          <span class="op-card-top">
            <span class="op-code">${op.codeName}</span>
            <span class="op-stars">${stars > 0 ? renderStarsText(stars) : `${op.turnLimit}P`}</span>
          </span>
          <span class="op-title">${op.title}</span>
          <span class="op-meta">${theater.name} • ${op.eraRuleset}</span>
        </button>
      `;
    }).join('');

    const activeOp = getTacticalOperation(this.selectedOperationId) ?? TACTICAL_OPERATIONS[0]!;
    const activeTheater = getBattleTheater(activeOp.theaterId);
    const activeCmd = getCommanderProfile(activeOp.commanderId);
    this.opsBriefingBox.textContent =
      `${activeOp.title} vs ${activeCmd.fullName} (${activeTheater.name}, ${activeOp.eraRuleset}): ${activeOp.briefing} Objective: ${activeOp.objectiveSummary}`;

    this.opsGrid
      .querySelectorAll<HTMLButtonElement>('[data-operation-id]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedOperationId = btn.dataset['operationId'] ?? TACTICAL_OPERATIONS[0]!.id;
          this.sound.playUiClick();
          this.render(this.store.getVisibleView(), this.store.getOptions());
        });
      });
  }

  private renderIntelLedger(view: PlayerVisibleView): void {
    const L = view.intelLedger;
    const cmd = getCommanderProfile(view.commanderId);
    const playerUpper = PIECE_COLOR_SPECS[view.playerPieceColor].upperLabel;
    const ownLabel = view.viewingFaction === 'PLAYER' ? `${playerUpper} COMMAND` : 'CRIMSON COMMAND';
    const oppLabel =
      view.matchMode === 'PASS_AND_PLAY'
        ? view.viewingFaction === 'PLAYER'
          ? 'CRIMSON (SEALED)'
          : `${playerUpper} (SEALED)`
        : `${cmd.fullName.toUpperCase()} ("${cmd.moniker.toUpperCase()}")`;
    const ownCasHtml = view.playerCasualties
      .slice(0, 8)
      .map((c) => `<img class="cas-rank-thumb navy" src="./ranks/${c.visibleRank}.webp" alt="Loss" />`)
      .join('');
    const enemyCasHtml = view.enemyCasualties
      .slice(0, 8)
      .map((c) => `<img class="cas-rank-thumb crimson" src="./ranks/${c.visibleRank}.webp" alt="Unconfirmed Loss" />`)
      .join('');

    this.intelBody.innerHTML = `
      <div class="intel-col">
        <div class="intel-col-hdr cyan">${ownLabel}</div>
        <div class="intel-kv"><span>Officers Active</span><strong>${L.ownOfficersAlive}</strong></div>
        <div class="intel-kv"><span>Privates Active</span><strong>${L.ownPrivatesAlive}</strong></div>
        <div class="intel-kv"><span>Spies Active</span><strong>${L.ownSpiesAlive}</strong></div>
        <div class="intel-kv"><span>Flag Status</span><strong>${L.ownFlagAlive ? 'SECURED' : 'LOST'}</strong></div>
        <div class="intel-casualty-row">${ownCasHtml}</div>
      </div>
      <div class="intel-col">
        <div class="intel-col-hdr crimson">${oppLabel}</div>
        <div class="intel-kv"><span>Unconfirmed Units</span><strong>${L.enemyUnconfirmedAlive}</strong></div>
        <div class="intel-kv"><span>Confirmed Eliminated</span><strong>${L.enemyEliminatedTotal}</strong></div>
        <div class="intel-kv"><span>Blooded Veterans (★)</span><strong>${L.enemyVeteranCount}</strong></div>
        <div class="intel-kv"><span>Tagged Suspects</span><strong>${L.enemyTaggedCount}</strong></div>
        <div class="intel-casualty-row">${enemyCasHtml}</div>
      </div>
    `;
  }

  private renderCombatLog(view: PlayerVisibleView): void {
    if (view.publicLog.length === 0) {
      this.logList.innerHTML = `<div class="log-row">No maneuvers logged yet.</div>`;
      return;
    }
    this.logList.innerHTML = view.publicLog
      .slice(-10)
      .reverse()
      .map(
        (entry) =>
          `<div class="log-row" data-clash="${entry.isClash}">${entry.text}</div>`
      )
      .join('');
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
        // Fallback CSS full-bleed active
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

  private toggleDrawer(drawer: ActiveDrawer): void {
    this.activeDrawer = this.activeDrawer === drawer ? 'NONE' : drawer;
    this.closeSuspectWheel();
    this.sound.playDrawerSlide(this.activeDrawer !== 'NONE');
    this.render(this.store.getVisibleView(), this.store.getOptions());
  }

  private bindEvents(): void {
    // 1. Title Screen Sculpted Command Blades
    this.root.querySelector('#btn-menu-skirmish')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playDrawerSlide(true);
      this.titleSubView = 'SKIRMISH';
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.root.querySelector('#btn-menu-operations')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playDrawerSlide(true);
      this.titleSubView = 'OPERATIONS';
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.root.querySelector('#btn-menu-campaign')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playDrawerSlide(true);
      const camp = this.store.getVisibleView().campaign;
      const highestUnlocked =
        COMMANDER_ROSTER.find((c) => c.tier === camp.unlockedTier) ?? COMMANDER_ROSTER[0]!;
      this.store.setSelectedCommander(highestUnlocked.id);
      this.titleSubView = 'CAMPAIGN';
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.root.querySelector('#btn-menu-passplay')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playDrawerSlide(true);
      this.activeDrawer = 'NONE';
      this.store.startPassAndPlay();
    });

    this.root.querySelector('#btn-menu-armory')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playDrawerSlide(true);
      this.activeDrawer = 'NONE';
      this.store.openFormationArmory();
    });

    this.root.querySelector('#btn-menu-manual')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playDrawerSlide(true);
      this.activeDrawer = 'NONE';
      this.store.openFieldManual('SPY');
    });

    this.root.querySelector('#btn-menu-options')?.addEventListener('click', () => {
      this.sound.unlock();
      this.toggleDrawer('OPTIONS');
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-back-root]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.titleSubView = 'ROOT';
        this.render(this.store.getVisibleView(), this.store.getOptions());
      });
    });

    this.skirmishGrid
      .querySelectorAll<HTMLButtonElement>('[data-skirmish-cmd]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const cid = btn.dataset['skirmishCmd'] as CommanderId;
          this.sound.playUiClick();
          this.store.setSelectedCommander(cid);
        });
      });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-skirmish-era button').forEach((b) => {
      b.addEventListener('click', () => {
        const era = b.dataset['skEra'] as AppOptions['eraMode'];
        this.sound.setEraMode(era);
        this.sound.playUiClick();
        this.store.updateOptions({ eraMode: era });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-skirmish-diff button').forEach((b) => {
      b.addEventListener('click', () => {
        const difficulty = b.dataset['skDiff'] as AppOptions['difficulty'];
        this.sound.playUiClick();
        this.store.updateOptions({ difficulty });
      });
    });

    this.root
      .querySelectorAll<HTMLButtonElement>('#seg-skirmish-color button, #seg-piece-color button')
      .forEach((b) => {
        b.addEventListener('click', () => {
          const pieceColor = b.dataset['pieceColor'] as PieceColorId;
          this.sound.playUiClick();
          this.store.updateOptions({ pieceColor });
        });
      });

    this.root.querySelector('#btn-start-skirmish')?.addEventListener('click', () => {
      this.sound.playDrawerSlide(true);
      this.titleSubView = 'ROOT';
      this.activeDrawer = 'NONE';
      this.store.startSkirmish();
    });

    this.root.querySelector('#btn-launch-campaign')?.addEventListener('click', () => {
      const view = this.store.getVisibleView();
      const prof = getCommanderProfile(view.commanderId);
      if (prof.tier <= view.campaign.unlockedTier) {
        this.sound.playDrawerSlide(true);
        this.titleSubView = 'ROOT';
        this.activeDrawer = 'NONE';
        this.store.startCampaignTier(view.commanderId);
      }
    });

    this.root.querySelector('#btn-start-operation')?.addEventListener('click', () => {
      this.sound.playDrawerSlide(true);
      this.titleSubView = 'ROOT';
      this.activeDrawer = 'NONE';
      this.store.startOperation(this.selectedOperationId);
    });

    this.titleRefreshBtn.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playUiClick();
      void this.checkForUpdates(true);
    });
    this.titleFsBtn.addEventListener('click', () => {
      this.sound.playUiClick();
      this.setFullscreenState(!this.fullscreenActive);
    });
    this.titleMuteBtn.addEventListener('click', () => {
      const nextMute = !this.store.getOptions().audioMuted;
      this.sound.setMuted(nextMute);
      if (!nextMute) this.sound.playUiClick();
      this.store.updateOptions({ audioMuted: nextMute });
    });

    // 2. Top Utility Header & Camera Reset Controls
    const goMainMenu = () => {
      this.sound.playDrawerSlide(false);
      this.activeDrawer = 'NONE';
      this.titleSubView = 'ROOT';
      this.store.returnToTitleMenu();
    };
    this.topMenuBackBtn.addEventListener('click', goMainMenu);
    this.armoryBackBtn.addEventListener('click', goMainMenu);
    this.root.querySelector('#btn-opt-mainmenu')?.addEventListener('click', goMainMenu);
    this.root.querySelector('#btn-showcase-menu')?.addEventListener('click', goMainMenu);
    this.root.querySelector('#btn-dossier-menu')?.addEventListener('click', goMainMenu);
    this.root.querySelector('#btn-rep-menu')?.addEventListener('click', goMainMenu);

    this.root.querySelector('#btn-showcase')?.addEventListener('click', () => {
      this.toggleDrawer('SHOWCASE');
    });
    this.root.querySelector('#btn-opt-showcase')?.addEventListener('click', () => {
      this.toggleDrawer('SHOWCASE');
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-reset-camera]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.callbacks.onResetCamera?.();
      });
    });

    this.skipCutsceneBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.sound.playUiClick();
      this.callbacks.onSkipArbiter?.();
    });

    this.topViewBtn.addEventListener('click', () => {
      this.sound.playUiClick();
      this.store.cycleBoardView();
    });
    this.topFsBtn.addEventListener('click', () => {
      this.sound.playUiClick();
      this.setFullscreenState(!this.fullscreenActive);
    });
    this.topOptionsBtn.addEventListener('click', () => {
      this.toggleDrawer('OPTIONS');
    });

    // 3. Command Shroud Unseal
    this.root.querySelector('#btn-unseal-shroud')?.addEventListener('click', () => {
      this.sound.playMagneticSnap();
      this.sound.vibrate([15, 25, 20]);
      this.store.unsealCommandShroud();
    });

    // 4. Bottom Dock Controls + 2-Step Hold-to-Confirm Surrender
    this.root.querySelector('#btn-dock-intel')?.addEventListener('click', () => {
      this.toggleDrawer('INTEL');
    });
    this.root.querySelector('#btn-dock-log')?.addEventListener('click', () => {
      this.toggleDrawer('LOG');
    });
    this.root.querySelector('#btn-dock-settings')?.addEventListener('click', () => {
      this.toggleDrawer('OPTIONS');
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-close-sheet]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeDrawer = 'NONE';
        this.sound.playUiClick();
        this.render(this.store.getVisibleView(), this.store.getOptions());
      });
    });

    this.bindTwoStepSurrender();

    // 5. Radial Suspect Wheel
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

    // 6. Mobilization Crate Controls & Hologram Drag-Out
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
        if (
          this.saveSlotArmed ||
          (view.deployedCount === ARMY_PIECE_TOTAL && !view.savedBlueprintSlots[slotIdx])
        ) {
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

    // 7. Interactive 3D Field Manual Rank Pills
    this.manualChipGrid
      .querySelectorAll<HTMLButtonElement>('.manual-rank-pill')
      .forEach((pill) => {
        pill.addEventListener('click', () => {
          const rank = pill.dataset['manualRank'] as RankId;
          this.sound.playPiecePickup();
          this.store.selectFieldManualRank(rank);
        });
      });

    // 8. End-of-War Dossier & Declassified X-Ray Replay Controls
    const openReplay = () => {
      this.activeDrawer = 'NONE';
      this.sound.playDrawerSlide(true);
      this.store.enterDeclassifiedReplay();
    };
    this.root.querySelector('#btn-dossier-replay')?.addEventListener('click', openReplay);
    this.root.querySelector('#btn-xray-replay')?.addEventListener('click', openReplay);
    this.root.querySelector('#btn-log-open-xray')?.addEventListener('click', openReplay);

    const triggerRematch = () => {
      this.activeDrawer = 'NONE';
      this.sound.playDrawerSlide(true);
      this.store.rematchCurrentMode();
    };
    this.root.querySelector('#btn-dossier-rematch')?.addEventListener('click', triggerRematch);
    this.root.querySelector('#btn-rep-rematch')?.addEventListener('click', triggerRematch);

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

    // 9. Showcase & Options Bindings (Bug 3 + Bug 1 Fixes)
    this.sheetShowcase.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset['preset'] as ShowcasePreset;
        this.activeDrawer = 'NONE';
        if (this.store.getVisibleView().cameraMode === 'ARBITER') {
          this.callbacks.onSkipArbiter?.();
        }
        const verdict = this.store.triggerShowcaseClash(preset);
        if (verdict) {
          this.callbacks.onTriggerVerdict(verdict);
        }
      });
    });

    this.root.querySelector('#btn-inspect-16')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.activeDrawer = 'NONE';
      const view = this.store.getVisibleView();
      if (view.cameraMode === 'INSPECT_16') {
        if (view.phase === 'TITLE') {
          this.store.returnToTitleMenu();
        } else {
          this.store.setCameraMode('PLAY');
        }
      } else {
        this.store.setCameraMode('INSPECT_16');
      }
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
      if (this.store.getVisibleView().cameraMode === 'ARBITER') {
        if (ev.key === ' ' || ev.code === 'Space' || ev.key === 'Enter' || ev.key === 'Escape') {
          ev.preventDefault();
          this.callbacks.onSkipArbiter?.();
          return;
        }
      }
      if (ev.key === 'f' || ev.key === 'F') {
        this.sound.playUiClick();
        this.setFullscreenState(!this.fullscreenActive);
      } else if (ev.key === 'Escape') {
        this.closeSuspectWheel();
        this.activeDrawer = 'NONE';
        if (this.fullscreenActive) this.setFullscreenState(false);
        this.render(this.store.getVisibleView(), this.store.getOptions());
      }
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-fullscreen button').forEach((b) => {
      b.addEventListener('click', () => {
        this.sound.playUiClick();
        this.setFullscreenState(b.dataset['fs'] === 'true');
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-frame-mode button').forEach((b) => {
      b.addEventListener('click', () => {
        const viewportFrameMode = b.dataset['frameMode'] as ViewportFrameMode;
        this.sound.playUiClick();
        this.store.updateOptions({ viewportFrameMode });
      });
    });

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

    this.root.querySelectorAll<HTMLButtonElement>('#seg-opt-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this.optionsTab = b.dataset['optTab'] as OptionsTab;
        this.sound.playUiClick();
        this.render(this.store.getVisibleView(), this.store.getOptions());
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

    this.root.querySelectorAll<HTMLButtonElement>('#seg-finish button').forEach((b) => {
      b.addEventListener('click', () => {
        const boardFinish = b.dataset['finish'] as AppOptions['boardFinish'];
        this.sound.playUiClick();
        this.store.updateOptions({ boardFinish });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-difficulty button').forEach((b) => {
      b.addEventListener('click', () => {
        const difficulty = b.dataset['diff'] as AppOptions['difficulty'];
        this.sound.playUiClick();
        this.store.updateOptions({ difficulty });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-handedness button').forEach((b) => {
      b.addEventListener('click', () => {
        const handedness = b.dataset['hand'] as AppOptions['handedness'];
        this.sound.playUiClick();
        this.store.updateOptions({ handedness });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-clocks button').forEach((b) => {
      b.addEventListener('click', () => {
        const clockPreset = b.dataset['clock'] as AppOptions['clockPreset'];
        this.sound.playUiClick();
        this.store.updateOptions({ clockPreset });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-quality button').forEach((b) => {
      b.addEventListener('click', () => {
        const qualityMode = b.dataset['quality'] as QualityTier;
        this.sound.playUiClick();
        this.store.updateOptions({ qualityMode });
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-theater button').forEach((b) => {
      b.addEventListener('click', () => {
        const theaterId = b.dataset['theater'] as TheaterId;
        this.sound.playUiClick();
        this.store.setTheater(theaterId);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#seg-speed button').forEach((b) => {
      b.addEventListener('click', () => {
        const speed = b.dataset['speed'] as AppOptions['arbiterSpeed'];
        this.sound.playUiClick();
        this.store.updateOptions({ arbiterSpeed: speed });
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

    const bindBusSlider = (
      id: string,
      key: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'ambianceVolume'
    ) => {
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
    bindBusSlider('#slider-master', 'masterVolume');
    bindBusSlider('#slider-music', 'musicVolume');
    bindBusSlider('#slider-sfx', 'sfxVolume');
    bindBusSlider('#slider-ambiance', 'ambianceVolume');
  }

  private bindTwoStepSurrender(): void {
    const HOLD_DURATION_MS = 740;

    // Bug 2 Fix: Block synthetic post-touchend click-through onto #dossier-card / #btn-dossier-menu
    this.dossierCard.addEventListener(
      'click',
      (ev) => {
        if (this.surrenderClickGuardActive) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      },
      true
    );

    const releaseClickGuard = (delayMs: number) => {
      window.clearTimeout(this.surrenderClickGuardTimer);
      this.surrenderClickGuardTimer = window.setTimeout(() => {
        this.surrenderClickGuardActive = false;
        this.dossierCard.style.pointerEvents = '';
      }, delayMs);
    };

    const resetHold = () => {
      this.surrenderHolding = false;
      cancelAnimationFrame(this.surrenderHoldRaf);
      this.surrenderFill.style.width = '0%';
      if (performance.now() < this.surrenderArmedUntil) {
        this.surrenderLabel.textContent = 'HOLD TO CONFIRM';
        this.surrenderBtn.dataset['armed'] = 'true';
      } else {
        this.surrenderLabel.textContent = 'SURRENDER';
        this.surrenderBtn.dataset['armed'] = 'false';
      }
    };

    const tickHold = () => {
      if (!this.surrenderHolding) return;
      const tickNow = performance.now();
      // Keep single-frame stall guard (`surrenderHoldTicks >= 3`) while allowing 3 FPS WebGL batch frames (`<= 480ms`) to complete a real 1150ms hold.
      const frameDelta = Math.min(480, Math.max(0, tickNow - this.surrenderLastTickMs));
      this.surrenderLastTickMs = tickNow;
      this.surrenderHoldTicks += 1;
      this.surrenderHoldAccumMs += frameDelta;
      const pct = Math.min(100, (this.surrenderHoldAccumMs / HOLD_DURATION_MS) * 100);
      this.surrenderFill.style.width = `${pct}%`;

      if (pct >= 100 && this.surrenderHoldTicks >= 3) {
        this.surrenderHolding = false;
        this.surrenderArmedUntil = 0;
        this.surrenderHoldAccumMs = 0;
        this.surrenderFill.style.width = '0%';
        this.surrenderLabel.textContent = 'SURRENDER';
        this.surrenderBtn.dataset['armed'] = 'false';
        this.surrenderClickGuardActive = true;
        this.dossierCard.style.pointerEvents = 'none';
        releaseClickGuard(2500);
        this.sound.vibrate([40, 30, 65]);
        this.store.surrenderMatch();
        return;
      }
      this.surrenderHoldRaf = requestAnimationFrame(tickHold);
    };

    this.surrenderBtn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
    });

    this.surrenderBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.sound.unlock();
      this.surrenderHoldingPointerId = ev.pointerId;
      try {
        this.surrenderBtn.setPointerCapture(ev.pointerId);
      } catch {
        // Synthetic test pointer events may not support capture
      }

      const now = performance.now();
      if (now >= this.surrenderArmedUntil) {
        this.surrenderArmedUntil = now + 3500;
        this.surrenderLabel.textContent = 'HOLD TO CONFIRM';
        this.surrenderBtn.dataset['armed'] = 'true';
        this.sound.playUiClick();
        this.sound.vibrate(10);
        window.setTimeout(() => {
          if (!this.surrenderHolding && performance.now() >= this.surrenderArmedUntil) {
            resetHold();
          }
        }, 3550);
        return;
      }

      this.surrenderHolding = true;
      this.surrenderHoldAccumMs = 0;
      this.surrenderHoldTicks = 0;
      this.surrenderLastTickMs = now;
      this.sound.vibrate(14);
      cancelAnimationFrame(this.surrenderHoldRaf);
      this.surrenderHoldRaf = requestAnimationFrame(tickHold);
    });

    const onRelease = (ev?: PointerEvent) => {
      if (this.surrenderHoldingPointerId !== null) {
        try {
          if (this.surrenderBtn.hasPointerCapture(this.surrenderHoldingPointerId)) {
            this.surrenderBtn.releasePointerCapture(this.surrenderHoldingPointerId);
          }
        } catch {
          // Ignore
        }
        if (!ev || ev.pointerId === this.surrenderHoldingPointerId) {
          this.surrenderHoldingPointerId = null;
        }
      }
      if (this.surrenderHolding) resetHold();
      if (this.surrenderClickGuardActive) {
        releaseClickGuard(30);
      }
    };

    window.addEventListener('pointerup', onRelease);
    window.addEventListener('pointercancel', onRelease);
    window.addEventListener('touchend', () => {
      if (this.surrenderHolding) resetHold();
      if (this.surrenderClickGuardActive) {
        releaseClickGuard(30);
      }
    });
  }

  private showUpdateToast(message: string, autoDismissMs = 0): void {
    window.clearTimeout(this.updateToastTimer);
    this.titleUpdateToast.textContent = message;
    this.titleUpdateToast.hidden = false;
    if (autoDismissMs > 0) {
      this.updateToastTimer = window.setTimeout(() => {
        this.titleUpdateToast.hidden = true;
      }, autoDismissMs);
    }
  }

  private async checkForUpdates(interactive: boolean): Promise<void> {
    if (typeof fetch !== 'function') return;
    if (interactive && this.updateCheckInFlight) return;

    if (interactive) {
      this.updateCheckInFlight = true;
      this.titleRefreshBtn.dataset['checking'] = 'true';
      this.showUpdateToast('CHECKING FOR UPDATES…');
    }

    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { buildId?: unknown };
      const remoteBuildId = typeof data?.buildId === 'string' ? data.buildId : '';
      if (!remoteBuildId) {
        throw new Error('Malformed version manifest');
      }

      if (remoteBuildId === LOCAL_BUILD_ID) {
        this.titleUpdateDot.hidden = true;
        if (interactive) {
          this.showUpdateToast(`UP TO DATE • BUILD ${LOCAL_BUILD_SHORT}`, 3000);
        }
        return;
      }

      this.titleUpdateDot.hidden = false;
      if (!interactive) {
        return;
      }

      this.showUpdateToast('UPDATE AVAILABLE — INSTALLING…');

      // Flush stale Service Worker & CacheStorage entries while preserving 100% of localStorage!
      if ('serviceWorker' in navigator && typeof navigator.serviceWorker?.getRegistrations === 'function') {
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(
          regs.map(async (reg) => {
            await reg.update().catch(() => {});
            await reg.unregister().catch(() => {});
          })
        );
      }
      if ('caches' in window && typeof window.caches?.keys === 'function') {
        const cacheKeys = await window.caches.keys().catch(() => []);
        await Promise.all(cacheKeys.map((k) => window.caches.delete(k).catch(() => false)));
      }

      await fetch(window.location.href, { cache: 'no-store' }).catch(() => {});
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('_upd', String(Date.now()));
      window.location.replace(nextUrl.toString());
    } catch {
      if (interactive) {
        this.showUpdateToast(`OFFLINE • RUNNING BUILD ${LOCAL_BUILD_SHORT}`, 3200);
      }
    } finally {
      if (interactive) {
        this.updateCheckInFlight = false;
        this.titleRefreshBtn.dataset['checking'] = 'false';
      }
    }
  }

  private syncSeg(selector: string, dataKey: string, expected: string): void {
    this.root.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.dataset['selected'] = String(btn.dataset[dataKey] === expected);
    });
  }
}
