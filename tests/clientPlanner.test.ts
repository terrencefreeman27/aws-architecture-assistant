import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { DemoProvider } from '../shared/demoProvider';
import type { PlanResponse } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { citedSourceIds } from '../shared/validate';
import { isKnownSource } from '../shared/sources';
import { planLocally, plannerLabel, resolvePlannerMode } from '../web/src/planner';
import { req } from './helpers';

/** Server path: the real Express route over HTTP, with the demo provider. */
async function viaServer(body: unknown): Promise<{ status: number; json: PlanResponse }> {
  const server: Server = await new Promise((resolve) => {
    const s = createApp(new DemoProvider()).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/** generatedAt is a timestamp; everything else must match exactly. */
const comparable = (r: PlanResponse) => (r.kind === 'plan' ? { ...r, generatedAt: '' } : r);

describe('in-browser demo planner (client path)', () => {
  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('%s: same validated plan as POST /api/plan', async (_id, requirements) => {
    const local = await planLocally(structuredClone(requirements));
    const server = await viaServer({ requirements });
    expect(server.status).toBe(200);
    expect(local.kind).toBe('plan');
    expect(comparable(local)).toEqual(comparable(server.json));
    if (local.kind === 'plan') {
      expect(local.provider).toBe('demo');
      expect(local.mermaid).toMatch(/^flowchart TB/);
      for (const id of citedSourceIds(local.plan)) expect(isKnownSource(id)).toBe(true);
    }
  });

  it('asks the same follow-up questions as the server for incomplete requirements', async () => {
    const requirements = { description: 'A thing' };
    const local = await planLocally(requirements as never);
    const server = await viaServer({ requirements });
    expect(local.kind).toBe('questions');
    expect(local).toEqual(server.json);
  });

  it('rejects malformed requirements the same way the server does', async () => {
    const requirements = { region: 'moon-1' };
    const local = await planLocally(requirements as never);
    const server = await viaServer({ requirements });
    expect(server.status).toBe(400);
    expect(local.kind).toBe('error');
    expect(local).toEqual(server.json);
  });

  it('applies guardrails in the browser too', async () => {
    const local = await planLocally(req({ description: 'A HIPAA compliant portal. How much will it cost per month?' }));
    expect(local.kind).toBe('plan');
    if (local.kind === 'plan') expect(local.plan.cautions.length).toBeGreaterThan(0);
  });
});

describe('planner mode selection', () => {
  const up = async () => ({ provider: 'anthropic', demo: false });
  const down = async () => null;
  const never = async () => {
    throw new Error('should not probe');
  };

  it('defaults to the in-browser planner in production builds without probing', async () => {
    expect(await resolvePlannerMode({ dev: false }, never)).toEqual({ kind: 'local' });
  });
  it('VITE_PLANNER=local never touches the network', async () => {
    expect(await resolvePlannerMode({ flag: 'local', dev: true }, never)).toEqual({ kind: 'local' });
  });
  it('dev uses the API when /api/health answers', async () => {
    expect(await resolvePlannerMode({ dev: true }, up)).toEqual({ kind: 'api', provider: 'anthropic', demo: false });
  });
  it('dev falls back to the in-browser planner when the API is unreachable', async () => {
    expect(await resolvePlannerMode({ dev: true }, down)).toEqual({ kind: 'local' });
  });
  it('VITE_PLANNER=api forces the API even when it is down (failures are reported, not hidden)', async () => {
    const mode = await resolvePlannerMode({ flag: 'api', dev: false }, down);
    expect(mode.kind).toBe('api');
    expect(plannerLabel(mode)).toBe('Server API (not reachable)');
  });
  it('labels the planner honestly', () => {
    expect(plannerLabel({ kind: 'local' })).toBe('Demo planner (runs in your browser)');
    expect(plannerLabel({ kind: 'api', provider: 'demo', demo: true })).toBe('Server API (provider: demo)');
    expect(plannerLabel({ kind: 'api', provider: 'anthropic', demo: false })).toBe('Server API (provider: anthropic)');
  });
});
