import type { AlternativeVariant, ComponentRef, PlanAlternative } from '../../shared/schema';

type Drawn = Extract<AlternativeVariant, { kind: 'diagram' }>;

export const drawnVariant = (alt: PlanAlternative | undefined): Drawn | null => (alt?.variant?.kind === 'diagram' ? alt.variant : null);

/** "Recommended | Alternative: ..." switch above the diagram. Only alternatives with a validated variant appear. */
export function DiagramToggle({ alternatives, shown, onShow }: { alternatives: PlanAlternative[]; shown: number | null; onShow: (index: number | null) => void }) {
  const drawn = alternatives.flatMap((a, i) => (drawnVariant(a) ? [{ a, i }] : []));
  if (drawn.length === 0) return null;
  return (
    <div className="diagram-toggle" role="group" aria-label="Design shown in the diagram" data-testid="diagram-toggle">
      <button type="button" className="toggle-option" aria-pressed={shown === null} onClick={() => onShow(null)} data-testid="diagram-toggle-recommended">
        Recommended
      </button>
      {drawn.map(({ a, i }) => (
        <button key={a.title} type="button" className="toggle-option" aria-pressed={shown === i} onClick={() => onShow(i)} data-testid={`diagram-toggle-${i}`}>
          <span className="toggle-kicker">Alternative:</span> {a.title}
        </button>
      ))}
    </div>
  );
}

function Component({ c }: { c: ComponentRef }) {
  return (
    <li>
      <span className="change-name">{c.label}</span>
      {c.service && c.service !== c.label && <span className="change-svc">{c.service}</span>}
    </li>
  );
}

interface WhatChangesProps {
  alternative: PlanAlternative;
  onUse: () => void;
  onBack: () => void;
  /** The form no longer matches the plan on screen, so applying the alternative would drop those edits. */
  stale: boolean;
  loading: boolean;
}

/** What the alternative changes, computed from the two validated plans, and the way to adopt it. */
export function WhatChanges({ alternative, onUse, onBack, stale, loading }: WhatChangesProps) {
  const v = drawnVariant(alternative);
  if (!v) return null;
  return (
    <section className="what-changes" aria-labelledby="what-changes-heading" data-testid="what-changes">
      <h3 id="what-changes-heading" tabIndex={-1}>
        What changes with this alternative
      </h3>
      <p className="what-changes-note">Compared with the recommended design. Worked out by planning both versions from your answers, not written by hand.</p>
      <div className="change-grid">
        <div className="change-col">
          <h4>Your answer that changes</h4>
          <ul className="change-list is-answer">
            {v.changes.map((c) => (
              <li key={c.field}>{c.label}</li>
            ))}
          </ul>
        </div>
        {v.added.length > 0 && (
          <div className="change-col">
            <h4>
              Added <span className="change-count">{v.added.length}</span>
            </h4>
            <ul className="change-list is-added" data-testid="what-changes-added">
              {v.added.map((c) => (
                <Component key={c.id} c={c} />
              ))}
            </ul>
          </div>
        )}
        {v.removed.length > 0 && (
          <div className="change-col">
            <h4>
              Removed <span className="change-count">{v.removed.length}</span>
            </h4>
            <ul className="change-list is-removed" data-testid="what-changes-removed">
              {v.removed.map((c) => (
                <Component key={c.id} c={c} />
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="what-changes-actions">
        <button type="button" className="btn-primary" onClick={onUse} disabled={stale || loading} data-testid="use-alternative">
          Use this alternative
        </button>
        <button type="button" className="btn-quiet" onClick={onBack}>
          Back to recommended
        </button>
        <p className="what-changes-hint">
          {stale
            ? 'Your answers changed since this plan was made. Regenerate first, then compare again.'
            : 'Changes your answer as shown above and regenerates the plan. You can still edit, share, or undo it in the form.'}
        </p>
      </div>
    </section>
  );
}
