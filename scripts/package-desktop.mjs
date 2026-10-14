import {spawnSync} from '../lib/process.mjs';
import {mkdtemp,cp,symlink,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function run(command,args){const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} exited ${result.status}`);}
const npm=process.platform==='win32'?'npm.cmd':'npm';
run(npm,['exec','--','tauri','build','--ci',...(process.platform==='darwin'?['--bundles','app']:[])]);
if(process.platform==='darwin'){
 const config=JSON.parse(await readFile(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));
 const app=path.join(root,`src-tauri/target/release/bundle/macos/${config.productName}.app`);
 const signature=spawnSync('codesign',['-d','--verbose',app],{encoding:'utf8'});
 // Seal preview resources without replacing an existing Developer ID signature.
 // Ad-hoc signing provides integrity, not Apple identity or notarization.
 if(signature.status!==0||signature.stderr.includes('Signature=adhoc'))run('codesign',['--force','--sign','-','--timestamp=none',app]);
 run('codesign',['--verify','--deep','--strict',app]);
 const stage=await mkdtemp(path.join(tmpdir(),'harness-bridge-dmg-'));
 try{
  await cp(app,path.join(stage,`${config.productName}.app`),{recursive:true});
  await cp(path.join(root,'docs/install-macos.md'),path.join(stage,'Read Me.txt'));
  await symlink('/Applications',path.join(stage,'Applications'));
  const output=path.join(root,'src-tauri/target/release/bundle/dmg');await mkdir(output,{recursive:true});
  run('hdiutil',['create','-volname',config.productName,'-srcfolder',stage,'-ov','-format','UDZO',path.join(output,`${config.productName}_${config.version}_${process.arch}.dmg`)]);
 }finally{await rm(stage,{recursive:true,force:true});}
}
