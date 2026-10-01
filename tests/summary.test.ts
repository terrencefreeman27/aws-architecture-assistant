import { SCENARIOS } from '../shared/scenarios';
import { planFromRequirements } from '../shared/service';
import { DemoProvider } from '../shared/demoProvider';
import { summaryItems } from '../web/src/PlanSummary';
import { validRawPlan } from './helpers';
import { validatePlan } from '../shared/validate';

describe('plan summary bar', () => {
  it.each(SCENARIOS.map((s) => s.id))('%s: counts come from the plan data and each item has a target', async (id) => {
    const res = await planFromRequirements(SCENARIOS.find((s) => s.id === id)!.requirements, new DemoProvider());
    if (res.kind !== 'plan') throw new Error('expected a plan');
    const counts = Object.fromEntries(summaryItems(res.plan).map((i) => [i.key, i.count]));
    expect(counts.components).toBe(res.plan.nodes.length);
    expect(counts.assumptions).toBe(res.plan.assumptions.length);
    expect(counts.alternatives).toBe(res.plan.alternatives.length);
    expect(counts['open-questions']).toBe(res.plan.openQuestions.length);
    expect(counts.cautions).toBe(res.plan.cautions.length || undefined);
    for (const item of summaryItems(res.plan)) expect('tab' in item.target || 'section' in item.target).toBe(true);
  });

  it('leaves out sections with nothing in them instead of linking nowhere', () => {
    const res = validatePlan({ ...validRawPlan(), openQuestions: [], cautions: [] });
    if (!res.ok) throw new Error('invalid');
    const keys = summaryItems(res.plan).map((i) => i.key);
    expect(keys).toEqual(['components', 'assumptions', 'alternatives']);
  });
});
