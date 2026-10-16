import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openAcpxWorker,isAcpxCommandProbe} from '../lib/runtime/acpx.mjs';
test('command diagnostics are separate from ACP workers including Windows command shims',()=>{
 assert.equal(isAcpxCommandProbe('gemini',{command:'/bin/gemini',args:['--version']}),true);
 assert.equal(isAcpxCommandProbe('copilot',{command:'node.exe',args:['C:\\Tools\\copilot.js','--help']}),true);
 assert.equal(isAcpxCommandProbe('gemini',{command:'C:\\Windows\\System32\\cmd.exe',args:['/d','/s','/c','"C:\\Tools\\gemini.cmd ^"--version^""']}),true);
 assert.equal(isAcpxCommandProbe('copilot',{command:'cmd.exe',args:['/d','/s','/c','"C:\\Program Files\\copilot.cmd ^"--help^""']}),true);
 assert.equal(isAcpxCommandProbe('gemini',{command:'cmd.exe',args:['/d','/s','/c','"C:\\Tools\\gemini.cmd ^"--acp^""']}),false);
 assert.equal(isAcpxCommandProbe('gemini',{command:'/bin/gemini',args:['--acp']}),false);
 assert.equal(isAcpxCommandProbe('copilot',{command:'/bin/copilot',args:['--acp','--stdio']}),false);
 assert.equal(isAcpxCommandProbe('opencode',{command:'/bin/opencode',args:['--version']}),false);
});
test('acpx preserves cwd, model/thinking choices and conservative capabilities',async()=>{
 const cwd=await mkdtemp(path.join(tmpdir(),'bridge-acpx-controls-'));
 const script=path.join(cwd,'worker.cjs'),log=path.join(cwd,'requests.jsonl');
 await writeFile(script,`const fs=require('node:fs');let text='';const opts=[{id:'model',category:'model',name:'Model',type:'select',currentValue:'a',options:[{value:'a',name:'A'},{value:'b',name:'B'}]},{id:'reasoning_effort',name:'Thinking',type:'select',currentValue:'low',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}];const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));process.stdin.on('data',d=>{text+=d;let n;while((n=text.indexOf('\\n'))>=0){const m=JSON.parse(text.slice(0,n));text=text.slice(n+1);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');if(m.id===undefined)continue;let result={};if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};if(m.method==='session/new')result={sessionId:'fixture',configOptions:opts};if(m.method==='session/set_config_option'){opts.find(o=>o.id===m.params.configId).currentValue=m.params.value;result={configOptions:opts};}if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify({cwd:process.cwd(),model:opts[0].currentValue,thinking:opts[1].currentValue,depth:process.env.HARNESS_BRIDGE_DEPTH})}}}});result={stopReason:'end_turn'};}send({id:m.id,result});}});`);
 let rpc;
 try{
  ({rpc}=await openAcpxWorker({id:'fixture',adapterPath:process.execPath,args:[script]},cwd));
  await rpc.call('session/set_config_option',{configId:'model',value:'b'},1000);
  await rpc.call('session/set_config_option',{configId:'reasoning_effort',value:'high'},1000);
  await rpc.call('session/prompt',{prompt:[{text:'inspect'}]},1000);
  const result=JSON.parse(rpc.text);assert.equal(result.model,'b');assert.equal(result.thinking,'high');assert.equal(result.depth,'1');
  const messages=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(messages.find(m=>m.method==='session/new').params.cwd,cwd);
  const caps=messages.find(m=>m.method==='initialize').params.clientCapabilities;
  assert.notEqual(caps.terminal,true);assert.notEqual(caps.fs?.writeTextFile,true);
 }finally{await rpc?.close();await rm(cwd,{recursive:true,force:true});}
});

test('worker text output is bounded in UTF-8 bytes and excess output stops execution',async()=>{
 const cwd=await mkdtemp(path.join(tmpdir(),'bridge-acpx-output-')),script=path.join(cwd,'worker.cjs');
 await writeFile(script,`let buf='';const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);if(m.id===undefined)continue;if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});else if(m.method==='session/new')send({id:m.id,result:{sessionId:'output'}});else if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'output',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'界'.repeat(20)}}}});send({id:m.id,result:{stopReason:'end_turn'}});}else send({id:m.id,result:{}});}});`);
 let rpc;
 try{
  ({rpc}=await openAcpxWorker({id:'fixture',adapterPath:process.execPath,args:[script]},cwd,{maxOutputBytes:32}));
  await assert.rejects(rpc.call('session/prompt',{prompt:[{text:'large'}]},2000),e=>e.code==='OUTPUT_LIMIT');
  assert.equal(rpc.text,'');
 }finally{await rpc?.close();await rm(cwd,{recursive:true,force:true});}
});
