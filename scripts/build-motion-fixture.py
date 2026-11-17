"""Build a connected synthetic A-pose mannequin for skeletal QA, never a person."""
import bpy
from mathutils import Vector
from pathlib import Path

bpy.ops.wm.read_factory_settings(use_empty=True)
def ball(center,radii):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=center)
    obj=bpy.context.object;obj.scale=radii
    return obj
def limb(a,b,radius):
    start,end=Vector(a),Vector(b)
    obj=ball((start+end)/2,(radius,radius,(end-start).length/2+radius*.4))
    obj.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler()
ball((0,0,1.18),(.22,.13,.31))
ball((0,0,.94),(.19,.12,.17))
limb((0,0,1.42),(0,0,1.58),.065)
ball((0,0,1.66),(.105,.10,.14))
ball((0,-.105,1.66),(.025,.03,.035))
for sign in [-1,1]:
    limb((sign*.18,0,1.43),(sign*.36,0,1.20),.07)
    limb((sign*.36,0,1.20),(sign*.52,0,1.02),.052)
    ball((sign*.54,0,.99),(.055,.035,.075))
    limb((sign*.10,0,.95),(sign*.10,0,.53),.09)
    limb((sign*.10,0,.53),(sign*.10,0,.10),.07)
    ball((sign*.10,-.055,.065),(.075,.14,.065))
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active=bpy.context.selected_objects[0]
bpy.ops.object.join();obj=bpy.context.object
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
remesh=obj.modifiers.new('Connected surface','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.018
bpy.ops.object.modifier_apply(modifier=remesh.name)
smooth=obj.modifiers.new('Surface smoothing','SMOOTH');smooth.factor=.5;smooth.iterations=3
bpy.ops.object.modifier_apply(modifier=smooth.name)
for face in obj.data.polygons:face.use_smooth=True
obj.name='SYNTHETIC_MOTION_QA_MANNEQUIN'
mat=bpy.data.materials.new('QA_blue');mat.use_nodes=True
mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.08,.25,.42,1)
mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.58
obj.data.materials.append(mat)
out=Path(__file__).resolve().parents[1]/'tests'/'motion-fixture.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB')
print('SYNTHETIC_MOTION_FIXTURE_WRITTEN')
