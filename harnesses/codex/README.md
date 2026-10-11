# Codex

`v0_160/parent.mjs` owns a dedicated app-server process and ephemeral thread. Dynamic Bridge tools return background receipts; worker completion queues a follow-up turn after the current one completes. Session folder and identity come from that owned thread. The CLI `parent codex --task ...` uses this adapter.

Live-tested installed Codex 0.160.1 and GPT-6.1 Sol: independent result323 arrived before the OpenCode worker finished; automatic continuation returned its unique fixture marker and sum143. Cancellation, uncertain submissions, turn-order races, and process disposal have regression tests.

This does not attach tools or unsolicited messages to an already-open Codex desktop/CLI conversation. Dynamic tools remain an experimental app-server API, so a new pre-1.0 minor requires compatibility review. Interactive approval/input requests are not automatically granted.

Worker execution remains generic acpx plus the separately installed `codex-acp` adapter, with `CODEX_PATH` pointing at the discovered Codex executable. Catalog discovery uses native app-server model/list.

[Official app-server documentation](https://learn.chatgpt.com/docs/app-server)
