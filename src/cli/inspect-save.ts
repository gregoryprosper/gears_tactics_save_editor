import { readFile } from 'node:fs/promises';
import { parse } from '../save-format';
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run inspect-save -- <save path> [--json]');
  const save = parse(await readFile(file));
  const report = {
    header: save.header,
    objectCount: save.objects.length,
    campaign: save.campaign,
    characters: save.characters,
    warnings: save.warnings,
    canSave: save.canSave,
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `GVAS detected • ${save.header.engineVersion}\nObjects: ${save.objects.length}\nCharacters: ${save.characters.length}\nMission: ${save.campaign.mission}\nRoster capacity: ${save.campaign.rosterCapacity}\nBinary patch validation: ${save.canSave ? 'passed' : 'saving disabled'}\n`,
  );
  for (const c of save.characters) {
    console.log(
      `${c.displayName}\nObject: #${c.objectIndex} ${c.objectName}\nClass: ${c.combatClass}${c.classInferred ? ' (inferred)' : ''}\nLevel: ${c.stats.Level ?? 'not serialized'}\nAbility Points: ${c.stats.CurrentAbilityPoints ?? 'not serialized'}\nCard Slots: ${c.cardSlots.length}`,
    );
    for (const s of c.cardSlots)
      console.log(
        `  ${s.slotNumber}: ${s.abilityLabel ?? s.status}${s.abilityCard ? ` [${s.abilityCard.name}]` : ''}`,
      );
    console.log('');
  }
  for (const w of save.warnings) console.log(`${w.severity.toUpperCase()} ${w.code}: ${w.message}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
