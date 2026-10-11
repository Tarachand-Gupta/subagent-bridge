import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-failures-'));
process.env.HARNESS_BRIDGE_HOME=path.join(dir,'state');
const oldPath=process.env.PATH;process.env.PATH=dir+path.delimiter+oldPath;
const {save}=await import('../lib/core.mjs');
const {delegate,DELEGATION_LIMITS,describeRoutes}=await import('../lib/agents.mjs');
const {DelegationError,classifyError}=await import('../lib/errors.mjs');
const route={id:'test',parents:['pi'],workers:['opencode'],models:[],reasoning:'',task:'Auto',enabled:true};
const state=path.join(dir,'worker-state.json');
const executable=path.join(dir,'opencode');
await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('1.18.34');process.exit(0);}const fs=require('node:fs');const file=${JSON.stringify(state)};let state=JSON.parse(fs.readFileSync(file,'utf8'));state.starts++;fs.writeFileSync(file,JSON.stringify(state));const mode=state.mode;let buf='';
const record=key=>{state=JSON.parse(fs.readFileSync(file,'utf8'));state[key]=(state[key]||0)+1;if(key==='prompts')state.promptAt=Date.now();fs.writeFileSync(file,JSON.stringify(state));};
const send=o=>console.log(JSON.stringify({jsonrpc:'2.0',...o}));
process.stdin.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);if(!m.method)continue;
if(m.method==='initialize'){
 if(mode==='start-disconnect-always'||mode==='start-disconnect-once'&&state.starts===1)process.exit(1);
 if(mode==='auth'){send({id:m.id,error:{code:-32000,message:'401 authentication invalid API key SECRET_VALUE https://example.test/?token=PRIVATE'}});continue;}
 send({id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});
}else if(m.method==='session/new')send({id:m.id,result:{sessionId:'fake',configOptions:[{id:'model',name:'Model',type:'select',category:'model',currentValue:'only-model',options:[{value:'only-model',name:'Only model'}]}]}});
else if(m.method==='session/prompt'){
 record('prompts');
 if(mode==='prompt-disconnect'){fs.writeFileSync(${JSON.stringify(path.join(dir,'edited.txt'))},'task changed a file');process.exit(1);}
 if(mode==='prompt-timeout')continue;
 if(mode==='permission')send({id:'permission',method:'session/request_permission',params:{sessionId:'fake',toolCall:{toolCallId:'test',title:'Read',status:'pending'},options:[]}});
 if(mode==='refusal'){send({id:m.id,result:{stopReason:'refusal'}});continue;}
 send({method:'session/update',params:{sessionId:'fake',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'done'}}}});send({id:m.id,result:{stopReason:'end_turn'}});
}else send({id:m.id,result:{}});
}});
`);await chmod(executable,0o755);
async function setup(mode,changes={}){await writeFile(state,JSON.stringify({mode,starts:0,prompts:0}));await save({routes:[{...route,...changes}]});}
const args={routeId:'test',parent:'pi',parentWorkspace:dir,task:'test'};
const counts=async()=>JSON.parse(await readFile(state,'utf8'));
async function failure(options){try{await delegate(args,options);assert.fail('Expected delegation failure');}catch(error){assert.ok(error instanceof DelegationError);assert.deepEqual(JSON.parse(JSON.stringify(error)),error.failure);return error.failure;}}
test('startup disconnect retries once and only submits the task on the successful attempt',async()=>{
 await setup('start-disconnect-once');assert.equal((await delegate(args,{limits:{retryDelay:1}})).text,'done');assert.equal((await counts()).starts,2);assert.equal((await counts()).prompts,1);
 await setup('start-disconnect-always');const e=await failure({limits:{retryDelay:1}});assert.equal(e.code,'DISCONNECTED');assert.equal(e.exitCode,1);assert.equal(e.stage,'startup');assert.equal(e.attempts,2);assert.equal(e.outcomeUnknown,false);assert.equal((await counts()).starts,2);assert.equal((await counts()).prompts,0);
});
test('authentication failure is safe to serialize and is never retried',async()=>{
 await setup('auth');const e=await failure();assert.equal(e.code,'AUTH_REQUIRED');assert.equal(e.retryable,false);assert.equal(e.attempts,1);assert.equal(e.worker,'opencode');assert.equal(e.outcomeUnknown,false);assert.doesNotMatch(JSON.stringify(e),/SECRET_VALUE|PRIVATE|example.test/);assert.equal((await counts()).starts,1);
});
test('disconnect after prompt preserves edits and never replays the task',async()=>{
 await setup('prompt-disconnect');const e=await failure();assert.equal(e.code,'DISCONNECTED');assert.equal(e.stage,'prompt');assert.equal(e.outcomeUnknown,true);assert.equal(e.retryable,false);assert.equal(e.attempts,1);assert.match(e.nextAction,/Inspect the project/);assert.equal((await counts()).starts,1);assert.equal((await counts()).prompts,1);assert.equal(await readFile(path.join(dir,'edited.txt'),'utf8'),'task changed a file');
});
test('prompt timeout is bounded, marked unknown, and never retried',async()=>{
 await setup('prompt-timeout');const start=Date.now();const e=await failure({limits:{prompt:60,total:5000}});assert.equal(e.code,'TIMEOUT');assert.equal(e.outcomeUnknown,true);assert.equal(e.retryable,false);assert.equal((await counts()).prompts,1);assert.equal((await counts()).starts,1);assert.ok(Date.now()-(await counts()).promptAt<3000,'Prompt deadline plus bounded worker cleanup');assert.ok(Date.now()-start<8000,'Overall admission deadline plus cleanup allowance');assert.equal(DELEGATION_LIMITS.total,200000);
});
test('permission cancellation, refusal and invalid model remain distinct nonretryable failures',async()=>{
 for(const [mode,expected] of [['permission','PERMISSION_CANCELLED'],['refusal','WORKER_REFUSED']]){await setup(mode);const e=await failure();assert.equal(e.code,expected);assert.equal(e.retryable,false);assert.equal((await counts()).prompts,1);assert.equal((await counts()).starts,1);}
 await setup('normal',{models:[{worker:'opencode',id:'not-advertised'}]});const e=await failure();assert.equal(e.code,'MODEL_UNAVAILABLE');assert.equal(e.stage,'model');assert.equal(e.outcomeUnknown,false);assert.equal((await counts()).prompts,0);assert.equal((await counts()).starts,1);
});
test('classifications and route instructions keep actionable failure policies',async()=>{
 for(const [message,code] of [['429 rate limit token=SECRET','RATE_LIMITED'],['503 overloaded','SERVICE_UNAVAILABLE'],['permission denied','PERMISSION_CANCELLED'],['task refused','WORKER_REFUSED'],['model not found','MODEL_UNAVAILABLE'],['random message with SECRET','WORKER_ERROR']]){const error=classifyError({message});assert.equal(error.code,code);assert.doesNotMatch(error.message,/SECRET/);}
 await setup('normal',{usage:'should'});assert.match((await describeRoutes('pi'))[0].instruction,/Required:.*report the task blocked/);
 await setup('normal',{usage:'can'});assert.match((await describeRoutes('pi'))[0].instruction,/Optional:/);
});
test.after(async()=>{process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true});});
