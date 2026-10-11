import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createParentBridge} from '../lib/parent-bridge.mjs';
import {createNativeService,handleNativeHook as realHandleNativeHook,sessionDirectory} from '../harnesses/codex/v0_160/native.mjs';
import {installCodexIntegration,codexIntegrationStatus} from '../harnesses/codex/integration.mjs';
const handleNativeHook=(input,options,request,version=async()=>'0.160.1')=>realHandleNativeHook(input,options,request,version);
test('native daemon keeps worker owner, messages, single delivery and recoverable status',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-codex-'));let notify,active=0,call=0;
 const options={sessionId:'parent-a',cwd:dir,bridgeHome:dir};
 const service=await createNativeService(options,{stopWaitMs:30,createBridge:o=>{notify=o.notify;return {get activeCount(){return active;},close:async()=>{},execute:async(name,args,ctx)=>{assert.equal(ctx.sessionId,'parent-a');assert.equal(ctx.cwd,dir);if(name==='bridge_status')return {jobId:'job',conversationId:'conversation',status:active?'running':'completed'};call++;if(name==='bridge_message')assert.equal(args.jobId,'job');active=1;return {jobId:'job',conversationId:'conversation',status:'running'};}};}});
 try{
  await service.execute({op:'delegate',args:{route:'r',task:'x'}});await service.execute({op:'message',args:{jobId:'job',message:'followup'}});assert.equal(call,2);
  const start=Date.now();assert.deepEqual((await service.execute({op:'drain',waitMs:1000})).results,[]);assert.ok(Date.now()-start<200);
  active=0;await notify({jobId:'job',conversationId:'conversation',status:'completed',result:{text:'nonce'}});
  const batches=await Promise.all([service.execute({op:'drain'}),service.execute({op:'drain'})]);assert.equal(batches.flatMap(x=>x.results).length,1);
  assert.equal((await service.execute({op:'status',args:{jobId:'job'}})).result.text,'nonce');
  await service.execute({op:'release',ids:['job']});assert.equal((await service.execute({op:'drain'})).results.length,1);
 }finally{await service.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('restart records interrupted outcome without replay and fences parent directories',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-codex-')),options={sessionId:'a',cwd:dir,bridgeHome:dir};
 const location=sessionDirectory(options);await fs.mkdir(location,{recursive:true});await fs.writeFile(path.join(location,'jobs.json'),JSON.stringify({j:{jobId:'j',status:'running'}}));let calls=0;
 const service=await createNativeService(options,{createBridge:()=>({activeCount:0,close:async()=>{},execute:async()=>{calls++;}})});
 try{const j=await service.execute({op:'status',args:{jobId:'j'}});assert.equal(j.error.outcomeUnknown,true);assert.equal(calls,0);assert.notEqual(location,sessionDirectory({...options,sessionId:'b'}));}finally{await service.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('native hooks refresh rules, block Stop once for result, never loop on pending continuation',async()=>{
 const input={session_id:'s',cwd:'/tmp',hook_event_name:'Stop'};let requests=[];
 const request=async(_o,r)=>{requests.push(r);return {results:[],activeCount:1};};
 assert.equal((await handleNativeHook(input,{},request)).decision,'block');
 assert.deepEqual(await handleNativeHook({...input,stop_hook_active:true},{},request),{});assert.equal(requests[1].waitMs,0);
 const result=await handleNativeHook(input,{},async()=>({results:[{jobId:'a',status:'completed'}]}));assert.match(result.reason,/background result/);
 const rules=await handleNativeHook({...input,hook_event_name:'UserPromptSubmit'},{},async(_o,r)=>r.op==='routes'?[{id:'new'}]:{results:[]});assert.match(rules.hookSpecificOutput.additionalContext,/new/);
});
test('native installer preserves other hooks, idempotent and requires native trust',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-codex-'));try{
  const original={hooks:{Stop:[{hooks:[{type:'command',command:'original'}]}]}};await fs.writeFile(path.join(dir,'hooks.json'),JSON.stringify(original));
  const options={codexHome:dir,version:'0.160.1'};assert.equal((await installCodexIntegration(options)).trustRequired,true);assert.equal((await installCodexIntegration(options)).changed,false);
  const saved=JSON.parse(await fs.readFile(path.join(dir,'hooks.json')));assert.equal(saved.hooks.Stop[0].hooks[0].command,'original');assert.equal((await codexIntegrationStatus(options)).current,true);
  await assert.rejects(installCodexIntegration({...options,version:'0.161.0'}));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('hooks fail closed after resolved Codex version changes',async()=>{let requests=0;const value=await handleNativeHook({session_id:'s',cwd:'/tmp',hook_event_name:'Stop'},{},async()=>{requests++;},async()=>'0.161.0');assert.match(value.systemMessage,/disabled/);assert.equal(requests,0);});
test('installer refuses symlink hook configuration without changing target',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-hooks-link-'));try{const original=path.join(dir,'original.json');await fs.writeFile(original,'{}');await fs.symlink(original,path.join(dir,'hooks.json'));await assert.rejects(installCodexIntegration({codexHome:dir,version:'0.160.1'}),/regular file/);assert.equal(await fs.readFile(original,'utf8'),'{}');}finally{await fs.rm(dir,{recursive:true,force:true});}});

test('native journal synchronizes failure-cancelled queued siblings from the real parent manager',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-native-failure-')),pending=[];
 const service=await createNativeService({sessionId:'parent',cwd:dir,bridgeHome:dir},{createBridge:options=>createParentBridge({...options,createHost:()=>({run:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),closeConversation(){},close:async()=>{}})})});
 try{
  const first=await service.execute({op:'delegate',args:{route:'r',task:'first'}});
  const second=await service.execute({op:'message',args:{jobId:first.jobId,message:'queued'}});
  pending[0].reject({code:'TIMEOUT',reason:'worker timed out',outcomeUnknown:true});await new Promise(r=>setImmediate(r));
  assert.equal((await service.execute({op:'status',args:{jobId:second.jobId}})).status,'cancelled');
  const batch=await service.execute({op:'drain'});assert.equal(batch.activeCount,0);assert.deepEqual(batch.results.map(j=>j.status).sort(),['cancelled','failed']);
  assert.equal((await service.execute({op:'drain'})).results.length,0);
  const journal=JSON.parse(await fs.readFile(path.join(service.dir,'jobs.json')));assert.equal(journal[second.jobId].status,'cancelled');
 }finally{await service.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('explicit conversation cancellation updates every queued job without completion notifications',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-native-cancel-'));
 const service=await createNativeService({sessionId:'parent',cwd:dir,bridgeHome:dir},{createBridge:options=>createParentBridge({...options,createHost:()=>({run:()=>new Promise(()=>{}),closeConversation(){},close:async()=>{}})})});
 try{
  const first=await service.execute({op:'delegate',args:{route:'r',task:'first'}}),second=await service.execute({op:'message',args:{jobId:first.jobId,message:'queued'}});
  await service.execute({op:'cancel',args:{jobId:first.jobId}});
  assert.equal((await service.execute({op:'status',args:{jobId:second.jobId}})).status,'cancelled');
  const batch=await service.execute({op:'drain'});assert.equal(batch.activeCount,0);assert.equal(batch.results.filter(j=>j.status==='cancelled').length,2);
 }finally{await service.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('a late completion callback cannot redeliver a result already obtained by status synchronization',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hb-native-delivery-'));let notify,finished=false;
 const terminal={jobId:'j',status:'completed',result:{text:'retained'}};
 const service=await createNativeService({sessionId:'parent',cwd:dir,bridgeHome:dir},{createBridge:options=>{notify=options.notify;return {get activeCount(){return finished?0:1;},close:async()=>{},execute:async name=>name==='bridge_status'&&finished?terminal:{jobId:'j',status:'running'}};}});
 try{
  await service.execute({op:'delegate',args:{route:'r',task:'x'}});finished=true;
  assert.equal((await service.execute({op:'drain'})).results.length,1);
  await notify(terminal);assert.equal((await service.execute({op:'drain'})).results.length,0);
  assert.equal((await service.execute({op:'status',args:{jobId:'j'}})).result.text,'retained');
 }finally{await service.close();await fs.rm(dir,{recursive:true,force:true});}
});
