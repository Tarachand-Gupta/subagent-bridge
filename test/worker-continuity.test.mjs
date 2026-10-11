import {spawn} from 'node:child_process';import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,chmod,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-continuity-'));process.env.HARNESS_BRIDGE_HOME=path.join(dir,'state');process.env.PATH=dir+path.delimiter+process.env.PATH;
const {save}=await import('../lib/core.mjs');const {createWorkerHost}=await import('../lib/runtime/worker-host-client.mjs');
const log=path.join(dir,'events.jsonl'),executable=path.join(dir,'opencode');
await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('1.18.34');process.exit(0);}const fs=require('node:fs');let buf='',history=[],session='session-'+process.pid;const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);if(m.id===undefined)continue;if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});else if(m.method==='session/new')send({id:m.id,result:{sessionId:session}});else if(m.method==='session/prompt'){const text=m.params.prompt[0].text;history.push(text);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({session,text,pid:process.pid})+'\\n');if(text==='disconnect'){process.exit(1);}const finish=()=>{send({method:'session/update',params:{sessionId:session,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(history)}}}});send({id:m.id,result:{stopReason:'end_turn'}});};setTimeout(finish,text.includes('slow')?500:0);}else send({id:m.id,result:{}});}});`);await chmod(executable,0o755);
const route={id:'research',parent:'pi',worker:'opencode',model:'',reasoning:'',task:'Research',enabled:true};
test('queued messages and completed-turn followups retain exact ACP session and context',async()=>{
 await save({routes:[route]});const host=createWorkerHost({parent:'pi',parentSessionId:'parent-one',cwd:dir});
 try{
  const first=host.run({conversationId:'one',routeId:'research',task:'remember nonce slow'});
  const second=host.run({conversationId:'one',routeId:'research',task:'recall nonce'});
  const [a,b]=await Promise.all([first,second]);assert.equal(a.sessionId,b.sessionId);assert.deepEqual(JSON.parse(b.text),['remember nonce slow','recall nonce']);
  const c=await host.run({conversationId:'one',routeId:'research',task:'third'});assert.equal(c.sessionId,a.sessionId);assert.equal(JSON.parse(c.text).length,3);
 }finally{await host.close();}
});
test('same conversation ID in another parent owns separate context; changed rule closes old context',async()=>{
 await save({routes:[route]});const a=createWorkerHost({parent:'pi',parentSessionId:'A',cwd:dir}),b=createWorkerHost({parent:'pi',parentSessionId:'B',cwd:dir});
 try{
  const one=await a.run({conversationId:'same',routeId:'research',task:'only parent A'}),two=await b.run({conversationId:'same',routeId:'research',task:'only parent B'});
  assert.notEqual(one.sessionId,two.sessionId);assert.deepEqual(JSON.parse(two.text),['only parent B']);
  await save({routes:[{...route,reasoning:'high'}]});await assert.rejects(a.run({conversationId:'same',routeId:'research',task:'later'}),e=>e.code==='CONFIGURATION_ERROR');
 }finally{await Promise.all([a.close(),b.close()]);}
});
test('uncertain failed conversation never reconnects or replays',async()=>{
 await save({routes:[route]});const host=createWorkerHost({parent:'pi',parentSessionId:'failure',cwd:dir});
 try{
  await assert.rejects(host.run({conversationId:'dead',routeId:'research',task:'disconnect'}),e=>e.outcomeUnknown===true);
  await assert.rejects(host.run({conversationId:'dead',routeId:'research',task:'after crash'}),e=>e.code==='CONFIGURATION_ERROR');
  const rows=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.filter(r=>r.text==='disconnect').length,1);assert.equal(rows.filter(r=>r.text==='after crash').length,0);
 }finally{await host.close();}
});
test('cancelling a queued message leaves the active conversation usable',async()=>{
 await save({routes:[route]});const host=createWorkerHost({parent:'pi',parentSessionId:'queue-cancel',cwd:dir}),controller=new AbortController();
 try{
  const first=host.run({conversationId:'queue',routeId:'research',task:'queue first slow'});
  for(let i=0;i<300;i++){const text=await readFile(log,'utf8').catch(()=>'');if(text.includes('queue first slow'))break;await new Promise(r=>setTimeout(r,10));}
  const next=host.run({conversationId:'queue',routeId:'research',task:'must never dispatch'},{signal:controller.signal});
  await new Promise(r=>setTimeout(r,20));controller.abort();await assert.rejects(next,e=>e.code==='CANCELLED');await first;
  const last=await host.run({conversationId:'queue',routeId:'research',task:'after queued cancel'});
  assert.deepEqual(JSON.parse(last.text),['queue first slow','after queued cancel']);
 }finally{await host.close();}
});
test('cancelling active turn invalidates its session and host close disposes worker',async()=>{
 await save({routes:[route]});const host=createWorkerHost({parent:'pi',parentSessionId:'active-cancel',cwd:dir}),controller=new AbortController();let pid;
 try{
  const first=host.run({conversationId:'active',routeId:'research',task:'active cancel slow'},{signal:controller.signal});
  for(let i=0;i<300;i++){const rows=(await readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse);pid=rows.find(r=>r.text==='active cancel slow')?.pid;if(pid)break;await new Promise(r=>setTimeout(r,10));}
  assert.ok(pid);controller.abort();await assert.rejects(first,e=>e.code==='CANCELLED');
  await assert.rejects(host.run({conversationId:'active',routeId:'research',task:'must not revive'}),e=>e.code==='CONFIGURATION_ERROR');
 }finally{await host.close();}
 assert.throws(()=>process.kill(pid,0));
});
test('idle worker exit cannot silently replace a retained conversation',async()=>{
 await save({routes:[route]});const host=createWorkerHost({parent:'pi',parentSessionId:'idle-crash',cwd:dir});
 try{
  await host.run({conversationId:'idle',routeId:'research',task:'idle crash marker'});
  const rows=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse),pid=rows.find(r=>r.text==='idle crash marker').pid;
  process.kill(pid,'SIGTERM');await new Promise(r=>setTimeout(r,100));
  await assert.rejects(host.run({conversationId:'idle',routeId:'research',task:'never recreated'}),e=>e.code==='DISCONNECTED');
  const after=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(after.filter(r=>r.text==='never recreated').length,0);
 }finally{await host.close();}
});
test('owner crash disconnects IPC and retires retained worker processes',async()=>{
 await save({routes:[route]});const runnerFile=path.join(dir,'owner.mjs'),ready=path.join(dir,'owner-ready');
 await writeFile(runnerFile,`import {createWorkerHost} from ${JSON.stringify(new URL('../lib/runtime/worker-host-client.mjs',import.meta.url).href)};import {writeFile} from 'node:fs/promises';const host=createWorkerHost({parent:'pi',parentSessionId:'crashed-owner',cwd:${JSON.stringify(dir)}});await host.run({conversationId:'owned',routeId:'research',task:'owner death marker'});await writeFile(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`);
 const runner=spawn(process.execPath,[runnerFile],{stdio:'ignore'});let workerPid;
 try{
  let admitted=false;for(let i=0;i<600;i++){try{await readFile(ready);admitted=true;break;}catch{await new Promise(r=>setTimeout(r,10));}}assert.ok(admitted);
  workerPid=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse).find(r=>r.text==='owner death marker').pid;
  runner.kill('SIGKILL');
  let alive=true;for(let i=0;i<600;i++){try{process.kill(workerPid,0);}catch{alive=false;break;}await new Promise(r=>setTimeout(r,10));}assert.equal(alive,false,'Worker must exit when its owning parent crashes');
 }finally{runner.kill('SIGKILL');if(workerPid)try{process.kill(workerPid,'SIGTERM');}catch{}}
});
test.after(()=>rm(dir,{recursive:true,force:true}));
