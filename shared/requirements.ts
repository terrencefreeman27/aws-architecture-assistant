import type { Completeness, FollowUpQuestion, RequirementField, Requirements } from './schema';

export interface FieldMeta {
  label: string;
  question: string;
  why: string;
}

export const FIELD_META: Record<RequirementField, FieldMeta> = {
  description: {
    label: 'System description',
    question: 'In a sentence or two, what should the system do and for whom?',
    why: 'The purpose decides which architecture pattern is a reasonable starting point.',
  },
  workloadType: {
    label: 'Closest pattern',
    question: 'Which pattern is closest: a web application, an integration between existing systems, or an AI knowledge assistant?',
    why: 'Demo mode builds plans from three reviewed patterns.',
  },
  existingSystems: {
    label: 'Existing systems and tools',
    question: 'Which existing systems must this connect to (for example a CRM, an ERP, an on-premises database, or a document store)? List the source first.',
    why: 'Integrations need to know what talks to what, and whether anything lives on-premises.',
  },
  expectedUsage: {
    label: 'Expected usage',
    question: 'How much usage do you expect: low, moderate, high, or spiky (quiet with sudden bursts)?',
    why: 'Usage shape drives the choice between pay-per-request serverless and always-on capacity.',
  },
  usageNotes: {
    label: 'Usage details',
    question: 'Any numbers you know, such as users, requests per day, or data volume?',
    why: 'Numbers let reviewers check scaling and cost assumptions.',
  },
  dataSensitivity: {
    label: 'Data sensitivity',
    question: 'How sensitive is the data: public, internal, confidential, or regulated (for example health or payment data)?',
    why: 'Sensitivity decides authentication, encryption, and audit requirements.',
  },
  region: {
    label: 'AWS Region',
    question: 'Which AWS Region should this run in? Pick the one closest to your users or required by data-residency rules.',
    why: 'Region affects latency, data residency, and which services and models are available.',
  },
  availability: {
    label: 'Availability and recovery',
    question: 'How available must it be: best effort, business hours, high availability, or mission critical?',
    why: 'Availability targets decide Multi-AZ, backup, and disaster-recovery design.',
  },
  recoveryNotes: {
    label: 'Recovery targets',
    question: 'Do you have recovery targets, such as how much data you can afford to lose (RPO) and how long you can be down (RTO)?',
    why: 'Recovery objectives pick the disaster-recovery strategy.',
  },
  budget: {
    label: 'Budget posture',
    question: 'What is the budget posture: minimal, moderate, or flexible?',
    why: 'Budget decides whether to favour scale-to-zero services or always-on capacity.',
  },
  operations: {
    label: 'Operational constraints',
    question: 'Who will run this: a small team that wants fully managed services, a dedicated ops team, or a team already standardised on containers?',
    why: 'Operational capacity decides how much infrastructure the team can realistically own.',
  },
  operationsNotes: {
    label: 'Other constraints',
    question: 'Any other constraints, such as required tools, deadlines, or skills on the team?',
    why: 'Constraints can rule out otherwise reasonable options.',
  },
};

const BASE_REQUIRED: RequirementField[] = [
  'description',
  'workloadType',
  'expectedUsage',
  'dataSensitivity',
  'region',
  'availability',
  'budget',
  'operations',
];

/** Minimum description length to count as a usable purpose statement. */
export const MIN_DESCRIPTION_LENGTH = 20;

export function requiredFields(req: Requirements): RequirementField[] {
  return req.workloadType === 'integration' ? [...BASE_REQUIRED, 'existingSystems'] : BASE_REQUIRED;
}

function isAnswered(req: Requirements, field: RequirementField): boolean {
  const value = req[field].trim();
  if (field === 'description') return value.length >= MIN_DESCRIPTION_LENGTH;
  return value.length > 0;
}

export function computeCompleteness(req: Requirements): Completeness {
  const required = requiredFields(req);
  const missing = required.filter((f) => !isAnswered(req, f));
  const answered = required.length - missing.length;
  return { answered, required: required.length, percent: Math.round((answered / required.length) * 100), missing };
}

export function followUpQuestions(req: Requirements): FollowUpQuestion[] {
  return computeCompleteness(req).missing.map((field) => ({
    field,
    question:
      field === 'description' && req.description.trim().length > 0
        ? 'Can you describe the system in a bit more detail: what it does, who uses it, and what data it handles?'
        : FIELD_META[field].question,
    why: FIELD_META[field].why,
  }));
}
