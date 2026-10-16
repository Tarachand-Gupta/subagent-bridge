# Configuration controls acceptance — 16 October 2026

Scope: Subagent Bridge 0.3.1 settings and configuration transfer. This does not add or re-certify live provider integrations.

## Automated checks

- Node suite: 130 passed, one Windows-only skip, 131 total.
- Two Rust tests passed: bounded UTF-8/BOM file import, private atomic export, failure preservation, path equivalence, and missing-file handling.
- HTTP and desktop validation reject malformed, oversized, or unsupported configurations without applying them. HTTP mutations require the existing local token and origin checks.
- The packaged CLI installed in an isolated prefix, reported 0.3.1, imported the disabled example as a shared draft, and validated it. No global installation or provider call was used.

## Computer-use checks

- Browser fixture: configuration preview and applied/current tabs; malformed JSON rejection; valid import preview and cancel; Load draft changes only the editor; export includes the unsaved imported rules. Active fixture rules remained unchanged.
- Native release build: View opened the themed JSON preview, Applied rules showed the active config, Export used the macOS Save dialog and wrote a matching JSON file with mode 0600, and Import used the native picker and showed a validated preview before cancellation.
- Open file completed through the default macOS file association. No file edits were made.
- The user's config checksum was unchanged after native checks. No editor draft or integration rewrite was created by these checks.

## Packages and limits

- The final Apple Silicon DMG passed `hdiutil verify`; its app passed strict recursive signature verification. Signing is ad-hoc, not Developer ID or notarized.
- macOS 12+ and Node.js 22.13+ remain required. Windows/Linux file-opening branches exist but were not exercised on those operating systems.
- Existing applied config and saved drafts use the same paths and schema as 0.3.0. Export/import excludes credentials, task-name presets, display preferences, and MCP installations.

## Update source

Updates are manual downloads from GitHub Releases; there is no in-app automatic updater. Keep the shared configuration directory, replace the app at its stable location, apply rules to reconnect changed runtime paths, and follow each harness's reload or hook-review guidance. Do not remove an old runtime while its workers are running.

The acpx registry is pinned in the package lock. Native integrations select their version family from `harnesses/<agent>/versions.mjs`. `compatibility.json` records evidence rather than controlling the runtime. These inputs are bundled: pushing a GitHub file does not update installed copies. A registry or adapter change requires a tested app/CLI release.
