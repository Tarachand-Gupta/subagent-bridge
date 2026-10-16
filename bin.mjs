#!/usr/bin/env node
// Select the shared data directory before importing modules that resolve it.
import path from 'node:path';
const args=process.argv.slice(2);
try{
 const homes=args.flatMap((arg,index)=>arg==='--home'?[index]:[]);
 if(homes.length>1)throw new Error('Specify --home only once');
 if(homes.length){
  const index=homes[0],value=args[index+1];
  if(!value||value.startsWith('--'))throw new Error('--home requires a directory');
  process.env.HARNESS_BRIDGE_HOME=path.resolve(value);
  args.splice(index,2);
 }
 const {runCli}=await import('./lib/cli.mjs');
 await runCli(args);
}catch(error){
 if(args.includes('--json'))console.log(JSON.stringify({ok:false,error:{code:error.code||'CLI_ERROR',message:error.message,...(error.recoveryFile?{recoveryFile:error.recoveryFile}:{})}},null,2));
 else console.error(error.message+(error.recoveryFile?'\nYour edited file is preserved at: '+error.recoveryFile:''));
 process.exitCode=1;
}
