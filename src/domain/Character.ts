import type { SaveObjectRef } from '../save-format/types';
export interface CharacterCardSlot {
  objectIndex: number;
  slotNumber: number;
  inferredSlotNumber: boolean;
  status: 'Empty' | 'Equipped' | 'Unknown';
  abilityCard?: SaveObjectRef;
  abilityLabel?: string;
}
export interface LearnedSkillReference {
  index: number;
  name: string;
  label: string;
}
export interface LearnedSkillTree {
  totalNodes: number;
  nodes: {
    nodeIndex: number;
    ability?: LearnedSkillReference;
    passive?: LearnedSkillReference;
    effect?: LearnedSkillReference;
  }[];
}
export interface CharacterState {
  objectIndex: number;
  objectName: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  callsign?: string;
  showCallsign?: boolean;
  hero?: string;
  combatClass: string;
  internalClass?: string;
  classInferred: boolean;
  stats: Record<string, number>;
  cardSlots: CharacterCardSlot[];
  learnedSkills?: LearnedSkillTree;
  unitReferences: SaveObjectRef[];
}
