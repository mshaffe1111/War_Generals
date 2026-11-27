# WAR GENERALS (SALPAKAN) — ARCHITECTURE & ANTI-SLOP ENGINEERING LAWS

## 1. Project Identity & Platform Contract
- **Title:** War Generals (*Salpakan* Electronic Strategy Game)
- **Target Platform:** Mobile-Only 3D Web Application & Full-Screen Installable PWA (`9:16` Portrait primary viewport, touch-first ergonomics), engineered to run directly from **GitHub Pages** (`base: './'`) with zero backend dependencies.
- **Tech Stack:** TypeScript + Vite + Three.js (WebGL2 Physical PBR Pipeline, `ACESFilmicToneMapping`, `PMREMGenerator` studio+lantern HDRI, `UnrealBloomPass`, tabletop tilt-shift Depth of Field) + WebAudio API Dual-Era Synthesizer (`1980s` Electro-Mechanical Hybrid | `1970s` Snare/Timpani/Brass) + Headless Blender (`bpy`) `.glb` pipeline (`public/models/`) paired with CAD-beveled `ExtrudeGeometry` PBR generation (`src/graphics/MeshFactory.ts`).
- **Nomenclature Law:** Always use **"War Generals"** or **"Salpakan"** nomenclature.

## 2. Hard Anti-Slop Engineering Bans (Zero Exceptions)
1. **NO Unlit or Flat Box Primitives:** Never use `MeshBasicMaterial` for 3D scene props, raw sharp-edged `BoxGeometry` cubes, or 2D HTML text labels pasted onto rectangles to represent pieces, insignias, or the Electronic Arbiter. Every 3D element must feature chamfered/beveled edges, physically based metallic/roughness/clearcoat/sheen properties, and procedural normal/bump micro-detail.
2. **NO Center-Screen Popup Modals During Battle:** Never cover the board with an HTML modal or spinner during clashes. All clash suspense unfolds physically in 3D inside the docked Electronic Arbiter (`Act 1: Clash Lock-In` -> `Act 2: Arbitrating` -> `Act 3: Battle Winner / Mutual Split / Flag Captured`).
3. **NO Cheating CPU Reads (Information Asymmetry Wall):**
   - `BoardTruthState` is encapsulated inside a private `#truth` vault owned solely by the Arbiter coordinator.
   - 3D Rendering & UI consume exclusively `PlayerVisibleView` (enemy ranks masked as `'UNKNOWN'`, rotated `180°` so only unmarked rear bevels face the camera).
   - AI modules (`src/ai/AIBeliefState.ts`) consume exclusively public move coordinates and rank-blind `ArbiterVerdict` outcomes—never `trueRank`.
4. **Strict Mobile-Only Viewport Lock:**
   - `html, body` are locked to `width: 100vw; height: 100dvh; overflow: hidden; touch-action: none; user-select: none; -webkit-tap-highlight-color: transparent;`.
   - On desktop viewports wider than `9:16`, the game centers automatically inside a `9:16` mobile studio chassis frame with dark letterboxing, and all pointer raycasts resolve relative to `canvas.getBoundingClientRect()`.

## 3. Official War Generals (Salpakan) Clash Resolution Matrix
- **Army Roster (21 Pieces per Side):**
  - Officers (1 each): `5-Star General`, `4-Star General`, `3-Star General`, `2-Star General`, `1-Star General`, `Colonel`, `Lt. Colonel`, `Major`, `Captain`, `1st Lieutenant`, `2nd Lieutenant`, `Sergeant`
  - Enlisted & Special: `Private` (×6), `Spy` (×2), `Flag` (×1)
  - Board Token: Chamfered brushed-brass `Attack Medallion`
- **Resolution Laws:**
  1. Higher-ranking Officer/Private eliminates lower-ranking Officer/Private.
  2. `Spy` eliminates all Officers (`5-Star General` down to `Sergeant`), regardless of who initiated the challenge.
  3. `Private` is the **only** rank that eliminates `Spy` (regardless of who initiated).
  4. Equal ranks (`Officer == Officer`, `Private == Private`, `Spy == Spy`) eliminate **both** pieces simultaneously (`MUTUAL_SPLIT`).
  5. Any piece challenging the enemy `Flag` captures it (`FLAG_CAPTURED`), **including** when an aggressor (moving) `Flag` challenges the defending enemy `Flag`. If a moving `Flag` challenges any non-Flag enemy piece, the moving `Flag` is eliminated.

## 4. Modular Directory Architecture
- `src/core/` — Canonical rank definitions, grid geometry constants, and strict TypeScript contracts
- `src/state/` — Encapsulated `BoardTruthState` vault and `PlayerVisibleView` projection store
- `src/arbiter/` — Pure `ArbiterResolver` clash engine and `ArbiterStage3D` 3-Act theatrical 3D hardware sequence
- `src/graphics/` — `SceneManager`, `MeshFactory`, procedural PBR textures/HDRI, board/war-room environment, command wedges, and move/reticle indicators
- `src/audio/` — `SoundDirector` dual-era (`1980s` | `1970s`) procedural WebAudio synthesizer & real-time `AnalyserNode` bridge
- `src/ai/` — Non-cheating `AIBeliefState` Bayesian/constraint probability tracker
- `src/ui/` — Chamfered smoked-glass safe-zone HUD, Showcase trigger pill, and Options drawer
- `tools/blender/` — Headless Blender (`bpy`) `.glb` generator outputting `public/models/`
