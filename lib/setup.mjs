import {execFile} from './process.mjs';
import os from 'node:os';
import path from 'node:path';
import {detect,home,root} from './core.mjs';
import * as codex from '../harnesses/codex/setup.mjs';
import * as pi from '../harnesses/pi/setup.mjs';
import * as opencode from '../harnesses/opencode/setup.mjs';
import * as deepseek from '../harnesses/deepseek/setup.mjs';
const adapters={codex,pi,opencode,deepseek};
async function context(options={}){
 const userHome=options.userHome||os.homedir();
 return {bridgeHome:options.bridgeHome||home,bridgeRoot:options.bridgeRoot||root,node:options.node||process.execPath,command:[options.node||process.execPath,path.join(options.bridgeRoot||root,'bin.mjs'),'mcp'],paths:{codex:process.env.CODEX_HOME||path.join(userHome,'.codex'),pi:process.env.PI_CODING_AGENT_DIR||path.join(userHome,'.pi/agent'),opencode:process.env.OPENCODE_CONFIG_DIR||path.join(process.env.XDG_CONFIG_HOME||path.join(userHome,'.config'),'opencode'),deepseek:process.env.DSH_HOME||path.join(userHome,'.dsh'),...options.paths},inventory:options.inventory||await detect(),run:options.run||((command,args,opts)=>execFile(command,args,{timeout:15000,maxBuffer:200000,windowsHide:true,...opts}))};
}
function availability(agent){if(agent.id==='claude')return 'Claude Code setup is deferred.';if(!adapters[agent.id])return 'This agent is an ACP worker. Native parent and automatic MCP setup are not provided.';if(!agent.installed)return 'This harness is not installed.';if(!agent.compatibility?.supported)return 'This installed version has no verified setup adapter.';return null;}
async function statusFor(ctx,agent){const base={id:agent.id,name:agent.name},reason=availability(agent);if(reason)return {...base,available:false,installed:false,reason};try{return {...base,...await adapters[agent.id].mcpStatus({...ctx,agent})};}catch(error){return {...base,available:false,installed:false,reason:error.message};}}
export async function setupStatus(options={}){const ctx=await context(options);return {mcp:{entries:await Promise.all(ctx.inventory.map(agent=>statusFor(ctx,agent)))}};}
let installs=Promise.resolve();
export async function installSetup(kind,id,options={}){
 if(kind!=='mcp'||!adapters[id])throw new Error('Unsupported setup selection');
 const task=installs.catch(()=>{}).then(async()=>{const ctx=await context(options),agent=ctx.inventory.find(a=>a.id===id);if(!agent)throw new Error('Unknown harness');const status=await statusFor(ctx,agent);if(!status.available)throw new Error(status.reason);
 await adapters[id].installMcp({...ctx,agent});
 return setupStatus({...options,inventory:ctx.inventory});});installs=task;return task;
}
