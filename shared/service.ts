import { detectCautions, mergeCautions } from './guardrails';
import { toMermaid } from './mermaid';
import type { ArchitectureProvider } from './provider';
import { computeCompleteness, followUpQuestions } from './requirements';
import { RequirementsSchema, type FollowUpQuestion, type PlanResponse, type Requirements, type ValidationIssue } from './schema';
import { resolveUnsure, unsureAssumptions } from './unsure';
import { validatePlan } from './validate';
import { withVariants } from './variants';

/**
 * The follow-up questions the pipeline asks before planning: missing required
 * answers first, then (only once those are answered) the provider's own preflight.
 * An empty list means the requirements are complete enough to plan.
 */
export function questionsFor(req: Requirements, provider: ArchitectureProvider): FollowUpQuestion[] {
  const completeness = computeCompleteness(req);
  return [...followUpQuestions(req), ...(completeness.missing.length === 0 ? (provider.preflight?.(req) ?? []) : [])];
}

/**
 * The single path from requirements to a response, shared by every provider:
 * completeness gate -> guardrail cautions -> "Not sure" defaults -> provider -> validation -> Mermaid,
 * then each alternative the provider can express is re-planned and validated the same way (shared/variants.ts).
 * Providers only ever see resolved requirements; each default becomes a plan assumption.
 */
export async function planFromRequirements(req: Requirements, provider: ArchitectureProvider): Promise<PlanResponse> {
  const completeness = computeCompleteness(req);
  const cautions = detectCautions(req);

  const questions = questionsFor(req, provider);
  if (questions.length > 0) {
    return { kind: 'questions', provider: provider.name, completeness, questions, cautions };
  }

  let raw: unknown;
  try {
    raw = await provider.generatePlan(resolveUnsure(req));
  } catch (err) {
    return {
      kind: 'error',
      provider: provider.name,
      message: `The ${provider.name} provider failed to produce a plan: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
    };
  }

  const result = validatePlan(raw);
  if (!result.ok) {
    return {
      kind: 'error',
      provider: provider.name,
      message: 'The provider returned architecture data that failed validation, so no plan or diagram was produced.',
      issues: result.issues,
    };
  }

  const plan = {
    ...result.plan,
    assumptions: [...unsureAssumptions(req), ...result.plan.assumptions],
    alternatives: await withVariants(req, result.plan, provider),
    cautions: mergeCautions(cautions, result.plan.cautions),
  };
  return {
    kind: 'plan',
    provider: provider.name,
    completeness,
    plan,
    mermaid: toMermaid(plan),
    warnings: result.warnings,
    generatedAt: new Date().toISOString(),
  };
}

/** Schema-checks untrusted requirements; issues use the same shape as the API's 400 response. */
export function parseRequirementsInput(
  input: unknown,
): { ok: true; requirements: Requirements } | { ok: false; issues: ValidationIssue[] } {
  const parsed = RequirementsSchema.safeParse(input);
  if (parsed.success) return { ok: true, requirements: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ code: 'schema', message: i.message, path: i.path.join('.') })) };
}

/**
 * Entry point for untrusted input (an HTTP body or browser form state):
 * schema-check the requirements, then run the shared pipeline. Used by both
 * the Express route and the in-browser demo planner so the two stay identical.
 * `status` mirrors the HTTP status the API returns for the same input.
 */
export async function planFromInput(
  input: unknown,
  provider: ArchitectureProvider,
): Promise<{ status: number; body: PlanResponse }> {
  const parsed = parseRequirementsInput(input);
  if (!parsed.ok) {
    return {
      status: 400,
      body: { kind: 'error', provider: provider.name, message: 'Requirements failed validation.', issues: parsed.issues },
    };
  }
  const body = await planFromRequirements(parsed.requirements, provider);
  return { status: body.kind === 'error' ? 422 : 200, body };
}
