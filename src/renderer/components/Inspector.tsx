import { useEffect, useState } from 'react';
import { Search, ArrowUpRight, Braces } from 'lucide-react';
import type { ObjectDetail, SessionView } from '../../shared/api';
export default function Inspector({
  session: s,
  selected,
  onSelect,
}: {
  session: SessionView;
  selected: number | undefined;
  onSelect: (index: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [klass, setKlass] = useState('');
  const [mode, setMode] = useState('Objects');
  const [detail, setDetail] = useState<ObjectDetail>();
  const [error, setError] = useState('');
  const [hex, setHex] = useState('');
  const [strings, setStrings] = useState<{ offset: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const objects = s.objects.filter(
    (o) =>
      (!klass || o.classPath === klass) &&
      `${o.name} ${o.outerPath} ${o.classPath} ${o.searchText}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const current = selected ?? objects[0]?.index;
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setHex('');
    if (current !== undefined)
      void window.editor!.inspect(s.id, current).then((result) => {
        if (active) {
          if (result.ok) setDetail(result.value);
          else setError(result.error);
        }
      });
    return () => {
      active = false;
    };
  }, [s.id, current]);
  async function showHex(offset: number) {
    const result = await window.editor!.hex(s.id, offset);
    if (result.ok) setHex(result.value);
    else setError(result.error);
  }
  async function searchStrings() {
    setSearching(true);
    try {
      const result = await window.editor!.strings(s.id, query);
      if (result.ok) {
        setStrings(result.value);
        setError('');
      } else setError(result.error);
    } finally {
      setSearching(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DEVELOPER / REVERSE ENGINEERING</div>
          <h1>Raw inspector</h1>
          <p>Follow object references, inspect tagged properties, and examine original bytes.</p>
        </div>
        <span className="tag neutral">READ ONLY</span>
      </div>
      <div className="inspector-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Search objects, properties, or strings"
            placeholder="Search objects, property names, values…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter object class"
          value={klass}
          onChange={(e) => setKlass(e.target.value)}
        >
          <option value="">All object classes</option>
          {[...new Set(s.objects.map((o) => o.classPath))].sort().map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="segmented">
          {['Objects', 'Strings'].map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {mode === 'Strings' ? (
        <section className="panel padded">
          <h3>Serialized string search</h3>
          <p className="muted">
            Search ASCII / UTF-8 and UTF-16 FStrings, including unmapped native data. Up to 200
            results. These are inspection candidates.
          </p>
          <button
            className="button secondary"
            disabled={query.length < 2 || searching}
            onClick={() => void searchStrings()}
          >
            {searching ? 'Searching…' : 'Search original bytes'}
          </button>
          <div className="string-results">
            {strings.map((match) => (
              <button key={match.offset} onClick={() => void showHex(match.offset)}>
                <code>0x{match.offset.toString(16)}</code>
                <span>{match.text}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="inspector-layout">
          <aside className="panel object-list">
            <div className="list-caption">{objects.length} MATCHING OBJECTS</div>
            {objects.slice(0, 400).map((o) => (
              <button
                key={o.index}
                className={current === o.index ? 'selected' : ''}
                onClick={() => onSelect(o.index)}
              >
                <span>#{o.index}</span>
                <strong>{o.name}</strong>
                <small>
                  {o.propertyCount} properties · {o.classPath.split('.').pop()}
                </small>
              </button>
            ))}
            {objects.length > 400 && (
              <p className="muted padded">Showing 400 results. Narrow your search.</p>
            )}
          </aside>
          <section className="panel object-detail">
            {detail ? (
              <>
                <div className="padded">
                  <span className="eyebrow">OBJECT #{detail.index}</span>
                  <h3>{detail.name}</h3>
                  <code className="path-line">{detail.classPath}</code>
                  <code className="path-line">{detail.outerPath}</code>
                  {detail.outerIndex !== undefined && detail.outerIndex >= 0 && (
                    <button className="text-button" onClick={() => onSelect(detail.outerIndex!)}>
                      Outer object #{detail.outerIndex} <ArrowUpRight size={13} />
                    </button>
                  )}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Property / type</th>
                        <th>Original value</th>
                        <th>Offset / bytes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.properties.map((p) => (
                        <tr key={`${p.offset}:${p.name}`}>
                          <td>
                            <strong>{p.name}</strong>
                            <small>
                              {p.type}
                              {p.metadata ? ` · ${p.metadata}` : ''}
                            </small>
                          </td>
                          <td>
                            {p.referenceIndex !== undefined &&
                            p.referenceIndex >= 0 &&
                            p.referenceIndex < s.objects.length ? (
                              <button
                                className="text-button"
                                onClick={() => onSelect(p.referenceIndex!)}
                              >
                                {p.value}
                                <ArrowUpRight size={12} />
                              </button>
                            ) : (
                              <span>{p.value}</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="text-button mono"
                              onClick={() => void showHex(p.valueOffset)}
                            >
                              0x{p.valueOffset.toString(16)}
                            </button>
                            <small>{p.size} bytes</small>
                            <details>
                              <summary>Raw payload</summary>
                              <code>
                                {p.rawHex || '(in tag)'}
                                {p.size > 128 ? ' …' : ''}
                              </code>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!detail.properties.length && (
                    <p className="muted padded">
                      No tagged properties. Native or external object data is retained unchanged.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <Braces size={28} />
                <p>Select an object to inspect it.</p>
              </div>
            )}
          </section>
        </div>
      )}
      {hex && (
        <section className="panel hex-panel">
          <div className="panel-title">
            <h3>Original bytes</h3>
            <button className="text-button" onClick={() => setHex('')}>
              Close
            </button>
          </div>
          <pre>{hex}</pre>
        </section>
      )}
    </>
  );
}
