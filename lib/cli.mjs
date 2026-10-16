import path from 'node:path';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {home,root,load,detect,apply,configRevision} from './core.mjs';
import {editorState,saveEditorDraft,applyEditorRules} from './editor-state.mjs';
import {configRead,configPreview,configSave,validateConfigInput} from './mcp-config.mjs';
import {validateEnabledRules} from './rule-validation.mjs';
import {editConfig} from './config-editor.mjs';

const MAX_CONFIG_BYTES=262144;
export const help=`Subagent Bridge — use other coding agents as subagents.

Usage: subagent-bridge <command> [options]

Shared configuration (the same files as the desktop app):
  config path                            Print the active config file path
  config status                          Show draft/applied state and revisions
  config show [--active | --preserved]    Print editable JSON (current draft by default)
  config show --output FILE [--active]    Export JSON to a new file
  config edit [--editor COMMAND]          Edit and save a draft using VISUAL/EDITOR
  config edit --apply                    Edit, validate, and apply immediately
  config import --file FILE [--apply]     Import a complete configuration as a draft
  config validate [--file FILE]           Check config structure, without starting agents
  config validate --check-agents          Also discover enabled workers/models/thinking
  config preview [--file FILE]            Show instructions and changes versus active rules
  config apply                           Validate and apply the current saved draft

Automation / existing commands:
  config read                            Active config, instructions, and revision
  config save --file FILE --revision REV  Legacy immediate save + apply (not a draft)
  detect                                 Detect installed harnesses
  models HARNESS                         Discover available models
  routes [--parent HARNESS]               Show active delegation rules
  mcp                                    Serve configuration MCP over stdio
  ui [--port 4780]                        Open a local UI server (also the default command)
  settings                               Show legacy workspace preferences
  apply ABSOLUTE_DIRECTORY                Legacy project instruction export
  parent codex --task TEXT [--model ID]    Start a Bridge-managed Codex parent
  delegate --route ID --parent HARNESS --workspace PATH --task TEXT
             [--worker HARNESS] [--model ID] [--parent-workspace PATH]

Options:
  --home DIRECTORY    Override ~/.harness-bridge for this process and its children
  --revision REV      Require an observed editor revision for edit/import/apply
  --json              JSON output, including errors (MCP always uses its own protocol)
  --help, --version

Save a draft first; config apply publishes it to agents and connects native parents.
The app shows CLI changes on refresh/reopen. Installed parents read applied rules next turn.
Use an editor that waits for completion, for example --editor "code --wait".
Plain delegate waits for its result; background jobs use the parent integration.
`;

export function parseOptions(args,{values=[],flags=[],positionals=0}={}){
 const options={},rest=[];
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(!arg.startsWith('--')){rest.push(arg);continue;}
  const name=arg.slice(2);
  if(Object.hasOwn(options,name))throw new Error(`Specify --${name} only once`);
  if(flags.includes(name)){options[name]=true;continue;}
  if(!values.includes(name))throw new Error(`Unknown option --${name}`);
  const value=args[++i];if(value===undefined||value.startsWith('--'))throw new Error(`--${name} requires a value`);
  options[name]=value;
 }
 if(rest.length>positionals)throw new Error('Unexpected argument: '+rest[positionals]);
 return {options,rest};
}
const revision=value=>{
 if(value!==undefined&&!/^[a-f0-9]{64}$/.test(value))throw new Error('--revision must be a revision returned by config status/read');
 return value;
};
async function readConfig(file){
 if(!file)throw new Error('Provide --file containing the complete rules configuration');
 if((await stat(file)).size>MAX_CONFIG_BYTES)throw new Error('Configuration file is too large');
 const bytes=await readFile(file);if(bytes.length>MAX_CONFIG_BYTES)throw new Error('Configuration file is too large');
 let parsed;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('Configuration file must contain valid JSON');}
 return validateConfigInput(parsed);
}
const paths=()=>({home,config:path.join(home,'config.json'),draft:path.join(home,'editor-draft.json'),tasks:path.join(home,'tasks.json')});

