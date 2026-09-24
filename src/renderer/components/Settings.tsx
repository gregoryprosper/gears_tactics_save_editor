import { useState } from 'react';
import type { Settings as Preferences } from '../../shared/api';
import Modal from './Modal';
export default function Settings({
  settings,
  onClose,
  onSave,
}: {
  settings: Preferences;
  onClose: () => void;
  onSave: (value: Preferences) => Promise<void>;
}) {
  const [value, setValue] = useState(settings);
  const [maximum, setMaximum] = useState(String(settings.abilityPointsMaximum));
  const [saving, setSaving] = useState(false);
  const valid =
    maximum.trim() !== '' &&
    Number.isInteger(Number(maximum)) &&
    Number(maximum) >= 0 &&
    Number(maximum) <= 2147483647;
  return (
    <Modal title="Editor settings" onClose={onClose}>
      <div className="setting-row">
        <div>
          <strong>Developer mode</strong>
          <p>Show class internals, raw properties, object references, and hexadecimal diffs.</p>
        </div>
        <input
          aria-label="Developer mode"
          type="checkbox"
          checked={value.developerMode}
          onChange={(e) => setValue({ ...value, developerMode: e.target.checked })}
        />
      </div>
      <div className="setting-row">
        <div>
          <strong>Ability point maximum</strong>
          <p>Configurable up to the signed 32-bit limit. Values above 100 carry a warning.</p>
        </div>
        <input
          aria-label="Ability point maximum"
          type="number"
          min="0"
          max="2147483647"
          value={maximum}
          onChange={(e) => setMaximum(e.target.value)}
        />
      </div>
      <div className="setting-row">
        <div>
          <strong>Enable Experimental Editing</strong>
          <p>
            Experimental operations may corrupt campaigns. This version does not implement property
            insertion, skill resets, text writing, or reclassing; enabling this setting does not
            unlock them.
          </p>
        </div>
        <input
          aria-label="Enable Experimental Editing"
          type="checkbox"
          checked={value.experimentalEditing}
          onChange={(e) => setValue({ ...value, experimentalEditing: e.target.checked })}
        />
      </div>
      {value.experimentalEditing && (
        <div className="warning-note">
          Experimental editing is acknowledged. Unverified write operations remain unavailable.
        </div>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!valid || saving}
          onClick={() => {
            setSaving(true);
            void onSave({ ...value, abilityPointsMaximum: Number(maximum) }).finally(() =>
              setSaving(false),
            );
          }}
        >
          Save settings
        </button>
      </div>
    </Modal>
  );
}
