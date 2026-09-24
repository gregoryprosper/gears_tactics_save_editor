import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, readdir, stat, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, serialize } from '../src/save-format';
import {
  createPatches,
  editableProperties,
  applyPatches,
  defaultLimits,
  validateOutput,
} from '../src/save-format/SavePatcher';
import { atomicSave } from '../src/main/AtomicSave';
import { EditingSession } from '../src/main/EditingSession';
import { diffSaves } from '../src/save-format/SemanticDiff';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const bytes = readFileSync('sample_save_files/NEW GAME - Jacked Mode/geargamesavegame_slot_39');
const save = parse(bytes);
const gabe = save.characters.find((c) => c.hero === 'Gabriel')!;
const edit = { objectIndex: gabe.objectIndex, propertyName: 'CurrentAbilityPoints', value: 20 };
describe('fixed-width patch transactions', () => {
  it('patches every allowlisted field across all fourteen eligible supplied saves', () => {
    const manifest = readFileSync('docs/sample-report.jsonl', 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { path: string; canSave: boolean });
    for (const fixture of manifest.filter((f) => f.canSave)) {
      const input = readFileSync(fixture.path);
      const parsed = parse(input);
      const edits = editableProperties(parsed).map(({ objectIndex, property }) => ({
        objectIndex,
        propertyName: property.name,
        value: property.type === 'FloatProperty' ? 0.75 : 20,
      }));
      const patched = applyPatches(parsed, createPatches(parsed, edits));
      const after = parse(patched);
      for (const edit of edits)
        expect(
          after.objects[edit.objectIndex]!.properties.find((p) => p.name === edit.propertyName)
            ?.value,
        ).toBe(edit.value);
      expect(serialize(parsed)).toEqual(input);
    }
  });
  it('changes only the requested four-byte payload and reparses the expected integer', () => {
    const patches = createPatches(save, [edit]);
    const patched = applyPatches(save, patches);
    const result = parse(patched);
    expect(result.characters.find((c) => c.hero === 'Gabriel')?.stats.CurrentAbilityPoints).toBe(
      20,
    );
    const offset = patches[0]!.offset;
    expect(patched.subarray(0, offset)).toEqual(bytes.subarray(0, offset));
    expect(patched.subarray(offset + 4)).toEqual(bytes.subarray(offset + 4));
    expect(serialize(save)).toEqual(bytes);
    expect(patched.length).toBe(bytes.length);
  });
  it('edits the observed float32 accuracy representation and roster capacity', () => {
    const patches = createPatches(save, [
      { ...edit, propertyName: 'Accuracy', value: 0.8 },
      {
        objectIndex: save.campaign.rosterObjectIndex!,
        propertyName: 'SoldierRosterSize',
        value: 20,
      },
    ]);
    const result = parse(applyPatches(save, patches));
    expect(result.campaign.rosterCapacity).toBe(20);
    expect(result.characters[0]?.stats.Accuracy).toBeCloseTo(0.8);
  });
  it.each([-1, 1.5, Infinity, NaN, 2147483648])('rejects invalid integer value %s', (value) => {
    expect(() => createPatches(save, [{ ...edit, value }])).toThrow(/Invalid/);
  });
  it('permits the full int32 range and configurable ability point limits', () => {
    expect(createPatches(save, [{ ...edit, value: 2147483647 }])[0]?.newValue).toBe(2147483647);
    expect(() => createPatches(save, [edit], { abilityPointsMaximum: 10 })).toThrow();
  });
  it('rejects field insertion, class changes, references, text, level and ambiguous edits', () => {
    for (const propertyName of ['CombatClass', 'Level', 'Name', 'AbilityCard', 'AnythingElse'])
      expect(() => createPatches(save, [{ ...edit, propertyName }])).toThrow(/not an editable/);
    expect(() => createPatches(save, [edit, edit])).toThrow(/Duplicate/);
    expect(() => createPatches(save, [{ ...edit, objectIndex: 99999 }])).toThrow();
  });
  it('rejects forged patch offsets and unrelated modifications', () => {
    const patches = createPatches(save, [edit]);
    expect(() => applyPatches(save, [{ ...patches[0]!, offset: 0 }])).toThrow(/provenance/);
    const patched = applyPatches(save, patches);
    patched[100] = patched[100]! ^ 1;
    expect(() => validateOutput(save, patched, patches)).toThrow(/Unrelated/);
  });
  it('does not produce patches for unchanged values and preserves no-op output', () => {
    const patches = createPatches(save, [{ ...edit, value: 2 }]);
    expect(patches).toEqual([]);
    expect(applyPatches(save, patches)).toEqual(bytes);
  });
  it('supports atomic batches, undo, redo and revert without mutating original bytes', () => {
    const session = new EditingSession('/tmp/example', save, defaultLimits);
    expect(() => session.apply(0, [edit])).toThrow(/Enable/);
    session.enable();
    session.apply(0, [edit]);
    expect(session.patches).toHaveLength(1);
    expect(() => session.apply(0, [edit])).toThrow(/changed/);
    session.move('undo');
    expect(session.patches).toHaveLength(0);
    session.move('redo');
    expect(session.patches).toHaveLength(1);
    expect(() =>
      session.apply(session.revision, [
        { ...edit, value: 30 },
        { ...edit, propertyName: 'CombatClass', value: 1 },
      ]),
    ).toThrow();
    expect(session.patches[0]?.newValue).toBe(20);
    session.move('revert');
    expect(session.patches).toHaveLength(0);
    session.move('undo');
    expect(session.patches[0]?.newValue).toBe(20);
    session.apply(session.revision, [{ ...edit, value: 2 }]);
    expect(session.patches).toHaveLength(0);
    expect(serialize(session.save)).toEqual(bytes);
  });
  it('blocks editing unsafe files', () => {
    const unsafe = parse(
      readFileSync('sample_save_files/NEW GAME - Classic Mode/geargamesavegame_slot_1'),
    );
    expect(() => createPatches(unsafe, [])).toThrow(/disabled/);
    expect(() => new EditingSession('/tmp/unsafe', unsafe, defaultLimits).enable()).toThrow(
      /read only/,
    );
  });
  it('reports semantic value changes without treating changed object payloads as new identities', () => {
    const result = diffSaves(save, parse(applyPatches(save, createPatches(save, [edit]))));
    expect(result.changes).toEqual([
      { object: 'Character[Gabriel]', property: 'CurrentAbilityPoints', before: '2', after: '20' },
    ]);
    expect(result.lengthDelta).toBe(0);
    expect(result.rawDifferentBytes).toBe(1);
    expect(diffSaves(save, save).changes).toEqual([]);
  });
});
describe('backup and atomic persistence', () => {
  let directory: string;
  let source: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gears-save-test-'));
    source = join(directory, 'geargamesavegame_slot_39');
    await writeFile(source, bytes);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('creates a verified original backup before writing, reparses disk output, and cleans temporary files', async () => {
    const result = await atomicSave(
      source,
      source,
      save,
      createPatches(save, [edit]),
      defaultLimits,
    );
    expect(await readFile(source + '.bak')).toEqual(bytes);
    expect(result.backup).toBe(source + '.bak');
    expect(parse(await readFile(source)).characters[0]?.stats.CurrentAbilityPoints).toBe(20);
    expect((await readdir(directory)).sort()).toEqual([
      'geargamesavegame_slot_39',
      'geargamesavegame_slot_39.bak',
    ]);
  });
  it('numbers backups without replacing previous backups', async () => {
    await writeFile(source + '.bak', 'earlier backup');
    await writeFile(source + '.bak.1', 'another backup');
    const result = await atomicSave(
      source,
      source,
      save,
      createPatches(save, [edit]),
      defaultLimits,
    );
    expect(result.backup).toBe(source + '.bak.2');
    expect(await readFile(source + '.bak', 'utf8')).toBe('earlier backup');
    expect(await readFile(source + '.bak.2')).toEqual(bytes);
  });
  it('Save As preserves the source and backs up an existing destination', async () => {
    const destination = join(directory, 'exported');
    await writeFile(destination, 'old destination');
    await atomicSave(source, destination, save, createPatches(save, [edit]), defaultLimits);
    expect(await readFile(source)).toEqual(bytes);
    expect(await readFile(destination + '.bak', 'utf8')).toBe('old destination');
    expect(parse(await readFile(destination)).characters[0]?.stats.CurrentAbilityPoints).toBe(20);
  });
  it('unchanged Save performs no disk write, backup, or timestamp change', async () => {
    const before = await stat(source);
    const result = await atomicSave(source, source, save, [], defaultLimits);
    const after = await stat(source);
    expect(result.noChange).toBe(true);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(directory)).toEqual(['geargamesavegame_slot_39']);
  });
  it('unchanged Save As creates a byte-identical copy', async () => {
    const destination = join(directory, 'copy');
    await atomicSave(source, destination, save, [], defaultLimits);
    expect(await readFile(destination)).toEqual(bytes);
  });
  it('refuses to overwrite a changed source', async () => {
    await writeFile(source, Buffer.from('external modification'));
    await expect(
      atomicSave(source, source, save, createPatches(save, [edit]), defaultLimits),
    ).rejects.toThrow(/changed on disk/);
    expect(await readFile(source, 'utf8')).toBe('external modification');
    expect(await readdir(directory)).toEqual(['geargamesavegame_slot_39']);
  });
  it('refuses competing writers and never removes another writer’s lock', async () => {
    await writeFile(source + '.editor-lock', 'owned by another writer');
    await expect(
      atomicSave(source, source, save, createPatches(save, [edit]), defaultLimits),
    ).rejects.toThrow(/save is in progress/);
    expect(await readFile(source + '.editor-lock', 'utf8')).toBe('owned by another writer');
    expect(await readFile(source)).toEqual(bytes);
  });
  it('does not follow destination symlinks', async () => {
    const link = join(directory, 'link');
    await symlink(source, link);
    await expect(
      atomicSave(source, link, save, createPatches(save, [edit]), defaultLimits),
    ).rejects.toThrow(/symlink/);
    expect(await readFile(source)).toEqual(bytes);
  });
  it('failed atomic replacement preserves the source and verified backup and cleans owned temporary files', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('Simulated replacement failure'));
    await expect(
      atomicSave(source, source, save, createPatches(save, [edit]), defaultLimits),
    ).rejects.toThrow(/replacement failure/);
    expect(await readFile(source)).toEqual(bytes);
    expect(await readFile(source + '.bak')).toEqual(bytes);
    expect((await readdir(directory)).sort()).toEqual([
      'geargamesavegame_slot_39',
      'geargamesavegame_slot_39.bak',
    ]);
  });
  it('validation failure writes neither destination nor backup', async () => {
    const p = createPatches(save, [edit])[0]!;
    await expect(
      atomicSave(source, source, save, [{ ...p, offset: 1 }], defaultLimits),
    ).rejects.toThrow(/provenance/);
    expect(await readFile(source)).toEqual(bytes);
    expect(await readdir(directory)).toEqual(['geargamesavegame_slot_39']);
  });
});
