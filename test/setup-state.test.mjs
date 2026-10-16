import test from 'node:test';
import assert from 'node:assert/strict';
import {parentSetup,workerSetup,failedDiscovery} from '../public/setup-state.mjs';
const pi={id:'pi',installed:true,acpReady:true,nativeParent:true,compatibility:{supported:true}};
test('configuration, ACP discovery, and live health are distinct labels',()=>{
 assert.equal(parentSetup(pi,{current:true,message:'Run /reload'}).label,'Configured');
 assert.equal(workerSetup(pi).label,'Adapter found');
 assert.equal(workerSetup(pi,{error:'Offline'}).label,'Discovery failed');
 assert.equal(workerSetup(pi,{protocolVerified:true}).label,'ACP checked');
 assert.equal(parentSetup({...pi,id:'codex'},{current:true}).label,'Approval not verified');
 assert.equal(parentSetup({...pi,id:'codex'},{current:true,trustRequired:false}).label,'Configured');
 assert.equal(parentSetup({...pi,id:'codex'},{current:true,trustRequired:true}).label,'Review hooks');
 assert.equal(parentSetup(pi,{current:false,installed:true}).needsApply,true);
});
test('registry workers do not masquerade as native orchestrator connections',()=>{
 const generic={...pi,id:'gemini',nativeParent:false,compatibility:{supported:false}};
 assert.equal(parentSetup(generic,{}).label,'Subagent only');
 assert.equal(workerSetup(generic).label,'Adapter found');
 assert.equal(workerSetup({...generic,worker:{status:'catalog-only',reason:'No local recipe'}}).label,'Catalog only');
});
test('failed discovery preserves a previous model list but keeps failure visible',()=>{
 const before={models:[{id:'a',reasoning:['high']}],currentModel:'a'};
 const after=failedDiscovery(before,'Disconnected');
 assert.deepEqual(after.models,before.models);assert.equal(after.stale,true);assert.equal(after.error,'Disconnected');
 assert.equal(before.error,undefined);assert.deepEqual(failedDiscovery(undefined,'Disconnected').models,[]);
});
