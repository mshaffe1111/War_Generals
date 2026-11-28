#!/usr/bin/env python3
"""
Procedural CAD-grade glTF 2.0 binary (.glb) generator for `public/models/command_wedge.glb` (F7).
Uses pure Python + NumPy + struct + json (no Blender CLI required) and matches `tools/blender/bake_wedge.py`
and `tools/blender/generate_assets.py` in exact dimensions, angles, node names, and PBR materials:
  - Model height: 0.735u (world height 0.794u at HERO_WEDGE_SCALE = 1.08)
  - Front escutcheon slope: 57.0 deg from horizontal (-33.0 deg emblem tilt from vertical)
  - Rear armored slope: 78.0 deg from horizontal (12.0 deg from vertical), 100% identical across all pieces
  - Nodes & Materials: WedgeBody (WedgeResin), WedgeBrassPlinth (WedgeBrass), WedgeEscutcheon (WedgeInset)
    with ZERO mat=none primitives.
"""

import json
import math
import os
import struct
import numpy as np

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_PATH = os.path.join(ROOT_DIR, "public", "models", "command_wedge.glb")


class MeshBuilder:
    def __init__(self):
        self.positions = []
        self.normals = []
        self.uvs = []
        self.indices = []

    def add_mesh_data(self, verts: np.ndarray, tris: np.ndarray, uv_scale: float = 0.8):
        """
        Adds a closed/beveled sub-mesh with angle-weighted smooth vertex normals
        at sharp-edge threshold, or crease-split normals where face angle > 34 deg.
        Here we split creases > 34 deg so flat faces stay crisp while chamfers shade smoothly!
        """
        v = np.asarray(verts, dtype=np.float64)
        f = np.asarray(tris, dtype=np.int32)
        if len(f) == 0:
            return

        # Compute face normals and areas
        p0 = v[f[:, 0]]
        p1 = v[f[:, 1]]
        p2 = v[f[:, 2]]
        cross = np.cross(p1 - p0, p2 - p0)
        lengths = np.linalg.norm(cross, axis=1, keepdims=True)
        valid = lengths[:, 0] > 1e-10
        f = f[valid]
        p0, p1, p2 = p0[valid], p1[valid], p2[valid]
        cross = cross[valid]
        lengths = lengths[valid]
        fnorm = cross / lengths

        # Build vertex -> face adjacency
        vert_faces = [[] for _ in range(len(v))]
        for fi, tri in enumerate(f):
            vert_faces[tri[0]].append(fi)
            vert_faces[tri[1]].append(fi)
            vert_faces[tri[2]].append(fi)

        cos_thresh = math.cos(math.radians(34.0))
        base_idx = len(self.positions)

        # Emit per-corner vertices with crease-aware normal smoothing + box UVs
        for fi, tri in enumerate(f):
            n_self = fnorm[fi]
            anx, any_, anz = abs(n_self[0]), abs(n_self[1]), abs(n_self[2])
            tri_indices = []
            for vi in tri:
                pos = v[vi]
                # Accumulate area-weighted normals of adjacent faces within crease angle
                acc = np.zeros(3, dtype=np.float64)
                for adj_fi in vert_faces[vi]:
                    n_adj = fnorm[adj_fi]
                    if np.dot(n_self, n_adj) >= cos_thresh:
                        acc += cross[adj_fi]
                n_len = np.linalg.norm(acc)
                n_out = (acc / n_len) if n_len > 1e-10 else n_self

                # Box UV projection matching Blender's box_uv_project
                if anz >= anx and anz >= any_:
                    uv = (pos[0] * uv_scale + 0.5, pos[1] * uv_scale + 0.5)
                elif anx >= any_:
                    uv = (pos[1] * uv_scale + 0.5, pos[2] * uv_scale + 0.5)
                else:
                    uv = (pos[0] * uv_scale + 0.5, pos[2] * uv_scale + 0.5)

                tri_indices.append(len(self.positions))
                self.positions.append((float(pos[0]), float(pos[1]), float(pos[2])))
                self.normals.append((float(n_out[0]), float(n_out[1]), float(n_out[2])))
                self.uvs.append((float(uv[0]), float(uv[1])))

            self.indices.extend(tri_indices)

    def build_rounded_prism(
        self,
        sx: float,
        sy: float,
        sz: float,
        corner_r: float = 0.05,
        bevel: float = 0.008,
        corner_segs: int = 6,
        loc=(0.0, 0.0, 0.0),
        rot_x_deg: float = 0.0,
        rot_y_deg: float = 0.0,
        rot_z_deg: float = 0.0,
        uv_scale: float = 0.9,
    ):
        """Creates a Three.js Y-up chamfered/beveled rounded box (`sx` X, `sy` Y height, `sz` Z depth)."""
        hx = sx * 0.5
        hz = sz * 0.5
        hy = sy * 0.5
        r = min(corner_r, hx * 0.85, hz * 0.85)
        b = min(bevel, hy * 0.42, r * 0.45)

        def rounded_xz_ring(inset: float, y_val: float):
            rx = max(1e-4, hx - inset)
            rz = max(1e-4, hz - inset)
            rr = max(1e-4, r - inset * 0.65)
            cx = max(0.0, rx - rr)
            cz = max(0.0, rz - rr)
            # 4 corners in CCW order when viewed from +Y (in Three.js XZ, CCW is +X -> -Z -> -X -> +Z)
            corners = [
                (cx, cz, 0.0, math.pi * 0.5),
                (-cx, cz, math.pi * 0.5, math.pi),
                (-cx, -cz, math.pi, math.pi * 1.5),
                (cx, -cz, math.pi * 1.5, math.pi * 2.0),
            ]
            pts = []
            for ox, oz, a0, a1 in corners:
                for s in range(corner_segs + 1):
                    a = a0 + (a1 - a0) * (s / corner_segs)
                    # Note: sin/cos mapped so +X is a=0, +Z is a=pi/2 -> CCW from +Y has normal +Y
                    # Wait: in Three.js (+X right, +Y up, +Z toward viewer), (x=cos, z=sin) goes (+X -> +Z -> -X -> -Z)
                    # which is CW from +Y! So reverse angle direction to go (+X -> -Z -> -X -> +Z) for CCW from +Y:
                    px = ox + math.cos(a) * rr
                    pz = oz + math.sin(a) * rr
                    pts.append((px, y_val, pz))
            return pts

        # Build 4 vertical rings: bottom-inner, bottom-outer, top-outer, top-inner for crisp 2-step chamfer
        ring_defs = [
            (b, -hy),
            (0.0, -hy + b),
            (0.0, hy - b),
            (b, hy),
        ]
        rings = [rounded_xz_ring(ins, yv) for ins, yv in ring_defs]
        # Reverse ring order in XZ so winding is CCW from outside (+Y up)
        rings = [list(reversed(rg)) for rg in rings]

        n_ring = len(rings[0])
        verts = []
        for rg in rings:
            verts.extend(rg)
        # Bottom center & top center
        bot_center_idx = len(verts)
        verts.append((0.0, -hy, 0.0))
        top_center_idx = len(verts)
        verts.append((0.0, hy, 0.0))

        tris = []
        # Bottom cap
        for i in range(n_ring):
            ni = (i + 1) % n_ring
            tris.append((bot_center_idx, ni, i))
        # Side quads
        for r_idx in range(len(rings) - 1):
            off0 = r_idx * n_ring
            off1 = (r_idx + 1) * n_ring
            for i in range(n_ring):
                ni = (i + 1) % n_ring
                a, b_v, c, d = off0 + i, off0 + ni, off1 + ni, off1 + i
                tris.append((a, b_v, c))
                tris.append((a, c, d))
        # Top cap
        top_off = (len(rings) - 1) * n_ring
        for i in range(n_ring):
            ni = (i + 1) % n_ring
            tris.append((top_center_idx, top_off + i, top_off + ni))

        v_arr = np.array(verts, dtype=np.float64)
        v_arr = transform_points(v_arr, loc, rot_x_deg, rot_y_deg, rot_z_deg)
        self.add_mesh_data(v_arr, np.array(tris, dtype=np.int32), uv_scale=uv_scale)

    def build_beveled_frame(
        self,
        outer_x: float,
        outer_z: float,
        inner_x: float,
        inner_z: float,
        thickness_y: float,
        outer_r: float,
        inner_r: float,
        bevel: float = 0.005,
        segs: int = 8,
        loc=(0.0, 0.0, 0.0),
        rot_x_deg: float = 0.0,
        uv_scale: float = 0.9,
    ):
        """Builds a watertight chamfered rectangular bezel frame with an open window."""
        hy = thickness_y * 0.5
        b = min(bevel, hy * 0.45)

        def loop_pts(w: float, d: float, r: float, y_val: float):
            hx, hz = w * 0.5, d * 0.5
            rr = min(r, hx * 0.85, hz * 0.85)
            cx, cz = max(0.0, hx - rr), max(0.0, hz - rr)
            corners = [
                (cx, -cz, -math.pi * 0.5, 0.0),
                (cx, cz, 0.0, math.pi * 0.5),
                (-cx, cz, math.pi * 0.5, math.pi),
                (-cx, -cz, math.pi, math.pi * 1.5),
            ]
            pts = []
            for ox, oz, a0, a1 in corners:
                for s in range(segs + 1):
                    a = a0 + (a1 - a0) * (s / segs)
                    # CCW from +Y: x = ox + cos(a)*rr, z = oz + sin(a)*rr?
                    # Let's check: a=-pi/2 -> (cx, -cz-rr), a=0 -> (cx+rr, -cz): goes +X then +Z -> CW!
                    # Use z = oz - sin(a)*rr so a=0 -> +X, a=pi/2 -> -Z (CCW from +Y)!
                    pts.append((ox + math.cos(a) * rr, y_val, oz - math.sin(a) * rr))
            return pts

        # Correct corner order for CCW from +Y with z = oz - sin(a)*rr:
        # Quadrant 1 (+X, -Z): a in [0, pi/2]
        # Quadrant 2 (-X, -Z): a in [pi/2, pi]
        # Quadrant 3 (-X, +Z): a in [pi, 1.5*pi]
        # Quadrant 4 (+X, +Z): a in [1.5*pi, 2*pi]
        def ccw_loop(w: float, d: float, r: float, y_val: float):
            hx, hz = w * 0.5, d * 0.5
            rr = min(r, hx * 0.85, hz * 0.85)
            cx, cz = max(0.0, hx - rr), max(0.0, hz - rr)
            corners = [
                (cx, -cz, 0.0, math.pi * 0.5),
                (-cx, -cz, math.pi * 0.5, math.pi),
                (-cx, cz, math.pi, math.pi * 1.5),
                (cx, cz, math.pi * 1.5, math.pi * 2.0),
            ]
            pts = []
            for ox, oz, a0, a1 in corners:
                for s in range(segs + 1):
                    a = a0 + (a1 - a0) * (s / segs)
                    pts.append((ox + math.cos(a) * rr, y_val, oz - math.sin(a) * rr))
            return pts

        # Cross-section profile of bezel around loop: 6-point beveled ring
        # Outer-bottom, outer-mid-bot, outer-mid-top, outer-top, inner-top, inner-mid-top, inner-mid-bot, inner-bottom
        rings = [
            ccw_loop(outer_x - 2 * b, outer_z - 2 * b, max(0.005, outer_r - b), -hy),
            ccw_loop(outer_x, outer_z, outer_r, -hy + b),
            ccw_loop(outer_x, outer_z, outer_r, hy - b),
            ccw_loop(outer_x - 2 * b, outer_z - 2 * b, max(0.005, outer_r - b), hy),
            ccw_loop(inner_x + 2 * b, inner_z + 2 * b, max(0.005, inner_r + b), hy),
            ccw_loop(inner_x, inner_z, inner_r, hy - b),
            ccw_loop(inner_x, inner_z, inner_r, -hy + b),
            ccw_loop(inner_x + 2 * b, inner_z + 2 * b, max(0.005, inner_r + b), -hy),
        ]
        n = len(rings[0])
        m = len(rings)
        verts = []
        for rg in rings:
            verts.extend(rg)
        tris = []
        for r_idx in range(m):
            nr_idx = (r_idx + 1) % m
            off0 = r_idx * n
            off1 = nr_idx * n
            for i in range(n):
                ni = (i + 1) % n
                a, b_v, c, d = off0 + i, off0 + ni, off1 + ni, off1 + i
                tris.append((a, b_v, c))
                tris.append((a, c, d))

        v_arr = np.array(verts, dtype=np.float64)
        v_arr = transform_points(v_arr, loc, rot_x_deg, 0.0, 0.0)
        self.add_mesh_data(v_arr, np.array(tris, dtype=np.int32), uv_scale=uv_scale)


