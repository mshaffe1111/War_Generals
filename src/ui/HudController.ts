import type { SoundDirector } from '../audio/SoundDirector';
import { RANK_SPECS } from '../core/ranks';
import type { AppOptions, ArbiterVerdict, PlayerVisibleView } from '../core/types';
import type { GameStore, ShowcasePreset } from '../state/GameStore';

export class HudController {
  private readonly root: HTMLElement;
  private readonly store: GameStore;
  private readonly sound: SoundDirector;
  private readonly onTriggerVerdict: (verdict: ArbiterVerdict) => void;

  private showcaseOpen = false;
  private optionsOpen = false;

  private readonly statusPill: HTMLElement;
  private readonly showcaseBtn: HTMLButtonElement;
  private readonly optionsBtn: HTMLButtonElement;
  private readonly showcaseDrawer: HTMLElement;
  private readonly optionsDrawer: HTMLElement;
  private readonly bottomCard: HTMLElement;
  private readonly rankTitleEl: HTMLElement;
  private readonly rankSubEl: HTMLElement;
  private readonly tallyNavyEl: HTMLElement;
  private readonly tallyCrimsonEl: HTMLElement;

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
          <button type="button" class="hud-icon-btn" id="btn-showcase">Showcase</button>
          <div class="hud-status-pill" id="hud-status-pill">TACTICAL COMMAND</div>
          <button type="button" class="hud-icon-btn" id="btn-options">Options</button>
        </div>

        <div class="hud-drawer" id="drawer-showcase" hidden>
          <div class="drawer-grid">
            <button type="button" class="drawer-chip" data-preset="PLAYER_WIN" data-variant="gold">Act 1–3: Win</button>
            <button type="button" class="drawer-chip" data-preset="ENEMY_WIN" data-variant="crimson">Act 1–3: Loss</button>
            <button type="button" class="drawer-chip" data-preset="MUTUAL_SPLIT" data-variant="cyan">Act 1–3: Split</button>
            <button type="button" class="drawer-chip" data-preset="FLAG_CAPTURE" data-variant="gold">Flag Victory</button>
            <button type="button" class="drawer-chip" id="btn-inspect-16" data-variant="cyan">16-Rank Gallery</button>
            <button type="button" class="drawer-chip" id="btn-reset-board">Reset Board</button>
          </div>
        </div>

        <div class="hud-drawer" id="drawer-options" hidden>
          <div class="option-row">
            <span>Audio Era</span>
            <div class="option-seg" id="seg-era">
              <button type="button" data-era="1980s">1980s Synth</button>
              <button type="button" data-era="1970s">1970s Brass</button>
            </div>
          </div>
          <div class="option-row">
            <span>Arbiter Speed</span>
            <div class="option-seg" id="seg-speed">
              <button type="button" data-speed="1x">1x Cinema</button>
              <button type="button" data-speed="1.75x">1.75x Brisk</button>
            </div>
          </div>
          <div class="option-row">
            <span>Render Scale</span>
            <div class="option-seg" id="seg-quality">
              <button type="button" data-quality="ULTRA">Ultra 2.5x</button>
              <button type="button" data-quality="BALANCED">Balanced 1.5x</button>
            </div>
          </div>
          <div class="option-row">
            <span>Master Audio</span>
            <div class="option-seg" id="seg-mute">
              <button type="button" data-mute="false">Sound On</button>
              <button type="button" data-mute="true">Muted</button>
            </div>
          </div>
        </div>
      </div>

