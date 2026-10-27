"""Expanded, bounded scene data. No expressions, scripts, URLs or executable nodes."""
import copy
import math
import re
import json

SHAPES={'box','sphere','icosphere','plane','cylinder','cone','torus','rod','panel','dish','planet',
        'mesh','curve','ribbon','lathe','extrude','terrain','text','library'}
LIMITS={'assets':32,'parts':512,'instances':256,'shots':24,'keyframes':128,
        'objects':12000,'vertices':2000000,'scatter':2048,'mesh_vertices':8192,'mesh_faces':16384}
CAPABILITIES={
 'version':2,'geometry':sorted(SHAPES),
 'modifiers':['bevel','subdivision','mirror','array','solidify','displace','decimate','boolean','triangulate'],
 'materials':['PBR','glass','coat','emission','noise','voronoi','wave','checker','gradient','wood','marble','terrain','image textures','normal maps'],
 'animation':['part hierarchy','pivot','transform keyframes','visibility','linear/bezier/constant','spin','bob','sway','pulse','path following','scatter'],
 'cinematography':['free camera','tracking camera','camera paths','camera keyframes','depth of field','area/sun/point/spot lights','animated lights','physical sky','fog','exposure','bloom','motion blur'],
 'limits':LIMITS}

GUIDE=r'''
SCENE LANGUAGE V2. Return JSON data, never Python. Use "version":2 at the root.
Metres; Z up; rotations in DEGREES. Build a coherent artistic scene rather than
approximating everything with boxes and cones. Use actual curved surfaces,
continuous ribbons, meshes, detailed silhouettes, lighting and moving parts.
Root: {version:2,title,summary,materials:[...],assets:[...],instances:[...],
 paths:[...],scatter:[...],lights:[...],environment:{...},shots:[...],render:{...}}.
materials: {id,color:'#RRGGBB',metallic:0,roughness:.4,emission:0,alpha:1,
 transmission:0,ior:1.45,coat:0,coat_roughness:.1,anisotropic:0,
 texture:{type:'noise|voronoi|wave|checker|gradient|wood|marble|terrain|image',
 color2:'#RRGGBB',scale:4,detail:3,roughness:.6,distortion:0,bump:.1,
 height_min:0,height_max:20}}. Procedural textures are generated, not image files.
 For image texture use {type:'image',image:'registered_image_id',projection:'UV|BOX'}.
 Optional maps:{base_color:'image_id',roughness:'image_id',metallic:'image_id',normal:'image_id',emission:'image_id'}.
 Use only IDs from the supplied local library catalog, never files/URLs.
 Use transmission=1,roughness=.08 for glass; a real palette and material contrast.
assets: {id,name,description,allow_disconnected:true,parts:[...]}.
 Every part: {id,shape,material,position:[x,y,z],rotation:[x,y,z],
 parent:'optional_local_part_id',pivot:[x,y,z],animation:[...],motion:{...},
 modifiers:[...],smooth:true}. Part transforms are relative to their parent;
 pivot is an optional offset in the part's LOCAL geometry coordinates.
Shapes and additional fields:
 box/sphere/icosphere/plane/planet: size:[x,y,z], bevel:.04. plane uses XY size.
 cylinder: radius,depth; cone: radius,radius_top,depth; torus: radius,thickness.
 rod: start:[x,y,z],end:[x,y,z],radius. panel: size:[w,h,d],rows:5,columns:8
 (solar-cell panel, NOT a generic surface). dish: radius,depth (concave paraboloid).
 mesh: vertices:[[x,y,z],...],faces:[[0,1,2,3],...],uv:[[u,v],...] optional
 per vertex. Faces need consistent outward winding; use subdivisions for softness.
 curve: points:[[x,y,z],...],radius:.05,resolution:12,closed:false.
 ribbon: points:[[x,y,z],...],width:4,thickness:.12,resolution:12,closed:false,
 markings:{material:'line_material',width:.08,dash:1,gap:1,offset:0} optional.
 A ribbon is ONE continuous curved road/river/belt; do not tile road boxes.
 lathe: profile:[[radius,z],...],segments:64,caps:true. Use for vessels,
 engine nozzles, bottles, towers, wheel profiles, lamps, custom round bodies.
 extrude: polygon:[[x,y],...],depth:1,bevel:.03 (closed 2D polygon).
 terrain: size:[width,length,height],resolution:64,seed:3,octaves:4,
 roughness:.55,ridge:true,noise_scale:3,base_height:0,
 peaks:[{center:[x,y],height:12,width:8}],
 flatten:[{center:[x,y],radius:5,height:0}] optional smooth clearings.
 library: source:'registered_model_id',size:[x,y,z],fit:'contain|stretch',origin:'bottom|center',
 keep_animation:true,include_lights:false,override_material:false. Imports a user-provided
 self-contained GLB from the local catalog, retaining its geometry/materials/rig animation.
 text: text:'Label',size:.5,depth:.02,align:'LEFT|CENTER|RIGHT'. Only text requested
 by the brief or useful explanatory labels; do not invent credits/title cards.
modifiers (optional array per part, applied in order):
 {type:'bevel',width:.04,segments:3}; {type:'subdivision',levels:1};
 {type:'mirror',axis:'X|Y|Z'}; {type:'array',count:6,offset:[2,0,0]};
 {type:'solidify',thickness:.04}; {type:'displace',strength:.1,scale:.5,seed:1};
 {type:'decimate',ratio:.5}; {type:'triangulate'};
 {type:'boolean',target:'part_id',operation:'DIFFERENCE|UNION|INTERSECT',hide_cutter:true}.
 Boolean cutters must be mesh parts in the same asset, and not self-references.
instances: {id,asset,position,rotation,scale:[1,1,1],parent:'optional_instance_id',
 animation:[{time:0,position:[...],rotation:[...],scale:[...],visible:true}],
 interpolation:'LINEAR|BEZIER|CONSTANT',motion:{...},follow_path:{...}}.
 Parts also support animation/interpolation/motion, so rotate wheels/rotors,
 open doors or unfold panels without spinning/moving the entire assembly.
 motion can combine {spin:{axis:'X|Y|Z',speed:360},bob:{axis:'Z',amplitude:.2,
 frequency:1,phase:0},sway:{axis:'Y',amplitude:10,frequency:.5,phase:0},
 pulse:{amplitude:.05,frequency:1,phase:0}}. Speed is degrees/second;
 phase is degrees. These motions are baked into real Blender keyframes.
paths: [{id,points:[[x,y,z],...],closed:false,resolution:16}].
 follow_path:{path:'id',start:0,end:1,offset:[0,0,0],align:true,forward_axis:'X',
 up_axis:'Z',roll:0}; start/end are fractions along the path over the whole film.
 Place car body along +X, wheels with axle along Y; spin wheels around Y while
 following a road path. Account for wheel radius and travel speed.
scatter: [{asset:'tree',count:80,seed:7,center:[0,0,0],size:[60,60,0],surface:'terrain_instance:part_id',
 scale_min:.7,scale_max:1.5,rotation_min:0,rotation_max:360,
 exclude:[{center:[x,y],radius:5}]}]. Deterministic object scatter, not LLM-written
 hundreds of instances. Keep the main subject/road clear. No external assets.
environment: {theme:'space|studio|sky',ground:true,stars:false,
 background:'#182738',strength:.4,ground_color:'#566239',ground_size:200,
 sky:{sun_elevation:12,sun_rotation:130,air:1,dust:3},
 fog:{density:.002,color:'#aabacd',anisotropy:.2}}.
 Physical sky is optional; use intentional warm/cool contrast, depth and atmosphere.
lights: [{id,type:'AREA|SUN|POINT|SPOT',color:'#ffd9a3',energy:1500,
 position:[8,-6,12],target:[0,0,1],size:6,angle:5,spot_size:45,blend:.4,
 animation:[{time:0,energy:1000,color:'#ff9966',position:[...],target:[...]}]}].
 Sun energy typically 1..5, area/point/spot 100..10000 W. Supplying lights replaces
 the generic studio rig. Choose artistic light direction instead of uniform fill.
 In Eevee, the sky/background alone does not guarantee diffuse illumination:
 include a readable key and fill light, accounting for scene scale and terrain shadows.
shots: [{start:0,end:5,label:'...',description:'...',ease:'SMOOTH|LINEAR',
 camera:{focus:'instance_id' or 'instance_id:part_id',azimuth:-60,elevation:20,
 margin:1.4,lens:50,target_offset:[0,0,0],dof:{fstop:2.8}},camera_end:{...}}].
 OR use free camera {position:[x,y,z],target:[x,y,z],lens:35,dof:{distance:8,fstop:4}}.
 Free cameras are supported and preserved; do not put them inside geometry.
 Optional projection:'ORTHO',ortho_scale:20 for parallel-projection infographics.
 Projection must remain constant within each shot; scale can be animated.
 camera may follow a declared path with {path:'id',path_start:0,path_end:1,
 focus:'instance_id',lens:35}. Camera path must stay outside geometry.
 Optional shot keyframes:[{time:0,camera:{...}},{time:3,camera:{...}}] use absolute
 film time and cover the shot. Cameras avoid terrain automatically; set avoid_terrain:false
 to disable this correction. margin is a multiplier [1.01,20], NOT metres.
 Lens [10,200] mm. Focus framing tracks geometry; free camera gives full composition.
 render:{exposure:0,look:'AgX - Medium High Contrast',bloom:.1,
 motion_blur:false,shutter:.3,transparent:false}.
 Limits: 32 assets,512 parts total,256 explicit instances,2048 scattered instances,
 24 contiguous shots,128 keyframes per object,8192 vertices per custom mesh,
 total evaluated scene budget 2 million vertices / 12000 objects. Prefer efficient
 procedural operations rather than giant JSON arrays. No scripts/expressions/URLs.
'''

