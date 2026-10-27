"""Trusted Blender compiler for the data-only scene language. No model code is run."""
import bpy
import json
import math
import random
import sys
import bisect
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from schema import validate
import advanced_blender as advanced

def emit(**kw):
    print('ORBIT_EVENT ' + json.dumps(kw), flush=True)

def color(hexcode):
    rgb = [int(hexcode[i:i+2], 16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb)

def material(name, hexcode, metallic=0, roughness=.4, emission=0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = color(hexcode)
    p.inputs['Base Color'].default_value = (*rgb,1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if emission:
        p.inputs['Emission Color'].default_value = (*rgb,1)
        p.inputs['Emission Strength'].default_value = emission
    m.diffuse_color = (*rgb,1)
    return m

def finish(o, name, mat, bevel=0, smooth=False):
    o.name = name
    if mat: o.data.materials.append(mat)
    if bevel:
        mod = o.modifiers.new('Manufactured edges', 'BEVEL'); mod.width = bevel; mod.segments = 3
    if smooth and o.type == 'MESH':
        for p in o.data.polygons: p.use_smooth = True
    return o

def cube(name, size, mat, pos=(0,0,0), bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object; o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, name, mat, min(bevel, min(size)*.22))

def earth_material():
    m = material('Procedural oceans and land', '#2879b5', .15, .55)
    n = m.node_tree.nodes; links = m.node_tree.links
    p = next(x for x in n if x.type == 'BSDF_PRINCIPLED')
    tex = n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=3.4
    tex.inputs['Detail'].default_value=4.5; tex.inputs['Roughness'].default_value=.7
    ramp=n.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation='EASE'
    entries=[(.30,'#063b76'),(.47,'#147cc2'),(.49,'#428357'),(.62,'#78986c'),(.78,'#e5edf0')]
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for i,(pos,col) in enumerate(entries):
        e=ramp.color_ramp.elements[0] if i==0 else ramp.color_ramp.elements.new(pos)
        e.position=pos; e.color=(*color(col),1)
    links.new(tex.outputs['Fac'],ramp.inputs[0]); links.new(ramp.outputs['Color'],p.inputs['Base Color'])
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.12; bump.inputs['Distance'].default_value=.05
    links.new(tex.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs[0],p.inputs['Normal'])
    return m

def part(p, materials):
    """Return a single parent with any generated detail parented beneath it."""
    kind=p['shape']; mat=materials[p['material']]; name=p['id']
    if kind in ('mesh','icosphere','plane','curve','ribbon','lathe','extrude','terrain','text','library'):
        o=advanced.geometry(p,materials)
        if kind in ('mesh','lathe','extrude') and p.get('bevel',0)>0:
            mod=o.modifiers.new('Edge bevel','BEVEL');mod.width=p['bevel'];mod.segments=3
    elif kind in ('box','panel'):
        o=cube(name,p['size'],mat,bevel=p['bevel'])
        if kind=='panel':
            frame_mat=material(name+' edge aluminium','#a6b5c5',.85,.27)
            cell_mat=material(name+' photovoltaic cells','#133b78',.5,.25)
            w,h,d=p['size']; margin=min(w,h)*.035
            for x,y,sx,sy in [(0,-h/2,w,margin),(0,h/2,w,margin),(-w/2,0,margin,h),(w/2,0,margin,h)]:
                q=cube(name+' frame',(sx,sy,d*1.6),frame_mat,(x,y,d*.15),.006);q.parent=o
            rows,cols=p['rows'],p['columns']
            cw=(w-2*margin)/cols; ch=(h-2*margin)/rows
            for r in range(rows):
                for c in range(cols):
                    x=-w/2+margin+cw*(c+.5);y=-h/2+margin+ch*(r+.5)
                    q=cube(name+f' cell {r:02}-{c:02}',(cw*.92,ch*.93,d*.10),cell_mat,(x,y,d*.56),.003);q.parent=o
    elif kind in ('sphere','planet'):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=32,radius=1)
        o=bpy.context.object;o.scale=[v/2 for v in p['size']]
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        earth_hint=kind=='planet' or (kind=='sphere' and 'earth' in p['material'].lower())
        finish(o,name,earth_material() if earth_hint else mat,smooth=True)
    elif kind in ('cylinder','cone','rod'):
        depth=p.get('depth',1)
        if kind=='rod': depth=(Vector(p['end'])-Vector(p['start'])).length
        if kind=='cone':
            bpy.ops.mesh.primitive_cone_add(vertices=48,radius1=p['radius'],radius2=p['radius_top'],depth=depth)
        else: bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=p['radius'],depth=depth)
        o=finish(bpy.context.object,name,mat,min(p['bevel'],p['radius']*.2),True)
        if kind=='rod':
            a,b=Vector(p['start']),Vector(p['end']);o.location=(a+b)/2
            o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    elif kind=='torus':
        bpy.ops.mesh.primitive_torus_add(major_radius=p['radius'],minor_radius=p['thickness'],major_segments=64,minor_segments=16)
        o=finish(bpy.context.object,name,mat,smooth=True)
    elif kind=='dish':
        verts=[(0,0,0)];faces=[];rings=16;segments=64
        for j in range(1,rings+1):
            r=p['radius']*j/rings
            for i in range(segments):
                angle=2*math.pi*i/segments;verts.append((r*math.cos(angle),r*math.sin(angle),p['depth']*(r/p['radius'])**2))
        for i in range(segments):faces.append((0,1+i,1+(i+1)%segments))
        for j in range(rings-1):
            a=1+j*segments;b=a+segments
            for i in range(segments):faces.append((a+i,b+i,b+(i+1)%segments,a+(i+1)%segments))
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
        o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);finish(o,name,mat,smooth=True)
        solid=o.modifiers.new('Reflector thickness','SOLIDIFY');solid.thickness=.015
    else: raise ValueError(kind)
    if kind!='rod':
        o.location=p['position'];o.rotation_euler=[math.radians(v) for v in p['rotation']]
    o['orbit_shape']=kind
    o['orbit_part_id']=p['id']
    return o

