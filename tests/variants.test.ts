// @vitest-environment jsdom
import mermaid from 'mermaid';
import { exportReport, planArchitecture } from '../shared/core';
import { buildDemoPlan, CHOICE_NOTES, DemoProvider } from '../shared/demoProvider';
import { mdText } from '../shared/report';
import { toMermaid } from '../shared/mermaid';
import type { ArchitectureProvider } from '../shared/provider';
import {
  OPS_MODELS,
  SENSITIVITY_LEVELS,
  USAGE_LEVELS,
  type AlternativeVariant,
  type PlanResponse,
  type Requirements,
} from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { planFromRequirements } from '../shared/service';
import { isKnownSource } from '../shared/sources';
import { UNSURE } from '../shared/unsure';
import { validatePlan } from '../shared/validate';
import { applyChanges, diffComponents, withVariants } from '../shared/variants';
import { scenarioRequirements, validRawPlan } from './helpers';

const demo = new DemoProvider();
type Diagram = Extract<AlternativeVariant, { kind: 'diagram' }>;

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
});

async function plan(r: Requirements): Promise<Extract<PlanResponse, { kind: 'plan' }>> {
  const res = await planFromRequirements(r, demo);
  if (res.kind !== 'plan') throw new Error(`expected a plan, got ${res.kind}`);
  return res;
}

const diagrams = (p: Extract<PlanResponse, { kind: 'plan' }>) =>
  p.plan.alternatives.flatMap((a) => (a.variant?.kind === 'diagram' ? [{ title: a.title, v: a.variant }] : []));

/** Checks one drawn alternative against an independent run of the planner with its changes applied. */
async function checkVariant(req: Requirements, base: Extract<PlanResponse, { kind: 'plan' }>, v: Diagram, label: string) {
  const applied = applyChanges(req, v.changes);
  const direct = await plan(applied);
  expect(v.nodes, label).toEqual(direct.plan.nodes);
  expect(v.connections, label).toEqual(direct.plan.connections);
  expect(v.mermaid, label).toBe(direct.mermaid);
  expect(v.mermaid, label).toBe(toMermaid({ nodes: v.nodes, connections: v.connections }));

  const raw = { ...validRawPlan(), nodes: v.nodes, connections: v.connections };
  const res = validatePlan(raw);
  expect(res.ok && res.warnings, label).toEqual([]);

  const diff = diffComponents(base.plan, direct.plan);
  expect({ added: v.added, removed: v.removed }, label).toEqual(diff);
  expect(v.added.length + v.removed.length, label).toBeGreaterThan(0);
  for (const n of v.nodes) for (const id of n.sourceIds) expect(isKnownSource(id), `${label} cites ${id}`).toBe(true);
}

