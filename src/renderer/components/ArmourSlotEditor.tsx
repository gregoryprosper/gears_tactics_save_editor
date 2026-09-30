import type { ArmourOption, EquipmentSlotView } from '../../shared/api';
import { armourFamilyName } from '../../shared/armour-names';
export const shortGuid = (guid: string) => guid.slice(0, 8).toUpperCase();

function optionLabel(option: ArmourOption): string {
  const name = option.name ?? shortGuid(option.guid);
  const rarity = option.rarity ? ` · ${option.rarity}` : '';
  const stock = option.quantity !== undefined ? ` · stock ${option.quantity}` : '';
  return `${name}${rarity}${stock}`;
}
export default function ArmourSlotEditor({
  slot,
  editing,
  developer,
  draft,
  onChange,
}: {
  slot: EquipmentSlotView;
  editing: boolean;
  developer: boolean;
  draft?: string;
  onChange: (value: string) => void;
}) {
  const label = `Armour slot ${slot.slot + 1}`;
  const current = draft !== undefined && draft !== '' ? draft : slot.guid;
  const currentOption = current
    ? slot.options.find((option) => option.guid === current)
    : undefined;
  const currentName = current
    ? (currentOption?.name ?? armourFamilyName(current) ?? shortGuid(current))
    : null;
  const currentRarity = currentOption?.rarity;
  const selectable = editing && slot.resolvable && slot.options.length > 0;
  return (
    <div
      className={`stat-field ${draft !== undefined ? 'changed-field' : ''} ${
        slot.guid === null ? 'muted' : ''
      }`}
    >
      <label>
        {label}
        {selectable ? (
          <select
            aria-label={label}
            value={current ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            {slot.options.map((option) => (
              <option key={option.guid} value={option.guid}>
                {optionLabel(option)}
                {option.guid === slot.guid ? ' · current' : ''}
              </option>
            ))}
          </select>
        ) : (
          <strong>
            {currentName
              ? currentRarity
                ? `${currentName} (${currentRarity})`
                : currentName
              : 'Empty'}
          </strong>
        )}
      </label>
      <small>
        {slot.guid === null
          ? 'No native equipment record.'
          : !slot.resolvable
            ? 'Internal record · not in this save’s armour inventory'
            : !editing
              ? 'Read only'
              : slot.options.length <= 1
                ? 'No alternative pieces with a matching slot in this save'
                : developer
                  ? `${slot.options.length} pieces · kind ${slot.kind} · entry flag ${slot.flag}`
                  : `${slot.options.length} pieces with a matching slot`}
      </small>
    </div>
  );
}
