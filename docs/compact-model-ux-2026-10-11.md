# Compact harness and model editor

Restore point before this work: `78134d5` in the Playground repository, scoped to `harness-bridge/`.

The New view groups each harness and its model alternatives on one underline. Model labels show at most two names and a remaining count. Hover and keyboard focus expand the label and change the slash to “with.” The harness name edits the allowed harness set; the adjacent model label opens that harness's provider-grouped multi-select. Selected models expose separate thinking controls. Auto uses the model's harness default; explicit levels are offered only after model-scoped discovery.

Per-model thinking is stored as optional `models[].reasoning`. An empty string explicitly requests Auto. Missing values inherit the older per-worker then per-rule defaults. Old/New switching preserves these values; deliberately changing the legacy global thinking control resets the overrides. MCP read, preview, save, and execution use the same precedence.

Multiple models and harnesses are alternatives for a single delegation, not automatic fan-out. “Their respective” is the supported execution mode. Parent-harness execution is disabled with an explanation; the UI does not claim a model/provider can be transplanted to another harness.

## Verification

- Pre-change checkpoint committed before implementation.
- 83 regression tests passed, including per-model validation, selection, explicit Auto override, MCP roundtrip, and native daemon upgrade negotiation.
- Native preview: four selected harnesses stayed connected to their own model groups.
- Three selected Codex models displayed a compact `+1` count.
- Keyboard slider set GPT-6.1 Sol to High and GPT-6 Astra to Low while GPT-6 Sol stayed Auto.
- Old view displayed “per model”; switching back preserved all choices and thinking settings.
- Pi's actual scoped capability discovery returned Off, Minimal, Low, Medium, High for the selected DigitalOcean Qwen model.
- UI test edits were not saved. The original app's existing unsaved draft was left intact.

The separate native preview avoids closing the user's original app. Mouse hover and focus share reveal styling; keyboard focus and native screenshots were checked. This does not claim every future catalog or window size has been exhaustively tested.

An already-running Codex native daemon may own a worker host using the previous schema. Updated clients refuse per-model delegate/message requests against that daemon and explain how to use a new chat; retrieval, cancellation and unchanged legacy routes remain available. Other already-loaded parent integrations and MCP servers must reload after the code upgrade. No existing worker process is automatically restarted, and no task is replayed.

## October 12 refinement

Thinking now expands within the model list row, with a themed dropdown for Auto and advertised levels. The collapsed row displays the chosen level as text. The detached thinking popover, bars and slider were removed. Sentence controls share a chevron asset and baseline; “with” aligns with the adjacent names.

Visible parent, worker and model selections expose a remove button on hover/focus. Its muted strike-through preview is scoped to that selection; worker removal includes its model choices and thinking overrides. Removing the final explicit selection restores that field's Auto behavior. Removal is only a local draft edit until Save.

Native Review checks covered setting Qwen High, collapsing/reopening, preserving High when another model is added/removed, model-only and whole-harness removal previews, last-model Auto, whole-harness deletion, and parent removal in the Old view. The existing user Preview had unsaved selections, so it was left untouched. UI test edits were not saved. The 11 route-options/MCP regression tests passed.

## Validation, confirmation and setup state

New rules start off. The editor and save endpoints use the same readiness check for installed parent/worker compatibility, ACP availability, model discovery, and advertised thinking levels. Disabled drafts may contain an unfinished custom task. Provider billing and successful inference are not implied by readiness.

Task, policy, execution and thinking menus now use the same custom theme. The thinking menu uses the browser top layer to avoid clipping inside a scrolling model list. Model names have no extra underline; the group retains one underline. Static “with” uses the same color as the sentence.

Shared instructions live in the heading info control. Rule labels are larger. Selection removal is armed with ×, then confirmed with trash; Escape or outside click cancels. Whole-rule removal additionally disables its content and requires a small confirmation dialog. All changes remain draft-only until Save.

