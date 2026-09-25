# Releases

## Published v0.1.0

[Gears Tactics Save Editor v0.1.0](https://github.com/gregoryprosper/gears_tactics_save_editor/releases/tag/v0.1.0) was published on September 25, 2026, from commit `a7f1310d137fcd102fc787d096450dc90de1be9b`. The release tag remains on that commit; subsequent documentation updates on `main` do not change the released application.

The downloadable applications bundle Electron 44.4.5 and do not require Node.js on the user's machine.

| Asset                                                      | Platform and use                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `Gears-Tactics-Save-Editor-0.1.0-windows-x64-setup.exe`    | Windows x64 NSIS installer                                  |
| `Gears-Tactics-Save-Editor-0.1.0-windows-x64-portable.exe` | Windows x64 app that runs without installation              |
| `Gears-Tactics-Save-Editor-0.1.0-macos-universal.dmg`      | macOS app for Apple Silicon and Intel; drag to Applications |
| `SHA256SUMS.txt`                                           | SHA-256 checksums for the three binaries                    |

GitHub also provides source archives. No Linux binary is included in v0.1.0, although the project has an AppImage build target.

### Signing and validation status

Windows executables are unsigned. The macOS application uses an ad-hoc signature for bundle integrity; it has no Developer ID signature or Apple notarization. Operating systems may display security warnings or block launch. Ad-hoc signature verification does not establish publisher identity.

The v0.1.0 build was produced on Apple Silicon macOS using Node.js 24.20.0 and electron-builder 26.15.3. Verification completed:

- All 60 automated tests passed. The fixture-heavy editing test exceeded its default 30-second timeout on an initial run; the full suite passed with a 90-second per-test timeout.
- Type checking and the production build passed.
- The Electron smoke test passed on temporary save copies, covering renderer isolation, fixture UI, skill counts, editing, undo/redo, draft ownership, backups, atomic writes, Save As, the developer inspector, and the read-only safety gate.
- The packaged universal macOS application launched on Apple Silicon. Its executable contains both `arm64` and `x86_64` architectures.
- The macOS application's code-signature integrity and the DMG checksum passed verification.
- Windows and macOS packaged main/preload bundles matched the production build. Sample saves were absent from the application archives.

Windows and Intel Mac runtime validation remains outstanding. The existing in-game compatibility limitations still apply; see the [README](../README.md#sample-validation-and-limitations).

### Verify a download

Download `SHA256SUMS.txt` from the same release as the application. On macOS, put the DMG and checksum file in one directory and run:

```bash
shasum -a 256 Gears-Tactics-Save-Editor-0.1.0-macos-universal.dmg
cat SHA256SUMS.txt
```

On Windows, use PowerShell and substitute the portable filename if applicable:

```powershell
Get-FileHash .\Gears-Tactics-Save-Editor-0.1.0-windows-x64-setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Compare the calculated hash with the line for that exact filename. Checksums detect corrupted or mismatched downloads; they are not a publisher signature.

## Building release assets

These commands run on macOS and produce both Windows x64 packages and a universal macOS DMG. Use a clean checkout of the intended release commit, a supported Node.js version (24 LTS is recommended), npm, network access for Electron and packaging-tool downloads, and a graphical desktop for the smoke test. The universal build also requires Apple's command-line developer tools, including `lipo` and `codesign`.

For an existing release, use its tag rather than the current feature branch. For example, from an existing repository checkout:

```bash
git fetch git@github.com:gregoryprosper/gears_tactics_save_editor.git tag v0.1.0
release_build_dir=$(mktemp -d /tmp/gears-tactics-release-build.XXXXXX)
git worktree add --detach "$release_build_dir" v0.1.0
cd "$release_build_dir"
git rev-parse HEAD
node --version
npm ci
```

For a new version, use the reviewed release commit instead of `v0.1.0`. Update and commit both `package.json` and `package-lock.json` before selecting that commit. The package version, tag, release title, and asset names must agree.

Check `node --version` **inside the build directory**. A version manager can select an older runtime after changing directories. Node 20.14.0 caused an `ERR_REQUIRE_ESM` failure in electron-builder during the first release; using Node 24.20.0 resolved it.

Validate and build before packaging:

```bash
npm test
npm run build
node --import tsx scripts/electron-smoke.ts
```

If the fixture-heavy suite times out on a slower machine, rerun with `npm test -- --testTimeout=90000` and record the timeout adjustment. Investigate assertion failures separately.

Package the production bundles with the same signing policy as v0.1.0:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false node node_modules/electron-builder/cli.js \
  --mac dmg --universal --publish never \
  -c.mac.identity=- -c.mac.notarize=false \
  -c.directories.output=release/mac

CSC_IDENTITY_AUTO_DISCOVERY=false node node_modules/electron-builder/cli.js \
  --win nsis portable --x64 --publish never \
  -c.win.signExecutable=false \
  -c.directories.output=release/windows
```

The macOS command creates an ad-hoc signature. The Windows command preserves executable metadata while skipping signing. `--publish never` keeps packaging separate from uploading. These overrides do not modify the checked-in build configuration. A future signed release needs its own signing and notarization configuration.

### Inspect and stage the artifacts

Set the version from the package and inspect the macOS output:

```bash
release_version=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
codesign --verify --deep --strict --verbose=2 \
  'release/mac/mac-universal/Gears Tactics Save Editor.app'
hdiutil verify "release/mac/Gears Tactics Save Editor-${release_version}-universal.dmg"
file 'release/mac/mac-universal/Gears Tactics Save Editor.app/Contents/MacOS/Gears Tactics Save Editor'
file 'release/windows/win-unpacked/Gears Tactics Save Editor.exe'
```

Launch the packaged macOS app and verify its UI. Test the Windows installer and portable app on Windows, and the Intel build on an Intel Mac, when those platforms are available. Report any untested platforms in the release notes. Inspect each packaged `app.asar` to ensure it contains the intended production bundles and excludes sample saves, tests, and mod CSV files.

Stage clearly named assets in a fresh directory and calculate checksums:

```bash
mkdir -p release/assets
cp "release/windows/Gears Tactics Save Editor Setup ${release_version}.exe" \
  "release/assets/Gears-Tactics-Save-Editor-${release_version}-windows-x64-setup.exe"
cp "release/windows/Gears Tactics Save Editor ${release_version}.exe" \
  "release/assets/Gears-Tactics-Save-Editor-${release_version}-windows-x64-portable.exe"
cp "release/mac/Gears Tactics Save Editor-${release_version}-universal.dmg" \
  "release/assets/Gears-Tactics-Save-Editor-${release_version}-macos-universal.dmg"
(
  cd release/assets
  shasum -a 256 *.exe *.dmg > SHA256SUMS.txt
  shasum -a 256 -c SHA256SUMS.txt
)
```

Only upload the three application downloads and `SHA256SUMS.txt`. The unpacked app folders and builder debug files are build intermediates. Blockmap files are not needed for this application's manual download/install workflow. Keep generated binaries out of Git; `release/` is ignored.

## Publishing on GitHub

The first release was published through the GitHub web interface. Packaging does not require a GitHub API token; uploading requires a signed-in account with repository release permissions.

1. Open the repository's [Releases page](https://github.com/gregoryprosper/gears_tactics_save_editor/releases).
2. For a new release, create or select `v<version>` at the exact commit used to build the application. Confirm the target before publishing; do not move an existing release tag to include later changes.
3. Add a title and release notes covering features, installation, supported architectures, signing status, completed validation, untested platforms, and known limitations.
4. Attach the staged binaries and `SHA256SUMS.txt` using the release's binary attachment control. Wait for every upload to finish.
5. Publish the new release, or choose **Update release** when adding assets to an existing release built from the same commit.
6. Verify the published tag/commit, asset names, download sizes, and checksum file. Download and verify the assets before announcing the release.

If the GitHub CLI is installed and authenticated, an existing release can also receive these assets with:

```bash
gh release upload "v${release_version}" release/assets/* \
  --repo gregoryprosper/gears_tactics_save_editor
```

This command requires the version variable and staged assets from the earlier steps. It deliberately omits `--clobber`: do not silently replace an already published binary. Release changed application code under a new version, and regenerate checksums for its assets.
