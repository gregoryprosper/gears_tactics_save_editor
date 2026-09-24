import { BinaryReader } from './BinaryReader';
import { readFrame } from './ObjectArchive';
import { knownTypes } from './PropertyParser';
import type { GearsTacticsSave, ParseWarning, UnrealProperty } from './types';
export function validateSave(save: GearsTacticsSave, buffer: Buffer): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const unknown = new Set<string>();
  const inspect = (p: UnrealProperty, objectIndex?: number, base?: number): void => {
    if (!knownTypes.has(p.type) && !unknown.has(p.type)) {
      unknown.add(p.type);
      warnings.push({
        code: 'UNKNOWN_PROPERTY',
        severity: 'warning',
        message: `Unknown property type encountered: ${p.type}; raw bytes preserved`,
        offset: p.offset,
        blocksSaving: true,
      });
    }
    if (p.type === 'MapProperty' && !unknown.has(p.type)) {
      unknown.add(p.type);
      warnings.push({
        code: 'OPAQUE_MAP',
        severity: 'info',
        message: 'MapProperty payloads are retained as opaque bytes',
        blocksSaving: false,
      });
    }
    if (typeof p.value === 'number' && !Number.isFinite(p.value))
      warnings.push({
        code: 'NONFINITE_VALUE',
        severity: 'error',
        message: `${p.name} is not finite`,
        offset: p.offset,
        objectIndex,
        blocksSaving: true,
      });
    const checkReference = (reader: BinaryReader): void => {
      const frame = readFrame(reader, base!, save.objects.length);
      if (frame && !save.objects[frame.index]?.body)
        reader.fail(`Referenced object ${frame.index} has no validated body`);
    };
    try {
      if (base !== undefined && p.type === 'ObjectProperty') {
        const r = new BinaryReader(buffer, p.valueOffset, p.endOffset);
        checkReference(r);
        if (r.offset !== r.end) r.fail('ObjectProperty reference does not fill payload');
      }
      if (base !== undefined && p.type === 'ArrayProperty' && p.metadata === 'ObjectProperty') {
        const r = new BinaryReader(buffer, p.valueOffset, p.endOffset);
        const count = r.count();
        for (let i = 0; i < count; i++) checkReference(r);
        if (r.offset !== r.end) r.fail('Object array does not fill payload');
      }
    } catch (error) {
      warnings.push({
        code: 'INVALID_REFERENCE',
        severity: 'error',
        message: String(error),
        offset: p.valueOffset,
        objectIndex,
        blocksSaving: true,
      });
    }
    p.children?.forEach((child) => inspect(child, objectIndex, base));
  };
  save.properties.forEach((p) => inspect(p));
  for (const o of save.objects) {
    if (!o.body)
      warnings.push({
        code: 'MISSING_OBJECT_BODY',
        severity: 'error',
        message: `No validated serialized body for object ${o.index} (${o.name})`,
        objectIndex: o.index,
        blocksSaving: true,
      });
    for (const frame of o.frames) {
      const outer = save.objects[frame.outerIndex];
      const expected = outer
        ? outer.outerPath === 'None'
          ? [outer.name]
          : [`${outer.outerPath}.${outer.name}`, `${outer.outerPath}:${outer.name}`]
        : ['None'];
      if (!expected.includes(o.outerPath)) {
        warnings.push({
          code: 'OUTER_IDENTITY_MISMATCH',
          severity: 'error',
          message: `Serialized ownership differs from the object table for ${o.name}`,
          offset: frame.offset,
          objectIndex: o.index,
          blocksSaving: true,
        });
        break;
      }
    }
    const names = new Set<string>();
    for (const p of o.properties) {
      const key = `${p.name}:${p.arrayIndex}`;
      if (names.has(key))
        warnings.push({
          code: 'AMBIGUOUS_PROPERTY',
          severity: 'error',
          message: `Multiple ${p.name} properties in ${o.name}`,
          objectIndex: o.index,
          blocksSaving: true,
        });
      names.add(key);
      inspect(p, o.index, o.body?.rootBase);
    }
    if (
      o.classPath.endsWith('.GanderCharacterData') &&
      [
        'bUseNewCustomizationSystem',
        'bIsInitialized',
        'Name',
        'FullName',
        'Level',
        'Health',
        'Strength',
        'MovementPoints',
        'ActionPoints',
        'CurrentAbilityPoints',
      ].some((name) => !o.properties.some((p) => p.name === name))
    )
      warnings.push({
        code: 'UNMAPPED_CHARACTER',
        severity: 'error',
        message: `Character properties could not be fully identified: ${o.name}`,
        objectIndex: o.index,
        blocksSaving: true,
      });
  }
  return warnings;
}
