import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createWorkerHost} from './runtime/worker-host-client.mjs';
import {root,home} from './core.mjs';

export {ruleGuidance} from '../public/rule-prompt.mjs';
import {ruleGuidance} from '../public/rule-prompt.mjs';
export const completionText=value=>'Subagent Bridge background result: '+JSON.stringify(value)+'. Synthesize this result yourself. It satisfies the Should rule for the delegated task; do not delegate it again. On failure explain the reason and next action.';
export const toolSchemas={
 bridge_routes:{description:'Read current Subagent Bridge delegation rules.',properties:{},required:[]},
 bridge_delegate:{description:'Start a background worker in this parent session folder. Returns a job ID immediately; completion is delivered automatically.',properties:{route:{type:'string'},task:{type:'string'},worker:{type:'string'},model:{type:'string'}},required:['route','task']},
 bridge_message:{description:'Send a followup to the same worker conversation using a previous job ID. Returns immediately. If busy, the message is queued for the next turn; it does not interrupt the current turn.',properties:{jobId:{type:'string'},message:{type:'string'}},required:['jobId','message']},
 bridge_status:{description:'Inspect a background job in this session. Do not poll in a loop.',properties:{jobId:{type:'string'}},required:['jobId']},
 bridge_cancel:{description:'Cancel a background job owned by this parent session.',properties:{jobId:{type:'string'}},required:['jobId']}
};
const fail=(code,reason,unknown=false)=>({code,reason,stage:'parent',retryable:false,outcomeUnknown:unknown,nextAction:unknown?'Inspect the workspace before considering another attempt.':'Report the failure; do not silently retry.'});
export function callBridge(args,cwd,{signal,node=process.execPath,bridgeRoot=root,bridgeHome=home,timeout=215000}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(fail('CANCELLED','Task cancelled'));
  const child=spawn(node,[path.join(bridgeRoot,'bin.mjs'),...args],{cwd,env:{...process.env,HARNESS_BRIDGE_HOME:bridgeHome},stdio:['ignore','pipe','ignore'],windowsHide:true});
  let out='',settled=false,killTimer;
  const stop=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);killTimer.unref();};
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>{stop();finish(fail('CANCELLED','Background task cancelled',true));};
  const timer=setTimeout(()=>{stop();finish(fail('TIMEOUT','Background task exceeded its deadline',true));},timeout);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',d=>{out+=d;if(out.length>8e6){stop();finish(fail('OUTPUT_LIMIT','Worker response exceeded the output limit',true));}});
  child.on('error',()=>finish(fail('PROCESS_UNAVAILABLE','Cannot start the Bridge runtime. Reconnect in Settings.')));
  child.on('close',code=>{clearTimeout(killTimer);let value;try{value=JSON.parse(out);}catch{}if(value?.ok===false)finish(value.error);else if(code===0&&value!==undefined)finish(null,value);else finish(fail('PROCESS_FAILED','Bridge process stopped without a valid result',true));});
 });
}
export function createParentBridge({parent,notify=async()=>{},call=callBridge,createHost,...options}){
 const jobs=new Map(),closedSessions=new Set(),closedConversations=new Set(),hosts=new Map();let closed=false;
 const scope=ctx=>JSON.stringify([ctx.sessionId,ctx.cwd]);
 const view=j=>({jobId:j.id,conversationId:j.conversationId,status:j.status,route:j.route,delivery:j.delivery,...(j.progress?{progress:j.progress}:{}),...(j.result?{result:j.result}:{}),...(j.error?{error:j.error}:{}),...(j.deliveryError?{deliveryError:j.deliveryError}:{})});
 const own=(id,ctx)=>{const job=jobs.get(id);if(!job||job.scope!==scope(ctx))throw new Error('No such job in this parent session and folder');return job;};
 function host(ctx){
  const key=scope(ctx);if(!hosts.has(key))hosts.set(key,(createHost||createWorkerHost)({parent,parentSessionId:ctx.sessionId,cwd:ctx.cwd,...options}));return hosts.get(key);
 }
 const conversationScope=j=>JSON.stringify([j.scope,j.conversationId]);
 function cancelConversation(j,error=fail('CANCELLED','Conversation cancelled by parent',true)){
  closedConversations.add(conversationScope(j));
  for(const item of jobs.values())if(item.scope===j.scope&&item.conversationId===j.conversationId&&item.status==='running'){
   item.status='cancelled';item.error=error;item.controller.abort();
  }
  hosts.get(j.scope)?.closeConversation(j.conversationId);
 }
 async function execute(name,args,ctx){
  if(closed||process.env.HARNESS_BRIDGE_DEPTH)throw new Error('Bridge is unavailable in this worker or closed session');
  if(!ctx?.sessionId||!path.isAbsolute(ctx.cwd||''))throw new Error('Parent session identity and absolute project directory are required');
  if(closedSessions.has(scope(ctx)))throw new Error('Bridge session is closed');
  if(name==='bridge_routes')return call(['routes','--parent',parent],ctx.cwd,options);
  if(name==='bridge_status')return view(own(args.jobId,ctx));
  if(name==='bridge_cancel'){const j=own(args.jobId,ctx);cancelConversation(j);return view(j);}
  let prior;
  if(name==='bridge_message'){
   prior=own(args.jobId,ctx);
   if(closedConversations.has(conversationScope(prior))||['failed','cancelled'].includes(prior.status))throw new Error('This conversation failed or was cancelled. Inspect its outcome before starting new work.');
   if(typeof args.message!=='string'||!args.message.trim())throw new Error('A message is required');
   args={route:prior.route,task:args.message,worker:prior.worker,model:prior.model};
  }else if(name!=='bridge_delegate')throw new Error('Unknown Bridge tool');
  if(typeof args.route!=='string'||!args.route||typeof args.task!=='string'||!args.task.trim()||args.task.length>100000)throw new Error('A valid route and a complete task are required');
  const key=JSON.stringify([scope(ctx),prior?.conversationId||'',args.route,args.task,args.worker||'',args.model||'']);
  const existing=[...jobs.values()].find(j=>j.key===key&&(j.status==='running'||j.status==='failed'&&Date.now()-j.finishedAt<60000));
  if(existing)return {...view(existing),reused:true,...(existing.status==='failed'?{retryAfterMs:Math.max(0,60000-(Date.now()-existing.finishedAt))}:{})};
  if([...jobs.values()].filter(j=>j.status==='running').length>=4)throw new Error('Four background jobs are running. Wait for completion.');
  for(const [id,j] of jobs){if(jobs.size<64)break;if(j.status!=='running')jobs.delete(id);}
  const conversationId=prior?.conversationId||randomUUID();
  const busy=[...jobs.values()].some(j=>j.scope===scope(ctx)&&j.conversationId===conversationId&&j.status==='running');
  const j={id:randomUUID(),conversationId,scope:scope(ctx),key,route:args.route,worker:args.worker,model:args.model,delivery:busy?'queued':'started',status:'running',controller:new AbortController(),ctx:{...ctx}};jobs.set(j.id,j);
  const run=()=>{
   // Lifecycle events can close a scope between admission and this microtask.
   // Never spawn a new host after the closing pass has already finished.
   if(closed||closedSessions.has(j.scope)||closedConversations.has(conversationScope(j))||j.controller.signal.aborted)throw fail('CANCELLED','Parent or worker conversation closed before dispatch');
   // Older callers can inject the one-shot transport for tests. Production always retains a worker host.
   if(call!==callBridge&&!createHost){
    const cmd=['delegate','--parent',parent,'--route',args.route,'--workspace',ctx.cwd,'--parent-workspace',ctx.cwd,'--task',args.task];
    if(args.worker)cmd.push('--worker',args.worker);if(args.model)cmd.push('--model',args.model);
    return call(cmd,ctx.cwd,{...options,signal:j.controller.signal});
   }
   return host(ctx).run({conversationId,routeId:args.route,task:args.task,worker:args.worker,model:args.model},{signal:j.controller.signal,onEvent:event=>{if(j.status==='running'&&event.type==='worker.prompt_started'){j.delivery='started';j.progress={phase:'working',sessionId:event.sessionId};}}});
  };
  void Promise.resolve().then(run).then(result=>{if(j.status==='running'){j.status='completed';j.result=result;}},error=>{if(j.status==='running'){j.status='failed';j.error=error?.code?error:fail('EXECUTION_ERROR','Background execution failed',true);cancelConversation(j,fail('CANCELLED','Conversation stopped after a worker failure',true));}}).then(async()=>{
   j.finishedAt=Date.now();if(closed||closedSessions.has(j.scope)||j.status==='cancelled')return;
   try{await notify(view(j),j.ctx);}catch{j.deliveryError=fail('DELIVERY_FAILED','The parent could not accept the result. Use bridge_status to recover it.');}
  });
  return {...view(j),message:busy?'Message queued for the next turn in the same worker conversation. The active turn continues.':'Started in background. Continue independent work; completion arrives automatically.'};
 }
 function closeSession(ctx){closedSessions.add(scope(ctx));for(const j of jobs.values())if(j.scope===scope(ctx)&&j.status==='running')cancelConversation(j);void hosts.get(scope(ctx))?.close();hosts.delete(scope(ctx));}
 return {execute,closeSession,close(){closed=true;for(const j of jobs.values())if(j.status==='running'){j.status='cancelled';j.controller.abort();}return Promise.allSettled([...hosts.values()].map(h=>h.close()));},get activeCount(){return [...jobs.values()].filter(j=>j.status==='running').length;}};
}
