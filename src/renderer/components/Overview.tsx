import {
  ArrowUpRight,
  Boxes,
  Check,
  FileCheck2,
  HardDrive,
  ShieldCheck,
  Users,
  Waypoints,
} from 'lucide-react';
import type { SessionView } from '../../shared/api';
export const formatBytes = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
export function ClassMark({ name }: { name: string }) {
  return (
    <span className={`class-mark class-${name.toLowerCase()}`}>
      {name === 'Support'
        ? '+'
        : name === 'Vanguard'
          ? 'V'
          : name === 'Scout'
            ? 'S'
            : name === 'Heavy'
              ? 'H'
              : name === 'Jack'
                ? 'J'
                : '⌖'}
    </span>
  );
}
export default function Overview({
  session: s,
  onSoldier,
}: {
  session: SessionView;
  onSoldier: (index: number) => void;
}) {
  const complete = s.campaign.completion === undefined ? undefined : s.campaign.completion * 100;
  const equipped = s.characters.reduce(
    (n, c) => n + c.cardSlots.filter((slot) => slot.status === 'Equipped').length,
    0,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">OPERATIONS / SAVE INTELLIGENCE</div>
          <h1>Campaign overview</h1>
          <p>A clear view of your campaign. The original file stays untouched until you save.</p>
        </div>
        <span className="tag neutral">GVAS · {s.header.saveVersion}.0</span>
      </div>
      <div className="campaign-banner">
        <div className="banner-grid" />
        <div>
          <span className="eyebrow accent">CAMPAIGN RECORD</span>
          <h2>
            {s.campaign.mission?.replace('Mission', 'Mission ').replace('_', ' · ') ??
              'Unknown mission'}
          </h2>
          <div className="banner-meta">
            <span>{s.campaign.difficulty ?? 'Unknown difficulty'}</span>
            <span>{s.campaign.gameType ?? 'Unknown game type'}</span>
            <span>{s.campaign.gameState}</span>
          </div>
        </div>
        <div className="completion">
          <span className="eyebrow">CAMPAIGN COMPLETION</span>
          <strong>{complete === undefined ? '—' : `${complete.toFixed(1)}%`}</strong>
          <div className="progress-track">
            <div style={{ width: `${Math.min(100, complete ?? 0)}%` }} />
          </div>
        </div>
      </div>
      <div className="metrics">
        <Metric
          icon={<Users size={19} />}
          label="CHARACTER RECORDS"
          value={s.characters.length}
          note={`Roster capacity ${s.campaign.rosterCapacity ?? 'not serialized'}`}
        />
        <Metric
          icon={<Boxes size={19} />}
          label="RESOLVED OBJECTS"
          value={s.objects.length.toLocaleString()}
          note="Discovered from the object table"
        />
        <Metric
          icon={<Waypoints size={19} />}
          label="EQUIPPED SKILLS"
          value={equipped}
          note="Across all character records"
        />
        <Metric
          icon={<HardDrive size={19} />}
          label="SAVE SIZE"
          value={formatBytes(s.size)}
          note="Original binary preserved"
        />
      </div>
      <div className="overview-columns">
        <section className="panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">PERSONNEL</span>
              <h3>Roster at a glance</h3>
            </div>
            <span className="count">{s.characters.length}</span>
          </div>
          <div className="roster-preview">
            {s.characters.slice(0, 6).map((c) => (
              <button key={c.objectIndex} onClick={() => onSoldier(c.objectIndex)}>
                <ClassMark name={c.combatClass} />
                <div>
                  <strong>{c.displayName}</strong>
                  <small>
                    {c.callsign ? `“${c.callsign}” · ` : ''}
                    {c.combatClass}
                    {c.classInferred ? ' (inferred)' : ''}
                  </small>
                </div>
                <span className="level">LVL {c.stats.Level ?? '—'}</span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        </section>
        <section className="panel integrity">
          <div className="panel-title">
            <div>
              <span className="eyebrow">FILE INTEGRITY</span>
              <h3>Preservation first</h3>
            </div>
            <ShieldCheck size={24} className="accent" />
          </div>
          <div className="integrity-row">
            <Check size={16} />
            <div>
              <strong>Original bytes retained</strong>
              <p>Unknown and native data remain intact.</p>
            </div>
          </div>
          <div className="integrity-row">
            <FileCheck2 size={16} />
            <div>
              <strong>{s.canSave ? 'Structural checks passed' : 'Inspection only'}</strong>
              <p>
                {s.canSave
                  ? 'Only validated scalar fields can be patched.'
                  : 'Resolve blocking diagnostics before saving.'}
              </p>
            </div>
          </div>
          <div className="integrity-row">
            <ShieldCheck size={16} />
            <div>
              <strong>Automatic, numbered backups</strong>
              <p>Backup will be created automatically when saving.</p>
            </div>
          </div>
          <div className="inline-note">
            Binary validation does not certify in-game behavior. Keep your backups.
          </div>
        </section>
      </div>
      <section className="panel file-details">
        <span className="eyebrow">SOURCE FILE</span>
        <strong>{s.filename}</strong>
        <code>{s.path}</code>
        <div>
          <span>ENGINE {s.header.engineVersion}</span>
          <span>LOCAL ONLY</span>
          <span>NO TELEMETRY</span>
        </div>
      </section>
    </>
  );
}
function Metric({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <section className="metric">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}
