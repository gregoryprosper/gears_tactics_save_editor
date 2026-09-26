import { BinaryReader } from './BinaryReader';
import { serialize } from './index';
import { findProperty, structArray } from './PropertyParser';
import type { GearsTacticsSave, ObjectFrame, UnrealProperty } from './types';

/** Parsed boundaries, not a claim that opaque native bytes can be relocated. */
export type ArchiveNode =
  | { kind: 'bytes'; bytes: Buffer }
  | { kind: 'property'; property: UnrealProperty; payload: ArchiveNode[]; byteCount: boolean }
  | { kind: 'frame'; frame: ObjectFrame; outer: ArchiveNode[]; body: ArchiveNode[] }
  | { kind: 'root'; body: ArchiveNode[]; versions: Buffer };

export interface StructuralArchive {
  nodes: ArchiveNode[];
  bodies: Map<number, Extract<ArchiveNode, { kind: 'frame' }>>;
}

/** Build a nested representation including frames inside tagged arrays and native bodies. */
export function readStructuralArchive(save: GearsTacticsSave): StructuralArchive {
  const bytes = serialize(save);
  type Boundary = { start: number; end: number; build: () => ArchiveNode };
  const boundaries = new Map<number, Boundary>();
  const bodies: StructuralArchive['bodies'] = new Map();
  const dataProperties = new Set<number>();
  const rootProperty = findProperty(save.properties, 'SavedRootObjects')!;
  for (const entry of structArray(bytes, rootProperty)) {
    const data = findProperty(entry, 'Data')!;
    dataProperties.add(data.offset);
  }
  function insert(boundary: Boundary): void {
    const previous = boundaries.get(boundary.start);
    if (previous && previous.end !== boundary.end)
      throw new Error(`Ambiguous archive boundary at ${boundary.start}`);
    boundaries.set(boundary.start, boundary);
  }
  function properties(list: UnrealProperty[]): void {
    for (const property of list) {
      insert({
        start: property.offset,
        end: property.endOffset,
        build: () => ({
          kind: 'property',
          property,
          payload: range(property.valueOffset, property.endOffset),
          byteCount: dataProperties.has(property.offset),
        }),
      });
      properties(property.children ?? []);
      if (property.type === 'ArrayProperty' && property.metadata === 'StructProperty') {
        for (const entry of structArray(bytes, property)) properties(entry);
      }
    }
  }
  properties(save.properties);
  for (const object of save.objects) {
    properties(object.properties);
    for (const frame of object.frames) {
      insert({
        start: frame.offset,
        end: frame.endOffset,
        build: () => {
          const node: Extract<ArchiveNode, { kind: 'frame' }> = {
            kind: 'frame',
            frame,
            outer: range(frame.offset + 12, frame.bodyOffset - 8),
            body: range(frame.bodyOffset, frame.endOffset),
          };
          if (frame.hasBody) bodies.set(frame.index, node);
          return node;
        },
      });
    }
  }
  for (const root of save.roots) {
    const bodyEnd = root.offset + Number(bytes.readBigInt64LE(root.offset));
    insert({
      start: root.offset,
      end: root.endOffset,
      build: () => ({
        kind: 'root',
        body: range(root.offset + 8, bodyEnd),
        versions: Buffer.from(bytes.subarray(bodyEnd, root.endOffset)),
      }),
    });
  }
  const starts = [...boundaries.keys()].sort((a, b) => a - b);
  function after(position: number): number {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid]! <= position) low = mid + 1;
      else high = mid;
    }
    return starts[low] ?? bytes.length;
  }
  let depth = 0;
  function range(start: number, end: number): ArchiveNode[] {
    if (++depth > 128) throw new Error('Structural archive nesting limit exceeded');
    const nodes: ArchiveNode[] = [];
    for (let position = start; position < end;) {
      const boundary = boundaries.get(position);
      if (boundary) {
        if (boundary.end > end) throw new Error(`Crossing archive boundary at ${position}`);
        nodes.push(boundary.build());
        position = boundary.end;
      } else {
        const next = Math.min(end, after(position));
        nodes.push({ kind: 'bytes', bytes: Buffer.from(bytes.subarray(position, next)) });
        position = next;
      }
    }
    depth--;
    return nodes;
  }
  const nodes = range(0, bytes.length);
  if (bodies.size !== save.objects.length)
    throw new Error('Structural archive does not account for every object body');
  return { nodes, bodies };
}

/**
 * Reconstruct known envelopes and recompute their lengths/root-relative frame ends.
 * Deliberately accepts a parsed save, not editable nodes: native relocation is not verified.
 * This is the round-trip prerequisite for a future structural mutation writer.
 */
export function rebuildUnchangedArchive(save: GearsTacticsSave): Buffer {
  const archive = readStructuralArchive(save);
  const chunks: Buffer[] = [];
  let position = 0;
  const emit = (bytes: Buffer): void => {
    chunks.push(bytes);
    position += bytes.length;
  };
  const i32 = (value: number): Buffer => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value);
    return buffer;
  };
  function write(nodes: ArchiveNode[], rootBase?: number): void {
    for (const node of nodes) {
      switch (node.kind) {
        case 'bytes':
          emit(Buffer.from(node.bytes));
          break;
        case 'property': {
          const tag = Buffer.from(node.property.rawTag);
          const reader = new BinaryReader(tag);
          reader.fstring();
          reader.fstring();
          emit(tag);
          const start = position;
          const chunkStart = chunks.length;
          write(node.payload, rootBase);
          tag.writeUInt32LE(position - start, reader.offset);
          if (node.byteCount) {
            const count = chunks[chunkStart];
            if (!count || count.length !== 4) throw new Error('Invalid root byte-count boundary');
            count.writeInt32LE(position - start - 4);
          }
          break;
        }
        case 'frame': {
          if (rootBase === undefined) throw new Error('Frame outside a root archive');
          emit(i32(node.frame.index));
          const end = Buffer.alloc(8);
          emit(end);
          write(node.outer, rootBase);
          emit(i32(node.frame.outerIndex));
          emit(i32(node.frame.hasBody ? 1 : 0));
          write(node.body, rootBase);
          end.writeBigInt64LE(BigInt(position - rootBase));
          break;
        }
        case 'root': {
          const base = position;
          const end = Buffer.alloc(8);
          emit(end);
          write(node.body, base);
          end.writeBigInt64LE(BigInt(position - base));
          emit(Buffer.from(node.versions));
          break;
        }
      }
    }
  }
  write(archive.nodes);
  const output = Buffer.concat(chunks);
  if (!output.equals(serialize(save)))
    throw new Error('Structural reconstruction did not reproduce the original archive');
  return output;
}
