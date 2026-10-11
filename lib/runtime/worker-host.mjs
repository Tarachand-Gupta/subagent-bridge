// Owned IPC child: one parent identity, isolated persistent ACP conversations.
import {delegate} from '../agents.mjs';
import {closeActiveAcpx} from './acpx.mjs';
const conversations=new Map(),requests=new Map();let owner,closed=false;
const failure=(code,reason,outcomeUnknown=false)=>({code,reason,stage:'worker-host',retryable:false,attempts:0,outcomeUnknown,nextAction:outcomeUnknown?'Inspect the worker conversation and workspace; do not replay an uncertain turn.':'Correct the request or start a new conversation when appropriate.'});
const send=value=>{if(process.connected)process.send(value,()=>{});};
async function closeConversation(id){const entry=conversations.get(id);if(!entry)return;entry.state.invalid=true;entry.state.cancelRequested=true;await (entry.state.activeRPC||entry.state.connection?.rpc)?.close();entry.state.connection=undefined;}
async function shutdown(){if(closed)return;closed=true;for(const request of requests.values())request.cancelled=true;await Promise.allSettled([...conversations.keys()].map(closeConversation));closeActiveAcpx();if(process.connected)process.disconnect();}
process.on('disconnect',()=>{void shutdown();});
process.on('SIGTERM',()=>{void shutdown();});process.on('SIGINT',()=>{void shutdown();});
process.on('message',message=>{
 if(closed||!message||typeof message!=='object')return;
 if(message.type==='init'){
  if(owner)return;owner={parent:message.parent,parentSessionId:message.parentSessionId,cwd:message.cwd};
  send({type:'ready'});return;
 }
 if(message.type==='shutdown'){void shutdown();return;}
 if(message.type==='closeConversation'){void closeConversation(message.conversationId);return;}
 if(message.type==='cancel'){
  const request=requests.get(message.requestId);if(!request)return;request.cancelled=true;
  if(request.started)void closeConversation(request.conversationId);
  return;
 }
 if(message.type!=='run')return;
 const requestId=message.requestId,params=message.params||{},id=params.conversationId;
 const reply=error=>send({type:'result',requestId,error});
 if(!owner||!owner.parentSessionId||typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return reply(failure('INVALID_CONVERSATION','A parent-scoped worker conversation ID is required'));
 if(requests.has(requestId))return reply(failure('DUPLICATE_REQUEST','This worker turn is already admitted'));
 let entry=conversations.get(id);
 if(!entry){
  if(conversations.size>=32)return reply(failure('CONVERSATION_LIMIT','This parent already owns 32 worker conversations'));
  entry={state:{},chain:Promise.resolve(),pending:0};conversations.set(id,entry);
 }
 if(entry.pending>=8)return reply(failure('QUEUE_LIMIT','Eight messages are already queued for this worker'));
 const request={conversationId:id,started:false,cancelled:false};requests.set(requestId,request);entry.pending++;
 entry.chain=entry.chain.catch(()=>{}).then(async()=>{
  if(closed||request.cancelled)return reply(failure('CANCELLED','Queued worker message cancelled before dispatch'));
  request.started=true;entry.state.onProgress=event=>send({type:'event',requestId,event:{...event,conversationId:id}});
  try{
   const result=await delegate({routeId:params.routeId,parent:owner.parent,workspace:owner.cwd,parentWorkspace:owner.cwd,task:params.task,worker:params.worker,model:params.model},{conversation:entry.state});
   if(!request.cancelled&&!closed)send({type:'result',requestId,result:{...result,conversationId:id,continuity:'same ACP session',messageMode:'queued turns'}});
   else reply(failure('CANCELLED','Worker message cancelled',true));
  }catch(error){reply(error.failure||failure('WORKER_HOST_ERROR','Worker conversation failed',request.started));}
 }).finally(()=>{requests.delete(requestId);entry.pending--;});
});