Settings caches the last successful MCP/skill status locally, presents it during refresh, and rechecks disk configuration whenever opened. A failed refresh keeps the prior display and reports the failure. Installed managed entries are distinguished from current-build entries, allowing an Update action instead of falsely presenting them as missing. Installation rechecks ownership before writing. Skills share one portable instruction and one pair of Copy/Preview actions at the heading; MCP copy/preview stays per harness because the configuration formats differ. Per-tile info buttons have been removed from both setup sections.

Validation: 88 automated tests passed, including disabled drafts, unknown models, incompatible thinking, moved installation roots, external skill removal, and shared skill content. Native computer-use checks covered themed menus, inline thinking, off-by-default creation, disabled invalid toggles, removal arming/cancellation, and the whole-rule dialog. No UI test edits were saved.

### Compact picker followup

Harness pickers use 280px compact menus, a short Auto row, checkmark selection, and one shared info/Done footer. Repeated Installed labels and instructional paragraphs are removed. Menus capture the clicked control's position when opening; text expansion and selecting alternatives do not move them. They remain on the chosen side and scroll within available space. Commas reserve their own width without negative margins. Native preview verified multi-parent selection, persistent anchoring, help, dismissal, and visible comma separation. User drafts in the main app were not changed.

### Model controls and stable hover

Selected model rows now deselect through their checkmark/name; their redundant removal button is gone. Inline sentence removal controls remain. Thinking discovery occupies the control itself with a spinner and Fetching, followed by the themed dropdown; failures expose Retry with the reason in its tooltip.

Catalog-provided thinking metadata is reused. For harnesses that require selecting a model to discover its controls, selected models and the current default are prefetched when the catalog loads. Newly selected models join that queue immediately. Requests are deduplicated and limited to two concurrent lookups; failures are not automatically retried. Unselected catalogs are not exhaustively probed.

Hover reveal measures the current line's remaining space before applying expanded styling. The harness/model group is capped to that space and model text can shrink, preventing the group from wrapping away from the pointer and repeatedly collapsing. Full model names remain available in the picker.

Validation: all 88 automated tests passed. Native Theme preview verified model-row deselection and prefetched thinking controls appearing immediately when expanded. Test selections were discarded without saving. Main app drafts were preserved.

Native hover checks covered the OpenCode/Kimi group at the right edge of the 1100px preview and at a wider window size. Expanded controls stayed on their original row, with truncation only when space was limited. Both main and Theme desktop bundles built successfully.

## Current setup and window layout (October 12)

This supersedes the Old/New and Skills UI described in the earlier verification history. The connected harness/model editor is the only view. Settings presents native agent connections followed by “Want your agent to manage Harness Bridge?” and MCP installation choices. The configuration MCP carries the complete read/discover/preview/save workflow in its tool descriptions and server instructions. Skill generation and installation have been removed. Existing unchanged managed Codex/OpenCode skills on the development machine were archived under `~/.harness-bridge/retired-skills`; unrelated or modified files are not removed.

Codex status now queries the 0.160.1 `hooks/list` API without starting a model turn or writing trust settings. It matches each expected hook by source file, event and command. All four enabled/trusted definitions produce Connected; modified/untrusted definitions produce Review hooks; disabled definitions are distinguished. A failed query or incomplete match yields Configured with an explicit unknown-approval explanation. Live verification confirmed all four installed hooks were already trusted and enabled. The former Review hooks badge had been unconditional.

The macOS title bar overlays the app header, preserving native traffic lights. Branding and Settings share that bar. Rules have a fixed bottom Save bar; Settings hides it and the top-right action, using a back control above Your setup. The rules count label is removed. Dragging is limited to the header through a scoped Tauri window capability.

Validation: 89 automated tests passed, including MCP install ownership, removed skill API rejection, configuration conflict behavior, and trusted/modified/disabled/unknown hook status. No hook approval was changed.

Native Setup preview confirmed the integrated header, absence of the view toggle and rule count, pinned Save while scrolling, no Save or top-right action in Settings, Back navigation, MCP config preview, and the corrected Connected badge for Codex. The preview delegates backend reads to the main bundle so installation paths match the live setup. Both native bundles built successfully; user rule drafts and hook approvals were unchanged.
