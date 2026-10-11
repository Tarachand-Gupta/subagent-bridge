import {spawn} from './process.mjs';

// Version families are explicit. Pre-1.0 protocols use a minor-version family.
import {versions as codex} from '../harnesses/codex/versions.mjs';
import {versions as pi} from '../harnesses/pi/versions.mjs';
import {versions as opencode} from '../harnesses/opencode/versions.mjs';
import {versions as deepseek} from '../harnesses/deepseek/versions.mjs';
export const compatibilityFamilies={codex,pi,opencode,deepseek,claude:[]};
export function parseVersion(raw){return String(raw).match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?\b/)?.[1]||null;}
export function selectCompatibility(id,version){
 const parsed=parseVersion(version);const [major,minor]=parsed?parsed.split('.').map(Number):[];
 const family=compatibilityFamilies[id]?.find(f=>f.exact?f.exact===parsed:f.major===major&&(f.minor===undefined||f.minor===minor));
 const supported=!!family&&family.parentMode!=='unsupported'&&(!parsed.includes('-')||!!family.exact);
 return {version:parsed,family:family?.id||null,parentMode:supported?family.parentMode:'unsupported',supported,verified:!!family?.tested.includes(parsed),message:!supported?'This version has no verified parent adapter. Background connection is disabled; ACP worker negotiation is separate.':family.parentMode==='managed'?'Automatic completion is available in a Bridge-managed Codex session. Existing Codex app/CLI chats are not attached.':family.tested.includes(parsed)?'Native background adapter verified for this installed version.':'Known version family; this exact release still needs a live compatibility test.'};
}
async function versionOf(executable){
 if(!executable)return null;
 return new Promise(resolve=>{
  const child=spawn(executable,['--version'],{stdio:['ignore','pipe','ignore'],windowsHide:true});let out='',done=false;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(null);},5000);
  child.stdout.on('data',d=>{out+=d;if(out.length>10000){child.kill();finish(null);}});
  child.on('error',()=>finish(null));child.on('close',()=>finish(parseVersion(out)));
 });
}
export async function inspectCompatibility(agent){return selectCompatibility(agent.id,await versionOf(agent.executable));}
