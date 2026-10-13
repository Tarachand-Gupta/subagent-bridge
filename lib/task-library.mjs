import path from 'node:path';
import {readFile,writeFile,mkdir,rename,rmdir,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {home} from './core.mjs';
import {DEFAULT_TASKS,taskName,uniqueTaskName} from '../public/task-library.mjs';
const file=path.join(home,'tasks.json');
function state(tasks){return {tasks,revision:createHash('sha256').update(JSON.stringify(tasks)).digest('hex')};}
export async function taskLibrary(){
 let tasks;
 try{tasks=JSON.parse(await readFile(file,'utf8')).tasks;}catch(e){if(e.code!=='ENOENT')throw e;tasks=structuredClone(DEFAULT_TASKS);}
 if(!Array.isArray(tasks)||tasks.length>100)throw new Error('Task list is invalid.');
 const ids=new Set(),names=new Set();
 for(const t of tasks){if(!t||typeof t.id!=='string'||!t.id||ids.has(t.id)||taskName(t.name)!==t.name||names.has(t.name.toLowerCase()))throw new Error('Task list is invalid.');ids.add(t.id);names.add(t.name.toLowerCase());}
 return state(tasks);
}
export async function saveTask({id,name,expectedRevision}={}){
 await mkdir(home,{recursive:true,mode:0o700});const lock=path.join(home,'tasks-write.lock'),deadline=Date.now()+5000;
 while(true){try{await mkdir(lock,{mode:0o700});break;}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>deadline)throw new Error('Another task save is in progress. Try again shortly.');await new Promise(r=>setTimeout(r,25));}}
 let temp;
 try{
  const before=await taskLibrary();if(expectedRevision!==before.revision)throw Object.assign(new Error('Task list changed. The latest list has been loaded; review your name and save again.'),{code:'TASK_CONFLICT'});
  const tasks=before.tasks,index=id===undefined?-1:tasks.findIndex(t=>t.id===id);
  if(id!==undefined&&index===-1)throw new Error('This task no longer exists. Reload the task list.');
  name=uniqueTaskName(name,tasks,id);
  if(index===-1&&tasks.length>=100)throw new Error('You can save up to 100 tasks.');
  const task={id:id??randomUUID(),name};if(index===-1)tasks.push(task);else tasks[index]=task;
  temp=path.join(home,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify({tasks},null,2),{mode:0o600});await rename(temp,file);temp=null;
  return {...state(tasks),task};
 }finally{if(temp)await rm(temp,{force:true});await rmdir(lock);}
}
