# Main desktop build — 2026-10-12

Harness Bridge 0.2.0 is the single main local app. The user's selected main-window
draft was saved before replacing that window. Preview, Review, Theme and Setup
app copies were closed and moved to macOS Trash; their discarded drafts were not
applied. The canonical backend path is unchanged, preserving existing hook commands.

## Verified on macOS Apple Silicon

- Native build and noninteractive DMG creation succeeded.
- Full regression run: 94 tests, 93 passed, one Windows-only launcher test skipped.
- Computer-use checks in the main app: Aa previews one rule, the next rule stays
  editable and at the same vertical position, overflow scrolls inside the original
  sentence area, and Aa restores that rule's editor without changing saved rules.
- Two-tone toolbar and canvas; shared arrow branding. Settings has no Save bar or
  top-right settings control. Native Codex trust shows Connected.
- Codex MCP absence correctly shows an available install action. The portable
  process runner retains exit codes/stderr so absence is not confused with a
  configuration error.
- Preview and parent runtime use the same rule-instruction generator. Per-model
  explicit Auto overrides remain distinct from inherited thinking defaults.

## Distribution boundary

The main app and DMG are local, unsigned/ad-hoc artifacts. Signing/notarization,
public release publication, Windows/Linux native builds, and live harness tests
on those platforms have not been completed. Platform configs and a native build
matrix are included, with Windows path/launcher/hook handling and common Node
installation discovery. CI has not run in this local repository.

The Aa preview is read-only in v1. It shows the parent rule instruction; the
parent supplies each actual worker task later. Runtime tool bindings, private
session identity and common delegation guidance are supplied separately.
