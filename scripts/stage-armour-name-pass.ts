/**
 * Stages one save for an in-game armour naming pass: equips one member of every
 * not-yet-named armour family onto visible squad members so the loadout screen
 * reveals each family's display name. Run:
 *
 *   node --import tsx scripts/stage-armour-name-pass.ts [sourceSave] [destination] [families]
 *
 * Defaults stage all unnamed families onto the probe save. The game only displays
 * an equipped piece it considers owned, so members with no stock are granted
 * quantity 1 in the same pass (4-byte inventory patches). Prefer a source save
 * written by the game on the target machine: the Steam Cloud has been observed
 * to drop manually copied files mid-sync, and foreign saves may be ignored.
 * Copy the output into the game's Steam remote folder under a free slot (with
 * the game and Steam closed), load it, and screenshot the loadout screens of
 * the characters listed in the manifest.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse, serialize } from '../src/save-format';
import { armourCatalog, cachedEquipmentEntries } from '../src/save-format/NativeSoldier';
import { EditingSession } from '../src/main/EditingSession';
import { defaultLimits } from '../src/save-format/SavePatcher';
import { armourFamilyName } from '../src/shared/armour-names';

const [sourceArg, destinationArg, familiesArg] = process.argv.slice(2);
const source = sourceArg ?? 'artifacts/armour-probe/GearGameSaveGame_Slot_41.current';
const destination = destinationArg ?? 'artifacts/name-pass/GearGameSaveGame_Slot_41';

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
const FAMILIES = familiesArg ? familiesArg.split(',') : [...UNKNOWN_FAMILIES];
/** Kinds observed for these families in other saves (5 = helmet, 1 = upper, 2 = lower). */
const KNOWN_KIND: Record<string, number | undefined> = {
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

/** One equippable member per family: highest stock, skipping the Default tier of a
 *  six-member family when nothing is owned (a blueprint pseudo-tier may not render a name). */
function pickMember(prefix: string): { guid: string; quantity: number } {
  const members = [...catalog.definitions.values()]
    .filter((d) => d.guid.startsWith(prefix))
    .sort(
      (a, b) =>
        (b.quantity ?? 0) - (a.quantity ?? 0) ||
        parseInt(a.guid.slice(24, 26), 16) - parseInt(b.guid.slice(24, 26), 16),
    );
  if (members.length === 0) throw new Error(`no catalog member for family ${prefix}`);
  if (!members.some((m) => (m.quantity ?? 0) > 0) && members.length === 6) {
    const common = members[1]!;
    return { guid: common.guid, quantity: 0 };
  }
  return { guid: members[0]!.guid, quantity: members[0]!.quantity ?? 0 };
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

const edits: { objectIndex: number; propertyName: string; value: number | string }[] = [];
const manifest: {
  name: string;
  slot: number;
  prefix: string;
  guid: string;
  from: string;
  granted: boolean;
}[] = [];
for (const prefix of FAMILIES) {
  const { guid, quantity } = pickMember(prefix);
  if (armourFamilyName(guid)) continue; // already calibrated
  const kind = KNOWN_KIND[prefix];
  const candidates = slots
    .filter((s) => !s.current.startsWith(prefix))
    .filter((s) => (kind === undefined ? s.slot > 0 : s.kind === kind))
    .sort((a, b) => a.assigned - b.assigned);
  const target = candidates[0];
  if (!target) throw new Error(`no free slot for family ${prefix}`);
  target.assigned++;
  const granted = quantity < 1;
  if (granted) edits.push({ objectIndex: -1, propertyName: `ArmourStock:${guid}`, value: 1 });
  edits.push({
    objectIndex: target.objectIndex,
    propertyName: `ArmourSlot:${target.slot}`,
    value: guid,
  });
  manifest.push({
    name: target.name,
    slot: target.slot,
    prefix,
    guid,
    from: target.current,
    granted,
  });
}

const session = new EditingSession(source, save, defaultLimits);
session.enable();
session.apply(session.revision, edits);
const output = session.output();

// Verify: the only changed bytes are those inside the applied patch windows.
const original = serialize(save);
const changed = new Set<number>();
for (let i = 0; i < original.length; i++) if (original[i] !== output[i]) changed.add(i);
const windowBytes = new Set<number>();
let expected = 0;
for (const patch of session.patches)
  for (let i = 0; i < patch.newBytes.length; i++) {
    windowBytes.add(patch.offset + i);
    if (patch.newBytes[i] !== original[patch.offset + i]) expected++;
  }
if (changed.size !== expected || [...changed].some((pos) => !windowBytes.has(pos)))
  throw new Error(`expected ${expected} changed bytes inside patch windows, got ${changed.size}`);
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
    `  ${row.name.padEnd(14)} slot ${row.slot}  <-  ${row.prefix} (${armourFamilyName(row.guid) ?? 'unknown'})${row.granted ? ' [stock granted]' : ''}  was ${armourFamilyName(row.from) ?? row.from.slice(0, 8)}`,
  );
