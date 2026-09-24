import { BinaryReader, BinaryFormatError } from './BinaryReader';
import { readPropertyList } from './PropertyParser';
import type { ObjectFrame, ParseWarning, SaveObject, SerializedRoot } from './types';

/** Native bodies are opaque; frames are accepted only after validating the full outer chain. */
export function readFrame(
  r: BinaryReader,
  base: number,
  objectCount: number,
  depth = 0,
): ObjectFrame | undefined {
  if (depth > 64) r.fail('Object outer chain too deep');
  const offset = r.offset;
  const index = r.i32();
  if (index === -1) return undefined;
  if (index < 0 || index >= objectCount) r.fail(`Object reference ${index} out of range`);
  const endOffset = base + r.position64();
  if (endOffset < r.offset + 12 || endOffset > r.end)
    r.fail('Object frame exceeds its containing archive');
  const header = new BinaryReader(r.buffer, r.offset, endOffset);
  const outer = readFrame(header, base, objectCount, depth + 1);
  const outerIndex = header.i32();
  const mode = header.i32();
  if (outerIndex !== (outer?.index ?? -1)) header.fail('Object outer reference mismatch');
  if (mode !== 0 && mode !== 1) header.fail('Unknown object body flag');
  if (mode === 0 && header.offset !== endOffset)
    header.fail('Unexpected bytes in a reference-only frame');
  const frame = {
    index,
    offset,
    bodyOffset: header.offset,
    endOffset,
    outerIndex,
    hasBody: mode === 1,
    rootBase: base,
  };
  r.offset = endOffset;
  return frame;
}

export function parseRootArchive(
  buffer: Buffer,
  base: number,
  end: number,
  index: number,
  objects: SaveObject[],
  warnings: ParseWarning[],
): SerializedRoot {
  const r = new BinaryReader(buffer, base, end);
  const bodyEnd = base + r.position64();
  if (bodyEnd > end || bodyEnd < r.offset) r.fail('Root end exceeds Data byte array');
  const primary = readFrame(new BinaryReader(buffer, r.offset, bodyEnd), base, objects.length);
  if (!primary || primary.index !== index || primary.endOffset !== bodyEnd)
    r.fail('Root Index does not match its object frame');
  // Scan only bounded root data for self-delimiting frames, never the whole file for field names.
  const frames: ObjectFrame[] = [];
  for (let pos = base + 8; pos + 24 <= bodyEnd; pos++) {
    const candidate = buffer.readInt32LE(pos);
    if (candidate < 0 || candidate >= objects.length || buffer.readUInt32LE(pos + 8) !== 0)
      continue;
    const limit = base + buffer.readUInt32LE(pos + 4);
    if (limit < pos + 24 || limit > bodyEnd) continue;
    try {
      const frame = readFrame(new BinaryReader(buffer, pos, bodyEnd), base, objects.length);
      if (frame) frames.push(frame);
    } catch (error) {
      if (!(error instanceof BinaryFormatError)) throw error;
    }
  }
  const byStart = new Map(frames.map((f) => [f.offset, f]));
  const stack: ObjectFrame[] = [];
  for (const frame of frames) {
    while (stack.length && stack[stack.length - 1]!.endOffset <= frame.offset) stack.pop();
    if (stack.length && frame.endOffset > stack[stack.length - 1]!.endOffset)
      warnings.push({
        code: 'CROSSING_FRAMES',
        severity: 'error',
        message: 'Object frames overlap without containment',
        offset: frame.offset,
        blocksSaving: true,
      });
    stack.push(frame);
    const object = objects[frame.index]!;
    object.frames.push(frame);
    if (!frame.hasBody) continue;
    if (object.body) {
      warnings.push({
        code: 'MULTIPLE_BODIES',
        severity: 'error',
        message: `Multiple serialized bodies for ${object.name}`,
        objectIndex: object.index,
        blocksSaving: true,
      });
      continue;
    }
    object.body = frame;
    // Complete tag runs are recognized within this object's own body. Child frames are skipped.
    for (let pos = frame.bodyOffset; pos + 9 <= frame.endOffset;) {
      const child = byStart.get(pos);
      if (child && child !== frame) {
        pos = child.endOffset;
        continue;
      }
      const length = buffer.readInt32LE(pos);
      if (length < 2 || length > 256 || pos + length + 4 > frame.endOffset) {
        pos++;
        continue;
      }
      try {
        const tags = new BinaryReader(buffer, pos, frame.endOffset);
        const properties = readPropertyList(tags);
        if (properties.length) {
          // A tagged UObject list is followed by a 32-bit GUID-presence flag.
          const guid = tags.i32();
          if (guid !== 0 && guid !== 1) tags.fail('Invalid post-property GUID flag');
          if (guid) tags.skip(16);
          object.properties.push(...properties);
          pos = tags.offset;
          continue;
        }
      } catch (error) {
        if (!(error instanceof BinaryFormatError)) throw error;
      }
      pos++;
    }
  }
  r.offset = bodyEnd;
  const count = r.count(1024);
  const versions: SerializedRoot['versions'] = [];
  for (let i = 0; i < count; i++)
    versions.push({ guid: r.bytes(16).toString('hex'), version: r.i32() });
  if (r.offset !== end) r.fail('Unexpected bytes after root custom-version table');
  return { index, offset: base, endOffset: end, versions };
}
