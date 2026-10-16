import {parentSetup,workerSetup,failedDiscovery} from './setup-state.mjs';
import {setupConfiguration} from './configuration-ui.mjs';
import {DEFAULT_TASKS,uniqueTaskName} from './task-library.mjs';
import {ruleInstruction} from './rule-prompt.mjs';
import {ruleReadiness,defaultThinking} from './rule-validation.mjs';
'use strict';
const $=s=>document.querySelector(s),names={codex:'Codex',claude:'Claude Code',pi:'Pi',opencode:'OpenCode',deepseek:'DeepSeek'};
let taskState={tasks:structuredClone(DEFAULT_TASKS),revision:null},tasksLoading=false;
const modelProbes=new Map();
const catalogs=new Map(),probing=new Set(),cards=new Map(),installing=new Set();let setupStatus=null,setupLoading=false,setupError='',setupRevision=0;let baseRevision,appliedRevision,savedSnapshot,actionInProgress='';let agents=[],config={version:1,routes:[]},loaded=false,dirty=false,busy=false,connections={};
let setupCheckedAt=null,inventoryCheckedAt=null,inventoryRefreshing=false,inventoryError='';const promptPreviews=new Set(),openAgentDetails=new Set();
let configurationUI;
try{const cached=JSON.parse(localStorage.getItem('bridge-inventory-v1')||'null');if(cached?.agents?.length){agents=cached.agents;connections=cached.connections||{};inventoryCheckedAt=cached.checkedAt;}}catch{}
function refreshAgentNames(){for(const agent of agents)names[agent.id]=agent.name||agent.id;}
refreshAgentNames();
function harnessEntries(role){return agents.filter(a=>role!=='parent'||a.nativeParent!==false&&a.id!=='claude').map(a=>({value:a.id,label:a.name||a.id,detail:role==='parent'?parentSetup(a,connections[a.id]).label:workerSetup(a,catalogs.get(a.id)).label}));}
function rememberInventory(){refreshAgentNames();inventoryCheckedAt=new Date().toISOString();try{localStorage.setItem('bridge-inventory-v1',JSON.stringify({agents:agents.map(({id,name,installed,acpReady,version,compatibility,nativeParent,registry,worker})=>({id,name,installed,acpReady,version,compatibility,nativeParent,registry,worker})),connections,checkedAt:inventoryCheckedAt}));}catch{}}
let showPromptPreviews=false;
try{showPromptPreviews=localStorage.getItem('bridge-show-prompt-previews')==='true';}catch{}
document.body.classList.toggle("macos",/Mac/.test(navigator.platform));
try{const cached=JSON.parse(localStorage.getItem('bridge-setup-v1')||'null');if(cached?.status?.mcp?.entries){setupStatus=cached.status;setupCheckedAt=cached.checkedAt;}}catch{}
function rememberSetup(){setupCheckedAt=new Date().toISOString();try{localStorage.setItem('bridge-setup-v1',JSON.stringify({status:setupStatus,checkedAt:setupCheckedAt}));}catch{}}
const native=()=>window.__TAURI__?.core?.invoke;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function notice(text,error=false){$('#notice').textContent=text;$('#notice').hidden=!text;$('#notice').classList.toggle('error',error);}
async function api(path,body){const invoke=native();if(invoke){let result=await invoke('bridge',{method:body===undefined?'GET':'POST',path,body:body??null});if(typeof result==='string'){try{result=JSON.parse(result);}catch{throw new Error(result);}}if(result?.error&&!result?.models)throw Object.assign(new Error(result.error),{code:result.code});return result;}const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','x-bridge-token':$('meta[name="bridge-token"]').content},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||result.message||`Request failed (${response.status})`),{code:result.code});return result;}
function normalize(r){r.parents=Array.isArray(r.parents)?r.parents:r.parent&&r.parent!=='*'?[r.parent]:[];r.workers=Array.isArray(r.workers)?r.workers:r.worker&&r.worker!=='auto'?[r.worker]:[];r.models=Array.isArray(r.models)?r.models:r.model&&r.workers.length===1?[{worker:r.workers[0],id:r.model}]:[];r.reasoning=r.reasoning||'';r.reasoningByWorker=r.reasoningByWorker&&typeof r.reasoningByWorker==='object'?r.reasoningByWorker:{};r.task=typeof r.task==='string'?r.task:'Auto';r.usage=r.usage||'can';sync(r);return r;}
function sync(r){r.parent=r.parents.length===1?r.parents[0]:'*';r.worker=r.workers.length===1?r.workers[0]:'auto';r.model=r.models.length===1?r.models[0].id:'';}
function changed(r){if(r){sync(r);if(r.enabled&&!ruleReadiness(r,agents,catalogs).valid)r.enabled=false;}dirty=savedSnapshot!==JSON.stringify(config);controls();}
function controls(){
 const pending=baseRevision!==appliedRevision,needsConnection=Object.entries(connections).some(([id,c])=>c.mode==='native'&&!c.current&&config.routes.some(r=>r.enabled&&(!r.parents.length||r.parents.includes(id))));
 $('#save-only').hidden=!dirty;$('#save-only').disabled=!loaded||busy;
 $('#save-apply').hidden=!dirty&&!pending&&!needsConnection;$('#save-apply').disabled=!loaded||busy;$('#save-apply').textContent=dirty?'Save Rules and Apply':'Apply Rules';
 $('#add').disabled=false;
 const attention=Object.values(connections).some(c=>c.current&&(c.trustRequired===true||c.hooksDisabled));
 $('#save-status').textContent=busy?(actionInProgress||'Checking…'):!loaded?'Waiting for connection':dirty?'Unsaved changes':pending?'Saved · not applied':needsConnection?'Saved · connection needs attention':attention?'Applied · review connections in Settings':'Saved and applied';
 configurationUI?.update();
}

function infoButton(label,text){
 const wrap=el('span','info-control'),button=el('button','info-button','i'),tip=el('span','info-tooltip',text);button.type='button';button.setAttribute('aria-label',label);tip.id=`tip-${crypto.randomUUID()}`;tip.setAttribute('role','tooltip');button.setAttribute('aria-describedby',tip.id);button.setAttribute('aria-expanded','false');wrap.append(button,tip);
 function place(){tip.style.left='0px';tip.style.right='auto';const bounds=tip.getBoundingClientRect();if(bounds.right>window.innerWidth-18)tip.style.left=`${window.innerWidth-18-bounds.right}px`;}
 wrap.addEventListener('pointerenter',place);wrap.addEventListener('focusin',place);button.addEventListener('click',()=>{const open=wrap.classList.toggle('tip-open');button.setAttribute('aria-expanded',String(open));place();});wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){wrap.classList.remove('tip-open');button.setAttribute('aria-expanded','false');button.blur();event.stopPropagation();}});return wrap;
}
function connectionText(){
 $('#agent-section-info').replaceChildren(infoButton('How agent connections work','Orchestrator status checks the integration files and, for Codex, hook approval when available. Configured does not prove that an existing session has loaded the integration. Subagent status checks for an ACP endpoint, not model access. Expand an agent for version details and next steps.'));
 $('#mcp-section-info').replaceChildren(infoButton('About MCP setup','Install Bridge’s MCP configuration tools for a supported harness, or copy the configuration for a manual setup. MCP configuration access is separate from native task delegation.'));
}
function select(label,entries,value,callback){
 const wrap=el('span','themed-select'),button=el('button','select-trigger'),popup=el('div','select-menu');let choices=[],selected=value;
 button.type='button';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');popup.id=`select-${crypto.randomUUID()}`;button.setAttribute('aria-controls',popup.id);popup.setAttribute('role','listbox');popup.setAttribute('aria-label',label);if(popup.showPopover)popup.setAttribute('popover','manual');popup.hidden=true;
 function close(focus=false){if(popup.matches(':popover-open'))popup.hidePopover();popup.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus({preventScroll:true});}
 function render(){button.textContent=choices.find(([v])=>v===selected)?.[1]||selected||'Auto';popup.replaceChildren();for(const [v,name,disabled=false]of choices){const item=el('button','select-option');item.type='button';item.disabled=disabled;item.setAttribute('role','option');item.setAttribute('aria-selected',String(v===selected));item.append(el('span','option-check',v===selected?'✓':''),el('span','',name));item.addEventListener('click',()=>{selected=v;close(true);render();callback(v);});popup.append(item);}}
 function open(){if(button.disabled)return;for(const other of document.querySelectorAll('.themed-select'))if(other!==wrap)other.closeSelect?.();capturePopoverAnchor(popup,button);popup.hidden=false;if(popup.showPopover)popup.showPopover();button.setAttribute('aria-expanded','true');positionPopover(popup,button);(popup.querySelector('[aria-selected=true]:not(:disabled)')||popup.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});}
 button.addEventListener('click',()=>popup.hidden?open():close());
 wrap.addEventListener('keydown',event=>{const items=[...popup.querySelectorAll('button:not(:disabled)')];if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(popup.hidden){open();return;}const current=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}else if(event.key==='Tab')close();});
 wrap.setChoices=(list,next=selected)=>{if(JSON.stringify(choices)===JSON.stringify(list)&&selected===next)return;choices=list;selected=next;render();};wrap.setDisabled=disabled=>{button.disabled=disabled;if(disabled)close();};wrap.closeSelect=close;wrap.positionSelect=()=>{if(!popup.hidden)positionPopover(popup,button);};wrap.trigger=button;wrap.append(button,popup);wrap.setChoices(entries,value);return wrap;
}
function workerIds(r){return r.workers.length?r.workers:agents.filter(a=>a.installed&&a.acpReady).map(a=>a.id);}
function levels(worker,model){
 const c=catalogs.get(worker),m=c?.models.find(m=>m.id===(model||c.currentModel));
 if(!model&&c?.harnessDefault)return defaultThinking(c);
 return(m?.reasoning||[]).map(v=>typeof v==='string'?[v,v]:[String(v.value),v.name||String(v.value)]);
}
// Some ACP catalogs expose controls only after selecting a model. Warm selected
// models without spawning a discovery process for every catalog entry.
const capabilityQueue=[];let capabilityActive=0;
function scheduleCapability(task){return new Promise((resolve,reject)=>{capabilityQueue.push({task,resolve,reject});drainCapabilities();});}
function drainCapabilities(){while(capabilityActive<2&&capabilityQueue.length){const item=capabilityQueue.shift();capabilityActive++;Promise.resolve().then(item.task).then(item.resolve,item.reject).finally(()=>{capabilityActive--;drainCapabilities();});}}
async function probeThinking(worker,model){
 const key=modelKey({worker,id:model}),catalog=catalogs.get(worker),meta=catalog?.models.find(m=>m.id===model);
 if(Array.isArray(meta?.reasoning))return meta.reasoning;
 if(modelProbes.has(key))return modelProbes.get(key);
 if(!meta)return [];
 if(meta.reasoningError)throw new Error(meta.reasoningError);
 const pending=scheduleCapability(async()=>{try{
  const result=await api('/api/probe',{agentId:worker,modelId:model}),queried=result.models?.find(m=>m.id===model);
  if(!queried||!Array.isArray(queried.reasoning))throw new Error('Thinking controls were not returned. Retry to check again.');
  if(catalogs.get(worker)===catalog){meta.reasoning=queried.reasoning;delete meta.reasoningError;}
  return queried.reasoning;
 }catch(error){if(catalogs.get(worker)===catalog)meta.reasoningError=error.message;throw error;}});
 modelProbes.set(key,pending);try{return await pending;}finally{modelProbes.delete(key);refreshCards();}
}
function thinking(r){const alternatives=workerIds(r).flatMap(worker=>{const ms=r.models.filter(m=>m.worker===worker);return(ms.length?ms:[{id:''}]).map(m=>levels(worker,m.id));});if(!alternatives.length)return[];return alternatives[0].filter(([v])=>alternatives.every(opts=>opts.some(([id])=>id===v)));}
async function probe(id){if(probing.has(id))return;probing.add(id);renderAgents();refreshCards();try{const c=await api('/api/probe',{agentId:id});catalogs.set(id,c.error?failedDiscovery(catalogs.get(id),c.error):{...c,models:(c.models||[]).map(m=>typeof m==='string'?{id:m,name:m}:m)});}catch(e){catalogs.set(id,failedDiscovery(catalogs.get(id),e.message));}finally{probing.delete(id);renderAgents();refreshCards();}}
function refreshCards(){if(pendingRemoval&&!pendingRemoval.button.isConnected)cancelRemoval();for(const card of cards.values())card.refresh();}
function ensureCatalogs(r){const selected=r.workers.length?r.workers:r.models.length?[...new Set(r.models.map(m=>m.worker))]:agents.filter(a=>a.installed&&a.acpReady&&a.nativeParent!==false&&a.id!=='claude').map(a=>a.id);for(const id of selected)if(agents.some(a=>a.id===id&&a.acpReady)&&!catalogs.has(id)&&!probing.has(id))probe(id);}
function modelKey(m){return JSON.stringify([m.worker,m.id]);}
function modelLabel(m){const c=catalogs.get(m.worker);return`${names[m.worker]||m.worker} / ${c?.models.find(o=>o.id===m.id)?.name||m.id}`;}
function modelEntries(r){const result=[];for(const id of workerIds(r)){const c=catalogs.get(id);for(const m of c?.models||[]){const provider=m.provider?.name||m.provider?.id||m.provider||(m.id.includes('/')?m.id.split('/')[0]:'Catalog');result.push({value:modelKey({worker:id,id:m.id}),label:m.name||m.id,chip:`${names[id]} / ${m.name||m.id}`,detail:m.id,group:`${names[id]} · ${provider}`});}}for(const m of r.models)if(!result.some(o=>o.value===modelKey(m)))result.push({value:modelKey(m),label:m.id,chip:modelLabel(m),detail:'Saved selection · not in discovered catalog',group:names[m.worker]||m.worker});return result;}
// Refresh picker contents in place so model discovery never steals focus or closes it.
let pendingRemoval=null;
function cancelRemoval(){pendingRemoval?.cancel();pendingRemoval=null;}
function removalButton(label,target,remove,{wholeRule=false}={}){
 const button=el('button','selection-remove');button.type='button';button.setAttribute('aria-label',label);button.title=label;
 const armed=()=>pendingRemoval?.button===button,preview=()=>target.classList.add('remove-preview'),restore=()=>{if(!armed())target.classList.remove('remove-preview');};
 button.addEventListener('pointerenter',preview);button.addEventListener('pointerleave',restore);button.addEventListener('focus',preview);button.addEventListener('blur',restore);
 button.addEventListener('click',event=>{event.stopPropagation();if(armed()){if(wholeRule){confirmRuleRemoval(target,label,()=>{cancelRemoval();remove();});}else{cancelRemoval();remove();}return;}cancelRemoval();preview();if(wholeRule){target.classList.add('deletion-pending');for(const node of target.children)if(!node.classList.contains('rule-header'))node.inert=true;target.querySelector('.toggle').disabled=true;}button.classList.add('confirm-remove');button.setAttribute('aria-label',`Confirm: ${label}`);button.title='Click the trash icon to confirm. Escape or click elsewhere to cancel.';pendingRemoval={button,cancel:()=>{button.classList.remove('confirm-remove');button.setAttribute('aria-label',label);button.title=label;target.classList.remove('remove-preview','deletion-pending');if(wholeRule){for(const node of target.children)node.inert=false;cards.get(target.dataset.id)?.refresh();}}};button.focus({preventScroll:true});});return button;
}
// Confirmation belongs to one visible control and never survives an unrelated action.
 document.addEventListener('click',event=>{if(pendingRemoval&&!event.composedPath().includes(pendingRemoval.button)&&!event.composedPath().some(n=>n.classList?.contains('rule-delete-dialog')))cancelRemoval();},true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&pendingRemoval&&!document.querySelector('.rule-delete-dialog[open]')){cancelRemoval();event.preventDefault();event.stopImmediatePropagation();}},true);
