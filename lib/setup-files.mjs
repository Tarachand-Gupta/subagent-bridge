import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export const setupName='harness-bridge';
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export async function readSafe(file){try{const info=await fs.lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('Refusing to replace a symlink or non-file: '+file);return await fs.readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function atomicWrite(file,text){const previous=await readSafe(file);if(previous===text)return false;await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});if(previous!==null)await fs.writeFile(file+'.bridge-backup-'+Date.now()+'-'+randomUUID().slice(0,8),previous,{mode:0o600,flag:'wx'});const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,text,{mode:0o600,flag:'wx'});if(await readSafe(file)!==previous)throw new Error('Configuration changed during setup; reload and retry');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}return true;}
export function markerPath(ctx,key){return path.join(ctx.bridgeHome,'setup',key+'.json');}
export async function owned(ctx,key,file,value){if(value===undefined||value===null)return true;const text=await readSafe(markerPath(ctx,key));if(!text)return false;const marker=JSON.parse(text);return marker.file===file&&marker.hash===hash(value);}
export async function mark(ctx,key,file,value){await atomicWrite(markerPath(ctx,key),JSON.stringify({owner:setupName,file,hash:hash(value)},null,2)+'\n');}
export async function entryState(ctx,key,file,current,expected){const installed=JSON.stringify(current)===JSON.stringify(expected);const available=installed||await owned(ctx,key,file,current);return {installed,available,...(!available?{reason:'An existing entry with this name is not managed by Harness Bridge; it will not be overwritten.'}:{}),path:file};}