def empty(name):
    o=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(o);return o

def make_asset(asset, materials, duration=None):
    parent=empty(asset['id'])
    parent['orbit_asset_id']=asset['id']
    parts={p['id']:part(p,materials) for p in asset['parts']}
    for p in asset['parts']:
        obj=parts[p['id']]
        if p.get('pivot'):advanced.pivot(obj,p['pivot'])
        obj.parent=parts[p['parent']] if p.get('parent') else parent
        advanced.modifiers(obj,p,parts)
        if p.get('animation') or p.get('motion'):advanced.animate(obj,p,duration or bpy.context.scene.frame_end/bpy.context.scene.render.fps)
    if not asset.get('allow_disconnected',False):connect_assembly(parent)
    return parent

def connect_assembly(root):
    """Bridge small gaps between multi-part assemblies; isolated primitives stay free.

    Intentional exploded views opt out with allow_disconnected. Connections are
    compiler-generated supports, just as panel grids are compiler-generated detail.
    """
    bpy.context.view_layer.update()
    parts=[p for p in root.children if p.type=='MESH'];boxes=[]
    for p in parts:
        pts=[p.matrix_world@Vector(v) for v in p.bound_box]
        boxes.append((Vector([min(v[i] for v in pts) for i in range(3)]),Vector([max(v[i] for v in pts) for i in range(3)])))
    remaining=set(range(len(parts)));groups=[]
    while remaining:
        group={remaining.pop()};pending=list(group)
        while pending:
            i=pending.pop();a,b=boxes[i]
            for j in list(remaining):
                c,d=boxes[j]
                if all(a[k]<=d[k]+.025 and c[k]<=b[k]+.025 for k in range(3)):
                    remaining.remove(j);group.add(j);pending.append(j)
        groups.append(group)
    if len(groups)<2:return
    _,radius=bounds(parts);primary=max(groups,key=len);others=[g for g in groups if g is not primary]
    added=0
    for group in sorted(others,key=len,reverse=True):
        if len(primary)<2 or len(group)<2 or added>=4:continue
        candidates=[]
        for i in primary:
            a,b=boxes[i]
            for j in group:
                c,d=boxes[j];pa=[];pb=[]
                for k in range(3):
                    if b[k]<c[k]:pa.append(b[k]);pb.append(c[k])
                    elif d[k]<a[k]:pa.append(a[k]);pb.append(d[k])
                    else:
                        mid=(max(a[k],c[k])+min(b[k],d[k]))/2;pa.append(mid);pb.append(mid)
                va,vb=Vector(pa),Vector(pb);candidates.append(((vb-va).length,i,j,va,vb))
        distance,i,j,a,b=min(candidates,key=lambda x:x[0])
        if not .025<distance<radius*.30:continue
        source=parts[i];mat=source.data.materials[0] if source.data.materials else None
        thickness=max(.012,min((boxes[i][1]-boxes[i][0]))*.22)
        bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=thickness,depth=distance+.012,location=(a+b)/2)
        o=finish(bpy.context.object,'Contact support — '+source.name+' to '+parts[j].name,mat,.005,True)
        o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.parent=root
        o['orbit_auto_support']=True;o['orbit_support_from']=source.name;o['orbit_support_to']=parts[j].name
        primary|=group;added+=1
        emit(automatic_support={'from':source.name,'to':parts[j].name,'gap':round(distance,4)})

