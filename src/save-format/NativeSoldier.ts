import { BinaryReader } from './BinaryReader';
import { readFrame } from './ObjectArchive';
import { readPropertyList, structArray, findProperty } from './PropertyParser';
import { serialize } from './index';
import { readWeaponRegistry } from './WeaponRegistry';
import type { GearsTacticsSave, SaveObject } from './types';
import type { SoldierNode, SoldierPackage } from '../shared/soldier';

/** Classic omits SaveInfo.GameType; its concrete inventory class identifies the mode. */
export function transferGameType(save: GearsTacticsSave): string | undefined {
  if (save.campaign.gameType) return save.campaign.gameType;
  const inventories = save.objects.filter((o) => o.classPath.includes('GanderMetaInventory_'));
  return inventories.length === 1 &&
    inventories[0]!.classPath ===
      '/Game/Gameplay/Meta/GanderMetaInventory_BP.GanderMetaInventory_BP_C'
    ? 'Classic'
    : undefined;
}

/** Reads primitive native data without mistaking a framed object for an integer. */
class Tokens {
  position = 0;
  private byte = 0;
  constructor(readonly nodes: SoldierNode[]) {}
  take(length: number): Buffer {
    const chunks: Buffer[] = [];
    while (length) {
      const node = this.nodes[this.position];
      if (node?.kind !== 'native') throw new Error('Unmapped native soldier field');
      const bytes = Buffer.from(node.hex, 'hex');
      const amount = Math.min(length, bytes.length - this.byte);
      if (!amount) throw new Error('Empty native soldier field');
      chunks.push(bytes.subarray(this.byte, this.byte + amount));
      this.byte += amount;
      length -= amount;
      if (this.byte === bytes.length) {
        this.position++;
        this.byte = 0;
      }
    }
    return Buffer.concat(chunks);
  }
  i32(): number {
    return this.take(4).readInt32LE();
  }
  u8(): number {
    return this.take(1)[0]!;
  }
  count(max: number): number {
    const count = this.i32();
    if (count < 0 || count > max) throw new Error('Invalid native soldier count');
    return count;
  }
  flag(): number {
    return this.count(1);
  }
  guid(): string {
    return this.take(16).toString('hex');
  }
  ref(): string | null {
    const node = this.nodes[this.position];
    if (!this.byte && node?.kind === 'reference') {
      this.position++;
      return node.id;
    }
    if (this.i32() !== -1) throw new Error('Unmapped native object reference');
    return null;
  }
  finish(): void {
    if (this.byte || this.position !== this.nodes.length)
      throw new Error('Unmapped native soldier suffix');
  }
}
export interface NativeItem {
  guid: string;
  kind: number;
  flag: number;
}
export interface NativeSoldier {
  campaign: string;
  inventory: string;
  properties: SoldierNode[];
  equipment: (NativeItem | null)[];
  weapons: { reference: string | null; flag?: number; modifications?: (NativeItem | null)[] }[];
  skillTree: (string | null)[][];
  skillOrder: number[];
  slotCapacity: number;
  slots: string[];
  units: (string | null)[];
}

/** Complete native character envelope observed across Classic/Jacked, including Jack. */
export function readNativeSoldier(body: SoldierNode[]): NativeSoldier {
  const r = new Tokens(body);
  const campaign = r.ref(),
    inventory = r.ref();
  if (!campaign || !inventory) throw new Error('Missing native character context');
  const properties: SoldierNode[] = [];
  while (['property', 'preserve'].includes(body[r.position]?.kind ?? ''))
    properties.push(body[r.position++]!);
  if (!r.take(13).equals(Buffer.from('050000004e6f6e650000000000', 'hex')))
    throw new Error('Unsupported character property terminator/GUID');
  const equipment = Array.from({ length: 4 }, () =>
    r.flag() ? { guid: r.guid(), kind: r.u8(), flag: r.flag() } : null,
  );
  const weapons: NativeSoldier['weapons'] = Array.from({ length: 4 }, () => {
    const reference = r.ref();
    return reference ? { reference, flag: r.flag() } : { reference };
  });
  for (const weapon of weapons) {
    if (!weapon.reference) continue;
    if (r.ref() !== campaign || r.ref() !== inventory)
      throw new Error('Weapon context differs from its soldier');
    if (r.count(7) !== 7) throw new Error('Unsupported weapon modification layout');
    weapon.modifications = Array.from({ length: 7 }, (_, slot) => {
      const kind = r.u8();
      if (kind === 7) return null;
      if (kind !== slot) throw new Error('Weapon modification slot does not match its index');
      return { kind, guid: r.guid(), flag: r.flag() };
    });
  }
  const count = r.count(128);
  const skillTree = Array.from({ length: count }, () => [r.ref(), r.ref(), r.ref()]);
  const orderCount = r.count(128);
  const skillOrder = Array.from({ length: orderCount }, () => r.i32());
  if (
    orderCount !== count ||
    new Set(skillOrder).size !== orderCount ||
    skillOrder.some((v) => v < 0 || v >= 128)
  )
    throw new Error('Skill tree ordering contains invalid or repeated nodes');
  const slotCapacity = r.count(64),
    slotCount = r.count(64);
  if (slotCapacity !== slotCount || ![10, 21].includes(slotCount))
    throw new Error('Unsupported native card-slot layout');
  if (skillOrder.some((v) => v >= (slotCount === 21 ? 28 : 35)))
    throw new Error('Skill node index exceeds the class tree');
  const slots = Array.from({ length: slotCount }, () => r.ref());
  if (slots.some((slot) => !slot) || new Set(slots).size !== slots.length)
    throw new Error('Missing or duplicate native card slots');
  const units = Array.from({ length: 5 }, () => r.ref());
  r.finish();
  return {
    campaign,
    inventory,
    properties,
    equipment,
    weapons,
    skillTree,
    skillOrder,
    slotCapacity,
    slots: slots as string[],
    units,
  };
}

