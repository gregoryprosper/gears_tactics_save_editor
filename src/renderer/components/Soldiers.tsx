import { useState } from 'react';
import { Search, Shield, LockKeyhole, Crosshair, ChevronRight } from 'lucide-react';
import type { SessionView } from '../../shared/api';
import { ClassMark } from './Overview';
import FieldEditor from './FieldEditor';
import LearnedSkills from './LearnedSkills';
export const fieldKey = (index: number, name: string) => `${index}:${name}`;
export default function Soldiers({
  session: s,
  selected,
  onSelect,
  developer,
  drafts,
  onDraft,
  onInspect,
}: {
  session: SessionView;
  selected: number | undefined;
  onSelect: (id: number) => void;
  developer: boolean;
  drafts: Record<string, string>;
  onDraft: (key: string, value: string) => void;
  onInspect: (id: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('Stats');
  const character = s.characters.find((c) => c.objectIndex === selected) ?? s.characters[0];
  const roster = s.characters.filter((c) =>
    `${c.displayName} ${c.callsign ?? ''} ${c.combatClass}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  if (!character)
    return (
      <div className="empty-state">
        <UsersEmpty />
        <h2>No character records discovered</h2>
        <p>Check parser diagnostics and the raw object table.</p>
      </div>
    );
  const object = s.objects.find((o) => o.index === character.objectIndex)!;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PERSONNEL / CHARACTER RECORDS</div>
          <h1>Soldiers</h1>
          <p>Inspect your roster and make precise, reversible stat changes.</p>
        </div>
        <span className="tag neutral">{s.characters.length} RECORDS</span>
      </div>
      <div className="soldier-layout">
        <aside className="roster-panel panel">
          <label className="search">
            <Search size={16} />
            <input
              placeholder="Search soldiers…"
              aria-label="Search soldiers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="roster-list">
            {roster.map((c) => (
              <button
                className={c.objectIndex === character.objectIndex ? 'selected' : ''}
                onClick={() => onSelect(c.objectIndex)}
                key={c.objectIndex}
              >
                <ClassMark name={c.combatClass} />
                <div>
                  <strong>{c.displayName}</strong>
                  <small>
                    {c.combatClass} · Level {c.stats.Level ?? '—'}
                  </small>
                  {c.callsign && <small className="callsign">“{c.callsign}”</small>}
                </div>
                <ChevronRight size={13} />
              </button>
            ))}
            {roster.length === 0 && <p className="muted padded">No soldiers match this search.</p>}
          </div>
        </aside>
        <section className="soldier-detail panel">
          <div className="soldier-header">
            <div className="soldier-emblem">
              <ClassMark name={character.combatClass} />
            </div>
            <div>
              <span className="eyebrow">
                {character.hero && character.hero !== 'None' ? 'HERO RECORD' : 'SOLDIER RECORD'} / #
                {character.objectIndex}
              </span>
              <h2>{character.displayName}</h2>
              <p>
                {character.callsign ? `“${character.callsign}” · ` : ''}
                {character.combatClass}
                {character.classInferred ? ' · inferred from omitted CombatClass' : ''}
              </p>
            </div>
            <span className="level large">
              LVL <b>{character.stats.Level ?? '—'}</b>
            </span>
          </div>
          <div className="tabs" role="tablist">
            {['Stats', 'Skills', 'Identity', ...(developer ? ['Internals'] : [])].map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
              >
                {name}
                {name === 'Skills' && character.learnedSkills && (
                  <span>{character.learnedSkills.nodes.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="soldier-content">
            {tab === 'Stats' && (
              <>
                <div className="section-caption">
                  <div>
                    <h3>Combat statistics</h3>
                    <p>Existing values only. Changes stay in memory until saved.</p>
                  </div>
                  <span className={`tag ${s.editing ? 'success' : 'neutral'}`}>
                    {s.editing ? 'EDITING ENABLED' : 'READ ONLY'}
                  </span>
                </div>
                <div className="stats-grid">
                  {[
                    'Level',
                    'Health',
                    'Accuracy',
                    'Strength',
                    'MovementPoints',
                    'ActionPoints',
                    'CurrentAbilityPoints',
                  ].map((name) => {
                    const key = fieldKey(character.objectIndex, name);
                    return (
                      <FieldEditor
                        key={`${character.objectIndex}:${name}`}
                        name={name}
                        value={
                          s.fields.find(
                            (f) => f.objectIndex === character.objectIndex && f.name === name,
                          )?.value ?? character.stats[name]
                        }
                        field={s.fields.find(
                          (f) => f.objectIndex === character.objectIndex && f.name === name,
                        )}
                        editing={s.editing}
                        draft={drafts[key]}
                        onChange={(v) => onDraft(key, v)}
                      />
                    );
                  })}
                </div>
                <div className="squad-strip">
                  <Shield size={18} />
                  <div>
                    <strong>Squad assignment</strong>
                    <small>
                      Squad {character.stats.SquadId ?? 'not serialized'} · Slot{' '}
                      {character.stats.SquadSlotId ?? 'not serialized'}
                    </small>
                  </div>
                  <LockKeyhole size={14} />
                  <span>Advanced · read only</span>
                </div>
              </>
            )}
            {tab === 'Skills' && (
              <>
                <LearnedSkills character={character} developer={developer} />
                <div className="section-caption">
                  <div>
                    <h3>Equipped ability cards</h3>
                    <p>
                      These slots show equipped cards only. Empty slots do not mean skills are
                      locked.
                    </p>
                  </div>
                  <span className="tag neutral">READ ONLY</span>
                </div>
                <div className="skills-grid">
                  {character.cardSlots.map((slot) => (
                    <div
                      className={`skill-card ${slot.status === 'Empty' ? 'empty' : ''}`}
                      key={slot.objectIndex}
                    >
                      <span className="slot-number">
                        {String(slot.slotNumber + 1).padStart(2, '0')}
                      </span>
                      <span className={`skill-status ${slot.status.toLowerCase()}`}>
                        {slot.status}
                      </span>
                      <Crosshair size={23} />
                      <h4>
                        {slot.abilityLabel ??
                          (slot.status === 'Empty' ? 'Empty slot' : 'Unresolved ability')}
                      </h4>
                      <code>{slot.abilityCard?.name ?? 'No AbilityCard property'}</code>
                      <small>
                        SlotNum {slot.slotNumber}
                        {slot.inferredSlotNumber ? ' (default inferred)' : ''} · Object #
                        {slot.objectIndex}
                        {slot.abilityCard ? ` → #${slot.abilityCard.index}` : ''}
                      </small>
                    </div>
                  ))}
                </div>
              </>
            )}
            {tab === 'Identity' && (
              <>
                <div className="section-caption">
                  <div>
                    <h3>Character identity</h3>
                    <p>Localized names and custom text are preserved in their original form.</p>
                  </div>
                  <LockKeyhole size={16} />
                </div>
                <dl className="definition-list">
                  {[
                    ['First name', character.firstName ?? 'Localized / not serialized'],
                    ['Surname', character.lastName ?? 'Localized / not serialized'],
                    ['Callsign', character.callsign ?? 'Localized / not serialized'],
                    [
                      'Display callsign',
                      character.showCallsign === undefined
                        ? 'Not serialized'
                        : character.showCallsign
                          ? 'Shown'
                          : 'Hidden',
                    ],
                    ['Hero identifier', character.hero ?? 'Not serialized'],
                    ['Object name', character.objectName],
                  ].map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="inline-note">
                  Text editing is deferred until its complete serialization is verified.
                  Localization keys are never replaced blindly.
                </div>
              </>
            )}
            {tab === 'Internals' && developer && (
              <>
                <div className="section-caption">
                  <div>
                    <h3>Class internals</h3>
                    <p>Reference mapping for future analysis. Reclassing is unavailable.</p>
                  </div>
                </div>
                <dl className="definition-list">
                  <div>
                    <dt>Object index</dt>
                    <dd>{character.objectIndex}</dd>
                  </div>
                  <div>
                    <dt>Outer path</dt>
                    <dd>
                      <code>{object.outerPath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Class path</dt>
                    <dd>
                      <code>{object.classPath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>CombatClass</dt>
                    <dd>{character.internalClass ?? 'Omitted (default inference)'}</dd>
                  </div>
                  <div>
                    <dt>Unit references</dt>
                    <dd>
                      {character.unitReferences.map((r) => (
                        <button
                          className="text-button"
                          key={r.index}
                          onClick={() => onInspect(r.index)}
                        >
                          #{r.index} {r.name}
                        </button>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Card slots</dt>
                    <dd>
                      {character.cardSlots.map((slot) => (
                        <button
                          className="index-button"
                          key={slot.objectIndex}
                          onClick={() => onInspect(slot.objectIndex)}
                        >
                          #{slot.objectIndex}
                        </button>
                      ))}
                    </dd>
                  </div>
                </dl>
                <button
                  className="button secondary"
                  onClick={() => onInspect(character.objectIndex)}
                >
                  Inspect all raw properties <ChevronRight size={15} />
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
function UsersEmpty() {
  return <Shield size={32} />;
}
