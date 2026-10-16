# Registry coverage and settings acceptance — 16 October 2026

These checks cover the source changes and v0.3.0 preview release candidates. Earlier live-integration results remain version-specific; the expanded catalog is not a live acceptance matrix.

## Automated checks

- Full Node suite: 124 passed, one platform-specific skip (125 tests total).
- Pinned acpx registry: 26 upstream IDs plus DeepSeek; 25 installed-launch recipes, two catalog-only entries. No package-runner fallback is executed.
- Generic Gemini protocol fixture: discovery sends no prompt; explicit model and High thinking reach the worker; a follow-up preserves session ID and turn count. Auto preserves a private model choice while respecting separately advertised thinking controls.
- Gemini/Copilot diagnostic process exits do not retire the actual ACP conversation. Simulated Windows command-shim cases pass; this is not native Windows acceptance.
- Existing rule normalization, separate parent ownership, cancellation, no-replay failure behavior, and MCP configuration tests pass.
- Tauri macOS application builds successfully. This is a local build, not a signed/notarized release.

## Browser checks with isolated configuration

- Saved agent/MCP installation states remain visible while refreshed state loads.
- Failed model discovery retains the previous catalog, reports failure, and does not turn off or dirty an enabled rule.
- Native parent selectors omit worker-only registry entries. Worker choices use registry names.
- A successful ACP session with no public model list supports Auto and a themed default-thinking control.
- Optional MCP details, installed state, manual configuration disclosure, task names, and preferences remain separate.
- Marketing dropdowns and content fit a 390px viewport without horizontal overflow. The old rotated caption rule was removed. Download/source links and GitHub Pages subpath build checks pass.

## Actual local discovery

Installed detection found Codex 0.160.1, Pi 1.2.0, OpenCode 1.18.34, desktop DeepSeek 0.2.0-rc.2, Claude Code 2.1.289, and Cursor 2025.09.18-7ae6800. This is executable discovery, not proof of credentials or task execution.

A bounded ACP capability check against the installed Cursor failed: the launcher emitted non-JSON terminal output and did not complete the ACP handshake. No prompt was submitted. The installed older Cursor version is therefore not live-verified as a Bridge worker. The UI reports capability discovery failure; it does not call the provider connected.

The actual native Tauri app was also opened and checked through computer use. Its desktop PATH additionally detected OpenClaw 2026.4.14 (seven installed harnesses total). Expandable Settings details, installed versions, and real shared task labels rendered through Tauri IPC. Native parent rows correctly reported Update needed because this separate source build is not the installed integration runtime. No Apply action was taken.

No new real-provider task, user rule change, native integration rewrite, website deployment, or installer publication was performed in these checks. Generic-agent support still requires per-version live acceptance before claiming it as tested.

## Shared configuration CLI

- `config edit` and `config import` use the desktop draft API; the live configuration stays unchanged until `config apply`.
- CLI process tests cover raw JSON round-trip, shared desktop state, stale revisions, invalid/oversized input, typo rejection, export overwrite protection, and a real editor subprocess.
- Concurrent external apply preserves edited work in a recovery file. A superseded saved draft can be exported with `config show --preserved`; edit and Apply reject it until the user reconciles and imports it. The focused CLI suite passed again after this safeguard.
- The editor uses literal arguments through the existing cross-platform process wrapper. Tests exercise quoted Windows paths and platform defaults; this is not a native Windows GUI test.
- The npm tarball installed successfully in an isolated local prefix. Its executable returned the correct version/default desktop config path, imported the included disabled example into an isolated shared draft, and validated it. No global package, npm publication, or real-harness connection was changed.
- Read-only inspection of the user's shared home confirmed that active and editor revisions matched. All mutation tests used isolated configuration or injected commits.

## v0.3.0 release package checks

- Final source regression run: 124 passed, one Windows-only test skipped on macOS; 125 total. A cancellation fixture was corrected to wait for its actual initialization message instead of assuming process startup within one second under build load.
- The final macOS Apple Silicon DMG passes `hdiutil verify`. Its extracted application passes strict code-signature verification, reports 0.3.0, and contains the exact CLI implementation and documentation tested from source. Signing remains ad-hoc, without Developer ID signing or notarization.
- The 0.3.0 CLI tarball installs into an isolated npm prefix, reports 0.3.0, and imports the bundled example into an isolated unapplied draft. Its 93-file package manifest contains the required runtime code, guide, and example, with no user configuration or development artifacts.
- The app copied from the final DMG was launched through computer use. Existing saved rules and cached agent status loaded, and Settings refreshed without applying rules or rewriting integrations.
- Package SHA-256 checksums accompany the release. Ubuntu/macOS GitHub CI covers the Node tests and npm package manifest; desktop packaging was performed on this Apple Silicon Mac.
- Website builds and release-link checks pass for both the root URL and GitHub Pages subpath, including matching macOS and CLI versioned links. The download section was inspected through computer use.