export async function configCommand(args,{readState=editorState,readActive=load,saveDraft=saveEditorDraft,applyRules=applyEditorRules,edit=editConfig}={}){
 const [action='status',...tail]=args;
 if(action==='path'){parseOptions(tail);return {text:paths().config,json:paths()};}
 if(action==='status'){
  parseOptions(tail);const state=await readState();
  return {ok:true,...paths(),revision:state.revision,activeRevision:state.activeRevision,applied:state.applied,pendingDraft:!state.applied,preservedDraft:!!state.preservedDraft};
 }
 if(action==='show'){
  const {options}=parseOptions(tail,{values:['output'],flags:['active','preserved']});
  if(options.active&&options.preserved)throw new Error('Choose --active or --preserved, not both');
  const config=options.active?await readActive():options.preserved?(await readState()).preservedDraft:(await readState()).config;
  if(!config)throw new Error('There is no superseded draft to recover');
  if(!options.output)return config;
  const file=path.resolve(options.output);await writeFile(file,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  return {ok:true,file,source:options.active?'active':options.preserved?'preserved':'editor'};
 }
 if(action==='read'){parseOptions(tail);return configRead({read:readActive});}
 if(action==='validate'||action==='preview'){
  const {options}=parseOptions(tail,{values:['file'],flags:action==='validate'?['check-agents']:[]});
  const value=options.file?await readConfig(options.file):validateConfigInput((await readState()).config);
  if(action==='preview')return configPreview(value,{read:readActive});
  if(options['check-agents'])await validateEnabledRules(value);
  return {ok:true,valid:true,scope:options['check-agents']?'enabled-rule-readiness':'structure',message:options['check-agents']?'Enabled rules passed current capability discovery; no model task was submitted.':'Configuration structure is valid. Harness availability and provider access were not checked.',config:value};
 }
 if(action==='save'){
  const {options}=parseOptions(tail,{values:['file','revision']});
  return configSave(await readConfig(options.file),revision(options.revision));
 }
 if(!['edit','import','apply'].includes(action))throw new Error('Unknown config command; use subagent-bridge config --help');
 const {options}=parseOptions(tail,{values:['revision',...(action==='edit'?['editor']:action==='import'?['file']:[])],flags:action==='apply'?[]:['apply']});
 const before=await readState(),expectedRevision=revision(options.revision)??before.revision;
 if(expectedRevision!==before.revision)throw Object.assign(new Error('Configuration changed. Read the latest config status before editing or applying.'),{code:'CONFIG_CONFLICT'});
 if(before.preservedDraft&&action!=='import')throw Object.assign(new Error('An external change superseded the saved draft. Export it with config show --preserved, reconcile it with the active rules, then import the result before editing or applying.'),{code:'CONFIG_CONFLICT'});
 if(action==='apply'){
  return applyRules({expectedRevision});
 }
 let edited;
 try{
  const config=action==='edit'?(edited=await edit(before.config,{editor:options.editor})).config:await readConfig(options.file);
  const value=validateConfigInput(config);
  if(action==='edit'&&configRevision(value)===before.revision&&!options.apply){
   await edited.cleanup();return {ok:true,changed:false,applied:before.applied,message:'No changes made.'};
  }
  const result=options.apply?await applyRules({config:value,expectedRevision}):await saveDraft(value,{expectedRevision});
  if(edited)await edited.cleanup();
  return {ok:true,...result,message:result.message||(result.applied?'Rules match the active configuration.':'Draft saved. Run subagent-bridge config apply to activate it.')};
 }catch(error){if(edited)error.recoveryFile=edited.file;throw error;}
}

export async function runCli(argv){
 const args=[...argv],json=args.includes('--json');
 if(args.filter(a=>a==='--json').length>1)throw new Error('Specify --json only once');
 const jsonIndex=args.indexOf('--json');if(jsonIndex>=0)args.splice(jsonIndex,1);
 const [command='ui',...tail]=args;
 if(command==='help'||args.includes('--help')){console.log(json?JSON.stringify({help}):help);return;}
 if(command==='--version'){const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));console.log(json?JSON.stringify({version:pkg.version}):pkg.version);return;}
 let result;
 if(command==='config')result=await configCommand(tail);
 else if(command==='mcp'){parseOptions(tail);const {serveConfigMcp}=await import('./mcp-config.mjs');await serveConfigMcp();}
 else if(command==='ui'){
  const {options}=parseOptions(tail,{values:['port']});const port=Number(options.port??4780);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Port must be between 0 and 65535');
  const {serve}=await import('./server.mjs');await serve(port);
 }
 else if(command==='detect'){parseOptions(tail);result=await detect();}
 else if(command==='settings'){parseOptions(tail);const config=await load();result={workspace:config.workspace,inheritWorkspace:config.inheritWorkspace};}
 else if(command==='models'){
  const {rest,options}=parseOptions(tail,{positionals:1,values:['model']});if(!rest[0])throw new Error('Provide a harness ID; use detect to list harnesses');
  const {probe}=await import('./agents.mjs');result=await probe(rest[0],{modelId:options.model});
 }
 else if(command==='routes'){
  const {options}=parseOptions(tail,{values:['parent']});const {describeRoutes}=await import('./agents.mjs');result=await describeRoutes(options.parent);
 }
 else if(command==='apply'){const {rest}=parseOptions(tail,{positionals:1});result=await apply(rest[0]);}
 else if(command==='native'&&tail[0]==='codex'){
  const {nativeCodexCommand}=await import('../harnesses/codex/v0_160/native.mjs');result=await nativeCodexCommand(tail.slice(1));
 }
 else if(command==='parent'&&tail[0]==='codex'){
  const {options}=parseOptions(tail.slice(1),{values:['task','model']});if(!options.task)throw new Error('Provide --task for the Bridge-managed Codex parent');
  const {runCodexParent}=await import('../harnesses/codex/integration.mjs');const controller=new AbortController();
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());
  result=await runCodexParent({signal:controller.signal,cwd:process.cwd(),task:options.task,model:options.model,onEvent:event=>console.log(JSON.stringify(event))});
 }
 else if(command==='delegate'){
  const {options}=parseOptions(tail,{values:['route','parent','workspace','parent-workspace','task','worker','model']});
  const [{delegate},{closeActiveRPCs},{closeActiveAcpx}]=await Promise.all([import('./agents.mjs'),import('./rpc.mjs'),import('./runtime/acpx.mjs')]);
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{closeActiveRPCs();closeActiveAcpx();setTimeout(()=>process.exit(130),2200);});
  try{result=await delegate({routeId:options.route,parent:options.parent,workspace:options.workspace,parentWorkspace:options['parent-workspace'],task:options.task,worker:options.worker,model:options.model});}
  catch(error){result={ok:false,error:error.failure||{code:'DELEGATION_FAILED',reason:error.message,stage:'validation',retryable:false,attempts:0,outcomeUnknown:false,nextAction:'Correct the reported configuration before delegating again.'}};process.exitCode=1;}
 }
 else throw new Error('Unknown command; use --help');
 if(result!==undefined)console.log(result.text!==undefined?(json?JSON.stringify(result.json,null,2):result.text):JSON.stringify(result,null,2));
}
