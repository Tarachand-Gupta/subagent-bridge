import test from 'node:test';
import assert from 'node:assert/strict';
import {ruleReadiness} from '../public/rule-validation.mjs';
import {validateEnabledRules} from '../lib/rule-validation.mjs';
import {validate} from '../lib/core.mjs';
const agents=['pi','opencode'].map(id=>({id,name:id,installed:true,acpReady:true,compatibility:{supported:true}}));
const catalog={models:[{id:'provider/model',reasoning:['low','high']}],currentModel:'provider/model'};
const catalogs={pi:catalog,opencode:catalog};
const rule={id:'r',parents:['pi'],workers:['opencode'],models:[{worker:'opencode',id:'provider/model'}],task:'Review',reasoning:'',usage:'can',enabled:true};
test('readiness validates advertised model, thinking and distinct parent/worker',()=>{
 assert.equal(ruleReadiness(rule,agents,catalogs).valid,true);
 for(const changed of [{task:''},{workers:['pi'],models:[]},{models:[{worker:'opencode',id:'missing'}]},{models:[{worker:'opencode',id:'provider/model',reasoning:'ultra'}]}])assert.equal(ruleReadiness({...rule,...changed},agents,catalogs).valid,false);
 assert.equal(ruleReadiness(rule,[agents[0],{...agents[1],acpReady:false}],catalogs).valid,false);
 assert.equal(ruleReadiness(rule,[{...agents[0],compatibility:{supported:false}},agents[1]],catalogs).valid,false);
});
test('discovery is pending until verified; failure is actionable; Auto needs a usable alternative for each parent',()=>{
 assert.equal(ruleReadiness(rule,agents,{}).pending,true);
 assert.match(ruleReadiness(rule,agents,{opencode:{error:'offline'}}).message,/discovery failed/);
 const auto={...rule,parents:[],workers:[],models:[]};assert.equal(ruleReadiness(auto,agents,catalogs).valid,true);
 assert.equal(ruleReadiness(auto,agents,{pi:catalog,opencode:{error:'offline'}}).valid,false);
});
test('disabled incomplete drafts persist but cannot be enabled',()=>{
 assert.equal(validate({routes:[{...rule,enabled:false,task:''}]}).routes[0].task,'');
 assert.throws(()=>validate({routes:[{...rule,task:''}]}),/Describe/);
});
test('save validation probes thinking per model, honors explicit Auto, and rejects enabled invalid rules',async()=>{
 const calls=[],dependencies={inventory:async()=>agents,catalog:async(id,options)=>{calls.push([id,options]);return options?catalog:{...catalog,models:[{id:'provider/model'}]};}};
 const value={routes:[{...rule,reasoning:'high'}]};await validateEnabledRules(value,dependencies);assert.deepEqual(calls[1],['opencode',{modelId:'provider/model'}]);
 calls.length=0;await validateEnabledRules({routes:[{...rule,reasoning:'high',models:[{worker:'opencode',id:'provider/model',reasoning:''}]}]},dependencies);assert.equal(calls.length,1);
 await assert.rejects(validateEnabledRules({routes:[{...rule,models:[{worker:'opencode',id:'missing'}]}]},dependencies),/no longer advertises/);
 calls.length=0;await validateEnabledRules({routes:[{...rule,enabled:false,task:''}]},dependencies);assert.equal(calls.length,0);
});

test('a verified ACP worker with no model controls accepts only harness default',()=>{
 const opaque={models:[],currentModel:'',protocolVerified:true,harnessDefault:true};
 const defaultRule={...rule,models:[],reasoning:''};
 assert.equal(ruleReadiness(defaultRule,agents,{opencode:opaque}).valid,true);
 assert.equal(ruleReadiness({...defaultRule,reasoning:'high'},agents,{opencode:opaque}).valid,false);
 assert.equal(ruleReadiness(rule,agents,{opencode:opaque}).valid,false);
 assert.equal(ruleReadiness(defaultRule,agents,{opencode:{...opaque,protocolVerified:false}}).valid,false);
});
test('readiness reports failed discovery without mutating the enabled rule',()=>{
 const retained=structuredClone(rule);assert.equal(ruleReadiness(retained,agents,{opencode:{...catalog,error:'Offline'}}).valid,false);
 assert.deepEqual(retained,rule);
});

test('default-model thinking uses independently advertised ACP controls',()=>{
 const c={models:[],currentModel:'managed-current-model',harnessDefault:true,protocolVerified:true,configOptions:[{id:'thought_level',name:'Thinking',options:[{name:'Levels',options:[{value:'high',name:'High'}]}]}]};
 assert.equal(ruleReadiness({...rule,models:[],reasoning:'high'},agents,{opencode:c}).valid,true);
 assert.equal(ruleReadiness({...rule,models:[],reasoning:'low'},agents,{opencode:c}).valid,false);
});
