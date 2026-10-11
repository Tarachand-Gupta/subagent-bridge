// Pinned acpx owns protocol framing, sessions, controls, events and process cleanup.
// Bridge retains route policy and its conservative no-replay failure contract.
import {createAcpRuntime,createAgentRegistry} from 'acpx/runtime';
import {randomUUID} from 'node:crypto';
import {AgentError,classifyError} from '../errors.mjs';
const active=new Set();
export function closeActiveAcpx(){for(const client of active)void client.close();}
function externalError(error,exit){
 for(let next=error;next;next=next.cause){
  if(next.code==='ACP_MODEL_UNSUPPORTED')return new AgentError('MODEL_UNAVAILABLE');
  const classified=classifyError(next);
  if(classified.code!=='WORKER_ERROR')return classified.code==='DISCONNECTED'&&exit?new AgentError('DISCONNECTED',{exitCode:exit.exitCode,signal:exit.signal}):classified;
 }
 if(exit)return new AgentError('DISCONNECTED',{exitCode:exit.exitCode,signal:exit.signal});
 return new AgentError('WORKER_ERROR');
}
export async function openAcpxWorker(agent,cwd,{args=agent.args,deadline=Date.now()+60000,request=30000,cleanup=async()=>{},persistent=false,onClient,onProgress,maxOutputBytes=8000000}={}){
 const records=new Map();let handle,lastExit,closing,spawned=false;
 const runtime=createAcpRuntime({
  cwd,agentRegistry:createAgentRegistry({overrides:{[agent.id]:[agent.adapterPath,...args]}}),
  sessionStore:{async load(id){return records.get(id);},async save(record){records.set(record.acpxRecordId,record);}},
  agentProcessEnv:{HARNESS_BRIDGE_DEPTH:'1',...(agent.id==='codex'?{CODEX_PATH:agent.executable}:{})},
  permissionMode:'deny-all',nonInteractivePermissions:'deny',fs:false,terminal:false,
  timeoutMs:Math.max(1,Math.min(request,deadline-Date.now())),
  onPermissionRequest:async()=>{client.permissionCancelled=true;return {outcome:'cancel'};},
  processLifecycle:{onBeforeSpawn(){if(persistent&&spawned)throw new AgentError('DISCONNECTED');},onSpawned(){spawned=true;},onExit(exit){lastExit=exit;}}
 });
 async function bounded(operation,timeout){
  let timer;
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{void runtime.shutdown().catch(()=>{});reject(new AgentError('TIMEOUT'));},Math.max(1,timeout));})]);}
  finally{clearTimeout(timer);}
 }
 const client={
  text:'',updates:[],permissionCancelled:false,
  async close(){if(!closing){closing=runtime.shutdown().finally(async()=>{active.delete(client);await cleanup();});}return closing;},
  async call(method,params,timeoutMs){
   try{
    if(method==='session/set_model'){await bounded(runtime.setModel({handle,model:params.modelId}),timeoutMs);return {};}
    if(method==='session/set_config_option')return await bounded(runtime.setConfigOption({handle,key:params.configId,value:params.value}),timeoutMs);
    if(method!=='session/prompt')throw new AgentError('PROTOCOL_ERROR');
    // A retained conversation must not silently reconnect into a fresh backend session.
    if(persistent&&lastExit)throw new AgentError('DISCONNECTED',{exitCode:lastExit.exitCode,signal:lastExit.signal});
    const turn=runtime.startTurn({handle,text:params.prompt.map(p=>p.text||'').join('\n'),requestId:randomUUID(),mode:'prompt',timeoutMs});
    turn.promptStarted.then(()=>{try{onProgress?.({type:'worker.prompt_started',sessionId:handle.backendSessionId});}catch{}},()=>{});
    let outputBytes=0;
    for await(const event of turn.events){
     if(event.type==='text_delta'&&event.stream!=='thought'){
      outputBytes+=Buffer.byteLength(event.text,'utf8');
      if(outputBytes>Math.max(1,Math.min(8000000,maxOutputBytes))){void client.close().catch(()=>{});throw new AgentError('OUTPUT_LIMIT');}
      client.text+=event.text;
     }
     // Avoid retaining provider payloads or chain-of-thought in Bridge state.
    }
    const result=await turn.result;
    if(client.permissionCancelled)throw new AgentError('PERMISSION_CANCELLED');
    if(result.status==='failed')throw externalError(result.error,lastExit);
    return {stopReason:result.stopReason||(result.status==='cancelled'?'cancelled':'end_turn')};
   }catch(error){throw externalError(error,lastExit);}
  }
 };
 active.add(client);onClient?.(client);
 try{
  handle=await bounded(runtime.ensureSession({sessionKey:randomUUID(),agent:agent.id,mode:persistent?'persistent':'oneshot'}),deadline-Date.now());
  const record=records.get(handle.acpxRecordId);
  return {rpc:client,session:{sessionId:handle.backendSessionId,configOptions:record?.acpx?.config_options||[],models:record?.acpx?.available_models?{currentModelId:record.acpx.current_model_id,availableModels:record.acpx.available_models.map(modelId=>({modelId,name:record.acpx.available_model_names?.[modelId]||modelId}))}:undefined}};
 }catch(error){await client.close();throw externalError(error,lastExit);}
}
