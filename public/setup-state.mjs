// Disk configuration and executable discovery are not live-session health checks.
export function parentSetup(agent, connection = {}) {
 if (agent.id==='claude') return {label:'Deferred',tone:'muted',help:'Claude Code orchestrator integration is deferred in this preview.'};
 if (agent.nativeParent===false) return {label:'Subagent only',tone:'muted',help:'This agent can receive work through ACP. Bridge does not install a native orchestrator connection for it.'};
 if (!agent.installed) return {label:'Not installed',tone:'muted',help:'Install this agent, then refresh.'};
 if (!agent.compatibility?.supported) return {label:'Version not supported',tone:'attention',help:agent.compatibility?.message||'This installed version has no supported parent integration.'};
 if (connection.mode==='unavailable') return {label:'Could not check',tone:'attention',help:connection.message||'Refresh to check this agent’s configuration again.'};
 if (connection.mode==='managed') return {label:'Managed sessions only',tone:'muted',help:connection.message};
 if (!connection.current) return {label:connection.installed?'Update needed':'Not configured',tone:'attention',help:'Return to your rules and use Apply Rules to configure native integrations. This also applies your saved rules.',needsApply:true};
 if (connection.hooksDisabled) return {label:'Hooks disabled',tone:'attention',help:'Enable the Bridge hooks in Codex /hooks.'};
 if (connection.trustRequired===true) return {label:'Review hooks',tone:'attention',help:'Review the Bridge hooks in Codex /hooks, then refresh here.'};
 if (agent.id==='codex'&&connection.trustRequired!==false) return {label:'Approval not verified',tone:'attention',help:'The hook configuration is present. Approval could not be checked; this does not mean you need to approve it again.'};
 return {label:'Configured',tone:'configured',help:connection.message||'The integration files are in place. Reload the agent to load an updated integration.'};
}

export function workerSetup(agent, catalog) {
 if(agent.worker?.status==='catalog-only')return {label:'Catalog only',tone:'muted',help:agent.worker.reason};
 if (!agent.installed) return {label:'Not installed',tone:'muted',help:agent.worker?.reason||'Install this agent before using it as a subagent.'};
 if (agent.acpReady&&catalog?.error)return {label:'Discovery failed',tone:'attention',help:'The launcher was found, but capability discovery failed. Expand the error below and refresh after correcting it.'};
 if (agent.acpReady&&catalog?.protocolVerified)return {label:'ACP checked',tone:'configured',help:'This launcher completed ACP discovery. No model task or provider access was tested.'};
 if (agent.id==='claude'&&agent.acpReady) return {label:'Untested',tone:'muted',help:'Claude Code worker execution has not been verified in this preview.'};
 return agent.acpReady
  ? {label:'Adapter found',tone:'configured',help:'An ACP endpoint was found. Model discovery and a real task can still fail due to provider access, permissions, or compatibility.'}
  : {label:'Adapter needed',tone:'attention',help:agent.worker?.reason||'Install this agent’s ACP adapter, then refresh.'};
}

export function failedDiscovery(previous, message) {
 return {...previous,models:previous?.models||[],error:message,stale:!!previous?.models?.length};
}
