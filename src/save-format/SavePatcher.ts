import { parse, serialize } from './index';
import type { GearsTacticsSave, UnrealProperty } from './types';
import type { EditRequest } from '../shared/api';
export interface SavePatch {
  objectIndex: number;
  propertyName: string;
  description: string;
  offset: number;
  oldBytes: Buffer;
  newBytes: Buffer;
  oldValue: number;
  newValue: number;
}
export interface EditLimits {
  abilityPointsMaximum: number;
}
export const defaultLimits: EditLimits = { abilityPointsMaximum: 2147483647 };
const integers = new Set(['CurrentAbilityPoints', 'Health', 'Strength', 'MovementPoints']);
export function editableProperties(
  save: GearsTacticsSave,
): { objectIndex: number; property: UnrealProperty }[] {
  const result: { objectIndex: number; property: UnrealProperty }[] = [];
  for (const object of save.objects)
    for (const p of object.properties) {
      const character = object.classPath.endsWith('.GanderCharacterData');
      const roster = object.index === save.campaign.rosterObjectIndex;
      const supported =
        (character &&
          ((integers.has(p.name) && p.type === 'IntProperty') ||
            (p.name === 'Accuracy' && p.type === 'FloatProperty'))) ||
        (roster && p.name === 'SoldierRosterSize' && p.type === 'IntProperty');
      if (
        supported &&
        p.size === 4 &&
        p.arrayIndex === 0 &&
        typeof p.value === 'number' &&
        Number.isFinite(p.value)
      )
        result.push({ objectIndex: object.index, property: p });
    }
  return result;
}
export function maximumFor(p: UnrealProperty, limits: EditLimits): number {
  return p.name === 'CurrentAbilityPoints'
    ? limits.abilityPointsMaximum
    : p.type === 'FloatProperty'
      ? 3.4028234663852886e38
      : 2147483647;
}
export function warningAbove(name: string): number {
  return (
    (
      {
        CurrentAbilityPoints: 100,
        Health: 10000,
        Accuracy: 1,
        Strength: 1000,
        MovementPoints: 20,
        SoldierRosterSize: 30,
      } as Record<string, number>
    )[name] ?? 1000
  );
}
export function createPatches(
  save: GearsTacticsSave,
  edits: EditRequest[],
  limits = defaultLimits,
): SavePatch[] {
  if (!save.canSave)
    throw new Error(
      'Saving has been disabled because this save contains structures the editor cannot safely preserve.',
    );
  if (
    !Number.isInteger(limits.abilityPointsMaximum) ||
    limits.abilityPointsMaximum < 0 ||
    limits.abilityPointsMaximum > 2147483647
  )
    throw new Error('Invalid ability point maximum');
  const allowed = editableProperties(save);
  const seen = new Set<string>();
  const result: SavePatch[] = [];
  for (const edit of edits) {
    const key = `${edit.objectIndex}:${edit.propertyName}`;
    if (seen.has(key)) throw new Error(`Duplicate edit for ${key}`);
    seen.add(key);
    const found = allowed.find(
      (e) => e.objectIndex === edit.objectIndex && e.property.name === edit.propertyName,
    );
    if (!found) throw new Error(`Property ${key} is not an editable, validated scalar`);
    const p = found.property;
    if (
      !Number.isFinite(edit.value) ||
      edit.value < 0 ||
      edit.value > maximumFor(p, limits) ||
      (p.type === 'IntProperty' && !Number.isInteger(edit.value))
    )
      throw new Error(
        `Invalid ${p.name}: enter ${p.type === 'IntProperty' ? 'an integer' : 'a number'} between 0 and ${maximumFor(p, limits)}`,
      );
    const newBytes = Buffer.alloc(4);
    if (p.type === 'IntProperty') newBytes.writeInt32LE(edit.value);
    else newBytes.writeFloatLE(edit.value);
    if (newBytes.equals(p.rawValue)) continue;
    const character = save.characters.find((c) => c.objectIndex === edit.objectIndex);
    result.push({
      objectIndex: edit.objectIndex,
      propertyName: p.name,
      description: `${character?.displayName ?? 'Campaign'} · ${p.name}`,
      offset: p.valueOffset,
      oldBytes: Buffer.from(p.rawValue),
      newBytes,
      oldValue: p.value as number,
      newValue: p.type === 'FloatProperty' ? newBytes.readFloatLE() : edit.value,
    });
  }
  return result.sort((a, b) => a.offset - b.offset);
}
function structure(save: GearsTacticsSave): string {
  const properties = (ps: UnrealProperty[]): unknown[] =>
    ps.map((p) => [
      p.name,
      p.type,
      p.offset,
      p.valueOffset,
      p.size,
      p.arrayIndex,
      p.metadata,
      p.referenceIndex,
      properties(p.children ?? []),
    ]);
  return JSON.stringify({
    header: save.header,
    roots: save.roots,
    objects: save.objects.map((o) => [
      o.index,
      o.name,
      o.classPath,
      o.outerPath,
      o.flags,
      o.body,
      properties(o.properties),
    ]),
    top: properties(save.properties),
  });
}
/** Only exact allowlisted four-byte replacements. Caller-provided offsets/bytes are never trusted. */
export function applyPatches(
  save: GearsTacticsSave,
  patches: SavePatch[],
  limits = defaultLimits,
): Buffer {
  const verified = createPatches(
    save,
    patches.map((p) => ({
      objectIndex: p.objectIndex,
      propertyName: p.propertyName,
      value: p.newValue,
    })),
    limits,
  );
  if (
    patches.length !== verified.length ||
    patches.some((p, i) => {
      const v = verified[i]!;
      return (
        p.offset !== v.offset || !p.oldBytes.equals(v.oldBytes) || !p.newBytes.equals(v.newBytes)
      );
    })
  )
    throw new Error('Patch provenance does not match the parsed original');
  const original = serialize(save);
  const output = Buffer.from(original);
  let previousEnd = 0;
  for (const patch of verified) {
    if (
      patch.offset < previousEnd ||
      !original.subarray(patch.offset, patch.offset + 4).equals(patch.oldBytes)
    )
      throw new Error('Overlapping or stale patch');
    patch.newBytes.copy(output, patch.offset);
    previousEnd = patch.offset + 4;
  }
  validateOutput(save, output, verified);
  return output;
}
export function validateOutput(
  save: GearsTacticsSave,
  output: Buffer,
  patches: SavePatch[],
): GearsTacticsSave {
  const original = serialize(save);
  if (output.length !== original.length) throw new Error('Save length changed');
  let cursor = 0;
  for (const p of patches) {
    if (
      p.offset < cursor ||
      !output.subarray(cursor, p.offset).equals(original.subarray(cursor, p.offset))
    )
      throw new Error('Unrelated bytes changed');
    if (!output.subarray(p.offset, p.offset + 4).equals(p.newBytes))
      throw new Error(`Patch verification failed: ${p.description}`);
    cursor = p.offset + 4;
  }
  if (!output.subarray(cursor).equals(original.subarray(cursor)))
    throw new Error('Unrelated trailing bytes changed');
  const reparsed = parse(output);
  if (!reparsed.canSave || structure(reparsed) !== structure(save))
    throw new Error('Structural validation failed after patching');
  for (const patch of patches) {
    const property = reparsed.objects[patch.objectIndex]?.properties.find(
      (p) => p.name === patch.propertyName && p.valueOffset === patch.offset,
    );
    if (!property || property.value !== patch.newValue)
      throw new Error(`Edited value failed to reparse: ${patch.description}`);
  }
  return reparsed;
}