def transform_points(
    pts: np.ndarray,
    loc=(0.0, 0.0, 0.0),
    rot_x_deg: float = 0.0,
    rot_y_deg: float = 0.0,
    rot_z_deg: float = 0.0,
) -> np.ndarray:
    out = pts.copy()
    if abs(rot_x_deg) > 1e-8:
        a = math.radians(rot_x_deg)
        c, s = math.cos(a), math.sin(a)
        y = out[:, 1] * c - out[:, 2] * s
        z = out[:, 1] * s + out[:, 2] * c
        out[:, 1], out[:, 2] = y, z
    if abs(rot_y_deg) > 1e-8:
        a = math.radians(rot_y_deg)
        c, s = math.cos(a), math.sin(a)
        x = out[:, 0] * c + out[:, 2] * s
        z = -out[:, 0] * s + out[:, 2] * c
        out[:, 0], out[:, 2] = x, z
    if abs(rot_z_deg) > 1e-8:
        a = math.radians(rot_z_deg)
        c, s = math.cos(a), math.sin(a)
        x = out[:, 0] * c - out[:, 1] * s
        y = out[:, 0] * s + out[:, 1] * c
        out[:, 0], out[:, 1] = x, y
    out[:, 0] += loc[0]
    out[:, 1] += loc[1]
    out[:, 2] += loc[2]
    return out


