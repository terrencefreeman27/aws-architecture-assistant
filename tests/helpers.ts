import { RequirementsSchema, type Requirements } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';

/** A minimal structurally valid plan, used as a base for mutation tests. */
export function validRawPlan(): any {
  return {
    title: 'Test plan',
    summary: 'A small plan used in tests.',
    nodes: [
      { id: 'users', kind: 'actor', label: 'Users', role: 'People using the app.', tier: 'users', sourceIds: [] },
      { id: 'api', kind: 'aws', serviceId: 'api-gateway', label: 'API Gateway', role: 'HTTPS API.', tier: 'app', sourceIds: ['svc-apigateway'] },
      { id: 'fn', kind: 'aws', serviceId: 'lambda', label: 'Lambda', role: 'Business logic.', tier: 'app', sourceIds: ['svc-lambda'] },
    ],
    connections: [
      { from: 'users', to: 'api', label: 'HTTPS' },
      { from: 'api', to: 'fn', label: '' },
    ],
    dataFlow: ['Users call the API, which invokes the function.'],
    assumptions: [{ text: 'Traffic is low.', field: 'expectedUsage' }],
    openQuestions: ['What are the RTO and RPO?'],
    considerations: {
      security: [{ text: 'Use least-privilege IAM roles.', basis: 'source', sourceIds: ['svc-iam'] }],
      reliability: [{ text: 'Retries are assumed to be acceptable.', basis: 'assumption', sourceIds: [] }],
      performance: [{ text: 'Lambda scales with requests.', basis: 'source', sourceIds: ['svc-lambda'] }],
      operations: [{ text: 'Alarm on errors.', basis: 'source', sourceIds: ['svc-cloudwatch'] }],
      cost: [{ text: 'Cost scales with requests.', basis: 'assumption', sourceIds: [] }],
    },
    alternatives: [{ title: 'Containers', summary: 'Run on ECS.', pros: ['Familiar.'], cons: ['Always-on cost.'], sourceIds: ['svc-ecs'] }],
    implementationSteps: ['Build the API.'],
    cautions: [],
  };
}

export function scenarioRequirements(id: string): Requirements {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return structuredClone(s.requirements);
}

export function req(overrides: Partial<Requirements>): Requirements {
  return RequirementsSchema.parse({ ...scenarioRequirements('web-app'), ...overrides });
}
