import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportReport } from '../shared/core';
import { CATALOG } from '../shared/catalog';
import { SCENARIOS } from '../shared/scenarios';
import { SOURCES } from '../shared/sources';
import { planLocally } from '../web/src/planner';

/** Runs bin/aws-arch-plan.mjs as a child process, the way a user would. */
function cli(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = execFile(process.execPath, [resolve('bin/aws-arch-plan.mjs'), ...args], { timeout: 30_000 }, (err, stdout, stderr) =>
      done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin!.end(stdin ?? '');
  });
}

let dir = '';
const file = async (name: string, content: unknown) => {
  const path = join(dir, name);
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aws-arch-cli-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const T = 30_000;

describe('aws-arch-plan CLI', () => {
  it.each(SCENARIOS.map((s) => [s.id, s.requirements] as const))(
    'plan %s (json) equals the website plan',
    async (id, requirements) => {
      const r = await cli(['plan', await file(`${id}.json`, requirements)]);
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      const web = await planLocally(structuredClone(requirements));
      if (web.kind !== 'plan') throw new Error('expected plan');
      expect(out.status).toBe('plan');
      expect(out.plan).toEqual(web.plan);
      expect(out.mermaid).toBe(web.mermaid);
      expect(out.notice).toMatch(/Not production-ready/);
    },
    T,
  );

  it('plan reads stdin and prints Mermaid', async () => {
    const r = await cli(['plan', '-', '--format', 'mermaid'], JSON.stringify(SCENARIOS[1].requirements));
    expect(r.code).toBe(0);
    const web = await planLocally(structuredClone(SCENARIOS[1].requirements));
    expect(r.stdout).toBe(`${web.kind === 'plan' && web.mermaid}\n`);
  }, T);

  it('plan --format md prints the website report', async () => {
    const r = await cli(['plan', '-f', 'md', await file('ai.json', SCENARIOS[2].requirements)]);
    expect(r.code).toBe(0);
    const expected = await exportReport(SCENARIOS[2].requirements);
    const normalise = (md: string) => md.replace(/^Generated \S+ by/m, 'Generated X by').trimEnd();
    expect(expected.kind === 'report' && normalise(r.stdout)).toBe(expected.kind === 'report' && normalise(expected.markdown));
  }, T);

  it('plan with incomplete requirements prints questions to stderr and exits 2', async () => {
    const r = await cli(['plan', '-'], JSON.stringify({ description: 'A portal for our customers' }));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/incomplete/);
    expect(r.stderr).toMatch(/workloadType \(What kind of system is it\?\)/);
  }, T);

  it('plan rejects invalid values, bad JSON, missing files, and unknown formats with exit 1', async () => {
    const bad = await cli(['plan', '-'], JSON.stringify({ region: 'moon-1' }));
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/failed validation[\s\S]*region/);
    const notJson = await cli(['plan', '-'], '{nope');
    expect(notJson.code).toBe(1);
    expect(notJson.stderr).toMatch(/not valid JSON/);
    const missing = await cli(['plan', join(dir, 'missing.json')]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/ENOENT/);
    const fmt = await cli(['plan', '-', '--format', 'pdf'], '{}');
    expect(fmt.code).toBe(1);
    const noFile = await cli(['plan']);
    expect(noFile.code).toBe(1);
  }, T);

  it('"unsure" answers become defaults and assumptions', async () => {
    const r = await cli(['plan', '-'], JSON.stringify({ ...SCENARIOS[0].requirements, region: 'unsure', dataSensitivity: 'unsure' }));
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.plan.title).toContain('us-east-1');
    expect(out.plan.assumptions.map((a: { field?: string }) => a.field)).toEqual(expect.arrayContaining(['region', 'dataSensitivity']));
  }, T);

  it('warns about unknown fields', async () => {
    const r = await cli(['plan', '-', '-f', 'mermaid'], JSON.stringify({ ...SCENARIOS[0].requirements, costCap: 10 }));
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/ignoring unknown field\(s\): costCap/);
  }, T);

  it('questions prints follow-up questions as JSON', async () => {
    const r = await cli(['questions', '-'], JSON.stringify({ description: 'A portal for our customers', workloadType: 'integration' }));
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('needs_more_information');
    expect(out.questions.map((q: { field: string }) => q.field)).toContain('existingSystems');
    const complete = await cli(['questions', '-'], JSON.stringify(SCENARIOS[0].requirements));
    expect(JSON.parse(complete.stdout).status).toBe('complete');
  }, T);

  it('catalog, sources, and schema print the registries', async () => {
    expect(JSON.parse((await cli(['catalog'])).stdout)).toEqual(CATALOG);
    expect(JSON.parse((await cli(['sources'])).stdout)).toHaveLength(SOURCES.length);
    const one = await cli(['sources', 'wa-security']);
    expect(JSON.parse(one.stdout).map((s: { id: string }) => s.id)).toEqual(['wa-security']);
    const unknown = await cli(['sources', 'made-up']);
    expect(unknown.code).toBe(1);
    const schema = JSON.parse((await cli(['schema'])).stdout);
    expect(schema.fields).toHaveLength(12);
  }, T);

  it('samples lists samples and prints one that plans cleanly', async () => {
    const list = JSON.parse((await cli(['samples'])).stdout);
    expect(list.map((s: { id: string }) => s.id)).toEqual(SCENARIOS.map((s) => s.id));
    const one = await cli(['samples', 'integration']);
    expect(JSON.parse(one.stdout)).toEqual(SCENARIOS[1].requirements);
    const planned = await cli(['plan', '-'], one.stdout);
    expect(planned.code).toBe(0);
    expect((await cli(['samples', 'nope'])).code).toBe(1);
  }, T);

  it('help, no command, and unknown commands', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/Usage: aws-arch-plan/);
    expect((await cli([])).code).toBe(1);
    const unknown = await cli(['deploy']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown command "deploy"/);
    expect((await cli(['plan', '--bogus'])).code).toBe(1);
  }, T);
});
