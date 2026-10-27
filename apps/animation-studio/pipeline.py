"""Model orchestration, visual review, Blender rendering and FFmpeg delivery."""
import copy
import base64
import gc
import hashlib
import json
import os
import re
import signal
import shutil
import subprocess
import threading
import time
from pathlib import Path

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TOKENIZERS_PARALLELISM='false', PYTHONDONTWRITEBYTECODE='1')
from schema import SCENE_GUIDE, parse_json, repair_delimiters, validate, apply_scene_patch
import lmstudio_backend as studio
import openrouter_backend as router
from scene_v2 import ident as scene_identifier,vec as scene_vector,GUIDE as V2_GUIDE
import asset_library
import speech
import json_output

ROOT=Path(__file__).resolve().parent
MODEL=Path(os.environ.get('ORBIT_MODEL',str(ROOT/'models'/'local-checkpoint')))
BLENDER=Path(os.environ.get('ORBIT_BLENDER','/Applications/Blender.app/Contents/MacOS/Blender'))
FFMPEG=os.environ.get('ORBIT_FFMPEG',shutil.which('ffmpeg') or 'ffmpeg')
FFPROBE=os.environ.get('ORBIT_FFPROBE',shutil.which('ffprobe') or 'ffprobe')

class Cancelled(Exception): pass

def atomic_json(path,obj):
    p=Path(path);tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2));tmp.replace(p)

class Job:
    def __init__(self, folder, data, changed=None):
        self.folder=Path(folder);self.data=data;self.cancel=threading.Event();self.lock=threading.RLock();self.changed=changed
    def update(self, **kw):
        with self.lock:
            self.data.update(kw);self.data['updated_at']=time.time();atomic_json(self.folder/'job.json',self.data)
    def event(self, stage, message, **kw):
        with self.lock:
            self.data.setdefault('events',[]).append({'time':time.time(),'stage':stage,'message':message})
            self.data['events']=self.data['events'][-120:]
            self.update(stage=stage,message=message,**kw)
    def check(self):
        if self.cancel.is_set():raise Cancelled('Stopped by user')
    def snapshot(self):
        with self.lock:return copy.deepcopy(self.data)
    def url(self,path):return '/artifacts/'+self.data['id']+'/'+str(Path(path).relative_to(self.folder))