def point_at(obj, point): obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler('XYZ',obj.rotation_euler)

def lights(theme):
    settings=[('Key',(5,-8,10),1800,7,(1,.88,.72)),('Fill',(-7,-4,5),1300,8,(.63,.79,1)),('Rim',(4,6,8),2400,6,(.62,.78,1))]
    for name,pos,power,size,tint in settings:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=tint
        o=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(o);o.location=pos;point_at(o,(0,0,0))
    if theme=='space':
        data=bpy.data.lights.new('Distant sunlight','SUN');data.energy=2.3;data.angle=.08
        o=bpy.data.objects.new('Distant sunlight',data);bpy.context.scene.collection.objects.link(o);o.rotation_euler=(.4,-.5,-.5)

def setup(width,height,samples,theme,gpu=False,engine='cycles',rig=True):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene;scene.render.engine='CYCLES'
    # Cycles CPU is stable in headless mode; Metal selected when the device is available.
    scene.cycles.samples=samples;scene.cycles.use_denoising=True
    scene.render.use_persistent_data=True
    try:
        if not gpu or engine!='cycles': raise RuntimeError('Cycles GPU not requested')
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='METAL';prefs.get_devices()
        devices=[d for d in prefs.devices if d.type=='METAL']
        if devices:
            for d in prefs.devices:d.use=d.type=='METAL'
            scene.cycles.device='GPU'
    except Exception: pass
    if engine=='eevee':
        for candidate in ('BLENDER_EEVEE','BLENDER_EEVEE_NEXT'):
            try:scene.render.engine=candidate;break
            except TypeError:continue
        else:raise RuntimeError('No Eevee renderer available')
        if hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=samples
        if hasattr(scene.eevee,'use_raytracing'):scene.eevee.use_raytracing=True
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    scene.render.film_transparent=False;scene.render.fps=24
    scene.world.use_nodes=True
    bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
    bg.inputs[0].default_value=(*color('#030813' if theme=='space' else '#a8b4c3'),1)
    bg.inputs[1].default_value=.22 if theme=='space' else .45
    scene.view_settings.view_transform='AgX'
    if rig:lights(theme)
    return scene

def camera(name,position,target,lens=45):
    data=bpy.data.cameras.new(name);data.lens=lens;data.clip_end=1000
    o=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(o);o.location=position;point_at(o,target);return o

def descendants(root):
    return [root]+[v for child in root.children for v in descendants(child)]

def bounds(objects):
    deps=bpy.context.evaluated_depsgraph_get()
    pts=[o.matrix_world@Vector(c) for o in objects if o.type in ('MESH','CURVE','FONT') and not o.hide_render for c in o.evaluated_get(deps).bound_box]
    if not pts:return Vector((0,0,0)),1
    lo=Vector([min(v[i] for v in pts) for i in range(3)]);hi=Vector([max(v[i] for v in pts) for i in range(3)])
    return (lo+hi)/2,max((hi-lo).length/2,.1)

def stars():
    rng=random.Random(148);verts=[];faces=[]
    for _ in range(600):
        v=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(-.3,1))).normalized()*80
        r=rng.uniform(.014,.05);base=len(verts)
        verts.extend([tuple(v+Vector((-r,0,0))),tuple(v+Vector((r,0,0))),tuple(v+Vector((0,-r,0))),tuple(v+Vector((0,r,0))),tuple(v+Vector((0,0,-r))),tuple(v+Vector((0,0,r)))])
        faces.extend(tuple(base+k for k in f) for f in [(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)])
    me=bpy.data.meshes.new('Star field');me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new('Star field',me);bpy.context.scene.collection.objects.link(o);finish(o,'Star field',material('Starlight','#d5e9ff',emission=3))

