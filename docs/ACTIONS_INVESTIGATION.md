# Actions discrepancy: Mikayla and Gabe

Status: Actions editing removed at the user's request on 2026-09-24. The value remains visible read only; the patch writer rejects `ActionPoints` edits. In-game behavior remains unresolved. Do not describe this as a confirmed character swap or a confirmed turn-start refresh.

## Evidence

The user supplied a post-load save and a turn-2 photograph showing Gabe at 4 actions and Mikayla at 3. The supplied save is 698,419 bytes, SHA-256 `88cea1e528e480ecc081aae60ec61680d6f8ed6174340aaed2fcb95860a5271e`. Its `GameState` is `ConvoyMeta`, mission `Mission1_5`; its root classes are `GanderMetaInfo` and `GanderGame_Meta_BP_C`. The current parser exposes campaign character values, not a decoded live combat action counter.

| Identity                        | Object index | Squad slot | ActionPoints payload offset | Saved value       | OriginalHealth / ModifiedHealth |
| ------------------------------- | ------------ | ---------- | --------------------------- | ----------------- | ------------------------------- |
| Gabriel / Gabe Diaz / Medic     | 50           | 0          | 348720                      | 3 (`03 00 00 00`) | 520 / 520                       |
| Mikayla / Mikayla Dorn / Sniper | 577          | 2          | 394222                      | 4 (`04 00 00 00`) | 1015 / 1015                     |

The photograph's health values agree with these identities. The character records also independently identify the expected hero, class, pawn-effort asset and unit type. Decoding `SquadInfo.Squads[0].Members` yields indices `[50, 432, 577, 466, 520]` (Gabe, Sid, Mikayla, Heavy, Jack), matching the saved `SquadSlotId` values. No swapped character or squad references were found.

The renderer keys drafts by object index and property name. The main process carries that identity through patch generation to the selected object's property payload. An Electron regression now selects Mikayla, edits Actions to 4, switches to Gabe, applies and saves while Gabe is selected, and verifies that only Mikayla's four-byte payload changes. Gabe remains at 3, the review names Mikayla, and the backup matches the pre-edit bytes. This passed using the existing end-game fixture and temporary files. It verifies editor ownership, not in-game interpretation.

The user reports that Gabe's chest passive is not Blitz. Its exact passive has not been supplied. Native equipment references include inventory GUIDs, but their complete mapping to item definitions and combat effects is not implemented; no specific equipment effect has been established as the cause. Gabe has Empower III and Teamwork equipped, but their presence does not establish that either was active in the photographed state.

The investigation did not alter the user's save. The original turn-refresh explanation was withdrawn because the photograph itself is from turn 2. Following the investigation, `ActionPoints` was removed from the editable allowlist. The desktop regression now verifies Actions has no input and uses Health to exercise cross-character draft ownership.

## Controlled test copies

Before editing was disabled, two extensionless diagnostic files were generated independently from the supplied save under the ignored `artifacts/actions-diagnosis` directory. Each differs from the source by exactly one byte, at Mikayla's ActionPoints payload. Both passed the then-current structural and preservation checks. The user subsequently reported that setting Mikayla back to 3 also returned Gabe to 3 in-game. This is evidence that the change affects Gabe in that scenario despite the stored character identities. It does not identify the game's underlying rule. The 6-point variant was not tested; further testing was superseded by the request to remove editing.

| Copy                                 | Gabe saved Actions | Mikayla saved Actions | Purpose                                                                              |
| ------------------------------------ | ------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| `mikayla-3/GearGameSaveGame_Slot_41` | 3                  | 3                     | Remove Mikayla's extra saved action to test whether Gabe still gets 4                |
| `mikayla-6/GearGameSaveGame_Slot_41` | 3                  | 6                     | Use a distinctive value to identify which displayed count, if any, follows the field |

Compare the same mission and comparable actions, recording counts before actions on turns 1 and 2. If Gabe retains 4 with Mikayla saved at 3, her extra saved point is not necessary for his extra point. If neither displayed count tracks the change from 3 to 6, investigate other combat initialization/state/effect data before presenting this field as a verified per-turn action allowance. These outcomes would narrow the cause, not prove a specific one.

Hashes and exact differences are recorded in `artifacts/actions-diagnosis/report.json`. These are diagnostic copies, not fixes.
