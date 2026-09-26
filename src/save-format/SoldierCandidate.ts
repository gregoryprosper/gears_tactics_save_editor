import { randomUUID } from 'node:crypto';
import { parse } from './index';
import { BinaryReader } from './BinaryReader';
import { readWeaponRegistry, writeWeaponRegistry } from './WeaponRegistry';
import { readSoldierPackage, stringifySoldierPackage } from './SoldierTransfer';
import {
  assetIdentity,
  assignedSoldiers,
  readNativeRoster,
  nativeTransferFindings,
  readNativeSoldier,
  transferGameType,
} from './NativeSoldier';
import {
  readArchiveGraph,
  writeArchiveGraph,
  integerBytes,
  type GraphNode,
  type GraphObject,
} from './GraphArchive';
import type { GearsTacticsSave } from './types';
import type { SoldierNode, SoldierPackage } from '../shared/soldier';

const protectedFields = new Set(['ActionPoints', 'SquadId', 'SquadSlotId', 'PreviousStatus']);
const hero = (value?: string): string | undefined =>
  value && value !== 'None' ? value.replace(/^SpecialHero_/, '') : undefined;

/** Canonical object content ignores physical reference placement and recomputed payload sizes. */
function canonical(nodes: GraphNode[], remap: (index: number) => number): string {
  function sequence(input: GraphNode[]): unknown[] {
    const result: unknown[] = [];
    let pending: Buffer[] = [];
    const flush = () => {
      if (pending.length) result.push(['bytes', Buffer.concat(pending).toString('hex')]);
      pending = [];
    };
    for (const n of input) {
      if (n.kind === 'bytes') pending.push(n.bytes);
      else {
        flush();
        result.push(node(n));
      }
    }
    flush();
    return result;
  }
  function node(n: GraphNode): unknown {
    switch (n.kind) {
      case 'bytes':
        return ['bytes', n.bytes.toString('hex')];
      case 'reference':
        return ['ref', remap(n.index)];
      case 'root':
        return ['root', sequence(n.body), n.versions.toString('hex')];
      case 'property': {
        const tag = Buffer.from(n.tag),
          r = new BinaryReader(tag);
        r.fstring();
        r.fstring();
        tag.writeUInt32LE(0, r.offset);
        return ['property', tag.toString('hex'), sequence(n.payload)];
      }
    }
  }
  return JSON.stringify(sequence(nodes));
}

export interface SoldierCandidate {
  bytes: Buffer;
  soldierIndex: number;
  report: {
    mode: 'add' | 'replace';
    soldier: string;
    destinationSoldier?: string;
    newObjects: number;
    removedUnreferencedObjects: number;
    recruitedBefore: number;
    recruitedAfter: number;
    gameValidated: false;
  };
}

/**
 * Builds validated structural output for the session and separate game-test copies.
 * Production Apply additionally checks the revision-bound preview in EditingSession.
 * All package bytes are reparsed and every surviving unrelated object is compared after relocation.
 */
