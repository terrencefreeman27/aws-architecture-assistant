import { TIERS, type Plan, type PlanNode } from './schema';

/**
 * Mermaid source is generated only from validated plan data. Labels are
 * reduced to a conservative character set so that nothing a provider returns
 * can inject Mermaid syntax, HTML, or directives into the diagram.
 */

const DISALLOWED = /[^\p{L}\p{N} .,:/()&+\-'?_]/gu;

export function sanitizeLabel(value: string, max = 60): string {
  const cleaned = value.replace(DISALLOWED, ' ').replace(/\s+/g, ' ').trim();
  const clipped = cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}...` : cleaned;
  return clipped || 'Unnamed';
}

const TIER_TITLES: Record<(typeof TIERS)[number], string> = {
  users: 'Users',
  edge: 'Edge and delivery',
  app: 'Application',
  integration: 'Integration',
  ai: 'AI services',
  data: 'Data',
  security: 'Security and identity',
  operations: 'Operations',
  external: 'Existing systems',
};

/** Prefix node ids so validated ids can never collide with Mermaid keywords such as "end". */
export const mermaidId = (id: string) => `n_${id}`;

function shape(node: PlanNode): string {
  const label = `"${sanitizeLabel(node.label)}"`;
  const id = mermaidId(node.id);
  if (node.kind === 'actor') return `${id}([${label}])`;
  if (node.kind === 'external') return `${id}[[${label}]]`;
  if (node.tier === 'data') return `${id}[(${label})]`;
  return `${id}[${label}]`;
}

export function toMermaid(plan: Pick<Plan, 'nodes' | 'connections'>): string {
  const lines: string[] = ['flowchart LR'];

  for (const tier of TIERS) {
    const members = plan.nodes.filter((n) => n.tier === tier);
    if (members.length === 0) continue;
    lines.push(`  subgraph tier_${tier}["${TIER_TITLES[tier]}"]`);
    lines.push('    direction TB');
    for (const node of members) lines.push(`    ${shape(node)}`);
    lines.push('  end');
  }

  const ids = new Set(plan.nodes.map((n) => n.id));
  for (const conn of plan.connections) {
    if (!ids.has(conn.from) || !ids.has(conn.to)) continue; // validation guarantees this; defensive only
    const label = conn.label ? sanitizeLabel(conn.label, 40) : '';
    const arrow = label ? `-->|"${label}"|` : '-->';
    lines.push(`  ${mermaidId(conn.from)} ${arrow} ${mermaidId(conn.to)}`);
  }

  lines.push('  classDef aws fill:#ffffff,stroke:#ff9900,stroke-width:2px,color:#16191f');
  lines.push('  classDef external fill:#eef2f7,stroke:#5f6b7a,stroke-dasharray:4 3,color:#16191f');
  lines.push('  classDef actor fill:#232f3e,stroke:#232f3e,color:#ffffff');
  for (const kind of ['aws', 'external', 'actor'] as const) {
    const members = plan.nodes.filter((n) => n.kind === kind).map((n) => mermaidId(n.id));
    if (members.length) lines.push(`  class ${members.join(',')} ${kind}`);
  }

  return lines.join('\n');
}
