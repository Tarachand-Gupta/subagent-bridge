# Harness ecosystem research and maintenance direction

Reviewed 11 October 2026. This is a source review, not an integration benchmark. No researched runtime was installed and no existing parent connection was changed. Exact repository commits are recorded in [the upstream snapshot](upstream-snapshot-2026-10-11.json). Current Bridge coverage is tracked separately under [harnesses](../../harnesses/README.md).

## Recommendation

Evaluate **acpx as the shared worker runtime**, use the **official ACP Registry for discovery**, and retain a small parent integration for each supported orchestrator. Reuse native background-task and completion mechanisms when the installed harness exposes them. Keep the Tauri app focused on rules, configuration and health.

Paseo is the strongest alternative if accepting a daemon that manages the parent sessions is compatible with the product. T3 Code and MonoCode are valuable implementation references. Importing their application internals would create another compatibility boundary rather than remove maintenance.

This is an architectural recommendation from inspected sources; selection requires a small compatibility spike against our existing worker fixtures and failure tests.

## Reusable projects

| Project | Verified useful surface | Fit and limit |
| --- | --- | --- |
| [acpx](https://github.com/openclaw/acpx) | Node CLI, exported runtime/flows/agent-registry interfaces, persistent ACP sessions and structured events | Strongest compact runtime candidate. MIT; explicitly pre-1.0, so isolate it behind our own contract and pin a release. |
| [Official ACP Registry](https://github.com/agentclientprotocol/registry) | Machine-readable versioned distributions and agent metadata; release metadata is refreshed hourly | Replace hard-coded launch catalogs. The fetched index had 41 agents, including Codex, OpenCode and Pi adapters. DeepSeek was absent. Handshake/auth CI is not end-to-end delegation certification. Apache-2.0 registry; agents have separate licenses. |
| [ACP TypeScript SDK](https://agentclientprotocol.com/libraries/typescript) | Official protocol client/agent library | Use directly if acpx fails our acceptance tests; prefer it to extending handwritten JSON-RPC. It does not own our routing rules or parent UI. |
| [Paseo](https://paseo.sh/docs/providers) | Native provider integrations plus generic ACP support | Useful daemon, SDK and orchestration reference. A larger product dependency than acpx. Apache-2.0 except incorporated third-party components, per its LICENSE. |
| [T3 Code](https://github.com/pingdotgg/t3code) | Provider boundaries, normalized orchestration and recovery design | MIT. Its inspected `effect-acp` package is private and depends on its Effect workspace. Treat as architecture/source reference, not an assumed stable standalone package. |
| [MonoCode](https://github.com/hardbeat920/monocode) | Tauri UI, provider detection, per-provider integration folders and session operations | MIT. Useful for native UX and integration layout. Source has separate Codex, OpenCode and Pi implementations; it is not evidence that ACP removes every provider-specific requirement. |
| [AgentPlugins](https://github.com/sigilco/agentplugins) | Compiles one plugin manifest into several native harness formats | Apache-2.0. Worth monitoring for installation/packaging. Do not make it the runtime foundation without tests: capability gaps and stale documentation remain. |

acpx's [agent list](https://github.com/openclaw/acpx/blob/main/docs/agents.md) includes Pi, Codex, Claude, OpenCode, Gemini, Cursor, Copilot and many others, plus custom launch commands. Its [shared runtime](https://github.com/openclaw/acpx/blob/main/docs/shared-sessions.md) exposes submitted turns, events, cancellation and final results. It explicitly avoids retrying uncertain submissions. This closely matches work Bridge has begun implementing.

Its [session documentation](https://github.com/openclaw/acpx/blob/main/docs/sessions.md) provides `--no-wait`, session watching, named sessions, workspace scope and crash recovery. Bridge must still use a name derived from the parent instance and task: directory alone cannot distinguish two parent conversations in the same repository. acpx also includes a [draft conformance suite](https://github.com/openclaw/acpx/blob/main/conformance/README.md); reuse its test approach while retaining our task-isolation and no-replay regressions.

## Background execution is different from parent wake-up

A shared worker engine can launch, cancel, monitor and collect results across many ACP agents. That does not prove it can inject a completion into an arbitrary existing conversation in a separately running app.

[Paseo's MCP reference](https://paseo.sh/docs/mcp) makes this distinction explicit: agent creation returns before completion and children inherit their caller's workspace. Paseo-managed agents receive finish/error/permission notifications; external MCP clients collect status/activity themselves. Therefore adopting its MCP endpoint alone does not deliver Pi-like automatic wake-up everywhere.

For Codex, [app-server](https://learn.chatgpt.com/docs/app-server) is a native session-control interface to investigate. Do not interpret its existence as proof that a separate Bridge process can take ownership of the user's already-running desktop conversation. That attachment and notification contract remains unverified.

For OpenCode, [plugins](https://opencode.ai/docs/plugins/) receive the SDK client and directory and can register tools/events. Native integration is promising, but [T3's provider constraints](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md) document distinct 1.x/2.x handling and MCP scope hazards. Match the installed major version and isolate parent session identity.

## DeepSeek: reuse its existing native subagent system

The official repository contains [`dsh-subagent-acp`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-acp/README.md). It launches an external ACP child with its own runtime, inherits a working directory, returns final/partial output and safe failure diagnostics, and participates in parent completion delivery through the subagent tool.

This is a candidate to integrate rather than replace. However, the generic external provider documents one execution per child, no follow-up input, and no optional start-time model controls. Our chosen model/thinking settings and DigitalOcean credential behavior still need compatibility tests. Upstream source is ahead of an unspecified local installed version until verified.

The [native subagent service](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent/README.md) owns capacity, child identity, cleanup and completion routing. A thin Bridge provider/tool mapping may preserve our shared rules while using that lifecycle. Do not duplicate its scheduler automatically.

## Community findings and actual maintenance risks

A [Reddit announcement and discussion](https://www.reddit.com/r/opencodeCLI/comments/1ulnspu/i_wanted_to_try_out_more_workflows_on_opencode_so/) led to AgentPlugins. A commenter identified incompatible lifecycle events as the portability problem. The project's own [capability matrix](https://github.com/sigilco/agentplugins/blob/main/docs/guide/capability-matrix.md) confirms escape hatches and warnings rather than uniform runtime behavior.

There is a specific stale claim: that matrix says Pi has no built-in MCP. [Paseo's current provider guide](https://github.com/getpaseo/paseo/blob/main/docs/providers.md) describes Pi 0.99+ MCP detection, plus differences for alternative MCP extensions. The inspected AgentPlugins commit was dated 2 July, while the other shortlisted repositories had commits on 11 October. Activity is a useful signal, not a support guarantee.

The same Paseo guide documents OpenCode v1 plugin files versus v2 package entry points, and per-provider turn steering. These are concrete examples of why static "supports ACP" tables cannot establish parent integration parity.

A [Reddit cross-harness orchestration thread](https://www.reddit.com/r/opencode/comments/1ub5ccp/best_way_to_use_codex_as_an_orchestrator_with/) pointed toward Paseo; its documentation was used to verify the relevant behavior. An [X post pointing to acpx](https://x.com/azu_re/status/2033690285218402364) was discoverable in search, but the full X page could not be retrieved. No technical conclusion depends on that post.

## Maintenance contract for Bridge

1. Keep one internal interface for start, events, status, cancel and result. Put acpx or the official SDK behind it; leave policy in Bridge.
2. Separate worker capabilities from parent capabilities: background submission, automatic completion delivery, current-session identity, model selection and reasoning controls are different flags.
3. Pin tested runtime/adapter versions. Refresh the discovery index separately from installing upgrades; never run `latest` automatically because metadata changed.
4. Negotiate ACP capabilities and read models/config options from the real worker session. Registry membership does not prove authentication, model access or thinking support. The [ACP initialization contract](https://agentclientprotocol.com/protocol/v1/initialization) defines capability exchange.
5. Test candidate upgrades with synthetic protocol fixtures first, then a small opt-in live matrix. Test two parent instances in the same folder as well as two different folders; completion must reach only its owner.
6. Preserve no-replay behavior after ambiguous submission failures, cancellation cleanup, bounded retries, and Can/Should policy. Show a degraded capability explicitly rather than silently changing behavior.
7. Record upstream release/commit, tested installed version, capabilities and known gaps per harness. Keep accounts and secrets out of these records.

Suggested implementation layout when work resumes:

```text
harnesses/
  codex/       README.md, compatibility.json, parent module
  pi/          README.md, compatibility.json, parent module
  opencode/    README.md, compatibility.json, parent module
  deepseek/    README.md, compatibility.json, parent module
  claude/      README.md, compatibility.json (deferred)
lib/
  runtime/     shared ACP engine, job lifecycle, event contract
  policy/      route matching, Can/Should, allowed model choices
```

Only the per-harness records and this research were added in this pass. Existing code remains in place. The next implementation should begin with an acpx acceptance spike and DeepSeek native-provider check, not three independent copies of Pi's task runner.
