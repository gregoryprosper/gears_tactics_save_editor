import { BinaryReader, BinaryFormatError } from './BinaryReader';
import { readGvasHeader } from './GvasReader';
import { findProperty, readPropertyList, structArray } from './PropertyParser';
import { parseObjectTable } from './ObjectTableParser';
import { parseRootArchive } from './ObjectArchive';
import { parseCharacters, type ClassResolutionRules } from './CharacterParser';
import { parseCampaign } from './CampaignParser';
import { validateSave } from './SaveValidator';
import type { GearsTacticsSave, ParseWarning } from './types';
export * from './types';
export { ObjectResolver } from './ObjectResolver';
const snapshots = new WeakMap<GearsTacticsSave, Buffer>();
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;
export function parse(buffer: Buffer, rules?: ClassResolutionRules): GearsTacticsSave {
  if (buffer.length > MAX_SAVE_BYTES) throw new Error('Save exceeds the 64 MiB inspection limit');
  const original = Buffer.from(buffer);
  const reader = new BinaryReader(original);
  const header = readGvasHeader(reader);
  const properties = readPropertyList(reader);
  if (reader.i32() !== 0 || reader.offset !== reader.end) reader.fail('Unexpected GVAS trailer');
  const table = findProperty(properties, 'ObjectConstructorParametersArray');
  const rootsProperty = findProperty(properties, 'SavedRootObjects');
  if (!table || !rootsProperty)
    throw new BinaryFormatError('Required object table or root archive is missing', reader.offset);
  const objects = parseObjectTable(original, table);
  const warnings: ParseWarning[] = [];
  const roots = structArray(original, rootsProperty).map((entry) => {
    const data = findProperty(entry, 'Data');
    const index = findProperty(entry, 'Index')?.value;
    if (
      !data ||
      data.type !== 'ArrayProperty' ||
      data.metadata !== 'ByteProperty' ||
      typeof index !== 'number'
    )
      throw new BinaryFormatError('Malformed root Data or Index', reader.offset);
    const bytes = new BinaryReader(original, data.valueOffset, data.endOffset);
    const count = bytes.count(MAX_SAVE_BYTES);
    if (count !== bytes.end - bytes.offset)
      bytes.fail('Root byte count does not match payload size');
    return parseRootArchive(original, bytes.offset, bytes.end, index, objects, warnings);
  });
  if (!objects.length || !roots.length) reader.fail('Save has no objects or roots');
  const characters = parseCharacters(objects, warnings, rules);
  const save: GearsTacticsSave = {
    header,
    properties,
    objects,
    roots,
    characters,
    campaign: parseCampaign(properties, objects, characters.length),
    warnings,
    get originalBuffer() {
      return Buffer.from(original);
    },
    canSave: false,
  };
  save.warnings.push(...validateSave(save, original));
  save.canSave = !save.warnings.some((w) => w.blocksSaving);
  snapshots.set(save, original);
  return save;
}
/** Lossless serialization deliberately copies the original archive instead of reconstructing it. */
export function serialize(save: GearsTacticsSave): Buffer {
  const original = snapshots.get(save);
  if (!original) throw new Error('Save was not created by this parser');
  return Buffer.from(original);
}
