import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentRegistry} from 'acpx/agent-registry';
import {agentDefinitions,inspectRegistryAgent,registryVersion} from '../lib/agent-registry.mjs';
import {selectCompatibility} from '../lib/compatibility.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'bridge-registry-'));
process.env.HARNESS_BRIDGE_HOME=path.join(dir,'state');
const {detect,validate,save}=await import('../lib/core.mjs');
const {selectRoute,delegate,probe}=await import('../lib/agents.mjs');
const {setupStatus}=await import('../lib/setup.mjs');

test('catalog derives every upstream id from the pinned public acpx API plus DeepSeek',()=>{
 const upstream=createAgentRegistry().list();
 assert.equal(registryVersion,'0.19.4');
 assert.deepEqual(new Set(agentDefinitions.map(a=>a.id)),new Set([...upstream,'deepseek']));
 assert.deepEqual(agentDefinitions.filter(a=>a.nativeParent).map(a=>a.id),['codex','pi','opencode','deepseek']);
 for(const agent of agentDefinitions.filter(a=>!['codex','claude','pi','opencode','deepseek'].includes(a.id))){
  const inspection=inspectRegistryAgent(agent.id,command=>command);
  assert.equal(agent.nativeParent,false);
  if(inspection){assert.deepEqual([agent.adapter,...agent.args],inspection.launch.argv);assert.equal(agent.catalogOnly,false);}
  else{assert.equal(agent.catalogOnly,true);assert.equal(agent.adapter,null);}
 }
 assert.equal(agentDefinitions.find(a=>a.id==='fast-agent').catalogOnly,true);
 assert.equal(agentDefinitions.find(a=>a.id==='mux').catalogOnly,true);
});

test('installed-only detection never treats package runners as ready or grants native parent support',async()=>{
 const lookups=[];
 const inventory=await detect({findExecutable:async command=>{lookups.push(command);return ['gemini','openclaw','kilo','npx','uvx'].includes(command)?path.join(dir,command):null;},inspectVersion:async agent=>selectCompatibility(agent.id,'1.2.3')});
 for(const id of ['gemini','openclaw','kilocode']){const agent=inventory.find(a=>a.id===id);assert.equal(agent.acpReady,true);assert.equal(agent.worker.status,'detected');assert.equal(agent.worker.liveVerified,false);assert.equal(agent.compatibility.supported,false);assert.equal(agent.nativeParent,false);}
 for(const id of ['fast-agent','mux']){const agent=inventory.find(a=>a.id===id);assert.equal(agent.acpReady,false);assert.equal(agent.worker.status,'catalog-only');}
 assert.equal(lookups.includes('npx'),false);assert.equal(lookups.includes('uvx'),false);
 const qwen=inventory.find(a=>a.id==='qwen');assert.deepEqual(qwen.worker.requirements,['qwen']);assert.equal(qwen.worker.status,'missing');
});

test('generic workers round-trip routing and are alternatives rather than an implicit fan-out',()=>{
 const rule=validate({routes:[{id:'registry',parents:['codex'],workers:['gemini','openclaw'],models:[{worker:'gemini',id:'model-a',reasoning:'high'}],task:'Research',reasoning:'',enabled:true}]}).routes[0];
 const inventory=[{id:'gemini',acpReady:true},{id:'openclaw',acpReady:true}];
 assert.throws(()=>selectRoute(rule,{parent:'codex'},inventory),/Choose one worker/);
 const selected=selectRoute(rule,{parent:'codex',worker:'gemini'},inventory);
 assert.equal(selected.agent.id,'gemini');assert.equal(selected.model,'model-a');assert.equal(selected.reasoning,'high');
 assert.deepEqual(validate({routes:[rule]}).routes[0],rule);
});

test('unavailable MCP targets do not receive misleading generic config snippets',async()=>{
 const inventory=['gemini','opencode','deepseek'].map(id=>({id,name:id,installed:false,compatibility:{supported:false}}));
 const status=await setupStatus({inventory,bridgeHome:path.join(dir,'setup'),userHome:dir});
 for(const entry of status.mcp.entries){assert.equal(entry.available,false);assert.equal(entry.configText,undefined);}
});

