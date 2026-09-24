import { createHash } from 'node:crypto';
import { serialize, type GearsTacticsSave, type UnrealProperty } from './index';
export interface SemanticChange {
  object: string;
  property: string;
  before: string;
  after: string;
}
function identities(save: GearsTacticsSave): Map<number, string> {
  const ids = new Map<number, string>();
  const counts = new Map<string, number>();
  for (const c of save.characters) {
    const base =
      c.hero && c.hero !== 'None'
        ? `Character[${c.hero}]`
        : `Character[${c.displayName}|${c.callsign ?? ''}]`;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const id = `${base}${count ? ` occurrence ${count + 1}` : ''}`;
    ids.set(c.objectIndex, id);
    for (const slot of c.cardSlots) ids.set(slot.objectIndex, `${id}.CardSlot[${slot.slotNumber}]`);
  }
  for (const o of save.objects)
    if (!ids.has(o.index)) ids.set(o.index, `${o.outerPath}/${o.name} (${o.classPath})`);
  return ids;
}
function values(
  save: GearsTacticsSave,
): Map<string, { object: string; property: string; value: string }> {
  const ids = identities(save);
  const result = new Map<string, { object: string; property: string; value: string }>();
  const visit = (object: string, props: UnrealProperty[], prefix = ''): void => {
    for (const p of props) {
      const property = `${prefix}${p.name}${p.arrayIndex ? `[${p.arrayIndex}]` : ''}`;
      if (p.children) {
        visit(object, p.children, `${property}.`);
        continue;
      }
      const value =
        p.referenceIndex !== undefined
          ? p.referenceIndex === -1
            ? '<null>'
            : (ids.get(p.referenceIndex) ?? `<invalid #${p.referenceIndex}>`)
          : p.value !== undefined
            ? String(p.value)
            : `[${p.type}, ${p.size} bytes, sha256:${createHash('sha256').update(p.rawValue).digest('hex').slice(0, 16)}]`;
      result.set(`${object}\0${property}`, { object, property, value });
    }
  };
  // Root byte arrays/table are reported semantically below, avoiding a duplicate opaque hash of the entire archive.
  visit(
    'Save',
    save.properties.filter(
      (p) => !['SavedRootObjects', 'ObjectConstructorParametersArray'].includes(p.name),
    ),
  );
  for (const o of save.objects) {
    const id = ids.get(o.index)!;
    result.set(`${id}\0@object`, { object: id, property: '@object', value: 'present' });
    visit(id, o.properties);
  }
  return result;
}
export function diffSaves(
  before: GearsTacticsSave,
  after: GearsTacticsSave,
): { changes: SemanticChange[]; rawDifferentBytes: number; lengthDelta: number } {
  const a = values(before),
    b = values(after);
  const changes: SemanticChange[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const left = a.get(key),
      right = b.get(key);
    if (left?.value !== right?.value) {
      const label = right ?? left!;
      changes.push({
        object: label.object,
        property: label.property,
        before: left?.value ?? '<missing>',
        after: right?.value ?? '<missing>',
      });
    }
  }
  const ba = serialize(before),
    bb = serialize(after);
  let rawDifferentBytes = Math.abs(ba.length - bb.length);
  for (let i = 0; i < Math.min(ba.length, bb.length); i++) if (ba[i] !== bb[i]) rawDifferentBytes++;
  return { changes, rawDifferentBytes, lengthDelta: bb.length - ba.length };
}
