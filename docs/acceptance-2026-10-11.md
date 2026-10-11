# Acceptance results — 11 October 2026

These are local fixture tests, not claims about every provider/model or OS.

| Check | Result |
|---|---|
| acpx execution: Codex GPT-6.1 Sol + High | Correct hidden marker and sum125 |
| acpx execution: Pi DigitalOcean Qwen | Correct hidden marker and sum125 |
| acpx execution: OpenCode Cloudflare GLM | Correct hidden marker and sum125 |
| acpx execution: DeepSeek DigitalOcean deepseek-v4-pro-0813 | Correct hidden marker and sum139 |
| Pi actual extension loader after version guard/move | Four tools registered; current isolated rules read |
| Pi background parent → OpenCode (earlier same-day test) | Immediate job receipt; independent calculation; automatic result delivery |
| Codex managed parent → OpenCode | Running receipt at9s; independent323 at11.5s; worker result20.5s; automatic continuation21.1s; correct marker/sum143 |
| OpenCode native1.18.34 parent → Codex | Two distinct project sessions; each got only its own nonce and correct totals149/109; automatic continuation |
| DeepSeek native rc.2 parent → OpenCode | Initial prompt ended after job receipt; native completion woke parent without another prompt/status poll; correct nonce/sum100 |

Evidence is retained locally under ignored `.dev-state/`: `acpx-integrated-evidence.json`, `final-adapters-evidence.json`, `background-live-evidence.json`, `codex-parent-live-evidence.json`, `opencode-native-parent-evidence.json`, and `deepseek-native-notice-evidence.json`. Do not publish raw traces without reviewing them for local paths or private context.

Codex existing app/CLI attach-and-wake is not implemented. Only its Bridge-managed parent mode was tested. DeepSeek rc.2 uses the installed native jobs API; newer upstream ACP subagent APIs were not substituted. OpenCode2 is unsupported. Claude is deferred.

## Regression and desktop verification

43 automated tests pass. The native Tauri release builds successfully (about59MiB bundled with production runtime dependencies). Computer-use checks verified the redesigned rule display, Add Rule producing Rule02, its enable toggle, Settings version/connection details, removal of the test rule, and Save rules installing the managed integrations. The saved Pi-to-OpenCode rule retained its original ID, worker, model, Auto task, and Can policy. Existing native parent sessions require the indicated reload/restart.
