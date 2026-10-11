import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-connect-'));
process.env.CODEX_HOME=path.join(dir,'codex-state');process.env.HARNESS_BRIDGE_HOME=path.join(dir,'bridge');process.env.PI_CODING_AGENT_DIR=path.join(dir,'pi-state');process.env.OPENCODE_CONFIG_DIR=path.join(dir,'opencode-state');process.env.DSH_HOME=path.join(dir,'dsh-state');
const oldPath=process.env.PATH;process.env.PATH=dir;
for(const [name,version]of Object.entries({pi:'1.1.0',opencode:'1.18.34',codex:'0.160.1',dsh:'0.2.0-rc.2'})){
 const file=path.join(dir,name);await writeFile(file,`#!${process.execPath}\nconsole.log(${JSON.stringify(version)});`);await chmod(file,0o755);
}
const {saveAndConnect,connectionStatus}=await import('../lib/connections.mjs');
test('save connects installed compatible parents without a global workspace or credential changes',async()=>{
 const profile=path.join(process.env.DSH_HOME,'profiles','web');await mkdir(profile,{recursive:true});await writeFile(path.join(profile,'cordis.patch.yml'),'# User setting\n- replace:\n    id: provider-example\n    config:\n      apiKeyEnv: EXAMPLE_API_KEY\n');
 const config={routes:[{id:'r',parents:['pi'],workers:['opencode'],models:[],task:'Auto',reasoning:'',usage:'can',enabled:true}]};
 const result=await saveAndConnect(config);assert.equal(result.saved,true);assert.deepEqual(result.warnings,[]);
 assert.equal(result.connections.pi.current,true);assert.equal(result.connections.opencode.current,true);assert.equal(result.connections.deepseek.current,true);assert.equal(result.connections.codex.mode,'native');
 assert.equal(result.config.workspace,'');const patch=await readFile(path.join(profile,'cordis.patch.yml'),'utf8');assert.ok(patch.includes('# User setting'));assert.ok(patch.includes('EXAMPLE_API_KEY'));
 assert.equal((await saveAndConnect(config)).warnings.length,0);assert.equal((await connectionStatus()).deepseek.current,true);
});
test.after(async()=>{process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true});});
