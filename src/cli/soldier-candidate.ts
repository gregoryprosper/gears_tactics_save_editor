import { readFile, open, mkdir, link, unlink } from 'node:fs/promises';
import { dirname, resolve, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parse } from '../save-format';
import { buildSoldierCandidate } from '../save-format/SoldierCandidate';
import { exportSoldier } from '../save-format/SoldierTransfer';

// Research-only entry point. It cannot overwrite an existing save, and is not wired to Apply.
const [flag, donorPath, donorName, destinationPath, mode, targetName, outputPath] =
  process.argv.slice(2);
if (
  flag !== '--experimental-test-copy' ||
  !donorPath ||
  !donorName ||
  !destinationPath ||
  !['add', 'replace'].includes(mode ?? '') ||
  !targetName ||
  !outputPath
) {
  console.error(
    'Usage: node --import tsx src/cli/soldier-candidate.ts --experimental-test-copy <donor-save> <soldier-name> <destination-save> <add|replace> <target-name|-> <new-output-path>',
  );
  process.exitCode = 1;
} else {
  const donorBytes = await readFile(donorPath),
    destinationBytes = await readFile(destinationPath);
  const donor = parse(donorBytes),
    destination = parse(destinationBytes);
  const selected = donor.characters.filter((c) => c.displayName === donorName);
  const targets = destination.characters.filter((c) => c.displayName === targetName);
  if (selected.length !== 1 || (mode === 'replace' && targets.length !== 1))
    throw new Error('Soldier names must identify exactly one character');
  const candidate = buildSoldierCandidate(
    destination,
    exportSoldier(donor, selected[0]!.objectIndex),
    mode as 'add' | 'replace',
    targets[0]?.objectIndex,
  );
  const output = resolve(outputPath);
  if ([resolve(donorPath), resolve(destinationPath)].includes(output))
    throw new Error('A separate output file is required');
  await mkdir(dirname(output), { recursive: true });
  const temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(candidate.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!(await readFile(temporary)).equals(candidate.bytes))
      throw new Error('Candidate disk verification failed');
    await link(temporary, output); // exclusive publication; EEXIST never overwrites anything
  } finally {
    await unlink(temporary).catch(() => {});
  }
  console.log(
    JSON.stringify(
      {
        ...candidate.report,
        output,
        donorSha256: createHash('sha256').update(donorBytes).digest('hex'),
        destinationSha256: createHash('sha256').update(destinationBytes).digest('hex'),
        outputSha256: createHash('sha256').update(candidate.bytes).digest('hex'),
        warning: 'Experimental game-test copy. Not game-validated. Keep the original save.',
      },
      null,
      2,
    ),
  );
}
