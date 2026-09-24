import type { CharacterState } from '../domain/Character';
import type { CampaignState } from '../domain/Campaign';
import type { GvasHeader, ParseWarning } from '../save-format/types';
export interface Settings {
  developerMode: boolean;
  experimentalEditing: boolean;
  abilityPointsMaximum: number;
}
export interface EditRequest {
  objectIndex: number;
  propertyName: string;
  value: number;
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
  label: string;
  oldValue: number;
  newValue: number;
  offset: number;
  oldHex: string;
  newHex: string;
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
  patches: PatchView[];
  canUndo: boolean;
  canRedo: boolean;
  editing: boolean;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface EditorApi {
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
