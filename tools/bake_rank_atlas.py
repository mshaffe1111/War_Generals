"""
2048x2048 Rank Insignia Atlas & Normal/Alpha Cutout Baker (`tools/bake_rank_atlas.py`).

1. Copies the clean war-room photographic backdrop plate into `public/textures/war_room_backdrop.jpg`.
2. Loads the 4x4 metallic rank reference sheet, repairs cell (row=0, col=0) (`5-Star General`)
   by extracting the photorealistic brushed-brass single star from cell (row=1, col=0) (`1-Star General`),
   Lanczos-scaling it cleanly, and compositing 5 copies in a regular pentagon cluster so its metallic
   grain and bevel lighting match the other 15 cells identically.
3. Saves the repaired `2048x2048` master sheet to `public/textures/ref_rank_symbols_4x4.jpg`.
4. Generates:
   - `public/textures/rank_atlas_cutout.png` (2048x2048 RGBA): border-seeded flood-fill alpha mask
     (stripping neutral grey `[80,80,80]` exterior + interior enclosed background holes cleanly with
     anti-aliased edge feathering, while preserving 100% of interior feather/vein dark shadows) +
     normalized high-contrast luminance relief map in RGB for `#E2B04A` Brass & `#DCE2EA` Silver tinting.
   - `public/textures/rank_atlas_normal.png` (2048x2048 RGB): tangent-space normal map combining
     multi-step chamfered edge bevel gradients + high-frequency Sobel relief detail.
"""

from collections import deque
import math
import os
import shutil
import numpy as np
from PIL import Image, ImageFilter


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEX_DIR = os.path.join(ROOT_DIR, "public", "textures")

UPLOADED_SHEET = r"C:\Users\mshaf\.gemini\antigravity\brain\f10c17e4-676b-4899-9851-d9b61677a348\.user_uploaded\media_1795745443168_a9479352.webp"
UPLOADED_BACKDROP = r"C:\Users\mshaf\.gemini\antigravity\brain\f10c17e4-676b-4899-9851-d9b61677a348\.user_uploaded\media_1795750965876_4be394a3.jpg"