class Director:
    def __init__(self,status,provider_only=None):
        self.provider_only=provider_only
        self.model=None;self.processor=None;self.json_tokenizer_data=None;self.remote_instance=None;self.cloud_connected=False;self.last_remote_check=0;self.status=status
        self.entry={'id':hashlib.sha256(str(MODEL.resolve()).encode()).hexdigest()[:16],
                    'name':'NVIDIA Nemotron 3.5 Bolt · 4-bit','path':str(MODEL),
                    'vision':True,'reasoning':True,'reasoning_format':'think','trust_remote_code':True}
    def configure(self,entry):
        self.check_provider(entry)
        if (self.model is not None or self.remote_instance or self.cloud_connected) and self.entry['id']!=entry['id']:self.unload()
        self.entry=dict(entry)
    def check_provider(self,entry=None):
        candidate=self.entry if entry is None else entry
        if self.provider_only=='openrouter' and (candidate.get('backend')!='openrouter' or candidate.get('api_model')!=router.MODEL_ID):
            raise ValueError('Only DeepSeek through OpenRouter is enabled. Local model inference is disabled.')
    def memory(self):
        if self.entry.get('backend')=='openrouter':
            result={'backend':'openrouter','active_bytes':None,'cache_bytes':None,'peak_bytes':None,'weights_bytes':0}
            self.status['memory']=result
            return result
        if self.entry.get('backend')=='lmstudio':
            if self.remote_instance and time.monotonic()-self.last_remote_check>5:
                self.last_remote_check=time.monotonic()
                try:
                    item=studio.find_model(self.entry['lm_model_key'])
                    if self.remote_instance not in [instance['id'] for instance in item.get('loaded_instances',[])]:
                        self.remote_instance=None
                        self.status.update(model_state='cold',loaded_model=None,loaded_model_path=None,model_loaded_at=None)
                except studio.StudioError as error:self.status.update(model_state='error',model_error=str(error))
            result={'backend':'lmstudio','active_bytes':None,'cache_bytes':None,'peak_bytes':None,'weights_bytes':self.entry['size_bytes'] if self.remote_instance else 0}
            self.status['memory']=result
            return result
        import mlx.core as mx
        result={'backend':'mlx','active_bytes':mx.get_active_memory(),'cache_bytes':mx.get_cache_memory(),'peak_bytes':mx.get_peak_memory()}
        self.status['memory']=result
        return result
    def unload(self):
        self.status.update(model_state='unloading')
        if self.cloud_connected:self.cloud_connected=False
        elif self.remote_instance:
            studio.request('POST','/api/v1/models/unload',{'instance_id':self.remote_instance},timeout=120)
            self.remote_instance=None
        elif self.entry.get('backend','mlx')=='mlx':
            import mlx.core as mx
            mx.synchronize()
            self.model=None;self.processor=None;self.json_tokenizer_data=None
            gc.collect();mx.clear_cache();mx.synchronize()
        self.status.update(model_state='cold',loaded_model=None,loaded_model_path=None,model_loaded_at=None)
        self.memory()
    def load(self,job=None):
        self.check_provider()
        if self.entry.get('backend')=='openrouter':
            if job:job.check()
            self.status.update(model_state='loading');router.verify_key()
            self.cloud_connected=True
            self.status.update(model_state='ready',loaded_model=self.entry['id'],loaded_model_path=self.entry['path'],model_loaded_at=time.time(),model_error=None)
            self.memory()
            return
        if self.entry.get('backend')=='lmstudio':
            if job:job.check()
            self.status.update(model_state='loading')
            item=studio.find_model(self.entry['lm_model_key']);instances=item.get('loaded_instances',[])
            if instances:self.remote_instance=instances[0]['id']
            else:
                others=[m.get('display_name',m['key']) for m in studio.models() if m.get('loaded_instances')]
                if others:raise studio.StudioError('Unload the other models in LM Studio before loading this model: '+', '.join(others))
                if job:job.event('loading','Loading '+self.entry['name']+' through local LM Studio…')
                loaded=studio.request('POST','/api/v1/models/load',{'model':self.entry['lm_model_key'],'context_length':32768,'flash_attention':True},timeout=600)
                self.remote_instance=loaded['instance_id']
            self.status.update(model_state='ready',loaded_model=self.entry['id'],loaded_model_path=self.entry['path'],model_loaded_at=time.time(),model_error=None)
            self.last_remote_check=time.monotonic()
            self.memory()
            if job:job.check()
            return
        if self.model is not None:
            self.status.update(model_state='ready')
            self.memory()
            return
        if job:job.event('loading',f'Loading {self.entry["name"]} into unified memory…')
        self.status.update(model_state='loading')
        try:external=sum(m.get('size_bytes',0) for m in studio.models() if m.get('loaded_instances'))
        except studio.StudioError:external=0
        if external+self.entry.get('size_bytes',0)>94*1024**3:
            raise studio.StudioError('A large model is already loaded in LM Studio. Unload it before loading this MLX model.')
        import mlx.core as mx
        from mlx_vlm import load
        mx.set_memory_limit(94*1024**3);mx.set_cache_limit(2*1024**3)
        self.model,self.processor=load(self.entry['path'],trust_remote_code=self.entry.get('trust_remote_code',False),local_files_only=True)
        self.prepare_prompt([{'role':'system','content':'Return JSON.'},{'role':'user','content':'Reply with a JSON object.'}])
        self.status.update(model_state='ready',loaded_model=self.entry['id'],loaded_model_path=self.entry['path'],model_loaded_at=time.time(),model_error=None)
        self.memory()
        if job:job.check()
    def public_answer(self,raw):
        fmt=self.entry.get('reasoning_format','think')
        if fmt=='think':
            if '</think>' not in raw:raise ValueError('The reasoning budget ended without a final answer. Try again with a simpler brief.')
            return raw.rsplit('</think>',1)[-1]
        if fmt=='harmony':
            parts=re.split(r'<\|(?:channel|meta_sep)\|>final<\|(?:message|im_sep)\|>',raw)
            if len(parts)<2:raise ValueError('The model ended without a final answer channel. Try a simpler brief.')
            return re.split(r'<\|(?:return|end|fim_suffix)\|>',parts[-1])[0]
        return raw
    def template_options(self):
        options={'enable_thinking':self.entry.get('reasoning',False)}
        # Effort vocabularies belong to each model's template. Qwen 3.8 uses
        # xhigh/medium/low; let it and other families choose their native default.
        if self.entry.get('reasoning_format')=='harmony':options['reasoning_effort']='high'
        return options
    @staticmethod
    def editing_step(name):return name.startswith('03-') or '-patch-' in name or 'format-repair' in name
    def prepare_prompt(self,history,num_images=0):
        from mlx_vlm.prompt_utils import apply_chat_template
        return apply_chat_template(self.processor,self.model.config,history,num_images=num_images,**self.template_options())
    def decode(self,job,name,raw,repair=True):
        public=self.public_answer(raw)
        try:return parse_json(public)
        except (ValueError,json.JSONDecodeError) as error:
            try:
                obj,removed=repair_delimiters(public)
                atomic_json(job.folder/'director'/(name+'.format-repair.json'),{'method':'delete unmatched closing delimiters outside strings','removed':removed,'original_preserved':True})
                job.event(job.data['stage'],'Corrected JSON punctuation in the director answer; the original is preserved.')
                return obj
            except ValueError:
                if not repair:raise error
                job.event(job.data['stage'],'The model is repairing the answer format before continuing.')
                return self.generate(job,name+'-format-repair',
                    'You repair JSON syntax only. Preserve the intended keys, values and data. Return exactly one valid JSON object. Do not add features or commentary.',
                    'Parser error: '+str(error)+'\nMalformed public JSON:\n'+public,
                    max_tokens=16384,thinking=1024,repair=False)
    def generate(self,job,name,system,user,images=None,max_tokens=12288,thinking=4096,repair=True):
        job.check();self.load(job)
        folder=job.folder/'director';folder.mkdir(exist_ok=True)
        cached=folder/(name+'.raw.txt')
        if cached.exists() and (folder/(name+'.metrics.json')).exists():
            raw=cached.read_text()
            try:self.public_answer(raw)
            except ValueError:
                # Older versions marked reasoning-only answers complete. Preserve
                # the receipt, but do not reuse a checkpoint with no final answer.
                (folder/(name+'.metrics.json')).replace(folder/(name+'.incomplete.metrics.json'))
            else:return self.decode(job,name,raw,repair)
        if cached.exists():cached.rename(folder/(name+f'.incomplete-{time.time_ns()}.txt'))
        if self.entry.get('backend')=='openrouter':
            return self.generate_router(job,name,system,user,images,max_tokens,repair)
        if self.entry.get('backend')=='lmstudio':
            return self.generate_studio(job,name,system,user,images,max_tokens,repair)
        import mlx.core as mx
        from mlx_vlm import stream_generate
        history=[{'role':'system','content':system},{'role':'user','content':user}]
        reasoning=self.entry.get('reasoning',False);think_format=self.entry.get('reasoning_format')=='think'
        template_options=self.template_options()
        atomic_json(folder/(name+'.request.json'),{'messages':history,'images':images or [],'max_tokens':max_tokens,'thinking_budget':thinking if think_format else None,'template_options':template_options,'model':self.entry['path'],'adapter':None})
        prompt=self.prepare_prompt(history,num_images=len(images or []))
        start=time.monotonic();chunks=[];last=None;last_update=0
        job.update(generation={'step':name,'tokens':0,'seconds':0,'reasoning':reasoning})
        generation_options={'max_tokens':max_tokens,'temperature':.35 if self.editing_step(name) else 1.0,'top_p':.95,'enable_thinking':think_format}
        grammar=json_output.schema_for(name)
        if grammar and self.entry.get('reasoning_format') in ('think','plain'):
            tokenizer=getattr(self.processor,'tokenizer',self.processor)
            if self.json_tokenizer_data is None:
                job.event(job.data['stage'],'Preparing constrained JSON output for visual reviews.')
                self.json_tokenizer_data=json_output.tokenizer_data(tokenizer)
            end=tokenizer.encode('</think>',add_special_tokens=False) if think_format else []
            generation_options['logits_processors']=[json_output.JsonOutput(self.json_tokenizer_data,grammar,end)]
        if think_format:generation_options['thinking_budget']=thinking
        with (folder/(name+'.raw.txt')).open('w') as rawfile:
            for r in stream_generate(self.model,self.processor,prompt,image=images,**generation_options):
                job.check();chunks.append(r.text);rawfile.write(r.text);last=r
                now=time.monotonic()
                if now-last_update>1:
                    last_update=now;rawfile.flush()
                    job.update(generation={'step':name,'tokens':r.generation_tokens,'seconds':round(now-start,1),'reasoning':reasoning})
        if last is None:raise ValueError('The local model returned no answer')
        raw=''.join(chunks)
        stats={k:getattr(last,k,None) for k in ['generation_tokens','prompt_tokens','generation_tps','peak_memory']}
        stats.update(step=name,seconds=round(time.monotonic()-start,1),reasoning=reasoning,model=self.entry['id'])
        answer_error=None
        try:self.public_answer(raw)
        except ValueError as error:answer_error=error
        stats['complete']=answer_error is None
        atomic_json(folder/(name+('.metrics.json' if answer_error is None else '.incomplete.metrics.json')),stats)
        totals=job.snapshot().get('usage',{'tokens':0,'generation_seconds':0,'calls':0,'peak_memory_gb':0})
        totals['tokens']+=stats.get('generation_tokens') or 0;totals['generation_seconds']+=stats['seconds'];totals['calls']+=1
        totals['peak_memory_gb']=max(totals['peak_memory_gb'],stats.get('peak_memory') or 0)
        job.update(generation=stats,usage=totals)
        mx.clear_cache()
        self.memory()
        if answer_error:raise answer_error
        return self.decode(job,name,raw,repair)
    def generate_studio(self,job,name,system,user,images,max_tokens,repair):
        folder=job.folder/'director';inputs=[{'type':'text','content':user}]
        for path in images or []:
            data=Path(path).read_bytes()
            if len(data)>16*1024**2:raise ValueError('A review image exceeds 16 MiB.')
            inputs.append({'type':'image','data_url':'data:image/png;base64,'+base64.b64encode(data).decode()})
        payload={'model':self.remote_instance,'input':inputs,'system_prompt':system,
                 'max_output_tokens':max_tokens,'temperature':.35 if self.editing_step(name) else 1.0,'top_p':.95,'stream':True,'store':False,'integrations':[]}
        if self.entry.get('reasoning_option'):payload['reasoning']=self.entry['reasoning_option']
        atomic_json(folder/(name+'.request.json'),{'messages':[{'role':'system','content':system},{'role':'user','content':user}],
                    'images':images or [],'max_tokens':max_tokens,'model':self.entry['path'],'backend':'lmstudio','adapter':None,'reasoning':payload.get('reasoning')})
        start=time.monotonic();chunks=0;last_update=0
        job.update(generation={'step':name,'tokens':None,'chunks':0,'seconds':0,'reasoning':self.entry['reasoning'],'backend':'lmstudio'})
        with (folder/(name+'.raw.txt')).open('w') as public,(folder/(name+'.reasoning.txt')).open('w') as private:
            def event(data):
                nonlocal chunks,last_update
                typ=data.get('type')
                if typ=='message.delta':public.write(data.get('content',''));chunks+=1
                elif typ=='reasoning.delta':private.write(data.get('content',''));chunks+=1
                now=time.monotonic()
                if now-last_update>1:
                    last_update=now;public.flush();private.flush()
                    job.update(generation={'step':name,'tokens':None,'chunks':chunks,'seconds':round(now-start,1),'reasoning':self.entry['reasoning'],'backend':'lmstudio','phase':typ})
            try:result=studio.stream_chat(payload,job.cancel,event)
            except studio.StudioCancelled:job.check();raise
        job.check()
        answer=''.join(item.get('content','') for item in result.get('output',[]) if item.get('type')=='message')
        if not answer.strip():raise ValueError('LM Studio returned no final answer. Increase the response/context budget or simplify the brief.')
        (folder/(name+'.raw.txt')).write_text(answer)
        native=result.get('stats',{})
        stats={'step':name,'generation_tokens':native.get('total_output_tokens',0),'prompt_tokens':native.get('input_tokens'),
               'generation_tps':native.get('tokens_per_second'),'seconds':round(time.monotonic()-start,1),
               'reasoning':self.entry['reasoning'],'model':self.entry['id'],'backend':'lmstudio','reasoning_tokens':native.get('reasoning_output_tokens')}
        atomic_json(folder/(name+'.metrics.json'),stats)
        totals=job.snapshot().get('usage') or {'tokens':0,'generation_seconds':0,'calls':0,'peak_memory_gb':None}
        totals['tokens']+=stats['generation_tokens'];totals['generation_seconds']+=stats['seconds'];totals['calls']+=1
        job.update(generation=stats,usage=totals);self.memory()
        return self.decode(job,name,answer,repair)
    def generate_router(self,job,name,system,user,images,max_tokens,repair):
        folder=job.folder/'director';content=[{'type':'text','text':user}]
        for path in images or []:
            data=Path(path).read_bytes()
            if len(data)>16*1024**2:raise ValueError('A review image exceeds 16 MiB.')
            content.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(data).decode()}})
        payload={'model':self.entry['api_model'],'messages':[{'role':'system','content':system},{'role':'user','content':content}],
                 'stream':True,'stream_options':{'include_usage':True},'max_tokens':max_tokens,
                 'temperature':.3 if self.editing_step(name) else .5,'response_format':{'type':'json_object'},'reasoning':{'effort':'low','exclude':True},
                 'provider':{'require_parameters':True}}
        atomic_json(folder/(name+'.request.json'),{'messages':[{'role':'system','content':system},{'role':'user','content':user}],
                    'images':images or [],'max_tokens':max_tokens,'model':self.entry['path'],'backend':'openrouter','adapter':None,
                    'response_format':payload['response_format'],'reasoning':payload['reasoning']})
        start=time.monotonic();chunks=0;last_update=0;usage={};finish=None;reported_model=None
        job.update(generation={'step':name,'tokens':None,'chunks':0,'seconds':0,'reasoning':True,'backend':'openrouter'})
        with (folder/(name+'.raw.txt')).open('w') as public:
            def event(data):
                nonlocal chunks,last_update,usage,finish,reported_model
                if data.get('usage'):usage=data['usage']
                if data.get('model'):reported_model=data['model']
                for choice in data.get('choices',[]):
                    delta=choice.get('delta',{});text=delta.get('content')
                    if isinstance(text,str):public.write(text);chunks+=1
                    if choice.get('finish_reason'):finish=choice['finish_reason']
                now=time.monotonic()
                if now-last_update>1:
                    last_update=now;public.flush()
                    job.update(generation={'step':name,'tokens':usage.get('completion_tokens'),'chunks':chunks,'seconds':round(now-start,1),'reasoning':True,'backend':'openrouter'})
            try:router.stream_chat(payload,job.cancel,event)
            except router.RouterCancelled:job.check();raise
        job.check()
        answer=(folder/(name+'.raw.txt')).read_text()
        complete=finish=='stop' and bool(answer.strip())
        stats={'step':name,'generation_tokens':usage.get('completion_tokens'),'prompt_tokens':usage.get('prompt_tokens'),
               'seconds':round(time.monotonic()-start,1),'reasoning':True,'model':self.entry['id'],'backend':'openrouter',
               'cost_usd':usage.get('cost'),'reported_model':reported_model,'finish_reason':finish,'complete':complete,
               'reasoning_tokens':(usage.get('completion_tokens_details') or {}).get('reasoning_tokens')}
        # Failed completions still consume tokens and may be billed. Preserve their
        # receipt separately so they never become reusable answer checkpoints.
        atomic_json(folder/(name+('.metrics.json' if complete else '.incomplete.metrics.json')),stats)
        totals=job.snapshot().get('usage') or {'tokens':0,'generation_seconds':0,'calls':0,'peak_memory_gb':None}
        totals['tokens']+=stats['generation_tokens'] or 0;totals['generation_seconds']+=stats['seconds'];totals['calls']+=1
        if isinstance(stats['cost_usd'],(int,float)):totals['cost_usd']=totals.get('cost_usd',0)+stats['cost_usd']
        job.update(generation=stats,usage=totals);self.memory()
        if finish!='stop':raise ValueError(f'OpenRouter did not finish the JSON answer ({finish or "missing finish status"}). Partial output is preserved; it will not be treated as a complete scene.')
        if not answer.strip():raise ValueError('OpenRouter returned no final JSON answer.')
        return self.decode(job,name,answer,repair)

