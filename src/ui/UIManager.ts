import type { SoundDirector } from '../audio/SoundDirector';
import {
  COMMANDER_ROSTER,
  getCommanderProfile,
  type CommanderId,
} from '../ai/CommanderProfiles';
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

export interface UIManagerCallbacks {
  readonly onTriggerVerdict: (verdict: ArbiterVerdict) => void;
  readonly onStartCrateDrag: (rank: RankId, clientX: number, clientY: number) => void;
}

type TitleSubView = 'ROOT' | 'SKIRMISH' | 'CAMPAIGN';
type ActiveDrawer = 'NONE' | 'INTEL' | 'LOG' | 'OPTIONS' | 'SHOWCASE';

export class UIManager {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly sound: SoundDirector;
  private readonly callbacks: UIManagerCallbacks;

  private titleSubView: TitleSubView = 'ROOT';
  private activeDrawer: ActiveDrawer = 'NONE';
  private fullscreenActive = false;
  private saveSlotArmed = false;
  private suspectTargetPieceId: string | null = null;

  // 2-Step Hold-to-Confirm Surrender State
  private surrenderArmedUntil = 0;
  private surrenderHoldRaf = 0;
  private surrenderHoldStart = 0;
  private surrenderHolding = false;

  // Cached DOM references
  private readonly titleScreen: HTMLElement;
  private readonly titleMainCards: HTMLElement;
  private readonly titleSkirmishPanel: HTMLElement;
  private readonly titleCampaignPanel: HTMLElement;
  private readonly skirmishGrid: HTMLElement;
  private readonly campaignGrid: HTMLElement;
  private readonly campaignStatsBadge: HTMLElement;
  private readonly titleFsBtn: HTMLButtonElement;
  private readonly titleMuteBtn: HTMLButtonElement;

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
  private readonly turnProgressFill: HTMLElement;
  private readonly roundTimerPill: HTMLElement;
  private readonly roundTimerVal: HTMLElement;

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
  private readonly manualRankTitle: HTMLElement;
  private readonly manualRankRule: HTMLElement;
  private readonly manualStatsRow: HTMLElement;
  private readonly manualChipGrid: HTMLElement;

  private readonly dossierCard: HTMLElement;
  private readonly dossierStamp: HTMLElement;
  private readonly dossierTitle: HTMLElement;
  private readonly dossierMethod: HTMLElement;
  private readonly dossierMedalBanner: HTMLElement;
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
          <span class="chip-metal-dot" data-metal="${spec.metal}"></span>
          <span class="chip-code">${COMPACT_CHIP_LABEL[r]}</span>
          <span class="chip-qty" data-qty-for="${r}">×${spec.countPerArmy}</span>
        </button>
      `;
    }).join('');

    const manualChipsHtml = ORDERED_RANKS.map((r) => {
      return `
        <button type="button" class="manual-rank-pill" data-manual-rank="${r}">
          <span class="manual-pill-code">${COMPACT_CHIP_LABEL[r]}</span>
          <span class="manual-pill-tag" data-manual-tag="${r}">—</span>
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
          <span class="cmd-portrait-box">${c.portraitSvg}</span>
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
           1. LIVE 3D TITLE & START SCREEN (Upper Crest + Lower 42% Thumb Deck)
           ===================================================================== -->
      <section class="title-screen-layer" id="title-screen">
        <div class="title-top-bar">
          <div class="war-generals-crest">
            <div class="crest-kicker">ELECTRONIC STRATEGY • SALPAKAN</div>
            <h1 class="crest-heading">WAR GENERALS</h1>
            <div class="crest-brass-rule">
              <span class="crest-star">★</span>
            </div>
          </div>
          <div class="title-utility-orbs">
            <button type="button" class="glass-icon-btn" id="btn-title-mute" aria-label="Toggle Audio" title="Mute / Unmute">
              ${ICON_AUDIO_ON}
            </button>
            <button type="button" class="glass-icon-btn" id="btn-title-fs" aria-label="Toggle Fullscreen" title="Toggle Fullscreen (F)">
              ${ICON_FULLSCREEN_ENTER}
            </button>
          </div>
        </div>

