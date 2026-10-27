#!/usr/bin/env python3
"""Loopback-only app. HTTP stays responsive while the main thread owns MLX."""
import argparse
import copy
import http.server
import json
import mimetypes
import os
import queue
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlparse,unquote
from pipeline import Director,Job,Cancelled,ROOT,MODEL,BLENDER,FFMPEG,run,atomic_json
from models import Catalog,describe_router
import lmstudio_backend as studio
import openrouter_backend as router
from production_settings import settings as production_settings
from schema import validate
from scene_v2 import CAPABILITIES
from demo_scenes import DEMOS
import asset_library
import speech

PUBLIC=ROOT/'public';JOBS=ROOT/'jobs';JOBS.mkdir(exist_ok=True)
TOKEN=secrets.token_urlsafe(32)
jobs={};pending=queue.Queue();lock=threading.RLock()
catalog=Catalog(provider_only='openrouter')
state={'model_state':'cold','active_job':None,'model':None,'model_path':None,'selected_model':None,
       'loaded_model':None,'loaded_model_path':None,'model_loaded_at':None,'model_operation':None,'model_error':None,
       'memory':{'backend':'openrouter','active_bytes':None,'cache_bytes':None,'peak_bytes':None,'weights_bytes':0},'adapter':None,'reasoning':True,'vision':True,'provider_lock':'openrouter'}
def selected_status(entry):
    state.update(selected_model=entry['id'],model=entry['name'],model_path=entry['path'],reasoning=entry['reasoning'],vision=entry['vision'],backend=entry.get('backend','mlx'))
if catalog.selected():selected_status(catalog.selected())

def model_task(task,director):
    """Runs on the MLX owner thread; HTTP handlers only enqueue operations."""
    error=None
    try:
        if task['action']=='load':
            entry=catalog.get(task['model_id'])
            director.configure(entry);director.load()
        else:director.unload()
    except Exception as exc:
        error=str(exc)
    # Drop the exception traceback before collecting partial model tensors.
    if error:
        try:director.unload()
        except Exception:pass
        state.update(model_state='error',model_error=error)
    with lock:
        state['model_operation']=None
def load_jobs():
    for f in sorted(JOBS.glob('*/job.json')):
        try:
            data=json.loads(f.read_text())
            if data['status'] in ('queued','running'):
                data.update(status='interrupted',stage='error',message='Server restarted. Continue this run from its saved checkpoints.')
                atomic_json(f,data)
            jobs[data['id']]=Job(f.parent,data)
        except (ValueError,KeyError):pass

def enqueue_scene(scene,settings,source,parent=None):
    """Caller holds lock; scene has been validated before creating files."""
    jid=secrets.token_hex(8);folder=JOBS/jid;folder.mkdir()
    descriptor={'id':source,'backend':'none','name':'Built-in tool demonstration' if source=='built_in_demo' else 'Imported scene','path':source,'vision':False}
    job=Job(folder,{'id':jid,'prompt':scene['summary'],'title':scene['title'],'model':descriptor,'source':source,'use_model':False,
        'parent_job':parent,'settings':settings,'created_at':time.time(),'status':'queued','stage':'queued','message':'Waiting for Blender.',
        'events':[],'assets':[],'previews':[],'versions':[],'plan':{'visual_direction':scene['summary'],'shots':scene['shots']}})
    atomic_json(folder/'scene-initial.json',scene);atomic_json(folder/'scene.json',scene)
    job.update();jobs[jid]=job;state['active_job']=jid;pending.put(job);return job

