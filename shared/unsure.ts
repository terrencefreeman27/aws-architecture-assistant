import type { Assumption, Requirements } from './schema';

/**
 * "Not sure" answers. A user who knows their business but not AWS can answer
 * "Not sure" to the choice fields below. The answer counts as answered for
 * completeness, and the planner substitutes a documented, conservative
 * default before any provider sees the requirements. Each substitution is
 * listed in the plan's assumptions, linked to the field so it can be changed.
 *
 * Fields that must come from the user (the description, the kind of system,
 * existing systems) have no "Not sure" option.
 */

export const UNSURE = 'unsure' as const;

export const UNSURE_FIELDS = ['expectedUsage', 'dataSensitivity', 'region', 'availability', 'budget', 'operations'] as const;
export type UnsureField = (typeof UNSURE_FIELDS)[number];

export interface UnsureDefault {
  /** The value the planner uses instead of "Not sure". */
  value: string;
  /** Plain-language assumption shown in the plan. */
  assumption: string;
}

/**
 * The defaults. Each one leans towards the safer outcome for someone who does
 * not know: more protection for data, resilience to a single data-center
 * failure, no always-on spend they did not plan for, and nothing for a small
 * team to patch.
 */
export const UNSURE_DEFAULTS: Record<UnsureField, UnsureDefault> = {
  expectedUsage: {
    value: 'spiky',
    assumption:
      "You weren't sure how busy it will be, so we assumed usage is unpredictable (quiet, then sudden bursts). The plan uses parts that scale up for bursts and back down when quiet instead of guessing a fixed size. Change it here if you know.",
  },
  dataSensitivity: {
    value: 'confidential',
    assumption:
      "You weren't sure how sensitive the data is, so we assumed it is confidential, never public: the plan requires sign-in, encrypts stored data with keys you control, and keeps an audit trail. If it includes health, payment, or government data, choose Regulated here.",
  },
  region: {
    value: 'us-east-1',
    assumption:
      "You weren't sure where most of your users are, so we assumed US East (N. Virginia), us-east-1, which offers the widest choice of AWS services and AI models. If your users or data-residency rules point elsewhere, change it here.",
  },
  availability: {
    value: 'high',
    assumption:
      "You weren't sure how much downtime is acceptable, so we assumed it should stay up nearly all the time: the plan keeps running if one data center fails (Multi-AZ) and backs up stored data. A multi-Region design is not assumed. Change it here if you know.",
  },
  budget: {
    value: 'minimal',
    assumption:
      "You weren't sure how to balance cost, so we assumed costs should stay as low as possible: the plan favours services that cost little when idle, so an unused system does not run up a bill. Change it here if speed or simplicity matter more.",
  },
  operations: {
    value: 'small_team',
    assumption:
      "You weren't sure who will look after it, so we assumed a small team that wants AWS to manage the servers: the plan uses fully managed services with nothing to patch or size. Change it here if you have an operations team or use containers.",
  },
};

export function isUnsureField(field: string): field is UnsureField {
  return (UNSURE_FIELDS as readonly string[]).includes(field);
}

/** Fields the user answered "Not sure", in form order. */
export function unsureFields(req: Requirements): UnsureField[] {
  return UNSURE_FIELDS.filter((f) => req[f] === UNSURE);
}

/** Replaces every "Not sure" answer with its default. Idempotent; other answers are untouched. */
export function resolveUnsure(req: Requirements): Requirements {
  const out = { ...req } as Record<string, string>;
  for (const field of unsureFields(req)) out[field] = UNSURE_DEFAULTS[field].value;
  return out as Requirements;
}

/** One assumption per "Not sure" answer, linked to the field so the user can change it. */
export function unsureAssumptions(req: Requirements): Assumption[] {
  return unsureFields(req).map((field) => ({ text: UNSURE_DEFAULTS[field].assumption, field }));
}