def command(job,cmd,log,handle=None,timeout=7200):
    job.check();log=Path(log);start=time.monotonic()
    env=dict(os.environ,PYTHONNOUSERSITE='1',TMPDIR='/private/tmp')
    p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,env=env,start_new_session=True)
    done=threading.Event();timed_out=threading.Event()
    def watch():
        while not done.wait(.25):
            if job.cancel.is_set() or time.monotonic()-start>timeout:
                if not job.cancel.is_set():timed_out.set()
                try:os.killpg(p.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                if not done.wait(5):
                    try:os.killpg(p.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                return
    watcher=threading.Thread(target=watch,daemon=True);watcher.start()
    try:
        with log.open('w') as f:
            for line in p.stdout:
                f.write(line);f.flush()
                if handle and line.startswith('ORBIT_EVENT '):handle(json.loads(line[len('ORBIT_EVENT '):]))
        code=p.wait()
    finally:
        done.set()
        if p.poll() is None:
            try:os.killpg(p.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                p.wait(timeout=5)
        p.stdout.close()
    job.check()
    if timed_out.is_set():raise RuntimeError('Rendering exceeded the time limit. Logs are saved in this run.')
    if code:raise RuntimeError(f'{Path(cmd[0]).name} failed ({code}): '+log.read_text()[-2500:])

def blender(job,mode,scene,out,handler=None):
    out.mkdir(parents=True,exist_ok=True)
    # No generated Python. The only executable script is our local, reviewed compiler.
    profile='(version 1) (allow default) (deny network*) '
    profile+='(deny file-read-data (require-all (subpath '+json.dumps(str(Path.home()))+') (require-not (subpath '+json.dumps(str(ROOT))+')))) '
    profile+='(deny file-write* (require-all (require-not (subpath '+json.dumps(str(job.folder))+')) (require-not (subpath "/private/tmp")) (require-not (subpath "/dev"))))'
    sb=out/'blender.sb';sb.write_text(profile)
    cmd=['/usr/bin/sandbox-exec','-f',str(sb),str(BLENDER),'--background','--factory-startup','--disable-autoexec','--python-exit-code','1','-t','8','--python',str(ROOT/'render_scene.py'),'--',mode,str(scene),str(out)]
    command(job,cmd,out/'blender.log',handler)

def render_assets(job,scene,version='assets'):
    asset_dir=job.folder/version;cards=[]
    def changed(e):
        if 'asset' in e:
            cards.append({'id':e['asset'],'name':e['name'],'url':job.url(asset_dir/(e['asset']+'.png'))})
            job.update(assets=list(cards),asset_progress={'completed':e['completed'],'total':e['total']})
    blender(job,'assets',job.folder/'scene.json',asset_dir,changed)
    contact_sheet([asset_dir/(a['id']+'.png') for a in scene['assets']],job.folder/'asset-board.png',[a['name'] for a in scene['assets']])

def contact_sheet(paths,dest,labels=None):
    from PIL import Image,ImageDraw,ImageFont
    cols=min(3,len(paths));w=512;h=320;rows=(len(paths)+cols-1)//cols
    out=Image.new('RGB',(cols*w,rows*h),'#14171c');d=ImageDraw.Draw(out)
    try:font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',17)
    except OSError:font=ImageFont.load_default()
    for i,p in enumerate(paths):
        im=Image.open(p).convert('RGB');im.thumbnail((w,h-30));x=i%cols*w;y=i//cols*h
        out.paste(im,(x+(w-im.width)//2,y+(h-30-im.height)//2));d.text((x+12,y+h-25),(labels[i] if labels else f'Frame {i+1}'),fill='#dce7ee',font=font)
    out.save(dest)

def create_scene(job,director,plan,duration):
    if job.data.get('settings',{}).get('detail')=='cinematic':return create_detailed_scene(job,director,plan,duration)
    scene=director.generate(job,'02-scene-1',SCENE_GUIDE,
        f'USER BRIEF: {job.data["prompt"]}\nEXACT DURATION: {duration} seconds.\nDIRECTOR PLAN: {json.dumps(plan,ensure_ascii=False)}\nLOCAL ASSET CATALOG: {json.dumps(job.data.get("library_catalog",[]))}',
        images=reference_paths(job,director),max_tokens=16384,thinking=6144)
    if job.data.get('source')=='model_generated' and isinstance(scene,dict):scene['version']=2
    issue=None
    for attempt in range(3):
        try:
            validated=validate(scene,duration)
            job.update(scene_repair=None)
            return validated
        except ValueError as error:issue=str(error)
        if attempt==2:raise ValueError('Scene validation failed after two targeted corrections: '+issue)
        job.event('modeling',f'Correcting invalid scene fields · {attempt+1}/2: {issue}',scene_repair={'attempt':attempt+1,'limit':2,'error':issue})
        patch=director.generate(job,f'02-scene-patch-{attempt+1}',
            'Repair the scene with MINIMAL JSON Patch operations. Return {"patches":[{"op":"replace","path":"/shots/0/camera/margin","value":1.3}]}. '
            'Allowed ops: add, replace, remove. Paths are JSON Pointers with numeric array indexes. Fix only invalid fields. Preserve all correct geometry, animation and materials. '
            'Do not return a complete scene. Fix the same problem in all locations. '+SCENE_GUIDE,
            f'VALIDATION ERROR: {issue}\nDURATION: {duration}\nCURRENT SCENE: {json.dumps(scene,ensure_ascii=False)}',
            max_tokens=4096,thinking=1024)
        try:scene=apply_scene_patch(scene,patch.get('patches'))
        except (ValueError,AttributeError) as error:
            issue='Invalid corrective patch: '+str(error)
            if attempt==1:raise ValueError(issue) from error
            # Keep the source scene; the next correction still receives its validation error.
            job.event('modeling',issue)
    raise ValueError(issue)

def repair_scene(job,director,scene,duration,name):
    patch_error=''
    for attempt in range(3):
        try:return validate(scene,duration)
        except ValueError as error:issue=str(error)
        if patch_error:issue+='; previous corrective patch failed: '+patch_error+'. Use add for absent fields.'
        if attempt==2:raise ValueError(f'{name} remains invalid after two corrections: '+issue)
        job.event('modeling','Correcting a scene field: '+issue,scene_repair={'attempt':attempt+1,'limit':2,'error':issue})
        reply=director.generate(job,f'{name}-patch-{attempt+1}',
            'Repair only the invalid fields with JSON {"patches":[{"op":"replace","path":"/assets/0/parts/0/size","value":[1,1,1]}]}. '
            'Use add/replace/remove and JSON Pointers. Preserve correct details. Do not regenerate the scene. '+SCENE_GUIDE,
            f'ERROR: {issue}\nDURATION: {duration}\nSCENE: {json.dumps(scene)}',max_tokens=6144,thinking=1024)
        try:
            candidate=apply_scene_patch(scene,reply.get('patches'))
            scene=candidate;patch_error=''
        except (ValueError,TypeError,AttributeError) as error:
            patch_error=str(error)
            if attempt==1:raise ValueError('Corrective patch remains invalid: '+patch_error) from error
    raise ValueError('Scene repair failed')

def merge_asset_materials(existing,extra,asset,asset_id):
    """Deduplicate or namespace local definitions without changing earlier assets."""
    existing=copy.deepcopy(existing);asset=copy.deepcopy(asset);by_id={m.get('id'):m for m in existing if isinstance(m,dict) and isinstance(m.get('id'),str)};aliases={}
    defaults={'metallic':0,'roughness':.4,'emission':0,'alpha':1,'transmission':0,'ior':1.45,'coat':0,'coat_roughness':.1,'anisotropic':0}
    def signature(material):
        value=copy.deepcopy(material);value.pop('id',None)
        for key,default in defaults.items():value.setdefault(key,default)
        return value
    for source in extra:
        item=copy.deepcopy(source);mid=item.get('id') if isinstance(item,dict) else None
        if isinstance(mid,str) and mid in by_id:
            if signature(item)==signature(by_id[mid]):continue
            digest=hashlib.sha256(json.dumps(item,sort_keys=True).encode()).hexdigest()[:8]
            replacement=asset_id+'_'+re.sub('[^a-zA-Z0-9_-]','_',mid)[:40]+'_'+digest
            aliases[mid]=replacement;item['id']=replacement
            if replacement in by_id and signature(item)==signature(by_id[replacement]):continue
        existing.append(item)
        if isinstance(item,dict) and isinstance(item.get('id'),str):by_id[item['id']]=item
    for part in asset.get('parts',[]) if isinstance(asset.get('parts',[]),list) else []:
        if not isinstance(part,dict):continue
        if isinstance(part.get('material'),str) and part['material'] in aliases:part['material']=aliases[part['material']]
        if isinstance(part.get('markings'),dict) and isinstance(part['markings'].get('material'),str) and part['markings']['material'] in aliases:part['markings']['material']=aliases[part['markings']['material']]
    return existing,asset,aliases

# Each specialist sees only the relevant part of the tool reference.
ASSET_GUIDE=(V2_GUIDE[:V2_GUIDE.index('instances:')]+V2_GUIDE[V2_GUIDE.index(' Parts also support'):V2_GUIDE.index('paths:')])
LAYOUT_GUIDE=(V2_GUIDE[:V2_GUIDE.index('assets:')]+V2_GUIDE[V2_GUIDE.index('instances:'):])

def build_one_asset(job,director,contract,materials,duration,plan,placement=None,paths=None,name=None,instruction=''):
    """Build a contracted subject; a mismatched identity is never silently relabelled."""
    aid=scene_identifier(contract['id']);name=name or '02-asset-'+aid;correction=''
    for attempt in range(2):
        response=director.generate(job,name+('-contract-2' if attempt else ''),ASSET_GUIDE+
            '\nBuild ONLY the object in ASSET CONTRACT. The contract is authoritative. Return '
            '{"asset":{id,name,description,allow_disconnected:true,parts:[...]},"materials":[]}. '
            'Do not build another object from the film. Preserve the exact ID, dimensions, origin and orientation. '
            'Describe and construct its distinctive silhouette and functional details. A desk is a desk surface/legs, never a lamp. '
            'Static supports and environments need no hero mechanism or arbitrary motion. '
            'parent must name another PART in this asset, never the asset ID. Omit parent for a root part. '
            'Each shape uses its documented fields: extrude uses polygon+depth; lathe uses profile. Bevel is a NUMBER; bevel modifiers use type/width/segments. '
            'Use existing material IDs or NEW IDs prefixed with this asset ID. Do not repeat existing materials. '
            'Part animation times are absolute film seconds. No scene cameras, instances or lights in this answer.',
            f'ASSET CONTRACT: {json.dumps(contract)}\nDURATION: {duration}\nSTYLE ONLY: {plan.get("visual_direction","")}\n'
            f'MATERIALS: {json.dumps(materials)}\nPLACEMENT: {json.dumps(placement or [])}\nPATHS: {json.dumps(paths or [])}\n'
            f'LOCAL ASSET CATALOG: {json.dumps(job.data.get("library_catalog",[]))}\nSPECIFIC CORRECTION: {instruction}\n{correction}',
            images=reference_paths(job,director),max_tokens=16384,thinking=3072)
        if isinstance(response,dict) and isinstance(response.get('asset'),dict) and response['asset'].get('id')==aid:break
        correction=f'Previous answer violated this contract. Return only {aid}: {contract["name"]}. Exact asset.id must be {aid}.'
        if attempt:raise ValueError('Asset builder did not preserve the contracted identity: '+aid)
        job.event('modeling','Correcting the subject of '+contract['name']+'.')
    extra=response.get('materials',[])
    if not isinstance(extra,list):raise ValueError('New asset materials must be a list')
    materials,asset,aliases=merge_asset_materials(materials,extra,response['asset'],aid)
    if aliases:atomic_json(job.folder/(name+'-material-aliases.json'),aliases)
    partial={'version':2,'title':contract['name'],'summary':str(contract.get('description','Asset construction')) or 'Asset construction',
             'materials':materials,'assets':[asset],'instances':[{'id':'asset_preview','asset':aid}],
             'shots':[{'start':0,'end':duration,'label':'Asset','camera':{'focus':'asset_preview'}}]}
    partial=repair_scene(job,director,partial,duration,name)
    atomic_json(job.folder/(name+'.json'),{'asset':partial['assets'][0],'materials':partial['materials']})
    return partial['assets'][0],partial['materials']

def create_detailed_scene(job,director,plan,duration):
    """Separate composition from asset construction so one answer need not hold a film."""
    layout=director.generate(job,'02-layout',LAYOUT_GUIDE+
        ' First design ONLY the scene blueprint. Return the full root with materials, asset contracts, instances, paths, scatter, lights, environment and shots. '
        'For each asset return {id,name,description,dimensions:[x,y,z],parts:[]}. DO NOT build parts yet: another pass will construct each asset separately. '
        'Give exact dimensions/origin/forward direction and needed moving part IDs in descriptions. Use a coherent scale and palette. '
        'Establish the entire main subject clearly before detail shots: focus the whole instance, not its base or one small part, unless the user explicitly asks for macro-only footage. '
        'For the establishing shot prefer solved focus/azimuth/elevation/margin framing over a guessed close camera path. Keep cameras above supporting surfaces and outside objects. '
        'Declare all materials here. Plan intentional lighting and material texture fields. A road should be one ribbon; landscape should use terrain; trees can use scatter. '
        'Do not refer to nonexistent tools, scripts or image textures. Both free and tracking cameras are supported.',
        f'BRIEF: {job.data["prompt"]}\nDURATION: {duration}\nART DIRECTION: {json.dumps(plan)}\nLOCAL ASSET CATALOG: {json.dumps(job.data.get("library_catalog",[]))}',images=reference_paths(job,director),max_tokens=12288,thinking=3072)
    if not isinstance(layout,dict) or not isinstance(layout.get('assets'),list) or not 1<=len(layout['assets'])<=32:raise ValueError('Blueprint needs 1..32 asset contracts.')
    layout['version']=2
    contracts=copy.deepcopy(layout['assets']);ids=set()
    for item in contracts:
        aid=scene_identifier(item.get('id'))
        if aid in ids:raise ValueError('Duplicate blueprint asset ID')
        ids.add(aid)
        if not isinstance(item.get('name'),str):raise ValueError('Asset contract needs a name')
        scene_vector(item.get('dimensions',[1,1,1]),'asset dimensions',.001,10000)
    atomic_json(job.folder/'blueprint.json',layout);built=[];materials=layout.get('materials',[])
    for index,contract in enumerate(contracts):
        aid=contract['id'];job.event('modeling',f'Building {contract["name"]} · asset {index+1}/{len(contracts)}.',build_progress={'completed':index,'total':len(contracts),'name':contract['name']})
        asset,materials=build_one_asset(job,director,contract,materials,duration,plan,
            [i for i in layout.get('instances',[]) if i.get('asset')==aid],layout.get('paths',[]))
        built.append(asset)
        job.update(build_progress={'completed':index+1,'total':len(contracts),'name':contract['name']},scene_repair=None)
    layout['assets']=built;layout['materials']=materials
    result=repair_scene(job,director,layout,duration,'02-assembly');job.update(scene_repair=None)
    return result

def reference_paths(job,director):
    return [str(asset_library.asset_path(id,'image')) for id in job.data.get('references',[])] if getattr(director,'entry',{}).get('vision',True) else None

def review_context(scene):
    """Keep topology arrays out of a visual transform/material review's context."""
    compact=copy.deepcopy(scene)
    for asset in compact['assets']:
        for part in asset['parts']:
            if part.get('shape')=='mesh':
                vertices=part.pop('vertices',[]);faces=part.pop('faces',[]);part.pop('uv',None)
                part['topology_summary']={'vertices':len(vertices),'faces':len(faces),'bounds':[[min(v[i] for v in vertices),max(v[i] for v in vertices)] for i in range(3)] if vertices else []}
    compact.pop('capability_summary',None)
    return compact

def asset_contracts(job,scene):
    blueprint=job.folder/'blueprint.json'
    contracts=json.loads(blueprint.read_text()).get('assets',[]) if blueprint.is_file() else job.data.get('plan',{}).get('assets',[])
    by={a['id']:a for a in contracts if isinstance(a,dict) and isinstance(a.get('id'),str)}
    return [copy.deepcopy(by.get(a['id'],{k:a[k] for k in ('id','name','description') if k in a})) for a in scene['assets']]

def review_issues(values):
    if not isinstance(values,list):raise ValueError('Review issues must be a list')
    result=[];seen=set()
    for value in values:
        if not isinstance(value,str) or not value.strip():continue
        value=value.strip()[:800];key=re.sub(r'\W+','',value).lower()
        if key in seen:continue
        result.append(value);seen.add(key)
        if len(result)==4:break
    return result

def canonical_review_patches(patches):
    """Recover a redundant single-scene wrapper, never a different scene/root."""
    result=copy.deepcopy(patches);changes=[]
    if not isinstance(result,list):return result,changes
    for patch in result:
        if not isinstance(patch,dict) or not isinstance(patch.get('path'),str):continue
        original=patch['path']
        path=re.sub(r'^/(?:scene|scenes/0)/(?=(?:title|summary|materials|assets|instances|shots|environment|lights|paths|scatter|render)(?:/|$))','/',original)
        if path!=original:patch['path']=path;changes.append({'from':original,'to':path})
    return result,changes

def edit_review(job,director,scene,critique,contracts,duration,iteration):
    """Keep criticism separate from implementation; repair one small edit transaction."""
    name=f'03-review-{iteration+1}-edit-v2';error=''
    system=('You edit a valid Blender scene. Return only JSON {"patches":[],"rebuild_assets":[]}. '
        'Use at most 16 MINIMAL JSON Patch operations, add/replace/remove. Numeric array indexes are safest. '
        'Use add for optional fields which are absent. Never replace complete assets/materials/instances/shots arrays. '
        'Do not edit omitted vertices/faces/uv. Actual numbers and arrays, not JSON-encoded strings. '
        'When an object is the WRONG SUBJECT or needs substantial new geometry, request '
        'rebuild_assets:[{"id":"contracted_asset_id","instruction":"specific correction"}] instead of dozens of patches. '
        'Maximum 2 rebuilds. The specialist will preserve its asset identity and dimensions. '
        'Prioritize visible defects from CRITIQUE and USER CORRECTION. Do not invent an unreported redesign. '
        'Framing: focus the whole instance for establishing shots; focus instance:part only for intentional detail. '
        'camera keys: focus,azimuth,elevation,margin [1.01,20],lens [10,200],target_offset:[x,y,z],'
        'dof:{fstop:4}, OR position/target vectors, optional path/path_start/path_end. '
        'path is an ID string. Do not use nested follow_path for a camera. '
        'Part transforms: position/rotation/scale, animation:[{time,position,rotation,scale,visible}], interpolation. '
        'Lights use energy/color/position/target. PBR materials use color/metallic/roughness/coat/emission. '
        'Return empty arrays if no safe improvement is possible.')
    for attempt in range(2):
        reply=director.generate(job,name+('-patch-2' if attempt else ''),system,
            f'DURATION: {duration}\nUSER CORRECTION: {job.data.get("refinement_instruction","")}\n'
            f'CRITIQUE: {json.dumps(critique)}\nCONTRACTS: {json.dumps(contracts)}\nSCENE: {json.dumps(review_context(scene))}\n{error}',
            max_tokens=6144,thinking=1536,repair=False)
        try:
            if not isinstance(reply,dict):raise ValueError('Editor must return an object')
            patches,aliases=canonical_review_patches(reply.get('patches',[]));rebuilds=reply.get('rebuild_assets',[])
            if not isinstance(patches,list) or len(patches)>16:raise ValueError('Editor needs at most 16 patches')
            if any(not isinstance(p,dict) or p.get('path') in ('/assets','/materials','/instances','/shots') for p in patches):raise ValueError('Patch individual fields; preserve complete scene arrays')
            if any(re.search(r'/(vertices|faces|uv)(/|$)',p.get('path','')) for p in patches):raise ValueError('Mesh topology is omitted; use rebuild_assets')
            by={c['id']:c for c in contracts}
            if not isinstance(rebuilds,list) or len(rebuilds)>2:raise ValueError('At most two targeted asset rebuilds')
            ids=set()
            for item in rebuilds:
                if not isinstance(item,dict) or item.get('id') not in by or not isinstance(item.get('instruction'),str) or not 1<=len(item['instruction'])<=1500:raise ValueError('Rebuild needs a known asset id and a short instruction')
                if item['id'] in ids:raise ValueError('Duplicate rebuild asset')
                ids.add(item['id'])
            updated=validate(apply_scene_patch(scene,patches),duration) if patches else copy.deepcopy(scene)
            break
        except (ValueError,TypeError) as exc:
            if attempt:raise ValueError('Review edit remains invalid: '+str(exc)) from exc
            error='YOUR LAST EDIT WAS INVALID: '+str(exc)+'\nPREVIOUS EDIT: '+json.dumps(reply)+'\nReturn one corrected small transaction.'
            job.event('review','Correcting a review edit: '+str(exc))
    for item in rebuilds:
        aid=item['id'];index=next(i for i,a in enumerate(updated['assets']) if a['id']==aid)
        job.event('review','Rebuilding only '+by[aid]['name']+' after review.')
        asset,materials=build_one_asset(job,director,by[aid],updated['materials'],duration,job.data.get('plan',{}),
            [i for i in updated['instances'] if i['asset']==aid],updated.get('paths',[]),name+ '-rebuild-'+aid+'-geometry-v2',item['instruction'])
        updated['assets'][index]=asset;updated['materials']=materials
    updated=validate(updated,duration)
    atomic_json(job.folder/(name+'-applied.json'),{'patches':patches,'path_aliases':aliases,'rebuilt_assets':[i['id'] for i in rebuilds]})
    return updated

def review_scene(job,director,scene,folder,inspection,duration,iteration):
    """A review may improve valid geometry, but cannot destroy its render checkpoint."""
    visual=director.entry.get('vision',True);mode='visual' if visual else 'data'
    role=('Inspect the attached ACTUAL Blender frames for framing, silhouette, connected parts, lighting and requested motion.' if visual else
          'You have NO vision and NO images. Review only scene JSON and geometry reports. Do not claim to have seen frames.')
    try:
        contracts=asset_contracts(job,scene)
        review=director.generate(job,f'03-review-{iteration+1}-critique',
            role+' Return ONLY JSON {"assessment":"one short verdict","issues":["one defect and desired correction"]}. '
            'At most FOUR distinct issues. Finish the answer after the fourth issue. Do NOT output patches, scene JSON, tutorials, scores or repeated explanations. '
            'Prioritize wrong subjects, cropped or invisible subjects, major motion defects, and unreadable lighting. '
            'Check each isolated asset against its expected contract. Be specific about which asset/shot is wrong. '
            'User corrections may describe an EARLIER version. Check the current built-part list and images before repeating a defect that was already fixed. '
            'Consider geometry below a support surface and camera occlusion before diagnosing a missing object as poor lighting. '
            'Report only what the evidence supports; do not infer animation continuity from five stills. Return issues=[] if acceptable.',
            f'BRIEF: {job.data["prompt"]}\nUSER CORRECTION: {job.data.get("refinement_instruction","")}\nDURATION: {duration}\nEXPECTED ASSETS: {json.dumps(contracts)}\n'
            f'BUILT ASSETS: {json.dumps([{ "id":a["id"],"name":a["name"],"parts":[p["id"] for p in a["parts"]]} for a in scene["assets"]])}\n'
            f'SHOTS: {json.dumps(scene["shots"])}\nAUTOMATIC PARTIAL CHECKS: {json.dumps(inspection)}\n'+
            ('Image 1: five timeline checkpoints in order. Image 2: isolated asset previews.' if visual else 'No images are provided.'),
            images=[str(folder/'contact.png'),str(job.folder/'asset-board.png')] if visual else None,
            max_tokens=4096,thinking=1024,repair=False)
        atomic_json(folder/'review.json',review)
        if not isinstance(review,dict) or not isinstance(review.get('assessment'),str):raise ValueError('Review must include a public assessment.')
        issues=review_issues(review.get('issues',[]))
        record={'version':iteration+1,'assessment':review['assessment'][:1200],'issues':issues,'mode':mode,'status':'complete'}
        updated=edit_review(job,director,scene,record,contracts,duration,iteration) if issues or (iteration==0 and job.data.get('refinement_instruction')) else scene
        return updated,record
    except (ValueError,router.RouterError,studio.StudioError) as error:
        job.check()  # A stopped job must never continue into rendering.
        warning=f'Review {iteration+1} unavailable: {error} Keeping the last valid scene for rendering; visual issues may remain.'
        warnings=list(job.data.get('warnings') or []);warnings.append(warning)
        job.event('review',warning,warnings=warnings)
        atomic_json(folder/'review-unavailable.json',{'error':str(error),'last_valid_scene_preserved':True})
        return scene,{'version':iteration+1,'assessment':warning,'issues':[],'mode':mode,'status':'unavailable'}

def run(job,director):
    started=job.data.get('started_at',time.time());settings=job.data['settings'];duration=settings['duration'];fps=settings.get('fps',24)
    atomic_json(job.folder/'settings.json',settings)
    job.update(status='running',started_at=started)
    if job.data.get('render_only') and (job.folder/'scene.json').exists():
        scene=validate(json.loads((job.folder/'scene.json').read_text()),duration)
        job.update(render_checkpoint=True)
        finish_render(job,scene,started)
        return
    scene=None;problem='';initial=job.folder/'scene-initial.json'
    legacy=job.folder/'preview-0'/'scene.json'
    if job.data.get('use_model',True):
        director.load(job)
        if job.data.get('use_saved_plan'):
            plan=job.data.get('plan',{})
            job.event('planning','Reusing the existing story and models; the selected model will inspect and improve this version.')
        else:
            job.event('planning','The model is developing the story, shots and visual direction.')
            plan=director.generate(job,'01-plan',
            'You are a cinematic 3D animation director. Return only JSON. Develop specific art direction: palette, material language, composition, light direction, atmosphere, camera rhythm and functional motion. '
            'Available tools include custom mesh, continuous spline ribbons, curves, terrain, lathe, extrusion, modifiers, PBR/procedural textures, glass, animated parts, paths, scatter, lights, fog and depth of field. '
            'Avoid generic primitive toy scenes unless explicitly requested. Choose a consistent intentional style. No narration unless supplied; the deliverable is a silent animation.',
            f'Brief: {job.data["prompt"]}\nDuration: {duration} seconds.\nStyle preference: {settings.get("style","auto")}\nNARRATION TO ILLUSTRATE: {settings.get("narration","")}\nLOCAL ASSET CATALOG: {json.dumps(job.data.get("library_catalog",[]))}\n'
            'Return {"title":"...","logline":"...","visual_direction":"specific art direction",'
            '"assets":[{"id":"valid_id","name":"...","description":"geometry, details, dimensions, origin and forward direction","dimensions":[4,2,2]}],'
            f'"shots":[{{"start":0,"end":{duration},"label":"...","action":"..."}}]}}. '
            'Use fewer cuts for short clips and purposeful shot changes for long films. Include actual part motion, not just camera motion. Only requested content, no logos or credits.',
            images=reference_paths(job,director),max_tokens=8192,thinking=3072)
        if not isinstance(plan.get('title'),str) or not isinstance(plan.get('shots'),list):raise ValueError('Director returned an invalid plan')
        atomic_json(job.folder/'plan.json',plan)
        job.event('modeling','Designing the editable models, lighting and animation.',plan=plan,title=plan['title'])
    else:
        plan=job.data.get('plan',{});job.event('modeling','Building the supplied scene with Blender tools. No model generation is used.')
    if initial.exists() or legacy.exists():
        scene=validate(json.loads((initial if initial.exists() else legacy).read_text()),duration)
    if scene is None:scene=create_scene(job,director,plan,duration)
    atomic_json(initial,scene);atomic_json(job.folder/'scene.json',scene)
    job.update(reviews=[],warnings=[])
    job.event('assets','Blender is constructing the models and rendering asset previews.')
    render_assets(job,scene)
    versions=[];reviews=[]
    fingerprint={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('render_scene.py','advanced_blender.py','scene_math.py','scene_v2.py')}
    fingerprint['settings']={k:settings.get(k) for k in ('duration','width','height','engine','fps')}
    for iteration in range(settings['reviews']+1):
        folder=job.folder/f'preview-{iteration}';atomic_json(job.folder/'scene.json',scene)
        job.event('preview',f'Blender is assembling the scene and rendering five checkpoints · version {iteration+1}.',revision=iteration+1)
        previews=[]
        def preview_event(e):
            if 'preview' in e:
                previews.append({'url':job.url(folder/e['file']),'frame':e['frame'],'time':round((e['frame']-1)/fps,2)})
                job.update(previews=list(previews))
        cached_scene=folder/'scene.json'
        cached_images=all((folder/f'preview-{i}.png').exists() for i in range(5))
        stamp=folder/'renderer.json'
        if cached_scene.exists() and cached_images and (folder/'inspection.json').exists() and stamp.exists() and json.loads(stamp.read_text())==fingerprint and json.loads(cached_scene.read_text())==scene:
            for index,f in enumerate([1,round(duration*fps*.25),round(duration*fps*.5),round(duration*fps*.75),duration*fps]):
                preview_event({'preview':index,'frame':f,'file':f'preview-{index}.png'})
            # Recheck geometry quickly with the current compiler; images are preserved.
            blender(job,'inspect',job.folder/'scene.json',folder/'geometry-check')
        else:
            blender(job,'preview',job.folder/'scene.json',folder,preview_event);atomic_json(stamp,fingerprint)
        contact_sheet([folder/f'preview-{i}.png' for i in range(5)],folder/'contact.png',[f'{p["time"]:.1f}s' for p in previews])
        inspection=json.loads((folder/'inspection.json').read_text())
        inspected=folder/'geometry-check'/'inspection.json'
        if inspected.exists():inspection.update(json.loads(inspected.read_text()))
        atomic_json(folder/'scene.json',scene)
        versions.append({'version':iteration+1,'url':job.url(folder/'contact.png'),'scene':job.url(folder/'scene.json')})
        job.update(versions=list(versions),inspection=inspection,shots=scene['shots'],scene_url=job.url(job.folder/'scene.json'))
        if iteration==settings['reviews']:break
        visual=director.entry.get('vision',True)
        job.event('review',f'The model is {"inspecting actual Blender frames" if visual else "checking scene data and geometry reports (text-only model)"} · review {iteration+1}.')
        updated,review=review_scene(job,director,scene,folder,inspection,duration,iteration)
        reviews.append(review)
        job.update(reviews=list(reviews))
        if review['status']=='unavailable':break
        if updated==scene:
            job.event('review',('Visual review' if visual else 'Scene data review')+' completed; preserving the current scene.')
            break
        assets_changed=updated['assets']!=scene['assets'] or updated['materials']!=scene['materials']
        scene=updated
        if assets_changed:
            atomic_json(job.folder/'scene.json',scene)
            job.event('assets',f'Rebuilding model previews after visual review {iteration+1}.')
            render_assets(job,scene,f'assets-revision-{iteration+1}')
    # Legacy XYZ cameras can miss/crop the subject. Have Nemotron express the
    # intent with a focus target; the compiler solves actual animated framing.
    if scene.get('version')!=2 and any('focus' not in shot[k] for shot in scene['shots'] for k in ('camera','camera_end')):
        job.event('preview','Calibrating the cameras to the actual model geometry.')
        error=''
        for attempt in range(2):
            answer=director.generate(job,f'04-focus-cameras-{attempt+1}',
                'You direct cameras for an editable Blender film. Return JSON {"shots":[...]}. '
                'Every shot keeps start, end, label, description. Both camera and camera_end MUST use '
                '{"focus":"instance_id or instance_id:part_id","azimuth":60,"elevation":20,"margin":1.3,"lens":45}. '
                'No position or target coordinates. Azimuth is degrees in world XY: 0 views from +X, '
                '90 from +Y, -90 from -Y. Elevation is degrees above the horizon, -80 to 85. '
                'Margin 1.05 to 3; lens 18 to 100 mm. The compiler follows the actual animated target '
                'and fits its whole bounding sphere safely. First shot must focus on the main subject '
                '(the first instance). Detail shots can focus on one of its named parts. '
                'Choose a viewpoint with background objects BEHIND the subject, opposite the camera. '
                'When a background planet is needed in the wide shot, use a low elevation, about 10–20 '
                'degrees, so it stays in the vertical field. Choose gentle angle changes and clear views '
                'of the visible surfaces. Do not invent instance/part IDs. No geometry changes.',
                f'BRIEF: {job.data["prompt"]}\nDURATION: {duration}\n'
                f'INSTANCE POSITIONS AND MOTION: {json.dumps(scene["instances"])}\n'
                f'PART IDS: {json.dumps({a["id"]:[p["id"] for p in a["parts"]] for a in scene["assets"]})}\n'
                f'SHOTS TO CALIBRATE: {json.dumps(scene["shots"])}\n'+error,
                max_tokens=6144,thinking=1536)
            try:
                calibrated=validate(scene|{'shots':answer.get('shots')},duration)
                if not all('focus' in s[k] for s in calibrated['shots'] for k in ('camera','camera_end')):
                    raise ValueError('Every camera must use a valid focus target, not guessed XYZ coordinates')
                scene=calibrated;break
            except ValueError as e:
                if attempt==1:raise
                error='Correct your last answer: '+str(e)+'\n'+json.dumps(answer)
        atomic_json(job.folder/'scene.json',scene)
        folder=job.folder/'preview-focus';previews=[]
        job.event('preview','Rendering the calibrated cameras for a final composition check.')
        def calibrated_event(e):
            if 'preview' in e:
                previews.append({'url':job.url(folder/e['file']),'frame':e['frame'],'time':round((e['frame']-1)/fps,2)})
                job.update(previews=list(previews))
        blender(job,'preview',job.folder/'scene.json',folder,calibrated_event)
        contact_sheet([folder/f'preview-{i}.png' for i in range(5)],folder/'contact.png',[f'{p["time"]:.1f}s' for p in previews])
        atomic_json(folder/'scene.json',scene)
        versions.append({'version':len(versions)+1,'url':job.url(folder/'contact.png'),'scene':job.url(folder/'scene.json')})
        inspection=json.loads((folder/'inspection.json').read_text())
        job.update(versions=versions,inspection=inspection,shots=scene['shots'])
    # A final accepted edit must always have a preview before full rendering.
    atomic_json(job.folder/'scene.json',scene)
    job.update(render_checkpoint=True)
    finish_render(job,scene,started)


def prepare_audio(job):
    settings=job.data['settings'];tracks=[]
    if settings.get('audio_id') or settings.get('narration'):job.event('audio','Preparing the supplied soundtrack and local narration.')
    if settings.get('audio_id'):tracks.append({'path':str(asset_library.asset_path(settings['audio_id'],'audio')),'volume':settings.get('audio_volume',.35),'role':'soundtrack'})
    text=settings.get('narration','')
    if text:
        voice=speech.validate_voice(settings.get('voice'));path=job.folder/'narration.aiff';stamp=job.folder/'narration-manifest.json'
        manifest={'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'voice':voice,'rate':settings.get('speech_rate',170)}
        if not path.exists() or not stamp.exists() or json.loads(stamp.read_text())!=manifest:
            source=job.folder/'narration.txt';source.write_text(text)
            job.event('audio','Preparing the supplied narration with an installed local voice.')
            command(job,['/usr/bin/say','-v',voice,'-r',str(manifest['rate']),'-f',str(source),'-o',str(path)],job.folder/'narration.log',timeout=300)
            atomic_json(stamp,manifest)
        probe=subprocess.run([FFPROBE,'-v','error','-show_format','-of','json',str(path)],capture_output=True,text=True,check=True,timeout=20)
        length=float(json.loads(probe.stdout)['format']['duration'])
        if length>settings['duration']+.25:raise ValueError(f'The narration needs {length:.1f} seconds, but this animation is {settings["duration"]} seconds. Shorten the narration or choose a longer film; speech will not be silently cut.')
        tracks.append({'path':str(path),'volume':1,'role':'narration'})
    settings['audio_tracks']=tracks;atomic_json(job.folder/'settings.json',settings)
    return tracks

def finish_render(job,scene,started):
    settings=job.data['settings'];duration=settings['duration'];fps=settings.get('fps',24)
    tracks=prepare_audio(job)
    manifest={'scene_sha256':hashlib.sha256(json.dumps(scene,sort_keys=True).encode()).hexdigest(),
              'settings':settings,'compiler_sha256':hashlib.sha256((ROOT/'render_scene.py').read_bytes()).hexdigest(),
              'schema_sha256':hashlib.sha256((ROOT/'schema.py').read_bytes()).hexdigest(),
              'feature_hashes':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('scene_v2.py','scene_math.py','advanced_blender.py')}}
    final=job.folder/'final'
    if (final/'manifest.json').exists() and json.loads((final/'manifest.json').read_text())!=manifest:
        final=job.folder/f'final-{int(time.time())}'
    final.mkdir(exist_ok=True);atomic_json(final/'manifest.json',manifest)
    job.event('rendering','Rendering the final animation frame by frame.',render={'frame':0,'total':duration*fps})
    def frame_event(e):
        if 'frame' in e:job.update(render={'frame':e['frame'],'total':e['total']},latest_frame=job.url(final/e['file']))
    blender(job,'final',job.folder/'scene.json',final,frame_event)
    job.event('encoding','Encoding the frames into a downloadable H.264 video.')
    video=final/'animation.mp4'
    encode=[FFMPEG,'-y','-framerate',str(fps),'-i',str(final/'frames'/'%05d.png')]
    if tracks:
        for track in tracks:encode+=['-protocol_whitelist','file,pipe','-i',track['path']]
        filters=[f'[{index+1}:a]volume={track["volume"]},apad[a{index}]' for index,track in enumerate(tracks)]
        filters.append(''.join(f'[a{i}]' for i in range(len(tracks)))+f'amix=inputs={len(tracks)}:duration=longest:normalize=0,alimiter=limit=0.95[audio]')
        encode+=['-filter_complex',';'.join(filters),'-map','0:v:0','-map','[audio]','-c:a','aac','-b:a','192k','-t',str(duration)]
    encode+=['-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(video)]
    command(job,encode,final/'ffmpeg.log',timeout=900)
    probe=subprocess.run([FFPROBE,'-v','error','-show_streams','-show_format','-of','json',str(video)],capture_output=True,text=True,check=True,timeout=30)
    metadata=json.loads(probe.stdout);atomic_json(final/'video-info.json',metadata)
    stream=next(s for s in metadata['streams'] if s['codec_type']=='video')
    if int(stream['nb_frames'])!=duration*fps or abs(float(metadata['format']['duration'])-duration)>.1:
        raise RuntimeError('Encoded video does not match the requested duration/frame count')
    job.event('complete','Your animation is ready.',status='complete',finished_at=time.time(),video=job.url(video),blend=job.url(final/'project.blend'),glb=job.url(final/'scene.glb') if (final/'scene.glb').exists() else None,video_info={'duration':float(metadata['format']['duration']),'frames':int(stream['nb_frames']),'width':stream['width'],'height':stream['height'],'codec':stream['codec_name'],'audio':any(s.get('codec_type')=='audio' for s in metadata['streams'])},elapsed_seconds=round(time.time()-started))
