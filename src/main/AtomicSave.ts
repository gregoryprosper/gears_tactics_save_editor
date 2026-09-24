import { open, readFile, lstat, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, serialize, type GearsTacticsSave } from '../save-format';
import {
  applyPatches,
  validateOutput,
  type SavePatch,
  type EditLimits,
} from '../save-format/SavePatcher';
function code(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}
async function readDestination(path: string): Promise<{ bytes: Buffer; mode: number } | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Save destination must be a regular file, not a symlink');
    return { bytes: await readFile(path), mode: info.mode };
  } catch (error) {
    if (code(error) === 'ENOENT') return undefined;
    throw error;
  }
}
async function backupFile(path: string, bytes: Buffer): Promise<string> {
  for (let n = 0; n < 10000; n++) {
    const backup = `${path}.bak${n ? `.${n}` : ''}`;
    let handle;
    try {
      handle = await open(backup, 'wx', 0o600);
    } catch (error) {
      if (code(error) === 'EEXIST') continue;
      throw error;
    }
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(backup).catch(() => {});
      throw error;
    }
    await handle.close();
    if (!(await readFile(backup)).equals(bytes))
      throw new Error(`Backup verification failed: ${backup}`);
    return backup;
  }
  throw new Error('Too many backups; archive old backups before saving');
}
export interface AtomicSaveResult {
  path: string;
  backup?: string;
  noChange: boolean;
  save: GearsTacticsSave;
}
export async function atomicSave(
  sourcePath: string,
  destination: string,
  save: GearsTacticsSave,
  patches: SavePatch[],
  limits: EditLimits,
): Promise<AtomicSaveResult> {
  const path = resolve(destination);
  const sameFile = path === resolve(sourcePath);
  // No-op save never touches the filesystem, even when the save is inspection-only.
  if (sameFile && !patches.length) return { path, noChange: true, save };
  const output = patches.length ? applyPatches(save, patches, limits) : serialize(save);
  if (patches.length === 0) parse(output); // Save As may copy an inspection-only file byte-for-byte.
  const lockPath = `${path}.editor-lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
    if (code(error) === 'EEXIST')
      throw new Error(
        'Another save is in progress, or an editor-lock remains after a crash. Check before removing it.',
      );
    throw error;
  });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let backup: string | undefined;
  try {
    const existing = await readDestination(path);
    if (sameFile && (!existing || !existing.bytes.equals(serialize(save))))
      throw new Error(
        'The source file changed on disk. Reopen it before saving; no file was overwritten.',
      );
    if (existing?.bytes.equals(output)) return { path, noChange: true, save: parse(output) };
    if (existing) backup = await backupFile(path, existing.bytes);
    const handle = await open(temp, 'wx', existing?.mode ?? 0o600);
    try {
      await handle.writeFile(output);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const staged = await readFile(temp);
    if (!staged.equals(output)) throw new Error('Temporary file verification failed');
    if (patches.length) validateOutput(save, staged, patches);
    else parse(staged);
    const latest = await readDestination(path);
    if (
      (existing === undefined) !== (latest === undefined) ||
      (existing && !latest?.bytes.equals(existing.bytes))
    )
      throw new Error('Destination changed while preparing the save; replacement cancelled.');
    await rename(temp, path);
    // Sync directory metadata where supported; Windows does not expose directory fsync.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    const written = await readFile(path);
    if (!written.equals(output))
      throw new Error(
        `Written file differs from validated output. Backup: ${backup ?? 'source file remains at ' + sourcePath}`,
      );
    const result = patches.length ? validateOutput(save, written, patches) : parse(written);
    return { path, backup, noChange: false, save: result };
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${backup ? ` Verified backup: ${backup}` : ''}`,
    );
  } finally {
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}
