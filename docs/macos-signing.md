# macOS signing and notarization

Release packaging signs native npm modules and helper code before sealing the
outer app. The certificate and private key stay in the maintainer's Keychain.
Do not commit private keys, passwords, or exported signing identities.

## Build with Developer ID

You need Xcode and a valid **Developer ID Application** certificate with its
private key. Apple Development and Apple Distribution certificates are not
substitutes for distributing a downloaded Mac app.

```sh
security find-identity -v -p codesigning
APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)' npm run desktop:package
```

Use the exact certificate name from Keychain. An invalid or unavailable identity
stops packaging; it never falls back to an unsigned release. With no identity,
the command still makes a local ad-hoc build for development.

Set `CARGO_TARGET_DIR` to an absolute staging directory to avoid replacing a
running build. The app and DMG are written under its `release/bundle` directory.
Signing uses a secure timestamp and hardened runtime, without runtime exceptions.
The DMG is signed too. **This command does not notarize the build.**

## Authenticate once

```sh
xcrun notarytool store-credentials subagent-bridge-notary --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID
```

Enter an app-specific password at the hidden prompt. Do not put it in the command,
shell history, repository, or CI logs. A preconfigured App Store Connect API key
profile is also supported by Apple's `notarytool`.

## Submit and verify

Use the actual DMG path produced by the build:

```sh
xcrun notarytool submit '/path/to/Subagent Bridge_VERSION_arm64.dmg' --keychain-profile subagent-bridge-notary
xcrun notarytool info SUBMISSION_ID --keychain-profile subagent-bridge-notary
xcrun notarytool log SUBMISSION_ID --keychain-profile subagent-bridge-notary
```

Keep the returned submission ID. If processing is still in progress, resume that
submission; do not upload the same artifact again. Only `Accepted` is success.
Read the log even when accepted, then staple and validate the final DMG:

```sh
xcrun stapler staple '/path/to/Subagent Bridge_VERSION_arm64.dmg'
xcrun stapler validate '/path/to/Subagent Bridge_VERSION_arm64.dmg'
codesign --verify --strict '/path/to/Subagent Bridge_VERSION_arm64.dmg'
spctl --assess --type open --context context:primary-signature --verbose=4 '/path/to/Subagent Bridge_VERSION_arm64.dmg'
```

Mount the final DMG read-only and check its app with
`codesign --verify --deep --strict`, `spctl --assess --type execute --verbose=4`,
and `syspolicy_check distribution`. Verify a fresh downloaded copy before
publishing claims about Gatekeeper. For a separately distributed ZIP, notarize
and staple the app itself before creating the ZIP with `ditto`.

Generate release checksums **after** stapling: stapling changes the DMG bytes.
Keep the existing bundle identifier and `~/.harness-bridge` data location so
users' rules and parent integrations continue to work.

References: [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/),
[Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).
