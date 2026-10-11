import path from 'node:path';
import {readFile,writeFile,mkdir,rename,rm,rmdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {home,load,validate,configRevision} from './core.mjs';
import {saveAndConnect} from './connections.mjs';
const file=path.join(home,'editor-draft.json');
const conflict=()=>Object.assign(new Error('Configuration changed. Load the latest rules before saving or applying.'),{code:'CONFIG_CONFLICT'});
export async function editorState(){
 const active=await load(),activeRevision=configRevision(active);let draft;
 try{draft=JSON.parse(await readFile(file,'utf8'));draft.config=validate(draft.config);}catch(e){if(e.code!=='ENOENT')throw e;}
 const superseded=draft&&draft.baseRevision!==activeRevision&&configRevision(draft.config)!==activeRevision;
 const config=draft&&!superseded?draft.config:active;
 return {config,revision:configRevision(config),activeRevision,applied:configRevision(config)===activeRevision,...(superseded?{preservedDraft:draft.config}:{})};
}
async function locked(fn){
 await mkdir(home,{recursive:true,mode:0o700});const lock=path.join(home,'editor-write.lock'),deadline=Date.now()+5000;
 while(true){try{await mkdir(lock,{mode:0o700});break;}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>deadline)throw new Error('Another rule save is in progress. Try again shortly.');await new Promise(r=>setTimeout(r,25));}}
 try{return await fn();}finally{await rmdir(lock);}
}
// Desktop-only drafts do not change config.json, which every parent reads live.
export async function saveEditorDraft(value,{expectedRevision}={}){
 return locked(async()=>{
  const before=await editorState();if(expectedRevision!==before.revision)throw conflict();
  const config=validate(value);
  if(configRevision(await load())!==before.activeRevision)throw conflict();
  const temp=path.join(home,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify({config,baseRevision:before.activeRevision},null,2),{mode:0o600});await rename(temp,file);
  return {config,revision:configRevision(config),activeRevision:before.activeRevision,applied:configRevision(config)===before.activeRevision,saved:true};
 });
}
export async function applyEditorRules({config,expectedRevision}={}, {commit=saveAndConnect}={}){
 return locked(async()=>{
  const before=await editorState();if(expectedRevision!==before.revision)throw conflict();
  const result=await commit(config??before.config,{expectedRevision:before.activeRevision});
  await rm(file,{force:true});
  return {...result,activeRevision:result.revision,applied:true};
 });
}
