import { useEffect, useState, type DragEvent } from 'react';
import {
  Activity,
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  CircleHelp,
  FilePlus2,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Redo2,
  Save,
  Settings2,
  ShieldCheck,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import type { EditRequest, Result, SessionView, Settings as Preferences } from '../shared/api';
import Overview from './components/Overview';
import Soldiers, { fieldKey } from './components/Soldiers';
import Campaign from './components/Campaign';
import Inspector from './components/Inspector';
import Settings from './components/Settings';
import Modal from './components/Modal';
import { formatNumber } from './components/FieldEditor';
import SoldierImport from './components/SoldierImport';
import type { SoldierImportPreview } from '../shared/soldier';
type Page = 'Overview' | 'Soldiers' | 'Campaign' | 'Raw Inspector';
const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
export default function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [settings, setSettings] = useState<Preferences>({
    developerMode: false,
    experimentalEditing: false,
    abilityPointsMaximum: 2147483647,
  });
  const [page, setPage] = useState<Page>('Overview');
  const [selected, setSelected] = useState<number>();
  const [inspected, setInspected] = useState<number>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [soldierImport, setSoldierImport] = useState<SoldierImportPreview | null>(null);
  const draftCount = Object.keys(drafts).length;
  const hasChanges = Boolean(session?.dirty || draftCount);
  const appliedCount = (session?.patches.length ?? 0) + (session?.structuralChanges.length ?? 0);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!window.editor) return;
    void run(async () => {
      const [preferences, current] = await Promise.all([
        window.editor!.settings(),
        window.editor!.current(),
      ]);
      setSettings(unwrap(preferences));
      setSession(unwrap(current));
    });
  }, []);
  function accept(s: SessionView) {
    setSession(s);
    setDrafts({});
  }
  function draft(key: string, value: string) {
    const next = { ...drafts };
    const field = session?.fields.find((f) => fieldKey(f.objectIndex, f.name) === key);
    if (field && value.trim() !== '' && Number(value) === field.value) delete next[key];
    else next[key] = value;
    setDrafts(next);
    void window.editor!.draftDirty(Object.keys(next).length > 0).then((result) => {
      if (!result.ok) setError(result.error);
    });
  }
  async function open(file?: File) {
    await run(async () => {
      const result = unwrap(
        await (file ? window.editor!.openDropped(file) : window.editor!.open()),
      );
      if (result) {
        accept(result);
        setSelected(undefined);
        setInspected(undefined);
        setPage('Overview');
        setMessage('Save opened in read-only mode.');
      }
    });
  }
  async function apply() {
    if (!session) return;
    await run(async () => {
      const changes: EditRequest[] = Object.entries(drafts).map(([key, value]) => {
        const field = session.fields.find((f) => fieldKey(f.objectIndex, f.name) === key);
        if (!field || !value.trim() || !Number.isFinite(Number(value)))
          throw new Error('Enter valid numeric values before applying changes.');
        return { objectIndex: field.objectIndex, propertyName: field.name, value: Number(value) };
      });
      accept(unwrap(await window.editor!.apply(session.id, session.revision, changes)));
      setChangesOpen(true);
      setMessage('Changes applied in memory. Review them before saving.');
    });
  }
  async function save(saveAs = false) {
    if (!session) return;
    await run(async () => {
      const result = unwrap(await window.editor!.save(session.id, saveAs));
      if (result) {
        accept(result.session);
        setChangesOpen(false);
        setMessage(
          result.noChange
            ? 'No bytes changed; no write was necessary.'
            : `Save verified and written.${result.backup ? ` Backup: ${result.backup}` : ' Original source preserved.'}`,
        );
      }
    });
  }
  async function history(action: 'undo' | 'redo' | 'revert') {
    if (!session) return;
    await run(async () => {
      accept(unwrap(await window.editor!.history(session.id, action)));
    });
  }
  async function exportSoldier(index: number) {
    if (!session) return;
    await run(async () => {
      const result = unwrap(
        await window.editor!.exportSoldier(session.id, session.revision, index),
      );
      if (result)
        setMessage(
          `Soldier archive exported: ${result.path}. Complete imports are not yet available.`,
        );
    });
  }
  async function importSoldier() {
    if (!session) return;
    await run(async () => {
      const result = unwrap(
        await window.editor!.prepareSoldierImport(session.id, session.revision),
      );
      if (result) setSoldierImport(result);
    });
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy || !window.editor) return;
    const file = event.dataTransfer.files[0];
    if (file) void open(file);
  }
  const blocking = session?.warnings.filter((w) => w.blocksSaving).length ?? 0;
  const status = hasChanges ? 'UNSAVED CHANGES' : session?.editing ? 'EDITING' : 'READ ONLY';
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={drop}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol">
            <ShieldCheck size={27} />
          </div>
          <div>
            <strong>GEARS TACTICS</strong>
            <span>SAVE EDITOR</span>
          </div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {(
            [
              { name: 'Overview', icon: LayoutDashboard },
              { name: 'Soldiers', icon: Users },
              { name: 'Campaign', icon: Activity },
              { name: 'Raw Inspector', icon: Braces },
            ] as const
          ).map((item) => (
            <button
              key={item.name}
              className={page === item.name ? 'active' : ''}
              disabled={!session || (item.name === 'Raw Inspector' && !settings.developerMode)}
              onClick={() => setPage(item.name)}
              title={
                item.name === 'Raw Inspector' && !settings.developerMode
                  ? 'Enable developer mode in Settings'
                  : undefined
              }
            >
              <item.icon size={18} />
              <span>{item.name}</span>
              {item.name === 'Soldiers' && session && <small>{session.characters.length}</small>}
              {item.name === 'Raw Inspector' && <span className="dev-label">DEV</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-separator" />
        <button className="side-action" disabled={!session} onClick={() => setChangesOpen(true)}>
          <ListChecks size={18} />
          Pending changes
          <span className={appliedCount ? 'change-count' : 'count'}>{appliedCount}</span>
        </button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <HardDrive size={17} />
            <div>
              <strong>LOCAL WORKSPACE</strong>
              <span>Your saves stay on this device.</span>
            </div>
            <span className="status-dot" />
          </div>
          <button className="side-action" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={17} />
            Settings
          </button>
          <div className="version">
            v0.1.0 <span>INDEPENDENT COMMUNITY TOOL</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <span
              className={`status ${hasChanges ? 'unsaved' : session?.editing ? 'editing' : ''}`}
            >
              <span className="status-dot" />
              {status}
            </span>
            <button
              className="button secondary"
              disabled={busy || !window.editor}
              onClick={() => void open()}
            >
              <FolderOpen size={16} />
              Open save
            </button>
          </div>
        </header>
        <main className="main-content" aria-busy={busy}>
          {error && (
            <div className="notification error" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {message && (
            <div className="notification" role="status">
              <Check size={17} />
              <span>{message}</span>
              <button aria-label="Dismiss notification" onClick={() => setMessage('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {!session ? (
            <div className="welcome">
              <div className="welcome-emblem">
                <ShieldCheck size={48} />
              </div>
              <span className="eyebrow accent">YOUR CAMPAIGN. UNDER YOUR CONTROL.</span>
              <h1>
                Know your save.
                <br />
                Preserve every byte.
              </h1>
              <p>
                Inspect your soldiers, skill cards, and campaign data.
                <br />
                Make precise changes with backups built in.
              </p>
              <button
                className="button primary large-button"
                disabled={busy || !window.editor}
                onClick={() => void open()}
              >
                <FolderOpen size={19} />
                Open a save file
                <ArrowRight size={18} />
              </button>
              <span className="drop-hint">
                or drop a Gears Tactics save anywhere in this window
              </span>
              <div className="welcome-features">
                <span>
                  <LockKeyhole size={15} />
                  Opens read only
                </span>
                <span>
                  <ShieldCheck size={15} />
                  Automatic backups
                </span>
                <span>
                  <HardDrive size={15} />
                  100% local
                </span>
              </div>
              {!window.editor && (
                <div className="warning-note">
                  Launch the Electron desktop app with <code>npm run dev</code> to open local save
                  files.
                </div>
              )}
              <div className="welcome-example">
                <FilePlus2 size={19} />
                <div>
                  <strong>Extensionless saves welcome</strong>
                  <code>geargamesavegame_slot_39</code>
                </div>
                <span className="tag neutral">GVAS</span>
              </div>
            </div>
          ) : (
            <>
              {blocking > 0 && (
                <div className="warning-note">
                  Saving has been disabled because this save contains structures the editor cannot
                  safely preserve.{' '}
                  <button className="text-button" onClick={() => setDiagnosticsOpen(true)}>
                    View {blocking} blocking diagnostics
                  </button>
                </div>
              )}
              {page === 'Overview' && (
                <Overview
                  session={session}
                  onSoldier={(id) => {
                    setSelected(id);
                    setPage('Soldiers');
                  }}
                />
              )}
              {page === 'Soldiers' && (
                <Soldiers
                  session={session}
                  selected={selected}
                  onSelect={setSelected}
                  developer={settings.developerMode}
                  drafts={drafts}
                  onDraft={draft}
                  transferBusy={busy}
                  onExport={(index) => void exportSoldier(index)}
                  onImport={() => void importSoldier()}
                  onInspect={(id) => {
                    setInspected(id);
                    setPage('Raw Inspector');
                  }}
                />
              )}
              {page === 'Campaign' && (
                <Campaign session={session} drafts={drafts} onDraft={draft} />
              )}
              {page === 'Raw Inspector' && settings.developerMode && (
                <Inspector session={session} selected={inspected} onSelect={setInspected} />
              )}
              <button className="diagnostics-link" onClick={() => setDiagnosticsOpen(true)}>
                <Activity size={14} />
                {session.warnings.length} parser diagnostics
                {blocking ? ` · ${blocking} blocking` : ''}
                <ChevronDown size={14} />
              </button>
            </>
          )}
        </main>
        {session && (
          <footer className="editing-bar">
            <div className="history-actions">
              <button
                className="icon-button"
                title="Undo applied changes"
                aria-label="Undo"
                disabled={busy || !session.canUndo || draftCount > 0}
                onClick={() => void history('undo')}
              >
                <Undo2 size={18} />
              </button>
              <button
                className="icon-button"
                title="Redo applied changes"
                aria-label="Redo"
                disabled={busy || !session.canRedo || draftCount > 0}
                onClick={() => void history('redo')}
              >
                <Redo2 size={18} />
              </button>
              <button
                className="text-button"
                disabled={busy || !hasChanges}
                onClick={() => void history('revert')}
              >
                Revert all
              </button>
            </div>
            <div className="save-reassurance">
              <ShieldCheck size={15} />
              <span>
                {draftCount
                  ? `${draftCount} draft ${draftCount === 1 ? 'value' : 'values'} · apply to review`
                  : 'Backup will be created automatically when saving.'}
              </span>
            </div>
            <div className="footer-actions">
              {!session.editing ? (
                <button
                  className="button primary"
                  disabled={busy || !session.canSave}
                  onClick={() =>
                    void run(async () =>
                      accept(unwrap(await window.editor!.enableEditing(session.id))),
                    )
                  }
                >
                  Enable editing
                </button>
              ) : (
                <button
                  className="button secondary"
                  disabled={busy || !draftCount}
                  onClick={() => void apply()}
                >
                  Apply changes{draftCount > 0 && <span className="count">{draftCount}</span>}
                </button>
              )}
              <button
                className="button secondary"
                disabled={busy || draftCount > 0 || !session.canSave}
                onClick={() => void save(true)}
              >
                Save as…
              </button>
              <button
                className="button primary"
                disabled={busy || draftCount > 0 || !session.canSave || !session.dirty}
                onClick={() => setChangesOpen(true)}
              >
                <Save size={15} />
                Save
              </button>
            </div>
          </footer>
        )}
        <div className="statusbar">
          <span>
            <span className="status-dot" />
            {busy ? 'WORKING…' : session ? 'SAVE LOADED' : 'READY'}
          </span>
          <span>
            {session
              ? `${session.filename} · ${session.objects.length.toLocaleString()} objects`
              : 'No save file open'}
          </span>
          <span>OFFLINE · NO TELEMETRY</span>
        </div>
      </div>
      {dragging && (
        <div className="drop-overlay">
          <FolderOpen size={42} />
          <h2>Drop to inspect</h2>
          <p>Your file will open in read-only mode.</p>
        </div>
      )}
      {settingsOpen && (
        <Settings
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={async (value) => {
            await run(async () => {
              setSettings(unwrap(await window.editor!.updateSettings(value)));
              const latest = unwrap(await window.editor!.current());
              if (latest) setSession(latest);
              if (!value.developerMode && page === 'Raw Inspector') setPage('Overview');
              setSettingsOpen(false);
            });
          }}
        />
      )}
      {soldierImport && session && (
        <SoldierImport
          preview={soldierImport}
          busy={busy}
          onClose={() => {
            if (busy) return;
            void run(async () => {
              unwrap(await window.editor!.cancelSoldierImport(session.id, soldierImport.token));
              setSoldierImport(null);
            });
          }}
          onApply={(mode, target) =>
            void run(async () => {
              accept(
                unwrap(
                  await window.editor!.applySoldierImport(
                    session.id,
                    soldierImport.revision,
                    soldierImport.token,
                    mode,
                    target,
                  ),
                ),
              );
              setSoldierImport(null);
            })
          }
        />
      )}
      {changesOpen && session && (
        <Modal title="Pending changes" onClose={() => setChangesOpen(false)}>
          <p className="muted">
            Review the exact values that will be written. Unknown data and unrelated regions remain
            byte-identical.
          </p>
          {session.dirty ? (
            <div className="patch-list">
              {session.structuralChanges.map((label, index) => (
                <div className="patch" key={`import-${index}`}>
                  <strong>{label}</strong>
                  <p>
                    Complete soldier transaction; destination action points and campaign state
                    preserved.
                  </p>
                </div>
              ))}
              {session.patches.map((p) => (
                <div className="patch" key={p.offset}>
                  <strong>{p.label}</strong>
                  <div className="patch-values">
                    <del>{formatNumber(p.oldValue)}</del>
                    <ArrowRight size={15} />
                    <b>{formatNumber(p.newValue)}</b>
                  </div>
                  {settings.developerMode && (
                    <code>
                      0x{p.offset.toString(16)} · {p.oldHex} → {p.newHex}
                    </code>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state small">
              <ShieldCheck size={30} />
              <p>No applied changes. Original bytes are intact.</p>
            </div>
          )}
          {draftCount > 0 && (
            <div className="warning-note">Apply {draftCount} draft values before saving.</div>
          )}
          <div className="inline-note">
            Backup will be created automatically when saving. The generated file is reparsed and
            checked before and after replacement.
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setChangesOpen(false)}>
              Keep editing
            </button>
            <button
              className="button primary"
              disabled={busy || draftCount > 0 || !session.canSave || !session.dirty}
              onClick={() => void save()}
            >
              <Save size={16} />
              Save {appliedCount} changes
            </button>
          </div>
        </Modal>
      )}
      {diagnosticsOpen && session && (
        <Modal title="Parser diagnostics" onClose={() => setDiagnosticsOpen(false)}>
          <p className="muted">
            Inferences are labeled. Only structural errors and unknown layouts block saving.
          </p>
          <div className="diagnostic-list">
            {session.warnings.map((w, i) => (
              <div className={`diagnostic ${w.severity}`} key={i}>
                <span className="tag neutral">{w.code}</span>
                <p>{w.message}</p>
                <small>
                  {w.objectIndex !== undefined ? `Object #${w.objectIndex} · ` : ''}
                  {w.blocksSaving ? 'Saving disabled' : 'Inspection note'}
                </small>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDiagnosticsOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
