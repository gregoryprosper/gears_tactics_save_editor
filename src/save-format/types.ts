export interface ParseWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  offset?: number;
  objectIndex?: number;
  blocksSaving: boolean;
}
export interface GvasHeader {
  saveVersion: number;
  packageVersion: number;
  engineVersion: string;
  changelist: number;
  branch: string;
  saveClass: string;
  endOffset: number;
}
export interface TextValue {
  kind: 'literal' | 'localized' | 'formatted' | 'unknown';
  flags: number;
  history: number;
  text?: string;
  key?: string;
}
export interface UnrealProperty {
  name: string;
  type: string;
  size: number;
  arrayIndex: number;
  offset: number;
  valueOffset: number;
  endOffset: number;
  metadata?: string;
  value?: number | string | boolean;
  text?: TextValue;
  referenceIndex?: number;
  children?: UnrealProperty[];
  rawValue: Buffer;
  rawTag: Buffer;
}
export interface ObjectFrame {
  index: number;
  offset: number;
  bodyOffset: number;
  endOffset: number;
  outerIndex: number;
  hasBody: boolean;
  rootBase: number;
}
export interface SaveObject {
  index: number;
  name: string;
  classPath: string;
  outerPath: string;
  flags: string;
  properties: UnrealProperty[];
  frames: ObjectFrame[];
  body?: ObjectFrame;
}
export interface SaveObjectRef {
  index: number;
  name?: string;
  classPath?: string;
  outerPath?: string;
}
export interface SerializedRoot {
  index: number;
  offset: number;
  endOffset: number;
  versions: { guid: string; version: number }[];
}
export interface GearsTacticsSave {
  header: GvasHeader;
  properties: UnrealProperty[];
  objects: SaveObject[];
  roots: SerializedRoot[];
  warnings: ParseWarning[];
  characters: import('../domain/Character').CharacterState[];
  campaign: import('../domain/Campaign').CampaignState;
  originalBuffer: Buffer;
  canSave: boolean;
}
