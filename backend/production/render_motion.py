"""Blender 4.5 LTS: estimated A-pose rig -> 120-frame wave -> review package.

This is a local skeletal preview, not image-to-video synthesis. Joint positions
are geometric estimates, not recovered anatomical measurements. Human review is
required for all outputs, especially loose garments, fingers and fused limbs.
"""
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector
import numpy as np


def bounds(mesh):
    points = np.array([tuple(mesh.matrix_world @ v.co) for v in mesh.data.vertices])
    return points, points.min(axis=0), points.max(axis=0)


def import_model(job):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.import_scene.gltf(filepath=job['source'])
    if any(o.type == 'ARMATURE' for o in bpy.context.scene.objects):
        raise ValueError('Source already contains a rig. Preserve and review it instead of automatically replacing it.')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes or sum(len(o.data.vertices) for o in meshes) > 500000:
        raise ValueError('Expected a humanoid mesh below 500,000 vertices.')
    for o in list(bpy.context.scene.objects):
        if o.type not in ('MESH', 'EMPTY'):
            bpy.data.objects.remove(o, do_unlink=True)
    # Bake parent transforms before joining. Keep materials and UVs.
    for obj in meshes:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    mesh = bpy.context.object
    mesh.name = 'Production_Avatar'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mesh.rotation_euler.z = float(job['yaw'])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    points, lower, upper = bounds(mesh)
    height = upper[2] - lower[2]
    if not math.isfinite(height) or height < .001:
        raise ValueError('Source height could not be determined.')
    scale = float(job['height']) / 100 / height
    center = Vector(((lower[0]+upper[0])/2, (lower[1]+upper[1])/2, lower[2]))
    for vertex in mesh.data.vertices:
        vertex.co = (vertex.co-center)*scale
    mesh.data.update()
    points, lower, upper = bounds(mesh)
    height = float(job['height']) / 100
    width, depth = upper[0]-lower[0], upper[1]-lower[1]
    if not .30*height < width < 1.3*height or depth > .65*height:
        raise ValueError('Check upright A-pose and front direction. This model needs manual alignment.')
    return mesh, points, height


def joints(points, height):
    h = height
    positions = {
        'pelvis': ((0,0,.50*h), (0,0,.58*h), None),
        'spine': ((0,0,.58*h), (0,0,.69*h), 'pelvis'),
        'chest': ((0,0,.69*h), (0,0,.81*h), 'spine'),
        'neck': ((0,0,.81*h), (0,0,.88*h), 'chest'),
        'head': ((0,0,.88*h), (0,0,.98*h), 'neck'),
    }
    for side, sign in [('R',-1),('L',1)]:
        # Outer arm surface is sampled in body coordinates. Never claim these
        # fitted anchors are the person's true bone lengths or joint centres.
        arm_points = points[(points[:,0]*sign>.15*h) & (points[:,2]>.40*h) & (points[:,2]<.85*h)]
        if len(arm_points)<30:
            raise ValueError('Separated arms are required for automatic fitting.')
        outer = np.quantile(arm_points[:,0]*sign, .85)
        hand_cloud = arm_points[arm_points[:,0]*sign >= outer]
        hand = Vector((sign*float(np.median(hand_cloud[:,0]*sign)),float(np.median(hand_cloud[:,1])),float(np.median(hand_cloud[:,2]))))
        shoulder = Vector((sign*.115*h,0,.795*h))
        if hand.z>shoulder.z-.035*h or (hand-shoulder).length<.12*h:
            raise ValueError('Hands must be clearly separated below the shoulders in an A-pose.')
        elbow = shoulder.lerp(hand, .49)
        wrist = shoulder.lerp(hand, .92)
        positions.update({
            'clavicle.'+side: ((sign*.025*h,0,.79*h),tuple(shoulder),'chest'),
            'upper_arm.'+side: (tuple(shoulder),tuple(elbow),'clavicle.'+side),
            'forearm.'+side: (tuple(elbow),tuple(wrist),'upper_arm.'+side),
            'hand.'+side: (tuple(wrist),tuple(hand+(hand-wrist).normalized()*.025*h),'forearm.'+side),
            'thigh.'+side: ((sign*.06*h,0,.52*h),(sign*.06*h,0,.285*h),'pelvis'),
            'shin.'+side: ((sign*.06*h,0,.285*h),(sign*.06*h,0,.055*h),'thigh.'+side),
            'foot.'+side: ((sign*.06*h,0,.055*h),(sign*.06*h,-.085*h,.035*h),'shin.'+side),
        })
    return positions


