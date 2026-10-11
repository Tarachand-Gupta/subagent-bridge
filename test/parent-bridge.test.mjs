import test from 'node:test';
import assert from 'node:assert/strict';
import {createParentBridge} from '../lib/parent-bridge.mjs';
import {selectCompatibility,parseVersion} from '../lib/compatibility.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('background parent tools return immediately and route completion to exact session and folder',async()=>{
 let finish;const notifications=[];const calls=[];
 const b=createParentBridge({parent:'opencode',notify:(v,c)=>notifications.push([v,c]),call:(args,cwd)=>{calls.push({args,cwd});return new Promise(r=>finish=r);}});
 const ctx={sessionId:'parent-A',cwd:'/tmp/project'};
 const job=await b.execute('bridge_delegate',{route:'rule',task:'research'},ctx);
 assert.equal(job.status,'running');await tick();
 assert.equal(calls[0].cwd,ctx.cwd);assert.ok(calls[0].args.includes('--parent-workspace'));
 assert.equal((await b.execute('bridge_delegate',{route:'rule',task:'research'},ctx)).jobId,job.jobId);
 await assert.rejects(b.execute('bridge_status',{jobId:job.jobId},{...ctx,sessionId:'parent-B'}));
 finish({text:'result'});await tick();assert.equal(notifications.length,1);assert.deepEqual(notifications[0][1],ctx);
 assert.equal((await b.execute('bridge_status',{jobId:job.jobId},ctx)).status,'completed');b.close();
});
test('cancel and closed parent sessions never receive stale completions',async()=>{
 let finish;const notifications=[];const b=createParentBridge({parent:'codex',notify:v=>notifications.push(v),call:()=>new Promise(r=>finish=r)});
 const ctx={sessionId:'one',cwd:'/tmp/a'};const job=await b.execute('bridge_delegate',{route:'x',task:'x'},ctx);await tick();
 await b.execute('bridge_cancel',{jobId:job.jobId},ctx);finish({text:'late'});await tick();assert.equal(notifications.length,0);assert.equal(b.activeCount,0);b.close();
});
test('completion delivery failure stays recoverable without replaying work',async()=>{
 let count=0;const b=createParentBridge({parent:'codex',notify:()=>{throw new Error('offline');},call:async()=>{count++;return {text:'finished'};}});
 const ctx={sessionId:'one',cwd:'/tmp/a'};const j=await b.execute('bridge_delegate',{route:'x',task:'x'},ctx);await tick();
 const result=await b.execute('bridge_status',{jobId:j.jobId},ctx);assert.equal(result.status,'completed');assert.equal(result.deliveryError.code,'DELIVERY_FAILED');assert.equal(count,1);b.close();
});
test('version routing is explicit for majors and pre-release families; future versions cannot silently fall back',()=>{
 assert.equal(parseVersion('codex-cli 0.160.1'),'0.160.1');
 assert.equal(selectCompatibility('opencode','1.18.34').family,'v1');
 assert.equal(selectCompatibility('opencode','2.0.0').supported,false);
 assert.equal(selectCompatibility('opencode','1.19.0').verified,false);
 assert.equal(selectCompatibility('opencode','1.19.0-beta.1').supported,false);
 assert.equal(selectCompatibility('codex','0.161.0').supported,false);
 assert.equal(selectCompatibility('deepseek','0.2.0-rc.2').supported,true);
 assert.equal(selectCompatibility('deepseek','0.2.0-rc.3').supported,false);
 assert.equal(selectCompatibility('pi',null).supported,false);
});

test('closing an exact parent session suppresses queued delivery and rejects further launches',async()=>{
 let finish;const notifications=[];const b=createParentBridge({parent:'codex',notify:v=>notifications.push(v),call:()=>new Promise(r=>finish=r)});
 const ctx={sessionId:'closing',cwd:'/tmp/scope'};await b.execute('bridge_delegate',{route:'r',task:'x'},ctx);await tick();
 finish({text:'finished'});b.closeSession(ctx);await tick();assert.equal(notifications.length,0);
 await assert.rejects(b.execute('bridge_delegate',{route:'r',task:'next'},ctx),/closed/);b.close();
});
test('failed tasks retain structured unknown outcomes and cannot be silently replayed during cooldown',async()=>{
 let calls=0;const error={code:'TIMEOUT',reason:'deadline',outcomeUnknown:true,retryable:false};const b=createParentBridge({parent:'codex',notify:()=>{},call:async()=>{calls++;throw error;}});
 const ctx={sessionId:'one',cwd:'/tmp/scope'},args={route:'r',task:'x'};
 const first=await b.execute('bridge_delegate',args,ctx);await tick();const again=await b.execute('bridge_delegate',args,ctx);
 assert.equal(again.jobId,first.jobId);assert.deepEqual(again.error,error);assert.ok(again.retryAfterMs>0);assert.equal(calls,1);b.close();
});

