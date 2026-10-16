# Install Subagent Bridge on macOS

Version 0.3.2 is an early preview for Apple Silicon (M1 or newer), targeting macOS
12 or later. It has been tested on the maintainer's Mac, not on every supported
macOS version. Intel Macs, Windows, and Linux do not have a published installer yet.

## Before opening

Install Node.js 22.13 or later from https://nodejs.org/ and install and configure
the coding agents you want to connect. Subagent Bridge does not include Node,
model subscriptions, API credits, or the agents themselves. Models use each
agent's existing provider configuration and permissions.

Download the DMG from:
https://github.com/Tarachand-Gupta/subagent-bridge/releases/tag/v0.3.2

Open it and drag Subagent Bridge into Applications. Launch it from Applications,
not from the mounted disk image: agent integrations need a stable install path.
The DMG also contains this Read Me.

## First launch and macOS security

The v0.3.2 release is signed with Tarachand Gupta’s Developer ID Application
certificate and notarized by Apple. The DMG and its app include stapled notary
tickets. Open it normally; macOS may ask you to confirm opening an app downloaded
from the internet. You should not need the earlier preview’s Open Anyway workaround.

If macOS reports that the app is damaged, unidentified, or will harm your computer,
stop and report the exact alert. Do not disable Gatekeeper. Check that you downloaded
v0.3.2 or later from the official release page: v0.3.1 and earlier were ad-hoc signed
and not notarized. SHA256SUMS is provided to verify download integrity.

## Connect your agents

Open Settings to see installed agents and compatibility. Codex and Pi need a
separate ACP adapter when used as workers. If these adapters are not already on
PATH, install the pinned, tested versions in Bridge's adapter directory:

```sh
npm install --prefix "$HOME/.harness-bridge/adapters" --save-exact @agentclientprotocol/codex-acp@2.2.2 pi-acp@0.0.34
```

You may install only the package for the worker you use. OpenCode and the
supported DeepSeek Harness build expose ACP themselves. Refresh Settings after
installing agents or adapters. An installed agent or listed model does not by
itself prove that its provider account can run that model.

Add a rule, choose its parent and worker, enable it, then click Save Rules and
Apply. This connects supported parent integrations. In an existing Pi session,
run /reload. Restart OpenCode or DeepSeek. In Codex, review the Bridge hooks in
/hooks and start or resume a chat. Hook ownership may still say Harness Bridge.
Later applied rule changes are read automatically by connected parents.

Every parent session passes its own project folder to the worker. Pass a
self-contained assignment: the parent's full chat history is not copied.
Background replies and follow-ups retain context while the owning session's
worker service remains alive. Codex receives replies during an active turn or
on the next turn; this preview does not wake an idle Codex chat.

Claude Code is deferred. Exact tested versions and limitations are recorded in:
https://github.com/Tarachand-Gupta/subagent-bridge/blob/main/docs/integrations.md#parent-integrations

## Upgrading an existing installation

Keep ~/.harness-bridge intact. The data folder, rule format, hook identifiers, and
legacy harness-bridge command alias have not changed. If the app's location
changes, use Save Rules and Apply from the new copy to update integrations, then
reload the parent agents and review any updated Codex hooks. Keep the old copy
until running work has finished and the new connection works. Work in progress
is not migrated between app locations.

## Help

Report installation issues with your macOS version, chip, Node version, agent
versions, and the exact error at:
https://github.com/Tarachand-Gupta/subagent-bridge/issues

Do not include provider keys, private prompts, or credentials in issue reports.
