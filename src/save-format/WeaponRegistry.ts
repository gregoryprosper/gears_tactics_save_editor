import { BinaryReader } from './BinaryReader';
import { readFrame } from './ObjectArchive';
import { readPropertyList } from './PropertyParser';
import { serialize } from './index';
import type { GearsTacticsSave } from './types';
import type { GraphNode } from './GraphArchive';
import { integerBytes } from './GraphArchive';

export interface WeaponRegistration {
  kind: number;
  flag: number;
  level: number;
  objectIndex: number;
}
export interface WeaponRegistry {
  objectIndex: number;
  context: number[];
  cosmetics: { kind: number; objectIndex: number }[];
  // Primary, secondary, two grenade lists, and recruitment-pool weapons.
  groups: WeaponRegistration[][];
  inventories: number[];
}

/** WeaponData properties omit weapon type and level; the meta inventory supplies them. */
export function readWeaponRegistry(save: GearsTacticsSave): WeaponRegistry {
  const matches = save.objects.filter((o) => /GanderMetaInventory_/.test(o.classPath));
  if (matches.length !== 1 || !matches[0]!.body)
    throw new Error('Ambiguous native weapon registry');
  const object = matches[0]!,
    frame = object.body!;
  const r = new BinaryReader(serialize(save), frame.bodyOffset, frame.endOffset);
  readPropertyList(r);
  if (r.i32() !== 0) r.fail('Unsupported weapon registry GUID');
  const ref = (): number => {
    const index = readFrame(r, frame.rootBase, save.objects.length)?.index;
    if (index === undefined || index < 0) r.fail('Missing weapon registry reference');
    return index!;
  };
  const context = [ref(), ref()];
  const cosmetics = Array.from({ length: r.count(100) }, () => ({
    kind: r.u8(),
    objectIndex: ref(),
  }));
  if (new Set(cosmetics.map((c) => c.kind)).size !== cosmetics.length)
    r.fail('Duplicate cosmetic registry key');
  const groups = Array.from({ length: 5 }, () => {
    const entries = Array.from({ length: r.count(1000) }, () => {
      const kind = r.u8(),
        flag = r.u8(),
        level = r.i32(),
        objectIndex = ref();
      if (
        flag !== 1 ||
        level < 1 ||
        level > 100 ||
        save.objects[objectIndex]?.classPath !== '/Script/GanderGame.WeaponData'
      )
        r.fail('Unsupported weapon registration');
      return { kind, flag, level, objectIndex };
    });
    if (new Set(entries.map((e) => e.objectIndex)).size !== entries.length)
      r.fail('Duplicate weapon registration');
    return entries;
  });
  const inventories = [ref(), ref()];
  if (
    !save.objects[inventories[0]!]?.classPath.endsWith('.GanderWeaponModMetaInventory') ||
    !save.objects[inventories[1]!]?.classPath.endsWith('.GanderArmourMetaInventory') ||
    r.offset !== r.end
  )
    r.fail('Unsupported weapon registry tail');
  const definitions = new Map<number, string>();
  for (const entry of groups.flat()) {
    const value = JSON.stringify([entry.kind, entry.flag, entry.level]);
    if (definitions.has(entry.objectIndex) && definitions.get(entry.objectIndex) !== value)
      r.fail('Conflicting weapon registration metadata');
    definitions.set(entry.objectIndex, value);
  }
  // Both grenade lists must expose the same definitions, including unequipped alternatives.
  if (JSON.stringify(groups[2]) !== JSON.stringify(groups[3]))
    r.fail('Unsupported divergent grenade registries');
  return { objectIndex: object.index, context, cosmetics, groups, inventories };
}

/** Rebuild only the decoded native suffix; preserve every tagged inventory property. */
export function writeWeaponRegistry(body: GraphNode[], registry: WeaponRegistry): GraphNode[] {
  let start = 0;
  while (body[start]?.kind === 'property') start++;
  const end = body[start];
  if (end?.kind !== 'bytes' || !end.bytes.equals(Buffer.from('050000004e6f6e650000000000', 'hex')))
    throw new Error('Unsupported weapon registry terminator');
  const ref = (index: number): GraphNode => ({ kind: 'reference', index });
  const bytes = (bytes: Buffer): GraphNode => ({ kind: 'bytes', bytes });
  const result: GraphNode[] = [
    ...body.slice(0, start + 1),
    ...registry.context.map(ref),
    bytes(integerBytes(registry.cosmetics.length)),
  ];
  for (const entry of registry.cosmetics)
    result.push(bytes(Buffer.from([entry.kind])), ref(entry.objectIndex));
  for (const group of registry.groups) {
    result.push(bytes(integerBytes(group.length)));
    for (const entry of group)
      result.push(
        bytes(Buffer.concat([Buffer.from([entry.kind, entry.flag]), integerBytes(entry.level)])),
        ref(entry.objectIndex),
      );
  }
  result.push(...registry.inventories.map(ref));
  return result;
}
