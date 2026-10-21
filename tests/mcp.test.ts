import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { exportReport } from '../shared/core';
import { CATALOG } from '../shared/catalog';
import { SCENARIOS } from '../shared/scenarios';
import { SOURCES, isKnownSource } from '../shared/sources';
import { UNSURE_DEFAULTS, UNSURE_FIELDS } from '../shared/unsure';
import { citedSourceIds } from '../shared/validate';
import { planLocally } from '../web/src/planner';
import { createMcpServer } from '../mcp/server';

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverTransport);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
});

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult & { structuredContent?: any };

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;

describe('MCP server (in-memory)', () => {
  it('lists the expected tools with stable schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'export_report',
      'get_missing_questions',
      'get_requirements_schema',
      'get_sources',
      'list_supported_services',
      'plan_architecture',
    ]);
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(80);
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
    const plan = tools.find((t) => t.name === 'plan_architecture')!;
    expect(plan.description).toMatch(/not production-ready/i);
    expect(plan.description).toMatch(/never invent/i);
    expect(plan.description).toMatch(/cost figures/i);
    expect(plan.description).toMatch(/cite only sources returned/i);
    expect(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).toMatchSnapshot();
  });

  it('plan_architecture includes each alternative\'s drawn variant or text-only reason (additive fields)', async () => {
    const r = await call('plan_architecture', { requirements: SCENARIOS.find((s) => s.id === 'scheduled-jobs')!.requirements });
    const alts = r.structuredContent.plan.alternatives;
    expect(alts.length).toBeGreaterThan(1);
    for (const a of alts) {
      expect(a).toEqual(expect.objectContaining({ title: expect.any(String), summary: expect.any(String), pros: expect.any(Array), cons: expect.any(Array), sourceIds: expect.any(Array) }));
      expect(['diagram', 'text_only']).toContain(a.variant.kind);
    }
    const drawn = alts.find((a: any) => a.variant.kind === 'diagram').variant;
    expect(drawn.mermaid).toMatch(/^flowchart TB/);
    expect(drawn.changes[0]).toEqual(expect.objectContaining({ field: 'operationsNotes', value: expect.any(String), label: expect.any(String) }));
  });

  it('documents the text length limits, including the 60-character diagram label limit, before callers hit them', async () => {
    const { tools } = await client.listTools();
    const plan = tools.find((t) => t.name === 'plan_architecture')!;
    const reqDesc = (plan.inputSchema.properties as any).requirements.description as string;
    expect(reqDesc).toMatch(/description 2000, existingSystems 1000, usageNotes 500, recoveryNotes 500, operationsNotes 500/);
    expect(reqDesc).toMatch(/at most 60 characters/);
    const schema = (await call('get_requirements_schema')).structuredContent;
    expect(schema.notes.join(' ')).toMatch(/at most 60 characters/);
    expect(schema.fields.find((f: any) => f.name === 'existingSystems').format).toMatch(/Comma-separated[\s\S]*60 characters/);
    // A long system name is shortened, not rejected.
    const long = 'On-premises ERP (SQL Server 2019) in our Atlanta data center, run by our IT team';
    const r = await call('plan_architecture', { requirements: { ...SCENARIOS[1].requirements, existingSystems: `${long}, Salesforce` } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.status).toBe('plan');
  });

  it('server instructions carry the same rules', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toMatch(/never invent/i);
    expect(instructions).toMatch(/NOT production-ready/);
  });

  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('%s: plan_architecture equals the website plan', async (_id, requirements) => {
    const r = await call('plan_architecture', { requirements });
    expect(r.isError).toBeFalsy();
    const web = await planLocally(structuredClone(requirements));
    if (web.kind !== 'plan') throw new Error('expected a plan');
    const sc = r.structuredContent;
    expect(sc.status).toBe('plan');
    expect(sc.plan).toEqual(web.plan);
    expect(sc.mermaid).toBe(web.mermaid);
    expect(sc.warnings).toEqual(web.warnings);
    expect(sc.completeness).toEqual(web.completeness);
    expect(sc.provider).toBe('demo');
    expect(sc.notice).toMatch(/Not production-ready/);
    expect(JSON.parse(text(r))).toEqual(sc);
    for (const id of citedSourceIds(sc.plan)) expect(isKnownSource(id), id).toBe(true);
    expect(text(r)).not.toMatch(/\$\s?\d/);
  });

  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))('%s: export_report equals the website report', async (_id, requirements) => {
    const r = await call('export_report', { requirements });
    const expected = await exportReport(structuredClone(requirements));
    if (expected.kind !== 'report') throw new Error('expected a report');
    const generatedAt = r.structuredContent.markdown.match(/^Generated (\S+) by/m)[1];
    const normalise = (md: string) => md.replace(/^Generated \S+ by/m, 'Generated X by');
    expect(normalise(r.structuredContent.markdown)).toBe(normalise(expected.markdown));
    expect(text(r)).toBe(r.structuredContent.markdown);
    expect(generatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(r.structuredContent.fileName).toBe(expected.fileName);
  });

  it('incomplete requirements return questions, not a plan', async () => {
    for (const tool of ['plan_architecture', 'get_missing_questions', 'export_report']) {
      const r = await call(tool, { requirements: { description: 'A portal for customers' } });
      expect(r.isError, tool).toBeFalsy();
      expect(r.structuredContent.status, tool).toBe('needs_more_information');
      expect(r.structuredContent.plan, tool).toBeUndefined();
      expect(r.structuredContent.instruction).toMatch(/Do not answer them yourself/);
      const fields = r.structuredContent.questions.map((q: { field: string }) => q.field);
      expect(fields).toContain('workloadType');
      for (const q of r.structuredContent.questions) expect(q.why.length).toBeGreaterThan(0);
    }
  });

  it('get_missing_questions reports complete requirements', async () => {
    const r = await call('get_missing_questions', { requirements: SCENARIOS[0].requirements });
    expect(r.structuredContent).toMatchObject({ status: 'complete', questions: [] });
  });

  it('invalid input returns a structured tool error and the server keeps working', async () => {
    const bad = await call('plan_architecture', { requirements: { region: 'moon-1' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/region/);
    const wrongType = await call('get_missing_questions', { requirements: 'not an object' });
    expect(wrongType.isError).toBe(true);
    const missingArg = await call('export_report', {});
    expect(missingArg.isError).toBe(true);
    const unknownTool = await client.callTool({ name: 'nope', arguments: {} }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }));
    expect(unknownTool.isError).toBe(true);
    const after = await call('plan_architecture', { requirements: SCENARIOS[1].requirements });
    expect(after.structuredContent.status).toBe('plan');
  });

  it('"unsure" answers use the documented defaults and become assumptions', async () => {
    const requirements = { ...SCENARIOS[0].requirements, ...Object.fromEntries(UNSURE_FIELDS.map((f) => [f, 'unsure'])) };
    const r = await call('plan_architecture', { requirements });
    expect(r.structuredContent.status).toBe('plan');
    const assumptions: { text: string; field?: string }[] = r.structuredContent.plan.assumptions;
    for (const f of UNSURE_FIELDS) expect(assumptions).toContainEqual({ text: UNSURE_DEFAULTS[f].assumption, field: f });
    expect(r.structuredContent.plan.title).toContain('us-east-1');
    const web = await planLocally(requirements as never);
    expect(web.kind === 'plan' && web.plan).toEqual(r.structuredContent.plan);
  });

  it('flags unknown requirement keys instead of silently dropping them', async () => {
    const r = await call('plan_architecture', { requirements: { ...SCENARIOS[0].requirements, monthlyBudgetUsd: 50 } });
    expect(r.structuredContent.ignoredFields).toEqual(['monthlyBudgetUsd']);
  });

  it('get_sources returns registry entries only', async () => {
    const all = await call('get_sources');
    expect(all.structuredContent.sources).toHaveLength(SOURCES.length);
    const some = await call('get_sources', { ids: ['wa-security', 'invented-source'] });
    expect(some.structuredContent.sources.map((s: { id: string }) => s.id)).toEqual(['wa-security']);
    expect(some.structuredContent.unknownIds).toEqual(['invented-source']);
  });

  it('list_supported_services returns the catalog', async () => {
    const r = await call('list_supported_services');
    expect(r.structuredContent.services).toEqual(CATALOG);
  });

  it('get_requirements_schema lists fields, labels, and "unsure" defaults', async () => {
    const r = await call('get_requirements_schema');
    const fields = r.structuredContent.fields as { name: string; notSure?: { defaultValue: string } }[];
    expect(fields).toHaveLength(12);
    for (const f of UNSURE_FIELDS) expect(fields.find((x) => x.name === f)!.notSure!.defaultValue).toBe(UNSURE_DEFAULTS[f].value);
  });
});

describe('MCP server (stdio child process via bin/aws-arch-mcp.mjs)', () => {
  it('starts, lists tools, plans a sample, and shuts down', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('bin/aws-arch-mcp.mjs')], stderr: 'pipe' });
    const c = new Client({ name: 'stdio-test', version: '1.0.0' });
    await c.connect(transport);
    try {
      expect((await c.listTools()).tools).toHaveLength(6);
      const r = (await c.callTool({ name: 'plan_architecture', arguments: { requirements: SCENARIOS[2].requirements } })) as any;
      expect(r.structuredContent.status).toBe('plan');
    } finally {
      await c.close();
    }
  }, 30_000);
});
