import { getService } from './catalog';
import { isKnownSource } from './sources';
import { PlanSchema, type Plan, type ValidationIssue } from './schema';

export type PlanValidationResult =
  | { ok: true; plan: Plan; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Validate untrusted structured architecture data (from any provider).
 *
 * Hard failures (plan rejected):
 *   - schema violations, duplicate node ids, connections that reference
 *     nodes that do not exist, self-loops, or an empty diagram.
 * Soft failures (plan kept, issue reported as a warning):
 *   - AWS components outside the supported catalog are removed from the
 *     diagram along with their connections, and a caution is added.
 *   - Citations to ids that are not in the curated source registry are
 *     stripped; a claim left with no sources is relabelled "assumption".
 */
export function validatePlan(raw: unknown): PlanValidationResult {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'schema',
        message: i.message,
        path: i.path.join('.'),
      })),
    };
  }

  const plan: Plan = structuredClone(parsed.data);
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Duplicate ids
  const seen = new Set<string>();
  for (const node of plan.nodes) {
    if (seen.has(node.id)) {
      issues.push({ code: 'duplicate_node', message: `Duplicate node id "${node.id}"`, path: `nodes.${node.id}` });
    }
    seen.add(node.id);
  }

  // Connections must reference declared nodes
  plan.connections.forEach((conn, i) => {
    for (const end of [conn.from, conn.to]) {
      if (!seen.has(end)) {
        issues.push({
          code: 'dangling_connection',
          message: `Connection ${conn.from} -> ${conn.to} references unknown node "${end}"`,
          path: `connections.${i}`,
        });
      }
    }
    if (conn.from === conn.to) {
      issues.push({ code: 'self_connection', message: `Connection loops back to "${conn.from}"`, path: `connections.${i}` });
    }
  });

  if (issues.length > 0) return { ok: false, issues };

  // Catalog check: remove (and flag) AWS components outside the catalog
  const removed = new Set<string>();
  for (const node of plan.nodes) {
    if (node.kind !== 'aws') continue;
    if (!node.serviceId) {
      removed.add(node.id);
      warnings.push({
        code: 'missing_service_id',
        message: `"${node.label}" is marked as an AWS component but names no catalog service; it was removed from the diagram.`,
        path: `nodes.${node.id}`,
      });
    } else if (!getService(node.serviceId)) {
      removed.add(node.id);
      warnings.push({
        code: 'unsupported_service',
        message: `"${node.label}" (${node.serviceId}) is not in the supported AWS component catalog; it was removed from the diagram and needs manual review.`,
        path: `nodes.${node.id}`,
      });
      plan.cautions.push({
        topic: 'Unsupported component',
        message: `The suggestion "${node.label}" is outside this assistant's supported catalog and was not included. Evaluate it separately against official AWS documentation.`,
        sourceIds: [],
      });
    }
  }
  if (removed.size > 0) {
    plan.nodes = plan.nodes.filter((n) => !removed.has(n.id));
    plan.connections = plan.connections.filter((c) => !removed.has(c.from) && !removed.has(c.to));
  }
  if (plan.nodes.length === 0) {
    return { ok: false, issues: [...warnings, { code: 'empty_diagram', message: 'No valid components remain after validation.' }] };
  }

  // Citation check: only ids from the curated registry survive
  const strip = (ids: string[], path: string): string[] =>
    ids.filter((id) => {
      if (isKnownSource(id)) return true;
      warnings.push({ code: 'unknown_source', message: `Removed citation "${id}" because it is not in the curated source registry.`, path });
      return false;
    });

  plan.nodes.forEach((n) => (n.sourceIds = strip(n.sourceIds, `nodes.${n.id}`)));
  plan.alternatives.forEach((a, i) => (a.sourceIds = strip(a.sourceIds, `alternatives.${i}`)));
  plan.cautions.forEach((c, i) => (c.sourceIds = strip(c.sourceIds, `cautions.${i}`)));
  for (const [pillar, claims] of Object.entries(plan.considerations)) {
    claims.forEach((claim, i) => {
      claim.sourceIds = strip(claim.sourceIds, `considerations.${pillar}.${i}`);
      if (claim.basis === 'source' && claim.sourceIds.length === 0) claim.basis = 'assumption';
    });
  }

  return { ok: true, plan, warnings };
}

/** Every source id cited anywhere in a plan (after validation). */
export function citedSourceIds(plan: Plan): string[] {
  const ids = new Set<string>();
  plan.nodes.forEach((n) => n.sourceIds.forEach((id) => ids.add(id)));
  plan.alternatives.forEach((a) => a.sourceIds.forEach((id) => ids.add(id)));
  plan.cautions.forEach((c) => c.sourceIds.forEach((id) => ids.add(id)));
  Object.values(plan.considerations).forEach((claims) => claims.forEach((c) => c.sourceIds.forEach((id) => ids.add(id))));
  return [...ids];
}
