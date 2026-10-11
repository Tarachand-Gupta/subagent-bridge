import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Read-only discovery: no thread, turn, hook approval, or configuration mutation.
export function readHookStatus({executable,codexHome,cwd,timeout=6000}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['app-server','--stdio'],{cwd,env:{...process.env,...(codexHome?{CODEX_HOME:codexHome}:{})},stdio:['pipe','pipe','ignore']});
  const lines=createInterface({input:child.stdout});let settled=false;
  const timer=setTimeout(()=>finish(new Error('Codex hook status timed out')),timeout);
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);lines.close();child.stdin.end();child.kill();error?reject(error):resolve(value);}
  function send(value){child.stdin.write(JSON.stringify(value)+'\n');}
  child.on('error',finish);child.stdin.on('error',finish);child.on('close',()=>finish(new Error('Codex hook status disconnected')));
  lines.on('line',line=>{let reply;try{reply=JSON.parse(line);}catch{return;}
   if(reply.error)return finish(new Error('Codex hook status unavailable'));
   if(reply.id===1){send({method:'initialized'});send({id:2,method:'hooks/list',params:{cwds:[cwd]}});}
   else if(reply.id===2)finish(null,reply.result);
   else if(reply.id!==undefined&&reply.method)send({id:reply.id,error:{code:-32601,message:'Read-only hook status client'}});
  });
  send({id:1,method:'initialize',params:{clientInfo:{name:'harness_bridge_status',version:'0.1.0'},capabilities:{experimentalApi:true}}});
 });
}
