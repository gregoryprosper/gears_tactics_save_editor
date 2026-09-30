/**
 * Stages one save for an in-game armour naming pass: equips one member of every
 * not-yet-named armour family onto visible squad members so the loadout screen
 * reveals each family's display name. Run:
 *
 *   node --import tsx scripts/stage-armour-name-pass.ts
 *
 * Reads the probe save, writes artifacts/name-pass/GearGameSaveGame_Slot_41.
 * Copy that file into the game's Steam remote folder under a free slot, load it,
 * and screenshot the loadout screens of the characters listed in the manifest.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse, serialize } from '../src/save-format';
import { armourCatalog, cachedEquipmentEntries } from '../src/save-format/NativeSoldier';
import { EditingSession } from '../src/main/EditingSession';
import { defaultLimits } from '../src/save-format/SavePatcher';
import { armourFamilyName } from '../src/shared/armour-names';

const source = 'artifacts/armour-probe/GearGameSaveGame_Slot_41.current';
const destination = 'artifacts/name-pass/GearGameSaveGame_Slot_41';

/** Family prefixes (first 4 GUID bytes) without a calibrated name. */
const UNKNOWN_FAMILIES = [
  '02881eb3',
  '2da71cd8',
  'bd224847',
  'ecd7b27c',
  '25e914a1',
  '8a6f7eca',
  'b002dc0d',
  '0b99c229',
  'a8c5c01c',
  '960cbdfb',
  '910d368d',
  '5e1c9c39',
  '34645318',
  '63a5d43a',
  '4c830e9e',
  '9c56c096',
] as const;
/** Kinds observed for these families in other saves (5 = helmet, 1 = upper, 2 = lower). */
const KNOWN_KIND: Partial<Record<(typeof UNKNOWN_FAMILIES)[number], number>> = {
  ecd7b27c: 5,
  '2da71cd8': 1,
  b002dc0d: 1,
  '02881eb3': 2,
  '8a6f7eca': 2,
  bd224847: 2,
  '0b99c229': 2,
  '910d368d': 2,
  a8c5c01c: 2,
};

const bytes = await readFile(source);
const save = parse(bytes);
if (!save.canSave) throw new Error('source save is not editable');
const catalog = armourCatalog(save);

function pickMember(prefix: string): string {
  const members = [...catalog.definitions.values()]
    .filter((d) => d.guid.startsWith(prefix))
    .sort(
      (a, b) =>
        (b.quantity ?? 0) - (a.quantity ?? 0) ||
        parseInt(a.guid.slice(24, 26), 16) - parseInt(b.guid.slice(24, 26), 16),
    );
  if (members.length === 0) throw new Error(`no catalog member for family ${prefix}`);
  return members[0]!.guid;
}

const slots = save.characters
  .filter((c) => !/jack|DefaultCharacter/i.test(c.displayName ?? ''))
  .flatMap((c) => {
    const entries = cachedEquipmentEntries(save, c.objectIndex);
    return entries
      .map((entry, slot) => ({ character: c, slot, entry }))
      .filter(({ entry, slot }) => entry !== null && slot < 3)
      .map(({ character, slot, entry }) => ({
        objectIndex: character.objectIndex,
        name: character.displayName ?? `#${character.objectIndex}`,
        slot,
        kind: entry!.kind,
        current: entry!.guid,
        assigned: 0,
      }));
  });

const edits: { objectIndex: number; propertyName: string; value: string }[] = [];
const manifest: { name: string; slot: number; prefix: string; guid: string; from: string }[] = [];
for (const prefix of UNKNOWN_FAMILIES) {
  const guid = pickMember(prefix);
  const kind = KNOWN_KIND[prefix];
  const candidates = slots
    .filter((s) => !s.current.startsWith(prefix))
    .filter((s) => (kind === undefined ? s.slot > 0 : s.kind === kind))
    .sort((a, b) => a.assigned - b.assigned);
  const target = candidates[0];
  if (!target) throw new Error(`no free slot for family ${prefix}`);
  target.assigned++;
  edits.push({
    objectIndex: target.objectIndex,
    propertyName: `ArmourSlot:${target.slot}`,
    value: guid,
  });
  manifest.push({ name: target.name, slot: target.slot, prefix, guid, from: target.current });
}

const session = new EditingSession(source, save, defaultLimits);
session.enable();
session.apply(session.revision, edits);
const output = session.output();

// Verify: exactly 16 sixteen-byte windows differ from the original.
const original = serialize(save);
const changed = new Set<number>();
for (let i = 0; i < original.length; i++) if (original[i] !== output[i]) changed.add(i);
if (changed.size !== 16 * edits.length)
  throw new Error(`expected ${16 * edits.length} changed bytes, got ${changed.size}`);
const reparsed = parse(output);
for (const row of manifest) {
  const character = reparsed.characters.find((c) => c.displayName === row.name);
  if (!character) continue;
  const entry = cachedEquipmentEntries(reparsed, character.objectIndex)[row.slot];
  if (entry?.guid !== row.guid) throw new Error(`reparse mismatch on ${row.name} slot ${row.slot}`);
}

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, output);
console.log(`staged ${edits.length} pieces -> ${destination} (${output.length} bytes)`);
console.log('\nScreenshot manifest (loadout screens to capture in game):');
for (const row of manifest)
  console.log(
    `  ${row.name.padEnd(14)} slot ${row.slot}  <-  ${row.prefix} (${armourFamilyName(row.guid) ?? 'unknown'})  was ${armourFamilyName(row.from) ?? row.from.slice(0, 8)}`,
  );
