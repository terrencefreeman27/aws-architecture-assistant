import { detectCautions, mergeCautions } from './guardrails';
import { toMermaid } from './mermaid';
import type { ArchitectureProvider } from './provider';
import { computeCompleteness, followUpQuestions } from './requirements';
import type { PlanResponse, Requirements } from './schema';
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