describe('alternatives drawn as validated variants', () => {
  it.each(SCENARIOS.map((s) => s.id))('%s: every alternative is either drawn and valid, or text-only with a reason', async (id) => {
    const req = scenarioRequirements(id);
    const base = await plan(req);
    for (const alt of base.plan.alternatives) {
      expect(alt.variant, alt.title).toBeDefined();
      if (alt.variant!.kind === 'text_only') expect(alt.variant!.reason.length, alt.title).toBeGreaterThan(30);
      else {
        await checkVariant(req, base, alt.variant!, `${id}: ${alt.title}`);
        await expect(mermaid.parse(alt.variant!.mermaid)).resolves.toBeTruthy();
        await expect(mermaid.parse(toMermaid(alt.variant!, { icons: true }))).resolves.toBeTruthy();
      }
    }
  });

  it('draws at least one alternative for the web app, data pipeline, and scheduled jobs samples', async () => {
    for (const id of ['web-app', 'data-pipeline', 'scheduled-jobs']) expect(diagrams(await plan(scenarioRequirements(id))).length, id).toBeGreaterThan(0);
  });

  it('computes the web app "what changes" lists from the two plans', async () => {
    const base = await plan(scenarioRequirements('web-app'));
    const [{ v }] = diagrams(base);
    expect(v.changes).toEqual([{ field: 'operations', value: 'containers', label: 'Who runs it: We already use containers (Docker etc.)' }]);
    expect(v.added.map((n) => n.service).sort()).toEqual(['AWS Secrets Manager', 'Amazon ECS on AWS Fargate', 'Amazon RDS', 'Amazon VPC', 'Application Load Balancer']);
    expect(v.removed.map((n) => n.service).sort()).toEqual(['AWS Lambda', 'Amazon API Gateway', 'Amazon DynamoDB']);
  });

  it('computes the scheduled job and data pipeline lists', async () => {
    const jobs = diagrams(await plan(scenarioRequirements('scheduled-jobs')));
    const fargate = jobs.find((d) => d.title.startsWith('Container task'))!.v;
    expect(fargate.added.map((n) => n.service)).toEqual(['Amazon ECS on AWS Fargate', 'Amazon VPC']);
    expect(fargate.removed.map((n) => n.service)).toEqual(['AWS Lambda']);
    const pipeline = diagrams(await plan(scenarioRequirements('data-pipeline')));
    const warehouse = pipeline.find((d) => d.title.startsWith('Data warehouse'))!.v;
    expect(warehouse.added.map((n) => n.service)).toEqual(['Amazon Redshift Serverless']);
    expect(warehouse.removed.map((n) => n.service)).toEqual(['Amazon Athena']);
    expect(warehouse.changes[0]).toMatchObject({ field: 'operationsNotes', value: CHOICE_NOTES.warehouse });
  });

  it('"Use this alternative" round-trips: applying it gives that diagram, and its own alternative leads back', async () => {
    for (const id of ['web-app', 'data-pipeline', 'scheduled-jobs']) {
      const req = scenarioRequirements(id);
      const base = await plan(req);
      for (const { title, v } of diagrams(base)) {
        const applied = applyChanges(req, v.changes);
        const after = await plan(applied);
        expect(after.plan.nodes, title).toEqual(v.nodes);
        // The applied plan offers the way back where the planner can draw it.
        const back = diagrams(after).find(({ v: bv }) => JSON.stringify(applyChanges(applied, bv.changes)) === JSON.stringify(req));
        if (!title.startsWith('AWS Batch')) expect(back, `${id}: ${title}`).toBeDefined();
        if (back) expect(back.v.nodes).toEqual(base.plan.nodes);
      }
    }
  });

  it('from AWS Batch, the single-task alternative really is a Fargate task', async () => {
    const req = { ...scenarioRequirements('scheduled-jobs'), operationsNotes: CHOICE_NOTES.parallel };
    const single = diagrams(await plan(req)).find((d) => d.title.startsWith('Single container task'))!.v;
    expect(single.added.map((n) => n.service)).toEqual(['Amazon ECS on AWS Fargate']);
    expect(single.removed.map((n) => n.service)).toEqual(['AWS Batch']);
    expect(single.changes[0].label).toContain('replaces');
  });

  it('keeps "Not sure" answers when applying an alternative', async () => {
    const req = { ...scenarioRequirements('web-app'), operations: UNSURE, budget: UNSURE } as Requirements;
    const [{ v }] = diagrams(await plan(req));
    const applied = applyChanges(req, v.changes);
    expect(applied.operations).toBe('containers');
    expect(applied.budget).toBe(UNSURE);
  });

  it('every drawn variant validates cleanly across option combinations', async () => {
    let drawn = 0;
    for (const s of SCENARIOS)
      for (const expectedUsage of USAGE_LEVELS)
        for (const dataSensitivity of SENSITIVITY_LEVELS)
          for (const operations of OPS_MODELS) {
            const req = { ...s.requirements, expectedUsage, dataSensitivity, operations };
            const base = await plan(req);
            for (const { v } of diagrams(base)) {
              drawn++;
              const res = validatePlan({ ...validRawPlan(), nodes: v.nodes, connections: v.connections });
              expect(res.ok && res.warnings).toEqual([]);
              expect(v.added.length + v.removed.length).toBeGreaterThan(0);
            }
          }
    expect(drawn).toBeGreaterThan(200);
  });
});