def num(x,lo,hi,name):
    if isinstance(x,bool) or not isinstance(x,(float,int)) or not math.isfinite(x) or not lo<=x<=hi:raise ValueError(f'{name}: expected finite number in [{lo},{hi}]')
    return x
def integer(x,lo,hi,name):
    if type(x) is not int:raise ValueError(f'{name}: expected an integer')
    return num(x,lo,hi,name)
def vec(x,name,lo=-10000,hi=10000,n=3):
    if not isinstance(x,list) or len(x)!=n:raise ValueError(f'{name}: expected {n} numbers')
    return [num(v,lo,hi,name) for v in x]
def ident(x):
    if not isinstance(x,str) or not re.fullmatch('[a-zA-Z][a-zA-Z0-9_-]{0,47}',x):raise ValueError('Invalid ID: '+str(x)[:60])
    return x
def material_id(x):
    if not isinstance(x,str) or not re.fullmatch('[a-zA-Z][a-zA-Z0-9_:-]{0,95}',x):raise ValueError('Invalid material ID: '+str(x)[:100])
    return x
def rows(x,lo,hi,name):
    if not isinstance(x,list) or not lo<=len(x)<=hi or any(not isinstance(v,dict) for v in x):raise ValueError(f'{name}: expected {lo}..{hi} objects')
    return x
