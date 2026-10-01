import { parse, serialize, type GearsTacticsSave } from './index';
import {
  armourCatalog,
  assignedSoldiers,
  cachedEquipmentEntries,
  equipmentSlotRecords,
  readEquipmentEntries,
  readNativeRoster,
} from './NativeSoldier';
import { readArchiveGraph, writeArchiveGraph, type GraphNode } from './GraphArchive';

/** Kind byte written per slot position: 5 = helmet, 1 = upper, 2 = lower (slot 3 is internal). */
export const SLOT_KINDS = [5, 1, 2] as const;
const TERMINATOR = Buffer.from('050000004e6f6e650000000000', 'hex');

export interface EquipIntoEmptyResult {
  bytes: Buffer;
  save: GearsTacticsSave;
  /** Old → new object indices after the rebuild; downstream edits must rebase through it. */
  indices: Map<number, number>;
  /** The equipped character's object index in the rebuilt save. */
  objectIndex: number;
}

/**
 * Equips an armour piece into an EMPTY native equipment slot. Empty entries are 4-byte
 * present-flag stubs, so this inserts 21 bytes (GUID + kind + record flag) into the
 * character's suffix — a variable-length structural edit rebuilt through the relocatable
 * graph writer, unlike the fixed-width GUID swaps of occupied slots.
 *
 * The piece comes from this save's armour inventory; the written kind follows the slot
 * position and the record flag follows squad membership (1 assigned, 0 reserve), matching
 * what the game itself writes. Every other character's equipment is verified unchanged.
 */
export function equipIntoEmptySlot(
  save: GearsTacticsSave,
  objectIndex: number,
  slot: number,
  guid: string,
): EquipIntoEmptyResult {
  if (slot < 0 || slot > 2) throw new Error(`Slot ${slot} cannot be equipped into`);
  if (!/^[0-9a-f]{32}$/.test(guid)) throw new Error('Invalid armour GUID');
  const object = save.objects[objectIndex];
  if (!object?.classPath.endsWith('.GanderCharacterData'))
    throw new Error('Armour edits require a character object');
  const records = equipmentSlotRecords(save, objectIndex);
  if (records[slot]?.entry) throw new Error(`Armour slot ${slot} is already equipped`);
  const catalog = armourCatalog(save);
  if (!catalog.definitions.has(guid))
    throw new Error('The selected armour piece does not exist in this save');
  const kind = SLOT_KINDS[slot]!;
  const flag = assignedSoldiers(save).has(objectIndex) ? 1 : 0;

  const serialized = serialize(save);
  const regionStart = records[0]!.presentOffset - TERMINATOR.length;
  if (!serialized.subarray(regionStart, records[0]!.presentOffset).equals(TERMINATOR))
    throw new Error('Unexpected character suffix layout');
  const region = serialized.subarray(regionStart, records[slot]!.presentOffset + 4);

  const graph = readArchiveGraph(save);
  const graphObject = graph.objects.get(objectIndex);
  if (!graphObject) throw new Error('Character missing from the archive graph');
  const hits: { node: { kind: 'bytes'; bytes: Buffer }; at: number }[] = [];
  function search(nodes: GraphNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'bytes') {
        const at = node.bytes.indexOf(region);
        if (at !== -1) hits.push({ node, at });
      } else if (node.kind === 'property') search(node.payload);
      else if (node.kind === 'root') search(node.body);
    }
  }
  search(graphObject.body);
  if (hits.length !== 1)
    throw new Error(
      hits.length === 0
        ? 'Character suffix not found in the archive graph'
        : 'Ambiguous character suffix match',
    );
  const { node, at } = hits[0]!;
  node.bytes = Buffer.concat([
    node.bytes.subarray(0, at),
    region.subarray(0, region.length - 4),
    Buffer.from([1, 0, 0, 0]),
    Buffer.from(guid, 'hex'),
    Buffer.from([kind]),
    Buffer.from([flag, 0, 0, 0]),
    node.bytes.subarray(at + region.length),
  ]);

  const rebuilt = writeArchiveGraph(graph);
  const remapped = rebuilt.indices.get(objectIndex);
  if (remapped === undefined) throw new Error('Character lost during rebuild');
  const reparsed = parse(rebuilt.bytes);
  if (!reparsed.canSave) throw new Error('Rebuilt save failed structural validation');
  const entry = readEquipmentEntries(reparsed, remapped)[slot];
  if (!entry || entry.guid !== guid || entry.kind !== kind || entry.flag !== flag)
    throw new Error('Equipped entry failed to decode');
  for (const character of save.characters) {
    const index = rebuilt.indices.get(character.objectIndex);
    if (index === undefined) throw new Error('Character lost during rebuild');
    if (character.objectIndex === objectIndex) continue;
    const before = cachedEquipmentEntries(save, character.objectIndex).map((e) => e?.guid ?? null);
    const after = cachedEquipmentEntries(reparsed, index).map((e) => e?.guid ?? null);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Another character’s equipment changed during the rebuild');
  }
  readNativeRoster(reparsed);
  return { bytes: rebuilt.bytes, save: reparsed, indices: rebuilt.indices, objectIndex: remapped };
}
