import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,rm,stat,realpath} from 'node:fs/promises';
import {agents,detect,run,currentModel,load} from './core.mjs';
import {RPC} from './rpc.mjs';
import {openAcpxWorker} from './runtime/acpx.mjs';
import {deepseekLaunch} from './deepseek.mjs';
import {AgentError,DelegationError} from './errors.mjs';
export const DELEGATION_LIMITS=Object.freeze({startup:60000,prompt:180000,total:200000,request:30000,retryDelay:1000});
function remaining(deadline,maximum){const time=Math.min(maximum,deadline-Date.now());if(time<=0)throw new AgentError('TIMEOUT');return time;}
export function flatten(options=[],group=''){return options.flatMap(o=>o.options?flatten(o.options,o.name||o.group||group):o.value?[{id:o.value,name:(o.name||o.value)+(group?` · ${group}`:'')}]:[]);}
async function acp(agent,cwd,{deadline=Date.now()+60000,request=30000}={}){
 const launch=agent.id==='deepseek'?await deepseekLaunch(agent.args):{args:agent.args,cleanup:async()=>{}};
 const rpc=new RPC(agent.adapterPath,launch.args,{cwd,env:{...process.env,HARNESS_BRIDGE_DEPTH:'1',...(agent.id==='codex'?{CODEX_PATH:agent.executable}:{})}});
 const close=rpc.close.bind(rpc);rpc.close=()=>{close();void launch.cleanup().catch(()=>{});};
 try{const init=await rpc.call('initialize',{protocolVersion:1,clientInfo:{name:'harness-bridge',version:'0.1.0'},clientCapabilities:{}},remaining(deadline,request));if(init.protocolVersion!==1)throw new AgentError('PROTOCOL_ERROR');const session=await rpc.call('session/new',{cwd,mcpServers:[]},remaining(deadline,request));return {rpc,session,init};}catch(e){rpc.close();throw e;}
}
export async function probe(id){
 const agent=(await detect()).find(a=>a.id===id);if(!agent?.installed)throw new Error('Harness not found on PATH');
 const current=await currentModel(id);
 if(id==='pi'){
  const text=await run(agent.executable,['--list-models']);
  const models=text.split('\n').map(l=>l.trim().split(/\s+/)).filter(a=>a.length>=4&&a[0]!=='provider'&&/\d/.test(a[2])).map(a=>({id:`${a[0]}/${a[1]}`,name:`${a[1]} · ${a[0]}`}));
  return {models,currentModel:current,source:'Pi CLI provider catalog',verified:false};
 }
 if(id==='codex'){
  const rpc=new RPC(agent.executable,['app-server']);
  try{await rpc.call('initialize',{clientInfo:{name:'harness_bridge',version:'0.1.0'}});rpc.send({method:'initialized',params:{}});let cursor;const models=[];
   do{const r=await rpc.call('model/list',{includeHidden:false,...(cursor?{cursor}:{})});for(const m of r.data||[])models.push({id:m.model||m.id,name:m.displayName||m.model||m.id,reasoning:(m.supportedReasoningEfforts||[]).map(x=>x.reasoningEffort)});cursor=r.nextCursor;}while(cursor&&models.length<2000);
   return {models,currentModel:current,source:'Codex app-server catalog (may be cached)',verified:false};
  }finally{rpc.close();}
 }
 if(agent.acpReady){
  const cwd=await mkdtemp(path.join(tmpdir(),'harness-catalog-'));let connection;
  try{connection=await acp(agent,cwd);const s=connection.session;const option=s.configOptions?.find(o=>o.category==='model'||o.id==='model');let models=flatten(option?.options);if(!models.length)models=(s.models?.availableModels||[]).map(m=>({id:m.modelId,name:m.name}));
   return {models,currentModel:option?.currentValue||s.models?.currentModelId||current,source:'ACP session model catalog',configOptions:(s.configOptions||[]).filter(o=>o.category!=='model'),verified:false};
  }finally{connection?.rpc.close();await rm(cwd,{recursive:true,force:true});}
 }
 return {models:current?[{id:current,name:current}]:[],currentModel:current,source:'Configured model only',error:`Install ${agent.adapter} on PATH to discover its ACP catalog. No model IDs were invented.`,verified:false};
}
export async function resolveWorkspace(selected,requested,inheritWorkspace=true){
 requested=requested||selected;
 if(inheritWorkspace&&(!selected||!path.isAbsolute(selected)))throw new Error('Select and save a project folder before delegating');
 if(!requested||!path.isAbsolute(requested)||!(await stat(requested)).isDirectory())throw new Error('Existing absolute workspace required');
 const actual=await realpath(requested);
 if(!inheritWorkspace)return actual;
 const expected=await realpath(selected);
 if(actual!==expected)throw new Error('Delegation workspace does not match the selected project folder');
 return actual;
}
// Choice lists are alternatives for one delegation, never a fan-out request.
export function availableWorkers(route,parent,inventory){
 return inventory.filter(a=>a.acpReady&&(route.workers.length?route.workers.includes(a.id):a.id!==parent));
}
export function selectRoute(route,{parent,worker,model},inventory){
 if(!agents.some(a=>a.id===parent)||(route.parents.length&&!route.parents.includes(parent)))throw new Error('Route does not allow this parent');
 if(worker!==undefined&&(typeof worker!=='string'||!worker))throw new Error('Invalid selected worker');
 if(model!==undefined&&typeof model!=='string')throw new Error('Invalid selected model');
 const choices=availableWorkers(route,parent,inventory);
 if(worker&&route.workers.length&&!route.workers.includes(worker))throw new Error('Selected worker is not allowed by this route');
 if(worker&&!choices.some(a=>a.id===worker))throw new Error('Selected worker is not available for this route; check its ACP adapter');
 if(!worker&&choices.length>1)throw new Error(`Choose one worker with --worker: ${choices.map(a=>a.id).join(', ')}. Multiple choices are alternatives, not parallel execution.`);
 const agent=choices.find(a=>a.id===worker)||choices[0];
 if(!agent)throw new Error('No ACP-ready worker is available for this route');
 const models=route.models.filter(m=>m.worker===agent.id).map(m=>m.id);
 if(model&&!models.includes(model))throw new Error('Selected model is not allowed by this route; Auto uses the harness default');
 if(!model&&models.length>1)throw new Error(`Choose one model for ${agent.id} with --model: ${models.join(', ')}`);
 return {agent,model:model||models[0]||'',reasoning:route.reasoningByWorker?.[agent.id]??route.reasoning};
}
export async function describeRoutes(parent){
 const [config,inventory]=await Promise.all([load(),detect()]);
 return config.routes.filter(r=>!parent||!r.parents.length||r.parents.includes(parent)).map(r=>{
  const workers=availableWorkers(r,parent,inventory).map(a=>({id:a.id,name:a.name,reasoning:r.reasoningByWorker?.[a.id]??r.reasoning,models:r.models.filter(m=>m.worker===a.id).map(m=>m.id)}));
  return {...r,availableWorkers:workers,instruction:`${r.usage==='should'?'Required: for a matching task, delegate using this rule. If unavailable or unsuccessful, report the task blocked; do not silently do it yourself or substitute another worker.':'Optional: you may use this rule when helpful.'} When ${r.parents.length?r.parents.join(', '):'any parent harness'} needs ${r.task.toLowerCase()==='auto'?'any task':r.task}, delegate to one of ${r.workers.length?r.workers.join(', '):'the available ACP-ready harnesses other than the initiating parent'}. ${r.models.length?'Allowed models: '+r.models.map(m=>m.worker+'/'+m.id).join(', ')+'. For a worker without selected models, use its harness default.':'Model Auto: use the selected harness default model.'} Thinking: ${Object.keys(r.reasoningByWorker||{}).length?workers.map(w=>w.id+' = '+(w.reasoning||'harness default')).join('; '):r.reasoning||'harness default'}. Select exactly one worker and, when multiple models are offered for it, one model; pass --worker and --model. Never fan out automatically. If delegation fails, report the structured failure; never automatically repeat a submitted task.`};
 });
}
export async function delegate({routeId,parent,workspace,parentWorkspace,task,worker,model},{limits:requestedLimits={},conversation}={}){
 const limits=Object.fromEntries(Object.entries(DELEGATION_LIMITS).map(([key,max])=>[key,Math.max(1,Math.min(max,Number(requestedLimits[key])||max))]));
 const deadline=Date.now()+limits.total;let stage='validation',attempts=0,submitted=false,activeRPC,agent,retain=false;
 try{
  if(conversation?.invalid)throw new Error('This worker conversation is closed after a failure or cancellation; start a new conversation only after inspecting its outcome');
  if(process.env.HARNESS_BRIDGE_DEPTH)throw new Error('Recursive delegation blocked');
  if(typeof task!=='string'||!task.trim()||task.length>100000)throw new Error('Provide a task under 100,000 characters');
  const config=await load(),route=config.routes.find(r=>r.id===routeId&&r.enabled);
  if(!route)throw new Error('Enabled route not found');
  const selection=selectRoute(route,{parent,worker,model},await detect());
  agent=selection.agent;model=selection.model;const reasoning=selection.reasoning;
  workspace=await resolveWorkspace(parentWorkspace||workspace||config.workspace,workspace||parentWorkspace,true);
  const signature=JSON.stringify([parent,workspace,route.id,agent.id,model,reasoning]);
  if(conversation?.signature&&conversation.signature!==signature)throw new Error('The worker conversation configuration changed; start a new conversation instead of replacing its session');
  const startupDeadline=Math.min(deadline,Date.now()+limits.startup);
  for(attempts=1;attempts<=2;attempts++){
   try{
    stage='startup';
    let connection=conversation?.connection;
    const reused=!!connection;
    if(!connection){
     const launch=agent.id==='deepseek'?await deepseekLaunch(agent.args):{args:agent.args,cleanup:async()=>{}};
     connection=await openAcpxWorker(agent,workspace,{...launch,deadline:startupDeadline,request:limits.request,persistent:!!conversation,onProgress:event=>conversation?.onProgress?.(event),onClient:rpc=>{if(conversation){conversation.activeRPC=rpc;if(conversation.cancelRequested)void rpc.close();}}});
    }
    const {rpc,session}=connection;activeRPC=rpc;
    if(conversation)conversation.activeRPC=rpc;
    let opts=session.configOptions||[];const modelOption=opts.find(o=>o.category==='model'||o.id==='model');
    stage='model';
    if(model&&!reused){
     if(modelOption){if(!flatten(modelOption.options).some(m=>m.id===model))throw new AgentError('MODEL_UNAVAILABLE');const changed=await rpc.call('session/set_config_option',{sessionId:session.sessionId,configId:modelOption.id,value:model},remaining(startupDeadline,limits.request));opts=changed.configOptions||opts;}
     else if(session.models){if(!session.models.availableModels.some(m=>m.modelId===model))throw new AgentError('MODEL_UNAVAILABLE');await rpc.call('session/set_model',{sessionId:session.sessionId,modelId:model},remaining(startupDeadline,limits.request));}
     else throw new AgentError('CONFIGURATION_ERROR');
    }
    stage='thinking';
    if(!reused&&reasoning&&!['default','inherit'].includes(reasoning)){
     const option=opts.find(o=>/reason|think|effort/i.test(o.id+' '+o.name));
     if(!option||!flatten(option.options).some(v=>v.id===reasoning))throw new AgentError('CONFIGURATION_ERROR');
     await rpc.call('session/set_config_option',{sessionId:session.sessionId,configId:option.id,value:reasoning},remaining(startupDeadline,limits.request));
    }
    if(conversation?.cancelRequested)throw new AgentError('CANCELLED');
    rpc.text='';rpc.updates=[];stage='prompt';
    const promptTime=remaining(deadline,limits.prompt);
    // Once written to the worker, the task could edit files even without a response.
    submitted=true;
    const result=await rpc.call('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:task}]},promptTime);
    if(rpc.permissionCancelled)throw new AgentError('PERMISSION_CANCELLED');
    if(result.stopReason!=='end_turn')throw new AgentError(result.stopReason==='refusal'?'WORKER_REFUSED':result.stopReason==='cancelled'?'CANCELLED':'WORKER_ERROR');
    if(!rpc.text.trim())throw new AgentError('EMPTY_RESPONSE');
    if(conversation){conversation.connection=connection;conversation.signature=signature;retain=true;}
    return {routeId,worker:agent.id,model:model||'harness default',sessionId:session.sessionId,text:rpc.text,stopReason:result.stopReason};
   }catch(error){
    if(activeRPC?.permissionCancelled)error=new AgentError('PERMISSION_CANCELLED');
    const failure=new DelegationError(error,{stage,worker:agent.id,attempts,outcomeUnknown:submitted});
    if(!submitted&&!conversation?.connection&&!conversation?.cancelRequested&&failure.failure.retryable&&attempts===1){
     const wait=failure.failure.code==='RATE_LIMITED'?Math.max(limits.retryDelay,30000):limits.retryDelay;
     if(Date.now()+wait<startupDeadline){
      await activeRPC?.close();activeRPC=undefined;
      await new Promise(resolve=>setTimeout(resolve,wait));
      continue;
     }
    }
    throw failure;
   }finally{if(!retain)await activeRPC?.close();activeRPC=undefined;if(conversation)conversation.activeRPC=undefined;}
  }
 }catch(error){
  if(conversation){conversation.invalid=true;await conversation.connection?.rpc.close();conversation.connection=undefined;}
  if(error instanceof DelegationError)throw error;
  // Validation messages below originate inside Bridge, not from external agents.
  const message=String(error?.message||'');let localReason;
  if(message.startsWith('Choose one model'))localReason='Choose one model from this rule before delegating.';
  else if(message.startsWith('Choose one worker'))localReason='Choose one worker from this rule before delegating.';
  else if(['This worker conversation is closed after a failure or cancellation; start a new conversation only after inspecting its outcome','The worker conversation configuration changed; start a new conversation instead of replacing its session','Recursive delegation blocked','Provide a task under 100,000 characters','Enabled route not found','Route does not allow this parent','Delegation workspace does not match the selected project folder','Existing absolute workspace required','Select and save a project folder before delegating','Selected worker is not allowed by this route','Selected model is not allowed by this route; Auto uses the harness default'].includes(message))localReason=message;
  const unavailable=/No ACP-ready worker|Selected worker is not available/.test(message);
  throw new DelegationError(new AgentError(unavailable?'WORKER_UNAVAILABLE':'CONFIGURATION_ERROR'),{stage,worker:agent?.id||worker||null,attempts,outcomeUnknown:submitted,localReason});
 }finally{if(!retain)await activeRPC?.close();}
}