def enum(x,values,name):
    if not isinstance(x,str) or x not in values:raise ValueError(f'{name}: choose one of '+', '.join(map(str,values)))
    return x
def flag(x,name):
    if type(x) is not bool:raise ValueError(name+' must be boolean')
    return x
def hexcolor(x):
    if not isinstance(x,str) or not re.fullmatch('#[0-9A-Fa-f]{6}',x):raise ValueError('Color must be #RRGGBB')
    return x
def points(x,name,minimum=2,maximum=128,dimensions=3):
    if not isinstance(x,list) or not minimum<=len(x)<=maximum:raise ValueError(f'{name}: expected {minimum}..{maximum} points')
    return [vec(v,name,n=dimensions) for v in x]
def graph(records,field,name):
    by={i['id']:i for i in records}
    for item in records:
        seen={item['id']};p=item.get(field)
        while p:
            if p not in by:raise ValueError(f'{name} references unknown parent {p}')
            if p in seen:raise ValueError(name+' contains a dependency cycle')
            seen.add(p);p=by[p].get(field)

def anim(obj,duration):
    prev=-1
    for k in rows(obj.get('animation',[]),0,128,'animation'):
        t=num(k.get('time'),0,duration,'keyframe time')
        if t<=prev:raise ValueError('Animation keyframes must be ordered')
        prev=t
        for prop in ('position','rotation','scale'):
            if prop in k:vec(k[prop],prop,0.0001 if prop=='scale' else -100000,100000)
        if 'visible' in k:flag(k['visible'],'visible')
    enum(obj.get('interpolation','BEZIER'),('LINEAR','BEZIER','CONSTANT'),'interpolation')
    motion=obj.get('motion',{})
    if not isinstance(motion,dict) or set(motion)-{'spin','bob','sway','pulse'}:raise ValueError('Unsupported procedural motion')
    for kind,spec in motion.items():
        if not isinstance(spec,dict):raise ValueError('Motion must be an object')
        if kind!='pulse':enum(spec.get('axis','Z'),('X','Y','Z'),'motion axis')
        num(spec.get('phase',0),-36000,36000,'phase')
        if kind=='spin':num(spec.get('speed',360),-36000,36000,'spin speed')
        else:
            num(spec.get('amplitude',.1),0,.99 if kind=='pulse' else 10000,'amplitude')
            num(spec.get('frequency',1),0,120,'frequency')

