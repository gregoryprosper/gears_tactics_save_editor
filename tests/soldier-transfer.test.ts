import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse, serialize, type GearsTacticsSave } from '../src/save-format';
import { rebuildUnchangedArchive } from '../src/save-format/StructuralArchive';
import {
  exportSoldier,
  previewSoldierImport,
  readSoldierPackage,
  stringifySoldierPackage,
} from '../src/save-format/SoldierTransfer';
import { EditingSession } from '../src/main/EditingSession';
import { defaultLimits } from '../src/save-format/SavePatcher';
import { readNativeRoster } from '../src/save-format/NativeSoldier';
import { readSoldierFile, writeSoldierFile } from '../src/main/SoldierFiles';
import type { SoldierNode, SoldierPackage } from '../src/shared/soldier';

const samplePath = 'sample_save_files/END GAME -  Jacked/geargamesavegame_slot_39';
let save: GearsTacticsSave;
let pkg: SoldierPackage;
beforeAll(() => {
  save = parse(readFileSync(samplePath));
  pkg = exportSoldier(save, save.characters.find((c) => c.hero === 'Gabriel')!.objectIndex);
});
function fixtures(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? fixtures(join(dir, e.name))
      : e.name.startsWith('geargamesavegame')
        ? [join(dir, e.name)]
        : [],
  );
}
function walk(nodes: SoldierNode[]): SoldierNode[] {
  return nodes.flatMap((node) => [node, ...(node.kind === 'property' ? walk(node.payload) : [])]);
}
describe('structural reconstruction prerequisites', () => {
  for (const path of fixtures('sample_save_files')) {
    it(`rebuilds envelope sizes and reference ends byte-identically: ${path}`, () => {
      const bytes = readFileSync(path);
      const parsed = parse(bytes);
      expect(rebuildUnchangedArchive(parsed)).toEqual(bytes);
    });
  }
});
describe('single soldier archive', () => {
  it('separates physical nesting from campaign and soldier ownership', () => {
    expect(pkg.soldier.displayName).toBe('Gabe Diaz');
    expect(pkg.objects.filter((o) => o.classPath.endsWith('.GanderCharacterData'))).toHaveLength(1);
    expect(pkg.bindings.map((b) => b.role).sort()).toEqual(['campaign', 'inventory', 'roster']);
    expect(
      pkg.objects.some((o) =>
        /GanderMetaInventory|GanderCharacterRoster|GanderMetaInfo/.test(o.classPath),
      ),
    ).toBe(false);
    expect(pkg.objects.some((o) => o.name === 'GanderAbilityCard_Stim_Lv3')).toBe(true);
    expect(pkg.objects.some((o) => o.classPath.endsWith('.GanderCharacterCardSlot'))).toBe(true);
    expect(readSoldierPackage(stringifySoldierPackage(pkg))).toEqual(pkg);
  });
  it('excludes action point overrides and destination assignments at every tagged level', () => {
    expect(pkg.soldier.stats.ActionPoints).toBeUndefined();
    expect(pkg.soldier.stats.SquadId).toBeUndefined();
    const nodes = pkg.objects.flatMap((o) => walk(o.body));
    expect(nodes.some((n) => n.kind === 'property' && n.name === 'ActionPoints')).toBe(false);
    expect(nodes.some((n) => n.kind === 'preserve' && n.name === 'ActionPoints')).toBe(true);
    expect(nodes.some((n) => n.kind === 'preserve' && n.name === 'SquadId')).toBe(true);
  });
  it('exports Jack and regular recruits without copying unrelated soldiers', () => {
    for (const character of save.characters) {
      const archive = exportSoldier(save, character.objectIndex);
      expect(
        archive.objects.filter((o) => o.classPath.endsWith('.GanderCharacterData')),
      ).toHaveLength(1);
      expect(archive.soldier.skills).toHaveLength(character.cardSlots.length);
      expect(archive.objects.find((o) => o.id === archive.root)?.name).toBe(character.objectName);
      expect(
        archive.objects.some((o) =>
          /GanderMetaInventory|GanderCharacterRoster|GanderMetaInfo/.test(o.classPath),
        ),
      ).toBe(false);
    }
  });
  it('rejects export of invalid selections and unsafe saves', () => {
    expect(() => exportSoldier(save, -1)).toThrow(/Select a soldier/);
    const unsafe = parse(
      readFileSync('sample_save_files/NEW GAME - Classic Mode/geargamesavegame_slot_1'),
    );
    expect(() => exportSoldier(unsafe, unsafe.characters[0]!.objectIndex)).toThrow(
      /blocking diagnostics/,
    );
  });
});
describe('untrusted text packages', () => {
  it('rejects raw save bytes, wrong versions and unsupported fields', () => {
    expect(() => readSoldierPackage('GVAS')).toThrow(/valid JSON/);
    expect(() => readSoldierPackage(JSON.stringify({ ...pkg, version: 999 }))).toThrow(/version/);
    expect(() => readSoldierPackage(JSON.stringify({ ...pkg, path: '/tmp/save' }))).toThrow(
      /unknown field/,
    );
    expect(() => readSoldierPackage(' '.repeat(16 * 1024 * 1024 + 1))).toThrow(/16 MiB/);
  });
  it('rejects injected actions, invalid numbers, broken references and duplicate IDs', () => {
    const actions = structuredClone(pkg);
    actions.soldier.stats.ActionPoints = 4;
    expect(() => readSoldierPackage(JSON.stringify(actions))).toThrow(/unknown field/);
    const invalid = structuredClone(pkg);
    invalid.soldier.stats.Health = -1;
    expect(() => readSoldierPackage(JSON.stringify(invalid))).toThrow(/statistic/);
    const broken = structuredClone(pkg);
    broken.objects[0]!.outer = 'object-9999';
    expect(() => readSoldierPackage(JSON.stringify(broken))).toThrow(/unresolved reference/);
    const duplicate = structuredClone(pkg);
    duplicate.objects.push(duplicate.objects[0]!);
    expect(() => readSoldierPackage(JSON.stringify(duplicate))).toThrow(/duplicate object/);
    const cycle = structuredClone(pkg);
    cycle.objects[0]!.outer = cycle.objects[0]!.id;
    expect(() => readSoldierPackage(JSON.stringify(cycle))).toThrow(/cyclic object ownership/);
    const forged = structuredClone(pkg);
    forged.objects[0]!.body.push({
      kind: 'property',
      name: 'ActionPoints',
      type: 'IntProperty',
      tagHex: '00',
      payload: [],
    });
    expect(() => readSoldierPackage(JSON.stringify(forged))).toThrow(/destination-owned/);
  });
  it('rejects forged property tags and oversized nested trees', () => {
    const bad = structuredClone(pkg);
    const node = walk(bad.objects[0]!.body).find((n) => n.kind === 'property')!;
    if (node.kind !== 'property') throw new Error('fixture lacks a property');
    node.name = 'Counterfeit';
    expect(() => readSoldierPackage(JSON.stringify(bad))).toThrow(/tag mismatch/);
    const nested = structuredClone(pkg);
    const p = walk(nested.objects[0]!.body).find((n) => n.kind === 'property')!;
    if (p.kind !== 'property') throw new Error('fixture lacks a property');
    let tail = p;
    for (let i = 0; i < 70; i++) {
      const next = { ...p, payload: [] };
      tail.payload = [next];
      tail = next;
    }
    expect(() => readSoldierPackage(JSON.stringify(nested))).toThrow(/nesting/);
  });
});
describe('compatibility preview and session isolation', () => {
  it('applies Add and Replace through revision-bound previews', () => {
    for (const [name, mode] of [
      ['Gary Carmine', 'add'],
      ['Gabe Diaz', 'replace'],
    ] as const) {
      const session = new EditingSession('/not-written', save, defaultLimits);
      const soldier = save.characters.find((c) => c.displayName === name)!;
      const archive = exportSoldier(save, soldier.objectIndex);
      expect(session.prepareSoldierImport(0, archive).canApply).toBe(false);
      session.enable();
      const preview = session.prepareSoldierImport(0, archive);
      expect(preview.canApply).toBe(true);
      session.applySoldierImport(0, preview.token, mode, soldier.objectIndex);
      expect(session.dirty).toBe(true);
      expect(session.save.characters.length).toBe(
        save.characters.length + (mode === 'add' ? 1 : 0),
      );
      const output = session.output();
      expect(() => session.applySoldierImport(0, preview.token, mode, soldier.objectIndex)).toThrow(
        /stale/,
      );
      session.move('undo');
      expect(session.output()).toEqual(serialize(save));
      session.move('redo');
      expect(session.output()).toEqual(output);
    }
  });
  it('enforces hero restrictions in the main process and rejects unsupported versions and point limits', () => {
    const session = new EditingSession('/not-written', save, defaultLimits);
    session.enable();
    const sid = save.characters.find((c) => c.hero === 'Sid')!;
    const archive = exportSoldier(save, sid.objectIndex);
    const preview = session.prepareSoldierImport(0, archive);
    expect(preview.canApply).toBe(true);
    expect(() => session.applySoldierImport(0, preview.token, 'add')).toThrow(/Heroes and Jack/);
    expect(session.dirty).toBe(false);
    const future = structuredClone(pkg);
    future.source.customVersions[0]!.version++;
    expect(previewSoldierImport(save, future).canApply).toBe(false);
    const excessive = structuredClone(pkg);
    session.limits = { ...defaultLimits, abilityPointsMaximum: 100 };
    excessive.soldier.stats.CurrentAbilityPoints = 101;
    expect(session.prepareSoldierImport(0, excessive).blockers.join(' ')).toMatch(
      /configured maximum/,
    );
  });
  it('supports compatible classes, heroes and Jack in both Classic and Jacked saves', () => {
    for (const path of [
      samplePath,
      'sample_save_files/END GAME -  Classic Mode/geargamesavegame_slot_0',
    ]) {
      const destination = parse(readFileSync(path));
      const recruited = new Set(readNativeRoster(destination).groups[0]!.map((c) => c.objectIndex));
      const classes = new Set<string>();
      for (const soldier of destination.characters) {
        if (
          soldier.classInferred ||
          !recruited.has(soldier.objectIndex) ||
          classes.has(soldier.combatClass)
        )
          continue;
        classes.add(soldier.combatClass);
        const session = new EditingSession('/not-written', destination, defaultLimits);
        session.enable();
        const archive = exportSoldier(destination, soldier.objectIndex);
        expect(archive.source.gameType).toBe(path === samplePath ? 'Operation' : 'Classic');
        const preview = session.prepareSoldierImport(0, archive);
        expect(preview.canApply, `${path}: ${soldier.displayName}`).toBe(true);
        session.applySoldierImport(0, preview.token, 'replace', soldier.objectIndex);
        expect(session.save.canSave).toBe(true);
        expect(session.save.characters).toHaveLength(destination.characters.length);
      }
      expect([...classes]).toEqual(
        expect.arrayContaining(['Support', 'Vanguard', 'Heavy', 'Sniper']),
      );
      if (path === samplePath) expect(classes.has('Jack')).toBe(true);
    }
  });
  it('explains same-class, hero, mode, template and native-format restrictions', () => {
    const preview = previewSoldierImport(save, pkg);
    expect(preview.canApply).toBe(true);
    expect(
      preview.blockers.some((b) => /Unmapped|Missing exported|Destination does not/.test(b)),
    ).toBe(false);
    expect(preview.blockers).toEqual([]);
    expect(preview.add.blockers.join(' ')).toMatch(/Heroes and Jack/);
    const sid = save.characters.find((c) => c.hero === 'Sid')!;
    expect(
      preview.replacements.find((c) => c.objectIndex === sid.objectIndex)?.blockers.join(' '),
    ).toMatch(/same class/);
    const gabe = save.characters.find((c) => c.hero === 'Gabriel')!;
    expect(preview.replacements.find((c) => c.objectIndex === gabe.objectIndex)?.blockers).toEqual(
      [],
    );
    const classic = parse(
      readFileSync('sample_save_files/END GAME -  Classic Mode/geargamesavegame_slot_1'),
    );
    expect(previewSoldierImport(classic, pkg).blockers.join(' ')).toMatch(/game modes differ/);
  });
  it('exports applied changes; rejected imports and cancellation leave bytes and history untouched', () => {
    const session = new EditingSession('/not-written', save, defaultLimits);
    session.enable();
    const gabe = save.characters.find((c) => c.hero === 'Gabriel')!;
    session.apply(0, [{ objectIndex: gabe.objectIndex, propertyName: 'Health', value: 777 }]);
    expect(session.exportSoldier(1, gabe.objectIndex).soldier.stats.Health).toBe(777);
    expect(() => session.exportSoldier(0, gabe.objectIndex)).toThrow(/changed/);
    const before = session.snapshot();
    const bytes = serialize(session.save);
    const preview = session.prepareSoldierImport(1, pkg);
    expect(() =>
      session.applySoldierImport(
        1,
        preview.token,
        'replace',
        save.characters.find((c) => c.hero === 'Sid')!.objectIndex,
      ),
    ).toThrow(/same class/);
    expect(session.snapshot()).toEqual(before);
    expect(serialize(session.save)).toEqual(bytes);
    session.cancelSoldierImport(preview.token);
    expect(() => session.applySoldierImport(1, preview.token, 'add')).toThrow(/stale/);
    const fresh = session.prepareSoldierImport(1, pkg);
    session.move('undo');
    expect(() => session.applySoldierImport(2, fresh.token, 'add')).toThrow(/stale/);
    session.move('redo');
    expect(session.exportSoldier(session.revision, gabe.objectIndex).soldier.stats.Health).toBe(
      777,
    );
  });
  it('does not mistake claimed completeness for a safe import', () => {
    expect(() => readSoldierPackage(JSON.stringify({ ...pkg, completeness: 'verified' }))).toThrow(
      /completeness/,
    );
    const session = new EditingSession('/not-written', save, defaultLimits);
    const preview = session.prepareSoldierImport(0, pkg);
    expect(() => session.applySoldierImport(0, preview.token, 'add')).toThrow(/Enable editing/);
  });
});
describe('soldier text file IO', () => {
  it('atomically exports UTF-8 text, reads BOM/CRLF, and refuses to overwrite files or links', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'soldier-files-'));
    try {
      const path = join(dir, 'Gabe.soldier.txt');
      await writeSoldierFile(path, pkg);
      expect(await readSoldierFile(path)).toEqual(pkg);
      const before = await readFile(path);
      await expect(writeSoldierFile(path, pkg)).rejects.toThrow(/already exists/);
      expect(await readFile(path)).toEqual(before);
      const alias = join(dir, 'alias.txt');
      await symlink(path, alias);
      await expect(writeSoldierFile(alias, pkg)).rejects.toThrow(/already exists/);
      const windows = join(dir, 'windows.txt');
      await writeFile(windows, '\uFEFF' + stringifySoldierPackage(pkg).replace(/\n/g, '\r\n'));
      expect(await readSoldierFile(windows)).toEqual(pkg);
      expect((await readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
