import type { PlanResponse, Requirements } from '../../shared/schema';

export interface Health {
  provider: string;
  demo: boolean;
}

/** Shown for any failure to get a usable answer from the server API. */
export const API_UNREACHABLE =
  'Couldn\'t reach the planning API. Run "npm run dev" locally to start it, or switch to the in-browser demo planner.';

export class PlanningApiError extends Error {}

export async function requestPlan(requirements: Requirements): Promise<PlanResponse> {
  let res: Response;
  try {
    res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requirements }),
    });
  } catch {
    throw new PlanningApiError(API_UNREACHABLE);
  }
  const body = (await res.json().catch(() => null)) as PlanResponse | null;
  if (body && typeof body === 'object' && 'kind' in body) return body;
  throw new PlanningApiError(`${API_UNREACHABLE} (HTTP ${res.status})`);
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Health> | null;
    return body && typeof body.provider === 'string' ? { provider: body.provider, demo: Boolean(body.demo) } : null;
  } catch {
    return null;
  }
}
