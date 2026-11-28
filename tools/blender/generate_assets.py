"""
Master Headless Blender 5.3 High-Dimensional Cabinet, Warfield Trench Diorama & 3D War-Room Props Pipeline
(`tools/blender/generate_assets.py`).

Exports origin-applied (`transform_apply(location=True, rotation=True, scale=True)`), smooth-shaded,
bevel-weighted `.glb` assemblies into `public/models/`:
  1. `board_cabinet.glb`  — Heavy dimensional oiled-walnut cabinet (`height = 0.88`) with raised `+0.15` outer
                            perimeter bolster rails, raised `+0.048` chamfered champagne-brass moldings,
                            deep `-0.36` sunken pillowed crushed-velvet casualty bunkers (with 1:1 planar UVs),
                            and 72 thick deep-chamfered charcoal-slate stone tiles over `-0.075` recessed grooves.
  2. `warfield_arena.glb` — Sunken 3D Miniature Battlefield Trench & Bunker Diorama fitting inside the top bay:
                            cratered No-Man's-Land terrain (`MudTerrain`), Left & Right fortified sandbagged
                            firing bastions (`Sandbags`, `BastionPads`, `BastionBrassRings`), crossed steel I-beam
                            Czech hedgehog tank traps (`TankTraps`), and a sloped rear armored artillery casemate
                            bunker (`ArmoredBunker`, `HowitzerBarrels`).
  3. `war_room_table.glb` — Real 3D multi-plank heavy weathered-oak campaign table (`OakPlanks` with physical
                            recessed V-grooves between planks!) + 3D wooden field ammo crate (`AmmoCrate`) +
                            3D brass hurricane oil lantern (`LanternBrass`, `LanternGlass`) + rolled parchment
                            command map scrolls & brass map weights (`MapScrolls`, `BrassWeights`).
  4. `command_wedge.glb`  — Sculpted 4-bevel Command Wedge (`57 deg` front slope, `78 deg` rear shield).
  5. `pocket_watch.glb`   — High-poly beveled antique brass pocket watch.
"""

