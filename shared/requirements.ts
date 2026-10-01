import type { Completeness, FollowUpQuestion, RequirementField, Requirements } from './schema';

export interface FieldMeta {
  /** Plain-language label shown on the form, written for someone who knows the business but not AWS. */
  label: string;
  /** Short name for compact lists ("Missing: ...", "Edit: ..."). */
  short: string;
  /** The precise AWS term, shown as a secondary hint next to the label. */
  term?: string;
  question: string;
  why: string;
}

export const FIELD_META: Record<RequirementField, FieldMeta> = {
  description: {
    label: 'What should the system do?',
    short: 'Description',
    question: 'In a sentence or two: what should it do, who uses it, and what information does it handle?',
    why: 'The purpose decides which kind of design is a reasonable starting point.',
  },
  workloadType: {
    label: 'What kind of system is it?',
    short: 'Kind of system',
    term: 'closest pattern',
    question:
      'Which is closest: a website or app people use, a connection that moves data between systems you already have, or an AI assistant that answers questions from your documents?',
    why: 'Demo mode builds plans from three reviewed designs, so it needs to know which one fits.',
  },
  existingSystems: {
    label: 'Which existing systems does it connect to?',
    short: 'Existing systems',
    question:
      'For example a CRM, an accounting or ERP system, a database in your own building, or a document store. When moving data between systems, list where the data comes from first.',
    why: 'Connections need to know what talks to what, and whether anything runs in your own building rather than online.',
  },
  expectedUsage: {
    label: 'How busy will it be?',
    short: 'How busy',
    term: 'expected usage',
    question: 'Light and steady, moderate, heavy all day, or quiet with sudden bursts?',
    why: 'How busy it is decides between services you pay for per use and capacity that is always running.',
  },
  usageNotes: {
    label: 'Any numbers you know?',
    short: 'Usage numbers',
    question: 'For example how many people use it, orders or requests per day, or how much data it stores.',
    why: 'Numbers let reviewers check whether the design will cope and what will drive cost.',
  },
  dataSensitivity: {
    label: 'How sensitive is the data?',
    short: 'Data sensitivity',
    question:
      'Who would be harmed if it leaked? Public information, internal staff-only data, confidential customer or business data, or regulated data such as health or payment records.',
    why: 'Sensitivity decides sign-in, encryption, and audit-trail requirements.',
  },
  region: {
    label: 'Where are most of your users?',
    short: 'User location',
    term: 'AWS Region',
    question: 'The plan runs in the AWS location closest to them, unless rules require the data to stay in a particular country.',
    why: 'Location affects speed for users, where the data is stored, and which services are available.',
  },
  availability: {
    label: 'How much downtime is acceptable?',
    short: 'Downtime',
    term: 'availability and recovery',
    question: 'If it stopped working for an hour, what would happen? This decides how much backup and redundancy the plan includes.',
    why: 'The answer decides whether the design keeps running when one data center fails, and how backups and recovery work.',
  },
  recoveryNotes: {
    label: 'After a serious failure, how much data could you lose, and for how long could it be down?',
    short: 'Recovery targets',
    term: 'RPO and RTO',
    question:
      'For example "we can lose at most 15 minutes of orders and must be back within 4 hours". The first is called the recovery point objective (RPO), the second the recovery time objective (RTO).',
    why: 'These two targets pick the disaster-recovery strategy.',
  },
  budget: {
    label: 'How should cost be balanced against other goals?',
    short: 'Cost balance',
    term: 'budget',
    question: 'Keep costs as low as possible, balance cost with other goals, or spend more for speed and simplicity?',
    why: 'This decides whether to favour services that cost almost nothing when idle or capacity that is always on.',
  },
  operations: {
    label: 'Who will look after it day to day?',
    short: 'Who runs it',
    term: 'operations',
    question:
      'A small team that wants AWS to handle the servers, a dedicated operations team, or a team that already packages its software in containers (for example Docker)?',
    why: 'How much the team can look after decides how much infrastructure the design can ask them to own.',
  },
  operationsNotes: {
    label: 'Anything else we should know?',
    short: 'Other constraints',
    question: 'For example required tools, deadlines, or skills on the team.',
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
