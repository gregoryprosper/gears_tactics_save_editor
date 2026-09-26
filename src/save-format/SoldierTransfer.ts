import { BinaryReader } from './BinaryReader';
import { readWeaponRegistry } from './WeaponRegistry';
import {
  readInventoryDefinitions,
  readNativeRoster,
  assignedSoldiers,
  nativeTransferFindings,
  transferGameType,
} from './NativeSoldier';
import { readStructuralArchive, type ArchiveNode } from './StructuralArchive';
import type { GearsTacticsSave, SaveObject } from './types';
import type {
  SoldierImportPreview,
  SoldierNode,
  SoldierPackage,
  SoldierSummary,
} from '../shared/soldier';

export const MAX_SOLDIER_BYTES = 16 * 1024 * 1024;
const MAX_OBJECTS = 4096;
const MAX_NODES = 100000;
const preserved = new Set(['ActionPoints', 'SquadId', 'SquadSlotId', 'PreviousStatus']);
const statisticNames = new Set([
  'Level',
  'Health',
  'Accuracy',
  'Strength',
  'MovementPoints',
  'CurrentAbilityPoints',
]);
const heroId = (hero?: string): string | undefined =>
  !hero || hero === 'None' ? undefined : hero.replace(/^SpecialHero_/, '');

/** Export object bodies separately: physical containment does not imply soldier ownership. */
export function exportSoldier(save: GearsTacticsSave, objectIndex: number): SoldierPackage {
  if (!save.canSave)
    throw new Error('This save has blocking diagnostics; soldier export is unavailable');
  const character = save.characters.find((c) => c.objectIndex === objectIndex);
  if (!character) throw new Error('Select a soldier to export');
  const archive = readStructuralArchive(save);
  const objects: SoldierPackage['objects'] = [];
  const bindings: SoldierPackage['bindings'] = [];
  const ids = new Map<number, string>();
  const queue: SaveObject[] = [];
  function context(object: SaveObject): SoldierPackage['bindings'][number]['role'] | undefined {
    if (object.index === objectIndex) return undefined;
    if (object.classPath.endsWith('.GanderCharacterData')) return 'other-character';
    if (object.classPath.includes('GanderCharacterRoster')) return 'roster';
    if (object.classPath.includes('GanderMetaInventory')) return 'inventory';
    if (/GanderMetaInfo|GanderGameProgression|GanderSquadInfo|GanderGame_/.test(object.classPath))
      return 'campaign';
    if (!object.body) return 'unresolved';
    return undefined;
  }
  function reference(index: number): string {
    const known = ids.get(index);
    if (known) return known;
    const object = save.objects[index];
    if (!object) throw new Error(`Unresolved soldier object ${index}`);
    const role = context(object);
    const id = role ? `binding-${bindings.length}` : `object-${queue.length}`;
    ids.set(index, id);
    if (role) bindings.push({ id, role, classPath: object.classPath, name: object.name });
    else queue.push(object);
    if (ids.size > MAX_OBJECTS)
      throw new Error('Soldier dependency graph exceeds the export limit');
    return id;
  }
  function convert(nodes: ArchiveNode[]): SoldierNode[] {
    return nodes.map((node): SoldierNode => {
      switch (node.kind) {
        case 'bytes':
          return { kind: 'native', hex: node.bytes.toString('hex') };
        case 'frame':
          return { kind: 'reference', id: reference(node.frame.index) };
        case 'property':
          if (preserved.has(node.property.name))
            return { kind: 'preserve', name: node.property.name };
          return {
            kind: 'property',
            name: node.property.name,
            type: node.property.type,
            tagHex: node.property.rawTag.toString('hex'),
            payload: convert(node.payload),
          };
        case 'root':
          throw new Error('Unexpected root archive in soldier body');
      }
    });
  }
  const root = reference(objectIndex);
  // Some owned bodies are serialized elsewhere, outside the character's physical frame.
  const owned = new Set([objectIndex]);
  let added = true;
  while (added) {
    added = false;
    for (const object of save.objects) {
      if (object.body && owned.has(object.body.outerIndex) && !owned.has(object.index)) {
        owned.add(object.index);
        reference(object.index);
        added = true;
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const object = queue[i]!;
    const body = archive.bodies.get(object.index);
    if (!body) throw new Error(`Missing soldier dependency body: ${object.name}`);
    const outer = body.frame.outerIndex === -1 ? null : reference(body.frame.outerIndex);
    objects.push({
      id: ids.get(object.index)!,
      name: object.name,
      classPath: object.classPath,
      outerPath: object.outerPath,
      flags: object.flags,
      outer,
      body: convert(body.body),
    });
  }
  const soldier: SoldierSummary = {
    displayName: character.displayName,
    combatClass: character.combatClass,
    classInferred: character.classInferred,
    hero: heroId(character.hero),
    callsign: character.callsign,
    stats: Object.fromEntries(
      Object.entries(character.stats).filter(([key]) => statisticNames.has(key)),
    ),
    skills: character.cardSlots.map((slot) => ({
      slot: slot.slotNumber,
      status: slot.status,
      ability: slot.abilityLabel,
    })),
  };
  const versions = new Map(save.roots.flatMap((r) => r.versions.map((v) => [v.guid, v] as const)));
  function nativeHex(nodes: SoldierNode[]): string[] {
    return nodes.flatMap((n) =>
      n.kind === 'native' ? [n.hex] : n.kind === 'property' ? nativeHex(n.payload) : [],
    );
  }
  const payloads = objects.flatMap((o) => nativeHex(o.body));
  const inventoryDefinitions = readInventoryDefinitions(save)
    .filter((definition) => payloads.some((hex) => hex.includes(definition.guid)))
    .map(({ guid, category, inventoryClass, assetIdentity }) => ({
      guid,
      category,
      inventoryClass,
      assetIdentity,
    }));
  const result: SoldierPackage = {
    format: 'gears-tactics-soldier',
    version: 1,
    completeness: 'native-dependencies-unverified',
    source: {
      saveVersion: save.header.saveVersion,
      packageVersion: save.header.packageVersion,
      engineVersion: save.header.engineVersion,
      gameType: transferGameType(save) ?? 'Unknown',
      gameState: save.campaign.gameState ?? 'Unknown',
      customVersions: [...versions.values()],
    },
    soldier,
    root,
    objects,
    bindings,
    inventoryDefinitions,
    weaponDefinitions: [
      ...new Map(
        readWeaponRegistry(save)
          .groups.flat()
          .filter((entry) => ids.has(entry.objectIndex))
          .map(({ objectIndex, kind, flag, level }) => [
            objectIndex,
            { id: ids.get(objectIndex)!, kind, flag, level },
          ]),
      ).values(),
    ],
  };
  // Exported packages obey exactly the same bounded format checks as imported packages.
  return readSoldierPackage(stringifySoldierPackage(result));
}

export function stringifySoldierPackage(value: SoldierPackage): string {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text, 'utf8') > MAX_SOLDIER_BYTES)
    throw new Error('Soldier package exceeds the 16 MiB limit');
  return text;
}

