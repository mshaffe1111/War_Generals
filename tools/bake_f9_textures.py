#!/usr/bin/env python3
"""
Generates Ultra-HD F9 PBR Textures for War Generals (`public/textures/`):
  - `vintage_war_map_left.jpg` (2048x1536) — Engraved Land Theater Tactical Cartography
  - `vintage_war_map_right.jpg` (2048x1536) — Naval & Artillery Triangulation Chart
  - `war_map_normal.jpg` (1024x768) — Parchment Fiber & Engraved Contour Normal Map
  - `mud_albedo.jpg` (1024x1024) — Shell-Cratered Trench Earth / Loam Albedo
  - `mud_normal.jpg` (1024x1024) — Cratered Soil & Gravel Normal Map
"""

import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.ndimage import gaussian_filter, sobel

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEX_DIR = os.path.join(ROOT_DIR, "public", "textures")


def fbm_2d(h: int, w: int, octaves=(4, 8, 16, 32, 64), weights=(0.45, 0.25, 0.15, 0.10, 0.05), seed=42):
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), dtype=np.float32)
    for freq, wt in zip(octaves, weights):
        gh = max(2, freq)
        gw = max(2, int(freq * (w / h)))
        grid = rng.random((gh, gw), dtype=np.float32)
        pil_grid = Image.fromarray((grid * 255.0).astype(np.uint8), mode="L").resize(
            (w, h), resample=Image.Resampling.BICUBIC
        )
        acc += (np.asarray(pil_grid, dtype=np.float32) / 255.0) * wt
    acc -= acc.min()
    if acc.max() > 1e-6:
        acc /= acc.max()
    return acc


def height_to_normal(height: np.ndarray, strength: float = 2.6) -> Image.Image:
    # Wrap-friendly Sobel gradients
    gx = sobel(height.astype(np.float32), axis=1, mode="wrap") * strength
    gy = sobel(height.astype(np.float32), axis=0, mode="wrap") * strength
    nx = -gx
    ny = gy
    nz = np.ones_like(height, dtype=np.float32)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-8
    rgb = np.stack(
        [
            ((nx / norm) * 0.5 + 0.5) * 255.0,
            ((ny / norm) * 0.5 + 0.5) * 255.0,
            ((nz / norm) * 0.5 + 0.5) * 255.0,
        ],
        axis=-1,
    )
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")


def bake_mud_pbr(size: int = 1024):
    base = fbm_2d(size, size, octaves=(6, 12, 24, 48, 96, 192), weights=(0.34, 0.24, 0.18, 0.12, 0.08, 0.04), seed=107)
    fine = fbm_2d(size, size, octaves=(64, 128, 256), weights=(0.5, 0.3, 0.2), seed=313)

    # Stamp realistic artillery shell craters with raised earthen rims
    rng = np.random.default_rng(88)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    craters = np.zeros((size, size), dtype=np.float32)
    for _ in range(28):
        cx = rng.uniform(0, size)
        cy = rng.uniform(0, size)
        rad = rng.uniform(22.0, 74.0)
        dx = np.minimum(np.abs(xx - cx), size - np.abs(xx - cx))
        dy = np.minimum(np.abs(yy - cy), size - np.abs(yy - cy))
        r = np.sqrt(dx * dx + dy * dy) / rad
        bowl = -0.58 * np.exp(-r * r * 3.1)
        rim = 0.32 * np.exp(-((r - 1.05) ** 2) / 0.08)
        craters += bowl + rim

    height = np.clip(0.52 * base + 0.24 * fine + 0.24 * (craters * 0.5 + 0.5), 0.0, 1.0)
    height = gaussian_filter(height, sigma=0.7)

    # Colorize: dark damp trench loam in crater bowls, dry ochre-umber on ridges & pebbles
    wet_mask = np.clip(1.0 - height * 1.35, 0.0, 1.0)
    r_ch = 58.0 + height * 54.0 - wet_mask * 16.0 + (fine - 0.5) * 18.0
    g_ch = 44.0 + height * 42.0 - wet_mask * 14.0 + (fine - 0.5) * 14.0
    b_ch = 33.0 + height * 31.0 - wet_mask * 10.0 + (fine - 0.5) * 10.0

    albedo_arr = np.stack([r_ch, g_ch, b_ch], axis=-1)
    albedo_img = Image.fromarray(np.clip(albedo_arr, 0, 255).astype(np.uint8), mode="RGB")
    normal_img = height_to_normal(height, strength=3.4)

    albedo_img.save(os.path.join(TEX_DIR, "mud_albedo.jpg"), quality=92)
    normal_img.save(os.path.join(TEX_DIR, "mud_normal.jpg"), quality=92)
    print("Baked mud_albedo.jpg & mud_normal.jpg (1024x1024)")


