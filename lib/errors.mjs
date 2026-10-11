// Provider messages may contain URLs, credentials, prompts, or file contents.
// Classify them locally; expose only fixed explanations across the bridge.
const definitions={
 AUTH_REQUIRED:['The worker needs authentication or its provider rejected its credentials.','Sign in or repair the provider credentials in the selected harness.'],
 PERMISSION_CANCELLED:['The worker requested a permission that Bridge could not approve.','Run the task interactively in that harness to review the permission request.'],
 WORKER_REFUSED:['The worker refused this task.','Review the task and the worker response; do not bypass its refusal.'],
 MODEL_UNAVAILABLE:['The selected model is unavailable or not advertised by this worker.','Refresh the model catalog and select an available model or Auto.'],
 CONFIGURATION_ERROR:['The selected worker configuration is not supported.','Review the rule and use supported model and thinking settings.'],
 WORKER_UNAVAILABLE:['The selected worker or its ACP adapter is unavailable.','Install or repair that harness and its ACP adapter.'],
 TIMEOUT:['The worker did not respond before the time limit.','Check the worker and provider service before retrying.'],
 DISCONNECTED:['The worker connection closed unexpectedly.','Check whether the harness process or provider connection failed.'],
 RATE_LIMITED:['The worker provider is currently rate limited.','Wait for the provider limit to reset before retrying.'],
 SERVICE_UNAVAILABLE:['The worker provider is temporarily unavailable.','Check provider availability before retrying.'],
 PROTOCOL_ERROR:['The worker returned invalid protocol data or an unsupported operation.','Update or repair the ACP adapter and verify harness compatibility.'],
 OUTPUT_LIMIT:['The worker response exceeded the Bridge output limit.','Ask for a smaller result or have the worker save a scoped artifact; do not repeat an uncertain task automatically.'],
 EMPTY_RESPONSE:['Worker ended without a response.','Check the worker provider and its logs before retrying.'],
 CANCELLED:['The worker cancelled the task.','Review the cancellation in the worker before starting another task.'],
 WORKER_ERROR:['The worker could not complete the request.','Check the selected harness locally for details.']
};
export class AgentError extends Error{
 constructor(code,details={}){super((definitions[code]||definitions.WORKER_ERROR)[0]);this.name='AgentError';this.code=definitions[code]?code:'WORKER_ERROR';this.diagnostics={};if(Number.isInteger(details.exitCode))this.diagnostics.exitCode=details.exitCode;if(typeof details.signal==='string'&&/^SIG[A-Z0-9]{1,12}$/.test(details.signal))this.diagnostics.signal=details.signal;}
}
export function classifyError(error){
 if(error instanceof AgentError)return error;
 const message=String(error?.message||'').toLowerCase();const code=error?.code;
 if(code==='ENOENT'||code==='EACCES')return new AgentError('WORKER_UNAVAILABLE');
 if(/unauthori[sz]ed|authentication|\b401\b|invalid.*(?:key|token)|login required|sign.?in|credential/.test(message))return new AgentError('AUTH_REQUIRED');
 if(/rate.?limit|\b429\b|quota/.test(message))return new AgentError('RATE_LIMITED');
 if(/permission|\b403\b|access denied/.test(message))return new AgentError('PERMISSION_CANCELLED');
 if(/refus/.test(message))return new AgentError('WORKER_REFUSED');
 if(/timed? ?out|timeout|deadline/.test(message))return new AgentError('TIMEOUT');
 if(['EPIPE','ECONNRESET','ECONNREFUSED'].includes(code)||/disconnect|connection.*(?:closed|reset|refused)|socket hang up/.test(message))return new AgentError('DISCONNECTED');
 if(/\b50[0234]\b|temporarily unavailable|overloaded|service unavailable/.test(message))return new AgentError('SERVICE_UNAVAILABLE');
 if(/model.*(?:not found|not available|unavailable|not offered|unsupported|catalog)/.test(message))return new AgentError('MODEL_UNAVAILABLE');
 if(/protocol|unsupported.*(?:method|operation)|method not found|unsupported$/.test(message))return new AgentError('PROTOCOL_ERROR');
 if(/cancel/.test(message))return new AgentError('CANCELLED');
 return new AgentError('WORKER_ERROR');
}
const transient=new Set(['TIMEOUT','DISCONNECTED','RATE_LIMITED','SERVICE_UNAVAILABLE']);
export class DelegationError extends Error{
 constructor(error,{stage='validation',worker=null,attempts=0,outcomeUnknown=false,localReason}={}){
  const classified=classifyError(error);const [reason,action]=definitions[classified.code];
  const exit=classified.diagnostics?.exitCode;const signal=classified.diagnostics?.signal;
  const safeReason=localReason||reason+(exit!==undefined?` Exit code: ${exit}.`:signal?` Process signal: ${signal}.`:'');super(safeReason);this.name='DelegationError';
  this.failure={...classified.diagnostics,...(classified.code==='RATE_LIMITED'?{suggestedWaitMs:30000}:{}),code:classified.code,reason:safeReason,stage,worker,retryable:!outcomeUnknown&&transient.has(classified.code),attempts,outcomeUnknown,nextAction:outcomeUnknown?'The task may have changed files. Inspect the project and worker session before deciding to retry; Bridge did not replay it. '+action:action};
 }
 toJSON(){return this.failure;}
}