export interface NativeRoster {
  objectIndex: number;
  groupCountOffsets: number[];
  groupEndOffsets: number[];
  groups: { objectIndex: number; hero: number; referenceOffset: number }[][];
}
export function readNativeRoster(save: GearsTacticsSave): NativeRoster {
  const candidates = save.objects.filter((o) => o.classPath.includes('GanderCharacterRoster'));
  if (candidates.length !== 1 || !candidates[0]!.body) throw new Error('Ambiguous roster layout');
  const object = candidates[0]!,
    frame = object.body!,
    bytes = serialize(save);
  const r = new BinaryReader(bytes, frame.bodyOffset, frame.endOffset);
  const reference = () => readFrame(r, frame.rootBase, save.objects.length);
  reference();
  reference();
  const groupCountOffsets: number[] = [],
    groupEndOffsets: number[] = [];
  const groups = Array.from({ length: 4 }, () => {
    groupCountOffsets.push(r.offset);
    const count = r.count(1000);
    const entries = Array.from({ length: count }, () => {
      if (r.i32() !== 1) r.fail('Unsupported roster entry discriminator');
      const hero = r.u8(),
        referenceOffset = r.offset,
        ref = reference();
      if (!ref || !save.characters.some((c) => c.objectIndex === ref.index))
        r.fail('Invalid roster character');
      return { objectIndex: ref!.index, hero, referenceOffset };
    });
    groupEndOffsets.push(r.offset);
    return entries;
  });
  const properties = readPropertyList(r);
  if (r.i32() !== 0 || r.offset !== r.end) r.fail('Unmapped roster data');
  const indices = groups.flat().map((c) => c.objectIndex);
  if (new Set(indices).size !== indices.length || indices.length !== save.characters.length)
    r.fail('Roster membership is incomplete or duplicated');
  // Cross-check the native reserve list against the independently tagged RecruitmentPool.
  const pool = findProperty(properties, 'RecruitmentPool');
  if (pool && pool.metadata === 'ObjectProperty') {
    const poolReader = new BinaryReader(bytes, pool.valueOffset, pool.endOffset);
    const count = poolReader.count(1000);
    const entries = Array.from(
      { length: count },
      () => readFrame(poolReader, frame.rootBase, save.objects.length)?.index,
    );
    if (
      poolReader.offset !== poolReader.end ||
      JSON.stringify(entries) !== JSON.stringify(groups[1]!.map((c) => c.objectIndex))
    )
      poolReader.fail('RecruitmentPool differs from native reserves');
  } else if (pool && pool.metadata === 'StructProperty') {
    const entries = structArray(bytes, pool).map(
      (entry) => findProperty(entry, 'Recruit')?.referenceIndex,
    );
    if (JSON.stringify(entries) !== JSON.stringify(groups[1]!.map((c) => c.objectIndex)))
      r.fail('RecruitmentPool differs from native reserves');
  } else if (pool || groups[1]!.length) {
    r.fail('Unsupported recruitment pool layout');
  }
  return { objectIndex: object.index, groupCountOffsets, groupEndOffsets, groups };
}

