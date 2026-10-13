import {taskLibrary,saveTask} from './lib/task-library.mjs';
import {editorState,saveEditorDraft,applyEditorRules} from './lib/editor-state.mjs';
import {validateEnabledRules} from './lib/rule-validation.mjs';
import {connectionStatus,saveAndConnect} from './lib/connections.mjs';
import {detect,load,save,apply,configRevision} from './lib/core.mjs';
import {setupStatus,installSetup} from './lib/setup.mjs';
import {probe} from './lib/agents.mjs';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>262144)throw new Error('Request too large');}
try {
 const {method,path,body}=JSON.parse(input);let result;
 if(method==='GET'&&path==='/api/state'){const state=await editorState();result={agents:await detect(),...state,connections:await connectionStatus(),integration:'Native parent integrations with persistent worker conversations'};}
 else if(method==='GET'&&path==='/api/tasks')result=await taskLibrary();
 else if(method==='POST'&&path==='/api/task-save')result=await saveTask(body);
 else if(method==='GET'&&path==='/api/setup-status')result=await setupStatus();
 else if(method==='POST'&&path==='/api/setup-install'){await installSetup(body.kind,body.id);result=await setupStatus();}
 else if(method==='POST'&&path==='/api/probe')result=await probe(body.agentId,{modelId:body.modelId});
 else if(method==='POST'&&path==='/api/save-connect')result=await saveAndConnect(body.config||body,{expectedRevision:body.expectedRevision});
 else if(method==='POST'&&path==='/api/editor-save')result=await saveEditorDraft(body.config,{expectedRevision:body.expectedRevision});
 else if(method==='POST'&&path==='/api/editor-apply')result=await applyEditorRules(body);
 else if(method==='POST'&&path==='/api/config')result=await save(await validateEnabledRules(body));
 else if(method==='POST'&&path==='/api/apply')result=await apply(body.workspace);
 else if(method==='POST'&&path==='/api/save-apply'){const config=await save(await validateEnabledRules(body.config));try{result={saved:true,...await apply(config.workspace)};}catch(e){result={saved:true,applied:false,error:e.message};}}
 else throw new Error('Unknown desktop operation');
 console.log(JSON.stringify({result}));
}catch(e){console.log(JSON.stringify({error:e.message}));process.exitCode=1;}
