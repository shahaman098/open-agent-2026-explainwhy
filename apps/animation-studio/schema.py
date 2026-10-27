"""Bounded scene description. Model output is data, never executable code."""
import copy
import json
import math
import re
from scene_v2 import GUIDE as ADVANCED_GUIDE,validate as validate_advanced

SHAPES = {'box', 'sphere', 'cylinder', 'cone', 'torus', 'rod', 'panel', 'dish', 'planet'}

SCENE_GUIDE = r'''
Return one JSON object, no Python. This is the COMPLETE supported Blender scene language.
Units metres; Z up. ALL rotations are DEGREES, not radians. Geometry of each asset
is local to its origin; instances place/animate the entire asset in world space.
Cylinders, cones, dishes, torus and panels face along local Z. Panel size=[width,height,thickness],
its cells lie in local XY. A dish is a concave paraboloid opening toward local +Z.
Objects must connect physically. Use rods between explicit start/end points for struts.
Do not simulate orbital physics at real astronomical scale; use a clear cinematic scale.
Supported schema (replace illustrative values with your own design):
{
 "title":"Short film title", "summary":"Public creative direction",
 "materials":[{"id":"gold","color":"#dcb46d","metallic":0.75,"roughness":0.3,"emission":0}],
 "assets":[{"id":"object","name":"Readable asset name","description":"What it is","allow_disconnected":false,
   "parts":[{"id":"body","shape":"box","material":"gold","position":[0,0,0],
     "rotation":[0,0,0],"size":[1,1,1],"bevel":0.04}]}],
 "instances":[{"id":"hero","asset":"object","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],
   "animation":[{"time":0,"position":[0,0,0],"rotation":[0,0,0]},
                {"time":10,"position":[1,0,0],"rotation":[0,0,40]}]}],
 "environment":{"theme":"space","stars":true,"ground":false},
 "shots":[{"start":0,"end":10,"label":"Hero reveal","description":"What the viewer sees",
   "camera":{"focus":"hero","azimuth":-60,"elevation":25,"margin":1.3,"lens":45},
   "camera_end":{"focus":"hero","azimuth":-30,"elevation":30,"margin":1.2,"lens":45}}]
}
Part-specific fields:
 box: size XYZ, bevel optional.
 sphere/planet: size XYZ is full diameter, not radius. planet adds procedural blue oceans/green land.
 cylinder: radius, depth; cone: radius, radius_top, depth.
 torus: radius (major), thickness (minor).
 rod: start XYZ, end XYZ, radius; endpoints are local to the asset.
 panel: size XYZ, rows (2..12), columns (2..16); automatic framed solar-cell grid.
   This ALREADY includes an aluminium frame. Never surround/cover it with a solid box:
   that hides the blue cells. Face the cell side (+local Z) toward the camera.
 dish: radius, depth; the feed/supports are separate rods/spheres in the same asset.
Materials are IDs, color is a 6-digit hex string. Reuse materials. Do not invent schema fields.
All materials are OPAQUE. Never add an opaque outer sphere as atmosphere/clouds; it
hides the planet. For Earth use the planet primitive, which already has ocean/land.
Limits: 1..6 assets, 1..80 parts total, 1..12 instances, 1..6 shots, at most 8 keyframes per instance.
Shots must cover the entire requested duration, be ordered and contiguous, starting at 0.
Keep compositions visually legible through the WHOLE shot. At 45 mm lens, from distance D
the horizontal frame width is about 0.8*D; allow margin for the full animated model.
Use 2..4 thoughtful shots for a ten-second film, including a wide establishing view and
a closer detail. Different shots may use different cameras. Avoid unnecessary fast spins.
Camera paths must stay OUTSIDE the geometry. Detail shots should aim at the detail's
actual coordinates, without placing the camera inside the body. Background objects must
be in the camera's forward field, not behind the camera. Use geometric reasoning.
REQUIRED CAMERA TOOL FOR NEW/REVISED SHOTS: instead of position/target, use
 {"focus":"hero","azimuth":-60,"elevation":30,"margin":1.2,"lens":45}.
The compiler finds the ACTUAL animated geometry center and fits it safely in the frame.
For a close-up, focus on "instance_id:part_id", e.g. "hero:body". Use an elevated
angle to see over foreground geometry. camera_end may change azimuth/elevation/margin
for an orbit/dolly. This avoids guessed coordinates and tracks moving subjects.
Camera numeric limits: margin is a framing MULTIPLIER in [1.05,3], normally 1.2..1.6,
NOT a distance in metres. elevation is [-80,85] degrees; lens is [18,100] mm.
Environment theme must be exactly one of "space", "studio", "sky". Use "sky"
with ground=true for mountains/roads/landscapes. Use "space" only when requested.
For space establishing shots, the compiler includes nearby larger background objects
by correcting the viewing side. Set include_context=false on a camera to opt out.
For dish/panel close-ups it shows the front surface; allow_backface=true opts out.
Small gaps between multi-part groups within an asset receive narrow structural supports.
Set allow_disconnected=true for intentional exploded views or separated assemblies.
Create rich silhouette/detail with connected geometry, contrasting materials and lighting.
Do not include code, external assets, filenames, scripts, URLs, narration or audio commands.
'''

