"""Trusted implementation of the expanded scene tools; imported only inside Blender."""
import bpy
import bisect
import math
import random
from mathutils import Vector,Matrix,Euler,Quaternion
from mathutils.bvhtree import BVHTree
from scene_math import spline,PathSampler,ribbon_mesh,lathe_mesh,terrain_height,lerp,smooth

def rgb(value):
    values=[int(value[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)

def material(spec):
    m=bpy.data.materials.new(spec['id']);m.use_nodes=True;n=m.node_tree.nodes;links=m.node_tree.links
    p=n.get('Principled BSDF');color=rgb(spec['color'])
    for key,socket,default in [('metallic','Metallic',0),('roughness','Roughness',.4),('alpha','Alpha',1),('transmission','Transmission Weight',0),('ior','IOR',1.45),('coat','Coat Weight',0),('coat_roughness','Coat Roughness',.1),('anisotropic','Anisotropic',0)]:
        p.inputs[socket].default_value=spec.get(key,default)
    p.inputs['Base Color'].default_value=(*color,1);m.diffuse_color=(*color,spec.get('alpha',1))
    p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=spec.get('emission',0)
    texture=spec.get('texture')
    if texture and texture['type']=='image':
        from asset_library import asset_path
        tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(asset_path(texture['image'],'image')),check_existing=True)
        coords=n.new('ShaderNodeTexCoord');tex.projection='FLAT' if texture.get('projection')=='UV' else 'BOX';tex.projection_blend=.2
        links.new(coords.outputs['UV' if tex.projection=='FLAT' else 'Generated'],tex.inputs['Vector'])
        links.new(tex.outputs['Color'],p.inputs['Base Color'])
    elif texture:
        typ=texture['type'];coords=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeMapping')
        links.new(coords.outputs['Generated'],mapping.inputs['Vector']);mapping.inputs['Scale'].default_value=(texture.get('scale',4),)*3
        node_type={'noise':'Noise','marble':'Wave','wood':'Wave','voronoi':'Voronoi','wave':'Wave','checker':'Checker','gradient':'Gradient','terrain':'Noise'}[typ]
        tex=n.new('ShaderNodeTex'+node_type);links.new(mapping.outputs['Vector'],tex.inputs['Vector'])
        if 'Scale' in tex.inputs:tex.inputs['Scale'].default_value=1
        if 'Detail' in tex.inputs:tex.inputs['Detail'].default_value=texture.get('detail',3)
        if 'Roughness' in tex.inputs:tex.inputs['Roughness'].default_value=texture.get('roughness',.6)
        if 'Distortion' in tex.inputs:tex.inputs['Distortion'].default_value=texture.get('distortion',0)
        if typ=='wood':tex.wave_type='RINGS';tex.rings_direction='Z';tex.inputs['Distortion'].default_value=texture.get('distortion',4)
        if typ=='wave':tex.wave_type='BANDS';tex.bands_direction='X'
        if typ=='marble':tex.wave_type='BANDS';tex.bands_direction='DIAGONAL';tex.inputs['Distortion'].default_value=texture.get('distortion',6)
        factor=tex.outputs.get('Fac') or tex.outputs.get('Distance') or tex.outputs[0]
        if typ=='terrain':
            geom=n.new('ShaderNodeNewGeometry');separate=n.new('ShaderNodeSeparateXYZ');links.new(geom.outputs['Position'],separate.inputs[0])
            remap=n.new('ShaderNodeMapRange');remap.inputs['From Min'].default_value=texture.get('height_min',0);remap.inputs['From Max'].default_value=texture.get('height_max',20)
            links.new(separate.outputs['Z'],remap.inputs['Value']);factor=remap.outputs[0]
        ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*color,1);ramp.color_ramp.elements[1].color=(*rgb(texture.get('color2','#ffffff')),1)
        links.new(factor,ramp.inputs[0]);links.new(ramp.outputs['Color'],p.inputs['Base Color'])
        if spec.get('emission',0):links.new(ramp.outputs['Color'],p.inputs['Emission Color'])
        if texture.get('bump',.1):
            bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=min(1,texture.get('bump',.1));bump.inputs['Distance'].default_value=texture.get('bump',.1)*.1
            links.new(tex.outputs.get('Fac') or tex.outputs[0],bump.inputs['Height']);links.new(bump.outputs[0],p.inputs['Normal'])
    for name,id in spec.get('maps',{}).items():
        from asset_library import asset_path
        tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(asset_path(id,'image')),check_existing=name in ('base_color','emission'))
        if name in ('normal','roughness','metallic'):tex.image.colorspace_settings.name='Non-Color'
        if name=='normal':
            normal=n.new('ShaderNodeNormalMap');links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs[0],p.inputs['Normal'])
        else:links.new(tex.outputs['Color'],p.inputs[{'base_color':'Base Color','roughness':'Roughness','metallic':'Metallic','emission':'Emission Color'}[name]])
    return m

