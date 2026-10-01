import { CATALOG } from '../shared/catalog';
import { buildDemoPlan } from '../shared/demoProvider';
import {
  AVAILABILITY_LEVELS,
  BUDGET_LEVELS,
  OPS_MODELS,
  SENSITIVITY_LEVELS,
  USAGE_LEVELS,
  type Requirements,
} from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { SOURCES, getSource, isKnownSource } from '../shared/sources';
import { citedSourceIds } from '../shared/validate';

describe('curated source registry', () => {
  it('has unique ids and unique URLs', () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    expect(new Set(SOURCES.map((s) => s.url)).size).toBe(SOURCES.length);
  });

  it('contains only official AWS documentation over HTTPS', () => {
    for (const s of SOURCES) {
      expect(s.url, s.id).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
      expect(s.title.length, s.id).toBeGreaterThan(3);
      expect(s.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('includes the AWS Well-Architected Framework and all six pillars', () => {
    for (const id of ['wa-framework', 'wa-security', 'wa-reliability', 'wa-performance', 'wa-cost', 'wa-operational', 'wa-sustainability']) {
      expect(isKnownSource(id), id).toBe(true);
    }
  });

  it('every catalog entry cites at least one registry source', () => {
    for (const svc of CATALOG) {
      expect(svc.sourceIds.length, svc.id).toBeGreaterThan(0);
      for (const id of svc.sourceIds) expect(getSource(id), `${svc.id} -> ${id}`).toBeDefined();
    }
  });
});

describe('every citation in generated plans is a real registry entry', () => {
  it('holds for the three sample scenarios', () => {
    for (const s of SCENARIOS) {
      const ids = citedSourceIds(buildDemoPlan(s.requirements));
      expect(ids.length, s.id).toBeGreaterThan(5);
      for (const id of ids) expect(isKnownSource(id), `${s.id} cites ${id}`).toBe(true);
    }
  });

  it('holds across every combination of the main requirement options', () => {
    let plans = 0;
    for (const scenario of SCENARIOS) {
      for (const expectedUsage of USAGE_LEVELS)
        for (const dataSensitivity of SENSITIVITY_LEVELS)
          for (const availability of AVAILABILITY_LEVELS)
            for (const budget of BUDGET_LEVELS)
              for (const operations of OPS_MODELS) {
                const r: Requirements = { ...scenario.requirements, expectedUsage, dataSensitivity, availability, budget, operations };
                const plan = buildDemoPlan(r);
                plans++;
                for (const id of citedSourceIds(plan)) expect(isKnownSource(id), id).toBe(true);
                for (const n of plan.nodes) if (n.kind === 'aws') expect(CATALOG.some((c) => c.id === n.serviceId), n.serviceId).toBe(true);
              }
    }
    expect(plans).toBe(3 * 4 * 4 * 4 * 3 * 3);
  });
});
