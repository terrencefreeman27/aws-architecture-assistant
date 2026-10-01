import type { RequirementField } from '../../shared/schema';

export interface Option {
  value: string;
  label: string;
}

export const SELECT_OPTIONS: Partial<Record<RequirementField, Option[]>> = {
  workloadType: [
    { value: 'web_app', label: 'Web application' },
    { value: 'integration', label: 'Integration between existing systems' },
    { value: 'ai_assistant', label: 'AI knowledge assistant' },
    { value: 'other', label: 'Something else' },
  ],
  expectedUsage: [
    { value: 'low', label: 'Low and steady' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'high', label: 'High and sustained' },
    { value: 'spiky', label: 'Spiky (quiet, then bursts)' },
  ],
  dataSensitivity: [
    { value: 'public', label: 'Public' },
    { value: 'internal', label: 'Internal' },
    { value: 'confidential', label: 'Confidential (customer or business data)' },
    { value: 'regulated', label: 'Regulated (health, payment, government)' },
  ],
  availability: [
    { value: 'best_effort', label: 'Best effort' },
    { value: 'business_hours', label: 'Business hours' },
    { value: 'high', label: 'High availability' },
    { value: 'mission_critical', label: 'Mission critical' },
  ],
  budget: [
    { value: 'minimal', label: 'Minimal' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'flexible', label: 'Flexible' },
  ],
  operations: [
    { value: 'small_team', label: 'Small team, fully managed services' },
    { value: 'ops_team', label: 'Dedicated operations team' },
    { value: 'containers', label: 'Team already uses containers' },
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

export function focusField(field: string): void {
  const el = document.getElementById(`field-${field}`);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  (el as HTMLElement).focus({ preventScroll: true });
}
