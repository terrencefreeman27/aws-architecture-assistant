import type { FollowUpQuestion, RequirementField, Requirements } from './schema';

/** One requirement answer an alternative would change. `summary` describes free-text edits in a few words. */
export interface RequirementChangeInput {
  field: RequirementField;
  value: string;
  summary?: string;
}

/**
 * How an alternative can be drawn: the requirement changes that make the same
 * planner produce it, or the reason it stays text-only.
 */
export type AlternativeSpec = { changes: RequirementChangeInput[] } | { reason: string };

/**
 * Model provider boundary. A provider turns complete requirements into
 * *untrusted* structured plan data. Callers must run the result through
 * `validatePlan` before using it; providers never produce diagram code.
 */
export interface ArchitectureProvider {
  /** Short identifier shown in the UI, e.g. "demo" or "anthropic". */
  readonly name: string;
  /** Optional provider-specific follow-up questions asked before planning. */
  preflight?(req: Requirements): FollowUpQuestion[];
  /** Return raw structured plan data (validated by the caller). */
  generatePlan(req: Requirements): Promise<unknown>;
  /**
   * Deterministic providers only: for each alternative title in the plan, the
   * requirement changes that make this provider produce that alternative, or
   * why it cannot. The pipeline re-plans with each change and validates the
   * result before drawing it. Providers without it get text-only alternatives.
   */
  alternativeSpecs?(req: Requirements): Record<string, AlternativeSpec>;
}
