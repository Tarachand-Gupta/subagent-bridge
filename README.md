# Subagent Bridge

Use other coding agents as subagents—without leaving your own.

A local desktop app and CLI for routing work between coding-agent harnesses. Write a rule as a sentence or edit its JSON, choose allowed harnesses/models, and apply it. Both interfaces share the same rules. Each worker runs in its own harness with its own provider settings and inherits the calling parent's project folder.

MIT licensed. Requires **Node.js 22.13+** and installed harnesses. No hosted service or Bridge credential store. The main local release is tested on macOS Apple Silicon. Windows/Linux package configurations are included; native acceptance and standalone DeepSeek npm layouts are not yet verified.

## Use

Download the [macOS Apple Silicon preview](https://github.com/Tarachand-Gupta/subagent-bridge/releases/tag/v0.3.0)
and follow the [installation guide](docs/install-macos.md). This release is ad-hoc
signed and not notarized; macOS may require a per-app first-launch approval.
Node.js 22.13+ and your configured coding agents are required separately.

To build from source (requires the Rust and Tauri platform prerequisites):

```sh
npm install
npm run desktop:package
```

Open `src-tauri/target/release/bundle/macos/Subagent Bridge.app`. This unsigned local build uses Tauri IPC and does not need a browser server. Node and the harnesses remain external dependencies.

1. Click **+ Add Rule**. The control is muted by default, with a thick underline on hover; it is always clickable.
2. Choose the parent, task, **can use / should use**, worker, model, and thinking. The editor keeps each harness beside its compact model list. Click the harness to change allowed harnesses; click its model list to select alternatives grouped by provider. Each selected model shows its thinking value as text; click it to expand a Thinking dropdown inside the same list row. Only advertised levels and Auto are offered. Hover or focus reveals removal controls; their strike-through preview shows exactly which selection will be removed. Hover or keyboard focus reveals longer names. Multi-selections are alternatives; the parent chooses one per task. Auto/default retains the worker's own setting.
3. **Save Rules** keeps a local draft without changing the rules agents read. **Save Rules and Apply** saves and publishes your edit, connecting supported native parents. After saving only, the primary action becomes **Apply Rules** and the secondary Save button disappears. Once applied, the footer shows **Saved and applied**. Initial connection or code updates need one reload/restart; later applied rule changes refresh each turn.

After this per-model editor upgrade, reload already-running parent integrations and MCP servers before using the new settings. The Codex native client detects older retained daemons and refuses affected delegate/followup requests instead of losing the model's thinking override. Use a new Codex chat for those settings; status, completion delivery and cancellation stay available in the original chat. Bridge never restarts a retained worker or replays its work automatically.
4. **Settings** separates **As orchestrator** from **As subagent**. Expand an agent for its installed version, compatibility evidence, reload instructions, and model discovery. **More ACP subagents** lists additional registry entries without implying that they are installed or live-tested. Previously checked installation state stays visible during refresh; a failed refresh does not disable your rules.

There is no global project picker. Every parent instance supplies its own current folder and session identity. Two sessions in the same folder still own separate jobs. Pass a self-contained task with relevant context: full conversation history is not automatically copied.

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

## Configure from another agent

Settings keeps the optional MCP under **Let an agent manage your rules**. Install it for a supported agent, or expand **Manual setup** to copy/preview the harness-specific configuration. The MCP descriptions carry the full workflow; no separate skill is needed. A blue outline and green check identify an installed configuration; an existing session may still need a reload. Codex hook trust is queried read-only through its versioned app-server API. Unavailable approval status is shown as **Approval not verified**, never a false request to review again. **Configured** describes files on disk, not live-session or provider health.

The configuration MCP uses the official MCP SDK over standard input/output:

```sh
subagent-bridge mcp
```

Its five tools are `bridge_config_read`, `bridge_config_preview`, `bridge_config_save`, `bridge_agents_list`, and `bridge_models_list`. Read the current configuration and revision, preserve unrelated rules, preview the proposed full configuration, then save with that revision. A concurrent change rejects the save. The desktop editor uses the same revision check and retains an unsaved draft on conflict. Discovery reports installed versions and actual harness model catalogs; a catalog entry does not prove provider access.

The MCP manages configuration and discovery. Background task execution and completion delivery remain the native parent integration's responsibility. Saving through MCP applies immediately using the same validation and native-connection operation as the app's Apply action; it never submits a model task or accepts credentials. The MCP descriptions include the complete configuration workflow. The existing immediate-save CLI remains available for automation:

```sh
subagent-bridge config read
subagent-bridge config preview --file proposed-rules.json
subagent-bridge config save --file proposed-rules.json --revision REVISION_FROM_READ
```

Setup adapters live in each harness's `setup.mjs`. They preserve unrelated configuration, back up changes, refuse symlinked target files and unowned name collisions, and recognize user edits to managed entries. Codex uses its own MCP CLI; Pi uses its native MCP configuration; OpenCode preserves JSONC comments; DeepSeek uses profile patch insertions. The app does not automatically install optional MCPs when saving rules.

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

These are **worker candidates**, not 27 native parent integrations or 27 live-tested providers. Codex, Pi, OpenCode, and DeepSeek retain the native parent handlers above. New worker records in `harnesses/<id>/compatibility.json` carry the registry version and empty live-tested-version lists. Generic protocol fixtures exercise discovery, thinking, execution, and same-session follow-ups; each real harness/provider still needs live acceptance. The v0.3.0 preview includes this catalog expansion; the earlier v0.2.0 installer does not.

Existing explicit rules keep their IDs, models, and integration paths. An **Auto worker** rule means any available worker, so newly installed registry workers become additional alternatives after an upgrade. The parent still chooses exactly one; there is no automatic fan-out.

DeepSeek provider definitions and selected model are read from the web profile into a temporary owner-only ACP patch. Only provider settings are imported, not web plugins. Credentials remain in their existing harness configuration. The temporary patch is removed after execution. Parent installation adds a separate managed row to profile patches, preserving existing YAML and backing it up first.

## Rules and updates

`~/.harness-bridge/config.json` is atomically saved JSON. A route contains:

- `parents`: empty means any connected parent.
- `workers`: empty means choose one available worker other than the initiating parent.
- `models`: worker-scoped allowed model alternatives; empty means the harness default.
- `task`: `Auto` means any substantive task; otherwise a preset or custom task.
- `models[].reasoning`: optional per-model thinking; empty explicitly selects Auto. When omitted, it inherits `reasoningByWorker[worker]`, then `reasoning`.
- `reasoning`: legacy shared thinking default; empty means the harness default.
- Thinking discovery is model-scoped. A harness-wide control is never assumed to apply to every catalog model. Unsupported explicit levels are rejected before task submission.
- `reasoningByWorker`: optional per-harness overrides. An explicit empty value retains that harness's default. Explicit levels must be advertised by the selected worker.
- `usage`: `can` permits delegation; `should` instructs delegation for matching tasks.
- `enabled`: disabled rules cannot execute.

Can/Should is an instruction to the parent, not a guarantee that every model will obey. The backend enforces allowed routes, workers, and models when execution occurs. Completion handling, synthesis, status, and cancellation are not new tasks to re-delegate. A worker already running keeps its admitted task/settings when a rule changes. Every followup revalidates the current rule; a changed worker, model, thinking setting, disabled rule or removed authorization rejects reuse rather than silently switching the conversation.

Pi inserts a fresh context message, OpenCode refreshes its system hook, DeepSeek rebuilds its prompt section, and managed Codex supplies current rules before each turn. Every actual delegation rereads saved rules. ACP itself does not broadcast instructions to parent harnesses.

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

See [research](docs/research/2026-10-11-harness-ecosystem.md), [integration records](harnesses/README.md), and [initial acceptance results](docs/acceptance-2026-10-11.md), and [session continuity checks](docs/session-continuity-2026-10-11.md).

## Failure behavior and limits

Worker execution is bounded to 200 seconds overall, including up to 60 seconds startup and 180 seconds prompting within that total. Transient startup failures may retry once. Submitted tasks are never automatically replayed: a disconnected worker may have edited files. Authentication, permission, model/configuration, refusal, timeout, and disconnection failures carry structured reasons and next actions.

Pi/OpenCode/managed Codex limit active Bridge jobs to four per instance and retain recent job status in memory. DeepSeek owns its native job capacity and lifecycle. Repeated running requests are deduplicated; failed duplicates cool down for 60 seconds. Live worker conversations do not survive process shutdown. A worker that disconnects is not silently relaunched under the same conversation handle. Completion delivery failures can be recovered through status while the parent remains alive. Session closure cancels owned work. Each worker host allows at most 32 conversations and eight queued turns per conversation. Native parent cancellation closes the conversation, including queued messages. Status exposes prompt admission and job state without retaining private reasoning.

Bridge advertises no client-side filesystem or terminal capabilities and cancels elevation requests. Existing worker permissions remain those of the worker harness. Shared folders are not an OS sandbox; concurrent edits are not automatically isolated or merged. Interactive worker approvals, cross-restart job persistence, and arbitrary native subagent-UI parity are not included.

## CLI and shared configuration

The CLI uses the desktop app's existing `~/.harness-bridge/config.json` and saved draft. No conversion or separate configuration is needed. With Node.js 22.13+, run it from a stable source checkout with `node bin.mjs`, or build a package with `npm pack` and install that tarball globally. The package has not been published to npm.

```sh
subagent-bridge config edit --editor "code --wait"
subagent-bridge config preview
subagent-bridge config apply
```

Editing or importing saves a draft, just like **Save Rules**. Applying validates enabled rules, publishes the shared configuration, and installs or updates supported native parent connections. Refresh or reopen the desktop app to see CLI changes. Existing connected parents read applied rule changes on their next turn; integration changes may need a reload or hook approval. Use `config edit --apply` for the combined action.

`config show` prints editable JSON; `config show --active` reads the rules agents currently use. `config status` reports the draft and active revisions. See the [CLI guide](docs/cli.md) for installation, import/export, safe editing, and script usage, and [a disabled example rule](examples/rules.json) for the file format.

Discovery and execution commands are also available:

```sh
subagent-bridge detect
subagent-bridge models codex
subagent-bridge routes --parent pi
subagent-bridge delegate --route RULE_ID --parent pi --workspace /project --task "Review the changes"
```

`node bin.mjs` without a command starts the optional loopback UI on port 4780. Plain `delegate` waits for its result; background delegation and same-session follow-ups use native parent integrations. Legacy `apply DIRECTORY` remains a manual project-instruction fallback, distinct from `config apply`; the desktop Save flow does not require or modify project instruction files. `npm test` runs local regression tests. Tauri builds stage production dependencies separately from development tools.

## Desktop packages and platform support

The main app is **Subagent Bridge 0.3.0**, with one editor and one arrow icon.
Enable **Settings → Preferences → Show prompt previews** to reveal the **Aa** button (off by default, saved on this device). The button on each rule replaces only that rule’s controls with read-only parent routing
instructions generated by the same function used by the integrations. Off rules
are clearly marked inactive. The preview occupies the same space as its sentence and scrolls internally; other rules stay unchanged. Shared harness instructions and runtime bindings are separate from this rule preview.
Preview reflects the current draft; Apply publishes it. The worker task, runtime tool
binding, and private session identifiers are supplied later by the parent.
Generated prompt editing is intentionally excluded from v1: use the rule controls
so the prompt and enforced permissions stay consistent.

`npm run desktop:package` builds native installers without Finder automation.
Platform-specific Tauri configurations produce macOS app/DMG, Windows NSIS,
and Linux DEB/AppImage packages. Node 22.13+ and the chosen harnesses must be
installed separately. The desktop discovers Node from PATH, common Node manager
locations, or `HARNESS_BRIDGE_NODE` (an absolute executable path). User data uses
the OS home directory, not a fixed `/Users` path. Windows npm launchers are escaped
through cross-spawn; Codex hook configuration is passed as base64 through an
encoded PowerShell command. Native Windows CLI callers can pass `--json-file`
instead of relying on PowerShell's native JSON argument escaping.

Build packages on their target OS. The public macOS preview is ad-hoc signed for
bundle integrity and not notarized. Developer ID signing and notarization remain
outstanding. Native Windows/Linux harness sessions require separate live
acceptance testing before publishing their installers. Linux AppImages need a
compatible host's FUSE setup. Do not infer platform acceptance from package
configuration alone. See the [macOS installation guide](docs/install-macos.md)
for requirements, pinned worker adapters, first launch, and upgrade instructions.

Desktop **Save Rules** and CLI `config edit` / `config import` share `~/.harness-bridge/editor-draft.json`. The live `config.json` remains unchanged until Apply. MCP saves and the legacy CLI `config save` command still apply immediately. A newer external apply supersedes a pending draft without discarding its recoverable contents; stale apply requests are rejected. The Aa surface displays exact prompt text, including literal Markdown, in a tinted monospace container with internal scrolling.

## Existing installations

Subagent Bridge is the new name for Harness Bridge. The `harness-bridge` CLI remains an alias. Existing `~/.harness-bridge` rules, drafts, tasks, sessions, `HARNESS_BRIDGE_*` environment variables, MCP server IDs, integration filenames, managed markers, and the `dev.harnessbridge.desktop` app identifier are deliberately unchanged. Do not rename or delete those paths when upgrading. Existing hooks may still display the legacy name so their ownership and approval remain valid. A change of install location still requires an explicit integration update; keep the old runtime available until that update is complete.
