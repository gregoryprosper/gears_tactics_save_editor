import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, serialize } from '../src/save-format';
import {
  applyPatches,
  createPatches,
  ARMOUR_SLOT_PROPERTY,
  defaultLimits,
} from '../src/save-format/SavePatcher';
import { atomicSave } from '../src/main/AtomicSave';
import { EditingSession } from '../src/main/EditingSession';
import { armourCatalog, readEquipmentEntries } from '../src/save-format/NativeSoldier';

const endBytes = readFileSync('sample_save_files/END GAME -  Jacked 100%/geargamesavegame_slot_41');
const end = parse(endBytes);
const corpus = readFileSync('docs/sample-report.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as { path: string; canSave: boolean });

/** A character entry that can actually be swapped: present, resolvable, with alternatives. */
function swappable(save = end) {
  const catalog = armourCatalog(save);
  for (const character of save.characters) {
    const entries = readEquipmentEntries(save, character.objectIndex);
    for (let slot = 0; slot < entries.length; slot++) {
      const entry = entries[slot];
      if (!entry || !catalog.definitions.has(entry.guid)) continue;
      const target = [...catalog.definitions.keys()].find(
        (guid) => catalog.kindOf.get(guid) === entry.kind && guid !== entry.guid,
      );
      if (target) return { character, slot, entry, target };
    }
  }
  throw new Error('fixture has no swappable armour entry');
}

describe('native equipment entries', () => {
  it('decodes offset-accurate entries across every supplied save', () => {
    let characters = 0;
    let present = 0;
    for (const fixture of corpus.filter((f) => f.canSave)) {
      const save = parse(readFileSync(fixture.path));
      const bytes = serialize(save);
      for (const character of save.characters) {
        const object = save.objects[character.objectIndex]!;
        const entries = readEquipmentEntries(save, character.objectIndex);
        characters++;
        expect(entries).toHaveLength(4);
        let previous = 0;
        entries.forEach((entry, slot) => {
          if (!entry) return;
          present++;
          expect(entry.guidOffset).toBeGreaterThan(previous);
          expect(entry.guidOffset).toBeGreaterThan(object.body!.bodyOffset);
          expect(entry.guidOffset + 16).toBeLessThanOrEqual(object.body!.endOffset);
          expect(bytes.subarray(entry.guidOffset, entry.guidOffset + 16).toString('hex')).toBe(
            entry.guid,
          );
          expect(bytes[entry.kindOffset]).toBe(entry.kind);
          previous = entry.guidOffset;
          void slot;
        });
      }
    }
    expect(characters).toBeGreaterThan(100);
    expect(present).toBeGreaterThan(300);
  });
});

describe('armour patch transactions', () => {
  it('rewrites exactly the sixteen GUID bytes, preserving kind, flag and every other byte', () => {
    const { character, slot, entry, target } = swappable();
    const session = new EditingSession('/tmp/example', end, defaultLimits);
    session.enable();
    session.apply(session.revision, [
      { objectIndex: character.objectIndex, propertyName: `ArmourSlot:${slot}`, value: target },
    ]);
    const output = session.output();
    const base = serialize(end);
    expect(output.length).toBe(base.length);
    const before = output.subarray(0, entry.guidOffset);
    const after = output.subarray(entry.guidOffset + 16);
    expect(before.equals(base.subarray(0, entry.guidOffset))).toBe(true);
    expect(after.equals(base.subarray(entry.guidOffset + 16))).toBe(true);
    const reparsed = parse(output);
    const swapped = readEquipmentEntries(reparsed, character.objectIndex)[slot]!;
    expect(swapped.guid).toBe(target);
    expect(swapped.kind).toBe(entry.kind);
    expect(swapped.flag).toBe(entry.flag);
    session.move('undo');
    expect(session.output().equals(base)).toBe(true);
    session.move('redo');
    expect(session.output().equals(output)).toBe(true);
  });

  it('overlays the staged piece in the equipment view and clears matching drafts', () => {
    const { character, slot, entry, target } = swappable();
    const session = new EditingSession('/tmp/example', end, defaultLimits);
    session.enable();
    const before = session
      .snapshot()
      .equipment.find((s) => s.objectIndex === character.objectIndex && s.slot === slot);
    expect(before?.guid).toBe(entry.guid);
    expect(before?.resolvable).toBe(true);
    expect(before?.options.length).toBeGreaterThan(1);
    session.apply(session.revision, [
      { objectIndex: character.objectIndex, propertyName: `ArmourSlot:${slot}`, value: target },
    ]);
    const after = session
      .snapshot()
      .equipment.find((s) => s.objectIndex === character.objectIndex && s.slot === slot);
    expect(after?.guid).toBe(target);
    const patch = session.snapshot().patches.find((p) => p.kind === 'armour');
    expect(patch?.oldValue).toBe(entry.guid);
    expect(patch?.newValue).toBe(target);
    session.move('undo');
    expect(
      session
        .snapshot()
        .equipment.find((s) => s.objectIndex === character.objectIndex && s.slot === slot)?.guid,
    ).toBe(entry.guid);
  });

  it('accepts pieces with no observed kind, listing them as options and keeping the kind byte', () => {
    const catalog = armourCatalog(end);
    const { character, slot, entry } = swappable();
    const unclassified = [...catalog.definitions.keys()].find(
      (guid) => catalog.kindOf.get(guid) === undefined,
    );
    expect(unclassified).toBeDefined();
    const session = new EditingSession('/tmp/example', end, defaultLimits);
    session.enable();
    const options = session
      .snapshot()
      .equipment.find((s) => s.objectIndex === character.objectIndex && s.slot === slot)!
      .options.find((o) => o.guid === unclassified);
    expect(options?.kind).toBeUndefined();
    session.apply(session.revision, [
      {
        objectIndex: character.objectIndex,
        propertyName: `ArmourSlot:${slot}`,
        value: unclassified!,
      },
    ]);
    const reparsed = parse(session.output());
    const swapped = readEquipmentEntries(reparsed, character.objectIndex)[slot]!;
    expect(swapped.guid).toBe(unclassified);
    expect(swapped.kind).toBe(entry.kind);
    expect(swapped.flag).toBe(entry.flag);
  });

  it('rejects cross-slot, unknown, malformed, empty-slot and non-character edits', () => {
    const save = end;
    const catalog = armourCatalog(save);
    const { character, slot, entry } = swappable();
    const session = new EditingSession('/tmp/example', save, defaultLimits);
    session.enable();
    const apply = (objectIndex: number, propertyName: string, value: string) =>
      session.apply(session.revision, [{ objectIndex, propertyName, value }]);
    const otherKind = [...catalog.definitions.keys()].find((guid) => {
      const kind = catalog.kindOf.get(guid);
      return kind !== undefined && kind !== entry.kind;
    })!;
    expect(() => apply(character.objectIndex, `ArmourSlot:${slot}`, otherKind)).toThrow(
      /does not match this equipment slot/,
    );
    expect(() => apply(character.objectIndex, `ArmourSlot:${slot}`, 'f'.repeat(32))).toThrow(
      /does not exist in this save/,
    );
    expect(() => apply(character.objectIndex, `ArmourSlot:${slot}`, 'zz')).toThrow(
      /Invalid armour GUID/,
    );
    // Slot 4 matches no armour allowlist entry, so it is rejected as an unknown property.
    expect(() => apply(character.objectIndex, 'ArmourSlot:4', 'zz')).toThrow(
      /not an editable, validated scalar/,
    );
    const empty = save.characters.flatMap((c) =>
      readEquipmentEntries(save, c.objectIndex)
        .map((e, index) => ({ e, index, objectIndex: c.objectIndex }))
        .filter(({ e }) => !e),
    )[0]!;
    expect(() => apply(empty.objectIndex, `ArmourSlot:${empty.index}`, entry.guid)).toThrow(
      /is empty/,
    );
    const outsider = save.objects.find((o) => o.classPath.includes('GanderCharacterRoster'))!;
    expect(() => apply(outsider.index, 'ArmourSlot:0', entry.guid)).toThrow(/character object/);
    const duplicate = {
      objectIndex: character.objectIndex,
      propertyName: `ArmourSlot:${slot}`,
      value: entry.guid,
    };
    expect(() =>
      session.apply(session.revision, [duplicate, { ...duplicate, value: otherKind }]),
    ).toThrow(/Duplicate/);
  });

  it('supports a mixed batch of scalar and armour edits and persists both atomically', async () => {
    const { character, slot, entry, target } = swappable();
    const session = new EditingSession('/tmp/example', end, defaultLimits);
    session.enable();
    const health = Object.keys(character.stats).includes('Health') ? 5000 : undefined;
    const changes = [
      ...(health === undefined
        ? []
        : [{ objectIndex: character.objectIndex, propertyName: 'Health', value: health }]),
      { objectIndex: character.objectIndex, propertyName: `ArmourSlot:${slot}`, value: target },
    ];
    session.apply(session.revision, changes);
    expect(session.patches).toHaveLength(changes.length);
    const directory = await mkdtemp(join(tmpdir(), 'gtse-armour-'));
    try {
      const source = join(directory, 'save');
      const destination = join(directory, 'save.edited');
      const { writeFile, copyFile } = await import('node:fs/promises');
      await writeFile(source, endBytes);
      // A pre-existing destination gets a verified backup before replacement.
      await copyFile(source, destination);
      const result = await atomicSave(
        source,
        destination,
        session.save,
        session.patches,
        defaultLimits,
      );
      const written = parse(await readFile(destination));
      const saved = readEquipmentEntries(written, character.objectIndex)[slot]!;
      expect(saved.guid).toBe(target);
      expect(
        written.characters.find((c) => c.objectIndex === character.objectIndex)?.stats.Health,
      ).toBe(health);
      expect(result.backup).toBeTruthy();
      expect((await readdir(directory)).some((f) => f.endsWith('.bak'))).toBe(true);
      expect(entry.guid).not.toBe(target);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects caller-supplied offsets and bytes that do not match a re-derived patch', () => {
    const { character, slot, target } = swappable();
    const [patch] = createPatches(end, [
      { objectIndex: character.objectIndex, propertyName: `ArmourSlot:${slot}`, value: target },
    ]);
    expect(patch?.kind).toBe('armour');
    expect(patch!.newBytes).toHaveLength(16);
    const shifted = { ...patch!, offset: patch!.offset + 1 };
    expect(() => applyPatches(end, [shifted])).toThrow(/provenance does not match/);
    const widened = { ...patch!, newBytes: Buffer.concat([patch!.newBytes, Buffer.alloc(1)]) };
    expect(() => applyPatches(end, [widened])).toThrow(/provenance/);
    expect(ARMOUR_SLOT_PROPERTY.exec('ArmourSlot:3')?.[1]).toBe('3');
    expect(ARMOUR_SLOT_PROPERTY.test('ArmourSlot:9')).toBe(false);
  });
});