def build(s, duration):
    scene=bpy.context.scene;fps=scene.render.fps;scene.frame_start=1;scene.frame_end=round(duration*fps)
    v2=s.get('version')==2
    materials={m['id']:advanced.material(m) if v2 else material(m['id'],m['color'],m['metallic'],m['roughness'],m['emission']) for m in s['materials']}
    path_samplers=advanced.paths(s)
    asset_by_id={a['id']:a for a in s['assets']}; roots=[]
    for i in s['instances']:
        root=make_asset(asset_by_id[i['asset']],materials,duration);root.name=i['id'];root['orbit_instance_id']=i['id'];roots.append(root)
        root.location=i['position'];root.rotation_euler=[math.radians(v) for v in i['rotation']];root.scale=i['scale']
        if v2:advanced.animate(root,i,duration,path_samplers)
        for frame in ([] if v2 else i.get('animation',[])):
            f=min(round(frame['time']*fps)+1,scene.frame_end)
            for key,prop in [('position','location'),('rotation','rotation_euler'),('scale','scale')]:
                if key in frame:
                    setattr(root,prop,[math.radians(v) for v in frame[key]] if key=='rotation' else frame[key]);root.keyframe_insert(data_path=prop,frame=f)
    by_id={r['orbit_instance_id']:r for r in roots}
    for instance in s['instances']:
        if instance.get('parent'):by_id[instance['id']].parent=by_id[instance['parent']]
    if v2:
        advanced.environment(s['environment'],s.get('render',{}));advanced.lights(s.get('lights',[]),duration)
        roots+=advanced.scatter(s.get('scatter',[]),lambda a,m:make_asset(a,m,duration),asset_by_id,materials,by_id)
        bpy.context.view_layer.update();advanced.geometry_report()
    theme=s['environment'].get('theme','studio')
    if s['environment'].get('ground',theme!='space'):
        size=s['environment'].get('ground_size',200);ground_color=s['environment'].get('ground_color','#576574' if theme=='space' else '#b5beca')
        cube('Ground',(size,size,.1),material('Ground',ground_color),(0,0,-.12),0)
    if s['environment'].get('stars',theme=='space'):stars()
    cameras=[];by_id={r['orbit_instance_id']:r for r in roots}
    terrain_bvhs=[advanced.surface_bvh(o) for r in roots for o in descendants(r) if o.get('orbit_shape')=='terrain'] if v2 else []
    def pose(settings,fraction=0):
        if 'focus' not in settings:
            pos=Vector(path_samplers[settings['path']].at(settings.get('path_start',0)+(settings.get('path_end',1)-settings.get('path_start',0))*fraction)[0]) if settings.get('path') else Vector(settings['position'])
            return pos,Vector(settings['target']),settings['lens']
        iid,_,pid=settings['focus'].partition(':');r=by_id[iid]
        if pid:r=next(c for c in descendants(r) if c.get('orbit_part_id')==pid)
        center,radius=bounds(descendants(r));lens=settings['lens']
        center+=Vector(settings.get('target_offset',[0,0,0]))
        if settings.get('path'):
            pos,_=path_samplers[settings['path']].at(settings.get('path_start',0)+(settings.get('path_end',1)-settings.get('path_start',0))*fraction)
            return Vector(pos),center,lens
        if 'position' in settings:return Vector(settings['position']),center,lens
        sensor_y=36*scene.render.resolution_y/scene.render.resolution_x
        fov=2*math.atan(min(36,sensor_y)/(2*lens))
        distance=radius/max(math.sin(fov/2),.01)*settings['margin']
        az=math.radians(settings['azimuth']);elev=math.radians(settings['elevation'])
        direction=Vector((math.cos(az)*math.cos(elev),math.sin(az)*math.cos(elev),math.sin(elev)))
        if pid and r.get('orbit_shape') in ('dish','panel') and not settings.get('allow_backface',False):
            normal=r.matrix_world.to_quaternion()@Vector((0,0,1));dot=direction.dot(normal)
            if dot<.4:direction=(direction-normal*dot+normal*.65).normalized()
        offset=direction*distance
        return center+offset,center,lens
    for index,shot in enumerate(s['shots']):
        start=min(round(shot['start']*fps)+1,scene.frame_end);end=min(round(shot['end']*fps),scene.frame_end)
        scene.frame_set(start);bpy.context.view_layer.update()
        a,b=dict(shot['camera']),dict(shot['camera_end'])
        if not v2 and index==0 and theme=='space' and a.get('focus')==roots[0]['orbit_instance_id'] and a.get('focus')==b.get('focus') and a.get('include_context',True):
            center,radius=bounds(descendants(roots[0]));context=[]
            for other in roots[1:]:
                bc,br=bounds(descendants(other));distance=(bc-center).length
                if br>radius*1.25 and distance>radius*2:context.append((distance,other,bc))
            if context:
                _,other,bc=min(context,key=lambda v:v[0]);delta=center-bc
                # A three-quarter offset reveals depth instead of flattening arrays.
                angle=math.degrees(math.atan2(delta.y,delta.x))+30;mean=(a['azimuth']+b['azimuth'])/2
                shift=(angle-mean+180)%360-180
                elevation=max(-15,min(15,math.degrees(math.atan2(delta.z,math.hypot(delta.x,delta.y)))-12))
                a['azimuth']+=shift;b['azimuth']+=shift;a['elevation']=elevation;b['elevation']=elevation+3
                emit(context_composition={'subject':roots[0]['orbit_instance_id'],'background':other['orbit_instance_id'],'azimuth_start':a['azimuth'],'azimuth_end':b['azimuth']})
        pos,target,lens=pose(a)
        c=camera(f'Shot {index+1:02} - '+shot['label'],pos,target,lens);cameras.append((start,end,c))
        c.data.type=a.get('projection','PERSP')
        for frame in range(start,end+1):
            u=(frame-start)/max(end-start,1);time=shot['start']+(shot['end']-shot['start'])*u
            ka,kb=a,b
            if shot.get('keyframes'):
                keys=shot['keyframes'];segment=max(0,min(len(keys)-2,bisect.bisect_right([k['time'] for k in keys],time)-1));aa,bb=keys[segment:segment+2]
                ka,kb=aa['camera'],bb['camera'];u=(time-aa['time'])/max(bb['time']-aa['time'],1e-8)
            if shot.get('ease','SMOOTH')=='SMOOTH':u=u*u*(3-2*u)
            scene.frame_set(frame);bpy.context.view_layer.update()
            if ka.get('focus') and ka.get('focus')==kb.get('focus') and not any('position' in k or 'path' in k for k in (ka,kb)):
                settings=dict(ka)
                for key in ('azimuth','elevation','margin','lens'):settings[key]=ka[key]*(1-u)+kb[key]*u
                settings['target_offset']=advanced.lerp(ka.get('target_offset',[0,0,0]),kb.get('target_offset',[0,0,0]),u)
                pos,target,lens=pose(settings,u)
            elif ka.get('path') and ka.get('path')==kb.get('path'):
                settings=dict(ka);settings['lens']=ka['lens']*(1-u)+kb['lens']*u;pos,target,lens=pose(settings,u)
            else:
                ap,at,al=pose(ka);bp,bt,bl=pose(kb,1);pos=ap.lerp(bp,u);target=at.lerp(bt,u);lens=al*(1-u)+bl*u
            if v2 and ka.get('avoid_terrain',True):pos=advanced.safe_camera(pos,target,terrain_bvhs)
            c.location=pos;point_at(c,target);c.data.lens=lens
            if c.data.type=='ORTHO':
                c.data.ortho_scale=ka.get('ortho_scale',20)*(1-u)+kb.get('ortho_scale',20)*u
                c.data.keyframe_insert(data_path='ortho_scale',frame=frame)
            dof=ka.get('dof')
            if dof:
                c.data.dof.use_dof=True;c.data.dof.aperture_fstop=dof.get('fstop',4);c.data.dof.focus_distance=dof.get('distance',(target-pos).length)
                c.data.dof.keyframe_insert(data_path='focus_distance',frame=frame);c.data.dof.keyframe_insert(data_path='aperture_fstop',frame=frame)
            c.keyframe_insert(data_path='location',frame=frame);c.keyframe_insert(data_path='rotation_euler',frame=frame);c.data.keyframe_insert(data_path='lens',frame=frame)
        advanced.interpolation(c,'LINEAR');advanced.interpolation(c.data,'LINEAR')
        marker=scene.timeline_markers.new(shot['label'],frame=start);marker.camera=c
    scene.camera=cameras[0][2];scene.frame_set(1);bpy.context.view_layer.update()
    return roots,cameras

