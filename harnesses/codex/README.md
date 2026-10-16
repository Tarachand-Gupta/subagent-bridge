# Codex

`v0_160/parent.mjs` owns a dedicated app-server process and ephemeral thread. Dynamic Bridge tools return background receipts; worker completion queues a follow-up turn after the current one completes. Session folder and identity come from that owned thread. The CLI `parent codex --task ...` uses this adapter.

Live-tested installed Codex 0.160.1 and GPT-6.1 Sol: independent result323 arrived before the OpenCode worker finished; automatic continuation returned its unique fixture marker and sum143. Cancellation, uncertain submissions, turn-order races, and process disposal have regression tests.

That managed mode does not attach to an existing chat. Separately, `v0_160/native.mjs` installs versioned native hooks for Codex desktop/CLI sessions. They expose Bridge operations through the session's shell binding and inject completed results during active turns or a bounded Stop continuation. An idle chat receives pending results on its next turn; it is not awakened automatically. Existing hook approval and the runtime location must be preserved across upgrades.

Dynamic tools and native hooks are version-sensitive APIs, so a new pre-1.0 minor requires compatibility review. Interactive approval/input requests are not automatically granted.

Worker execution remains generic acpx plus the separately installed `codex-acp` adapter, with `CODEX_PATH` pointing at the discovered Codex executable. Catalog discovery uses native app-server model/list.

[Official app-server documentation](https://learn.chatgpt.com/docs/app-server)