        <div class="title-thumb-deck" id="title-thumb-deck">
          <!-- Root 6 Command Cards (100% inside lower 42% thumb zone!) -->
          <div class="title-card-stack" id="title-main-cards">
            <button type="button" class="menu-command-card cta-sheen" id="btn-menu-skirmish" data-primary="true">
              <span class="mc-icon">⚔</span>
              <span class="mc-copy">
                <span class="mc-title">PLAY SKIRMISH</span>
                <span class="mc-sub">Select Commander AI &amp; Era Rules → Mobilization</span>
              </span>
              <span class="mc-arrow">›</span>
            </button>

            <button type="button" class="menu-command-card" id="btn-menu-campaign">
              <span class="mc-icon">★</span>
              <span class="mc-copy">
                <span class="mc-title">COMMAND CAMPAIGN</span>
                <span class="mc-sub" id="menu-campaign-sub">6-Tier Rival General Gauntlet &amp; Medals</span>
              </span>
              <span class="mc-arrow">›</span>
            </button>

            <button type="button" class="menu-command-card" id="btn-menu-passplay">
              <span class="mc-icon">⇄</span>
              <span class="mc-copy">
                <span class="mc-title">PASS &amp; PLAY (2P LOCAL)</span>
                <span class="mc-sub">Hotseat Clash with Brass Command Shroud</span>
              </span>
              <span class="mc-arrow">›</span>
            </button>

            <button type="button" class="menu-command-card" id="btn-menu-armory">
              <span class="mc-icon">▦</span>
              <span class="mc-copy">
                <span class="mc-title">FORMATION ARMORY</span>
                <span class="mc-sub">Build, Mirror &amp; Save 21-Unit Blueprints</span>
              </span>
              <span class="mc-arrow">›</span>
            </button>

            <button type="button" class="menu-command-card" id="btn-menu-manual">
              <span class="mc-icon">◈</span>
              <span class="mc-copy">
                <span class="mc-title">FIELD MANUAL &amp; RANKS</span>
                <span class="mc-sub">Interactive 3D Rank &amp; Spy/Private Hierarchy</span>
              </span>
              <span class="mc-arrow">›</span>
            </button>

            <button type="button" class="menu-command-card" id="btn-menu-options">
              <span class="mc-icon">⚙</span>
              <span class="mc-copy">
                <span class="mc-title">OPTIONS &amp; ERA RULES</span>
                <span class="mc-sub">1980s / 1970s Ruleset, Mixer &amp; Display</span>
              </span>
              <span class="mc-arrow">›</span>
            </button>
          </div>

          <!-- Sub-Panel A: Skirmish Commander & Era Selector -->
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
              <span class="era-inline-label">ERA RULESET</span>
              <div class="seg-track" id="seg-skirmish-era">
                <button type="button" data-sk-era="1980s">1980s Electronic</button>
                <button type="button" data-sk-era="1970s">1970s Classic</button>
              </div>
            </div>
            <button type="button" class="primary-brass-cta cta-sheen" id="btn-start-skirmish">
              DEPLOY FORCES — MOBILIZE
            </button>
          </div>

          <!-- Sub-Panel B: 6-Tier Command Campaign Gauntlet -->
          <div class="title-sub-sheet" id="title-sub-campaign" hidden>
            <div class="sub-sheet-header">
              <span class="sub-sheet-title">COMMAND CAMPAIGN</span>
              <span class="mono-stat-pill" id="campaign-stats-badge">MEDALS 0/6 • WIN 0%</span>
              <button type="button" class="mini-brass-btn" data-back-root="true">← MENU</button>
            </div>
            <div class="cmd-grid-6" id="campaign-cmd-grid"></div>
            <div class="cmd-dossier-blurb" id="campaign-cmd-summary"></div>
            <button type="button" class="primary-brass-cta cta-sheen" id="btn-launch-campaign">
              LAUNCH CAMPAIGN OPERATION
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
           3. IN-MATCH SAFE-ZONE TOP TRIO (COUNTDOWN | STATE + BAR | ROUND)
           ===================================================================== -->
      <header class="play-top-trio" id="play-top-trio" hidden>
        <div class="clock-pill">
          <span class="clock-micro-label">COUNTDOWN</span>
          <span class="clock-mono-val" id="val-countdown">10:00</span>
        </div>

