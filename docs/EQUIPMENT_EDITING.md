# In-place armour editing

**Desktop armour editing is enabled under standard editing (no experimental gate) and is byte-verified but NOT yet game-tested.** Test one copy at a time with the game closed and retain the working original, exactly as documented for [soldier transfer](SOLDIER_TRANSFER.md#user-game-test-missing-weapons-2026-09-25). Report the results of the checklist at the bottom before treating armour edits as game-safe.

## What the feature does

On **Soldiers → Equipment**, each soldier shows its four native equipment entries. A slot whose piece resolves against the save's `GanderArmourMetaInventory` offers a replacement from every piece that is provably correct for that slot in this save. Applying stages a regular undoable patch — it appears in Pending changes next to scalar edits, saves through the same verified non-structural atomic path, and produces backups.

Empty entries and the fourth slot's internal records stay read only. Inventory quantities are never adjusted, matching the soldier-import precedent.

## Native layout

Each `.GanderCharacterData` body serializes as: framed campaign reference, framed meta-inventory reference, one tagged property list, then the native suffix. Directly after the property terminator (`050000004e6f6e650000000000` — the `None` FString plus a zero GUID-presence flag) come four equipment entries, each:

| Field        | Width    | Notes                                                           |
| ------------ | -------- | --------------------------------------------------------------- |
| present flag | int32    | 0 = absent (entry is just this field), 1 = record follows       |
| GUID         | 16 bytes | Catalog identity resolved against the armour meta inventory     |
| kind         | uint8    | Slot type: 5 on the first entry, 1 second, 2 third, 3 fourth    |
| record flag  | int32    | Observed 1 on squad soldiers, 0 on reserves and the fourth slot |

`readEquipmentEntries` (`src/save-format/NativeSoldier.ts`) decodes the complete suffix with absolute byte offsets — weapons, weapon mods, skill tree, card slots and unit references included — so recorded offsets cannot describe a misaligned layout. The observed character suffix matches `readNativeSoldier`, which the transfer path consumes.

Weapon registrations (`WeaponRegistry`) are unrelated to these entries; weapon identity lives in the meta inventory, armour identity lives in the character suffix plus the armour inventory.

## Empirical findings (15 supplied fixtures, 195 characters, 0 decode failures)

- **GUIDs partition cleanly by kind.** Across 82 distinct equipped GUIDs, no GUID ever appears with two kind bytes. Kind tracks the entry position: 5, 1, 2, 3 for entries 0–3.
- **The fourth entry is an internal record.** Every observed fourth entry carries a GUID that is absent from the armour inventory (and every inventory, per `readInventoryDefinitions`), with record flag 0. These slots are displayed read only.
- **Reserves carry real armour records.** Unassigned recruits show the same kinds with record flag 0; swapping their GUIDs is byte-equivalent to swapping squad soldiers'.
- **Quantities are account-wide stock.** Endgame saves hold ~100 stock of commonly equipped pieces while multiple soldiers equip the same GUID; equipping does not visibly decrement the armour inventory. The editor therefore does not adjust quantities when swapping.
- **`linkedGuid` is zero for armour definitions**, so a piece's kind cannot be derived from the inventory alone.

## Validation rules for a swap

`createPatches` accepts the property name `ArmourSlot:0`–`ArmourSlot:3` on `.GanderCharacterData` objects with a string GUID value and rewrites exactly the 16 GUID bytes at the recorded offset. A swap is accepted only when:

1. the target entry exists (present flag 1);
2. the value is a 32-character hex GUID matching exactly one `armour` category definition in this save (`readInventoryDefinitions`);
3. the GUID carries a **same-kind precedent** on some character equipment entry in this save (`armourCatalog.kindOf`). Because a definition's kind is otherwise unknowable, every offered replacement has been observed in the correct slot type of the very save being edited — unobserved definitions are excluded rather than guessed.

The kind, record flag, present flag and all other bytes are preserved; output length is unchanged, so armour edits flow through the fixed-width patch pipeline (`applyPatches` re-derives each patch, verifies provenance, checks byte windows, and reparses the output with a structural fingerprint comparison). The patcher generalized from 4-byte to arbitrary fixed-width patches for this; variable-length and reference-rewriting operations still require the structural transaction path per [ARCHITECTURE.md](ARCHITECTURE.md).

## UI behaviour

- Options are sorted by stock quantity, then GUID. Pieces display as their short GUID (`F8AC6FCA…`); developer mode adds kind, record flag and hex diffs in Pending changes.
- Drafts are keyed `equip:{objectIndex}:{slot}` and auto-clear when reselecting the current (staged) piece. Export/import transfers stay blocked while any draft exists, as with scalar drafts.

## Display names: calibrated from the running game (2026-09-30)

Offline derivation is impossible (the negative results below still hold: no names in the save, no GUID constants in 40.6 GB of decompressed game data, no hash derivation, no localization table for equipment). The names were obtained by **observing the running game** through the sibling project's probe package (`mod/armour-name-probe/`): a fresh campaign on the patched B2 pair plus live screen reading over VNC.

**GUID structure (the decisive discovery):** the 128 armour definitions form **34 families** — one family per piece, members = rarity tiers sharing a 12-byte GUID base with a counter byte. Five-member families ascend Common → Uncommon → Rare → Epic → Legendary; six-member families carry a **Default** (blueprint) tier first; singletons are hero-unique pieces. Verified against in-game owned counts (e.g. UIR Regulator Common = 4 stock in both the list and the save).

**Calibrated names** (family prefix → display name) live in `src/shared/armour-names.ts`: UIR Regulator, Commando Vest, Veteran Armor, Trooper Armor, Cadet Chest Plate, Onyx Shell, Ranger Kit, Delta Kit, Regulation Armor (uppers); Trooper Boots, Delta Straps, Cadet Shin Guards, Ranger Treads, Hunter Braces, Commando Knee Pads (lowers); Onyx Helmet, Onyx Retro Helmet, Trooper Helmet (helmets). The Equipment tab and Pending changes render these with derived rarity; unknown families fall back to short GUIDs.

**Still unnamed:** six tiered families not worn in the probed campaign (`02881eb3`, `2da71cd8`, `bd224847`, `ecd7b27c`, `25e914a1`, `8a6f7eca` — likely Destroyer-set and other later pieces) and ten hero-unique singletons. Naming them is a repeat of the same harness: open the wearing soldier's armour screen in-game and match the equipped name to the save GUID.

## Verification performed

- Corpus: every character of every supplied save decodes with offset-accurate GUID windows (`tests/armour-editing.test.ts`).
- Patches: a swap changes exactly 16 bytes; reparse shows the new GUID with kind/flag preserved; undo/redo restore; mixed scalar + armour batches save atomically with a verified backup.
- Rejections: cross-kind GUIDs, unknown GUIDs, malformed values, empty slots, non-character objects, duplicate edits and tampered provenance.

## Not yet tested in game

Checklist for the first game test (one edit at a time on a copy):

1. Save loads; soldier list intact.
2. Edited soldier shows the replacement piece visually in the armour screen.
3. Piece stats apply in combat (defence/tier effects consistent with the piece).
4. Save and reload inside the game keep the piece.
5. Unrelated soldiers, their armour and campaign progress are unchanged.
6. A swap on a reserve (record flag 0) entry behaves consistently with squad soldiers.

If the game rejects or misrenders a swap, capture the save and the observed behaviour; the likely suspects are the same-kind precedent rule (try restricting options further) and the record flag semantics.
