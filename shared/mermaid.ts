import { serviceIconName } from './awsIcons';
import type { Plan, PlanNode } from './schema';

/**
 * Mermaid source is generated only from validated plan data. Labels are
 * reduced to a conservative character set so that nothing a provider returns
 * can inject Mermaid syntax, HTML, or directives into the diagram.
 */

const DISALLOWED = /[^\p{L}\p{N} .,:/()&+\-'?_]/gu;

export function sanitizeLabel(value: string, max = 60): string {
  const cleaned = value.replace(DISALLOWED, ' ').replace(/\s+/g, ' ').trim();
  const clipped = cleaned.length > max ? `${cleaned.slice(0, max - 3).trimEnd()}...` : cleaned;
  return clipped || 'Unnamed';
}

/** Prefix node ids so validated ids can never collide with Mermaid keywords such as "end". */
export const mermaidId = (id: string) => `n_${id}`;

export interface MermaidOptions {
  /**
   * Draw AWS nodes with their official icon (Mermaid icon shape, "aws:<catalog id>").
   * Needs the "aws" icon pack registered with Mermaid, so it is used for the
   * on-screen diagram only. The default (false) is portable Mermaid that renders
   * anywhere, and is what the API returns and the Markdown report embeds.
   */
  icons?: boolean;
}

/** Icon name for a node in icon mode, or undefined if it should be drawn as a plain shape. */
export function nodeIcon(node: PlanNode): string | undefined {
  return node.kind === 'aws' ? serviceIconName(node.serviceId) : undefined;
}

function shape(node: PlanNode, options: MermaidOptions): string {
  const label = `"${sanitizeLabel(node.label)}"`;
  const id = mermaidId(node.id);
  const icon = options.icons ? nodeIcon(node) : undefined;
  // Icon names are validated against /^[a-z0-9-]+$/ and labels are sanitized, so neither can leave its quotes.
  if (icon) return `${id}@{ icon: "${icon}", label: ${label}, pos: "b", h: 44 }`;
  if (node.kind === 'actor') return `${id}([${label}])`;
  if (node.kind === 'external') return `${id}[[${label}]]`;
  if (node.tier === 'data') return `${id}[(${label})]`;
  return `${id}[${label}]`;
}

/** Max cross-cutting nodes per column before starting a new column. */
const CROSS_CUTTING_COLUMN = 3;

/**
 * Layout: top-to-bottom flow of connected components (no tier subgraphs, which
 * force very wide layouts), plus one compact "Cross-cutting services" group for
 * components with no connections (IAM, KMS, monitoring, backup). Those are
 * stacked into short columns with invisible links so they do not widen the
 * diagram.
 */
export function toMermaid(plan: Pick<Plan, 'nodes' | 'connections'>, options: MermaidOptions = {}): string {
  const ids = new Set(plan.nodes.map((n) => n.id));
  const connections = plan.connections.filter((c) => ids.has(c.from) && ids.has(c.to)); // validation guarantees this; defensive only
  const linked = new Set(connections.flatMap((c) => [c.from, c.to]));
  const flowNodes = plan.nodes.filter((n) => linked.has(n.id));
  const crossCutting = plan.nodes.filter((n) => !linked.has(n.id));

  const lines: string[] = ['flowchart TB'];
  for (const node of flowNodes) lines.push(`  ${shape(node, options)}`);

  for (const conn of connections) {
    const label = conn.label ? sanitizeLabel(conn.label, 40) : '';
    const arrow = label ? `-->|"${label}"|` : '-->';
    lines.push(`  ${mermaidId(conn.from)} ${arrow} ${mermaidId(conn.to)}`);
  }

  if (crossCutting.length > 0) {
    lines.push('  subgraph cross_cutting["Cross-cutting services"]');
    for (const node of crossCutting) lines.push(`    ${shape(node, options)}`);
    for (let i = 0; i < crossCutting.length; i += CROSS_CUTTING_COLUMN) {
      const column = crossCutting.slice(i, i + CROSS_CUTTING_COLUMN).map((n) => mermaidId(n.id));
      if (column.length > 1) lines.push(`    ${column.join(' ~~~ ')}`);
    }
    lines.push('  end');
  }

  lines.push('  classDef aws fill:#ffffff,stroke:#ff9900,stroke-width:2px,color:#16191f');
  lines.push('  classDef external fill:#eef2f7,stroke:#5f6b7a,stroke-dasharray:4 3,color:#16191f');
  lines.push('  classDef actor fill:#232f3e,stroke:#232f3e,color:#ffffff');
  const hasIcon = (n: PlanNode) => Boolean(options.icons && nodeIcon(n));
  if (plan.nodes.some(hasIcon)) lines.push('  classDef awsicon color:#16191f');
  for (const cls of ['aws', 'awsicon', 'external', 'actor'] as const) {
    const members = plan.nodes
      .filter((n) => (cls === 'awsicon' ? hasIcon(n) : n.kind === cls && !hasIcon(n)))
      .map((n) => mermaidId(n.id));
    if (members.length) lines.push(`  class ${members.join(',')} ${cls}`);
  }

  return lines.join('\n');
}
