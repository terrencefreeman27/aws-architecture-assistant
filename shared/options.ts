import { REGIONS, type RequirementField } from './schema';

/** Human-readable labels for form options and tiers, shared by the UI and the Markdown report. */

export interface Option {
  value: string;
  label: string;
}

/** Display names for the Regions offered in the form, as AWS names them. */
export const REGION_NAMES: Record<(typeof REGIONS)[number], string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'ca-central-1': 'Canada (Central)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-west-2': 'Europe (London)',
  'eu-central-1': 'Europe (Frankfurt)',
  'eu-north-1': 'Europe (Stockholm)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'sa-east-1': 'South America (São Paulo)',
};

export const SELECT_OPTIONS: Partial<Record<RequirementField, Option[]>> = {
  workloadType: [
    { value: 'web_app', label: 'A website or app people sign in to or browse' },
    { value: 'integration', label: 'Moving data between systems we already use' },
    { value: 'ai_assistant', label: 'An AI assistant that answers from our documents' },
    { value: 'other', label: 'Something else' },
  ],
  expectedUsage: [
    { value: 'low', label: 'Light and steady' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'high', label: 'Heavy, all day' },
    { value: 'spiky', label: 'Quiet, then sudden bursts' },
  ],
  dataSensitivity: [
    { value: 'public', label: 'Public: anyone may see it' },
    { value: 'internal', label: 'Internal: staff only' },
    { value: 'confidential', label: 'Confidential: customer or business data' },
    { value: 'regulated', label: 'Regulated: health, payment, or government data' },
  ],
  region: REGIONS.map((r) => ({ value: r, label: `${REGION_NAMES[r]} · ${r}` })),
  availability: [
    { value: 'best_effort', label: 'Downtime is fine now and then (best effort)' },
    { value: 'business_hours', label: 'Must work during business hours' },
    { value: 'high', label: 'Should stay up nearly all the time (high availability)' },
    { value: 'mission_critical', label: 'Downtime would be serious harm (mission critical)' },
  ],
  budget: [
    { value: 'minimal', label: 'Keep costs as low as possible' },
    { value: 'moderate', label: 'Balance cost with other goals' },
    { value: 'flexible', label: 'Spend more for speed and simplicity' },
  ],
  operations: [
    { value: 'small_team', label: 'Small team: let AWS manage the servers' },
    { value: 'ops_team', label: 'We have a dedicated operations team' },
    { value: 'containers', label: 'Our team already uses containers (e.g. Docker)' },
  ],
};

export const TIER_LABELS: Record<string, string> = {
  users: 'Users',
  edge: 'Edge',
  app: 'Application',
  integration: 'Integration',
  ai: 'AI',
  data: 'Data',
  security: 'Security',
  operations: 'Operations',
  external: 'Existing system',
};
