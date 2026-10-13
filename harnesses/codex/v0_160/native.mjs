import http from 'node:http';
import {spawn,execFile,shellCommand} from '../../../lib/process.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createParentBridge,ruleGuidance,completionText} from '../../../lib/parent-bridge.mjs';
import {home,root,which} from '../../../lib/core.mjs';
const self=fileURLToPath(import.meta.url);
export async function installedCodexVersion(){const command=await which('codex');if(!command)return null;try{const {stdout}=await execFile(command,['--version'],{timeout:5000,windowsHide:true});return stdout.match(/\b(\d+\.\d+\.\d+(?:-[^\s]+)?)\b/)?.[1]||null;}catch{return null;}}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const error=reason=>({code:'PARENT_SERVICE_UNAVAILABLE',reason,stage:'parent',retryable:false,outcomeUnknown:true,nextAction:'Inspect the saved job status and workspace before starting another task.'});
export function sessionDirectory({sessionId,cwd,bridgeHome=home}){
 if(!sessionId||!path.isAbsolute(cwd||''))throw new Error('An exact parent session and absolute working folder are required');
 return path.join(bridgeHome,'codex-sessions',createHash('sha256').update(JSON.stringify([sessionId,cwd])).digest('hex').slice(0,32));
}
async function json(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}
async function write(file,value){const temp=file+'.'+randomBytes(6).toString('hex');await fs.writeFile(temp,JSON.stringify(value),{mode:0o600});await fs.rename(temp,file);}
export async function createNativeService(options,{createBridge=createParentBridge,stopWaitMs=205000,idleMs=1800000}={}){
 const dir=sessionDirectory(options);await fs.mkdir(dir,{recursive:true,mode:0o700});
 const stateFile=path.join(dir,'jobs.json'),saved=await json(stateFile)||{},jobs=new Map(Object.entries(saved)),ctx={sessionId:options.sessionId,cwd:options.cwd};
 for(const j of jobs.values())if(j.status==='running'){j.status='failed';j.error=error('The parent service stopped before the worker outcome was recorded. Work is not replayed.');j.offered=false;}
 let persistTail=Promise.resolve(),lastUse=Date.now(),stopping=false;
 const persist=()=>{for(const [id,j]of jobs){if(jobs.size<=256)break;if(j.status!=='running'&&j.offered)jobs.delete(id);}persistTail=persistTail.then(()=>write(stateFile,Object.fromEntries(jobs)));return persistTail;};
 const bridge=createBridge({parent:'codex',bridgeHome:options.bridgeHome||home,bridgeRoot:options.bridgeRoot||root,notify:async value=>{const previous=jobs.get(value.jobId);jobs.set(value.jobId,{...previous,...value,offered:previous?.status!=='running'&&previous?.offered===true});await persist();}});
 await persist();
 async function syncRunning(){
  let changed=false;
  for(const [id,previous]of jobs){
   if(previous.status!=='running')continue;
   let value;
   try{value=await bridge.execute('bridge_status',{jobId:id},ctx);}
   catch{value={jobId:id,status:'failed',error:error('The live job is no longer available in its parent service. Inspect its outcome before starting new work.')};}
   // A completion callback may have updated and delivered the same job while
   // status was being read. Never overwrite that newer terminal delivery state.
   const current=jobs.get(id);if(current?.status!=='running')continue;
   if(JSON.stringify(value)!==JSON.stringify(Object.fromEntries(Object.entries(current).filter(([key])=>key!=='offered')))){
    jobs.set(id,{...current,...value,offered:false});changed=true;
   }
  }
  if(changed)await persist();
 }
 async function execute(request){
  lastUse=Date.now();if(stopping)throw new Error('Parent service is closing');
  if(request.op==='ping')return {ready:true,capabilities:{modelReasoning:1}};
  if(request.op==='close'){stopping=true;await bridge.close();return {closed:true};}
  if(request.op==='drain'){
   const deadline=Date.now()+Math.max(0,Math.min(stopWaitMs,Number(request.waitMs)||0));
   do{
    await syncRunning();
    const results=[...jobs.values()].filter(j=>j.status!=='running'&&!j.offered);
    if(results.length&&(!request.waitAll||!bridge.activeCount||Date.now()>=deadline)){for(const j of results)j.offered=true;await persist();return {results,activeCount:bridge.activeCount};}
    if(!bridge.activeCount||Date.now()>=deadline)break;
    await pause(Math.min(100,Math.max(1,deadline-Date.now())));
   }while(true);
   return {results:[],activeCount:bridge.activeCount};
  }
  if(request.op==='release'){for(const id of request.ids||[]){const j=jobs.get(id);if(j)j.offered=false;}await persist();return {};}
  if(request.op==='status'&&jobs.has(request.args?.jobId)){await syncRunning();return jobs.get(request.args.jobId);}
  if(!['routes','delegate','message','status','cancel'].includes(request.op))throw new Error('Unknown parent operation');
  if(request.op==='message'&&jobs.get(request.args?.jobId)?.error?.code==='PARENT_SERVICE_UNAVAILABLE')throw new Error('Worker conversation was lost with the service. Inspect outcome before creating new work.');
  const value=await bridge.execute('bridge_'+request.op,request.args||{},ctx);
  if(value.jobId){const previous=jobs.get(value.jobId);jobs.set(value.jobId,{...previous,...value,offered:previous?.offered||false});await persist();}
  if(request.op==='cancel')await syncRunning();
  return value;
 }
 const token=randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end('{}');return;}
  let text='';try{for await(const chunk of req){text+=chunk;if(text.length>200000)throw new Error('Request too large');}
   const value=await execute(JSON.parse(text));res.end(JSON.stringify({ok:true,value}));
   if(stopping)void close();
  }catch(e){res.end(JSON.stringify({ok:false,error:e.message||'Parent operation failed'}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const endpoint={pid:process.pid,port:server.address().port,token};await write(path.join(dir,'endpoint.json'),endpoint);
 const timer=setInterval(()=>{if(!bridge.activeCount&&Date.now()-lastUse>idleMs)void close();},Math.min(idleMs,60000));timer.unref();
 let closing;
 function close(){return closing??=(async()=>{stopping=true;clearInterval(timer);await bridge.close();for(const j of jobs.values())if(j.status==='running'){j.status='failed';j.error=error('Parent service closed while work was pending.');j.offered=false;}await persist();await new Promise(r=>server.close(r));await fs.rm(path.join(dir,'endpoint.json'),{force:true});})();}
 return {execute,close,endpoint,dir};
}
async function post(endpoint,request,timeout=215000){
 const response=await fetch('http://127.0.0.1:'+endpoint.port,{method:'POST',headers:{authorization:'Bearer '+endpoint.token,'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(timeout)});
 const value=await response.json();if(!value.ok)throw new Error(value.error||'Parent service rejected request');return value.value;
}
export async function nativeRequest(options,request,{start=true}={}){
 const dir=sessionDirectory(options),endpointFile=path.join(dir,'endpoint.json');let endpoint=await json(endpointFile),handshake;
 if(endpoint){try{handshake=await post(endpoint,{op:'ping'},1000);}catch{endpoint=null;}}
 if(!endpoint&&!start)return null;
 if(!endpoint){
  await fs.mkdir(dir,{recursive:true,mode:0o700});const lock=path.join(dir,'starting');let acquired=false;
  try{await fs.mkdir(lock);acquired=true;}catch{}
  if(!acquired){const info=await fs.stat(lock).catch(()=>null);if(info&&Date.now()-info.mtimeMs>15000){await fs.rm(lock,{recursive:true,force:true});try{await fs.mkdir(lock);acquired=true;}catch{}}}
  if(acquired){
   const child=spawn(process.execPath,[self,'serve',JSON.stringify(options)],{cwd:options.cwd,env:{...process.env,HARNESS_BRIDGE_HOME:options.bridgeHome||home},detached:true,stdio:'ignore'});child.unref();child.on('error',()=>{});
  }
  for(let i=0;i<80;i++){await pause(100);endpoint=await json(endpointFile);if(endpoint){try{handshake=await post(endpoint,{op:'ping'},500);break;}catch{endpoint=null;}}}
  if(acquired)await fs.rm(lock,{recursive:true,force:true});
  if(!endpoint)throw new Error('Cannot start the Codex parent service. No worker has been replayed.');
 }
 // An already-running daemon may still own a worker host with the old schema.
 // Reject only affected new turns; leave retrieval and cancellation available.
 if(['delegate','message'].includes(request.op)&&!handshake?.capabilities?.modelReasoning){
  const config=await json(path.join(options.bridgeHome||home,'config.json'));
  const routeId=request.op==='delegate'?request.args?.route:(await json(path.join(dir,'jobs.json')))?.[request.args?.jobId]?.route;
  const routes=(config?.routes||[]).filter(route=>!routeId||route.id===routeId);
  if(routes.some(route=>route.models?.some(model=>Object.hasOwn(model,'reasoning')))){
   throw new Error('BRIDGE_UPGRADE_REQUIRED: This Codex chat still uses an older bridge process that cannot apply per-model thinking. No task or message was submitted. Use a new Codex chat for the updated settings. Existing jobs remain available for status, completion delivery and cancellation; no work was restarted or replayed.');
  }
 }
 // Mutating requests are never automatically retried: their outcome could already have taken effect.
 return post(endpoint,request);
}
export function nativeInstructions(options,routes){
 const command=shellCommand([process.execPath,self,'cli','--session-id',options.sessionId,'--cwd',options.cwd,'--home',options.bridgeHome||home]);
 return ruleGuidance+'\nNative Codex connection: use your '+(process.platform==='win32'?'PowerShell':'shell')+' tool to execute '+command+(process.platform==='win32'?' --op OP --json-file PATH_TO_UTF8_JSON. Write operation arguments as JSON to a temporary file to preserve native PowerShell quoting.':' --op OP --json JSON_ARGUMENTS.')+' Operations: routes {}; delegate {route,task,worker?,model?}; message {jobId,message}; status {jobId}; cancel {jobId}. Quote JSON as a single shell argument. Reuse the returned jobId for followups. Session identity above is private to this parent; never substitute another session. Hooks deliver completed results during active turns or at Stop. An idle chat is not woken; undelivered results arrive next turn. Current rules: '+JSON.stringify(routes);
}
export async function handleNativeHook(input,options={},request=nativeRequest,version=installedCodexVersion){
 if(process.env.HARNESS_BRIDGE_DEPTH||process.env.HARNESS_BRIDGE_MANAGED_PARENT)return {};
 const ctx={...options,sessionId:input.session_id,cwd:input.cwd};
 if(!ctx.sessionId||!path.isAbsolute(ctx.cwd||''))return {};
 const event=input.hook_event_name;
 if(await version()!=='0.160.1')return {systemMessage:'Subagent Bridge native connection disabled: the resolved Codex CLI version is not the tested 0.160.1. Update the Bridge integration before delegating.'};
 if(event==='SessionStart'||event==='UserPromptSubmit'){
  const routes=await request(ctx,{op:'routes'});const pending=await request(ctx,{op:'drain'});
  return {hookSpecificOutput:{hookEventName:event,additionalContext:nativeInstructions(ctx,routes)+(pending?.results?.length?'\n'+pending.results.map(completionText).join('\n'):'')}};
 }
 if(event==='PostToolUse'||event==='Stop'){
  const result=await request(ctx,{op:'drain',waitAll:event==='Stop',waitMs:event==='Stop'&&!input.stop_hook_active?205000:0},{start:false});
  if(result?.results.length){const text=result.results.map(completionText).join('\n')+(result.activeCount?'\nOther jobs remain pending. Report pending work; do not poll or resubmit. An idle chat is not woken; remaining results are offered next turn.':'');return event==='Stop'?{decision:'block',reason:text}:{hookSpecificOutput:{hookEventName:event,additionalContext:text}};}
  if(event==='Stop'&&result?.activeCount&&!input.stop_hook_active)return {decision:'block',reason:'Subagent Bridge still has pending work after its bounded wait. Tell the user it is pending; do not loop, poll, or resubmit it. Results remain recoverable with status and will be offered next turn.'};
 }
 return {};
}
export async function nativeCodexCommand(argv){
 if(await installedCodexVersion()!=='0.160.1')throw new Error('Native connection disabled: resolved Codex CLI is not tested version 0.160.1');
 const values={};for(let i=0;i<argv.length;i++)if(argv[i].startsWith('--'))values[argv[i].slice(2)]=argv[++i];
 const options={sessionId:values['session-id']||values.session,cwd:values.cwd||process.cwd(),bridgeHome:values.home||home};
 return nativeRequest(options,{op:values.op||'routes',args:JSON.parse(values['json-file']?await fs.readFile(values['json-file'],'utf8'):values.json||'{}')});
}
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 const mode=process.argv[2];
 try{
  if(mode==='serve'){const service=await createNativeService(JSON.parse(process.argv[3]));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void service.close());}
  else if(mode==='cli')console.log(JSON.stringify(await nativeCodexCommand(process.argv.slice(3))));
  else if(mode==='hook'||mode==='hook-base64'){
   let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1000000)throw new Error('Hook input too large');}
   const options=JSON.parse(mode==='hook-base64'?Buffer.from(process.argv[3]||'e30=','base64').toString('utf8'):process.argv[3]||'{}');console.log(JSON.stringify(await handleNativeHook(JSON.parse(input),options)));
  }
 }catch(e){console.log(JSON.stringify(mode?.startsWith('hook')?{systemMessage:'Subagent Bridge connection failed: '+e.message}:{ok:false,error:e.message}));process.exitCode=mode?.startsWith('hook')?0:1;}
}