class Handler(http.server.BaseHTTPRequestHandler):
    server_version='OrbitLocal/1'
    def log_message(self,fmt,*args):
        if not self.path.startswith('/api/jobs/') and self.path not in ('/api/status','/api/jobs'):super().log_message(fmt,*args)
    def local_request(self,mutation=False):
        if self.headers.get('Host') not in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}:
            self.send_error(403,'Invalid host');return False
        origin=self.headers.get('Origin')
        allowed={f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}
        if origin and origin not in allowed:
            self.send_error(403,'Cross-origin access denied');return False
        if mutation and self.headers.get('X-Orbit-Token')!=TOKEN:
            self.send_error(403,'Missing session token');return False
        return True
    def json(self,data,code=200):
        body=json.dumps(data,ensure_ascii=False).encode();self.send_response(code);self.headers_out('application/json',len(body));self.end_headers();self.wfile.write(body)
    def headers_out(self,typ,size):
        self.send_header('Content-Type',typ);self.send_header('Content-Length',str(size));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
    def file(self,path):
        if not path.is_file():self.send_error(404);return
        size=path.stat().st_size;start=0;end=size-1;partial=False
        r=self.headers.get('Range','')
        if r:
            match=re.fullmatch(r'bytes=(\d*)-(\d*)',r)
            if not match or not any(match.groups()):self.send_error(416);return
            a,b=match.groups()
            if not a:start=max(0,size-int(b))
            else:start=int(a);end=min(int(b),end) if b else end
            if start>end or start>=size:self.send_error(416);return
            partial=True
        self.send_response(206 if partial else 200)
        self.headers_out(mimetypes.guess_type(path.name)[0] or 'application/octet-stream',end-start+1)
        self.send_header('Accept-Ranges','bytes')
        if partial:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        if path.suffix=='.blend':self.send_header('Content-Disposition','attachment; filename="project.blend"')
        self.end_headers()
        with path.open('rb') as f:
            f.seek(start);left=end-start+1
            while left>0:
                data=f.read(min(left,256*1024))
                if not data:break
                self.wfile.write(data);left-=len(data)
    def do_GET(self):
        if not self.local_request():return
        p=unquote(urlparse(self.path).path)
        if p=='/api/status':
            with lock:out=copy.deepcopy(state)
            out.update(token=TOKEN,ready=bool(out['selected_model']) and BLENDER.is_file() and Path(FFMPEG).is_file())
            out['openrouter']=router.key_status()
            return self.json(out)
        if p=='/api/models':
            if urlparse(self.path).query=='refresh=1':catalog.refresh()
            return self.json({'models':catalog.list()})
        if p=='/api/capabilities':return self.json(CAPABILITIES)
        if p=='/api/library':return self.json(asset_library.catalog())
        if p=='/api/voices':return self.json(speech.voices())
        library=re.fullmatch(r'/library/((?:image|model)_[a-f0-9]{32})\.(png|glb)',p)
        if library:
            try:path=asset_library.asset_path(library[1])
            except (ValueError,OSError):return self.send_error(404)
            return self.file(path)
        if p=='/api/demos':return self.json([{'id':key,**{k:v for k,v in item.items() if k!='builder'}} for key,item in DEMOS.items()])
        if p=='/api/jobs':
            with lock:items=[j.snapshot() for j in jobs.values()]
            return self.json(sorted(items,key=lambda x:x['created_at'],reverse=True))
        m=re.fullmatch(r'/api/jobs/([a-f0-9]{16})',p)
        if m:
            with lock:j=jobs.get(m[1])
            return self.json(j.snapshot()) if j else self.send_error(404)
        if p.startswith('/artifacts/'):
            rel=Path(p[len('/artifacts/'):]);target=(JOBS/rel).resolve()
            if not target.is_relative_to(JOBS.resolve()) or any(x.startswith('.') for x in rel.parts):self.send_error(403);return
            if target.suffix not in ('.png','.mp4','.blend','.glb','.json','.txt','.log'):self.send_error(403);return
            return self.file(target)
        target=(PUBLIC/('index.html' if p=='/' else p.lstrip('/'))).resolve()
        if not target.is_relative_to(PUBLIC.resolve()):self.send_error(403);return
        self.file(target)
    def do_POST(self):
        if not self.local_request(True):return
        p=urlparse(self.path).path
        if p in ('/api/library/image','/api/library/model','/api/library/audio'):
            try:
                limit=asset_library.MAX_IMAGE if p.endswith('/image') else asset_library.MAX_MODEL if p.endswith('/model') else asset_library.MAX_AUDIO
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=limit:raise ValueError(f'Upload must be at most {limit//1024**2} MiB')
                name=unquote(self.headers.get('X-Asset-Name','Uploaded asset'))
                data=self.rfile.read(length)
                if len(data)!=length:raise ValueError('Incomplete upload')
                item=asset_library.add_image(data,name) if p.endswith('/image') else asset_library.add_model(data,name) if p.endswith('/model') else asset_library.add_audio(data,name)
                return self.json(item,201)
            except (ValueError,OSError,RecursionError) as error:return self.json({'error':str(error)},400)
        try:
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError('Expected application/json')
            length=int(self.headers.get('Content-Length','0'))
            limit=4*1024**2 if urlparse(self.path).path in ('/api/jobs/from-scene','/api/scene/validate') else 16384
            if not 0<length<=limit:raise ValueError('Request body too large or empty')
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('Expected an object')
        except (ValueError,TypeError,RecursionError) as e:return self.json({'error':str(e)},400)
        p=urlparse(self.path).path
        if p in ('/api/jobs/from-scene','/api/scene/validate','/api/demos/render'):
            try:
                if p=='/api/demos/render':
                    demo=DEMOS.get(data.get('demo'))
                    if not demo:raise ValueError('Unknown tool demonstration.')
                    settings=production_settings(data,demo['duration']);scene=validate(demo['builder'](),demo['duration']);source='built_in_demo'
                else:
                    settings=production_settings(data);scene=validate(data.get('scene'),settings['duration']);source='imported_scene'
                settings['reviews']=0
            except (ValueError,TypeError,KeyError,AttributeError) as error:return self.json({'error':str(error)},400)
            if p=='/api/scene/validate':return self.json({'valid':True,'title':scene['title'],'capability_summary':scene.get('capability_summary')})
            with lock:
                if state['active_job'] or state['model_operation']:return self.json({'error':'Wait for the current operation to finish.'},409)
                parent=data.get('parent_job')
                if parent is not None and (not isinstance(parent,str) or not re.fullmatch('[a-f0-9]{16}',parent)):return self.json({'error':'Invalid parent job.'},400)
                job=enqueue_scene(scene,settings,source,parent)
            return self.json(job.snapshot(),202)
        if p=='/api/openrouter/key':
            with lock:
                if state['active_job'] or state['model_operation']:return self.json({'error':'Wait for the current operation before changing the API key.'},409)
                if data.get('clear') is True:router.clear_key()
                else:
                    try:router.set_key(data.get('api_key'))
                    except ValueError as error:return self.json({'error':str(error)},400)
                if state.get('backend')=='openrouter':state.update(model_state='cold',loaded_model=None,loaded_model_path=None,model_error=None)
            return self.json(router.key_status())
        if p=='/api/models/add':
            try:entry=catalog.add(data.get('path'))
            except (ValueError,OSError,TypeError,AttributeError) as e:return self.json({'error':str(e)},400)
            return self.json({'model':entry,'models':catalog.list()},201)
        if p in ('/api/models/select','/api/models/load','/api/models/unload'):
            with lock:
                if state['active_job'] or state['model_operation']:
                    return self.json({'error':'Wait for the current animation or model operation to finish before switching models.'},409)
                if p!='/api/models/unload':
                    try:entry=catalog.select(data.get('model_id'))
                    except (ValueError,OSError,TypeError,AttributeError,studio.StudioError) as e:return self.json({'error':str(e)},400)
                    selected_status(entry);state['model_error']=None
                    if state['model_state']=='error':state['model_state']='cold'
                if p.endswith('/select'):return self.json(copy.deepcopy(state))
                action='unload' if p.endswith('/unload') else 'load'
                state['model_error']=None
                state['model_operation']={'action':action,'model_id':state['selected_model'],'started_at':time.time()}
                state['model_state']='unloading' if action=='unload' else 'loading'
                pending.put({'kind':'model','action':action,'model_id':state['selected_model']})
                return self.json(copy.deepcopy(state),202)
        if p=='/api/jobs':
            prompt=data.get('prompt','')
            if not isinstance(prompt,str) or not 8<=len(prompt.strip())<=4000:return self.json({'error':'Write a brief between 8 and 4,000 characters.'},400)
            try:settings=production_settings(data)
            except ValueError as error:return self.json({'error':str(error)},400)
            with lock:
                if state['active_job'] or state['model_operation']:return self.json({'error':'Wait for the current animation or model operation to finish.'},409)
                try:entry=catalog.get(state['selected_model'])
                except (ValueError,OSError,studio.StudioError) as e:return self.json({'error':str(e)},400)
                if entry.get('backend')=='openrouter' and not router.key_status()['configured']:return self.json({'error':'Add an OpenRouter API key before creating an animation.'},400)
                references=data.get('references',[])
                if not isinstance(references,list) or len(references)>4 or len(set(map(str,references)))!=len(references):return self.json({'error':'Choose at most four distinct image references.'},400)
                try:
                    for image in references:asset_library.get(image,'image')
                except (ValueError,OSError) as error:return self.json({'error':str(error)},400)
                jid=secrets.token_hex(8);folder=JOBS/jid;folder.mkdir()
                j=Job(folder,{'id':jid,'prompt':prompt.strip(),'title':'Untitled animation','model':entry,'source':'model_generated','use_model':True,'references':references,'library_catalog':[a for a in asset_library.catalog() if a['kind']!='audio'][:64],'settings':settings,'created_at':time.time(),'status':'queued','stage':'queued','message':'Waiting for the director.','events':[],'assets':[],'previews':[],'versions':[]})
                j.update();jobs[jid]=j;state['active_job']=jid;pending.put(j)
            return self.json(j.snapshot(),202)
        m=re.fullmatch(r'/api/jobs/([a-f0-9]{16})/cancel',p)
        if m:
            with lock:j=jobs.get(m[1])
            if not j:return self.json({'error':'Run not found'},404)
            if j.data['status'] not in ('queued','running'):return self.json({'error':'Run is no longer active'},409)
            j.cancel.set();j.event(j.data['stage'],'Stopping after the current operation…')
            return self.json({'ok':True})
        m=re.fullmatch(r'/api/jobs/([a-f0-9]{16})/refine',p)
        if m:
            instruction=data.get('instruction','')
            reviews=data.get('reviews',2)
            if not isinstance(instruction,str) or not 8<=len(instruction.strip())<=2000:return self.json({'error':'Describe the improvement in 8 to 2,000 characters.'},400)
            if type(reviews) is not int or not 1<=reviews<=5:return self.json({'error':'Choose 1 to 5 refinement reviews.'},400)
            with lock:
                if state['active_job'] or state['model_operation']:return self.json({'error':'Wait for the current operation to finish.'},409)
                parent=jobs.get(m[1])
                if not parent:return self.json({'error':'Animation not found.'},404)
                if parent.data['status']!='complete' or not (parent.folder/'scene.json').is_file():return self.json({'error':'Choose a completed animation with a saved scene.'},409)
                try:
                    entry=catalog.get(state['selected_model'])
                    if entry.get('backend')=='openrouter' and not router.key_status()['configured']:raise ValueError('Add an OpenRouter key before refining.')
                    settings=copy.deepcopy(parent.data['settings']);settings['reviews']=reviews
                    scene=validate(json.loads((parent.folder/'scene.json').read_text()),settings['duration'])
                except (ValueError,OSError,studio.StudioError) as error:return self.json({'error':str(error)},400)
                jid=secrets.token_hex(8);folder=JOBS/jid;folder.mkdir()
                plan=copy.deepcopy(parent.data.get('plan',{}))
                plan.setdefault('title',parent.data['title']);plan.setdefault('shots',scene['shots'])
                child=Job(folder,{'id':jid,'prompt':parent.data['prompt'],'title':parent.data['title'],'model':entry,
                    'source':'model_refinement','parent_job':parent.data['id'],'use_model':True,'use_saved_plan':True,
                    'refinement_instruction':instruction.strip(),'references':parent.data.get('references',[]),
                    'library_catalog':[a for a in asset_library.catalog() if a['kind']!='audio'][:64],
                    'plan':plan,'settings':settings,'created_at':time.time(),'status':'queued','stage':'queued',
                    'message':'Waiting to improve the existing animation.','events':[],'assets':[],'previews':[],'versions':[]})
                atomic_json(folder/'scene-initial.json',scene);atomic_json(folder/'scene.json',scene);atomic_json(folder/'plan.json',plan)
                if (parent.folder/'blueprint.json').is_file():(folder/'blueprint.json').write_bytes((parent.folder/'blueprint.json').read_bytes())
                child.update();jobs[jid]=child;state['active_job']=jid;pending.put(child)
            return self.json(child.snapshot(),202)
        m=re.fullmatch(r'/api/jobs/([a-f0-9]{16})/retry',p)
        if m:
            with lock:
                j=jobs.get(m[1])
                if not j:return self.json({'error':'Run not found'},404)
                if state['active_job'] or state['model_operation']:return self.json({'error':'Another animation or model operation is active'},409)
                if j.data['status'] not in ('failed','cancelled','interrupted'):return self.json({'error':'This run cannot be retried'},409)
                reviews=data.get('reviews',j.data['settings']['reviews'])
                if type(reviews) is not int or not 0<=reviews<=5:return self.json({'error':'Review budget must be 0 to 5'},400)
                j.data['settings']['reviews']=reviews
                if 'engine' in data:
                    if data['engine'] not in ('eevee','cycles'):return self.json({'error':'Unsupported renderer'},400)
                    j.data['settings']['engine']=data['engine']
                    j.data['settings']['samples']=64 if data['engine']=='eevee' else 48
                render_only=data.get('render_only',j.data.get('render_checkpoint',False))
                if not isinstance(render_only,bool):return self.json({'error':'render_only must be boolean'},400)
                if render_only and not (j.folder/'scene.json').is_file():return self.json({'error':'No completed scene available'},400)
                original=j.data.get('model',{'id':Director({}).entry['id']})
                if not render_only and j.data.get('use_model',True) and catalog.provider_only and (original.get('backend')!='openrouter' or original.get('api_model')!=router.MODEL_ID):
                    return self.json({'error':'Local model generation is disabled. Render the saved scene without a model, or improve a completed animation as a new DeepSeek version.'},409)
                if not render_only and j.data.get('use_model',True) and original['id']!=state['selected_model']:
                    return self.json({'error':'Choose the model originally used by this animation before continuing, or start a new animation with the selected model.'},409)
                j.data['render_only']=render_only
                j.cancel.clear();j.event('queued','Continuing from saved director answers and render checkpoints.',status='queued')
                j.data.pop('finished_at',None);j.data.pop('error_log',None);j.update()
                state['active_job']=j.data['id'];pending.put(j)
            return self.json(j.snapshot(),202)
        self.send_error(404)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8765);args=parser.parse_args()
    load_jobs()
    server=http.server.ThreadingHTTPServer(('127.0.0.1',args.port),Handler);server.daemon_threads=True
    threading.Thread(target=server.serve_forever,daemon=True).start()
    print(f'ANIMATION STUDIO READY http://127.0.0.1:{args.port}',flush=True)
    director=Director(state,provider_only='openrouter')
    director.configure(describe_router())
    try:
        while True:
            try:j=pending.get(timeout=2)
            except queue.Empty:
                if director.model is not None or director.remote_instance or director.cloud_connected:director.memory()
                continue
            if isinstance(j,dict) and j.get('kind')=='model':
                try:model_task(j,director)
                finally:pending.task_done()
                continue
            try:
                if not j.data.get('render_only') and j.data.get('use_model',True):
                    entry=catalog.get(j.data.get('model',Director({}).entry)['id'])
                    director.configure(entry)
                run(j,director)
            except Cancelled:j.event('cancelled','Production stopped. Files produced so far are preserved.',status='cancelled',finished_at=time.time())
            except Exception as e:
                import traceback
                (j.folder/'error.log').write_text(traceback.format_exc())
                j.event('error',str(e),status='failed',finished_at=time.time(),error_log=j.url(j.folder/'error.log'))
                print('JOB FAILED',j.data['id'],repr(e),flush=True)
            finally:
                if state['model_state']=='loading':
                    director.unload()
                with lock:state['active_job']=None
                pending.task_done()
    except KeyboardInterrupt:server.shutdown()

if __name__=='__main__':main()
