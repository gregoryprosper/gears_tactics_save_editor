import type { CharacterState } from '../domain/Character';
import type { CampaignState } from '../domain/Campaign';
import type { GvasHeader, ParseWarning } from '../save-format/types';
import type { SoldierImportPreview } from './soldier';
export interface Settings {
  developerMode: boolean;
  experimentalEditing: boolean;
  abilityPointsMaximum: number;
}
export interface EditRequest {
  objectIndex: number;
  propertyName: string;
  value: number | string;
}
export interface FieldView {
  objectIndex: number;
  name: string;
  type: string;
  value: number;
  originalValue: number;
  valueOffset: number;
  minimum: number;
  maximum: number;
  warningAbove: number;
}
export interface PatchView {
  objectIndex: number;
  propertyName: string;
  kind: 'scalar' | 'armour';
  label: string;
  oldValue: number | string;
  newValue: number | string;
  offset: number;
  oldHex: string;
  newHex: string;
}
export interface ArmourOption {
  guid: string;
  quantity?: number;
  /** Calibrated display name, when the piece's family is known. */
  name?: string;
  /** Rarity tier derived from the family member ordinal (Common…Legendary, Default). */
  rarity?: string;
  /** Observed equipment-entry kind; undefined for pieces never worn in this save. */
  kind?: number;
}
export interface EquipmentSlotView {
  objectIndex: number;
  slot: number;
  kind: number | null;
  flag: number | null;
  /** Equipped piece GUID, or null when the native entry is empty. */
  guid: string | null;
  /** False when the GUID does not resolve against this save's armour inventory (slot 3 records). */
  resolvable: boolean;
  /**
   * Replacement pieces with a same-kind precedent in this save, owned stock first, followed by
   * unclassified pieces (no observed kind) which keep the slot's kind byte when equipped.
   */
  options: ArmourOption[];
}
export interface ObjectSummary {
  index: number;
  name: string;
  classPath: string;
  outerPath: string;
  propertyCount: number;
  searchText: string;
}
export interface PropertyView {
  name: string;
  type: string;
  size: number;
  offset: number;
  valueOffset: number;
  value: string;
  rawHex: string;
  referenceIndex?: number;
  metadata?: string;
}
export interface ObjectDetail extends ObjectSummary {
  properties: PropertyView[];
  bodyOffset?: number;
  endOffset?: number;
  outerIndex?: number;
}
export interface SessionView {
  dirty: boolean;
  structuralChanges: string[];
  id: string;
  revision: number;
  filename: string;
  path: string;
  size: number;
  sha256: string;
  header: GvasHeader;
  campaign: CampaignState;
  characters: CharacterState[];
  objects: ObjectSummary[];
  warnings: ParseWarning[];
  canSave: boolean;
  fields: FieldView[];
  equipment: EquipmentSlotView[];
  patches: PatchView[];
  canUndo: boolean;
  canRedo: boolean;
  editing: boolean;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface EditorApi {
  exportSoldier(
    id: string,
    revision: number,
    objectIndex: number,
  ): Promise<Result<{ path: string } | null>>;
  prepareSoldierImport(id: string, revision: number): Promise<Result<SoldierImportPreview | null>>;
  cancelSoldierImport(id: string, token: string): Promise<Result<void>>;
  applySoldierImport(
    id: string,
    revision: number,
    token: string,
    mode: 'add' | 'replace',
    target?: number,
  ): Promise<Result<SessionView>>;
  settings(): Promise<Result<Settings>>;
  updateSettings(settings: Settings): Promise<Result<Settings>>;
  current(): Promise<Result<SessionView | null>>;
  open(): Promise<Result<SessionView | null>>;
  openDropped(file: File): Promise<Result<SessionView | null>>;
  enableEditing(id: string): Promise<Result<SessionView>>;
  apply(id: string, revision: number, changes: EditRequest[]): Promise<Result<SessionView>>;
  history(id: string, action: 'undo' | 'redo' | 'revert'): Promise<Result<SessionView>>;
  save(
    id: string,
    saveAs: boolean,
  ): Promise<Result<{ session: SessionView; backup?: string; noChange: boolean } | null>>;
  inspect(id: string, objectIndex: number): Promise<Result<ObjectDetail>>;
  hex(id: string, offset: number): Promise<Result<string>>;
  strings(id: string, query: string): Promise<Result<{ offset: number; text: string }[]>>;
  draftDirty(dirty: boolean): Promise<Result<void>>;
}
