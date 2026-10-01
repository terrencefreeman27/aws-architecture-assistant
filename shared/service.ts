import { detectCautions, mergeCautions } from './guardrails';
import { toMermaid } from './mermaid';
import type { ArchitectureProvider } from './provider';
import { computeCompleteness, followUpQuestions } from './requirements';
import { RequirementsSchema, type PlanResponse, type Requirements } from './schema';
import { validatePlan } from './validate';

/**
 * The single path from requirements to a response, shared by every provider:
 * completeness gate -> guardrail cautions -> provider -> validation -> Mermaid.
 */
export async function planFromRequirements(req: Requirements, provider: ArchitectureProvider): Promise<PlanResponse> {
  const completeness = computeCompleteness(req);
  const cautions = detectCautions(req);

  const questions = [...followUpQuestions(req), ...(completeness.missing.length === 0 ? (provider.preflight?.(req) ?? []) : [])];
  if (questions.length > 0) {
    return { kind: 'questions', provider: provider.name, completeness, questions, cautions };
  }

  let raw: unknown;
  try {
    raw = await provider.generatePlan(req);
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

  const plan = { ...result.plan, cautions: mergeCautions(cautions, result.plan.cautions) };
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
  const parsed = RequirementsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        kind: 'error',
        provider: provider.name,
        message: 'Requirements failed validation.',
        issues: parsed.error.issues.map((i) => ({ code: 'schema', message: i.message, path: i.path.join('.') })),
      },
    };
  }
  const body = await planFromRequirements(parsed.data, provider);
  return { status: body.kind === 'error' ? 422 : 200, body };
}
