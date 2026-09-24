import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse, serialize, ObjectResolver } from '../src/save-format';
import { BinaryReader } from '../src/save-format/BinaryReader';
import { readPropertyList } from '../src/save-format/PropertyParser';
const sample = (folder: string, slot = 'geargamesavegame_slot_39') =>
  readFileSync(join('sample_save_files', folder, slot));
const earlyBytes = sample('NEW GAME - Jacked Mode');
const progressedBytes = sample('END GAME -  Jacked');
const early = parse(earlyBytes);
const progressed = parse(progressedBytes);
function fixtures(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? fixtures(join(dir, e.name))
      : e.name.startsWith('geargamesavegame')
        ? [join(dir, e.name)]
        : [],
  );
}
describe('observed GVAS layout', () => {
  it('recognizes the actual header and parses the object table', () => {
    expect(early.header).toMatchObject({
      saveVersion: 1,
      packageVersion: 502,
      engineVersion: '4.11.2',
      saveClass: 'GanderSaveGameObject',
    });
    expect(early.objects).toHaveLength(437);
    expect(progressed.objects).toHaveLength(1391);
    expect(new ObjectResolver(early.objects).resolve(47).name).toBe('GanderCharacter_Gabe');
  });
  it('discovers characters by class, including renamed runtime objects', () => {
    expect(early.characters).toHaveLength(2);
    expect(progressed.characters).toHaveLength(17);
    expect(progressed.characters.find((c) => c.hero === 'Gabriel')?.objectName).toBe(
      'GanderCharacterData_0',
    );
  });
  it('reads known stats and ability points without converting raw accuracy', () => {
    const gabe = early.characters.find((c) => c.hero === 'Gabriel')!;
    expect(gabe.stats).toMatchObject({
      Level: 2,
      Health: 500,
      Strength: 65,
      MovementPoints: 6,
      ActionPoints: 3,
      CurrentAbilityPoints: 2,
    });
    expect(gabe.stats.Accuracy).toBeCloseTo(0.6);
    expect(early.characters.find((c) => c.hero === 'Sid')?.stats.Strength).toBe(50);
  });
  it('discovers empty and equipped slots through outer-object relationships', () => {
    expect(early.characters[0]?.cardSlots).toHaveLength(10);
    expect(
      early.characters[0]?.cardSlots.every((s) => s.status === 'Empty' && !s.abilityCard),
    ).toBe(true);
    const gabe = progressed.characters.find((c) => c.hero === 'Gabriel')!;
    expect(gabe.cardSlots.filter((s) => s.status === 'Equipped')).toHaveLength(8);
    expect(gabe.cardSlots.map((s) => s.abilityCard?.name)).toContain('GanderAbilityCard_Stim_Lv3');
    expect(
      gabe.cardSlots.filter((s) => s.status === 'Equipped').map((s) => s.abilityLabel),
    ).toEqual([
      'Stim III',
      'Recovery Patch III',
      'Empower III',
      'Teamwork II',
      'Locked And Loaded',
      'High Powered Shot III',
      'Surge',
      'Group Therapy II',
    ]);
    expect(gabe.cardSlots.filter((s) => s.status === 'Empty')).toHaveLength(2);
    const sid = progressed.characters.find((c) => c.hero === 'Sid')!;
    expect(sid.cardSlots.filter((s) => s.status === 'Equipped').map((s) => s.abilityLabel)).toEqual(
      [
        'Hunker Down II',
        'Distraction III',
        'Rally III',
        'Stand Together',
        'Intimidation III',
        'Rage Shot III',
        'Shock Shot',
        'Breach',
      ],
    );
  });
  it('finds Jack’s 21 slots dynamically', () => {
    const jack = progressed.characters.find((c) => c.cardSlots.length === 21);
    expect(jack).toBeDefined();
    expect(jack?.combatClass).toBe('Jack');
  });
  it('isolates missing CombatClass inference behind a configurable rule', () => {
    expect(progressed.characters.some((c) => c.classInferred && c.combatClass === 'Scout')).toBe(
      true,
    );
    const noInference = parse(progressedBytes, { missingCombatClass: undefined });
    expect(noInference.characters.some((c) => c.combatClass === 'Unknown')).toBe(true);
  });
  it('reads custom FText while preserving localization references', () => {
    expect(progressed.characters.map((c) => c.displayName)).toContain('Anthony Carmine');
    expect(progressed.characters.find((c) => c.displayName === 'Anthony Carmine')?.callsign).toBe(
      'Delta-One',
    );
    expect(early.objects[47]?.properties.find((p) => p.name === 'Name')?.text?.kind).toBe(
      'localized',
    );
    expect(early.characters[0]?.displayName).toBe('Gabe Diaz');
  });
  it('reads campaign metadata and roster capacity', () => {
    expect(early.campaign).toMatchObject({
      mission: 'Mission1_2',
      difficulty: 'Insane',
      rosterCapacity: 4,
    });
    expect(progressed.campaign).toMatchObject({ mission: 'Mission3_1', rosterCapacity: 14 });
  });
  for (const path of fixtures('sample_save_files'))
    it(`lossless round trip and complete object discovery: ${path}`, () => {
      const bytes = readFileSync(path);
      const save = parse(bytes);
      expect(serialize(save).equals(bytes)).toBe(true);
      expect(save.objects.filter((o) => o.body)).toHaveLength(save.objects.length);
      const unsafeFixture = path.includes('NEW GAME - Classic Mode') && path.endsWith('_1');
      expect(save.warnings.filter((w) => w.blocksSaving).map((w) => w.code)).toEqual(
        unsafeFixture ? ['NONFINITE_VALUE'] : [],
      );
      expect(save.canSave).toBe(!unsafeFixture);
      expect(
        save.characters.every((c) => c.cardSlots.length === 10 || c.cardSlots.length === 21),
      ).toBe(true);
    });
  it('keeps the private original isolated from callers and raw-value buffers', () => {
    const source = Buffer.from(earlyBytes);
    const save = parse(source);
    source.fill(0);
    save.originalBuffer.fill(0);
    save.objects[47]!.properties[0]!.rawTag.fill(0);
    expect(serialize(save).equals(earlyBytes)).toBe(true);
  });
  it('rejects wrong magic, unsupported versions and truncations', () => {
    expect(() => parse(Buffer.from('NOT A SAVE'))).toThrow(/GVAS/);
    const version = Buffer.from(earlyBytes);
    version.writeInt32LE(3, 4);
    expect(() => parse(version)).toThrow(/Unsupported/);
    for (const size of [0, 3, 50, 1000, earlyBytes.length - 1])
      expect(() => parse(earlyBytes.subarray(0, size))).toThrow();
  });
  it('disables saving when damaged character tags would otherwise expose only a partial property run', () => {
    const p = early.objects[47]!.properties.find((p) => p.name === 'Level')!;
    const bytes = Buffer.from(earlyBytes);
    bytes.writeInt32LE(8, p.valueOffset - 8);
    expect(parse(bytes).canSave).toBe(false);
  });
  it('disables saving when a known object reference becomes invalid', () => {
    const p = progressed.objects
      .flatMap((o) => o.properties)
      .find((p) => p.name === 'AbilityCard')!;
    const bytes = Buffer.from(progressedBytes);
    bytes.writeInt32LE(999999, p.valueOffset);
    const result = parse(bytes);
    expect(result.canSave).toBe(false);
    expect(result.warnings.some((w) => w.code === 'INVALID_REFERENCE')).toBe(true);
  });
});
describe('bounded primitive and unknown-property handling', () => {
  it('decodes wide FStrings and rejects malformed lengths and terminators', () => {
    const wide = Buffer.from('Renée\0', 'utf16le');
    const bytes = Buffer.alloc(4 + wide.length);
    bytes.writeInt32LE(-6);
    wide.copy(bytes, 4);
    expect(new BinaryReader(bytes).fstring()).toBe('Renée');
    expect(() => new BinaryReader(Buffer.from([255, 255, 255, 127])).fstring()).toThrow();
    expect(() => new BinaryReader(Buffer.from([2, 0, 0, 0, 65, 66])).fstring()).toThrow(
      /terminator/,
    );
    expect(() => new BinaryReader(Buffer.alloc(3)).i32()).toThrow(/Truncated/);
  });
  it('retains unknown payload bytes and tag metadata', () => {
    const f = (s: string) => {
      const v = Buffer.from(s + '\0');
      const n = Buffer.alloc(4);
      n.writeInt32LE(v.length);
      return Buffer.concat([n, v]);
    };
    const size = Buffer.alloc(8);
    size.writeUInt32LE(3);
    const bytes = Buffer.concat([
      f('FutureField'),
      f('FutureProperty'),
      size,
      Buffer.from([9, 8, 7]),
      f('None'),
    ]);
    const p = readPropertyList(new BinaryReader(bytes))[0]!;
    expect(p.rawValue).toEqual(Buffer.from([9, 8, 7]));
    expect(p.size).toBe(3);
  });
});
