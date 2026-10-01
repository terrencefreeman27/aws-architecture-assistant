import { FIELD_META, computeCompleteness, requiredFields } from '../../shared/requirements';
import { REGIONS, type RequirementField, type Requirements } from '../../shared/schema';
import { SCENARIOS } from '../../shared/scenarios';
import { SELECT_OPTIONS } from './options';

interface Props {
  requirements: Requirements;
  onChange: (next: Requirements) => void;
  onLoadScenario: (id: string) => void;
  onGenerate: () => void;
  onReset: () => void;
  activeScenario: string | null;
  loading: boolean;
}

type FieldKind = 'textarea' | 'text' | 'select' | 'region';

const GROUPS: { title: string; fields: [RequirementField, FieldKind][] }[] = [
  { title: 'The system', fields: [['description', 'textarea'], ['workloadType', 'select'], ['existingSystems', 'textarea']] },
  { title: 'Usage and data', fields: [['expectedUsage', 'select'], ['usageNotes', 'text'], ['dataSensitivity', 'select'], ['region', 'region']] },
  { title: 'Resilience and cost', fields: [['availability', 'select'], ['recoveryNotes', 'text'], ['budget', 'select']] },
  { title: 'Operations', fields: [['operations', 'select'], ['operationsNotes', 'text']] },
];

export function RequirementsPanel({ requirements, onChange, onLoadScenario, onGenerate, onReset, activeScenario, loading }: Props) {
  const completeness = computeCompleteness(requirements);
  const required = new Set<RequirementField>(requiredFields(requirements));
  const set = (field: RequirementField, value: string) => onChange({ ...requirements, [field]: value } as Requirements);

  return (
    <aside className="sidebar" aria-label="Requirements">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">AW</span>
        <div>
          <h1>Architecture Design Assistant</h1>
          <p>Requirements in, reviewable AWS plan out.</p>
        </div>
      </header>

      <section className="side-section">
        <h2 className="side-heading">Start from a sample</h2>
        <div className="scenario-list">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`scenario${activeScenario === s.id ? ' is-active' : ''}`}
              onClick={() => onLoadScenario(s.id)}
              aria-pressed={activeScenario === s.id}
            >
              <span className="scenario-name">{s.name}</span>
              <span className="scenario-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="side-section completeness" aria-live="polite">
        <div className="completeness-row">
          <h2 className="side-heading">Requirements</h2>
          <span className="completeness-count">
            {completeness.answered} of {completeness.required} required
          </span>
        </div>
        <div
          className="meter"
          role="progressbar"
          aria-label="Requirements completeness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completeness.percent}
        >
          <span style={{ width: `${completeness.percent}%` }} />
        </div>
        {completeness.missing.length > 0 ? (
          <p className="meter-note">Missing: {completeness.missing.map((f) => FIELD_META[f].label).join(', ')}</p>
        ) : (
          <p className="meter-note is-done">Enough to draft a plan. Optional details sharpen it.</p>
        )}
      </section>

      <form
        className="req-form"
        onSubmit={(e) => {
          e.preventDefault();
          onGenerate();
        }}
      >
        {GROUPS.map((group) => (
          <fieldset key={group.title}>
            <legend>{group.title}</legend>
            {group.fields.map(([field, kind]) => {
              const meta = FIELD_META[field];
              const id = `field-${field}`;
              const isReq = required.has(field);
              const missing = completeness.missing.includes(field);
              return (
                <div className={`field${missing ? ' is-missing' : ''}`} key={field}>
                  <label htmlFor={id}>
                    {meta.label}
                    <span className={isReq ? 'req-tag' : 'opt-tag'}>{isReq ? 'required' : 'optional'}</span>
                  </label>
                  {kind === 'textarea' && (
                    <textarea id={id} rows={field === 'description' ? 4 : 2} value={requirements[field]} onChange={(e) => set(field, e.target.value)} />
                  )}
                  {kind === 'text' && <input id={id} type="text" value={requirements[field]} onChange={(e) => set(field, e.target.value)} />}
                  {kind === 'select' && (
                    <select id={id} value={requirements[field]} onChange={(e) => set(field, e.target.value)}>
                      <option value="">Not answered</option>
                      {SELECT_OPTIONS[field]?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {kind === 'region' && (
                    <select id={id} value={requirements.region} onChange={(e) => set(field, e.target.value)}>
                      <option value="">Not sure yet</option>
                      {REGIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="hint">{meta.question}</p>
                </div>
              );
            })}
          </fieldset>
        ))}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Generating...' : 'Generate plan'}
          </button>
          <button type="button" className="btn-quiet" onClick={onReset}>
            Clear
          </button>
        </div>
      </form>
    </aside>
  );
}

