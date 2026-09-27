"""Low-detail parked cars for the ferry terminal's car park: our four real car models, each joined
into one mesh (materials kept), decimated to a few thousand triangles and set on the ground
(tyres on y 0, centred, bow +Z like the originals). The game instances them into the bays.
Run:
  Blender --background --factory-startup --python tools/ferry/parked_cars.py
Output: public/ferry/parked_cars.glb with one root node per model (ParkedAster, ParkedJeep,
ParkedWagon, ParkedPickup).
"""
import math
from pathlib import Path
import bpy, bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
MODELS = (('ParkedAster', 'aster_rs', 5000), ('ParkedJeep', 'black_jeep', 5500), ('ParkedWagon', 'support_wagon', 4500), ('ParkedPickup', 'support_pickup', 4500))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

roots = []
for i, (name, src, target) in enumerate(MODELS):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / f'public/rally/{src}.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    new_names = [o.name for o in new]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # Bake every transform into the vertices, decimate each part on its own (big parts hard, small
    # parts barely, so trim and lamps survive), then join into one mesh.
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    share = target / max(1, tris)
    for o in meshes:
        # Weld split vertices first: open seams are what collapse into spikes.
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
        bm.to_mesh(o.data); bm.free()
        t = sum(len(p.vertices) - 2 for p in o.data.polygons)
        keep = max(share, min(1.0, 300 / max(1, t)))
        if keep < 0.98:
            mod = o.modifiers.new('Decimate', 'DECIMATE'); mod.ratio = keep; mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    car = bpy.context.view_layer.objects.active
    for n in new_names:
        o = bpy.data.objects.get(n)
        if o is not None and o != car: bpy.data.objects.remove(o)
    # Centred in plan; the originals already stand with their tyres on z 0 (Blender is Z up here;
    # the export turns it back to glTF Y up).
    xs = [v.co.x for v in car.data.vertices]; ys = [v.co.y for v in car.data.vertices]; zs = [v.co.z for v in car.data.vertices]
    shift = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0.0))
    for v in car.data.vertices: v.co -= shift
    for p in car.data.polygons: p.use_smooth = True
    car.name = name
    car.location = (i * 6.0, 0, 0)          # side by side in the file; the game ignores this offset
    after = sum(len(p.vertices) - 2 for p in car.data.polygons)
    print(f'PARKED {name} {src}: {tris} -> {after} triangles, {len(car.data.materials)} materials, size {max(xs) - min(xs):.2f} x {max(ys) - min(ys):.2f} x {max(zs) - min(zs):.2f}')
    roots.append(car)

bpy.ops.object.select_all(action='DESELECT')
for o in roots: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/ferry/parked_cars.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
print('PARKED written', ROOT / 'public/ferry/parked_cars.glb')