SCENE_GUIDE = ADVANCED_GUIDE

def parse_json(raw):
    public = raw.rsplit('</think>', 1)[-1].strip()
    public = re.sub(r'^```(?:json)?\s*', '', public)
    public = re.sub(r'\s*```\s*$', '', public)
    start = public.find('{')
    if start < 0:
        raise ValueError('No JSON object in the model answer')
    obj, _ = json.JSONDecoder().raw_decode(public[start:])
    if not isinstance(obj, dict):
        raise ValueError('Expected a JSON object')
    return obj

def apply_scene_patch(scene,patches):
    """A bounded subset of JSON Patch; the original scene is preserved on errors."""
    if not isinstance(patches,list) or not 1<=len(patches)<=32:raise ValueError('Return 1..32 targeted patches.')
    result=copy.deepcopy(scene)
    roots={'title','summary','materials','assets','instances','shots','environment','lights','paths','scatter','render'}
    for patch in patches:
        if not isinstance(patch,dict) or patch.get('op') not in ('add','replace','remove'):raise ValueError('Unsupported scene patch operation.')
        path=patch.get('path')
        if not isinstance(path,str) or not path.startswith('/') or len(path)>1024:raise ValueError('Invalid JSON Pointer path.')
        parts=path[1:].split('/')
        if any(re.search(r'~(?![01])',part) for part in parts):raise ValueError('Invalid JSON Pointer escape.')
        parts=[part.replace('~1','/').replace('~0','~') for part in parts]
        if parts[0] not in roots:raise ValueError('Patch must target scene data only.')
        parent=result
        try:
            for part in parts[:-1]:
                if isinstance(parent,list):
                    if re.fullmatch(r'0|[1-9][0-9]*',part):index=int(part)
                    else:
                        matches=[i for i,item in enumerate(parent) if isinstance(item,dict) and item.get('id')==part]
                        if len(matches)!=1:raise ValueError('Unknown or ambiguous array item: '+part)
                        index=matches[0]
                    parent=parent[index]
                elif isinstance(parent,dict):parent=parent[part]
                else:raise ValueError('Patch parent is not a container.')
            key=parts[-1];operation=patch['op']
            if operation!='remove' and 'value' not in patch:raise ValueError('Patch value is missing.')
            if isinstance(parent,list):
                if key=='-' and operation=='add':index=len(parent)
                elif re.fullmatch(r'0|[1-9][0-9]*',key):index=int(key)
                else:
                    matches=[i for i,item in enumerate(parent) if isinstance(item,dict) and item.get('id')==key]
                    if len(matches)==1:index=matches[0]
                    elif not matches and operation=='add' and isinstance(patch.get('value'),dict) and patch['value'].get('id')==key:index=len(parent)
                    else:raise ValueError('Unknown or ambiguous array item: '+key)
                if operation=='add':
                    if not 0<=index<=len(parent):raise ValueError('Array index is out of range.')
                    parent.insert(index,copy.deepcopy(patch['value']))
                elif operation=='remove':del parent[index]
                else:parent[index]=copy.deepcopy(patch['value'])
            elif isinstance(parent,dict):
                if operation in ('replace','remove') and key not in parent:raise ValueError('Patch target does not exist: '+path)
                if operation=='remove':del parent[key]
                else:parent[key]=copy.deepcopy(patch['value'])
            else:raise ValueError('Patch parent is not a container.')
        except (KeyError,IndexError,TypeError) as error:raise ValueError('Patch target does not exist: '+path) from error
    return result

