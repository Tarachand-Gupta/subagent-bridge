import {taskLibrary,saveTask} from './task-library.mjs';
import {editorState,saveEditorDraft,applyEditorRules} from './editor-state.mjs';
import {validateEnabledRules} from './rule-validation.mjs';
import {connectionStatus,saveAndConnect} from './connections.mjs';
import {setupStatus,installSetup} from './setup.mjs';
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {root,detect,load,save,apply,configRevision} from './core.mjs';
import {probe} from './agents.mjs';
export async function serve(port=4780){
 const token=randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${server.address().port}`;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.host!==`127.0.0.1:${server.address().port}`)return json(403,{error:'Use the printed loopback URL'});
  if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Cross-origin request rejected'});
  try{
   const url=new URL(req.url,origin);
   if(req.method==='GET'&&url.pathname==='/api/state'){const state=await editorState();return json(200,{agents:await detect(),...state,connections:await connectionStatus(),integration:'Native parent integrations with persistent worker conversations'});}
   if(req.method==='GET'&&url.pathname==='/api/tasks')return json(200,await taskLibrary());
   if(req.method==='GET'&&url.pathname==='/api/setup-status')return json(200,await setupStatus());
   if(req.method==='POST'){
    if(req.headers['x-bridge-token']!==token)return json(403,{error:'Reload the local UI before saving'});
    if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON required'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>262144)return json(413,{error:'Request too large'});}const body=JSON.parse(raw);
    if(url.pathname==='/api/task-save')return json(200,await saveTask(body));
    if(url.pathname==='/api/setup-install'){await installSetup(body.kind,body.id);return json(200,await setupStatus());}
    if(url.pathname==='/api/save-connect')return json(200,await saveAndConnect(body.config||body,{expectedRevision:body.expectedRevision}));
    if(url.pathname==='/api/editor-save')return json(200,await saveEditorDraft(body.config,{expectedRevision:body.expectedRevision}));
    if(url.pathname==='/api/editor-apply')return json(200,await applyEditorRules(body));
    if(url.pathname==='/api/config')return json(200,await save(await validateEnabledRules(body)));
    if(url.pathname==='/api/save-apply'){const config=await save(await validateEnabledRules(body.config));try{return json(200,{saved:true,...await apply(config.workspace)});}catch(e){return json(200,{saved:true,applied:false,error:e.message});}}
    if(url.pathname==='/api/probe')return json(200,await probe(body.agentId,{modelId:body.modelId}));
    if(url.pathname==='/api/apply')return json(200,await apply(body.workspace));
    return json(404,{error:'Unknown API'});
   }
   const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/task-library.mjs':['task-library.mjs','text/javascript'],'/setup-state.mjs':['setup-state.mjs','text/javascript'],'/rule-prompt.mjs':['rule-prompt.mjs','text/javascript'],'/mark.svg':['mark.svg','image/svg+xml'],'/rule-validation.mjs':['rule-validation.mjs','text/javascript'],'/style.css':['style.css','text/css']};
   if(req.method!=='GET'||!assets[url.pathname])return json(404,{error:'Not found'});
   const [file,type]=assets[url.pathname];let data=await readFile(path.join(root,'public',file),'utf8');if(file==='index.html')data=data.replaceAll('__BRIDGE_TOKEN__',token);
   res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(data);
  }catch(e){json(400,{error:e.message});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 console.log(`Subagent Bridge: http://127.0.0.1:${server.address().port}`);return server;
}
