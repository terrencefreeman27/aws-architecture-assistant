import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Requirements                                                        */
/* ------------------------------------------------------------------ */

export const WORKLOAD_TYPES = ['web_app', 'integration', 'ai_assistant', 'other'] as const;
export const USAGE_LEVELS = ['low', 'moderate', 'high', 'spiky'] as const;
export const SENSITIVITY_LEVELS = ['public', 'internal', 'confidential', 'regulated'] as const;
export const AVAILABILITY_LEVELS = ['best_effort', 'business_hours', 'high', 'mission_critical'] as const;
export const BUDGET_LEVELS = ['minimal', 'moderate', 'flexible'] as const;
export const OPS_MODELS = ['small_team', 'ops_team', 'containers'] as const;

/** Commercial regions offered in the form. "Not sure" is represented by ''. */
export const REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'sa-east-1',
] as const;

/** Empty string means "not answered yet". */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), z.literal('')]).default('');

const text = (max: number) => z.string().trim().max(max).default('');

export const RequirementsSchema = z.object({
  description: text(2000),
  workloadType: optionalEnum(WORKLOAD_TYPES),
  existingSystems: text(1000),
  expectedUsage: optionalEnum(USAGE_LEVELS),
  usageNotes: text(500),
  dataSensitivity: optionalEnum(SENSITIVITY_LEVELS),
  region: optionalEnum(REGIONS),
  availability: optionalEnum(AVAILABILITY_LEVELS),
  recoveryNotes: text(500),
  budget: optionalEnum(BUDGET_LEVELS),
  operations: optionalEnum(OPS_MODELS),
  operationsNotes: text(500),
});

export type Requirements = z.infer<typeof RequirementsSchema>;
export type RequirementField = keyof Requirements;

export const EMPTY_REQUIREMENTS: Requirements = RequirementsSchema.parse({});

/* ------------------------------------------------------------------ */
/* Follow-up questions                                                 */
/* ------------------------------------------------------------------ */

export const FollowUpQuestionSchema = z.object({
  field: z.string(),
  question: z.string(),
  why: z.string(),
});
export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;

/* ------------------------------------------------------------------ */
/* Architecture plan (the structured output a provider must return)   */
/* ------------------------------------------------------------------ */

/** Diagram-safe identifier: used verbatim as a Mermaid node id. */
export const NodeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Node ids must be lowercase letters, digits, or underscores and start with a letter');

export const TIERS = ['users', 'edge', 'app', 'integration', 'data', 'ai', 'security', 'operations', 'external'] as const;

export const NodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.enum(['aws', 'external', 'actor']),
  /** Catalog id; required when kind is "aws". */
  serviceId: z.string().optional(),
  label: z.string().min(1).max(60),
  role: z.string().min(1).max(400),
  tier: z.enum(TIERS),
  sourceIds: z.array(z.string()).default([]),
});
export type PlanNode = z.infer<typeof NodeSchema>;

export const ConnectionSchema = z.object({
  from: NodeIdSchema,
  to: NodeIdSchema,
  label: z.string().max(40).default(''),
});
export type Connection = z.infer<typeof ConnectionSchema>;

/**
 * A claim in the plan. If `basis` is "source", at least one source id is
 * required. Anything not supported by a curated source must be labelled
 * "assumption".
 */
export const ClaimSchema = z
  .object({
    text: z.string().min(1).max(600),
    basis: z.enum(['source', 'assumption']),
    sourceIds: z.array(z.string()).default([]),
  })
  .refine((c) => c.basis === 'assumption' || c.sourceIds.length > 0, {
    message: 'Claims with basis "source" must cite at least one source id',
  });
export type Claim = z.infer<typeof ClaimSchema>;

export const PILLARS = ['security', 'reliability', 'performance', 'operations', 'cost'] as const;
export type Pillar = (typeof PILLARS)[number];

export const AssumptionSchema = z.object({
  text: z.string().min(1).max(400),
  /** Requirement field the user can edit to correct this assumption. */
  field: z.string().optional(),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const CautionSchema = z.object({
  topic: z.string().min(1).max(80),
  message: z.string().min(1).max(600),
  sourceIds: z.array(z.string()).default([]),
});
export type Caution = z.infer<typeof CautionSchema>;

export const AlternativeSchema = z.object({
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(600),
  pros: z.array(z.string()).min(1),
  cons: z.array(z.string()).min(1),
  sourceIds: z.array(z.string()).default([]),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const PlanSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(1200),
  nodes: z.array(NodeSchema).min(1).max(40),
  connections: z.array(ConnectionSchema).max(80),
  dataFlow: z.array(z.string().min(1)).min(1),
  assumptions: z.array(AssumptionSchema),
  openQuestions: z.array(z.string()),
  considerations: z.object({
    security: z.array(ClaimSchema).min(1),
    reliability: z.array(ClaimSchema).min(1),
    performance: z.array(ClaimSchema).min(1),
    operations: z.array(ClaimSchema).min(1),
    cost: z.array(ClaimSchema).min(1),
  }),
  alternatives: z.array(AlternativeSchema).min(1),
  implementationSteps: z.array(z.string().min(1)).min(1),
  cautions: z.array(CautionSchema).default([]),
});
export type Plan = z.infer<typeof PlanSchema>;

/* ------------------------------------------------------------------ */
/* API contract                                                        */
/* ------------------------------------------------------------------ */

export interface Completeness {
  answered: number;
  required: number;
  percent: number;
  missing: RequirementField[];
}

export interface ValidationIssue {
  code:
    | 'schema'
    | 'unsupported_service'
    | 'missing_service_id'
    | 'duplicate_node'
    | 'dangling_connection'
    | 'self_connection'
    | 'unknown_source'
    | 'empty_diagram';
  message: string;
  path?: string;
}

export type PlanResponse =
  | {
      kind: 'questions';
      provider: string;
      completeness: Completeness;
      questions: FollowUpQuestion[];
      cautions: Caution[];
    }
  | {
      kind: 'plan';
      provider: string;
      completeness: Completeness;
      plan: Plan;
      mermaid: string;
      warnings: ValidationIssue[];
      generatedAt: string;
    }
  | {
      kind: 'error';
      provider: string;
      message: string;
      issues: ValidationIssue[];
    };
