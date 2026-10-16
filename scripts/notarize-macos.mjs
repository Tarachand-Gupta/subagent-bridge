import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,rename} from 'node:fs/promises';

export async function sha256(file){
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(file))hash.update(chunk);
 return hash.digest('hex');
}

export async function writeJson(file,value){
 await writeFile(`${file}.tmp`,JSON.stringify(value,null,2)+'\n',{mode:0o600});
 await rename(`${file}.tmp`,file);
}

export async function readJson(file){
 try{return JSON.parse(await readFile(file,'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// Persist the intent before upload, then the submission ID before waiting.
// An interrupted upload with no ID is ambiguous: never upload it again blindly.
export async function notarize({file,journal,profile,run,timeout='10m'}){
 const digest=await sha256(file);
 let state=await readJson(journal);
 if(state&&(state.sha256!==digest||state.profile!==profile))throw new Error(`Notarization inputs changed: ${journal}. Keep the original artifact or start a new release directory.`);
 const save=()=>writeJson(journal,state);
 const call=(op,args)=>run('xcrun',['notarytool',op,...args,'--keychain-profile',profile,'--output-format','json'],{json:true});
 if(!state){
  state={file,sha256:digest,profile,phase:'submitting',startedAt:new Date().toISOString()};await save();
  const submission=await call('submit',[file,'--no-wait']);
  if(!submission.id)throw new Error(`Apple returned no submission ID. Reconcile ${journal} with notarytool history before retrying.`);
  state.id=submission.id;state.phase='submitted';await save();
 }
 if(!state.id)throw new Error(`Previous upload outcome is unknown. Use notarytool history/info/log to identify the upload, verify its SHA-256 against ${digest}, then add its id to ${journal}. Do not resubmit.`);
 if(state.phase==='accepted')return state;
 let status=await call('info',[state.id]);
 if(status.status==='In Progress'){
  try{status=await call('wait',[state.id,'--timeout',timeout]);}
  catch(error){throw new Error(`Notarization wait stopped for ${state.id}. Rerun the same release command to resume; do not resubmit. ${error.message}`);}
 }
 if(status.status!=='Accepted'&&status.status!=='Invalid'&&status.status!=='Rejected')throw new Error(`Apple reports ${status.status??'unknown'} for ${state.id}. Rerun to check this same submission later.`);
 const log=await call('log',[state.id]);
 await writeJson(`${journal}.log.json`,log);
 if(log.jobId!==state.id||log.sha256?.toLowerCase()!==digest)throw new Error(`Apple's log does not match submission ${state.id} and its artifact hash.`);
 state.status=status.status;state.phase=status.status==='Accepted'&&log.status==='Accepted'?'accepted':'rejected';await save();
 if(status.status!=='Accepted'||log.status!=='Accepted')throw new Error(`Apple rejected ${file}. Inspect ${journal}.log.json; nothing will be published.`);
 if(log.issues?.length)console.warn(`Apple reported ${log.issues.length} notarization issue(s); see ${journal}.log.json.`);
 return state;
}

export function chooseIdentity(output,explicit){
 const identities=[...output.matchAll(/"(Developer ID Application: [^"]+)"/g)].map(match=>match[1]);
 if(explicit){if(!identities.includes(explicit))throw new Error('Requested Developer ID Application identity is unavailable.');return explicit;}
 if(identities.length!==1)throw new Error('Set APPLE_SIGNING_IDENTITY to one available Developer ID Application certificate name.');
 return identities[0];
}

export function validateVersions({pkg,lock,tauri,cargo,cargoLock}){
 const version=pkg.version;
 const cargoVersion=cargo.match(/\[package\][\s\S]*?\bversion\s*=\s*"([^"]+)"/)?.[1];
 const lockedVersion=cargoLock.match(/\[\[package\]\]\s*name = "harness-bridge"\s*version = "([^"]+)"/)?.[1];
 if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)||[lock.version,lock.packages?.['']?.version,tauri.version,cargoVersion,lockedVersion].some(value=>value!==version))throw new Error('Release versions must match in package.json, package-lock.json, tauri.conf.json, Cargo.toml and Cargo.lock.');
 return version;
}

export function assertPublishable({tagCommit,commit,release,state}){
 if(tagCommit!==commit)throw new Error('The GitHub release tag must point to the exact verified source commit.');
 if(!state.verified)throw new Error('Installer verification must pass before publishing.');
 if(release&&!release.isDraft)throw new Error('This release is already public; its assets will never be replaced.');
 if(release&&(!state.releaseId||release.id!==state.releaseId))throw new Error('An unrelated draft already exists. Inspect it before continuing.');
}
