import {readFile,writeFile,mkdir,lstat,rename,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,home} from '../../../lib/core.mjs';

const MARKER='// Harness Bridge managed Pi integration v1';
export function piIntegrationPath(){
 return path.join(process.env.PI_CODING_AGENT_DIR||path.join(homedir(),'.pi','agent'),'extensions','harness-bridge.ts');
}
export function piExtensionSource(){
 return `${MARKER}
import { Type } from '@earendil-works/pi-ai';
import { VERSION } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mountPiIntegration } from ${JSON.stringify(new URL('./plugin.mjs',import.meta.url).href)};
export default function(pi: ExtensionAPI) {
  return mountPiIntegration(pi, {Type, version: VERSION, bridgeOptions: ${JSON.stringify({node:process.execPath,bridgeRoot:root,bridgeHome:home})}});
}
`;
}
export async function piIntegrationStatus(){
 const file=piIntegrationPath();
 try{
  const info=await lstat(file);
  if(info.isSymbolicLink()||!info.isFile())return {installed:false,current:false,path:file,conflict:true,message:'An unmanaged file or symlink occupies the Pi integration path.'};
  const content=await readFile(file,'utf8');const managed=content.startsWith(MARKER+'\n');
  return {installed:managed,current:managed&&content===piExtensionSource(),path:file,conflict:!managed};
 }catch(error){if(error.code==='ENOENT')return {installed:false,current:false,path:file,conflict:false};throw error;}
}
export async function installPiIntegration(){
 const status=await piIntegrationStatus();
 if(status.conflict)throw new Error('Refusing to overwrite an unrelated Pi extension: '+status.path);
 if(!status.current){
  await mkdir(path.dirname(status.path),{recursive:true,mode:0o700});
  const temporary=status.path+'.'+randomUUID()+'.tmp';
  try{
   await writeFile(temporary,piExtensionSource(),{mode:0o600,flag:'wx'});
   // Recheck before replacing so an unrelated extension is not silently overwritten.
   if((await piIntegrationStatus()).conflict)throw new Error('Pi extension changed during installation; try again after reviewing it.');
   await rename(temporary,status.path);
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 return {installed:true,current:true,path:status.path,reloadRequired:!status.current,message:'Pi is connected. In existing Pi sessions run /reload once, or start a new session. Saved routing changes then load automatically before each turn.'};
}
