import math
import os
import traceback
import bpy
import bmesh

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT_DIR, "public", "models")
LOG_FILE = os.path.join(os.path.dirname(__file__), "wedge_log.txt")


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


def box_uv_project(obj, scale=0.8):
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


def boolean_cut(target_obj, cutter_obj):
    mod = target_obj.modifiers.new(name="Cut", type="BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter_obj
    bpy.context.view_layer.objects.active = target_obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter_obj, do_unlink=True)


def join_objects(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = objs[0]
    joined.name = name
    apply_all_transforms(joined)
    return joined


def create_rounded_box(name, sx, sy, sz, corner_r=0.05, loc=(0, 0, 0), bevel_z=0.01):
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
            segments=8,
            profile=0.5,
            affect="EDGES",
        )
    bm.to_mesh(obj.data)
    bm.free()

    if bevel_z > 0.001:
        apply_bevel_and_weighted_normals(obj, width=bevel_z, segments=3, angle_deg=35.0)
    else:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    mat_resin = make_pbr_mat("WedgeResin", (0.08, 0.15, 0.28, 1.0), metallic=0.06, roughness=0.38)
    mat_brass = make_pbr_mat("WedgeBrass", (0.80, 0.62, 0.28, 1.0), metallic=0.92, roughness=0.24)
    mat_inset = make_pbr_mat("WedgeInset", (0.04, 0.08, 0.16, 1.0), metallic=0.12, roughness=0.48)

    # 1. Weighted Stepped Octagonal Brushed-Brass Pedestal Plinth (`Z_bl = 0.00 .. 0.075`)
    plinth_parts = []
    p_low = create_rounded_box("PlinthLow", 0.76, 0.58, 0.042, corner_r=0.105, loc=(0, -0.005, 0.021), bevel_z=0.009)
    p_low.data.materials.append(mat_brass)
    plinth_parts.append(p_low)

    p_step = create_rounded_box("PlinthStep", 0.70, 0.52, 0.038, corner_r=0.088, loc=(0, -0.005, 0.056), bevel_z=0.008)
    p_step.data.materials.append(mat_brass)
    plinth_parts.append(p_step)

    # 2. Sculpted Multi-Chamfered Monolith Body (`Z_bl = 0.068 .. 0.710`, crest top `0.735u` -> `0.794u` at 1.08x)
    mesh = bpy.data.meshes.new("CommandMonolithMesh")
    bm = bmesh.new()

    z0 = 0.068
    z_shoulder = 0.620
    z_crown = 0.710

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

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()

    body = bpy.data.objects.new("WedgeBody", mesh)
    bpy.context.collection.objects.link(body)
    apply_bevel_and_weighted_normals(body, width=0.014, segments=4, angle_deg=22.0)
    body.data.materials.append(mat_resin)

    body_addons = [body]
    crown_bar = create_rounded_box(
        "CrownCrest", 0.26, 0.068, 0.029, corner_r=0.02, loc=(0, (yf_cr + yb_cr) * 0.5, z_crown + 0.0105), bevel_z=0.006
    )
    crown_bar.data.materials.append(mat_resin)
    body_addons.append(crown_bar)

    # 3 Rear Horizontal Armor Louvers + Central Rear Command Spine (100% identical on all pieces!)
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

    for sx in (-1, 1):
        flank = create_rounded_box(
            f"SideRib_{sx}", 0.036, 0.17, 0.40, corner_r=0.012, loc=(sx * 0.296, 0.008, 0.335), bevel_z=0.006
        )
        flank.rotation_euler = (0, math.radians(-sx * 9.5), 0)
        flank.data.materials.append(mat_resin)
        body_addons.append(flank)

    joined_body = join_objects(body_addons, "WedgeBody")
    box_uv_project(joined_body, scale=0.8)

    # 3. Raised Brushed-Brass Escutcheon Shield Frame + Crown Brass Finial + Dark Satin Inset on 57 deg Front Face!
    front_mid_z = 0.355
    t_mid = (front_mid_z - z0) / (z_shoulder - z0)
    front_mid_y = yf0 * (1.0 - t_mid) + yf_sh * t_mid

    frame_outer = create_rounded_box("EscOuter", 0.47, 0.45, 0.022, corner_r=0.058, loc=(0, 0, 0), bevel_z=0.0)
    frame_inner = create_rounded_box("EscInner", 0.415, 0.395, 0.06, corner_r=0.042, loc=(0, 0, 0), bevel_z=0.0)
    boolean_cut(frame_outer, frame_inner)
    apply_bevel_and_weighted_normals(frame_outer, width=0.0045, segments=2, angle_deg=35.0)
    frame_outer.rotation_euler = (math.radians(57.0), 0, 0)
    frame_outer.location = (0, front_mid_y - 0.005, front_mid_z + 0.003)
    apply_all_transforms(frame_outer)
    frame_outer.data.materials.clear()
    frame_outer.data.materials.append(mat_brass)
    plinth_parts.append(frame_outer)

    crown_finial = create_rounded_box(
        "CrownBrassBar", 0.19, 0.042, 0.020, corner_r=0.011, loc=(0, (yf_cr + yb_cr) * 0.5, 0.725), bevel_z=0.004
    )
    crown_finial.data.materials.append(mat_brass)
    plinth_parts.append(crown_finial)

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


if __name__ == "__main__":
    try:
        build()
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write("SUCCESS\n")
    except Exception:
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
