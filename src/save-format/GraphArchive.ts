import { BinaryReader } from './BinaryReader';
import { readStructuralArchive, type ArchiveNode } from './StructuralArchive';
import { findProperty, structArray } from './PropertyParser';
import { serialize, MAX_SAVE_BYTES } from './index';
import type { GearsTacticsSave } from './types';

export type GraphNode =
  | { kind: 'bytes'; bytes: Buffer }
  | { kind: 'reference'; index: number }
  | {
      kind: 'property';
      name: string;
      type: string;
      tag: Buffer;
      payload: GraphNode[];
      byteCount?: boolean;
      rootIndex?: number;
    }
  | { kind: 'root'; body: GraphNode[]; versions: Buffer };
export interface GraphObject {
  index: number;
  name: string;
  classPath: string;
  outerPath: string;
  flags: string;
  outer: number;
  body: GraphNode[];
  constructorBytes?: Buffer;
}
export interface ArchiveGraph {
  top: GraphNode[];
  objects: Map<number, GraphObject>;
}
export const integerBytes = (value: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
};
export const stringBytes = (value: string): Buffer => {
  const b = Buffer.from(value + '\0', 'utf8');
  return Buffer.concat([integerBytes(b.length), b]);
};
export function graphProperty(name: string, type: string, bytes: Buffer): GraphNode {
  return {
    kind: 'property',
    name,
    type,
    tag: Buffer.concat([
      stringBytes(name),
      stringBytes(type),
      integerBytes(bytes.length),
      integerBytes(0),
    ]),
    payload: [{ kind: 'bytes', bytes }],
  };
}

export function readArchiveGraph(save: GearsTacticsSave): ArchiveGraph {
  const bytes = serialize(save),
    archive = readStructuralArchive(save);
  const indexProperties = new Map<number, number>();
  for (const entry of structArray(bytes, findProperty(save.properties, 'SavedRootObjects')!)) {
    const index = findProperty(entry, 'Index')!;
    indexProperties.set(index.offset, index.value as number);
  }
  function nodes(input: ArchiveNode[]): GraphNode[] {
    return input.map((n): GraphNode => {
      switch (n.kind) {
        case 'bytes':
          return { kind: 'bytes', bytes: Buffer.from(n.bytes) };
        case 'frame':
          return { kind: 'reference', index: n.frame.index };
        case 'root':
          return { kind: 'root', body: nodes(n.body), versions: Buffer.from(n.versions) };
        case 'property':
          return {
            kind: 'property',
            name: n.property.name,
            type: n.property.type,
            tag: Buffer.from(n.property.rawTag),
            payload: nodes(n.payload),
            byteCount: n.byteCount,
            rootIndex: indexProperties.get(n.property.offset),
          };
      }
    });
  }
  const entries = structArray(
    bytes,
    findProperty(save.properties, 'ObjectConstructorParametersArray')!,
  );
  const objects = new Map<number, GraphObject>();
  for (const o of save.objects) {
    const body = archive.bodies.get(o.index)!;
    const entry = entries[o.index]!;
    objects.set(o.index, {
      index: o.index,
      name: o.name,
      classPath: o.classPath,
      outerPath: o.outerPath,
      flags: o.flags,
      outer: body.frame.outerIndex,
      body: nodes(body.body),
      constructorBytes: Buffer.from(bytes.subarray(entry[0]!.offset, entry.at(-1)!.endOffset + 9)),
    });
  }
  return { top: nodes(archive.nodes), objects };
}

/**
 * Structural writer: first-reference body emission, live-object table compaction and relocation.
 * Production import separately enforces native compatibility and destination constraints.
 */
