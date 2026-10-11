import {hookCommand} from '../../lib/process.mjs';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readHookStatus} from './v0_160/hook-status.mjs';
import {detect,root,home} from '../../lib/core.mjs';
const marker='Harness Bridge native session';
export async function runCodexParent(options){
 const agent=(await detect()).find(a=>a.id==='codex');
 if(!agent?.compatibility.supported)throw new Error('Installed Codex version has no supported parent compatibility handler');
 const {runParent}=await import('./v0_160/parent.mjs');return runParent({...options,executable:agent.executable});
}
function target({codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}={}){return path.join(codexHome,'hooks.json');}
function generated({node=process.execPath,bridgeRoot=root,bridgeHome=home}={}){
 const command=hookCommand([node,path.join(bridgeRoot,'harnesses/codex/v0_160/native.mjs'),process.platform==='win32'?'hook-base64':'hook',process.platform==='win32'?Buffer.from(JSON.stringify({bridgeHome,bridgeRoot})).toString('base64'):JSON.stringify({bridgeHome,bridgeRoot})]);
 return Object.fromEntries(['SessionStart','UserPromptSubmit','PostToolUse','Stop'].map(event=>[event,[{...(event==='PostToolUse'?{matcher:'.*'}:{}),hooks:[{type:'command',command,timeout:event==='Stop'?215:15,statusMessage:marker,...(event==='Stop'?{}:{additionalContextLimit:12000})}]}]]));
}
const ours=h=>h.statusMessage===marker;
export async function installCodexIntegration(options={}){
 if(!/^0\.160\.1$/.test(String(options.version||'').replace(/^codex-cli\s+/,'')))throw new Error('Native Codex hooks are tested only on 0.160.1');
 const file=target(options);let before;try{const info=await fs.lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('Codex hooks.json must be a regular file; its link target will not be modified');before=await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const value=before?JSON.parse(before):{hooks:{}};value.hooks??={};
 for(const [event,groups] of Object.entries(value.hooks))value.hooks[event]=groups.map(g=>({...g,hooks:g.hooks.filter(h=>!ours(h))})).filter(g=>g.hooks.length);
 for(const [event,groups] of Object.entries(generated(options)))value.hooks[event]=[...(value.hooks[event]||[]),...groups];
 const after=JSON.stringify(value,null,2)+'\n';if(before===after)return {installed:true,current:true,changed:false,trustRequired:true};
 await fs.mkdir(path.dirname(file),{recursive:true});if(before)await fs.writeFile(file+'.bridge-backup-'+Date.now(),before,{mode:0o600});
 const temp=file+'.bridge-'+process.pid+'-'+Date.now();await fs.writeFile(temp,after,{mode:0o600,flag:'wx'});await fs.rename(temp,file);return {installed:true,current:true,changed:true,trustRequired:true};
}
export async function codexIntegrationStatus(options={}){
 let value;try{value=JSON.parse(await fs.readFile(target(options),'utf8'));}catch{}
 const expected=generated(options);const current=Object.entries(expected).every(([event,groups])=>groups.every(g=>value?.hooks?.[event]?.some(actual=>JSON.stringify(actual)===JSON.stringify(g))));
 const installed=!!value&&Object.values(value.hooks||{}).some(groups=>groups.some(g=>g.hooks?.some(ours)));
 let trustRequired=null,hooksDisabled=false,hookTrust='unknown';
 if(current&&(options.readHooks||options.executable)&&(!options.version||String(options.version).replace(/^codex-cli\s+/,'')==='0.160.1')){
  try{
   const response=await (options.readHooks||readHookStatus)({...options,codexHome:path.dirname(target(options)),cwd:options.cwd||path.dirname(target(options))});
   const entries=response.data||[],hooks=entries.flatMap(entry=>entry.hooks||[]);
   const expectedHooks=Object.entries(expected).flatMap(([event,groups])=>groups.flatMap(g=>g.hooks.map(h=>({event:event[0].toLowerCase()+event.slice(1),command:h.command}))));
   const matched=expectedHooks.map(wanted=>hooks.find(h=>h.sourcePath===target(options)&&h.eventName===wanted.event&&h.command===wanted.command&&h.statusMessage===marker));
   if(entries.length&&entries.every(e=>!e.errors?.length)&&matched.every(Boolean)){
    trustRequired=matched.some(h=>!['trusted','managed'].includes(h.trustStatus));hooksDisabled=matched.some(h=>!h.enabled);
    hookTrust=trustRequired?'review-required':'trusted';
   }
  }catch{} // Unknown is distinct from an actual request to review again.
 }
 const connectionState=!current?'not-configured':trustRequired===true?'configured-review-required':hooksDisabled?'hooks-disabled':trustRequired===false?'connected':'configured-trust-unknown';
 const message=!current?'Native Codex integration needs installation or update.':trustRequired===true?'Review the current Harness Bridge definitions in Codex /hooks.':hooksDisabled?'Harness Bridge hooks are trusted but disabled. Enable them in Codex /hooks.':trustRequired===false?'All four Harness Bridge hooks are enabled and trusted. Active turns receive completion; idle chats receive it on their next turn. Saved rules refresh each turn.':'Hooks are configured. Codex approval status could not be verified; refresh to check again. No new approval requirement has been detected.';
 return {installed,current,mode:'native',approvalRequired:trustRequired,trustRequired,hooksDisabled,hookTrust,connectionState,message};
}
