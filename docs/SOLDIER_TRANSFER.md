# Soldier transfer implementation status

Work lives on `codex/soldier-export-import`. **Desktop export/import is enabled for regular recruit Add and same-class Replace in compatible campaign/barracks saves.** Heroes and Jack replace their existing counterpart. Classic-to-Classic and Jacked-to-Jacked transfers share the same engine; cross-mode transfers remain blocked. Gary Add and Gabe Replace passed user-reported barracks, weapons, combat, abilities, turn-2 Actions and save/reload checks. These results validate the shared transfer path without certifying every equipment combination or save. There is no per-class or per-hero test allowlist.

## Desktop behavior

- Export one selected soldier to versioned UTF-8 JSON `.soldier.txt`. Exports include applied edits, identity, appearance, class, statistics, progression, skill selections, equipment and discovered dependencies. Some native fields are represented as hex alongside readable summaries. Archives are not save backups.
- Apply or discard drafts first. Export publishes a verified file atomically and exclusively; existing files and symlinks cannot be overwritten. Input supports UTF-8 BOM and CRLF with size, nesting and schema limits.
- Enable editing and preview Add or Replace, including mode, format, capacity, dependency and hero restrictions. Preview does not modify the session. Apply checks compatibility again in the main process and stages one undoable transaction; Save writes it with the existing backup workflow.
- Preview tokens belong to one session revision. Edits, history changes, saving, cancellation or another preview invalidate old applications. Main-process checks do not depend on disabled UI controls.
- Archives made before inventory and weapon registration definitions were included must be re-exported. The version-1 completeness marker remains `native-dependencies-unverified` for compatibility: an archive cannot grant itself permission to import. Main-process structural and dependency checks determine eligibility.

## Native transfer engine

Classic saves commonly omit `SaveInfo.GameType`. The importer identifies that mode from the concrete Classic meta-inventory class; it does not compare an exported `Unknown` string with a missing destination value. Archives exported before this correction with `gameType: Unknown` must be re-exported. An unrecognized mode still blocks transfer.

`NativeSoldier` fully consumes the observed character suffix: four equipment entries, four weapon references, seven mod positions per equipped weapon, learned skill triples and tree indices, 10 regular or 21 Jack card slots, and five unit references. Sparse learned skills retain their original tree indices; an index need not be smaller than the number of learned skills. Unexpected trailing bytes, unsupported dependency classes and unresolved references block generation.

The roster codec separates recruited soldiers from recruitment-pool candidates and checks the tagged pool against the native records. Add uses a recruited, unassigned, same-class regular soldier as a destination-default template. It appends an unassigned recruit without increasing capacity. Capacity conservatively counts Jack too; an unknown or full capacity blocks Add. Additional unrecognized roster groups and inferred classes are rejected.

Replace requires an existing recruited soldier of the same verified class. Heroes and Jack require the same hero identity, cannot be added, and cannot be unlocked through import. Replacement preserves destination squad assignments, previous status and Actions. Add preserves the template's Actions and unassigned defaults. There is no ActionPoints override.

Numeric inventory records contain an item GUID, quantity and linked provenance GUID. Cosmetic inventories contain catalog GUIDs and definition references. The importer resolves equipped items against definitions already present in the destination and leaves destination inventory quantities and provenance unchanged. Missing or conflicting definitions block transfer. Runtime undergarment names vary between saves; those records match by catalog GUID and class only after verifying their serialized definition is empty. Other cosmetic definitions match their complete asset identity.

Weapons also require registration in the main meta inventory. Each record contains a weapon kind byte, a flag byte, an int32 level and a framed WeaponData reference. The observed five lists contain primary weapons, secondary weapons, two matching grenade lists and recruitment-pool weapons. WeaponData's own sparse tagged properties do not contain the weapon kind or level. Exports now include the selected soldier's weapon registration metadata. Import appends new weapon instances to the relevant lists, including both grenade lists, preserving existing records and the recruitment-pool list. Unsupported type/slot combinations and missing definitions block generation. `WeaponRegistry` completely consumes this layout and reconstructs it byte-identically across all 15 fixtures.

Shared campaign, roster and inventory objects become destination bindings rather than being transplanted. Shared ability-card `TotalAmountOfUses` remains the destination value; newly introduced definitions omit this campaign counter. Other reused assets must match serialized content. Owned objects receive fresh names and rebased ownership paths. Exactly one character is transferred.

## Structural writing and transactions

The inventory's entire body can be physically embedded inside the first character that references it. Copying a character's byte slice would therefore copy shared campaign data or miss its dependencies. `StructuralArchive` separates framed bodies from references; `GraphArchive` rebuilds first-reference body placement, root-relative offsets, property lengths, byte counts and the object-constructor table. It removes unreachable objects and remaps discovered references. Unchanged reconstruction is byte-identical across all 15 fixtures.

`SoldierCandidate` validates the package again, resolves definitions, writes the graph, reparses it and verifies the imported summary, Actions and roster membership. Every surviving unrelated object body is compared after reference remapping. Unknown destination native regions remain opaque: these checks establish the observed structures, not every possible gameplay invariant or hidden reference.

