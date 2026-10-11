import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {root,home} from '../core.mjs';
const failure=(code,reason,outcomeUnknown=true)=>({code,reason,stage:'worker-host',retryable:false,attempts:0,outcomeUnknown,nextAction:outcomeUnknown?'Inspect the worker conversation and workspace; no turn was automatically replayed.':'Reconnect this parent integration.'});
export function createWorkerHost({parent,parentSessionId,cwd,node=process.execPath,bridgeRoot=root,bridgeHome=home}){
 if(!parentSessionId||!path.isAbsolute(cwd||''))throw new Error('Parent session ID and absolute workspace are required');
 const child=spawn(node,[path.join(bridgeRoot,'lib/runtime/worker-host.mjs')],{cwd,env:{...process.env,HARNESS_BRIDGE_HOME:bridgeHome},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const pending=new Map();let closed=false,closing,resolveReady,rejectReady,exited=false,killTimer;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
 const startup=setTimeout(()=>fail(failure('HOST_STARTUP_TIMEOUT','Worker host did not initialize',false)),10000);
 function fail(error){clearTimeout(startup);closed=true;rejectReady(error);for(const entry of pending.values())entry.finish(error);pending.clear();if(!exited){child.kill('SIGTERM');if(!killTimer){killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);killTimer.unref();}}}
 function send(message){if(closed||!child.connected)throw failure('HOST_CLOSED','Worker host is closed');child.send(message,error=>{if(error)fail(failure('HOST_DISCONNECTED','Worker host IPC disconnected'));});}
 child.on('error',()=>fail(failure('HOST_UNAVAILABLE','Cannot launch the worker host',false)));
 child.on('close',()=>{exited=true;clearTimeout(killTimer);fail(failure('HOST_DISCONNECTED','Worker host stopped; retained worker context is unavailable'));});
 child.on('message',message=>{
  if(message.type==='ready'){clearTimeout(startup);resolveReady();return;}
  if(message.type==='event'){try{pending.get(message.requestId)?.onEvent?.(message.event);}catch{}return;}
  if(message.type==='result'){const entry=pending.get(message.requestId);if(entry)entry.finish(message.error,message.result);}
 });
 child.once('spawn',()=>{try{send({type:'init',parent,parentSessionId,cwd});}catch(error){fail(error);}});
 return {
  async run(params,{signal,timeout=430000,onEvent}={}){
   if(signal?.aborted)throw failure('CANCELLED','Worker message cancelled before admission',false);
   await ready;if(closed)throw failure('HOST_CLOSED','Worker host is closed');
   if(signal?.aborted)throw failure('CANCELLED','Worker message cancelled before admission',false);
   return new Promise((resolve,reject)=>{
    const requestId=randomUUID();let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(requestId);error?reject(error):resolve(result);};
    const cancel=error=>{try{send({type:'cancel',requestId});}catch{}finish(error);};
    const abort=()=>cancel(failure('CANCELLED','Worker message cancelled'));
    const timer=setTimeout(()=>cancel(failure('TIMEOUT','Queued worker message exceeded its deadline')),timeout);
    pending.set(requestId,{finish,onEvent});signal?.addEventListener('abort',abort,{once:true});
    try{send({type:'run',requestId,params});}catch(error){finish(error);}
   });
  },
  closeConversation(conversationId){if(!closed)send({type:'closeConversation',conversationId});},
  async close(){
   if(closing)return closing;
   closing=new Promise(resolve=>{
    if(exited){resolve();return;}
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);
    child.once('close',()=>{clearTimeout(timer);resolve();});
    try{send({type:'shutdown'});}catch{child.kill('SIGTERM');}
    closed=true;clearTimeout(startup);rejectReady(failure('HOST_CLOSED','Worker host closed',false));
    for(const entry of pending.values())entry.finish(failure('CANCELLED','Parent closed the worker host'));pending.clear();
   });return closing;
  }
 };
}
