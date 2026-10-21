import { buildDemoPlan, CHOICE_NOTES, DemoProvider } from '../shared/demoProvider';
import { SELECT_OPTIONS } from '../shared/options';
import { computeCompleteness } from '../shared/requirements';
import { RequirementsSchema, type PlanResponse, type Requirements } from '../shared/schema';
import { planFromRequirements } from '../shared/service';
import { validatePlan } from '../shared/validate';
import { scenarioRequirements } from './helpers';

const demo = new DemoProvider();
const services = (r: Requirements) => new Set(buildDemoPlan(r).nodes.map((n) => n.serviceId).filter(Boolean));
const pipeline = (o: Partial<Requirements> = {}) => RequirementsSchema.parse({ ...scenarioRequirements('data-pipeline'), ...o });
const jobs = (o: Partial<Requirements> = {}) => RequirementsSchema.parse({ ...scenarioRequirements('scheduled-jobs'), ...o });

async function plan(r: Requirements): Promise<Extract<PlanResponse, { kind: 'plan' }>> {
  const res = await planFromRequirements(r, demo);
  if (res.kind !== 'plan') throw new Error(`expected a plan, got ${res.kind}: ${JSON.stringify(res)}`);
  return res;
}

describe('new patterns are offered in plain language', () => {
  it('lists both kinds of system with labels a non-AWS user understands', () => {
    const labels = Object.fromEntries(SELECT_OPTIONS.workloadType!.map((o) => [o.value, o.label]));
    expect(labels.data_pipeline).toBe('Collecting data for reports and dashboards');
    expect(labels.scheduled_jobs).toMatch(/^Jobs that run on a schedule/);
    expect(Object.keys(labels).at(-1)).toBe('other');
  });

  it('"Something else" lists all five templates when it asks', async () => {
    const res = await planFromRequirements(pipeline({ workloadType: 'other' }), demo);
    expect(res.kind).toBe('questions');
    if (res.kind === 'questions') expect(res.questions[0].question).toMatch(/data pipeline.*schedule/);
  });
});

describe.each([
  ['data-pipeline', 'Data pipeline and analytics'],
  ['scheduled-jobs', 'Scheduled and batch jobs'],
] as const)('%s pattern', (id, title) => {
  it('gates on completeness before planning', async () => {
    const r = { ...scenarioRequirements(id), budget: '' } as Requirements;
    expect(computeCompleteness(r).missing).toEqual(['budget']);
    const res = await planFromRequirements(r, demo);
    expect(res.kind).toBe('questions');
  });

  it('does not require existing systems, and says what it assumed without them', async () => {
    const r = { ...scenarioRequirements(id), existingSystems: '' };
    expect(computeCompleteness(r).missing).toEqual([]);
    const res = await plan(r);
    expect(res.plan.assumptions.some((a) => a.field === 'existingSystems')).toBe(true);
  });

  it('produces a valid plan with every section, no warnings, and is deterministic', async () => {
    const r = scenarioRequirements(id);
    const raw = buildDemoPlan(r);
    const v = validatePlan(raw);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings).toEqual([]);
    expect(raw.title).toBe(`${title} on AWS (${r.region})`);
    expect(raw.summary).toMatch(/not production-ready/);
    for (const pillar of ['security', 'reliability', 'performance', 'operations', 'cost'] as const) expect(raw.considerations[pillar].length, pillar).toBeGreaterThan(0);
    expect(raw.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(raw.implementationSteps.at(-1)).toMatch(/Well-Architected review/);
    expect(raw.openQuestions.length).toBeGreaterThanOrEqual(3);
    expect(buildDemoPlan(r)).toEqual(raw);
    expect((await plan(r)).mermaid).toBe((await plan(r)).mermaid);
  });

  it('never states cost figures', () => {
    expect(JSON.stringify(buildDemoPlan(scenarioRequirements(id)))).not.toMatch(/\$\s?\d|per month|USD/);
  });

  it('flags regulated data', async () => {
    const res = await plan({ ...scenarioRequirements(id), dataSensitivity: 'regulated' });
    expect(res.plan.cautions.map((c) => c.topic).join(' ')).toMatch(/Regulated data/);
    expect(res.plan.nodes.some((n) => n.serviceId === 'guardduty')).toBe(true);
  });

});

