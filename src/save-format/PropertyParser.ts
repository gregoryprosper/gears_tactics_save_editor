import { BinaryReader } from './BinaryReader';
import type { TextValue, UnrealProperty } from './types';
const names = /^[A-Za-z_][A-Za-z_0-9]*$/;
export const knownTypes = new Set([
  'IntProperty',
  'FloatProperty',
  'BoolProperty',
  'ObjectProperty',
  'TextProperty',
  'NameProperty',
  'StrProperty',
  'ByteProperty',
  'Int64Property',
  'StructProperty',
  'ArrayProperty',
  'MapProperty',
  'EnumProperty',
  'AssetObjectProperty',
]);
export function readText(reader: BinaryReader): TextValue {
  const flags = reader.u32();
  const history = reader.u8();
  if (history === 0) {
    const text = reader.fstring();
    if (reader.offset !== reader.end) return { kind: 'unknown', flags, history };
    if (flags === 2) return { kind: 'literal', flags, history, text };
    return { kind: 'localized', flags, history, key: text };
  }
  return { kind: history === 2 ? 'formatted' : 'unknown', flags, history };
}
export function readPropertyList(reader: BinaryReader, depth = 0): UnrealProperty[] {
  if (depth > 32) reader.fail('Property nesting limit exceeded');
  const result: UnrealProperty[] = [];
  for (let n = 0; n < 100_000; n++) {
    const offset = reader.offset;
    const name = reader.fstring(256);
    if (name === 'None') return result;
    if (!names.test(name)) reader.fail('Invalid tagged property name');
    const type = reader.fstring(128);
    if (!names.test(type) || !type.endsWith('Property')) reader.fail('Invalid property type');
    const size = reader.u32();
    const arrayIndex = reader.i32();
    if (arrayIndex < 0 || arrayIndex > 1_000_000) reader.fail('Invalid property array index');
    let metadata: string | undefined;
    let bool: boolean | undefined;
    if (['StructProperty', 'ArrayProperty', 'ByteProperty', 'EnumProperty'].includes(type)) {
      metadata = reader.fstring(256);
      if (type === 'StructProperty') reader.skip(16);
    } else if (type === 'BoolProperty') {
      const value = reader.u8();
      if (value > 1 || size !== 0) reader.fail('Invalid BoolProperty tag');
      bool = value === 1;
    }
    const valueOffset = reader.offset;
    const payload = reader.child(size);
    reader.skip(size);
    const property: UnrealProperty = {
      name,
      type,
      size,
      arrayIndex,
      offset,
      valueOffset,
      endOffset: reader.offset,
      metadata,
      rawValue: Buffer.from(payload.buffer.subarray(valueOffset, reader.offset)),
      rawTag: Buffer.from(reader.buffer.subarray(offset, valueOffset)),
    };
    switch (type) {
      case 'IntProperty':
        if (size !== 4) payload.fail('IntProperty must be four bytes');
        property.value = payload.i32();
        break;
      case 'FloatProperty':
        if (size !== 4) payload.fail('FloatProperty must be four bytes');
        property.value = payload.f32();
        break;
      case 'Int64Property':
        if (size !== 8) payload.fail('Int64Property must be eight bytes');
        property.value = payload.i64().toString();
        break;
      case 'BoolProperty':
        property.value = bool;
        break;
      case 'NameProperty':
      case 'StrProperty':
      case 'EnumProperty':
      case 'AssetObjectProperty':
        property.value = payload.fstring();
        if (payload.offset !== payload.end) payload.fail('Unexpected string payload bytes');
        break;
      case 'ByteProperty':
        property.value = size === 1 ? payload.u8() : payload.fstring();
        break;
      case 'TextProperty':
        property.text = readText(payload);
        property.value = property.text.text ?? property.text.key;
        break;
      case 'ObjectProperty':
        property.referenceIndex = payload.i32();
        break;
      case 'StructProperty':
        // Native structs (DateTime, GUID, vectors, etc.) remain opaque if not a full tag list.
        try {
          const children = readPropertyList(payload, depth + 1);
          if (payload.offset === payload.end) property.children = children;
        } catch {
          /* Preserve opaque struct bytes. */
        }
        break;
    }
    result.push(property);
  }
  reader.fail('Too many properties');
}
export function structArray(buffer: Buffer, property: UnrealProperty): UnrealProperty[][] {
  if (property.type !== 'ArrayProperty' || property.metadata !== 'StructProperty')
    throw new Error(`${property.name} is not a struct array`);
  const r = new BinaryReader(buffer, property.valueOffset, property.endOffset);
  const count = r.count();
  const entries: UnrealProperty[][] = [];
  for (let i = 0; i < count; i++) entries.push(readPropertyList(r));
  if (r.offset !== r.end) r.fail(`Unexpected trailing bytes in ${property.name}`);
  return entries;
}
export const findProperty = (
  properties: UnrealProperty[],
  name: string,
): UnrealProperty | undefined => properties.find((p) => p.name === name);
