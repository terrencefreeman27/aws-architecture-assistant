import { buildDemoPlan } from '../shared/demoProvider';
import { PILLARS } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { validatePlan } from '../shared/validate';
import { req, scenarioRequirements } from './helpers';

const services = (r: Parameters<typeof buildDemoPlan>[0]) => buildDemoPlan(r).nodes.map((n) => n.serviceId ?? n.kind);

describe('demo provider output', () => {
  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('%s passes validation with no warnings', (_id, r) => {
    const res = validatePlan(buildDemoPlan(r));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings).toEqual([]);
  });

  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('%s includes every required plan section', (_id, r) => {
    const plan = buildDemoPlan(r);
    expect(plan.alternatives.length).toBeGreaterThanOrEqual(1);
    for (const alt of plan.alternatives) {
      expect(alt.pros.length).toBeGreaterThan(0);
      expect(alt.cons.length).toBeGreaterThan(0);
    }
    expect(plan.assumptions.length).toBeGreaterThan(0);
    expect(plan.dataFlow.length).toBeGreaterThan(2);
    expect(plan.implementationSteps.length).toBeGreaterThan(2);
    for (const p of PILLARS) expect(plan.considerations[p].length, p).toBeGreaterThan(0);
    expect(plan.considerations.cost.some((c) => c.basis === 'assumption')).toBe(true);
  });

  it('is deterministic', () => {
    for (const s of SCENARIOS) expect(buildDemoPlan(s.requirements)).toEqual(buildDemoPlan(s.requirements));
  });
});

describe('editing requirements changes the plan', () => {
  it('switches the web app from serverless to containers', () => {
    expect(services(req({}))).toEqual(expect.arrayContaining(['api-gateway', 'lambda', 'dynamodb']));
    const containers = services(req({ operations: 'containers' }));
    expect(containers).toEqual(expect.arrayContaining(['alb', 'ecs-fargate', 'rds', 'secrets-manager']));
    expect(containers).not.toContain('lambda');
  });

  it('drops sign-in for public data and adds it back for internal data', () => {
    expect(services(req({ dataSensitivity: 'public' }))).not.toContain('cognito');
    expect(services(req({ dataSensitivity: 'internal' }))).toContain('cognito');
  });

  it('adds encryption, audit, and threat detection as sensitivity rises', () => {
    expect(services(req({ dataSensitivity: 'internal' }))).not.toContain('kms');
    const regulated = services(req({ dataSensitivity: 'regulated' }));
    expect(regulated).toEqual(expect.arrayContaining(['kms', 'cloudtrail', 'guardduty']));
  });

  it('adds Multi-AZ guidance and backups for high availability', () => {
    const low = buildDemoPlan(req({ operations: 'containers', availability: 'best_effort' }));
    const high = buildDemoPlan(req({ operations: 'containers', availability: 'high' }));
    expect(low.nodes.some((n) => n.serviceId === 'backup')).toBe(false);
    expect(high.nodes.some((n) => n.serviceId === 'backup')).toBe(true);
    expect(JSON.stringify(high.considerations.reliability)).toMatch(/Multi-AZ/);
    expect(JSON.stringify(low.considerations.reliability)).toMatch(/single point of failure/);
  });

  it('changes the region everywhere it is mentioned', () => {
    const plan = buildDemoPlan(req({ region: 'eu-central-1' }));
    expect(plan.title).toContain('eu-central-1');
    expect(plan.assumptions.some((a) => a.field === 'region' && a.text.includes('eu-central-1'))).toBe(true);
  });

  it('adds a VPN for on-premises integration targets and SFTP for file exchanges', () => {
    const base = scenarioRequirements('integration');
    expect(services(base)).toContain('site-to-site-vpn');
    expect(services({ ...base, existingSystems: 'Salesforce, NetSuite' })).not.toContain('site-to-site-vpn');
    expect(services({ ...base, description: `${base.description} The ERP sends nightly CSV files over SFTP.` })).toContain('transfer-family');
  });

  it('uses the existing-systems order to assume source and target, and says so', () => {
    const plan = buildDemoPlan({ ...scenarioRequirements('integration'), existingSystems: 'NetSuite, HubSpot' });
    const src = plan.nodes.find((n) => n.id === 'src');
    expect(src?.label).toBe('NetSuite');
    expect(plan.assumptions.find((a) => a.field === 'existingSystems')?.text).toMatch(/"NetSuite" is assumed to be the source/);
  });

  it('adds OCR only when scanned documents are mentioned', () => {
    const ai = scenarioRequirements('ai-assistant');
    expect(services(ai)).toContain('textract');
    expect(services({ ...ai, description: 'An internal assistant that answers questions about our HR policy documents.' })).not.toContain('textract');
  });
});
