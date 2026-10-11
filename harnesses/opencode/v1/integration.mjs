import {readFile,writeFile,mkdir,lstat,rename,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,home,which} from '../../../lib/core.mjs';
import {selectCompatibility,inspectCompatibility} from '../../../lib/compatibility.mjs';
const MARKER='// Harness Bridge managed OpenCode integration v1';
export function openCodeIntegrationPath(){return path.join(process.env.OPENCODE_CONFIG_DIR||path.join(process.env.XDG_CONFIG_HOME||path.join(homedir(),'.config'),'opencode'),'plugins','harness-bridge.ts');}
export function openCodePluginSource(){return `${MARKER}
import { tool } from '@opencode-ai/plugin';
import { createOpenCodePlugin } from ${JSON.stringify(new URL('./plugin.mjs',import.meta.url).href)};
export default createOpenCodePlugin({ tool, bridgeOptions: ${JSON.stringify({node:process.execPath,bridgeRoot:root,bridgeHome:home})} });
`;}
export async function opencodeIntegrationStatus(){
 const file=openCodeIntegrationPath();
 try{
  const info=await lstat(file);
  if(info.isSymbolicLink()||!info.isFile())return{installed:false,current:false,path:file,conflict:true,message:'An unmanaged file or symlink occupies the OpenCode integration path.'};
  const content=await readFile(file,'utf8'),managed=content.startsWith(MARKER+'\n');
  return{installed:managed,current:managed&&content===openCodePluginSource(),path:file,conflict:!managed};
 }catch(error){if(error.code==='ENOENT')return{installed:false,current:false,path:file,conflict:false};throw error;}
}
export async function installOpenCodeIntegration({version}={}){
 const compatibility=version?selectCompatibility('opencode',version):await inspectCompatibility({id:'opencode',executable:await which('opencode')});
 if(!compatibility.supported||compatibility.family!=='v1')throw new Error('OpenCode '+(compatibility.version||'unknown version')+' is not supported by the 1.x parent integration.');
 const status=await opencodeIntegrationStatus();
 if(status.conflict)throw new Error('Refusing to overwrite an unrelated OpenCode plugin: '+status.path);
 if(!status.current){
  await mkdir(path.dirname(status.path),{recursive:true,mode:0o700});
  const temporary=status.path+'.'+randomUUID()+'.tmp';
  try{
   await writeFile(temporary,openCodePluginSource(),{mode:0o600,flag:'wx'});
   if((await opencodeIntegrationStatus()).conflict)throw new Error('OpenCode plugin changed during installation. Review it before connecting.');
   await rename(temporary,status.path);
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 return{installed:true,current:true,path:status.path,reloadRequired:!status.current,message:'OpenCode is connected. Restart existing OpenCode instances once to load the plugin. Later saved rule changes refresh each turn.'};
}