      <div class="hud-bottom-card" id="hud-bottom-card">
        <div class="hud-rank-meta">
          <div class="hud-rank-title" id="hud-rank-title">SELECT COMMAND WEDGE</div>
          <div class="hud-rank-sub" id="hud-rank-sub">Tap any Cobalt-Navy piece to plot orthogonal moves or challenge adjacent Crimson forces.</div>
        </div>
        <div class="hud-tally">
          <span class="tally-navy" id="tally-navy">NAVY LOST: 0</span>
          <span class="tally-crimson" id="tally-crimson">CRIMSON LOST: 0</span>
        </div>
      </div>
    `;

    this.statusPill = this.root.querySelector('#hud-status-pill')!;
    this.showcaseBtn = this.root.querySelector('#btn-showcase')!;
    this.optionsBtn = this.root.querySelector('#btn-options')!;
    this.showcaseDrawer = this.root.querySelector('#drawer-showcase')!;
    this.optionsDrawer = this.root.querySelector('#drawer-options')!;
    this.bottomCard = this.root.querySelector('#hud-bottom-card')!;
    this.rankTitleEl = this.root.querySelector('#hud-rank-title')!;
    this.rankSubEl = this.root.querySelector('#hud-rank-sub')!;
    this.tallyNavyEl = this.root.querySelector('#tally-navy')!;
    this.tallyCrimsonEl = this.root.querySelector('#tally-crimson')!;

    this.bindEvents();
  }

  public render(view: PlayerVisibleView, options: Readonly<AppOptions>): void {
    this.statusPill.textContent = view.banner;
    if (
      view.banner === 'BATTLE WINNER' ||
      view.banner === 'FLAG CAPTURED — VICTORY'
    ) {
      this.statusPill.dataset['alert'] = 'gold';
    } else if (
      view.banner === 'MUTUAL ELIMINATION' ||
      view.banner === 'FLAG LOST — DEFEAT'
    ) {
      this.statusPill.dataset['alert'] = 'crimson';
    } else {
      delete this.statusPill.dataset['alert'];
    }

    // During the 3-Act Electronic Arbiter close-up (`ref_battle_act1..3.jpg`),
    // hide side buttons, drawers & bottom card so ONLY the top status pill frames the 3D hardware!
    const inArbiter = view.cameraMode === 'ARBITER';
    this.showcaseBtn.style.visibility = inArbiter ? 'hidden' : 'visible';
    this.optionsBtn.style.visibility = inArbiter ? 'hidden' : 'visible';
    if (inArbiter) {
      this.showcaseOpen = false;
      this.optionsOpen = false;
    }

    this.showcaseBtn.dataset['active'] = String(this.showcaseOpen || view.cameraMode === 'INSPECT_16');
    this.optionsBtn.dataset['active'] = String(this.optionsOpen);
    this.showcaseDrawer.hidden = !this.showcaseOpen;
    this.optionsDrawer.hidden = !this.optionsOpen;

    // Bottom safe-zone card
    this.bottomCard.dataset['hidden'] = String(inArbiter);
    this.tallyNavyEl.textContent = `NAVY LOST: ${view.playerCasualties.length}`;
    this.tallyCrimsonEl.textContent = `CRIMSON LOST: ${view.enemyCasualties.length}`;

    if (view.cameraMode === 'INSPECT_16') {
      this.rankTitleEl.innerHTML = `16 METALLIC RELIEF GALLERY <span class="metal-tag" data-metal="BRASS">BRASS & SILVER</span>`;
      this.rankSubEl.textContent =
        'Top row: 4-angle Command Wedge turnaround • Grid: All 15 Salpakan rank reliefs + Attack Medallion. Tap Showcase -> 16-Rank Gallery to return.';
    } else if (view.selectedPieceId) {
      const sel = view.pieces.find((p) => p.id === view.selectedPieceId);
      if (sel && sel.visibleRank !== 'UNKNOWN') {
        const spec = RANK_SPECS[sel.visibleRank];
        this.rankTitleEl.innerHTML = `${spec.name} <span class="metal-tag" data-metal="${spec.metal}">${spec.metal}</span>`;
        this.rankSubEl.textContent = spec.tacticalRule;
      }
    } else {
      this.rankTitleEl.textContent = 'WAR GENERALS • SALPAKAN SANDBOX';
      this.rankSubEl.textContent =
        'Tap any Cobalt-Navy wedge to project cyan move vectors & challenge adjacent Crimson forces.';
    }

    const inspectBtn = this.root.querySelector<HTMLButtonElement>('#btn-inspect-16');
    if (inspectBtn) {
      inspectBtn.textContent =
        view.cameraMode === 'INSPECT_16' ? 'Return to Board' : '16-Rank Gallery';
    }

    // Sync Option segmented highlights
    this.syncSeg('#seg-era button', 'era', options.eraMode);
    this.syncSeg('#seg-speed button', 'speed', options.arbiterSpeed);
    this.syncSeg('#seg-quality button', 'quality', options.renderQuality);
    this.syncSeg('#seg-mute button', 'mute', String(options.audioMuted));
  }

  private bindEvents(): void {
    this.showcaseBtn.addEventListener('click', () => {
      this.sound.playSelect();
      this.showcaseOpen = !this.showcaseOpen;
      if (this.showcaseOpen) this.optionsOpen = false;
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.optionsBtn.addEventListener('click', () => {
      this.sound.playSelect();
      this.optionsOpen = !this.optionsOpen;
      if (this.optionsOpen) this.showcaseOpen = false;
      this.render(this.store.getVisibleView(), this.store.getOptions());
    });

    this.showcaseDrawer.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
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
