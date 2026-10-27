"""Hand-authored tool demonstrations, explicitly separate from AI-generated films."""
import math

def material(id,color,**kw):return {'id':id,'color':color,**kw}
def part(id,shape,material,**kw):return {'id':id,'shape':shape,'material':material,**kw}

def gallery():
    materials=[material('metal','#69b4b6',metallic=.7,roughness=.25),material('warm','#e69a50'),material('glass','#9acede',transmission=1,roughness=.08),material('glow','#ffbb55',emission=3)]
    textures=['noise','voronoi','wave','checker','gradient','wood','marble','terrain']
    materials += [material('tex_'+t,'#304e67',texture={'type':t,'color2':'#e0aa6b','bump':.2}) for t in textures]
    specs=[
      part('mesh','mesh','metal',vertices=[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0],[0,0,2]],faces=[[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]]),
      part('ribbon','ribbon','warm',points=[[-2,-1,0],[0,1,.3],[2,-1,0]],width=1.3,markings={'material':'glow','width':.05,'dash':.2,'gap':.3}),
      part('curve','curve','metal',points=[[-1,-1,0],[0,0,2],[1,1,0]],radius=.1),
      part('lathe','lathe','glass',profile=[[.7,0],[.8,.2],[.5,1],[.3,1.6],[.4,1.8]],segments=32),
      part('extrude','extrude','warm',polygon=[[-1,-1],[1,-1],[1,0],[0,1],[-1,0]],depth=.5),
      part('terrain','terrain','tex_terrain',size=[3,3,1],resolution=16,seed=1),
      part('text','text','glow',text='3D',size=1,rotation=[90,0,0]),
      part('plane','plane','tex_checker',size=[3,3,.1]),
      part('ico','icosphere','metal',size=[2,2,2],smooth=False),
      part('bevel','box','metal',size=[1.5,1.5,1.5],modifiers=[{'type':'bevel','width':.1,'segments':3}]),
      part('subdiv','box','warm',size=[1.8,1.8,1.8],bevel=0,modifiers=[{'type':'subdivision','levels':2}]),
      part('array','box','metal',size=[.4,.4,1],modifiers=[{'type':'array','count':4,'offset':[.6,0,0]}]),
      part('mirror','box','warm',size=[.6,1,1],position=[.7,0,0],modifiers=[{'type':'mirror','axis':'X'}]),
      part('solidify','plane','metal',size=[2,2,.1],modifiers=[{'type':'solidify','thickness':.2}]),
      part('displace','icosphere','tex_noise',size=[2,2,2],modifiers=[{'type':'displace','strength':.2,'scale':.2,'seed':3}]),
      part('decimate','icosphere','warm',size=[2,2,2],smooth=False,modifiers=[{'type':'decimate','ratio':.2},{'type':'triangulate'}]),
    ]
    assets=[];instances=[]
    for index,p in enumerate(specs):
        aid=p['id'];assets.append({'id':aid,'name':aid,'parts':[p]});instances.append({'id':'i_'+aid,'asset':aid,'position':[(index%4-1.5)*4,(index//4-1.5)*4,0]})
    assets.append({'id':'boolean','name':'Boolean assembly','parts':[part('block','box','metal',size=[2,2,2],modifiers=[{'type':'boolean','target':'cutter'}]),part('cutter','cylinder','warm',radius=.6,depth=4)]})
    instances.append({'id':'i_boolean','asset':'boolean','position':[8,0,1]})
    assets.append({'id':'mechanism','name':'Animated parent and pivot','parts':[part('base','box','metal',size=[2,.3,.3]),part('arm','box','warm',size=[2,.3,.3],parent='base',position=[1,0,0],pivot=[-1,0,0],motion={'spin':{'axis':'Z','speed':90}})]})
    instances.append({'id':'mechanism','asset':'mechanism','position':[8,4,1]})
    for index,typ in enumerate(textures):
        assets[0]['parts'].append(part('texture_'+typ,'sphere','tex_'+typ,size=[.6,.6,.6],position=[(index-4)*.7,0,3]))
    return {'version':2,'title':'Scene Tools Gallery','summary':'Hand-authored verification of geometry, modifiers, materials, cameras and animation.',
      'materials':materials,'assets':assets,'instances':instances,
      'paths':[{'id':'motion','points':[[-8,-10,2],[0,-10,4],[8,-10,2]]}],
      'scatter':[{'asset':'ico','count':3,'seed':9,'center':[0,10,0],'size':[8,1,0],'scale_min':.3,'scale_max':.5}],
      'lights':[{'id':'key','type':'AREA','position':[0,-6,12],'target':[0,0,0],'energy':3000,'size':8,'animation':[{'time':0,'energy':2500},{'time':2,'energy':3500}]},
                {'id':'sun','type':'SUN','energy':1,'color':'#ffd2a0','position':[10,-10,20]},
                {'id':'point','type':'POINT','position':[-5,0,5],'energy':300},
                {'id':'spot','type':'SPOT','position':[5,0,8],'target':[0,0,0],'energy':500}],
      'environment':{'theme':'studio','ground':True,'ground_color':'#182630','background':'#152432','strength':.3},
      'render':{'bloom':.1,'exposure':.3},
      'shots':[{'start':0,'end':2,'label':'All tools','camera':{'position':[22,-30,28],'target':[0,0,1],'lens':42},'camera_end':{'position':[20,-28,25],'target':[0,0,1],'lens':42}}]}

def mountain_drive(duration=5):
    road=[[-28,-5,.12],[-16,-3,.12],[-4,1,.12],[9,0,.12],[20,5,.12],[30,9,.12]]
    mats=[material('paint','#075b78',metallic=.65,roughness=.22,coat=.85),material('rubber','#11191e',roughness=.8,texture={'type':'noise','color2':'#27343a','scale':40,'bump':.15}),material('alloy','#ccd7dc',metallic=.9,roughness=.19),material('glass','#345767',metallic=.15,transmission=.75,roughness=.1),material('headlight','#d8f5ff',emission=4),material('tail','#fa4024',emission=3),material('asphalt','#252e35',roughness=.9,texture={'type':'noise','color2':'#3b444a','scale':100,'bump':.13}),material('line','#e6d6a5',roughness=.8),material('earth','#384e31',roughness=.9,texture={'type':'terrain','color2':'#b4b4a4','height_min':1,'height_max':22,'bump':.25}),material('bark','#47342b',texture={'type':'wood','color2':'#67513b','scale':10}),material('pine','#173d32',texture={'type':'noise','color2':'#426448','scale':8,'bump':.1})]
    sections=[(-2.4,.65,.55),(-2.15,.94,.68),(-1.2,1.0,.76),(.9,1.0,.75),(1.9,.9,.63),(2.35,.65,.5)]
    vertices=[]
    for x,width,z in sections:vertices += [[x,-width,.48],[x,width,.48],[x,width,z+.4],[x,-width,z+.4]]
    faces=[[0,3,2,1]]
    for j in range(len(sections)-1):
        for k in range(4):faces.append([j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k])
    faces.append([(len(sections)-1)*4+k for k in range(4)])
    car=[part('body','mesh','paint',vertices=vertices,faces=faces,bevel=.08),part('cabin','mesh','glass',vertices=[[-1.2,-.82,1.05],[-1.2,.82,1.05],[1.1,.82,1.05],[1.1,-.82,1.05],[-.65,-.72,1.8],[-.65,.72,1.8],[.65,.72,1.8],[.65,-.72,1.8]],faces=[[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]],bevel=.035),part('roof','box','paint',size=[1.38,1.52,.12],position=[0,0,1.82],bevel=.07)]
    for x in (-1.55,1.55):
        for y in (-1.02,1.02):
            ident='wheel_'+('front' if x>0 else 'rear')+('_l' if y>0 else '_r')
            car.append(part(ident,'lathe','rubber',profile=[[.28,-.18],[.44,-.15],[.49,-.07],[.49,.07],[.44,.15],[.28,.18]],segments=48,position=[x,y,.49],rotation=[90,0,0],motion={'spin':{'axis':'Y','speed':-1450*5/duration}},bevel=.02))
            car.append(part(ident+'_hub','cylinder','alloy',radius=.28,depth=.35,parent=ident,bevel=.025))
            for spoke in range(5):
                a=spoke/5*math.tau
                car.append(part(ident+'_spoke'+str(spoke),'box','alloy',size=[.09,.42,.035],parent=ident,position=[math.sin(a)*.1,math.cos(a)*.1,.19 if y<0 else -.19],rotation=[0,0,-math.degrees(a)],bevel=.02))
    for y in (-.65,.65):
        car.append(part('head_'+str(y).replace('-','m').replace('.','_'),'box','headlight',size=[.07,.42,.13],position=[2.25,y,.95],bevel=.04))
        car.append(part('tail_'+str(y).replace('-','m').replace('.','_'),'box','tail',size=[.08,.4,.1],position=[-2.25,y,.93],bevel=.025))
    car += [part('bumper_front','box','alloy',size=[.12,1.55,.12],position=[2.3,0,.62],bevel=.04),part('bumper_back','box','alloy',size=[.12,1.55,.12],position=[-2.3,0,.62],bevel=.04)]
    flatten=[{'center':p[:2],'radius':13,'height':-.15} for p in road]
    terrain=part('land','terrain','earth',size=[120,100,7],resolution=96,noise_scale=5,octaves=5,seed=23,peaks=[{'center':[-15,28],'height':27,'width':12},{'center':[12,31],'height':30,'width':10},{'center':[32,25],'height':22,'width':9},{'center':[-30,-28],'height':18,'width':11}],flatten=flatten)
    tree=[part('trunk','cylinder','bark',radius=.17,depth=3,position=[0,0,1.5]),part('foliage','lathe','pine',profile=[[0,1],[1.2,1.1],[.7,1.7],[1,1.9],[.5,2.5],[.7,2.7],[0,4.4]],segments=20,modifiers=[{'type':'displace','strength':.09,'scale':.3}],smooth=False)]
    tracking=[[p[0]-3,p[1]-11,4] for p in road];wide=[[p[0]-8,p[1]-20,14] for p in road]
    return {'version':2,'title':'Golden Valley Drive','summary':'Hand-authored cinematic tool demonstration: continuous road, sculpted terrain, detailed moving car, forest, sunset lighting and tracking cameras.',
      'materials':mats,'assets':[{'id':'car','name':'Touring coupe','parts':car},{'id':'road','name':'Continuous valley road','parts':[part('surface','ribbon','asphalt',points=road,width=6,thickness=.18,resolution=20,markings={'material':'line','width':.1,'dash':1.4,'gap':1.6})]},{'id':'landscape','name':'Ridged mountain valley','parts':[terrain]},{'id':'pine','name':'Alpine pine','parts':tree}],
      'instances':[{'id':'hero','asset':'car','follow_path':{'path':'drive','offset':[0,0,.05]}},{'id':'valley','asset':'landscape'},{'id':'road','asset':'road'}],
      'scatter':[{'asset':'pine','surface':'valley:land','count':60,'seed':33,'center':[0,0,0],'size':[95,75,0],'scale_min':.8,'scale_max':1.7,'exclude':[{'center':p[:2],'radius':10} for p in road]}],
      'paths':[{'id':'drive','points':road},{'id':'tracking','points':tracking},{'id':'wide','points':wide}],
      'lights':[{'id':'sun','type':'SUN','color':'#ffd39b','energy':3,'position':[-20,5,55],'target':[0,0,0],'angle':5},{'id':'sky_fill','type':'SUN','color':'#a9cce6','energy':1.5,'position':[0,-50,100],'target':[0,0,0],'angle':35},{'id':'soft_fill','type':'AREA','color':'#8dbad6','energy':12000,'position':[5,-12,28],'target':[0,0,0],'size':24}],
      'environment':{'theme':'sky','ground':True,'ground_color':'#495337','sky':{'sun_elevation':9,'sun_rotation':145,'air':1,'dust':3},'strength':.12,'fog':{'density':.0008,'color':'#9bafa9','anisotropy':.25}},
      'render':{'exposure':.7,'bloom':.04,'motion_blur':True,'shutter':.25,'look':'AgX - Medium High Contrast'},
      'shots':[{'start':0,'end':duration*.4,'label':'Valley approach','camera':{'path':'tracking','path_start':0,'path_end':.4,'focus':'hero','target_offset':[0,0,.4],'lens':42,'dof':{'fstop':5.6}}},
               {'start':duration*.4,'end':duration*.7,'label':'Roadside tracking','camera':{'focus':'hero','azimuth':-85,'elevation':12,'margin':1.45,'lens':55,'dof':{'fstop':4}},'camera_end':{'focus':'hero','azimuth':-65,'elevation':15,'margin':1.5,'lens':55,'dof':{'fstop':4}}},
               {'start':duration*.7,'end':duration,'label':'Valley reveal','camera':{'path':'wide','path_start':.7,'path_end':1,'focus':'hero','lens':35}}]}

DEMOS={'mountain-drive':{'title':'Golden Valley Drive','description':'Detailed car, spinning wheels, continuous road, terrain, forest and sunset.','duration':5,'builder':mountain_drive},
       'tools-gallery':{'title':'Scene Tools Gallery','description':'Geometry, materials, modifiers, motion and lighting verification.','duration':2,'builder':gallery}}
