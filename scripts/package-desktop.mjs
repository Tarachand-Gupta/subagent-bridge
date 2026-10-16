import {spawnSync} from '../lib/process.mjs';
import {mkdtemp,cp,symlink,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireDeveloperId,signMacApp,signMacDmg} from './sign-macos.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:root,stdio:'inherit',...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} exited ${result.status}`);}
const npm=process.platform==='win32'?'npm.cmd':'npm';
const identity=process.env.APPLE_SIGNING_IDENTITY;
if(process.platform==='darwin'&&identity)requireDeveloperId(identity);
// Signing must include native npm modules before the outer app is sealed.
// Do not let Tauri notarize the bundle before those modules are signed.
const buildEnv={...process.env};
if(buildEnv.CARGO_TARGET_DIR)buildEnv.CARGO_TARGET_DIR=path.resolve(root,buildEnv.CARGO_TARGET_DIR);
if(process.platform==='darwin'){
 for(const key of ['APPLE_ID','APPLE_PASSWORD','APPLE_TEAM_ID','APPLE_API_KEY','APPLE_API_ISSUER','APPLE_API_KEY_PATH'])delete buildEnv[key];
 buildEnv.APPLE_SIGNING_IDENTITY='-';
}
run(npm,['exec','--','tauri','build','--ci',...(process.platform==='darwin'?['--bundles','app']:[])],{env:buildEnv});
if(process.platform==='darwin'){
 const config=JSON.parse(await readFile(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));
 const target=process.env.CARGO_TARGET_DIR?path.resolve(root,process.env.CARGO_TARGET_DIR):path.join(root,'src-tauri/target');
 const app=path.join(target,`release/bundle/macos/${config.productName}.app`);
 const signature=spawnSync('codesign',['-d','--verbose',app],{encoding:'utf8'});
 // Seal preview resources without replacing an existing Developer ID signature.
 // Ad-hoc signing provides integrity, not Apple identity or notarization.
 if(identity)await signMacApp(app,identity);
 else if(signature.status!==0||signature.stderr.includes('Signature=adhoc'))run('codesign',['--force','--sign','-','--timestamp=none',app]);
 run('codesign',['--verify','--deep','--strict',app]);
 const stage=await mkdtemp(path.join(tmpdir(),'harness-bridge-dmg-'));
 try{
  run('ditto',[app,path.join(stage,`${config.productName}.app`)]);
  await cp(path.join(root,'docs/install-macos.md'),path.join(stage,'Read Me.txt'));
  await symlink('/Applications',path.join(stage,'Applications'));
  const output=path.join(target,'release/bundle/dmg');await mkdir(output,{recursive:true});
  const dmg=path.join(output,`${config.productName}_${config.version}_${process.arch}.dmg`);
  run('hdiutil',['create','-volname',config.productName,'-srcfolder',stage,'-ov','-format','UDZO',dmg]);
  if(identity)signMacDmg(dmg,identity);
  console.log(identity?'Developer ID signed. Complete notarization and staple/validate the ticket before publishing.':'Local ad-hoc build only; not Developer ID signed or notarized.');
 }finally{await rm(stage,{recursive:true,force:true});}
}
