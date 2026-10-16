# Agent integrations

[Back to the README](../README.md) · [Documentation](README.md)

Use this reference to check connection methods, tested versions, background delivery, and runtime limits. Installed agents, discovered models, and successful model calls are different checks.

## Parent integrations

| Parent | Tested version | Connection / background completion |
|---|---|---|
| Pi | 1.1.0 | Managed extension; run `/reload` once. Completion automatically starts a follow-up in the originating session. |
| OpenCode | 1.18.34 | Native 1.x plugin; restart once. Completion queues a prompt in the originating session. |
| DeepSeek | desktop-bundled 0.2.0-rc.2 | Native tools and jobs in web, desktop, and headless profiles; restart once. Native notices wake the parent; `job_output` collects the retained result and `job_kill` cancels. |
| Codex | 0.160.1 | Native hooks; review the Bridge hooks (legacy label: Harness Bridge) in `/hooks`, then start/resume a chat. Completion is injected during active turns or a bounded Stop continuation. Idle chats receive remaining results next turn. Bridge-managed app-server mode is also available. |
| Claude Code | — | Deferred; not live-tested. |

Launch a Bridge-managed Codex parent from its project folder:

```sh
node /absolute/path/to/harness-bridge/bin.mjs parent codex --task "Research this project using my configured worker"
```

After installing the CLI package, the equivalent is `subagent-bridge parent codex --task "…"`. An optional `--model` selects the parent model; omission keeps Codex's configuration. This command owns a separate, ephemeral parent conversation and remains alive until its worker results have been handled. It does not commandeer a running app conversation. Interactive approvals are not supported in this unattended client and are declined rather than automatically approved.

Pi, OpenCode, and managed Codex expose `bridge_routes`, `bridge_delegate`, `bridge_message`, `bridge_status`, and `bridge_cancel`. DeepSeek exposes routes, delegate, and message, and uses its own native job tools. `bridge_delegate` returns immediately, allowing independent parent work. Results must arrive before dependent work can be claimed. Plain CLI `delegate` still waits for its result; background scheduling belongs to the parent integration.

## Worker transport and discovery

Worker execution uses **acpx 0.19.4**, pinned in the lockfile, through its exported in-process runtime. Bridge retains routing policy, model/thinking enforcement, deadlines, and failure reporting. Each parent owns an isolated worker host. `bridge_delegate` creates a persistent ACP conversation; `bridge_message` with a previous job ID reuses that exact conversation. Messages sent while busy queue in order for subsequent turns. ACP does not provide universal mid-turn steering, so Bridge does not present queued messages as interruptions. Bridge does not silently install the registry's latest adapter.

| Worker | Endpoint | Model discovery |
|---|---|---|
| Codex | `codex-acp` using installed Codex | Codex app-server `model/list` |
| Pi | `pi-acp` | Pi CLI provider catalog |
| OpenCode | `opencode acp --pure` | ACP session model/config options |
| DeepSeek | `dsh --profile acp` | ACP session model/config options |
| Claude | `claude-agent-acp` if separately installed | ACP / configured-model fallback; untested |

Codex/Pi adapters must be on PATH or under `~/.harness-bridge/adapters/node_modules/.bin`. Tested adapter versions are `@agentclientprotocol/codex-acp@2.2.2` and `pi-acp@0.0.34`. ACP discovery and execution share the pinned acpx runtime; Codex and Pi retain their native model catalogs. A visible model is not proof that an account can use it; execution errors remain authoritative.

### Broader ACP workers

The current source consumes the public **acpx agent-registry** API: 26 upstream entries plus Bridge's DeepSeek integration, for **27 catalog entries**. Examples include Gemini CLI, GitHub Copilot, Cursor, Kimi, Qwen Code, and OpenClaw. Launch arguments come from the pinned dependency rather than a second handwritten command map. The five existing launch integrations keep their compatibility behavior.

Of these entries, 25 have local launch recipes; Fast Agent and Mux remain catalog-only because this pinned registry exposes package-runner recipes for them. Bridge never installs or executes an `npx`/`uvx` fallback during detection. Install the required launcher separately, refresh Settings, and discover its advertised ACP capabilities before enabling a rule. Model and thinking selection are accepted only when advertised; Auto can retain a harness-managed model even if no model list is exposed.