describe('long answers (every pattern)', () => {
  it.each(['web-app', 'integration', 'ai-assistant', 'data-pipeline', 'scheduled-jobs'])('%s: stays inside the plan schema limits instead of failing validation', async (id) => {
    const longName = 'On-premises ERP (SQL Server 2019) hosted in our Atlanta data center, managed by IT';
    const res = await plan({
      ...scenarioRequirements(id),
      description: `${'We need this to work reliably. '.repeat(60)}`.slice(0, 2000),
      existingSystems: `${longName}, ${longName} B`,
      usageNotes: 'x'.repeat(500),
      recoveryNotes: 'y'.repeat(500),
      operationsNotes: 'z'.repeat(500),
    });
    for (const n of res.plan.nodes) expect(n.label.length).toBeLessThanOrEqual(60);
    expect(res.plan.nodes.some((n) => n.kind === 'external' && n.label.endsWith('...'))).toBe(true);
  });
});

describe('data pipeline choices', () => {
  it('defaults to serverless batch loads queried in place', () => {
    const s = services(pipeline());
    for (const svc of ['s3', 'glue', 'eventbridge-scheduler', 'athena', 'quick-sight', 'sns', 'cloudwatch', 'iam']) expect(s.has(svc), svc).toBe(true);
    for (const svc of ['firehose', 'redshift-serverless', 'transfer-family', 'step-functions']) expect(s.has(svc), svc).toBe(false);
  });

  it('streams with Data Firehose when data must arrive continuously', () => {
    expect(services(pipeline({ description: 'Collect clickstream events from our website in real time for marketing dashboards.' })).has('firehose')).toBe(true);
    expect(services(pipeline({ operationsNotes: CHOICE_NOTES.stream })).has('firehose')).toBe(true);
  });

  it('uses a Redshift Serverless warehouse instead of Athena when asked for one', () => {
    const s = services(pipeline({ operationsNotes: CHOICE_NOTES.warehouse }));
    expect(s.has('redshift-serverless')).toBe(true);
    expect(s.has('athena')).toBe(false);
  });

  it('accepts SFTP file drops and orchestrates with Step Functions for high availability', () => {
    expect(services(pipeline({ existingSystems: 'Supplier SFTP feed' })).has('transfer-family')).toBe(true);
    const high = services(pipeline({ availability: 'high' }));
    expect(high.has('step-functions') && high.has('backup')).toBe(true);
  });
});

describe('scheduled job choices', () => {
  it('defaults to EventBridge Scheduler, Lambda, a dead-letter queue, and SNS notifications', () => {
    const s = services(jobs());
    for (const svc of ['eventbridge-scheduler', 'lambda', 'sqs', 'sns', 's3', 'secrets-manager']) expect(s.has(svc), svc).toBe(true);
    for (const svc of ['ecs-fargate', 'batch', 'step-functions', 'vpc']) expect(s.has(svc), svc).toBe(false);
  });

  it('moves long jobs and container teams to Fargate tasks in a VPC', () => {
    for (const r of [jobs({ operationsNotes: CHOICE_NOTES.long }), jobs({ description: 'A long-running nightly reconciliation that takes several hours to finish.' }), jobs({ operations: 'containers' })]) {
      const s = services(r);
      expect(s.has('ecs-fargate') && s.has('vpc')).toBe(true);
      expect(s.has('lambda')).toBe(false);
    }
  });

  it('uses AWS Batch for many parallel jobs, Step Functions for multi-step runs, a queue for files, and run history for syncs', () => {
    expect(services(jobs({ operationsNotes: CHOICE_NOTES.parallel })).has('batch')).toBe(true);
    expect(services(jobs({ description: 'A nightly multi-step workflow: export, transform, then load into the warehouse and notify.' })).has('step-functions')).toBe(true);
    const files = buildDemoPlan(jobs({ description: 'Process each CSV file our partners drop overnight and load the rows into our system.' }));
    expect(files.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['inbox', 'queue', 'dlq']));
    expect(services(jobs({ description: 'Every hour, sync new customers from our CRM into our billing system incrementally.' })).has('dynamodb')).toBe(true);
  });

  it('reaches on-premises systems over a VPN', () => {
    const p = buildDemoPlan(jobs({ existingSystems: 'On-premises ERP' }));
    expect(p.connections).toEqual(expect.arrayContaining([{ from: 'job', to: 'vpn', label: 'private' }]));
  });
});
