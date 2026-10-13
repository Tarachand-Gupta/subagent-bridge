import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema,ListResourcesRequestSchema,ListResourceTemplatesRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {load,validate,configRevision,agents,detect,routeReasoning} from './core.mjs';
import {saveAndConnect,connectionStatus} from './connections.mjs';
import {probe} from './agents.mjs';

const string={type:'string',maxLength:2000};
const harness={type:'string',enum:agents.map(a=>a.id)};
const configSchema={type:'object',additionalProperties:false,required:['routes'],properties:{
 version:{type:'integer',const:1},workspace:{type:'string',description:'Legacy field, preserved for compatibility. Delegation always inherits the parent instance folder.'},inheritWorkspace:{type:'boolean',description:'Legacy preference; parent folder inheritance is enforced by current integrations.'},
 routes:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['id','task','reasoning','enabled'],properties:{
  id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},parent:{type:'string'},worker:{type:'string'},model:string,
  parents:{type:'array',items:harness,uniqueItems:true},workers:{type:'array',items:harness,uniqueItems:true},
  models:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['worker','id'],properties:{worker:harness,id:string,reasoning:{...string,description:'Model-specific thinking. Empty string explicitly uses harness default; omit to inherit worker then rule thinking.'}}}},
  reasoning:string,reasoningByWorker:{type:'object',additionalProperties:string},task:string,enabled:{type:'boolean'},usage:{enum:['can','should']}
 }}}
}};
const tools=[
 {name:'bridge_agents_list',description:'Detect installed harnesses, supported versions, ACP readiness, and native connection status. Reads local setup only; never returns provider credentials or starts tasks.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'bridge_models_list',description:'Query a harness for its available model catalog and advertised thinking controls. May start a temporary discovery session, but never submits an inference task. Catalog availability is not proof that a provider will accept a request.',inputSchema:{type:'object',required:['harness'],additionalProperties:false,properties:{harness,modelId:string}},annotations:{readOnlyHint:true}},
 {name:'bridge_config_read',description:'Start here when the user asks to configure Subagent Bridge. Read the complete routing configuration, preferences, revision, and readable rules. Preserve unrelated rules, model-specific thinking, and Can/Should policy. Empty parent/worker/model arrays mean Auto; multiple choices are alternatives, not fan-out. Discover identifiers with bridge_agents_list and bridge_models_list, preview the full proposed config, then save using this revision. Never include credentials.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'bridge_config_preview',description:'Validate a complete proposed configuration and show normalized configuration, current revision, readable rules, and changes. Does not save or connect anything. Preserve unrelated rules and preferences from bridge_config_read.',inputSchema:{type:'object',required:['config'],additionalProperties:false,properties:{config:configSchema}},annotations:{readOnlyHint:true}},
 {name:'bridge_config_save',description:'Save exactly the supplied complete validated configuration if expectedRevision still matches. Replaces routing configuration and connects installed supported native harness integrations using the same Save & Connect operation as the app. May require a one-time harness reload. Never starts a delegated task. Read and preview first; on conflict, read again and merge intentionally without overwriting intervening changes. A user request to change rules authorizes saving that specific change; inspection alone does not. Preserve unrelated settings. Workers inherit the active parent session folder.',inputSchema:{type:'object',required:['config','expectedRevision'],additionalProperties:false,properties:{config:configSchema,expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'}}},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}}
];

function exactKeys(value,allowed){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Unexpected configuration fields. Read the complete supported configuration before editing.');
}
function proposed(value){
 exactKeys(value,Object.keys(configSchema.properties));
 if(value.version!==undefined&&value.version!==1)throw new Error('Unsupported configuration version');
 if(value.workspace!==undefined&&typeof value.workspace!=='string')throw new Error('Invalid legacy workspace field');
 if(Array.isArray(value.routes))for(const route of value.routes){
  exactKeys(route,Object.keys(configSchema.properties.routes.items.properties));
  if(Array.isArray(route.models))for(const model of route.models)exactKeys(model,['worker','id','reasoning']);
 }
 return validate(value);
}
function instructions(config){
 return config.routes.map(r=>{
  const parents=r.parents.length?r.parents.join(', '):'any parent';
  const workers=r.workers.length?r.workers.join(', '):'any available other harness';
  const models=r.models.length?r.models.map(m=>`${m.worker}: ${m.id} (thinking: ${routeReasoning(r,m.worker,m.id)||'harness default'})`).join('; '):'harness default model';
  const thinking=Object.keys(r.reasoningByWorker||{}).length?Object.entries(r.reasoningByWorker).map(([id,v])=>`${id}: ${v||'harness default'}`).join('; ')+`; other workers: ${r.reasoning||'harness default'}`:r.reasoning||'harness default';
  return `${r.enabled?'Enabled':'Disabled'} [${r.id}]: When ${parents} needs ${r.task.toLowerCase()==='auto'?'any task':r.task}, ${r.usage==='should'?'it should':'it can'} delegate to ${workers}. Models: ${models}. Default thinking for models without an override: ${thinking}. Workers inherit the initiating parent instance folder.`;
 });
}
function changes(before,after){
 const changes=[];
 const old=new Map(before.routes.map(r=>[r.id,r])),next=new Map(after.routes.map(r=>[r.id,r]));
 for(const [id,rule]of old){if(!next.has(id))changes.push({kind:'removed',id,before:rule});else if(JSON.stringify(rule)!==JSON.stringify(next.get(id)))changes.push({kind:'updated',id,before:rule,after:next.get(id)});}
 for(const [id,rule]of next)if(!old.has(id))changes.push({kind:'added',id,after:rule});
 if(JSON.stringify(before.routes.map(r=>r.id))!==JSON.stringify(after.routes.map(r=>r.id)))changes.push({kind:'route-order',before:before.routes.map(r=>r.id),after:after.routes.map(r=>r.id)});
 for(const key of ['workspace','inheritWorkspace'])if(before[key]!==after[key])changes.push({kind:'preference',key,before:before[key],after:after[key]});
 return changes;
}
function result(data,isError=false){return {content:[{type:'text',text:JSON.stringify(data,null,2)}],structuredContent:data,...(isError?{isError:true}:{})};}

export async function configAgents({inventory=detect,status=connectionStatus}={}){
 const detected=await inventory(),connections=await status(detected);
 return {ok:true,agents:detected.map(a=>({id:a.id,name:a.name,installed:a.installed,version:a.version,acpReady:a.acpReady,compatibility:a.compatibility,connection:connections[a.id]}))};
}
export async function configModels(harness,{catalog=probe,modelId}={}){
 if(!agents.some(a=>a.id===harness))throw new Error('Choose a known harness');
 if(modelId!==undefined&&(typeof modelId!=='string'||modelId.length>2000))throw new Error('Invalid model selection');
 const data=await catalog(harness,{modelId});
 return {ok:true,harness,models:data.models,currentModel:data.currentModel,source:data.source,verified:data.verified,reasoning:data.reasoning,reasoningScope:data.reasoningScope,reasoningModelId:data.reasoningModelId,configOptions:(data.configOptions||[]).filter(o=>/reason|think|effort/i.test([o.id,o.name,o.category].join(' ')))};
}

export async function configRead({read=load}={}){
 const config=validate(await read());return {ok:true,revision:configRevision(config),config,instructions:instructions(config)};
}
export async function configPreview(value,{read=load}={}){
 const current=validate(await read()),config=proposed(value);
 return {ok:true,revision:configRevision(current),proposedRevision:configRevision(config),config,instructions:instructions(config),changes:changes(current,config),saved:false};
}
export async function configSave(value,expectedRevision,{commit=saveAndConnect}={}){
 const config=proposed(value);
 if(typeof expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(expectedRevision))throw new Error('A valid expectedRevision from read or preview is required');
 const saved=await commit(config,{expectedRevision});
 return {ok:true,saved:true,revision:configRevision(saved.config),config:saved.config,instructions:instructions(saved.config),message:saved.message,connections:saved.connections,warnings:saved.warnings};
}

export function createConfigMcpServer({read=load,commit=saveAndConnect,inventory=detect,status=connectionStatus,catalog=probe}={}){
 const server=new Server({name:'harness-bridge-config',version:'0.1.0'},{capabilities:{tools:{},resources:{}},instructions:'Manage Subagent Bridge routing configuration. Read the current config and revision; discover harness/model identifiers; preserve unrelated settings; preview the complete proposed config; save with the observed revision when the user requests a change. On conflict, reread and reconcile. Empty selection arrays mean Auto. Multiple harnesses/models are alternatives: choose one per task. Can permits delegation; Should requires it for matching tasks. Each model may override thinking, with an empty string explicitly using its harness default. Workers inherit the initiating parent instance folder. These tools never submit delegated tasks or accept credentials. Execution and same-conversation followups use the separately installed native bridge_delegate/bridge_message integration; use its existing jobId for followups, and never replay failed or unknown work automatically.'});
 // DeepSeek's MCP client enumerates resources unconditionally; advertise an honest empty catalog.
 server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[]}));
 server.setRequestHandler(ListResourceTemplatesRequestSchema,async()=>({resourceTemplates:[]}));
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
 server.setRequestHandler(CallToolRequestSchema,async request=>{
  const {name,arguments:args={}}=request.params;
  try{
   const tool=tools.find(t=>t.name===name);if(!tool)throw new Error('Unknown configuration tool');
   exactKeys(args,Object.keys(tool.inputSchema.properties));
   if(name==='bridge_agents_list')return result(await configAgents({inventory,status}));
   if(name==='bridge_models_list')return result(await configModels(args.harness,{catalog,modelId:args.modelId}));
   if(name==='bridge_config_read')return result(await configRead({read}));
   if(name==='bridge_config_preview')return result(await configPreview(args.config,{read}));
   return result(await configSave(args.config,args.expectedRevision,{commit}));
  }catch(error){
   const code=['CONFIG_CONFLICT','CONFIG_BUSY'].includes(error.code)?error.code:'CONFIG_INVALID_OR_UNAVAILABLE';
   // Validation messages contain no supplied values; unexpected filesystem/provider errors stay local.
   const reason=code==='CONFIG_CONFLICT'?'Configuration changed. Read and preview again before saving.':code==='CONFIG_BUSY'?'Another configuration save is active. Retry after it finishes.':'Configuration could not be validated or saved. Check tool schema and local configuration; no credentials are accepted.';
   return result({ok:false,error:{code,reason}},true);
  }
 });
 return server;
}

export async function serveConfigMcp(options={}){
 const server=createConfigMcpServer(options);
 const stdin=options.stdin??process.stdin,stdout=options.stdout??process.stdout;
 const transport=new StdioServerTransport(stdin,stdout,{maxBufferSize:1024*1024});
 await server.connect(transport);
 stdin.once('end',()=>{void server.close();});
 return server;
}
