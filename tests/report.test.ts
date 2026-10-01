import { DemoProvider } from '../shared/demoProvider';
import { toMermaid } from '../shared/mermaid';
import { mdText, planToMarkdown, reportFileName, type ReportInput } from '../shared/report';
import { RequirementsSchema, type PlanResponse } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { planFromRequirements } from '../shared/service';
import { SOURCES } from '../shared/sources';
import { citedSourceIds, validatePlan } from '../shared/validate';
import { validRawPlan } from './helpers';

const SECTIONS = [
  '## Summary',
  '## Requirements as entered',
  '## Architecture diagram',
  '## Components',
  '## Data flow',
  '## Assumptions',
  '## Open questions',
  '## Considerations by pillar',
  '### Security',
  '### Reliability',
  '### Performance efficiency',
  '### Operational excellence',
  '### Cost (drivers, not estimates)',
  '## Alternatives and tradeoffs',
  '## Implementation sequence',
  '## Cautions',
  '## Sources',
  '## Share link',
];

const REGISTRY_URLS = new Set<string>(SOURCES.map((s) => s.url));
const SHARE = 'https://aws-architecture-assistant.example/#r=zAbc_-123';

async function samplePlan(id: string): Promise<Extract<PlanResponse, { kind: 'plan' }>> {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const res = await planFromRequirements(scenario.requirements, new DemoProvider());
  if (res.kind !== 'plan') throw new Error(`expected a plan for ${id}`);
  return res;
}

function mermaidBlock(md: string): string {
  const match = /^(`{3,})mermaid\n([\s\S]*?)\n\1$/m.exec(md);
  if (!match) throw new Error('no mermaid block');
  return match[2];
}

describe('planToMarkdown on the sample scenarios', () => {
  it.each(SCENARIOS.map((s) => s.id))('%s: has every section, in order, and the notices', async (id) => {
    const res = await samplePlan(id);
    const md = planToMarkdown({ plan: res.plan, mermaid: res.mermaid, requirements: SCENARIOS.find((s) => s.id === id)!.requirements, generatedAt: res.generatedAt, provider: res.provider, shareUrl: SHARE });
    expect(md.startsWith(`# ${mdText(res.plan.title)}\n`)).toBe(true);
    let last = -1;
    for (const heading of SECTIONS) {
      const at = md.indexOf(`\n${heading}\n`);
      expect(at, heading).toBeGreaterThan(last);
      last = at;
    }
    expect(md).toContain(`Generated ${res.generatedAt}`);
    expect(md).toContain('**Not production-ready.**');
    expect(md).not.toMatch(/\bis production-ready/i);
    expect(md).toContain(`<${SHARE}>`);
    // Every component, data-flow step, and implementation step appears.
    for (const node of res.plan.nodes) expect(md).toContain(`**${mdText(node.label)}**`);
    for (const step of res.plan.dataFlow) expect(md).toContain(mdText(step));
    for (const step of res.plan.implementationSteps) expect(md).toContain(mdText(step));
    for (const alt of res.plan.alternatives) expect(md).toContain(`### ${mdText(alt.title)}`);
  });

  it.each(SCENARIOS.map((s) => s.id))('%s: the Mermaid block equals the generated Mermaid', async (id) => {
    const res = await samplePlan(id);
    const md = planToMarkdown({ plan: res.plan, mermaid: res.mermaid, requirements: SCENARIOS.find((s) => s.id === id)!.requirements, generatedAt: res.generatedAt });
    expect(mermaidBlock(md)).toBe(res.mermaid);
    expect(mermaidBlock(md)).toBe(toMermaid(res.plan));
  });

  it.each(SCENARIOS.map((s) => s.id))('%s: every URL is a registry source (or the share link), and every cited source is listed', async (id) => {
    const res = await samplePlan(id);
    const md = planToMarkdown({ plan: res.plan, mermaid: res.mermaid, requirements: SCENARIOS.find((s) => s.id === id)!.requirements, generatedAt: res.generatedAt, shareUrl: SHARE });
    const urls = md.match(/https?:\/\/[^\s)<>]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url === SHARE || REGISTRY_URLS.has(url), url).toBe(true);

    const sourcesSection = md.slice(md.indexOf('\n## Sources\n'), md.indexOf('\n## Share link\n'));
    const listed = [...sourcesSection.matchAll(/^\d+\. \[[^\n]+\]\((https:\/\/[^)]+)\)$/gm)].map((m) => m[1]);
    const cited = citedSourceIds(res.plan).map((sid) => SOURCES.find((s) => s.id === sid)?.url).filter(Boolean);
    expect(new Set(listed)).toEqual(new Set(cited));
  });

  it.each(SCENARIOS.map((s) => s.id))('%s: contains no dollar figures', async (id) => {
    const res = await samplePlan(id);
    const md = planToMarkdown({ plan: res.plan, mermaid: res.mermaid, requirements: SCENARIOS.find((s) => s.id === id)!.requirements, generatedAt: res.generatedAt });
    expect(md).not.toMatch(/\$\s?\d/);
    expect(md).not.toMatch(/\b(USD|per month)\b.*\d/i);
  });
});