def normalize(source):
    vector_keys={'position','rotation','scale','target','target_offset','pivot','size','offset','start','end','center','points','vertices','faces','uv','profile','polygon'}
    def visit(value):
        if isinstance(value,dict):
            result={key:visit(v) for key,v in value.items()}
            for key,v in list(result.items()):
                if key in vector_keys and isinstance(v,str) and v.lstrip().startswith('[') and len(v)<=65536:
                    try:parsed=json.loads(v)
                    except ValueError:continue
                    if isinstance(parsed,list):result[key]=parsed
            return result
        if isinstance(value,list):return [visit(item) for item in value]
        return value
    scene=visit(source)
    if not isinstance(scene,dict):return scene
    for shot in scene.get('shots',[]) if isinstance(scene.get('shots',[]),list) else []:
        if not isinstance(shot,dict):continue
        cameras=[shot.get('camera'),shot.get('camera_end')]+[k.get('camera') for k in shot.get('keyframes',[]) if isinstance(k,dict)]
        for camera in cameras:
            if not isinstance(camera,dict):continue
            alias=camera.pop('follow_path',None)
            if 'path' not in camera and isinstance(alias,str):camera['path']=alias
            elif 'path' not in camera and isinstance(alias,dict):
                camera['path']=alias.get('path');camera.setdefault('path_start',alias.get('start',0));camera.setdefault('path_end',alias.get('end',1))
    return scene

