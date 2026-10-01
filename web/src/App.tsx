import { useEffect, useState } from 'react';
import { EMPTY_REQUIREMENTS, type PlanResponse, type Requirements } from '../../shared/schema';
import { getScenario } from '../../shared/scenarios';
import { fetchHealth, requestPlan } from './api';
import { AssistantPanel } from './AssistantPanel';
import { DiagramCanvas } from './DiagramCanvas';
import { PlanDetails } from './PlanDetails';
import { RequirementsPanel } from './RequirementsPanel';

export function App() {
  const [requirements, setRequirements] = useState<Requirements>(EMPTY_REQUIREMENTS);
  const [response, setResponse] = useState<PlanResponse | null>(null);
  const [generatedFor, setGeneratedFor] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [provider, setProvider] = useState<{ provider: string; demo: boolean } | null>(null);

  useEffect(() => {
    fetchHealth().then(setProvider);
  }, []);

  const generate = async (req: Requirements = requirements) => {
    setLoading(true);
    setRequestError('');
    try {
      const result = await requestPlan(req);
      setResponse(result);
      setGeneratedFor(JSON.stringify(req));
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Could not reach the API.');
    } finally {
      setLoading(false);
    }
  };

  const loadScenario = (id: string) => {
    const scenario = getScenario(id);
    if (!scenario) return;
    setRequirements(scenario.requirements);
    setActiveScenario(id);
    void generate(scenario.requirements);
  };

  const plan = response?.kind === 'plan' ? response : null;
  const stale = Boolean(plan) && generatedFor !== JSON.stringify(requirements);

  return (
    <div className="workbench">
      <RequirementsPanel
        requirements={requirements}
        onChange={setRequirements}
        onLoadScenario={loadScenario}
        onGenerate={() => void generate()}
        onReset={() => {
          setRequirements(EMPTY_REQUIREMENTS);
          setResponse(null);
          setActiveScenario(null);
          setRequestError('');
        }}
        activeScenario={activeScenario}
        loading={loading}
      />

      <main className="workspace">
        <header className="workspace-head">
          <div>
            <h2>{plan ? plan.plan.title : 'Architecture plan'}</h2>
            <p className="muted">
              {plan
                ? `${plan.plan.nodes.length} components. Generated ${new Date(plan.generatedAt).toLocaleTimeString()}.`
                : 'A diagram and plan appear here once the requirements are complete.'}
            </p>
          </div>
          <div className="head-badges">
            {provider && (
              <span className={`mode-badge${provider.demo ? ' is-demo' : ''}`}>
                {provider.demo ? 'Demo mode: rules-based, no credentials' : `Live provider: ${provider.provider}`}
              </span>
            )}
            {plan && (
              <button type="button" className="btn-primary" onClick={() => void generate()} disabled={loading}>
                {loading ? 'Regenerating...' : 'Regenerate'}
              </button>
            )}
          </div>
        </header>

        {loading && !plan ? (
          <div className="skeleton" aria-busy="true">
            <div className="skeleton-canvas" />
            <div className="skeleton-row" />
          </div>
        ) : plan ? (
          <div className={`plan-area${loading ? ' is-loading' : ''}`}>
            <DiagramCanvas source={plan.mermaid} title={plan.plan.title} />
            <PlanDetails plan={plan.plan} />
            <p className="disclaimer">
              This plan is a reviewable starting point generated from your stated requirements. It is not production-ready, does not establish compliance, and contains no cost figures. Validate it with your team and a Well-Architected review.
            </p>
          </div>
        ) : (
          <div className="canvas-empty">
            <h3>No plan yet</h3>
            <p>
              {response?.kind === 'questions'
                ? 'The assistant needs a few more answers before it can recommend an architecture. See the questions on the right.'
                : 'Load a sample scenario or fill in the requirements, then generate a plan.'}
            </p>
          </div>
        )}
      </main>

      <AssistantPanel response={response} stale={stale} requestError={requestError} />
    </div>
  );
}
