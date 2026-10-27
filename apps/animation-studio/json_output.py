"""Bounded native-MLX structured output after the private reasoning channel.

Uses pinned lm-format-enforcer 0.11.3 from the app-local .deps directory.
The grammar constrains format only; ordinary scene validation remains authoritative.
"""
import sys
from pathlib import Path

DEPS=Path(__file__).resolve().parent/'.deps'
if DEPS.is_dir() and str(DEPS) not in sys.path:sys.path.insert(0,str(DEPS))

CRITIQUE={'type':'object','required':['assessment','issues'],'additionalProperties':False,'properties':{
    'assessment':{'type':'string','maxLength':500},
    'issues':{'type':'array','maxItems':4,'items':{'type':'string','maxLength':500}}}}
EDIT={'type':'object','required':['patches','rebuild_assets'],'additionalProperties':False,'properties':{
    'patches':{'type':'array','maxItems':16,'items':{'type':'object','required':['op','path'],'additionalProperties':False,'properties':{
        'op':{'enum':['add','replace','remove']},'path':{'type':'string','pattern':r'/(title|summary|materials|assets|instances|shots|environment|lights|paths|scatter|render)(/[A-Za-z0-9_~:.-]+)*'},'value':{'type':['string','number','boolean','null','array','object']}}}},
    'rebuild_assets':{'type':'array','maxItems':2,'items':{'type':'object','required':['id','instruction'],'additionalProperties':False,'properties':{
        'id':{'type':'string','maxLength':48},'instruction':{'type':'string','maxLength':800}}}}}}

PATCH={'type':'object','required':['patches'],'additionalProperties':False,'properties':{'patches':EDIT['properties']['patches']}}
VECTOR={'type':'array','minItems':3,'maxItems':3,'items':{'type':'number'}}
PART_FIELDS={key:{'type':'number'} for key in 'bevel radius radius_top depth thickness width roughness noise_scale base_height'.split()}
for key in 'rows columns resolution segments seed octaves'.split():PART_FIELDS[key]={'type':'integer'}
for key in 'closed caps ridge keep_animation include_lights override_material'.split():PART_FIELDS[key]={'type':'boolean'}
for key in ('markings','motion'):PART_FIELDS[key]={'type':'object'}
for key in ('peaks','flatten'):PART_FIELDS[key]={'type':'array','maxItems':64,'items':{'type':'object'}}
for key in ('source','text'):PART_FIELDS[key]={'type':'string','maxLength':500}
for key,values in [('fit',['contain','stretch']),('origin',['bottom','center']),('align',['LEFT','CENTER','RIGHT']),('interpolation',['LINEAR','BEZIER','CONSTANT'])]:PART_FIELDS[key]={'enum':values}
PART_FIELDS.update(id={'type':'string','maxLength':48},material={'type':'string','maxLength':96},
    shape={'enum':['box','sphere','icosphere','plane','cylinder','cone','torus','rod','panel','dish','planet','mesh','curve','ribbon','lathe','extrude','terrain','text','library']},
    parent={'type':'string','maxLength':48},smooth={'type':'boolean'},size={'type':['number','array']})
for key in ('position','rotation','pivot','start','end'):PART_FIELDS[key]=VECTOR
for key,dimensions,maximum in [('vertices',3,8192),('points',3,128),('uv',2,8192),('profile',2,128),('polygon',2,128)]:
    PART_FIELDS[key]={'type':'array','maxItems':maximum,'items':{'type':'array','minItems':dimensions,'maxItems':dimensions,'items':{'type':'number'}}}
PART_FIELDS['faces']={'type':'array','maxItems':16384,'items':{'type':'array','minItems':3,'maxItems':64,'items':{'type':'integer'}}}
def object_schema(properties,required=()):return {'type':'object','properties':properties,'required':list(required),'additionalProperties':False}
NUMBER={'type':'number'};INTEGER={'type':'integer'};BOOLEAN={'type':'boolean'};SHORT_ID={'type':'string','maxLength':96}
PART_FIELDS['modifiers']={'type':'array','maxItems':8,'items':object_schema({
    'type':{'enum':['bevel','subdivision','mirror','array','solidify','displace','decimate','boolean','triangulate']},
    **{key:NUMBER for key in ('width','thickness','strength','scale','ratio')},
    **{key:INTEGER for key in ('segments','levels','count','seed')},
    'axis':{'enum':['X','Y','Z']},'offset':VECTOR,'target':SHORT_ID,
    'operation':{'enum':['DIFFERENCE','UNION','INTERSECT']},'hide_cutter':BOOLEAN},['type'])}
PART_FIELDS['animation']={'type':'array','maxItems':128,'items':object_schema({
    'time':NUMBER,'position':VECTOR,'rotation':VECTOR,'scale':VECTOR,'visible':BOOLEAN},['time'])}
PART_FIELDS['motion']=object_schema({
    key:object_schema({**{field:NUMBER for field in fields},**({'axis':{'enum':['X','Y','Z']}} if key!='pulse' else {})})
    for key,fields in [('spin',['speed']),('bob',['amplitude','frequency','phase']),('sway',['amplitude','frequency','phase']),('pulse',['amplitude','frequency','phase'])]})
PART_FIELDS['markings']=object_schema({'material':SHORT_ID,**{key:NUMBER for key in ('width','dash','gap','offset')}},['material'])
for key in ('peaks','flatten'):
    PART_FIELDS[key]={'type':'array','maxItems':64,'items':object_schema({
        'center':{'type':'array','minItems':2,'maxItems':2,'items':NUMBER},'height':NUMBER,
        'width' if key=='peaks' else 'radius':NUMBER},['center','height','width' if key=='peaks' else 'radius'])}
