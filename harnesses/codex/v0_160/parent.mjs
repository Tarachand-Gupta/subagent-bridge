import {spawn} from '../../../lib/process.mjs';
import {createInterface} from 'node:readline';
import {createParentBridge,ruleGuidance,completionText,toolSchemas} from '../../../lib/parent-bridge.mjs';

// This owns a dedicated app-server and thread. It must never attach to arbitrary app threads.
export async function runParent({executable,cwd,task,model,onEvent=()=>{},timeout=600000,signal,bridgeCall}){
 const child=spawn(executable,['app-server','--stdio'],{cwd,env:{...process.env,HARNESS_BRIDGE_MANAGED_PARENT:'1'},stdio:['pipe','pipe','ignore']});
 const pending=new Map();let seq=0,threadId,active=false,closed=false,starting=false,turns=0,activeTurnId,deliveries=0;
 const queue=[];let resolveDone,rejectDone;
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
 const bridge=createParentBridge({parent:'codex',...(bridgeCall?{call:bridgeCall}:{}),notify:deliverCompletion});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},60000);pending.set(id,{resolve,reject,timer,method});send({id,method,params});});
 const fatal=error=>{
  if(closed)return;closed=true;bridge.close();
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();
  rejectDone(error);child.kill('SIGTERM');
 };
 const lines=createInterface({input:child.stdout});child.stdin.on('error',fatal);child.on('error',fatal);child.on('close',()=>{if(!closed)fatal(new Error('Codex parent disconnected; background tasks cancelled.'));});
 async function request(m){
  if(m.method==='item/tool/call'){
   try{if(m.params.threadId!==threadId)throw new Error('Wrong parent thread');const value=await bridge.execute(m.params.tool,m.params.arguments,{sessionId:threadId,cwd});send({id:m.id,result:{success:true,contentItems:[{type:'inputText',text:JSON.stringify(value)}]}});onEvent({type:'tool.result',tool:m.params.tool,value});}
   catch(e){send({id:m.id,result:{success:false,contentItems:[{type:'inputText',text:JSON.stringify({error:e.message||e.reason})}]}});}return;
  }
  // No permission escalation or synthetic user answer in an unattended parent.
  if(m.method==='item/commandExecution/requestApproval'||m.method==='item/fileChange/requestApproval')send({id:m.id,result:{decision:'decline'}});
  else if(m.method==='item/permissions/requestApproval')send({id:m.id,result:{permissions:{},scope:'turn'}});
  else send({id:m.id,error:{code:-32601,message:'This Bridge client cannot answer interactive approval or input requests.'}});
 }
 lines.on('line',line=>{
  let m;try{m=JSON.parse(line);}catch{return fatal(new Error('Invalid Codex protocol response'));}
  if(m.method){
   if(m.id!==undefined){void request(m).catch(fatal);return;}
   if(m.params?.threadId&&threadId&&m.params.threadId!==threadId)return;
   if(m.method==='turn/started'){active=true;activeTurnId=m.params?.turn?.id;onEvent({type:'turn.started',turnId:m.params?.turn?.id});}
   if(m.method==='item/completed'&&m.params?.item?.type==='agentMessage')onEvent({type:'message',text:m.params.item.text});
   if(m.method==='turn/completed'){active=false;activeTurnId=undefined;onEvent({type:'turn.completed',status:m.params?.turn?.status});if(m.params?.turn?.status!=='completed')fatal(new Error('Codex parent turn failed. Check its provider configuration.'));else void pump().catch(fatal);}
  }else{const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);if(m.error){const error=new Error('Codex '+p.method+' request failed. Check the parent provider configuration.');error.undelivered=p.method==='turn/steer'&&/(?:expected.*turn.*(?:mismatch|does not match)|no active turn|turn.*not active)/i.test(String(m.error.message||''));p.reject(error);}else p.resolve(m.result);}
 });
 async function deliverCompletion(result){
  deliveries++;onEvent({type:'worker.completed',result});
  try{
   const text=completionText(result);
   if(active&&activeTurnId){
    try{
     await call('turn/steer',{threadId,expectedTurnId:activeTurnId,input:[{type:'text',text}]});
     onEvent({type:'completion.delivered',mode:'active-turn',jobId:result.jobId});return;
    }catch(error){
     // An explicit active-turn precondition rejection means the input was not admitted.
     // Transport errors/timeouts are ambiguous and must never replay the completion.
     if(!error.undelivered){fatal(error);throw error;}
    }
   }
   queue.push(text);
  }finally{deliveries--;await pump();}
 }
 async function pump(){
  if(closed||starting||active||!threadId)return;
  if(!queue.length){if(!bridge.activeCount&&!deliveries)resolveDone({threadId,turns});return;}
  if(++turns>20)throw new Error('Parent continuation limit reached; stopping to prevent a delegation loop.');
  starting=true;active=true;
  try{
   const text=queue.shift();const routes=await bridge.execute('bridge_routes',{}, {sessionId:threadId,cwd});
   await call('turn/start',{threadId,input:[{type:'text',text:'Current Harness Bridge rules (supersede earlier snapshots): '+JSON.stringify(routes)+'\n\n'+text}],...(model?{model}:{})});
  }finally{starting=false;}
  if(!active)await pump();
 }
 const deadline=setTimeout(()=>fatal(new Error('Codex parent deadline exceeded; inspect workspace before retrying.')),timeout);
 const abort=()=>fatal(new Error('Codex parent cancelled'));signal?.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)throw new Error('Codex parent cancelled');
  await call('initialize',{clientInfo:{name:'harness_bridge',version:'0.1.0'},capabilities:{experimentalApi:true}});send({method:'initialized'});
  const dynamicTools=Object.entries(toolSchemas).map(([name,s])=>({type:'function',name,description:s.description,inputSchema:{type:'object',properties:s.properties,required:s.required,additionalProperties:false}}));
  const started=await call('thread/start',{cwd,...(model?{model}:{}),ephemeral:true,developerInstructions:ruleGuidance,dynamicTools});
  threadId=started.thread.id;onEvent({type:'parent.started',threadId,cwd});queue.push(task);await pump();return await done;
 }finally{
  closed=true;clearTimeout(deadline);signal?.removeEventListener('abort',abort);await bridge.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Parent closed'));}pending.clear();lines.close();child.stdin.end();
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{
   const kill=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);
   child.once('close',()=>{clearTimeout(kill);resolve();});child.kill('SIGTERM');
  });
 }
}
