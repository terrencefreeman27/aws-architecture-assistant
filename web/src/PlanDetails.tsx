import { useRef, type KeyboardEvent } from 'react';
import { getService } from '../../shared/catalog';
import { PILLARS, type ResolvedPlan } from '../../shared/schema';
import { TIER_LABELS } from './options';
import { SourceChips } from './SourceChips';

export const TABS = ['Components', 'Data flow', 'Considerations', 'Alternatives', 'Implementation'] as const;
export type PlanTab = (typeof TABS)[number];
export const tabId = (t: PlanTab) => `plan-tab-${t.toLowerCase().replace(/\s+/g, '-')}`;

const PILLAR_TITLES: Record<string, string> = {
  security: 'Security',
  reliability: 'Reliability',
  performance: 'Performance',
  operations: 'Operations',
  cost: 'Cost (drivers, not estimates)',
};

interface Props {
  plan: ResolvedPlan;
  tab: PlanTab;
  onTabChange: (tab: PlanTab) => void;
  /** Alternative currently drawn in the diagram, if any. */
  shownAlt?: number | null;
  onViewAlternative?: (index: number) => void;
}

export function PlanDetails({ plan, tab, onTabChange, shownAlt = null, onViewAlternative }: Props) {
  const list = useRef<HTMLDivElement>(null);

  // Arrow keys, Home, and End move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    onTabChange(next);
    list.current?.querySelector<HTMLElement>(`#${tabId(next)}`)?.focus();
  };

  return (
    <section className="details-card" aria-label="Plan details" id="plan-details">
      <div className="tabs" role="tablist" aria-label="Plan details" ref={list} onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t}
            id={tabId(t)}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls="plan-tabpanel"
            tabIndex={tab === t ? 0 : -1}
            className={`tab${tab === t ? ' is-active' : ''}`}
            onClick={() => onTabChange(t)}
          >
            {t}
            {t === 'Alternatives' && <span className="tab-count">{plan.alternatives.length}</span>}
          </button>
        ))}
      </div>

      <div className="tab-panel" role="tabpanel" id="plan-tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'Components' && (
          <div className="component-grid">
            {plan.nodes.map((node) => {
              const svc = node.serviceId ? getService(node.serviceId) : undefined;
              return (
                <article key={node.id} className={`component kind-${node.kind}`}>
                  <header>
                    <h3>{node.label}</h3>
                    <span className="tier">{node.kind === 'aws' ? TIER_LABELS[node.tier] : node.kind === 'actor' ? 'People' : 'Existing system'}</span>
                  </header>
                  {svc && svc.name !== node.label && <p className="svc-name">{svc.name}</p>}
                  <p>{node.role}</p>
                  <SourceChips ids={node.sourceIds} />
                </article>
              );
            })}
          </div>
        )}

        {tab === 'Data flow' && (
          <ol className="flow-list">
            {plan.dataFlow.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}

        {tab === 'Considerations' && (
          <div className="pillars">
            {PILLARS.map((pillar) => (
              <div key={pillar} className="pillar">
                <h3>{PILLAR_TITLES[pillar]}</h3>
                <ul>
                  {plan.considerations[pillar].map((claim, i) => (
                    <li key={i}>
                      {claim.basis === 'assumption' && <span className="badge-assumption">Assumption</span>}
                      <span>{claim.text}</span> <SourceChips ids={claim.sourceIds} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {tab === 'Alternatives' && (
          <div className="alternatives">
            {plan.alternatives.map((alt, i) => (
              <article key={alt.title} className="alternative" data-testid={`alternative-${i}`}>
                <h3>{alt.title}</h3>
                <p>{alt.summary}</p>
                <div className="tradeoffs">
                  <div>
                    <h4>Gains</h4>
                    <ul>
                      {alt.pros.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>Costs</h4>
                    <ul>
                      {alt.cons.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <SourceChips ids={alt.sourceIds} />
                {alt.variant?.kind === 'diagram' ? (
                  <div className="alt-diagram">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onViewAlternative?.(i)}
                      aria-pressed={shownAlt === i}
                      data-testid={`view-alternative-${i}`}
                    >
                      {shownAlt === i ? 'Shown in the diagram' : 'View its diagram'}
                    </button>
                    <span className="alt-diagram-summary">
                      {[
                        alt.variant.added.length ? `adds ${alt.variant.added.length}` : '',
                        alt.variant.removed.length ? `removes ${alt.variant.removed.length}` : '',
                      ]
                        .filter(Boolean)
                        .join(', ')}{' '}
                      {alt.variant.added.length + alt.variant.removed.length === 1 ? 'component' : 'components'}
                    </span>
                  </div>
                ) : alt.variant ? (
                  <p className="alt-text-only" data-testid={`alternative-text-only-${i}`}>
                    <strong>Text only, no diagram.</strong> {alt.variant.reason}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {tab === 'Implementation' && (
          <>
            <ol className="flow-list">
              {plan.implementationSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <p className="note">This assistant never creates AWS resources. These steps are for your team to plan and review.</p>
          </>
        )}
      </div>
    </section>
  );
}
