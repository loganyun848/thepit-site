"""Build a data-only Blender 2.93 template. Run with Blender --background --python.

The browser replaces the mesh arrays and packed texture bytes. No startup scripts,
drivers, external libraries, or automatic Python execution are embedded.
"""
import bpy
import json
import math
import os
from mathutils import Vector

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'assets', 'avatar')
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1200
scene.render.resolution_y = 1600
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new('Studio world')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.12, .12, .12, 1)
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
mesh = bpy.data.meshes.new('AvatarMesh')
mesh.from_pydata([(-.3, 0, 0), (.3, 0, 0), (0, 0, 1.8)], [], [(0, 1, 2)])
mesh.uv_layers.new(name='UVMap')
mesh.update()
obj = bpy.data.objects.new('Avatar', mesh)
scene.collection.objects.link(obj)
mat = bpy.data.materials.new('Avatar PBR')
mat.use_nodes = True
mesh.materials.append(mat)
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = nodes.get('Principled BSDF')
for i, name in enumerate(['BaseColor', 'ORM', 'Normal']):
    img = bpy.data.images.new(name, width=4, height=4)
    color = {'BaseColor':(.7,.5,.3,1), 'ORM':(1,.6,0,1), 'Normal':(.5,.5,1,1)}[name]
    img.pixels[:] = list(color) * 16
    if name != 'BaseColor': img.colorspace_settings.name = 'Non-Color'
    img.filepath_raw = os.path.join(out, name+'.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    img.filepath = '//'+name+'.png'
    tex = nodes.new('ShaderNodeTexImage')
    tex.name = name
    tex.image = img
    tex.location = (-500, 200-i*300)
    if name == 'BaseColor': links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    elif name == 'ORM':
        split = nodes.new('ShaderNodeSeparateRGB')
        links.new(tex.outputs['Color'], split.inputs[0])
        links.new(split.outputs['G'], bsdf.inputs['Roughness'])
        links.new(split.outputs['B'], bsdf.inputs['Metallic'])
    else:
        normal = nodes.new('ShaderNodeNormalMap')
        links.new(tex.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
for name, pos, power, size in [('Key', (3,-4,4),500,4), ('Fill',(-3,-2,2.5),250,3), ('Rim',(0,3,3.5),400,3)]:
    light = bpy.data.lights.new(name, 'AREA')
    light.energy, light.size = power, size
    ob = bpy.data.objects.new(name, light)
    scene.collection.objects.link(ob)
    ob.location = pos
    ob.rotation_euler = (Vector((0,0,.9))-ob.location).to_track_quat('-Z','Y').to_euler()
plans = json.load(open(os.path.join(root,'avatar-camera-plan.json'),encoding='utf-8'))
for plan in plans:
    camera = bpy.data.cameras.new(plan['id'])
    camera.lens = 70
    camera.sensor_fit = 'VERTICAL'
    camera.sensor_height = 24
    ob = bpy.data.objects.new('Camera_'+plan['id'], camera)
    scene.collection.objects.link(ob)
    face = plan['framing'] == 'face'
    distance = (.5 if face else 2.25) / (2*math.tan(math.radians(19.46/2)))
    target = Vector((0,0,1.62 if face else .9))
    a, e = math.radians(plan['azimuth']), math.radians(plan['elevation'])
    ob.location = target + Vector((math.sin(a)*math.cos(e)*distance, -math.cos(a)*math.cos(e)*distance, math.sin(e)*distance))
    ob.rotation_euler = (target-ob.location).to_track_quat('-Z','Y').to_euler()
    if plan['id'] == 'front': scene.camera = ob
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.shading.type = 'MATERIAL'
        area.spaces.active.region_3d.view_distance = 4
        area.spaces.active.region_3d.view_location = (0,0,.9)
readme = bpy.data.texts.new('ABOUT_AVATAR.txt')
readme.write('Generated reconstruction for look development. Not a body scan.\n'
             'Static mesh; no skeletal rig, facial blendshapes or motion capture.\n'
             'Unseen surfaces are inferred. Check likeness, hands, hair and clothing.\n'
             'The GLB download preserves the source model. This scene uses packed PBR atlases.\n'
             'Camera positions assume a 1.8 metre reference height. Scale the whole scene to match the required units.\n')
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'avatar-template.blend'), compress=False)
for name in ['BaseColor','ORM','Normal']:
    os.remove(os.path.join(out,name+'.png'))
print('AVATAR_TEMPLATE_READY')
