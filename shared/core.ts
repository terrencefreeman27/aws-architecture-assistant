import { z } from 'zod';
import { CATALOG, type CatalogService } from './catalog';
import { detectCautions } from './guardrails';
import { DemoProvider } from './demoProvider';
import { SELECT_OPTIONS, unsureDefaultLabel } from './options';
import { REQUIREMENT_ORDER, planToMarkdown, reportFileName } from './report';
import { FIELD_META, MIN_DESCRIPTION_LENGTH, computeCompleteness, requiredFields } from './requirements';
import { SCENARIOS, getScenario, type Scenario } from './scenarios';
import {
  EMPTY_REQUIREMENTS,
  RequirementsSchema,
  type Caution,
  type Completeness,
  type FollowUpQuestion,
  type PlanResponse,
  type RequirementField,
} from './schema';
import { buildShareUrl } from './share';
import { parseRequirementsInput, planFromInput, questionsFor } from './service';
import { SOURCES, getSource, type Source } from './sources';
import { UNSURE, UNSURE_DEFAULTS, isUnsureField } from './unsure';

/**
 * Small programmatic API over the shared pipeline, used by the CLI and the MCP
 * server. Every function delegates to the same code the website runs
 * (`planFromInput` with the deterministic DemoProvider, `planToMarkdown`, the
 * catalog, and the source registry), so the same input gives the same result.
 * No network, no model calls, no credentials, no environment variables.
 */

/** The public static demo. Report share links point here so they open the same plan in a browser. */
export const PUBLIC_DEMO_URL = 'https://aws-architecture-assistant.vercel.app/';

const provider = new DemoProvider();

type ErrorResponse = Extract<PlanResponse, { kind: 'error' }>;

/** Keys in the input object that the requirements schema does not know (they are ignored, as on the website). */
export function unknownRequirementKeys(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const known = new Set(Object.keys(RequirementsSchema.shape));
  return Object.keys(input).filter((k) => !known.has(k));
}

/** Plan from untrusted requirements: exactly the website's in-browser planner. */
export async function planArchitecture(input: unknown): Promise<PlanResponse> {
  return (await planFromInput(input, provider)).body;
}

export type QuestionsResult =
  | { kind: 'questions' | 'complete'; completeness: Completeness; questions: FollowUpQuestion[]; cautions: Caution[] }
  | ErrorResponse;

/** Follow-up questions the planner would ask, without generating a plan. `complete` means it is ready to plan. */
export function missingQuestions(input: unknown): QuestionsResult {
  const parsed = parseRequirementsInput(input);
  if (!parsed.ok) return { kind: 'error', provider: provider.name, message: 'Requirements failed validation.', issues: parsed.issues };
  const req = parsed.requirements;
  const questions = questionsFor(req, provider);
  return { kind: questions.length ? 'questions' : 'complete', completeness: computeCompleteness(req), questions, cautions: detectCautions(req) };
}

export interface ReportOptions {
  /** Base URL for the share link in the report; `null` omits it. Defaults to the public demo. */
  shareBase?: string | null;
}

export type ReportResult =
  | { kind: 'report'; markdown: string; fileName: string; response: Extract<PlanResponse, { kind: 'plan' }> }
  | Exclude<PlanResponse, { kind: 'plan' }>;

/** The Markdown design document the website's "Download report" produces for the same requirements. */
export async function exportReport(input: unknown, options: ReportOptions = {}): Promise<ReportResult> {
  const response = await planArchitecture(input);
  if (response.kind !== 'plan') return response;
  const requirements = RequirementsSchema.parse(input);
  const base = options.shareBase === undefined ? PUBLIC_DEMO_URL : options.shareBase;
  const shareUrl = base ? await buildShareUrl(base, requirements) : undefined;
  const markdown = planToMarkdown({
    plan: response.plan,
    mermaid: response.mermaid,
    requirements,
    generatedAt: response.generatedAt,
    provider: response.provider,
    shareUrl,
  });
  return { kind: 'report', markdown, fileName: reportFileName(response.plan.title), response };
}

export function listSupportedServices(): readonly CatalogService[] {
  return CATALOG;
}

/** Registry entries, optionally filtered by id. Unknown ids are reported, never invented. */
export function getSources(ids?: readonly string[]): { sources: Source[]; unknownIds: string[] } {
  if (!ids || ids.length === 0) return { sources: [...SOURCES], unknownIds: [] };
  const unique = [...new Set(ids)];
  return {
    sources: unique.map(getSource).filter((s): s is Source => Boolean(s)),
    unknownIds: unique.filter((id) => !getSource(id)),
  };
}

export interface RequirementFieldInfo {
  name: RequirementField;
  label: string;
  short: string;
  term?: string;
  question: string;
  why: string;
  required: 'always' | 'when workloadType is "integration"' | 'no';
  type: 'text' | 'choice';
  maxLength?: number;
  minLength?: number;
  options?: { value: string; label: string }[];
  notSure?: { value: typeof UNSURE; defaultValue: string; defaultLabel: string; assumption: string };
}

/** Field list for callers that need to ask the user for requirements. */
export function getRequirementsSchema() {
  const json = z.toJSONSchema(RequirementsSchema, { io: 'input' }) as { properties: Record<string, { maxLength?: number }> };
  const always = new Set(requiredFields(EMPTY_REQUIREMENTS));
  const forIntegration = new Set(requiredFields({ ...EMPTY_REQUIREMENTS, workloadType: 'integration' }));
  const fields: RequirementFieldInfo[] = REQUIREMENT_ORDER.map((name) => {
    const meta = FIELD_META[name];
    const options = SELECT_OPTIONS[name];
    const info: RequirementFieldInfo = {
      name,
      label: meta.label,
      short: meta.short,
      ...(meta.term ? { term: meta.term } : {}),
      question: meta.question,
      why: meta.why,
      required: always.has(name) ? 'always' : forIntegration.has(name) ? 'when workloadType is "integration"' : 'no',
      type: options ? 'choice' : 'text',
    };
    if (options) info.options = options.map((o) => ({ ...o }));
    else info.maxLength = json.properties[name]?.maxLength;
    if (name === 'description') info.minLength = MIN_DESCRIPTION_LENGTH;
    if (isUnsureField(name)) {
      const d = UNSURE_DEFAULTS[name];
      info.notSure = { value: UNSURE, defaultValue: d.value, defaultLabel: unsureDefaultLabel(name), assumption: d.assumption };
    }
    return info;
  });
  return {
    notes: [
      'Empty string ("") means not answered. Every field is optional in the JSON, but planning needs every required field.',
      'Choice fields accept only the listed values. Fields with a notSure entry also accept "unsure": the planner uses the stated default and lists it as an assumption.',
      'description, workloadType, and existingSystems have no "unsure" option; they must come from the user.',
      'Unknown keys are ignored.',
    ],
    fields,
    jsonSchema: json,
  };
}

export function listSamples(): readonly Scenario[] {
  return SCENARIOS;
}

export function getSample(id: string): Scenario | undefined {
  return getScenario(id);
}
