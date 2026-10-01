import type { PlanResponse, Requirements } from '../../shared/schema';

export async function requestPlan(requirements: Requirements): Promise<PlanResponse> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requirements }),
  });
  const body = (await res.json().catch(() => null)) as PlanResponse | { message?: string } | null;
  if (body && 'kind' in body) return body;
  throw new Error(body?.message ?? `The API responded with status ${res.status}.`);
}

export async function fetchHealth(): Promise<{ provider: string; demo: boolean } | null> {
  try {
    const res = await fetch('/api/health');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
