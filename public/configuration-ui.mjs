const LIMIT=262144;
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const jsonText=config=>JSON.stringify(config,null,2)+'\n';

export function setupConfiguration({api,native,getEditor,importDraft,showRules,infoButton}){
 const section=document.querySelector('#configuration-settings'),status=section.querySelector('[role=status]'),path=section.querySelector('.configuration-path');
 const buttons=Object.fromEntries([...section.querySelectorAll('[data-config-action]')].map(button=>[button.dataset.configAction,button]));
 let metadata=null,working=false,refreshing=false;
 section.querySelector('.configuration-info').append(infoButton('About configuration','The desktop app and CLI share these rules. Export includes the rules currently in your editor, including unsaved changes. Import replaces the editor draft only; Save and Apply publishes it to agents. Task-name presets, display preferences, agent credentials, and MCP installations are separate. Open file opens the applied config.json; direct edits affect agents, so use Import to review changes first.'));
 function feedback(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
 function update(){
  const editor=getEditor();
  for(const button of Object.values(buttons))button.disabled=working||!editor.loaded||editor.busy;
  buttons.open.textContent=native()?'Open file ↗':'Copy path';buttons.open.disabled=working||(!native()&&!metadata?.path);
  section.querySelector('.configuration-state').textContent=editor.dirty?'Includes unsaved changes':editor.pending?'Saved draft · not applied':'Shared with the CLI';
 }
 async function refresh(){
  if(refreshing)return;refreshing=true;
  try{metadata=await api('/api/configuration');path.textContent=metadata.path;path.title=metadata.path;}
  catch(error){if(!metadata)path.textContent='Configuration path unavailable';feedback(String(error.message||error),true);}
  finally{refreshing=false;update();}
 }
 async function action(operation){if(working)return;working=true;update();feedback('');try{await operation();}catch(error){feedback(String(error.message||error),true);}finally{working=false;update();}}
 function dialog(title,returnTo){
  const box=element('dialog','configuration-dialog'),heading=element('div','configuration-dialog-heading'),label=element('h2','',title),close=element('button','task-close','×'),body=element('div','configuration-dialog-body'),actions=element('div','dialog-actions');
  label.id='configuration-dialog-title';box.setAttribute('aria-labelledby',label.id);close.type='button';close.setAttribute('aria-label','Close configuration');heading.append(label,close);box.append(heading,body,actions);document.body.append(box);
  const dismiss=()=>{box.close();box.remove();returnTo?.focus({preventScroll:true});};close.addEventListener('click',dismiss);box.addEventListener('cancel',event=>{event.preventDefault();dismiss();});box.addEventListener('click',event=>{if(event.target===box){const b=box.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dismiss();}});
  return {box,body,actions,dismiss,show(){box.showModal();close.focus();}};
 }
 function codeView(config){
  const pre=element('pre','configuration-code'),code=element('code');pre.tabIndex=0;pre.setAttribute('aria-label','Configuration JSON');
  const text=jsonText(config),tokens=/"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g;let end=0;
  for(const match of text.matchAll(tokens)){code.append(document.createTextNode(text.slice(end,match.index)));const value=match[0],kind=value.startsWith('"')?text.slice(match.index+value.length).trimStart().startsWith(':')?'key':'string':'literal';code.append(element('span',`json-${kind}`,value));end=match.index+value.length;}
  code.append(document.createTextNode(text.slice(end)));pre.append(code);return pre;
 }
 async function exportConfig(value=getEditor().config){
  const checked=await api('/api/configuration/validate',{config:value}),text=jsonText(checked.config);
  if(new TextEncoder().encode(text).length>LIMIT)throw new Error('Configuration is too large to export (maximum 256 KiB).');
  if(native()){const saved=await native()('export_configuration',{text});feedback(saved?'Configuration exported.':'Export canceled.');}
  else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=element('a');link.href=url;link.download='subagent-bridge-config.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('Configuration downloaded.');}
 }
 async function view(){
  const state=await api('/api/configuration'),editor=getEditor(),d=dialog('Configuration',buttons.view),tabs=element('div','configuration-tabs'),content=element('div'),note=element('p','configuration-note'),copy=element('button','task-submit','Copy JSON');let value=editor.config;
  const choices=[{name:editor.dirty?'Current draft':editor.pending?'Saved draft':'Current rules',value:editor.config},{name:'Applied rules',value:state.activeConfig}];if(state.preservedDraft)choices.push({name:'Preserved draft',value:state.preservedDraft});
  tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Configuration version');
  for(const choice of choices){const button=element('button','',choice.name);button.type='button';button.setAttribute('aria-pressed',String(choice===choices[0]));button.addEventListener('click',()=>{value=choice.value;for(const item of tabs.children)item.setAttribute('aria-pressed',String(item===button));content.replaceChildren(codeView(value));note.textContent=choice.name==='Applied rules'?'Read by connected agents.':choice.name==='Preserved draft'?'Recovered from an external change. Export or copy it before reconciling.':editor.dirty?'Unsaved changes are included.':editor.pending?'Saved locally. Not applied to agents yet.':'These rules match the current editor.';});tabs.append(button);}
  content.append(codeView(value));note.textContent=editor.dirty?'Unsaved changes are included.':editor.pending?'Saved locally. Not applied to agents yet.':'Read-only preview of your rule configuration.';
  copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(jsonText(value));copy.textContent='Copied';}catch{const range=document.createRange();range.selectNodeContents(content);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);note.textContent='JSON selected. Use your copy shortcut.';}});d.body.append(tabs,note,content);d.actions.append(copy);d.show();
 }
 function chooseFile(){
  if(native())return native()('import_configuration');
  return new Promise((resolve,reject)=>{const input=element('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);input.addEventListener('cancel',()=>{input.remove();resolve(null);},{once:true});input.addEventListener('change',async()=>{try{const file=input.files?.[0];if(!file){resolve(null);return;}if(file.size>LIMIT)throw new Error('Choose a JSON file smaller than 256 KiB.');resolve({text:await file.text(),name:file.name});}catch(error){reject(error);}finally{input.remove();}},{once:true});input.click();});
 }
 async function importConfig(){
  const file=await chooseFile();if(!file)return;
  if(new TextEncoder().encode(file.text).length>LIMIT)throw new Error('Choose a JSON file smaller than 256 KiB.');
  let value;try{value=JSON.parse(file.text.replace(/^\uFEFF/,''));}catch{throw new Error('This file is not valid JSON. Your current rules have not changed.');}
  const checked=await api('/api/configuration/validate',{config:value}),editor=getEditor(),snapshot=JSON.stringify(editor.config),d=dialog('Import configuration',buttons.import),note=element('p','configuration-note'),summary=element('p','configuration-import-summary'),error=element('p','configuration-status'),backup=element('button','dialog-cancel','Export current'),cancel=element('button','dialog-cancel','Cancel'),confirm=element('button','task-submit','Load draft');
  const count=checked.config.routes.length;summary.textContent=`${editor.config.routes.length} rules → ${count} ${count===1?'rule':'rules'}`;note.textContent=`${file.name} · Replaces the rules in your editor. ${editor.dirty?'Your unsaved changes will be replaced. ':''}Nothing is applied until you Save and Apply.`;error.setAttribute('role','status');
  for(const button of [backup,cancel,confirm])button.type='button';backup.addEventListener('click',async()=>{backup.disabled=true;try{await exportConfig(editor.config);error.textContent='';}catch(e){error.textContent=String(e.message||e);}finally{backup.disabled=false;}});cancel.addEventListener('click',d.dismiss);confirm.addEventListener('click',()=>{const latest=getEditor();if(latest.busy||latest.revision!==editor.revision||JSON.stringify(latest.config)!==snapshot){error.textContent='Your rules changed while this preview was open. Close it and import again.';return;}importDraft(structuredClone(checked.config));d.dismiss();showRules();});
  d.body.append(summary,note,codeView(checked.config),error);d.actions.append(backup,cancel,confirm);d.show();
 }
 buttons.view.addEventListener('click',()=>action(view));buttons.export.addEventListener('click',()=>action(()=>exportConfig()));buttons.import.addEventListener('click',()=>action(importConfig));
 buttons.open.addEventListener('click',()=>action(async()=>{if(native()){await native()('open_configuration');feedback('Opened the applied config file. Refresh Bridge after external edits.');}else{try{await navigator.clipboard.writeText(metadata.path);feedback('Configuration path copied.');}catch{const range=document.createRange();range.selectNodeContents(path);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);feedback('Path selected. Use your copy shortcut.');}}}));
 update();return {refresh,update};
}
