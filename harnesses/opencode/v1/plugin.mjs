import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function openCodeRuntimeVersion(){
 if(!/^opencode(?:[-.]|$)/i.test(path.basename(process.execPath)))return null;
 try{return(await exec(process.execPath,['--version'],{timeout:5000,maxBuffer:10000})).stdout.trim();}catch{return null;}
}
const argumentHelp={route:'Exact enabled rule id from the current Bridge rules or bridge_routes. This is not a parent or worker name.',task:'Complete delegated task with relevant context, constraints and expected result.',worker:'One allowed worker ID if a choice is needed.',model:'One exact allowed model ID if a choice is needed. Omit for the worker default.',jobId:'A jobId previously returned by bridge_delegate or bridge_message in this same parent session. Followups continue that job’s worker conversation.',message:'A self-contained follow-up for the same worker conversation. If busy, it is queued for the next turn; this does not interrupt the current generation.'};
import {createParentBridge,ruleGuidance,completionText,toolSchemas} from '../../../lib/parent-bridge.mjs';

// The tool helper is resolved beside OpenCode's managed loader, so it uses that
// installation's plugin API rather than a second copy in the Bridge package.
export function createOpenCodePlugin({tool,bridgeOptions={},makeBridge=createParentBridge,readVersion=openCodeRuntimeVersion}={}){
 return async({client})=>{
  if(process.env.HARNESS_BRIDGE_DEPTH)return {};
  const version=await readVersion();
  if(!/^1\.\d+\.\d+$/.test(version||'')){
   const warning=`Subagent Bridge parent tools are disabled: OpenCode ${version||'unknown version'} is not supported by the 1.x adapter. Reconnect using a compatible Bridge adapter; no background tasks were started.`;
   try{await client.app?.log?.({body:{service:'harness-bridge',level:'warn',message:warning}});}catch{}
   return {'experimental.chat.system.transform':async(_input,output)=>{output.system.push(warning);}};
  }
  const sessions=new Map();
  const bridge=makeBridge({parent:'opencode',...bridgeOptions,notify:async(result,ctx)=>{
   const response=await client.session.promptAsync({path:{id:ctx.sessionId},query:{directory:ctx.cwd},body:{parts:[{type:'text',text:completionText(result)}]}});
   if(response?.error)throw new Error('OpenCode did not accept the Bridge completion');
  }});
  const dispose=()=>{bridge.close();sessions.clear();process.removeListener('beforeExit',dispose);};
  process.once('beforeExit',dispose);
  const remember=(sessionId,cwd)=>{
   if(!sessionId||!path.isAbsolute(cwd||''))throw new Error('OpenCode did not provide an absolute session directory');
   const ctx={sessionId,cwd};sessions.set(sessionId,ctx);return ctx;
  };
  const tools={};
  for(const[name,spec]of Object.entries(toolSchemas)){
   const args={};
   for(const[key,property]of Object.entries(spec.properties)){
    let schema=tool.schema.string();
    schema=schema.describe(property.description||argumentHelp[key]||key);
    if(!spec.required.includes(key))schema=schema.optional();
    args[key]=schema;
   }
   tools[name]=tool({description:spec.description,args,async execute(args,context){
    const ctx=remember(context.sessionID,context.directory);
    if(context.abort?.aborted)throw new Error('Parent tool call cancelled before execution');
    return JSON.stringify(await bridge.execute(name,args,ctx));
   }});
  }
  return {
   tool:tools,
   async 'experimental.chat.system.transform'(input,output){
    if(!input.sessionID)return;
    try{
     // The hook has no directory field. Fetch this specific session; never use
     // the plugin's original startup directory for a different parent session.
     const response=await client.session.get({path:{id:input.sessionID}});
     if(response?.error)throw new Error('Cannot resolve the current OpenCode session');
     const session=response?.data??response;
     const ctx=remember(input.sessionID,session?.directory);
     const rules=await bridge.execute('bridge_routes',{},ctx);
     output.system.push(ruleGuidance+'\nThis fresh snapshot replaces all previous Subagent Bridge rules for this session. Current rules: '+JSON.stringify(rules)+'\nThe worker inherits this session directory: '+ctx.cwd);
    }catch{
     output.system.push('Subagent Bridge could not refresh this session’s rules. Do not use stale rules or silently substitute a worker. Report the connection problem; bridge_routes can check again when the connection is repaired.');
    }
   },
   async event({event}){
    if(event.type==='session.deleted'){
     const session=event.properties?.info,ctx=sessions.get(session?.id);
     if(ctx){bridge.closeSession(ctx);sessions.delete(session.id);}
    }
    if(event.type==='server.instance.disposed')dispose();
   }
  };
 };
}