`EditingSession.applySoldierImport` validates the session revision, preview token, editing mode and compatibility before invoking the internal transaction builder. The builder stages one undoable transaction, incorporating previously applied scalar edits and retaining their descriptions in Pending changes. Undo/redo, revert, later scalar edits and committed baselines are tested. Arbitrary packages and bytes cannot reach the transaction builder directly through IPC. `atomicSaveStructural` shares the existing verified backup, stale-source protection, staged flush and atomic replacement workflow; its bytes come only from the main process. The scalar patcher remains separate.

## Generate a separate game-test copy

The research CLI cannot overwrite any existing output. It requires exact, unique display names and an explicit experimental flag:

```bash
node --import tsx src/cli/soldier-candidate.ts --experimental-test-copy \
  /path/to/donor 'Gary Carmine' /path/to/destination add - \
  /path/to/new-test-folder/GearGameSaveGame_Slot_41

node --import tsx src/cli/soldier-candidate.ts --experimental-test-copy \
  /path/to/donor 'Gabe Diaz' /path/to/destination replace 'Gabe Diaz' \
  /path/to/another-test-folder/GearGameSaveGame_Slot_41
```

It prints the transfer result and SHA-256 hashes for both inputs and output. Original files remain untouched. The `.txt` extension belongs to the portable archive, **not** to these binary game-test saves. Keep test saves extensionless before transferring between machines.

Test one copy at a time with the game closed during replacement and retain the working original. Check loading, identity, appearance, level, learned/equipped skills, equipment and mods, unchanged campaign progress, and unchanged unrelated soldiers. For Add, check roster membership and deploy the new soldier. For Replace, check the original squad assignment. Check Actions in combat across turn boundaries, then save and reload in the game.

## Verification and compatibility

`tests/soldier-transfer.test.ts` covers envelope reconstruction, export, bounded input, compatibility previews, applied-state export, stale/cancelled previews and exclusive archive publication. `tests/native-transfer.test.ts` covers graph reconstruction across all fixtures, native character/roster/inventory parsing, Add and cross-save Replace, regular/hero/Jack restrictions, missing/tampered dependencies, protected fields, transaction history, structural persistence and stale-source rejection. Electron smoke tests exercise real export/preview IPC alongside scalar editing, backup and reload regressions.

Eligibility follows the decoded data: matching game mode and serialization versions, campaign/barracks state, complete native layout and dependency coverage, verified class and matching hero identity. Add additionally requires space and an unassigned same-class regular template. There is no display-name, class or mode allowlist tied to individual game-test cases. Tests apply replacement through the production preview/token path for Support, Vanguard, Heavy, Sniper and Jack as present in Classic and Jacked fixtures. The desktop smoke test exports a Heavy, applies Add, undoes/redoes, saves with a verified backup and reopens; it also imports Gabe into a different save, saves and reloads via main/preload IPC. Unknown or inferred layouts remain blocked; compatibility is assessed per save.

## User game test: missing weapons (2026-09-25)

The user reported seeing level 15 Gary Carmine in the game. Subsequent screenshots showed level 15 Gary and Gabe with armor present but blank primary/secondary weapon slots and no held weapon. This establishes initial loading and visible identity/level/armor for the tested candidates, not successful complete transfers, combat, or save/reload.

The initial writer cloned WeaponData objects without registering them in the destination meta inventory. The original Add output hash was `e10b478dc42ac370390b724d299312d1a39e3752c06232efa354fa0243afb4ff`; Replace was `6fe10e7c660b2d3cc7c3399554c443383acd5152435c9a5a6a26d43e02b64076`. Both are superseded by the candidates under `artifacts/soldier-transfer-tests-v2/`. The writer now registers imported weapons and tests verify metadata, mods and preservation of pre-existing registrations.

## User-confirmed results and desktop enablement (2026-09-25)

The user supplied follow-up screenshots showing Gary and Gabe with populated weapon slots and held weapons, reported successful save/reload, and then confirmed the requested combat checks for both soldiers: attacks, imported abilities and the expected 3 Actions on turn 2. These are user-reported game results, distinct from the automated parser and desktop tests.

The tested v2 Add output SHA-256 is `fbdf4e3e2614eca4a2fea92c2ce0ae372b3ecae81075d6d1750d26673acc425f`; Replace is `105a578ce261002bac247add4d128d50298d5c9959930cb8226b27b99d0a7835`. Both used donor hash `eaa2e8400c9f64f0003635ddd7edd782cc43cc531a6136c4d6dbecc894eb48e5` and destination hash `ea0302a761dd87184d3381d05d547c25367ff2c738544557d576a01601df0743`.

The initial Heavy/Gabe-only production restriction was removed after the user correctly noted that these cases exercise the shared transfer logic. Compatible classes and both modes now use that same desktop path, with structural/dependency checks and complete export/import/save workflow coverage. Automated validation of the broader cases is not presented as additional in-game testing.