export function buildSoldierCandidate(
  destination: GearsTacticsSave,
  input: SoldierPackage,
  mode: 'add' | 'replace',
  targetIndex?: number,
): SoldierCandidate {
  const pkg = readSoldierPackage(stringifySoldierPackage(input));
  if (!destination.canSave) throw new Error('Destination has blocking parser diagnostics');
  if (destination.campaign.gameState !== 'ConvoyMeta' || pkg.source.gameState !== 'ConvoyMeta')
    throw new Error('Only campaign/barracks candidates are supported');
  if (
    pkg.source.gameType === 'Unknown' ||
    pkg.source.gameType !== transferGameType(destination) ||
    pkg.source.saveVersion !== destination.header.saveVersion ||
    pkg.source.packageVersion !== destination.header.packageVersion ||
    pkg.source.engineVersion !== destination.header.engineVersion
  )
    throw new Error('Source and destination formats or modes differ');
  const versions = new Map(
    destination.roots.flatMap((r) => r.versions.map((v) => [v.guid, v.version] as const)),
  );
  if (pkg.source.customVersions.some((v) => versions.get(v.guid) !== v.version))
    throw new Error('Native serialization versions differ');
  if (pkg.soldier.classInferred) throw new Error('An inferred class is not verified for transfer');
  const findings = nativeTransferFindings(destination, pkg);
  if (findings.length) throw new Error(findings.join('\n'));
  const roster = readNativeRoster(destination),
    assigned = assignedSoldiers(destination);
  if (roster.groups[2]!.length || roster.groups[3]!.length)
    throw new Error('Unsupported additional roster groups');
  let template = destination.characters.find((c) => c.objectIndex === targetIndex);
  if (mode === 'replace') {
    if (!template || !roster.groups[0]!.some((e) => e.objectIndex === template!.objectIndex))
      throw new Error('Choose an existing recruited soldier');
    if (template.combatClass !== pkg.soldier.combatClass || template.classInferred)
      throw new Error('Replacement requires the same verified class');
    if (hero(template.hero) !== hero(pkg.soldier.hero))
      throw new Error('Replacement hero identity must match');
  } else {
    if (hero(pkg.soldier.hero)) throw new Error('Adding heroes or Jack is not supported');
    // Conservative: count Jack too until exempt-slot capacity semantics have game evidence.
    if (
      destination.campaign.rosterCapacity === undefined ||
      roster.groups[0]!.length >= destination.campaign.rosterCapacity
    )
      throw new Error('No verified spare roster capacity');
    template = destination.characters.find(
      (c) =>
        c.combatClass === pkg.soldier.combatClass &&
        !c.classInferred &&
        !hero(c.hero) &&
        !assigned.has(c.objectIndex) &&
        roster.groups[0]!.some((e) => e.objectIndex === c.objectIndex) &&
        !destination.objects[c.objectIndex]!.properties.some((p) =>
          ['SquadId', 'SquadSlotId', 'PreviousStatus'].includes(p.name),
        ),
    );
    if (!template)
      throw new Error('No unassigned same-class recruit template with verified defaults');
  }
  const graph = readArchiveGraph(destination);
  const originalBodies = new Map([...graph.objects].map(([i, o]) => [i, o.body]));
  const sourceObjects = new Map(pkg.objects.map((o) => [o.id, o]));
  const mapped = new Map<string, number>();
  const templateObject = graph.objects.get(template.objectIndex)!;
  const action = templateObject.body.find(
    (n) => n.kind === 'property' && n.name === 'ActionPoints',
  );
  if (!action) throw new Error('Template has no verified action-point default');
  for (const binding of pkg.bindings) {
    if (binding.role === 'other-character' || binding.role === 'unresolved')
      throw new Error('Unresolved destination binding');
    const matches = destination.objects.filter((o) => o.classPath === binding.classPath);
    if (matches.length !== 1) throw new Error(`Ambiguous destination binding: ${binding.name}`);
    mapped.set(binding.id, matches[0]!.index);
  }
  let nextIndex = destination.objects.length;
  const nonce = randomUUID().replaceAll('-', '').slice(0, 12);
  const appended: { source: SoldierPackage['objects'][number]; object: GraphObject }[] = [];
  for (const source of pkg.objects) {
    const root = source.id === pkg.root;
    const runtime = source.outerPath.startsWith('/Engine/Transient');
    if (!root && !runtime) {
      const matches = destination.objects.filter((o) => assetIdentity(o) === assetIdentity(source));
      if (matches.length > 1) throw new Error(`Ambiguous shared asset: ${source.name}`);
      if (matches.length === 1) {
        mapped.set(source.id, matches[0]!.index);
        continue;
      }
    }
    const index = root && mode === 'replace' ? template.objectIndex : nextIndex++;
    const name =
      root && mode === 'replace'
        ? templateObject.name
        : runtime
          ? `${source.name.slice(0, 70)}_Imported_${nonce}_${index}`
          : source.name;
    const object: GraphObject = {
      index,
      name,
      classPath: source.classPath,
      outerPath: source.outerPath,
      flags: source.flags,
      outer: -1,
      body: [],
    };
    mapped.set(source.id, index);
    graph.objects.set(index, object);
    appended.push({ source, object });
  }
  const resolve = (id: string | null): number => {
    if (id === null) return -1;
    const index = mapped.get(id);
    if (index === undefined) throw new Error(`Unresolved package reference ${id}`);
    return index;
  };
  function convert(nodes: SoldierNode[]): GraphNode[] {
    return nodes.flatMap((n): GraphNode[] => {
      switch (n.kind) {
        case 'native':
          return [{ kind: 'bytes', bytes: Buffer.from(n.hex, 'hex') }];
        case 'reference':
          return [{ kind: 'reference', index: resolve(n.id) }];
        case 'preserve':
          return [];
        case 'property':
          return [
            {
              kind: 'property',
              name: n.name,
              type: n.type,
              tag: Buffer.from(n.tagHex, 'hex'),
              payload: convert(n.payload),
            },
          ];
      }
    });
  }
  const rebased = new Set<string>();
  function rebase(id: string): void {
    if (rebased.has(id)) return;
    const entry = appended.find((e) => e.source.id === id);
    if (!entry) return;
    const { source, object } = entry;
    object.outer = resolve(source.outer);
    if (id === pkg.root) object.outerPath = templateObject.outerPath;
    else if (source.outer) {
      rebase(source.outer);
      const parent = sourceObjects.get(source.outer),
        mappedParent = graph.objects.get(object.outer);
      if (parent && mappedParent) {
        if (source.outerPath === parent.name) object.outerPath = mappedParent.name;
        else if (
          source.outerPath.startsWith(parent.outerPath) &&
          source.outerPath.endsWith(parent.name)
        ) {
          const separator = source.outerPath.slice(
            parent.outerPath.length,
            source.outerPath.length - parent.name.length,
          );
          if (!['.', ':'].includes(separator))
            throw new Error('Unsupported object outer-path separator');
          object.outerPath = mappedParent.outerPath + separator + mappedParent.name;
        } else throw new Error('Object outer path does not match its owner');
      }
    }
    object.body = convert(source.body);
    if (source.classPath === '/Script/GanderGame.GanderAbilityCard')
      object.body = object.body.filter(
        (n) => !(n.kind === 'property' && n.name === 'TotalAmountOfUses'),
      );
    rebased.add(id);
  }
  for (const { source } of appended) rebase(source.id);
  const soldierIndex = resolve(pkg.root),
    newSoldier = graph.objects.get(soldierIndex)!;
  const protectedNodes = templateObject.body.filter(
    (n) => n.kind === 'property' && protectedFields.has(n.name),
  );
  let endOfProperties = 2;
  while (newSoldier.body[endOfProperties]?.kind === 'property') endOfProperties++;
  newSoldier.body.splice(endOfProperties, 0, ...protectedNodes);
  // Register new weapon instances before their character references them. The game restores
  // weapon type/level from these records, not from the sparse WeaponData property body.
  const registry = readWeaponRegistry(destination);
  const native = readNativeSoldier(sourceObjects.get(pkg.root)!.body);
  for (const [slot, weapon] of native.weapons.entries()) {
    if (!weapon.reference) continue;
    const definition = pkg.weaponDefinitions!.find((d) => d.id === weapon.reference)!;
    const entry = {
      kind: definition.kind,
      flag: definition.flag,
      level: definition.level,
      objectIndex: resolve(weapon.reference),
    };
    // The two grenade lists contain both grenade alternatives, even if only one is equipped.
    for (const group of slot >= 2 ? [2, 3] : [slot]) {
      if (!registry.groups[group]!.some((e) => e.objectIndex === entry.objectIndex))
        registry.groups[group]!.push(entry);
    }
  }
  const inventory = graph.objects.get(registry.objectIndex)!;
  inventory.body = writeWeaponRegistry(inventory.body, registry);
  if (mode === 'add') {
    const object = graph.objects.get(roster.objectIndex)!;
    const tail = object.body.findIndex((n) => n.kind === 'property');
    if (tail < 0) throw new Error('Missing roster properties');
    const groups = roster.groups.map((g) =>
      g.map((e) => ({ objectIndex: e.objectIndex, hero: e.hero })),
    );
    groups[0]!.push({ objectIndex: soldierIndex, hero: 0 });
    const body: GraphNode[] = [...object.body.slice(0, 2)];
    for (const group of groups) {
      body.push({ kind: 'bytes', bytes: integerBytes(group.length) });
      for (const entry of group)
        body.push(
          { kind: 'bytes', bytes: Buffer.concat([integerBytes(1), Buffer.from([entry.hero])]) },
          { kind: 'reference', index: entry.objectIndex },
        );
    }
    object.body = [...body, ...object.body.slice(tail)];
  }
  // Shared asset records with matching identity must also have matching serialized content.
  for (const source of pkg.objects) {
    if (appended.some((e) => e.source.id === source.id)) continue;
    const existing = graph.objects.get(resolve(source.id))!;
    const definition = (nodes: GraphNode[]) =>
      nodes.filter(
        (n) =>
          !(
            source.classPath === '/Script/GanderGame.GanderAbilityCard' &&
            n.kind === 'property' &&
            n.name === 'TotalAmountOfUses'
          ),
      );
    if (
      canonical(definition(convert(source.body)), (i) => i) !==
      canonical(definition(existing.body), (i) => i)
    )
      throw new Error(`Shared asset content differs: ${source.name}`);
  }
  const output = writeArchiveGraph(graph),
    parsed = parse(output.bytes);
  if (!parsed.canSave)
    throw new Error(
      `Candidate failed structural validation: ${parsed.warnings
        .filter((w) => w.blocksSaving)
        .map((w) => w.code)
        .join(', ')}`,
    );
  const resultGraph = readArchiveGraph(parsed),
    mappedIndex = output.indices.get(soldierIndex)!;
  const character = parsed.characters.find((c) => c.objectIndex === mappedIndex);
  if (
    !character ||
    character.combatClass !== pkg.soldier.combatClass ||
    hero(character.hero) !== hero(pkg.soldier.hero)
  )
    throw new Error('Imported identity/class does not match the package summary');
  if (character.stats.ActionPoints !== template.stats.ActionPoints)
    throw new Error('Candidate changed action points');
  if (
    character.displayName !== pkg.soldier.displayName ||
    Object.entries(pkg.soldier.stats).some(([key, value]) => character.stats[key] !== value)
  )
    throw new Error('Package summary does not match the imported identity/statistics');
  const skills = character.cardSlots.map((slot) => ({
    slot: slot.slotNumber,
    status: slot.status,
    ability: slot.abilityLabel,
  }));
  if (JSON.stringify(skills) !== JSON.stringify(pkg.soldier.skills))
    throw new Error('Package summary does not match the imported skills');
  for (const [index, before] of originalBodies) {
    if (
      index === soldierIndex ||
      (mode === 'add' && index === roster.objectIndex) ||
      !output.indices.has(index)
    )
      continue;
    const after = resultGraph.objects.get(output.indices.get(index)!)!;
    if (
      canonical(index === registry.objectIndex ? inventory.body : before, (i) =>
        i === -1 ? -1 : output.indices.get(i)!,
      ) !== canonical(after.body, (i) => i)
    )
      throw new Error(`Unrelated object changed: ${index}`);
  }
  const afterRoster = readNativeRoster(parsed);
  if (afterRoster.groups[0]!.length !== roster.groups[0]!.length + (mode === 'add' ? 1 : 0))
    throw new Error('Incorrect recruited roster count');
  if (mode === 'add' && assignedSoldiers(parsed).has(mappedIndex))
    throw new Error('New soldier was assigned to a squad');
  return {
    bytes: output.bytes,
    soldierIndex: mappedIndex,
    report: {
      mode,
      soldier: character.displayName,
      destinationSoldier: mode === 'replace' ? template.displayName : undefined,
      newObjects: appended.filter((e) => e.object.index >= destination.objects.length).length,
      removedUnreferencedObjects:
        destination.objects.length -
        [...output.indices.keys()].filter((i) => i < destination.objects.length).length,
      recruitedBefore: roster.groups[0]!.length,
      recruitedAfter: afterRoster.groups[0]!.length,
      gameValidated: false,
    },
  };
}
