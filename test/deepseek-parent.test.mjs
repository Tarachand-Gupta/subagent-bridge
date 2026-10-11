import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {mountIntegration,readRuntimeVersion} from '../harnesses/deepseek/v0_2_rc2/plugin.mjs';import {installDeepSeekIntegration,deepseekIntegrationStatus,supportedVersion} from '../harnesses/deepseek/integration.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-dsh-parent-test-'));
test('DeepSeek native jobs immediately retain ownership, completion and cancellation',async()=>{
 const tools=new Map(),jobs=[],sections=[];let resolveCall;const calls=[];
 const ctx={tools:{register(t){tools.set(t.name,t);}},jobs:{list(owner){return jobs.filter(j=>j.owner===owner).map((j,index)=>({id:'subagent-'+(index+1),status:'running'}));},start(spec){jobs.push(spec);spec.handle=spec.run();return 'subagent-'+jobs.length;}},systemPrompt:{getSectionOrder:()=>1,section:s=>sections.push(s)}};
 const config={runtimeVersion:supportedVersion,bridgeHome:dir,callBridge:(args,cwd,options)=>{calls.push({args,cwd,options});if(args[0]==='routes')return Promise.resolve([{id:'x'}]);return new Promise(resolve=>{resolveCall=resolve;});}};
 mountIntegration(ctx,config,supportedVersion);const exec={agent:{id:'parent-A',session:{header:{cwd:dir}}},signal:new AbortController().signal};
 const result=await tools.get('bridge_delegate').execute({route:'x',task:'research',worker:'opencode',model:'allowed'},exec);
 assert.equal((await tools.get('bridge_delegate').execute({route:'x',task:'research',worker:'opencode',model:'allowed'},exec)).reused,true);assert.equal(jobs.length,1);
 assert.equal(result.status,'running');assert.equal(jobs[0].owner,'parent-A');assert.equal(calls[0].cwd,dir);assert.deepEqual(calls[0].args.slice(-4),['--worker','opencode','--model','allowed']);
 resolveCall({text:'result',worker:'opencode',model:'allowed'});const completed=await jobs[0].handle.done;assert.equal(completed.status,'completed');assert.equal(JSON.parse(completed.result).text,'result');assert.equal(JSON.parse(completed.result).conversationId,result.conversationId);
 await assert.rejects(tools.get('bridge_delegate').execute({route:'x',task:'research'},{agent:{id:'B'}}),/project folder/);
 const second={...exec,agent:{id:'parent-B',session:{header:{cwd:path.dirname(dir)}}}};await tools.get('bridge_delegate').execute({route:'x',task:'other'},second);assert.equal(jobs[1].owner,'parent-B');assert.equal(calls[1].cwd,path.dirname(dir));jobs[1].handle.cancel();assert.equal(calls[1].options.signal.aborted,true);resolveCall({text:'late'});await jobs[1].handle.done;
});
test('DeepSeek rules update in native prompt section and unsupported runtimes fail closed',async()=>{
 let section;const ctx={tools:{register(){}},jobs:{},systemPrompt:{getSectionOrder:()=>1,section:s=>section=s}};
 assert.throws(()=>mountIntegration(ctx,{runtimeVersion:'future'},supportedVersion),/unsupported/);mountIntegration(ctx,{runtimeVersion:supportedVersion,bridgeHome:dir},supportedVersion);
 await writeFile(path.join(dir,'config.json'),JSON.stringify({routes:[{id:'first',enabled:true,parents:['deepseek']},{id:'other',enabled:true,parents:['pi']}]}));assert.match(section.text(),/first/);assert.doesNotMatch(section.text(),/"id":"other"/);
 await writeFile(path.join(dir,'config.json'),JSON.stringify({routes:[{id:'updated',enabled:true,parents:[]}]}));assert.match(section.text(),/updated/);assert.doesNotMatch(section.text(),/"id":"first"/);
});
test('DeepSeek runtime verifies the installed package rather than a saved claimed version',async()=>{
 const resources=path.join(dir,'resources');const file=path.join(resources,'app.asar/dsh/node_modules/@deepseek-ai/dsh-subagent/package.json');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify({version:'future'}));assert.equal(readRuntimeVersion(resources),'future');assert.throws(()=>mountIntegration({}, {runtimeVersion:supportedVersion},readRuntimeVersion(resources)),/unsupported/);assert.equal(readRuntimeVersion(path.join(dir,'missing')),null);
});
test('DeepSeek installer preserves unrelated profile nodes and is version gated',async()=>{
 const profile=path.join(dir,'profile');await mkdir(profile);const file=path.join(profile,'cordis.patch.yml');await writeFile(file,'# existing settings\n- id: existing\n  config:\n    untouched: true\n');const opts={version:supportedVersion,profileDirectory:profile,bridgeHome:dir};
 await assert.rejects(installDeepSeekIntegration({...opts,version:'new'}),/requires verified/);await installDeepSeekIntegration(opts);await installDeepSeekIntegration(opts);const content=await readFile(file,'utf8');assert.match(content,/# existing settings/);assert.match(content,/untouched: true/);assert.equal((content.match(/id: harness-bridge-rc2/g)||[]).length,1);assert.equal((await deepseekIntegrationStatus(opts)).current,true);
});
test.after(async()=>{await rm(dir,{recursive:true,force:true});});

test('DeepSeek followups preserve worker conversation and reject another native owner',async()=>{
 const tools=new Map(),jobs=[],runs=[],closed=[];
 const ctx={tools:{register(t){tools.set(t.name,t);}},jobs:{list(){return jobs.map((j,i)=>({id:'subagent-'+(i+1),status:'running'}));},start(spec){jobs.push(spec);spec.handle=spec.run();return 'subagent-'+jobs.length;}},systemPrompt:{getSectionOrder:()=>1,section(){}}};
 mountIntegration(ctx,{runtimeVersion:supportedVersion,bridgeHome:dir,createHost:()=>({run(params,options){return new Promise(resolve=>runs.push({params,options,resolve}));},closeConversation(id){closed.push(id);},close(){}})},supportedVersion);
 const exec={agent:{id:'A',session:{header:{cwd:dir}}}};
 const first=await tools.get('bridge_delegate').execute({route:'r',task:'remember'},exec);
 const next=await tools.get('bridge_message').execute({jobId:first.jobId,message:'recall'},exec);
 assert.equal(first.conversationId,next.conversationId);assert.equal(runs[0].params.conversationId,runs[1].params.conversationId);assert.equal(next.delivery,'queued');
 await assert.rejects(tools.get('bridge_message').execute({jobId:first.jobId,message:'steal'},{agent:{id:'B',session:{header:{cwd:dir}}}}),/No such/);
 runs[0].resolve({sessionId:'same',text:'READY'});runs[1].resolve({sessionId:'same',text:'secret'});
 const results=await Promise.all(jobs.map(j=>j.handle.done));assert.ok(results.every(r=>JSON.parse(r.result).sessionId==='same'));
 const third=await tools.get('bridge_message').execute({jobId:first.jobId,message:'again'},exec);jobs[2].handle.cancel();assert.equal(closed[0],first.conversationId);runs[2].resolve({text:'late'});await jobs[2].handle.done;
 await assert.rejects(tools.get('bridge_message').execute({jobId:third.jobId,message:'again'},exec),/cancelled/);
});
