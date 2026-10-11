import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-test-'));
process.env.HARNESS_BRIDGE_HOME=path.join(dir,'state');
const {validate,save,load,apply,managed}=await import('../lib/core.mjs');
const {RPC}=await import('../lib/rpc.mjs');
const {resolveWorkspace,delegate,flatten}=await import('../lib/agents.mjs');
const {providerOverlay}=await import('../lib/deepseek.mjs');
const {serve}=await import('../lib/server.mjs');
const route={id:'review',parent:'pi',worker:'opencode',model:'provider/model',reasoning:'',task:'Review code',enabled:true};
test('config persists and rejects invalid harness and duplicate IDs',async()=>{
 await save({routes:[route],workspace:dir});assert.equal((await load()).routes[0].worker,'opencode');
 assert.equal((await load()).inheritWorkspace,true);
 await save({routes:[route],workspace:dir,inheritWorkspace:false});assert.equal((await load()).inheritWorkspace,false);
 assert.throws(()=>validate({routes:[route],inheritWorkspace:'false'}));
 assert.throws(()=>validate({routes:[{...route,worker:'arbitrary-command'}]}));
 assert.throws(()=>validate({routes:[route,route]}));
});
test('workspace application preserves existing instructions and updates idempotently',async()=>{
 await writeFile(path.join(dir,'AGENTS.md'),'Existing project guidance.\n');await apply(dir);await apply(dir);
 const text=await readFile(path.join(dir,'AGENTS.md'),'utf8');assert.ok(text.startsWith('Existing project guidance.'));assert.equal(text.match(/<!-- harness-bridge:start -->/g).length,1);
 assert.throws(()=>managed('<!-- harness-bridge:start -->','new'));
});
test('delegation requires the selected project and accepts its symlink alias',async()=>{
 const other=await mkdtemp(path.join(dir,'other-'));
 const alias=path.join(dir,'alias');await symlink(other,alias,'dir');
 assert.equal(await resolveWorkspace(other,alias),await resolveWorkspace(other,other));
 await assert.rejects(resolveWorkspace(dir,other),/does not match/);
 await assert.rejects(resolveWorkspace('',dir),/Select and save/);
 assert.equal(await resolveWorkspace(other,undefined),await resolveWorkspace(other,other));
 assert.equal(await resolveWorkspace(dir,other,false),await resolveWorkspace(other,other));
 assert.equal(await resolveWorkspace('',other,false),await resolveWorkspace(other,other));
 await assert.rejects(resolveWorkspace(dir,'https://github.com/example/repo',false),/absolute workspace/);
});
test('DeepSeek overlay imports only provider settings and preserves provider labels',()=>{
 const providers={digitalocean:{displayName:'DigitalOcean',apiKeyEnv:'EXAMPLE_KEY',models:[]}};
 const rows=[{id:'web',config:{port:3080}},{id:'llm-pi-ai',name:'ignored',config:{providers,unrelated:true}},{id:'agent-default-model',config:{provider:'digitalocean',model:'example'}}];
 assert.deepEqual(providerOverlay(rows),[{id:'llm-pi-ai',config:{providers}},{id:'acp',config:{provider:'digitalocean',model:'example'}}]);
 assert.deepEqual(providerOverlay([]),[]);
 assert.throws(()=>providerOverlay({}),/unsupported format/);
 assert.deepEqual(flatten([{group:'digitalocean',name:'DigitalOcean',options:[{value:'model-id',name:'Example'}]}]),[{id:'model-id',name:'Example · DigitalOcean'}]);
});
test('RPC handles streaming updates and agent errors',async()=>{
 const script=`let buf='';process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);console.log(JSON.stringify({method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello'}}}}));console.log(JSON.stringify(m.method==='bad'?{id:m.id,error:{message:'unsupported'}}:{id:m.id,result:{stopReason:'end_turn'}}));}});`;
 const rpc=new RPC(process.execPath,['-e',script]);try{assert.equal((await rpc.call('session/prompt',{})).stopReason,'end_turn');assert.equal(rpc.text,'hello');await assert.rejects(rpc.call('bad',{}),/unsupported/);}finally{rpc.close();}
});
test('delegation excludes startup text and rejects empty completed responses',async()=>{
 const executable=path.join(dir,'opencode');
 const script=`#!${process.execPath}
 let buf='';process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));if(m.method==='session/new')send({method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'startup'}}}});if(m.method==='session/prompt'&&m.params.prompt[0].text==='answer')send({method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'actual answer'}}}});send({id:m.id,result:m.method==='initialize'?{protocolVersion:1,agentCapabilities:{}}:m.method==='session/new'?{sessionId:'test'}:{stopReason:'end_turn'}});}});`;
 await writeFile(executable,script);await chmod(executable,0o755);
 const oldPath=process.env.PATH;process.env.PATH=dir+path.delimiter+oldPath;
 try{
  await save({routes:[{...route,model:''}],workspace:dir});
  const args={routeId:route.id,parent:'pi',workspace:dir};
  assert.equal((await delegate({...args,task:'answer'})).text,'actual answer');
  await save({routes:[{...route,model:''}],workspace:''});
  assert.equal((await delegate({...args,parentWorkspace:dir,task:'answer'})).text,'actual answer');
  await assert.rejects(delegate({...args,parentWorkspace:path.dirname(dir),task:'answer'}),/does not match/);
  await assert.rejects(delegate({...args,task:'empty'}),/without a response/);
 }finally{process.env.PATH=oldPath;}
});
test('local UI serves and rejects forged writes and foreign origins',async()=>{
 const server=await serve(0);const url=`http://127.0.0.1:${server.address().port}`;
 try{
  const html=await(await fetch(url)).text();assert.ok(html.includes('Who should do what?'));assert.ok(!html.includes('__BRIDGE_TOKEN__'));
  assert.equal((await fetch(url+'/rule-prompt.mjs')).status,200);assert.equal((await fetch(url+'/mark.svg')).headers.get('content-type'),'image/svg+xml; charset=utf-8');
  const token=html.match(/name="bridge-token" content="([^"]+)"/)[1];
  const body=JSON.stringify({routes:[{...route,enabled:false}],workspace:dir});
  assert.equal((await fetch(url+'/api/config',{method:'POST',headers:{'content-type':'application/json'},body})).status,403);
  assert.equal((await fetch(url+'/api/config',{method:'POST',headers:{'content-type':'application/json','x-bridge-token':token,origin:'https://evil.example'},body})).status,403);
  assert.equal((await fetch(url+'/api/config',{method:'POST',headers:{'content-type':'application/json','x-bridge-token':token},body})).status,200);
  assert.equal((await fetch(url+'/../package.json')).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
test.after(async()=>{await rm(dir,{recursive:true,force:true});});
