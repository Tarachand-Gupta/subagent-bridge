# Claude integration record

Reviewed 11 October 2026.

## Current Bridge state

Worker launch: `claude-agent-acp`.

Deferred by user; no active subscription for testing.

No live inference validation in this project.

## Reuse candidate

Track upstream adapter and use generic ACP worker path when user wants to enable it.

## Compatibility checks

- Do not report supported-and-tested based on executable discovery.
- Registry licensing metadata is per agent; do not assume every adapter has the registry license.

## Current implementation

- [core.mjs](../../lib/core.mjs)

## Upstream sources

- [github.com/agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
- [github.com/openclaw/acpx/blob/main/docs/agents.md](https://github.com/openclaw/acpx/blob/main/docs/agents.md)
