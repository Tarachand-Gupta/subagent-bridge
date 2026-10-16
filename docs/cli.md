# CLI

The CLI and desktop app use the same configuration. You can edit a rule in either interface, save it as a draft, and apply it from the other.

## Install

Requires Node.js **22.13+** and separately installed, configured harnesses. The CLI is available from GitHub Releases or source; it has not been published to the npm registry.

Download the `.tgz` package from [v0.3.1](https://github.com/Tarachand-Gupta/subagent-bridge/releases/tag/v0.3.1) and install it with `npm install --global ./subagent-bridge-local-0.3.1.tgz`, or use a stable checkout:

```sh
npm ci
node bin.mjs --help
node bin.mjs config status
```

To install the command on your PATH, pack that checkout and install the resulting tarball:

```sh
npm pack
npm install --global ./subagent-bridge-local-0.3.1.tgz
subagent-bridge --help
```

Use the filename printed by `npm pack` if the package version has changed. `harness-bridge` remains an alias for compatibility.

Keep the installed package or source checkout in place: applying rules can register native integrations that refer to its runtime files. Avoid applying from a temporary `npx` cache or a checkout you plan to delete. Moving the runtime requires an explicit integration update; retain the previous location until that update succeeds.

## Edit, review, apply

```sh
subagent-bridge config edit --editor "code --wait"
subagent-bridge config preview
subagent-bridge config apply
```

`edit` opens a temporary JSON copy and saves a shared draft after you close the editor. It uses `--editor`, then `VISUAL`, then `EDITOR`; the fallback is `vi` on macOS/Linux and Notepad on Windows. Choose an editor that waits until editing is complete. Editor arguments are passed directly, without shell expansion.

`preview` shows readable rule instructions and changes from the active configuration. `apply` checks enabled rules against current harness, model, and thinking capabilities, then publishes the rules and connects supported native parents. It does not submit a model task. Check the returned connection warnings and reload instructions: rules may be saved even when an integration update needs attention.

Use `config edit --apply` to combine editing and applying. Refresh or reopen the desktop app to load saved CLI changes. Connected parent sessions read applied rules on their next turn; initial installation or integration updates can require a reload, restart, or Codex hook approval.

## Shared files

| File | Purpose |
|---|---|
| `~/.harness-bridge/config.json` | Applied rules read by parent integrations. |
| `~/.harness-bridge/editor-draft.json` | Shared saved draft, including its base revision. Desktop **Save Rules** and CLI edit/import use this file. |
| `~/.harness-bridge/tasks.json` | Custom task names, separate from routing configuration. Managed in desktop Settings. |

`~` means the current OS user's home directory, including on Windows. Display preferences, such as whether the Aa prompt-preview control is visible, remain local to the UI and are not part of the rules JSON.

Run `config path` for the actual live file path and `config status` for the current draft/applied state. `--home DIRECTORY` overrides the Bridge data directory for that invocation and its children; `HARNESS_BRIDGE_HOME` is also supported. This does not redirect an already-running desktop app or existing parent integrations. An alternate home is a separate configuration, not a sandbox for integration installation.

Edit through the CLI rather than modifying the live file directly. The editor validates JSON, checks for concurrent changes, and leaves the live configuration untouched until Apply. On an editor, validation, or conflict error, the CLI reports a recovery file when available. Reconcile it with the latest state before importing again. A newer external apply can supersede a saved draft; `config status` reports whether such a draft was preserved. Editing or applying while that superseded draft exists returns `CONFIG_CONFLICT` rather than discarding it. Recover it with `config show --preserved --output recovered-rules.json`, reconcile it with the active configuration, and import the reconciled file before applying.

## Import and export

```sh
subagent-bridge config show --output rules.json
subagent-bridge config validate --file rules.json
subagent-bridge config import --file rules.json
subagent-bridge config preview
subagent-bridge config apply
```

`show` exports the current editor state, including a pending draft. Add `--active` to export applied rules instead, or `--preserved` to recover a superseded draft; these two flags cannot be combined. Without `--output`, it prints raw editable JSON. File export refuses to overwrite an existing file.

An import supplies the **complete configuration**, not a patch. Start from an export and preserve unrelated rules. Import saves a draft by default; `--apply` validates and applies immediately.

`validate` checks structure without starting agents. Add `--check-agents` to discover capabilities for enabled rules; this still does not submit inference or prove provider access. Use `detect` and `models HARNESS` to find local identifiers before choosing a model. Thinking levels must be advertised for that model.

[The example configuration](../examples/rules.json) contains one disabled Codex → Pi rule using `digitalocean/qwen3.8-max` with high thinking. It illustrates the format, not a preconfigured provider or a compatibility guarantee. Replace its selections with your discovered capabilities before enabling it. Keep provider credentials in the harness, never in Bridge's rules.

## Scripts and compatibility

Add `--json` for machine-readable results and errors. Failures return a nonzero exit code. For concurrent-safe automation:

1. Read `config status --json` and retain its `revision`.
2. Export and edit the complete configuration.
3. Run `config import --file rules.json --revision REVISION`.
4. Review, read the new status revision, and use `config apply --revision NEW_REVISION`.

`CONFIG_CONFLICT` means the configuration changed after your read. Reload and merge deliberately rather than retrying an old write. The interactive editor also checks the revision it observed before opening your editor.

Existing commands retain their behavior:

- `config read` returns the active configuration, instructions, and active revision.
- `config save --file FILE --revision REVISION` applies immediately; use the revision from `config read`. Configuration MCP saves also apply immediately.
- `apply ABSOLUTE_DIRECTORY` exports legacy project instructions. It is separate from `config apply`, which uses native parent connections and needs no project picker.
- `delegate` waits for a result. Background jobs and messages to a retained worker conversation use the parent integration's `bridge_delegate` and `bridge_message` tools.
- `ui` starts the optional local browser UI; it is also the default when no command is supplied.

Use `subagent-bridge --help` for the complete command list. Native Windows/Linux harness sessions still require platform acceptance testing; a portable configuration path alone does not establish full platform support.