def draw_compass_rose(draw: ImageDraw.ImageDraw, cx: int, cy: int, radius: int, ink: tuple, gold: tuple):
    for r in (radius, int(radius * 0.84), int(radius * 0.55)):
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=ink, width=2 if r == radius else 1)
    for deg in range(0, 360, 10):
        a = math.radians(deg)
        r0 = radius * (0.84 if deg % 30 == 0 else 0.91)
        draw.line(
            (cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a) * radius, cy + math.sin(a) * radius),
            fill=ink,
            width=2 if deg % 30 == 0 else 1,
        )
    # 8-point compass star
    for i in range(8):
        a = i * math.pi / 4.0 - math.pi / 2.0
        tip_r = radius * (0.78 if i % 2 == 0 else 0.52)
        side_r = radius * 0.13
        tip = (cx + math.cos(a) * tip_r, cy + math.sin(a) * tip_r)
        left = (cx + math.cos(a - math.pi / 2.0) * side_r, cy + math.sin(a - math.pi / 2.0) * side_r)
        right = (cx + math.cos(a + math.pi / 2.0) * side_r, cy + math.sin(a + math.pi / 2.0) * side_r)
        draw.polygon([(cx, cy), left, tip], fill=ink)
        draw.polygon([(cx, cy), tip, right], fill=gold)


