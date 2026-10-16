# Development

[Back to the README](../README.md) · [Documentation](README.md)

## Run from source

Install Node.js 22.13+ and the coding agents you want to connect. Keep this checkout at a stable path: installed parent integrations may refer to its runtime files.

```sh
npm ci
node bin.mjs --help
npm start
```

With no command, `node bin.mjs` starts the optional loopback UI on port 4780. The browser UI and native app use the same rules. See the [CLI guide](cli.md) for configuration and execution commands.

## Build the desktop app

Install Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```sh
npm ci
npm run desktop:package
```

On macOS, open `src-tauri/target/release/bundle/macos/Subagent Bridge.app`. The native app uses Tauri IPC and does not need a browser server. Tauri builds stage production dependencies separately from development tools; Node and the harnesses remain external dependencies.

## Check changes

```sh
npm test
```

Local regression tests do not establish live provider access or platform acceptance. Integration changes also need the checks in [Compatibility and maintenance](integrations.md#compatibility-and-maintenance). Record exact tested versions separately from supported version families.

## Packaging and platform support

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
configuration alone. See the [macOS installation guide](install-macos.md)
for requirements, pinned worker adapters, first launch, and upgrade instructions.

## Where the code lives

- `public/`: the rule editor and settings UI.
- `lib/`: shared routing, configuration, discovery, and worker runtime.
- `harnesses/`: per-agent integrations and compatibility records.
- `src-tauri/`: native desktop shell and package configuration.

See the [integration architecture](integrations.md#compatibility-and-maintenance) before adding an adapter. Keep existing rule paths and integration identifiers stable; the [upgrade notes](usage.md#existing-installations) explain the legacy names.
