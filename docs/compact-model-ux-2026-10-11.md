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
