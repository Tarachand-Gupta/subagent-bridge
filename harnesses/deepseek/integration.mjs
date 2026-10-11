import {readFile,writeFile,mkdir,rename,lstat,copyFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseDocument} from 'yaml';
import {root,home} from '../../lib/core.mjs';
export const supportedVersion='0.2.0-rc.2';
const marker='harness-bridge-rc2';
const patchPath=options=>path.join(options.profileDirectory||path.join(process.env.DSH_HOME||path.join(homedir(),'.dsh'),'profiles',options.profile||'web'),'cordis.patch.yml');
export function deepseekPatch({bridgeRoot=root,bridgeHome=home,node=process.execPath}={}){
 return {insert:[{id:marker,name:path.join(bridgeRoot,'harnesses/deepseek/v0_2_rc2/plugin.mjs'),config:{runtimeVersion:supportedVersion,node,bridgeRoot,bridgeHome}}]};
}
export async function deepseekIntegrationStatus(options={}){
 const file=patchPath(options);
 try{
  if((await lstat(file)).isSymbolicLink())return {installed:false,current:false,path:file,conflict:true};
  const doc=parseDocument(await readFile(file,'utf8'));if(doc.errors.length)throw new Error('Invalid profile YAML');
  const rows=doc.toJS();const entries=Array.isArray(rows)?rows.flatMap(r=>r?.insert||[]):[];
  const entry=entries.find(r=>r?.id===marker);
  return {installed:!!entry,current:!!entry&&JSON.stringify(entry)===JSON.stringify(deepseekPatch(options).insert[0]),path:file,profile:options.profile||'web',runtimeVersion:supportedVersion,restartRequired:true};
 }catch(error){if(error.code==='ENOENT')return {installed:false,current:false,path:file,profile:options.profile||'web'};return {installed:false,current:false,path:file,conflict:true};}
}
export async function installDeepSeekIntegration(options={}){
 if(options.version!==supportedVersion)throw new Error('DeepSeek parent integration requires verified version '+supportedVersion);
 const status=await deepseekIntegrationStatus(options);if(status.conflict)throw new Error('Refusing to modify an invalid or symlinked DeepSeek profile');
 if(status.current)return status;
 const file=status.path;let previous='[]\n';try{previous=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const doc=parseDocument(previous);if(doc.errors.length||!Array.isArray(doc.toJS()))throw new Error('DeepSeek profile patch must contain a YAML list');
 const rows=doc.toJS();
 // Replace only our dedicated insertion row; preserve all other YAML nodes/tags.
 const index=rows.findIndex(row=>Array.isArray(row?.insert)&&row.insert.length===1&&row.insert[0]?.id===marker);
 if(index>=0)doc.set(index,deepseekPatch(options));else if(rows.some(row=>row?.insert?.some?.(entry=>entry.id===marker)))throw new Error('Managed Bridge entry has been moved into a mixed profile row; review it first');else doc.add(deepseekPatch(options));
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});if(previous!=='[]\n')await copyFile(file,file+'.harness-bridge-backup-'+Date.now());
 const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,String(doc),{mode:0o600});await rename(temporary,file);
 return {...await deepseekIntegrationStatus(options),message:'DeepSeek native integration saved. Restart this profile to load the plugin; saved rule updates then apply at each prompt.'};
}
