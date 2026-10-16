# macOS releases

Future Mac releases use one command for building, signing, notarizing and
verification. Signing credentials stay in the maintainer's Mac Keychain.

```sh
npm run release:mac -- --check      # check this Mac's setup
npm run release:mac                # prepare verified assets locally
npm run release:mac -- --publish   # prepare and publish to GitHub
```

The command runs **on the configured Mac**, not on GitHub-hosted runners. A Git
push alone does not start signing. It uses the existing certificate and Keychain
profile without asking for the Apple password again. The Keychain must be
unlocked and allow the signing tools access. Expired/revoked credentials must be
renewed. Never commit private keys, passwords, or exported signing identities.

## For each release

1. Update the version in `package.json`, `package-lock.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the app entry in
   `src-tauri/Cargo.lock`. Add `docs/releases/vVERSION.md`.
2. Review and merge the release changes. Check out that exact clean commit and
   push its `vVERSION` tag. The command refuses mismatched versions or tags.
3. Run `npm run release:mac -- --publish` on the configured Mac.

Releases are prereleases by default. Add `--stable` to publish a stable release
and mark it latest. Existing public assets are never replaced. Update the
website's release links in its separate repository after publishing.

The pipeline automatically:

- Takes an immutable snapshot of the committed source, installs locked npm
  dependencies and runs the tests.
- Builds in an isolated directory, signs every native dependency inside out,
  then seals the app with Developer ID, hardened runtime and a secure timestamp.
- Notarizes the app ZIP, checks Apple's acceptance log and attaches the app ticket.
- Creates and signs a DMG containing that stapled app, notarizes the DMG and
  attaches its ticket too.
- Checks signatures, tickets and Gatekeeper, mounts the DMG read-only and runs
  `syspolicy_check` on its enclosed app. Generates CLI packaging and checksums
  **after** stapling.
- With `--publish`, uploads to a GitHub draft, downloads and verifies the assets,
  then makes the release public. Verification failures leave the release a draft.

Artifacts, checksums, submission IDs and Apple's logs live in the ignored folder
`.dev-state/releases/vVERSION-ARCH-COMMIT/`. The running app and user rules are
not touched. Keep the bundle identifier and `~/.harness-bridge` data location stable.

## Interrupted releases

Rerun the same command from the same commit. Completed stages are reused;
notarization resumes the recorded submission rather than uploading again. Each
Apple wait is limited to ten minutes; a timeout does not cancel Apple's job.

If the process is forcibly killed, check the PID in `release.lock` and confirm
it and its children have stopped before removing that lock. Ordinary errors
release the lock automatically.

If an upload loses its connection before returning an ID, the script stops with
an **unknown outcome**. Use `notarytool history`, `info` and `log` with the same
Keychain profile. Match the log's SHA-256 to the journal's `sha256`, then add
the confirmed `id` to `app-notary.json` or `dmg-notary.json`. Never guess an ID
or delete a submission journal just to retry. Rejected builds require a fix and
a new source commit.

An interrupted GitHub draft creation is handled similarly: inspect the draft,
its tag and target commit, then record its `releaseId` in `release.json` only
after verifying it belongs to this run. Public releases are always left intact.

## One-time setup on another Mac

Install Node.js 22.13+, Rust, Xcode (including `notarytool` and `stapler`), the
GitHub CLI, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
Release verification requires macOS 14+ for `syspolicy_check`; the distributed
app still supports macOS 12+. Sign into GitHub with access to the repository.

Install a valid **Developer ID Application** certificate and its private key.
Apple Development and Apple Distribution certificates are not substitutes.
The script selects the identity automatically when exactly one is available.
If there are several, set `APPLE_SIGNING_IDENTITY` to the full certificate name.

```sh
security find-identity -v -p codesigning
xcrun notarytool store-credentials subagent-bridge-notary --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID
```

Enter the app-specific password at Apple's hidden prompt. Do not include it in
the command or shell history. An existing App Store Connect API key profile
also works. Set `APPLE_NOTARY_PROFILE` if its name differs from
`subagent-bridge-notary`.

GitHub Actions continues running credential-free regression tests on macOS and
Linux. Cloud signing would require a separately provisioned signing credential
and notarization secret; this setup does not export the Mac's private key.

## Local development builds

`npm run desktop:package` still supports ad-hoc local builds and does not
notarize them. With `APPLE_SIGNING_IDENTITY` it signs the app and DMG, but release
publication should always use `release:mac` for the complete verification flow.

References: [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/),
[Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).
