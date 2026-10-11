import {spawnSync} from '../lib/process.mjs';
import {cp,mkdir,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target=path.join(root,'.runtime');
const npm=process.platform==='win32'?'npm.cmd':'npm';
const result=spawnSync(npm,['ls','--omit=dev','--all','--parseable'],{cwd:root,encoding:'utf8'});
if(result.error||result.status!==0)throw result.error||new Error(result.stderr||'Dependency staging failed');
const dependencies=result.stdout.trim().split(/\r?\n/).filter(p=>p!==root);
await rm(target,{recursive:true,force:true});await mkdir(path.join(target,'node_modules'),{recursive:true});
// Preserve npm's relative layout, including nested dependency versions and platform binaries.
for(const directory of dependencies){
 const relative=path.relative(root,directory);
 if(relative.startsWith('..')||!relative.startsWith('node_modules'+path.sep))throw new Error('Unexpected dependency outside project');
 await cp(directory,path.join(target,relative),{recursive:true,dereference:true});
}
console.log(`Staged ${dependencies.length} production dependency directories for desktop packaging.`);