function fail(message: string): never {
  throw new Error(`Invalid soldier package: ${message}`);
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) fail('unknown field');
  return result;
}
function string(value: unknown, maximum = 2048): string {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.includes('\0'))
    fail('invalid string');
  return value;
}
function integer(value: unknown, maximum = 2147483647): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maximum)
    fail('invalid integer');
  return value;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail('invalid array');
  return value;
}
function hex(value: unknown): string {
  const result = string(value, MAX_SOLDIER_BYTES);
  if (result.length % 2 || !/^[0-9a-f]+$/.test(result)) fail('invalid hex payload');
  return result;
}

/** Text files are untrusted data. No source paths, offsets or executable content are accepted. */
export function readSoldierPackage(text: string): SoldierPackage {
  if (Buffer.byteLength(text, 'utf8') > MAX_SOLDIER_BYTES) fail('file exceeds 16 MiB');
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    fail('not valid JSON text');
  }
  const value = record(json, [
    'format',
    'version',
    'completeness',
    'source',
    'soldier',
    'root',
    'objects',
    'bindings',
    'inventoryDefinitions',
    'weaponDefinitions',
  ]);
  if (value.format !== 'gears-tactics-soldier' || value.version !== 1)
    fail('unsupported format or version');
  if (value.completeness !== 'native-dependencies-unverified')
    fail('unsupported completeness declaration');
  const source = record(value.source, [
    'saveVersion',
    'packageVersion',
    'engineVersion',
    'gameType',
    'gameState',
    'customVersions',
  ]);
  integer(source.saveVersion);
  integer(source.packageVersion);
  string(source.engineVersion);
  string(source.gameType);
  string(source.gameState);
  const versionIds = new Set<string>();
  for (const entry of array(source.customVersions, 1024)) {
    const v = record(entry, ['guid', 'version']);
    if (!/^[0-9a-f]{32}$/.test(string(v.guid)) || versionIds.has(String(v.guid)))
      fail('invalid custom version GUID');
    versionIds.add(String(v.guid));
    integer(v.version);
  }
  const soldier = record(value.soldier, [
    'displayName',
    'combatClass',
    'classInferred',
    'hero',
    'callsign',
    'stats',
    'skills',
  ]);
  string(soldier.displayName);
  string(soldier.combatClass);
  if (typeof soldier.classInferred !== 'boolean') fail('invalid class inference flag');
  if (soldier.hero !== undefined) string(soldier.hero);
  if (soldier.callsign !== undefined && soldier.callsign !== '') string(soldier.callsign);
  const stats = record(soldier.stats, [...statisticNames]);
  for (const [key, number] of Object.entries(stats)) {
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0)
      fail('invalid statistic');
    if (key !== 'Accuracy') integer(number);
    else if (number > 3.4028234663852886e38) fail('accuracy exceeds float32');
  }
  const slots = new Set<number>();
  for (const entry of array(soldier.skills, 64)) {
    const slot = record(entry, ['slot', 'status', 'ability']);
    const index = integer(slot.slot, 63);
    if (slots.has(index)) fail('duplicate skill slot');
    slots.add(index);
    if (!['Empty', 'Equipped', 'Unknown'].includes(String(slot.status)))
      fail('invalid skill status');
    if (slot.ability !== undefined) string(slot.ability);
  }
  const ids = new Set<string>();
  const references: string[] = [];
  let nodes = 0;
  function identifier(id: unknown): string {
    const result = string(id, 32);
    if (!/^(object|binding)-\d+$/.test(result)) fail('invalid package-local identifier');
    return result;
  }
  function declare(id: unknown): void {
    const key = identifier(id);
    if (ids.has(key)) fail('duplicate object identifier');
    ids.add(key);
  }
  function body(input: unknown, depth = 0): void {
    if (depth > 64) fail('nesting limit exceeded');
    for (const entry of array(input, MAX_NODES)) {
      if (++nodes > MAX_NODES) fail('node limit exceeded');
      const n = record(entry, ['kind', 'hex', 'id', 'name', 'type', 'tagHex', 'payload']);
      switch (n.kind) {
        case 'native':
          record(n, ['kind', 'hex']);
          hex(n.hex);
          break;
        case 'reference':
          record(n, ['kind', 'id']);
          references.push(identifier(n.id));
          break;
        case 'preserve':
          record(n, ['kind', 'name']);
          if (!preserved.has(string(n.name))) fail('unsupported preserved property');
          break;
        case 'property': {
          record(n, ['kind', 'name', 'type', 'tagHex', 'payload']);
          if (preserved.has(string(n.name))) fail('destination-owned property override');
          const r = new BinaryReader(Buffer.from(hex(n.tagHex), 'hex'));
          if (r.fstring(256) !== n.name || r.fstring(128) !== string(n.type))
            fail('property tag mismatch');
          r.u32();
          r.i32();
          if (
            ['StructProperty', 'ArrayProperty', 'ByteProperty', 'EnumProperty'].includes(
              String(n.type),
            )
          ) {
            r.fstring(256);
            if (n.type === 'StructProperty') r.skip(16);
          } else if (n.type === 'BoolProperty') {
            if (r.u8() > 1) fail('invalid boolean tag');
          }
          if (r.offset !== r.end) fail('unexpected property tag bytes');
          body(n.payload, depth + 1);
          break;
        }
        default:
          fail('unknown body node');
      }
    }
  }
  const objects = array(value.objects, MAX_OBJECTS);
  if (!objects.length) fail('missing soldier object');
  const outers = new Map<string, string | null>();
  for (const entry of objects) {
    const o = record(entry, ['id', 'name', 'classPath', 'outerPath', 'flags', 'outer', 'body']);
    declare(o.id);
    if (!String(o.id).startsWith('object-')) fail('invalid object identifier namespace');
    string(o.name);
    string(o.classPath);
    string(o.outerPath);
    if (!/^-?\d{1,20}$/.test(string(o.flags))) fail('invalid object flags');
    if (o.outer !== null) references.push(identifier(o.outer));
    outers.set(String(o.id), o.outer as string | null);
    body(o.body);
  }
  for (const entry of array(value.bindings, MAX_OBJECTS)) {
    const b = record(entry, ['id', 'role', 'classPath', 'name']);
    declare(b.id);
    if (!String(b.id).startsWith('binding-')) fail('invalid binding identifier namespace');
    string(b.classPath);
    string(b.name);
    if (
      !['campaign', 'roster', 'inventory', 'other-character', 'unresolved'].includes(String(b.role))
    )
      fail('invalid destination binding');
  }
  if (ids.size > MAX_OBJECTS) fail('too many dependencies');
  const root = identifier(value.root);
  const main = objects.find((entry) => (entry as Record<string, unknown>).id === root) as
    Record<string, unknown> | undefined;
  if (!main || main.classPath !== '/Script/GanderGame.GanderCharacterData')
    fail('missing soldier root');
  if (
    objects.filter((entry) =>
      String((entry as Record<string, unknown>).classPath).endsWith('.GanderCharacterData'),
    ).length !== 1
  )
    fail('expected exactly one soldier');
  for (const ref of references) if (!ids.has(ref)) fail(`unresolved reference ${ref}`);
  if (value.weaponDefinitions !== undefined) {
    const seen = new Set<string>();
    for (const entry of array(value.weaponDefinitions, 4)) {
      const d = record(entry, ['id', 'kind', 'flag', 'level']);
      const id = identifier(d.id);
      const object = objects.find((o) => (o as Record<string, unknown>).id === id) as
        Record<string, unknown> | undefined;
      if (seen.has(id) || object?.classPath !== '/Script/GanderGame.WeaponData')
        fail('invalid weapon definition reference');
      seen.add(id);
      integer(d.kind, 255);
      if (d.flag !== 1 || integer(d.level, 100) < 1) fail('invalid weapon definition metadata');
    }
  }
  if (value.inventoryDefinitions !== undefined) {
    const seen = new Set<string>();
    for (const entry of array(value.inventoryDefinitions, 10000)) {
      const d = record(entry, ['guid', 'category', 'inventoryClass', 'assetIdentity']);
      if (
        !/^[0-9a-f]{32}$/.test(string(d.guid)) ||
        !['armour', 'mod', 'cosmetic'].includes(String(d.category))
      )
        fail('invalid inventory definition');
      string(d.inventoryClass);
      if (d.assetIdentity !== undefined) string(d.assetIdentity, 8192);
      const key = `${d.guid}:${d.inventoryClass}`;
      if (seen.has(key)) fail('duplicate inventory dependency');
      seen.add(key);
    }
  }
  for (const id of outers.keys()) {
    const seen = new Set<string>();
    let current: string | null | undefined = id;
    while (current && outers.has(current)) {
      if (seen.has(current)) fail('cyclic object ownership');
      seen.add(current);
      current = outers.get(current);
    }
  }
  // The schema carries opaque native bytes. Valid JSON is never treated as safe to relocate.
  return json as SoldierPackage;
}

