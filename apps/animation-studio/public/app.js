'use strict';
const $ = id => document.getElementById(id);
const stages = [
  {name:'Creative direction', keys:['queued','loading','planning']},
  {name:'Build the models', keys:['modeling','assets']},
  {name:'Scene & animation', keys:['preview']},
  {name:'Visual review', keys:['review']},
  {name:'Sound & narration',keys:['audio']},
  {name:'Render the animation', keys:['rendering']},
  {name:'Final delivery', keys:['encoding','complete']}
];
let token='', selected=null, allJobs=[], activeId=null, tab='frames', selectedImage='', videoSource='', pollBusy=false, lastArtifacts='', lastNotes='', lastEvents='', lastVersions='', historySignature='', connected=false, manualPreview=false, bootstrapped=false, manualTab=false, imageTicket=0;
let engineStatus=null, localModels=[], modelSignature='', modelBusy=false, modelError='';
let toolBusy=false,sceneParent=null;
let libraryItems=[],selectedReferences=new Set(),librarySignature='';
const show=(id,on)=>$(id).classList.toggle('hidden',!on);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const shortTime=s=>{s=Math.max(0,Math.floor(s));return s<60?`${s}s`:`${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;};
const running=j=>j&&['queued','running'].includes(j.status);
const label=s=>({complete:'Finished',failed:'Needs attention',cancelled:'Stopped',interrupted:'Interrupted',queued:'Queued',running:'In production'}[s]||s);
async function api(path,options={}) {
  const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','X-Orbit-Token':token,...options.headers}});
  if(!r.ok){let m;try{m=(await r.json()).error;}catch{m=`Request failed (${r.status})`;}throw new Error(m||'Request failed');}
  return r.json();
}
function resetPanels(){
  lastArtifacts='';lastNotes='';lastEvents='';lastVersions='';selectedImage='';manualPreview=false;manualTab=false;
  imageTicket++;videoSource='';$('result-video').pause();$('result-video').removeAttribute('src');$('result-video').load();
  $('preview-image').removeAttribute('src');show('empty-scene',true);show('preview-image',false);show('result-video',false);show('viewport-label',false);$('viewport').classList.remove('has-video');
}
const gib=bytes=>`${(Number(bytes||0)/1024**3).toFixed(2)} GiB`;
function renderModels(){
  const status=engineStatus||{}, chosen=localModels.find(m=>m.id===status.selected_model), loaded=localModels.find(m=>m.id===status.loaded_model);
  const signature=JSON.stringify(localModels);
  if(signature!==modelSignature){modelSignature=signature;$('model-select').replaceChildren(...localModels.filter(m=>m.supported).map(m=>{const option=el('option',null,`${m.name} · ${m.backend==='openrouter'?'cloud':gib(m.size_bytes)}${m.supported?'':' · unavailable'}`);option.value=m.id;option.disabled=!m.supported;option.title=m.reason||m.path;return option;}));}
  if(chosen)$('model-select').value=chosen.id;
  const busy=modelBusy||Boolean(status.active_job)||Boolean(status.model_operation)||!connected;
  $('model-select').disabled=busy||!localModels.length;
  const cloud=chosen?.backend==='openrouter';
  document.querySelector('.device-label').textContent=cloud?'CLOUD AI · LOCAL RENDER':'ON YOUR MAC';
  document.querySelector('.model-add').classList.toggle('hidden',status.provider_lock==='openrouter');
  $('model-load').disabled=busy||!chosen||!chosen.supported||(cloud&&!status.openrouter?.configured)||(status.model_state==='ready'&&status.loaded_model===status.selected_model);
  $('model-unload').disabled=busy||!status.loaded_model;
  $('model-load').textContent=status.model_operation?.action==='load'?(cloud?'Connecting…':'Loading…'):status.loaded_model===status.selected_model&&status.model_state==='ready'?(cloud?'Connected':'Loaded'):(cloud?'Connect API':'Load model');
  $('model-unload').textContent=status.model_operation?.action==='unload'?'Disconnecting…':loaded?.backend==='openrouter'?'Disconnect':'Unload';
  $('model-refresh').disabled=modelBusy||!connected;
  $('model-add-button').disabled=busy;
  const state=$('model-runtime-state');state.dataset.state=status.model_state||'cold';
  state.textContent=!connected?'Engine disconnected':status.model_state==='loading'?(chosen?.backend==='lmstudio'?'Connecting to local LM Studio…':'Loading selected model into memory…'):status.model_state==='unloading'?(loaded?.backend==='lmstudio'?'Unloading the model from LM Studio…':'Releasing model and MLX cache…'):status.model_state==='error'?'Model could not be loaded':status.loaded_model?`${loaded?.name||'Model'} loaded${status.active_job?' · in use':status.loaded_model!==status.selected_model?' · selected model is not loaded':''}`:'No model in memory · loads automatically when you create an animation';
  if(cloud&&status.model_state==='loading')state.textContent='Connecting to OpenRouter…';
  else if(loaded?.backend==='openrouter'&&status.model_state==='ready')state.textContent='DeepSeek connected through OpenRouter';
  else if(cloud&&!status.loaded_model)state.textContent=status.openrouter?.configured?'API key configured · connect or create an animation':'Add your OpenRouter API key below';
  $('model-memory').textContent=status.memory?.backend==='openrouter'?'Cloud API · no local weights':status.memory?.backend==='lmstudio'?`LM Studio · ${gib(status.memory.weights_bytes)} weights · runtime memory not reported`:`MLX memory: ${gib(status.memory?.active_bytes)} · cache ${gib(status.memory?.cache_bytes)}`;
  $('model-description').textContent=cloud?'DeepSeek through OpenRouter · text + images · JSON output · Blender renders on your Mac':chosen?`${chosen.backend==='lmstudio'?'LM Studio · '+chosen.format.toUpperCase():'MLX'} · ${gib(chosen.size_bytes)} weights${chosen.bits?` · ${chosen.bits}-bit`:''} · ${chosen.vision?'Vision: reviews rendered frames':'Text only: reviews scene data without images'}${chosen.reasoning?' · reasoning enabled':''}`:'Choose a model.';
  $('model-path').textContent=cloud?`openrouter.ai / ${chosen.api_model}`:chosen?.backend==='lmstudio'?`127.0.0.1:1234 / ${chosen.lm_model_key}`:chosen?.path||'';
  show('openrouter-settings',cloud);
  $('openrouter-save').disabled=busy;$('openrouter-forget').disabled=busy||!status.openrouter?.configured;
  $('openrouter-key-status').textContent=status.openrouter?.configured?`Key configured (${status.openrouter.source==='environment'?'server environment':'server memory only'}). It is never returned to this page or stored in browser storage.`:'No key configured. The key stays in server memory only and is cleared when the server restarts.';
  const error=modelError||status.model_error;$('model-error').textContent=error||'';show('model-error',Boolean(error));
}
async function modelAction(action,data={}){
  if(modelBusy)return;modelBusy=true;modelError='';renderModels();render(selected);
  try{engineStatus={...engineStatus,...await api(`/api/models/${action}`,{method:'POST',body:JSON.stringify(data)})};renderModels();}
  catch(error){modelError=error.message;}
  finally{modelBusy=false;renderModels();render(selected);await poll();}
}
function setPreview(url,caption='BLENDER / SCENE PREVIEW') {
  if(!url)return;
  selectedImage=url;const ticket=++imageTicket;
  const display=()=>{if(ticket!==imageTicket||selectedImage!==url)return;$('preview-image').src=url;show('empty-scene',false);show('result-video',false);show('preview-image',true);$('result-video').pause();$('viewport').classList.remove('has-video');$('viewport-label-text').textContent=caption;show('viewport-label',true);};
  if($('preview-image').getAttribute('src')===url&&$('preview-image').naturalWidth){display();return;}
  const next=new Image();next.onload=display;next.src=url;
}
function setVideo(url) {
  imageTicket++;selectedImage='';
  show('empty-scene',false);show('preview-image',false);show('result-video',true);$('viewport').classList.add('has-video');
  if(videoSource!==url){$('result-video').src=url;videoSource=url;}
}
function renderStages(j){
  const key=j?.stage;let idx=stages.findIndex(s=>s.keys.includes(key));
  const completed=j?.status==='complete';const failed=j&&!running(j)&&!completed;
  if(failed){const last=(j.events||[]).filter(e=>!['error','cancelled'].includes(e.stage)).at(-1);idx=stages.findIndex(s=>s.keys.includes(last?.stage));}
  $('stages').replaceChildren(...stages.map((s,i)=>{
    const done=completed||idx>i;const current=idx===i&&!completed;
    const row=el('li',`stage${done?' done':''}${current?' current':''}${failed&&current?' failed':''}`);
    const marker=el('span','stage-marker');if(done)marker.textContent='✓';else if(current&&running(j))marker.append(el('span'));else marker.textContent=String(i+1).padStart(2,'0');
    const skipReview=(s.keys.includes('review')&&j?.settings?.reviews===0)||(s.keys.includes('audio')&&!j?.settings?.audio_id&&!j?.settings?.narration);if(skipReview)marker.textContent='—';
    const reviewWarning=s.keys.includes('review')&&j?.reviews?.some(r=>r.status==='unavailable');if(reviewWarning){row.classList.add('review-warning');marker.textContent='!';}
    row.append(marker,el('span','stage-name',s.keys.includes('review')&&j?.model?.vision===false?'Scene data review':s.name),el('span','stage-state',skipReview?'OFF':reviewWarning?'PARTIAL':done?'DONE':current?(failed?'STOPPED':'WORKING'):''));return row;
  }));
}
function renderArtifacts(j){
  const signature=JSON.stringify([tab,j?.previews,j?.assets,j?.shots,j?.plan?.shots,selectedImage]);
  if(signature===lastArtifacts)return;lastArtifacts=signature;
  const area=$('artifact-area');let nodes=[];
  if(tab==='story'){
    const shots=j?.shots||j?.plan?.shots||[];const grid=el('div','story-grid');
    for(const [i,s] of shots.entries()){
      const card=el('div','shot-card');card.append(el('span','shot-time',`${String(i+1).padStart(2,'0')} / ${s.start}s — ${s.end}s`),el('strong',null,s.label),el('p',null,s.description||s.action||''));grid.append(card);
    }
    if(shots.length)nodes=[grid];
  }else{
    const items=tab==='assets'?j?.assets||[]:j?.previews||[];const strip=el('div',tab==='assets'?'asset-strip':'artifact-strip');
    for(const item of items){
      const card=el('button',`artifact-card${selectedImage===item.url?' selected':''}`);card.type='button';
      const img=el('img');img.src=item.url;img.alt=tab==='assets'?item.name:`Animation at ${item.time}s`;img.loading='lazy';
      card.append(img,el('span',null,tab==='assets'?item.name:`${Number(item.time).toFixed(1)}s`));
      card.addEventListener('click',()=>{manualPreview=true;setPreview(item.url,tab==='assets'?'BLENDER / MODEL PREVIEW':`BLENDER / ${Number(item.time).toFixed(1)}s`);lastArtifacts='';renderArtifacts(selected);});strip.append(card);
    }
    if(items.length)nodes=[strip];
  }
  if(!nodes.length)nodes=[el('div','artifact-empty',tab==='assets'?'Your models will appear as Blender builds them.':tab==='story'?'The local model is waiting for your direction.':'Animation frames will appear here.')];
  area.replaceChildren(...nodes);
}
function renderNotes(j){
  const sig=JSON.stringify([j?.plan,j?.reviews]);if(sig===lastNotes)return;lastNotes=sig;
  const notes=[];
  if(j?.plan){const card=el('div','director-note');card.append(el('strong',null,'THE CREATIVE DIRECTION'),el('p',null,j.plan.visual_direction||j.plan.logline||''));notes.push(card);}
  for(const r of j?.reviews||[]){const card=el('div','director-note');card.append(el('strong',null,`${r.mode==='data'?'SCENE DATA REVIEW':'VISUAL REVIEW'} / TAKE ${r.version}`),el('p',null,r.assessment));if(Array.isArray(r.issues)&&r.issues.length){const ul=el('ul');for(const issue of r.issues)ul.append(el('li',null,String(issue)));card.append(ul);}if(r.rejected_change)card.append(el('p',null,'The proposed edit did not pass scene validation; the valid scene was preserved.'));notes.push(card);}
  $('director-notes').replaceChildren(...notes);
}
function renderJournal(j){
  const sig=JSON.stringify(j?.events);if(sig===lastEvents)return;lastEvents=sig;
  $('event-list').replaceChildren(...(j?.events||[]).slice().reverse().map(e=>{const row=el('div','event-row');row.append(el('time',null,new Date(e.time*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})),el('span',null,e.message));return row;}));
}
function renderVersions(j){
  const sig=JSON.stringify(j?.versions);if(sig===lastVersions)return;lastVersions=sig;
  $('revisions').replaceChildren(...(j?.versions||[]).map(v=>{const wrap=el('div','revision');const img=el('img');img.src=v.url;img.alt=`Actual rendered timeline, take ${v.version}`;img.loading='lazy';wrap.append(img,el('span',null,`TAKE ${String(v.version).padStart(2,'0')} / RENDERED CHECKPOINTS`));return wrap;}));
}
function render(j){
  if(!manualTab&&j){const desired=j.previews?.length?'frames':j.assets?.length?'assets':j.plan?'story':'frames';if(tab!==desired){tab=desired;for(const b of document.querySelectorAll('.view-tab')){const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));}lastArtifacts='';}}
  const busy=Boolean(activeId),missingKey=engineStatus?.backend==='openrouter'&&!engineStatus?.openrouter?.configured;$('create-button').disabled=busy||toolBusy||!connected||modelBusy||Boolean(engineStatus?.model_operation)||!engineStatus?.selected_model||missingKey;$('create-label').textContent=busy?'Animation in production':missingKey?'Add API key to start':'Create animation';
  show('stop-button',running(j));show('retry-button',!!j&&['failed','cancelled','interrupted'].includes(j.status)&&!busy);$('stop-button').disabled=false;
  $('project-title').textContent=j?.title||'Animation preview';
  const previewWidth=j?.settings?.width||($('quality').value==='ultra'?3840:$('quality').value==='studio'?1920:1280);$('resolution-label').textContent=`${previewWidth} × ${j?.settings?.height||Math.round(previewWidth*9/16)}`;
  renderStages(j);$('stage-message').textContent=j?.message||'Describe your animation to begin.';
  const warnings=j?.warnings||[];show('production-warnings',warnings.length>0);$('production-warnings').replaceChildren(...warnings.map(w=>el('p',null,w)));
  show('generation-note',running(j)&&['loading','planning','modeling','review'].includes(j.stage));
  $('generation-title').textContent=j?.stage==='loading'?'Waking up the director':j?.stage==='review'?'Looking at the actual frames':'Director is thinking';
  if(j?.scene_repair&&j.stage==='modeling')$('generation-title').textContent=`Correcting scene fields (${j.scene_repair.attempt}/${j.scene_repair.limit})`;
  $('generation-detail').textContent=j?.generation?`${j.generation.tokens!=null||j.generation.generation_tokens!=null?`${j.generation.tokens??j.generation.generation_tokens} tokens`:`${j.generation.chunks||0} response chunks`} · ${shortTime(j.generation.seconds||0)}`:'Loading the local model';
  if(j?.build_progress&&j.stage==='modeling'&&!j.scene_repair)$('generation-title').textContent=`${j.build_progress.name} · ${j.build_progress.completed}/${j.build_progress.total} assets`;
  const r=j?.render;show('render-meter',!!r);if(r){$('render-progress').max=r.total;$('render-progress').value=r.frame;$('render-frames').textContent=`${r.frame} / ${r.total} frames`;$('render-percent').textContent=`${Math.floor(r.frame/r.total*100)}%`;}
  $('frames-count').textContent=String(j?.previews?.length||0).padStart(2,'0');$('assets-count').textContent=String(j?.assets?.length||0).padStart(2,'0');$('shots-count').textContent=String((j?.shots||j?.plan?.shots||[]).length).padStart(2,'0');
  if(j?.video&&j.status==='complete'){
    if(!manualPreview||selected?.status!=='complete'){manualPreview=false;setVideo(j.video);}
    show('delivery',true);show('watch-button',true);$('download-video').href=j.video;$('download-blend').href=j.blend;show('download-glb',Boolean(j.glb));if(j.glb)$('download-glb').href=j.glb;
    $('delivery-title').textContent=j.title;$('delivery-meta').textContent=`${j.video_info.duration}s · ${j.video_info.width} × ${j.video_info.height} · ${j.video_info.frames} frames${j.source==='built_in_demo'?' · Tool demonstration':j.source==='imported_scene'?' · Imported scene':j.source==='model_refinement'?' · Model refinement':''}`;
  }else{
    show('delivery',false);show('watch-button',false);
    if(!manualPreview&&running(j)&&j.latest_frame&&j.stage==='rendering')setPreview(j.latest_frame,`RENDERING / FRAME ${j.render.frame}`);
    else if(!manualPreview&&j?.previews?.length)setPreview(j.previews[0].url);
    else if(!manualPreview&&j?.assets?.length&&!selectedImage)setPreview(j.assets[0].url,'BLENDER / MODEL PREVIEW');
    else if(!j){show('empty-scene',true);show('preview-image',false);show('result-video',false);show('viewport-label',false);$('viewport').classList.remove('has-video');}
  }
  show('process-detail',Boolean(j));renderArtifacts(j);renderNotes(j);renderJournal(j);renderVersions(j);
  show('scene-download',Boolean(j?.scene_url));if(j?.scene_url)$('scene-download').href=j.scene_url;
  show('refinement-panel',j?.status==='complete'&&Boolean(j?.scene_url));$('refine-animation').disabled=busy||toolBusy||!connected||modelBusy||Boolean(engineStatus?.model_operation)||missingKey||!engineStatus?.selected_model;
  if(j&&['failed','interrupted'].includes(j.status)){show('form-error',true);$('form-error').textContent=j.message;}else show('form-error',false);
  selected=j;updateElapsed();
  for(const id of ['render-demo','render-scene','validate-scene'])$(id).disabled=busy||toolBusy||!connected;
  for(const id of ['reference-files','model-asset-file','image-asset-files','audio-asset-file'])$(id).disabled=busy||toolBusy||!connected;
  renderLibrary();
}
function updateElapsed(){const j=selected;$('elapsed').textContent=j?.started_at?shortTime((j.finished_at||Date.now()/1000)-j.started_at):'—';}
function renderHistory(){
  $('history-count').textContent=allJobs.length;
  const sig=JSON.stringify(allJobs.map(j=>[j.id,j.title,j.status,j.previews?.at(0)?.url,j.video]));if(sig===historySignature)return;historySignature=sig;
  if(!allJobs.length)return;
  $('history-grid').replaceChildren(...allJobs.map(j=>{
    const card=el('button','history-card');card.type='button';const thumb=j.previews?.[0]?.url||j.assets?.[0]?.url;
    if(thumb){const img=el('img');img.src=thumb;img.loading='lazy';img.alt=j.title;card.append(img);}else card.append(el('div','history-placeholder',j.status==='running'?'✳':'↗'));
    const body=el('div','history-card-body');const info=el('p');info.append(el('span',null,`${j.settings.duration}s / ${j.settings.quality==='ultra'?'4K':j.settings.quality==='studio'?'1080p':'720p'}`),el('span',null,label(j.status)+(j.source==='built_in_demo'?' · Tool demo':j.source==='imported_scene'?' · Imported':j.source==='model_refinement'?' · Refinement':'')));body.append(el('strong',null,j.title),info);card.append(body);
    card.addEventListener('click',()=>{resetPanels();selected=null;render(j);if(j.video)setVideo(j.video);$('prompt').value=j.prompt;$('duration').value=j.settings.duration;$('quality').value=j.settings.quality;restoreProductionSettings(j);countChars();$('workspace').scrollIntoView({behavior:'smooth',block:'start'});});return card;
  }));
}
async function poll(){
  if(pollBusy)return;pollBusy=true;
  try{
    const status=await api('/api/status');token=status.token;activeId=status.active_job;engineStatus=status;connected=true;
    if(!localModels.length)localModels=(await api('/api/models')).models;
    renderModels();
    $('connection-dot').classList.remove('offline');$('connection-label').textContent=status.backend==='openrouter'?(status.model_state==='ready'?'DeepSeek connected':status.model_state==='loading'?'Connecting API':status.openrouter?.configured?'OpenRouter configured':'Add OpenRouter key'):status.model_state==='ready'?'Model loaded':status.model_state==='loading'?'Loading model':status.model_state==='unloading'?'Unloading model':'Local engine connected';
    allJobs=await api('/api/jobs');renderHistory();
    if(selected){const fresh=allJobs.find(j=>j.id===selected.id);if(fresh)render(fresh);}
    else if(activeId){resetPanels();render(allJobs.find(j=>j.id===activeId));}
    else if(!bootstrapped&&allJobs.length){resetPanels();render(allJobs[0]);}
    else render(null);
    bootstrapped=true;
  }catch(e){connected=false;renderModels();$('connection-dot').classList.add('offline');$('connection-label').textContent='Engine disconnected';$('create-button').disabled=true;if(selected&&running(selected))$('stage-message').textContent='Connection lost. This page will reconnect automatically.';}
  finally{pollBusy=false;}
}
function countChars(){$('char-count').textContent=`${$('prompt').value.length} / 4000`;}
$('openrouter-form').addEventListener('submit',async event=>{
  event.preventDefault();if(modelBusy)return;modelBusy=true;modelError='';renderModels();render(selected);
  try{const value=$('openrouter-key').value;await api('/api/openrouter/key',{method:'POST',body:JSON.stringify({api_key:value})});$('openrouter-key').value='';engineStatus=await api('/api/status');}
  catch(error){modelError=error.message;}
  finally{modelBusy=false;renderModels();render(selected);}
});
$('openrouter-forget').addEventListener('click',async()=>{
  if(modelBusy)return;modelBusy=true;modelError='';renderModels();
  try{await api('/api/openrouter/key',{method:'POST',body:JSON.stringify({clear:true})});$('openrouter-key').value='';engineStatus=await api('/api/status');}
  catch(error){modelError=error.message;}
  finally{modelBusy=false;renderModels();render(selected);}
});
$('model-select').addEventListener('change',()=>modelAction('select',{model_id:$('model-select').value}));
$('model-load').addEventListener('click',()=>modelAction('load',{model_id:$('model-select').value}));
$('model-unload').addEventListener('click',()=>modelAction('unload'));
$('model-refresh').addEventListener('click',async()=>{
  if(modelBusy)return;modelBusy=true;modelError='';renderModels();
  try{localModels=(await api('/api/models?refresh=1')).models;}catch(e){modelError=e.message;}
  finally{modelBusy=false;renderModels();}
});
$('model-add-form').addEventListener('submit',async event=>{
  event.preventDefault();if(modelBusy)return;modelBusy=true;modelError='';renderModels();
  try{const result=await api('/api/models/add',{method:'POST',body:JSON.stringify({path:$('model-folder').value.trim()})});localModels=result.models;engineStatus=await api('/api/models/select',{method:'POST',body:JSON.stringify({model_id:result.model.id})});$('model-folder').value='';}
  catch(e){modelError=e.message;}
  finally{modelBusy=false;renderModels();render(selected);}
});
$('prompt').addEventListener('input',countChars);countChars();
$('quality').addEventListener('change',()=>{if(!selected)render(null);});
$('create-form').addEventListener('submit',async e=>{
  e.preventDefault();show('form-error',false);$('create-button').disabled=true;
  try{const j=await api('/api/jobs',{method:'POST',body:JSON.stringify({prompt:$('prompt').value,...productionSettings()})});activeId=j.id;resetPanels();selected=null;videoSource='';render(j);await poll();}
  catch(err){$('form-error').textContent=err.message;show('form-error',true);$('create-button').disabled=false;}
});
$('stop-button').addEventListener('click',async()=>{if(!selected)return;$('stop-button').disabled=true;try{await api(`/api/jobs/${selected.id}/cancel`,{method:'POST',body:'{}'});$('stage-message').textContent='Stopping production…';}catch(e){$('stage-message').textContent=e.message;}});
for(const b of document.querySelectorAll('.view-tab'))b.addEventListener('click',()=>{manualTab=true;tab=b.dataset.tab;for(const other of document.querySelectorAll('.view-tab')){other.classList.toggle('active',other===b);other.setAttribute('aria-selected',String(other===b));}lastArtifacts='';renderArtifacts(selected);});
$('retry-button').addEventListener('click',async()=>{if(!selected)return;$('retry-button').disabled=true;try{const j=await api(`/api/jobs/${selected.id}/retry`,{method:'POST',body:'{}'});activeId=j.id;render(j);}catch(e){$('stage-message').textContent=e.message;}finally{$('retry-button').disabled=false;}});
$('watch-button').addEventListener('click',()=>{if(!selected?.video)return;manualPreview=false;setVideo(selected.video);$('result-video').play().catch(()=>{});});
$('fullscreen-button').addEventListener('click',()=>{$('viewport').requestFullscreen?.().catch(()=>{});});
$('library-nav').addEventListener('click',()=>$('history').scrollIntoView({behavior:'smooth'}));
$('studio-nav').addEventListener('click',()=>$('workspace').scrollIntoView({behavior:'smooth'}));
$('new-film').addEventListener('click',()=>{if(activeId){$('workspace').scrollIntoView({behavior:'smooth'});return;}resetPanels();selected=null;render(null);$('prompt').focus();$('workspace').scrollIntoView({behavior:'smooth'});});
function restoreProductionSettings(job){
  const s=job.settings;const values={duration:s.duration,quality:s.quality,detail:s.detail||'concept','visual-style':s.style||'auto',aspect:s.aspect||'16:9',fps:s.fps||24,'review-budget':s.reviews??2,'render-engine':s.engine||'eevee','speech-rate':s.speech_rate||170,'audio-volume':s.audio_volume??.35};
  for(const [id,value] of Object.entries(values))$(id).value=String(value);$('narration').value=s.narration||'';if(s.voice)$('narrator-voice').value=s.voice;
  selectedReferences=new Set(job.references||[]);renderLibrary();$('soundtrack').value=s.audio_id||'';
}
function productionSettings(){return {duration:Number($('duration').value),quality:$('quality').value,detail:$('detail').value,style:$('visual-style').value,aspect:$('aspect').value,fps:Number($('fps').value),reviews:Number($('review-budget').value),engine:$('render-engine').value,references:[...selectedReferences],narration:$('narration').value,voice:$('narrator-voice').value,speech_rate:Number($('speech-rate').value),audio_id:$('soundtrack').value||null,audio_volume:Number($('audio-volume').value)};}
function acceptJob(j){activeId=j.id;resetPanels();selected=null;videoSource='';render(j);$('workspace').scrollIntoView({behavior:'smooth',block:'start'});}
function toolStatus(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('error',error);}
async function toolRequest(status,work){
  if(toolBusy||activeId)return;toolBusy=true;render(selected);toolStatus(status,'Working…');
  try{await work();}catch(error){toolStatus(status,error.message,true);}
  finally{toolBusy=false;render(selected);}
}
$('render-demo').addEventListener('click',()=>toolRequest('tool-status',async()=>{
  const job=await api('/api/demos/render',{method:'POST',body:JSON.stringify({...productionSettings(),demo:$('demo-select').value})});acceptJob(job);toolStatus('tool-status','Building a hand-authored Blender tool demonstration. No model is called.');await poll();
}));
$('load-scene').addEventListener('click',()=>toolRequest('scene-editor-status',async()=>{
  if(!selected)throw new Error('Select an animation first.');
  const scene=await api(selected.scene_url||`/artifacts/${selected.id}/scene.json`);$('scene-editor').value=JSON.stringify(scene,null,2);sceneParent=selected.id;
  restoreProductionSettings(selected);toolStatus('scene-editor-status',`Loaded ${selected.title}. Editing creates a separate animation.`);
}));
$('scene-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>4*1024*1024)throw new Error('Scene files must be at most 4 MiB.');const text=await file.text();JSON.parse(text);$('scene-editor').value=text;sceneParent=null;toolStatus('scene-editor-status','Scene loaded. Set its duration above, then validate or render.');}catch(error){toolStatus('scene-editor-status',error.message,true);}
  event.target.value='';
});
$('validate-scene').addEventListener('click',()=>toolRequest('scene-editor-status',async()=>{
  const result=await api('/api/scene/validate',{method:'POST',body:JSON.stringify({...productionSettings(),scene:JSON.parse($('scene-editor').value)})});toolStatus('scene-editor-status',`Valid scene: ${result.title}${result.capability_summary?` · ${result.capability_summary.authored_parts} authored parts · approximately ${result.capability_summary.estimated_vertices.toLocaleString()} vertices`:''}. This checks structure and resource limits; it does not score visual quality.`);
}));
$('render-scene').addEventListener('click',()=>toolRequest('scene-editor-status',async()=>{
  const job=await api('/api/jobs/from-scene',{method:'POST',body:JSON.stringify({...productionSettings(),scene:JSON.parse($('scene-editor').value),parent_job:sceneParent})});acceptJob(job);toolStatus('scene-editor-status','Rendering a new version. The original is preserved.');await poll();
}));
$('refine-animation').addEventListener('click',()=>toolRequest('refinement-status',async()=>{
  if(!selected||selected.status!=='complete')throw new Error('Select a completed animation first.');
  const instruction=$('refinement-instruction').value.trim();
  if(instruction.length<8)throw new Error('Describe the improvement in at least 8 characters.');
  const job=await api(`/api/jobs/${selected.id}/refine`,{method:'POST',body:JSON.stringify({instruction,reviews:Number($('refinement-reviews').value)})});
  acceptJob(job);toolStatus('refinement-status','Improving a separate version with the selected model.');await poll();
}));
async function loadTools(){
  try{const [caps,demos]=await Promise.all([api('/api/capabilities'),api('/api/demos')]);$('capability-count').textContent=`· ${caps.geometry.length} geometry tools`;
    $('capability-overview').textContent=`${caps.geometry.length} geometry tools · ${caps.modifiers.length} modifiers · procedural materials, moving parts, paths, scatter, lighting, atmosphere and camera controls.`;
    $('capability-tags').replaceChildren(...[...caps.geometry,...caps.modifiers].map(name=>el('span',null,name)));
    $('demo-select').replaceChildren(...demos.map(d=>{const option=el('option',null,d.title);option.value=d.id;option.title=d.description;return option;}));
  }catch(error){toolStatus('tool-status',error.message,true);}
}
function renderLibrary(){
  const signature=JSON.stringify([libraryItems,[...selectedReferences],Boolean(activeId),toolBusy]);if(signature===librarySignature)return;librarySignature=signature;
  $('library-count').textContent=libraryItems.length?`· ${libraryItems.length} assets`:'';
  const cards=libraryItems.map(item=>{
    const card=el('div','library-item');if(item.kind==='image'){const image=el('img');image.src=item.url;image.alt=item.name;card.append(image);}
    const body=el('div');body.append(el('div','library-kind',item.kind.toUpperCase()),el('strong',null,item.name),el('small',null,item.kind==='image'?`${item.width} × ${item.height}`:item.kind==='model'?`${item.vertices.toLocaleString()} vertices · ${item.animations} animations`:`${shortTime(item.duration)} audio`),el('code',null,item.id));
    if(item.kind==='image'){
      const label=el('label'),input=el('input');input.type='checkbox';input.checked=selectedReferences.has(item.id);input.disabled=Boolean(activeId)||toolBusy;
      input.addEventListener('change',()=>{if(input.checked&&selectedReferences.size>=4){input.checked=false;toolStatus('library-status','Choose at most four references.',true);return;}if(input.checked)selectedReferences.add(item.id);else selectedReferences.delete(item.id);renderLibrary();});label.append(input,document.createTextNode('Use as reference'));body.append(label);
    }
    card.append(body);return card;
  });$('asset-library-list').replaceChildren(...(cards.length?cards:[el('p',null,'Your imported models, textures and soundtracks will appear here.')]));
  $('selected-references').replaceChildren(...[...selectedReferences].map(id=>{const item=libraryItems.find(i=>i.id===id);if(!item)return el('span');const wrap=el('div','selected-reference'),img=el('img'),remove=el('button',null,'×');img.src=item.url;img.alt=item.name;remove.type='button';remove.setAttribute('aria-label',`Remove reference ${item.name}`);remove.disabled=Boolean(activeId)||toolBusy;remove.addEventListener('click',()=>{selectedReferences.delete(id);renderLibrary();});wrap.append(img,remove);return wrap;}));
  const audio=$('soundtrack').value;$('soundtrack').replaceChildren(el('option',null,'None'),...libraryItems.filter(i=>i.kind==='audio').map(i=>{const option=el('option',null,i.name);option.value=i.id;return option;}));$('soundtrack').options[0].value='';$('soundtrack').value=audio;
}
async function loadMedia(){
  try{const [items,voices]=await Promise.all([api('/api/library'),api('/api/voices')]);libraryItems=items;renderLibrary();
    const previous=$('narrator-voice').value;$('narrator-voice').replaceChildren(...voices.sort((a,b)=>a.locale.localeCompare(b.locale)||a.id.localeCompare(b.id)).map(v=>{const option=el('option',null,`${v.id} · ${v.locale}`);option.value=v.id;return option;}));
    const preferred=voices.find(v=>v.id===previous)||voices.find(v=>v.id.startsWith('Daniel')&&v.locale==='en_GB')||voices.find(v=>v.id.startsWith('Samantha'))||voices[0];if(preferred)$('narrator-voice').value=preferred.id;else{$('narration').disabled=true;$('narration').placeholder='No installed local voice is available.';}
  }catch(error){toolStatus('library-status',error.message,true);}
}
async function uploadAssets(input,kind,asReferences=false){
  const files=[...input.files];if(!files.length)return;
  await toolRequest('library-status',async()=>{
    let count=0;for(const file of files){const item=await api(`/api/library/${kind}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-Asset-Name':encodeURIComponent(file.name)},body:file});if(asReferences&&selectedReferences.size<4)selectedReferences.add(item.id);count++;}
    libraryItems=await api('/api/library');renderLibrary();toolStatus('library-status',`Added ${count} ${kind} asset${count===1?'':'s'} locally.${asReferences?` ${selectedReferences.size} reference image(s) selected.`:''}`);
  });input.value='';
}
$('reference-files').addEventListener('change',event=>uploadAssets(event.target,'image',true));
$('image-asset-files').addEventListener('change',event=>uploadAssets(event.target,'image'));
$('model-asset-file').addEventListener('change',event=>uploadAssets(event.target,'model'));
$('audio-asset-file').addEventListener('change',event=>uploadAssets(event.target,'audio'));
render(null);poll();loadTools();loadMedia();setInterval(poll,2000);setInterval(updateElapsed,1000);
