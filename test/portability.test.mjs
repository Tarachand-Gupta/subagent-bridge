import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertLaunchArguments,execFile,shellCommand,hookCommand} from '../lib/process.mjs';
import {ruleInstruction} from '../public/rule-prompt.mjs';
test('process runner preserves spaces, unicode and shell metacharacters as data',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bridge space ü-'));
 try{const file=path.join(dir,'test child.cjs');await writeFile(file,'console.log(JSON.stringify(process.argv.slice(2)))');const args=['a b','üser','x&y','"quoted"','%PATH%','$(echo nope)'];const result=await execFile(process.execPath,[file,...args],{cwd:dir});assert.deepEqual(JSON.parse(result.stdout),args);}finally{await rm(dir,{recursive:true,force:true});}
});
test('Windows hooks use encoded PowerShell with literal argument quoting',()=>{
 const args=['C:\\Program Files\\nodejs\\node.exe',"C:\\Users\\O'Brien\\bridge.mjs",'hook',JSON.stringify({bridgeHome:'C:\\Users\\A & B'})];
 const encoded=hookCommand(args,'win32').split(' ').at(-1);const command=Buffer.from(encoded,'base64').toString('utf16le');assert.equal(command,shellCommand(args,'win32'));assert.match(command,/O''Brien/);assert.ok(command.startsWith("& 'C:\\Program Files"));
 assert.throws(()=>assertLaunchArguments('npm.cmd',['ok\nmalicious'],'win32'),/line breaks/);
});
test('prompt preview preserves explicit Auto thinking over inherited high',()=>{
 const r={parents:['codex'],workers:['pi'],models:[{worker:'pi',id:'provider/model',reasoning:''}],reasoning:'high',reasoningByWorker:{},task:'Research',usage:'should'};
 assert.match(ruleInstruction(r),/^Required:/);assert.match(ruleInstruction(r),/provider\/model \(thinking: harness default\)/);assert.match(ruleInstruction(r),/Default thinking for models without an override: high/);
 const auto={...r,parents:[],workers:[],models:[],task:'Auto',usage:'can'};assert.match(ruleInstruction(auto),/any parent harness needs any task/);assert.match(ruleInstruction(auto),/Model Auto/);
});

test('process failures preserve exit code and stderr for missing-configuration detection',async()=>{
 await assert.rejects(execFile(process.execPath,['-e',"console.error('No MCP server named harness-bridge');process.exit(1)"]),error=>error.code===1&&/No MCP server named/.test(error.stderr));
});

test('Windows npm-style cmd launchers preserve literal arguments',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bridge shim space-'));
 try{const script=path.join(dir,'echo.cjs'),shim=path.join(dir,'agent.cmd');await writeFile(script,'console.log(JSON.stringify(process.argv.slice(2)))');await writeFile(shim,'@echo off\r\n"'+process.execPath+'" "'+script+'" %*\r\n');const args=['one two','a&b','%PATH%','"quoted"'];const result=await execFile(shim,args);assert.deepEqual(JSON.parse(result.stdout),args);}finally{await rm(dir,{recursive:true,force:true});}
});
