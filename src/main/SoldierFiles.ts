import { open, readFile, link, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MAX_SOLDIER_BYTES,
  readSoldierPackage,
  stringifySoldierPackage,
} from '../save-format/SoldierTransfer';
import type { SoldierPackage } from '../shared/soldier';

export async function readSoldierFile(path: string): Promise<SoldierPackage> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_SOLDIER_BYTES)
      throw new Error('Choose a soldier text file smaller than 16 MiB');
    const bytes = Buffer.alloc(Math.min(info.size + 1, MAX_SOLDIER_BYTES + 1));
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size !== info.size) throw new Error('Soldier file changed while reading; try again');
    return readSoldierPackage(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
    );
  } finally {
    await file.close();
  }
}

/** Publish a verified file atomically, without ever replacing a save or an existing export. */
export async function writeSoldierFile(path: string, pkg: SoldierPackage): Promise<void> {
  const text = stringifySoldierPackage(pkg);
  readSoldierPackage(text);
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await readFile(temporary, 'utf8')) !== text)
      throw new Error('Soldier export verification failed');
    // link is an atomic, exclusive publish: unlike rename it cannot overwrite the destination.
    await link(temporary, path).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        throw new Error('That file already exists. Choose a new filename for the soldier export.');
      throw error;
    });
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
