/**
 * Armour catalogue family names, calibrated in-game (2026-09-30) by matching equipped
 * piece names against save GUID families. A family is one armour piece; its members are
 * rarity tiers sharing a 12-byte GUID base. Unknown families fall back to short GUIDs.
 */
const FAMILY_NAMES: Record<string, string> = {
  '94012d86': 'UIR Regulator',
  a0448e33: 'Commando Vest',
  '9921b42a': 'Veteran Armor',
  e4fb2114: 'Trooper Armor',
  '861eee54': 'Cadet Chest Plate',
  f57d2a64: 'Onyx Shell',
  '99d103ea': 'Ranger Kit',
  '3b03035f': 'Delta Kit',
  '4b4ec492': 'Regulation Armor',
  '1fa8889b': 'Trooper Boots',
  '61ebefc4': 'Delta Straps',
  '37c86ba1': 'Cadet Shin Guards',
  d321392c: 'Ranger Treads',
  c75fade0: 'Hunter Braces',
  d38bbdab: 'Commando Knee Pads',
  '594ebf40': 'Onyx Helmet',
  '799d3299': 'Onyx Retro Helmet',
  f8ac6fca: 'Trooper Helmet',
  '2da71cd8': 'Hunter Shell',
  '02881eb3': 'Onyx Greaves',
  '25e914a1': 'Destroyer Vest',
  bd224847: 'UIR Holsters',
  '0b99c229': 'Veteran Leg Guards',
  '8a6f7eca': 'Destroyer Leg Guards',
  a8c5c01c: 'Regulation Boots',
  '34645318': 'Thrashball Pads',
  '9c56c096': 'Thrashball Pads',
  '5e1c9c39': 'Destroyer Vest',
  '4c830e9e': 'Destroyer Vest',
  '63a5d43a': 'Delta Straps',
  ecd7b27c: 'UIR Regulator',
  '910d368d': 'Cadet Shin Guards',
};

/**
 * Fixed in-game rarity for singleton families (variant pieces with no tier ladder), read
 * from the running game. Two families (b002dc0d, 960cbdfb) render as literal "Error" in
 * the game UI itself — cut or placeholder pieces with no display name anywhere.
 */
const SINGLETON_RARITY: Record<string, string> = {
  ecd7b27c: 'Common',
  '63a5d43a': 'Epic',
  '0b99c229': 'Rare',
  a8c5c01c: 'Rare',
  '910d368d': 'Rare',
  '34645318': 'Rare',
  '9c56c096': 'Rare',
  '5e1c9c39': 'Rare',
  '4c830e9e': 'Rare',
};

const TIERED_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

/** Display name for a catalogue piece GUID, when its family has been calibrated. */
export function armourFamilyName(guid: string): string | undefined {
  return FAMILY_NAMES[guid.slice(0, 8)];
}

/** In-game rarity of a singleton variant piece, when calibrated. */
export function singletonRarity(guid: string): string | undefined {
  return SINGLETON_RARITY[guid.slice(0, 8)];
}

/**
 * Rarity label from the member's position within its family: five-tier families ascend
 * Common → Legendary; six-tier families carry the Default (blueprint) variant first.
 * Singletons (hero-unique pieces) have item-defined rarity that is not derivable here.
 */
export function armourRarityLabel(ordinal: number, familySize: number): string | undefined {
  if (familySize === 6) {
    if (ordinal === 0) return 'Default';
    return TIERED_RARITIES[ordinal - 1];
  }
  if (familySize === 5) return TIERED_RARITIES[ordinal];
  return undefined;
}
