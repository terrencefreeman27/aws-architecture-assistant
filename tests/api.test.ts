import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, selectProvider } from '../server/app';
import { DemoProvider } from '../shared/demoProvider';
import type { ArchitectureProvider } from '../shared/provider';
import { isKnownSource } from '../shared/sources';
import { citedSourceIds } from '../shared/validate';
import { scenarioRequirements, validRawPlan } from './helpers';

async function withServer(provider: ArchitectureProvider, fn: (base: string) => Promise<void>) {
  const server: Server = await new Promise((resolve) => {
    const s = createApp(provider).listen(0, () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A fake "live" provider returning canned raw output, to test the validation path. */
const fakeProvider = (output: unknown): ArchitectureProvider => ({ name: 'fake', generatePlan: async () => output });

describe('API', () => {
  it('reports demo mode by default', async () => {
    await withServer(new DemoProvider(), async (base) => {
      expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, provider: 'demo', demo: true });
    });
  });

  it('returns a validated plan with Mermaid for a sample scenario', async () => {
    await withServer(new DemoProvider(), async (base) => {
      const res = await post(base, { requirements: scenarioRequirements('integration') });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.kind).toBe('plan');
      expect(body.mermaid).toMatch(/^flowchart TB/);
      for (const id of citedSourceIds(body.plan)) expect(isKnownSource(id)).toBe(true);
    });
  });

  it('returns follow-up questions for incomplete requirements', async () => {
    await withServer(new DemoProvider(), async (base) => {
      const body = await (await post(base, { requirements: { description: 'A thing' } })).json();
      expect(body.kind).toBe('questions');
      expect(body.questions.length).toBeGreaterThan(3);
    });
  });

  it('rejects malformed requirements with 400', async () => {
    await withServer(new DemoProvider(), async (base) => {
      expect((await post(base, { requirements: { region: 'moon-1' } })).status).toBe(400);
      expect((await post(base, {})).status).toBe(400); // a requirements object is required
    });
  });

  it('returns 422 and no diagram when a provider returns invalid diagram data', async () => {
    const bad = validRawPlan();
    bad.connections.push({ from: 'api', to: 'nowhere', label: '' });
    await withServer(fakeProvider(bad), async (base) => {
      const res = await post(base, { requirements: scenarioRequirements('web-app') });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.kind).toBe('error');
      expect(body.mermaid).toBeUndefined();
      expect(body.issues[0].code).toBe('dangling_connection');
    });
  });

  it('returns 422 when a provider returns free-form diagram text instead of structured data', async () => {
    await withServer(fakeProvider('flowchart LR\n a --> b'), async (base) => {
      expect((await post(base, { requirements: scenarioRequirements('web-app') })).status).toBe(422);
    });
  });

  it('flags and removes unsupported services suggested by a provider', async () => {
    const raw = validRawPlan();
    raw.nodes.push({ id: 'quantum', kind: 'aws', serviceId: 'amazon-braket', label: 'Braket', role: 'Quantum.', tier: 'app', sourceIds: [] });
    raw.connections.push({ from: 'fn', to: 'quantum', label: '' });
    await withServer(fakeProvider(raw), async (base) => {
      const body = await (await post(base, { requirements: scenarioRequirements('web-app') })).json();
      expect(body.kind).toBe('plan');
      expect(body.warnings.map((w: { code: string }) => w.code)).toContain('unsupported_service');
      expect(body.mermaid).not.toContain('quantum');
    });
  });

  it('reports provider failures as errors rather than crashing', async () => {
    const failing: ArchitectureProvider = { name: 'broken', generatePlan: async () => { throw new Error('upstream timeout'); } };
    await withServer(failing, async (base) => {
      const body = await (await post(base, { requirements: scenarioRequirements('web-app') })).json();
      expect(body).toMatchObject({ kind: 'error' });
      expect(body.message).toContain('upstream timeout');
    });
  });
});

describe('provider selection', () => {
  it('uses demo mode when nothing is configured', async () => {
    expect((await selectProvider({})).provider.name).toBe('demo');
  });

  it('falls back to demo mode when the live provider is requested without a key', async () => {
    const sel = await selectProvider({ MODEL_PROVIDER: 'anthropic' });
    expect(sel.provider.name).toBe('demo');
    expect(sel.note).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('constructs (but never calls) the live provider when explicitly enabled with a key', async () => {
    const sel = await selectProvider({ MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key-not-real' });
    expect(sel.provider.name).toBe('anthropic');
  });
});
