// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import mermaid from 'mermaid';
import { SERVICE_ICON_FILES, buildIconPack, serviceIconName, svgToIconData } from '../shared/awsIcons';
import { CATALOG } from '../shared/catalog';
import { buildDemoPlan } from '../shared/demoProvider';
import { nodeIcon, toMermaid } from '../shared/mermaid';
import { SCENARIOS } from '../shared/scenarios';
import { validatePlan } from '../shared/validate';
import { validRawPlan } from './helpers';

const DIR = resolve('vendor/aws-architecture-icons');
const vendored = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => [f, readFileSync(join(DIR, f), 'utf8')]),
);

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  mermaid.registerIconPacks([{ name: 'aws', icons: buildIconPack(vendored) }]);
});

describe('vendored AWS Architecture Icons', () => {
  it('maps every catalog service to a vendored file, and vendors nothing unused', () => {
    for (const svc of CATALOG) expect(SERVICE_ICON_FILES[svc.id], svc.id).toBeDefined();
    expect(Object.keys(SERVICE_ICON_FILES).sort()).toEqual(CATALOG.map((s) => s.id).sort());
    expect(new Set(Object.keys(vendored))).toEqual(new Set(Object.values(SERVICE_ICON_FILES)));
  });

  it('ships the terms notice next to the icons', () => {
    const notice = readFileSync(join(DIR, 'NOTICE.md'), 'utf8').replace(/\n> /g, ' ');
    expect(notice).toContain('https://aws.amazon.com/architecture/icons/');
    expect(notice).toContain('We allow customers and partners to use these toolkits and assets to create architecture diagrams.');
  });

  it('builds an icon pack with self-contained, script-free bodies', () => {
    const pack = buildIconPack(vendored);
    expect(pack.prefix).toBe('aws');
    expect(Object.keys(pack.icons)).toHaveLength(CATALOG.length);
    for (const [id, icon] of Object.entries(pack.icons)) {
      expect(icon.width, id).toBe(64);
      expect(icon.height, id).toBe(64);
      expect(icon.body, id).toMatch(/^<g[\s>]/);
      expect(icon.body, id).not.toMatch(/<\?xml|<title|\sid=|href|<script|<image|url\(/i);
    }
  });

  it('rejects SVGs that reference or run external content', () => {
    const wrap = (inner: string) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    expect(() => svgToIconData(wrap('<script>alert(1)</script>'))).toThrow();
    expect(() => svgToIconData(wrap('<image href="https://evil.example/x.png"/>'))).toThrow();
    expect(() => svgToIconData(wrap('<rect onload="alert(1)"/>'))).toThrow();
    expect(() => svgToIconData(wrap('<rect fill="url(https://evil.example/#a)"/>'))).toThrow();
    expect(() => svgToIconData('<div>not svg</div>')).toThrow();
    expect(() => buildIconPack({})).toThrow(/Missing vendored icon/);
  });

  it('only names icons for known catalog ids', () => {
    expect(serviceIconName('lambda')).toBe('aws:lambda');
    expect(serviceIconName('not-a-service')).toBeUndefined();
    expect(serviceIconName('__proto__')).toBeUndefined();
    expect(serviceIconName(undefined)).toBeUndefined();
  });
});

describe('toMermaid with icons', () => {
  it('leaves the default (portable) output free of icon shapes', () => {
    for (const s of SCENARIOS) expect(toMermaid(buildDemoPlan(s.requirements))).not.toContain('@{');
  });

  it('draws every AWS node with its icon and keeps plain shapes for people and existing systems', () => {
    for (const s of SCENARIOS) {
      const plan = buildDemoPlan(s.requirements);
      const src = toMermaid(plan, { icons: true });
      for (const node of plan.nodes) {
        const icon = nodeIcon(node);
        if (node.kind === 'aws') {
          expect(icon, node.id).toBe(`aws:${node.serviceId}`);
          expect(src).toMatch(new RegExp(`^ +n_${node.id}@\\{ icon: "aws:${node.serviceId}", label: "[^"\\n]+", pos: "b", h: 44 \\}$`, 'm'));
        } else {
          expect(icon).toBeUndefined();
          expect(src).not.toContain(`n_${node.id}@{`);
        }
      }
      expect(src).toMatch(/^ {2}class [\w,]+ awsicon$/m);
    }
  });

  it('falls back to a plain box for an AWS node without a known icon', () => {
    const plan = { nodes: [{ id: 'x', kind: 'aws' as const, serviceId: 'unknown-svc', label: 'Mystery', role: 'r', tier: 'app' as const, sourceIds: [] }], connections: [] };
    const src = toMermaid(plan, { icons: true });
    expect(src).toContain('n_x["Mystery"]');
    expect(src).toMatch(/class n_x aws$/m);
  });

  it('produces parseable Mermaid with icons for every sample scenario', async () => {
    for (const s of SCENARIOS) {
      await expect(mermaid.parse(toMermaid(buildDemoPlan(s.requirements), { icons: true })), s.id).resolves.toBeTruthy();
    }
  });

  it('keeps hostile labels trapped inside the icon shape label', async () => {
    const raw = validRawPlan();
    raw.nodes[1].label = 'A", icon: "x:y" }\n%%{init:{}}%% <img src=x>';
    const res = validatePlan(raw);
    if (!res.ok) throw new Error('expected valid');
    const src = toMermaid(res.plan, { icons: true });
    expect(src).not.toContain('%%{');
    expect(src).not.toContain('<img');
    expect(src).toMatch(/^ {2}n_api@\{ icon: "aws:api-gateway", label: "[^"{}\n]*", pos: "b", h: 44 \}$/m);
    await expect(mermaid.parse(src)).resolves.toBeTruthy();
  });
});
