import { DemoProvider } from '../../shared/demoProvider';
import type { PlanResponse, Requirements } from '../../shared/schema';
import { planFromInput } from '../../shared/service';
import { fetchHealth, requestPlan, type Health } from './api';

const UNREACHABLE = 'unreachable';

/**
 * Which planner produced the plans on screen.
 * - local: the deterministic DemoProvider + shared validation pipeline, running in the browser.
 * - api:   the Express server at /api (demo or the optional live Anthropic provider).
 */
export type PlannerMode = { kind: 'local' } | { kind: 'api'; provider: string; demo: boolean };

export interface PlannerEnv {
  /** Value of VITE_PLANNER, if set. */
  flag?: string;
  /** True under the Vite dev server. */
  dev: boolean;
}

/**
 * Mode selection:
 * - VITE_PLANNER=local -> always the in-browser demo planner (no network).
 * - VITE_PLANNER=api   -> always the server API (failures are reported, never silently swapped).
 * - unset, production build -> local. A static host (e.g. Vercel) has no /api.
 * - unset, dev server  -> probe /api/health; use the API if it answers, else fall back to local.
 */
export async function resolvePlannerMode(env: PlannerEnv, probe: () => Promise<Health | null> = fetchHealth): Promise<PlannerMode> {
  const flag = env.flag?.trim().toLowerCase();
  if (flag === 'local') return { kind: 'local' };
  if (flag === 'api') {
    const health = await probe();
    return health ? { kind: 'api', provider: health.provider, demo: health.demo } : { kind: 'api', provider: UNREACHABLE, demo: false };
  }
  if (!env.dev) return { kind: 'local' };
  const health = await probe();
  return health ? { kind: 'api', provider: health.provider, demo: health.demo } : { kind: 'local' };
}

export const plannerEnv: PlannerEnv = { flag: import.meta.env.VITE_PLANNER, dev: import.meta.env.DEV };

const localProvider = new DemoProvider();

/** The in-browser planner: same schema check and pipeline as POST /api/plan, with the demo provider. */
export async function planLocally(requirements: Requirements): Promise<PlanResponse> {
  return (await planFromInput(requirements, localProvider)).body;
}

export function planWith(mode: PlannerMode, requirements: Requirements): Promise<PlanResponse> {
  return mode.kind === 'local' ? planLocally(requirements) : requestPlan(requirements);
}

export function plannerLabel(mode: PlannerMode): string {
  if (mode.kind === 'local') return 'Demo planner (runs in your browser)';
  if (mode.provider === UNREACHABLE) return 'Server API (not reachable)';
  return mode.demo ? 'Server API (provider: demo)' : `Server API (provider: ${mode.provider})`;
}
