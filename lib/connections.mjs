import {validateEnabledRules} from './rule-validation.mjs';
import {save,detect,configRevision} from './core.mjs';
import {piAdapter} from '../harnesses/pi/integration.mjs';
import {piIntegrationStatus} from '../harnesses/pi/v1/integration.mjs';
import {installOpenCodeIntegration,opencodeIntegrationStatus} from '../harnesses/opencode/integration.mjs';
import {installDeepSeekIntegration,deepseekIntegrationStatus} from '../harnesses/deepseek/integration.mjs';
import {codexIntegrationStatus,installCodexIntegration} from '../harnesses/codex/integration.mjs';
const deepseekProfiles=['web','desktop','headless'];
export async function connectionStatus(inventory){
 inventory??=await detect();const results={};
 for(const agent of inventory){
  const compatibility=agent.compatibility;
  if(!agent.installed||!compatibility?.supported){results[agent.id]={installed:false,current:false,mode:'unsupported',message:agent.installed?compatibility?.message:'Harness is not installed.'};continue;}
  try{
   let status;
   if(agent.id==='pi')status={...await piIntegrationStatus(),mode:'native',message:'Run /reload once in existing Pi sessions after an integration update. Saved rules refresh each turn.'};
   if(agent.id==='opencode')status={...await opencodeIntegrationStatus(),mode:'native',message:'Restart OpenCode once after an integration update. Saved rules refresh each turn.'};
   if(agent.id==='deepseek'){
    const profiles=await Promise.all(deepseekProfiles.map(profile=>deepseekIntegrationStatus({profile})));
    status={installed:profiles.every(p=>p.installed),current:profiles.every(p=>p.current),profiles,mode:'native',message:'Restart DeepSeek web, desktop or headless sessions once after connecting. Native jobs deliver completion notices; job_output collects the result.'};
   }
   if(agent.id==='codex')status=await codexIntegrationStatus({executable:agent.executable,version:agent.version});
   results[agent.id]={...status,version:compatibility.version,family:compatibility.family};
  }catch{results[agent.id]={installed:false,current:false,mode:'unavailable',message:'Could not inspect the connection. Check local harness configuration.'};}
 }
 return results;
}
export async function saveAndConnect(value,options){
 const checked=await validateEnabledRules(value);
 const config=await save(checked,options),inventory=await detect(),updates=[],warnings=[];
 // Saving connects installed, supported native parents. Rules themselves decide where delegation is allowed.
 for(const agent of inventory){
  if(!agent.installed||!agent.compatibility?.supported||agent.compatibility.parentMode!=='native')continue;
  try{
   if(agent.id==='codex'){const result=await installCodexIntegration({version:agent.version});if(result.changed)updates.push('Codex: review Harness Bridge in /hooks');}
   if(agent.id==='pi'){const adapter=await piAdapter(agent.version);const result=await adapter.installPiIntegration();if(result.reloadRequired)updates.push('Pi: /reload');}
   if(agent.id==='opencode'){const result=await installOpenCodeIntegration({version:agent.version});if(result.reloadRequired)updates.push('OpenCode: restart');}
   if(agent.id==='deepseek')for(const profile of deepseekProfiles){const before=await deepseekIntegrationStatus({profile});await installDeepSeekIntegration({version:agent.version,profile});if(!before.current)updates.push('DeepSeek '+profile+': restart');}
  }catch(error){warnings.push(agent.name+': '+error.message);}
 }
 const connections=await connectionStatus(inventory);
 const message=['Rules saved.',updates.length?'Load updated integrations once — '+updates.join('; ')+'.':'Connected native parents read rule changes on their next turn.',warnings.length?'Connection needs attention — '+warnings.join('; '):''].filter(Boolean).join(' ');
 return {config,revision:configRevision(config),saved:true,connections,message,warnings};
}
