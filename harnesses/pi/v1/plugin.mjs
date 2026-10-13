import path from 'node:path';
import {createParentBridge,toolSchemas,ruleGuidance,completionText} from '../../../lib/parent-bridge.mjs';

// Pi activates one parent session at a time. A switch closes the old manager;
// returning to that session creates a new manager instead of reviving old jobs.
export function mountPiIntegration(pi,{Type,version,bridgeOptions={},makeBridge=createParentBridge}={}){
 if(process.env.HARNESS_BRIDGE_DEPTH)return;
 if(!/^1\.\d+\.\d+$/.test(version||''))throw new Error('Subagent Bridge: this Pi version needs a compatibility review. Reconnect in Settings.');
 let active=null;
 const scope=ctx=>JSON.stringify([ctx.sessionId,ctx.cwd]);
 const parent=ctx=>{
  const sessionId=ctx.sessionManager?.getSessionId(),cwd=ctx.cwd;
  if(!sessionId||!path.isAbsolute(cwd||''))throw new Error('Pi must provide a parent session and absolute project directory');
  return{sessionId,cwd};
 };
 const stop=()=>{const previous=active;active=null;if(previous)previous.bridge.close();};
 function activate(ctx){
  const identity=parent(ctx),owner=scope(identity);
  if(active?.scope===owner)return{...active,identity};
  stop();
  const entry={scope:owner,bridge:null};
  entry.bridge=makeBridge({parent:'pi',...bridgeOptions,notify:async value=>{
   if(active!==entry)throw new Error('The owning Pi session is no longer active');
   pi.sendMessage({customType:'harness-bridge-completion',display:true,content:completionText(value),details:value},{triggerTurn:true,deliverAs:'followUp'});
  }});
  active=entry;return{...entry,identity};
 }
 pi.on('session_shutdown',stop);
 pi.on('session_before_switch',stop);
 pi.on('session_start',(_event,ctx)=>{activate(ctx);});
 for(const[name,spec]of Object.entries(toolSchemas)){
  const properties={};
  for(const[key,property]of Object.entries(spec.properties)){
   const schema=Type.Unsafe(property);
   properties[key]=spec.required.includes(key)?schema:Type.Optional(schema);
  }
  pi.registerTool({name,label:name.replaceAll('_',' '),description:spec.description,parameters:Type.Object(properties),
   async execute(_id,args,signal,_update,ctx){
    if(signal?.aborted)throw new Error('Subagent Bridge parent tool call cancelled before execution');
    const current=activate(ctx),value=await current.bridge.execute(name,args,current.identity);
    return{content:[{type:'text',text:JSON.stringify(value)}],details:value};
   }});
 }
 pi.on('before_agent_start',async(_event,ctx)=>{
  try{
   const current=activate(ctx),routes=await current.bridge.execute('bridge_routes',{},current.identity);
   return{message:{customType:'harness-bridge-routes',display:false,content:ruleGuidance+'\nThis fresh snapshot replaces earlier Subagent Bridge rules. Current rules: '+JSON.stringify(routes)+'\nWorkers inherit this Pi session folder: '+current.identity.cwd+'. Use Bridge tools for configured cross-harness work, not Pi native subagent profiles.',details:{routes}}};
  }catch(error){
   return{message:{customType:'harness-bridge-error',display:true,content:'Subagent Bridge could not load its rules: '+(error?.reason||error?.message||'connection failed'),details:undefined}};
  }
 });
 return{close:stop};
}