def mesh_object(name,vertices,faces,mat,smooth_shading=True,uv=None):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    if mat:data.materials.append(mat)
    for polygon in data.polygons:polygon.use_smooth=smooth_shading
    if uv:
        layer=data.uv_layers.new(name='UVMap')
        for polygon in data.polygons:
            for loop in polygon.loop_indices:layer.data[loop].uv=uv[data.loops[loop].vertex_index]
    return obj

def geometry(p,mats):
    kind=p['shape'];name=p['id'];mat=mats[p['material']];shade=p.get('smooth',True)
    if kind=='library':
        from asset_library import asset_path
        scene=bpy.context.scene;frame_range=(scene.frame_start,scene.frame_end);before=set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(asset_path(p['source'],'model')))
        created=set(bpy.data.objects)-before;scene.frame_start,scene.frame_end=frame_range
        container=bpy.data.objects.new(name,None);scene.collection.objects.link(container)
        inner=bpy.data.objects.new(name+' native origin',None);scene.collection.objects.link(inner);inner.parent=container
        for obj in created:
            if obj.parent not in created:
                world=obj.matrix_world.copy();obj.parent=inner;obj.matrix_world=world
            if not p.get('keep_animation',True):obj.animation_data_clear()
            if obj.type in ('LIGHT','CAMERA') and not p.get('include_lights',False):obj.hide_render=True;obj['orbit_intrinsic_hidden']=True
            if p.get('override_material',False) and obj.type=='MESH':obj.data.materials.clear();obj.data.materials.append(mat)
        bpy.context.view_layer.update();points=[o.matrix_world@Vector(v) for o in created if o.type in ('MESH','CURVE') for v in o.bound_box]
        if not points:raise ValueError('Imported GLB has no visible geometry')
        lo=Vector([min(v[i] for v in points) for i in range(3)]);hi=Vector([max(v[i] for v in points) for i in range(3)]);extent=hi-lo
        scale=Vector([p['size'][i]/max(extent[i],.00001) for i in range(3)])
        if p.get('fit','contain')=='contain':scale=Vector((min(scale),)*3)
        origin=(lo+hi)/2
        if p.get('origin','bottom')=='bottom':origin.z=lo.z
        inner.scale=scale;inner.location=Vector([-origin[i]*scale[i] for i in range(3)])
        return container
    if kind=='mesh':return mesh_object(name,p['vertices'],p['faces'],mat,shade,p.get('uv'))
    if kind=='plane':return mesh_object(name,[(-p['size'][0]/2,-p['size'][1]/2,0),(p['size'][0]/2,-p['size'][1]/2,0),(p['size'][0]/2,p['size'][1]/2,0),(-p['size'][0]/2,p['size'][1]/2,0)],[(0,1,2,3)],mat,False)
    if kind=='icosphere':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=1);obj=bpy.context.object;obj.name=name
        obj.scale=[x/2 for x in p['size']];bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);obj.data.materials.append(mat)
        for poly in obj.data.polygons:poly.use_smooth=shade
        return obj
    if kind=='curve':
        data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=p.get('resolution',12)
        data.bevel_depth=p['radius'];data.bevel_resolution=3;data.use_fill_caps=True
        line=data.splines.new('BEZIER');line.bezier_points.add(len(p['points'])-1);line.use_cyclic_u=p.get('closed',False)
        for handle,point in zip(line.bezier_points,p['points']):handle.co=point;handle.handle_left_type='AUTO';handle.handle_right_type='AUTO'
        obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);data.materials.append(mat);return obj
    if kind=='ribbon':
        samples=spline(p['points'],p.get('resolution',12),p.get('closed',False));verts,faces=ribbon_mesh(samples,p['width'])
        obj=mesh_object(name,verts,faces,mat,shade)
        if p.get('thickness',.1):mod=obj.modifiers.new('Road thickness','SOLIDIFY');mod.thickness=p.get('thickness',.1);mod.offset=-1
        marking=p.get('markings')
        if marking:
            path=PathSampler(p['points'],p.get('resolution',12),p.get('closed',False));vertices=[];quads=[];at=0;step=marking['dash']+marking['gap']
            # A bounded number of dashes, independent of road length.
            while at<path.length and len(quads)<4096:
                end=min(path.length,at+marking['dash']);points=[]
                for j in range(5):
                    point,tangent=path.at((at+(end-at)*j/4)/path.length);side=Vector((-tangent[1],tangent[0],0)).normalized()*marking.get('offset',0)
                    points.append([point[0]+side.x,point[1]+side.y,point[2]+.008])
                vv,ff=ribbon_mesh(points,marking['width']);offset=len(vertices);vertices.extend(vv);quads.extend(tuple(x+offset for x in face) for face in ff);at+=step
            line=mesh_object(name+' markings',vertices,quads,mats[marking['material']],False);line.parent=obj
        return obj
    if kind=='lathe':
        vertices,faces=lathe_mesh(p['profile'],p.get('segments',64),p.get('caps',True));return mesh_object(name,vertices,faces,mat,shade)
    if kind=='extrude':
        polygon=p['polygon'];count=len(polygon);vertices=[(x,y,z) for z in (0,p['depth']) for x,y in polygon]
        faces=[tuple(reversed(range(count))),tuple(range(count,2*count))]+[(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
        return mesh_object(name,vertices,faces,mat,False)
    if kind=='terrain':
        n=p['resolution'];w,h,_=p['size'];vertices=[];faces=[]
        for row in range(n+1):
            for column in range(n+1):
                x=(column/n-.5)*w;y=(row/n-.5)*h;vertices.append((x,y,terrain_height(x,y,p)))
        for row in range(n):
            for column in range(n):a=row*(n+1)+column;faces.append((a,a+1,a+n+2,a+n+1))
        return mesh_object(name,vertices,faces,mat,shade)
    if kind=='text':
        data=bpy.data.curves.new(name,'FONT');data.body=p['text'];data.size=p.get('size',1);data.extrude=p.get('depth',.02);data.bevel_depth=min(p.get('bevel',.005),.03);data.align_x=p.get('align','CENTER');data.align_y='CENTER'
        obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);data.materials.append(mat);return obj
    raise ValueError('Unsupported geometry tool '+kind)

def modifiers(obj,spec,parts):
    for index,item in enumerate(spec.get('modifiers',[])):
        typ=item['type'];label=f'{index+1:02} {typ}'
        if typ=='bevel':mod=obj.modifiers.new(label,'BEVEL');mod.width=item.get('width',.04);mod.segments=item.get('segments',3)
        elif typ=='subdivision':mod=obj.modifiers.new(label,'SUBSURF');mod.levels=item.get('levels',1);mod.render_levels=mod.levels
        elif typ=='mirror':mod=obj.modifiers.new(label,'MIRROR');mod.use_axis=[a==item.get('axis','X') for a in 'XYZ']
        elif typ=='array':mod=obj.modifiers.new(label,'ARRAY');mod.count=item.get('count',2);mod.use_relative_offset=False;mod.use_constant_offset=True;mod.constant_offset_displace=item.get('offset',[1,0,0])
        elif typ=='solidify':mod=obj.modifiers.new(label,'SOLIDIFY');mod.thickness=item.get('thickness',.04)
        elif typ=='displace':
            tex=bpy.data.textures.new(label+' '+obj.name,type='CLOUDS');tex.noise_scale=item.get('scale',.5)
            control=bpy.data.objects.new(label+' noise origin',None);bpy.context.scene.collection.objects.link(control);control['orbit_no_export']=True
            rng=random.Random(item.get('seed',0));control.location=[rng.uniform(-100,100) for _ in range(3)]
            mod=obj.modifiers.new(label,'DISPLACE');mod.texture=tex;mod.strength=item.get('strength',.1);mod.texture_coords='OBJECT';mod.texture_coords_object=control
        elif typ=='decimate':mod=obj.modifiers.new(label,'DECIMATE');mod.ratio=item.get('ratio',.5)
        elif typ=='triangulate':obj.modifiers.new(label,'TRIANGULATE')
        elif typ=='boolean':
            mod=obj.modifiers.new(label,'BOOLEAN');mod.operation=item.get('operation','DIFFERENCE');mod.solver='EXACT';mod.object=parts[item['target']]
            if item.get('hide_cutter',True):mod.object.hide_render=True;mod.object.hide_set(True);mod.object['orbit_intrinsic_hidden']=True

def pivot(obj,offset):
    if not hasattr(obj.data,'transform'):raise ValueError('Pivot offsets need mesh or curve geometry')
    shift=Vector(offset);rotation=obj.rotation_euler.to_matrix();obj.data.transform(Matrix.Translation(-shift));obj.location+=rotation@shift

def fcurves(idblock):
    animation=getattr(idblock,'animation_data',None)
    if not animation or not animation.action:return []
    action=animation.action
    if hasattr(action,'fcurves'):return list(action.fcurves)
    result=[]
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:result.extend(bag.fcurves)
    return result

def interpolation(obj,value):
    for curve in fcurves(obj):
        for point in curve.keyframe_points:
            point.interpolation=value
            if value=='BEZIER':point.handle_left_type='AUTO_CLAMPED';point.handle_right_type='AUTO_CLAMPED'

def value_at(spec,prop,time,default):
    points=[(0,default)]
    for key in spec.get('animation',[]):
        if prop in key:
            if key['time']==0:points[0]=(0,key[prop])
            else:points.append((key['time'],key[prop]))
    if time>=points[-1][0]:return list(points[-1][1])
    for (ta,a),(tb,b) in zip(points,points[1:]):
        if ta<=time<=tb:
            u=(time-ta)/max(tb-ta,1e-8);style=spec.get('interpolation','BEZIER')
            return lerp(a,b,0 if style=='CONSTANT' else u if style=='LINEAR' else smooth(u))
    return list(default)

def animate(obj,spec,duration,paths=None):
    fps=bpy.context.scene.render.fps;last=max(1,round(duration*fps));motion=spec.get('motion',{});follow=spec.get('follow_path')
    defaults={'position':list(obj.location),'rotation':[math.degrees(x) for x in obj.rotation_euler],'scale':list(obj.scale)}
    if motion or follow:
        path=paths[follow['path']] if follow else None
        for frame in range(1,last+1):
            t=(frame-1)/max(last-1,1)*duration
            pos=value_at(spec,'position',t,defaults['position']);rot=value_at(spec,'rotation',t,defaults['rotation']);scale=value_at(spec,'scale',t,defaults['scale'])
            if follow:
                u=follow.get('start',0)+(follow.get('end',1)-follow.get('start',0))*t/duration;point,tangent=path.at(u)
                pos=[a+b for a,b in zip(point,follow.get('offset',[0,0,0]))]
                if follow.get('align',True):
                    if follow.get('end',1)<follow.get('start',0):tangent=[-x for x in tangent]
                    q=Vector(tangent).to_track_quat(follow.get('forward_axis','X'),follow.get('up_axis','Z'))
                    q=q@Euler([math.radians(x) for x in rot]).to_quaternion()
                    axis='XYZ'.index(follow.get('forward_axis','X').lstrip('-'));local_axis=Vector([1 if j==axis else 0 for j in range(3)])
                    q=q@Quaternion(local_axis,math.radians(follow.get('roll',0)));rot=[math.degrees(x) for x in q.to_euler()]
            for kind,values in motion.items():
                axis='XYZ'.index(values.get('axis','Z'));phase=math.radians(values.get('phase',0));wave=math.sin(math.tau*values.get('frequency',1)*t+phase)
                if kind=='spin':rot[axis]+=values.get('speed',360)*t
                elif kind=='bob':pos[axis]+=values.get('amplitude',.1)*wave
                elif kind=='sway':rot[axis]+=values.get('amplitude',10)*wave
                elif kind=='pulse':scale=[x*(1+values.get('amplitude',.05)*wave) for x in scale]
            obj.location=pos;obj.rotation_euler=[math.radians(x) for x in rot];obj.scale=scale
            for prop in ('location','rotation_euler','scale'):obj.keyframe_insert(data_path=prop,frame=frame)
        interpolation(obj,'LINEAR')
    else:
        for field,prop in [('position','location'),('rotation','rotation_euler'),('scale','scale')]:
            if any(field in key for key in spec.get('animation',[])):obj.keyframe_insert(data_path=prop,frame=1)
        for key in spec.get('animation',[]):
            frame=min(round(key['time']*fps)+1,last)
            for field,prop in [('position','location'),('rotation','rotation_euler'),('scale','scale')]:
                if field in key:setattr(obj,prop,[math.radians(x) for x in key[field]] if field=='rotation' else key[field]);obj.keyframe_insert(data_path=prop,frame=frame)
        interpolation(obj,spec.get('interpolation','BEZIER'))
    targets=[obj]+descendants(obj)
    if any('visible' in key for key in spec.get('animation',[])):
        for target in targets:target.keyframe_insert(data_path='hide_render',frame=1)
    for key in spec.get('animation',[]):
        if 'visible' in key:
            for target in targets:
                target.hide_render=not key['visible'] or bool(target.get('orbit_intrinsic_hidden'));target.keyframe_insert(data_path='hide_render',frame=min(round(key['time']*fps)+1,last))
    for target in targets:
        for curve in fcurves(target):
            if curve.data_path=='hide_render':
                for key in curve.keyframe_points:key.interpolation='CONSTANT'

def descendants(obj):return [child for c in obj.children for child in [c]+descendants(c)]

def paths(scene):return {p['id']:PathSampler(p['points'],p.get('resolution',16),p.get('closed',False)) for p in scene.get('paths',[])}

def environment(spec,render):
    scene=bpy.context.scene;world=scene.world;world.use_nodes=True;n=world.node_tree.nodes;links=world.node_tree.links
    bg=next(v for v in n if v.type=='BACKGROUND');bg.inputs['Color'].default_value=(*rgb(spec.get('background','#182738')),1);bg.inputs['Strength'].default_value=spec.get('strength',.45)
    if spec.get('sky'):
        values=spec['sky'];sky=n.new('ShaderNodeTexSky');sky.sky_type='MULTIPLE_SCATTERING';sky.sun_elevation=math.radians(values.get('sun_elevation',20));sky.sun_rotation=math.radians(values.get('sun_rotation',120));sky.air_density=values.get('air',1);sky.aerosol_density=values.get('dust',2);links.new(sky.outputs['Color'],bg.inputs['Color'])
    fog=spec.get('fog')
    if fog and fog.get('density',.002)>0:
        # A world volume has infinite optical depth and extinguishes the sky.
        # Use a finite volume so both the background and direct sunlight survive.
        size=spec.get('ground_size',200);bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,30));box=bpy.context.object;box.name='Atmosphere volume';box.scale=(size,size,80);box['orbit_no_export']=True
        fog_mat=bpy.data.materials.new('Finite atmosphere');fog_mat.use_nodes=True;nodes=fog_mat.node_tree.nodes;nodes.clear()
        output=nodes.new('ShaderNodeOutputMaterial');volume=nodes.new('ShaderNodeVolumeScatter');volume.inputs['Density'].default_value=fog.get('density',.002);volume.inputs['Color'].default_value=(*rgb(fog.get('color','#b5c4d4')),1);volume.inputs['Anisotropy'].default_value=fog.get('anisotropy',.2)
        fog_mat.node_tree.links.new(volume.outputs['Volume'],output.inputs['Volume']);box.data.materials.append(fog_mat)
    scene.view_settings.exposure=render.get('exposure',0)
    scene.view_settings.look=render.get('look','AgX - Medium High Contrast')
    scene.render.film_transparent=render.get('transparent',False);scene.render.use_motion_blur=render.get('motion_blur',False);scene.render.motion_blur_shutter=render.get('shutter',.3)
    amount=render.get('bloom',0)
    if amount:
        group=bpy.data.node_groups.new('Film finishing','CompositorNodeTree');scene.compositing_node_group=group
        out=group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
        output=group.nodes.new('NodeGroupOutput');layers=group.nodes.new('CompositorNodeRLayers');layers.scene=scene
        glare=group.nodes.new('CompositorNodeGlare')
        # Blender 5.1 exposes compositor options as node sockets.
        if 'Type' in glare.inputs:glare.inputs['Type'].default_value='Fog Glow'
        if 'Threshold' in glare.inputs:glare.inputs['Threshold'].default_value=1
        if 'Strength' in glare.inputs:glare.inputs['Strength'].default_value=amount
        group.links.new(layers.outputs['Image'],glare.inputs['Image']);group.links.new(glare.outputs['Image'],output.inputs['Image'])

