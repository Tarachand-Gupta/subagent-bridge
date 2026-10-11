'use strict';
const $=s=>document.querySelector(s),names={codex:'Codex',claude:'Claude Code',pi:'Pi',opencode:'OpenCode',deepseek:'DeepSeek'},presets=['General task','Code review','Implementation','Debugging','Research'];
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
function sizeSelect(s){const text=s.selectedOptions[0]?.textContent||'';s.style.width=`${Math.max(4,text.length*.57+1.1)}em`;}
function select(label,entries,value,callback){const s=el('select');s.setAttribute('aria-label',label);for(const[v,t]of entries)s.append(option(v,t));s.value=value;sizeSelect(s);s.addEventListener('change',()=>{sizeSelect(s);callback(s.value);});return s;}
function workerIds(r){return r.workers.length?r.workers:agents.filter(a=>a.installed&&a.acpReady).map(a=>a.id);}
function levels(worker,model){const c=catalogs.get(worker);if(!c||c.error)return[];const m=c.models.find(m=>m.id===(model||c.currentModel));if(m?.reasoning?.length)return m.reasoning.map(v=>typeof v==='string'?[v,v]:[String(v.value),v.name||String(v.value)]);const control=c.configOptions?.find(o=>/think|reason|effort/i.test([o.id,o.name,o.category].join(' '))&&o.options);return(control?.options||[]).filter(o=>o.value!==undefined).map(o=>[String(o.value),o.name||String(o.value)]);}
function thinking(r){const alternatives=workerIds(r).flatMap(worker=>{const ms=r.models.filter(m=>m.worker===worker);return(ms.length?ms:[{id:''}]).map(m=>levels(worker,m.id));});if(!alternatives.length)return[];return alternatives[0].filter(([v])=>alternatives.every(opts=>opts.some(([id])=>id===v)));}
async function probe(id){if(probing.has(id))return;probing.add(id);renderAgents();refreshCards();try{const c=await api('/api/probe',{agentId:id});catalogs.set(id,{...c,models:(c.models||[]).map(m=>typeof m==='string'?{id:m,name:m}:m)});}catch(e){catalogs.set(id,{models:[],error:e.message});}finally{probing.delete(id);renderAgents();refreshCards();}}
function refreshCards(){for(const card of cards.values())card.refresh();}
function ensureCatalogs(r){for(const id of workerIds(r))if(!catalogs.has(id)&&!probing.has(id))probe(id);}
function modelKey(m){return JSON.stringify([m.worker,m.id]);}
function modelLabel(m){const c=catalogs.get(m.worker);return`${names[m.worker]||m.worker} / ${c?.models.find(o=>o.id===m.id)?.name||m.id}`;}
function modelEntries(r){const result=[];for(const id of workerIds(r)){const c=catalogs.get(id);for(const m of c?.models||[]){const provider=m.provider?.name||m.provider?.id||m.provider||(m.id.includes('/')?m.id.split('/')[0]:'Catalog');result.push({value:modelKey({worker:id,id:m.id}),label:m.name||m.id,chip:`${names[id]} / ${m.name||m.id}`,detail:m.id,group:`${names[id]} · ${provider}`});}}for(const m of r.models)if(!result.some(o=>o.value===modelKey(m)))result.push({value:modelKey(m),label:m.id,chip:modelLabel(m),detail:'Saved selection · not in discovered catalog',group:names[m.worker]||m.worker});return result;}
// Refresh picker contents in place so model discovery never steals focus or closes it.
function multiPicker({label,auto,entries,values,choose,onOpen,models=false,embedded=false}){const wrap=el('div','combo'),button=el('button','chip combo-trigger'),chips=el('span','combo-chips'),popup=el('div','model-popover'),search=el('input','model-search'),options=el('div','model-options');button.type='button';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');popup.hidden=true;popup.id=`picker-${crypto.randomUUID()}`;button.setAttribute('aria-controls',popup.id);search.type='search';search.placeholder=models?'Search harness, provider or model…':'Search agents…';search.setAttribute('aria-label',`Search ${label.toLowerCase()}`);options.setAttribute('role','listbox');options.setAttribute('aria-label',label);options.setAttribute('aria-multiselectable','true');button.append(chips);function close(){if(embedded)return;popup.hidden=true;button.setAttribute('aria-expanded','false');}function fill(){const scroll=options.scrollTop,focused=options.contains(document.activeElement)?document.activeElement?.dataset.value:null,selected=values(),all=entries(),q=search.value.trim().toLowerCase();chips.replaceChildren();if(!selected.length)chips.append(el('span','auto-chip',auto));else for(const [i,value]of selected.entries()){if(i)chips.append(el('span','chip-comma',','));const item=all.find(e=>e.value===value);chips.append(el('span','selection-chip',item?.chip||item?.label||value));}button.title=selected.length?selected.map(value=>{const item=all.find(e=>e.value===value);return item?.chip||item?.label||value;}).join(', '):auto;options.replaceChildren();function row(item,isAuto=false){const active=isAuto?!selected.length:selected.includes(item.value),b=el('button','model-option'+(active?' selected':''));b.type='button';b.dataset.value=isAuto?'__auto__':item.value;b.setAttribute('role','option');b.setAttribute('aria-selected',String(active));b.append(el('span','option-check',active?'✓':''),el('span','option-label',item.label));if(item.detail)b.append(el('small','',item.detail));b.addEventListener('click',()=>{choose(isAuto?[]:active?selected.filter(v=>v!==item.value):[...selected,item.value]);fill();});options.append(b);}row({label:auto},true);let group='',count=0;for(const item of all){if(q&&!`${item.label} ${item.detail||''} ${item.group||''}`.toLowerCase().includes(q))continue;if(item.group&&item.group!==group){group=item.group;options.append(el('div','option-group',group));}row(item);count++;}if(!count)options.append(el('div','picker-empty',models?'No matching catalog models. Refresh to discover available models.':'No matching agents.'));options.scrollTop=scroll;if(focused!==null)Array.from(options.querySelectorAll('button')).find(b=>b.dataset.value===focused)?.focus({preventScroll:true});}search.addEventListener('input',fill);button.addEventListener('click',()=>{const opening=popup.hidden;for(const other of document.querySelectorAll('.combo'))if(other!==wrap)other.closePicker?.();popup.hidden=!opening;button.setAttribute('aria-expanded',String(opening));if(opening){onOpen?.();fill();popup.style.left='0px';popup.style.top='';popup.style.bottom='';const bounds=popup.getBoundingClientRect();if(bounds.right>window.innerWidth-18)popup.style.left=`${window.innerWidth-18-bounds.right}px`;if(bounds.bottom>window.innerHeight-18&&button.getBoundingClientRect().top>bounds.height+18){popup.style.top='auto';popup.style.bottom='calc(100% + 12px)';}else if(bounds.bottom>window.innerHeight-18){popup.scrollIntoView({block:'nearest'});}search.focus({preventScroll:true});}});wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();e.stopPropagation();}if(e.key==='ArrowDown'&&e.target===search){e.preventDefault();options.querySelector('button')?.focus();}});popup.append(search,options,el('div','picker-hint',models?'Choose alternatives. The parent picks one harness and model per task. Catalog visibility does not verify account access.':'Select one or more, or choose Auto. Multiple selections are alternatives, not parallel runs.'));const done=el('button','text-button picker-done','Done');done.type='button';done.addEventListener('click',()=>{close();button.focus();});popup.append(done);wrap.append(button,popup);wrap.closePicker=close;if(embedded){button.hidden=true;popup.hidden=false;popup.classList.add('embedded-popover');done.hidden=true;wrap.classList.add('embedded-picker');}fill();return{element:wrap,refresh:fill};}
function effectiveReasoning(r,id){return Object.hasOwn(r.reasoningByWorker||{},id)?r.reasoningByWorker[id]:r.reasoning||'';}
function instruction(r){
 const parent=r.parents.length?r.parents.map(v=>names[v]||v).join(', '):'any connected parent',task=r.task==='Auto'?'any task':r.task,worker=r.workers.length?`choose one of ${r.workers.map(v=>names[v]||v).join(', ')}`:'choose one available harness',model=r.models.length?`choose one allowed model (${r.models.map(modelLabel).join(', ')}); use its default model for harnesses without a model selection`:'use its default model';
 const overrides=Object.entries(r.reasoningByWorker||{}),reason=overrides.length?`use the selected harness’s thinking setting (${overrides.map(([id,value])=>`${names[id]}: ${value||'default'}`).join(', ')}; other harnesses: ${r.reasoning||'default'})`:r.reasoning?`use ${r.reasoning} thinking`:'use its default thinking setting';
 const policy=r.usage==='should'?'delegation is required for matching tasks':'delegation is optional when helpful';
 return`When ${parent} needs ${task}, ${policy}: ${worker}, ${model}, and ${reason}. Inherit the parent session’s project folder.${r.usage==='should'?' If no allowed alternative is available or delegation fails, report the task as blocked; do not silently substitute another agent or do the task yourself.':''}`;
}
function reasoningOptions(control,options,current,{mixed=false}={}){
 control.replaceChildren(option('','Auto · default'),...options.map(([value,name])=>option(value,name.charAt(0).toUpperCase()+name.slice(1))));
 if(mixed){const placeholder=option('__per_harness__','per harness');placeholder.disabled=true;control.append(placeholder);control.value='__per_harness__';}
 else{if(current&&!options.some(([value])=>value===current))control.append(option(current,`${current} · saved, unverified`));control.value=current;}
 sizeSelect(control);
}
function positionPopover(popup,button){
 popup.style.left='0px';popup.style.top='';popup.style.bottom='';const bounds=popup.getBoundingClientRect();
 if(bounds.right>window.innerWidth-18)popup.style.left=`${window.innerWidth-18-bounds.right}px`;
 if(bounds.bottom>window.innerHeight-18&&button.getBoundingClientRect().top>bounds.height+18){popup.style.top='auto';popup.style.bottom='calc(100% + 12px)';}
 else if(bounds.bottom>window.innerHeight-18)popup.scrollIntoView({block:'nearest'});
}
function workerEditor(r,id,index,updated){
 const wrap=el('div','worker-editor'),trigger=el('button','worker-trigger',names[id]),summary=el('span','worker-summary'),popup=el('div','worker-popover');
 function revealWidth(){const right=wrap.closest('.sentence')?.getBoundingClientRect().right;if(right)wrap.style.setProperty('--worker-reveal',`${Math.max(summary.clientWidth,right-trigger.getBoundingClientRect().right-18)}px`);}
 wrap.addEventListener('pointerenter',revealWidth);wrap.addEventListener('focusin',revealWidth);
 trigger.type='button';trigger.setAttribute('aria-label',`Configure ${names[id]} for rule ${index+1}`);trigger.setAttribute('aria-expanded','false');popup.id=`worker-${crypto.randomUUID()}`;trigger.setAttribute('aria-controls',popup.id);popup.hidden=true;
 const view=()=>({...r,workers:[id],models:r.models.filter(m=>m.worker===id)});
 const picker=multiPicker({label:`${names[id]} models for rule ${index+1}`,auto:'Auto · use this harness’s default model',models:true,embedded:true,entries:()=>modelEntries(view()),values:()=>r.models.filter(m=>m.worker===id).map(modelKey),choose:values=>{
  r.models=[...r.models.filter(m=>m.worker!==id),...values.map(value=>{const[worker,model]=JSON.parse(value);return{worker,id:model};})];changed(r);updated();
 }});
 const thinkingLabel=el('div','editor-label','Thinking'),reasoning=select(`${names[id]} thinking for rule ${index+1}`,[],'',value=>{r.reasoningByWorker={...r.reasoningByWorker,[id]:value};changed(r);updated();});
 const heading=el('div','worker-editor-heading');heading.append(el('strong','',names[id]),el('span','','MODEL & THINKING'));
 const closeButton=el('button','text-button picker-done','Done');closeButton.type='button';
 function close(){popup.hidden=true;trigger.setAttribute('aria-expanded','false');}
 function open(){for(const other of document.querySelectorAll('.worker-editor'))if(other!==wrap)other.closeEditor?.();for(const combo of document.querySelectorAll('.combo'))combo.closePicker?.();popup.hidden=false;trigger.setAttribute('aria-expanded','true');if(!catalogs.has(id)&&!probing.has(id))probe(id);refresh();positionPopover(popup,trigger);popup.querySelector('input')?.focus({preventScroll:true});}
 trigger.addEventListener('click',()=>popup.hidden?open():close());summary.addEventListener('click',open);closeButton.addEventListener('click',()=>{close();trigger.focus();});
 wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){close();trigger.focus();e.stopPropagation();}});
 const hint=el('p','editor-note','Choose model alternatives for this harness. Other harnesses keep their own settings.');
 popup.append(heading,picker.element,thinkingLabel,reasoning,hint,closeButton);wrap.append(trigger,summary,popup);wrap.closeEditor=close;
 function refresh(){picker.refresh();const choices=r.models.filter(m=>m.worker===id).map(m=>catalogs.get(id)?.models.find(o=>o.id===m.id)?.name||m.id),reason=effectiveReasoning(r,id);summary.textContent=`${choices.length?choices.join(', '):'Auto model'} · ${reason||'Auto thinking'}`;summary.title=summary.textContent;reasoningOptions(reasoning,thinking(view()),reason);}
 refresh();return{element:wrap,refresh};
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
  const model=multiPicker({label:`Models for rule ${i+1}`,auto:'its default model',entries:()=>modelEntries(r),values:()=>r.models.map(modelKey),choose:values=>{r.models=values.map(key=>{const[worker,id]=JSON.parse(key);return{worker,id};});changed(r);refresh();},onOpen:()=>ensureCatalogs(r),models:true});
  const taskValue=r.task==='Auto'?'Auto':presets.includes(r.task)?r.task:'Custom';
  sentence.append(word('When'),parent.element,word('needs'),select(`Task type for rule ${i+1}`,[['Auto','any task'],...presets.map(p=>[p,p]),['Custom','Custom task…']],taskValue,value=>{r.task=value==='Custom'?'Custom task':value;changed(r);renderRules();}));
  if(taskValue==='Custom'){const custom=el('input','custom-task');custom.placeholder='Describe the task';custom.value=r.task==='Custom task'?'':r.task;custom.setAttribute('aria-label',`Custom task for rule ${i+1}`);custom.addEventListener('input',()=>{r.task=custom.value;changed(r);refresh();});sentence.append(custom);}
  const reasoning=select(`Thinking level for rule ${i+1}`,[],'',value=>{if(value==='__per_harness__')return;r.reasoning=value;r.reasoningByWorker={};changed(r);refresh();});
  const usage=select(`Delegation policy for rule ${i+1}`,[['can','can use'],['should','should use']],r.usage,value=>{r.usage=value;changed(r);refresh();});usage.classList.add('usage-select');sentence.append(usage);
  const workerArea=el('span','worker-area'),editors=[];
  function renderWorkerEditors(){
   if(viewMode!=='new')return;editors.length=0;for(const node of [...workerArea.childNodes])if(node!==worker.element)node.remove();if(worker.element.parentNode!==workerArea)workerArea.append(worker.element);
   if(!r.workers.length)worker.element.classList.remove('worker-chooser-compact');else worker.element.classList.add('worker-chooser-compact');
   for(const[idIndex,id]of r.workers.entries()){if(idIndex)workerArea.insertBefore(word('or'),worker.element);const editor=workerEditor(r,id,i,refresh);editors.push(editor);workerArea.insertBefore(editor.element,worker.element);}
  }
  if(viewMode==='new'){sentence.append(workerArea,word('.'));renderWorkerEditors();}
  else sentence.append(worker.element,word('using'),model.element,word('with'),reasoning,word('thinking.'));
  const policyHelp=el('div','policy-help'),foot=el('div','rule-foot'),preview=el('details','instruction-preview'),previewText=el('p');preview.append(el('summary','','Details & instruction'),policyHelp,foot,previewText);
  function refresh(){
   parent.refresh();worker.refresh();model.refresh();for(const editor of editors)editor.refresh();
   const opts=thinking(r),ids=workerIds(r),effective=ids.map(id=>effectiveReasoning(r,id)),mixed=new Set(effective).size>1,current=effective.length?effective[0]:r.reasoning||'';
   reasoningOptions(reasoning,opts,current,{mixed});previewText.textContent=instruction(r);policyHelp.textContent=r.usage==='should'?'Should use: delegate matching tasks. If delegation cannot run, report the blocker without silently substituting.':'Can use: the parent may delegate when helpful, or handle the task itself.';
   const pending=ids.filter(id=>probing.has(id)),unready=r.workers.filter(id=>!agents.find(a=>a.id===id)?.acpReady);
   foot.textContent=pending.length?`Discovering models for ${pending.map(id=>names[id]).join(', ')}…`:unready.length?`${unready.map(id=>names[id]).join(', ')} needs installation or ACP setup.`:viewMode==='new'?'Click a blue harness name to choose its models and thinking. Auto keeps that harness’s defaults.':mixed?'Thinking differs by harness. Switching views preserves it; changing this global thinking control replaces those overrides.':!opts.length?'Auto uses each harness’s default thinking setting. No shared explicit thinking levels are advertised.':'Explicit thinking levels shown are supported across the selected alternatives.';
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
$('#add').addEventListener('click',()=>{config.routes.push(normalize({id:crypto.randomUUID(),parents:[],workers:[],models:[],reasoning:'',task:'Auto',enabled:true}));changed();renderRules();});$('#save-only').addEventListener('click',save);$('#refresh').addEventListener('click',load);window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});document.addEventListener('click',e=>{for(const tooltip of document.querySelectorAll('.info-control.tip-open'))if(!e.composedPath().includes(tooltip)){tooltip.classList.remove('tip-open');tooltip.querySelector('button').setAttribute('aria-expanded','false');}for(const editor of document.querySelectorAll('.worker-editor'))if(!e.composedPath().includes(editor))editor.closeEditor?.();for(const d of document.querySelectorAll('.combo'))if(!e.composedPath().includes(d))d.closePicker?.();});load();
