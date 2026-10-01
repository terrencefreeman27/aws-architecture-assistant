import { buildDemoPlan, DemoProvider } from '../shared/demoProvider';
import { toMermaid } from '../shared/mermaid';
import { SELECT_OPTIONS } from '../shared/options';
import { planToMarkdown } from '../shared/report';
import { computeCompleteness, FIELD_META } from '../shared/requirements';
import type { ArchitectureProvider } from '../shared/provider';
import { RequirementsSchema, type PlanResponse, type Requirements } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { planFromRequirements } from '../shared/service';
import { decodeRequirements, encodeRequirements, toBase64Url } from '../shared/share';
import { resolveUnsure, UNSURE, UNSURE_DEFAULTS, UNSURE_FIELDS, unsureAssumptions } from '../shared/unsure';
import { loadAutosave, saveAutosave } from '../web/src/storage';
import { req, scenarioRequirements } from './helpers';

const demo = new DemoProvider();

async function plan(r: Requirements): Promise<Extract<PlanResponse, { kind: 'plan' }>> {
  const res = await planFromRequirements(r, demo);
  if (res.kind !== 'plan') throw new Error(`expected a plan, got ${res.kind}`);
  return res;
}

/** The plan without assumptions and summary text: what gets built. */
const design = (p: Extract<PlanResponse, { kind: 'plan' }>) => ({ nodes: p.plan.nodes, connections: p.plan.connections, considerations: p.plan.considerations });

const PROTECTIVE_SERVICES = ['cognito', 'kms', 'cloudtrail', 'waf', 'guardduty', 'secrets-manager', 'vpc'];
const protective = (r: Requirements) =>
  new Set(buildDemoPlan(r).nodes.map((n) => n.serviceId).filter((s): s is string => Boolean(s) && PROTECTIVE_SERVICES.includes(s!)));

describe('"Not sure" answers', () => {
  it('is offered only on fields with a responsible default, never on what must come from the user', () => {
    for (const field of UNSURE_FIELDS) expect(SELECT_OPTIONS[field]?.some((o) => o.value === UNSURE), field).toBe(true);
    expect(SELECT_OPTIONS.workloadType?.some((o) => o.value === UNSURE)).toBe(false);
    expect(RequirementsSchema.safeParse({ workloadType: UNSURE }).success).toBe(false);
    expect(RequirementsSchema.safeParse({ description: UNSURE }).success).toBe(true); // free text, but never treated as unsure
    expect(resolveUnsure(req({ description: UNSURE })).description).toBe(UNSURE);
  });

  it('documents these defaults', () => {
    expect(Object.fromEntries(UNSURE_FIELDS.map((f) => [f, UNSURE_DEFAULTS[f].value]))).toEqual({
      expectedUsage: 'spiky',
      dataSensitivity: 'confidential',
      region: 'us-east-1',
      availability: 'high',
      budget: 'minimal',
      operations: 'small_team',
    });
  });

  it('counts as answered for completeness', () => {
    const all = req(Object.fromEntries(UNSURE_FIELDS.map((f) => [f, UNSURE])) as Partial<Requirements>);
    expect(computeCompleteness(all)).toMatchObject({ percent: 100, missing: [] });
  });

  describe.each(UNSURE_FIELDS)('%s: Not sure', (field) => {
    it.each(SCENARIOS.map((s) => s.id))('%s: builds the same design as the stated default, plus an assumption that links back', async (id) => {
      const base = scenarioRequirements(id);
      const unsure = await plan({ ...base, [field]: UNSURE });
      const explicit = await plan({ ...base, [field]: UNSURE_DEFAULTS[field].value });

      expect(design(unsure)).toEqual(design(explicit));
      expect(unsure.plan.title).toBe(explicit.plan.title);
      expect(unsure.mermaid).toBe(explicit.mermaid);

      const added = unsure.plan.assumptions.filter((a) => a.text.startsWith("You weren't sure"));
      expect(added).toEqual([{ field, text: UNSURE_DEFAULTS[field].assumption }]);
      expect(added[0].text).toMatch(/so we assumed/);
      expect(added[0].text).toMatch(/here/);
      expect(unsure.plan.assumptions.slice(1)).toEqual(explicit.plan.assumptions);
      expect(JSON.stringify(unsure.plan)).not.toContain('"unsure"');
    });
  });

  it('answering Not sure to everything still produces a valid plan with one assumption per field', async () => {
    const all = req(Object.fromEntries(UNSURE_FIELDS.map((f) => [f, UNSURE])) as Partial<Requirements>);
    const res = await plan(all);
    expect(res.plan.assumptions.slice(0, UNSURE_FIELDS.length).map((a) => a.field)).toEqual([...UNSURE_FIELDS]);
    expect(res.plan.title).toContain('us-east-1');
    expect(res.mermaid).toBe(toMermaid(res.plan));
  });

  it('providers only ever receive resolved requirements', async () => {
    const seen: Requirements[] = [];
    const spy: ArchitectureProvider = {
      name: 'spy',
      generatePlan: async (r) => {
        seen.push(r);
        return buildDemoPlan(r);
      },
    };
    await planFromRequirements(req(Object.fromEntries(UNSURE_FIELDS.map((f) => [f, UNSURE])) as Partial<Requirements>), spy);
    expect(seen).toHaveLength(1);
    expect(Object.values(seen[0])).not.toContain(UNSURE);
  });

  it('no assumptions are added when nothing is Not sure', () => {
    for (const s of SCENARIOS) expect(unsureAssumptions(s.requirements)).toEqual([]);
  });
});

