# Gears Tactics Save Editor

An independent, local-only Electron + React + TypeScript desktop application for inspecting Gears Tactics PC saves and patching validated, existing scalar values. No game art, analytics, telemetry, accounts, or runtime network services.

**Milestone 1 is implemented. Milestone 2 supports bounded integer/float editing with backups and verification.** Text writing, skill insertion/removal, resets, equipment changes and reclassing are deliberately unavailable. “Safe” means tested binary preservation, not game compatibility. User testing confirmed Gabe’s health edit and Gabe/Sid ability-point edits, separately and combined, work for one save. An initial loading failure did not reproduce with byte-identical combined output; its cause remains unknown. These results do not certify other edits or saves; see the [game load test results](docs/REVERSE_ENGINEERING.md#user-reported-game-load-tests-2026-09-24).

## Install and run

Use Node.js 22.12+ or 24 LTS and npm. Dependencies are locked in `package-lock.json`.

```bash
npm ci
npm run dev
```

Open a file with **Open save**, or drag an extensionless save into the window. Saves such as `geargamesavegame_slot_39` require no renaming. The app remembers the last directory locally.

To open a particular sample with the built desktop application:

```bash
npm run build
npx electron . --inspect "sample_save_files/END GAME -  Jacked/geargamesavegame_slot_39"
```

If npm reports a root-owned cache, use a separate cache, for example `npm ci --cache /tmp/gears-editor-npm-cache`. Do not change ownership of unrelated system directories. Electron's binary must be installed; if your npm configuration disables install scripts, review and allow Electron's installer.

## Workflow

1. Open a save in **READ ONLY** mode. Inspect the campaign, soldiers, slots, and diagnostics.
2. Select **Enable editing**. Adjust the supported stats or campaign roster capacity.
3. Select **Apply changes** to stage the complete batch in memory and review old/new values.
4. Use Undo, Redo, or Revert all as needed. A new edit after Undo discards the redo branch.
5. Select **Save**, review the pending changes, then confirm **Save N changes**. **Save as…** writes a selected destination and keeps the source untouched.

Draft values must be applied before either save action. Merely typing or applying does not write to disk. Closing the app or opening another save prompts when changes would be discarded. The main process owns the session, validates IPC arguments and prevents concurrent writes.

### Currently editable

Only existing, unique, four-byte properties on verified object identities:

| Property             | Representation | Notes                                                                                  |
| -------------------- | -------------- | -------------------------------------------------------------------------------------- |
| CurrentAbilityPoints | signed int32   | Minimum 0; maximum configurable through Settings, up to 2,147,483,647; warns above 100 |
| Health, Strength     | signed int32   | Non-negative; extreme values flagged                                                   |
| MovementPoints       | signed int32   | Non-negative; extreme values flagged                                                   |
| Accuracy             | float32        | **Raw multiplier** when editing: 0.6 means 60%; values above 1 are flagged             |
| SoldierRosterSize    | signed int32   | On the campaign roster object; does not create soldiers                                |

Actions (`ActionPoints`), level, squad assignments, class, text, identity and equipment are read only. Actions editing was removed because its effect on combat could not be reliably attributed to the selected character; ability-point editing remains available. Omitted properties are not inserted. No single-field “Reclass” button exists. Enabling **Experimental Editing** records the preference and shows a warning, but does not unlock any unimplemented operation.

## Soldier archives and import previews

On **Soldiers**, **Export soldier…** writes one readable `.soldier.txt` archive containing the selected soldier's applied state and discovered dependencies. Apply or discard drafts first and choose a new filename; exports never overwrite existing files. This text extension is for the archive, not the game's binary save.

**Import soldier… currently provides a compatibility preview; production Apply is gated pending game validation.** The transfer engine now decodes the observed native soldier, roster and inventory layouts and generates separate Add/Replace test saves through a research CLI. It preserves destination Actions, campaign data and replacement squad assignments, resolves gear definitions, and rejects unsupported transfers. Undoable structural transactions and atomic persistence are implemented and tested internally. No preview or attempted desktop import changes the save. See [test-copy instructions and remaining release gate](docs/SOLDIER_TRANSFER.md).

## Save protection

- Retains a private copy of the complete original binary; `serialize(parse(bytes))` is byte-identical.
- A no-change Save is a no-op: no backup, write, or modification-time change.
- Before replacing any existing destination, creates an exclusive, verified backup: `filename.bak`, then `.bak.1`, `.bak.2`, etc. Existing backups are never replaced.
- Writes a uniquely named temporary file in the destination directory, flushes it, rereads and reparses it, then renames it into place. Directory metadata is flushed on platforms that support it.
- Verifies the final disk contents, all discovered object structures/references, expected values, file length, and every unrelated byte range.
- Rejects symlink destinations and sources changed on disk since opening. Rechecks the destination immediately before replacement. An adjacent `.editor-lock` prevents concurrent writes from this editor.
- A failed operation leaves the original or a verified backup available; temporary files and owned locks are cleaned up. After a process crash, inspect a remaining lock before removing it.

Close the game before editing a live save. Other programs and cloud sync do not honor the editor's lock; there is a small unavoidable race with external writers. Atomic replacement/durability guarantees depend on the local filesystem. Restore by copying the appropriate `.bak` file over the save while the game is closed.

## What the inspector knows

It parses the observed GVAS version 1 / package version 502 header, tagged properties, object constructor table, root archives, bounded object frames, character data, campaign metadata and owned skill slots. Unknown payloads and native serialization are preserved verbatim. Object identities and relationships determine ownership; there are no sample-specific absolute offsets.

- Dynamically discovers regular soldiers, heroes and Jack. Regular characters have 10 observed slots; Jack has 21. All counts come from the save.
- Shows learned skill-tree nodes, ability upgrade ranks and passives separately from equipped ability-card slots. The Skills count reflects learned nodes; a fully learned tree is labeled “All skills unlocked.”
- Lists equipped skills as **Active abilities**. Empty slots, raw card names and slot/object identifiers appear only in Developer mode. Unsupported learned-tree layouts are labeled unavailable rather than shown as zero learned skills.
- Resolves ability object names (for example `GanderAbilityCard_Stim_Lv3` → `Stim III`) while retaining internal identifiers.
- Labels missing CombatClass → Scout as a configurable inference.
- Reads custom names/callsigns and preserves localization keys/formatted text. Hero labels use the CharacterHero identifier, not fixed roster positions.
- Developer mode exposes object/class/property searches, original payload bytes, reference navigation, class internals and bounded FString searches.

## Sample validation and limitations

All **15 supplied files** are covered by fixture-driven round-trip and object-discovery tests. See [the machine-readable sample report](docs/sample-report.jsonl). The samples appear to include prior manual edits and are not pristine gameplay baselines.

The early Jacked slot 39 has 437 objects and two character records; Gabe/Sid's reported early stats match. The progressed Jacked slot 39 has 1,391 objects and 17 character records; Gabe and Sid each have eight equipped and two empty slots. Anthony Carmine and other custom names are readable. Jack's 21-slot case is verified.

**One supplied file is intentionally read only:** `NEW GAME - Classic Mode/geargamesavegame_slot_1` contains a non-finite Accuracy float. It is displayed with a blocking diagnostic and is never silently repaired.

This is a preservation-first parser, **not a complete implementation of every native Gears serialization routine**. It validates self-delimiting object frames and complete tagged-property runs within them; native prefixes/suffixes and some container payloads remain opaque. Unsupported headers are rejected; recoverable unknown payloads stay inspectable. Missing/ambiguous bodies, inconsistent references, unmapped character schemas, unknown property types, or non-finite values disable writes. Inputs are limited to 64 MiB, bounded counts, and bounded nesting. Plain localized names cannot all be resolved without game localization assets. Raw inspection shows original bytes, even when changes are staged.

## Platforms and builds

The game save format is from **Windows PC**. The editor's build configuration targets Windows (NSIS and portable), macOS (DMG), and Linux (AppImage). Development and desktop smoke tests in this workspace run on macOS. Windows/Linux runtime behavior and signing/notarization require platform-specific release validation; no claim of in-game or cross-platform certification is made.

```bash
npm run build       # typecheck + production main/preload/renderer bundles
npm start           # preview the built Electron application
npm run package     # unpacked app for the current OS, under release/
npm run dist        # distributable for the current OS
# On the target build machine:
npx electron-builder --win
npx electron-builder --mac
npx electron-builder --linux
```

Build outputs exclude the sample saves, test data, and additional CSV mod files. Packaging may download Electron/platform tooling. Code signing credentials are not configured.

Typical Windows locations to check (installation and storefront dependent):

- Steam: `<Steam folder>\userdata\<user ID>\1184050\remote\`, as reported in the [Steam save-location discussion](https://steamcommunity.com/app/1184050/discussions/0/2270321250022571850/).
- Microsoft Store/Xbox: `%LOCALAPPDATA%\Packages\Microsoft.GanderBaseGame_*\SystemAppData\wgs\`. WGS also uses container metadata; direct WGS container import/export is **not implemented**.

Choose a file that actually begins with `GVAS`. This application does not edit the supplied loot/mod CSVs or manage cloud/container metadata.

## CLI and verification

```bash
npm run inspect-save -- "sample_save_files/NEW GAME - Jacked Mode/geargamesavegame_slot_39"
npm run inspect-save -- /path/to/save --json
npm run diff-saves -- /path/to/before /path/to/after
npm run diff-saves -- /path/to/before /path/to/after --json
npm run samples:report
npm test
npm run typecheck
npm run lint
npm run format:check
npm run test:electron
```

`diff-saves` compares semantic property values and resolved references, matching heroes by identity and slots by owner/number. It reports missing/added properties and raw byte differences, including when changes are confined to unmapped data. Runtime renames/duplicate identities can appear as additions and removals; object indexes alone are never treated as stable across files.

The Electron smoke test opens **temporary copies**, edits and verifies them, checks the UI and renderer isolation, exercises Save As and the read-only safety gate, and writes screenshots under `artifacts/`. A graphical desktop is required. Preferences are isolated through the development-only `GTSE_TEST_DATA` environment variable.

## Design and future work

See [architecture](docs/ARCHITECTURE.md) and [reverse-engineering observations](docs/REVERSE_ENGINEERING.md). Parser code under `src/save-format/` has no Electron dependency and uses Node Buffer APIs directly.

Future milestones: verify complete FText writing before enabling names; analyze skill refund/reset serialization; map all class/unit/passive/weapon/progression relationships. Skill restructuring and reclassing must remain unavailable until generated saves load and behave correctly in the game.
