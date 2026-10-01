/**
 * Prototype: equip a helmet into Gabe Diaz's EMPTY helmet slot (slot 0), which is a
 * 4-byte present-flag stub in the native suffix. Filling it inserts 21 bytes
 * (GUID + kind + record flag), shifting the rest of his suffix — a structural edit
 * routed through the relocatable graph writer, not the fixed-width patcher.
 *
 *   node --import tsx scripts/stage-empty-slot-test.ts
 *
 * Writes artifacts/name-pass/GearGameSaveGame_Slot_41 (overwrites the naming-pass
 * staging target) plus slot41-helmet-test.zip. Game-test via the usual
 * overwrite-Slot-41 flow; Gabe should show a helmet on his loadout screen.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse, serialize } from '../src/save-format';
import {
  readEquipmentEntries,
  readInventoryDefinitions,
  armourCatalog,
  readNativeRoster,
} from '../src/save-format/NativeSoldier';
import {
  readArchiveGraph,
  writeArchiveGraph,
  type GraphNode,
} from '../src/save-format/GraphArchive';
import { createPatches, applyPatches } from '../src/save-format/SavePatcher';
import { armourFamilyName } from '../src/shared/armour-names';

const source = 'artifacts/recovery-latest/remote/GearGameSaveGame_Slot_41';
const destination = 'artifacts/name-pass/GearGameSaveGame_Slot_41';

const bytes = await readFile(source);
const save = parse(bytes);
const gabe = save.characters.find((c) => c.displayName === 'Gabe Diaz');
if (!gabe) throw new Error('Gabe Diaz not found');
const before = readEquipmentEntries(save, gabe.objectIndex);
if (before[0] !== null) throw new Error('Gabe slot 0 is not empty — nothing to insert');
if (!before[1] || !before[2]) throw new Error('Unexpected: Gabe upper/lower not both present');
console.log(
  'Gabe before:',
  before
    .map((e) =>
      e ? `${armourFamilyName(e.guid) ?? e.guid.slice(0, 8)}(k${e.kind},f${e.flag})` : 'empty',
    )
    .join(' | '),
);

// Helmet member: highest owned stock in this save, else lowest counter (stock granted later).
const catalog = armourCatalog(save);
const helmetMembers = [...catalog.definitions.values()]
  .filter((d) => d.category === 'armour' && catalog.kindOf.get(d.guid) === 5)
  .sort(
    (a, b) =>
      (b.quantity ?? 0) - (a.quantity ?? 0) ||
      parseInt(a.guid.slice(24, 26), 16) - parseInt(b.guid.slice(24, 26), 16),
  );
const helmet = helmetMembers[0]!;
if (!helmet) throw new Error('no helmet definitions in this save');
console.log(
  `helmet: ${helmet.guid.slice(0, 8)} (${armourFamilyName(helmet.guid)}, stock ${helmet.quantity})`,
);

// Locate Gabe's suffix inside the graph: the terminator followed by his empty slot-0 flag
// and occupied slot-1 header is unique to this character.
const pattern = Buffer.concat([
  Buffer.from('050000004e6f6e650000000000', 'hex'),
  Buffer.from([0, 0, 0, 0]), // slot 0 present = 0
  Buffer.from([1, 0, 0, 0]), // slot 1 present = 1
  Buffer.from(before[1]!.guid, 'hex'),
]);
const graph = readArchiveGraph(save);
const gabeObject = graph.objects.get(gabe.objectIndex);
if (!gabeObject) throw new Error('Gabe missing from the archive graph');
let hits: { node: { kind: 'bytes'; bytes: Buffer }; at: number }[] = [];
function search(nodes: GraphNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'bytes') {
      const at = node.bytes.indexOf(pattern);
      if (at !== -1) hits.push({ node, at });
    } else if (node.kind === 'property') search(node.payload);
    else if (node.kind === 'root') search(node.body);
  }
}
search(gabeObject.body);
if (hits.length !== 1) throw new Error(`expected exactly one suffix match, found ${hits.length}`);
const { node, at } = hits[0]!;
const insertion = at + 13; // pattern = 13-byte terminator, then the empty slot's 4-byte present flag
// Replace the 4-byte empty stub with a full 25-byte entry: present=1, helmet GUID, kind 5, flag 1.
node.bytes = Buffer.concat([
  node.bytes.subarray(0, insertion),
  Buffer.from([1, 0, 0, 0]),
  Buffer.from(helmet.guid, 'hex'),
  Buffer.from([5]),
  Buffer.from([1, 0, 0, 0]),
  node.bytes.subarray(insertion + 4),
]);

const rebuilt = writeArchiveGraph(graph);
const remap = (index: number): number => {
  const mapped = rebuilt.indices.get(index);
  if (mapped === undefined) throw new Error(`object ${index} missing from rebuild index map`);
  return mapped;
};
const output0 = rebuilt.bytes;
console.log(
  `rebuilt: ${bytes.length} -> ${output0.length} bytes (delta ${output0.length - bytes.length}, expected +21)`,
);

// Validation pass 1: the rebuilt save must fully decode with the helmet entry present.
const reparsed = parse(output0);
if (!reparsed.canSave) {
  for (const w of reparsed.warnings.filter((w) => w.blocksSaving))
    console.log('blocking:', w.message);
  throw new Error('rebuilt save is not savable');
}
const gabeIndex = remap(gabe.objectIndex);
const after = readEquipmentEntries(reparsed, gabeIndex);
if (!after[0] || after[0].guid !== helmet.guid || after[0].kind !== 5 || after[0].flag !== 1)
  throw new Error('helmet entry did not decode as inserted');
if (after[1]?.guid !== before[1]!.guid || after[2]?.guid !== before[2]!.guid)
  throw new Error('existing entries moved');
let unchanged = 0;
for (const character of save.characters) {
  if (character.objectIndex === gabe.objectIndex) continue;
  const a = readEquipmentEntries(save, character.objectIndex).map((e) => e?.guid ?? null);
  const b = readEquipmentEntries(reparsed, remap(character.objectIndex)).map(
    (e) => e?.guid ?? null,
  );
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`entries changed for #${character.objectIndex}`);
  unchanged++;
}
readNativeRoster(reparsed);
console.log(
  `decode check: helmet present, ${unchanged} other characters byte-identical, roster intact`,
);

// The game only displays owned pieces, so grant stock for the helmet when needed.
let output = output0;
if ((helmet.quantity ?? 0) < 1) {
  output = applyPatches(
    reparsed,
    createPatches(reparsed, [
      { objectIndex: gabeIndex, propertyName: `ArmourStock:${helmet.guid}`, value: 1 },
    ]),
  );
  const granted = readInventoryDefinitions(parse(output)).find((d) => d.guid === helmet.guid);
  if (granted?.quantity !== 1) throw new Error('stock grant failed to reparse');
  console.log('stock granted: 1');
}

// Validation pass 2: strict round trip.
if (!serialize(parse(output)).equals(output)) throw new Error('final bytes do not round trip');

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, output);
console.log(`staged -> ${destination} (${output.length} bytes)`);
console.log(`fingerprint: ${(await readFile(destination)).length} bytes`);