def lights(specs,duration):
    for values in specs:
        data=bpy.data.lights.new(values['id'],values['type']);data.color=rgb(values.get('color','#ffffff'));data.energy=values.get('energy',1000)
        if data.type=='AREA':data.shape='DISK';data.size=values.get('size',5)
        if data.type=='SUN':data.angle=math.radians(values.get('angle',5))
        if data.type in ('POINT','SPOT'):data.shadow_soft_size=values.get('size',.2)
        if data.type=='SPOT':data.spot_size=math.radians(values.get('spot_size',45));data.spot_blend=values.get('blend',.4)
        obj=bpy.data.objects.new(values['id'],data);bpy.context.scene.collection.objects.link(obj);obj.location=values.get('position',[0,0,10])
        def point(target):
            delta=Vector(target)-obj.location
            if delta.length>1e-8:obj.rotation_euler=delta.to_track_quat('-Z','Y').to_euler('XYZ',obj.rotation_euler)
        point(values.get('target',[0,0,0]))
        for field,owner,path in [('position',obj,'location'),('target',obj,'rotation_euler'),('energy',data,'energy'),('color',data,'color')]:
            if any(field in key for key in values.get('animation',[])):owner.keyframe_insert(data_path=path,frame=1)
        for key in values.get('animation',[]):
            fps=bpy.context.scene.render.fps;frame=min(round(key['time']*fps)+1,round(duration*fps))
            if 'position' in key:obj.location=key['position'];obj.keyframe_insert(data_path='location',frame=frame)
            if 'target' in key:point(key['target']);obj.keyframe_insert(data_path='rotation_euler',frame=frame)
            if 'energy' in key:data.energy=key['energy'];data.keyframe_insert(data_path='energy',frame=frame)
            if 'color' in key:data.color=rgb(key['color']);data.keyframe_insert(data_path='color',frame=frame)
        interpolation(obj,'BEZIER');interpolation(data,'BEZIER')

