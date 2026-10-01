import { getService } from './catalog';
import { SELECT_OPTIONS, TIER_LABELS } from './options';
import { FIELD_META } from './requirements';
import { PILLARS, type Plan, type RequirementField, type Requirements } from './schema';
import { getSource, type Source } from './sources';

/**
 * Turns a validated plan into a self-contained Markdown design document.
 *
 * - All text that came from the user or a provider goes through `mdText`, which
 *   flattens it to one line and backslash-escapes Markdown/HTML syntax, so it
 *   cannot open headings, fences, tables, links, or HTML in the document.
 * - The diagram is the generated Mermaid source, passed in verbatim.
 * - Sources are resolved through the curated registry only; unknown ids are dropped.
 */

export interface ReportInput {
  plan: Plan;
  /** Mermaid source generated from the validated plan (PlanResponse.mermaid). */
  mermaid: string;
  /** The requirements the plan was generated from. */
  requirements: Requirements;
  /** ISO timestamp of plan generation. */
  generatedAt: string;
  provider?: string;
  /** Share link from the app (URL fragment form). Omitted when unavailable. */
  shareUrl?: string;
}

export const REPORT_NOTICE =
  'This document is a reviewable starting point generated from the stated requirements. It is not production-ready, does not establish compliance, and contains no cost figures. Validate it with your team and a Well-Architected review before building.';

const PILLAR_TITLES: Record<string, string> = {
  security: 'Security',
  reliability: 'Reliability',
  performance: 'Performance efficiency',
  operations: 'Operational excellence',
  cost: 'Cost (drivers, not estimates)',
};

const REQUIREMENT_ORDER: RequirementField[] = [
  'description',
  'workloadType',
  'existingSystems',
  'expectedUsage',
  'usageNotes',
  'dataSensitivity',
  'region',
  'availability',
  'recoveryNotes',
  'budget',
  'operations',
  'operationsNotes',
];

/**
 * Escapes untrusted text for use inline in Markdown. Newlines are collapsed so
 * the text can never start a new block (heading, list, fence, table, quote);
 * the remaining inline syntax (emphasis, code, links, HTML, tables, math,
 * entities) is backslash-escaped.
 */
export function mdText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_[\]<>#|~&$]/g, (ch) => `\\${ch}`);
}

