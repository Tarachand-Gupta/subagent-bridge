import path from 'node:path';
import {parse,modify,applyEdits} from 'jsonc-parser';
import {readSafe,atomicWrite,entryState,mark,setupName} from '../../lib/setup-files.mjs';
export const mcpEntry=ctx=>({type:'local',command:ctx.command,environment:{HARNESS_BRIDGE_HOME:ctx.bridgeHome},enabled:true});
async function inspect(ctx){
 const plain=path.join(ctx.paths.opencode,'opencode.json'),commented=plain+'c';
 const a=await readSafe(plain),b=await readSafe(commented),file=b!==null?commented:plain,text=b??a??'{}\n';
 const decode=text=>{const errors=[],value=parse(text,errors,{allowTrailingComma:true});if(errors.length||!value||typeof value!=='object'||Array.isArray(value)||value.mcp&&(typeof value.mcp!=='object'||Array.isArray(value.mcp)))throw new Error('OpenCode configuration must be a valid JSON/JSONC object');return value;};
 const value=decode(text),fallback=a!==null?decode(a):{};
 return {file,text,current:value.mcp?.[setupName]??fallback.mcp?.[setupName],expected:mcpEntry(ctx)};
}
export async function mcpStatus(ctx){const {file,current,expected}=await inspect(ctx);return {...await entryState(ctx,'opencode-mcp',file,current,expected),configText:JSON.stringify({mcp:{[setupName]:expected}},null,2)};}
export async function installMcp(ctx){const {file,text,current,expected}=await inspect(ctx),state=await entryState(ctx,'opencode-mcp',file,current,expected);if(!state.available)throw new Error(state.reason);if(!state.current)await atomicWrite(file,applyEdits(text,modify(text,['mcp',setupName],expected,{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}})));await mark(ctx,'opencode-mcp',file,expected);}