function confirmRuleRemoval(card,label,remove){
 if(document.querySelector('.rule-delete-dialog'))return;
 const dialog=el('dialog','rule-delete-dialog'),title=el('h2','',`${label}?`),message=el('p','','The rule will be removed from this draft. Save rules to apply the change.'),actions=el('div','dialog-actions'),cancel=el('button','dialog-cancel','Cancel'),confirm=el('button','dialog-delete','Delete rule');
 title.id=`delete-${crypto.randomUUID()}`;dialog.setAttribute('aria-labelledby',title.id);cancel.type=confirm.type='button';actions.append(cancel,confirm);dialog.append(title,message,actions);document.body.append(dialog);
 const dismiss=()=>{dialog.close();dialog.remove();cancelRemoval();card.querySelector('.rule-remove')?.focus();};cancel.addEventListener('click',dismiss);dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dismiss();}});confirm.addEventListener('click',()=>{dialog.close();dialog.remove();remove();$('#add').focus();});dialog.showModal();cancel.focus();
}
function ensureThinkingChecks(r){
 for(const worker of workerIds(r)){const c=catalogs.get(worker);if(!c||c.error)continue;const selected=r.models.filter(m=>m.worker===worker);for(const m of selected.length?selected:[{id:c.currentModel}]){const meta=c.models?.find(x=>x.id===m.id);if(meta&&!meta.reasoningError&&!Array.isArray(meta.reasoning))void probeThinking(worker,m.id).catch(()=>{});}}
}
function multiPicker({label,auto,entries,values,choose,onOpen,models=false,embedded=false,onClose}){
 const wrap=el('div','combo'),shell=el('span','chip combo-trigger'),button=el('button','combo-open'),chips=el('span','combo-chips'),popup=el('div',`model-popover ${models?'compact-model-menu':'compact-harness-menu'}`),search=el('input','model-search'),options=el('div','model-options');
 button.type='button';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');popup.hidden=true;popup.id=`picker-${crypto.randomUUID()}`;button.setAttribute('aria-controls',popup.id);
 search.type='search';search.placeholder=models?'Search harness, provider or model…':'Search agents…';search.setAttribute('aria-label',`Search ${label.toLowerCase()}`);options.setAttribute('role','group');options.setAttribute('aria-label',label);
 function close(){if(embedded)return;popup.hidden=true;button.setAttribute('aria-expanded','false');}
 function toggle(event){const opening=popup.hidden;if(opening)capturePopoverAnchor(popup,event?.currentTarget||shell);for(const other of document.querySelectorAll('.combo'))if(other!==wrap)other.closePicker?.();popup.hidden=!opening;button.setAttribute('aria-expanded',String(opening));if(opening){onOpen?.();fill();positionPopover(popup,shell);search.focus({preventScroll:true});}}
 function fill(){
  const scroll=options.scrollTop,focused=options.contains(document.activeElement)?document.activeElement?.dataset.value:null,selected=values(),all=entries(),q=search.value.trim().toLowerCase();chips.replaceChildren();
  if(!selected.length){const text=el('button','selection-label auto-chip',auto);text.type='button';text.addEventListener('click',toggle);chips.append(text);}
  else for(const [i,value]of selected.entries()){
   if(i)chips.append(el('span','chip-comma',','));const item=all.find(e=>e.value===value),name=item?.chip||item?.label||value,token=el('span','selection-chip'),text=el('button','selection-label',name);text.type='button';text.addEventListener('click',toggle);
   token.append(text,removalButton(`Remove ${name} from ${label.toLowerCase()}`,token,()=>{choose(values().filter(v=>v!==value),{removed:value});fill();button.focus({preventScroll:true});}));chips.append(token);
  }
  button.title=selected.length?selected.map(value=>{const item=all.find(e=>e.value===value);return item?.chip||item?.label||value;}).join(', '):auto;options.replaceChildren();
  function row(item,isAuto=false){const active=isAuto?!selected.length:selected.includes(item.value),b=el('button','model-option'+(active?' selected':''));b.type='button';b.dataset.value=isAuto?'__auto__':item.value;b.setAttribute('aria-pressed',String(active));b.append(el('span','option-check',active?'✓':''),el('span','option-label',item.label));if(item.detail&&(models||item.detail!=='Installed'))b.append(el('small','',item.detail));b.addEventListener('click',()=>{choose(isAuto?[]:active?selected.filter(v=>v!==item.value):[...selected,item.value]);fill();});options.append(b);}
  row({label:models?'Auto · harness default':'Auto'},true);let group='',count=0;for(const item of all){if(q&&!`${item.label} ${item.detail||''} ${item.group||''}`.toLowerCase().includes(q))continue;if(item.group&&item.group!==group){group=item.group;options.append(el('div','option-group',group));}row(item);count++;}
  if(!count)options.append(el('div','picker-empty',models?'No matching catalog models. Refresh to discover available models.':'No matching agents.'));options.scrollTop=scroll;if(focused!==null)Array.from(options.querySelectorAll('button')).find(b=>b.dataset.value===focused)?.focus({preventScroll:true});
 }
 search.addEventListener('input',fill);button.addEventListener('click',toggle);wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();e.stopPropagation();}if(e.key==='ArrowDown'&&e.target===search){e.preventDefault();options.querySelector('button')?.focus();}});
 const footer=el('div','picker-hint picker-footer');footer.append(infoButton(models?'About model selection':'About harness selection',models?'Choose one or more alternatives. The parent picks one model per task. Auto uses the harness default. Catalog visibility does not verify account access.':'Choose one or more harnesses. The parent picks one per task. Auto allows any available harness. Installation details are in Settings.'));
 const done=el('button','text-button picker-done','Done');done.type='button';done.addEventListener('click',()=>{if(onClose)onClose();else{close();button.focus();}});footer.append(done);popup.append(search,options,footer);shell.append(chips,button);wrap.append(shell,popup);wrap.closePicker=close;wrap.positionPicker=()=>{if(!embedded&&!popup.hidden)positionPopover(popup,shell);};
 if(embedded){shell.hidden=true;popup.hidden=false;popup.classList.add('embedded-popover');wrap.classList.add('embedded-picker');}fill();return{element:wrap,refresh:fill};
}
function effectiveReasoning(r,id,model){const selection=r.models.find(m=>m.worker===id&&m.id===model);return selection&&Object.hasOwn(selection,'reasoning')?selection.reasoning:Object.hasOwn(r.reasoningByWorker||{},id)?r.reasoningByWorker[id]:r.reasoning||'';}

