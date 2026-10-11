import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-options-'));
process.env.HARNESS_BRIDGE_HOME=path.join(dir,'state');
const {validate,save}=await import('../lib/core.mjs');
const {selectRoute,availableWorkers,delegate,describeRoutes}=await import('../lib/agents.mjs');
const legacy={id:'research',parent:'pi',worker:'opencode',model:'provider/a',task:'Research',reasoning:'',enabled:true};
const route=changes=>validate({routes:[{...legacy,...changes}]}).routes[0];
const inventory=[{id:'pi',acpReady:true},{id:'opencode',acpReady:true},{id:'codex',acpReady:true},{id:'claude',acpReady:false}];
test('legacy choices migrate without broadening access and normalization is stable',()=>{
 const normalized=route({});
 assert.deepEqual(normalized.parents,['pi']);assert.deepEqual(normalized.workers,['opencode']);assert.deepEqual(normalized.models,[{worker:'opencode',id:'provider/a'}]);
 assert.deepEqual(route(normalized),normalized);
 assert.equal(normalized.usage,'can');
 assert.equal(route({usage:'should'}).usage,'should');
 assert.throws(()=>route({usage:'always'}),/delegation policy/);
 const {parent,worker,model,...canonical}=normalized;assert.deepEqual(validate({routes:[canonical]}).routes[0],normalized);
 assert.equal(route({parents:['pi','codex'],workers:['opencode','pi'],models:[]}).parent,'*');
 assert.equal(route({workers:['opencode','pi'],models:[]}).worker,'auto');
 for(const change of [{parents:['pi','pi']},{workers:['missing']},{models:[{worker:'codex',id:'a'}]},{models:[{worker:'opencode',id:'a'},{worker:'opencode',id:'a'}]},{models:Array(101).fill({worker:'opencode',id:'a'})}])assert.throws(()=>route(change));
});
test('Auto excludes parent and selects one available harness, never fan-out',()=>{
 const auto=route({parents:[],workers:[],models:[],task:'Auto'});
 assert.deepEqual(availableWorkers(auto,'pi',inventory).map(a=>a.id),['opencode','codex']);
 assert.throws(()=>selectRoute(auto,{parent:'pi'},inventory),/Choose one worker/);
 assert.equal(selectRoute(auto,{parent:'pi',worker:'opencode'},inventory).model,'');
 assert.throws(()=>selectRoute(auto,{parent:'pi',worker:'pi'},inventory),/not available/);
 assert.throws(()=>selectRoute(auto,{parent:'pi',worker:'claude'},inventory),/not available/);
 assert.throws(()=>selectRoute(auto,{parent:'pi',worker:'opencode',model:'unlisted'},inventory),/not allowed/);
 assert.equal(selectRoute(auto,{parent:'pi'},inventory.slice(0,2)).agent.id,'opencode');
 assert.throws(()=>selectRoute(auto,{parent:'unknown'},inventory),/parent/);
});
test('multiple models are scoped to worker and only explicit alternatives are accepted',()=>{
 const multiple=route({workers:['opencode','codex'],models:[{worker:'opencode',id:'provider/a'},{worker:'opencode',id:'provider/b'},{worker:'codex',id:'codex/a'}]});
 assert.throws(()=>selectRoute(multiple,{parent:'pi',worker:'opencode'},inventory),/Choose one model/);
 assert.equal(selectRoute(multiple,{parent:'pi',worker:'opencode',model:'provider/b'},inventory).model,'provider/b');
 assert.equal(selectRoute(multiple,{parent:'pi',worker:'codex'},inventory).model,'codex/a');
 assert.throws(()=>selectRoute(multiple,{parent:'pi',worker:'opencode',model:'codex/a'},inventory),/not allowed/);
 assert.throws(()=>selectRoute(multiple,{parent:'opencode',worker:'codex'},inventory),/parent/);
 assert.throws(()=>selectRoute(route({}),{parent:'pi',worker:'codex'},inventory),/not allowed/);
});
test('ACP receives the selected model while Auto preserves the harness default',async()=>{
 const executable=path.join(dir,'opencode');
 await writeFile(executable,`#!${process.execPath}
 if(process.argv.includes('--version')){console.log('1.18.34');process.exit(0);}
 let buf='',model='provider/default',effort='default';const configOptions=()=>[{id:'reasoning',name:'Thinking',type:'select',currentValue:effort,options:[{value:'default',name:'Default'},{value:'high',name:'High'}]},{id:'model',category:'model',name:'Model',type:'select',currentValue:model,options:[{value:'provider/default',name:'Default'},{value:'provider/a',name:'A'},{value:'provider/b',name:'B'}]}];process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));if(m.id===undefined)continue;let result={};if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};if(m.method==='session/new')result={sessionId:'test',configOptions:configOptions()};if(m.method==='session/set_config_option'){if(m.params.configId==='model')model=m.params.value;else effort=m.params.value;result={configOptions:configOptions()};}if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:model+(effort==='default'?'':':'+effort)}}}});result={stopReason:'end_turn'};}send({id:m.id,result});}});`);
 await chmod(executable,0o755);const oldPath=process.env.PATH;process.env.PATH=dir+path.delimiter+oldPath;
 try{
  const config={routes:[route({models:[{worker:'opencode',id:'provider/a'},{worker:'opencode',id:'provider/b'}]})]};await save(config);
  const args={routeId:'research',parent:'pi',parentWorkspace:dir,task:'answer'};
  await assert.rejects(delegate(args),/Choose one model/);
  assert.equal((await delegate({...args,worker:'opencode',model:'provider/b'})).text,'provider/b');
  await save({routes:[route({models:[],task:'Auto'})]});
  assert.equal((await delegate(args)).text,'provider/default');
  const descriptions=await describeRoutes('pi');assert.match(descriptions[0].instruction,/any task/);assert.match(descriptions[0].instruction,/harness default model/);assert.equal(descriptions[0].availableWorkers[0].id,'opencode');
  assert.deepEqual(await describeRoutes('codex'),[]);
  await save({routes:[route({models:[],reasoning:'invalid-global',reasoningByWorker:{opencode:''}})]});
  assert.equal((await delegate(args)).text,'provider/default');
  await save({routes:[route({models:[],reasoning:'',reasoningByWorker:{opencode:'high'}})]});
  assert.equal((await delegate(args)).text,'provider/default:high');
  assert.match((await describeRoutes('pi'))[0].instruction,/opencode = high/);
 }finally{process.env.PATH=oldPath;}
});
test.after(async()=>{await rm(dir,{recursive:true,force:true});});

test('per-harness thinking is retained, scoped, and selected independently',()=>{
 const r=route({workers:['opencode','codex'],models:[],reasoning:'medium',reasoningByWorker:{opencode:'',codex:'high'}});
 assert.deepEqual(route(r),r);
 assert.equal(selectRoute(r,{parent:'pi',worker:'opencode'},inventory).reasoning,'');
 assert.equal(selectRoute(r,{parent:'pi',worker:'codex'},inventory).reasoning,'high');
 assert.equal(selectRoute({...r,reasoningByWorker:{}},{parent:'pi',worker:'codex'},inventory).reasoning,'medium');
 for(const value of [null,[],{unknown:'high'},{pi:'high'},{opencode:3}])assert.throws(()=>route({...r,reasoningByWorker:value}),/per-harness/);
});