def repair_delimiters(raw):
    """Only remove unmatched closing delimiters outside strings; never invent data."""
    public=raw.rsplit('</think>',1)[-1].strip();start=public.find('{')
    if start<0:raise ValueError('No JSON object')
    stack=[];out=[];quoted=False;escaped=False;removed=0
    for c in public[start:]:
        if quoted:
            out.append(c)
            if escaped:escaped=False
            elif c=='\\':escaped=True
            elif c=='"':quoted=False
        elif c=='"':quoted=True;out.append(c)
        elif c in '{[':stack.append(c);out.append(c)
        elif c in '}]':
            expected='{' if c=='}' else '['
            if stack and stack[-1]==expected:stack.pop();out.append(c)
            else:removed+=1
        else:out.append(c)
    if not removed or stack or quoted:raise ValueError('Cannot repair JSON by deleting unmatched closers')
    return parse_json(''.join(out)),removed

def number(x, lo, hi, name):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or not lo <= x <= hi:
        raise ValueError(f'{name}: expected finite number in [{lo}, {hi}]')
    return x

def vector(x, name, lo=-100, hi=100):
    if not isinstance(x, list) or len(x) != 3:
        raise ValueError(f'{name}: expected three numbers')
    return [number(v, lo, hi, name) for v in x]

def identifier(x):
    if not isinstance(x, str) or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_-]{0,47}', x):
        raise ValueError(f'Invalid ID: {str(x)[:60]}')
    return x

def sequence(x, lo, hi, name):
    if not isinstance(x, list) or not lo <= len(x) <= hi or not all(isinstance(v, dict) for v in x):
        raise ValueError(f'{name}: expected {lo}..{hi} objects')
    return x