        <div class="state-banner-pill" id="pill-turn-state" data-tone="player">
          <span class="state-banner-text" id="text-turn-state">YOUR TURN</span>
          <div class="turn-progress-track">
            <div class="turn-progress-fill" id="turn-progress-fill"></div>
          </div>
        </div>

        <div class="clock-pill" id="pill-round-timer" data-urgent="false">
          <span class="clock-micro-label">ROUND</span>
          <span class="clock-mono-val" id="val-round-timer">00:45</span>
        </div>
      </header>

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

        <!-- Pop-up Sheet: Options, Era Rules & 4-Bus Audio Mixer -->
        <div class="smoked-sheet" id="sheet-options" hidden>
          <div class="sub-sheet-header">
            <span class="sub-sheet-title">OPTIONS &amp; ERA RULES</span>
            <div class="hud-orb-cluster">
              <button type="button" class="mini-brass-btn" id="btn-opt-showcase">SHOWCASE</button>
              <button type="button" class="mini-brass-btn" id="btn-opt-mainmenu">MAIN MENU</button>
              <button type="button" class="mini-brass-btn" data-close-sheet="true">✕</button>
            </div>
          </div>
          <div class="options-grid">
            <div class="setting-row">
              <span>Era &amp; Flag Rule</span>
              <div class="seg-track" id="seg-era">
                <button type="button" data-era="1980s" title="Instant back-row Flag win">1980s Instant</button>
                <button type="button" data-era="1970s" title="1-turn deferred Flag check">1970s Classic</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Display</span>
              <div class="seg-track" id="seg-fullscreen">
                <button type="button" data-fs="false">Framed</button>
                <button type="button" data-fs="true">Fullscreen</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Camera Tilt</span>
              <div class="seg-track" id="seg-view">
                <button type="button" data-view="COMMAND">40° Hero</button>
                <button type="button" data-view="TACTICAL">32° Low</button>
                <button type="button" data-view="OVERHEAD">62° Top</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Battle Pace</span>
              <div class="seg-track" id="seg-speed">
                <button type="button" data-speed="1x">1x Cinema</button>
                <button type="button" data-speed="1.75x">1.75x Fast</button>
              </div>
            </div>
            <div class="setting-row">
              <span>Music Bus</span>
              <input type="range" class="bus-slider" id="slider-music" min="0" max="100" step="5" value="85" aria-label="Music Bus" />
            </div>
            <div class="setting-row">
              <span>SFX Foley</span>
              <input type="range" class="bus-slider" id="slider-sfx" min="0" max="100" step="5" value="95" aria-label="SFX Bus" />
            </div>
            <div class="setting-row">
              <span>Ambiance</span>
              <input type="range" class="bus-slider" id="slider-ambiance" min="0" max="100" step="5" value="75" aria-label="Ambiance Bus" />
            </div>
            <div class="setting-row">
              <span>Haptics / Audio</span>
              <div class="hud-orb-cluster">
                <div class="seg-track" id="seg-haptics">
                  <button type="button" data-haptics="true">Vib</button>
                  <button type="button" data-haptics="false">Off</button>
                </div>
                <div class="seg-track" id="seg-mute">
                  <button type="button" data-mute="false">Sound</button>
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
              <button type="button" class="mob-preset-pill" data-dep-preset="VACCINATION">Vaccination</button>
              <button type="button" class="mob-preset-pill" data-dep-preset="MOTHERSHIP">Mothership</button>
              <button type="button" class="mob-preset-pill" data-dep-preset="IRON_BLITZ">Iron Blitz</button>
              <button type="button" class="mob-preset-pill" data-dep-preset="MIRAGE_DECOY">Mirage</button>
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
            <div>
              <div class="manual-rank-title" id="manual-rank-title">SPY (SECRET AGENT)</div>
              <div class="manual-rank-rule" id="manual-rank-rule">
                Eliminates all Officers (5★ down to Sergeant) &amp; Flag • Eliminated ONLY by Private!
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

        <!-- Selected Friendly Unit Micro-Strip (Floats cleanly above Bottom Safe-Zone Dock) -->
        <div class="selected-unit-strip" id="selected-unit-strip" hidden>
          <span class="sel-unit-name" id="sel-unit-name">5-STAR GENERAL</span>
          <span class="sel-unit-sep">•</span>
          <span class="sel-unit-rule" id="sel-unit-rule">Outranks all officers &amp; Privates</span>
        </div>

