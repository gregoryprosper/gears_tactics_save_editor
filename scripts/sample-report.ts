import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, serialize } from '../src/save-format';
async function visit(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.startsWith('geargamesavegame')) {
      const bytes = await readFile(path);
      const start = performance.now();
      const s = parse(bytes);
      console.log(
        JSON.stringify({
          path,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          objects: s.objects.length,
          characters: s.characters.length,
          slots: s.characters.map((c) => c.cardSlots.length),
          mission: s.campaign.mission,
          capacity: s.campaign.rosterCapacity,
          roundTrip: serialize(s).equals(bytes),
          canSave: s.canSave,
          errors: s.warnings.filter((w) => w.blocksSaving),
          milliseconds: Math.round(performance.now() - start),
        }),
      );
    }
  }
}
await visit('sample_save_files');