describe('planToMarkdown escaping', () => {
  const HOSTILE = '```\n# Injected heading\n<script>alert(1)</script> [click](javascript:alert(1)) | a | b |\n---\n> quote *bold* _em_ ~~x~~ $x$ &lt;';

  function hostileReport(): string {
    const raw = validRawPlan();
    raw.title = 'Plan # with ``` fence';
    raw.summary = HOSTILE;
    raw.nodes[1].role = HOSTILE;
    raw.dataFlow = [HOSTILE];
    raw.assumptions = [{ text: HOSTILE, field: 'description' }];
    raw.openQuestions = [HOSTILE];
    raw.considerations.security[0].text = HOSTILE;
    raw.alternatives[0].title = '# Alt ```';
    raw.alternatives[0].pros = [HOSTILE];
    raw.implementationSteps = [HOSTILE];
    raw.cautions = [{ topic: '## topic', message: HOSTILE, sourceIds: ['not-a-real-source'] }];
    raw.nodes[1].sourceIds = ['svc-apigateway', 'https://evil.example/fake'];
    const res = validatePlan(raw);
    if (!res.ok) throw new Error(JSON.stringify(res.issues));
    const requirements = RequirementsSchema.parse({ description: HOSTILE, existingSystems: HOSTILE, usageNotes: '<img src=x onerror=alert(1)>' });
    const input: ReportInput = { plan: res.plan, mermaid: toMermaid(res.plan), requirements, generatedAt: '2026-10-01T00:00:00.000Z', shareUrl: 'javascript:alert(1)' };
    return planToMarkdown(input);
  }

  it('keeps user and provider text from creating headings, fences, quotes, rules, or tables', () => {
    const md = hostileReport();
    const lines = md.split('\n');
    const headings = lines.filter((l) => /^#{1,6}\s/.test(l));
    expect(headings.every((h) => h.startsWith('# Plan') || SECTIONS.includes(h) || h.startsWith('### '))).toBe(true);
    expect(headings.filter((h) => /Injected/.test(h))).toHaveLength(0);
    expect(lines.filter((l) => /^\s*`{3,}/.test(l))).toHaveLength(2); // only the mermaid fence
    expect(lines.filter((l) => /^\s*(---|>|\|)/.test(l) && !l.startsWith('> **Not production-ready.**'))).toHaveLength(0);
  });

  it('escapes HTML, links, emphasis, and math so they render as text', () => {
    const md = hostileReport();
    expect(md).not.toMatch(/(?<!\\)<(script|img)/);
    expect(md).not.toMatch(/(?<!\\)\]\(javascript:/);
    expect(md).not.toContain('javascript:alert(1)>');
    expect(md).toContain('\\<script\\>');
    expect(md).toContain('\\*bold\\*');
    expect(md).toContain('\\$x\\$');
    expect(md).toContain('\\&lt;');
  });

  it('lists only registry sources and drops unknown or URL-shaped ids', () => {
    const md = hostileReport();
    expect(md).not.toContain('evil.example');
    expect(md).not.toContain('not-a-real-source');
    const urls = md.match(/https?:\/\/[^\s)<>]+/g) ?? [];
    for (const url of urls) expect(REGISTRY_URLS.has(url), url).toBe(true);
  });

  it('refuses a non-http share link', () => {
    const md = hostileReport();
    expect(md).toMatch(/## Share link\n\n_Not available\._/);
  });

  it('mdText flattens newlines and control characters', () => {
    expect(mdText('a\n\n# b\r\n c\u0000d')).toBe('a \\# b c d');
  });

  it('reportFileName is a safe slug', () => {
    expect(reportFileName('Customer portal: serverless / v2!')).toBe('customer-portal-serverless-v2-design.md');
    expect(reportFileName('###')).toBe('architecture-design.md');
  });
});
