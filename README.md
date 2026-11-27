# War Generals (*Salpakan* 3D Mobile Strategy)

Mobile-first `9:16` 3D WebGL2 & installable PWA tactical strategy game inspired by classic *Salpakan* electronic hardware, featuring a physical PBR oiled-walnut `9×8` slate board, 16 CAD-beveled metallic rank reliefs, dual-era procedural WebAudio synthesis (`1980s` Electro-Mechanical Hybrid | `1970s` Military Brass/Snare), and a 3-Act theatrical 3D Electronic Arbiter.

## Completed Architecture (Block 1 & Block 2)
- **Strict Information Asymmetry (`src/state/GameStore.ts`, `src/ai/AIBeliefState.ts`):** `BoardTruthState` is isolated inside a private `#truthPieces` vault; rendering and UI consume exclusively `PlayerVisibleView` (`visibleRank: 'UNKNOWN'` on enemy wedges rotated `180°`).
- **Ultra-HD 3D PBR Pipeline (`src/graphics/`):**
  - `ACESFilmicToneMapping` (`1.12`), `2048×2048` `PCFSoftShadowMap`, procedural studio + `2700K` tent-lantern `PMREMGenerator` HDRI, selective `UnrealBloomPass`, and tabletop tilt-shift Depth of Field.
  - Mitered oiled-walnut cabinet, flush brushed-brass collars, `72` (`9×8`) instanced beveled charcoal-slate tiles, twin cobalt-navy & crimson-burgundy velvet casualty wells, topological war maps, live ticking brass pocket watch, spiral field notebook, and flickering tent lanterns.
  - Asymmetric 4-bevel Command Wedges (`68°` front insignia slope, `78°` blank rear shield) + all 15 3D metallic rank reliefs (11 Brushed Brass `#C8963E` + 4 Brushed Silver `#C9CFD6`) + chamfered Attack Medallion.
- **3-Act Theatrical Electronic Arbiter (`src/arbiter/ArbiterStage3D.ts`):**
  - **Act 1 (`Clash Lock-In`):** Retracting ribbed gunmetal tambour shutter, heavy Attack Medallion drop, spring-loaded brass pad slams, radial grind sparks, and glowing cyan/crimson rings.
  - **Act 2 (`Arbitrating`):** Rising 4-dome Fresnel beacons, dual glass vacuum tubes over 4-column segmented amber VU bars, curved CRT oscilloscope driven by live WebAudio `AnalyserNode` waveform data, and crackling golden relay arcs.
  - **Act 3 (`Battle Winner` / `Mutual Elimination` / `Victory`):** Hydraulic winner elevation inside a soft golden spotlight shaft while defeated pads hinge open `78°` as red-rimmed trapdoor chutes before transferring casualties into the velvet wells.

## Development & Asset Pipeline
```bash
npm install
npm run dev          # Local Vite mobile preview
npm run build        # Strict tsc + production ./dist build
npm run bake:models  # Headless Blender 5.x .glb asset bake (tools/blender/generate_assets.py)
```
