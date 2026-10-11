import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import path from 'node:path';
import {parse,stringify} from 'yaml';

// DeepSeek profiles have separate provider settings but share their credential store.
// Import only provider definitions; never load web plugins into the ACP process.
export function providerOverlay(rows){
 if(!Array.isArray(rows))throw new Error('DeepSeek web provider settings have an unsupported format');
 const providers=rows.find(row=>row?.id==='llm-pi-ai')?.config?.providers;
 if(!providers||typeof providers!=='object'||Array.isArray(providers))return [];
 const overlay=[{id:'llm-pi-ai',config:{providers}}];
 const selected=rows.find(row=>row?.id==='agent-default-model')?.config;
 if(typeof selected?.provider==='string'&&typeof selected?.model==='string'&&Object.hasOwn(providers,selected.provider)){
  overlay.push({id:'acp',config:{provider:selected.provider,model:selected.model}});
 }
 return overlay;
}
export async function deepseekLaunch(args){
 const file=path.join(process.env.DSH_HOME||path.join(homedir(),'.dsh'),'profiles/web/cordis.patch.yml');
 let source;try{source=await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return {args,cleanup:async()=>{}};throw new Error('Cannot read DeepSeek web provider settings');}
 let overlay;try{overlay=providerOverlay(parse(source));}catch{throw new Error('Cannot parse DeepSeek web provider settings');}
 if(!overlay.length)return {args,cleanup:async()=>{}};
 const dir=await mkdtemp(path.join(tmpdir(),'bridge-deepseek-'));
 const cleanup=()=>rm(dir,{recursive:true,force:true});
 try{const patch=path.join(dir,'providers.yml');await writeFile(patch,stringify(overlay),{mode:0o600});return {args:[...args,'--patch',patch],cleanup};}catch(e){await cleanup();throw e;}
}
