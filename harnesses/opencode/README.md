# OpenCode parent integration

The 1.x adapter installs one managed plugin at `~/.config/opencode/plugins/harness-bridge.ts` (or the configured OpenCode config directory). It does not modify provider configuration, other plugins, or project instructions. An existing unrelated file at that path is never overwritten. Restart an existing OpenCode process once after connecting; later saved rule edits are read before every model turn.

The plugin registers native `bridge_routes`, `bridge_delegate`, `bridge_message`, `bridge_status`, and `bridge_cancel` tools using OpenCode's own `@opencode-ai/plugin` helper. `experimental.chat.system.transform` obtains the current session's directory from `client.session.get`, then adds a fresh rule snapshot. Tool calls use their own `context.sessionID` and `context.directory`, never the plugin startup folder.

Delegation starts a new retained worker conversation and returns a background job immediately. `bridge_message` sends a followup using an owned prior job ID and retains the same worker session. Busy followups queue for the next turn; they do not interrupt the current generation. Each turn gets its own job ID. Results are delivered to the owning session via `client.session.promptAsync`, with the owning directory in its query. Parent jobs are isolated by session ID and directory. Deleted sessions and disposed instances cancel their work. Workers launched with `HARNESS_BRIDGE_DEPTH` expose no recursive parent tools.

## Compatibility

- OpenCode **1.18.34**: native parent integration tested against the installed binary and its plugin SDK.
- Other stable 1.x releases: use the same version family, but require their own live compatibility verification.
- OpenCode **2.x**, prereleases, and unknown host versions: parent integration disabled. The plugin checks its running executable at startup, so an existing installation cannot silently continue under a new major version.
- ACP worker launch remains separate: `opencode acp --pure`.

## Evidence

Native 1.18.34 continuity testing used a real Cloudflare GPT-OSS parent and Codex GPT-6.1 Sol worker. It queued a followup before the first completion, received two automatic completions with the same ACP session ID, and recalled a unique token omitted from the followup prompt. See the local `.dev-state/opencode-native-continuity-evidence.json` report. Worker context lasts until the owning parent instance/session or conversation is closed; this is not durable restart recovery.

`test/opencode-parent.test.mjs` covers fresh rule injection, per-session directories, completion targeting, deletion/disposal, recursion prevention, managed-file preservation, and version drift. Live test evidence is saved locally under `.dev-state/opencode-native-parent-evidence.json` and is not distributed as user configuration.

## Sources

- [OpenCode plugin documentation](https://opencode.ai/docs/plugins/)
- [OpenCode ACP documentation](https://opencode.ai/docs/acp/)
- Installed `@opencode-ai/plugin` tool and hook declarations.
- Installed `@opencode-ai/sdk` `session.promptAsync` schema.
