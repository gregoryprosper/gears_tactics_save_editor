import { abilityLabel } from '../domain/AbilityCard';
import type { CharacterCardSlot } from '../domain/Character';
import { ObjectResolver } from './ObjectResolver';
import { findProperty } from './PropertyParser';
import type { ParseWarning, SaveObject } from './types';
export function parseSkills(
  character: SaveObject,
  resolver: ObjectResolver,
  warnings: ParseWarning[],
): CharacterCardSlot[] {
  return resolver
    .children(character.index)
    .filter((o) => o.classPath.endsWith('.GanderCharacterCardSlot'))
    .map<CharacterCardSlot>((o) => {
      const number = findProperty(o.properties, 'SlotNum')?.value;
      const status = String(findProperty(o.properties, 'SlotStatus')?.value ?? '')
        .split('::')
        .pop();
      const ability = findProperty(o.properties, 'AbilityCard');
      const abilityCard =
        ability?.referenceIndex !== undefined
          ? resolver.resolve(ability.referenceIndex)
          : undefined;
      if (abilityCard && !abilityCard.name)
        warnings.push({
          code: 'UNRESOLVED_ABILITY',
          severity: 'error',
          message: 'AbilityCard object could not be resolved',
          objectIndex: o.index,
          blocksSaving: true,
        });
      return {
        objectIndex: o.index,
        slotNumber: typeof number === 'number' ? number : 0,
        inferredSlotNumber: number === undefined,
        status: status === 'Empty' || status === 'Equipped' ? status : 'Unknown',
        abilityCard,
        abilityLabel: abilityCard?.name ? abilityLabel(abilityCard.name) : undefined,
      };
    })
    .sort((a, b) => a.slotNumber - b.slotNumber);
}
