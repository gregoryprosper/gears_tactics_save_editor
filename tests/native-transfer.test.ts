import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EditingSession } from '../src/main/EditingSession';
import { atomicSaveStructural } from '../src/main/AtomicSave';
import { defaultLimits } from '../src/save-format/SavePatcher';
import { parse, serialize } from '../src/save-format';
import { readArchiveGraph, writeArchiveGraph } from '../src/save-format/GraphArchive';
import { exportSoldier, previewSoldierImport } from '../src/save-format/SoldierTransfer';
import {
  readNativeSoldier,
  readNativeRoster,
  readInventoryDefinitions,
  assignedSoldiers,
  nativeTransferFindings,
} from '../src/save-format/NativeSoldier';
import { buildSoldierCandidate } from '../src/save-format/SoldierCandidate';
import type { SoldierNode } from '../src/shared/soldier';

const endBytes = readFileSync('sample_save_files/END GAME -  Jacked/geargamesavegame_slot_39');
const earlyBytes = readFileSync(
  'sample_save_files/NEW GAME - Jacked Mode/geargamesavegame_slot_39',
);
const end = parse(endBytes),
  early = parse(earlyBytes);
const character = (name: string) => end.characters.find((c) => c.displayName === name)!;
const packageFor = (name: string) => exportSoldier(end, character(name).objectIndex);
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.startsWith('geargamesavegame')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('native codecs across the corpus', () => {
  for (const path of files('sample_save_files'))
    it(`relocatable graph round trip and native roster/catalog: ${path}`, () => {
      const bytes = readFileSync(path),
        save = parse(bytes);
      const out = writeArchiveGraph(readArchiveGraph(save));
      expect(out.bytes.equals(bytes)).toBe(true);
      const roster = readNativeRoster(save);
      expect(roster.groups.flat()).toHaveLength(save.characters.length);
      expect(readInventoryDefinitions(save).length).toBeGreaterThan(400);
      expect(
        [...assignedSoldiers(save)].every((index) =>
          save.characters.some((c) => c.objectIndex === index),
        ),
      ).toBe(true);
    });
  it('distinguishes recruits from the recruitment pool and does not count reserves against capacity', () => {
    const roster = readNativeRoster(end);
    expect(roster.groups.map((g) => g.length)).toEqual([13, 4, 0, 0]);
    const preview = previewSoldierImport(end, packageFor('Gary Carmine'));
    expect(preview.add.blockers).toEqual([]);
    expect(preview.canApply).toBe(false); // production gate requires game validation
  });
  it('decodes every character including sparse learned skills and Jack', () => {
    for (const c of end.characters) {
      const pkg = exportSoldier(end, c.objectIndex),
        native = readNativeSoldier(pkg.objects.find((o) => o.id === pkg.root)!.body);
      expect(native.slots.length).toBe(c.cardSlots.length);
      expect(native.skillOrder.length).toBe(native.skillTree.length);
      expect(nativeTransferFindings(end, pkg)).toEqual([]);
    }
    expect(readNativeSoldier(packageFor('Jack').objects[0]!.body).slots).toHaveLength(21);
    expect(readNativeSoldier(packageFor('6').objects[0]!.body).skillOrder).toEqual([17]);
  });
  it('retains linked inventory GUIDs without copying pool quantities or loot provenance', () => {
    const save = parse(
      readFileSync('sample_save_files/END GAME -  Jacked/geargamesavegame_slot_40'),
    );
    expect(
      readInventoryDefinitions(save).some((d) => d.linkedGuid && d.linkedGuid !== '0'.repeat(32)),
    ).toBe(true);
    const pkg = exportSoldier(save, save.characters[0]!.objectIndex);
    expect(pkg.inventoryDefinitions?.some((d) => 'quantity' in d || 'linkedGuid' in d)).toBe(false);
  });
});

