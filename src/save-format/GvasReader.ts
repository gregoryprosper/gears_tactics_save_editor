import { BinaryReader } from './BinaryReader';
import type { GvasHeader } from './types';
export function readGvasHeader(reader: BinaryReader): GvasHeader {
  if (reader.bytes(4).toString('ascii') !== 'GVAS') reader.fail('Not a GVAS save');
  const saveVersion = reader.i32();
  const packageVersion = reader.i32();
  if (saveVersion !== 1 || packageVersion !== 502)
    reader.fail(
      `Unsupported GVAS layout ${saveVersion}/${packageVersion}; only observed layout 1/502 is supported`,
    );
  const engineVersion = `${reader.u16()}.${reader.u16()}.${reader.u16()}`;
  const changelist = reader.u32();
  const branch = reader.fstring();
  const saveClass = reader.fstring();
  if (saveClass !== 'GanderSaveGameObject') reader.fail(`Unsupported save class ${saveClass}`);
  return {
    saveVersion,
    packageVersion,
    engineVersion,
    changelist,
    branch,
    saveClass,
    endOffset: reader.offset,
  };
}
