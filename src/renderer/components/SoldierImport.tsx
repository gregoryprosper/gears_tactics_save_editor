import { useState } from 'react';
import type { SoldierImportPreview } from '../../shared/soldier';
import Modal from './Modal';

export default function SoldierImport({
  preview,
  busy,
  onClose,
  onApply,
}: {
  preview: SoldierImportPreview;
  busy: boolean;
  onClose: () => void;
  onApply: (mode: 'add' | 'replace', target?: number) => void;
}) {
  const [mode, setMode] = useState<'add' | 'replace'>(preview.soldier.hero ? 'replace' : 'add');
  const [target, setTarget] = useState<number | undefined>(
    preview.replacements.find((c) => !c.blockers.length)?.objectIndex,
  );
  const choice = preview.replacements.find((c) => c.objectIndex === target);
  const reasons =
    mode === 'add' ? preview.add.blockers : (choice?.blockers ?? ['Select a destination soldier.']);
  return (
    <Modal title="Import soldier" onClose={onClose}>
      <p>
        <strong>{preview.soldier.displayName}</strong> · {preview.soldier.combatClass} · Level{' '}
        {preview.soldier.stats.Level ?? '—'}
      </p>
      <p className="muted">
        {preview.objectCount} archived objects · {preview.soldier.skills.length} skill slots
      </p>
      <div className="warning-note">
        Compatibility preview only. Complete soldier imports are not available in this build. The
        transfer engine can generate separate research copies for game testing. Applying imports
        remains gated until those copies pass in-game validation.
      </div>
      <div className="transfer-options">
        <label>
          Import mode
          <select
            aria-label="Import mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as 'add' | 'replace')}
          >
            <option value="add">Add new soldier</option>
            <option value="replace">Replace existing soldier</option>
          </select>
        </label>
        {mode === 'replace' && (
          <label>
            Destination soldier
            <select
              aria-label="Destination soldier"
              value={target ?? ''}
              onChange={(event) =>
                setTarget(event.target.value === '' ? undefined : Number(event.target.value))
              }
            >
              <option value="">Choose a soldier</option>
              {preview.replacements.map((c) => (
                <option key={c.objectIndex} value={c.objectIndex}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <h3>Compatibility findings</h3>
      <ul className="transfer-findings">
        {[...preview.blockers, ...reasons].map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p className="muted">
        Action points, squad assignment, and campaign progress are not imported. Previewing or
        cancelling never changes the save.
      </p>
      <div className="modal-actions">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Cancel import
        </button>
        <button
          className="button primary"
          disabled={busy || !preview.canApply || reasons.length > 0}
          onClick={() => onApply(mode, target)}
        >
          Apply import
        </button>
      </div>
    </Modal>
  );
}
