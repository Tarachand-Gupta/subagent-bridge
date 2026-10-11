import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const directory=await mkdtemp(path.join(tmpdir(),'bridge-pi-test-'));
process.env.PI_CODING_AGENT_DIR=path.join(directory,'pi');
process.env.HARNESS_BRIDGE_HOME=path.join(directory,'bridge');
const {installPiIntegration,piIntegrationStatus}=await import('../lib/pi-integration.mjs');
const {mountPiIntegration}=await import('../harnesses/pi/v1/plugin.mjs');
test('Pi connection installs managed loader, is idempotent, and preserves unrelated files',async()=>{
 assert.equal((await piIntegrationStatus()).installed,false);
 const result=await installPiIntegration();assert.equal(result.reloadRequired,true);
 assert.equal(result.path,path.join(directory,'pi/extensions/harness-bridge.ts'));assert.equal((await piIntegrationStatus()).current,true);
 const source=await readFile(result.path,'utf8');assert.match(source,/mountPiIntegration/);assert.match(source,/version: VERSION/);assert.match(source,/bridgeOptions/);
 assert.equal(await readFile((await installPiIntegration()).path,'utf8'),source);
 await writeFile(result.path,'// unrelated extension');await assert.rejects(installPiIntegration(),/unrelated Pi extension/);assert.equal(await readFile(result.path,'utf8'),'// unrelated extension');
 await rm(result.path);const other=path.join(directory,'other');await writeFile(other,'original');await symlink(other,result.path);await assert.rejects(installPiIntegration(),/unrelated Pi extension/);assert.equal(await readFile(other,'utf8'),'original');
});
function mockRuntime(version='1.1.0'){
 const tools=new Map(),handlers=new Map(),calls=[],notifications=[],pending=[],hosts=[];
 let saved=[{id:'first',parents:['pi'],enabled:true,usage:'should'}];
 const integration=mountPiIntegration({registerTool(t){tools.set(t.name,t);},on(e,h){handlers.set(e,h);},sendMessage(m,o){notifications.push({m,o});}},
  {Type:{Object:v=>v,Unsafe:v=>v,Optional:v=>v},version,bridgeOptions:{
   call:async(args,cwd)=>{calls.push({args,cwd});return saved;},
   createHost(options){const host={options,closed:false,cancelled:[],run(args,{signal}){return new Promise((resolve,reject)=>pending.push({args,options,signal,resolve,reject}));},closeConversation(id){host.cancelled.push(id);},async close(){host.closed=true;}};hosts.push(host);return host;}
  }});
 const context=(id='one',cwd='/projects/'+id)=>({cwd,sessionManager:{getSessionId:()=>id}});
 const execute=(name,params,ctx=context(),signal)=>tools.get(name).execute('call',params,signal,null,ctx);
 return{tools,handlers,calls,notifications,pending,hosts,context,execute,close:()=>integration?.close(),setRoutes:v=>saved=v};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('Pi returns immediately, preserves one conversation for queued and later messages, and wakes for each turn',async()=>{
 const m=mockRuntime();const job=(await m.execute('bridge_delegate',{route:'first',task:'Remember marker'})).details;
 assert.equal(job.status,'running');assert.ok(job.conversationId);assert.equal(m.pending.length,1);
 const duplicate=(await m.execute('bridge_delegate',{route:'first',task:'Remember marker'})).details;assert.equal(duplicate.jobId,job.jobId);assert.equal(duplicate.reused,true);
 const message=(await m.execute('bridge_message',{jobId:job.jobId,message:'Use the marker next'})).details;
 assert.equal(message.delivery,'queued');assert.equal(message.conversationId,job.conversationId);assert.notEqual(message.jobId,job.jobId);
 assert.equal(m.pending[0].options.cwd,'/projects/one');assert.equal(m.pending[0].options.parentSessionId,'one');assert.equal(m.pending[0].args.conversationId,m.pending[1].args.conversationId);
 m.pending[0].resolve({text:'remembered',sessionId:'worker-session'});await settle();m.pending[1].resolve({text:'marker result',sessionId:'worker-session'});await settle();
 assert.equal(m.notifications.length,2);assert.deepEqual(m.notifications[1].o,{triggerTurn:true,deliverAs:'followUp'});
 assert.equal((await m.execute('bridge_status',{jobId:message.jobId})).details.result.sessionId,'worker-session');
 const followup=(await m.execute('bridge_message',{jobId:message.jobId,message:'Recall again'})).details;assert.equal(followup.delivery,'started');assert.equal(followup.conversationId,job.conversationId);m.pending[2].resolve({text:'recalled'});await settle();assert.equal(m.notifications.length,3);m.close();
});
test('Pi rejects other-session job IDs, cancels whole conversations, and suppresses switched-session notices',async()=>{
 const m=mockRuntime();const job=(await m.execute('bridge_delegate',{route:'r',task:'first'})).details;
 const queued=(await m.execute('bridge_message',{jobId:job.jobId,message:'second'})).details;
 await m.execute('bridge_cancel',{jobId:job.jobId});assert.equal(m.pending[0].signal.aborted,true);assert.equal(m.pending[1].signal.aborted,true);assert.equal((await m.execute('bridge_status',{jobId:queued.jobId})).details.status,'cancelled');
 m.pending[0].resolve({text:'late'});m.pending[1].resolve({text:'late'});await settle();assert.equal(m.notifications.length,0);
 const next=(await m.execute('bridge_delegate',{route:'r',task:'new'})).details;m.handlers.get('session_before_switch')();assert.equal(m.pending[2].signal.aborted,true);assert.equal(m.hosts[0].closed,true);
 m.handlers.get('session_start')({},m.context('two'));await assert.rejects(m.execute('bridge_message',{jobId:next.jobId,message:'leak'},m.context('two')),/No such job/);
 m.pending[2].resolve({text:'stale'});await settle();assert.equal(m.notifications.length,0);
 m.handlers.get('session_before_switch')();m.handlers.get('session_start')({},m.context('one'));const returned=(await m.execute('bridge_delegate',{route:'r',task:'after returning'})).details;assert.equal(returned.status,'running');assert.notEqual(returned.conversationId,next.conversationId);m.close();m.pending[3].resolve({text:'closed'});await settle();assert.equal(m.notifications.length,0);
});
test('Pi preserves structured failures, refreshes saved rules, and rejects cancelled calls',async()=>{
 const m=mockRuntime();const job=(await m.execute('bridge_delegate',{route:'r',task:'test'})).details;
 const error={code:'RATE_LIMIT',reason:'Provider busy',stage:'prompt',worker:'opencode',retryable:true,attempts:1,outcomeUnknown:false,nextAction:'Try later'};m.pending[0].reject(error);await settle();
 assert.deepEqual((await m.execute('bridge_status',{jobId:job.jobId})).details.error,error);assert.equal(m.notifications.length,1);await assert.rejects(m.execute('bridge_message',{jobId:job.jobId,message:'retry'}),/failed or was cancelled/);
 const repeated=(await m.execute('bridge_delegate',{route:'r',task:'test'})).details;assert.equal(repeated.jobId,job.jobId);assert.ok(repeated.retryAfterMs>0);assert.equal(m.pending.length,1);
 const hook=m.handlers.get('before_agent_start');assert.equal((await hook({},m.context())).message.details.routes[0].id,'first');m.setRoutes([{id:'changed',parents:['pi'],enabled:true,usage:'can'}]);assert.equal((await hook({},m.context())).message.details.routes[0].id,'changed');
 const aborted=new AbortController();aborted.abort();await assert.rejects(m.execute('bridge_delegate',{route:'r',task:'no'},m.context(),aborted.signal),/cancelled/);m.close();
});
test('Pi bounds background work including queued followups',async()=>{
 const m=mockRuntime(),job=(await m.execute('bridge_delegate',{route:'r',task:'first'})).details;
 for(let i=0;i<3;i++)await m.execute('bridge_message',{jobId:job.jobId,message:'queued '+i});
 await assert.rejects(m.execute('bridge_message',{jobId:job.jobId,message:'fifth'}),/Four background jobs/);m.close();for(const p of m.pending){assert.equal(p.signal.aborted,true);p.resolve({text:'late'});}await settle();assert.equal(m.notifications.length,0);
});
test('Pi rejects version drift and prevents recursive parent tools',()=>{
 assert.throws(()=>mockRuntime('2.0.0'),/compatibility review/);const before=process.env.HARNESS_BRIDGE_DEPTH;process.env.HARNESS_BRIDGE_DEPTH='1';try{assert.equal(mockRuntime().tools.size,0);}finally{if(before===undefined)delete process.env.HARNESS_BRIDGE_DEPTH;else process.env.HARNESS_BRIDGE_DEPTH=before;}
});
test.after(()=>rm(directory,{recursive:true,force:true}));