def extract_background_mask_cell(cell_rgb: np.ndarray, bg_rgb: np.ndarray, tol: float = 21.5) -> np.ndarray:
    """
    Computes clean foreground alpha (0..1) for a single cell using border-seeded flood-fill
    plus enclosed neutral-grey hole detection (for target rings, Captain twin-bar gap, and hilts).
    """
    h, w, _ = cell_rgb.shape
    diff = np.linalg.norm(cell_rgb - bg_rgb[None, None, :], axis=-1)
    # Chroma (saturation) check: neutral studio grey has max(R,G,B) - min(R,G,B) <= 5
    chroma = np.max(cell_rgb, axis=-1) - np.min(cell_rgb, axis=-1)
    is_bg_candidate = (diff < tol) & (chroma < 11.0)

    # 1. Flood-fill from all 4 cell borders to capture exterior background
    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg_candidate[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg_candidate[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))

    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_bg_candidate[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    # 2. Also capture genuine enclosed background holes (e.g. inside Attack Medallion rings & Captain bars)
    #    where connected neutral-grey region has >= 36 pixels and tight match to [80, 80, 80]
    strict_hole = (diff < 12.5) & (chroma < 6.5) & (~visited)
    checked = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            if strict_hole[y, x] and not checked[y, x]:
                comp: list[tuple[int, int]] = []
                cq: deque[tuple[int, int]] = deque([(y, x)])
                checked[y, x] = True
                while cq:
                    py, px = cq.popleft()
                    comp.append((py, px))
                    for ny, nx in ((py - 1, px), (py + 1, px), (py, px - 1), (py, px + 1)):
                        if 0 <= ny < h and 0 <= nx < w and strict_hole[ny, nx] and not checked[ny, nx]:
                            checked[ny, nx] = True
                            cq.append((ny, nx))
                if len(comp) >= 40:
                    for py, px in comp:
                        visited[py, px] = True

    fg = (~visited).astype(np.float32)

    # Anti-aliased soft edge ramp near silhouette boundary using color distance
    edge_ramp = np.clip((diff - 10.0) / 14.0, 0.0, 1.0)
    alpha = np.where(fg > 0.5, np.maximum(0.65, edge_ramp), 0.0)
    alpha_img = Image.fromarray((alpha * 255.0).astype(np.uint8), mode="L").filter(
        ImageFilter.GaussianBlur(radius=0.85)
    )
    alpha_smooth = np.array(alpha_img, dtype=np.float32) / 255.0
    return np.clip((alpha_smooth - 0.12) / 0.82, 0.0, 1.0)


def repair_five_star_cell(sheet_img: Image.Image, bg_rgb: np.ndarray) -> Image.Image:
    """
    Repairs cell (row=0, col=0) (`5-Star General`) by cropping the photorealistic brushed-brass
    single star from cell (row=1, col=0) (`1-Star General`), scaling it cleanly with Lanczos,
    and compositing 5 copies in a regular pentagon cluster.
    """
    repaired = sheet_img.copy()
    w, h = repaired.size
    cell_w = w // 4  # 256 on 1024x1024

    # Extract 1-Star General cell at (col=0, row=1) -> box (0, cell_w, cell_w, 2*cell_w)
    one_star_box = (0, cell_w, cell_w, 2 * cell_w)
    one_star_img = repaired.crop(one_star_box)
    one_star_np = np.array(one_star_img, dtype=np.float32)
    star_alpha = extract_background_mask_cell(one_star_np, bg_rgb, tol=20.0)

    # Tight crop around the single star foreground
    ys, xs = np.where(star_alpha > 0.08)
    pad = 4
    y0, y1 = max(0, int(ys.min()) - pad), min(cell_w, int(ys.max()) + pad + 1)
    x0, x1 = max(0, int(xs.min()) - pad), min(cell_w, int(xs.max()) + pad + 1)

    star_rgba_np = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
    star_rgba_np[:, :, :3] = np.clip(one_star_np[y0:y1, x0:x1], 0, 255).astype(np.uint8)
    star_rgba_np[:, :, 3] = np.clip(star_alpha[y0:y1, x0:x1] * 255.0, 0, 255).astype(np.uint8)
    star_rgba = Image.fromarray(star_rgba_np, mode="RGBA")

    # Scale single star cleanly to match the star proportion of 4-Star / 3-Star cells (~76px across on 256px cell)
    target_star_size = int(round(cell_w * 0.305))
    star_scaled = star_rgba.resize((target_star_size, target_star_size), Image.Resampling.LANCZOS)

    # Soft ambient contact shadow matching the other 15 cells
    shadow_alpha = star_scaled.split()[3].filter(ImageFilter.GaussianBlur(radius=3.2))
    shadow_layer = Image.new("RGBA", star_scaled.size, (22, 18, 14, 0))
    shadow_np = np.array(shadow_alpha, dtype=np.float32) * 0.52
    shadow_layer.putalpha(Image.fromarray(shadow_np.astype(np.uint8), mode="L"))

    # Build clean [80, 80, 80] cell canvas for (col=0, row=0)
    bg_tuple = tuple(int(round(x)) for x in bg_rgb) + (255,)
    five_cell = Image.new("RGBA", (cell_w, cell_w), bg_tuple)

    cx = cell_w * 0.5
    cy = cell_w * 0.515
    pentagon_r = cell_w * 0.258

    # First pass: soft contact shadows; second pass: crisp photorealistic brass stars
    coords: list[tuple[int, int]] = []
    for i in range(5):
        angle = -math.pi / 2.0 + i * (2.0 * math.pi / 5.0)
        px = int(round(cx + math.cos(angle) * pentagon_r - target_star_size * 0.5))
        py = int(round(cy + math.sin(angle) * pentagon_r - target_star_size * 0.5))
        coords.append((px, py))

    for px, py in coords:
        five_cell.alpha_composite(shadow_layer, (px + 2, py + 3))
    for px, py in coords:
        five_cell.alpha_composite(star_scaled, (px, py))

    repaired.paste(five_cell.convert("RGB"), (0, 0))
    return repaired


def build_2048_atlases(master_1024: Image.Image, bg_rgb: np.ndarray):
    # Upscale master sheet to crisp 2048x2048 with Lanczos + subtle unsharp mask
    master_2048 = master_1024.resize((2048, 2048), Image.Resampling.LANCZOS)
    master_2048 = master_2048.filter(ImageFilter.UnsharpMask(radius=1.2, percent=125, threshold=2))

    master_path = os.path.join(TEX_DIR, "ref_rank_symbols_4x4.jpg")
    master_2048.save(master_path, quality=96, subsampling=0)
    print(f"Saved {master_path} (2048x2048)")

    rgb_2048 = np.array(master_2048, dtype=np.float32)
    alpha_2048 = np.zeros((2048, 2048), dtype=np.float32)
    detail_rgb = np.zeros((2048, 2048, 3), dtype=np.float32)
    height_2048 = np.zeros((2048, 2048), dtype=np.float32)

    cell_s = 512
    for row in range(4):
        for col in range(4):
            y0, y1 = row * cell_s, (row + 1) * cell_s
            x0, x1 = col * cell_s, (col + 1) * cell_s
            cell = rgb_2048[y0:y1, x0:x1]
            a = extract_background_mask_cell(cell, bg_rgb, tol=22.0)
            alpha_2048[y0:y1, x0:x1] = a

            # Compute normalized grayscale surface detail inside the emblem so PBR brass (#E2B04A)
            # and PBR silver (#DCE2EA) multiply cleanly without dark grey fringes or hue shifts!
            lum = 0.299 * cell[:, :, 0] + 0.587 * cell[:, :, 1] + 0.114 * cell[:, :, 2]
            fg_vals = lum[a > 0.35]
            if fg_vals.size > 20:
                p15 = float(np.percentile(fg_vals, 12))
                p90 = float(np.percentile(fg_vals, 92))
                denom = max(18.0, p90 - p15)
                norm_lum = np.clip((lum - p15) / denom, 0.0, 1.15)
                # Map to [0.42 .. 1.08] so shadow crevices stay rich bronze/pewter while highlights gleam!
                remapped = 0.44 + 0.62 * np.clip(norm_lum, 0.0, 1.05)
            else:
                remapped = np.ones_like(lum)

            # Bleed foreground detail outward by a few pixels into alpha=0 zone to prevent dark mipmap fringes!
            safe_val = np.where(a > 0.08, remapped, 0.88)
            detail_rgb[y0:y1, x0:x1, 0] = safe_val
            detail_rgb[y0:y1, x0:x1, 1] = safe_val
            detail_rgb[y0:y1, x0:x1, 2] = safe_val

            # Height field = smooth silhouette dome bevel + crisp interior relief luminance
            dome_pil = Image.fromarray((a * 255.0).astype(np.uint8), mode="L").filter(
                ImageFilter.GaussianBlur(radius=5.5)
            )
            dome = (np.array(dome_pil, dtype=np.float32) / 255.0) * a
            height_2048[y0:y1, x0:x1] = (0.62 * dome + 0.38 * (remapped * a))

    # Export RGBA cutout detail atlas (`rank_atlas_cutout.png`)
    cutout_rgba = np.zeros((2048, 2048, 4), dtype=np.uint8)
    cutout_rgba[:, :, :3] = np.clip(detail_rgb * 255.0, 0, 255).astype(np.uint8)
    cutout_rgba[:, :, 3] = np.clip(alpha_2048 * 255.0, 0, 255).astype(np.uint8)
    cutout_path = os.path.join(TEX_DIR, "rank_atlas_cutout.png")
    Image.fromarray(cutout_rgba, mode="RGBA").save(cutout_path, compress_level=6)
    print(f"Saved {cutout_path} (2048x2048 RGBA)")

    # Compute tangent-space normal map (`rank_atlas_normal.png`) via central differences / Sobel
    hp = np.pad(height_2048, 1, mode="edge")
    dx = (
        (hp[:-2, 2:] + 2.0 * hp[1:-1, 2:] + hp[2:, 2:])
        - (hp[:-2, :-2] + 2.0 * hp[1:-1, :-2] + hp[2:, :-2])
    )
    dy = (
        (hp[2:, :-2] + 2.0 * hp[2:, 1:-1] + hp[2:, 2:])
        - (hp[:-2, :-2] + 2.0 * hp[:-2, 1:-1] + hp[:-2, 2:])
    )
    strength = 3.4
    nx = -dx * strength
    ny = dy * strength  # OpenGL +Y up tangent convention
    nz = np.ones_like(nx)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    normal_rgb = np.zeros((2048, 2048, 3), dtype=np.uint8)
    normal_rgb[:, :, 0] = np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    normal_rgb[:, :, 1] = np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    normal_rgb[:, :, 2] = np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    normal_path = os.path.join(TEX_DIR, "rank_atlas_normal.png")
    Image.fromarray(normal_rgb, mode="RGB").save(normal_path, compress_level=6)
    print(f"Saved {normal_path} (2048x2048 RGB)")


def main():
    os.makedirs(TEX_DIR, exist_ok=True)
    backdrop_dst = os.path.join(TEX_DIR, "war_room_backdrop.jpg")
    shutil.copyfile(UPLOADED_BACKDROP, backdrop_dst)
    print(f"Copied {backdrop_dst}")

    raw_sheet = Image.open(UPLOADED_SHEET).convert("RGB")
    arr = np.array(raw_sheet, dtype=np.float32)
    border_pixels = np.concatenate([arr[0, :], arr[-1, :], arr[:, 0], arr[:, -1]], axis=0)
    bg_rgb = np.median(border_pixels, axis=0)

    repaired_sheet = repair_five_star_cell(raw_sheet, bg_rgb)
    build_2048_atlases(repaired_sheet, bg_rgb)


if __name__ == "__main__":
    main()
