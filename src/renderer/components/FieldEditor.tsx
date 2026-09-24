import type { FieldView } from '../../shared/api';
export const fieldLabels: Record<string, string> = {
  CurrentAbilityPoints: 'Ability points',
  MovementPoints: 'Movement',
  ActionPoints: 'Actions',
  SoldierRosterSize: 'Roster capacity',
  SquadId: 'Squad ID',
  SquadSlotId: 'Squad slot',
};
export const formatNumber = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(7)));
export default function FieldEditor({
  name,
  value,
  field,
  editing,
  draft,
  onChange,
}: {
  name: string;
  value?: number;
  field?: FieldView;
  editing: boolean;
  draft?: string;
  onChange: (value: string) => void;
}) {
  const label = fieldLabels[name] ?? name;
  const number = draft !== undefined ? Number(draft) : value;
  const invalid =
    draft !== undefined &&
    (draft.trim() === '' ||
      !Number.isFinite(number) ||
      number! < (field?.minimum ?? 0) ||
      number! > (field?.maximum ?? Infinity) ||
      (field?.type === 'IntProperty' && !Number.isInteger(number)));
  return (
    <div
      className={`stat-field ${name === 'CurrentAbilityPoints' ? 'highlight-field' : ''} ${draft !== undefined ? 'changed-field' : ''}`}
    >
      <label>
        {label}
        {editing && field ? (
          <input
            aria-label={label}
            type="number"
            step={field.type === 'FloatProperty' ? 'any' : 1}
            min={field.minimum}
            max={field.maximum}
            value={draft ?? formatNumber(field.value)}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
          />
        ) : (
          <strong>
            {value === undefined
              ? '—'
              : name === 'Accuracy'
                ? `${formatNumber(value * 100)}%`
                : formatNumber(value)}
          </strong>
        )}
      </label>
      <small>
        {invalid
          ? 'Enter a valid value within the supported range.'
          : number !== undefined && field && number > field.warningAbove
            ? 'Extreme value — may affect game balance or behavior.'
            : name === 'Accuracy' && editing
              ? 'Raw multiplier · 0.6 = 60%'
              : name === 'CurrentAbilityPoints'
                ? 'Spend through the in-game skill tree'
                : !field
                  ? value === undefined
                    ? 'Not serialized · read only'
                    : 'Read only'
                  : `${field.type === 'FloatProperty' ? 'Float32' : 'Int32'} · 4 bytes`}
      </small>
    </div>
  );
}
