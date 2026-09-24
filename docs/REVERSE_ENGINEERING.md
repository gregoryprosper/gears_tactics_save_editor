# Observed Gears Tactics format

These observations come from the supplied binaries, not a generic Unreal serializer. No game executable or copyrighted art is bundled. The samples appear to include prior manual edits; they are evidence of serialization, not proof that a newly edited save works in-game.

## Outer archive

All 15 samples begin with `GVAS`, LE int32 save version 1, LE int32 package version 502, uint16 engine components 4/11/2, uint32 changelist 0, an FString branch and FString class `GanderSaveGameObject`. FString starts with signed LE int32 length including NUL; negative lengths denote UTF-16LE code units. There is no modern custom-version table in this outer header.

Tagged properties contain FString name, FString type, uint32 payload size, int32 array index. `None` ends a list. StructProperty adds FString struct type and 16 opaque GUID bytes; ByteProperty adds enum type; ArrayProperty adds element type; BoolProperty stores a byte in the tag and has zero payload size. There is no modern property GUID marker. Known tags are decoded; unrecognized payloads remain raw.

Top-level properties include GameState, BaseRandomSeed, SaveInfo, SavedRootObjects and ObjectConstructorParametersArray. The last two are arrays of None-terminated tagged structs. SaveInfo contains mission, completion fraction, difficulty and game type. The file ends with a four-byte zero trailer.

## Object table and root archives

ObjectConstructorParametersArray starts with int32 count. Each entry holds OuterPath, ClassPath, Name (StrProperty) and Flags (Int64Property). Indices are zero-based. The early Jacked slot 39 has 437 entries; the progressed Jacked slot 39 has 1391. Names are not unique. ClassPath identifies characters even when Name is just GanderCharacterData_N.

Each SavedRootObjects element contains Data (byte array: int32 count then bytes) and Index (IntProperty). Data begins with int64 root-relative end of the primary object. A framed object reference is:

```
int32 objectIndex (-1 means null; no other fields)
int64 endOffsetRelativeToRootData
recursive outer-object reference
int32 outerObjectIndex (repeats the outer reference's index)
int32 hasSerializedBody (0 or 1)
body bytes, ending at rootDataStart + endOffset
```

References with body=0 still serialize the outer chain. References with body=1 may contain native/custom data before and after a tagged-property list, nested object records, or external asset strings. These are NOT ordinary four-byte Unreal object references. Root end is followed by a custom-version table: int32 count, then count × (16-byte GUID + int32 version).

The reader bounds and validates reference frames using the root end, table identity, matching outer index, flag, nested containment and minimum header size. Native bodies are not fully mapped. It discovers complete, terminated tag runs inside those bounded bodies, excluding nested object records. This is conservative structural discovery, not a full implementation of the game's native serializer. Unmapped bytes are retained verbatim. No offsets specific to any fixture are used.

## Characters and skills

GanderCharacterData objects own GanderCharacterCardSlot objects via outer index; the table OuterPath corroborates ownership. SlotNum may be omitted for slot zero. Empty slots omit AbilityCard; their SlotStatus is Empty. Equipped references resolve against the object table. Regular characters have 10 slots; Jack has 21. Counts are discovered, not used to allocate slots.

Early Gabe: Level 2, Health 500, Accuracy float32 ~0.6, Strength 65, MovementPoints 6, ActionPoints 3, CurrentAbilityPoints 2. Sid differs in Strength (50), class Vanguard and squad slot. Display accuracy as a percentage but edit its raw multiplier explicitly. SoldierRosterSize is 4 in early slot 39 and 14 in progressed slot 39.

CombatClass is a ByteProperty containing EGanderCharacterClass::X. Missing CombatClass is a configurable Scout inference, never a proven value. Hero identity comes from CharacterHero; do not depend on an object name containing Gabe/Sid.

## Text

Observed TextProperty starts with uint32 flags, uint8 history. History 0 then has one FString. Flags 2 identify custom strings (Anthony, Carmine, callsigns). Flags 8 identify localization keys; other flags can also contain GUID keys. History 2 contains formatted/nested text, not a plain editable string. Localization IDs and all unsupported histories are preserved. Text writing is deliberately not implemented in milestones 1–2.

## Editing boundary

Only allowlisted, existing, uniquely identified 4-byte IntProperty/FloatProperty payloads may be patched. No property insertion, removal, length changes, object-reference writing or native-data reconstruction. Safe here means validated binary preservation, not game-play certification. Unknown native regions and MapProperty payloads are copied unchanged. Ambiguous/missing object bodies, invalid references, unsupported header layouts or invalid editable property widths disable saving.

Further work: map native prefix/suffix records, localized text histories, skill reset transactions, equipment and complete class relationships; validate edited saves in-game before expanding support. Reclassing remains unavailable.

## Additional findings from the complete corpus

`AssetObjectProperty` contains a plain FString asset path (for example LoadingScreenSVO). It has the normal tag header with no additional type metadata. It is decoded read-only. Ability name level suffixes occur as both `_Lv3` and `_lv3`; label normalization is case-insensitive.

Jack serializes CombatClass `Jackbot` and CharacterHero `SpecialHero_Jack`; display labels map these to Jack without changing raw identity. The full corpus ranges from 437 to 1647 objects and 2 to 23 character records. One Classic early slot 1 has a non-finite Accuracy float. The editor rejects writes to that file while preserving read-only inspection and exact round-trip bytes. See `sample-report.jsonl` for hashes, counts, slot counts and per-file diagnostics.
