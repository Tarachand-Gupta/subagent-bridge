'use strict';
const $=s=>document.querySelector(s),names={codex:'Codex',claude:'Claude Code',pi:'Pi',opencode:'OpenCode',deepseek:'DeepSeek'},presets=['General task','Code review','Implementation','Debugging','Research'];
const modelProbes=new Map();
const catalogs=new Map(),probing=new Set(),cards=new Map(),installing=new Set();let setupStatus=null,setupLoading=false,setupError='',setupRevision=0;let baseRevision;let agents=[],config={version:1,routes:[]},loaded=false,dirty=false,busy=false,connections={};
let viewMode='new';try{viewMode=localStorage.getItem('bridge-rule-view')==='old'?'old':'new';}catch{}
const native=()=>window.__TAURI__?.core?.invoke;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function notice(text,error=false){$('#notice').textContent=text;$('#notice').hidden=!text;$('#notice').classList.toggle('error',error);}
async function api(path,body){const invoke=native();if(invoke){let result=await invoke('bridge',{method:body===undefined?'GET':'POST',path,body:body??null});if(typeof result==='string'){try{result=JSON.parse(result);}catch{throw new Error(result);}}if(result?.error&&!result?.models)throw Object.assign(new Error(result.error),{code:result.code});return result;}const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','x-bridge-token':$('meta[name="bridge-token"]').content},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||result.message||`Request failed (${response.status})`),{code:result.code});return result;}
function normalize(r){r.parents=Array.isArray(r.parents)?r.parents:r.parent&&r.parent!=='*'?[r.parent]:[];r.workers=Array.isArray(r.workers)?r.workers:r.worker&&r.worker!=='auto'?[r.worker]:[];r.models=Array.isArray(r.models)?r.models:r.model&&r.workers.length===1?[{worker:r.workers[0],id:r.model}]:[];r.reasoning=r.reasoning||'';r.reasoningByWorker=r.reasoningByWorker&&typeof r.reasoningByWorker==='object'?r.reasoningByWorker:{};r.task=r.task||'Auto';r.usage=r.usage||'can';sync(r);return r;}
function sync(r){r.parent=r.parents.length===1?r.parents[0]:'*';r.worker=r.workers.length===1?r.workers[0]:'auto';r.model=r.models.length===1?r.models[0].id:'';}
function changed(r){if(r)sync(r);dirty=true;controls();}
function controls(){$('#save-only').disabled=!loaded||busy;$('#save-only').textContent='Save rules';$('#add').disabled=false;$('#save-status').textContent=busy?'Saving…':!loaded?'Waiting for connection':dirty?'Unsaved changes':'Rules saved · connections in Settings';$('#rule-count').textContent=config.routes.length;}
function infoButton(label,text){
 const wrap=el('span','info-control'),button=el('button','info-button','i'),tip=el('span','info-tooltip',text);button.type='button';button.setAttribute('aria-label',label);tip.id=`tip-${crypto.randomUUID()}`;tip.setAttribute('role','tooltip');button.setAttribute('aria-describedby',tip.id);button.setAttribute('aria-expanded','false');wrap.append(button,tip);
 function place(){tip.style.left='0px';tip.style.right='auto';const bounds=tip.getBoundingClientRect();if(bounds.right>window.innerWidth-18)tip.style.left=`${window.innerWidth-18-bounds.right}px`;}
 wrap.addEventListener('pointerenter',place);wrap.addEventListener('focusin',place);button.addEventListener('click',()=>{const open=wrap.classList.toggle('tip-open');button.setAttribute('aria-expanded',String(open));place();});wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){wrap.classList.remove('tip-open');button.setAttribute('aria-expanded','false');button.blur();event.stopPropagation();}});return wrap;
}
function connectionText(){
 $('#agent-section-info').replaceChildren(infoButton('How agent connections work','Each connected parent uses its own project folder. Saved rules refresh each turn after its integration is loaded. Followups retain the same worker conversation; messages sent while busy queue for its next turn. Click a model count to refresh discovery.'));
 $('#mcp-section-info').replaceChildren(infoButton('About MCP setup','Install Bridge’s MCP configuration tools for a supported harness, or copy the configuration for a manual setup. MCP configuration access is separate from native task delegation.'));
 $('#skills-section-info').replaceChildren(infoButton('About skill setup','Install the Bridge skill in the selected harness’s supported skill directory. It explains how to inspect and update shared rules, plus how native delegation works. A skill does not add model access or replace the native integration.'));
}
function option(value,text){const o=el('option','',text);o.value=value;return o;}
function sizeSelect(s){
 const text=s.selectedOptions[0]?.textContent||'';s.style.width=`${Math.max(4,text.length*.5+1)}em`;
 requestAnimationFrame(()=>{if(!s.isConnected)return;const style=getComputedStyle(s),measure=document.createElement('canvas').getContext('2d');measure.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;const spacing=parseFloat(style.letterSpacing)||0;s.style.width=`${Math.ceil(measure.measureText(s.selectedOptions[0]?.textContent||'').width+text.length*spacing+24)}px`;});
}
function select(label,entries,value,callback){const s=el('select');s.setAttribute('aria-label',label);for(const[v,t]of entries)s.append(option(v,t));s.value=value;sizeSelect(s);s.addEventListener('change',()=>{sizeSelect(s);callback(s.value);});return s;}
function workerIds(r){return r.workers.length?r.workers:agents.filter(a=>a.installed&&a.acpReady).map(a=>a.id);}
function levels(worker,model){
 const c=catalogs.get(worker),m=c?.models.find(m=>m.id===(model||c.currentModel));
 return(m?.reasoning||[]).map(v=>typeof v==='string'?[v,v]:[String(v.value),v.name||String(v.value)]);
}
async function probeThinking(worker,model){
 const key=modelKey({worker,id:model});if(modelProbes.has(key))return modelProbes.get(key);
 const pending=(async()=>{try{
  const result=await api('/api/probe',{agentId:worker,modelId:model}),catalog=catalogs.get(worker)||{models:[]};
  const queried=result.models?.find(m=>m.id===model);
  if(queried){const existing=catalog.models.find(m=>m.id===model);if(existing)existing.reasoning=queried.reasoning||[];else catalog.models.push(queried);catalogs.set(worker,catalog);}
  return queried?.reasoning||[];
 }catch(error){throw error;}finally{refreshCards();}})();
 modelProbes.set(key,pending);try{return await pending;}finally{modelProbes.delete(key);}
}
function thinking(r){const alternatives=workerIds(r).flatMap(worker=>{const ms=r.models.filter(m=>m.worker===worker);return(ms.length?ms:[{id:''}]).map(m=>levels(worker,m.id));});if(!alternatives.length)return[];return alternatives[0].filter(([v])=>alternatives.every(opts=>opts.some(([id])=>id===v)));}
async function probe(id){if(probing.has(id))return;probing.add(id);renderAgents();refreshCards();try{const c=await api('/api/probe',{agentId:id});catalogs.set(id,{...c,models:(c.models||[]).map(m=>typeof m==='string'?{id:m,name:m}:m)});}catch(e){catalogs.set(id,{models:[],error:e.message});}finally{probing.delete(id);renderAgents();refreshCards();}}
function refreshCards(){for(const card of cards.values())card.refresh();}
function ensureCatalogs(r){for(const id of workerIds(r))if(!catalogs.has(id)&&!probing.has(id))probe(id);}
function modelKey(m){return JSON.stringify([m.worker,m.id]);}
function modelLabel(m){const c=catalogs.get(m.worker);return`${names[m.worker]||m.worker} / ${c?.models.find(o=>o.id===m.id)?.name||m.id}`;}
function modelEntries(r){const result=[];for(const id of workerIds(r)){const c=catalogs.get(id);for(const m of c?.models||[]){const provider=m.provider?.name||m.provider?.id||m.provider||(m.id.includes('/')?m.id.split('/')[0]:'Catalog');result.push({value:modelKey({worker:id,id:m.id}),label:m.name||m.id,chip:`${names[id]} / ${m.name||m.id}`,detail:m.id,group:`${names[id]} · ${provider}`});}}for(const m of r.models)if(!result.some(o=>o.value===modelKey(m)))result.push({value:modelKey(m),label:m.id,chip:modelLabel(m),detail:'Saved selection · not in discovered catalog',group:names[m.worker]||m.worker});return result;}
// Refresh picker contents in place so model discovery never steals focus or closes it.
function multiPicker({label,auto,entries,values,choose,onOpen,models=false,embedded=false}){const wrap=el('div','combo'),button=el('button','chip combo-trigger'),chips=el('span','combo-chips'),popup=el('div','model-popover'),search=el('input','model-search'),options=el('div','model-options');button.type='button';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');popup.hidden=true;popup.id=`picker-${crypto.randomUUID()}`;button.setAttribute('aria-controls',popup.id);search.type='search';search.placeholder=models?'Search harness, provider or model…':'Search agents…';search.setAttribute('aria-label',`Search ${label.toLowerCase()}`);options.setAttribute('role','group');options.setAttribute('aria-label',label);button.append(chips);function close(){if(embedded)return;popup.hidden=true;button.setAttribute('aria-expanded','false');}function fill(){const scroll=options.scrollTop,focused=options.contains(document.activeElement)?document.activeElement?.dataset.value:null,selected=values(),all=entries(),q=search.value.trim().toLowerCase();chips.replaceChildren();if(!selected.length)chips.append(el('span','auto-chip',auto));else for(const [i,value]of selected.entries()){if(i)chips.append(el('span','chip-comma',','));const item=all.find(e=>e.value===value);chips.append(el('span','selection-chip',item?.chip||item?.label||value));}button.title=selected.length?selected.map(value=>{const item=all.find(e=>e.value===value);return item?.chip||item?.label||value;}).join(', '):auto;options.replaceChildren();function row(item,isAuto=false){const active=isAuto?!selected.length:selected.includes(item.value),b=el('button','model-option'+(active?' selected':''));b.type='button';b.dataset.value=isAuto?'__auto__':item.value;b.setAttribute('aria-pressed',String(active));b.append(el('span','option-check',active?'✓':''),el('span','option-label',item.label));if(item.detail)b.append(el('small','',item.detail));b.addEventListener('click',()=>{choose(isAuto?[]:active?selected.filter(v=>v!==item.value):[...selected,item.value]);fill();});options.append(b);}row({label:auto},true);let group='',count=0;for(const item of all){if(q&&!`${item.label} ${item.detail||''} ${item.group||''}`.toLowerCase().includes(q))continue;if(item.group&&item.group!==group){group=item.group;options.append(el('div','option-group',group));}row(item);count++;}if(!count)options.append(el('div','picker-empty',models?'No matching catalog models. Refresh to discover available models.':'No matching agents.'));options.scrollTop=scroll;if(focused!==null)Array.from(options.querySelectorAll('button')).find(b=>b.dataset.value===focused)?.focus({preventScroll:true});}search.addEventListener('input',fill);button.addEventListener('click',()=>{const opening=popup.hidden;for(const other of document.querySelectorAll('.combo'))if(other!==wrap)other.closePicker?.();popup.hidden=!opening;button.setAttribute('aria-expanded',String(opening));if(opening){onOpen?.();fill();popup.style.left='0px';popup.style.top='';popup.style.bottom='';const bounds=popup.getBoundingClientRect();if(bounds.right>window.innerWidth-18)popup.style.left=`${window.innerWidth-18-bounds.right}px`;if(bounds.bottom>window.innerHeight-18&&button.getBoundingClientRect().top>bounds.height+18){popup.style.top='auto';popup.style.bottom='calc(100% + 12px)';}else if(bounds.bottom>window.innerHeight-18){popup.scrollIntoView({block:'nearest'});}search.focus({preventScroll:true});}});wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();e.stopPropagation();}if(e.key==='ArrowDown'&&e.target===search){e.preventDefault();options.querySelector('button')?.focus();}});popup.append(search,options,el('div','picker-hint',models?'Choose alternatives. The parent picks one harness and model per task. Catalog visibility does not verify account access.':'Select one or more, or choose Auto. Multiple selections are alternatives, not parallel runs.'));const done=el('button','text-button picker-done','Done');done.type='button';done.addEventListener('click',()=>{close();button.focus();});popup.append(done);wrap.append(button,popup);wrap.closePicker=close;if(embedded){button.hidden=true;popup.hidden=false;popup.classList.add('embedded-popover');done.hidden=true;wrap.classList.add('embedded-picker');}fill();return{element:wrap,refresh:fill};}
function effectiveReasoning(r,id,model){const selection=r.models.find(m=>m.worker===id&&m.id===model);return selection&&Object.hasOwn(selection,'reasoning')?selection.reasoning:Object.hasOwn(r.reasoningByWorker||{},id)?r.reasoningByWorker[id]:r.reasoning||'';}
function instruction(r){
 const parent=r.parents.length?r.parents.map(v=>names[v]||v).join(', '):'any connected parent',task=r.task==='Auto'?'any task':r.task,worker=r.workers.length?`choose one of ${r.workers.map(v=>names[v]||v).join(', ')}`:'choose one available harness',model=r.models.length?`choose one allowed model (${r.models.map(modelLabel).join(', ')}); use its default model for harnesses without a model selection`:'use its default model';
 const overrides=Object.entries(r.reasoningByWorker||{}),modelOverrides=r.models.filter(m=>Object.hasOwn(m,'reasoning')),reason=modelOverrides.length?`use each model’s thinking setting (${r.models.map(m=>`${modelLabel(m)}: ${effectiveReasoning(r,m.worker,m.id)||'Auto'}`).join('; ')}); models without an override inherit their harness or rule setting`:overrides.length?`use the selected harness’s thinking setting (${overrides.map(([id,value])=>`${names[id]}: ${value||'default'}`).join(', ')}; other harnesses: ${r.reasoning||'default'})`:r.reasoning?`use ${r.reasoning} thinking`:'use its default thinking setting';
 const policy=r.usage==='should'?'delegation is required for matching tasks':'delegation is optional when helpful';
 return`When ${parent} needs ${task}, ${policy}: ${worker}, ${model}, and ${reason}. Inherit the parent session’s project folder.${r.usage==='should'?' If no allowed alternative is available or delegation fails, report the task as blocked; do not silently substitute another agent or do the task yourself.':''}`;
}
function reasoningOptions(control,options,current,{mixed=false}={}){
 control.replaceChildren(option('','Auto · default'),...options.map(([value,name])=>option(value,name.charAt(0).toUpperCase()+name.slice(1))));
 if(mixed){const placeholder=option('__per_harness__','per model');placeholder.disabled=true;control.append(placeholder);control.value='__per_harness__';}
 else{if(current&&!options.some(([value])=>value===current))control.append(option(current,`${current} · saved, unverified`));control.value=current;}
 sizeSelect(control);
}
function positionPopover(popup,button){
 popup.style.position='fixed';popup.style.bottom='auto';popup.style.maxHeight='calc(100vh - 32px)';popup.style.overflowY='auto';
 const anchor=button.getBoundingClientRect(),height=popup.offsetHeight,width=popup.offsetWidth,below=window.innerHeight-anchor.bottom-16;
 popup.style.left=`${Math.max(16,Math.min(anchor.left,window.innerWidth-width-16))}px`;
 popup.style.top=`${Math.max(16,Math.min(below>=height?anchor.bottom+10:anchor.top-height-10,window.innerHeight-height-16))}px`;
}
function compactModelName(worker,model){
 const catalog=catalogs.get(worker)?.models.find(m=>m.id===model),name=catalog?.name||model;
 return name.split(' · ')[0].split('/').at(-1);
}
function providerName(model){const provider=model.provider;return provider?.name||provider?.id||(typeof provider==='string'?provider:null)||model.name?.split(' · ').slice(1).join(' · ')|| (model.id.includes('/')?model.id.split('/')[0]:'Models');}
function workerEditor(r,id,index,updated,chooseWorkers){
 const wrap=el('div','worker-editor inline-worker'),harness=el('button','worker-name',names[id]),join=el('span','worker-join'),slash=el('span','join-slash','/'),withWord=el('span','join-with','with'),trigger=el('button','inline-model-trigger'),summary=el('span','inline-model-summary'),more=el('span','model-more'),popup=el('div','worker-popover compact-model-menu'),search=el('input','model-search'),options=el('div','model-options'),hint=el('div','picker-hint'),effort=el('div','model-effort-popover');
 let thinkingId=null,thinkingAnchor=null,thinkingError='',thinkingLoading=false;
 harness.type=trigger.type='button';harness.setAttribute('aria-label',`Harnesses for rule ${index+1}, ${names[id]} group`);harness.setAttribute('aria-expanded','false');
 trigger.setAttribute('aria-label',`${names[id]} models for rule ${index+1}`);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
 popup.id=`models-${crypto.randomUUID()}`;popup.setAttribute('role','dialog');popup.setAttribute('aria-label',`${names[id]} model selection`);trigger.setAttribute('aria-controls',popup.id);popup.hidden=true;
 search.type='search';search.placeholder='Search models or providers…';search.setAttribute('aria-label',`Search ${names[id]} models for rule ${index+1}`);
 options.setAttribute('role','group');options.setAttribute('aria-label',`${names[id]} model alternatives`);hint.append(infoButton('How model alternatives work','Select one or more models. These are allowed alternatives: the parent picks one per task, not every selection. Auto uses the harness default. Thinking is saved separately for each model.'));
 const done=el('button','text-button picker-done','Done');done.type='button';hint.append(done);
 effort.hidden=true;effort.setAttribute('role','dialog');effort.setAttribute('aria-label','Model thinking');
 const harnessPicker=multiPicker({label:`Choose harnesses for rule ${index+1}`,auto:'Auto · any available harness',embedded:true,entries:()=>Object.keys(names).map(worker=>({value:worker,label:names[worker],detail:agents.find(a=>a.id===worker)?.installed?'Installed':'Not detected'})),values:()=>r.workers,choose:chooseWorkers});
 const harnessMenu=el('div','worker-popover harness-menu');harnessMenu.hidden=true;harnessMenu.append(el('div','option-group','ALLOWED HARNESSES'),harnessPicker.element);
 function closeThinking(){effort.hidden=true;thinkingAnchor?.setAttribute('aria-expanded','false');thinkingId=null;thinkingAnchor=null;}
 function close(){popup.hidden=true;harnessMenu.hidden=true;closeThinking();wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');harness.setAttribute('aria-expanded','false');}
 function closeOthers(){for(const other of document.querySelectorAll('.worker-editor'))if(other!==wrap)other.closeEditor?.();for(const combo of document.querySelectorAll('.combo'))combo.closePicker?.();}
 function openModels(){closeOthers();harnessMenu.hidden=true;harness.setAttribute('aria-expanded','false');popup.hidden=false;wrap.classList.add('is-open');trigger.setAttribute('aria-expanded','true');if(!catalogs.has(id)&&!probing.has(id))probe(id);refresh();positionPopover(popup,trigger);search.focus({preventScroll:true});}
 harness.addEventListener('click',()=>{const opening=harnessMenu.hidden;closeOthers();close();if(opening){harnessMenu.hidden=false;wrap.classList.add('is-open');harness.setAttribute('aria-expanded','true');harnessPicker.refresh();positionPopover(harnessMenu,harness);harnessMenu.querySelector('input')?.focus({preventScroll:true});}});
 trigger.addEventListener('click',()=>popup.hidden?openModels():close());done.addEventListener('click',()=>{close();trigger.focus();});
 search.addEventListener('input',fillModels);
 function selectModel(model){const selected=r.models.find(m=>m.worker===id&&m.id===model);if(selected){r.models=r.models.filter(m=>m!==selected);if(thinkingId===model)closeThinking();}else r.models.push({worker:id,id:model});changed(r);updated();}
 function renderThinking(){
  if(!thinkingId)return;const model=thinkingId,selected=r.models.find(m=>m.worker===id&&m.id===model);if(!selected){closeThinking();return;}
  const focus=document.activeElement?.dataset.effortControl,value=effectiveReasoning(r,id,model),choices=levels(id,model);effort.replaceChildren();
  const title=el('div','effort-title',compactModelName(id,model)),top=el('div','effort-top'),auto=el('button','effort-auto'+(!value?' active':''),'Auto'),label=el('output','effort-value',value||'Auto'),reset=el('button','effort-reset','↺');auto.type=reset.type='button';auto.dataset.effortControl='auto';reset.dataset.effortControl='reset';auto.setAttribute('aria-pressed',String(!value));reset.setAttribute('aria-label',`Reset ${compactModelName(id,model)} thinking to Auto`);
  function set(value){selected.reasoning=value;changed(r);updated();renderThinking();}
  auto.addEventListener('click',()=>set(''));reset.addEventListener('click',()=>set(''));top.append(auto,label,reset);effort.append(title,top);
  if(choices.length){const slider=el('input','effort-slider');slider.type='range';slider.min='0';slider.max=String(choices.length);slider.step='1';slider.value=String(value?Math.max(0,choices.findIndex(([v])=>v===value)+1):0);slider.dataset.effortControl='slider';slider.setAttribute('aria-label',`${compactModelName(id,model)} thinking level`);slider.setAttribute('aria-valuetext',value||'Auto');slider.addEventListener('input',()=>{const next=Number(slider.value)===0?'':choices[Number(slider.value)-1][0];selected.reasoning=next;label.textContent=next||'Auto';slider.setAttribute('aria-valuetext',next||'Auto');auto.classList.toggle('active',!next);auto.setAttribute('aria-pressed',String(!next));changed(r);});slider.addEventListener('change',()=>{updated();effort.querySelector('[data-effort-control=slider]')?.focus({preventScroll:true});});effort.append(slider);const labels=el('div','effort-ticks');for(const text of ['Auto',...choices.map(([,name])=>name)])labels.append(el('span','',text));effort.append(labels);}
  if(thinkingLoading||thinkingError||!choices.length||value&&!choices.some(([v])=>v===value)){effort.append(el('p','effort-note',thinkingLoading?'Checking this model’s controls…':thinkingError||value&&!choices.some(([v])=>v===value)?thinkingError||`Saved “${value}” is not currently advertised. Choose Auto to use the default.`:'This model has not advertised thinking controls. Auto uses its default.'));}
  if(focus)effort.querySelector(`[data-effort-control="${focus}"]`)?.focus({preventScroll:true});
 }
 function positionThinking(){if(!thinkingAnchor)return;const rect=thinkingAnchor.getBoundingClientRect(),width=260;effort.style.width=`${Math.min(width,window.innerWidth-32)}px`;effort.style.left=`${Math.max(16,Math.min(rect.right+12,window.innerWidth-width-16))}px`;effort.style.top=`${Math.max(16,Math.min(rect.top,window.innerHeight-effort.offsetHeight-16))}px`;}
 async function openThinking(model,anchor){thinkingId=model;thinkingAnchor=anchor;thinkingError='';effort.hidden=false;const metadata=catalogs.get(id)?.models.find(m=>m.id===model);thinkingLoading=!Array.isArray(metadata?.reasoning);renderThinking();positionThinking();effort.querySelector('button')?.focus({preventScroll:true});if(thinkingLoading){try{await probeThinking(id,model);}catch(error){if(thinkingId===model)thinkingError=error.message;}finally{if(thinkingId===model){thinkingLoading=false;renderThinking();positionThinking();}}}}
 function fillModels(){
  const previousScroll=options.scrollTop,focused=document.activeElement?.dataset.modelControl,q=search.value.trim().toLowerCase(),catalog=catalogs.get(id),models=[...(catalog?.models||[])];
  for(const selected of r.models.filter(m=>m.worker===id))if(!models.some(m=>m.id===selected.id))models.push({id:selected.id,name:selected.id,saved:true});
  options.replaceChildren();const auto=el('button','model-option auto-model'+(!r.models.some(m=>m.worker===id)?' selected':''),'Auto · harness default');auto.type='button';auto.setAttribute('aria-pressed',String(!r.models.some(m=>m.worker===id)));auto.dataset.modelControl='auto';auto.addEventListener('click',()=>{r.models=r.models.filter(m=>m.worker!==id);closeThinking();changed(r);updated();});options.append(auto);
  const groups=new Map();for(const model of models){if(q&&!`${model.name} ${model.id} ${providerName(model)}`.toLowerCase().includes(q))continue;const group=providerName(model);if(!groups.has(group))groups.set(group,[]);groups.get(group).push(model);}
  const isSelected=model=>r.models.some(m=>m.worker===id&&m.id===model.id);
  for(const [provider,list]of [...groups].sort((a,b)=>Number(b[1].some(isSelected))-Number(a[1].some(isSelected)))){list.sort((a,b)=>Number(isSelected(b))-Number(isSelected(a)));options.append(el('div','option-group',provider));for(const model of list){
   const selected=r.models.some(m=>m.worker===id&&m.id===model.id),row=el('div','model-select-row'+(selected?' selected':'')),choice=el('button','model-row-choice'),name=el('span','model-row-name',compactModelName(id,model.id));choice.type='button';choice.dataset.modelControl=`select:${model.id}`;choice.setAttribute('aria-pressed',String(selected));choice.setAttribute('aria-label',`${selected?'Deselect':'Select'} ${model.name||model.id} from ${provider}`);choice.title=model.id;choice.append(el('span','option-check',selected?'✓':''),name);if(model.saved)choice.append(el('span','saved-model-marker','saved'));choice.addEventListener('click',()=>selectModel(model.id));row.append(choice);
   if(selected){const current=effectiveReasoning(r,id,model.id),control=el('button','model-thinking-button'),bars=el('span','thinking-bars'),opts=levels(id,model.id),amount=current?Math.max(1,opts.findIndex(([v])=>v===current)+1):0;control.type='button';control.dataset.modelControl=`thinking:${model.id}`;control.setAttribute('aria-label',`Thinking for ${model.name||model.id}: ${current||'Auto'}`);control.title=`Thinking: ${current||'Auto'}`;control.setAttribute('aria-expanded',String(thinkingId===model.id));for(let i=1;i<=5;i++){const bar=el('i',amount&&i<=Math.ceil(amount/Math.max(1,opts.length)*5)?'filled':'');bar.style.height=`${4+i*2}px`;bars.append(bar);}control.append(bars);control.addEventListener('click',()=>thinkingId===model.id?closeThinking():openThinking(model.id,control));row.append(control);if(thinkingId===model.id)thinkingAnchor=control;}
   options.append(row);
  }}
  if(!groups.size)options.append(el('p','picker-empty',probing.has(id)?'Discovering models…':catalog?.error||'No matching models.'));options.scrollTop=previousScroll;if(focused)Array.from(options.querySelectorAll('button')).find(b=>b.dataset.modelControl===focused)?.focus({preventScroll:true});
 }
 function refresh(){
  const selected=r.models.filter(m=>m.worker===id),labels=selected.map(m=>compactModelName(id,m.id));summary.textContent=labels.length?labels.slice(0,2).join(', '):'Auto';more.textContent=labels.length>2?`+${labels.length-2}`:'';more.hidden=labels.length<=2;trigger.title=selected.length?selected.map(m=>`${modelLabel(m)} · ${effectiveReasoning(r,id,m.id)||'Auto'} thinking`).join('\n'):'Use the default model in this harness';fillModels();harnessPicker.refresh();if(thinkingId){renderThinking();positionThinking();}
 }
 wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();if(!effort.hidden){const anchor=thinkingAnchor;closeThinking();anchor?.focus();}else{close();trigger.focus();}}});
 wrap.addEventListener('pointerenter',()=>{wrap.style.setProperty('--inline-reveal',`${Math.min(450,window.innerWidth-200)}px`);});
 join.setAttribute('aria-hidden','true');join.append(slash,withWord);trigger.append(summary,more);popup.append(search,options,hint);wrap.append(harness,join,trigger,harnessMenu,popup,effort);wrap.closeEditor=close;wrap.closeThinking=closeThinking;wrap.positionThinking=()=>{if(!popup.hidden)positionPopover(popup,trigger);if(!harnessMenu.hidden)positionPopover(harnessMenu,harness);if(!effort.hidden)positionThinking();};refresh();return{element:wrap,refresh};
}
function renderRules(){
 const root=$('#routes');root.replaceChildren();cards.clear();$('#rules-panel').classList.toggle('new-view',viewMode==='new');
 for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===viewMode));
 if(!config.routes.length){root.append(el('div','empty','No rules yet. Add one to connect your agents.'));controls();return;}
 config.routes.forEach((r,i)=>{
  const card=el('article',`rule ${r.enabled===false?'off':''}`);card.dataset.id=r.id;
  const head=el('div','rule-header'),index=el('span','rule-index',`RULE ${String(i+1).padStart(2,'0')}`),tools=el('div','rule-tools'),toggle=el('input','toggle');index.title=`Rule ID: ${r.id}`;
  toggle.type='checkbox';toggle.checked=r.enabled!==false;toggle.setAttribute('aria-label',`Enable rule ${i+1}`);toggle.addEventListener('change',()=>{r.enabled=toggle.checked;card.classList.toggle('off',!r.enabled);changed(r);});
  const remove=el('button','remove','×');remove.setAttribute('aria-label',`Remove rule ${i+1}`);remove.addEventListener('click',()=>{config.routes.splice(i,1);changed();renderRules();});tools.append(toggle,remove);head.append(index,tools);
  const sentence=el('div','sentence'),word=text=>el('span','word',text),agentEntries=()=>Object.keys(names).map(id=>({value:id,label:names[id],detail:agents.find(a=>a.id===id)?.installed?'Installed':'Not detected'}));
  const parent=multiPicker({label:`Parent agents for rule ${i+1}`,auto:'any agent',entries:agentEntries,values:()=>r.parents,choose:values=>{r.parents=values;changed(r);refresh();}});
  const worker=multiPicker({label:`Worker harnesses for rule ${i+1}`,auto:'any available harness',entries:agentEntries,values:()=>r.workers,choose:values=>{
   r.workers=values;r.models=r.models.filter(m=>!values.length||values.includes(m.worker));if(values.length)r.reasoningByWorker=Object.fromEntries(Object.entries(r.reasoningByWorker||{}).filter(([id])=>values.includes(id)));changed(r);renderWorkerEditors();refresh();ensureCatalogs(r);
  }});
  const model=multiPicker({label:`Models for rule ${i+1}`,auto:'its default model',entries:()=>modelEntries(r),values:()=>r.models.map(modelKey),choose:values=>{r.models=values.map(key=>{const[worker,id]=JSON.parse(key);return r.models.find(m=>m.worker===worker&&m.id===id)||{worker,id};});changed(r);refresh();},onOpen:()=>ensureCatalogs(r),models:true});
  const taskValue=r.task==='Auto'?'Auto':presets.includes(r.task)?r.task:'Custom';
  sentence.append(word('When'),parent.element,word('needs'),select(`Task type for rule ${i+1}`,[['Auto','any task'],...presets.map(p=>[p,p]),['Custom','Custom task…']],taskValue,value=>{r.task=value==='Custom'?'Custom task':value;changed(r);renderRules();}));
  if(taskValue==='Custom'){const custom=el('input','custom-task');custom.placeholder='Describe the task';custom.value=r.task==='Custom task'?'':r.task;custom.setAttribute('aria-label',`Custom task for rule ${i+1}`);custom.addEventListener('input',()=>{r.task=custom.value;changed(r);refresh();});sentence.append(custom);}
  const reasoning=select(`Thinking level for rule ${i+1}`,[],'',value=>{if(value==='__per_harness__')return;r.reasoning=value;r.reasoningByWorker={};r.models=r.models.map(({reasoning,...m})=>m);changed(r);refresh();});
  const usage=select(`Delegation policy for rule ${i+1}`,[['can','can use'],['should','should use']],r.usage,value=>{r.usage=value;changed(r);refresh();});usage.classList.add('usage-select');sentence.append(usage);
  const workerArea=el('span','worker-area'),editors=[],editorMap=new Map();
  function renderWorkerEditors(){
   if(viewMode!=='new')return;const focused=document.activeElement;editors.length=0;for(const node of [...workerArea.childNodes])if(node!==worker.element)node.remove();if(worker.element.parentNode!==workerArea)workerArea.append(worker.element);
   if(!r.workers.length)worker.element.classList.remove('worker-chooser-compact');else worker.element.classList.add('worker-chooser-compact');
   for(const[idIndex,id]of (r.workers.length?r.workers:[...new Set(r.models.map(m=>m.worker))]).entries()){if(idIndex)workerArea.insertBefore(word('and'),worker.element);const editor=editorMap.get(id)||workerEditor(r,id,i,refresh,values=>{r.workers=values;r.models=r.models.filter(m=>!values.length||values.includes(m.worker));if(values.length)r.reasoningByWorker=Object.fromEntries(Object.entries(r.reasoningByWorker||{}).filter(([worker])=>values.includes(worker)));changed(r);renderWorkerEditors();refresh();ensureCatalogs(r);});editorMap.set(id,editor);editors.push(editor);workerArea.insertBefore(editor.element,worker.element);}if(focused?.isConnected)focused.focus({preventScroll:true});
  }
  if(viewMode==='new'){
   const execution=select(`Execution harness for rule ${i+1}`,[['respective','Their respective'],['parent','Parent harness · not supported']],'respective',()=>{});execution.options[1].disabled=true;execution.classList.add('execution-choice');execution.title='Each model runs inside its selected harness, using that harness’s provider configuration. Parent-harness execution is not yet supported.';
   sentence.append(workerArea,word('models in'),execution,word('harnesses.'));renderWorkerEditors();
  }
  else sentence.append(worker.element,word('using'),model.element,word('with'),reasoning,word('thinking.'));
  const policyHelp=el('div','policy-help'),foot=el('div','rule-foot'),preview=el('details','instruction-preview'),previewText=el('p');preview.append(el('summary','','Details & instruction'),policyHelp,foot,previewText);
  function refresh(){
   parent.refresh();worker.refresh();model.refresh();for(const editor of editors)editor.refresh();
   const opts=thinking(r),ids=workerIds(r),effective=ids.flatMap(id=>{const ms=r.models.filter(m=>m.worker===id);return ms.length?ms.map(m=>effectiveReasoning(r,id,m.id)):[effectiveReasoning(r,id)];}),mixed=new Set(effective).size>1,current=effective.length?effective[0]:r.reasoning||'';
   reasoningOptions(reasoning,opts,current,{mixed});previewText.textContent=instruction(r);policyHelp.textContent=r.usage==='should'?'Should use: delegate matching tasks. If delegation cannot run, report the blocker without silently substituting.':'Can use: the parent may delegate when helpful, or handle the task itself.';
   const pending=ids.filter(id=>probing.has(id)),unready=r.workers.filter(id=>!agents.find(a=>a.id===id)?.acpReady);
   foot.textContent=pending.length?`Discovering models for ${pending.map(id=>names[id]).join(', ')}…`:unready.length?`${unready.map(id=>names[id]).join(', ')} needs installation or ACP setup.`:viewMode==='new'?'Choose harnesses by name and models beside them. Each selected model has its own thinking control. Multiple selections are alternatives; the parent chooses one per task.':mixed?'Thinking differs by model. Switching views preserves it; changing this global thinking control replaces those overrides.':!opts.length?'Auto uses each harness’s default thinking setting. No shared explicit thinking levels are advertised.':'Explicit thinking levels shown are supported across the selected alternatives.';
  }
  parent.element.classList.add('parent-choice');worker.element.classList.add('worker-choice');model.element.classList.add('model-choice');const revealModel=()=>{const bounds=model.element.getBoundingClientRect();model.element.style.setProperty('--model-reveal',`${Math.max(bounds.width,sentence.getBoundingClientRect().right-bounds.left-8)}px`);};model.element.addEventListener('pointerenter',revealModel);model.element.addEventListener('focusin',revealModel);reasoning.classList.add('thinking-choice');card.append(head,sentence,preview);root.append(card);cards.set(r.id,{refresh});refresh();
 });controls();
}
function renderAgents(){
 const root=$('#agents');root.replaceChildren();$('#agent-count').textContent=agents.filter(agent=>agent.installed).length;
 for(const agent of agents){
  const c=catalogs.get(agent.id),connection=connections[agent.id]||{},tile=el('article','detected-tile'+(!agent.installed?' not-detected':''));
  const state=!agent.installed?'Not found':connection.current&&connection.trustRequired?'Review hooks':connection.current?'Connected':connection.mode==='managed'?'Managed sessions':connection.mode==='unsupported'?'Setup unavailable':'Not connected';
  const details=[agent.installed?`Installed version: ${agent.version||'unknown'}`:'This harness was not detected.',`Worker: ${agent.acpReady?'ACP endpoint available':agent.installed?'ACP adapter needed':'not installed'}`,`Parent: ${state.toLowerCase()}`,connection.message,agent.id==='codex'?'In Codex: /hooks → review Harness Bridge.':null,agent.compatibility?.supported&&!agent.compatibility?.verified?'This version family is supported; this exact release has not been live-tested.':null,c?.error,c?.currentModel?`Current model: ${c.models.find(model=>model.id===c.currentModel)?.name||c.currentModel}`:null].filter(Boolean).join('\n');
  const top=el('div','detected-top');top.append(el('strong','',agent.name||names[agent.id]),infoButton(`${agent.name||names[agent.id]} connection details`,details));
  const status=el('span','detected-status'+(connection.current&&!connection.trustRequired?' connected':''),state),discover=el('button','catalog-button',probing.has(agent.id)?'Discovering…':c?.models.length?`${c.models.length} models ↻`:'Models ↻');discover.type='button';discover.disabled=!agent.installed||probing.has(agent.id);discover.setAttribute('aria-label',`Discover models for ${agent.name||names[agent.id]}`);discover.addEventListener('click',()=>probe(agent.id));
  const bottom=el('div','detected-bottom');bottom.append(status,discover);tile.append(top,bottom);root.append(tile);
 }
}
function setupFeedback(text,error=false){const node=$('#setup-feedback');node.textContent=text;node.hidden=!text;node.classList.toggle('error',error);}
async function loadSetup(){
 if(installing.size)return;const revision=++setupRevision;setupLoading=true;setupError='';renderSetup();
 try{const result=await api('/api/setup-status');if(revision!==setupRevision)return;setupStatus=result;}
 catch(error){if(revision===setupRevision)setupError=error.message||'Setup status unavailable';}
 finally{if(revision===setupRevision){setupLoading=false;renderSetup();}}
}
function configText(entry){return typeof entry.configText==='string'?entry.configText:entry.configText?JSON.stringify(entry.configText,null,2):'';}
function previewConfig(entry,kind='mcp'){const text=configText(entry);if(!text)return;const preview=$('#config-preview');preview.hidden=false;preview.open=true;preview.querySelector('summary').textContent=`${entry.name} · ${kind==='skills'?'skill':'config'}`;$('#config-text').value=text;}
async function copyConfig(entry,kind='mcp'){
 const text=configText(entry);if(!text)return;
 try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);setupFeedback(`${entry.name} ${kind==='skills'?'skill':'config'} copied.`);}
 catch{previewConfig(entry,kind);const input=$('#config-text');input.focus();input.select();setupFeedback(`Clipboard access is unavailable. The config is selected below; press ${/Mac/i.test(navigator.platform)?'⌘C':'Ctrl+C'} to copy it.`,true);}
}
function renderSetup(){
 for(const kind of ['mcp','skills']){
  const root=$(`#setup-${kind}`);root.replaceChildren();const entries=setupStatus?.[kind]?.entries||[];
  if(!entries.length){root.append(el('span','setup-empty',setupError|| (setupLoading?'Checking setup…':'No setup options available.')));continue;}
  for(const entry of entries){
   const pending=installing.has(`${kind}:${entry.id}`),tile=el('div','setup-tile'+(entry.installed?' installed':'')+(!entry.available&&!entry.installed?' unavailable':'')),button=el('button','setup-install'),name=entry.name||names[entry.id]||entry.id;
   button.type='button';button.disabled=!entry.available||!!entry.installed||installing.size>0;button.setAttribute('aria-label',pending?`Installing ${name} ${kind==='mcp'?'MCP':'skill'}`:entry.installed?`${name} ${kind==='mcp'?'MCP':'skill'} installed`:`Install ${kind==='mcp'?'MCP':'skill'} for ${name}`);button.setAttribute('aria-busy',String(pending));
   const marker=el('span',pending?'install-spinner':entry.installed?'install-check':'install-plus',pending?'':entry.installed?'✓':entry.available?'+':'—');marker.setAttribute('aria-hidden','true');button.append(el('span','',name),marker);button.addEventListener('click',()=>installSetup(kind,entry));
   const description=entry.reason||(entry.installed?'Installed.':entry.available?`Install ${kind==='mcp'?'MCP configuration':'Bridge instructions'} for ${name}.`:'Automatic installation is unavailable for this harness.');
   const top=el('div','setup-tile-top');top.append(button,infoButton(`${name} ${kind==='mcp'?'MCP':'skill'} details`,description));tile.append(top);
   if(configText(entry)){const actions=el('div','setup-copy-actions'),copy=el('button','setup-copy',kind==='skills'?'Copy skill':'Copy config'),preview=el('button','setup-preview','Preview');copy.type=preview.type='button';copy.setAttribute('aria-label',`Copy ${name} ${kind==='skills'?'skill':'MCP config'}`);preview.setAttribute('aria-label',`Preview ${name} ${kind==='skills'?'skill':'MCP config'}`);copy.addEventListener('click',()=>copyConfig(entry,kind));preview.addEventListener('click',()=>previewConfig(entry,kind));actions.append(copy,preview);tile.append(actions);}
   root.append(tile);
  }
 }
 if(setupError)setupFeedback(setupError,true);
}
async function installSetup(kind,entry){
 if(installing.size||!entry.available||entry.installed)return;const key=`${kind}:${entry.id}`;installing.add(key);setupRevision++;setupLoading=false;setupError='';setupFeedback(`Installing ${entry.name} ${kind==='mcp'?'MCP':'skill'}…`);renderSetup();
 try{setupStatus=await api('/api/setup-install',{kind,id:entry.id});const updated=setupStatus?.[kind]?.entries?.find(item=>item.id===entry.id);setupFeedback(updated?.installed?`${entry.name} ${kind==='mcp'?'MCP':'skill'} installed.`:updated?.reason||`${entry.name} installation was not confirmed.`,!updated?.installed);}
 catch(error){setupFeedback(error.message||'Installation failed.',true);}
 finally{installing.delete(key);renderSetup();}
}
async function load(){busy=true;$('#refresh').disabled=true;try{const state=await api('/api/state');agents=state.agents||[];connections=state.connections||{};connectionText();if(!loaded||!dirty){const drafts=!loaded&&dirty?config.routes:[];config={version:1,routes:[],...state.config};config.routes=[...config.routes,...drafts].map(normalize);config.workspace='';config.inheritWorkspace=true;baseRevision=state.revision;}loaded=true;void loadSetup();$('#connection').textContent='On your machine';renderAgents();renderRules();for(const r of config.routes)ensureCatalogs(r);}catch(e){notice(String(e.message||e),true);$('#connection').textContent='Connection unavailable';}finally{busy=false;$('#refresh').disabled=false;controls();}}
function showConflict(){
 const panel=$('#save-conflict');panel.hidden=false;panel.open=true;$('#draft-text').value=JSON.stringify(config,null,2);notice('Rules changed outside this app. Your draft is preserved below. Load the latest rules, then reapply the changes you want to keep.',true);
}
async function loadLatest(){
 if(busy)return;busy=true;controls();$('#load-latest').disabled=true;
 try{const state=await api('/api/state');$('#draft-text').value=JSON.stringify(config,null,2);config={version:1,routes:[],...state.config};config.routes=config.routes.map(normalize);config.workspace='';config.inheritWorkspace=true;baseRevision=state.revision;agents=state.agents||[];connections=state.connections||{};dirty=false;loaded=true;connectionText();renderAgents();renderRules();for(const rule of config.routes)ensureCatalogs(rule);notice('Latest rules loaded. Your previous draft remains below for reference while you reapply your changes.');}
 catch(error){notice(error.message||'Could not load the latest rules. Your draft is unchanged.',true);}
 finally{busy=false;$('#load-latest').disabled=false;controls();}
}
async function save(){
 if(busy||!loaded)return;busy=true;controls();
 try{for(const r of config.routes)sync(r);const submitted=JSON.stringify(config);const result=await api('/api/save-connect',{config:JSON.parse(submitted),expectedRevision:baseRevision});baseRevision=result.revision;if(result.connections)connections=result.connections;dirty=JSON.stringify(config)!==submitted;connectionText();renderAgents();notice(result.message||'Rules saved.');}
 catch(error){if(error.code==='CONFIG_CONFLICT'||/configuration changed/i.test(error.message||''))showConflict();else notice(String(error.message||error),true);}
 finally{busy=false;controls();}
}
$('#load-latest').addEventListener('click',loadLatest);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{viewMode=button.dataset.view;try{localStorage.setItem('bridge-rule-view',viewMode);}catch{}renderRules();});
$('#settings-toggle').addEventListener('click',()=>{const open=$('#agents-panel').hidden;$('#agents-panel').hidden=!open;$('#rules-panel').hidden=open;$('#settings-toggle').setAttribute('aria-expanded',String(open));$('#settings-toggle').setAttribute('aria-label',open?'Close settings':'Open settings');$('#settings-toggle').querySelector('span').textContent=open?'Back to rules':'Settings';if(open&&!setupStatus&&!setupLoading)void loadSetup();});
$('#add').addEventListener('click',()=>{config.routes.push(normalize({id:crypto.randomUUID(),parents:[],workers:[],models:[],reasoning:'',task:'Auto',enabled:true}));changed();renderRules();});$('#save-only').addEventListener('click',save);$('#refresh').addEventListener('click',load);window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});document.addEventListener('keydown',e=>{if(e.key==='Escape'){const active=[...document.querySelectorAll('.worker-editor')].find(w=>!w.querySelector('.model-effort-popover')?.hidden);if(active)active.closeThinking?.();else for(const w of document.querySelectorAll('.worker-editor'))w.closeEditor?.();}});document.addEventListener('scroll',()=>{for(const w of document.querySelectorAll('.worker-editor'))w.positionThinking?.();},true);window.addEventListener('resize',()=>{for(const w of document.querySelectorAll('.worker-editor'))w.positionThinking?.();});document.addEventListener('click',e=>{for(const tooltip of document.querySelectorAll('.info-control.tip-open'))if(!e.composedPath().includes(tooltip)){tooltip.classList.remove('tip-open');tooltip.querySelector('button').setAttribute('aria-expanded','false');}for(const editor of document.querySelectorAll('.worker-editor'))if(!e.composedPath().includes(editor))editor.closeEditor?.();for(const d of document.querySelectorAll('.combo'))if(!e.composedPath().includes(d))d.closePicker?.();});load();
