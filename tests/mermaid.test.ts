// @vitest-environment jsdom
import mermaid from 'mermaid';
import { buildDemoPlan } from '../shared/demoProvider';
import { sanitizeLabel, toMermaid } from '../shared/mermaid';
import { SCENARIOS } from '../shared/scenarios';
import { validatePlan } from '../shared/validate';
import { validRawPlan } from './helpers';

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
});

describe('sanitizeLabel', () => {
  it('removes characters that could break out of a Mermaid label', () => {
    const out = sanitizeLabel('Evil"] --> x; click n_a call alert(1) <script>|#;{}');
    expect(out).not.toMatch(/["<>[\]{}|#;`\\]/);
  });

  it('keeps ordinary punctuation and non-ASCII letters', () => {
    expect(sanitizeLabel("ERP (SQL Server), Zürich's site / v2")).toBe("ERP (SQL Server), Zürich's site / v2");
  });

  it('never returns an empty label and truncates long ones', () => {
    expect(sanitizeLabel('"""')).toBe('Unnamed');
    expect(sanitizeLabel('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('toMermaid', () => {
  it('prefixes every node id so ids such as "end" cannot collide with keywords', () => {
    const raw = validRawPlan();
    raw.nodes[0].id = 'end';
    raw.connections[0].from = 'end';
    const res = validatePlan(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const src = toMermaid(res.plan);
    expect(src).toContain('n_end');
    expect(src).not.toMatch(/^\s+end\(/m);
  });

  it('groups unconnected components as cross-cutting services', () => {
    const raw = validRawPlan();
    raw.nodes.push({ id: 'iam', kind: 'aws', serviceId: 'iam', label: 'AWS IAM', role: 'Roles.', tier: 'security', sourceIds: [] });
    const res = validatePlan(raw);
    if (!res.ok) throw new Error('expected valid');
    expect(toMermaid(res.plan)).toMatch(/subgraph cross_cutting[\s\S]*n_iam[\s\S]*end/);
  });

  it('produces parseable Mermaid for every sample scenario', async () => {
    for (const s of SCENARIOS) {
      const src = toMermaid(buildDemoPlan(s.requirements));
      await expect(mermaid.parse(src), s.id).resolves.toBeTruthy();
    }
  });

  it('produces parseable Mermaid even when labels contain hostile text', async () => {
    const raw = validRawPlan();
    raw.nodes[1].label = 'A"]:::evil-->n_users\n%%{init:{"securityLevel":"loose"}}%%';
    raw.connections[0].label = 'x|y"; click';
    const res = validatePlan(raw);
    if (!res.ok) throw new Error('expected valid');
    const src = toMermaid(res.plan);
    expect(src).not.toContain('%%{');
    // The hostile text stays trapped inside one quoted label: no quote, bracket, or newline survives.
    expect(src).toMatch(/^ {2}n_api\["[^"\[\]\n]*"\]$/m);
    expect(src).toMatch(/^ {2}n_users -->\|"[^"|]*"\| n_api$/m);
    expect(src.split('\n').filter((l) => l.includes('evil'))).toHaveLength(1);
    await expect(mermaid.parse(src)).resolves.toBeTruthy();
  });
});