function reasoningOptions(control,options,current,{mixed=false}={}){
 const entries=[['','Auto · default'],...options.map(([value,name])=>[value,name.charAt(0).toUpperCase()+name.slice(1)])];
 if(mixed)entries.push(['__per_harness__','per model',true]);else if(current&&!options.some(([value])=>value===current))entries.push([current,`${current} · saved, unverified`,true]);
 control.setChoices(entries,mixed?'__per_harness__':current);
}
const popoverAnchors=new WeakMap();
function capturePopoverAnchor(popup,button){const rect=button.getBoundingClientRect(),below=window.innerHeight-rect.bottom-24,above=rect.top-24;popoverAnchors.set(popup,{left:rect.left,top:rect.top,bottom:rect.bottom,scrollX:window.scrollX,scrollY:window.scrollY,side:below>=160||below>=above?'below':'above'});}
function positionPopover(popup,button){
 if(!popoverAnchors.has(popup))capturePopoverAnchor(popup,button);
 const saved=popoverAnchors.get(popup),dx=window.scrollX-saved.scrollX,dy=window.scrollY-saved.scrollY,anchor={left:saved.left-dx,top:saved.top-dy,bottom:saved.bottom-dy},gap=8;
 popup.style.position='fixed';popup.style.bottom='auto';popup.style.overflowY='auto';
 const space=saved.side==='below'?window.innerHeight-anchor.bottom-gap-16:anchor.top-gap-16;
 popup.style.maxHeight=`${Math.max(64,space)}px`;
 const width=popup.offsetWidth,height=popup.offsetHeight;
 popup.style.left=`${Math.max(16,Math.min(anchor.left,window.innerWidth-width-16))}px`;
 popup.style.top=`${Math.max(16,saved.side==='below'?anchor.bottom+gap:anchor.top-height-gap)}px`;
}
function compactModelName(worker,model){
 if(!model)return 'default model';
 const catalog=catalogs.get(worker)?.models.find(m=>m.id===model),name=catalog?.name||model;
 return name.split(' · ')[0].split('/').at(-1);
}
function providerName(model){const provider=model.provider;return provider?.name||provider?.id||(typeof provider==='string'?provider:null)||model.name?.split(' · ').slice(1).join(' · ')|| (model.id.includes('/')?model.id.split('/')[0]:'Models');}
function workerEditor(r,id,index,updated,chooseWorkers){
 const wrap=el('div','worker-editor inline-worker'),harnessLabel=el('span','harness-label'),harness=el('button','worker-name',names[id]),join=el('span','worker-join'),slash=el('span','join-slash','/'),withWord=el('span','join-with','with'),summary=el('span','inline-model-summary'),popup=el('div','worker-popover compact-model-menu'),search=el('input','model-search'),options=el('div','model-options'),hint=el('div','picker-hint');
 let thinkingId=null;
 harness.type='button';harness.setAttribute('aria-label',`Harnesses for rule ${index+1}, ${names[id]} group`);harness.setAttribute('aria-expanded','false');
 popup.id=`models-${crypto.randomUUID()}`;popup.setAttribute('role','dialog');popup.setAttribute('aria-label',`${names[id]} model selection`);popup.hidden=true;
 search.type='search';search.placeholder='Search models or providers…';search.setAttribute('aria-label',`Search ${names[id]} models for rule ${index+1}`);
 options.setAttribute('role','group');options.setAttribute('aria-label',`${names[id]} model alternatives`);hint.append(infoButton('How model alternatives work','Select one or more models. The parent picks one per task. Auto uses the harness default. Click a thinking value to adjust that model. Removing the last selected model restores Auto.'));
 const done=el('button','text-button picker-done','Done');done.type='button';hint.append(done);
 const harnessPicker=multiPicker({label:`Choose harnesses for rule ${index+1}`,auto:'Auto · any available harness',embedded:true,onClose:()=>{close();harness.focus();},entries:()=>harnessEntries('worker'),values:()=>r.workers,choose:chooseWorkers});
 const harnessMenu=el('div','worker-popover harness-menu');harnessMenu.hidden=true;harnessMenu.append(harnessPicker.element);
 function focusModels(){summary.querySelector('button')?.focus({preventScroll:true});}
 function closeThinking(){thinkingId=null;fillModels();}
 function close(){popup.hidden=true;harnessMenu.hidden=true;thinkingId=null;wrap.classList.remove('is-open');summary.querySelectorAll('[aria-expanded]').forEach(b=>b.setAttribute('aria-expanded','false'));harness.setAttribute('aria-expanded','false');}
 function closeOthers(){for(const other of document.querySelectorAll('.worker-editor'))if(other!==wrap)other.closeEditor?.();for(const combo of document.querySelectorAll('.combo'))combo.closePicker?.();}
 function position(){if(!popup.hidden)positionPopover(popup,summary);if(!harnessMenu.hidden)positionPopover(harnessMenu,harness);}
 function openModels(event){if(!popup.hidden){close();return;}capturePopoverAnchor(popup,event?.currentTarget||summary);closeOthers();harnessMenu.hidden=true;harness.setAttribute('aria-expanded','false');popup.hidden=false;wrap.classList.add('is-open');if(!catalogs.has(id)&&!probing.has(id))probe(id);refresh();position();search.focus({preventScroll:true});}
 harness.addEventListener('click',()=>{const opening=harnessMenu.hidden;if(opening)capturePopoverAnchor(harnessMenu,harness);closeOthers();close();if(opening){harnessMenu.hidden=false;wrap.classList.add('is-open');harness.setAttribute('aria-expanded','true');harnessPicker.refresh();position();harnessMenu.querySelector('input')?.focus({preventScroll:true});}});
 const removeHarness=removalButton(`Remove ${names[id]} and its models from rule ${index+1}`,wrap,()=>{close();r.models=r.models.filter(m=>m.worker!==id);delete r.reasoningByWorker[id];chooseWorkers(r.workers.filter(worker=>worker!==id));const card=cards.get(r.id);card?.focusWorker?.();});
 harnessLabel.append(harness,removeHarness);done.addEventListener('click',()=>{close();focusModels();});search.addEventListener('input',fillModels);
 function selectModel(model){const selected=r.models.find(m=>m.worker===id&&m.id===model);if(selected){r.models=r.models.filter(m=>m!==selected);if(thinkingId===model)thinkingId=null;}else r.models.push({worker:id,id:model});changed(r);updated();}
 const thinkingText=(model)=>{const value=effectiveReasoning(r,id,model);return value?value.charAt(0).toUpperCase()+value.slice(1):'Auto';};
 function openThinking(model){
  if(thinkingId===model){closeThinking();return;}thinkingId=model;
  const requested=model||catalogs.get(id)?.currentModel;if(requested)void probeThinking(id,requested).catch(()=>{});fillModels();position();
 }
 function thinkingRow(model){
  const section=el('div','model-thinking-details'),line=el('div','thinking-field'),label=el('label','','Thinking'),current=effectiveReasoning(r,id,model),choices=levels(id,model);
  const catalog=catalogs.get(id),meta=!model&&catalog?.harnessDefault?{reasoning:defaultThinking(catalog).map(([value])=>value)}:catalog?.models.find(m=>m.id===(model||catalog.currentModel)),fetching=!Array.isArray(meta?.reasoning)&&!meta?.reasoningError;
  line.append(label);
  if(!meta){line.append(el('span','thinking-fetching','Unavailable'));}
  else if(fetching){const status=el('span','thinking-fetching');status.setAttribute('role','status');status.setAttribute('aria-label',`Fetching thinking levels for ${compactModelName(id,model)}`);status.append(el('span','install-spinner'),el('span','','Fetching'));line.append(status);}
  else if(meta?.reasoningError){const retry=el('button','thinking-retry','Retry');retry.type='button';retry.title=meta.reasoningError;retry.setAttribute('aria-label',`Retry thinking levels for ${compactModelName(id,model)}`);retry.addEventListener('click',()=>{delete meta.reasoningError;void probeThinking(id,model).catch(()=>{});fillModels();});line.append(retry);}
  else{
   const control=select(`Thinking level for ${compactModelName(id,model)} in ${names[id]}`,[['','Auto'],...choices.map(([value,name])=>[value,name.charAt(0).toUpperCase()+name.slice(1)])],current,value=>{const selected=r.models.find(m=>m.worker===id&&m.id===model);if(!model){r.reasoningByWorker[id]=value;changed(r);updated();}else if(selected){selected.reasoning=value;changed(r);updated();}});
   control.classList.add('thinking-select');control.trigger.dataset.modelControl=`level:${model}`;control.trigger.id=`thinking-${crypto.randomUUID()}`;label.htmlFor=control.trigger.id;
   if(current&&!choices.some(([value])=>value===current))control.setChoices([['','Auto'],...choices.map(([value,name])=>[value,name]),[current,`${thinkingText(model)} · saved`,true]],current);
   if(!choices.length)control.trigger.title='No adjustable levels advertised. Auto uses the model’s default.';
   line.append(control);
  }
  section.append(line);return section;
 }
 function fillModels(){
  const previousScroll=options.scrollTop,focused=options.contains(document.activeElement)?document.activeElement?.dataset.modelControl:null,q=search.value.trim().toLowerCase(),catalog=catalogs.get(id),models=[...(catalog?.models||[])];
  for(const selected of r.models.filter(m=>m.worker===id))if(!models.some(m=>m.id===selected.id))models.push({id:selected.id,name:selected.id,saved:true});
  options.replaceChildren();const auto=el('button','model-option auto-model'+(!r.models.some(m=>m.worker===id)?' selected':''),'Auto · harness default');auto.type='button';auto.setAttribute('aria-pressed',String(!r.models.some(m=>m.worker===id)));auto.dataset.modelControl='auto';auto.addEventListener('click',()=>{r.models=r.models.filter(m=>m.worker!==id);thinkingId=null;changed(r);updated();});const defaultSelected=!r.models.some(m=>m.worker===id),defaultRow=el('div','model-select-row'+(defaultSelected?' selected':'')+(thinkingId===''?' expanded':'')),defaultTop=el('div','model-row-top');defaultTop.append(auto);if(defaultSelected&&catalog&&!catalog.error){const control=el('button','model-thinking-button',thinkingText(''));control.type='button';control.setAttribute('aria-label',`Thinking for ${names[id]} default model: ${thinkingText('')}`);control.setAttribute('aria-expanded',String(thinkingId===''));control.addEventListener('click',()=>openThinking(''));defaultTop.append(control);}defaultRow.append(defaultTop);if(defaultSelected&&thinkingId==='')defaultRow.append(thinkingRow(''));options.append(defaultRow);
  const groups=new Map();for(const model of models){if(q&&!`${model.name} ${model.id} ${providerName(model)}`.toLowerCase().includes(q))continue;const group=providerName(model);if(!groups.has(group))groups.set(group,[]);groups.get(group).push(model);}
  const isSelected=model=>r.models.some(m=>m.worker===id&&m.id===model.id);
  for(const [provider,list]of [...groups].sort((a,b)=>Number(b[1].some(isSelected))-Number(a[1].some(isSelected)))){list.sort((a,b)=>Number(isSelected(b))-Number(isSelected(a)));options.append(el('div','option-group',provider));for(const model of list){
   const selected=isSelected(model),row=el('div','model-select-row'+(selected?' selected':'')+(thinkingId===model.id?' expanded':'')),top=el('div','model-row-top'),choice=el('button','model-row-choice'),name=el('span','model-row-name',compactModelName(id,model.id));choice.type='button';choice.dataset.modelControl=`select:${model.id}`;choice.setAttribute('aria-pressed',String(selected));choice.setAttribute('aria-label',`${selected?'Deselect':'Select'} ${model.name||model.id} from ${provider}`);choice.title=model.id;choice.append(el('span','option-check',selected?'✓':''),name);if(model.saved)choice.append(el('span','saved-model-marker','saved'));choice.addEventListener('click',()=>selectModel(model.id));top.append(choice);
   if(selected){const control=el('button','model-thinking-button',thinkingText(model.id));control.type='button';control.dataset.modelControl=`thinking:${model.id}`;control.setAttribute('aria-label',`Thinking for ${model.name||model.id}: ${thinkingText(model.id)}`);control.setAttribute('aria-expanded',String(thinkingId===model.id));control.addEventListener('click',()=>void openThinking(model.id));top.append(control);}
   row.append(top);if(selected&&thinkingId===model.id)row.append(thinkingRow(model.id));options.append(row);
  }}
  if(!groups.size)options.append(el('p','picker-empty',probing.has(id)?'Discovering models…':catalog?.error||(catalog?.harnessDefault?'This harness manages its own model. Auto keeps that choice.':'No matching models.')));options.scrollTop=previousScroll;if(focused)Array.from(options.querySelectorAll('[data-model-control]')).find(b=>b.dataset.modelControl===focused)?.focus({preventScroll:true});
 }
 function refresh(){
  const selected=r.models.filter(m=>m.worker===id),focused=summary.contains(document.activeElement)?document.activeElement?.dataset.summaryControl:null;summary.replaceChildren();
  for(const [i,model]of (selected.length?selected.slice(0,2):[null]).entries()){
   if(i)summary.append(el('span','model-comma',','));const token=el('span','inline-model-token'),button=el('button','inline-model-trigger',model?compactModelName(id,model.id):'Auto');button.type='button';button.dataset.summaryControl=model?.id||'auto';button.title=model?`${model.id} · ${thinkingText(model.id)} thinking`:'Use the default model in this harness';button.setAttribute('aria-label',`${names[id]} models for rule ${index+1}${model?': '+compactModelName(id,model.id):''}`);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded',String(!popup.hidden));button.setAttribute('aria-controls',popup.id);button.addEventListener('click',openModels);token.append(button);
   if(model){const remove=removalButton(`Remove ${compactModelName(id,model.id)} from ${names[id]} rule ${index+1}`,token,()=>{selectModel(model.id);focusModels();});remove.dataset.summaryControl=`remove:${model.id}`;token.append(remove);}summary.append(token);
  }
  if(selected.length>2){const more=el('button','model-more',`+${selected.length-2}`);more.type='button';more.setAttribute('aria-label',`Show all ${selected.length} ${names[id]} models`);more.addEventListener('click',openModels);summary.append(more);}
  if(focused)Array.from(summary.querySelectorAll('button')).find(b=>b.dataset.summaryControl===focused)?.focus({preventScroll:true});fillModels();harnessPicker.refresh();
 }
 wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();if(thinkingId!==null){const id=thinkingId;closeThinking();Array.from(options.querySelectorAll('button')).find(b=>b.dataset.modelControl===`thinking:${id}`)?.focus();}else{close();focusModels();}}});
 wrap.addEventListener('pointerenter',()=>{const line=wrap.closest('.sentence')?.getBoundingClientRect(),box=wrap.getBoundingClientRect();if(line)wrap.style.setProperty('--worker-line-space',`${Math.max(box.width,Math.floor(line.right-box.left)-1)}px`);wrap.style.setProperty('--inline-reveal',`${Math.min(450,window.innerWidth-200)}px`);wrap.classList.add('is-revealed');});
 wrap.addEventListener('pointerleave',()=>wrap.classList.remove('is-revealed'));
 join.setAttribute('aria-hidden','true');join.append(slash,withWord);popup.append(search,options,hint);wrap.append(harnessLabel,join,summary,harnessMenu,popup);wrap.closeEditor=close;wrap.closeThinking=closeThinking;wrap.positionThinking=position;refresh();return{element:wrap,refresh};
}
function renderRules(){
 const root=$('#routes');root.replaceChildren();cards.clear();
 if(!config.routes.length){root.append(el('div','empty','No rules yet. Add one to connect your agents.'));controls();return;}
 config.routes.forEach((r,i)=>{
  const card=el('article',`rule ${r.enabled===false?'off':''}`);card.dataset.id=r.id;
  const head=el('div','rule-header'),index=el('span','rule-index',`Rule ${i+1}`),tools=el('div','rule-tools'),toggle=el('input','toggle');index.title=`Rule ID: ${r.id}`;
  toggle.type='checkbox';toggle.checked=r.enabled!==false;toggle.setAttribute('aria-label',`Enable rule ${i+1}`);toggle.addEventListener('change',()=>{r.enabled=toggle.checked&&ruleReadiness(r,agents,catalogs).valid;card.classList.toggle('off',!r.enabled);changed(r);refresh();});
  const remove=removalButton(`Remove rule ${i+1}`,card,()=>{config.routes.splice(i,1);changed();renderRules();},{wholeRule:true});remove.classList.add('rule-remove');const promptButton=el('button','prompt-button','Aa');promptButton.type='button';promptButton.title=`Preview agent prompt for rule ${i+1}`;promptButton.setAttribute('aria-label',`Prompt preview for rule ${i+1}`);promptButton.setAttribute('aria-pressed',String(promptPreviews.has(r.id)));promptButton.addEventListener('click',()=>{if(promptPreviews.has(r.id))promptPreviews.delete(r.id);else promptPreviews.add(r.id);refresh();});tools.append(promptButton,toggle,remove);const validation=el('span','rule-validation');validation.setAttribute('role','status');head.append(index,validation,tools);
  const pane=el('div','rule-pane'),preview=el('pre','rule-prompt prompt-text');preview.tabIndex=0;preview.setAttribute('role','region');preview.setAttribute('aria-label',`Agent prompt for rule ${i+1}`);preview.hidden=!promptPreviews.has(r.id);
  const sentence=el('div','sentence'),word=text=>el('span','word',text);
  const parent=multiPicker({label:`Parent agents for rule ${i+1}`,auto:'any agent',entries:()=>harnessEntries('parent'),values:()=>r.parents,choose:values=>{r.parents=values;changed(r);refresh();}});
  const worker=multiPicker({label:`Worker harnesses for rule ${i+1}`,auto:'any available harness',entries:()=>harnessEntries('worker'),values:()=>r.workers,choose:(values,{removed}={})=>{
   if(removed){r.models=r.models.filter(m=>m.worker!==removed);delete r.reasoningByWorker[removed];}r.workers=values;r.models=r.models.filter(m=>!values.length||values.includes(m.worker));if(values.length)r.reasoningByWorker=Object.fromEntries(Object.entries(r.reasoningByWorker||{}).filter(([id])=>values.includes(id)));changed(r);renderWorkerEditors();refresh();ensureCatalogs(r);
  }});
  const taskChoices=()=>[['Auto','any task'],...visibleTasks().map(t=>[t.name,t.name]),['__bridge_add_task__','＋ Add new task',!taskState.revision]];
  const taskSelect=select(`Task type for rule ${i+1}`,taskChoices(),r.task,value=>{
   if(value==='__bridge_add_task__'){taskSelect.setChoices(taskChoices(),r.task);openTaskDialog({ruleId:r.id,returnTo:()=>cards.get(r.id)?.focusTask()});return;}
   r.task=value;changed(r);refresh();
  });
  sentence.append(word('When'),parent.element,word('needs'),taskSelect);
  const usage=select(`Delegation policy for rule ${i+1}`,[['can','can use'],['should','should use']],r.usage,value=>{r.usage=value;changed(r);refresh();});usage.classList.add('usage-select');sentence.append(usage);
  const workerArea=el('span','worker-area'),editors=[],editorMap=new Map();
  function renderWorkerEditors(){
   const focused=document.activeElement;editors.length=0;for(const node of [...workerArea.childNodes])if(node!==worker.element)node.remove();if(worker.element.parentNode!==workerArea)workerArea.append(worker.element);
   if(!r.workers.length)worker.element.classList.remove('worker-chooser-compact');else worker.element.classList.add('worker-chooser-compact');
   for(const[idIndex,id]of (r.workers.length?r.workers:[...new Set(r.models.map(m=>m.worker))]).entries()){if(idIndex)workerArea.insertBefore(word('and'),worker.element);const editor=editorMap.get(id)||workerEditor(r,id,i,refresh,values=>{r.workers=values;r.models=r.models.filter(m=>!values.length||values.includes(m.worker));if(values.length)r.reasoningByWorker=Object.fromEntries(Object.entries(r.reasoningByWorker||{}).filter(([worker])=>values.includes(worker)));changed(r);renderWorkerEditors();refresh();ensureCatalogs(r);});editorMap.set(id,editor);editors.push(editor);workerArea.insertBefore(editor.element,worker.element);}if(focused?.isConnected)focused.focus({preventScroll:true});
  }
  {
   const execution=select(`Execution harness for rule ${i+1}`,[['respective','Their respective'],['parent','Parent harness · not supported',true]],'respective',()=>{});execution.classList.add('execution-choice');execution.title='Each model runs inside its selected harness, using that harness’s provider configuration. Parent-harness execution is not yet supported.';
   sentence.append(workerArea,word('models in'),execution,word('harnesses.'));renderWorkerEditors();
  }
  function refresh(){
   taskSelect.setChoices(taskChoices(),r.task);parent.refresh();worker.refresh();for(const editor of editors)editor.refresh();
   const previewing=showPromptPreviews&&promptPreviews.has(r.id);promptButton.hidden=!showPromptPreviews;pane.classList.toggle('show-prompt',previewing);sentence.inert=previewing;sentence.setAttribute('aria-hidden',String(previewing));preview.hidden=!previewing;preview.textContent=ruleInstruction(r);promptButton.setAttribute('aria-pressed',String(previewing));
   ensureThinkingChecks(r);
   // Refreshing discovery must never change the user's enabled intent.
   const result=ruleReadiness(r,agents,catalogs);
   toggle.checked=r.enabled;toggle.disabled=card.classList.contains('deletion-pending')||(!r.enabled&&!result.valid);toggle.title=result.valid?'Enable or disable this rule':result.message;card.classList.toggle('off',!r.enabled);
   validation.textContent=result.valid?(r.enabled?'':'Off'):result.message;validation.classList.toggle('invalid',!result.valid&&!result.pending);

  }
  parent.element.classList.add('parent-choice');worker.element.classList.add('worker-choice');pane.append(sentence,preview);card.append(head,pane);root.append(card);cards.set(r.id,{refresh,focusTask:()=>taskSelect.trigger.focus({preventScroll:true}),focusWorker:()=>workerArea.querySelector('button')?.focus({preventScroll:true})});refresh();
 });controls();
}
function renderAgents(){
 const root=$('#agents'),more=$('#catalog-agents'),focusKey=document.activeElement?.dataset?.agentAction;root.replaceChildren();more.replaceChildren();$('#agent-count').textContent=agents.filter(agent=>agent.installed).length+' detected';
 const catalogAgents=agents.filter(a=>!a.installed&&a.nativeParent===false);$('#catalog-count').textContent=String(catalogAgents.length);$('#agent-catalog').hidden=!catalogAgents.length;const registry=agents.find(a=>a.registry?.source==='acpx')?.registry;$('#catalog-source').textContent=registry?`Launch recipes from acpx ${registry.version}. Install an agent’s ACP launcher separately, then refresh. Discovery does not install software or verify model access.`:'';
 for(const agent of [...agents.filter(a=>!catalogAgents.includes(a)),...catalogAgents.sort((a,b)=>a.name.localeCompare(b.name))]){
  const connection=connections[agent.id]||{},parent=parentSetup(agent,connection),c=catalogs.get(agent.id),worker=workerSetup(agent,c),name=agent.name||names[agent.id];
  const row=el('details','agent-row'+(!agent.installed?' not-detected':'')),summary=el('summary','agent-summary'),identity=el('span','agent-identity');row.open=openAgentDetails.has(agent.id);row.addEventListener('toggle',()=>{if(!row.isConnected)return;row.open?openAgentDetails.add(agent.id):openAgentDetails.delete(agent.id);});
  identity.append(el('strong','',name),el('span','agent-version',agent.installed?agent.version||'Version unknown':'Not detected'));
  const cell=(value,label)=>{const n=el('span','agent-state '+value.tone,value.label);n.dataset.label=label;return n;};
  summary.append(identity,cell(parent,'Orchestrator'),cell(worker,'Subagent'),el('span','settings-chevron'));summary.lastChild.setAttribute('aria-hidden','true');
  const detail=el('div','agent-detail'),guidance=el('div','agent-guidance'),p=el('p','',parent.help),w=el('p','',worker.help);guidance.append(el('span','settings-kicker','Orchestrator'),p,el('span','settings-kicker','Subagent'),w);
  if(parent.needsApply){const back=el('button','settings-text-action','Review rules →');back.type='button';back.addEventListener('click',()=>showSettings(false));guidance.insertBefore(back,guidance.children[2]);}
  const modelArea=el('div','agent-models'),modelCount=el('strong','',probing.has(agent.id)?'Checking models…':c?.models.length?`${c.models.length} advertised model${c.models.length===1?'':'s'}`:'Model catalog');
  const discover=el('button','catalog-button',probing.has(agent.id)?'Refreshing…':c?'Refresh models':'Discover models');discover.type='button';discover.disabled=!agent.acpReady||probing.has(agent.id);discover.dataset.agentAction=agent.id+'-models';discover.setAttribute('aria-label',`Discover models for ${name}`);discover.addEventListener('click',()=>probe(agent.id));
  modelArea.append(modelCount,el('p','',c?.error?(c.stale?'Refresh failed. Showing the previous model list.':'Model discovery failed. Try refreshing.'):'Lists the models this harness advertises. Availability depends on your provider.'),discover);
  if(c?.error){const error=el('p','model-error',c.error);modelArea.append(error);}
  const family=agent.compatibility?.family;modelArea.append(el('p','version-evidence',family?`${family} · ${agent.compatibility.verified?'This exact version has been tested.':'This version family is supported; this release has not been tested.'}`:agent.nativeParent===false?'ACP worker integration · no native orchestrator connection.':'No tested parent compatibility handler.'));
  detail.append(guidance,modelArea);row.append(summary,detail);(catalogAgents.includes(agent)?more:root).append(row);
 }
 if(focusKey)$('#agents-panel').querySelector(`[data-agent-action="${focusKey}"]`)?.focus({preventScroll:true});
}
function setupFeedback(text,error=false){const node=$('#setup-feedback');node.textContent=text;node.hidden=!text;node.classList.toggle('error',error);}
async function loadSetup(){
 if(installing.size||setupLoading)return;const revision=++setupRevision;setupLoading=true;setupError='';renderSetup();
 try{const result=await api('/api/setup-status');if(revision!==setupRevision)return;setupStatus=result;rememberSetup();}
 catch(error){if(revision===setupRevision)setupError=error.message||'Setup status unavailable';}
 finally{if(revision===setupRevision){setupLoading=false;renderSetup();}}
}
function configText(entry){return typeof entry.configText==='string'?entry.configText:entry.configText?JSON.stringify(entry.configText,null,2):'';}
function previewConfig(entry){const text=configText(entry);if(!text)return;const preview=$('#config-preview');preview.hidden=false;preview.open=true;preview.querySelector('summary').textContent=`${entry.name} · config`;$('#config-text').value=text;}
async function copyConfig(entry){
 const text=configText(entry);if(!text)return;
 try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);setupFeedback(`${entry.name} config copied.`);}
 catch{previewConfig(entry);const input=$('#config-text');input.focus();input.select();setupFeedback(`Clipboard access is unavailable. The config is selected below; press ${/Mac/i.test(navigator.platform)?'⌘C':'Ctrl+C'} to copy it.`,true);}
}
function renderSetup(){
 const status=$('#setup-freshness'),refreshing=setupLoading||inventoryRefreshing,failed=setupError||inventoryError,checked=inventoryCheckedAt||setupCheckedAt;status.textContent=refreshing?(checked?'Refreshing · previous status stays visible':'Checking this device…'):failed?'Refresh incomplete · previous status stays visible':checked?'Checked '+new Date(checked).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
 {
  const kind='mcp';
  const root=$(`#setup-${kind}`);root.replaceChildren();const entries=setupStatus?.[kind]?.entries||[];
  if(!entries.length){root.append(el('span','setup-empty',setupError|| (setupLoading?'Checking setup…':'No setup options available.')));return;}
  for(const entry of entries){
   const pending=installing.has(`${kind}:${entry.id}`),tile=el('div','setup-tile'+(entry.installed?' installed':'')+(!entry.available&&!entry.installed?' unavailable':'')),button=el('button','setup-install'),name=entry.name||names[entry.id]||entry.id;
   button.type='button';const update=entry.installed&&entry.current===false;button.disabled=!entry.available||(entry.installed&&!update)||installing.size>0||setupLoading;button.setAttribute('aria-label',pending?`Installing ${name} MCP`:update?`Update ${name} MCP`:entry.installed?`${name} MCP installed`:`Install MCP for ${name}`);button.setAttribute('aria-busy',String(pending));
   const marker=el('span',pending?'install-spinner':entry.installed?'install-check':'install-plus',pending?'':entry.installed?'✓':entry.available?'+':'—');marker.setAttribute('aria-hidden','true');button.append(el('span','',name),marker);button.addEventListener('click',()=>installSetup(kind,entry));
   const description=entry.reason||(entry.installed?'Installed.':entry.available?`Install MCP configuration for ${name}.`:'Automatic installation is unavailable for this harness.');
   const top=el('div','setup-tile-top');button.title=description;top.append(button);tile.append(top);if(update)button.insertBefore(el('span','setup-update','Update'),marker);
   tile.append(el('p','mcp-state',pending?'Installing…':update?'Configuration update needed':entry.installed?'Configuration installed':entry.available?'Click to install':entry.reason||'Unavailable'));
   if(entry.installed||(!entry.available&&entry.reason))tile.append(el('p','mcp-next-step',entry.installed?description:''));
   if(kind==='mcp'&&configText(entry)){const manual=el('details','mcp-manual'),manualLabel=el('summary','','Manual setup'),actions=el('div','setup-copy-actions'),copy=el('button','setup-copy','Copy config'),preview=el('button','setup-preview','Preview');manual.append(manualLabel);copy.type=preview.type='button';copy.setAttribute('aria-label',`Copy ${name} MCP config`);preview.setAttribute('aria-label',`Preview ${name} MCP config`);copy.addEventListener('click',()=>copyConfig(entry));preview.addEventListener('click',()=>previewConfig(entry));actions.append(copy,preview);manual.append(actions);tile.append(manual);}
   root.append(tile);
  }
 }
 if(setupError)setupFeedback(setupError,true);
}
async function installSetup(kind,entry){
 if(installing.size||setupLoading||!entry.available||(entry.installed&&entry.current!==false))return;const key=`${kind}:${entry.id}`;installing.add(key);setupRevision++;setupLoading=false;setupError='';setupFeedback(`Installing ${entry.name} MCP…`);renderSetup();
 try{setupStatus=await api('/api/setup-install',{kind,id:entry.id});rememberSetup();const updated=setupStatus?.[kind]?.entries?.find(item=>item.id===entry.id);setupFeedback(updated?.installed?`${entry.name} MCP installed.`:updated?.reason||`${entry.name} installation was not confirmed.`,!updated?.installed);}
 catch(error){setupFeedback(error.message||'Installation failed.',true);}
 finally{installing.delete(key);renderSetup();}
}
async function load(){if(inventoryRefreshing)return;const previousError=inventoryError;busy=true;inventoryRefreshing=true;inventoryError='';$('#refresh').disabled=true;renderSetup();try{const state=await api('/api/state');agents=state.agents||[];connections=state.connections||{};rememberInventory();connectionText();if(!loaded||!dirty){const drafts=!loaded&&dirty?config.routes:[];config={version:1,routes:[],...state.config};config.routes=[...config.routes,...drafts].map(normalize);config.workspace='';config.inheritWorkspace=true;baseRevision=state.revision;appliedRevision=state.activeRevision;savedSnapshot=JSON.stringify(config);if(state.preservedDraft){$('#save-conflict').hidden=false;$('#save-conflict').open=true;$('#draft-text').value=JSON.stringify(state.preservedDraft,null,2);notice('Rules were applied outside this app. The latest rules are loaded; your earlier saved draft is preserved below.');}}loaded=true;if(previousError&&$('#notice').textContent===previousError)notice('');void loadSetup();void loadTasks();$('#connection').textContent='On this device';renderAgents();renderRules();renderTaskLibrary();for(const r of config.routes)ensureCatalogs(r);}catch(e){inventoryError=String(e.message||e);notice(inventoryError,true);$('#connection').textContent='Could not refresh';}finally{busy=false;inventoryRefreshing=false;$('#refresh').disabled=false;renderSetup();controls();}}
function showConflict(){
 const panel=$('#save-conflict');panel.hidden=false;panel.open=true;$('#draft-text').value=JSON.stringify(config,null,2);notice('Rules changed outside this app. Your draft is preserved below. Load the latest rules, then reapply the changes you want to keep.',true);
}
async function loadLatest(){
 if(busy)return;busy=true;controls();$('#load-latest').disabled=true;
 try{const state=await api('/api/state');$('#draft-text').value=JSON.stringify(config,null,2);config={version:1,routes:[],...state.config};config.routes=config.routes.map(normalize);config.workspace='';config.inheritWorkspace=true;baseRevision=state.revision;appliedRevision=state.activeRevision;savedSnapshot=JSON.stringify(config);agents=state.agents||[];connections=state.connections||{};rememberInventory();dirty=false;loaded=true;connectionText();renderAgents();renderRules();renderTaskLibrary();for(const rule of config.routes)ensureCatalogs(rule);notice('Latest rules loaded. Your previous draft remains below for reference while you reapply your changes.');}
 catch(error){notice(error.message||'Could not load the latest rules. Your draft is unchanged.',true);}
 finally{busy=false;$('#load-latest').disabled=false;controls();}
}
async function save(apply=false){
 if(busy||!loaded)return;busy=true;actionInProgress=apply?'Applying…':'Saving…';controls();
 try{
  for(const r of config.routes)sync(r);const submitted=JSON.stringify(config);
  const result=await api(apply?'/api/editor-apply':'/api/editor-save',{...(dirty||!apply?{config:JSON.parse(submitted)}:{}),expectedRevision:baseRevision});
  baseRevision=result.revision;appliedRevision=result.activeRevision;savedSnapshot=submitted;dirty=JSON.stringify(config)!==submitted;
  if(result.connections)connections=result.connections;connectionText();renderAgents();
  notice(apply&&(result.warnings?.length||/Load updated integrations/.test(result.message||''))?result.message:'');
 }catch(error){if(error.code==='CONFIG_CONFLICT'||/configuration changed/i.test(error.message||''))showConflict();else notice(String(error.message||error),true);}
 finally{busy=false;actionInProgress='';controls();}
}

