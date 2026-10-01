import { SCENARIOS } from '../../shared/scenarios';
import { focusField } from './options';

const YOU_GET = [
  'An architecture diagram drawn with the official AWS icons',
  'What each part does, and how data moves between them',
  'The assumptions it made, open questions, and alternatives with their tradeoffs',
  'A Markdown report to download and a link to share',
];

/** Empty-state start panel: what the tool produces, and one-click samples that generate a plan immediately. */
export function StartPanel({ onLoadScenario, loading }: { onLoadScenario: (id: string) => void; loading: boolean }) {
  return (
    <section className="canvas-empty start-panel" aria-labelledby="start-heading" data-testid="start-panel">
      <div className="start-intro">
        <h3 id="start-heading">Turn a business need into a reviewable AWS design</h3>
        <p>Answer a few plain-language questions. You don't need to know AWS. You'll get:</p>
        <ul className="start-list">
          {YOU_GET.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="start-samples">
        <h4>See it work with a sample</h4>
        <div className="start-sample-grid">
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className="start-sample" onClick={() => onLoadScenario(s.id)} disabled={loading} data-testid={`start-sample-${s.id}`}>
              <span className="start-sample-name">{s.name}</span>
              <span className="start-sample-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
        <p className="start-own">
          or{' '}
          <button type="button" className="link-btn" onClick={() => focusField('description')}>
            describe your own system
          </button>{' '}
          <span className="start-where">in the form on the left</span>
          <span className="start-where-narrow">in the form above</span>.
        </p>
      </div>

      <p className="start-fine">Nothing is created in any AWS account, and no account or credentials are needed. Plans are starting points, not production-ready designs.</p>
    </section>
  );
}
