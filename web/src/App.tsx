import { useEffect, useRef, useState } from 'react';
import { computeCompleteness } from '../../shared/requirements';
import { EMPTY_REQUIREMENTS, type PlanResponse, type Requirements } from '../../shared/schema';
import { getScenario } from '../../shared/scenarios';
import { decodeRequirements, readShareHash } from '../../shared/share';
import { PlanningApiError } from './api';
import { AssistantPanel } from './AssistantPanel';
import { DiagramCanvas } from './DiagramCanvas';
import { PlanDetails } from './PlanDetails';
import { planWith, plannerEnv, plannerLabel, resolvePlannerMode, type PlannerMode } from './planner';
import { RequirementsPanel } from './RequirementsPanel';
import { CopyLinkButton, ShareFallback, useShareLink } from './ShareLink';
import { loadAutosave, saveAutosave } from './storage';

function clearHash() {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    // Some embedded contexts disallow history changes; the stale fragment is harmless.
  }
}

export function App() {
  const [requirements, setRequirements] = useState<Requirements>(EMPTY_REQUIREMENTS);
  const [response, setResponse] = useState<PlanResponse | null>(null);
  const [generatedFor, setGeneratedFor] = useState<Requirements | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [apiFailed, setApiFailed] = useState(false);
  const [mode, setMode] = useState<PlannerMode | null>(null);
  const [linkNotice, setLinkNotice] = useState('');
  const booted = useRef(false);
  const hydrated = useRef(false);
  const share = useShareLink(requirements);
  const modeRef = useRef<Promise<PlannerMode> | null>(null);
  const getMode = () => (modeRef.current ??= resolvePlannerMode(plannerEnv));

  useEffect(() => {
    void getMode().then(setMode);
  }, []);

  const switchToLocalPlanner = () => {
    const local: PlannerMode = { kind: 'local' };
    modeRef.current = Promise.resolve(local);
    setMode(local);
    return local;
  };

  const generate = async (req: Requirements = requirements, forced?: PlannerMode) => {
    setLoading(true);
    setRequestError('');
    setApiFailed(false);
    try {
      const result = await planWith(forced ?? (await getMode()), req);
      setResponse(result);
      setGeneratedFor(req);
    } catch (err) {
      setApiFailed(err instanceof PlanningApiError);
      setRequestError(err instanceof Error ? err.message : 'The planner failed unexpectedly.');
    } finally {
      setLoading(false);
    }
  };

  /** Loads requirements from a "#r=" share link. Returns false if there is no link or it is invalid. */
  const applyShareHash = async (): Promise<boolean> => {
    const payload = readShareHash(window.location.hash);
    if (payload === null) return false;
    const result = await decodeRequirements(payload);
    clearHash();
    if (!result.ok) {
      const saved = loadAutosave();
      setLinkNotice(`${result.error} ${saved ? 'Showing your autosaved requirements instead.' : 'Starting from an empty form.'}`);
      return false;
    }
    setLinkNotice('');
    setRequirements(result.requirements);
    setActiveScenario(null);
    void generate(result.requirements);
    return true;
  };

  // Startup: a share link wins over the autosave. Guarded so StrictMode's double effect runs only once.
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      void (async () => {
        if (!(await applyShareHash())) {
          const saved = loadAutosave();
          if (saved) {
            setRequirements(saved);
            if (computeCompleteness(saved).missing.length === 0) void generate(saved);
          }
        }
        hydrated.current = true;
      })();
    }
    const onHashChange = () => void applyShareHash();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (hydrated.current) saveAutosave(requirements);
  }, [requirements]);

  const loadScenario = (id: string) => {
    const scenario = getScenario(id);
    if (!scenario) return;
    setRequirements(scenario.requirements);
    setActiveScenario(id);
    void generate(scenario.requirements);
  };

  const plan = response?.kind === 'plan' ? response : null;
  const stale = Boolean(plan) && JSON.stringify(generatedFor) !== JSON.stringify(requirements);

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
                ? `${plan.plan.nodes.filter((n) => n.kind === 'aws').length} AWS components from the supported catalog. Generated ${new Date(plan.generatedAt).toLocaleTimeString()}.`
                : 'A diagram and plan appear here once the requirements are complete.'}
            </p>
          </div>
          <div className="head-badges">
            {mode && (
              <span
                className={`mode-badge${mode.kind === 'local' || mode.demo ? ' is-demo' : ''}`}
                data-testid="planner-mode"
                title={mode.kind === 'local' ? 'Rules-based demo planner. No server, no credentials, nothing leaves your browser.' : 'Plans come from the local API server.'}
              >
                {plannerLabel(mode)}
              </span>
            )}
            {plan && <CopyLinkButton share={share} />}
            {plan && (
              <button type="button" className="btn-primary" onClick={() => void generate()} disabled={loading}>
                {loading ? 'Regenerating...' : 'Regenerate'}
              </button>
            )}
          </div>
        </header>

        <ShareFallback share={share} />
        {linkNotice && (
          <div className="callout is-error link-notice" role="alert" data-testid="link-notice">
            <p>{linkNotice}</p>
            <button type="button" className="link-btn" onClick={() => setLinkNotice('')}>
              Dismiss
            </button>
          </div>
        )}

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

      <AssistantPanel
        response={response}
        stale={stale}
        requestError={requestError}
        onUseLocalPlanner={apiFailed ? () => void generate(requirements, switchToLocalPlanner()) : undefined}
      />
    </div>
  );
}