        <!-- In-Match Safe-Zone Bottom Dock (INTEL LEDGER | DECLASSIFIED LOG | SURRENDER | SETTINGS) -->
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
    this.skirmishGrid = this.root.querySelector('#skirmish-cmd-grid')!;
    this.campaignGrid = this.root.querySelector('#campaign-cmd-grid')!;
    this.campaignStatsBadge = this.root.querySelector('#campaign-stats-badge')!;
    this.titleFsBtn = this.root.querySelector('#btn-title-fs')!;
    this.titleMuteBtn = this.root.querySelector('#btn-title-mute')!;

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
    this.turnProgressFill = this.root.querySelector('#turn-progress-fill')!;
    this.roundTimerPill = this.root.querySelector('#pill-round-timer')!;
    this.roundTimerVal = this.root.querySelector('#val-round-timer')!;

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
    this.manualRankTitle = this.root.querySelector('#manual-rank-title')!;
    this.manualRankRule = this.root.querySelector('#manual-rank-rule')!;
    this.manualStatsRow = this.root.querySelector('#manual-stats-row')!;
    this.manualChipGrid = this.root.querySelector('#manual-chip-grid')!;

    this.dossierCard = this.root.querySelector('#dossier-card')!;
    this.dossierStamp = this.root.querySelector('#dossier-stamp')!;
    this.dossierTitle = this.root.querySelector('#dossier-title')!;
    this.dossierMethod = this.root.querySelector('#dossier-method')!;
    this.dossierMedalBanner = this.root.querySelector('#dossier-medal')!;
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
  }

  public openSuspectWheel(pieceId: string, clientX: number, clientY: number): void {
    this.suspectTargetPieceId = pieceId;
    const hostRect = this.root.getBoundingClientRect();
    const localX = clampVal(clientX - hostRect.left, 82, Math.max(82, hostRect.width - 82));
    const localY = clampVal(clientY - hostRect.top, 82, Math.max(82, hostRect.height - 82));
    this.suspectWheel.style.left = `${localX}px`;
    this.suspectWheel.style.top = `${localY}px`;
    this.suspectWheel.hidden = false;
  }

  public closeSuspectWheel(): void {
    this.suspectTargetPieceId = null;
    this.suspectWheel.hidden = true;
  }

  public render(view: PlayerVisibleView, options: Readonly<AppOptions>): void {
    const inTitle = view.phase === 'TITLE';
    const inArbiter = view.cameraMode === 'ARBITER';
    const inInspect = view.cameraMode === 'INSPECT_16';
    const inPlay = view.phase === 'PLAY' && !inInspect;
    const inDeploy = (view.phase === 'DEPLOY' || view.phase === 'ARMORY') && !inInspect && !inArbiter;
    const inManual = view.phase === 'FIELD_MANUAL' && !inInspect;
    const inReplay = view.phase === 'REPLAY' && !inInspect;
    const inGameOver = view.phase === 'GAME_OVER' && !inInspect && !inArbiter;
    const shrouded = Boolean(view.shroud?.active);

    if (inArbiter) {
      this.activeDrawer = 'NONE';
      this.closeSuspectWheel();
    }

    // 1. Live 3D Start Screen
    this.titleScreen.hidden = !inTitle;
    if (inTitle) {
      this.titleMainCards.hidden = this.titleSubView !== 'ROOT';
      this.titleSkirmishPanel.hidden = this.titleSubView !== 'SKIRMISH';
      this.titleCampaignPanel.hidden = this.titleSubView !== 'CAMPAIGN';
      this.titleMuteBtn.innerHTML = options.audioMuted ? ICON_AUDIO_MUTED : ICON_AUDIO_ON;
      this.titleFsBtn.innerHTML = this.fullscreenActive
        ? ICON_FULLSCREEN_EXIT
        : ICON_FULLSCREEN_ENTER;

      this.syncTitleCampaignAndSkirmish(view, options);
    }

    // 2. Top Utility Header (Non-Title, Non-Play screens)
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
        const facTag =
          view.matchMode === 'PASS_AND_PLAY'
            ? view.viewingFaction === 'PLAYER'
              ? 'NAVY DEPLOYMENT'
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

    // 3. In-Match Top Safe-Zone Trio (`COUNTDOWN` | `STATE + PROGRESS` | `ROUND TIMER`)
    const showTopTrio = inPlay || inArbiter;
    this.playTopTrio.hidden = !showTopTrio;
    if (showTopTrio) {
      this.countdownVal.textContent = formatClock(view.matchClockSec);
      this.roundTimerVal.textContent = formatClock(view.turnClockSec);
      const isUrgent = !inArbiter && view.turnClockSec <= 10;
      this.roundTimerPill.dataset['urgent'] = String(isUrgent);

      const pct = Math.max(0, Math.min(100, (view.turnClockSec / view.turnClockMaxSec) * 100));
      this.turnProgressFill.style.width = `${inArbiter ? 100 : pct}%`;

      if (inArbiter) {
        this.centerStateText.textContent =
          view.banner === 'ARBITRATING' ? 'ARBITRATING' : view.banner;
        this.centerStatePill.dataset['tone'] =
          view.banner.includes('VICTORY') || view.banner === 'BATTLE WINNER' ? 'gold' : 'crimson';
      } else if (view.matchMode === 'PASS_AND_PLAY') {
        this.centerStateText.textContent =
          view.activeTurn === 'PLAYER' ? 'NAVY TURN' : 'CRIMSON TURN';
        this.centerStatePill.dataset['tone'] =
          view.activeTurn === 'PLAYER' ? 'player' : 'enemy';
      } else if (view.activeTurn === 'ENEMY') {
        this.centerStateText.textContent = 'ENEMY THINKING';
        this.centerStatePill.dataset['tone'] = 'enemy';
      } else {
        this.centerStateText.textContent = 'YOUR TURN';
        this.centerStatePill.dataset['tone'] = 'player';
      }
    }

    // 4. Pass & Play Brass Privacy Command Shroud
    this.shroudOverlay.hidden = !shrouded;
    if (shrouded && view.shroud) {
      this.shroudBadge.textContent =
        view.shroud.nextFaction === 'PLAYER'
          ? 'EYES ONLY // NAVY HIGH COMMAND'
          : 'EYES ONLY // CRIMSON HIGH COMMAND';
      this.shroudHeadline.textContent = view.shroud.headline;
      this.shroudSubline.textContent = view.shroud.subline;
    }

    // 5. Pop-up Smoked-Glass Sheets (`INTEL`, `LOG`, `OPTIONS`, `SHOWCASE`)
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

    // 6. Mobilization Crate Drawer (`DEPLOY` & `ARMORY`)
    this.mobilizationDrawer.hidden = !inDeploy || shrouded;
    if (inDeploy && !shrouded) {
      const ready = view.deployedCount === ARMY_PIECE_TOTAL;
      const isArmory = view.phase === 'ARMORY';
      this.mobHeaderLabel.textContent = isArmory
        ? 'ARMORY WORKSHOP'
        : view.matchMode === 'PASS_AND_PLAY'
          ? view.viewingFaction === 'PLAYER'
            ? 'NAVY CRATE'
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
        this.launchBattleBtn.textContent = 'SEAL NAVY & PASS TO CRIMSON';
      } else {
        this.launchBattleBtn.textContent = 'READY TO LAUNCH — ENGAGE';
      }
    }

    // 7. Interactive 3D Field Manual & Ranks Sheet
    this.manualSheet.hidden = !inManual;
    if (inManual) {
      const selSpec = RANK_SPECS[view.manualSelectedRank];
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

    // 8. End-of-War Classified Military Dossier
    this.dossierCard.hidden = !inGameOver || !view.dossier;
    if (inGameOver && view.dossier) {
      const d = view.dossier;
      this.dossierCard.dataset['victory'] = String(d.playerWon);
      this.dossierStamp.textContent = `CLASSIFIED DOSSIER // ${options.eraMode} RULESET`;
      this.dossierTitle.textContent = d.winnerLabel;
      this.dossierMethod.textContent = `${d.winMethod} • ${d.detailNote}`;
      if (d.campaignMedalUnlocked) {
        this.dossierMedalBanner.hidden = false;
        this.dossierMedalBanner.textContent = `★ CAMPAIGN MEDAL AWARDED: ${d.campaignMedalUnlocked.toUpperCase()}`;
      } else {
        this.dossierMedalBanner.hidden = true;
      }
      this.dossierStatTurns.textContent = String(d.turnsElapsed);
      this.dossierStatClashes.textContent = String(
        d.playerWon ? d.clashesWonByPlayer : d.clashesWonByEnemy
      );
      this.dossierStatOfficer.textContent = d.survivingHighOfficer;
      this.dossierStatTime.textContent = d.matchDurationFormatted;
    }

    // 9. Declassified X-Ray Replay Scrubber
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

    // 10. In-Match Safe-Zone Bottom Dock + Selected Unit Strip
    const showPlayDock = inPlay && !inArbiter && !shrouded;
    this.playBottomDock.hidden = !showPlayDock;

    if (showPlayDock && view.selectedPieceId) {
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

    // Sync Options Controls
    this.syncSeg('#seg-skirmish-era button', 'skEra', options.eraMode);
    this.syncSeg('#seg-fullscreen button', 'fs', String(this.fullscreenActive));
    this.syncSeg('#seg-view button', 'view', options.boardView);
    this.syncSeg('#seg-era button', 'era', options.eraMode);
    this.syncSeg('#seg-haptics button', 'haptics', String(options.hapticsEnabled));
    this.syncSeg('#seg-speed button', 'speed', options.arbiterSpeed);
    this.syncSeg('#seg-mute button', 'mute', String(options.audioMuted));

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
    const totalGames = camp.totalWins + camp.totalLosses;
    const winPct = totalGames > 0 ? Math.round((camp.totalWins / totalGames) * 100) : 0;

    const menuSub = this.root.querySelector('#menu-campaign-sub');
    if (menuSub) {
      menuSub.textContent = `Tier ${camp.unlockedTier}/6 Unlocked • ${medalsCount}/6 Medals • ${winPct}% Win`;
    }
    this.campaignStatsBadge.textContent = `MEDALS ${medalsCount}/6 • WIN ${winPct}%`;

    const activeCmd = getCommanderProfile(view.commanderId);
    const skSummary = this.root.querySelector('#skirmish-cmd-summary');
    if (skSummary) {
      skSummary.textContent = `${activeCmd.fullName} ("${activeCmd.moniker}") — ${activeCmd.summary}`;
    }
    const campSummary = this.root.querySelector('#campaign-cmd-summary');
    if (campSummary) {
      campSummary.textContent = `${activeCmd.fullName} ("${activeCmd.moniker}") — ${activeCmd.summary}`;
    }

    this.skirmishGrid
      .querySelectorAll<HTMLButtonElement>('[data-skirmish-cmd]')
      .forEach((btn) => {
        btn.dataset['selected'] = String(btn.dataset['skirmishCmd'] === view.commanderId);
      });

    // Rebuild Campaign 6-Tier Grid cleanly with Tactical Portraits & Monikers
    this.campaignGrid.innerHTML = COMMANDER_ROSTER.map((c) => {
      const unlocked = c.tier <= camp.unlockedTier;
      const rec = camp.records[c.id];
      const selected = view.commanderId === c.id && unlocked;
      return `
        <button
          type="button"
          class="cmd-select-card"
          data-campaign-cmd="${c.id}"
          data-selected="${selected}"
          data-locked="${!unlocked}"
          ${!unlocked ? 'disabled' : ''}
        >
          <span class="cmd-portrait-box">${c.portraitSvg}</span>
          <span class="cmd-card-meta">
            <span class="cmd-card-top">
              <span class="cmd-tier-tag">${unlocked ? `T${c.tier}` : '🔒'}</span>
              <span class="cmd-doctrine-tag">${rec.medalEarned ? '★ MEDAL' : `"${c.moniker}"`}</span>
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

  private renderIntelLedger(view: PlayerVisibleView): void {
    const L = view.intelLedger;
    const cmd = getCommanderProfile(view.commanderId);
    const ownLabel = view.viewingFaction === 'PLAYER' ? 'NAVY COMMAND' : 'CRIMSON COMMAND';
    const oppLabel =
      view.matchMode === 'PASS_AND_PLAY'
        ? view.viewingFaction === 'PLAYER'
          ? 'CRIMSON (SEALED)'
          : 'NAVY (SEALED)'
        : `${cmd.fullName.toUpperCase()} ("${cmd.moniker.toUpperCase()}")`;
    this.intelBody.innerHTML = `
      <div class="intel-col">
        <div class="intel-col-hdr cyan">${ownLabel}</div>
        <div class="intel-kv"><span>Officers Active</span><strong>${L.ownOfficersAlive}</strong></div>
        <div class="intel-kv"><span>Privates Active</span><strong>${L.ownPrivatesAlive}</strong></div>
        <div class="intel-kv"><span>Spies Active</span><strong>${L.ownSpiesAlive}</strong></div>
        <div class="intel-kv"><span>Flag Status</span><strong>${L.ownFlagAlive ? 'SECURED' : 'LOST'}</strong></div>
      </div>
      <div class="intel-col">
        <div class="intel-col-hdr crimson">${oppLabel}</div>
        <div class="intel-kv"><span>Unconfirmed Units</span><strong>${L.enemyUnconfirmedAlive}</strong></div>
        <div class="intel-kv"><span>Confirmed Eliminated</span><strong>${L.enemyEliminatedTotal}</strong></div>
        <div class="intel-kv"><span>Blooded Veterans (★)</span><strong>${L.enemyVeteranCount}</strong></div>
        <div class="intel-kv"><span>Tagged Suspects</span><strong>${L.enemyTaggedCount}</strong></div>
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
    // 1. Title Screen Main 6 Command Cards
    this.root.querySelector('#btn-menu-skirmish')?.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.playDrawerSlide(true);
      this.titleSubView = 'SKIRMISH';
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

    // 2. Top Utility Header Controls
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

    // 4. Bottom Dock Controls + 2-Step Hold-to-Confirm Surrender!
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

    // 9. Showcase & Options Bindings
    this.sheetShowcase.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset['preset'] as ShowcasePreset;
        this.activeDrawer = 'NONE';
        const verdict = this.store.triggerShowcaseClash(preset);
        if (verdict) {
          this.callbacks.onTriggerVerdict(verdict);
        }
      });
    });

    this.root.querySelector('#btn-inspect-16')?.addEventListener('click', () => {
      this.sound.playUiClick();
      this.activeDrawer = 'NONE';
      const cur = this.store.getVisibleView().cameraMode;
      this.store.setCameraMode(cur === 'INSPECT_16' ? 'PLAY' : 'INSPECT_16');
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

  private bindTwoStepSurrender(): void {
    const HOLD_DURATION_MS = 780;

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
      const elapsed = performance.now() - this.surrenderHoldStart;
      const pct = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
      this.surrenderFill.style.width = `${pct}%`;

      if (pct >= 100) {
        this.surrenderHolding = false;
        this.surrenderArmedUntil = 0;
        this.surrenderFill.style.width = '0%';
        this.surrenderLabel.textContent = 'SURRENDER';
        this.surrenderBtn.dataset['armed'] = 'false';
        this.sound.vibrate([40, 30, 65]);
        this.store.surrenderMatch();
        return;
      }
      this.surrenderHoldRaf = requestAnimationFrame(tickHold);
    };

    this.surrenderBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.sound.unlock();
      const now = performance.now();

      // Step 1: First tap arms the surrender lock for 3.5 seconds so stray thumb brushes never forfeit!
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

      // Step 2: Press-and-hold fills the brass-crimson confirmation bar!
      this.surrenderHolding = true;
      this.surrenderHoldStart = now;
      this.sound.vibrate(14);
      cancelAnimationFrame(this.surrenderHoldRaf);
      this.surrenderHoldRaf = requestAnimationFrame(tickHold);
    });

    window.addEventListener('pointerup', () => {
      if (this.surrenderHolding) resetHold();
    });
    window.addEventListener('pointercancel', () => {
      if (this.surrenderHolding) resetHold();
    });
  }

  private syncSeg(selector: string, dataKey: string, expected: string): void {
    this.root.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.dataset['selected'] = String(btn.dataset[dataKey] === expected);
    });
  }
}
