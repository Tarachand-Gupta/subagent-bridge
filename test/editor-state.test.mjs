import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-editor-'));
process.env.HARNESS_BRIDGE_HOME=dir;
const {load,save,configRevision}=await import('../lib/core.mjs');
const {editorState,saveEditorDraft,applyEditorRules}=await import('../lib/editor-state.mjs');
const config=task=>({routes:[{id:'test',parents:['pi'],workers:['opencode'],models:[],reasoning:'',usage:'can',task,enabled:false}]});
const commit=async(value,options)=>{const saved=await save(value,options);return {config:saved,revision:configRevision(saved),saved:true,connections:{},warnings:[]};};
test('Save Rules persists a draft without exposing it to agents; Apply publishes it',async()=>{
 await save(config('Original'));let state=await editorState();assert.equal(state.applied,true);
 const draft=await saveEditorDraft(config('Draft'),{expectedRevision:state.revision});assert.equal(draft.applied,false);assert.equal((await load()).routes[0].task,'Original');
 state=await editorState();assert.equal(state.config.routes[0].task,'Draft');assert.equal(state.applied,false);
 const result=await applyEditorRules({expectedRevision:state.revision},{commit});assert.equal(result.applied,true);assert.equal((await load()).routes[0].task,'Draft');assert.equal((await editorState()).applied,true);
});
test('Save and Apply publishes the current edit in one operation',async()=>{
 const state=await editorState();await applyEditorRules({config:config('Combined'),expectedRevision:state.revision},{commit});assert.equal((await load()).routes[0].task,'Combined');
});
test('an external applied change wins; the previous draft stays recoverable and stale writes fail',async()=>{
 let state=await editorState();await saveEditorDraft(config('Pending'),{expectedRevision:state.revision});const stale=await editorState();await save(config('MCP update'));
 state=await editorState();assert.equal(state.config.routes[0].task,'MCP update');assert.equal(state.preservedDraft.routes[0].task,'Pending');
 await assert.rejects(applyEditorRules({expectedRevision:stale.revision},{commit}),{code:'CONFIG_CONFLICT'});
 await assert.rejects(saveEditorDraft(config('Wrong'),{expectedRevision:stale.revision}),{code:'CONFIG_CONFLICT'});
});
test('failed apply retains the saved draft',async()=>{
 const state=await editorState();await saveEditorDraft(config('Retry later'),{expectedRevision:state.revision});const draft=await editorState();
 await assert.rejects(applyEditorRules({expectedRevision:draft.revision},{commit:async()=>{throw new Error('Unavailable');}}),/Unavailable/);
 assert.equal((await editorState()).config.routes[0].task,'Retry later');assert.equal((await load()).routes[0].task,'MCP update');
});
test.after(()=>rm(dir,{recursive:true,force:true}));
