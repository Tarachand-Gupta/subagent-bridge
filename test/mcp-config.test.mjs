import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture={version:1,workspace:'legacy-preserved',inheritWorkspace:false,routes:[
 {id:'untouched',parents:['codex'],workers:['pi'],models:[],reasoning:'high',task:'Review',enabled:false,usage:'can'},
 {id:'edit',parents:['pi'],workers:['opencode'],models:[{worker:'opencode',id:'provider/model'}],reasoning:'',reasoningByWorker:{opencode:'high'},task:'Research',enabled:true,usage:'should'}
]};
async function setup(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'bridge-mcp-'));
 await writeFile(path.join(dir,'config.json'),JSON.stringify(fixture));
 const runner=path.join(dir,'server.mjs');
 // Real stdio MCP + real shared filesystem CAS; replace harness installer to avoid modifying user's integrations.
 await writeFile(runner,`import {serveConfigMcp} from ${JSON.stringify(pathToFileURL(path.join(root,'lib/mcp-config.mjs')).href)};
 import {save} from ${JSON.stringify(pathToFileURL(path.join(root,'lib/core.mjs')).href)};
 await serveConfigMcp({inventory:async()=>[{id:'pi',name:'Pi',installed:true,version:'1.0',acpReady:true}],status:async()=>({pi:{current:true}}),catalog:async()=>({models:[{id:'provider/model',name:'Example',reasoning:['high']}],currentModel:'provider/model',source:'test catalog',verified:false}),commit:async(value,options)=>({config:await save(value,options),saved:true,message:'Saved and connected test integrations.',connections:{pi:{current:true}},warnings:[]})});`);
 const clients=[];
 async function client(command=runner){
  const transport=new StdioClientTransport({command:process.execPath,args:command===runner?[runner]:[command,'mcp'],env:{...process.env,HARNESS_BRIDGE_HOME:dir},stderr:'pipe'});
  const client=new Client({name:'bridge-config-test',version:'1.0.0'},{capabilities:{}});
  await client.connect(transport);clients.push(client);return client;
 }
 t.after(async()=>{await Promise.all(clients.map(c=>c.close()));await rm(dir,{recursive:true,force:true});});
 return {dir,client};
}
async function call(client,name,args={}){
 const answer=await client.callTool({name,arguments:args});return {answer,data:JSON.parse(answer.content[0].text)};
}

test('real stdio client initializes, pings, reads complete config, previews without writes, and CAS saves',async t=>{
 const {dir,client}=await setup(t),c=await client();
 assert.equal(c.getServerVersion().name,'harness-bridge-config');
 await c.ping();
 assert.deepEqual(c.getServerCapabilities().resources,{});
 assert.deepEqual(await c.listResources(),{resources:[]});
 assert.deepEqual(await c.listResourceTemplates(),{resourceTemplates:[]});
 const listed=await c.listTools();assert.deepEqual(listed.tools.map(t=>t.name),['bridge_agents_list','bridge_models_list','bridge_config_read','bridge_config_preview','bridge_config_save']);
 assert.equal(listed.tools[4].annotations.readOnlyHint,false);
 const inventory=(await call(c,'bridge_agents_list')).data;assert.equal(inventory.agents[0].connection.current,true);
 const models=(await call(c,'bridge_models_list',{harness:'pi'})).data;assert.equal(models.models[0].id,'provider/model');
 assert.equal((await call(c,'bridge_models_list',{harness:'unknown'})).answer.isError,true);
 const read=(await call(c,'bridge_config_read')).data;
 assert.match(read.revision,/^[a-f0-9]{64}$/);assert.equal(read.config.workspace,'legacy-preserved');
 const before=await readFile(path.join(dir,'config.json'),'utf8');
 const changed=structuredClone(read.config);changed.routes[1].reasoningByWorker.opencode='low';
 const preview=(await call(c,'bridge_config_preview',{config:changed})).data;
 assert.equal(preview.saved,false);assert.equal(preview.revision,read.revision);assert.match(preview.instructions[1],/opencode: low/);
 assert.equal(preview.changes.length,1);assert.equal(preview.changes[0].id,'edit');assert.equal(await readFile(path.join(dir,'config.json'),'utf8'),before);
 const saved=(await call(c,'bridge_config_save',{config:changed,expectedRevision:read.revision})).data;
 assert.equal(saved.saved,true);assert.equal(saved.connections.pi.current,true);assert.equal(saved.revision,preview.proposedRevision);
 assert.deepEqual(saved.config.routes[0],read.config.routes[0]);assert.equal(saved.config.workspace,read.config.workspace);assert.equal(saved.config.inheritWorkspace,false);
 assert.equal((await call(c,'bridge_config_read')).data.revision,saved.revision);
});

test('stale revision and malformed updates preserve saved config; concurrent clients cannot both overwrite',async t=>{
 const {dir,client}=await setup(t),a=await client(),b=await client();
 const snapshot=(await call(a,'bridge_config_read')).data;
 const first=structuredClone(snapshot.config),second=structuredClone(snapshot.config);first.routes[1].task='First';second.routes[1].task='Second';
 const responses=await Promise.all([call(a,'bridge_config_save',{config:first,expectedRevision:snapshot.revision}),call(b,'bridge_config_save',{config:second,expectedRevision:snapshot.revision})]);
 assert.equal(responses.filter(r=>r.data.saved).length,1);assert.equal(responses.filter(r=>r.data.error?.code==='CONFIG_CONFLICT').length,1);
 const before=await readFile(path.join(dir,'config.json'),'utf8');
 for(const args of [{config:first},{config:{...first,apiKey:'must-never-echo'},expectedRevision:snapshot.revision},{config:{...first,routes:[{...first.routes[0],reasoningByWorker:{unknown:'high'}}]},expectedRevision:snapshot.revision}]){
  const r=await call(a,'bridge_config_save',args);assert.equal(r.answer.isError,true);assert.doesNotMatch(JSON.stringify(r),/must-never-echo/);
 }
 assert.equal(await readFile(path.join(dir,'config.json'),'utf8'),before);
});

test('actual CLI MCP dispatch serves initialization/read/preview without stdout noise',async t=>{
 const {client}=await setup(t),c=await client(path.join(root,'bin.mjs'));
 const read=(await call(c,'bridge_config_read')).data;assert.equal(read.ok,true);
 const preview=(await call(c,'bridge_config_preview',{config:read.config})).data;assert.deepEqual(preview.changes,[]);
});


test('ordinary app save invalidates MCP draft revision under the same writer lock',async t=>{
 const {dir,client}=await setup(t),c=await client();
 const read=(await call(c,'bridge_config_read')).data;
 const updated=structuredClone(read.config);updated.routes[0].enabled=true;
 const writer=path.join(dir,'app-save.mjs');
 await writeFile(writer,`import {save} from ${JSON.stringify(pathToFileURL(path.join(root,'lib/core.mjs')).href)}; await save(${JSON.stringify(updated)});`);
 await promisify(execFile)(process.execPath,[writer],{env:{...process.env,HARNESS_BRIDGE_HOME:dir}});
 const stale=await call(c,'bridge_config_save',{config:read.config,expectedRevision:read.revision});
 assert.equal(stale.data.error.code,'CONFIG_CONFLICT');
 const latest=(await call(c,'bridge_config_read')).data;assert.equal(latest.config.routes[0].enabled,true);
 const saved=await call(c,'bridge_config_save',{config:latest.config,expectedRevision:latest.revision});assert.equal(saved.data.saved,true);
});
