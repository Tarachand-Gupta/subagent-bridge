import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runParent} from '../harnesses/codex/v0_160/parent.mjs';
const root=await mkdtemp(path.join(tmpdir(),'bridge-codex-parent-test-'));
async function fixture(mode){
 const cwd=await mkdtemp(path.join(root,'case-')),executable=path.join(cwd,'codex'),log=path.join(cwd,'wire.jsonl');
 await writeFile(executable,`#!${process.execPath}
const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(cwd,'pid'))},String(process.pid));const mode=${JSON.stringify(mode)};let buf='',turn=0;const send=o=>console.log(JSON.stringify(o));const finish=()=>send({method:'turn/completed',params:{threadId:'owned',turn:{id:'t'+turn,status:mode==='interrupted'?'interrupted':'completed'}}});process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');if(mode==='hang-init')continue;if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'owned'}}});if(m.method==='turn/start'){turn++;send({method:'turn/started',params:{threadId:'owned',turn:{id:'t'+turn}}});if(mode==='disconnect'){process.exit(1);}if(['background','steer','steer-error','steer-stale'].includes(mode)&&turn===1){send({id:m.id,result:{turn:{id:'t1'}}});send({id:'tool',method:'item/tool/call',params:{threadId:'owned',tool:'bridge_delegate',arguments:{route:'rule',task:'inspect'}}});}else {finish();setTimeout(()=>send({id:m.id,result:{turn:{id:'t'+turn}}}),20);}}if(m.id==='tool'&&m.result&&mode==='background'){finish();}if(m.method==='turn/steer'){if(mode==='steer-error')send({id:m.id,error:{code:-32000,message:'unclassified provider error'}});else if(mode==='steer-stale'){finish();send({id:m.id,error:{code:-32600,message:'No active turn; expected turn does not match'}});}else{send({id:m.id,result:{turnId:'t1'}});finish();}}}});`);
 await chmod(executable,0o755);return {cwd,executable,log};
}
async function dead(cwd){const pid=Number(await readFile(path.join(cwd,'pid'),'utf8'));assert.throws(()=>process.kill(pid,0));}
test('abort during initialize immediately rejects pending request and disposes owned process',async()=>{
 const f=await fixture('hang-init'),controller=new AbortController();
 const running=runParent({...f,task:'test',signal:controller.signal});
 running.catch(()=>{});
 try{
  // Wait for protocol admission, not a guessed process startup duration. A busy
  // build machine may not have scheduled the fixture within the old one second.
  const deadline=Date.now()+10000;let initialized=false;
  while(Date.now()<deadline){
   try{initialized=(await readFile(f.log,'utf8')).includes('"method":"initialize"');}catch(error){if(error.code!=='ENOENT')throw error;}
   if(initialized)break;await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.ok(initialized,'fixture received initialize before cancellation');
  const start=Date.now();controller.abort();
  await assert.rejects(running,/cancelled/);assert.ok(Date.now()-start<2000);await dead(f.cwd);
 }finally{controller.abort();await running.catch(()=>{});}
});
test('disconnect after turn admission never resubmits uncertain prompt',async()=>{
 const f=await fixture('disconnect');await assert.rejects(runParent({...f,task:'test',bridgeCall:async()=>[]}),/disconnected/);
 const messages=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(messages.filter(m=>m.method==='turn/start').length,1);await dead(f.cwd);
});
test('turn completion preceding start response waits for background completion then one follow-up',async()=>{
 const f=await fixture('background');let resolveWorker;const events=[];
 const running=runParent({...f,task:'test',onEvent:e=>events.push(e),bridgeCall:async args=>args[0]==='routes'?[]:new Promise(resolve=>resolveWorker=resolve)});
 while(!resolveWorker)await new Promise(r=>setTimeout(r,5));
 let done=false;running.then(()=>done=true);await new Promise(r=>setTimeout(r,50));assert.equal(done,false);
 resolveWorker({text:'worker-result'});const result=await running;assert.equal(result.turns,2);
 const messages=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(messages.filter(m=>m.method==='turn/start').length,2);
 assert.ok(messages.filter(m=>m.method==='turn/start')[1].params.input[0].text.includes('worker-result'));
 assert.equal(events.filter(e=>e.type==='worker.completed').length,1);await dead(f.cwd);
});
test('interrupted parent turn is a failure, not successful completion',async()=>{
 const f=await fixture('interrupted');await assert.rejects(runParent({...f,task:'test',bridgeCall:async()=>[]}),/failed/);await dead(f.cwd);
});
test('completion reaches an active parent turn via steer without waiting for a final turn event',async()=>{
 const f=await fixture('steer');const result=await runParent({...f,task:'test',bridgeCall:async args=>args[0]==='routes'?[]:{text:'active result'}});
 const messages=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);
 const steer=messages.find(m=>m.method==='turn/steer');assert.ok(steer);assert.equal(steer.params.expectedTurnId,'t1');assert.match(steer.params.input[0].text,/active result/);assert.equal(result.turns,1);await dead(f.cwd);
});
test('ambiguous steer failure never repeats the completion as a new turn',async()=>{
 const f=await fixture('steer-error');await assert.rejects(runParent({...f,task:'test',bridgeCall:async args=>args[0]==='routes'?[]:{text:'result'}}),/turn\/steer request failed/);
 const messages=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(messages.filter(m=>m.method==='turn/steer').length,1);assert.equal(messages.filter(m=>m.method==='turn/start').length,1);await dead(f.cwd);
});
test('explicit no-active-turn rejection safely queues completion once',async()=>{
 const f=await fixture('steer-stale');const result=await runParent({...f,task:'test',bridgeCall:async args=>args[0]==='routes'?[]:{text:'result'}});
 const messages=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(messages.filter(m=>m.method==='turn/steer').length,1);assert.equal(result.turns,2);await dead(f.cwd);
});
test.after(()=>rm(root,{recursive:true,force:true}));
