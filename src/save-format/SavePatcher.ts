import { parse, serialize } from './index';
import type { GearsTacticsSave, UnrealProperty } from './types';
import type { EditRequest } from '../shared/api';
import { armourCatalog, cachedEquipmentEntries, readInventoryDefinitions } from './NativeSoldier';
import { armourFamilyName } from '../shared/armour-names';
export type SavePatchKind = 'scalar' | 'armour' | 'stock';
export interface SavePatch {
  kind: SavePatchKind;
  objectIndex: number;
  propertyName: string;
  description: string;
  offset: number;
  oldBytes: Buffer;
  newBytes: Buffer;
  oldValue: number | string;
  newValue: number | string;
}
export interface EditLimits {
  abilityPointsMaximum: number;
}
export const defaultLimits: EditLimits = { abilityPointsMaximum: 2147483647 };
const integers = new Set(['CurrentAbilityPoints', 'Health', 'Strength', 'MovementPoints']);
export const ARMOUR_SLOT_PROPERTY = /^ArmourSlot:([0-3])$/;
export const ARMOUR_STOCK_PROPERTY = /^ArmourStock:([0-9a-f]{32})$/;
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
/**
 * An armour swap rewrites only the 16 GUID bytes of one native equipment entry. The replacement
 * GUID must be an armour definition of this save and, when its kind has been observed on some
 * character entry, must match the slot's kind. Pieces never worn in this save have no observed
 * kind; they are accepted deliberately (naming/probe passes) and keep the entry's kind byte,
 * which is not part of the patch.
 */
function armourPatch(save: GearsTacticsSave, edit: EditRequest, slot: number): SavePatch | null {
  if (typeof edit.value !== 'string') throw new Error(`Armour slot ${slot} requires a GUID value`);
  const guid = edit.value.toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(guid)) throw new Error(`Invalid armour GUID for slot ${slot}`);
  const object = save.objects[edit.objectIndex];
  if (!object?.classPath.endsWith('.GanderCharacterData'))
    throw new Error('Armour edits require a character object');
  const entry = cachedEquipmentEntries(save, edit.objectIndex)[slot] ?? null;
  if (!entry) throw new Error(`Armour slot ${slot} is empty for this character`);
  const catalog = armourCatalog(save);
  if (!catalog.definitions.has(guid))
    throw new Error('The selected armour piece does not exist in this save');
  const observedKind = catalog.kindOf.get(guid);
  if (observedKind !== undefined && observedKind !== entry.kind)
    throw new Error('The selected armour piece does not match this equipment slot');
  const newBytes = Buffer.from(guid, 'hex');
  const oldBytes = Buffer.from(entry.guid, 'hex');
  if (newBytes.equals(oldBytes)) return null;
  const character = save.characters.find((c) => c.objectIndex === edit.objectIndex);
  return {
    kind: 'armour',
    objectIndex: edit.objectIndex,
    propertyName: edit.propertyName,
    description: `${character?.displayName ?? `Character #${edit.objectIndex}`} · Armour slot ${slot}`,
    offset: entry.guidOffset,
    oldBytes,
    newBytes,
    oldValue: entry.guid,
    newValue: guid,
  };
}
/**
 * A stock grant rewrites only the 4-byte quantity of one armour inventory definition. The
 * game displays an equipped piece only when the character owns it, so granting stock is the
 * enabling step for equipping pieces this save has never held.
 */