/** Only https URLs from the registry are ever written, and they are encoded defensively. */
const safeUrl = (url: string) => encodeURI(decodeURI(url)).replace(/[()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

function fence(source: string): string {
  const longest = Math.max(2, ...(source.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}mermaid\n${source.trim()}\n${ticks}`;
}

function requirementValue(field: RequirementField, value: string): string {
  if (!value) return '_Not answered_';
  const option = SELECT_OPTIONS[field]?.find((o) => o.value === value);
  return mdText(option ? option.label : value);
}

export function planToMarkdown(input: ReportInput): string {
  const { plan, requirements } = input;

  // Number every cited registry source in order of first appearance.
  const sources: Source[] = [];
  const indexOf = new Map<string, number>();
  const cite = (ids: string[]): string => {
    const nums: number[] = [];
    for (const id of ids) {
      const src = getSource(id);
      if (!src) continue;
      if (!indexOf.has(id)) {
        sources.push(src);
        indexOf.set(id, sources.length);
      }
      const n = indexOf.get(id)!;
      if (!nums.includes(n)) nums.push(n);
    }
    return nums.length ? ` (sources: ${nums.map((n) => `[${n}]`).join(', ')})` : '';
  };

  const out: string[] = [];
  const blank = () => out.push('');

  out.push(`# ${mdText(plan.title)}`);
  blank();
  out.push(`Generated ${mdText(input.generatedAt)} by the AWS Architecture Design Assistant${input.provider ? ` (planner: ${mdText(input.provider)})` : ''}.`);
  blank();
  out.push(`> **Not production-ready.** ${REPORT_NOTICE}`);
  blank();

  out.push('## Summary');
  blank();
  out.push(mdText(plan.summary));
  blank();

  out.push('## Requirements as entered');
  blank();
  for (const field of REQUIREMENT_ORDER) {
    const meta = FIELD_META[field];
    out.push(`- **${meta.label}${meta.term ? ` (${meta.term})` : ''}** ${requirementValue(field, requirements[field])}`);
  }
  blank();

  out.push('## Architecture diagram');
  blank();
  out.push('Generated from the validated components and connections below.');
  blank();
  out.push(fence(input.mermaid));
  blank();

  out.push('## Components');
  blank();
  for (const node of plan.nodes) {
    const svc = node.serviceId ? getService(node.serviceId) : undefined;
    const kind = node.kind === 'aws' ? TIER_LABELS[node.tier] ?? node.tier : node.kind === 'actor' ? 'People' : 'Existing system';
    const service = svc && svc.name !== node.label ? `, ${mdText(svc.name)}` : '';
    out.push(`- **${mdText(node.label)}** (${mdText(kind)}${service}): ${mdText(node.role)}${cite(node.sourceIds)}`);
  }
  blank();

  out.push('## Data flow');
  blank();
  plan.dataFlow.forEach((step, i) => out.push(`${i + 1}. ${mdText(step)}`));
  blank();

  out.push('## Assumptions');
  blank();
  if (plan.assumptions.length === 0) out.push('_None recorded._');
  for (const a of plan.assumptions) {
    const field = a.field && a.field in FIELD_META ? ` _Change this in: ${FIELD_META[a.field as RequirementField].short}._` : '';
    out.push(`- ${mdText(a.text)}${field}`);
  }
  blank();

  out.push('## Open questions');
  blank();
  if (plan.openQuestions.length === 0) out.push('_None recorded._');
  for (const q of plan.openQuestions) out.push(`- ${mdText(q)}`);
  blank();

  out.push('## Considerations by pillar');
  blank();
  for (const pillar of PILLARS) {
    out.push(`### ${PILLAR_TITLES[pillar]}`);
    blank();
    for (const claim of plan.considerations[pillar]) {
      out.push(`- ${claim.basis === 'assumption' ? '**Assumption:** ' : ''}${mdText(claim.text)}${cite(claim.sourceIds)}`);
    }
    blank();
  }

  out.push('## Alternatives and tradeoffs');
  blank();
  for (const alt of plan.alternatives) {
    out.push(`### ${mdText(alt.title)}`);
    blank();
    out.push(`${mdText(alt.summary)}${cite(alt.sourceIds)}`);
    blank();
    out.push('Gains:');
    blank();
    for (const p of alt.pros) out.push(`- ${mdText(p)}`);
    blank();
    out.push('Costs:');
    blank();
    for (const c of alt.cons) out.push(`- ${mdText(c)}`);
    blank();
  }

  out.push('## Implementation sequence');
  blank();
  plan.implementationSteps.forEach((step, i) => out.push(`${i + 1}. ${mdText(step)}`));
  blank();
  out.push('This assistant never creates AWS resources. These steps are for your team to plan and review.');
  blank();

  out.push('## Cautions');
  blank();
  if (plan.cautions.length === 0) out.push('_None flagged._');
  for (const c of plan.cautions) out.push(`- **${mdText(c.topic)}:** ${mdText(c.message)}${cite(c.sourceIds)}`);
  blank();

  out.push('## Sources');
  blank();
  if (sources.length === 0) out.push('_No sources cited._');
  sources.forEach((src, i) => out.push(`${i + 1}. [${mdText(src.title)}](${safeUrl(src.url)})`));
  blank();

  out.push('## Share link');
  blank();
  if (input.shareUrl && /^https?:\/\/[^\s<>]+$/.test(input.shareUrl)) {
    out.push(`<${input.shareUrl}>`);
    blank();
    out.push('Opening the link loads these requirements and regenerates the plan. The requirements live after the "#" in the link, which browsers never send to a server.');
  } else {
    out.push('_Not available._');
  }
  blank();

  return out.join('\n');
}

/** File name for the downloaded report, derived from the plan title. */
export function reportFileName(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'architecture'}-design.md`;
}