def render(path,frame,cameras=None):
    scene=bpy.context.scene;scene.frame_set(frame)
    if cameras:
        scene.camera=next((c for start,end,c in cameras if start<=frame<=end),cameras[-1][2])
    scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)

def checks(roots,cameras,frames):
    from bpy_extras.object_utils import world_to_camera_view
    scene=bpy.context.scene;results=[]
    for frame in frames:
        scene.frame_set(frame);cam=next((c for start,end,c in cameras if start<=frame<=end),cameras[-1][2]);bpy.context.view_layer.update()
        for root in [r for r in roots if not r.name.startswith('scatter_')][:64]:
            center,radius=bounds(descendants(root));v=world_to_camera_view(scene,cam,center)
            deps=bpy.context.evaluated_depsgraph_get()
            points=[o.matrix_world@Vector(c) for o in descendants(root) if o.type in ('MESH','CURVE','FONT') and not o.hide_render for c in o.evaluated_get(deps).bound_box]
            projected=[world_to_camera_view(scene,cam,p) for p in points]
            front=bool(projected) and all(p.z>0 for p in projected)
            visible=[p for p in projected if p.z>0]
            box=[[min(p[i] for p in visible),max(p[i] for p in visible)] for i in range(2)] if visible else None
            overlap=0
            if front and box:
                area=(box[0][1]-box[0][0])*(box[1][1]-box[1][0])
                overlap=max(0,min(1,box[0][1])-max(0,box[0][0]))*max(0,min(1,box[1][1])-max(0,box[1][0]))/max(area,1e-12)
            results.append({'frame':frame,'instance':root.name,'center_in_frame':bool(v.z>0 and 0<=v.x<=1 and 0<=v.y<=1),'center_uv':[round(v.x,3),round(v.y,3)],'bounding_radius':round(radius,3),
                'bounds_fully_in_frame':front and all(0<=p.x<=1 and 0<=p.y<=1 for p in projected),
                'bounds_screen_overlap':round(overlap,3),'projected_bounds':[[round(x,3) for x in axis] for axis in box] if box else None,
                'world_bounds':[[round(min(p[i] for p in points),4),round(max(p[i] for p in points),4)] for i in range(3)] if points else None,
                'caveat':'Projected bounding boxes only; no occlusion or perceptual-quality guarantee.'})
    return results

