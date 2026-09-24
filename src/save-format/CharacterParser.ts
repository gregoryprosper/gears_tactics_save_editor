import type { CharacterState } from '../domain/Character';
import { ObjectResolver } from './ObjectResolver';
import { findProperty } from './PropertyParser';
import { parseSkills } from './SkillParser';
import type { ParseWarning, SaveObject } from './types';
export const characterStatNames = [
  'Level',
  'Health',
  'Accuracy',
  'Strength',
  'MovementPoints',
  'ActionPoints',
  'CurrentAbilityPoints',
  'SquadId',
  'SquadSlotId',
] as const;
export interface ClassResolutionRules {
  missingCombatClass: string | undefined;
}
export const defaultClassRules: ClassResolutionRules = { missingCombatClass: 'Scout' };
const heroes: Record<string, string> = {
  Gabriel: 'Gabe Diaz',
  Sid: 'Sid Redburn',
  Mikayla: 'Mikayla Dorn',
  Reyna: 'Reyna Diaz',
  Cole: 'Augustus Cole',
  Jack: 'Jack',
  SpecialHero_Jack: 'Jack',
  SpecialHero_Cole: 'Augustus Cole',
};
export function parseCharacters(
  objects: SaveObject[],
  warnings: ParseWarning[],
  rules = defaultClassRules,
): CharacterState[] {
  const resolver = new ObjectResolver(objects);
  return objects
    .filter((o) => o.classPath.endsWith('.GanderCharacterData'))
    .map((o) => {
      const get = (name: string) => findProperty(o.properties, name);
      const literal = (name: string) =>
        get(name)?.text?.kind === 'literal' ? get(name)?.text?.text : undefined;
      const firstName = literal('Name');
      const lastName = literal('Surname');
      const callsign = literal('Callsign');
      const hero =
        String(get('CharacterHero')?.value ?? '')
          .split('::')
          .pop() || undefined;
      const internalClass =
        typeof get('CombatClass')?.value === 'string'
          ? String(get('CombatClass')!.value).split('::').pop()
          : undefined;
      const inferred = internalClass === undefined && rules.missingCombatClass !== undefined;
      if (inferred)
        warnings.push({
          code: 'INFERRED_SCOUT',
          severity: 'info',
          message: `${o.name}: ${rules.missingCombatClass} inferred because CombatClass is absent`,
          objectIndex: o.index,
          blocksSaving: false,
        });
      const klass = internalClass ?? rules.missingCombatClass ?? 'Unknown';
      const stats: Record<string, number> = {};
      for (const name of characterStatNames) {
        const value = get(name)?.value;
        if (typeof value === 'number') stats[name] = value;
      }
      const cardSlots = parseSkills(o, resolver, warnings);
      if (cardSlots.length !== 10 && cardSlots.length !== 21)
        warnings.push({
          code: 'SLOT_COUNT',
          severity: 'warning',
          message: `${o.name} has ${cardSlots.length} discovered card slots`,
          objectIndex: o.index,
          blocksSaving: false,
        });
      const displayName =
        [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ') ||
        (hero ? heroes[hero] : undefined) ||
        o.name.replace(/^GanderCharacter(?:Data)?_/, '').replace(/_/g, ' ');
      return {
        objectIndex: o.index,
        objectName: o.name,
        displayName,
        firstName,
        lastName,
        callsign,
        showCallsign:
          typeof get('bShowCallsign')?.value === 'boolean'
            ? Boolean(get('bShowCallsign')!.value)
            : undefined,
        hero,
        combatClass: klass === 'Medic' ? 'Support' : klass === 'Jackbot' ? 'Jack' : klass,
        internalClass,
        classInferred: inferred,
        stats,
        cardSlots,
        unitReferences: resolver
          .children(o.index)
          .filter((child) => child.name.startsWith('GanderUnit_'))
          .map((child) => resolver.resolve(child.index)),
      };
    });
}
