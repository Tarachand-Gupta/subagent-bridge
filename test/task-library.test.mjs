import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'bridge-tasks-'));process.env.HARNESS_BRIDGE_HOME=dir;
const {taskLibrary,saveTask}=await import('../lib/task-library.mjs');
const {save,load}=await import('../lib/core.mjs');
test('default tasks are editable; custom tasks persist without publishing rule changes',async()=>{
 const original={routes:[{id:'a',parents:['pi'],workers:['opencode'],models:[],reasoning:'',task:'Research',enabled:false}]};await save(original);
 const s=await taskLibrary();assert.equal(s.tasks.length,5);
 const added=await saveTask({name:'  Security   audit  ',expectedRevision:s.revision});assert.equal(added.task.name,'Security audit');assert.equal((await taskLibrary()).revision,added.revision);
 const renamed=await saveTask({id:added.task.id,name:'Threat modelling',expectedRevision:added.revision});assert.equal(renamed.task.id,added.task.id);assert.equal(renamed.tasks.length,6);
 const research=renamed.tasks.find(t=>t.name==='Research');await saveTask({id:research.id,name:'Discovery',expectedRevision:renamed.revision});assert.equal((await load()).routes[0].task,'Research');
 assert((await readFile(path.join(dir,'tasks.json'),'utf8')).includes('Threat modelling'));
});
test('invalid, reserved, duplicate, and stale edits cannot overwrite the library',async()=>{
 const s=await taskLibrary();for(const name of ['', '  ', 'Auto','ANY TASK','threat modelling','x'.repeat(121)])await assert.rejects(saveTask({name,expectedRevision:s.revision}));
 await assert.rejects(saveTask({id:'missing',name:'Test',expectedRevision:s.revision}),/no longer exists/);
 const updated=await saveTask({name:'Accessibility',expectedRevision:s.revision});
 await assert.rejects(saveTask({name:'Concurrent',expectedRevision:s.revision}),{code:'TASK_CONFLICT'});
 assert.equal((await taskLibrary()).revision,updated.revision);
});
test('concurrent writes have one winner and a recoverable conflict',async()=>{
 const s=await taskLibrary();const results=await Promise.allSettled(['Release audit','Dependency audit'].map(name=>saveTask({name,expectedRevision:s.revision})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'TASK_CONFLICT');
});
test.after(()=>rm(dir,{recursive:true,force:true}));