describe('complete research candidate generation', () => {
  it('transfers a hero between saves while preserving destination actions and campaign', () => {
    const donor = early.characters.find((c) => c.hero === 'Gabriel')!;
    const target = character('Gabe Diaz');
    const candidate = buildSoldierCandidate(
      end,
      exportSoldier(early, donor.objectIndex),
      'replace',
      target.objectIndex,
    );
    const result = parse(candidate.bytes),
      imported = result.characters.find((c) => c.objectIndex === candidate.soldierIndex)!;
    expect(result.canSave).toBe(true);
    expect(imported.displayName).toBe('Gabe Diaz');
    expect(imported.stats.Level).toBe(donor.stats.Level);
    expect(imported.stats.ActionPoints).toBe(target.stats.ActionPoints);
    expect(imported.stats.SquadId).toBe(target.stats.SquadId);
    expect(imported.cardSlots.map((s) => s.abilityLabel)).toEqual(
      donor.cardSlots.map((s) => s.abilityLabel),
    );
    expect(result.campaign).toEqual({
      ...end.campaign,
      rosterObjectIndex: result.campaign.rosterObjectIndex,
    });
    expect(readInventoryDefinitions(result)).toEqual(readInventoryDefinitions(end));
    expect(serialize(early)).toEqual(earlyBytes);
  });
  it('blocks transferring cosmetic definitions absent from the destination', () => {
    const pkg = packageFor('Gabe Diaz');
    pkg.inventoryDefinitions!.push({
      guid: '00'.repeat(16),
      category: 'cosmetic',
      inventoryClass: '/Script/GanderGame.GanderUndergarmentsInventory',
      assetIdentity: 'missing',
    });
    expect(() =>
      buildSoldierCandidate(early, pkg, 'replace', early.characters[0]!.objectIndex),
    ).toThrow(/matching cosmetic definition/);
  });
  it('adds a full unassigned soldier, preserves the reserve list and consumes one available roster position', () => {
    const pkg = packageFor('Gary Carmine');
    const candidate = buildSoldierCandidate(end, pkg, 'add');
    const result = parse(candidate.bytes),
      roster = readNativeRoster(result);
    expect(candidate.report).toMatchObject({
      mode: 'add',
      recruitedBefore: 13,
      recruitedAfter: 14,
      removedUnreferencedObjects: 0,
      gameValidated: false,
    });
    expect(roster.groups[1]).toHaveLength(4);
    expect(result.characters).toHaveLength(end.characters.length + 1);
    expect(result.characters.filter((c) => c.displayName === 'Gary Carmine')).toHaveLength(2);
    expect(assignedSoldiers(result).has(candidate.soldierIndex)).toBe(false);
    expect(
      result.characters.find((c) => c.objectIndex === candidate.soldierIndex)?.stats.ActionPoints,
    ).toBe(character('Gary Carmine').stats.ActionPoints);
    expect(readInventoryDefinitions(result)).toEqual(readInventoryDefinitions(end));
    expect(() => buildSoldierCandidate(result, pkg, 'add')).toThrow(/capacity/);
    expect(serialize(end)).toEqual(endBytes);
  });
  it('replaces a regular soldier of the same class and preserves Jack’s complete 21-slot layout', () => {
    const heavy = character('DefaultCharacterData');
    const replaced = buildSoldierCandidate(
      end,
      packageFor('Gary Carmine'),
      'replace',
      heavy.objectIndex,
    );
    expect(
      parse(replaced.bytes).characters.find((c) => c.objectIndex === replaced.soldierIndex)
        ?.displayName,
    ).toBe('Gary Carmine');
    const jack = buildSoldierCandidate(
      end,
      packageFor('Jack'),
      'replace',
      character('Jack').objectIndex,
    );
    expect(
      parse(jack.bytes).characters.find((c) => c.objectIndex === jack.soldierIndex)?.cardSlots,
    ).toHaveLength(21);
  });
  it('blocks heroes added as recruits, cross-class replacements, missing heroes and inferred classes', () => {
    expect(() => buildSoldierCandidate(end, packageFor('Gabe Diaz'), 'add')).toThrow(
      /Adding heroes/,
    );
    expect(() =>
      buildSoldierCandidate(
        end,
        packageFor('Gabe Diaz'),
        'replace',
        character('Sid Redburn').objectIndex,
      ),
    ).toThrow(/same verified class/);
    expect(() => buildSoldierCandidate(early, packageFor('Jack'), 'replace', 999999)).toThrow(
      /recruited soldier|matching/,
    );
    expect(() => buildSoldierCandidate(end, packageFor('Benjamin Carmine'), 'add')).toThrow(
      /inferred class/,
    );
  });
  it('rejects old archives, missing item dependencies, unmapped native bytes, and forged classes', () => {
    const old = packageFor('Gabe Diaz');
    delete old.inventoryDefinitions;
    expect(() =>
      buildSoldierCandidate(end, old, 'replace', character('Gabe Diaz').objectIndex),
    ).toThrow(/Re-export/);
    const missing = packageFor('Gabe Diaz');
    missing.inventoryDefinitions = [];
    expect(() =>
      buildSoldierCandidate(end, missing, 'replace', character('Gabe Diaz').objectIndex),
    ).toThrow(/Missing exported/);
    const extra = packageFor('Gabe Diaz');
    extra.objects[0]!.body.push({ kind: 'native', hex: '00000000' });
    expect(() =>
      buildSoldierCandidate(end, extra, 'replace', character('Gabe Diaz').objectIndex),
    ).toThrow(/suffix/);
    const forged = packageFor('Gabe Diaz');
    forged.objects[1]!.classPath = '/Script/Engine.ArbitraryClass';
    expect(() =>
      buildSoldierCandidate(end, forged, 'replace', character('Gabe Diaz').objectIndex),
    ).toThrow(/Unsupported soldier dependency/);
  });
  it('preserves destination assignments even when the source omitted assignment tags', () => {
    const pkg = packageFor('Gary Carmine');
    const target = end.characters.find(
      (c) => c.combatClass === 'Heavy' && c.displayName !== 'Gary Carmine',
    )!;
    const source = pkg.objects[0]!.body;
    expect(source.some((n) => n.kind === 'preserve' && n.name === 'SquadId')).toBe(false);
    const candidate = buildSoldierCandidate(end, pkg, 'replace', target.objectIndex);
    const imported = parse(candidate.bytes).characters.find(
      (c) => c.objectIndex === candidate.soldierIndex,
    )!;
    expect(imported.stats.SquadId).toBe(target.stats.SquadId);
    expect(imported.stats.SquadSlotId).toBe(target.stats.SquadSlotId);
  });
  it('rejects a tampered action-point tag rather than writing it', () => {
    const pkg = packageFor('Gabe Diaz');
    const invalid: SoldierNode = {
      kind: 'property',
      name: 'ActionPoints',
      type: 'IntProperty',
      tagHex: '00',
      payload: [{ kind: 'native', hex: '04000000' }],
    };
    pkg.objects[0]!.body.splice(2, 0, invalid);
    expect(() =>
      buildSoldierCandidate(end, pkg, 'replace', character('Gabe Diaz').objectIndex),
    ).toThrow(/destination-owned/);
  });
});

