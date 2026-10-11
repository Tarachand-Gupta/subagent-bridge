# Persistent delegation and message passing — 11 October 2026

This follow-up addresses the real gap seen in a native Codex chat: separate CLI delegations were separate worker conversations, and a background process alone did not deliver results to that chat.

## Worker verification

Fresh live checks used the installed harnesses and configured providers. Each check sent three turns through one retained ACP connection. The first introduced a random nonce. The second was queued after the worker admitted the first prompt, while it was still active, and asked for recall without repeating that nonce. The third ran after completion and asked for recall again.

| Worker | Model | Same backend session for three turns | Both recall checks |
|---|---|---|---|
| Codex 0.160.1 | GPT-6.1 Sol, high | Pass | Pass |
| Pi 1.1.0 | DigitalOcean Qwen3.8 Max | Pass | Pass |
| OpenCode 1.18.34 | Cloudflare Kimi K2.7 Code | Pass | Pass |
| DeepSeek 0.2.0-rc.2 | DigitalOcean DeepSeek v4 Pro 0813 | Pass | Pass |

Local raw evidence: `.dev-state/four-worker-continuity-live-evidence.json`. It contains session identifiers, prompts/results and the actual admission event. These are execution checks of these versions and models, not a claim about every provider or future release.

## Contract

- `bridge_delegate` starts a new worker conversation and returns a job ID immediately.
- `bridge_message({jobId,message})` reuses that job's worker conversation. It returns a new job ID. Messages submitted while busy queue in order for subsequent turns.
- A job belongs to the exact parent session and project folder. Another session cannot use its handle, even in the same folder.
- The worker's existing credentials, model and harness remain in use. Parent chat history is not copied automatically.
- Every turn revalidates saved routing policy. A changed or disabled route cannot silently move an existing conversation to a different model or harness.
- Native parent cancellation invalidates the conversation and its queued messages. Disconnects and uncertain failures are not automatically replayed or silently turned into a fresh session.
- Worker conversations remain live while the owning parent host remains live. This is not durable conversation recovery after process death.
- Status can show prompt admission and completion state. Bridge does not store or forward private reasoning.

ACP does **not** provide universal mid-turn steering. A queued message cannot change a turn already running. This implementation provides continued conversation and queued message passing, not a promise of immediate interruption.

## Parent verification

DeepSeek's native parent was tested with its real provider and native job service: one `bridge_delegate`, an immediate `bridge_message`, independent arithmetic by the parent, then two native completion notices and `job_output` calls. The worker read a fixture nonce and returned it only on the followup. The parent recovered the correct nonce without reading the file or polling. Evidence: `.dev-state/deepseek-continuity-parent-evidence.json`.

OpenCode's native parent also passed a queued message and same-session nonce recall check. Evidence: `.dev-state/opencode-native-continuity-evidence.json`.

Pi's native extension passed the same scenario with two automatic followups and no status polling. Evidence: `.dev-state/pi-native-continuity-evidence.json`.

Codex CLI 0.160.1 with real GPT-6.1 Sol also passed native hook delivery, queued followup, same-session recall, and independent work without polling. Evidence: `.dev-state/codex-native-real-evidence.json`. The separately managed Codex parent passed after fixing active-turn result delivery with `turn/steer`; evidence: `.dev-state/codex-parent-continuity-live-evidence.json`. See [native Codex setup and limits](codex-native-hooks.md). Native Codex desktop attachment is a separate capability from a Bridge-managed app-server parent; the latter alone is not proof of delivery into an arbitrary already-open desktop chat.

## Failure tests

### Actual Codex desktop follow-up

After the user approved the four Harness Bridge hooks, the existing desktop chat passed immediate background delegation, independent parent work, automatic first-result delivery, and a follow-up to the completed worker with retained context. Both turns used the same ACP session, and the second prompt did not repeat the token or original numbers. No polling or extra user input was used to obtain either result. Evidence: `.dev-state/codex-desktop-live-evidence.json`. This supersedes the earlier unverified-desktop limitation above for this tested active-turn flow. Idle wakeup and crash recovery remain outside the supported contract.

Regression coverage includes owner/folder isolation, route changes, cancelled queued and active turns, late-result suppression, failed-delivery recovery, duplicate suppression, bounded timeouts, UTF-8 output limits, idle worker exit, and owner process death. A failed or lost conversation never reconnects under the pretense of retaining its old context.

## Configuration MCP and desktop setup

The configuration MCP exposes agent/model discovery, read, preview, and revision-checked save. It shares the UI's atomic write lock and rejects stale revisions without overwriting newer rules. Preview does not write. MCP setup and skills are optional installations, separate from native background delegation.

Isolated installation checks covered all four supported harnesses. Codex's installed CLI verified its saved MCP entry; Pi and OpenCode reported connected MCP servers; DeepSeek's actual native client called `bridge_config_read` and recovered a hidden fixture rule ID. DeepSeek's client also requires an empty resource catalog: implementing standard resource-list responses removed its warning that otherwise polluted ACP output. Evidence: `.dev-state/setup-live-evidence.json` and `.dev-state/deepseek-mcp-setup-evidence.json`. These tests did not install optional MCP/skills into the user's global configuration.

The final regression run passed 79 tests, with none skipped. Native desktop computer-use checks covered Old/New switching without changing rules, per-harness model search and thinking controls, truncated model text revealing on focus, Settings information popovers, configuration preview, and copying a skill. Hover uses the same reveal styling as focus; mouse-hover animation was not separately recorded. Evidence: `.dev-state/final-mcp-setup-suite.log`.
