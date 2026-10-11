# Pi integration

The managed loader at Pi's `extensions/harness-bridge.ts` uses the installed Pi `Type` and `VERSION` exports, then mounts the versioned adapter in `v1/plugin.mjs`. Stable Pi 1.x is accepted; unsupported majors, prereleases, and recursive worker contexts do not register parent tools.

The adapter uses the shared parent manager to register `bridge_routes`, `bridge_delegate`, `bridge_message`, `bridge_status`, and `bridge_cancel`. Rules refresh before each parent turn. Tool calls inherit that Pi instance's session ID and current folder.

`bridge_delegate` starts a new worker conversation. `bridge_message` takes an existing owned job ID and sends a followup to that same conversation. If the worker is busy, the followup queues for its next turn; it does not interrupt the current response. Each turn gets a separate job ID and completion. Status reports the real prompt-started event and worker session ID where available. Native Pi `sendMessage` with `deliverAs: 'followUp'` wakes the owning parent when a turn finishes.

## Session lifetime

Conversation memory is retained while this parent activation stays alive. Reload, shutdown, or switching Pi sessions closes its worker host and cancels pending turns. Switching back creates a fresh manager; old jobs and conversations are not silently revived. An inactive session cannot receive a stale completion. Cancellation closes the whole worker conversation, including queued turns.

## Verification

The adapter tests cover same-conversation followups, queued acknowledgements, exact parent folder, cancellation, switch-away/back, fresh rule loading, failure preservation, bounded concurrency, recursion protection, runtime version drift, and safe idempotent installation.

Live evidence uses the installed Pi 1.1.0 loader and provider. Local continuity traces are stored under `.dev-state/pi-native-continuity-evidence.json`; only a report whose `verified` field is true counts as a completed live acceptance run.

## Sources

- [Pi extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi ACP adapter](https://github.com/svkozak/pi-acp)