function visibleTasks(){
 const list=taskState.tasks.map(t=>({...t}));
 for(const r of config.routes)if(r.task&&r.task!=='Auto'&&!list.some(t=>t.name.toLowerCase()===r.task.toLowerCase()))list.push({name:r.task});
 return list;
}
function renderTaskLibrary(){
 const root=$('#task-library');root.replaceChildren();
 for(const task of visibleTasks()){
  const button=el('button','task-chip');button.type='button';button.disabled=!taskState.revision;button.setAttribute('aria-label',`Edit task ${task.name}`);button.append(el('span','',task.name),el('span','task-edit-icon','↗'));button.lastChild.setAttribute('aria-hidden','true');
  button.addEventListener('click',()=>openTaskDialog({task,returnTo:()=>[...root.querySelectorAll('button')].find(b=>b.dataset.id===task.id)?.focus()}));button.dataset.id=task.id||task.name;root.append(button);
 }
 $('#add-task').disabled=!taskState.revision;
}
async function loadTasks(){
 if(tasksLoading)return;tasksLoading=true;
 try{taskState=await api('/api/tasks');$('#task-library-status').textContent='';renderTaskLibrary();for(const card of cards.values())card.refresh();}
 catch(error){$('#task-library-status').textContent=error.message||'Could not load tasks.';}
 finally{tasksLoading=false;}
}
function openTaskDialog({task,ruleId,returnTo}={}){
 if(!taskState.revision||document.querySelector('.task-dialog'))return;
 for(const select of document.querySelectorAll('.themed-select'))select.closeSelect?.();
 const dialog=el('dialog','task-dialog'),form=el('form'),heading=el('div','task-dialog-heading'),title=el('h2','',task?'Edit task':'New task'),close=el('button','task-close','×'),label=el('label','','Task name'),input=el('input','task-name'),error=el('p','task-error'),hint=el('p','task-hint'),actions=el('div','dialog-actions'),cancel=el('button','dialog-cancel','Cancel'),submit=el('button','task-submit',task?'Save task':'Add task');
 let saving=false;const originalName=task?.name;
 title.id='task-dialog-title';dialog.setAttribute('aria-labelledby',title.id);input.id='task-dialog-name';input.maxLength=120;input.required=true;input.value=originalName||'';input.placeholder='e.g. Security audit';input.autocomplete='off';label.htmlFor=input.id;error.id='task-dialog-error';error.setAttribute('role','status');input.setAttribute('aria-describedby',error.id);close.type=cancel.type='button';close.setAttribute('aria-label','Close task editor');submit.type='submit';
 heading.append(title,close);actions.append(cancel,submit);form.append(heading,label,input,error,hint,actions);dialog.append(form);document.body.append(dialog);
 function validateInput(){let message='';try{uniqueTaskName(input.value,taskState.tasks,task?.id);}catch(e){message=e.message;}error.textContent=input.value?message:'';input.setAttribute('aria-invalid',String(!!message&&!!input.value));submit.disabled=saving||!!message||(task?.id&&input.value.trim()===originalName);const count=originalName?config.routes.filter(r=>r.task===originalName).length:0;hint.textContent=count?`Renaming updates ${count===1?'this rule':`${count} rules`} in your draft. Save and apply rules to publish.`:'Available in every rule’s task dropdown.';}
 const dismiss=()=>{if(saving)return;dialog.close();dialog.remove();returnTo?.();if(!document.activeElement||document.activeElement===document.body)$('#add-task').focus({preventScroll:true});};
 cancel.addEventListener('click',dismiss);close.addEventListener('click',dismiss);dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dismiss();}});input.addEventListener('input',validateInput);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(saving||submit.disabled)return;let name;try{name=uniqueTaskName(input.value,taskState.tasks,task?.id);}catch(e){error.textContent=e.message;return;}
  saving=true;submit.disabled=true;cancel.disabled=close.disabled=true;submit.textContent='Saving…';
  try{
   const result=await api('/api/task-save',{...(task?.id?{id:task.id}:{}),name,expectedRevision:taskState.revision});taskState={tasks:result.tasks,revision:result.revision};let edited=false;
   for(const r of config.routes)if((ruleId&&r.id===ruleId)||(originalName&&r.task===originalName)){r.task=result.task.name;edited=true;}
   if(edited)changed();renderTaskLibrary();for(const card of cards.values())card.refresh();$('#task-library-status').textContent=edited?'Task saved. Save and apply your rule changes when ready.':'Task saved.';saving=false;dialog.close();dialog.remove();returnTo?.();
  }catch(e){if(/Task list changed/.test(e.message)){await loadTasks();}error.textContent=e.message||'Could not save task.';}
  finally{saving=false;if(dialog.isConnected){submit.textContent=task?'Save task':'Add task';submit.disabled=false;cancel.disabled=close.disabled=false;input.focus();}}
 });
 dialog.showModal();validateInput();input.focus();input.select();
}
$('#add-task').addEventListener('click',()=>openTaskDialog({returnTo:()=>$('#add-task').focus()}));
$('#task-section-info').append(infoButton('About tasks','Click a task to rename it, or add one of your own. Task names are saved on this device. Auto always remains available. Renaming updates matching rules in the current draft; Save and Apply publishes those rule changes.'));
renderTaskLibrary();