def validate(source,duration):
    s=normalize(source)
    if not isinstance(s,dict):raise ValueError('Scene must be an object')
    if s.get('version')!=2:raise ValueError('Unsupported scene version')
    num(duration,.01,600,'duration')
    for field in ('title','summary'):
        if not isinstance(s.get(field),str) or not 1<=len(s[field])<=3000:raise ValueError('Missing or overlong '+field)
    mats={}
    for m in rows(s.get('materials'),1,128,'materials'):
        mid=material_id(m.get('id'))
        if mid in mats:raise ValueError('Duplicate material ID')
        mats[mid]=m;hexcolor(m.get('color'))
        for prop,default,hi in [('metallic',0,1),('roughness',.4,1),('emission',0,100),('alpha',1,1),('transmission',0,1),('ior',1.45,4),('coat',0,1),('coat_roughness',.1,1),('anisotropic',0,1)]:
            m[prop]=num(m.get(prop,default),1 if prop=='ior' else 0,hi,prop)
        texture=m.get('texture')
        if texture is not None:
            if not isinstance(texture,dict):raise ValueError('texture must be an object')
            enum(texture.get('type'),('noise','voronoi','wave','checker','gradient','wood','marble','terrain','image'),'texture type')
            if texture['type']=='image':
                from asset_library import get
                get(texture.get('image'),'image');enum(texture.get('projection','BOX'),('UV','BOX'),'image projection')
            hexcolor(texture.get('color2','#ffffff'))
            for prop,default,lo,hi in [('scale',4,.001,1000),('detail',3,0,15),('roughness',.6,0,1),('distortion',0,0,100),('bump',.1,0,5),('height_min',0,-10000,10000),('height_max',20,-10000,10000)]:
                if prop=='distortion' and texture['type']=='marble':default=6
                texture[prop]=num(texture.get(prop,default),lo,hi,prop)
            if texture['height_max']<=texture['height_min']:raise ValueError('Texture height_max must exceed height_min')
        if 'maps' in m:
            from asset_library import get
            if not isinstance(m['maps'],dict) or set(m['maps'])-{'base_color','roughness','metallic','normal','emission'}:raise ValueError('Unsupported material maps')
            for image in m['maps'].values():get(image,'image')
    assets={};costs={};parts_count=0
    for a in rows(s.get('assets'),1,32,'assets'):
        aid=ident(a.get('id'))
        if aid in assets:raise ValueError('Duplicate asset ID')
        assets[aid]=a
        if not isinstance(a.get('name'),str) or len(a['name'])>200:raise ValueError('Invalid asset name')
        a['allow_disconnected']=flag(a.get('allow_disconnected',True),'allow_disconnected')
        parts={};asset_vertices=0;asset_objects=0
        for p in rows(a.get('parts'),1,512,'parts'):
            parts_count+=1;pid=ident(p.get('id'))
            if pid in parts:raise ValueError('Duplicate part ID')
            parts[pid]=p;kind=enum(p.get('shape'),SHAPES,'shape')
            if p.get('material') not in mats:raise ValueError('Unknown material '+str(p.get('material')))
            p['position']=vec(p.get('position',[0,0,0]),'part position');p['rotation']=vec(p.get('rotation',[0,0,0]),'part rotation',-100000,100000)
            p['bevel']=num(p.get('bevel',.02),0,10,'bevel');p['smooth']=flag(p.get('smooth',True),'smooth')
            if 'pivot' in p:vec(p['pivot'],'pivot')
            anim(p,duration);vertices={'box':8,'plane':4,'sphere':2048,'planet':2048,'icosphere':642,'cylinder':98,'cone':98,'rod':98,'torus':1024,'dish':1025}.get(kind,512);objects=1
            if kind in ('box','sphere','icosphere','plane','planet','panel','terrain','library'):p['size']=vec(p.get('size'),'size',.0001,10000)
            if kind=='library':
                from asset_library import get
                meta=get(p.get('source'),'model');vertices=meta['vertices'];objects=meta['objects']
                enum(p.get('fit','contain'),('contain','stretch'),'library fit');enum(p.get('origin','bottom'),('bottom','center'),'library origin')
                for option,default in [('keep_animation',True),('include_lights',False),('override_material',False)]:flag(p.get(option,default),option)
            if kind in ('cylinder','cone','torus','rod','dish','curve'):p['radius']=num(p.get('radius',.05),.0001,1000,'radius')
            if kind in ('cylinder','cone','dish','extrude'):p['depth']=num(p.get('depth',1),.0001,10000,'depth')
            if kind=='cone':p['radius_top']=num(p.get('radius_top',0),0,1000,'radius_top')
            if kind=='torus':p['thickness']=num(p.get('thickness',.04),.0001,100,'thickness')
            if kind=='rod':
                vec(p.get('start'),'rod start');vec(p.get('end'),'rod end')
                if sum((x-y)**2 for x,y in zip(p['start'],p['end']))<1e-8:raise ValueError('Zero-length rod')
            if kind=='panel':
                p['rows']=integer(p.get('rows',5),2,12,'rows');p['columns']=integer(p.get('columns',8),2,16,'columns');objects=5+p['rows']*p['columns'];vertices=objects*8
            if kind=='mesh':
                points(p.get('vertices'),'mesh vertices',3,8192)
                faces=p.get('faces')
                if not isinstance(faces,list) or not 1<=len(faces)<=16384:raise ValueError('Invalid mesh faces')
                for face in faces:
                    if not isinstance(face,list) or not 3<=len(face)<=32:raise ValueError('Faces need 3..32 vertex indexes')
                    for index in face:integer(index,0,len(p['vertices'])-1,'vertex index')
                    if len(set(face))!=len(face):raise ValueError('Repeated face vertex')
                if 'uv' in p:
                    points(p['uv'],'UV',len(p['vertices']),len(p['vertices']),2)
                vertices=len(p['vertices'])
            if kind in ('curve','ribbon'):
                points(p.get('points'),kind+' points');p['resolution']=integer(p.get('resolution',12),1,64,'resolution');flag(p.get('closed',False),'closed')
                if all(sum((a-b)**2 for a,b in zip(p['points'][0],pt))<1e-8 for pt in p['points']):raise ValueError('Curve has zero length')
                vertices=len(p['points'])*p['resolution']*(16 if kind=='curve' else 4)
                if kind=='ribbon':
                    p['width']=num(p.get('width',4),.001,1000,'ribbon width');p['thickness']=num(p.get('thickness',.1),0,100,'ribbon thickness')
                    if 'markings' in p:
                        m=p['markings']
                        if not isinstance(m,dict) or m.get('material') not in mats:raise ValueError('Invalid ribbon marking material')
                        for prop,default,lo,hi in [('width',.08,.001,100),('dash',1,.01,1000),('gap',1,0,1000),('offset',0,-1000,1000)]:m[prop]=num(m.get(prop,default),lo,hi,prop)
                        objects+=1;vertices*=2
            if kind=='lathe':
                points(p.get('profile'),'lathe profile',2,128,2)
                if any(v[0]<0 for v in p['profile']):raise ValueError('Negative lathe radius')
                p['segments']=integer(p.get('segments',64),8,128,'segments');flag(p.get('caps',True),'caps');vertices=p['segments']*len(p['profile'])
            if kind=='extrude':points(p.get('polygon'),'extrude polygon',3,128,2);vertices=len(p['polygon'])*2
            if kind=='terrain':
                p['resolution']=integer(p.get('resolution',64),4,128,'terrain resolution');integer(p.get('seed',0),0,2147483647,'seed')
                integer(p.get('octaves',4),1,8,'octaves');num(p.get('roughness',.55),0,1,'roughness');num(p.get('noise_scale',3),.01,100,'noise_scale');num(p.get('base_height',0),-10000,10000,'base_height');flag(p.get('ridge',True),'ridge')
                for peak in rows(p.get('peaks',[]),0,64,'peaks'):
                    vec(peak.get('center'),'peak center',n=2);num(peak.get('height'),-10000,10000,'peak height');num(peak.get('width'),.001,10000,'peak width')
                for flat in rows(p.get('flatten',[]),0,64,'flatten'):
                    vec(flat.get('center'),'flatten center',n=2);num(flat.get('height',0),-10000,10000,'flatten height');num(flat.get('radius'),.001,10000,'flatten radius')
                vertices=(p['resolution']+1)**2
            if kind=='text':
                if not isinstance(p.get('text'),str) or not 1<=len(p['text'])<=500:raise ValueError('Text length must be 1..500')
                num(p.get('size',1),.001,1000,'text size');num(p.get('depth',.02),0,100,'text depth');enum(p.get('align','CENTER'),('LEFT','CENTER','RIGHT'),'text align');vertices=len(p['text'])*256
            for m in rows(p.get('modifiers',[]),0,8,'modifiers'):
                typ=enum(m.get('type'),CAPABILITIES['modifiers'],'modifier')
                if typ=='bevel':num(m.get('width',.04),0,10,'bevel width');integer(m.get('segments',3),1,8,'segments');vertices*=4
                elif typ=='subdivision':vertices*=4**integer(m.get('levels',1),1,3,'subdivision levels')
                elif typ=='array':
                    count=integer(m.get('count',2),1,128,'array count');vec(m.get('offset',[1,0,0]),'array offset');vertices*=count
                elif typ=='mirror':enum(m.get('axis','X'),('X','Y','Z'),'mirror axis');vertices*=2
                elif typ=='solidify':num(m.get('thickness',.04),-100,100,'solidify thickness');vertices*=2
                elif typ=='displace':num(m.get('strength',.1),-100,100,'displace strength');num(m.get('scale',.5),.001,1000,'displace scale');integer(m.get('seed',0),0,100000,'displace seed')
                elif typ=='decimate':num(m.get('ratio',.5),.001,1,'decimate ratio')
                elif typ=='boolean':enum(m.get('operation','DIFFERENCE'),('DIFFERENCE','UNION','INTERSECT'),'boolean operation');flag(m.get('hide_cutter',True),'hide_cutter');vertices*=2
            asset_vertices+=vertices;asset_objects+=objects
        graph(a['parts'],'parent','Part hierarchy')
        for p in a['parts']:
            for m in p.get('modifiers',[]):
                if m['type']=='boolean' and (m.get('target') not in parts or m['target']==p['id']):raise ValueError('Boolean target must be another part in this asset')
        costs[aid]=(asset_vertices,asset_objects)
    if parts_count>512:raise ValueError('Scene exceeds 512 authored parts')
    paths={}
    for p in rows(s.get('paths',[]),0,128,'paths'):
        pid=ident(p.get('id'))
        if pid in paths:raise ValueError('Duplicate path ID')
        paths[pid]=p;points(p.get('points'),'path points');flag(p.get('closed',False),'closed');integer(p.get('resolution',16),1,64,'path resolution')
        if all(sum((a-b)**2 for a,b in zip(p['points'][0],pt))<1e-8 for pt in p['points']):raise ValueError('Path has zero length')
    ids={};total_vertices=0;total_objects=0
    for i in rows(s.get('instances'),1,256,'instances'):
        iid=ident(i.get('id'))
        if iid in ids:raise ValueError('Duplicate instance ID')
        ids[iid]=i
        if i.get('asset') not in assets:raise ValueError('Instance references unknown asset')
        for prop,default in [('position',[0,0,0]),('rotation',[0,0,0]),('scale',[1,1,1])]:i[prop]=vec(i.get(prop,default),prop,.0001 if prop=='scale' else -100000,100000)
        anim(i,duration)
        f=i.get('follow_path')
        if f is not None:
            if not isinstance(f,dict) or f.get('path') not in paths:raise ValueError('Unknown follow_path')
            for prop,default in [('start',0),('end',1)]:num(f.get(prop,default),0,1,prop)
            vec(f.get('offset',[0,0,0]),'path offset');flag(f.get('align',True),'align')
            enum(f.get('forward_axis','X'),('X','Y','Z','-X','-Y','-Z'),'forward axis');enum(f.get('up_axis','Z'),('X','Y','Z'),'up axis')
            if f.get('forward_axis','X').lstrip('-')==f.get('up_axis','Z'):raise ValueError('Path forward and up axes must differ')
            num(f.get('roll',0),-36000,36000,'path roll')
            if i.get('parent'):raise ValueError('A path-following instance must use world coordinates, without parent')
        v,o=costs[i['asset']];total_vertices+=v;total_objects+=o
    graph(s['instances'],'parent','Instance hierarchy')
    scatter_count=0
    for spec in rows(s.get('scatter',[]),0,32,'scatter'):
        if spec.get('asset') not in assets:raise ValueError('Scatter references unknown asset')
        if 'surface' in spec:
            surface=spec['surface']
            if not isinstance(surface,str) or ':' not in surface:raise ValueError('Scatter surface must be instance:part')
            iid,pid=surface.split(':',1)
            if iid not in ids or pid not in {p['id'] for p in assets[ids[iid]['asset']]['parts']}:raise ValueError('Unknown scatter surface')
        count=integer(spec.get('count'),1,2048,'scatter count');scatter_count+=count
        vec(spec.get('center',[0,0,0]),'scatter center');vec(spec.get('size',[20,20,0]),'scatter size',0,10000)
        integer(spec.get('seed',0),0,2147483647,'scatter seed')
        mn=num(spec.get('scale_min',1),.001,100,'scale_min');num(spec.get('scale_max',1),mn,100,'scale_max')
        num(spec.get('rotation_min',0),-36000,36000,'rotation_min');num(spec.get('rotation_max',360),-36000,36000,'rotation_max')
        for zone in rows(spec.get('exclude',[]),0,128,'scatter exclude'):
            vec(zone.get('center'),'exclude center',n=2);num(zone.get('radius'),.001,10000,'exclude radius')
        v,o=costs[spec['asset']];total_vertices+=v*count;total_objects+=o*count
    if scatter_count>2048 or total_vertices>2000000 or total_objects>12000:raise ValueError('Scene exceeds generated geometry budget (2M vertices / 12000 objects / 2048 scatter)')
    end=0
    def camera(c):
        if not isinstance(c,dict):raise ValueError('Missing camera')
        unknown=set(c)-{'focus','position','target','path','path_start','path_end','azimuth','elevation','margin','lens','target_offset','dof','avoid_terrain','include_context','allow_backface','projection','ortho_scale'}
        if unknown:raise ValueError('Unsupported camera fields: '+', '.join(sorted(unknown)))
        c['lens']=num(c.get('lens',45),10,200,'lens')
        c['projection']=enum(c.get('projection','PERSP'),('PERSP','ORTHO'),'camera projection')
        if c['projection']=='ORTHO':c['ortho_scale']=num(c.get('ortho_scale',20),.01,10000,'orthographic scale')
        if 'avoid_terrain' in c:flag(c['avoid_terrain'],'avoid_terrain')
        if 'focus' in c:
            if not isinstance(c['focus'],str):raise ValueError('Invalid focus')
            iid,_,pid=c['focus'].partition(':')
            if iid not in ids or (pid and pid not in {p['id'] for p in assets[ids[iid]['asset']]['parts']}):raise ValueError('Unknown camera focus target')
            c['azimuth']=num(c.get('azimuth',-60),-100000,100000,'azimuth');c['elevation']=num(c.get('elevation',25),-89,89,'elevation');c['margin']=num(c.get('margin',1.4),1.01,20,'margin')
            vec(c.get('target_offset',[0,0,0]),'target_offset')
        if 'path' in c:
            if c['path'] not in paths:raise ValueError('Camera path is unknown')
            num(c.get('path_start',0),0,1,'path_start');num(c.get('path_end',1),0,1,'path_end')
            if 'focus' not in c:vec(c.get('target'),'camera target')
        elif 'position' in c:
            vec(c['position'],'camera position')
            if 'focus' not in c:vec(c.get('target'),'camera target')
            if 'target' in c and sum((a-b)**2 for a,b in zip(c['position'],c['target']))<.0001:raise ValueError('Camera at its target')
        elif 'focus' not in c:raise ValueError('Camera needs focus, position or path')
        if 'dof' in c:
            dof=c['dof']
            if not isinstance(dof,dict):raise ValueError('dof must be an object')
            num(dof.get('fstop',4),.7,64,'fstop');num(dof.get('distance',10),.001,100000,'focus distance')
    for shot in rows(s.get('shots'),1,24,'shots'):
        start=num(shot.get('start'),0,duration,'shot start');stop=num(shot.get('end'),0,duration,'shot end')
        if abs(start-end)>.02 or stop<=start:raise ValueError('Shots must be contiguous and nonempty')
        end=stop
        if not isinstance(shot.get('label'),str) or len(shot['label'])>200:raise ValueError('Invalid shot label')
        enum(shot.get('ease','SMOOTH'),('SMOOTH','LINEAR'),'shot ease');camera(shot.get('camera'))
        shot['camera_end']=shot.get('camera_end',copy.deepcopy(shot['camera']));camera(shot['camera_end'])
        if shot['camera_end']['projection']!=shot['camera']['projection']:raise ValueError('Camera projection must remain constant within a shot')
        keys=rows(shot.get('keyframes',[]),0,128,'camera keyframes');prev=-1
        for key in keys:
            t=num(key.get('time'),start,stop,'camera keyframe time')
            if t<=prev:raise ValueError('Camera keyframes must be ordered')
            prev=t;camera(key.get('camera'))
            if key['camera']['projection']!=shot['camera']['projection']:raise ValueError('Camera projection must remain constant within a shot')
        if keys and (keys[0]['time']!=start or keys[-1]['time']!=stop):raise ValueError('Camera keyframes must cover the shot')
    if abs(end-duration)>.02:raise ValueError('Shots must cover full duration')
    env=s.setdefault('environment',{});enum(env.get('theme','studio'),('space','studio','sky'),'environment theme')
    for field in ('ground','stars'):
        if field in env:flag(env[field],field)
    for field in ('background','ground_color'):
        if field in env:hexcolor(env[field])
    num(env.get('strength',.45),0,20,'world strength');num(env.get('ground_size',200),1,20000,'ground_size')
    if 'sky' in env:
        sky=env['sky']
        if not isinstance(sky,dict):raise ValueError('sky must be an object')
        for prop,default,lo,hi in [('sun_elevation',20,-10,90),('sun_rotation',120,-3600,3600),('air',1,0,10),('dust',2,0,10)]:num(sky.get(prop,default),lo,hi,prop)
    if 'fog' in env:
        fog=env['fog']
        if not isinstance(fog,dict):raise ValueError('fog must be an object')
        num(fog.get('density',.002),0,.1,'fog density');hexcolor(fog.get('color','#b5c4d4'));num(fog.get('anisotropy',.2),-.9,.9,'anisotropy')
    light_ids=set()
    for light in rows(s.get('lights',[]),0,32,'lights'):
        lid=ident(light.get('id'))
        if lid in light_ids:raise ValueError('Duplicate light ID')
        light_ids.add(lid);enum(light.get('type'),('AREA','SUN','POINT','SPOT'),'light type');hexcolor(light.get('color','#ffffff'))
        num(light.get('energy',1000),0,100000,'light energy');vec(light.get('position',[0,0,10]),'light position');vec(light.get('target',[0,0,0]),'light target')
        num(light.get('size',5),.001,1000,'light size');num(light.get('angle',5),0,180,'light angle');num(light.get('spot_size',45),1,179,'spot_size');num(light.get('blend',.4),0,1,'spot blend')
        prev=-1
        for key in rows(light.get('animation',[]),0,128,'light animation'):
            t=num(key.get('time'),0,duration,'light time')
            if t<=prev:raise ValueError('Light keyframes must be ordered')
            prev=t
            if 'energy' in key:num(key['energy'],0,100000,'light energy')
            if 'color' in key:hexcolor(key['color'])
            for field in ('position','target'):
                if field in key:vec(key[field],'light '+field)
    render=s.setdefault('render',{})
    num(render.get('exposure',0),-10,10,'exposure');num(render.get('bloom',0),0,2,'bloom');num(render.get('shutter',.3),0,2,'shutter')
    for field in ('motion_blur','transparent'):
        if field in render:flag(render[field],field)
    enum(render.get('look','AgX - Medium High Contrast'),('None','AgX - Medium High Contrast','AgX - Medium Low Contrast','AgX - High Contrast','AgX - Low Contrast','AgX - Very High Contrast','AgX - Very Low Contrast','AgX - Base Contrast'),'look')
    s['capability_summary']={'authored_parts':parts_count,'estimated_vertices':total_vertices,'estimated_objects':total_objects,'scatter_instances':scatter_count}
    return s
