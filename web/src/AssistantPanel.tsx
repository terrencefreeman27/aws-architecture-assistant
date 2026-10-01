import { citedSourceIds } from '../../shared/validate';
import { FIELD_META } from '../../shared/requirements';
import type { PlanResponse, RequirementField } from '../../shared/schema';
import { getSource } from '../../shared/sources';
import { focusField } from './options';
import { SourceChips } from './SourceChips';

interface Props {
  response: PlanResponse | null;
  stale: boolean;
  requestError: string;
  /** Offered when the server API failed: switch to the in-browser demo planner and retry. */
  onUseLocalPlanner?: () => void;
}

const fieldLabel = (field?: string) => (field && field in FIELD_META ? FIELD_META[field as RequirementField].short : '');

export function AssistantPanel({ response, stale, requestError, onUseLocalPlanner }: Props) {
  return (
    <aside className="assistant" aria-label="Assistant">
      <h2 className="panel-title">Assistant</h2>

      {requestError && (
        <div className="callout is-error" role="alert">
          <p>{requestError}</p>
          {onUseLocalPlanner && (
            <button type="button" className="btn-secondary" onClick={onUseLocalPlanner}>
              Use the in-browser demo planner
            </button>
          )}
        </div>
      )}

      {!response && !requestError && (
        <div className="empty">
          <p>Describe the system on the left, or load a sample. When something important is missing, the assistant asks before it designs.</p>
          <p className="muted">Plans are reviewable starting points, not production-ready designs. Nothing is created in your AWS account.</p>
        </div>
      )}

      {response?.kind === 'error' && (
        <div className="callout is-error" role="alert">
          <strong>No plan produced.</strong> {response.message}
          {response.issues.length > 0 && (
            <ul>
              {response.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {response?.kind === 'questions' && (
        <section className="block">
          <h3>A few questions first</h3>
          <p className="muted">These answers are needed for a responsible design.</p>
          <ol className="questions">
            {response.questions.map((q) => (
              <li key={q.field + q.question}>
                <p>{q.question}</p>
                <p className="why">{q.why}</p>
                <button type="button" className="link-btn" onClick={() => focusField(q.field)}>
                  Answer in {fieldLabel(q.field) || 'requirements'}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {response && response.kind !== 'error' && (() => {
        const cautions = response.kind === 'plan' ? response.plan.cautions : response.cautions;
        if (cautions.length === 0) return null;
        return (
          <section className="block" id="section-cautions">
            <h3 tabIndex={-1}>Not answered with confidence</h3>
            <ul className="cautions">
              {cautions.map((c) => (
                <li key={c.topic}>
                  <strong>{c.topic}.</strong> {c.message} <SourceChips ids={c.sourceIds} />
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {response?.kind === 'plan' && (
        <>
          {stale && (
            <div className="callout is-stale" role="status">
              Requirements changed since this plan was generated. Regenerate to update it.
            </div>
          )}

          <section className="block">
            <h3>Rationale</h3>
            <p>{response.plan.summary}</p>
          </section>

          <section className="block" id="section-assumptions">
            <h3 tabIndex={-1}>Assumptions</h3>
            <p className="muted">Correct any that are wrong, then regenerate.</p>
            <ul className="assumptions">
              {response.plan.assumptions.map((a, i) => (
                <li key={i}>
                  <span>{a.text}</span>
                  {a.field && fieldLabel(a.field) && (
                    <button type="button" className="link-btn" onClick={() => focusField(a.field!)}>
                      Edit: {fieldLabel(a.field)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {response.plan.openQuestions.length > 0 && (
            <section className="block" id="section-open-questions">
              <h3 tabIndex={-1}>Open questions</h3>
              <ul className="plain">
                {response.plan.openQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </section>
          )}

          {response.warnings.length > 0 && (
            <section className="block">
              <h3>Validation notes</h3>
              <ul className="plain">
                {response.warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="block">
            <h3>Sources cited</h3>
            <p className="muted">Official AWS documentation from a curated list. Claims without a source are labelled as assumptions.</p>
            <ul className="sources">
              {citedSourceIds(response.plan)
                .map((id) => getSource(id))
                .filter((s) => s !== undefined)
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((s) => (
                  <li key={s.id}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.title}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        </>
      )}

    </aside>
  );
}
