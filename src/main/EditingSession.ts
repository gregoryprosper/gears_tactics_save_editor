import { basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parse, serialize, type GearsTacticsSave, type UnrealProperty } from '../save-format';
import {
  createPatches,
  applyPatches,
  editableProperties,
  maximumFor,
  warningAbove,
  type SavePatch,
  type EditLimits,
} from '../save-format/SavePatcher';
import type {
  ArmourOption,
  EditRequest,
  EquipmentSlotView,
  SessionView,
  ObjectDetail,
  PropertyView,
} from '../shared/api';
import {
  armourCatalog,
  cachedEquipmentEntries,
  type ArmourCatalog,
  type EquipmentEntry,
} from '../save-format/NativeSoldier';
import { armourFamilyName, armourRarityLabel, singletonRarity } from '../shared/armour-names';
import { equipmentSlotRecords } from '../save-format/NativeSoldier';
import { equipIntoEmptySlot, SLOT_KINDS } from '../save-format/EquipmentStructural';
import { ARMOUR_SLOT_PROPERTY } from '../save-format/SavePatcher';
import {
  exportSoldier,
  previewSoldierImport,
  readSoldierPackage,
  stringifySoldierPackage,
} from '../save-format/SoldierTransfer';
import type { SoldierImportPreview, SoldierPackage } from '../shared/soldier';
import { buildSoldierCandidate } from '../save-format/SoldierCandidate';
interface SessionState {
  save: GearsTacticsSave;
  patches: SavePatch[];
  imports: string[];
}
export class EditingSession {
  readonly id = randomUUID();
  revision = 0;
  editing = false;
  private history: SessionState[];
  private baseline: GearsTacticsSave;
  private position = 0;
  private soldierPreview?: { token: string; revision: number; package: SoldierPackage };
  constructor(
    public path: string,
    save: GearsTacticsSave,
    public limits: EditLimits,
  ) {
    this.baseline = save;
    this.history = [{ save, patches: [], imports: [] }];
  }
  get save(): GearsTacticsSave {
    return this.history[this.position]!.save;
  }
  get baselineSave(): GearsTacticsSave {
    return this.baseline;
  }
  get structuralChanges(): string[] {
    return [...this.history[this.position]!.imports];
  }
  get dirty(): boolean {
    return Boolean(this.patches.length || this.structuralChanges.length);
  }
  get patches(): SavePatch[] {
    return this.history[this.position]!.patches;
  }
  output(): Buffer {
    return this.patches.length
      ? applyPatches(this.save, this.patches, this.limits)
      : serialize(this.save);
  }
  /** Internal transaction builder. Production IPC enters through the validated preview below. */
  stageResearchImport(
    revision: number,
    pkg: SoldierPackage,
    mode: 'add' | 'replace',
    target?: number,
  ): void {
    if (!this.editing) throw new Error('Enable editing first');
    if (revision !== this.revision) throw new Error('The editing session changed. Preview again.');
    const candidate = buildSoldierCandidate(this.appliedSave(), pkg, mode, target);
    const parsed = parse(candidate.bytes);
    const character = parsed.characters.find((c) => c.objectIndex === candidate.soldierIndex)!;
    if ((character.stats.CurrentAbilityPoints ?? 0) > this.limits.abilityPointsMaximum)
      throw new Error('Imported ability points exceed the configured maximum');
    const imports = [
      ...this.structuralChanges,
      ...this.patches.map(
        (p) => `${p.description}: ${p.oldValue} → ${p.newValue} (applied before import)`,
      ),
      `${mode === 'add' ? 'Add' : 'Replace'} soldier: ${character.displayName}`,
    ];
    this.history = this.history.slice(0, this.position + 1);
    this.history.push({ save: parsed, patches: [], imports });
    this.position++;
    this.revision++;
    this.soldierPreview = undefined;
  }
  private appliedSave(): GearsTacticsSave {
    return this.patches.length
      ? parse(applyPatches(this.save, this.patches, this.limits))
      : this.save;
  }
  exportSoldier(revision: number, objectIndex: number): SoldierPackage {
    if (revision !== this.revision) throw new Error('The editing session changed. Export again.');
    return exportSoldier(this.appliedSave(), objectIndex);
  }
  prepareSoldierImport(revision: number, pkg: SoldierPackage): SoldierImportPreview {
    if (revision !== this.revision) throw new Error('The editing session changed. Preview again.');
    const validated = readSoldierPackage(stringifySoldierPackage(pkg));
    const assessment = previewSoldierImport(this.appliedSave(), validated);
    if (!this.editing) {
      assessment.blockers.push('Enable editing before importing a soldier.');
      assessment.canApply = false;
    }
    if ((validated.soldier.stats.CurrentAbilityPoints ?? 0) > this.limits.abilityPointsMaximum) {
      assessment.blockers.push('Imported ability points exceed the configured maximum.');
      assessment.canApply = false;
    }
    const token = randomUUID();
    this.soldierPreview = { token, revision, package: validated };
    return { ...assessment, token, revision };
  }
  cancelSoldierImport(token: string): void {
    if (this.soldierPreview?.token === token) this.soldierPreview = undefined;
  }
  applySoldierImport(
    revision: number,
    token: string,
    mode: 'add' | 'replace',
    target?: number,
  ): void {
    if (!this.editing) throw new Error('Enable editing first');
    const pending = this.soldierPreview;
    if (
      !pending ||
      token !== pending.token ||
      revision !== this.revision ||
      pending.revision !== this.revision
    )
      throw new Error('The import preview is stale. Open the soldier file again.');
    const assessment = previewSoldierImport(this.appliedSave(), pending.package);
    const destination = assessment.replacements.find((c) => c.objectIndex === target);
    if (mode === 'replace' && !destination) throw new Error('Select a destination soldier');
    const reasons = [
      ...assessment.blockers,
      ...(mode === 'add' ? assessment.add.blockers : destination!.blockers),
    ];
    if (reasons.length) throw new Error(reasons.join('\n'));
    this.stageResearchImport(revision, pending.package, mode, target);
  }
  enable(): void {
    if (!this.save.canSave) throw new Error('Structural validation failed; this save is read only');
    this.editing = true;
  }
  apply(revision: number, changes: EditRequest[]): void {
    if (!this.editing) throw new Error('Enable editing first');
    if (revision !== this.revision)
      throw new Error('The editing session changed. Refresh and try again.');
    // ArmourSlot edits on EMPTY slots are structural inserts (21 bytes into the character
    // suffix), not fixed-width swaps. They stage through the rebuild path like imports;
    // remaining edits rebase across the rebuild's object-index remap.
    const structural: { edit: EditRequest; slot: number; guid: string }[] = [];
    const fixed: EditRequest[] = [];
    const seen = new Set<string>();
    for (const change of changes) {
      const key = `${change.objectIndex}:${change.propertyName}`;
      if (seen.has(key)) throw new Error('Duplicate change');
      seen.add(key);
      const match = ARMOUR_SLOT_PROPERTY.exec(change.propertyName);
      if (match && typeof change.value === 'string' && Number(match[1]) <= 2) {
        let empty = false;
        try {
          empty = !equipmentSlotRecords(this.save, change.objectIndex)[Number(match[1])]?.entry;
        } catch {
          empty = false; // non-character objects fall through to the fixed-width rejection
        }
        if (empty) {
          structural.push({
            edit: change,
            slot: Number(match[1]),
            guid: change.value.toLowerCase(),
          });
          continue;
        }
      }
      fixed.push(change);
    }
    if (!structural.length) {
      const merged = new Map<string, EditRequest>(
        this.patches.map((p) => [
          `${p.objectIndex}:${p.propertyName}`,
          { objectIndex: p.objectIndex, propertyName: p.propertyName, value: p.newValue },
        ]),
      );
      for (const c of fixed) merged.set(`${c.objectIndex}:${c.propertyName}`, c);
      const next = createPatches(this.save, [...merged.values()], this.limits);
      if (JSON.stringify(next) === JSON.stringify(this.patches)) return;
      this.history = this.history.slice(0, this.position + 1);
      this.history.push({ ...this.history[this.position]!, patches: next });
      this.position++;
      this.revision++;
      return;
    }
    const imports = [
      ...this.structuralChanges,
      ...this.patches.map(
        (p) => `${p.description}: ${p.oldValue} → ${p.newValue} (applied before equip)`,
      ),
    ];
    let working = this.appliedSave();
    let rebase = new Map<number, number>(
      working.characters.map((c) => [c.objectIndex, c.objectIndex]),
    );
    for (const equip of structural) {
      const objectIndex = rebase.get(equip.edit.objectIndex);
      if (objectIndex === undefined)
        throw new Error('The editing session changed. Refresh and try again.');
      const result = equipIntoEmptySlot(working, objectIndex, equip.slot, equip.guid);
      imports.push(
        `Equip ${armourFamilyName(equip.guid) ?? equip.guid.slice(0, 8)} · Armour slot ${
          equip.slot
        } · ${result.save.characters.find((c) => c.objectIndex === result.objectIndex)?.displayName ?? `#${result.objectIndex}`}`,
      );
      working = result.save;
      rebase = result.indices;
    }
    const rebased = fixed.map((edit) => {
      const objectIndex = rebase.get(edit.objectIndex);
      if (objectIndex === undefined)
        throw new Error('The editing session changed. Refresh and try again.');
      return { ...edit, objectIndex };
    });
    const patches = createPatches(working, rebased, this.limits);
    this.history = this.history.slice(0, this.position + 1);
    this.history.push({ save: working, patches, imports });
    this.position++;
    this.revision++;
  }
  move(action: 'undo' | 'redo' | 'revert'): void {
    if (action === 'undo' && this.position > 0) this.position--;
    if (action === 'redo' && this.position < this.history.length - 1) this.position++;
    if (action === 'revert' && this.dirty) {
      this.history = this.history.slice(0, this.position + 1);
      this.history.push({ save: this.baseline, patches: [], imports: [] });
      this.position++;
    }
    this.revision++;
  }
  committed(path: string, save: GearsTacticsSave): void {
    this.path = path;
    this.baseline = save;
    this.history = [{ save, patches: [], imports: [] }];
    this.position = 0;
    this.revision++;
  }
  snapshot(): SessionView {
    const bytes = serialize(this.save);
    return {
      id: this.id,
      revision: this.revision,
      dirty: this.dirty,
      structuralChanges: this.structuralChanges,
      path: this.path,
      filename: basename(this.path),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      header: this.save.header,
      campaign: {
        ...this.save.campaign,
        rosterCapacity:
          (this.patches.find((p) => p.kind === 'scalar' && p.propertyName === 'SoldierRosterSize')
            ?.newValue as number | undefined) ?? this.save.campaign.rosterCapacity,
      },
      characters: this.save.characters.map((c) => ({
        ...c,
        stats: {
          ...c.stats,
          ...Object.fromEntries(
            this.patches
              .filter((p) => p.kind === 'scalar' && p.objectIndex === c.objectIndex)
              .map((p) => [p.propertyName, p.newValue as number]),
          ),
        },
      })),
      objects: this.save.objects.map((o) => ({
        index: o.index,
        name: o.name,
        classPath: o.classPath,
        outerPath: o.outerPath,
        propertyCount: o.properties.length,
        searchText: flatten(o.properties)
          .map((p) => `${p.name} ${p.type} ${p.value ?? ''}`)
          .join(' ')
          .toLowerCase(),
      })),
      warnings: this.save.warnings,
      canSave: this.save.canSave,
      editing: this.editing,
      fields: editableProperties(this.save).map(({ objectIndex, property: p }) => ({
        objectIndex,
        name: p.name,
        type: p.type,
        originalValue: p.value as number,
        value:
          (this.patches.find(
            (patch) =>
              patch.kind === 'scalar' &&
              patch.objectIndex === objectIndex &&
              patch.propertyName === p.name,
          )?.newValue as number | undefined) ?? (p.value as number),
        valueOffset: p.valueOffset,
        minimum: 0,
        maximum: maximumFor(p, this.limits),
        warningAbove: warningAbove(p.name),
      })),
      equipment: equipmentViews(this.save, this.patches),
      patches: this.patches.map((p) => ({
        objectIndex: p.objectIndex,
        propertyName: p.propertyName,
        kind: p.kind,
        label: p.description,
        oldValue: p.oldValue,
        newValue: p.newValue,
        offset: p.offset,
        oldHex: hex(p.oldBytes),
        newHex: hex(p.newBytes),
      })),
      canUndo: this.position > 0,
      canRedo: this.position < this.history.length - 1,
    };
  }
  inspect(index: number): ObjectDetail {
    const object = this.save.objects[index];
    if (!object) throw new Error('Object index is out of range');
    const properties: PropertyView[] = flatten(object.properties).map((p) => ({
      name: p.name,
      type: p.type,
      size: p.size,
      offset: p.offset,
      valueOffset: p.valueOffset,
      value:
        p.referenceIndex !== undefined
          ? `${p.referenceIndex === -1 ? 'None' : (this.save.objects[p.referenceIndex]?.name ?? 'Unresolved')} (#${p.referenceIndex})`
          : p.text
            ? (p.text.text ??
              (p.text.key ? `Localization: ${p.text.key}` : `[${p.text.kind} text]`))
            : p.value === undefined
              ? '[opaque / structured payload]'
              : String(p.value),
      rawHex: hex(p.rawValue.subarray(0, 128)),
      referenceIndex: p.referenceIndex,
      metadata: p.metadata,
    }));
    return {
      index: object.index,
      name: object.name,
      classPath: object.classPath,
      outerPath: object.outerPath,
      propertyCount: properties.length,
      searchText: '',
      properties,
      bodyOffset: object.body?.bodyOffset,
      endOffset: object.body?.endOffset,
      outerIndex: object.body?.outerIndex,
    };
  }
}
function flatten(properties: UnrealProperty[]): UnrealProperty[] {
  return properties.flatMap((p) => [p, ...flatten(p.children ?? [])]);
}
/**
 * One view row per native equipment entry, with staged patch values overlaid so drafts
 * compare against what the save will contain. Options carry a same-kind precedent, with
 * unclassified pieces (no observed kind) appended last.
 */