def build_command_wedge():
    # Three.js Y-up coordinate space (+Z front toward camera, -Z rear, +Y up):
    # Model height = 0.735u -> 0.735 * HERO_WEDGE_SCALE (1.08) = 0.794u world height!
    y0 = 0.068
    y_shoulder = 0.620
    y_crown = 0.710

    zf0 = 0.295
    zb0 = -0.275
    front_angle_deg = 57.0
    rear_angle_deg = 78.0

    zf_sh = zf0 - (y_shoulder - y0) / math.tan(math.radians(front_angle_deg))  # -0.0635
    zb_sh = zb0 + (y_shoulder - y0) / math.tan(math.radians(rear_angle_deg))   # -0.1577
    zf_cr = zf_sh - 0.022
    zb_cr = zb_sh + 0.016

    # --- 1. WedgeBody (Mat 0: WedgeResin) ---
    body = MeshBuilder()

    def make_oct_ring(hw_f: float, hw_b: float, zf: float, zb: float, y: float, cham: float):
        # CCW from +Y
        return [
            (hw_f - cham, y, zf),
            (hw_f, y, zf - cham * 0.9),
            (hw_b, y, zb + cham * 0.9),
            (hw_b - cham, y, zb),
            (-hw_b + cham, y, zb),
            (-hw_b, y, zb + cham * 0.9),
            (-hw_f, y, zf - cham * 0.9),
            (-hw_f + cham, y, zf),
        ]

    # Chamfered multi-ring monolith profile for smooth bevel highlights along base, shoulder, and crown
    ring_specs = [
        (0.352, 0.332, zf0, zb0, y0, 0.074),
        (0.350, 0.330, zf0 - 0.008, zb0 + 0.004, y0 + 0.014, 0.072),
        (0.266, 0.250, zf_sh + 0.012, zb_sh - 0.004, y_shoulder - 0.016, 0.060),
        (0.258, 0.242, zf_sh, zb_sh, y_shoulder, 0.058),
        (0.244, 0.228, zf_sh - 0.006, zb_sh + 0.004, y_shoulder + 0.014, 0.055),
        (0.204, 0.190, zf_cr + 0.006, zb_cr - 0.004, y_crown - 0.012, 0.046),
        (0.194, 0.180, zf_cr, zb_cr, y_crown, 0.044),
    ]
    rings = [make_oct_ring(*sp) for sp in ring_specs]
    verts = []
    for rg in rings:
        verts.extend(rg)
    bot_c = len(verts)
    verts.append((0.0, y0, (zf0 + zb0) * 0.5))
    top_c = len(verts)
    verts.append((0.0, y_crown, (zf_cr + zb_cr) * 0.5))

    tris = []
    for i in range(8):
        ni = (i + 1) % 8
        tris.append((bot_c, ni, i))
    for r_idx in range(len(rings) - 1):
        o0 = r_idx * 8
        o1 = (r_idx + 1) * 8
        for i in range(8):
            ni = (i + 1) % 8
            a, b_v, c, d = o0 + i, o0 + ni, o1 + ni, o1 + i
            tris.append((a, b_v, c))
            tris.append((a, c, d))
    top_o = (len(rings) - 1) * 8
    for i in range(8):
        ni = (i + 1) % 8
        tris.append((top_c, top_o + i, top_o + ni))

    body.add_mesh_data(np.array(verts, dtype=np.float64), np.array(tris, dtype=np.int32), uv_scale=0.8)

    # Crown Crest (y = 0.706 .. 0.735)
    body.build_rounded_prism(
        sx=0.26,
        sy=0.029,
        sz=0.068,
        corner_r=0.02,
        bevel=0.006,
        loc=(0.0, y_crown + 0.0105, (zf_cr + zb_cr) * 0.5),
        uv_scale=0.8,
    )

    # 3 Rear Horizontal Armor Louvers + Central Rear Spine (100% identical across all 21 enemy pieces!)
    for idx, ly in enumerate((0.20, 0.34, 0.48)):
        t_frac = (ly - y0) / (y_shoulder - y0)
        lz = zb0 * (1.0 - t_frac) + zb_sh * t_frac - 0.008
        lw = 0.41 - idx * 0.045
        body.build_rounded_prism(
            sx=lw,
            sy=0.044,
            sz=0.034,
            corner_r=0.01,
            bevel=0.006,
            loc=(0.0, ly, lz),
            rot_x_deg=12.0,
            uv_scale=0.8,
        )

    spine_z = (zb0 + zb_sh) * 0.5 - 0.011
    body.build_rounded_prism(
        sx=0.064,
        sy=0.41,
        sz=0.036,
        corner_r=0.014,
        bevel=0.006,
        loc=(0.0, 0.345, spine_z),
        rot_x_deg=12.0,
        uv_scale=0.8,
    )

    # Side Shoulder Epaulet Ribs (+/-X flanks)
    for sx_sign in (-1.0, 1.0):
        body.build_rounded_prism(
            sx=0.036,
            sy=0.40,
            sz=0.17,
            corner_r=0.012,
            bevel=0.006,
            loc=(sx_sign * 0.296, 0.335, -0.008),
            rot_z_deg=sx_sign * 9.5,
            uv_scale=0.8,
        )

    # --- 2. WedgeBrassPlinth (Mat 1: WedgeBrass — ZERO mat=none primitives!) ---
    brass = MeshBuilder()
    # Weighted Stepped Chamfered Brass Pedestal Plinth (0.76 x 0.58)
    brass.build_rounded_prism(
        sx=0.76,
        sy=0.042,
        sz=0.58,
        corner_r=0.105,
        bevel=0.009,
        loc=(0.0, 0.021, 0.005),
        uv_scale=0.9,
    )
    brass.build_rounded_prism(
        sx=0.70,
        sy=0.038,
        sz=0.52,
        corner_r=0.088,
        bevel=0.008,
        loc=(0.0, 0.056, 0.005),
        uv_scale=0.9,
    )

    # Front Escutcheon Brass Bezel on 57 deg front slope (-33 deg tilt from vertical)
    front_mid_y = 0.355
    t_mid = (front_mid_y - y0) / (y_shoulder - y0)
    front_mid_z = zf0 * (1.0 - t_mid) + zf_sh * t_mid  # ~0.1086
    # Outward normal on +Z front slope leaning back by 33 deg around X: (0, cos(57), sin(57)) = (0, 0.5446, 0.8387)
    n_y = math.cos(math.radians(front_angle_deg))
    n_z = math.sin(math.radians(front_angle_deg))
    tilt_deg = 90.0 - front_angle_deg  # 33.0 deg -> rotated around X by +57 deg brings +Y normal to (0, cos(57), sin(57))!
    # Wait: verify rot_x_deg on flat XZ frame (local normal = +Y):
    # Applying +57 deg around X maps (0, 1, 0) -> (0, cos(57), sin(57)) = (0, 0.5446, 0.8387)!
    # And maps local +Z -> (0, -sin(57), cos(57)) pointing downward along the front face!
    brass.build_beveled_frame(
        outer_x=0.47,
        outer_z=0.45,
        inner_x=0.415,
        inner_z=0.395,
        thickness_y=0.022,
        outer_r=0.058,
        inner_r=0.042,
        bevel=0.0045,
        loc=(0.0, front_mid_y + n_y * 0.006, front_mid_z + n_z * 0.006),
        rot_x_deg=front_angle_deg,
        uv_scale=0.9,
    )

    # Crown Brass Finial Bar (top = 0.735u)
    brass.build_rounded_prism(
        sx=0.19,
        sy=0.020,
        sz=0.042,
        corner_r=0.011,
        bevel=0.004,
        loc=(0.0, 0.725, (zf_cr + zb_cr) * 0.5),
        uv_scale=0.9,
    )

    # Rear Brass Heel Bar
    brass.build_rounded_prism(
        sx=0.36,
        sy=0.036,
        sz=0.034,
        corner_r=0.01,
        bevel=0.006,
        loc=(0.0, 0.105, zb0 - 0.009),
        uv_scale=0.9,
    )

    # --- 3. WedgeEscutcheon (Mat 2: WedgeInset) ---
    escutcheon = MeshBuilder()
    escutcheon.build_rounded_prism(
        sx=0.425,
        sy=0.012,
        sz=0.405,
        corner_r=0.042,
        bevel=0.003,
        loc=(0.0, front_mid_y + n_y * 0.003, front_mid_z + n_z * 0.003),
        rot_x_deg=front_angle_deg,
        uv_scale=1.0,
    )

    return [
        ("WedgeBody", body, "WedgeResin"),
        ("WedgeBrassPlinth", brass, "WedgeBrass"),
        ("WedgeEscutcheon", escutcheon, "WedgeInset"),
    ]


