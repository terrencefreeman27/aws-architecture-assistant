import {
  PUBLIC_DEMO_URL,
  exportReport,
  getRequirementsSchema,
  getSample,
  getSources,
  listSamples,
  missingQuestions,
  planArchitecture,
  unknownRequirementKeys,
} from '../shared/core';
import { CATALOG } from '../shared/catalog';
import { planToMarkdown } from '../shared/report';
import type { PlanResponse } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { buildShareUrl, decodeRequirements, readShareHash } from '../shared/share';
import { SOURCES } from '../shared/sources';
import { UNSURE_FIELDS } from '../shared/unsure';
import { planLocally } from '../web/src/planner';

const comparable = (r: PlanResponse) => (r.kind === 'plan' ? { ...r, generatedAt: '' } : r);

describe('shared core API', () => {
  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('%s: planArchitecture equals the website planner', async (_id, requirements) => {
    const core = await planArchitecture(structuredClone(requirements));
    const web = await planLocally(structuredClone(requirements));
    expect(core.kind).toBe('plan');
    expect(comparable(core)).toEqual(comparable(web));
  });

  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('%s: exportReport equals the website report', async (_id, requirements) => {
    const result = await exportReport(structuredClone(requirements));
    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;
    const r = result.response;
    // Built the way web/src/App.tsx builds the download.
    const shareUrl = await buildShareUrl(PUBLIC_DEMO_URL, requirements);
    expect(result.markdown).toBe(
      planToMarkdown({ plan: r.plan, mermaid: r.mermaid, requirements, generatedAt: r.generatedAt, provider: r.provider, shareUrl }),
    );
    expect(result.fileName).toMatch(/-design\.md$/);
    const link = result.markdown.match(/<(https:[^>]+)>/)![1];
    expect(link.startsWith(`${PUBLIC_DEMO_URL}#r=`)).toBe(true);
    const decoded = await decodeRequirements(readShareHash(new URL(link).hash)!);
    expect(decoded).toEqual({ ok: true, requirements });
  });

  it('can omit the share link', async () => {
    const result = await exportReport(SCENARIOS[0].requirements, { shareBase: null });
    expect(result.kind === 'report' && result.markdown).toContain('_Not available._');
  });

  it('missingQuestions matches the planner questions and reports completeness', async () => {
    const partial = { description: 'A thing' };
    const q = missingQuestions(partial);
    const plan = await planArchitecture(partial);
    expect(q.kind).toBe('questions');
    if (q.kind === 'questions' && plan.kind === 'questions') {
      expect(q.questions).toEqual(plan.questions);
      expect(q.completeness).toEqual(plan.completeness);
    }
    expect(missingQuestions(SCENARIOS[0].requirements).kind).toBe('complete');
    expect(missingQuestions({ ...SCENARIOS[0].requirements, workloadType: 'other' }).kind).toBe('questions');
    expect(missingQuestions({ region: 'moon-1' }).kind).toBe('error');
  });

  it('getSources filters by id and reports unknown ids', () => {
    expect(getSources().sources).toHaveLength(SOURCES.length);
    const r = getSources(['svc-lambda', 'made-up', 'svc-lambda']);
    expect(r.sources.map((s) => s.id)).toEqual(['svc-lambda']);
    expect(r.unknownIds).toEqual(['made-up']);
  });

  it('describes every requirement field, including "unsure" defaults', () => {
    const schema = getRequirementsSchema();
    expect(schema.fields.map((f) => f.name)).toEqual(Object.keys(schema.jsonSchema.properties));
    for (const field of UNSURE_FIELDS) {
      const f = schema.fields.find((x) => x.name === field)!;
      expect(f.notSure?.value).toBe('unsure');
      expect(f.options?.some((o) => o.value === 'unsure')).toBe(true);
    }
    expect(schema.fields.find((f) => f.name === 'existingSystems')!.required).toBe('when workloadType is "integration"');
    expect(schema.fields.find((f) => f.name === 'description')!.notSure).toBeUndefined();
  });

  it('exposes samples and flags unknown keys', () => {
    expect(listSamples().map((s) => s.id)).toEqual(['web-app', 'integration', 'ai-assistant']);
    expect(getSample('nope')).toBeUndefined();
    expect(unknownRequirementKeys({ description: 'x', usage: 'low' })).toEqual(['usage']);
    expect(CATALOG.length).toBe(41);
  });
});
