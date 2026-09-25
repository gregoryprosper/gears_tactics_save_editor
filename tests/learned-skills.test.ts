import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse, serialize } from '../src/save-format';
import { parseLearnedSkills } from '../src/save-format/LearnedSkillParser';
const bytes = readFileSync('sample_save_files/END GAME -  Jacked/geargamesavegame_slot_39');
const save = parse(bytes);
const mikayla = save.characters.find((c) => c.hero === 'Mikayla')!;
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.startsWith('geargamesavegame')
        ? [join(dir, e.name)]
        : [],
  );
}
describe('learned skill display data', () => {
  it('reads all 35 of Mikayla’s nodes separately from seven equipped cards', () => {
    expect(mikayla.learnedSkills?.totalNodes).toBe(35);
    expect(mikayla.learnedSkills?.nodes).toHaveLength(35);
    const refs = mikayla
      .learnedSkills!.nodes.flatMap((n) => [n.ability, n.passive, n.effect])
      .filter((r) => r !== undefined);
    expect(refs.map((r) => r.label)).toEqual(
      expect.arrayContaining([
        'Lucky Streak',
        'Deathblow',
        'Deathblow II',
        'Deathblow III',
        'Impact',
        'Knockdown',
      ]),
    );
    expect(mikayla.cardSlots.filter((s) => s.status === 'Equipped')).toHaveLength(7);
    expect(mikayla.cardSlots.filter((s) => s.status === 'Empty')).toHaveLength(3);
  });
  it('shows a learned passive even when every equipped card slot is empty', () => {
    const early = parse(
      readFileSync('sample_save_files/NEW GAME - Jacked Mode/geargamesavegame_slot_39'),
    );
    expect(early.characters[0]!.learnedSkills?.nodes).toHaveLength(1);
    expect(early.characters[0]!.learnedSkills!.nodes[0]!.passive?.name).toBe(
      'BP_Passive_Aura_v2_C',
    );
    expect(early.characters[0]!.cardSlots.every((slot) => slot.status === 'Empty')).toBe(true);
  });
  it('retains sparse node IDs and Jack’s different tree size', () => {
    const sparse = save.characters.find((c) => c.displayName === '6')!.learnedSkills!;
    expect(sparse.nodes.map((n) => n.nodeIndex)).toEqual([17]);
    const jack = save.characters.find((c) => c.displayName === 'Jack')!;
    expect(jack.learnedSkills?.nodes).toHaveLength(28);
    expect(jack.learnedSkills?.totalNodes).toBe(28);
    expect(jack.cardSlots).toHaveLength(21);
  });
  it('decodes all characters across the corpus without changing serialization', () => {
    for (const path of files('sample_save_files')) {
      const original = readFileSync(path),
        parsed = parse(original);
      expect(
        parsed.characters.every((c) => c.learnedSkills !== undefined),
        path,
      ).toBe(true);
      expect(serialize(parsed).equals(original), path).toBe(true);
    }
  });
  it('reports an unsupported suffix without showing zero skills or hiding equipped cards', () => {
    const altered = Buffer.from(bytes);
    const frame = save.objects[mikayla.objectIndex]!.body!;
    // Break the first native context reference without changing its framed size.
    altered.writeInt32LE(-2, frame.bodyOffset);
    expect(() =>
      parseLearnedSkills(altered, save.objects[mikayla.objectIndex]!, save.objects),
    ).toThrow();
    const parsed = parse(altered),
      character = parsed.characters.find((c) => c.hero === 'Mikayla')!;
    expect(character.learnedSkills).toBeUndefined();
    expect(character.cardSlots).toHaveLength(10);
    expect(parsed.warnings).toContainEqual(
      expect.objectContaining({
        code: 'LEARNED_SKILLS_UNAVAILABLE',
        objectIndex: character.objectIndex,
        blocksSaving: false,
      }),
    );
    expect(serialize(parsed)).toEqual(altered);
  });
});
