// DeepSeek Harness 0.2.0-rc.2 native tools + owner-scoped background jobs.
// Jobs, cancellation, result retention, and parent notices remain DeepSeek-owned.
import {randomUUID} from 'node:crypto';
import {createWorkerHost} from '../../../lib/runtime/worker-host-client.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {callBridge,ruleGuidance,toolSchemas} from '../../../lib/parent-bridge.mjs';
export const name='harness-bridge';
export const inject=['tools','jobs','systemPrompt'];
const parameters=spec=>({type:'object',properties:spec.properties,required:spec.required,additionalProperties:false});
const output={schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]};
export function readRuntimeVersion(resourcesPath=process.resourcesPath){
 if(!resourcesPath)return null;
 try{return JSON.parse(readFileSync(path.join(resourcesPath,'app.asar/dsh/node_modules/@deepseek-ai/dsh-subagent/package.json'),'utf8')).version;}catch{return null;}
}
export function apply(ctx,config={}){return mountIntegration(ctx,config,readRuntimeVersion());}
export function mountIntegration(ctx,config={},runtimeVersion){
 if(process.env.HARNESS_BRIDGE_DEPTH)return;
 if(config.runtimeVersion!=='0.2.0-rc.2'||runtimeVersion!=='0.2.0-rc.2')throw new Error('Subagent Bridge: unsupported DeepSeek runtime; reconnect after compatibility review');
 const options={node:config.node,bridgeRoot:config.bridgeRoot,bridgeHome:config.bridgeHome};
 const call=config.callBridge||callBridge;
 const recent=new Map(),conversations=new Map(),hosts=new Map();
 const scope=(id,cwd)=>JSON.stringify([id,cwd]);
 function host(id,cwd){const key=scope(id,cwd);if(!hosts.has(key))hosts.set(key,(config.createHost||createWorkerHost)({parent:'deepseek',parentSessionId:id,cwd,...options}));return hosts.get(key);}
 ctx.on?.('dispose',()=>Promise.allSettled([...hosts.values()].map(h=>h.close())));
 function parent(exec){
  const id=exec.agent?.id,cwd=exec.agent?.session?.header?.cwd;
  if(!id||typeof cwd!=='string'||!path.isAbsolute(cwd))throw new Error('Subagent Bridge requires a parent session and its absolute project folder');
  return {id,cwd};
 }
 ctx.tools.register({name:'bridge_routes',description:toolSchemas.bridge_routes.description,parameters:parameters(toolSchemas.bridge_routes),output,isConcurrencySafe:()=>true,
  async execute(_args,exec){const {cwd}=parent(exec);return {routes:await call(['routes','--parent','deepseek'],cwd,{...options,signal:exec.signal})};}});
 for(const toolName of ['bridge_delegate','bridge_message'])ctx.tools.register({name:toolName,description:toolSchemas[toolName].description+' DeepSeek owns the job; use native job_output once after completion or when blocked, and job_kill for cancellation.',parameters:parameters(toolSchemas[toolName]),output,isConcurrencySafe:()=>true,
  async execute(args,exec){
   const {id,cwd}=parent(exec);
   let previous;
   if(toolName==='bridge_message'){
    previous=conversations.get(args.jobId);
    if(!previous||previous.scope!==scope(id,cwd))throw new Error('No such conversation in this parent session and folder');
    if(previous.invalid)throw new Error('This conversation failed or was cancelled; inspect its outcome before new work');
    args={route:previous.route,worker:previous.worker,model:previous.model,task:args.message};
   }
   if(typeof args.route!=='string'||!args.route||typeof args.task!=='string'||!args.task.trim()||args.task.length>100000)throw new Error('A rule and a self-contained task are required');
   if(args.worker!==undefined&&typeof args.worker!=='string'||args.model!==undefined&&typeof args.model!=='string')throw new Error('Worker and model selections must be strings');
   exec.signal?.throwIfAborted();
   const key=JSON.stringify([id,cwd,previous?.conversationId||'',args.route,args.task,args.worker||'',args.model||'']);
   const prior=recent.get(key);
   if(prior){
    const job=ctx.jobs.list(id).find(j=>j.id===prior.jobId);
    if(job?.status==='failed'&&!prior.failureSeenAt)prior.failureSeenAt=Date.now();
    if(job&&(['running','stopping'].includes(job.status)||job.status==='failed'&&Date.now()-prior.failureSeenAt<60000))return {jobId:prior.jobId,status:job.status,reused:true,message:'This task is already running or recently failed. Collect its native job_output; do not duplicate it.'};
    recent.delete(key);
   }
   const command=['delegate','--parent','deepseek','--route',args.route,'--parent-workspace',cwd,'--workspace',cwd,'--task',args.task];
   if(args.worker)command.push('--worker',args.worker);if(args.model)command.push('--model',args.model);
   const conversationId=previous?.conversationId||randomUUID();
   const busy=[...conversations.values()].some(c=>c.scope===scope(id,cwd)&&c.conversationId===conversationId&&c.status==='running');
   const conversation={scope:scope(id,cwd),conversationId,status:'running',route:args.route,worker:args.worker,model:args.model};
   const jobId=ctx.jobs.start({kind:'subagent',label:'Subagent Bridge: '+args.route,owner:id,outputLimitBytes:16000,run:()=>{
    const controller=new AbortController();
    const run=config.callBridge&&!config.createHost?call(command,cwd,{...options,signal:controller.signal}):host(id,cwd).run({conversationId,routeId:args.route,task:args.task,worker:args.worker,model:args.model},{signal:controller.signal});
    const done=run.then(result=>controller.signal.aborted?{status:'killed'}:({status:'completed',result:JSON.stringify({...result,conversationId})}),error=>{for(const c of conversations.values())if(c.conversationId===conversationId)c.invalid=true;return controller.signal.aborted?{status:'killed'}:{status:'failed',detail:JSON.stringify(error?.code?error:{code:'BRIDGE_ERROR',reason:'Bridge execution failed; inspect the selected harness',outcomeUnknown:true})};});
    void done.then(result=>{conversation.status=result.status;});
    return {done,cancel:()=>{for(const c of conversations.values())if(c.conversationId===conversationId)c.invalid=true;controller.abort();hosts.get(scope(id,cwd))?.closeConversation(conversationId);}};
   }});
   conversations.set(jobId,conversation);
   if(recent.size>=64)recent.delete(recent.keys().next().value);recent.set(key,{jobId});
   return {jobId,conversationId,status:'running',delivery:busy?'queued':'started',message:'Started in the background. Continue independent work. DeepSeek delivers a completion notice to this session; collect the result with job_output. Do not poll or duplicate this task.'};
  }});
 ctx.systemPrompt.section({name:'tool:harness-bridge',order:ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),text:()=>{
  try{
   const value=JSON.parse(readFileSync(path.join(config.bridgeHome,'config.json'),'utf8'));
   const routes=(value.routes||[]).filter(r=>r.enabled&&(r.parents?(!r.parents.length||r.parents.includes('deepseek')):r.parent==='*'||r.parent==='deepseek'));
   return ruleGuidance+' DeepSeek native jobs own this execution. Completion notices identify the finished job; use job_output to collect it. Current saved rules: '+JSON.stringify(routes);
  }catch{return 'Subagent Bridge rules could not be loaded. Call bridge_routes to inspect the error before delegating.';}
 }});
}