def export_glb(meshes, out_path: str):
    bin_chunks = []
    buffer_views = []
    accessors = []
    gltf_meshes = []
    gltf_nodes = []

    materials = [
        {
            "name": "WedgeResin",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.08, 0.15, 0.28, 1.0],
                "metallicFactor": 0.06,
                "roughnessFactor": 0.38,
            },
        },
        {
            "name": "WedgeBrass",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.80, 0.62, 0.28, 1.0],
                "metallicFactor": 0.92,
                "roughnessFactor": 0.24,
            },
        },
        {
            "name": "WedgeInset",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.04, 0.08, 0.16, 1.0],
                "metallicFactor": 0.12,
                "roughnessFactor": 0.48,
            },
        },
    ]
    mat_index_map = {m["name"]: idx for idx, m in enumerate(materials)}

    byte_offset = 0

    def append_buffer(raw_bytes: bytes, target: int):
        nonlocal byte_offset
        pad = (4 - (len(raw_bytes) % 4)) % 4
        padded = raw_bytes + (b"\x00" * pad)
        bv_idx = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": byte_offset,
                "byteLength": len(raw_bytes),
                "target": target,
            }
        )
        bin_chunks.append(padded)
        byte_offset += len(padded)
        return bv_idx

    for node_idx, (name, mb, mat_name) in enumerate(meshes):
        pos = np.array(mb.positions, dtype=np.float32)
        nrm = np.array(mb.normals, dtype=np.float32)
        uv = np.array(mb.uvs, dtype=np.float32)
        idx = np.array(mb.indices, dtype=np.uint32)

        bv_pos = append_buffer(pos.tobytes(), 34962)
        bv_nrm = append_buffer(nrm.tobytes(), 34962)
        bv_uv = append_buffer(uv.tobytes(), 34962)
        bv_idx = append_buffer(idx.tobytes(), 34963)

        acc_pos = len(accessors)
        accessors.append(
            {
                "bufferView": bv_pos,
                "componentType": 5126,
                "count": int(len(pos)),
                "type": "VEC3",
                "min": [float(x) for x in pos.min(axis=0)],
                "max": [float(x) for x in pos.max(axis=0)],
            }
        )
        acc_nrm = len(accessors)
        accessors.append(
            {
                "bufferView": bv_nrm,
                "componentType": 5126,
                "count": int(len(nrm)),
                "type": "VEC3",
            }
        )
        acc_uv = len(accessors)
        accessors.append(
            {
                "bufferView": bv_uv,
                "componentType": 5126,
                "count": int(len(uv)),
                "type": "VEC2",
            }
        )
        acc_idx = len(accessors)
        accessors.append(
            {
                "bufferView": bv_idx,
                "componentType": 5125,
                "count": int(len(idx)),
                "type": "SCALAR",
            }
        )

        gltf_meshes.append(
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": acc_pos,
                            "NORMAL": acc_nrm,
                            "TEXCOORD_0": acc_uv,
                        },
                        "indices": acc_idx,
                        "material": mat_index_map[mat_name],
                    }
                ],
            }
        )
        gltf_nodes.append({"name": name, "mesh": node_idx})

    bin_blob = b"".join(bin_chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "WarGenerals-CAD-GLB-Builder/2.0"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(gltf_nodes)))}],
        "nodes": gltf_nodes,
        "meshes": gltf_meshes,
        "materials": materials,
        "bufferViews": buffer_views,
        "accessors": accessors,
        "buffers": [{"byteLength": len(bin_blob)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b" " * json_pad

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_blob)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_blob), 0x004E4942))
        f.write(bin_blob)

    # Print exact bounding box summary
    all_pos = np.vstack([np.array(mb.positions) for _, mb, _ in meshes])
    mn = all_pos.min(axis=0)
    mx = all_pos.max(axis=0)
    total_tris = sum(len(mb.indices) // 3 for _, mb, _ in meshes)
    print(
        f"Exported {out_path} ({total_len} bytes, {total_tris} tris) | "
        f"BBox min={mn.round(4).tolist()} max={mx.round(4).tolist()}"
    )


if __name__ == "__main__":
    meshes = build_command_wedge()
    export_glb(meshes, OUT_PATH)