def rig_model(mesh, positions):
    bpy.ops.object.select_all(action='DESELECT')
    data = bpy.data.armatures.new('Estimated_Humanoid_Rig')
    rig = bpy.data.objects.new('Motion_Rig', data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(head,tail,parent) in positions.items():
        bone=data.edit_bones.new(name)
        bone.head, bone.tail = head,tail
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh.vertex_groups.clear()
    mesh.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    unweighted = [v.index for v in mesh.data.vertices if not any(g.weight>.00001 for g in v.groups)]
    if unweighted:
        raise ValueError(f'Automatic skin binding failed for {len(unweighted)} vertices. Manual rigging required.')
    rig.show_in_front=True
    rig['fitting_method']='Estimated geometric A-pose anchors + Blender bone heat weights'
    rig['quality_status']='NEEDS_REVIEW'
    return rig


def set_direction(rig, name, head, direction):
    pb = rig.pose.bones[name]
    rest = pb.bone.matrix_local.to_quaternion()
    old_direction = pb.bone.tail_local - pb.bone.head_local
    rotation = old_direction.rotation_difference(direction.normalized()) @ rest
    pb.matrix = Matrix.Translation(head) @ rotation.to_matrix().to_4x4()
    bpy.context.view_layer.update()
    return head + direction.normalized()*pb.bone.length


def animate(rig, height):
    for pb in rig.pose.bones:
        pb.rotation_mode='QUATERNION'
    # Raise the avatar's right hand, wave three times, return to its rest pose.
    keys=[(1,0,0),(15,0,0),(32,1,-.16),(44,1,.14),(56,1,-.16),(68,1,.14),(80,1,-.16),(92,1,.14),(108,0,0),(120,0,0)]
    for frame,raised,swing in keys:
        bpy.context.scene.frame_set(frame)
        for pb in rig.pose.bones:
            pb.location=(0,0,0)
            pb.rotation_quaternion=Quaternion()
            pb.scale=(1,1,1)
        bpy.context.view_layer.update()
        if raised:
            upper=rig.pose.bones['upper_arm.R']
            shoulder=upper.bone.head_local.copy()
            elbow=set_direction(rig,'upper_arm.R',shoulder,Vector((-.95,-.15,.20)))
            wrist=set_direction(rig,'forearm.R',elbow,Vector((swing,-.12,1)))
            set_direction(rig,'hand.R',wrist,Vector((swing*1.7,-.10,1)))
        for pb in rig.pose.bones:
            pb.keyframe_insert(data_path='rotation_quaternion',frame=frame)
            pb.keyframe_insert(data_path='location',frame=frame)
    rig.animation_data.action.name='Wave_5s_24fps'


def deformation_audit(mesh):
    scene=bpy.context.scene
    def vertices(frame):
        scene.frame_set(frame)
        evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        return np.array([tuple(evaluated.matrix_world @ v.co) for v in evaluated.data.vertices])
    start=vertices(1)
    middle=vertices(56)
    end=vertices(120)
    distance=np.linalg.norm(middle-start,axis=1)
    if int((distance>.01).sum())<20 or float(distance.max())<.03:
        raise ValueError('No significant body deformation detected.')
    return {'animated_vertices':int((distance>.01).sum()),'max_displacement_m':float(distance.max()),'return_error_m':float(np.linalg.norm(end-start,axis=1).max())}


def studio(height, fixture):
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC'
    scene.render.engine='BLENDER_EEVEE_NEXT'
    scene.render.fps=24
    scene.frame_start,scene.frame_end=1,120
    scene.render.film_transparent=False
    scene.world=bpy.data.worlds.new('Studio')
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.045,.055,.075,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.003))
    floor=bpy.context.object
    floor.name='Studio_Floor'
    mat=bpy.data.materials.new('Floor_Charcoal');mat.diffuse_color=(.045,.055,.075,1);mat.use_nodes=True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.045,.055,.075,1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8
    floor.data.materials.append(mat)
    target=Vector((0,0,height*.52))
    for name,pos,power,size in [('Key',(-2,-3,4),550,4),('Fill',(3,-1,2.5),350,3),('Rim',(1,2,3.5),650,3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=pos
        light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Preview_Camera');camera=bpy.data.objects.new('Preview_Camera',data);scene.collection.objects.link(camera)
    camera.location=(0,-height*3.4,height*.64)
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=height*1.32;scene.camera=camera
    scene.view_settings.view_transform='AgX'
    scene.render.use_stamp=True
    scene.render.use_stamp_date=False;scene.render.use_stamp_time=False
    scene.render.use_stamp_render_time=False;scene.render.use_stamp_frame=False
    scene.render.use_stamp_filename=False;scene.render.use_stamp_scene=False
    scene.render.use_stamp_camera=False;scene.render.use_stamp_note=True
    scene.render.stamp_note_text='SYNTHETIC QA FIXTURE | NOT A USER AVATAR' if fixture else 'MOTION PREVIEW | PRODUCTION REVIEW REQUIRED'
    scene.render.stamp_font_size=18
    return scene


def main():
    manifest=Path(sys.argv[sys.argv.index('--')+1]).resolve()
    job=json.loads(manifest.read_text(encoding='utf-8'))
    if job.get('schema')!='thepit-motion-v1' or job.get('action')!='wave-v1' or job.get('frames')!=120 or job.get('fps')!=24:
        raise ValueError('Unsupported production job.')
    if not 80<=float(job['height'])<=250 or not math.isfinite(float(job['yaw'])):
        raise ValueError('Invalid project dimensions.')
    out=Path(job['output']).resolve()
    if out!=manifest.parent or Path(job['source']).resolve().parent!=out:
        raise ValueError('All job files must stay in the production job directory.')
    mesh,points,height=import_model(job)
    fitted=joints(points,height)
    rig=rig_model(mesh,fitted)
    animate(rig,height)
    audit=deformation_audit(mesh)
    scene=studio(height,job.get('fixture'))
    resolution=max(256,min(1080,int(job.get('resolution',720))))
    scene.render.resolution_x=resolution
    scene.render.resolution_y=resolution
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='FFMPEG'
    scene.render.ffmpeg.format='MPEG4'
    scene.render.ffmpeg.codec='H264'
    scene.render.ffmpeg.constant_rate_factor='MEDIUM'
    scene.render.ffmpeg.ffmpeg_preset='GOOD'
    scene.render.ffmpeg.audio_codec='NONE'
    scene.render.filepath=str(out/'preview.mp4')
    scene['quality_status']='NEEDS_REVIEW'
    scene['source_kind']='synthetic-test-fixture' if job.get('fixture') else 'fit-room-avatar'
    scene['job_id']=job['jobId']
    scene.frame_set(1)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'motion.blend'))
    # Export a real skinned model and joint animation for later editing.
    bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);rig.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(out/'animated.glb'),export_format='GLB',use_selection=True,export_animations=True,export_frame_range=True)
    (out/'rig-landmarks.json').write_text(json.dumps({'unit':'meters','method':'estimated-geometric-anchors','bones':fitted},indent=2),encoding='utf-8')
    (out/'render-audit.json').write_text(json.dumps({**audit,'bone_count':len(rig.data.bones),'quality':'NEEDS_REVIEW','fixture':bool(job.get('fixture'))},indent=2),encoding='utf-8')
    bpy.ops.render.render(animation=True)
    print('MOTION_RENDER_COMPLETE')


if __name__=='__main__':
    main()
