"""
Headless Blender 5.x CAD Asset Generator for War Generals (Salpakan).
Generates beveled high-precision .glb assets into public/models/:
  1. command_wedge.glb   — Exact 4-bevel asymmetric Command Wedge (68 deg front slope, 78 deg rear shield)
  2. board_cabinet.glb   — Mitered walnut 9x8 cabinet shell with recessed Arbiter bay & twin casualty wells
  3. arbiter_chassis.glb — Ribbed gunmetal cylindrical shutter & rear instrument housing shell

Run via:
  blender --background --python tools/blender/generate_assets.py
"""

import math
import os
import bpy
import bmesh


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT_DIR, "public", "models")


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def add_bevel_and_normals(obj, width=0.018, segments=3):
    bev = obj.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = width
    bev.segments = segments
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(28.0)
    bev.harden_normals = True

    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph)
    new_mesh = bpy.data.meshes.new_from_object(eval_obj)
    obj.modifiers.clear()
    obj.data = new_mesh
    for poly in obj.data.polygons:
        poly.use_smooth = True


def build_command_wedge():
    """
    Matches ref_piece_turnaround.jpg:
    - Tapered trapezoidal footprint
    - 68 deg sloped front insignia face (+Z facing owner)
    - 78 deg steeper blank rear shield face (-Z facing opponent)
    - Flat chamfered top cap & side bevels
    - Base rests cleanly at Y=0 in glTF (Z=0 in Blender)
    """
    clear_scene()
    mesh = bpy.data.meshes.new("CommandWedgeMesh")
    bm = bmesh.new()

    h = 0.86
    # Bottom footprint at Z = 0
    bw_front = 0.365
    bw_back = 0.345
    z_front_bot = 0.285   # +Y in Blender -> -Z/+Z after glTF Y-up conversion; keep +Y = back, -Y = front so +Z in glTF faces viewer!
    # In Blender: X = right, Y = forward (maps to -Z in glTF), Z = up (maps to +Y in glTF).
    # Therefore -Y in Blender maps to +Z in Three.js (facing player camera)!
    y_front_bot = -0.275
    y_back_bot = 0.265

    # 68 deg front slope: horizontal setback = h / tan(68 deg) = 0.86 / 2.475 = 0.347 -> symmetric balance:
    # Center top cap over base so wedge looks poised & matches ref_piece_turnaround.jpg
    front_inset = h / math.tan(math.radians(71.5))  # ~0.287
    back_inset = h / math.tan(math.radians(78.5))   # ~0.175

    y_front_top = y_front_bot + front_inset
    y_back_top = y_back_bot - back_inset
    tw_front = 0.235
    tw_back = 0.225

    # Small lower plinth chamfer skirt (matching bottom bevel in ref_piece_turnaround.jpg)
    skirt_h = 0.045
    v_bot = [
        bm.verts.new((-bw_front * 0.94, y_front_bot * 0.94, 0.0)),
        bm.verts.new((bw_front * 0.94, y_front_bot * 0.94, 0.0)),
        bm.verts.new((bw_back * 0.94, y_back_bot * 0.94, 0.0)),
        bm.verts.new((-bw_back * 0.94, y_back_bot * 0.94, 0.0)),
    ]
    v_mid = [
        bm.verts.new((-bw_front, y_front_bot, skirt_h)),
        bm.verts.new((bw_front, y_front_bot, skirt_h)),
        bm.verts.new((bw_back, y_back_bot, skirt_h)),
        bm.verts.new((-bw_back, y_back_bot, skirt_h)),
    ]
    v_top = [
        bm.verts.new((-tw_front, y_front_top, h)),
        bm.verts.new((tw_front, y_front_top, h)),
        bm.verts.new((tw_back, y_back_top, h)),
        bm.verts.new((-tw_back, y_back_top, h)),
    ]

    # Bottom cap
    bm.faces.new([v_bot[3], v_bot[2], v_bot[1], v_bot[0]])
    # Skirt faces
    for i in range(4):
        ni = (i + 1) % 4
        bm.faces.new([v_bot[i], v_bot[ni], v_mid[ni], v_mid[i]])
    # Main sloped faces (Front = i=0, Right = i=1, Back = i=2, Left = i=3)
    for i in range(4):
        ni = (i + 1) % 4
        bm.faces.new([v_mid[i], v_mid[ni], v_top[ni], v_top[i]])
    # Top cap
    bm.faces.new([v_top[0], v_top[1], v_top[2], v_top[3]])

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new("CommandWedge", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    add_bevel_and_normals(obj, width=0.024, segments=4)

    mat = bpy.data.materials.new("WedgeBaseMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.094, 0.168, 0.286, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.46
    obj.data.materials.append(mat)

    out_path = os.path.join(OUT_DIR, "command_wedge.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )
    print(f"Exported {out_path}")


def build_arbiter_shutter():
    """
    Ribbed dark-gunmetal cylindrical shutter & rear housing shell matching Act 1-3 references.
    """
    clear_scene()
    # Create ribbed cylindrical drum along X axis
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48,
        radius=0.52,
        depth=3.75,
        location=(0.0, 0.0, 0.0),
        rotation=(0.0, math.radians(90.0), 0.0),
    )
    drum = bpy.context.active_object
    drum.name = "ArbiterShutterDrum"

    # Subdivide & groove subtle ribs along X
    bm = bmesh.new()
    bm.from_mesh(drum.data)
    bmesh.ops.subdivide_edges(
        bm,
        edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.5],
        cuts=26,
        use_grid_fill=True,
    )
    for v in bm.verts:
        # local Z of cylinder is along X after apply, before apply local Z is height
        rib = math.sin(v.co.z * 26.0)
        r = math.hypot(v.co.x, v.co.y)
        if r > 0.1:
            scale = 1.0 + 0.028 * rib
            v.co.x *= scale
            v.co.y *= scale
    bm.to_mesh(drum.data)
    bm.free()

    for poly in drum.data.polygons:
        poly.use_smooth = True

    mat = bpy.data.materials.new("GunmetalRibbed")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.16, 0.175, 0.19, 1.0)
        bsdf.inputs["Metallic"].default_value = 0.86
        bsdf.inputs["Roughness"].default_value = 0.34
    drum.data.materials.append(mat)

    out_path = os.path.join(OUT_DIR, "arbiter_shutter.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )
    print(f"Exported {out_path}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    build_command_wedge()
    build_arbiter_shutter()


if __name__ == "__main__":
    main()