function equipmentViews(save: GearsTacticsSave, patches: SavePatch[]): EquipmentSlotView[] {
  let catalog: ArmourCatalog;
  try {
    catalog = armourCatalog(save);
  } catch {
    return [];
  }
  // Family metadata: one family per armour piece; members are rarity tiers sharing a
  // 12-byte GUID base, ordered by the counter byte. Names come from the calibrated table.
  const families = new Map<string, string[]>();
  for (const definition of catalog.definitions.values()) {
    const key = definition.guid.slice(0, 24);
    if (!families.has(key)) families.set(key, []);
    families.get(key)!.push(definition.guid);
  }
  const pieceLabels = new Map<string, { name?: string; rarity?: string }>();
  for (const members of families.values()) {
    members.sort((a, b) => parseInt(a.slice(24, 26), 16) - parseInt(b.slice(24, 26), 16));
    members.forEach((guid, ordinal) => {
      pieceLabels.set(guid, {
        name: armourFamilyName(guid),
        rarity: armourRarityLabel(ordinal, members.length) ?? singletonRarity(guid),
      });
    });
  }
  const optionsByKind = new Map<number, ArmourOption[]>();
  for (const definition of catalog.definitions.values()) {
    const kind = catalog.kindOf.get(definition.guid);
    if (kind === undefined || kind < 0) continue;
    if (!optionsByKind.has(kind)) optionsByKind.set(kind, []);
    optionsByKind.get(kind)!.push({
      guid: definition.guid,
      quantity: definition.quantity,
      ...pieceLabels.get(definition.guid),
    });
  }
  for (const options of optionsByKind.values())
    options.sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0) || (a.guid < b.guid ? -1 : 1));
  // Pieces with no observed kind cannot be routed to a slot type, so every slot lists them;
  // equipping one keeps the entry's existing kind byte (probe path for naming unknown pieces).
  const unclassified: ArmourOption[] = [];
  for (const definition of catalog.definitions.values()) {
    if (catalog.kindOf.get(definition.guid) !== undefined) continue;
    unclassified.push({
      guid: definition.guid,
      quantity: definition.quantity,
      ...pieceLabels.get(definition.guid),
    });
  }
  unclassified.sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0) || (a.guid < b.guid ? -1 : 1));
  const views: EquipmentSlotView[] = [];
  for (const character of save.characters) {
    let entries: (EquipmentEntry | null)[];
    try {
      entries = cachedEquipmentEntries(save, character.objectIndex);
    } catch {
      continue;
    }
    entries.forEach((entry, slot) => {
      const staged = patches.find(
        (p) =>
          p.kind === 'armour' &&
          p.objectIndex === character.objectIndex &&
          p.propertyName === `ArmourSlot:${slot}`,
      )?.newValue;
      const guid = typeof staged === 'string' ? staged : (entry?.guid ?? null);
      // Empty slots carry no kind; their options come from the slot position instead.
      const optionKind = entry?.kind ?? (slot <= 2 ? SLOT_KINDS[slot] : undefined);
      views.push({
        objectIndex: character.objectIndex,
        slot,
        kind: entry?.kind ?? null,
        flag: entry?.flag ?? null,
        guid,
        resolvable: guid !== null && catalog.definitions.has(guid),
        options:
          optionKind === undefined
            ? []
            : [...(optionsByKind.get(optionKind) ?? []), ...unclassified],
      });
    });
  }
  return views;
}
export function hex(buffer: Buffer): string {
  return buffer.toString('hex').match(/.{2}/g)?.join(' ') ?? '';
}
