import { DemoProvider } from '../shared/demoProvider';
import { computeCompleteness, followUpQuestions } from '../shared/requirements';
import { EMPTY_REQUIREMENTS, RequirementsSchema } from '../shared/schema';
import { planFromRequirements } from '../shared/service';
import { req, scenarioRequirements } from './helpers';

const demo = new DemoProvider();

describe('incomplete requirements', () => {
  it('empty requirements produce follow-up questions, never a plan', async () => {
    const res = await planFromRequirements(EMPTY_REQUIREMENTS, demo);
    expect(res.kind).toBe('questions');
    if (res.kind !== 'questions') return;
    expect(res.completeness.percent).toBe(0);
    expect(res.questions.map((q) => q.field)).toEqual(
      expect.arrayContaining(['description', 'workloadType', 'expectedUsage', 'dataSensitivity', 'region', 'availability', 'budget', 'operations']),
    );
    for (const q of res.questions) expect(q.why.length).toBeGreaterThan(10);
  });

  it('asks only about what is missing', async () => {
    const res = await planFromRequirements(req({ region: '', budget: '' }), demo);
    expect(res.kind).toBe('questions');
    if (res.kind === 'questions') expect(res.questions.map((q) => q.field).sort()).toEqual(['budget', 'region']);
  });

  it('treats a too-short description as missing and asks for more detail', () => {
    const r = req({ description: 'An app' });
    expect(computeCompleteness(r).missing).toContain('description');
    expect(followUpQuestions(r)[0].question).toMatch(/more detail/);
  });

  it('requires existing systems for integrations only', () => {
    expect(computeCompleteness(req({ existingSystems: '' })).missing).not.toContain('existingSystems');
    const integration = { ...scenarioRequirements('integration'), existingSystems: '' };
    expect(computeCompleteness(integration).missing).toEqual(['existingSystems']);
  });

  it('asks instead of guessing when no demo template matches', async () => {
    const res = await planFromRequirements(req({ workloadType: 'other' }), demo);
    expect(res.kind).toBe('questions');
    if (res.kind === 'questions') expect(res.questions[0].question).toMatch(/closest/);
  });

  it('complete sample scenarios produce plans at 100% completeness', async () => {
    for (const id of ['web-app', 'integration', 'ai-assistant']) {
      const res = await planFromRequirements(scenarioRequirements(id), demo);
      expect(res.kind, id).toBe('plan');
      if (res.kind === 'plan') expect(res.completeness.percent).toBe(100);
    }
  });
});

describe('requirements schema', () => {
  it('rejects values outside the allowed options', () => {
    expect(RequirementsSchema.safeParse({ region: 'mars-1' }).success).toBe(false);
    expect(RequirementsSchema.safeParse({ dataSensitivity: 'secret' }).success).toBe(false);
  });

  it('fills unanswered fields with empty strings', () => {
    expect(RequirementsSchema.parse({}).region).toBe('');
  });
});