/** Pure compatibility assessment. No filesystem or session mutation. */
export function previewSoldierImport(
  save: GearsTacticsSave,
  pkg: SoldierPackage,
): Omit<SoldierImportPreview, 'token' | 'revision'> {
  const blockers: string[] = [];
  if (!save.canSave) blockers.push('The destination save has blocking parser diagnostics.');
  if (
    pkg.source.saveVersion !== save.header.saveVersion ||
    pkg.source.packageVersion !== save.header.packageVersion ||
    pkg.source.engineVersion !== save.header.engineVersion
  )
    blockers.push('The source and destination save formats differ.');
  const destinationMode = transferGameType(save);
  if (!destinationMode || pkg.source.gameType === 'Unknown')
    blockers.push('The game mode could not be identified. Re-export old soldier archives.');
  else if (pkg.source.gameType !== destinationMode)
    blockers.push('The source and destination game modes differ.');
  if (pkg.source.gameState !== 'ConvoyMeta' || save.campaign.gameState !== 'ConvoyMeta')
    blockers.push(
      'Only campaign/barracks saves are in scope; active-combat transfers are unavailable.',
    );
  const destinationVersions = new Map(
    save.roots.flatMap((r) => r.versions.map((v) => [v.guid, v.version] as const)),
  );
  if (pkg.source.customVersions.some((v) => destinationVersions.get(v.guid) !== v.version))
    blockers.push('Native serialization versions differ.');
  if (pkg.soldier.classInferred)
    blockers.push(
      'The source class is inferred from an omitted value and has not been verified for transfer.',
    );
  blockers.push(...nativeTransferFindings(save, pkg));
  const add: { blockers: string[] } = { blockers: [] };
  if (heroId(pkg.soldier.hero))
    add.blockers.push('Heroes and Jack can only replace the same hero already in this save.');
  let recruited: Set<number> | undefined;
  try {
    recruited = new Set(readNativeRoster(save).groups[0]!.map((entry) => entry.objectIndex));
    if (
      save.campaign.rosterCapacity === undefined ||
      recruited.size >= save.campaign.rosterCapacity
    )
      add.blockers.push(
        'No verified spare roster capacity. The roster will not be expanded automatically.',
      );
    const assigned = assignedSoldiers(save);
    if (
      !save.characters.some(
        (c) =>
          recruited!.has(c.objectIndex) &&
          !assigned.has(c.objectIndex) &&
          !heroId(c.hero) &&
          c.combatClass === pkg.soldier.combatClass &&
          !c.classInferred &&
          !save.objects[c.objectIndex]!.properties.some((p) =>
            ['SquadId', 'SquadSlotId', 'PreviousStatus'].includes(p.name),
          ),
      )
    )
      add.blockers.push('No unassigned same-class recruit template with verified defaults.');
  } catch {
    add.blockers.push('Native roster membership could not be verified.');
  }
  const replacements = save.characters.map((c) => {
    const reasons: string[] = [];
    if (!recruited?.has(c.objectIndex))
      reasons.push('Replacement requires an existing recruited soldier.');
    if (c.combatClass !== pkg.soldier.combatClass)
      reasons.push('Replacement requires the same class.');
    if (heroId(c.hero) !== heroId(pkg.soldier.hero))
      reasons.push('Heroes must match; regular recruits cannot replace a hero.');
    if (c.classInferred)
      reasons.push('The destination class is inferred and has not been verified for transfer.');
    return { objectIndex: c.objectIndex, displayName: c.displayName, blockers: reasons };
  });
  if (
    heroId(pkg.soldier.hero) &&
    !save.characters.some((c) => heroId(c.hero) === heroId(pkg.soldier.hero))
  )
    blockers.push('This hero is not present in the destination save. Import cannot unlock a hero.');
  return {
    soldier: pkg.soldier,
    objectCount: pkg.objects.length,
    blockers,
    add,
    replacements,
    canApply:
      blockers.length === 0 &&
      (add.blockers.length === 0 || replacements.some((r) => r.blockers.length === 0)),
  };
}