export function writeArchiveGraph(graph: ArchiveGraph): {
  bytes: Buffer;
  indices: Map<number, number>;
} {
  const live = new Set<number>();
  function visit(index: number): void {
    if (index === -1 || live.has(index)) return;
    const object = graph.objects.get(index);
    if (!object) throw new Error(`Unresolved graph object ${index}`);
    live.add(index);
    visit(object.outer);
    walk(object.body);
  }
  function walk(nodes: GraphNode[]): void {
    for (const n of nodes) {
      if (n.kind === 'reference') visit(n.index);
      else if (n.kind === 'property') walk(n.payload);
      else if (n.kind === 'root') walk(n.body);
    }
  }
  walk(graph.top);
  const indices = new Map([...live].sort((a, b) => a - b).map((index, i) => [index, i]));
  const mapped = (index: number): number => {
    if (index === -1) return -1;
    const value = indices.get(index);
    if (value === undefined) throw new Error('Reference points to an unreachable object');
    return value;
  };
  const chunks: Buffer[] = [],
    emitted = new Set<number>();
  let position = 0,
    depth = 0;
  function emit(bytes: Buffer): void {
    if (position + bytes.length > MAX_SAVE_BYTES) throw new Error('Generated save exceeds 64 MiB');
    chunks.push(bytes);
    position += bytes.length;
  }
  function constructor(object: GraphObject): Buffer {
    if (object.constructorBytes) return object.constructorBytes;
    const parts: Buffer[] = [];
    for (const [name, value] of [
      ['OuterPath', object.outerPath],
      ['ClassPath', object.classPath],
      ['Name', object.name],
    ]) {
      const valueBytes = stringBytes(value!);
      parts.push(
        stringBytes(name!),
        stringBytes('StrProperty'),
        integerBytes(valueBytes.length),
        integerBytes(0),
        valueBytes,
      );
    }
    const flags = Buffer.alloc(8);
    flags.writeBigInt64LE(BigInt(object.flags));
    parts.push(
      stringBytes('Flags'),
      stringBytes('Int64Property'),
      integerBytes(8),
      integerBytes(0),
      flags,
      stringBytes('None'),
    );
    return Buffer.concat(parts);
  }
  function reference(index: number, base: number): void {
    if (++depth > 128) throw new Error('Generated object nesting limit exceeded');
    emit(integerBytes(mapped(index)));
    if (index === -1) {
      depth--;
      return;
    }
    const end = Buffer.alloc(8);
    emit(end);
    const object = graph.objects.get(index)!;
    const first = !emitted.has(index);
    emitted.add(index);
    reference(object.outer, base);
    emit(integerBytes(mapped(object.outer)));
    emit(integerBytes(first ? 1 : 0));
    if (first) write(object.body, base);
    end.writeBigInt64LE(BigInt(position - base));
    depth--;
  }
  function write(nodes: GraphNode[], base?: number): void {
    for (const n of nodes) {
      switch (n.kind) {
        case 'bytes':
          emit(Buffer.from(n.bytes));
          break;
        case 'reference':
          if (base === undefined) throw new Error('Reference outside a root');
          reference(n.index, base);
          break;
        case 'root': {
          const rootBase = position,
            end = Buffer.alloc(8);
          emit(end);
          write(n.body, rootBase);
          end.writeBigInt64LE(BigInt(position - rootBase));
          emit(Buffer.from(n.versions));
          break;
        }
        case 'property': {
          const tag = Buffer.from(n.tag),
            r = new BinaryReader(tag);
          r.fstring();
          r.fstring();
          emit(tag);
          const start = position,
            chunkStart = chunks.length;
          if (base === undefined && n.name === 'ObjectConstructorParametersArray') {
            emit(integerBytes(indices.size));
            for (const index of indices.keys()) emit(constructor(graph.objects.get(index)!));
          } else if (n.rootIndex !== undefined) emit(integerBytes(mapped(n.rootIndex)));
          else write(n.payload, base);
          tag.writeUInt32LE(position - start, r.offset);
          if (n.byteCount) {
            const count = chunks[chunkStart];
            if (count?.length !== 4) throw new Error('Invalid root byte count');
            count.writeInt32LE(position - start - 4);
          }
          break;
        }
      }
    }
  }
  write(graph.top);
  if (emitted.size !== live.size) throw new Error('Not every reachable body was emitted');
  return { bytes: Buffer.concat(chunks), indices };
}
