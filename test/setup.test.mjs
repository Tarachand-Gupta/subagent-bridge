import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'jsonc-parser';
import {setupStatus,installSetup} from '../lib/setup.mjs';
const inventory=['codex','pi','opencode','deepseek','claude'].map(id=>({id,name:id,installed:true,version:id==='deepseek'?'0.2.0-rc.2':'1.1.0',compatibility:{supported:id!=='claude'},executable:id}));
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-setup-'));return {dir,options:{inventory,bridgeHome:path.join(dir,'bridge'),paths:Object.fromEntries(inventory.map(a=>[a.id,path.join(dir,a.id)])),run:async()=>{throw Object.assign(new Error('missing'),{code:1,stderr:'No MCP server named harness-bridge found'});}}};}
test('Pi MCP and skills are isolated, idempotent, preserve unrelated entries, and refuse user edits',async()=>{
 const {dir,options}=await fixture();try{
  const file=path.join(options.paths.pi,'mcp.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({mcpServers:{existing:{command:'other'}}}));
  let result=await installSetup('mcp','pi',options);assert.equal(result.mcp.entries.find(e=>e.id==='pi').installed,true);
  const first=await fs.readFile(file,'utf8');await installSetup('mcp','pi',options);assert.equal(await fs.readFile(file,'utf8'),first);assert.equal(JSON.parse(first).mcpServers.existing.command,'other');
  result=await installSetup('skills','pi',options);assert.equal(result.skills.entries.find(e=>e.id==='pi').installed,true);
  const skill=result.skills.entries.find(e=>e.id==='pi').path;await fs.appendFile(skill,'\nUser added content.');await assert.rejects(installSetup('skills','pi',options),/not managed/);assert.match(await fs.readFile(skill,'utf8'),/User added content/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('OpenCode edits JSONC minimally and respects an unrelated collision from the JSON fallback',async()=>{
 const {dir,options}=await fixture();try{
  const file=path.join(options.paths.opencode,'opencode.jsonc');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'{\n // keep this comment\n "theme": "system",\n "mcp": {"original": {"type":"local","command":["other"]}},\n}\n');
  const result=await installSetup('mcp','opencode',options);assert.equal(result.mcp.entries.find(e=>e.id==='opencode').installed,true);const text=await fs.readFile(file,'utf8');assert.match(text,/keep this comment/);assert.equal(parse(text).mcp.original.command[0],'other');
  await fs.writeFile(file,'{}');await fs.writeFile(file.slice(0,-1),JSON.stringify({mcp:{'harness-bridge':{type:'remote',url:'https://example.com'}}}));await assert.rejects(installSetup('mcp','opencode',options),/not managed/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('DeepSeek MCP preserves profile YAML tags and native insertion rows across all supported profiles',async()=>{
 const {dir,options}=await fixture();try{
  const file=path.join(options.paths.deepseek,'profiles','web','cordis.patch.yml');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'# keep provider\n- replace:\n    id: provider\n    config:\n      apiKey: !!js process.env.MY_TOKEN\n');
  const result=await installSetup('mcp','deepseek',options);assert.equal(result.mcp.entries.find(e=>e.id==='deepseek').installed,true);const text=await fs.readFile(file,'utf8');assert.match(text,/!!js process.env.MY_TOKEN/);assert.match(text,/# keep provider/);assert.match(text,/dsh-mcp-client/);
  await installSetup('mcp','deepseek',options);assert.equal(await fs.readFile(file,'utf8'),text);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('unavailable harnesses and symlink skill folders cannot be installed',async()=>{
 const {dir,options}=await fixture();try{
  assert.equal((await setupStatus(options)).mcp.entries.find(e=>e.id==='claude').available,false);
  await assert.rejects(installSetup('mcp','claude',options));
  const folder=path.join(options.paths.pi,'skills','harness-bridge');await fs.mkdir(path.dirname(folder),{recursive:true});await fs.mkdir(path.join(dir,'user-folder'));await fs.symlink(path.join(dir,'user-folder'),folder);await assert.rejects(installSetup('skills','pi',options),/symlink/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('setup distinguishes installed managed entries from current build and refreshes external removals',async()=>{
 const {dir,options}=await fixture();try{
  await installSetup('mcp','pi',options);await installSetup('skills','pi',options);
  const newer={...options,bridgeRoot:path.join(dir,'new-build')};
  let status=await setupStatus(newer);
  for(const kind of ['mcp','skills']){const entry=status[kind].entries.find(e=>e.id==='pi');assert.equal(entry.installed,true);assert.equal(entry.current,false);assert.equal(entry.available,true);await installSetup(kind,'pi',newer);}
  status=await setupStatus(newer);for(const kind of ['mcp','skills'])assert.equal(status[kind].entries.find(e=>e.id==='pi').current,true);
  await fs.rm(status.skills.entries.find(e=>e.id==='pi').path);assert.equal((await setupStatus(newer)).skills.entries.find(e=>e.id==='pi').installed,false);
  const texts=(await setupStatus(newer)).skills.entries.filter(e=>e.configText).map(e=>e.configText);assert.equal(new Set(texts).size,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