describe('alternatives that cannot be drawn', () => {
  it('stay text-only for providers without alternative specs, and the provider is not called again', async () => {
    let calls = 0;
    const model: ArchitectureProvider = { name: 'model', generatePlan: async (r) => (calls++, buildDemoPlan(r)) };
    const res = await planFromRequirements(scenarioRequirements('web-app'), model);
    if (res.kind !== 'plan') throw new Error('expected plan');
    expect(calls).toBe(1);
    for (const a of res.plan.alternatives) expect(a.variant).toMatchObject({ kind: 'text_only', reason: expect.stringContaining('"model" planner') });
  });

  it('stay text-only when the changes are invalid, incomplete, or change nothing', async () => {
    const req = scenarioRequirements('web-app');
    const base = buildDemoPlan(req);
    const title = base.alternatives[0].title;
    const run = async (spec: unknown) =>
      (await withVariants(req, base, { ...demo, name: 'demo', generatePlan: demo.generatePlan.bind(demo), alternativeSpecs: () => ({ [title]: spec as never }) }))[0].variant;
    expect(await run({ changes: [{ field: 'operations', value: 'kubernetes' }] })).toMatchObject({ kind: 'text_only' });
    expect(await run({ changes: [{ field: 'notAField', value: 'x' }] })).toMatchObject({ kind: 'text_only' });
    expect(await run({ changes: [] })).toMatchObject({ kind: 'text_only' });
    expect(await run({ changes: [{ field: 'budget', value: '' }] })).toMatchObject({ kind: 'text_only', reason: expect.stringContaining('incomplete') });
    expect(await run({ changes: [{ field: 'region', value: 'eu-west-1' }] })).toMatchObject({ kind: 'text_only', reason: expect.stringContaining('not change') });
    expect(await run(undefined)).toMatchObject({ kind: 'text_only' });
  });

  it('ignores a variant a provider tries to supply itself', () => {
    const raw = validRawPlan();
    raw.alternatives[0].variant = { kind: 'diagram', mermaid: 'flowchart TB\n  click x call alert(1)', nodes: [], connections: [], changes: [], added: [], removed: [] };
    const res = validatePlan(raw);
    expect(res.ok && 'variant' in res.plan.alternatives[0]).toBe(false);
  });

  it('says why when the reverse choice comes from the user\'s own words', async () => {
    const req = { ...scenarioRequirements('scheduled-jobs'), description: 'A long-running nightly reconciliation that takes several hours to finish, then emails the team.' };
    const alt = (await plan(req)).plan.alternatives.find((a) => a.title.startsWith('Lambda'))!;
    expect(alt.variant).toMatchObject({ kind: 'text_only', reason: expect.stringContaining('15 minutes') });
  });
});

describe('variants reach the report, MCP/CLI JSON, and keep citations registry-only', () => {
  it.each(['web-app', 'data-pipeline', 'scheduled-jobs'])('%s: the report embeds each drawn alternative with its what-changes list', async (id) => {
    const r = await exportReport(scenarioRequirements(id), { shareBase: null });
    if (r.kind !== 'report') throw new Error('expected report');
    for (const alt of r.response.plan.alternatives) {
      const v = alt.variant!;
      if (v.kind === 'diagram') {
        expect(r.markdown).toContain(`\`\`\`mermaid\n${v.mermaid}\n\`\`\``);
        for (const c of v.changes) expect(r.markdown).toContain(`- Answer changed: ${mdText(c.label)}`);
        expect(r.markdown).toMatch(/- (Added|Removed): \*\*/);
      } else {
        expect(r.markdown).toContain('Not drawn as a diagram:');
      }
    }
    expect(r.markdown).not.toMatch(/\$\s?\d/);
    const urls = [...r.markdown.matchAll(/\]\((https:[^)]+)\)/g)].map((m) => m[1]);
    for (const u of urls) expect(u).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
  });

  it('planArchitecture (used by MCP plan_architecture and the CLI) returns the structured variants', async () => {
    const r = await planArchitecture(scenarioRequirements('data-pipeline'));
    if (r.kind !== 'plan') throw new Error('expected plan');
    const v = r.plan.alternatives[0].variant as Diagram;
    expect(v.kind).toBe('diagram');
    expect(Object.keys(v).sort()).toEqual(['added', 'changes', 'connections', 'kind', 'mermaid', 'nodes', 'removed']);
    // Additive: every field the plan had before is still there with the same shape.
    for (const a of r.plan.alternatives) expect(Object.keys(a)).toEqual(expect.arrayContaining(['title', 'summary', 'pros', 'cons', 'sourceIds']));
  });
});