import math
import os
import random
import bpy
import bmesh


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT_DIR, "public", "models")


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name, rgba, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def apply_all_transforms(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def apply_bevel_and_weighted_normals(obj, width=0.018, segments=4, angle_deg=28.0):
    bpy.context.view_layer.objects.active = obj
    for poly in obj.data.polygons:
        poly.use_smooth = True

    bev = obj.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = width
    bev.segments = segments
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(angle_deg)
    bev.harden_normals = False
    bev.miter_outer = "MITER_ARC"

    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    baked_mesh = bpy.data.meshes.new_from_object(eval_obj)
    obj.modifiers.clear()
    obj.data = baked_mesh
    for poly in obj.data.polygons:
        poly.use_smooth = True


def box_uv_project(obj, scale=0.12):
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = (mesh.uv_layers.active or mesh.uv_layers[0]).data
    for poly in mesh.polygons:
        nx, ny, nz = abs(poly.normal.x), abs(poly.normal.y), abs(poly.normal.z)
        for loop_idx in poly.loop_indices:
            v = mesh.vertices[mesh.loops[loop_idx].vertex_index].co
            if nz >= nx and nz >= ny:
                uv_layer[loop_idx].uv = (v.x * scale + 0.5, v.y * scale + 0.5)
            elif nx >= ny:
                uv_layer[loop_idx].uv = (v.y * scale + 0.5, v.z * scale + 0.5)
            else:
                uv_layer[loop_idx].uv = (v.x * scale + 0.5, v.z * scale + 0.5)


def planar_bounds_uv_project(obj):
    """Maps XY bounding box of `obj` strictly to `[0..1, 0..1]` so baked tray AO & nap align 1:1!"""
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    dx = max(1e-4, max_x - min_x)
    dy = max(1e-4, max_y - min_y)
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            v = mesh.vertices[mesh.loops[loop_idx].vertex_index].co
            u = (v.x - min_x) / dx
            # Blender +Y is back (-Z in Three.js), so v=0 at +Y (top of tray) and v=1 at -Y (bottom)
            vv = (max_y - v.y) / dy
            uv_layer[loop_idx].uv = (u, vv)


def boolean_cut(target_obj, cutter_obj):
    mod = target_obj.modifiers.new(name="Cut", type="BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter_obj
    bpy.context.view_layer.objects.active = target_obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter_obj, do_unlink=True)


def join_objects(objs, name):
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = objs[0]
    joined.name = name
    apply_all_transforms(joined)
    return joined


def create_rounded_box(name, sx, sy, sz, corner_r=0.25, loc=(0, 0, 0), bevel_z=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    vert_edges = [
        e for e in bm.edges
        if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-4
        and abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-4
    ]
    if corner_r > 0.002 and vert_edges:
        bmesh.ops.bevel(
            bm,
            geom=vert_edges,
            offset=corner_r,
            offset_type="OFFSET",
            segments=10,
            profile=0.5,
            affect="EDGES",
        )
    bm.to_mesh(obj.data)
    bm.free()

    if bevel_z > 0.001:
        apply_bevel_and_weighted_normals(obj, width=bevel_z, segments=4, angle_deg=35.0)
    else:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def create_brass_inlay_frame(name, cx, cy, z_top, outer_w, outer_d, stroke_w, height, corner_r, mat):
    outer = create_rounded_box(
        f"{name}_outer",
        outer_w,
        outer_d,
        height,
        corner_r=corner_r,
        loc=(cx, cy, z_top - height * 0.5),
        bevel_z=0.0,
    )
    inner = create_rounded_box(
        f"{name}_inner",
        outer_w - stroke_w * 2.0,
        outer_d - stroke_w * 2.0,
        height * 2.4,
        corner_r=max(0.02, corner_r - stroke_w * 0.8),
        loc=(cx, cy, z_top - height * 0.5),
        bevel_z=0.0,
    )
    boolean_cut(outer, inner)
    apply_bevel_and_weighted_normals(outer, width=0.009, segments=3, angle_deg=35.0)
    outer.name = name
    apply_all_transforms(outer)
    box_uv_project(outer, scale=0.3)
    outer.data.materials.append(mat)
    return outer


def build_board_cabinet_glb():
    """
    Heavy Dimensional Mitered Walnut Cabinet (`board_cabinet.glb`):
    - Stepped heavy lower base plinth (`Z_bl = -0.68..-0.28`)
    - Main recessed walnut deck (`Z_bl = -0.34..0.02`)
    - Raised `+0.15` outer sculpted walnut bolster rail (`Z_bl = 0.00..+0.15`) casting real shadows!
    - Raised `+0.048` 3D chamfered champagne-brass moldings around grid, wells, and warfield trench bay!
    - Deep `-0.35` sunken tufted crushed-velvet casualty bunkers (`NavyVelvetCushion`, `CrimsonVelvetCushion`)
      with planar 1:1 UVs!
    - 72 thick, deep-chamfered charcoal-slate stone tiles (`0.934 x 0.934 x 0.078`) over `-0.075` dark grooves!
    """
    clear_scene()

    mat_walnut = make_pbr_mat("WalnutCabinet", (0.24, 0.14, 0.08, 1.0), metallic=0.0, roughness=0.36)
    mat_brass = make_pbr_mat("ChampagneBrass", (0.80, 0.62, 0.28, 1.0), metallic=0.92, roughness=0.24)
    mat_slate = make_pbr_mat("CharcoalSlate", (0.14, 0.16, 0.20, 1.0), metallic=0.06, roughness=0.56)
    mat_obsidian = make_pbr_mat("ObsidianGroove", (0.02, 0.025, 0.035, 1.0), metallic=0.04, roughness=0.90)
    mat_velvet_navy = make_pbr_mat("VelvetNavy", (0.06, 0.12, 0.28, 1.0), metallic=0.0, roughness=0.92)
    mat_velvet_crimson = make_pbr_mat("VelvetCrimson", (0.28, 0.05, 0.09, 1.0), metallic=0.0, roughness=0.92)

    grid_cy = -0.85
    bay_cy = 4.78
    cab_cy = 0.50
    left_wx = -3.68
    right_wx = 3.68

    # 1. Heavy Stepped Lower Walnut Plinth (`10.68 x 12.36`, `Z_bl = -0.68..-0.28`)
    plinth = create_rounded_box(
        "CabinetPlinth", 10.68, 12.36, 0.40, corner_r=0.48, loc=(0, cab_cy, -0.48), bevel_z=0.042
    )
    plinth_cut = create_rounded_box(
        "PlinthBayCut", 5.04, 2.08, 1.2, corner_r=0.12, loc=(0, bay_cy, -0.45), bevel_z=0.0
    )
    boolean_cut(plinth, plinth_cut)
    apply_all_transforms(plinth)
    box_uv_project(plinth, scale=0.085)
    plinth.data.materials.append(mat_walnut)

    # 2. Main Walnut Deck (`10.24 x 11.92`, `Z_bl = -0.32..+0.02`)
    deck = create_rounded_box(
        "CabinetDeck", 10.24, 11.92, 0.34, corner_r=0.38, loc=(0, cab_cy, -0.15), bevel_z=0.028
    )
    cut_grid = create_rounded_box("CutGrid", 9.12, 8.12, 0.95, corner_r=0.10, loc=(0, grid_cy, -0.08), bevel_z=0.0)
    cut_left = create_rounded_box("CutLeft", 1.38, 2.12, 0.95, corner_r=0.11, loc=(left_wx, bay_cy, -0.08), bevel_z=0.0)
    cut_bay = create_rounded_box("CutBay", 5.08, 2.12, 0.95, corner_r=0.12, loc=(0, bay_cy, -0.08), bevel_z=0.0)
    cut_right = create_rounded_box("CutRight", 1.38, 2.12, 0.95, corner_r=0.11, loc=(right_wx, bay_cy, -0.08), bevel_z=0.0)
    for cutter in (cut_grid, cut_left, cut_bay, cut_right):
        boolean_cut(deck, cutter)
    apply_bevel_and_weighted_normals(deck, width=0.014, segments=3, angle_deg=35.0)
    apply_all_transforms(deck)
    box_uv_project(deck, scale=0.085)
    deck.data.materials.append(mat_walnut)

    # 3. Raised Sculpted Walnut Outer Bolster Rail (`Z_bl = 0.00..+0.145`) — real 3D raised frame casting shadows!
    bolster = create_brass_inlay_frame(
        "CabinetBolsterRail", 0, cab_cy, 0.145, 10.18, 11.86, 0.36, 0.15, 0.36, mat_walnut
    )
    box_uv_project(bolster, scale=0.085)

    # 4. Raised 3D Chamfered Champagne-Brass Moldings (`Z_bl = +0.048`, `stroke = 0.068`)
    create_brass_inlay_frame("BrassGridFrame", 0, grid_cy, 0.048, 9.26, 8.26, 0.068, 0.056, 0.13, mat_brass)
    create_brass_inlay_frame("BrassLeftWell", left_wx, bay_cy, 0.052, 1.50, 2.24, 0.060, 0.060, 0.13, mat_brass)
    create_brass_inlay_frame("BrassArbiterBay", 0, bay_cy, 0.055, 5.20, 2.24, 0.062, 0.064, 0.14, mat_brass)
    create_brass_inlay_frame("BrassRightWell", right_wx, bay_cy, 0.052, 1.50, 2.24, 0.060, 0.060, 0.13, mat_brass)

    # 5. Deep Recessed Obsidian Sub-Bed (`Z_bl = -0.075`) & Pillowed Crushed-Velvet Casualty Cushions (`Z_bl = -0.34`)
    groove_bed = create_rounded_box("ObsidianSubBed", 9.10, 8.10, 0.09, corner_r=0.06, loc=(0, grid_cy, -0.095), bevel_z=0.0)
    apply_all_transforms(groove_bed)
    groove_bed.data.materials.append(mat_obsidian)

    navy_pad = create_rounded_box(
        "NavyVelvetCushion", 1.36, 2.10, 0.11, corner_r=0.09, loc=(left_wx, bay_cy, -0.35), bevel_z=0.032
    )
    apply_all_transforms(navy_pad)
    planar_bounds_uv_project(navy_pad)
    navy_pad.data.materials.append(mat_velvet_navy)

    crimson_pad = create_rounded_box(
        "CrimsonVelvetCushion", 1.36, 2.10, 0.11, corner_r=0.09, loc=(right_wx, bay_cy, -0.35), bevel_z=0.032
    )
    apply_all_transforms(crimson_pad)
    planar_bounds_uv_project(crimson_pad)
    crimson_pad.data.materials.append(mat_velvet_crimson)

    # Deep dark inner walnut/obsidian liners inside casualty wells & warfield bay
    for side_name, wx in (("LeftLiner", left_wx), ("RightLiner", right_wx)):
        liner = create_brass_inlay_frame(side_name, wx, bay_cy, 0.01, 1.42, 2.16, 0.04, 0.38, 0.10, mat_obsidian)
        liner.name = side_name
    bay_liner = create_brass_inlay_frame("BayInnerLiner", 0, bay_cy, 0.01, 5.12, 2.16, 0.045, 0.44, 0.12, mat_obsidian)
    bay_liner.name = "BayInnerLiner"

    # 6. 72 Thick Deep-Chamfered Charcoal-Slate Stone Tiles (`0.934 x 0.934 x 0.082`, pronounced 0.020 bevels!)
    tile_proto = create_rounded_box("SlateTileProto", 0.936, 0.936, 0.082, corner_r=0.032, loc=(0, 0, 0), bevel_z=0.019)
    box_uv_project(tile_proto, scale=0.45)
    tile_proto.data.materials.append(mat_slate)

    tile_meshes = []
    for r in range(8):
        for c in range(9):
            tx = (c - 4.0) * 1.0
            tz_three = (r - 3.5) * 1.0 + 0.85
            ty_blend = -tz_three
            inst = tile_proto.copy()
            inst.data = tile_proto.data.copy()
            inst.location = (tx, ty_blend, -0.022)
            bpy.context.collection.objects.link(inst)
            tile_meshes.append(inst)

    bpy.data.objects.remove(tile_proto, do_unlink=True)
    join_objects(tile_meshes, "SlateGrid72")

    out_path = os.path.join(OUT_DIR, "board_cabinet.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True, export_yup=True)
    print(f"Exported {out_path}")


def build_warfield_arena_glb():
    """
    Sunken 3D Miniature Battlefield Trench & Bunker Diorama (`warfield_arena.glb`), centered around `(0,0,0)`
    (mounted at `ARBITER_BAY_CENTER_Z = -4.78` in Three.js!):
      - `MudTerrain`: Sculpted 3D shell-cratered earth & rocky trench floor (`4.98 x 2.02`, `Z_bl = -0.34..-0.12`).
      - `BastionBases`: Reinforced concrete/gunmetal octagonal firing redoubts at `X = +/-1.34`.
      - `Sandbags`: 26 plump 3D beveled burlap sandbags stacked in curved defensive walls around both bastions!
      - `TankTraps`: 3 riveted steel Czech hedgehog anti-tank obstacles in No-Man's-Land!
      - `ArmoredBunker`: Sloped reinforced casemate pillbox along the rear embankment (`Y_bl = +0.58`) with
                         recessed visor port & twin traversed brass howitzer barrels (`HowitzerBarrels`).
    """
    clear_scene()
    rng = random.Random(77)

    mat_mud = make_pbr_mat("MudTerrainMat", (0.14, 0.11, 0.08, 1.0), metallic=0.02, roughness=0.88)
    mat_sandbag = make_pbr_mat("SandbagBurlap", (0.46, 0.39, 0.27, 1.0), metallic=0.0, roughness=0.86)
    mat_bunker = make_pbr_mat("ArmoredConcrete", (0.19, 0.21, 0.24, 1.0), metallic=0.65, roughness=0.42)
    mat_steel = make_pbr_mat("TankTrapSteel", (0.13, 0.15, 0.18, 1.0), metallic=0.84, roughness=0.38)
    mat_brass = make_pbr_mat("ArtilleryBrass", (0.78, 0.60, 0.28, 1.0), metallic=0.92, roughness=0.25)

    # 1. Sculpted 3D Shell-Cratered Battlefield Floor (`4.98 x 2.02`)
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=24, size=1.0, location=(0, 0, -0.26))
    terrain = bpy.context.active_object
    terrain.name = "MudTerrain"
    terrain.scale = (4.98, 2.02, 1.0)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    craters = [(-0.28, -0.18, 0.38, 0.11), (0.32, 0.16, 0.42, 0.12), (0.02, -0.35, 0.30, 0.08)]
    for v in terrain.data.vertices:
        x, y = v.co.x, v.co.y
        # Subtle organic battlefield mounds + crater rims & bowls
        h = 0.032 * math.sin(x * 3.1) * math.cos(y * 4.3) + 0.018 * math.cos(x * 7.7 + y * 5.2)
        for cx, cy, cr, cd in craters:
            d = math.hypot(x - cx, y - cy)
            if d < cr * 1.35:
                u = d / cr
                if u < 1.0:
                    h -= cd * (1.0 - u * u)
                else:
                    rim = math.sin(((u - 1.0) / 0.35) * math.pi)
                    h += cd * 0.32 * rim
        # Raise rear embankment slightly toward bunker (`+Y` in Blender -> `-Z` rear in Three.js)
        if y > 0.35:
            h += (y - 0.35) * 0.16
        # Flatten edges cleanly so nothing pokes outside bay liner
        edge_damp = min(1.0, (2.48 - abs(x)) * 3.0, (1.00 - abs(y)) * 3.0)
        v.co.z = -0.26 + h * max(0.0, edge_damp)

    for p in terrain.data.polygons:
        p.use_smooth = True
    terrain.data.update()
    box_uv_project(terrain, scale=0.35)
    terrain.data.materials.append(mat_mud)

    # 2. Left & Right Fortified Bastion Emplacements (`X = +/-1.34`, `Y_bl = -0.12` -> `Z_3js = +0.12`)
    bastion_objs = []
    ring_objs = []
    for sx in (-1.34, 1.34):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.72, depth=0.22, location=(sx, -0.12, -0.21))
        b_base = bpy.context.active_object
        b_base.rotation_euler = (0, 0, math.radians(22.5))
        apply_all_transforms(b_base)
        apply_bevel_and_weighted_normals(b_base, width=0.025, segments=3)
        b_base.data.materials.append(mat_bunker)
        bastion_objs.append(b_base)

        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.54, minor_radius=0.032, major_segments=32, minor_segments=12, location=(sx, -0.12, -0.095)
        )
        t_ring = bpy.context.active_object
        for p in t_ring.data.polygons:
            p.use_smooth = True
        t_ring.data.materials.append(mat_brass)
        ring_objs.append(t_ring)

    join_objects(bastion_objs, "BastionBases")
    join_objects(ring_objs, "BastionBrassRings")

    # 3. 28 Plump Sculpted 3D Sandbags stacked around the inner/front flanks of both bastions!
    bag_objs = []
    for side in (-1, 1):
        cx = side * 1.34
        cy = -0.12
        # Arc facing inward toward No-Man's-Land and slightly forward
        base_angles = [-65, -25, 15, 55, 95] if side == -1 else [115, 155, 195, 235, 275]
        for layer in (0, 1):
            for idx, deg in enumerate(base_angles):
                if layer == 1 and idx == len(base_angles) - 1:
                    continue
                ang = math.radians(deg + (layer * 16))
                rad = 0.68
                bx = cx + math.cos(ang) * rad
                by = cy + math.sin(ang) * rad * 0.88
                bz = -0.17 + layer * 0.088
                bag = create_rounded_box(
                    f"Bag_{side}_{layer}_{idx}",
                    0.28,
                    0.15,
                    0.095,
                    corner_r=0.045,
                    loc=(bx, by, bz),
                    bevel_z=0.028,
                )
                bag.rotation_euler = (
                    rng.uniform(-0.06, 0.06),
                    rng.uniform(-0.06, 0.06),
                    ang + math.pi * 0.5 + rng.uniform(-0.08, 0.08),
                )
                bag.data.materials.append(mat_sandbag)
                bag_objs.append(bag)

    sandbags = join_objects(bag_objs, "Sandbags")
    box_uv_project(sandbags, scale=1.2)

    # 4. 3 Steel Czech Hedgehog Anti-Tank Obstacles in No-Man's-Land!
    trap_objs = []
    for tx, ty, rot_z in ((-0.38, -0.34, 0.35), (0.36, -0.22, -0.45), (-0.02, 0.14, 0.18)):
        for rx, ry, rz in ((0.62, 0.45, 0.1), (-0.58, 0.52, 1.15), (0.48, -0.62, 2.2)):
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=(tx, ty, -0.14))
            beam = bpy.context.active_object
            beam.scale = (0.036, 0.036, 0.34)
            beam.rotation_euler = (rx, ry, rz + rot_z)
            apply_all_transforms(beam)
            apply_bevel_and_weighted_normals(beam, width=0.006, segments=2)
            beam.data.materials.append(mat_steel)
            trap_objs.append(beam)
    join_objects(trap_objs, "TankTraps")

    # 5. Low-Slung Sloped Armored Command Pillbox Bunker (`Y_bl = +0.62` -> `Z_3js = -0.62`)
    bunker = create_rounded_box(
        "ArmoredBunker", 2.48, 0.58, 0.62, corner_r=0.14, loc=(0, 0.64, 0.04), bevel_z=0.035
    )
    # Cut armored vision/comms aperture on front (`-Y_bl` -> `+Z_3js`)
    visor_cut = create_rounded_box("VisorCut", 1.32, 0.28, 0.34, corner_r=0.05, loc=(0, 0.42, 0.08), bevel_z=0.0)
    boolean_cut(bunker, visor_cut)
    apply_bevel_and_weighted_normals(bunker, width=0.012, segments=3)
    apply_all_transforms(bunker)
    box_uv_project(bunker, scale=0.4)
    bunker.data.materials.append(mat_bunker)

    # Twin Traversed Brass Casemate Artillery Barrels flanking the bunker visor!
    barrel_objs = []
    for bx, yaw in ((-0.88, -0.18), (0.88, 0.18)):
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=20,
            radius=0.048,
            depth=0.42,
            location=(bx, 0.32, 0.08),
            rotation=(math.radians(82), 0, yaw),
        )
        brl = bpy.context.active_object
        brl.data.materials.append(mat_brass)
        barrel_objs.append(brl)

        bpy.ops.mesh.primitive_cylinder_add(
            vertices=20,
            radius=0.068,
            depth=0.09,
            location=(bx - math.sin(yaw) * 0.18, 0.14, 0.10),
            rotation=(math.radians(82), 0, yaw),
        )
        muz = bpy.context.active_object
        muz.data.materials.append(mat_steel)
        barrel_objs.append(muz)
    join_objects(barrel_objs, "HowitzerBarrels")

    # Twin Bastion Sandbag Firing Cannon Muzzles (so gunfire blasts cleanly from the sandbagged parapets!)
    bastion_guns = []
    for side in (-1, 1):
        gx = side * 0.78
        gy = -0.12
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=18,
            radius=0.042,
            depth=0.34,
            location=(gx, gy, -0.05),
            rotation=(0, math.radians(90 * side), 0),
        )
        g_brl = bpy.context.active_object
        g_brl.data.materials.append(mat_steel)
        bastion_guns.append(g_brl)
    join_objects(bastion_guns, "BastionGuns")

    out_path = os.path.join(OUT_DIR, "warfield_arena.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True, export_yup=True)
    print(f"Exported {out_path}")


def build_war_room_table_glb():
    """
    Real 3D Multi-Plank Weathered-Oak Campaign Table & Dimensional War-Room Props (`war_room_table.glb`):
      - `OakPlanks`: 9 individual thick 3D beveled oak planks (`width = 28, thickness = 0.36`) separated
                     by physical `0.045` recessed V-grooves so grazing light casts real plank seam shadows!
      - `AmmoCrate`: 3D slatted wooden field-command crate at rear-left `(-5.35, 7.15, -0.68)` (`Z_3js = -7.15`).
      - `LanternBrass` & `LanternGlass`: Sculpted 3D antique brass hurricane oil lantern standing on the crate!
      - `MapScrolls` & `BrassWeights`: Rolled 3D parchment command scrolls & brass map weights on the right!
    """
    clear_scene()

    mat_oak = make_pbr_mat("OakPlanksMat", (0.42, 0.31, 0.22, 1.0), metallic=0.0, roughness=0.68)
    mat_crate = make_pbr_mat("CrateWoodMat", (0.28, 0.19, 0.12, 1.0), metallic=0.0, roughness=0.76)
    mat_brass = make_pbr_mat("PropBrassMat", (0.78, 0.60, 0.28, 1.0), metallic=0.92, roughness=0.25)
    mat_glass = make_pbr_mat("LanternGlassMat", (1.0, 0.85, 0.55, 1.0), metallic=0.0, roughness=0.12)
    mat_scroll = make_pbr_mat("ParchmentScrollMat", (0.76, 0.67, 0.50, 1.0), metallic=0.0, roughness=0.82)

    # 1. 15 Individual 3D Beveled Heavy Oak Planks (`width = 52.0`, extending forward to `Z_3js = +20.0` so ZERO bottom black void!)
    plank_objs = []
    plank_depth = 2.25
    for i in range(15):
        py_bl = -20.2 + i * (plank_depth + 0.038)
        plank = create_rounded_box(
            f"Plank_{i}",
            52.0,
            plank_depth,
            0.34,
            corner_r=0.04,
            loc=(0, py_bl, -0.855),
            bevel_z=0.026,
        )
        plank.data.materials.append(mat_oak)
        plank_objs.append(plank)

    planks = join_objects(plank_objs, "OakPlanks")
    box_uv_project(planks, scale=0.14)

    # 2. Rear-Left Wooden Field Command Crate (placed cleanly clear of the `-5.34` walnut cabinet edge!)
    crate_parts = []
    crate_body = create_rounded_box(
        "CrateMain", 2.15, 1.85, 0.54, corner_r=0.04, loc=(-6.85, 6.65, -0.41), bevel_z=0.02
    )
    crate_body.rotation_euler = (0, 0, math.radians(-12))
    crate_body.data.materials.append(mat_crate)
    crate_parts.append(crate_body)
    crate = join_objects(crate_parts, "AmmoCrate")
    box_uv_project(crate, scale=0.35)

    # 3. 3D Brass & Glass Hurricane Oil Lantern standing atop the crate (`x = -6.65, y_bl = 6.55 -> z_3js = -6.55`)
    lx, ly, lz = -6.65, 6.55, -0.14
    lantern_brass = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.46, depth=0.22, location=(lx, ly, lz + 0.11))
    fount = bpy.context.active_object
    apply_bevel_and_weighted_normals(fount, width=0.035, segments=3)
    fount.data.materials.append(mat_brass)
    lantern_brass.append(fount)

    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.36, depth=0.14, location=(lx, ly, lz + 1.08))
    cap = bpy.context.active_object
    apply_bevel_and_weighted_normals(cap, width=0.03, segments=3)
    cap.data.materials.append(mat_brass)
    lantern_brass.append(cap)

    for ang_deg in (0, 90, 180, 270):
        a = math.radians(ang_deg)
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=12,
            radius=0.022,
            depth=0.88,
            location=(lx + math.cos(a) * 0.40, ly + math.sin(a) * 0.40, lz + 0.62),
        )
        guard = bpy.context.active_object
        guard.data.materials.append(mat_brass)
        lantern_brass.append(guard)

    join_objects(lantern_brass, "LanternBrass")

    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.29, depth=0.74, location=(lx, ly, lz + 0.60))
    globe = bpy.context.active_object
    globe.name = "LanternGlass"
    for p in globe.data.polygons:
        p.use_smooth = True
    apply_all_transforms(globe)
    globe.data.materials.append(mat_glass)

    # 4. 3D Rolled Parchment Command Scrolls oriented lengthwise (`along Y_bl / Z_3js`) cleanly outside `+5.34` rail!
    scroll_parts = []
    for dx, dz, yaw_z, rad in ((0.0, 0.0, 0.14, 0.13), (0.27, 0.0, 0.18, 0.125), (0.13, 0.20, 0.16, 0.12)):
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=24,
            radius=rad,
            depth=2.55,
            location=(6.45 + dx, 3.85, -0.55 + dz),
            rotation=(math.radians(90), 0, yaw_z),
        )
        sc = bpy.context.active_object
        for p in sc.data.polygons:
            p.use_smooth = True
        sc.data.materials.append(mat_scroll)
        scroll_parts.append(sc)
    scrolls = join_objects(scroll_parts, "MapScrolls")
    box_uv_project(scrolls, scale=0.4)

    weight_parts = []
    for wx, wy in ((-3.85, 8.95), (4.25, 8.85)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=0.22, depth=0.11, location=(wx, wy, -0.61))
        bw = bpy.context.active_object
        apply_bevel_and_weighted_normals(bw, width=0.02, segments=3)
        bw.data.materials.append(mat_brass)
        weight_parts.append(bw)
    join_objects(weight_parts, "BrassWeights")

    out_path = os.path.join(OUT_DIR, "war_room_table.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True, export_yup=True)
    print(f"Exported {out_path}")


def build_command_wedge_glb():
    """
    Heirloom Brass-Collared Military Command Monolith (`command_wedge.glb`):
    Multi-part sculpted high-definition piece with 3 distinct material meshes so pieces NEVER look like plain rectangles:
      1. `WedgeBrassPlinth`: Weighted stepped octagonal brushed-brass pedestal base + delicate raised front shield trim!
      2. `WedgeBody`: Sculpted multi-chamfered monolith (`68 deg` front face with recessed escutcheon frame,
                      stepped Art-Deco crown crest,faceted side shoulders, and `78 deg` armored rear shield with
                      3 horizontal armor louvers + central command spine—100% identical across all ranks!).
      3. `WedgeEscutcheon`: Deep satin inset panel on the front slope framing the 3D metallic rank relief!
    """
    clear_scene()

    mat_resin = make_pbr_mat("WedgeResin", (0.08, 0.15, 0.28, 1.0), metallic=0.06, roughness=0.38)
    mat_brass = make_pbr_mat("WedgeBrass", (0.80, 0.62, 0.28, 1.0), metallic=0.92, roughness=0.24)
    mat_inset = make_pbr_mat("WedgeInset", (0.04, 0.08, 0.16, 1.0), metallic=0.12, roughness=0.48)

    # 1. Weighted Stepped Brushed-Brass Pedestal Plinth (`Z_bl = 0.00 .. 0.075`)
    plinth_parts = []
    p_low = create_rounded_box("PlinthLow", 0.76, 0.58, 0.042, corner_r=0.105, loc=(0, -0.005, 0.021), bevel_z=0.009)
    p_low.data.materials.append(mat_brass)
    plinth_parts.append(p_low)

    p_step = create_rounded_box("PlinthStep", 0.70, 0.52, 0.038, corner_r=0.088, loc=(0, -0.005, 0.056), bevel_z=0.008)
    p_step.data.materials.append(mat_brass)
    plinth_parts.append(p_step)

    # 2. Main Sculpted Tapered Monolith Body (`Z_bl = 0.068 .. 0.710`, crest top `0.735u`)
    mesh = bpy.data.meshes.new("CommandMonolithMesh")
    bm = bmesh.new()

    z0 = 0.068
    z_shoulder = 0.620
    z_crown = 0.710

    # Blender -Y -> Three.js +Z (front 57 deg face toward player camera)
    yf0 = -0.295
    yb0 = 0.275
    yf_sh = yf0 + (z_shoulder - z0) / math.tan(math.radians(57.0))
    yb_sh = yb0 - (z_shoulder - z0) / math.tan(math.radians(78.0))
    yf_cr = yf_sh + 0.022
    yb_cr = yb_sh - 0.016

    def make_octagon_ring(hw_f, hw_b, yf, yb, z, cham):
        return [
            bm.verts.new((-hw_f + cham, yf, z)),
            bm.verts.new((hw_f - cham, yf, z)),
            bm.verts.new((hw_f, yf + cham * 0.9, z)),
            bm.verts.new((hw_b, yb - cham * 0.9, z)),
            bm.verts.new((hw_b - cham, yb, z)),
            bm.verts.new((-hw_b + cham, yb, z)),
            bm.verts.new((-hw_b, yb - cham * 0.9, z)),
            bm.verts.new((-hw_f, yf + cham * 0.9, z)),
        ]

    r0 = make_octagon_ring(0.352, 0.332, yf0, yb0, z0, 0.074)
    r1 = make_octagon_ring(0.258, 0.242, yf_sh, yb_sh, z_shoulder, 0.058)
    r2 = make_octagon_ring(0.194, 0.180, yf_cr, yb_cr, z_crown, 0.044)

    bm.faces.new(list(reversed(r0)))
    for ring_a, ring_b in ((r0, r1), (r1, r2)):
        for i in range(8):
            ni = (i + 1) % 8
            bm.faces.new([ring_a[i], ring_a[ni], ring_b[ni], ring_b[i]])
    bm.faces.new(r2)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    body = bpy.data.objects.new("WedgeBody", mesh)
    bpy.context.collection.objects.link(body)
    apply_bevel_and_weighted_normals(body, width=0.014, segments=4, angle_deg=22.0)

    # Sculpted Crown Ridge Cap & Rear Armored Spine/Louvers (gives Enemy back faces awesome 3D detail!)
    body_addons = [body]
    crown_bar = create_rounded_box(
        "CrownCrest", 0.26, 0.068, 0.029, corner_r=0.02, loc=(0, (yf_cr + yb_cr) * 0.5, z_crown + 0.0105), bevel_z=0.006
    )
    crown_bar.data.materials.append(mat_resin)
    body_addons.append(crown_bar)

    # 3 Rear Horizontal Armor Louvers + Central Rear Spine (`+Y_bl` rear face, 78 deg slope = 12 deg from vertical)
    for idx, lz in enumerate((0.20, 0.34, 0.48)):
        t_frac = (lz - z0) / (z_shoulder - z0)
        ly = yb0 * (1.0 - t_frac) + yb_sh * t_frac + 0.008
        lw = 0.41 - idx * 0.045
        louver = create_rounded_box(
            f"RearLouver_{idx}", lw, 0.034, 0.044, corner_r=0.01, loc=(0, ly, lz), bevel_z=0.006
        )
        louver.rotation_euler = (math.radians(12.0), 0, 0)
        louver.data.materials.append(mat_resin)
        body_addons.append(louver)

    spine_y = (yb0 + yb_sh) * 0.5 + 0.011
    spine = create_rounded_box(
        "RearSpine", 0.064, 0.036, 0.41, corner_r=0.014, loc=(0, spine_y, 0.345), bevel_z=0.006
    )
    spine.rotation_euler = (math.radians(12.0), 0, 0)
    spine.data.materials.append(mat_resin)
    body_addons.append(spine)

    # Side Shoulder Epaulet Ribs (`+/-X` flanks)
    for sx in (-1, 1):
        flank = create_rounded_box(
            f"SideRib_{sx}", 0.036, 0.17, 0.40, corner_r=0.012, loc=(sx * 0.296, 0.008, 0.335), bevel_z=0.006
        )
        flank.rotation_euler = (0, math.radians(-sx * 9.5), 0)
        flank.data.materials.append(mat_resin)
        body_addons.append(flank)

    body.data.materials.append(mat_resin)
    joined_body = join_objects(body_addons, "WedgeBody")
    box_uv_project(joined_body, scale=0.8)

    # 3. Delicate Raised Brass Escutcheon Frame + Dark Satin Shield Plate on the `57 deg` Front Slope!
    front_mid_z = 0.355
    t_mid = (front_mid_z - z0) / (z_shoulder - z0)
    front_mid_y = yf0 * (1.0 - t_mid) + yf_sh * t_mid

    escutcheon_frame = create_brass_inlay_frame(
        "EscutcheonBrass", 0, 0, 0.014, 0.47, 0.45, 0.024, 0.022, 0.052, mat_brass
    )
    escutcheon_frame.rotation_euler = (math.radians(57.0), 0, 0)
    escutcheon_frame.location = (0, front_mid_y - 0.005, front_mid_z + 0.003)
    apply_all_transforms(escutcheon_frame)
    plinth_parts.append(escutcheon_frame)

    crown_finial = create_rounded_box(
        "CrownBrassBar", 0.19, 0.042, 0.020, corner_r=0.011, loc=(0, (yf_cr + yb_cr) * 0.5, 0.725), bevel_z=0.004
    )
    crown_finial.data.materials.append(mat_brass)
    plinth_parts.append(crown_finial)

    # Rear Brass Command Rivet Bar on plinth heel
    rear_brass_bar = create_rounded_box(
        "RearBrassHeel", 0.36, 0.034, 0.036, corner_r=0.01, loc=(0, yb0 + 0.009, 0.105), bevel_z=0.006
    )
    rear_brass_bar.data.materials.append(mat_brass)
    plinth_parts.append(rear_brass_bar)

    joined_brass = join_objects(plinth_parts, "WedgeBrassPlinth")
    box_uv_project(joined_brass, scale=0.9)

    inset_plate = create_rounded_box(
        "WedgeEscutcheon", 0.425, 0.405, 0.012, corner_r=0.042, loc=(0, 0, 0), bevel_z=0.003
    )
    inset_plate.rotation_euler = (math.radians(57.0), 0, 0)
    inset_plate.location = (0, front_mid_y - 0.0025, front_mid_z + 0.0016)
    apply_all_transforms(inset_plate)
    box_uv_project(inset_plate, scale=1.0)
    inset_plate.data.materials.append(mat_inset)

    out_path = os.path.join(OUT_DIR, "command_wedge.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True, export_yup=True)
    print(f"Exported {out_path}")


def build_pocket_watch_glb():
    clear_scene()
    mat_brass = make_pbr_mat("WatchBrass", (0.76, 0.57, 0.26, 1.0), metallic=0.92, roughness=0.24)
    mat_dial = make_pbr_mat("WatchDial", (0.85, 0.79, 0.66, 1.0), metallic=0.0, roughness=0.55)

    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.72, depth=0.22, location=(0, 0, 0.11))
    case = bpy.context.active_object
    apply_bevel_and_weighted_normals(case, width=0.035, segments=4)
    case.data.materials.append(mat_brass)
    parts.append(case)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.68, minor_radius=0.058, major_segments=48, minor_segments=16, location=(0, 0, 0.21))
    bezel = bpy.context.active_object
    for p in bezel.data.polygons:
        p.use_smooth = True
    bezel.data.materials.append(mat_brass)
    parts.append(bezel)

    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.075, depth=0.22, location=(0, 0.80, 0.12), rotation=(math.radians(90), 0, 0))
    stem = bpy.context.active_object
    stem.data.materials.append(mat_brass)
    parts.append(stem)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.16, minor_radius=0.026, major_segments=28, minor_segments=12, location=(0, 0.94, 0.12))
    bow = bpy.context.active_object
    for p in bow.data.polygons:
        p.use_smooth = True
    bow.data.materials.append(mat_brass)
    parts.append(bow)

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.63, depth=0.02, location=(0, 0, 0.215))
    dial = bpy.context.active_object
    dial.data.materials.append(mat_dial)
    parts.append(dial)

    join_objects(parts, "PocketWatch")

    out_path = os.path.join(OUT_DIR, "pocket_watch.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True, export_yup=True)
    print(f"Exported {out_path}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    build_board_cabinet_glb()
    build_warfield_arena_glb()
    build_war_room_table_glb()
    build_command_wedge_glb()
    build_pocket_watch_glb()
    with open(os.path.join(OUT_DIR, "_bake_stamp.txt"), "w", encoding="utf-8") as f:
        f.write("OK\n")


if __name__ == "__main__":
    main()
