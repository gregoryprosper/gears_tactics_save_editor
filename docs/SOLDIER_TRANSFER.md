# Soldier transfer implementation status

Work lives on `codex/soldier-export-import`. The branch implements readable soldier archives, compatibility previews, a native transfer engine, structural writing, and undoable import transactions. **Generated transfers have not been validated in Gears Tactics.** Production Apply remains gated in both the UI and main process; separate research copies can now be generated for that validation.

## Desktop behavior

- Export one selected soldier to versioned UTF-8 JSON `.soldier.txt`. Exports include applied edits, identity, appearance, class, statistics, progression, skill selections, equipment and discovered dependencies. Some native fields are represented as hex alongside readable summaries. Archives are not save backups.
- Apply or discard drafts first. Export publishes a verified file atomically and exclusively; existing files and symlinks cannot be overwritten. Input supports UTF-8 BOM and CRLF with size, nesting and schema limits.
- Preview Add or same-class Replace, including mode, format, capacity, dependency and hero restrictions. Preview does not modify the session. Production Apply always rejects until a game-validated profile is enabled.
- Preview tokens belong to one session revision. Edits, history changes, saving, cancellation or another preview invalidate old applications. Main-process checks do not depend on disabled UI controls.
- Archives made before inventory definitions were included must be re-exported. The current completeness marker remains `native-dependencies-unverified` until game testing confirms behavior.

## Native transfer engine

`NativeSoldier` fully consumes the observed character suffix: four equipment entries, four weapon references, seven mod positions per equipped weapon, learned skill triples and tree indices, 10 regular or 21 Jack card slots, and five unit references. Sparse learned skills retain their original tree indices; an index need not be smaller than the number of learned skills. Unexpected trailing bytes, unsupported dependency classes and unresolved references block generation.

The roster codec separates recruited soldiers from recruitment-pool candidates and checks the tagged pool against the native records. Add uses a recruited, unassigned, same-class regular soldier as a destination-default template. It appends an unassigned recruit without increasing capacity. Capacity conservatively counts Jack too; an unknown or full capacity blocks Add. Additional unrecognized roster groups and inferred classes are rejected.

Replace requires an existing recruited soldier of the same verified class. Heroes and Jack require the same hero identity, cannot be added, and cannot be unlocked through import. Replacement preserves destination squad assignments, previous status and Actions. Add preserves the template's Actions and unassigned defaults. There is no ActionPoints override.

Numeric inventory records contain an item GUID, quantity and linked provenance GUID. Cosmetic inventories contain catalog GUIDs and definition references. The importer resolves equipped items against definitions already present in the destination and leaves destination inventory quantities and provenance unchanged. Missing or conflicting definitions block transfer. Runtime undergarment names vary between saves; those records match by catalog GUID and class only after verifying their serialized definition is empty. Other cosmetic definitions match their complete asset identity.

Shared campaign, roster and inventory objects become destination bindings rather than being transplanted. Shared ability-card `TotalAmountOfUses` remains the destination value; newly introduced definitions omit this campaign counter. Other reused assets must match serialized content. Owned objects receive fresh names and rebased ownership paths. Exactly one character is transferred.

## Structural writing and transactions

The inventory's entire body can be physically embedded inside the first character that references it. Copying a character's byte slice would therefore copy shared campaign data or miss its dependencies. `StructuralArchive` separates framed bodies from references; `GraphArchive` rebuilds first-reference body placement, root-relative offsets, property lengths, byte counts and the object-constructor table. It removes unreachable objects and remaps discovered references. Unchanged reconstruction is byte-identical across all 15 fixtures.

`SoldierCandidate` validates the package again, resolves definitions, writes the graph, reparses it and verifies the imported summary, Actions and roster membership. Every surviving unrelated object body is compared after reference remapping. Unknown destination native regions remain opaque: these checks establish the observed structures, not every possible gameplay invariant or hidden reference.

`EditingSession.stageResearchImport` stages a candidate as one undoable transaction, including previously applied scalar edits. Undo/redo, revert, later scalar edits and committed baselines are tested. This internal method is not exposed through IPC. `atomicSaveStructural` shares the existing verified backup, stale-source protection, staged flush and atomic replacement workflow; its bytes come only from the main process. The scalar patcher remains separate.

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

## Verification and remaining release gate

`tests/soldier-transfer.test.ts` covers envelope reconstruction, export, bounded input, compatibility previews, applied-state export, stale/cancelled previews and exclusive archive publication. `tests/native-transfer.test.ts` covers graph reconstruction across all fixtures, native character/roster/inventory parsing, Add and cross-save Replace, regular/hero/Jack restrictions, missing/tampered dependencies, protected fields, transaction history, structural persistence and stale-source rejection. Electron smoke tests exercise real export/preview IPC alongside scalar editing, backup and reload regressions.

The remaining release gate is in-game evidence for each supported transfer profile, including regular Add, same-class Replace, matching heroes and Jack. Record the exact input/output hashes and results, fix any observed failures, then enable only validated profiles through production preview/Apply and add corresponding desktop transaction tests. Classic and Jacked modes, other classes, equipment variants and save versions must not inherit certification from one successful case. The current implementation deliberately blocks unsupported paths; it does not promise import into every save.
