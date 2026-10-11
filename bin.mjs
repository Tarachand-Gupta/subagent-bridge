#!/usr/bin/env node
import {serve} from './lib/server.mjs';
import {load,detect,apply} from './lib/core.mjs';
import {probe,delegate,describeRoutes} from './lib/agents.mjs';
import {closeActiveRPCs} from './lib/rpc.mjs';
import {closeActiveAcpx} from './lib/runtime/acpx.mjs';
const [command='ui',...args]=process.argv.slice(2);
if(command==='delegate')for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{closeActiveRPCs();closeActiveAcpx();setTimeout(()=>process.exit(130),2200);});
const option=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:undefined;};
try{
 let result;
 if(command==='mcp'){const {serveConfigMcp}=await import('./lib/mcp-config.mjs');await serveConfigMcp();}
 else if(command==='ui')await serve(Number(option('port')||4780));
 else if(command==='parent'&&args[0]==='codex'){const {runCodexParent}=await import('./harnesses/codex/integration.mjs');const task=option('task');if(!task)throw new Error('Provide --task for the Bridge-managed Codex parent');const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());result=await runCodexParent({signal:controller.signal,cwd:process.cwd(),task,model:option('model'),onEvent:event=>console.log(JSON.stringify(event))});}
 else if(command==='config'){
  const {configRead,configPreview,configSave}=await import('./lib/mcp-config.mjs');
  if(args[0]==='read')result=await configRead();
  else if(['preview','save'].includes(args[0])){
   const file=option('file');if(!file)throw new Error('Provide --file containing the complete rules configuration');
   const {readFile}=await import('node:fs/promises');const source=await readFile(file,'utf8');if(source.length>262144)throw new Error('Configuration file is too large');
   const config=JSON.parse(source);result=args[0]==='preview'?await configPreview(config):await configSave(config,option('revision'));
  }else throw new Error('Use config read, config preview --file PATH, or config save --file PATH --revision REVISION');
 }
 else if(command==='native'&&args[0]==='codex'){const {nativeCodexCommand}=await import('./harnesses/codex/v0_160/native.mjs');result=await nativeCodexCommand(args.slice(1));}
 else if(command==='detect')result=await detect();
 else if(command==='models')result=await probe(args[0]);
 else if(command==='settings'){const config=await load();result={workspace:config.workspace,inheritWorkspace:config.inheritWorkspace};}
 else if(command==='routes')result=await describeRoutes(option('parent'));
 else if(command==='apply')result=await apply(args[0]);
 else if(command==='delegate')result=await delegate({routeId:option('route'),parent:option('parent'),workspace:option('workspace'),parentWorkspace:option('parent-workspace'),task:option('task'),worker:option('worker'),model:option('model')});
 else if(command==='--help'||command==='help')result={usage:['harness-bridge [ui] [--port 4780]','harness-bridge mcp','harness-bridge config read','harness-bridge config preview --file PATH','harness-bridge config save --file PATH --revision REVISION','harness-bridge detect','harness-bridge parent codex --task TEXT [--model MODEL]','harness-bridge models <harness>','harness-bridge routes [--parent HARNESS]','harness-bridge settings','harness-bridge apply <absolute workspace>','harness-bridge delegate --route ID --parent HARNESS --workspace PATH --task TEXT [--worker HARNESS] [--model MODEL]']};
 else throw new Error('Unknown command; use --help');
 if(result!==undefined)console.log(JSON.stringify(result,null,2));
}catch(e){
 if(command==='delegate')console.log(JSON.stringify({ok:false,error:e.failure||{code:'DELEGATION_FAILED',reason:e.message,stage:'validation',retryable:false,attempts:0,outcomeUnknown:false,nextAction:'Correct the reported configuration before delegating again.'}},null,2));
 else console.error(e.message);
 process.exitCode=1;
}