export interface InventoryDefinition {
  guid: string;
  category: 'armour' | 'mod' | 'cosmetic';
  inventoryClass: string;
  quantity?: number;
  assetIdentity?: string;
  linkedGuid?: string;
}
export function readInventoryDefinitions(save: GearsTacticsSave): InventoryDefinition[] {
  const bytes = serialize(save),
    result: InventoryDefinition[] = [];
  for (const object of save.objects) {
    const numeric = /\.Gander(Armour|WeaponMod)MetaInventory$/.test(object.classPath);
    const cosmetic =
      /^\/Script\/GanderGame\.Gander(?:SkinPart\w+|Accessories|HairTints|BodyDecals|Undergarments)Inventory$/.test(
        object.classPath,
      );
    if (!numeric && !cosmetic) continue;
    const frame = object.body;
    if (!frame) throw new Error('Inventory has no body');
    const r = new BinaryReader(bytes, frame.bodyOffset, frame.endOffset);
    if (readPropertyList(r).length || r.i32() !== 0) r.fail('Unsupported inventory property data');
    if (numeric) {
      readFrame(r, frame.rootBase, save.objects.length);
      readFrame(r, frame.rootBase, save.objects.length);
    }
    const count = r.count(10000),
      seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const guid = r.bytes(16).toString('hex');
      if (seen.has(guid)) r.fail('Duplicate inventory definition');
      seen.add(guid);
      if (numeric) {
        const quantity = r.i32();
        const linkedGuid = r.bytes(16).toString('hex');
        if (quantity < 0) r.fail('Unsupported negative inventory quantity');
        result.push({
          guid,
          category: object.classPath.includes('Armour') ? 'armour' : 'mod',
          quantity,
          linkedGuid,
          inventoryClass: object.classPath,
        });
      } else {
        const ref = readFrame(r, frame.rootBase, save.objects.length);
        if (!ref) r.fail('Missing inventory asset');
        const asset = save.objects[ref!.index]!;
        // Undergarment prototypes acquire runtime names (e.g. TShirt01 -> GanderArmourData_95).
        // The catalog GUID is their identity; require the observed empty default body as well.
        const runtimeDefault =
          asset.classPath === '/Script/GanderGame.GanderArmourData' &&
          asset.outerPath === '/Engine/Transient';
        if (
          runtimeDefault &&
          (!asset.body ||
            !bytes
              .subarray(asset.body.bodyOffset, asset.body.endOffset)
              .equals(Buffer.from('050000004e6f6e650000000000', 'hex')))
        )
          r.fail('Unsupported runtime cosmetic definition');
        result.push({
          guid,
          category: 'cosmetic',
          inventoryClass: object.classPath,
          assetIdentity: runtimeDefault
            ? JSON.stringify([asset.classPath, 'catalog-default', guid])
            : assetIdentity(asset),
        });
      }
    }
    if (r.offset !== r.end) r.fail('Unmapped inventory suffix');
  }
  return result;
}
export function assetIdentity(
  object: Pick<SaveObject, 'classPath' | 'outerPath' | 'name'>,
): string {
  return JSON.stringify([object.classPath, object.outerPath, object.name]);
}

/** Squad membership, not omitted scalar defaults, determines whether a template is unassigned. */
export function assignedSoldiers(save: GearsTacticsSave): Set<number> {
  const bytes = serialize(save),
    assigned = new Set<number>();
  for (const object of save.objects.filter((o) => o.classPath.includes('GanderSquadInfo'))) {
    const squads = findProperty(object.properties, 'Squads');
    if (!squads || !object.body) throw new Error('Unsupported squad layout');
    for (const squad of structArray(bytes, squads)) {
      const members = findProperty(squad, 'Members');
      if (!members) continue;
      const r = new BinaryReader(bytes, members.valueOffset, members.endOffset),
        count = r.count(1000);
      for (let i = 0; i < count; i++) {
        const ref = readFrame(r, object.body.rootBase, save.objects.length);
        if (ref) assigned.add(ref.index);
      }
      if (r.offset !== r.end) r.fail('Unmapped squad membership');
    }
  }
  return assigned;
}