def asset_checks(roots):
    """Conservative warnings, not proof of contact/visibility or a quality score."""
    records=[];seen=set();bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
    for root in roots[:32]:
        aid=root.get('orbit_asset_id',root.name)
        if aid in seen:continue
        seen.add(aid)
        parts=[p for p in descendants(root) if p.type=='MESH' and not p.hide_render];enclosed=[];boxes=[]
        for p in parts:
            pts=[p.matrix_world@Vector(v) for v in p.bound_box]
            boxes.append(([min(v[i] for v in pts) for i in range(3)],[max(v[i] for v in pts) for i in range(3)]))
            for outer in parts:
                if p==outer or outer.get('orbit_shape') not in ('box','sphere'):continue
                if outer.get('orbit_shape')=='sphere' and p.get('orbit_shape') not in ('sphere','planet'):continue
                inv=outer.matrix_world.inverted();local=[inv@v for v in pts]
                lo=[min(v[i] for v in outer.bound_box) for i in range(3)];hi=[max(v[i] for v in outer.bound_box) for i in range(3)]
                if all(lo[i]-.0001<=v[i]<=hi[i]+.0001 for v in local for i in range(3)):
                    enclosed.append({'inner':p.name,'opaque_outer':outer.name})
        remaining=set(range(len(parts)));groups=[]
        while remaining:
            group={remaining.pop()};pending=list(group)
            while pending:
                i=pending.pop();a,b=boxes[i]
                for j in list(remaining):
                    c,d=boxes[j]
                    if all(a[k]<=d[k]+.025 and c[k]<=b[k]+.025 for k in range(3)):
                        remaining.remove(j);group.add(j);pending.append(j)
            groups.append([parts[i].name for i in sorted(group)])
        records.append({'instance':root.name,'potentially_hidden_inside_opaque_parts':enclosed,'disconnected_AABB_groups':groups,'caveat':'Bounding boxes only: overlap does not prove surface contact; intentional separate details may be valid. Image inspection is required.'})
    return records

