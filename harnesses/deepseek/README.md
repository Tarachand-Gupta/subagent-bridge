# DeepSeek parent integration

Verified 11 October 2026 against the installed desktop-bundled DeepSeek Harness **0.2.0-rc.2**.

`v0_2_rc2/plugin.mjs` registers `bridge_routes` and `bridge_delegate` through DeepSeek's native tool registry. Delegation immediately creates a native `ctx.jobs` job owned by the exact calling agent ID. DeepSeek supplies job retention, owner checks, cancellation, completion notices and idle-parent wakeup. Its existing `job_output` and `job_kill` tools collect or cancel work. Bridge does not replace that lifecycle or run a parent polling loop.

The calling Session's `header.cwd` supplies the project folder. Route definitions are read afresh from Bridge's saved JSON during prompt assembly, while `bridge_routes` obtains current validated rules and availability. Models and thinking choices are enforced by the shared Bridge worker dispatcher, preserving each worker's own provider credentials.

## Compatibility and installation

The installed release differs from current upstream documentation: it has `subagents.start()`, not `startActivation()`, and does not bundle `dsh-subagent-acp`. Consequently this adapter uses its shipped native jobs/tool services rather than pretending the newer generic ACP plugin is present.

`integration.mjs` exports `installDeepSeekIntegration(options)` and `deepseekIntegrationStatus(options)`. Installation requires `version: '0.2.0-rc.2'`; the application's compatibility layer must obtain this from the actual launcher. `profile` defaults to `web`; `profileDirectory` permits an explicitly selected profile directory. Other options are `bridgeRoot`, `bridgeHome`, and `node`.

The installer adds one dedicated managed insertion row to `cordis.patch.yml`, preserving unrelated YAML nodes and making a backup before changing existing content. Symlinks and malformed profiles are refused. Restart the selected profile once to load the plugin; later routing edits are read each prompt. No provider or credential setup is replaced.

The plugin independently checks the installed bundled `dsh-subagent/package.json` version at runtime, so an existing installation fails closed after an unreviewed upgrade. This runtime check currently supports the desktop-bundled CLI and app. Standalone package layouts and newer releases require separate verification.

Existing profiles observed on this machine: `web`, `desktop`, `headless`, and `acp`. Do not create a `tui` profile merely because launcher help includes generic examples: the inspected desktop bundle did not include a TUI package. Parent profiles must include the base native jobs controller, as the shipped web/headless profiles do.

## Verification

- Native headless DigitalOcean parent → immediate `subagent-1` acknowledgment → OpenCode GLM 5.3 Flash → exact fixture nonce and sum 100. The parent collected with native `job_output` once.
- Persistent ACP parent: initial request returned `end_turn` containing only the started-job receipt. Without another prompt or polling tool, native completion woke the same parent, which collected and reported the exact nonce and sum 100. Five updates arrived after the initial prompt returned.
- Automated tests cover parent-specific ownership/folder propagation, immediate return, same-task deduplication, cancellation signaling, live rule refresh, version drift, and idempotent profile edits.

Local ignored evidence: `.dev-state/deepseek-native-parent-evidence.json` and `.dev-state/deepseek-native-notice-evidence.json`. Tests used temporary project/config/patch files, leaving existing provider configurations intact.

## Limits

Jobs are process-local and do not survive runtime shutdown. The native completion notice asks the parent to collect its retained output with `job_output`; it is not a resumable remote subagent session. A one-shot headless parent must collect dependent work before it exits. At most the most recent 64 Bridge task signatures are retained for duplicate detection; job state itself remains native. Identical running tasks are reused, and recently failed tasks have a 60-second repeat guard. Provider/model availability can still fail at execution time.

## References

- [Upstream subagent service](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent/README.md)
- [Upstream generic ACP provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-acp/README.md)
- [Upstream delegation tools](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/tool-subagent/README.md)

Current upstream documents are comparison material; the release-specific implementation was checked against source bundled in the installed app.
