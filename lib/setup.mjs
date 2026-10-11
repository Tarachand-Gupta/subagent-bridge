import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {detect,home,root} from './core.mjs';
import {readSafe,atomicWrite,owned,mark,setupName} from './setup-files.mjs';
import * as codex from '../harnesses/codex/setup.mjs';
import * as pi from '../harnesses/pi/setup.mjs';
import * as opencode from '../harnesses/opencode/setup.mjs';
import * as deepseek from '../harnesses/deepseek/setup.mjs';
const adapters={codex,pi,opencode,deepseek};
async function context(options={}){
 const userHome=options.userHome||os.homedir();
 return {bridgeHome:options.bridgeHome||home,bridgeRoot:options.bridgeRoot||root,node:options.node||process.execPath,command:[options.node||process.execPath,path.join(options.bridgeRoot||root,'bin.mjs'),'mcp'],paths:{codex:process.env.CODEX_HOME||path.join(userHome,'.codex'),pi:process.env.PI_CODING_AGENT_DIR||path.join(userHome,'.pi/agent'),opencode:process.env.OPENCODE_CONFIG_DIR||path.join(process.env.XDG_CONFIG_HOME||path.join(userHome,'.config'),'opencode'),deepseek:process.env.DSH_HOME||path.join(userHome,'.dsh'),...options.paths},inventory:options.inventory||await detect(),run:options.run||((command,args,opts)=>promisify(execFile)(command,args,{timeout:15000,maxBuffer:200000,windowsHide:true,...opts}))};
}
export function skillText(ctx,id){
 const command=JSON.stringify(ctx.node)+' '+JSON.stringify(path.join(ctx.bridgeRoot,'bin.mjs'));
 return `---
name: harness-bridge
description: Read and update Harness Bridge routing rules when the user asks to configure which coding harness or model handles delegated tasks.
---

<!-- Harness Bridge managed skill -->
Use the Harness Bridge configuration tools for routing changes. This skill changes shared routing rules; worker execution uses the separately installed native parent integration.

Read current configuration and its revision using bridge_config_read. Discover installed harnesses and their available models with bridge_agents_list and bridge_models_list before choosing identifiers. Preserve unrelated rules and the user's selected models, thinking levels, Can/Should policy, and current-folder inheritance. Empty parent/worker/model arrays mean Auto; multiple choices are alternatives, never automatic fan-out. Do not copy credentials into rules.

Apply the requested change to the current configuration, validate it with bridge_config_preview({config}), then save with bridge_config_save({config,expectedRevision}) using the revision you read. If the revision changed, reread and reconcile the user's intended change without discarding intervening edits. Ask only when the requested target or behavior is materially ambiguous. A user's request to make the change authorizes saving that change; a request to inspect or explain does not.

If MCP tools are unavailable, use the local CLI: \`${command} config read\`, \`${command} config preview --file PATH\`, and \`${command} config save --file PATH --revision REVISION\`. Write the complete proposed JSON to a temporary file for preview/save. Prefix these commands with HARNESS_BRIDGE_HOME=${JSON.stringify(ctx.bridgeHome)} when this Bridge uses a nondefault state directory. Native CLI fallback availability does not mean MCP is installed.

For delegation, ${id==='codex'?'use the native-session CLI instructions injected by Codex hooks; review Harness Bridge in /hooks after installation.':id==='deepseek'?'use native bridge_routes/bridge_delegate/bridge_message and the installed DeepSeek job tools.':'use native bridge_routes, bridge_delegate, bridge_message, bridge_status and bridge_cancel tools.'} A delegate starts a worker conversation and returns a job ID. A message to that job queues a followup in the same conversation. The active parent supplies its own session and current folder; never reuse another parent\'s session ID. Relevant task context must be supplied explicitly. Report failed or unknown outcomes instead of silently replaying work. Native Codex hooks continue active turns but do not wake an idle chat.
`;
}
function availability(agent){if(agent.id==='claude')return 'Claude Code setup is deferred.';if(!agent.installed)return 'This harness is not installed.';if(!agent.compatibility?.supported)return 'This installed version has no verified setup adapter.';return null;}
async function skillStatus(ctx,id){const file=adapters[id].skillPath(ctx);try{if((await fs.lstat(path.dirname(file))).isSymbolicLink())throw new Error('The skill directory is a symlink; it will not be modified.');}catch(e){if(e.code!=='ENOENT')throw e;}const current=await readSafe(file),expected=skillText(ctx,id),installed=current===expected,available=installed||await owned(ctx,id+'-skill',file,current);return {installed,available,path:file,configText:expected,...(!available?{reason:'An existing skill is not managed by Harness Bridge; it will not be overwritten.'}:{reason:id==='pi'?'Run /reload to discover the skill.':'Start a new session or refresh the harness to discover the skill.'})};}
async function statusFor(ctx,agent,kind){const base={id:agent.id,name:agent.name},reason=availability(agent),configText=JSON.stringify({mcpServers:{[setupName]:{command:ctx.command[0],args:ctx.command.slice(1),env:{HARNESS_BRIDGE_HOME:ctx.bridgeHome}}}},null,2);if(reason)return {...base,available:false,installed:false,reason,...(kind==='mcp'?{configText}:{})};try{return {...base,...await (kind==='mcp'?adapters[agent.id].mcpStatus({...ctx,agent}):skillStatus(ctx,agent.id))};}catch(error){return {...base,available:false,installed:false,reason:error.message,...(kind==='mcp'?{configText}:{})};}}
export async function setupStatus(options={}){const ctx=await context(options);const [mcp,skills]=await Promise.all(['mcp','skills'].map(kind=>Promise.all(ctx.inventory.map(agent=>statusFor(ctx,agent,kind)))));return {mcp:{entries:mcp},skills:{entries:skills}};}
let installs=Promise.resolve();
export async function installSetup(kind,id,options={}){
 if(!['mcp','skills'].includes(kind)||!adapters[id])throw new Error('Unsupported setup selection');
 const task=installs.catch(()=>{}).then(async()=>{const ctx=await context(options),agent=ctx.inventory.find(a=>a.id===id);if(!agent)throw new Error('Unknown harness');const status=await statusFor(ctx,agent,kind);if(!status.available)throw new Error(status.reason);
 if(kind==='mcp')await adapters[id].installMcp({...ctx,agent});else{const file=adapters[id].skillPath(ctx),text=skillText(ctx,id);await atomicWrite(file,text);await mark(ctx,id+'-skill',file,text);}
 return setupStatus({...options,inventory:ctx.inventory});});installs=task;return task;
}
