import { BinaryReader } from './BinaryReader';
import { readFrame } from './ObjectArchive';
import { readPropertyList } from './PropertyParser';
import { abilityLabel } from '../domain/AbilityCard';
import type { LearnedSkillTree, LearnedSkillReference } from '../domain/Character';
import type { SaveObject } from './types';

/** Read the observed native character envelope; never infer learned skills from equipped cards. */
export function parseLearnedSkills(
  buffer: Buffer,
  character: SaveObject,
  objects: SaveObject[],
): LearnedSkillTree {
  const frame = character.body;
  if (!frame) throw new Error('Character body is unavailable');
  const r = new BinaryReader(buffer, frame.bodyOffset, frame.endOffset);
  const ref = () => readFrame(r, frame.rootBase, objects.length)?.index;
  const campaign = ref(),
    inventory = ref();
  if (campaign === undefined || inventory === undefined) r.fail('Missing character context');
  readPropertyList(r);
  if (r.i32() !== 0) r.fail('Unsupported character property GUID');
  for (let i = 0; i < 4; i++) {
    if (r.count(1)) {
      r.skip(16);
      r.u8();
      r.count(1);
    }
  }
  const weapons = Array.from({ length: 4 }, () => {
    const index = ref();
    if (index !== undefined) r.count(1);
    return index;
  });
  for (const weapon of weapons) {
    if (weapon === undefined) continue;
    if (ref() !== campaign || ref() !== inventory) r.fail('Weapon context mismatch');
    if (r.count(7) !== 7) r.fail('Unsupported weapon mod layout');
    for (let slot = 0; slot < 7; slot++) {
      const kind = r.u8();
      if (kind === 7) continue;
      if (kind !== slot) r.fail('Invalid weapon mod slot');
      r.skip(16);
      r.count(1);
    }
  }
  const reference = (kind: 'ability' | 'passive' | 'effect'): LearnedSkillReference | undefined => {
    const index = ref();
    if (index === undefined) return undefined;
    const object = objects[index]!;
    const expected = kind === 'ability' ? '.GanderAbilityCard' : '.BlueprintGeneratedClass';
    if (!object.classPath.endsWith(expected)) r.fail('Unsupported learned skill reference');
    return {
      index,
      name: object.name,
      label: abilityLabel(
        object.name.replace(/^BP_(?:Passive|WeaponEffect)_/, '').replace(/_C$/, ''),
      ),
    };
  };
  const count = r.count(128);
  const nodes = Array.from({ length: count }, () => ({
    ability: reference('ability'),
    passive: reference('passive'),
    effect: reference('effect'),
  }));
  if (nodes.some((n) => !n.ability && !n.passive && !n.effect)) r.fail('Empty learned skill node');
  if (r.count(128) !== count) r.fail('Learned skill ordering count mismatch');
  const order = Array.from({ length: count }, () => r.i32());
  const capacity = r.count(64),
    slots = r.count(64);
  if (capacity !== slots || ![10, 21].includes(slots)) r.fail('Unsupported card-slot layout');
  const totalNodes = slots === 21 ? 28 : 35;
  if (new Set(order).size !== count || order.some((i) => i < 0 || i >= totalNodes))
    r.fail('Invalid learned skill node ordering');
  const slotRefs = Array.from({ length: slots }, ref);
  if (
    new Set(slotRefs).size !== slots ||
    slotRefs.some(
      (index) =>
        index === undefined ||
        !objects[index]!.classPath.endsWith('.GanderCharacterCardSlot') ||
        objects[index]!.body?.outerIndex !== character.index,
    )
  )
    r.fail('Invalid character card slots');
  for (let i = 0; i < 5; i++) ref();
  if (r.offset !== r.end) r.fail('Unsupported character suffix');
  return { totalNodes, nodes: nodes.map((node, i) => ({ ...node, nodeIndex: order[i]! })) };
}
