# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Electron + TypeScript desktop editor for Gears Tactics PC saves (GVAS format). Branch `main` is the only long-lived branch; feature work happens on `codex/*` branches and is merged to `main` when shipped. Never commit real saves, personal data, or packaged binaries (`release/`, `sample_save_files/` fixtures are the only save files in the repo).

## Layout

- `src/save-format/` — GVAS parse/serialize, `SavePatcher` (fixed-width byte patches), `NativeSoldier` (equipment/inventory decode), `EquipmentStructural` (graph-rebuild edits), `SemanticDiff`.
- `src/main/` — `EditingSession` (history, staging, structural transactions), `AtomicSave` (verified backups, atomic writes), IPC.
- `src/renderer/`, `src/shared/` — UI and shared API types.
- `docs/` — `ARCHITECTURE.md`, `RELEASING.md`, `EQUIPMENT_EDITING.md`, `SOLDIER_TRANSFER.md`, and feature investigations. Update the relevant doc when changing save-format behavior.
- `tests/` (vitest), `scripts/`, `sample_save_files/` + `docs/sample-report.jsonl` (corpus manifest).

## Invariants

- The patcher applies **fixed-width, byte-exact windows only** — no variable-length or reference-touching operations. Variable-length edits go through the structural path (`EquipmentStructural` → graph writer → session staging with index rebasing).
- Edits are derived from the parsed save, provenance-checked, and revalidated after patching. Saves are written atomically with a verified backup of the original.
- Prefer verifying behavior against every fixture in the corpus manifest; new format findings get documented, not just coded.

## Commands

```sh
npm test                                   # vitest suite (~40s on M-series; fixture-heavy tests have raised timeouts)
npm run build                              # production build
node --import tsx scripts/electron-smoke.ts  # needs a graphical desktop
npm run dev                                # run the app
npx tsc --noEmit                           # typecheck
```

Node 24 LTS required — Node 20 breaks electron-builder with `ERR_REQUIRE_ESM`.

## Release process

Follow `docs/RELEASING.md` in full; the essentials:

1. **Version + tag**: bump the version in **both** `package.json` and `package-lock.json`, commit, create annotated tag `vX.Y.Z` matching the package version, push `main` and the tag. Never move a published tag.
2. **Validate on the release commit**: `npm test`, `npm run build`, electron smoke test.
3. **Package** (no CI — builds are cross-compiled locally on macOS per `docs/RELEASING.md`): universal macOS DMG (ad-hoc signed, notarization off) and Windows x64 NSIS + portable (unsigned), both with `--publish never` and separate output dirs.
4. **Verify + stage**: `codesign --verify`, `hdiutil verify`, `file` the binaries (universal = 2 architectures; Windows = PE32+ x86-64), launch-test the packaged Mac app, copy renamed assets into `release/assets/`, write `SHA256SUMS.txt` over the three binaries and `shasum -c` it.
5. **Publish**: `gh release create vX.Y.Z <assets> --notes-file …`, or `gh release upload` for an existing release. **Never `--clobber`; never replace a published binary** — fix mistakes under a new version. The Linux AppImage target exists but is not shipped.
6. **Release notes** match the established format: `##` feature summary, `## Downloads` (exact filenames incl. `SHA256SUMS.txt`, plus the unsigned-Windows/ad-hoc-mac disclaimer), `## Validation and limits` (test counts, in-game coverage, outstanding platforms). No `#` title header — the release title carries it.
7. After publishing: merge the release branch to `main`, delete merged branches, attach any missed platform builds from the same code state.

## Environment notes

- macOS arm64 host; `git@github.com:gregoryprosper/gears_tactics_save_editor` (SSH), `gh` CLI for releases. github.com DNS occasionally flakes — retry.
- The game reads saves only through Steam Cloud (`Steam/userdata/<id>/1184050/remote/`); Cloud must be on and the game closed when testing with live saves.