$('#load-latest').addEventListener('click',loadLatest);
function showSettings(open){
 $('#agents-panel').hidden=!open;$('#rules-panel').hidden=open;$('#rules-actions').hidden=open;const button=$('#settings-toggle');button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Close settings':'Open settings');button.querySelector('span').textContent=open?'Close settings':'Settings';button.querySelector('.settings-gear').toggleAttribute('hidden',open);button.querySelector('.settings-close').toggleAttribute('hidden',!open);document.body.classList.toggle('settings-open',open);window.scrollTo(0,0);
 if(open){renderSetup();void loadTasks();void load();void configurationUI.refresh();}else $('#settings-toggle').focus({preventScroll:true});
}
configurationUI=setupConfiguration({api,native,infoButton,getEditor:()=>({config:structuredClone(config),dirty,loaded,busy,revision:baseRevision,pending:baseRevision!==appliedRevision}),importDraft:value=>{config=value;config.routes=config.routes.map(normalize);changed();renderRules();renderTaskLibrary();for(const rule of config.routes)ensureCatalogs(rule);notice('Configuration imported into your draft. Review the rules, then Save or Save and Apply.');},showRules:()=>showSettings(false)});
$('#settings-toggle').addEventListener('click',()=>showSettings($('#agents-panel').hidden));
$('#show-prompt-previews').checked=showPromptPreviews;
$('#show-prompt-previews').addEventListener('change',event=>{
 showPromptPreviews=event.target.checked;
 try{localStorage.setItem('bridge-show-prompt-previews',String(showPromptPreviews));}catch{}
 if(!showPromptPreviews)promptPreviews.clear();
 for(const card of cards.values())card.refresh();
});
$('#prompt-preview-info').append(infoButton('About prompt previews','Show an Aa button on each rule to inspect its generated instruction. Read only; each preview stays within that rule. This display preference is saved automatically on this device.'));

