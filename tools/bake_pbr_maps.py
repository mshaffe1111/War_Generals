"""
Processes Gemini-generated Ultra-HD PBR cabinet, velvet, bay-plate, oak & cartography textures (`tools/bake_pbr_maps.py`):
  1. `public/textures/walnut_albedo.jpg` + `walnut_normal.jpg` (2048x2048 seamless museum-grade satin oiled black walnut)
  2. `public/textures/velvet_albedo.jpg` + `velvet_normal.jpg` (1024x1024 plush crushed velvet + recessed box-tray AO vignette)
  3. `public/textures/bay_plate_albedo.jpg` + `bay_plate_normal.jpg` (1024x512 machined satin gunmetal recessed dock plate
     with brushed horizontal grain, deep cavity edge AO, and the exact 6 countersunk fastener sockets of `ref_board_empty.jpg`!)
  4. `public/textures/oak_albedo.jpg` + `oak_normal.jpg` (1024x1024 weathered oak planks + deep plank normal)
  5. `public/textures/vintage_war_map_left.jpg` + `vintage_war_map_right.jpg` (two distinct engraved sepia war maps)
  6. `public/textures/tent_cyclorama.jpg` (parted canvas command tent & twin glowing oil lanterns backdrop)
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEX_DIR = os.path.join(ROOT_DIR, "public", "textures")

WALNUT_V2_SRC = r"C:\Users\mshaf\.gemini\antigravity\brain\f10c17e4-676b-4899-9851-d9b61677a348\american_black_walnut_albedo_v2_1795757708049.jpg"
VELVET_SRC = r"C:\Users\mshaf\.gemini\antigravity\brain\f10c17e4-676b-4899-9851-d9b61677a348\crushed_velvet_albedo_1795757681732.jpg"
OAK_SRC = r"C:\Users\mshaf\.gemini\antigravity\brain\f10c17e4-676b-4899-9851-d9b61677a348\oak_table_albedo_1795755614880.jpg"
MAP_SRC = r"C:\Users\mshaf\.gemini\antigravity\brain\f10c17e4-676b-4899-9851-d9b61677a348\vintage_war_map_1795755615306.jpg"
WAR_ROOM_PLATE = r"C:\Users\mshaf\.gemini\antigravity\brain\f10c17e4-676b-4899-9851-d9b61677a348\.user_uploaded\media_1795750965876_4be394a3.jpg"


def make_seamless_cross_blend(img: Image.Image, blend_frac: float = 0.18) -> Image.Image:
    """Smooth toroidal edge cross-fade so tiled wood & fabric textures have zero hard UV wrap seams."""
    arr = np.array(img, dtype=np.float32)
    h, w, _ = arr.shape
    shifted_x = np.roll(arr, w // 2, axis=1)
    u = np.linspace(0.0, 1.0, w, dtype=np.float32)
    dist_edge_x = np.minimum(u, 1.0 - u)
    wx = np.clip(dist_edge_x / blend_frac, 0.0, 1.0)[None, :, None]
    wx = wx * wx * (3.0 - 2.0 * wx)
    arr = arr * wx + shifted_x * (1.0 - wx)

    shifted_y = np.roll(arr, h // 2, axis=0)
    v = np.linspace(0.0, 1.0, h, dtype=np.float32)
    dist_edge_y = np.minimum(v, 1.0 - v)
    wy = np.clip(dist_edge_y / blend_frac, 0.0, 1.0)[:, None, None]
    wy = wy * wy * (3.0 - 2.0 * wy)
    arr = arr * wy + shifted_y * (1.0 - wy)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB")


def bake_normal_from_albedo(img: Image.Image, strength: float = 2.0) -> Image.Image:
    arr = np.array(img, dtype=np.float32) / 255.0
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    hp = np.pad(lum, 1, mode="wrap")
    dx = (
        (hp[:-2, 2:] + 2.0 * hp[1:-1, 2:] + hp[2:, 2:])
        - (hp[:-2, :-2] + 2.0 * hp[1:-1, :-2] + hp[2:, :-2])
    )
    dy = (
        (hp[2:, :-2] + 2.0 * hp[2:, 1:-1] + hp[2:, 2:])
        - (hp[:-2, :-2] + 2.0 * hp[:-2, 1:-1] + hp[:-2, 2:])
    )
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(nx)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.zeros((arr.shape[0], arr.shape[1], 3), dtype=np.uint8)
    rgb[:, :, 0] = np.clip((nx * inv * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    rgb[:, :, 1] = np.clip((ny * inv * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    rgb[:, :, 2] = np.clip((nz * inv * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def bake_machined_bay_plate():
    """
    Bakes `bay_plate_albedo.jpg` & `bay_plate_normal.jpg` (`1024x512`) matching `ref_board_empty.jpg`:
    - Satin brushed dark titanium-slate (`#525863`) with ultra-fine horizontal brushed anodization
    - Deep recessed perimeter ambient-occlusion shadow (strongest along top & side inner walls)
    - Subtle hairline center parting seam + 6 precision countersunk fastener sockets (3 top, 3 bottom)!
    """
    w, h = 1024, 512
    rng = np.random.default_rng(42)

    # Fine horizontal brushed titanium-slate micro-grain
    noise = rng.normal(0.0, 1.0, (h, w)).astype(np.float32)
    streak_img = Image.fromarray(np.clip((noise * 0.25 + 0.5) * 255, 0, 255).astype(np.uint8), mode="L")
    streak_img = streak_img.resize((w // 12, h), Image.Resampling.BILINEAR).resize((w, h), Image.Resampling.BICUBIC)
    streaks = (np.array(streak_img, dtype=np.float32) / 255.0 - 0.5) * 0.14

    u = np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :]
    v = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]

    # Soft studio sheen gradient + deep recessed box-wall AO along edges (especially top edge v -> 0)
    top_ao = np.clip(v / 0.16, 0.0, 1.0) ** 0.65
    bot_ao = np.clip((1.0 - v) / 0.10, 0.0, 1.0) ** 0.7
    side_ao = np.clip(np.minimum(u, 1.0 - u) / 0.07, 0.0, 1.0) ** 0.7
    ao = (0.34 + 0.66 * top_ao) * (0.55 + 0.45 * bot_ao) * (0.52 + 0.48 * side_ao)

    # Subtle hairline center blast-door seam at u = 0.5
    seam = 1.0 - 0.32 * np.exp(-((u - 0.5) / 0.0028) ** 2)

    height_map = (0.5 + streaks * 0.35) * seam
    lum = (0.31 + 0.06 * np.sin(u * 3.14159) + streaks) * ao * seam

    # 6 Precision Countersunk Hex Fastener Sockets matching `ref_board_empty.jpg`!
    screw_uvs = [
        (0.14, 0.13), (0.50, 0.13), (0.86, 0.13),
        (0.14, 0.87), (0.50, 0.87), (0.86, 0.87),
    ]
    for su, sv in screw_uvs:
        dx = (u - su) * (w / h)
        dy = v - sv
        r = np.sqrt(dx * dx + dy * dy)
        bevel_ring = np.exp(-((r - 0.022) / 0.006) ** 2)
        pit = np.clip(1.0 - r / 0.020, 0.0, 1.0)
        lum = lum * (1.0 - 0.82 * (r < 0.019)) + 0.09 * bevel_ring * (-dy / (r + 1e-4))
        height_map -= 0.45 * pit

    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[:, :, 0] = np.clip(lum * 0.94 * 255.0, 0, 255).astype(np.uint8)
    rgb[:, :, 1] = np.clip(lum * 0.98 * 255.0, 0, 255).astype(np.uint8)
    rgb[:, :, 2] = np.clip(lum * 1.06 * 255.0, 0, 255).astype(np.uint8)

    albedo_img = Image.fromarray(rgb, mode="RGB")
    albedo_img.save(os.path.join(TEX_DIR, "bay_plate_albedo.jpg"), quality=95)

    h_img = Image.fromarray(np.clip(height_map * 255.0, 0, 255).astype(np.uint8), mode="L").convert("RGB")
    norm_img = bake_normal_from_albedo(h_img, strength=3.2)
    norm_img.save(os.path.join(TEX_DIR, "bay_plate_normal.jpg"), quality=94)


def bake_velvet_maps():
    """
    Processes Gemini `crushed_velvet_albedo` into `1024x1024` plush grayscale velvet albedo + normal map
    with rich recessed tray-wall ambient occlusion so Navy & Crimson casualty wells look deeply tufted & sunken!
    """
    raw = Image.open(VELVET_SRC).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    seamless = make_seamless_cross_blend(raw, 0.18)
    arr = np.array(seamless, dtype=np.float32) / 255.0
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]

    # Normalize crushed velvet nap to `[0.52 .. 1.25]` so tinting preserves deep royal Navy/Crimson richness
    p10, p90 = float(np.percentile(lum, 10)), float(np.percentile(lum, 92))
    nap = 0.52 + 0.72 * np.clip((lum - p10) / max(0.08, p90 - p10), 0.0, 1.15)

    # Recessed tray perimeter cushion crease + top cavity shadow (`ref_board_empty.jpg`)
    u = np.linspace(0.0, 1.0, 1024, dtype=np.float32)[None, :]
    v = np.linspace(0.0, 1.0, 1024, dtype=np.float32)[:, None]
    edge_x = np.clip(np.minimum(u, 1.0 - u) / 0.13, 0.0, 1.0) ** 0.65
    edge_y = np.clip(np.minimum(v, 1.0 - v) / 0.13, 0.0, 1.0) ** 0.65
    top_shadow = 0.68 + 0.32 * np.clip(v / 0.32, 0.0, 1.0)
    cushion_ao = (0.32 + 0.68 * edge_x * edge_y) * top_shadow

    final_v = np.clip(nap * cushion_ao * 255.0, 0, 255).astype(np.uint8)
    velvet_rgb = np.stack([final_v, final_v, final_v], axis=-1)
    velvet_img = Image.fromarray(velvet_rgb, mode="RGB")
    velvet_img.save(os.path.join(TEX_DIR, "velvet_albedo.jpg"), quality=94)

    velvet_norm = bake_normal_from_albedo(seamless, strength=2.4)
    velvet_norm.save(os.path.join(TEX_DIR, "velvet_normal.jpg"), quality=93)


def frame_vintage_map_sheet(crop_img: Image.Image) -> Image.Image:
    sheet = Image.new("RGB", (1024, 768), (198, 179, 142))
    inner = crop_img.resize((956, 700), Image.Resampling.LANCZOS)
    sheet.paste(inner, (34, 34))

    draw = ImageDraw.Draw(sheet)
    draw.rectangle([22, 22, 1001, 745], outline=(76, 58, 38), width=4)
    draw.rectangle([32, 32, 991, 735], outline=(96, 74, 48), width=2)

    arr = np.array(sheet, dtype=np.float32)
    u = np.linspace(-1.0, 1.0, 1024, dtype=np.float32)[None, :]
    v = np.linspace(-1.0, 1.0, 768, dtype=np.float32)[:, None]
    vig = 1.0 - 0.14 * np.clip(u * u * 0.65 + v * v * 0.65, 0.0, 1.4)
    arr *= vig[:, :, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB")


def main():
    os.makedirs(TEX_DIR, exist_ok=True)

    # 1. Ultra-HD 2048x2048 Museum-Grade Satin Oiled Black Walnut (silky fine grain, zero bark roughness!)
    walnut = Image.open(WALNUT_V2_SRC).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
    walnut = make_seamless_cross_blend(walnut, 0.18)
    walnut = ImageEnhance.Brightness(walnut).enhance(0.96)
    # Slightly soften micro-noise before computing normal so cabinet bevels gleam like hand-rubbed furniture!
    walnut_for_norm = walnut.filter(ImageFilter.GaussianBlur(radius=1.1))
    walnut_norm = bake_normal_from_albedo(walnut_for_norm, strength=1.15)
    walnut.save(os.path.join(TEX_DIR, "walnut_albedo.jpg"), quality=95)
    walnut_norm.save(os.path.join(TEX_DIR, "walnut_normal.jpg"), quality=93)

    # 2. Ultra-HD Crushed Plush Velvet + Tray AO
    bake_velvet_maps()

    # 3. Ultra-HD Recessed Satin Gunmetal Bay Plate + 6 Countersunk Screws (`ref_board_empty.jpg`)
    bake_machined_bay_plate()

    # 4. Weathered Oak Planks Albedo & Deep Plank Normal
    oak = Image.open(OAK_SRC).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    oak = make_seamless_cross_blend(oak, 0.14)
    oak = ImageEnhance.Brightness(oak).enhance(0.98)
    oak = ImageEnhance.Contrast(oak).enhance(1.08)
    oak_norm = bake_normal_from_albedo(oak, strength=3.6)
    oak.save(os.path.join(TEX_DIR, "oak_albedo.jpg"), quality=93)
    oak_norm.save(os.path.join(TEX_DIR, "oak_normal.jpg"), quality=92)

    # 5. Two Distinct Vintage Topographic War Maps
    raw_map = Image.open(MAP_SRC).convert("RGB")
    mw, mh = raw_map.size
    left_crop = raw_map.crop((int(mw * 0.03), int(mh * 0.04), int(mw * 0.76), int(mh * 0.68)))
    right_crop = (
        raw_map.crop((int(mw * 0.22), int(mh * 0.28), int(mw * 0.97), int(mh * 0.95)))
        .transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    )
    map_left = ImageEnhance.Brightness(frame_vintage_map_sheet(left_crop)).enhance(0.92)
    map_right = ImageEnhance.Brightness(frame_vintage_map_sheet(right_crop)).enhance(0.90)
    map_left.save(os.path.join(TEX_DIR, "vintage_war_map_left.jpg"), quality=93)
    map_right.save(os.path.join(TEX_DIR, "vintage_war_map_right.jpg"), quality=93)
    map_left.save(os.path.join(TEX_DIR, "vintage_war_map.jpg"), quality=93)

    # 6. Parted Canvas Tent & Twin Glowing Oil Lanterns Cyclorama (`tent_cyclorama.png` RGBA with smooth alpha feathering
    #    so ZERO rectangular card edges can EVER appear against the 3D oak table or sky!)
    plate = Image.open(WAR_ROOM_PLATE).convert("RGB")
    pw, ph = plate.size
    tent_crop = plate.crop((0, 0, pw, int(ph * 0.252))).resize((1024, 512), Image.Resampling.LANCZOS)
    tent_crop = ImageEnhance.Brightness(tent_crop).enhance(1.10)
    tent_crop = ImageEnhance.Contrast(tent_crop).enhance(1.08)

    t_arr = np.array(tent_crop, dtype=np.float32)
    v = np.linspace(0.0, 1.0, 512, dtype=np.float32)[:, None]
    u = np.linspace(-1.0, 1.0, 1024, dtype=np.float32)[None, :]
    fade_bot = np.clip((1.0 - v) / 0.34, 0.0, 1.0) ** 1.35
    fade_top = np.clip(v / 0.10, 0.0, 1.0)
    fade_side = np.clip((1.0 - np.abs(u)) / 0.22, 0.0, 1.0) ** 1.25
    alpha = fade_bot * fade_top * fade_side

    rgba = np.zeros((512, 1024, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.clip(t_arr, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(rgba, mode="RGBA").save(os.path.join(TEX_DIR, "tent_cyclorama.png"), compress_level=6)
    print("Baked Ultra-HD 2048 walnut, plush velvet, machined bay plate, oak, war maps, and RGBA tent cyclorama.")


if __name__ == "__main__":
    main()