export function nativeTransferFindings(save: GearsTacticsSave, pkg: SoldierPackage): string[] {
  const failures: string[] = [];
  try {
    const root = pkg.objects.find((o) => o.id === pkg.root)!;
    const native = readNativeSoldier(root.body);
    if (
      pkg.bindings.find((b) => b.id === native.campaign)?.role !== 'campaign' ||
      pkg.bindings.find((b) => b.id === native.inventory)?.role !== 'inventory'
    )
      throw new Error('Invalid native campaign/inventory bindings');
    if (!pkg.inventoryDefinitions)
      throw new Error('Re-export this soldier to include native inventory dependencies.');
    const definitions = readInventoryDefinitions(save);
    const needed = [
      ...native.equipment.filter((i) => i !== null),
      ...native.weapons.flatMap((w) => w.modifications?.filter((i) => i !== null) ?? []),
    ];
    for (const item of needed) {
      if (!pkg.inventoryDefinitions.some((d) => d.guid === item.guid))
        throw new Error(`Missing exported item definition ${item.guid}`);
    }
    for (const required of pkg.inventoryDefinitions) {
      const matches = definitions.filter(
        (d) => d.guid === required.guid && d.inventoryClass === required.inventoryClass,
      );
      if (
        matches.length !== 1 ||
        matches[0]!.category !== required.category ||
        matches[0]!.assetIdentity !== required.assetIdentity
      )
        throw new Error(
          `Destination does not contain the matching ${required.category} definition ${required.guid}`,
        );
    }
    const byId = new Map(pkg.objects.map((o) => [o.id, o]));
    if (!pkg.weaponDefinitions)
      throw new Error('Re-export the soldier to include weapon registry definitions');
    const registry = readWeaponRegistry(save);
    const usedWeapons = new Set(native.weapons.flatMap((w) => (w.reference ? [w.reference] : [])));
    if (pkg.weaponDefinitions.some((d) => !usedWeapons.has(d.id)))
      throw new Error('Weapon definition is not equipped by the soldier');
    for (const [slot, weapon] of native.weapons.entries()) {
      if (!weapon.reference) continue;
      const definition = pkg.weaponDefinitions.find((d) => d.id === weapon.reference);
      if (!definition) throw new Error('Missing exported weapon registry definition');
      if (!registry.groups[slot]!.some((entry) => entry.kind === definition.kind))
        throw new Error('Destination has no matching weapon type in the required loadout slot');
    }
    for (const weapon of native.weapons)
      if (
        weapon.reference &&
        byId.get(weapon.reference)?.classPath !== '/Script/GanderGame.WeaponData'
      )
        throw new Error('Invalid native weapon reference');
    for (const references of native.skillTree)
      for (const ref of references)
        if (
          ref &&
          ![
            '/Script/GanderGame.GanderAbilityCard',
            '/Script/Engine.BlueprintGeneratedClass',
          ].includes(byId.get(ref)?.classPath ?? '')
        )
          throw new Error('Invalid native skill reference');
    for (const slot of native.slots) {
      const object = byId.get(slot);
      if (object?.outer !== pkg.root || !object.classPath.endsWith('.GanderCharacterCardSlot'))
        throw new Error('Invalid native slot ownership');
    }
    for (const object of pkg.objects) {
      if (object.id === pkg.root) continue;
      const leafClasses = [
        'CoreUObject.Package',
        'GearGame.GUDBank',
        ...[
          'GanderAISpawnTypeInfo',
          'GanderAbilityCard',
          'GanderAccessory',
          'GanderBodyDecal',
          'GanderBodyPart',
          'GanderCharacterCardSlot',
          'GanderCharacterSkin',
          'GanderHairTint',
          'GanderSkinPartPaint',
          'GanderSkinPartPattern',
          'GanderSkinPartTone',
          'GanderSkinPartWeaponDecal',
          'WeaponData',
        ].map((c) => `GanderGame.${c}`),
      ].map((c) => `/Script/${c}`);
      if (object.classPath === '/Script/Engine.BlueprintGeneratedClass') {
        if (object.body.length !== 1 || object.body[0]!.kind !== 'native')
          throw new Error('Unsupported blueprint class body');
        const r = new BinaryReader(Buffer.from(object.body[0]!.hex, 'hex'));
        if (r.fstring() !== `${object.outerPath}.${object.name}` || r.offset !== r.end)
          throw new Error('Blueprint identity mismatch');
      } else {
        if (!leafClasses.includes(object.classPath))
          throw new Error(`Unsupported soldier dependency class: ${object.classPath}`);
        const end = object.body.at(-1);
        if (
          !end ||
          end.kind !== 'native' ||
          end.hex !== '050000004e6f6e650000000000' ||
          object.body.slice(0, -1).some((n) => n.kind !== 'property')
        )
          throw new Error(`Unmapped native dependency body: ${object.name}`);
      }
    }
    readNativeRoster(save);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  return failures;
}