def surface_bvh(obj):
    bpy.context.view_layer.update();evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
    try:return BVHTree.FromPolygons([obj.matrix_world@v.co for v in mesh.vertices],[list(p.vertices) for p in mesh.polygons],all_triangles=False)
    finally:evaluated.to_mesh_clear()

def safe_camera(pos,target,terrains):
    pos=pos.copy()
    for bvh in terrains:
        point,_,_,_=bvh.ray_cast(Vector((pos.x,pos.y,10000)),Vector((0,0,-1)),20000)
        if point is not None:pos.z=max(pos.z,point.z+1)
    # Clear terrain occlusion as well as the camera point itself. The subject's
    # own geometry is intentionally excluded from this terrain-only correction.
    for _ in range(16):
        delta=target-pos;blocked=False
        for bvh in terrains:
            hit,_,_,distance=bvh.ray_cast(pos,delta.normalized(),max(0,delta.length-.5))
            if hit is not None:blocked=True;break
        if not blocked:break
        pos.z+=max(1,delta.length*.08)
    return pos

def scatter(specs,make_asset,assets,materials,by_id=None):
    roots=[]
    for group,spec in enumerate(specs):
        rng=random.Random(spec.get('seed',0));count=0;tries=0;center=spec.get('center',[0,0,0]);size=spec.get('size',[20,20,0])
        surface=None
        if spec.get('surface'):
            iid,pid=spec['surface'].split(':',1);root=by_id[iid];surface=surface_bvh(next(o for o in descendants(root) if o.get('orbit_part_id')==pid))
        while count<spec['count'] and tries<spec['count']*30:
            tries+=1;position=[c+rng.uniform(-extent/2,extent/2) for c,extent in zip(center,size)]
            if any(math.hypot(position[0]-zone['center'][0],position[1]-zone['center'][1])<zone['radius'] for zone in spec.get('exclude',[])):continue
            if surface:
                hit,_,_,_=surface.ray_cast(Vector((position[0],position[1],10000)),Vector((0,0,-1)),20000)
                if hit is None:continue
                position[2]+=hit.z
            root=make_asset(assets[spec['asset']],materials);root.name=f'scatter_{group}_{count}';root.location=position
            root.rotation_euler.z=math.radians(rng.uniform(spec.get('rotation_min',0),spec.get('rotation_max',360)));root.scale=(rng.uniform(spec.get('scale_min',1),spec.get('scale_max',1)),)*3
            root['orbit_instance_id']=root.name;roots.append(root);count+=1
        if count!=spec['count']:raise ValueError('Scatter exclusion leaves insufficient space. Reduce count or exclusions.')
    return roots

def geometry_report():
    deps=bpy.context.evaluated_depsgraph_get();vertices=0;objects=0
    for obj in bpy.context.scene.objects:
        if obj.type in ('MESH','CURVE','FONT') and not obj.hide_render:
            evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
            try:vertices+=len(mesh.vertices);objects+=1
            finally:evaluated.to_mesh_clear()
            if vertices>2000000 or objects>12000:raise ValueError('Evaluated geometry exceeds 2M vertices / 12000 objects')
    return {'evaluated_vertices':vertices,'render_objects':objects}

def export_glb(path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if not obj.get('orbit_no_export') and not obj.hide_render:obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=True,export_cameras=True,export_lights=True)
