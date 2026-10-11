import {validate,detect} from './core.mjs';
import {probe} from './agents.mjs';
import {ruleReadiness} from '../public/rule-validation.mjs';
export async function validateEnabledRules(value,{inventory=detect,catalog=probe}={}){
 const config=validate(value),enabled=config.routes.filter(r=>r.enabled);if(!enabled.length)return config;
 const agents=await inventory(),catalogs={},ids=[...new Set(enabled.flatMap(r=>r.workers.length?r.workers:agents.filter(a=>a.installed&&a.acpReady).map(a=>a.id)))];
 await Promise.all(ids.map(async id=>{try{catalogs[id]=await catalog(id);}catch{catalogs[id]={error:'Unavailable'};}}));
 const requests=new Map();for(const r of enabled)for(const id of ids){if(r.workers.length&&!r.workers.includes(id))continue;const c=catalogs[id];if(!c||c.error)continue;const selected=r.models.filter(m=>m.worker===id),models=selected.length?selected:[{id:c.currentModel}];for(const m of models){const level=m.reasoning??r.reasoningByWorker?.[id]??r.reasoning,meta=c.models?.find(x=>x.id===m.id);if(level&&meta&&!Array.isArray(meta.reasoning))requests.set(JSON.stringify([id,m.id]),[id,m.id,meta]);}}
 await Promise.all([...requests.values()].map(async([id,modelId,meta])=>{try{const scoped=await catalog(id,{modelId});meta.reasoning=scoped.models?.find(m=>m.id===modelId)?.reasoning||[];}catch{meta.reasoningError=true;}}));
 for(const r of enabled){const result=ruleReadiness(r,agents,catalogs);if(!result.valid)throw Object.assign(new Error(`Rule ${r.id}: ${result.message} Disable it to save as a draft.`),{code:'RULE_NOT_READY'});}
 return config;
}
