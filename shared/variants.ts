import { getService } from './catalog';
import { toMermaid } from './mermaid';
import { SELECT_OPTIONS } from './options';
import type { AlternativeSpec, ArchitectureProvider, RequirementChangeInput } from './provider';
import { FIELD_META, computeCompleteness } from './requirements';
import {
  RequirementsSchema,
  type AlternativeVariant,
  type ComponentRef,
  type Plan,
  type PlanAlternative,
  type PlanNode,
  type RequirementChange,
  type RequirementField,
  type Requirements,
} from './schema';
import { resolveUnsure } from './unsure';
import { validatePlan } from './validate';

/**
 * Alternatives as real designs. For each alternative the provider can express
 * as requirement changes, the pipeline applies the changes, runs the same
 * planner, validates the result like any plan, and generates its Mermaid. The
 * "what changes" lists are computed by comparing the two validated plans.
 * Anything that cannot be expressed or fails a check stays text-only, with the
 * reason, rather than being drawn from guesswork.
 */

const textOnly = (reason: string): AlternativeVariant => ({ kind: 'text_only', reason });

/** "Who runs it: We already use containers (Docker etc.)", or for free text the provider's summary of the edit. */
export function describeChange(change: RequirementChangeInput): string {
  const meta = FIELD_META[change.field];
  const option = SELECT_OPTIONS[change.field]?.find((o) => o.value === change.value);
  return `${meta.short}: ${option ? option.label : change.summary ?? `"${change.value}"`}`;
}

/** The requirements with an alternative's changes applied. Used by "Use this alternative" and to plan the variant. */
export function applyChanges(req: Requirements, changes: readonly { field: RequirementField; value: string }[]): Requirements {
  const next: Record<string, string> = { ...req };
  for (const c of changes) next[c.field] = c.value;
  return next as Requirements;
}

const ref = (n: PlanNode): ComponentRef => {
  const service = n.serviceId ? getService(n.serviceId)?.name : undefined;
  return { id: n.id, label: n.label, kind: n.kind, ...(service ? { service } : {}) };
};

/** A component is the same in both plans when its id, kind, and service match (labels and roles may be reworded). */
const key = (n: PlanNode) => `${n.id}|${n.kind}|${n.serviceId ?? ''}`;

export function diffComponents(base: Pick<Plan, 'nodes'>, variant: Pick<Plan, 'nodes'>): { added: ComponentRef[]; removed: ComponentRef[] } {
  const before = new Set(base.nodes.map(key));
  const after = new Set(variant.nodes.map(key));
  return {
    added: variant.nodes.filter((n) => !before.has(key(n))).map(ref),
    removed: base.nodes.filter((n) => !after.has(key(n))).map(ref),
  };
}

async function variantFor(
  req: Requirements,
  base: Plan,
  spec: AlternativeSpec | undefined,
  provider: ArchitectureProvider,
): Promise<AlternativeVariant> {
  if (!spec) return textOnly('The planner did not say how to draw this alternative, so it is described in text only.');
  if ('reason' in spec) return textOnly(spec.reason);

  const fields = spec.changes.map((c) => c.field);
  if (fields.length === 0 || new Set(fields).size !== fields.length || !fields.every((f) => Object.hasOwn(RequirementsSchema.shape, f))) {
    return textOnly('The change it needs is not a valid set of answers, so it is described in text only.');
  }
  const parsed = RequirementsSchema.safeParse(applyChanges(req, spec.changes));
  if (!parsed.success) return textOnly('The change it needs is not a valid answer, so it is described in text only.');
  const next = parsed.data;
  if (computeCompleteness(next).missing.length > 0 || (provider.preflight?.(next) ?? []).length > 0) {
    return textOnly('Applying it would leave the requirements incomplete, so it is described in text only.');
  }

  let raw: unknown;
  try {
    raw = await provider.generatePlan(resolveUnsure(next));
  } catch {
    return textOnly('The planner could not produce this alternative, so it is described in text only.');
  }
  const result = validatePlan(raw);
  if (!result.ok || result.warnings.length > 0) {
    return textOnly('The alternative design did not pass validation cleanly, so it is not drawn.');
  }
  const { added, removed } = diffComponents(base, result.plan);
  if (added.length === 0 && removed.length === 0) return textOnly('Applying it would not change the components in the diagram, so there is nothing new to draw.');

  const changes: RequirementChange[] = spec.changes.map((c) => ({ field: c.field, value: c.value, label: describeChange(c) }));
  const { nodes, connections } = result.plan;
  return { kind: 'diagram', changes, nodes, connections, mermaid: toMermaid({ nodes, connections }), added, removed };
}

/**
 * Attaches a variant to every alternative of a validated plan. Only providers
 * that declare `alternativeSpecs` (deterministic ones) are re-run; for others
 * every alternative is text-only, so a model-backed provider is never called again.
 */
export async function withVariants(req: Requirements, plan: Plan, provider: ArchitectureProvider): Promise<PlanAlternative[]> {
  if (!provider.alternativeSpecs) {
    const reason = `Only the built-in demo planner draws alternatives; this plan came from the "${provider.name}" planner, so alternatives are described in text only.`;
    return plan.alternatives.map((alt) => ({ ...alt, variant: textOnly(reason) }));
  }
  let specs: Record<string, AlternativeSpec>;
  try {
    specs = provider.alternativeSpecs(resolveUnsure(req));
  } catch {
    specs = {};
  }
  const out: PlanAlternative[] = [];
  for (const alt of plan.alternatives) {
    const spec = Object.hasOwn(specs, alt.title) ? specs[alt.title] : undefined;
    out.push({ ...alt, variant: await variantFor(req, plan, spec, provider) });
  }
  return out;
}
