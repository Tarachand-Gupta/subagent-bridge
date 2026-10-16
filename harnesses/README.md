# Harness integrations

Each folder owns the harness-specific code, supported version families, README, and compatibility record. Shared policy, background job machinery, and ACP execution live under `lib/`.

- [Codex](codex/README.md): `v0_160` native hooks and managed app-server parent.
- [Pi](pi/README.md): `v1` extension.
- [OpenCode](opencode/README.md): `v1` native plugin; `v2` deliberately unsupported pending testing.
- [DeepSeek](deepseek/README.md): `v0_2_rc2` native jobs/plugin and worker profile overlay.
- [Claude](claude/README.md): deferred.

`versions.mjs` is used by runtime compatibility selection. `compatibility.json` records upstream references and verified results; it is documentation, not a credential or user configuration file. Never put secrets in either.

Add a handler for a breaking family instead of spreading version checks through the UI. Keep exact live-tested versions separate from supported families. Unknown majors, unverified prereleases, and changed pre-1.0 protocol families must not silently load an older adapter.

Additional folders contain **worker-only registry records**. `lib/agent-registry.mjs` reads launch recipes from the pinned acpx public registry. These records identify the source and exact registry version; an empty `liveTestedVersions` list means the real agent/provider has not been accepted. Native parent handlers are not inferred from an ACP worker entry. See [catalog scope and discovery](../docs/integrations.md#broader-acp-workers).