describe('data sensitivity "Not sure" is never less protective', () => {
  const variants: Partial<Requirements>[] = [{}, { operations: 'containers' }, { expectedUsage: 'low' }, { availability: 'best_effort' }];

  it.each(SCENARIOS.map((s) => s.id))('%s: protects at least as much as public, internal, or confidential', (id) => {
    for (const v of variants) {
      const base = { ...scenarioRequirements(id), ...v } as Requirements;
      const unsure = protective({ ...base, dataSensitivity: UNSURE });
      for (const level of ['public', 'internal', 'confidential'] as const) {
        const known = protective({ ...base, dataSensitivity: level });
        for (const svc of known) expect(unsure.has(svc), `${id} ${JSON.stringify(v)}: ${svc} present for ${level}`).toBe(true);
      }
      expect(unsure.has('kms') && unsure.has('cloudtrail')).toBe(true);
    }
  });

  it('requires sign-in wherever the pattern has users, and never describes the data as public', async () => {
    for (const id of ['web-app', 'ai-assistant']) {
      const res = await plan({ ...scenarioRequirements(id), dataSensitivity: UNSURE });
      expect(res.plan.nodes.some((n) => n.serviceId === 'cognito'), id).toBe(true);
      expect(res.plan.summary).toContain('confidential data');
      expect(res.plan.dataFlow.join(' ')).not.toMatch(/data is public/);
    }
  });
});

describe('Not sure in share links, autosave, and the report', () => {
  // Generated by the share encoder on main (e8aaddf), before "Not sure" existed:
  // the web-app sample with operations=containers and availability=high.
  const OLD_LINK_PAYLOAD =
    'zVVHLTsQwDPwVq-fuauEIp-UDkNAuZ5QmbmttG0ex01Ih_h2nPCSuHs94ZvzRBBSfKSlxbB6aM_giyjNmSJzVTbCOmBG4ZPATYVQBoSECRVCGhXAFHZEycA6YpYXAa5zYBdtYmDzayMUAJQWn-LPrOarzCgHV0STHpm1WzrdKu24JzceK3ZtLyQB8J1GKw2UTxVkMeynkb0_MN9nhhF4xvIobKnFms2GXDCp19MyKlXTuuCjct6fTCTIOpmmxwl9aeQQHvYUZSwwVMHu0ICQrIritOjT_7oJRyADSzTQtRk_BOiE32UKV3UssckAnerizoVssoeto-qaMNIw27UoYUKtdijTvbE7VtwnIt7I1E83XP-Q3zHVl627BqUJWsOe5r9_qJoSVdITa4mV_awux7gbyVkoATvY_dX1_bD6_AA';

  it('old-format share links still decode to the same requirements', async () => {
    const res = await decodeRequirements(OLD_LINK_PAYLOAD);
    expect(res).toEqual({ ok: true, requirements: { ...scenarioRequirements('web-app'), operations: 'containers', availability: 'high' } });
    const oldJson = { description: 'A customer portal for orders and invoices.', workloadType: 'web_app', region: 'eu-west-1', budget: 'flexible' };
    const j = `j${toBase64Url(new TextEncoder().encode(JSON.stringify(oldJson)))}`;
    expect(await decodeRequirements(j)).toEqual({ ok: true, requirements: RequirementsSchema.parse(oldJson) });
  });

  it('round-trips Not sure answers through a share link', async () => {
    const r = req({ dataSensitivity: UNSURE, region: UNSURE, budget: UNSURE });
    expect(await decodeRequirements(await encodeRequirements(r))).toEqual({ ok: true, requirements: r });
  });

  it('autosaves and restores Not sure answers', () => {
    const store = new Map<string, string>();
    const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    vi.stubGlobal('window', { localStorage });
    try {
      const r = req({ availability: UNSURE, operations: UNSURE });
      saveAutosave(r);
      expect(loadAutosave()).toEqual(r);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the report says which answers were Not sure and what was assumed', async () => {
    const r = req({ dataSensitivity: UNSURE, region: UNSURE });
    const res = await plan(r);
    const md = planToMarkdown({ plan: res.plan, mermaid: res.mermaid, requirements: r, generatedAt: res.generatedAt });
    expect(md).toContain(`**${FIELD_META.dataSensitivity.label}** Not sure, so assumed: Confidential: customer or business data`);
    expect(md).toContain('Not sure, so assumed: US East (N. Virginia) · us-east-1');
    expect(md).toMatch(/You weren't sure how sensitive the data is.*_Change this in: Data sensitivity\._/);
  });
});

describe('plain-language wording', () => {
  it('labels ask questions a non-AWS user can answer, keeping the AWS term as a hint', () => {
    expect(FIELD_META.region).toMatchObject({ label: 'Where are most of your users?', term: 'AWS Region' });
    expect(FIELD_META.availability).toMatchObject({ label: 'How much downtime is acceptable?', term: 'availability and recovery' });
    expect(FIELD_META.budget).toMatchObject({ label: 'How should cost be balanced against other goals?', term: 'budget' });
    expect(FIELD_META.workloadType.label).not.toMatch(/pattern/i);
    expect(FIELD_META.operations.label).not.toMatch(/operational/i);
  });

  it('RPO and RTO are always explained in plain words', async () => {
    for (const s of SCENARIOS) {
      const res = await plan({ ...s.requirements, recoveryNotes: '' });
      const texts = [...res.plan.openQuestions, ...res.plan.assumptions.map((a) => a.text), ...Object.values(res.plan.considerations).flat().map((c) => c.text)];
      const mentions = texts.filter((t) => /\bRPO\b|\bRTO\b/.test(t));
      expect(mentions.length, s.id).toBeGreaterThan(0);
      for (const t of mentions) expect(t, t).toMatch(/how much (recent )?data|how long/i);
    }
    expect(FIELD_META.recoveryNotes.question).toMatch(/recovery point objective \(RPO\)/);
  });
});
