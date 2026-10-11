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
