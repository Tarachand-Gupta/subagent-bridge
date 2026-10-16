import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createOpenCodePlugin} from '../harnesses/opencode/v1/plugin.mjs';
import {installOpenCodeIntegration,opencodeIntegrationStatus} from '../harnesses/opencode/v1/integration.mjs';
const tool=Object.assign(x=>x,{schema:{string:()=>({optional(){return this;},describe(){return this;}})}});

test('OpenCode tools inherit each tool context and inject fresh per-session rules',async()=>{
 const calls=[],deliveries=[],closed=[];let notify,version=1;
 const hooks=await createOpenCodePlugin({tool,readVersion:async()=>'1.18.34',makeBridge:options=>{notify=options.notify;return{execute:async(name,args,ctx)=>{calls.push({name,args,ctx});return{version};},closeSession:ctx=>closed.push(ctx),close:()=>closed.push('all')};}})({client:{session:{get:async({path:{id}})=>({data:{directory:'/projects/'+id}}),promptAsync:async req=>{deliveries.push(req);return{};}}},directory:'/wrong/startup-folder'});
 const first={system:[]};await hooks['experimental.chat.system.transform']({sessionID:'a'},first);
 version=2;const second={system:[]};await hooks['experimental.chat.system.transform']({sessionID:'b'},second);
 assert.match(first.system[0],/"version":1/);assert.match(second.system[0],/"version":2/);
 await hooks.tool.bridge_delegate.execute({route:'r',task:'work'},{sessionID:'b',directory:'/projects/explicit-b'});
 assert.deepEqual(calls.at(-1).ctx,{sessionId:'b',cwd:'/projects/explicit-b'});
 await notify({jobId:'result-b'},calls.at(-1).ctx);
 assert.equal(deliveries[0].path.id,'b');assert.equal(deliveries[0].query.directory,'/projects/explicit-b');assert.match(deliveries[0].body.parts[0].text,/result-b/);
 await hooks.event({event:{type:'session.deleted',properties:{info:{id:'b'}}}});assert.deepEqual(closed[0],{sessionId:'b',cwd:'/projects/explicit-b'});
 await hooks.event({event:{type:'server.instance.disposed',properties:{directory:'/wrong/startup-folder'}}});assert.equal(closed[1],'all');
});
test('OpenCode workers expose no recursive parent tools',async()=>{
 const before=process.env.HARNESS_BRIDGE_DEPTH;process.env.HARNESS_BRIDGE_DEPTH='1';
 try{assert.deepEqual(await createOpenCodePlugin({tool})({client:{}}),{});}finally{if(before===undefined)delete process.env.HARNESS_BRIDGE_DEPTH;else process.env.HARNESS_BRIDGE_DEPTH=before;}
});
test('OpenCode install is idempotent and refuses unrelated plugin overwrite',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'bridge-opencode-install-')),before=process.env.OPENCODE_CONFIG_DIR;process.env.OPENCODE_CONFIG_DIR=temporary;
 // Exercise installation behavior independently of binaries on the host PATH.
 const options={version:'1.18.34'};
 try{await mkdir(path.join(temporary,'plugins'));const file=path.join(temporary,'plugins','harness-bridge.ts');await writeFile(file,'// user plugin\n');await assert.rejects(installOpenCodeIntegration(options),/unrelated/);assert.equal(await readFile(file,'utf8'),'// user plugin\n');await rm(file);const first=await installOpenCodeIntegration(options);assert.equal(first.reloadRequired,true);assert.equal((await installOpenCodeIntegration(options)).reloadRequired,false);assert.equal((await opencodeIntegrationStatus()).current,true);}finally{if(before===undefined)delete process.env.OPENCODE_CONFIG_DIR;else process.env.OPENCODE_CONFIG_DIR=before;await rm(temporary,{recursive:true,force:true});}
});

test('OpenCode runtime rejects major drift without registering tools',async()=>{const hooks=await createOpenCodePlugin({tool,readVersion:async()=>'2.0.0'})({client:{}});assert.equal(hooks.tool,undefined);const output={system:[]};await hooks['experimental.chat.system.transform']({},output);assert.match(output.system[0],/disabled/);await assert.rejects(installOpenCodeIntegration({version:'2.0.0'}),/not supported/);});

test('OpenCode native message tool preserves one conversation and delivers each turn to its owner',async()=>{
 const pending=[],notifications=[],hosts=[];
 const hooks=await createOpenCodePlugin({tool,readVersion:async()=>'1.18.34',bridgeOptions:{createHost:ctx=>{const host={ctx,run(args,{signal}){return new Promise(resolve=>pending.push({args,signal,resolve}));},closeConversation(){},async close(){}};hosts.push(host);return host;}}})({client:{session:{promptAsync:async request=>{notifications.push(request);return{};}}}});
 const ctx={sessionID:'native-a',directory:'/projects/a'};
 const first=JSON.parse(await hooks.tool.bridge_delegate.execute({route:'r',task:'remember token'},ctx));
 const queued=JSON.parse(await hooks.tool.bridge_message.execute({jobId:first.jobId,message:'recall token'},ctx));
 assert.equal(queued.delivery,'queued');assert.equal(queued.conversationId,first.conversationId);assert.equal(pending[1].args.conversationId,pending[0].args.conversationId);
 await assert.rejects(hooks.tool.bridge_message.execute({jobId:first.jobId,message:'leak'},{sessionID:'native-b',directory:'/projects/a'}),/No such job/);
 pending[0].resolve({text:'READY',sessionId:'same-worker'});await new Promise(r=>setImmediate(r));pending[1].resolve({text:'token',sessionId:'same-worker'});await new Promise(r=>setImmediate(r));
 assert.equal(notifications.length,2);assert.ok(notifications.every(n=>n.path.id==='native-a'&&n.query.directory==='/projects/a'));assert.match(notifications[1].body.parts[0].text,/same-worker/);
 await hooks.event({event:{type:'server.instance.disposed',properties:{}}});
});
