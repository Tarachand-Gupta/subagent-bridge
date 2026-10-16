import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,cp,rm,symlink,open,access} from 'node:fs/promises';
import {spawnSync} from '../lib/process.mjs';
import {signMacDmg} from './sign-macos.mjs';
import {sha256,readJson,writeJson,notarize,chooseIdentity,validateVersions,assertPublishable} from './notarize-macos.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const flags=new Set(process.argv.slice(2));
const help=`Usage: npm run release:mac -- [--check] [--publish] [--stable]

Build, sign, notarize, staple and verify the app and DMG on this Mac.
--check    Check tools, versions, certificate and Keychain authentication only.
--publish Upload verified assets to a GitHub draft, download and check them,
          then publish. Requires an existing remote vVERSION tag at HEAD.
--stable  Publish a stable release (default: prerelease).

Credentials stay in Keychain. APPLE_SIGNING_IDENTITY is optional when exactly
one Developer ID Application identity exists. APPLE_NOTARY_PROFILE defaults
to subagent-bridge-notary. Rerun the command to resume the same submission.
`;

function run(command,args,{cwd=root,env=process.env,json=false,capture=false,timeout,...options}={}){
 const result=spawnSync(command,args,{cwd,env,encoding:'utf8',maxBuffer:32*1024*1024,timeout,
  stdio:json||capture?['ignore','pipe','pipe']:'inherit',...options});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`${command} ${args[0]??''} failed (${result.status}): ${result.stderr?.trim()??''}`);
 if(json)return JSON.parse(result.stdout);
 return capture?result.stdout.trim():result;
}
const text=(command,args,options={})=>run(command,args,{...options,capture:true});
const jsonFile=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
async function exists(file){try{await access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

function verifyApp(app,identity,cdhash){
 run('codesign',['--verify','--deep','--strict',app]);
 const signature=spawnSync('codesign',['-d','--verbose=4',app],{encoding:'utf8'});
 const hash=signature.stderr?.match(/^CDHash=(.+)$/m)?.[1];
 if(signature.status!==0||!signature.stderr.includes(`Authority=${identity}\n`)||!hash||!signature.stderr.includes('runtime'))throw new Error('App signature is missing the expected Developer ID, hardened runtime, or code hash.');
 if(cdhash&&hash!==cdhash)throw new Error('The app changed since signing; refusing to continue.');
 return hash;
}

function verifyStapledApp(app,identity,cdhash){
 verifyApp(app,identity,cdhash);
 run('xcrun',['stapler','validate',app]);
 run('spctl',['--assess','--type','execute','--verbose=4',app]);
 run('syspolicy_check',['distribution',app]);
}

async function verifyDmg(dmg,{directory,product,identity,cdhash}){
 run('codesign',['--verify','--strict',dmg]);
 run('xcrun',['stapler','validate',dmg]);
 run('spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=4',dmg]);
 const mount=path.join(directory,'mounted');await mkdir(mount,{recursive:true});
 run('hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount]);
 try{verifyStapledApp(path.join(mount,`${product}.app`),identity,cdhash);}
 finally{run('hdiutil',['detach',mount]);}
}

async function main(){
 if(flags.has('--help')){console.log(help);return;}
 for(const flag of flags)if(!['--check','--publish','--stable'].includes(flag))throw new Error(`Unknown option: ${flag}\n${help}`);
 if(process.platform!=='darwin')throw new Error('Mac releases must run on a Mac with Xcode, Developer ID and notarization credentials.');
 if(process.env.CARGO_BUILD_TARGET)throw new Error('Cross-compilation is not supported by this release command; use a Mac of the release architecture.');
 const pkg=await jsonFile('package.json'),tauri=await jsonFile('src-tauri/tauri.conf.json');
 const version=validateVersions({pkg,tauri,lock:await jsonFile('package-lock.json'),cargo:await readFile(path.join(root,'src-tauri/Cargo.toml'),'utf8'),cargoLock:await readFile(path.join(root,'src-tauri/Cargo.lock'),'utf8')});
 const identity=chooseIdentity(text('security',['find-identity','-v','-p','codesigning']),process.env.APPLE_SIGNING_IDENTITY);
 const profile=process.env.APPLE_NOTARY_PROFILE||'subagent-bridge-notary';
 for(const command of ['codesign','hdiutil','ditto','syspolicy_check','cargo','npm'])text('/usr/bin/which',[command]);
 run('xcrun',['notarytool','history','--keychain-profile',profile,'--output-format','json'],{json:true,timeout:60000});
 console.log(`Ready: v${version} (${process.arch}); ${identity}; Keychain profile ${profile}.`);
 if(flags.has('--check'))return;
 if(text('git',['status','--porcelain','--untracked-files=normal']))throw new Error('Commit or stash source changes first. Releases are built from an immutable Git snapshot.');
 const commit=text('git',['rev-parse','HEAD']),tag=`v${version}`;
 const directory=path.join(root,'.dev-state/releases',`${tag}-${process.arch}-${commit.slice(0,12)}`);
 await mkdir(directory,{recursive:true});
 const lockFile=path.join(directory,'release.lock');
 const lock=await open(lockFile,'wx').catch(error=>{if(error.code==='EEXIST')throw new Error(`Another release may be running. Check ${lockFile}; remove it only after confirming its process and children have stopped.`);throw error;});
 await lock.writeFile(`${process.pid}\n`);await lock.close();
 try{
  const stateFile=path.join(directory,'release.json');
  const inputs={schema:1,commit,version,arch:process.arch,identity,profile};
  const state=await readJson(stateFile)||{inputs,steps:[]};
  if(JSON.stringify(state.inputs)!==JSON.stringify(inputs))throw new Error('Release inputs changed. Restore the previous identity/profile or use a new source commit.');
  const save=()=>writeJson(stateFile,state);
  await save();
  const step=async(name,action)=>{if(!state.steps.includes(name)){console.log(`\n→ ${name}`);await action();state.steps.push(name);await save();}};
  const source=path.join(directory,'source'),assets=path.join(directory,'assets');
  const app=path.join(directory,`${tauri.productName}.app`),zip=path.join(directory,'app.zip');
  const submittedDmg=path.join(directory,'submitted.dmg');
  const dmgName=`Subagent-Bridge_${version}_${process.arch}.dmg`,dmg=path.join(assets,dmgName);
  const cliName=`${pkg.name}-${version}.tgz`;
  const context={directory,product:tauri.productName,identity};
  let repo;
  async function releaseInfo(){return run('gh',['api',`repos/${repo}/releases?per_page=100`],{json:true}).find(item=>item.tag_name===tag);}
  async function publicationPreflight(checkVerified=false){
   repo=run('gh',['repo','view','--json','nameWithOwner'],{json:true}).nameWithOwner;
   const remote=text('git',['ls-remote','origin',`refs/tags/${tag}`,`refs/tags/${tag}^{}`]);
   const rows=remote.split('\n').map(row=>row.split(/\s+/));
   const tagCommit=(rows.find(row=>row[1]?.endsWith('^{}'))||rows[0])[0];
   const release=await releaseInfo();
   assertPublishable({tagCommit,commit,state:checkVerified?state:{...state,verified:true},release:release&&{id:release.id,isDraft:release.draft}});
   if(!await exists(path.join(root,`docs/releases/${tag}.md`)))throw new Error(`Write docs/releases/${tag}.md before publishing.`);
  }
  if(flags.has('--publish'))await publicationPreflight();
  await step('Snapshot source',async()=>{
   await rm(source,{recursive:true,force:true});await mkdir(source,{recursive:true});
   const archive=path.join(directory,'source.tar');
   run('git',['archive','--format=tar',`--output=${archive}`,commit]);
   run('tar',['-xf',archive,'-C',source]);
  });
  await step('Install and test',async()=>{run('npm',['ci'],{cwd:source});run('npm',['test'],{cwd:source});});
  await step('Build and sign app',async()=>{
   const target=path.join(directory,'target');
   run('npm',['run','desktop:package','--','--app-only'],{cwd:source,env:{...process.env,CARGO_TARGET_DIR:target,APPLE_SIGNING_IDENTITY:identity}});
   await rm(app,{recursive:true,force:true});
   run('ditto',[path.join(target,'release/bundle/macos',`${tauri.productName}.app`),app]);
   state.cdhash=verifyApp(app,identity);
  });
  context.cdhash=state.cdhash;verifyApp(app,identity,state.cdhash);
  await step('Archive signed app',async()=>{run('ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip]);});
  const appNotary=await notarize({file:zip,journal:path.join(directory,'app-notary.json'),profile,run});
  await step('Staple app',async()=>{run('xcrun',['stapler','staple',app]);});
  verifyStapledApp(app,identity,state.cdhash);
  await step('Create and sign DMG',async()=>{
   const stage=path.join(directory,'dmg-content');await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
   run('ditto',[app,path.join(stage,`${tauri.productName}.app`)]);
   await cp(path.join(source,'docs/install-macos.md'),path.join(stage,'Read Me.txt'));
   await symlink('/Applications',path.join(stage,'Applications'));
   run('hdiutil',['create','-volname',tauri.productName,'-srcfolder',stage,'-ov','-format','UDZO',submittedDmg]);
   signMacDmg(submittedDmg,identity);
  });
  const dmgNotary=await notarize({file:submittedDmg,journal:path.join(directory,'dmg-notary.json'),profile,run});
  await mkdir(assets,{recursive:true});
  await step('Staple final DMG',async()=>{await cp(submittedDmg,dmg);run('xcrun',['stapler','staple',dmg]);});
  await step('Package CLI',async()=>{run('npm',['pack','--pack-destination',assets],{cwd:source});});
  if(state.hashes)for(const [name,hash]of Object.entries(state.hashes))if(await sha256(path.join(assets,name))!==hash)throw new Error(`Verified release asset changed: ${name}`);
  state.verified=false;await save();
  await verifyDmg(dmg,context);
  state.hashes={[dmgName]:await sha256(dmg),[cliName]:await sha256(path.join(assets,cliName))};
  const sums=path.join(assets,'SHA256SUMS');
  await writeFile(sums,Object.entries(state.hashes).map(([name,hash])=>`${hash}  ${name}\n`).join(''));
  state.notarization={app:appNotary.id,dmg:dmgNotary.id};state.verified=true;await save();
  console.log(`\nVerified release assets: ${assets}`);
  if(!flags.has('--publish')){console.log('Nothing published. Use --publish once the matching release tag is on GitHub.');return;}
  await publicationPreflight(true);
  const files=[dmg,path.join(assets,cliName),sums];
  if(!state.releaseId){
   // If creation has an unknown outcome, stop and reconcile the draft explicitly.
   if(state.creatingDraft)throw new Error('Previous GitHub draft creation outcome is unknown. Inspect the draft and record its releaseId in release.json before resuming.');
   state.creatingDraft=true;await save();
   run('gh',['release','create',tag,'--repo',repo,'--verify-tag','--draft','--title',`Subagent Bridge ${tag}`,'--notes-file',path.join(source,`docs/releases/${tag}.md`),...(flags.has('--stable')?[]:['--prerelease'])]);
   const release=await releaseInfo();
   if(!release?.draft)throw new Error('Expected a GitHub draft release.');
   state.releaseId=release.id;await save();
  }
  for(const file of files){
   const name=path.basename(file);const release=await releaseInfo();
   if(!release?.draft||release.id!==state.releaseId)throw new Error('The GitHub draft changed; stopping.');
   if(!release.assets.some(asset=>asset.name===name))run('gh',['release','upload',tag,file,'--repo',repo]);
  }
  const download=path.join(directory,'download');await mkdir(download,{recursive:true});
  for(const file of files){
   const name=path.basename(file);
   run('gh',['release','download',tag,'--repo',repo,'--pattern',name,'--dir',download,'--clobber']);
   if(await sha256(path.join(download,name))!==await sha256(file))throw new Error(`GitHub download checksum differs: ${name}. The release remains a draft.`);
  }
  await verifyDmg(path.join(download,dmgName),context);
  await publicationPreflight(true);
  run('gh',['release','edit',tag,'--repo',repo,'--draft=false',`--prerelease=${!flags.has('--stable')}`,`--latest=${flags.has('--stable')}`]);
  state.published=true;await save();
  console.log(`Published https://github.com/${repo}/releases/tag/${tag}`);
 }finally{await rm(lockFile,{force:true});}
}

main().catch(error=>{console.error(`\nRelease stopped: ${error.message}`);process.exitCode=1;});