These are **worker candidates**, not 27 native parent integrations or 27 live-tested providers. Codex, Pi, OpenCode, and DeepSeek retain the native parent handlers above. New worker records in `harnesses/<id>/compatibility.json` carry the registry version and empty live-tested-version lists. Generic protocol fixtures exercise discovery, thinking, execution, and same-session follow-ups; each real harness/provider still needs live acceptance. The v0.3.1 preview includes this catalog expansion; the earlier v0.2.0 installer does not.

Existing explicit rules keep their IDs, models, and integration paths. An **Auto worker** rule means any available worker, so newly installed registry workers become additional alternatives after an upgrade. The parent still chooses exactly one; there is no automatic fan-out.

DeepSeek provider definitions and selected model are read from the web profile into a temporary owner-only ACP patch. Only provider settings are imported, not web plugins. Credentials remain in their existing harness configuration. The temporary patch is removed after execution. Parent installation adds a separate managed row to profile patches, preserving existing YAML and backing it up first.

## Compatibility and maintenance

Each harness owns its integration, version families, and record:

```text
harnesses/
  codex/     versions.mjs · integration.mjs · v0_160/parent.mjs
  pi/        versions.mjs · integration.mjs · v1/integration.mjs
  opencode/  versions.mjs · integration.mjs · v1/ · v2/README.md
  deepseek/  versions.mjs · integration.mjs · worker.mjs · v0_2_rc2/plugin.mjs
  claude/    deferred integration record
  gemini/    compatibility.json (registry worker record)
  .../       one compatibility record per additional registry worker
lib/
  agent-registry.mjs  installed-only catalog from pinned acpx
  compatibility.mjs   installed-version parsing and selection
  parent-bridge.mjs    shared job scoping, cancellation and result delivery
  runtime/acpx.mjs    shared ACP worker runtime
  runtime/worker-host*.mjs  parent-owned persistent conversations and IPC
```

Detection checks the actual resolved executable's version. Pre-1.0 breaking families are gated more narrowly than major versions; DeepSeek's prerelease is exact-pinned. Native plugins also check runtime versions so an existing installation does not silently keep running after an incompatible upgrade. OpenCode 2.x has its own reserved folder and is disabled until verified. A supported family and a live-tested exact version are shown separately.

To support a new family: add its adapter and version entry, check the installed protocol, test model/thinking selection, permissions, cancellation, failure delivery, separate-session ownership, and idle-parent completion. Only then add the exact version to `tested`. Registry metadata is a discovery aid, not permission to upgrade runtime dependencies automatically.

See [integration records](../harnesses/README.md), [the ecosystem research](research/2026-10-11-harness-ecosystem.md), and [acceptance reports](README.md#verification-records).

## Failure behavior and limits

Worker execution is bounded to 200 seconds overall, including up to 60 seconds startup and 180 seconds prompting within that total. Transient startup failures may retry once. Submitted tasks are never automatically replayed: a disconnected worker may have edited files. Authentication, permission, model/configuration, refusal, timeout, and disconnection failures carry structured reasons and next actions.

Pi/OpenCode/managed Codex limit active Bridge jobs to four per instance and retain recent job status in memory. DeepSeek owns its native job capacity and lifecycle. Repeated running requests are deduplicated; failed duplicates cool down for 60 seconds. Live worker conversations do not survive process shutdown. A worker that disconnects is not silently relaunched under the same conversation handle. Completion delivery failures can be recovered through status while the parent remains alive. Session closure cancels owned work. Each worker host allows at most 32 conversations and eight queued turns per conversation. Native parent cancellation closes the conversation, including queued messages. Status exposes prompt admission and job state without retaining private reasoning.

Bridge advertises no client-side filesystem or terminal capabilities and cancels elevation requests. Existing worker permissions remain those of the worker harness. Shared folders are not an OS sandbox; concurrent edits are not automatically isolated or merged. Interactive worker approvals, cross-restart job persistence, and arbitrary native subagent-UI parity are not included.
