import {createInterface} from 'node:readline';
import {launch} from './core.mjs';
import {AgentError,classifyError} from './errors.mjs';
const active=new Set();
export function closeActiveRPCs(){for(const rpc of active)rpc.close();}
export class RPC{
 constructor(command,args,{cwd,env=process.env}={}){
  this.pending=new Map();this.seq=0;this.updates=[];this.text='';this.closed=false;this.terminalError=null;this.permissionCancelled=false;
  this.child=launch(command,args,{cwd,env,stdio:['pipe','pipe','ignore'],detached:process.platform!=='win32'});
  active.add(this);
  this.child.stdin.on('error',()=>{});
  this.lines=createInterface({input:this.child.stdout});
  this.lines.on('line',line=>{try{this.receive(JSON.parse(line));}catch{this.fail(new AgentError('PROTOCOL_ERROR'));}});
  this.child.on('error',e=>this.fail(classifyError(e)));this.child.on('close',(exitCode,signal)=>{active.delete(this);this.closed=true;this.fail(new AgentError('DISCONNECTED',{exitCode,signal}));});
 }
 send(value){if(this.closed||this.terminalError)throw this.terminalError||new AgentError('DISCONNECTED');this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');}
 receive(m){
  if(m.method){
   if(m.method==='session/update'){const u=m.params?.update;this.updates.push(u);if(u?.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text')this.text+=u.content.text;}
   if(m.id!==undefined){
    if(m.method==='session/request_permission'){this.permissionCancelled=true;this.send({id:m.id,result:{outcome:{outcome:'cancelled'}}});}
    else this.send({id:m.id,error:{code:-32601,message:'Client capability not available'}});
   }return;
  }
  const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(classifyError({message:m.error.message||'Agent request failed',code:m.error.code})):p.resolve(m.result);
 }
 call(method,params,timeout=30000){return new Promise((resolve,reject)=>{if(this.closed||this.terminalError)return reject(this.terminalError||new AgentError('DISCONNECTED'));const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new AgentError('TIMEOUT'));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(classifyError(error));}});}
 fail(e){this.terminalError=e;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
 close(){this.fail(new AgentError('CANCELLED'));this.child.stdin.end();const stop=signal=>{try{if(process.platform!=='win32')process.kill(-this.child.pid,signal);else this.child.kill(signal);}catch{}};stop('SIGTERM');const timer=setTimeout(()=>{if(!this.closed)stop('SIGKILL');},2000);timer.unref();this.lines.close();}
}