def main():
    args=sys.argv[sys.argv.index('--')+1:];mode,scene_path,out=args[:3];out=Path(out);out.mkdir(parents=True,exist_ok=True)
    config=json.loads((Path(scene_path).parent/'settings.json').read_text());duration=config['duration']
    s=validate(json.loads(Path(scene_path).read_text()),duration);theme=s['environment'].get('theme','studio')
    if mode=='assets':
        records=[]
        for a in s['assets']:
            scene=setup(480,480,24,'studio');scene.render.fps=config.get('fps',24)
            mats={m['id']:advanced.material(m) if s.get('version')==2 else material(m['id'],m['color'],m['metallic'],m['roughness'],m['emission']) for m in s['materials']}
            root=make_asset(a,mats,duration);scene.frame_set(1);bpy.context.view_layer.update();center,radius=bounds(descendants(root))
            c=camera('Asset camera',center+Vector((1.1,-1.7,.9)).normalized()*radius*3.6,center,45);scene.camera=c
            scene.render.filepath=str(out/(a['id']+'.png'));bpy.ops.render.render(write_still=True)
            records.append({'id':a['id'],'name':a['name'],'parts':len(a['parts']),'file':a['id']+'.png'})
            emit(asset=a['id'],name=a['name'],completed=len(records),total=len(s['assets']))
        (out/'assets.json').write_text(json.dumps(records));return
    final=mode=='final';width=config['width'] if final else 768;height=round(width*config.get('height',config['width']*9/16)/config['width'])
    preview_engine=config.get('engine','eevee') if s.get('version')==2 else 'cycles'
    scene=setup(width,height,config['samples'] if final else 24,theme,gpu=final and config.get('cycles_device')=='GPU',engine=config.get('engine','eevee') if final else preview_engine,rig=not bool(s.get('lights')));scene.render.fps=config.get('fps',24)
    roots,cameras=build(s,duration)
    if config.get('audio_tracks'):
        editor=scene.sequence_editor_create();strips=getattr(editor,'strips',None)
        if strips is None:strips=editor.sequences
        for index,track in enumerate(config['audio_tracks']):
            strip=strips.new_sound(track['role'],track['path'],channel=index+1,frame_start=1);strip.volume=track['volume']
        scene.render.use_sequencer=False
    frames=[1,max(1,round(scene.frame_end*.25)),max(1,round(scene.frame_end*.5)),max(1,round(scene.frame_end*.75)),scene.frame_end]
    if mode=='inspect':
        report={'checks':checks(roots,cameras,frames),'asset_checks':asset_checks(roots),'geometry':advanced.geometry_report(),'automatic_supports':[{'from':o['orbit_support_from'],'to':o['orbit_support_to']} for o in bpy.data.objects if o.get('orbit_auto_support')]}
        (out/'inspection.json').write_text(json.dumps(report,indent=2));emit(done=True,**report);return
    if final:
        scene.frame_set(1)
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type=='VIEW_3D':
                    area.spaces.active.region_3d.view_perspective='CAMERA'
                    area.spaces.active.shading.type='MATERIAL'
        bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(out/'project.blend'))
        advanced.export_glb(out/'scene.glb')
        dest=out/'frames';dest.mkdir(exist_ok=True)
        for f in range(1,scene.frame_end+1):
            target=dest/f'{f:05}.png'
            if not target.exists():render(target,f,cameras)
            emit(frame=f,total=scene.frame_end,file=f'frames/{f:05}.png')
        emit(done=True,device='GPU' if scene.render.engine!='CYCLES' else scene.cycles.device,engine=scene.render.engine)
    else:
        for index,f in enumerate(frames):
            render(out/f'preview-{index}.png',f,cameras)
            emit(preview=index,frame=f,total=len(frames),file=f'preview-{index}.png')
        inventory={'objects':len(bpy.data.objects),'meshes':len(bpy.data.meshes),'frames':scene.frame_end,'engine':scene.render.engine,'device':'GPU' if scene.render.engine!='CYCLES' else scene.cycles.device,'checks':checks(roots,cameras,frames),'asset_checks':asset_checks(roots),'automatic_supports':[{'from':o['orbit_support_from'],'to':o['orbit_support_to']} for o in bpy.data.objects if o.get('orbit_auto_support')]}
        (out/'inspection.json').write_text(json.dumps(inventory,indent=2))
        scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(out/'preview.blend'))
        emit(done=True,**inventory)

if __name__=='__main__':
    try: main()
    except Exception as e:
        emit(error=str(e));raise
