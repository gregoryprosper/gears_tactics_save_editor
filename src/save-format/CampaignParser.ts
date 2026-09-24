import type { CampaignState } from '../domain/Campaign';
import { findProperty } from './PropertyParser';
import type { SaveObject, UnrealProperty } from './types';
export function parseCampaign(
  properties: UnrealProperty[],
  objects: SaveObject[],
  characterCount: number,
): CampaignState {
  const info = findProperty(properties, 'SaveInfo')?.children ?? [];
  const string = (name: string) => {
    const v = findProperty(info, name)?.value;
    return typeof v === 'string' ? v.split('::').pop() : undefined;
  };
  const roster = objects.find(
    (o) =>
      o.classPath.includes('GanderCharacterRoster') &&
      findProperty(o.properties, 'SoldierRosterSize'),
  );
  const capacity = findProperty(roster?.properties ?? [], 'SoldierRosterSize')?.value;
  const completion = findProperty(info, 'CampaignCompletion')?.value;
  return {
    mission: string('CampaignMissionId'),
    difficulty: string('DifficultyLevel'),
    gameType: string('GameType'),
    completion: typeof completion === 'number' ? completion : undefined,
    gameState: String(findProperty(properties, 'GameState')?.value ?? 'Unknown'),
    rosterCapacity: typeof capacity === 'number' ? capacity : undefined,
    rosterObjectIndex: roster?.index,
    characterCount,
  };
}
