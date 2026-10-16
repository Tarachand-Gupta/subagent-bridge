import {createAgentRegistry} from 'acpx/agent-registry';
import acpxPackage from 'acpx/package.json' with {type:'json'};

export const registryVersion=acpxPackage.version;
export const registrySource='https://github.com/openclaw/acpx/blob/main/docs/agents.md';
// inspect() is the maintained, installed-only API. Never resolve() a built-in:
// its fallback may execute npx/uvx and download an unreviewed package.
const recipeRegistry=createAgentRegistry({resolveExecutable:command=>command,resolvePackageRoot:()=>undefined});
const bridgeAgents=[
 {id:'codex',name:'Codex',command:'codex',adapter:'codex-acp',args:[]},
 {id:'claude',name:'Claude Code',command:'claude',adapter:'claude-agent-acp',args:[]},
 {id:'pi',name:'Pi',command:'pi',adapter:'pi-acp',args:[]},
 {id:'opencode',name:'OpenCode',command:'opencode',adapter:'opencode',args:['acp','--pure']},
 {id:'deepseek',name:'DeepSeek Harness',command:'dsh',adapter:'dsh',args:['--profile','acp']}
];
const nativeIds=new Set(['codex','pi','opencode','deepseek']);
export function registryAgentDefinitions(){
 const known=new Set(bridgeAgents.map(agent=>agent.id));
 const additions=recipeRegistry.list().filter(id=>!known.has(id)).map(id=>{
  const inspection=recipeRegistry.inspect(id),argv=inspection?.launch.kind==='installed'?inspection.launch.argv:null;
  return {id,name:inspection?.name||id.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join(' '),command:argv?.[0]||null,adapter:argv?.[0]||null,args:argv?.slice(1)||[],catalogOnly:!argv};
 });
 return [...bridgeAgents,...additions].map(agent=>({...agent,nativeParent:nativeIds.has(agent.id),registry:{source:agent.id==='deepseek'?'bridge':'acpx',version:agent.id==='deepseek'?'0.2.0-rc.2':registryVersion,url:agent.id==='deepseek'?null:registrySource},workerVerified:false}));
}
export const agentDefinitions=registryAgentDefinitions();

export function inspectRegistryAgent(id,resolveExecutable){
 return createAgentRegistry({resolveExecutable,resolvePackageRoot:()=>undefined}).inspect(id);
}

export function workerAvailability(agent,executable,adapterPath){
 if(agent.catalogOnly)return {status:'catalog-only',reason:'This registry entry only provides a package-runner recipe. Automatic downloads are disabled.',requirements:[],protocolVerified:false,liveVerified:false};
 if(!executable||!adapterPath){
  const requirements=[...new Set([!executable&&agent.command,!adapterPath&&agent.adapter].filter(Boolean))];
  return {status:'missing',reason:requirements.length?`Install ${requirements.join(' and ')} separately, then refresh.`:'No installed ACP launcher was found.',requirements,protocolVerified:false,liveVerified:false};
 }
 return {status:'detected',reason:'Local launcher found. Model discovery checks ACP; provider access is verified only by a task.',requirements:[],protocolVerified:false,liveVerified:false};
}
