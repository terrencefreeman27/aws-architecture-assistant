import { useState } from 'react';
import { getService } from '../../shared/catalog';
import { PILLARS, type Plan } from '../../shared/schema';
import { TIER_LABELS } from './options';
import { SourceChips } from './SourceChips';

const TABS = ['Components', 'Data flow', 'Considerations', 'Alternatives', 'Implementation'] as const;
type Tab = (typeof TABS)[number];

const PILLAR_TITLES: Record<string, string> = {
  security: 'Security',
  reliability: 'Reliability',
  performance: 'Performance',
  operations: 'Operations',
  cost: 'Cost (drivers, not estimates)',
};

export function PlanDetails({ plan }: { plan: Plan }) {
  const [tab, setTab] = useState<Tab>('Components');

  return (
    <section className="details-card" aria-label="Plan details">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} className={`tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {t === 'Alternatives' && <span className="tab-count">{plan.alternatives.length}</span>}
          </button>
        ))}
      </div>

      <div className="tab-panel" role="tabpanel">
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
            {plan.alternatives.map((alt) => (
              <article key={alt.title} className="alternative">
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