test('messages reuse a scoped conversation and queued turns deliver exactly once',async()=>{
 const runs=[],notices=[];let closeCount=0;
 const b=createParentBridge({parent:'codex',createHost:()=>({run(params,options){return new Promise(resolve=>runs.push({params,options,resolve}));},closeConversation(){},close(){closeCount++;}}),notify:(job,ctx)=>notices.push({job,ctx})});
 const ctx={sessionId:'A',cwd:'/tmp/project'};
 const first=await b.execute('bridge_delegate',{route:'r',task:'remember'},ctx);await tick();
 runs[0].options.onEvent({type:'worker.prompt_started',sessionId:'actual-session'});
 assert.equal((await b.execute('bridge_status',{jobId:first.jobId},ctx)).progress.sessionId,'actual-session');
 const next=await b.execute('bridge_message',{jobId:first.jobId,message:'recall'},ctx);await tick();
 assert.equal(next.delivery,'queued');assert.equal(first.conversationId,next.conversationId);assert.equal(runs[0].params.conversationId,runs[1].params.conversationId);
 await assert.rejects(b.execute('bridge_message',{jobId:first.jobId,message:'steal'},{...ctx,sessionId:'B'}),/No such/);
 await assert.rejects(b.execute('bridge_message',{jobId:first.jobId,message:'steal'},{...ctx,cwd:'/tmp/other'}),/No such/);
 runs[0].resolve({sessionId:'actual-session',text:'ready'});runs[1].resolve({sessionId:'actual-session',text:'nonce'});await tick();assert.equal(notices.length,2);
 const last=await b.execute('bridge_message',{jobId:first.jobId,message:'recall again'},ctx);await tick();assert.equal(last.conversationId,first.conversationId);assert.equal(last.delivery,'started');runs[2].resolve({text:'nonce again'});await tick();assert.equal(notices.length,3);
 await b.close();assert.equal(closeCount,1);
});
test('conversation cancellation aborts queued messages and suppresses their delivery',async()=>{
 const runs=[],notices=[],closed=[];
 const b=createParentBridge({parent:'pi',createHost:()=>({run(params,options){return new Promise(resolve=>runs.push({params,options,resolve}));},closeConversation(id){closed.push(id);},close(){}}),notify:value=>notices.push(value)});
 const ctx={sessionId:'A',cwd:'/tmp/project'};const first=await b.execute('bridge_delegate',{route:'r',task:'one'},ctx);await tick();const next=await b.execute('bridge_message',{jobId:first.jobId,message:'two'},ctx);await tick();
 await b.execute('bridge_cancel',{jobId:next.jobId},ctx);assert.ok(runs.every(r=>r.options.signal.aborted));assert.equal(closed[0],first.conversationId);
 for(const run of runs)run.resolve({text:'late'});await tick();assert.equal(notices.length,0);assert.equal(b.activeCount,0);
 await assert.rejects(b.execute('bridge_message',{jobId:first.jobId,message:'three'},ctx),/cancelled/);await b.close();
});

test('closing before dispatch never creates a late persistent host',async()=>{
 for(const mode of ['parent','session']){
  let created=0;const b=createParentBridge({parent:'pi',createHost:()=>{created++;return{run:async()=>({text:'wrong'}),close(){},closeConversation(){}};}}),ctx={sessionId:'closing-'+mode,cwd:'/tmp/project'};
  const admission=b.execute('bridge_delegate',{route:'r',task:'must not start'},ctx);
  if(mode==='parent')await b.close();else b.closeSession(ctx);
  await admission;await tick();assert.equal(created,0);assert.equal(b.activeCount,0);await b.close();
 }
});
test('failed followup tombstones its whole conversation including older successful job IDs',async()=>{
 const pending=[],notices=[];const b=createParentBridge({parent:'opencode',createHost:()=>({run(params,options){return new Promise((resolve,reject)=>pending.push({params,options,resolve,reject}));},closeConversation(){},close(){}}),notify:n=>notices.push(n)}),ctx={sessionId:'owner',cwd:'/tmp/project'};
 const first=await b.execute('bridge_delegate',{route:'r',task:'first'},ctx);pending[0].resolve({text:'READY'});await tick();
 const next=await b.execute('bridge_message',{jobId:first.jobId,message:'second'},ctx);
 const queued=await b.execute('bridge_message',{jobId:first.jobId,message:'third'},ctx);
 pending[1].reject({code:'TIMEOUT',reason:'unknown result',outcomeUnknown:true});await tick();
 assert.equal(pending[2].options.signal.aborted,true);assert.equal((await b.execute('bridge_status',{jobId:queued.jobId},ctx)).status,'cancelled');
 await assert.rejects(b.execute('bridge_message',{jobId:first.jobId,message:'fourth'},ctx),/failed or was cancelled/);
 await assert.rejects(b.execute('bridge_message',{jobId:next.jobId,message:'fifth'},ctx),/failed or was cancelled/);
 pending[2].resolve({text:'late'});await tick();assert.equal(notices.length,2);assert.equal(notices[1].status,'failed');await b.close();
});
test('cancelling an idle conversation prevents reuse through its completed job ID',async()=>{
 const b=createParentBridge({parent:'pi',createHost:()=>({run:async()=>({text:'complete'}),closeConversation(){},close(){}})}),ctx={sessionId:'owner',cwd:'/tmp/project'};
 const first=await b.execute('bridge_delegate',{route:'r',task:'first'},ctx);await tick();await b.execute('bridge_cancel',{jobId:first.jobId},ctx);
 assert.equal((await b.execute('bridge_status',{jobId:first.jobId},ctx)).status,'completed');
 await assert.rejects(b.execute('bridge_message',{jobId:first.jobId,message:'again'},ctx),/failed or was cancelled/);await b.close();
});