test('registry worker performs ACP discovery, model/thinking selection and same-session followup',{skip:process.platform==='win32'},async()=>{
 const executable=path.join(dir,'gemini'),log=path.join(dir,'requests.jsonl');
 await writeFile(executable,`#!${process.execPath}
import fs from 'node:fs';
if(process.argv.includes('--version')){console.log('1.2.3');process.exit(0);}
let buf='',model='first',thinking='low',turns=0;
const opts=()=>[{id:'model',category:'model',name:'Model',type:'select',currentValue:model,options:[{value:'first',name:'First'},{value:'second',name:'Second'}]},{id:'thinking',name:'Thinking',type:'select',currentValue:thinking,options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}];
const send=value=>console.log(JSON.stringify({jsonrpc:'2.0',...value}));
process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const msg=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:msg.method,argv:process.argv.slice(2),cwd:process.cwd(),params:msg.params})+'\\n');if(msg.id===undefined)continue;let result={};
if(msg.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};
if(msg.method==='session/new')result={sessionId:'registry-fixture',configOptions:opts()};
if(msg.method==='session/set_config_option'){if(msg.params.configId==='model')model=msg.params.value;else thinking=msg.params.value;result={configOptions:opts()};}
if(msg.method==='session/prompt'){send({method:'session/update',params:{sessionId:'registry-fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify({model,thinking,turn:++turns,cwd:process.cwd()})}}}});result={stopReason:'end_turn'};}send({id:msg.id,result});}});
`);
 await chmod(executable,0o755);const previousPath=process.env.PATH;process.env.PATH=dir;
 const conversation={};
 try{
  const catalog=await probe('gemini',{modelId:'second'});assert.equal(catalog.protocolVerified,true);assert.equal(catalog.verified,false);assert.deepEqual(catalog.models.find(m=>m.id==='second').reasoning,['low','high']);
  const discovered=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(discovered.some(m=>m.method==='session/prompt'),false);assert.ok(discovered.some(m=>m.argv.includes('--acp')));
  await save({routes:[{id:'generic',parents:['codex'],workers:['gemini'],models:[{worker:'gemini',id:'second',reasoning:'high'}],task:'Research',reasoning:'',enabled:true}]});
  const args={routeId:'generic',parent:'codex',parentWorkspace:dir,task:'fixture'};
  const first=await delegate(args,{conversation}),second=await delegate({...args,task:'followup'},{conversation});
  assert.equal(first.sessionId,second.sessionId);assert.deepEqual(JSON.parse(second.text),{model:'second',thinking:'high',turn:2,cwd:await realpath(dir)});
  await conversation.connection.rpc.close();
  await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('1.2.3');process.exit(0);}
let buf='';process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);if(m.id===undefined)continue;const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));let result={};if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};if(m.method==='session/new')result={sessionId:'defaults'};if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'defaults',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'harness default'}}}});result={stopReason:'end_turn'};}send({id:m.id,result});}});
`);
  const defaults=await probe('gemini');assert.equal(defaults.harnessDefault,true);assert.deepEqual(defaults.models,[]);
  await assert.rejects(probe('gemini',{modelId:'not-advertised'}),/not advertised/);
  await save({routes:[{id:'generic',parents:['codex'],workers:['gemini'],models:[],task:'Research',reasoning:'',enabled:true}]});
  assert.equal((await delegate(args)).text,'harness default');
  // A private model catalog may still name its current model and expose
  // independent thinking controls. Auto must not try to switch that model.
  await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('1.2.3');process.exit(0);}
let buf='',thinking='low';const opts=()=>[{id:'thinking',name:'Thinking',type:'select',currentValue:thinking,options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}];const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));
process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);if(m.id===undefined)continue;let result={};if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};if(m.method==='session/new')result={sessionId:'private-catalog',models:{currentModelId:'private-default',availableModels:[]},configOptions:opts()};if(m.method==='session/set_model')throw new Error('Auto must not set a model');if(m.method==='session/set_config_option'){thinking=m.params.value;result={configOptions:opts()};}if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'private-catalog',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'private default:'+thinking}}}});result={stopReason:'end_turn'};}send({id:m.id,result});}});
`);
  const privateCatalog=await probe('gemini');assert.equal(privateCatalog.harnessDefault,true);assert.equal(privateCatalog.currentModel,'private-default');assert.deepEqual(privateCatalog.configOptions[0].options.map(v=>v.value),['low','high']);
  await save({routes:[{id:'generic',parents:['codex'],workers:['gemini'],models:[],task:'Research',reasoning:'high',enabled:true}]});
  assert.equal((await delegate(args)).text,'private default:high');
 }finally{await conversation.connection?.rpc.close();process.env.PATH=previousPath;}
});

test.after(async()=>{await rm(dir,{recursive:true,force:true});});