def validate(scene, duration):
    if isinstance(scene,dict) and scene.get('version')==2:
        try:return validate_advanced(scene,duration)
        except (TypeError,KeyError,AttributeError,OverflowError,RecursionError) as error:raise ValueError('Malformed scene field: '+str(error)) from error
    if not isinstance(scene,dict):raise ValueError('Scene must be an object')
    if scene.get('version') not in (None,1):raise ValueError('Unsupported scene version')
    s = copy.deepcopy(scene)
    for field in ('title', 'summary'):
        if not isinstance(s.get(field), str) or not 1 <= len(s[field]) <= 3000:
            raise ValueError(f'Missing or overlong {field}')
    mats = set()
    for m in sequence(s.get('materials'), 1, 20, 'materials'):
        mid = identifier(m.get('id'))
        if mid in mats: raise ValueError('Duplicate material ID')
        mats.add(mid)
        if not re.fullmatch('#[0-9a-fA-F]{6}', m.get('color', '')): raise ValueError('Material color must be #RRGGBB')
        for k, default, hi in [('metallic', 0, 1), ('roughness', .4, 1), ('emission', 0, 5)]:
            m[k] = number(m.get(k, default), 0, hi, k)
    assets = set(); total = 0; costs = {}
    for a in sequence(s.get('assets'), 1, 6, 'assets'):
        aid = identifier(a.get('id'))
        if aid in assets: raise ValueError('Duplicate asset ID')
        assets.add(aid)
        costs[aid] = 0
        if not isinstance(a.get('name'), str) or len(a['name']) > 200: raise ValueError('Invalid asset name')
        if 'allow_disconnected' in a and not isinstance(a['allow_disconnected'],bool):raise ValueError('allow_disconnected must be boolean')
        part_ids = set()
        for p in sequence(a.get('parts'), 1, 80, 'parts'):
            total += 1
            pid = identifier(p.get('id'))
            if pid in part_ids: raise ValueError('Duplicate part ID')
            part_ids.add(pid)
            if p.get('shape') not in SHAPES: raise ValueError(f'Unsupported shape: {p.get("shape")}')
            if p.get('material') not in mats: raise ValueError(f'Unknown material: {p.get("material")}')
            p['position'] = vector(p.get('position', [0, 0, 0]), 'part position')
            p['rotation'] = vector(p.get('rotation', [0, 0, 0]), 'part rotation', -3600, 3600)
            if p['shape'] in ('box', 'sphere', 'planet', 'panel'):
                p['size'] = vector(p.get('size'), 'size', .001, 100)
            if p['shape'] in ('cylinder', 'cone', 'torus', 'rod', 'dish'):
                p['radius'] = number(p.get('radius'), .001, 50, 'radius')
            if p['shape'] in ('cylinder', 'cone', 'dish'):
                p['depth'] = number(p.get('depth'), .001, 100, 'depth')
            if p['shape'] == 'cone': p['radius_top'] = number(p.get('radius_top', 0), 0, 50, 'radius_top')
            if p['shape'] == 'torus': p['thickness'] = number(p.get('thickness', .04), .001, 10, 'thickness')
            if p['shape'] == 'rod':
                p['start'] = vector(p.get('start'), 'rod start'); p['end'] = vector(p.get('end'), 'rod end')
                if sum((x-y)**2 for x,y in zip(p['start'], p['end'])) < 1e-8: raise ValueError('Zero-length rod')
            if p['shape'] == 'panel':
                for k, mx in [('rows', 12), ('columns', 16)]:
                    if not isinstance(p.get(k, 5), int): raise ValueError('Panel grid must use integers')
                    p[k] = int(number(p.get(k, 5), 2, mx, k))
            p['bevel'] = number(p.get('bevel', .02), 0, .5, 'bevel')
            costs[aid] += 5+p['rows']*p['columns'] if p['shape']=='panel' else 1
    if total > 80: raise ValueError('More than 80 parts')
    ids = set(); object_budget = 0
    for i in sequence(s.get('instances'), 1, 12, 'instances'):
        iid = identifier(i.get('id'))
        if iid in ids: raise ValueError('Duplicate instance ID')
        ids.add(iid)
        if i.get('asset') not in assets: raise ValueError('Instance references unknown asset')
        object_budget += costs[i['asset']]
        if object_budget > 4000: raise ValueError('Scene exceeds the 4,000 generated-object budget')
        i['position'] = vector(i.get('position', [0,0,0]), 'instance position')
        i['rotation'] = vector(i.get('rotation', [0,0,0]), 'instance rotation', -3600, 3600)
        i['scale'] = vector(i.get('scale', [1,1,1]), 'instance scale', .001, 100)
        frames = sequence(i.get('animation', []), 0, 8, 'animation')
        prev = -1
        for f in frames:
            t = number(f.get('time'), 0, duration, 'keyframe time')
            if t <= prev: raise ValueError('Animation keyframes must be ordered')
            prev = t
            for k in ('position', 'rotation', 'scale'):
                if k in f:
                    lo,hi={'position':(-100,100),'rotation':(-3600,3600),'scale':(.001,100)}[k]
                    vector(f[k],k,lo,hi)
    instance_assets={i['id']:next(a for a in s['assets'] if a['id']==i['asset']) for i in s['instances']}
    end = 0
    for shot in sequence(s.get('shots'), 1, 6, 'shots'):
        start = number(shot.get('start'), 0, duration, 'shot start')
        stop = number(shot.get('end'), 0, duration, 'shot end')
        if abs(start-end) > .02 or stop <= start: raise ValueError('Shots must be contiguous and nonempty')
        end = stop
        if not isinstance(shot.get('label'), str) or len(shot['label']) > 200: raise ValueError('Invalid shot label')
        shot['camera_end'] = shot.get('camera_end', copy.deepcopy(shot.get('camera')))
        for k in ('camera', 'camera_end'):
            c = shot.get(k)
            if not isinstance(c, dict): raise ValueError('Missing camera')
            c['lens'] = number(c.get('lens', 45), 18, 100, 'lens')
            for flag in ('include_context','allow_backface'):
                if flag in c and not isinstance(c[flag],bool):raise ValueError('Camera flags must be booleans')
            if 'focus' in c:
                if not isinstance(c['focus'],str):raise ValueError('Invalid camera focus')
                iid,_,pid=c['focus'].partition(':')
                if iid not in instance_assets:raise ValueError('Camera focus references unknown instance')
                if pid and pid not in {p['id'] for p in instance_assets[iid]['parts']}:raise ValueError('Camera focus references unknown part')
                c['azimuth']=number(c.get('azimuth',-60),-3600,3600,'camera azimuth')
                c['elevation']=number(c.get('elevation',30),-80,85,'camera elevation')
                c['margin']=number(c.get('margin',1.2),1.05,3,'camera margin')
            else:
                vector(c.get('position'), 'camera position'); vector(c.get('target'), 'camera target')
                if sum((x-y)**2 for x,y in zip(c['position'], c['target'])) < .01: raise ValueError('Camera at target')
    if abs(end-duration) > .02: raise ValueError('Shots must cover full duration')
    env = s.get('environment', {})
    if not isinstance(env, dict) or env.get('theme', 'studio') not in ('space', 'studio', 'sky'): raise ValueError('Invalid environment')
    for field in ('ground', 'stars'):
        if field in env and not isinstance(env[field], bool): raise ValueError('Environment flags must be booleans')
    s['environment'] = env
    return s
