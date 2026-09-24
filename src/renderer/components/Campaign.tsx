import type { SessionView } from '../../shared/api';
import FieldEditor from './FieldEditor';
import { fieldKey } from './Soldiers';
export default function Campaign({
  session: s,
  drafts,
  onDraft,
}: {
  session: SessionView;
  drafts: Record<string, string>;
  onDraft: (key: string, value: string) => void;
}) {
  const field = s.fields.find((f) => f.name === 'SoldierRosterSize');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OPERATIONS / CAMPAIGN STATE</div>
          <h1>Campaign</h1>
          <p>Campaign metadata and the validated roster capacity field.</p>
        </div>
      </div>
      <div className="overview-columns">
        <section className="panel padded">
          <h3>Roster capacity</h3>
          <p className="muted">
            This changes the capacity value. It does not create or delete soldier records.
          </p>
          <FieldEditor
            name="SoldierRosterSize"
            value={field?.value ?? s.campaign.rosterCapacity}
            field={field}
            editing={s.editing}
            draft={field ? drafts[fieldKey(field.objectIndex, field.name)] : undefined}
            onChange={(value) => {
              if (field) onDraft(fieldKey(field.objectIndex, field.name), value);
            }}
          />
          <p className="muted">
            {s.campaign.characterCount} character records found. These may include heroes, recruits,
            or characters outside your active roster.
          </p>
        </section>
        <section className="panel padded">
          <h3>Campaign metadata</h3>
          <dl className="definition-list">
            {Object.entries({
              Mission: s.campaign.mission,
              Completion:
                s.campaign.completion === undefined
                  ? 'Not serialized'
                  : `${(s.campaign.completion * 100).toFixed(1)}%`,
              Difficulty: s.campaign.difficulty,
              'Game type': s.campaign.gameType,
              'Game state': s.campaign.gameState,
            }).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value ?? 'Not serialized'}</dd>
              </div>
            ))}
          </dl>
          <div className="inline-note">
            Mission, difficulty, completion, and game type are read only. Their effects on campaign
            state have not been validated.
          </div>
        </section>
      </div>
    </>
  );
}
