import {inspectCompatibility} from './compatibility.mjs';
import {spawn} from 'node:child_process';
import {access,readFile,writeFile,mkdir,rename,stat,lstat,copyFile,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const home=process.env.HARNESS_BRIDGE_HOME || path.join(homedir(),'.harness-bridge');
export const agents=[
 {id:'codex',name:'Codex',command:'codex',adapter:'codex-acp',args:[]},
 {id:'claude',name:'Claude Code',command:'claude',adapter:'claude-agent-acp',args:[]},
 {id:'pi',name:'Pi',command:'pi',adapter:'pi-acp',args:[]},
 {id:'opencode',name:'OpenCode',command:'opencode',adapter:'opencode',args:['acp','--pure']},
 {id:'deepseek',name:'DeepSeek Harness',command:'dsh',adapter:'dsh',args:['--profile','acp']}
];
export async function which(command){
 for(const dir of [...(process.env.PATH||'').split(path.delimiter),path.join(home,'adapters','node_modules','.bin')]){
  for(const ext of process.platform==='win32'?['.exe','.cmd','.bat','']:['']){
   const p=path.join(dir,command+ext);try{await access(p,constants.X_OK);if((await stat(p)).isFile())return p;}catch{}
  }
 }
 if(command==='dsh'&&process.platform==='darwin'){
  for(const base of ['/Applications',path.join(homedir(),'Applications')]){
   const launcher=path.join(base,'DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh');
   try{await access(launcher,constants.X_OK);if((await stat(launcher)).isFile())return launcher;}catch{}
  }
 }
 return null;
}
export async function detect(){return Promise.all(agents.map(async a=>{
 const [executable,adapterPath]=await Promise.all([which(a.command),which(a.adapter)]);
 const compatibility=await inspectCompatibility({...a,executable});
 return {...a,version:compatibility.version,compatibility,installed:!!executable,executable,adapterPath,acpReady:!!adapterPath,status:adapterPath?'ACP endpoint found':executable?'Installed · ACP adapter needed':'Not found on PATH'};
}));}
export function launch(command,args,options={}){
 // On Windows npm exposes .cmd launchers. Only fixed commands/arguments go through this path;
 // prompts and model IDs always travel over stdin, never through a shell command.
 return spawn(command,args,{...options,shell:process.platform==='win32'&&/\.(cmd|bat)$/i.test(command),windowsHide:true});
}
export async function run(command,args,timeout=20000){
 return new Promise((resolve,reject)=>{
  const p=launch(command,args,{stdio:['ignore','pipe','ignore']});let out='';
  const timer=setTimeout(()=>{p.kill();reject(new Error('Harness query timed out'));},timeout);
  p.stdout.on('data',d=>{out+=d;if(out.length>4e6){p.kill();reject(new Error('Harness output too large'));}});
  p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error(`Harness query exited ${code}`));});
 });
}
export function validate(value){
 if(!value||!Array.isArray(value.routes)||value.routes.length>100)throw new Error('Expected at most 100 routes');
 if(value.inheritWorkspace!==undefined&&typeof value.inheritWorkspace!=='boolean')throw new Error('Invalid project inheritance setting');
 const ids=new Set();
 const routes=value.routes.map(r=>{
  if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(r.id)||ids.has(r.id))throw new Error('Route IDs must be unique');ids.add(r.id);
  const known=id=>agents.some(a=>a.id===id);
  if(r.model!==undefined&&(typeof r.model!=='string'||r.model.length>2000))throw new Error('Invalid model');
  if(r.model===undefined&&!Array.isArray(r.models))throw new Error('Invalid model');
  for(const k of ['task','reasoning'])if(typeof r[k]!=='string'||r[k].length>2000)throw new Error(`Invalid ${k}`);
  const harnesses=(key,legacy)=>{
   const list=r[key]===undefined?legacy:r[key];
   if(!Array.isArray(list)||list.length>agents.length||list.some(id=>typeof id!=='string'||!known(id))||new Set(list).size!==list.length)throw new Error(`Invalid ${key}: choose unique known harnesses`);
   return [...list];
  };
  const parents=harnesses('parents',r.parent==='*'?[]:[r.parent]);
  const workers=harnesses('workers',r.worker==='auto'?[]:[r.worker]);
  const reasoningByWorker={};
  if(r.reasoningByWorker!==undefined){
   if(!r.reasoningByWorker||typeof r.reasoningByWorker!=='object'||Array.isArray(r.reasoningByWorker))throw new Error('Invalid per-harness thinking settings');
   for(const [id,level] of Object.entries(r.reasoningByWorker)){
    if(!known(id)||(workers.length&&!workers.includes(id))||typeof level!=='string'||level.length>2000)throw new Error('Invalid per-harness thinking settings');
    reasoningByWorker[id]=level;
   }
  }
  const rawModels=r.models===undefined?(r.model?[{worker:r.worker,id:r.model}]:[]):r.models;
  if(!Array.isArray(rawModels)||rawModels.length>100)throw new Error('Expected at most 100 selected models');
  const modelKeys=new Set();
  const models=rawModels.map(m=>{
   if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(key=>!['worker','id','reasoning'].includes(key))||!known(m.worker)||typeof m.id!=='string'||!m.id.trim()||m.id.length>2000||(workers.length&&!workers.includes(m.worker)))throw new Error('Selected model must belong to an allowed harness');
   const key=JSON.stringify([m.worker,m.id]);if(modelKeys.has(key))throw new Error('Selected models must be unique');modelKeys.add(key);
   if(m.reasoning!==undefined&&(typeof m.reasoning!=='string'||m.reasoning.length>2000))throw new Error('Invalid per-model thinking setting');
   return {worker:m.worker,id:m.id,...(m.reasoning!==undefined?{reasoning:m.reasoning}:{})};
  });
  if(r.enabled&&!r.task.trim())throw new Error('Describe when the route should be used');
  if(typeof r.enabled!=='boolean')throw new Error('Invalid route state');
  const usage=r.usage??'can';
  if(!['can','should'].includes(usage))throw new Error('Invalid delegation policy: choose can or should');
  return {id:r.id,parents,workers,models,parent:parents.length===1?parents[0]:'*',worker:workers.length===1?workers[0]:'auto',model:models.length===1?models[0].id:'',reasoning:r.reasoning,...(Object.keys(reasoningByWorker).length?{reasoningByWorker}:{}),task:r.task,enabled:r.enabled,usage};
 });
 return {version:1,workspace:typeof value.workspace==='string'?value.workspace:'',inheritWorkspace:value.inheritWorkspace!==false,routes};
}
export function routeReasoning(route,worker,model=''){return route.models?.find(m=>m.worker===worker&&m.id===model)?.reasoning??route.reasoningByWorker?.[worker]??route.reasoning;}
export async function load(){try{return validate(JSON.parse(await readFile(path.join(home,'config.json'),'utf8')));}catch(e){if(e.code==='ENOENT')return {version:1,workspace:'',inheritWorkspace:true,routes:[]};throw e;}}
export function configRevision(config){return createHash('sha256').update(JSON.stringify(validate(config))).digest('hex');}
export async function save(value,{expectedRevision}={}){
 const config=validate(value);await mkdir(home,{recursive:true,mode:0o700});
 // Every writer shares this lock so an MCP compare-and-save cannot race a UI save.
 const lock=path.join(home,'config-write.lock'),deadline=Date.now()+5000;
 while(true){try{await mkdir(lock,{mode:0o700});break;}catch(error){
  if(error.code!=='EEXIST')throw error;
  if(Date.now()>=deadline)throw Object.assign(new Error('Configuration is busy. Retry after the other save finishes; if a writer crashed, remove config-write.lock only after confirming no save is active.'),{code:'CONFIG_BUSY'});
  await new Promise(resolve=>setTimeout(resolve,25));
 }}
 try{
  if(expectedRevision!==undefined&&expectedRevision!==configRevision(await load()))throw Object.assign(new Error('Configuration changed. Read the current configuration and preview your changes again before saving.'),{code:'CONFIG_CONFLICT'});
  const tmp=path.join(home,randomUUID()+'.tmp');await writeFile(tmp,JSON.stringify(config,null,2),{mode:0o600});await rename(tmp,path.join(home,'config.json'));return config;
 }finally{await rmdir(lock);}
}
export async function jsonFile(file){try{return JSON.parse(await readFile(file,'utf8'));}catch{return {};}}
export async function currentModel(id){
 if(id==='pi'){const c=await jsonFile(path.join(process.env.PI_CODING_AGENT_DIR||path.join(homedir(),'.pi/agent'),'settings.json'));return c.defaultProvider&&c.defaultModel?`${c.defaultProvider}/${c.defaultModel}`:c.defaultModel;}
 if(id==='claude'){const c=await jsonFile(path.join(homedir(),'.claude/settings.json'));return process.env.ANTHROPIC_MODEL||c.model||c.env?.ANTHROPIC_MODEL;}
 if(id==='codex'){try{const t=await readFile(path.join(process.env.CODEX_HOME||path.join(homedir(),'.codex'),'config.toml'),'utf8');return t.split(/^\s*\[/m)[0].match(/^model\s*=\s*"([^"]+)"/m)?.[1];}catch{}}
 return undefined;
}
const START='<!-- harness-bridge:start -->',END='<!-- harness-bridge:end -->';
export function managed(previous,block){const start=previous.indexOf(START),end=previous.indexOf(END);if((start<0)!==(end<0)||end>=0&&end<start)throw new Error('Incomplete managed instruction block; repair it first');return start<0?previous.trimEnd()+'\n\n'+block+'\n':previous.slice(0,start)+block+previous.slice(end+END.length);}
export async function apply(workspace){
 if(!workspace||!path.isAbsolute(workspace)||(await stat(workspace)).isDirectory()===false)throw new Error('Choose an existing absolute workspace directory');
 const command=`${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(root,'bin.mjs'))}`;
 const block=`${START}\n## Harness Bridge delegation\nBefore delegating a subtask, run \`${command} routes --parent YOUR_HARNESS\` to read current saved routing rules.\nUse enabled rules matching your harness (or *) and the task. Delegate with:\n\`${command} delegate --route ROUTE_ID --parent YOUR_HARNESS --workspace ${JSON.stringify(workspace)} --task "self-contained task"\`\nAlways inherit this parent session’s current project folder. Routing rules are shared across projects. For multiple or Auto worker choices, select exactly one available worker and pass --worker WORKER_ID. For multiple model choices for that worker, select one allowed model and pass --model MODEL_ID. Omit --model for Auto to retain the harness default. These choices never mean automatic parallel execution.\nValid parent IDs: codex, claude, pi, opencode, deepseek. Child execution retains its own harness and configured provider.\nDo not infer that a catalog model is authorized. Respect worker errors and permissions. Do not recursively delegate when HARNESS_BRIDGE_DEPTH is set.\nRules are shared and read at invocation time; do not copy model lists into instructions.\n${END}`;
 const files=['AGENTS.md','CLAUDE.md'];const plans=[];
 for(const name of files){const file=path.join(workspace,name);let previous='';try{if((await lstat(file)).isSymbolicLink())throw new Error(`Refusing symlink ${name}`);previous=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}plans.push({file,previous,next:managed(previous,block)});}
 const written=[];
 for(const p of plans){if(p.previous)await copyFile(p.file,p.file+'.harness-bridge-backup-'+Date.now());await writeFile(p.file,p.next);written.push(p.file);}
 const config=await load();await save({...config,workspace});
 return {files:written,message:'Instructions applied to AGENTS.md and CLAUDE.md. Start new agent sessions or reload workspace instructions. Harnesses that do not read these files need the instruction block imported manually.',coverage:{codex:'AGENTS.md',claude:'CLAUDE.md',pi:'AGENTS.md',opencode:'AGENTS.md',deepseek:'Import AGENTS.md into the selected profile if not automatically loaded'}};
}
