# Architecture

## Trust and ownership

The Electron main process owns file paths, original save bytes, parser models, transaction history and disk writes. The sandboxed renderer has no Node integration. Context isolation and a bundled CommonJS preload expose only named, typed operations. No arbitrary IPC channel, shell, filesystem API, URL opener or binary write primitive crosses the bridge.

Main-process handlers verify the sending WebContents and top-level frame URL, validate every argument, require the active session ID and use a revision for Apply. File/session mutations are serialized. Popups, navigation, webviews, downloads and permissions are blocked. Production renderer requests cannot access HTTP(S). The interface uses a Content Security Policy and renders save content as text rather than HTML. The development server alone permits local connections for HMR.

Security choices follow the official [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [sandbox model](https://www.electronjs.org/docs/latest/tutorial/sandbox). Drag/drop uses the documented [webUtils bridge](https://www.electronjs.org/docs/latest/api/web-utils).

## Modules

- `src/save-format/BinaryReader.ts`: checked little-endian reads, bounded sub-readers and FString decoding.
- `GvasReader.ts`, `PropertyParser.ts`, `ObjectTableParser.ts`: the observed outer layout and tagged structures, retaining raw tags/payloads.
- `ObjectArchive.ts`: validated root-relative object frames and complete tagged-property-run discovery inside native bodies. This intentionally does not rebuild unknown native serialization.
- `ObjectResolver.ts`: zero-based references and direct ownership.
- `CharacterParser.ts`, `SkillParser.ts`, `CampaignParser.ts`: domain projections and explicitly labeled default inferences.
- `SaveValidator.ts`: structural/reference diagnostics and save gating.
- `SavePatcher.ts`: allowlisted fixed-width scalar edits, expected-byte checks and byte-for-byte validation outside patch ranges.
- `SemanticDiff.ts`: cross-file semantic comparison with declared identity limitations.
- `src/main/EditingSession.ts`: immutable original baseline, atomic change batches, revision, undo/redo/revert and renderer-safe DTOs.
- `src/main/AtomicSave.ts`: exclusive numbered backups, same-directory staged files, flush/verify/rename, stale-file checks and final disk reparse.
- `src/main/Settings.ts`: local preferences and last directory, persisted outside save files.
- `src/preload/`: a narrow contextBridge API; drag/drop obtains the real path with Electron webUtils.
- `src/shared/api.ts`: serializable IPC contracts. Renderer receives summaries and requests raw details on demand.
- `src/renderer/`: React screens, explicit editing mode, local drafts, change review and native-accessible dialogs.
- `src/cli/`: standalone inspectors using the same parser/validator as the application.

## Transaction lifecycle

```
File bytes → private snapshot → parse + diagnostics → READ ONLY
  → Enable editing → draft fields → Apply validated batch
  → review pending changes → Save
  → create verified backup → stage patched clone → reparse and validate
  → atomic rename → re-read + verify → new baseline, empty history
```

Applying an invalid multi-field batch changes nothing. A patch identifies object + property and includes offset, old bytes, new bytes and description. Offsets and byte payloads are derived again from allowlisted parser properties, never trusted from the renderer. Changing history cannot touch disk. Unknown regions, tags, object sizes and archive offsets remain unchanged. Only four-byte payload changes are possible.

`parse()` privately snapshots the input in a WeakMap and returns copies for raw tags, payloads and `originalBuffer`. `serialize()` retrieves that private snapshot, ignoring user mutations to exposed Buffer copies. Serialization without edits is therefore lossless even for opaque payloads.

## What validation proves

Tests establish the observed header/outer structures, complete object-table discovery on the supplied corpus, known stat values, card ownership, Jack's slot count, text distinctions, precise scalar changes, backups, no-op saves and reparsability. Saving compares structural fingerprints before/after and verifies every unrelated byte region. It does not prove gameplay invariants, absence of unknown game checksums in unobserved variants, or behavior of cloud sync. Unknown native areas stay opaque; growing or relocating them is prohibited.

The parser is intentionally conservative about unknown property types, ambiguous bodies, missing expected character anchors and invalid references. Future layouts need new fixtures and explicit codecs. The 64 MiB, count and depth limits bound resource use; parsing currently runs in the main process and is short on the 1–2 MiB corpus. A worker process is the extension point if significantly larger saves are supported.

## Extensions

New scalar types need both decoder coverage and patch validation; being readable does not make a field editable. Text edits need complete history/encoding round trips and length handling. New skill/class operations should implement a domain transaction producing a complete set of validated patches, with all dependencies checked before the session accepts it. Variable-length operations require a separate archive writer and must never pass through the current fixed-width patcher.

## Verification

The tests use supplied sample binaries and small synthetic primitives. Original fixture hashes are captured in `sample-report.jsonl`; no test mutates the fixtures. Persistence tests create temporary directories. Electron smoke tests likewise use temporary save copies and a temporary preferences directory. The built renderer is tested through the actual preload and main IPC path, rather than a browser mock.