GEOMETRY_REQUIRED={'box':['size'],'sphere':['size'],'icosphere':['size'],'plane':['size'],'planet':['size'],'panel':['size'],'terrain':['size'],
    'cylinder':['radius','depth'],'cone':['radius','depth'],'torus':['radius','thickness'],'rod':['start','end','radius'],'dish':['radius','depth'],
    'curve':['points','radius'],'ribbon':['points','width'],'lathe':['profile'],'extrude':['polygon','depth'],'text':['text','size'],'library':['source','size']}
PART_VARIANTS=[]
GEOMETRY_FIELDS={
    'box':'size','sphere':'size','icosphere':'size','plane':'size','planet':'size','panel':'size rows columns',
    'terrain':'size resolution seed octaves roughness ridge noise_scale base_height peaks flatten',
    'cylinder':'radius depth','cone':'radius radius_top depth','torus':'radius thickness','rod':'start end radius','dish':'radius depth',
    'curve':'points radius resolution closed','ribbon':'points width thickness resolution closed markings','lathe':'profile segments caps',
    'extrude':'polygon depth','text':'text size depth align','library':'source size fit origin keep_animation include_lights override_material'}
for shape,fields in GEOMETRY_REQUIRED.items():
    allowed=set('id shape material parent smooth bevel position rotation pivot interpolation animation motion modifiers'.split()+GEOMETRY_FIELDS[shape].split())
    properties={key:value for key,value in PART_FIELDS.items() if key in allowed}|{'shape':{'enum':[shape]}}
    if shape in ('box','sphere','icosphere','plane','planet','panel','terrain','library'):properties=properties|{'size':VECTOR}
    elif shape=='text':properties=properties|{'size':{'type':'number'}}
    PART_VARIANTS.append({'type':'object','required':['id','shape','material']+fields,'additionalProperties':False,'properties':properties})
MATERIAL_FIELDS={'id':SHORT_ID,'color':{'type':'string','pattern':'#[0-9a-fA-F]{6}'},
    **{key:NUMBER for key in ('metallic','roughness','emission','alpha','transmission','ior','coat','coat_roughness','anisotropic')},
    'texture':object_schema({'type':{'enum':['noise','voronoi','wave','checker','gradient','wood','marble','terrain','image']},
        'color2':{'type':'string','pattern':'#[0-9a-fA-F]{6}'},'image':SHORT_ID,'projection':{'enum':['UV','BOX']},
        **{key:NUMBER for key in ('scale','detail','roughness','distortion','bump','height_min','height_max')}},['type']),
    'maps':object_schema({key:SHORT_ID for key in ('base_color','roughness','metallic','normal','emission')})}
ASSET={'type':'object','required':['asset','materials'],'additionalProperties':False,'properties':{
    'asset':{'type':'object','required':['id','name','parts'],'additionalProperties':False,'properties':{
        'id':{'type':'string','maxLength':48},'name':{'type':'string','maxLength':200},'description':{'type':'string','maxLength':700},
        'allow_disconnected':{'type':'boolean'},'parts':{'type':'array','minItems':1,'maxItems':512,'items':{'oneOf':PART_VARIANTS}}}},
    'materials':{'type':'array','maxItems':128,'items':object_schema(MATERIAL_FIELDS,['id','color'])}}}

def schema_for(name):
    if '-format-repair' in name:return None
    if '-critique' in name:return CRITIQUE
    if '-edit' in name and '-rebuild-' not in name:return EDIT
    if '-patch-' in name:return PATCH
    if name.startswith('02-asset-') or '-rebuild-' in name:return ASSET
    return None

def tokenizer_data(tokenizer):
    # Same leading-space treatment as the upstream Transformers integration,
    # without importing Torch or changing the inference backend.
    from lmformatenforcer import TokenEnforcerTokenizerData
    zero=tokenizer.encode('0',add_special_tokens=False)[-1];special=set(tokenizer.all_special_ids);regular=[]
    for token_id in range(len(tokenizer)):
        if token_id in special:continue
        after=tokenizer.decode([zero,token_id],clean_up_tokenization_spaces=False)[1:]
        alone=tokenizer.decode([token_id],clean_up_tokenization_spaces=False)
        regular.append((token_id,after,len(after)>len(alone)))
    return TokenEnforcerTokenizerData(regular,lambda ids:tokenizer.decode(ids,clean_up_tokenization_spaces=False).rstrip('�'),tokenizer.eos_token_id,False,len(tokenizer))

class JsonOutput:
    def __init__(self,data,schema,reasoning_end=()):
        from lmformatenforcer import TokenEnforcer,JsonSchemaParser
        self.enforcer=TokenEnforcer(data,JsonSchemaParser(schema));self.marker=list(reasoning_end)
        self.origin=None;self.answer_start=None
    def allowed(self,tokens):
        if self.origin is None:
            self.origin=len(tokens)
            if not self.marker:self.answer_start=self.origin
        if self.answer_start is None:
            # Search only tokens generated for this request, never template text.
            start=max(self.origin,len(tokens)-len(self.marker)-1)
            for index in range(start,len(tokens)-len(self.marker)+1):
                if tokens[index:index+len(self.marker)]==self.marker:
                    self.answer_start=index+len(self.marker);break
            if self.answer_start is None:return None
        return self.enforcer.get_allowed_tokens(tokens[self.answer_start:]).allowed_tokens
    def __call__(self,tokens,logits):
        allowed=self.allowed(tokens.tolist())
        if allowed is None:return logits
        import mlx.core as mx
        allowed=[i for i in allowed if 0<=i<logits.shape[-1]]
        if not allowed:raise ValueError('JSON grammar has no valid next token')
        mask=mx.full((logits.shape[-1],),-float('inf'),dtype=logits.dtype)
        mask[mx.array(allowed)]=0
        return logits+mask
