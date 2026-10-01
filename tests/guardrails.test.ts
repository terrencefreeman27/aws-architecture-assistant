import { buildDemoPlan, DemoProvider } from '../shared/demoProvider';
import { detectCautions } from '../shared/guardrails';
import { SCENARIOS } from '../shared/scenarios';
import { planFromRequirements } from '../shared/service';
import { isKnownSource } from '../shared/sources';
import { req } from './helpers';

const topics = (description: string) => detectCautions(req({ description })).map((c) => c.topic);

describe('questions the assistant should not answer confidently', () => {
  it('declines to give exact costs', () => {
    expect(topics('How much will this cost per month for our portal?')).toContain('Exact cost');
    expect(topics('We have $500 to spend on the portal each month.')).toContain('Exact cost');
  });

  it('declines to certify compliance', () => {
    expect(topics('A patient portal that must be HIPAA compliant.')).toContain('Compliance');
    expect(topics('Store card data; we need PCI-DSS certification.')).toContain('Compliance');
  });

  it('declines to call designs production-ready or guaranteed', () => {
    expect(topics('Give me a production-ready design with zero downtime.')).toContain('Production readiness');
  });

  it('stays AWS-only', () => {
    expect(topics('Should we use Azure or Google Cloud for this portal?')).toContain('Other clouds');
  });

  it('flags regulated data and mission-critical availability even without keywords', () => {
    const t = detectCautions(req({ dataSensitivity: 'regulated', availability: 'mission_critical' })).map((c) => c.topic);
    expect(t).toEqual(expect.arrayContaining(['Regulated data', 'Mission-critical availability']));
  });

  it('raises nothing for an ordinary request', () => {
    expect(topics('A customer portal where clients view their orders and invoices.')).toEqual([]);
  });

  it('cites only registry sources in cautions', () => {
    const all = detectCautions(
      req({ description: 'HIPAA, production-ready, how much per month, or Azure?', dataSensitivity: 'regulated', availability: 'mission_critical' }),
    );
    for (const c of all) for (const id of c.sourceIds) expect(isKnownSource(id), id).toBe(true);
  });

  it('carries cautions into both follow-up questions and finished plans', async () => {
    const demo = new DemoProvider();
    const incomplete = await planFromRequirements(req({ description: 'How much does a HIPAA compliant portal cost?', region: '' }), demo);
    expect(incomplete.kind).toBe('questions');
    if (incomplete.kind === 'questions') expect(incomplete.cautions.map((c) => c.topic)).toEqual(expect.arrayContaining(['Exact cost', 'Compliance']));

    const complete = await planFromRequirements(req({ description: 'How much does a HIPAA compliant portal cost?' }), demo);
    expect(complete.kind).toBe('plan');
    if (complete.kind === 'plan') expect(complete.plan.cautions.map((c) => c.topic)).toEqual(expect.arrayContaining(['Exact cost', 'Compliance']));
  });
});

describe('plan content never overclaims', () => {
  it('contains no dollar figures and never claims to be production-ready', () => {
    for (const s of SCENARIOS) {
      const text = JSON.stringify(buildDemoPlan(s.requirements));
      expect(text, s.id).not.toMatch(/\$\s?\d/);
      expect(text.match(/production-ready/g)?.length ?? 0).toBe(1); // only in "it is not production-ready"
      expect(text).toContain('not production-ready');
      expect(text).not.toMatch(/\bguarantee/i);
      expect(text).not.toMatch(/\bcompliant\b/i);
    }
  });

  it('asks the user to confirm Bedrock model availability instead of asserting it', () => {
    const plan = buildDemoPlan(SCENARIOS.find((s) => s.id === 'ai-assistant')!.requirements);
    expect(plan.openQuestions.some((q) => /available in us-west-2/.test(q))).toBe(true);
  });
});
