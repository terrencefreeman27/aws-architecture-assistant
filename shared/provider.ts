import type { FollowUpQuestion, Requirements } from './schema';

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
}
