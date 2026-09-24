import { readFile } from 'node:fs/promises';
import { parse } from '../save-format';
import { diffSaves } from '../save-format/SemanticDiff';
async function main(): Promise<void> {
  const [before, after] = process.argv.slice(2);
  if (!before || !after) throw new Error('Usage: npm run diff-saves -- <before> <after> [--json]');
  const [a, b] = await Promise.all([readFile(before), readFile(after)]);
  const result = diffSaves(parse(a), parse(b));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const c of result.changes)
    console.log(`${c.object}.${c.property}\n${c.before} → ${c.after}\n`);
  console.log(
    `${result.changes.length} semantic differences; ${result.rawDifferentBytes} differing byte positions; length delta ${result.lengthDelta}.`,
  );
  if (!result.changes.length && result.rawDifferentBytes)
    console.log(
      'Differences exist in unmapped/native data; semantic equality does not mean byte equality.',
    );
  console.log(
    'Objects matched by hero/custom identity, owner + slot number, or full table path. Runtime renames and duplicate identities can appear as additions/removals.',
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
