import path from 'node:path';
import {readSafe,atomicWrite,entryState,mark,setupName} from '../../lib/setup-files.mjs';
const file=ctx=>path.join(ctx.paths.pi,'mcp.json');
export const mcpEntry=ctx=>({command:ctx.command[0],args:ctx.command.slice(1),env:{HARNESS_BRIDGE_HOME:ctx.bridgeHome}});
async function inspect(ctx){const text=await readSafe(file(ctx));const value=text?JSON.parse(text):{};if(!value||Array.isArray(value)||typeof value!=='object'||value.mcpServers&&(typeof value.mcpServers!=='object'||Array.isArray(value.mcpServers)))throw new Error('Pi MCP configuration is not an object');return {value,current:value.mcpServers?.[setupName],expected:mcpEntry(ctx)};}
export async function mcpStatus(ctx){const {current,expected}=await inspect(ctx);const state=await entryState(ctx,'pi-mcp',file(ctx),current,expected);return {...state,configText:JSON.stringify({mcpServers:{[setupName]:expected}},null,2),reason:state.reason||'Run /reload in existing Pi sessions after installation.'};}
export async function installMcp(ctx){const {value,current,expected}=await inspect(ctx);const state=await entryState(ctx,'pi-mcp',file(ctx),current,expected);if(!state.available)throw new Error(state.reason);if(!state.current){value.mcpServers??={};value.mcpServers[setupName]=expected;await atomicWrite(file(ctx),JSON.stringify(value,null,2)+'\n');}await mark(ctx,'pi-mcp',file(ctx),expected);}
