// Session controls can exist even when a harness keeps its model choice private.
export function defaultThinking(catalog){
 const option=catalog?.configOptions?.find(o=>/reason|think|effort/i.test([o.id,o.name,o.category].join(' ')));
 const flatten=options=>(options||[]).flatMap(o=>o.options?flatten(o.options):typeof o.value==='string'&&o.value?[[o.value,o.name||o.value]]:[]);
 return flatten(option?.options);
}
// Shared by the editor and save path. Discovery checks configuration, never paid inference.
export function ruleReadiness(rule,agents,catalogs={}){
 const issues=[],pending=[];const catalog=id=>catalogs instanceof Map?catalogs.get(id):catalogs[id];
 const name=id=>agents.find(a=>a.id===id)?.name||id;
 if(!rule.task?.trim())issues.push('Describe the task first.');
 if(!['can','should'].includes(rule.usage||'can'))issues.push('Choose Can use or Should use.');
 const parents=rule.parents?.length?rule.parents:agents.filter(a=>a.installed&&a.compatibility?.supported).map(a=>a.id);
 if(!parents.length)issues.push('Connect a supported parent harness.');
 for(const id of parents){const a=agents.find(a=>a.id===id);if(!a?.installed||!a.compatibility?.supported)issues.push(`${name(id)} needs a supported parent integration.`);}
 const explicit=!!rule.workers?.length,workers=explicit?rule.workers:agents.filter(a=>a.installed&&a.acpReady).map(a=>a.id),usable=[];
 for(const id of workers){
  const errors=[],wait=[];const a=agents.find(a=>a.id===id),c=catalog(id);
  if(!a?.installed||!a.acpReady)errors.push(`${name(id)} needs an installed harness and ACP adapter.`);
  else if(!c)wait.push(`Discover ${name(id)} models in Settings.`);
  else if(c.error)errors.push(`${name(id)} model discovery failed. Refresh it in Settings.`);
  else{
   const selected=(rule.models||[]).filter(m=>m.worker===id),models=selected.length?selected:[{id:c.currentModel||''}];
   for(const m of models){const meta=c.models?.find(x=>x.id===m.id),level=m.reasoning??rule.reasoningByWorker?.[id]??rule.reasoning??'';
    if(!selected.length&&c.harnessDefault&&c.protocolVerified){if(level&&!defaultThinking(c).some(([value])=>value===level))errors.push(`${name(id)} does not advertise ${level} thinking for its default model.`);continue;}
    if(!meta)errors.push(m.id?`${name(id)} no longer advertises ${m.id}.`:`Choose a model for ${name(id)}; no default was found.`);
    else if(level){if(meta.reasoningError)errors.push(`${name(id)} thinking controls could not be verified.`);else if(!Array.isArray(meta.reasoning))wait.push(`Checking ${name(id)} thinking levels…`);else if(!meta.reasoning.some(v=>(typeof v==='string'?v:v.value)===level))errors.push(`${name(id)} does not advertise ${level} thinking for ${m.id}.`);}
   }
  }
  if(!errors.length&&!wait.length)usable.push(id);
  if(explicit){issues.push(...errors);pending.push(...wait);}else pending.push(...wait);
 }
 for(const m of rule.models||[])if(explicit&&!workers.includes(m.worker))issues.push('A selected model belongs to a removed harness.');
 for(const parent of parents)if(!usable.some(id=>id!==parent)&&!pending.length)issues.push(`Choose an available worker other than ${name(parent)}.`);
 if(!explicit&&parents.every(parent=>usable.some(id=>id!==parent)))pending.length=0;
 return {valid:!issues.length&&!pending.length,pending:!issues.length&&!!pending.length,issues:[...new Set(issues)],message:issues[0]||pending[0]||'Ready to enable'};
}