function armourStockPatch(save: GearsTacticsSave, edit: EditRequest): SavePatch | null {
  const match = ARMOUR_STOCK_PROPERTY.exec(edit.propertyName);
  if (!match) return null;
  if (typeof edit.value !== 'number' || !Number.isInteger(edit.value) || edit.value < 0)
    throw new Error(`Invalid stock quantity for ${edit.propertyName.slice(12, 20)}`);
  const guid = match[1]!;
  const matches = [...readInventoryDefinitions(save).values()].filter(
    (d) => d.category === 'armour' && d.guid === guid,
  );
  if (matches.length === 0)
    throw new Error('The selected armour piece does not exist in this save');
  if (matches.length > 1)
    throw new Error(`Ambiguous armour definition for stock grant: ${guid.slice(0, 8)}`);
  const definition = matches[0]!;
  if (definition.quantityOffset === undefined || definition.quantity === undefined)
    throw new Error('Armour definition carries no stock record');
  const newBytes = Buffer.alloc(4);
  newBytes.writeInt32LE(edit.value);
  const oldBytes = Buffer.alloc(4);
  oldBytes.writeInt32LE(definition.quantity);
  if (newBytes.equals(oldBytes)) return null;
  return {
    kind: 'stock',
    objectIndex: save.objects.findIndex((o) => o.classPath === definition.inventoryClass),
    propertyName: edit.propertyName,
    description: `Armour stock ${armourFamilyName(guid) ?? guid.slice(0, 8)} → ${edit.value}`,
    offset: definition.quantityOffset,
    oldBytes,
    newBytes,
    oldValue: definition.quantity,
    newValue: edit.value,
  };
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
    const armour = ARMOUR_SLOT_PROPERTY.exec(edit.propertyName);
    if (armour) {
      const patch = armourPatch(save, edit, Number(armour[1]));
      if (patch) result.push(patch);
      continue;
    }
    const stock = armourStockPatch(save, edit);
    if (stock) {
      result.push(stock);
      continue;
    }
    if (ARMOUR_STOCK_PROPERTY.test(edit.propertyName)) continue;
    const found = allowed.find(
      (e) => e.objectIndex === edit.objectIndex && e.property.name === edit.propertyName,
    );
    if (!found) throw new Error(`Property ${key} is not an editable, validated scalar`);
    const p = found.property;
    if (
      typeof edit.value !== 'number' ||
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
      kind: 'scalar',
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
/** Only exact allowlisted fixed-width replacements. Caller-provided offsets/bytes are never trusted. */
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
        p.kind !== v.kind ||
        p.offset !== v.offset ||
        !p.oldBytes.equals(v.oldBytes) ||
        !p.newBytes.equals(v.newBytes)
      );
    })
  )
    throw new Error('Patch provenance does not match the parsed original');
  const original = serialize(save);
  const output = Buffer.from(original);
  let previousEnd = 0;
  for (const patch of verified) {
    const width = patch.newBytes.length;
    if (patch.oldBytes.length !== width || width < 1)
      throw new Error(`Unsupported patch width: ${patch.description}`);
    if (
      patch.offset < previousEnd ||
      !original.subarray(patch.offset, patch.offset + width).equals(patch.oldBytes)
    )
      throw new Error('Overlapping or stale patch');
    patch.newBytes.copy(output, patch.offset);
    previousEnd = patch.offset + width;
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
    const width = p.newBytes.length;
    if (
      p.offset < cursor ||
      !output.subarray(cursor, p.offset).equals(original.subarray(cursor, p.offset))
    )
      throw new Error('Unrelated bytes changed');
    if (!output.subarray(p.offset, p.offset + width).equals(p.newBytes))
      throw new Error(`Patch verification failed: ${p.description}`);
    cursor = p.offset + width;
  }
  if (!output.subarray(cursor).equals(original.subarray(cursor)))
    throw new Error('Unrelated trailing bytes changed');
  const reparsed = parse(output);
  if (!reparsed.canSave || structure(reparsed) !== structure(save))
    throw new Error('Structural validation failed after patching');
  for (const patch of patches) {
    if (patch.kind === 'armour') {
      const slot = Number(ARMOUR_SLOT_PROPERTY.exec(patch.propertyName)![1]);
      const entry = cachedEquipmentEntries(reparsed, patch.objectIndex)[slot] ?? null;
      if (!entry || entry.guid !== patch.newValue)
        throw new Error(`Edited value failed to reparse: ${patch.description}`);
    } else if (patch.kind === 'stock') {
      const guid = ARMOUR_STOCK_PROPERTY.exec(patch.propertyName)![1]!;
      const matches = readInventoryDefinitions(reparsed).filter(
        (d) => d.category === 'armour' && d.guid === guid,
      );
      if (matches.length !== 1 || matches[0]!.quantity !== patch.newValue)
        throw new Error(`Edited value failed to reparse: ${patch.description}`);
    } else {
      const property = reparsed.objects[patch.objectIndex]?.properties.find(
        (p) => p.name === patch.propertyName && p.valueOffset === patch.offset,
      );
      if (!property || property.value !== patch.newValue)
        throw new Error(`Edited value failed to reparse: ${patch.description}`);
    }
  }
  return reparsed;
}