def bake_war_map(filename: str, seed: int, is_naval: bool, write_normal: bool = False):
    w, h = 2048, 1536
    fiber = fbm_2d(h, w, octaves=(4, 10, 28, 72, 160), weights=(0.35, 0.25, 0.2, 0.12, 0.08), seed=seed)
    terrain = fbm_2d(h, w, octaves=(3, 6, 12, 24, 48), weights=(0.45, 0.25, 0.16, 0.09, 0.05), seed=seed + 99)

    # Warm aged linen parchment base with subtle radial edge vignette
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (xx / w - 0.5) * 2.0
    dy = (yy / h - 0.5) * 2.0
    vig = np.clip(1.0 - 0.26 * (dx * dx + dy * dy), 0.65, 1.0)

    sea_level = 0.54 if is_naval else 0.45
    land_mask = terrain > sea_level

    r = (198.0 + (fiber - 0.5) * 28.0) * vig
    g = (176.0 + (fiber - 0.5) * 24.0) * vig
    b = (138.0 + (fiber - 0.5) * 20.0) * vig

    # Subtle bathymetric tint for sea & ochre/olive shading for landmass
    r = np.where(land_mask, r * 0.99, r * 0.87)
    g = np.where(land_mask, g * 0.97, g * 0.92)
    b = np.where(land_mask, b * 0.88, b * 0.97)

    # Topographic contour lines
    contour_step = 0.045
    contour_dist = np.abs(((terrain - sea_level) / contour_step) - np.round((terrain - sea_level) / contour_step))
    contour_line = (contour_dist < 0.055) & (terrain > sea_level)
    coast_line = np.abs(terrain - sea_level) < 0.008

    r = np.where(contour_line, r * 0.72, r)
    g = np.where(contour_line, g * 0.68, g)
    b = np.where(contour_line, b * 0.62, b)

    r = np.where(coast_line, 58.0, r)
    g = np.where(coast_line, 46.0, g)
    b = np.where(coast_line, 34.0, b)

    base_img = Image.fromarray(np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(base_img)

    ink = (52, 40, 28)
    faint_ink = (96, 78, 56)
    crimson_ink = (136, 42, 34)
    navy_ink = (36, 66, 98)
    gold_ink = (176, 134, 62)

    # Outer engraved cartographic double frame + degree ticks
    m1, m2 = 44, 62
    draw.rectangle((m1, m1, w - m1, h - m1), outline=ink, width=4)
    draw.rectangle((m2, m2, w - m2, h - m2), outline=ink, width=2)
    for x in range(m2, w - m2, 64):
        draw.line((x, m1, x, m2), fill=ink, width=2)
        draw.line((x, h - m2, x, h - m1), fill=ink, width=2)
    for y in range(m2, h - m2, 64):
        draw.line((m1, y, m2, y), fill=ink, width=2)
        draw.line((w - m2, y, w - m1, y), fill=ink, width=2)

    # Sector grid lines
    for gx in range(m2 + 160, w - m2, 160):
        draw.line((gx, m2, gx, h - m2), fill=faint_ink, width=1)
    for gy in range(m2 + 160, h - m2, 160):
        draw.line((m2, gy, w - m2, gy), fill=faint_ink, width=1)

    # Strategic Frontline / Naval Bearing Vectors & Force Arrows
    if is_naval:
        # Rhumb lines radiating from compass center
        cx, cy = 1480, 1020
        for deg in range(0, 360, 15):
            a = math.radians(deg)
            draw.line((cx, cy, cx + math.cos(a) * 1800, cy + math.sin(a) * 1800), fill=(112, 96, 76), width=1)
        draw_compass_rose(draw, cx, cy, 138, ink, gold_ink)
        # Task Force Approach Arcs
        draw.arc((360, 260, 1280, 1080), 210, 340, fill=navy_ink, width=5)
        draw.arc((520, 420, 1460, 1260), 195, 315, fill=crimson_ink, width=4)
        # Range rings
        for rr in (180, 320, 460):
            draw.ellipse((740 - rr, 620 - rr, 740 + rr, 620 + rr), outline=crimson_ink, width=2)
    else:
        draw_compass_rose(draw, 320, 1180, 128, ink, gold_ink)
        # Frontline trench trace & spearhead advance vectors
        pts = [(260 + i * 130, 740 + int(math.sin(i * 0.7) * 140)) for i in range(12)]
        draw.line(pts, fill=crimson_ink, width=6)
        for px, py in pts[1::2]:
            draw.ellipse((px - 10, py - 10, px + 10, py + 10), fill=crimson_ink, outline=ink, width=2)
        # Spearhead operational arrows
        draw.line((520, 1080, 760, 760), fill=navy_ink, width=7)
        draw.polygon([(760, 760), (725, 782), (748, 804)], fill=navy_ink)
        draw.line((1020, 1120, 1180, 680), fill=navy_ink, width=7)
        draw.polygon([(1180, 680), (1152, 708), (1182, 718)], fill=navy_ink)

    # Cartouche Title Block
    draw.rectangle((w - 580, 96, w - 96, 250), fill=(214, 194, 156), outline=ink, width=3)
    draw.rectangle((w - 570, 106, w - 106, 240), outline=faint_ink, width=1)
    title = "SALPAKAN THEATRE CHART II" if is_naval else "SECTOR COMMAND TOPOGRAPHY I"
    sub = "ADMIRALTY SOUNDINGS & BEARING GRID" if is_naval else "FORTIFIED ELEVATION & TRENCH LINES"
    font = ImageFont.load_default(size=24)
    sub_font = ImageFont.load_default(size=15)
    draw.text((w - 546, 132), title, fill=ink, font=font)
    draw.text((w - 546, 180), sub, fill=crimson_ink if not is_naval else navy_ink, font=sub_font)

    out_path = os.path.join(TEX_DIR, filename)
    base_img.save(out_path, quality=93)
    print(f"Baked {filename} ({w}x{h})")

    if write_normal:
        # Subtle fiber + engraved relief normal map at 1024x768
        h_map = (fiber * 0.72 + (terrain > sea_level).astype(np.float32) * 0.28)
        h_small = np.asarray(
            Image.fromarray((h_map * 255.0).astype(np.uint8), mode="L").resize((1024, 768), Image.Resampling.BILINEAR),
            dtype=np.float32,
        ) / 255.0
        n_img = height_to_normal(h_small, strength=1.8)
        n_img.save(os.path.join(TEX_DIR, "war_map_normal.jpg"), quality=90)
        print("Baked war_map_normal.jpg (1024x768)")


if __name__ == "__main__":
    os.makedirs(TEX_DIR, exist_ok=True)
    bake_mud_pbr(1024)
    bake_war_map("vintage_war_map_left.jpg", seed=17, is_naval=False, write_normal=True)
    bake_war_map("vintage_war_map_right.jpg", seed=53, is_naval=True, write_normal=False)