describe('structural transaction history and persistence', () => {
  it('combines imports and scalar edits with undo/redo/revert and a verified backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'soldier-transaction-'));
    try {
      const path = join(dir, 'save');
      await writeFile(path, endBytes);
      const session = new EditingSession(path, end, defaultLimits);
      session.enable();
      session.apply(0, [
        { objectIndex: character('Gabe Diaz').objectIndex, propertyName: 'Health', value: 777 },
      ]);
      const beforeImport = session.output();
      session.stageResearchImport(session.revision, packageFor('Gary Carmine'), 'add');
      const imported = session.output();
      expect(session.snapshot().structuralChanges).toEqual(['Add soldier: Gary Carmine']);
      expect(session.save.characters.find((c) => c.hero === 'Gabriel')?.stats.Health).toBe(777);
      session.move('undo');
      expect(session.output()).toEqual(beforeImport);
      session.move('redo');
      expect(session.output()).toEqual(imported);
      const added = session.save.characters.at(-1)!;
      session.apply(session.revision, [
        { objectIndex: added.objectIndex, propertyName: 'Health', value: 888 },
      ]);
      expect(
        session.snapshot().characters.find((c) => c.objectIndex === added.objectIndex)?.stats
          .Health,
      ).toBe(888);
      session.move('undo');
      expect(session.output()).toEqual(imported);
      session.move('revert');
      expect(session.output()).toEqual(endBytes);
      expect(session.dirty).toBe(false);
      session.move('undo');
      expect(session.output()).toEqual(imported);
      const result = await atomicSaveStructural(path, path, session.baselineSave, session.output());
      expect(await readFile(result.backup!)).toEqual(endBytes);
      expect(await readFile(path)).toEqual(imported);
      session.committed(result.path, result.save);
      expect(session.dirty).toBe(false);
      expect(session.snapshot().canUndo).toBe(false);
      expect(session.save.characters).toHaveLength(end.characters.length + 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('failed or stale imports leave the entire session untouched', () => {
    const session = new EditingSession('/not-written', end, defaultLimits);
    session.enable();
    const before = session.snapshot();
    expect(() => session.stageResearchImport(0, packageFor('Gabe Diaz'), 'add')).toThrow(/heroes/);
    expect(session.snapshot()).toEqual(before);
    expect(() => session.stageResearchImport(9, packageFor('Gary Carmine'), 'add')).toThrow(
      /changed/,
    );
    expect(session.output()).toEqual(endBytes);
  });
  it('rejects stale source files before structural replacement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'soldier-stale-'));
    try {
      const path = join(dir, 'save');
      const candidate = buildSoldierCandidate(end, packageFor('Gary Carmine'), 'add');
      await writeFile(path, earlyBytes);
      await expect(atomicSaveStructural(path, path, end, candidate.bytes)).rejects.toThrow(
        /source file changed/,
      );
      expect(await readFile(path)).toEqual(earlyBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
