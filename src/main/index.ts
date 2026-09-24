import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, serialize, MAX_SAVE_BYTES } from '../save-format';
import { BinaryReader } from '../save-format/BinaryReader';
import { EditingSession, hex } from './EditingSession';
import { atomicSave } from './AtomicSave';
import { SettingsStore, validateSettings } from './Settings';
import type { EditRequest, Result } from '../shared/api';
const directory = dirname(fileURLToPath(import.meta.url));
if (!app.isPackaged && process.env.GTSE_TEST_DATA)
  app.setPath('userData', process.env.GTSE_TEST_DATA);
let window: BrowserWindow | null = null;
let session: EditingSession | undefined;
let draftsDirty = false;
let busy = false;
let preferences: SettingsStore;
const rendererPath = join(directory, '../renderer/index.html');
function trusted(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  const expected = process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererPath).href;
  if (
    !window ||
    event.sender !== window.webContents ||
    frame !== event.sender.mainFrame ||
    frame.url !== new URL(expected).href
  )
    throw new Error('Untrusted IPC sender');
}
function handle(
  channel: string,
  callback: (...args: unknown[]) => unknown | Promise<unknown>,
  mutation = false,
): void {
  ipcMain.handle(
    `editor:${channel}`,
    async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      let acquired = false;
      try {
        trusted(event);
        if (mutation) {
          if (busy) throw new Error('A file operation is already in progress');
          busy = true;
          acquired = true;
        }
        return { ok: true, value: await callback(...args) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        if (acquired) busy = false;
      }
    },
  );
}
function current(id: unknown): EditingSession {
  if (!session || id !== session.id) throw new Error('This save session is no longer active');
  return session;
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new Error('Invalid integer argument');
  return value;
}
async function discard(): Promise<boolean> {
  if (!session?.patches.length && !draftsDirty) return true;
  const choice = await dialog.showMessageBox(window!, {
    type: 'warning',
    title: 'Unsaved changes',
    message: 'Discard your unsaved changes?',
    detail: 'Draft and applied changes are only in memory. No save has been written.',
    buttons: ['Keep editing', 'Discard changes'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return choice.response === 1;
}
async function load(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('An absolute file path is required');
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_SAVE_BYTES)
    throw new Error('Choose a regular save file smaller than 64 MiB');
  const parsed = parse(await readFile(path));
  session = new EditingSession(resolve(path), parsed, preferences.settings);
  draftsDirty = false;
  preferences.lastDirectory = dirname(path);
  await preferences.persist();
}
function registerIpc(): void {
  handle('settings', () => preferences.settings);
  handle(
    'update-settings',
    async (value) => {
      const settings = validateSettings(value);
      preferences.settings = settings;
      await preferences.persist();
      if (session) session.limits = settings;
      return settings;
    },
    true,
  );
  handle('current', () => session?.snapshot() ?? null);
  handle(
    'open',
    async () => {
      if (!(await discard())) return null;
      const result = await dialog.showOpenDialog(window!, {
        title: 'Open Gears Tactics save',
        defaultPath: preferences.lastDirectory,
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Gears Tactics Save Files (including extensionless)', extensions: ['*', 'sav'] },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      await load(result.filePaths[0]);
      return session!.snapshot();
    },
    true,
  );
  handle(
    'open-dropped',
    async (path) => {
      if (typeof path !== 'string' || !path) throw new Error('Drop a local save file');
      if (!(await discard())) return null;
      await load(path);
      return session!.snapshot();
    },
    true,
  );
  handle(
    'enable',
    (id) => {
      const s = current(id);
      s.enable();
      return s.snapshot();
    },
    true,
  );
  handle(
    'apply',
    (id, revision, value) => {
      const s = current(id);
      if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid change list');
      const changes: EditRequest[] = value.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid edit');
        const e = entry as Record<string, unknown>;
        if (typeof e.propertyName !== 'string' || typeof e.value !== 'number')
          throw new Error('Invalid edit');
        return {
          objectIndex: integer(e.objectIndex),
          propertyName: e.propertyName,
          value: e.value,
        };
      });
      s.apply(integer(revision), changes);
      draftsDirty = false;
      return s.snapshot();
    },
    true,
  );
  handle(
    'history',
    (id, action) => {
      if (action !== 'undo' && action !== 'redo' && action !== 'revert')
        throw new Error('Invalid history action');
      if (draftsDirty && action !== 'revert')
        throw new Error('Apply or discard draft values before undo/redo');
      const s = current(id);
      s.move(action);
      if (action === 'revert') draftsDirty = false;
      return s.snapshot();
    },
    true,
  );
  handle(
    'save',
    async (id, saveAs) => {
      const s = current(id);
      if (typeof saveAs !== 'boolean') throw new Error('Invalid save mode');
      if (draftsDirty) throw new Error('Apply changes before saving');
      let destination = s.path;
      if (saveAs) {
        const choice = await dialog.showSaveDialog(window!, {
          title: 'Save As',
          defaultPath: s.path + '.edited',
          filters: [{ name: 'All Files', extensions: ['*'] }],
        });
        if (choice.canceled || !choice.filePath) return null;
        destination = choice.filePath;
      }
      const result = await atomicSave(s.path, destination, s.save, s.patches, s.limits);
      s.committed(result.path, result.save);
      return { session: s.snapshot(), backup: result.backup, noChange: result.noChange };
    },
    true,
  );
  handle('inspect', (id, index) => current(id).inspect(integer(index)));
  handle('hex', (id, offset) => {
    const b = serialize(current(id).save);
    const start = integer(offset);
    if (start >= b.length) throw new Error('Hex offset exceeds file size');
    return Array.from({ length: Math.ceil(Math.min(512, b.length - start) / 16) }, (_, row) => {
      const pos = start + row * 16;
      const chunk = b.subarray(pos, Math.min(pos + 16, b.length));
      return `0x${pos.toString(16).padStart(8, '0')}  ${hex(chunk).padEnd(47)}  ${Array.from(chunk, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('')}`;
    }).join('\n');
  });
  handle('strings', (id, query) => {
    if (typeof query !== 'string' || query.length < 2 || query.length > 200)
      throw new Error('Search for 2–200 characters');
    const b = serialize(current(id).save);
    const matches: { offset: number; text: string }[] = [];
    const needle = query.toLowerCase();
    for (let pos = 0; pos + 4 <= b.length && matches.length < 200; pos++) {
      const n = b.readInt32LE(pos);
      if (Math.abs(n) < 3 || Math.abs(n) > 4096) continue;
      try {
        const r = new BinaryReader(b, pos);
        const text = r.fstring(4096);
        if (text.toLowerCase().includes(needle)) matches.push({ offset: pos, text });
      } catch {
        /* Not a valid FString boundary. */
      }
    }
    return matches;
  });
  handle('draft-dirty', (value) => {
    if (typeof value !== 'boolean') throw new Error('Invalid draft state');
    draftsDirty = value;
  });
}
async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#111417',
    title: 'Gears Tactics Save Editor',
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.on('will-download', (event) => event.preventDefault());
  // Packaged operation is local-only, including renderer network requests.
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const dev = process.env.ELECTRON_RENDERER_URL;
    const localDev =
      dev && ['http:', 'ws:'].includes(url.protocol) && url.hostname === new URL(dev).hostname;
    callback({ cancel: !['file:', 'devtools:', 'data:'].includes(url.protocol) && !localDev });
  });
  let closing = false;
  window.on('close', (event) => {
    if (closing) return;
    if (busy) {
      event.preventDefault();
      return;
    }
    if (session?.patches.length || draftsDirty) {
      event.preventDefault();
      void discard().then((ok) => {
        if (ok) {
          closing = true;
          window?.close();
        }
      });
    }
  });
  window.on('closed', () => {
    window = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(rendererPath);
}
void app.whenReady().then(async () => {
  preferences = new SettingsStore(app.getPath('userData'));
  await preferences.load();
  registerIpc();
  Menu.setApplicationMenu(null);
  const argIndex = process.argv.indexOf('--inspect');
  const path = process.argv[argIndex + 1];
  if (argIndex >= 0 && path) {
    try {
      await load(resolve(path));
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Could not open save',
        detail: String(error),
      });
    }
  }
  await createWindow();
  app.on('activate', () => {
    if (!window) void createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