$('#add').addEventListener('click',()=>{config.routes.push(normalize({id:crypto.randomUUID(),parents:[],workers:[],models:[],reasoning:'',task:'Auto',enabled:false}));changed();renderRules();ensureCatalogs(config.routes.at(-1));});$('#save-only').addEventListener('click',()=>save(false));$('#save-apply').addEventListener('click',()=>save(true));$('#refresh').addEventListener('click',load);window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});document.addEventListener('keydown',e=>{if(e.key==='Escape'){const active=[...document.querySelectorAll('.worker-editor')].find(w=>w.querySelector('.model-select-row.expanded'));if(active)active.closeThinking?.();else for(const w of document.querySelectorAll('.worker-editor'))w.closeEditor?.();}});document.addEventListener('scroll',()=>{for(const picker of document.querySelectorAll('.combo'))picker.positionPicker?.();for(const s of document.querySelectorAll('.themed-select'))s.positionSelect?.();for(const w of document.querySelectorAll('.worker-editor'))w.positionThinking?.();},true);window.addEventListener('resize',()=>{for(const picker of document.querySelectorAll('.combo'))picker.positionPicker?.();for(const s of document.querySelectorAll('.themed-select'))s.positionSelect?.();for(const w of document.querySelectorAll('.worker-editor'))w.positionThinking?.();});document.addEventListener('click',e=>{for(const s of document.querySelectorAll('.themed-select'))if(!e.composedPath().includes(s))s.closeSelect?.();for(const tooltip of document.querySelectorAll('.info-control.tip-open'))if(!e.composedPath().includes(tooltip)){tooltip.classList.remove('tip-open');tooltip.querySelector('button').setAttribute('aria-expanded','false');}for(const editor of document.querySelectorAll('.worker-editor'))if(!e.composedPath().includes(editor))editor.closeEditor?.();for(const d of document.querySelectorAll('.combo'))if(!e.composedPath().includes(d))d.closePicker?.();});$('#rules-help').append(infoButton('How rules work','Enable prompt previews in Settings to inspect a rule with Aa. Preview is read only and scrolls within the rule’s existing space; Save Rules keeps a draft; Apply Rules publishes it to agents. Runtime tools and shared delegation guidance are added by the harness. Can use permits delegation; Should use requires it for matching tasks. Multiple harnesses and models are alternatives: the parent chooses one per task. Workers inherit the parent’s folder. Thinking belongs to each model. New rules start off; enable them after validation passes. Validation checks installed harnesses and advertised settings, not provider billing or live model responses.'));renderAgents();renderSetup();void loadTasks();load();
