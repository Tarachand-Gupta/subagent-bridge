export const DEFAULT_TASKS = ['General task','Code review','Implementation','Debugging','Research'].map((name,index)=>({id:`default-${index+1}`,name}));
export function taskName(value){
 if(typeof value!=='string')throw new Error('Enter a task name.');
 const name=value.trim().replace(/\s+/gu,' ');
 if(!name)throw new Error('Enter a task name.');
 if(name.length>120)throw new Error('Use 120 characters or fewer.');
 if(/[\u0000-\u001f\u007f]/u.test(name))throw new Error('Use plain text for the task name.');
 if(['auto','any task','__bridge_add_task__'].includes(name.toLowerCase()))throw new Error('Auto is already available for any task. Choose another name.');
 return name;
}
export function uniqueTaskName(value,tasks,id){
 const name=taskName(value);
 if(tasks.some(task=>task.id!==id&&task.name.toLowerCase()===name.toLowerCase()))throw new Error('A task with this name already exists.');
 return name;
}
