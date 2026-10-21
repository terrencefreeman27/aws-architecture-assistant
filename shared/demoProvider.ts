import { getService } from './catalog';
import type { AlternativeSpec, ArchitectureProvider } from './provider';
import { resolveUnsure } from './unsure';
import { DIAGRAM_LABEL_MAX } from './schema';
import type {
  Alternative,
  Assumption,
  Caution,
  Claim,
  Connection,
  FollowUpQuestion,
  Pillar,
  Plan,
  PlanNode,
  Requirements,
} from './schema';

/**
 * Deterministic, rules-based provider used when no model credentials are
 * configured. It maps requirement answers onto reviewed templates built only
 * from the supported catalog, so the same input always yields the same plan
 * and editing a requirement visibly changes the result.
 */

// "unsure" is resolved before planning (shared/unsure.ts); if it ever reaches here it ranks as the protective default.
const SENSITIVITY_RANK = { '': 0, public: 0, internal: 1, confidential: 2, regulated: 3, unsure: 2 } as const;
const AVAILABILITY_RANK = { '': 0, best_effort: 0, business_hours: 1, high: 2, mission_critical: 3, unsure: 2 } as const;

const USAGE_TEXT: Record<string, string> = {
  low: 'low, steady',
  moderate: 'moderate',
  high: 'high, sustained',
  spiky: 'spiky, bursty',
};

const SAAS_HINT = /\b(salesforce|hubspot|zendesk|servicenow|slack|marketo|google analytics|zoho|sap|quickbooks|shopify|stripe|jira|workday|netsuite)\b/i;
const ONPREM_HINT = /\b(on[- ]?prem(ises)?|data ?cent(er|re)|local server|internal network|legacy (erp|database|db|server)|mainframe)\b/i;
const FILE_HINT = /\b(s?ftp|csv|file drop|flat files?|batch files?)\b/i;
const SCHEDULE_HINT = /\b(nightly|daily|hourly|weekly|schedule[ds]?|batch)\b/i;
const WORKFLOW_HINT = /\b(workflow|approval|multi[- ]step|orchestrat\w*|saga)\b/i;
const SCANNED_HINT = /\b(scanned|scans|images?|handwritten|faxe?s?)\b/i;
const STREAM_HINT = /\b(real[- ]?time|stream(s|ing)?|clickstreams?|telemetry|iot|sensors?|continuous(ly)?|within (seconds|minutes))\b/i;
const WAREHOUSE_HINT = /\b(data warehouse|redshift|complex (queries|joins))\b/i;
const LONG_HINT = /\b(longer than 15 minutes|long[- ]running|takes? (several |many )?hours|hours? long|for hours)\b/i;
const PARALLEL_HINT = /\b(parallel|aws batch|hpc|simulations?|thousands of (files|jobs|images|documents))\b/i;
const SYNC_HINT = /\b(sync(s|ed|ing)?|incremental|since the last (run|sync))\b/i;
const JOB_FILE_HINT = /\b(s?ftp|csv|file drop|flat files?|(incoming|uploaded|dropped) files?|process(es|ing)? (the |each |new )?files?)\b/i;

/**
 * Sentences that select a design choice the planner otherwise reads from free
 * text. An alternative that needs one of these choices is expressed as adding
 * the sentence to "Anything else we should know?", so applying it stays a
 * normal, visible, editable, shareable requirement. Each one matches its hint.
 */
export const CHOICE_NOTES = {
  workflow: 'It is a multi-step workflow: steps run in order, with retries.',
  stream: 'Data should arrive continuously, in near real time.',
  warehouse: 'We want a dedicated data warehouse for frequent, complex queries.',
  long: 'Some runs take longer than 15 minutes.',
  parallel: 'Each run splits into many parallel jobs.',
} as const;

const NOTES_MAX = 500;

/** Clips user text quoted inside plan fields so long answers never break the plan schema's length limits. */
function quote(value: string, max: number): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 3).trimEnd()}...` : v;
}

/** Diagram labels are limited to DIAGRAM_LABEL_MAX characters (NodeSchema); longer names are shortened, never rejected. */
const clipLabel = (value: string) => quote(value, DIAGRAM_LABEL_MAX);

function addNote(req: Requirements, note: string): AlternativeSpec {
  const current = req.operationsNotes.trim();
  const value = current ? `${current} ${note}` : note;
  if (value.length > NOTES_MAX) {
    return { reason: `Selecting it means adding a sentence to "Anything else we should know?", and that answer is already close to its ${NOTES_MAX}-character limit.` };
  }
  return { changes: [{ field: 'operationsNotes', value, summary: `adds "${note}"` }] };
}

/**
 * The reverse of addNote: removes the sentence again. If the user's own words
 * (anywhere the hint is read) still ask for the choice, the alternative cannot
 * be expressed by editing answers the planner wrote, so it stays text-only.
 */
function removeNote(req: Requirements, note: string, hint: RegExp, readFrom: (r: Requirements) => string, ownWords: string): AlternativeSpec {
  const without = req.operationsNotes.replace(note, ' ').replace(/\s+/g, ' ').trim();
  if (hint.test(readFrom({ ...req, operationsNotes: without })) || !req.operationsNotes.includes(note)) return { reason: ownWords };
  return { changes: [{ field: 'operationsNotes', value: without, summary: `removes "${note}"` }] };
}

class PlanBuilder {
  nodes: PlanNode[] = [];
  connections: Connection[] = [];
  considerations: Record<Pillar, Claim[]> = { security: [], reliability: [], performance: [], operations: [], cost: [] };
  assumptions: Assumption[] = [];
  openQuestions: string[] = [];
  cautions: Caution[] = [];
  alternatives: Alternative[] = [];
  /** How each alternative (by title) can be drawn as a variant, or why it cannot. */
  altSpecs: Record<string, AlternativeSpec> = {};
  dataFlow: string[] = [];
  steps: string[] = [];

  aws(id: string, serviceId: string, role: string, tier: PlanNode['tier'], label?: string): this {
    const svc = getService(serviceId);
    if (!svc) throw new Error(`Demo template references unknown catalog service "${serviceId}"`);
    this.nodes.push({ id, kind: 'aws', serviceId, label: label ?? svc.name, role, tier, sourceIds: [...svc.sourceIds] });
    return this;
  }

  external(id: string, label: string, role: string): this {
    this.nodes.push({ id, kind: 'external', label: clipLabel(label), role, tier: 'external', sourceIds: [] });
    return this;
  }

  actor(id: string, label: string, role: string): this {
    this.nodes.push({ id, kind: 'actor', label, role, tier: 'users', sourceIds: [] });
    return this;
  }

  alt(alternative: Alternative, spec: AlternativeSpec): this {
    this.alternatives.push(alternative);
    this.altSpecs[alternative.title] = spec;
    return this;
  }

  has(id: string): boolean {
    return this.nodes.some((n) => n.id === id);
  }

  link(from: string, to: string, label = ''): this {
    if (!this.connections.some((c) => c.from === from && c.to === to)) this.connections.push({ from, to, label });
    return this;
  }

  cite(pillar: Pillar, text: string, ...sourceIds: string[]): this {
    this.considerations[pillar].push({ text, basis: 'source', sourceIds });
    return this;
  }

  assume(pillar: Pillar, text: string): this {
    this.considerations[pillar].push({ text, basis: 'assumption', sourceIds: [] });
    return this;
  }
}

function parseSystems(value: string): string[] {
  const parts = value
    .split(/[,;\n]|\band\b/i)
    .map((p) => clipLabel(p.trim().replace(/^[-*]\s*/, '')))
    .filter((p) => p.length > 1);
  return [...new Set(parts)].slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Cross-cutting sections shared by every pattern                      */
/* ------------------------------------------------------------------ */

function addCrossCutting(b: PlanBuilder, req: Requirements, statefulDb: boolean): void {
  const sens = SENSITIVITY_RANK[req.dataSensitivity];
  const avail = AVAILABILITY_RANK[req.availability];

  b.aws('iam', 'iam', 'Least-privilege roles for every compute component; no long-lived access keys in code.', 'security');
  b.cite('security', 'Give each function or service its own IAM role scoped to only the actions and resources it needs.', 'svc-iam', 'wa-security');

  if (sens >= 2) {
    b.aws('kms', 'kms', 'Customer managed keys for encrypting stored data and controlling who can decrypt it.', 'security');
    b.cite('security', 'Encrypt data at rest with AWS KMS keys and restrict key usage through key policies.', 'svc-kms', 'wa-security');
    b.aws('cloudtrail', 'cloudtrail', 'Audit trail of account activity and API calls.', 'operations');
    b.cite('security', 'Enable CloudTrail so that access to sensitive resources can be audited.', 'svc-cloudtrail');
  } else {
    b.assume('security', 'Data is not sensitive enough to require customer managed keys; AWS-managed encryption defaults are assumed to be acceptable. Revisit if sensitivity changes.');
  }
  if (sens >= 3) {
    b.aws('guardduty', 'guardduty', 'Continuous threat detection for the account and workloads.', 'security');
    b.cite('security', 'Turn on GuardDuty for threat detection across the account.', 'svc-guardduty');
  }

  b.aws('cloudwatch', 'cloudwatch', 'Metrics, logs, dashboards, and alarms for every component.', 'operations');
  b.cite('operations', 'Send logs and metrics to CloudWatch and alarm on error rates and latency, not only on infrastructure health.', 'svc-cloudwatch', 'wa-operational');
  b.cite('operations', 'Define the infrastructure as code (for example CloudFormation) so environments are reproducible and changes are reviewable.', 'svc-cloudformation', 'wa-operational');

  if (avail >= 2 && statefulDb) {
    b.aws('backup', 'backup', 'Policy-based backups of stateful data stores.', 'operations');
    b.cite('reliability', 'Use AWS Backup with a defined schedule and retention, and test restores rather than assuming they work.', 'svc-backup', 'wa-reliability');
  }

  if (req.recoveryNotes.trim()) {
    b.assumptions.push({ text: `Recovery targets taken from your notes: "${quote(req.recoveryNotes, 280)}". The design has not been verified against them.`, field: 'recoveryNotes' });
  } else {
    b.openQuestions.push('After a serious failure, how much recent data could you afford to lose, and how long could the system be down? These recovery targets (the recovery point objective, RPO, and recovery time objective, RTO) decide the disaster-recovery strategy.');
    b.assumptions.push({
      text:
        avail >= 2
          ? 'No recovery targets given (how much data you could lose and how long you could be down, known as RPO and RTO). Assumed that surviving the loss of one data center (Multi-AZ, within one Region) plus backups is acceptable.'
          : 'No recovery targets given (how much data you could lose and how long you could be down, known as RPO and RTO). Assumed that restoring from backups within hours is acceptable.',
      field: 'recoveryNotes',
    });
  }
  b.cite('reliability', 'Choose a disaster-recovery strategy (backup and restore, pilot light, warm standby, or multi-site) from agreed recovery targets: how much data you can afford to lose (RPO) and how long you can be down (RTO).', 'wp-disaster-recovery');

  if (!req.usageNotes.trim()) {
    b.openQuestions.push('Roughly how many users, requests per day, or GB of data do you expect at launch and at peak?');
    b.assumptions.push({ text: `Usage assumed to be ${USAGE_TEXT[req.expectedUsage] ?? 'unspecified'} with no specific numbers provided.`, field: 'usageNotes' });
  } else {
    b.assumptions.push({ text: `Usage based on your notes: "${quote(req.usageNotes, 360)}".`, field: 'usageNotes' });
  }

  b.assumptions.push({ text: `All components are deployed in ${req.region}; service and feature availability in that Region must be confirmed.`, field: 'region' });

  b.cite('cost', 'Treat cost as a design input: estimate from your own usage numbers with AWS Pricing Calculator and set AWS Budgets alerts before launch.', 'tool-pricing-calculator', 'tool-budgets', 'wa-cost');
  if (req.budget === 'minimal') {
    b.assume('cost', 'Minimal budget: the plan favours services that scale down when idle. Always-on resources (load balancers, provisioned databases, NAT gateways) are the main things to avoid or justify.');
  } else if (req.budget === 'flexible') {
    b.assume('cost', 'Flexible budget: the plan accepts some always-on capacity in exchange for predictable performance and simpler operations.');
  } else {
    b.assume('cost', 'Moderate budget: start small, measure real usage, and right-size after launch.');
  }

  if (req.operations === 'small_team') {
    b.assume('operations', 'A small team was indicated, so fully managed and serverless services are preferred over anything requiring patching or capacity management.');
  }
  if (req.operationsNotes.trim()) {
    b.assumptions.push({ text: `Constraint noted: "${quote(req.operationsNotes, 370)}".`, field: 'operationsNotes' });
  }
}

/* ------------------------------------------------------------------ */
/* Pattern: web application                                            */
/* ------------------------------------------------------------------ */

function webApp(req: Requirements): PlanBuilder {
  const b = new PlanBuilder();
  const sens = SENSITIVITY_RANK[req.dataSensitivity];
  const avail = AVAILABILITY_RANK[req.availability];
  const busy = req.expectedUsage === 'high' || req.expectedUsage === 'spiky';
  const containers =
    req.operations === 'containers' || (req.expectedUsage === 'high' && req.budget !== 'minimal' && req.operations === 'ops_team');
  const needsAuth = sens >= 1;
  const needsWaf = busy || sens >= 2;

  b.actor('users', 'Users', 'People using the web application in a browser.');
  b.aws('cdn', 'cloudfront', 'Serves the front end over HTTPS from edge locations and forwards API calls to the backend.', 'edge');
  b.aws('static_site', 's3', 'Private bucket holding the built front-end assets, readable only through CloudFront.', 'data', 'S3 static assets');
  b.link('users', 'cdn', 'HTTPS').link('cdn', 'static_site', 'static assets');

  if (needsWaf) {
    b.aws('waf', 'waf', 'Filters malicious or abusive requests before they reach the application.', 'security');
    b.link('waf', 'cdn', 'protects');
    b.cite('security', 'Attach AWS WAF rules to the CloudFront distribution to filter common web exploits and rate-limit abusive clients.', 'svc-waf', 'wa-security');
  }

  if (needsAuth) {
    b.aws('auth', 'cognito', 'User sign-up and sign-in; issues tokens the API verifies on every request.', 'security');
    b.link('users', 'auth', 'sign in');
    b.cite('security', 'Use a managed identity service such as Amazon Cognito rather than building password storage and sign-in yourself.', 'svc-cognito', 'wa-security');
    b.assumptions.push({ text: 'Users need to sign in because the data is not public.', field: 'dataSensitivity' });
  }

  if (containers) {
    b.aws('alb', 'alb', 'Spreads API traffic across containers running in more than one Availability Zone.', 'app');
    b.aws('app', 'ecs-fargate', 'Runs the backend API as containers without managing servers.', 'app', 'ECS Fargate service');
    const db = avail >= 2 && req.budget === 'flexible' ? 'aurora' : 'rds';
    b.aws('db', db, 'Relational database for application data.', 'data', db === 'aurora' ? 'Aurora database' : 'RDS database');
    b.aws('secrets', 'secrets-manager', 'Holds and rotates the database credentials used by the containers.', 'security');
    b.link('cdn', 'alb', '/api').link('alb', 'app').link('app', 'db', 'SQL').link('app', 'secrets', 'DB credentials');
    if (needsAuth) b.link('app', 'auth', 'verify tokens');
    b.aws('network', 'vpc', 'Private subnets for containers and database across at least two Availability Zones.', 'security', 'VPC (private subnets)');
    b.cite('security', 'Place the containers and database in private subnets and allow database access only from the application security group.', 'svc-vpc');
    b.cite('reliability', 'Run tasks in at least two Availability Zones behind the load balancer so a single-AZ failure does not take the service down.', 'svc-alb', 'wp-fault-isolation');
    if (avail >= 2) {
      b.cite('reliability', `Use a Multi-AZ deployment for the ${db === 'aurora' ? 'Aurora' : 'RDS'} database so a standby can take over if the primary fails.`, db === 'aurora' ? 'svc-aurora' : 'svc-rds', 'wa-reliability');
    } else {
      b.assume('reliability', 'Lower availability target: a single-AZ database instance with automated backups is assumed acceptable to save cost. This is a known single point of failure.');
    }
    b.cite('security', 'Keep database credentials in Secrets Manager rather than in code or environment files.', 'svc-secretsmanager');
    if (busy) {
      b.aws('cache', 'elasticache', 'Caches frequent reads to reduce database load during peaks.', 'data', 'ElastiCache');
      b.link('app', 'cache', 'cache reads');
      b.cite('performance', 'Add an in-memory cache for hot, read-heavy data to cut latency and database load.', 'svc-elasticache', 'wa-performance');
    }
    b.cite('performance', 'Configure ECS Service Auto Scaling on CPU or request count so capacity follows demand.', 'svc-ecs', 'wa-performance');
    b.assume('cost', 'Cost drivers: the load balancer, running container tasks, and the database instance are billed while running, even when idle. Data transfer out and NAT gateways are common surprises.');
    b.dataFlow.push(
      'The user loads the front end from CloudFront, which reads the built assets from a private S3 bucket.',
      needsAuth ? 'The user signs in with Amazon Cognito and receives a token.' : 'No sign-in is required because the data is public.',
      'API calls go through CloudFront to the Application Load Balancer, which routes them to ECS tasks in private subnets.',
      'The containers read and write application data in the relational database, using credentials fetched from Secrets Manager.',
      'Logs and metrics from every component flow to CloudWatch for dashboards and alarms.',
    );
    b.alt({
      title: 'Serverless API (API Gateway + Lambda + DynamoDB)',
      summary: 'Replace the load balancer, containers, and relational database with a managed API, functions, and a serverless database.',
      pros: ['Scales to zero when idle, so low or spiky usage costs less.', 'No containers or database instances to patch or size.'],
      cons: ['Requires designing data access around DynamoDB keys instead of SQL joins.', 'Per-request pricing can cost more than containers at sustained high volume.', 'Function cold starts may add latency to some requests.'],
      sourceIds: ['svc-apigateway', 'svc-lambda', 'svc-dynamodb', 'wa-serverless-lens'],
    }, req.operations === 'containers'
      ? { changes: [{ field: 'operations', value: 'small_team' }] }
      : { reason: 'The planner chose containers because you have an operations team, heavy all-day usage, and room in the budget. Changing one of those answers would switch to the serverless design.' });
  } else {
    b.aws('api', 'api-gateway', 'Managed HTTPS API in front of the backend functions; handles throttling and token checks.', 'app');
    b.aws('fn', 'lambda', 'Backend business logic that runs per request and scales automatically.', 'app', 'Lambda functions');
    b.aws('db', 'dynamodb', 'Serverless database for application data with on-demand capacity.', 'data', 'DynamoDB tables');
    b.link('cdn', 'api', '/api').link('api', 'fn').link('fn', 'db', 'read / write');
    if (needsAuth) b.link('api', 'auth', 'verify tokens');
    b.cite('reliability', 'API Gateway, Lambda, and DynamoDB are Regional managed services that run across multiple Availability Zones without extra configuration.', 'wp-fault-isolation', 'wa-serverless-lens');
    b.cite('reliability', 'Enable DynamoDB point-in-time recovery so table data can be restored after accidental writes or deletes.', 'svc-dynamodb');
    b.cite('performance', 'Lambda scales with request volume; set API Gateway throttling and reserved concurrency so bursts cannot overwhelm downstream systems.', 'svc-lambda', 'svc-apigateway');
    b.assume('cost', 'Cost drivers: number of API requests, Lambda duration and memory, and DynamoDB reads, writes, and storage. Idle cost is close to zero, but sustained high volume can exceed the cost of always-on containers.');
    b.dataFlow.push(
      'The user loads the front end from CloudFront, which reads the built assets from a private S3 bucket.',
      needsAuth ? 'The user signs in with Amazon Cognito and receives a token.' : 'No sign-in is required because the data is public.',
      'API calls go through CloudFront to API Gateway, which checks the token and invokes a Lambda function.',
      'The function reads and writes application data in DynamoDB.',
      'Logs and metrics from every component flow to CloudWatch for dashboards and alarms.',
    );
    b.alt({
      title: 'Containers (ALB + ECS Fargate + RDS)',
      summary: 'Run the backend as containers behind a load balancer with a managed relational database.',
      pros: ['Familiar SQL data model and frameworks; easy to port an existing app.', 'Predictable cost at sustained high load.', 'No function duration limits.'],
      cons: ['Load balancer, tasks, and database cost money even when idle.', 'More to operate: VPC design, scaling policies, database sizing and maintenance windows.'],
      sourceIds: ['svc-alb', 'svc-ecs', 'svc-rds'],
    }, { changes: [{ field: 'operations', value: 'containers' }] });
  }

  b.cite('performance', 'Cache static assets at the edge with CloudFront to reduce latency for distant users and load on the origin.', 'svc-cloudfront', 'wa-performance');
  b.alt({
    title: 'AWS Amplify Hosting for the front end',
    summary: 'Use Amplify Hosting for build, deploy, and hosting of the front end instead of wiring S3 and CloudFront yourself.',
    pros: ['Built-in CI/CD from a Git repository and preview environments.', 'Less configuration for a small team.'],
    cons: ['Less fine-grained control over caching and edge behaviour.', 'Another service and deployment model to learn.'],
    sourceIds: ['svc-amplify'],
  }, { reason: 'It changes how the front end is built and deployed rather than the parts of the design, and none of your answers selects it, so the planner does not draw it.' });

  const existing = parseSystems(req.existingSystems);
  existing.slice(0, 2).forEach((name, i) => {
    const id = `ext_${i + 1}`;
    b.external(id, name, 'Existing system the application exchanges data with.');
    b.link(b.has('app') ? 'app' : 'fn', id, 'integrates');
  });
  if (existing.length) {
    b.openQuestions.push(`How should the app connect to ${existing.join(', ')}: public API, private network, or file exchange?`);
  }

  b.steps.push(
    `Set up an AWS account (ideally with separate dev and prod accounts) in ${req.region}, with billing alerts and IAM roles for the team.`,
    'Define the infrastructure as code: networking, storage, and the data store.',
    containers ? 'Containerise the backend, push images to a registry, and deploy the ECS service behind the load balancer.' : 'Build the API in API Gateway with Lambda handlers and DynamoDB tables keyed on your access patterns.',
    'Host the front end in a private S3 bucket behind CloudFront.',
    needsAuth ? 'Add Amazon Cognito sign-in and require tokens on every API route.' : 'Confirm no endpoint exposes non-public data.',
    'Add CloudWatch dashboards and alarms, then load-test against your expected usage.',
    'Run a Well-Architected review of the result before launch.',
  );

  addCrossCutting(b, req, true);
  b.openQuestions.push('Do you need a custom domain? If so, plan DNS (Route 53 or your current provider) and a TLS certificate.');
  return b;
}

/* ------------------------------------------------------------------ */
/* Pattern: integration between existing systems                       */
/* ------------------------------------------------------------------ */

const integrationText = (req: Requirements) => `${req.description}\n${req.existingSystems}\n${req.operationsNotes}`;

function integration(req: Requirements): PlanBuilder {
  const b = new PlanBuilder();
  const avail = AVAILABILITY_RANK[req.availability];
  const allText = integrationText(req);
  const systems = parseSystems(req.existingSystems);
  const [sourceName, ...targetNames] = systems.length ? systems : ['Source system'];
  const targets = targetNames.length ? targetNames : ['Target system'];
  const onPrem = ONPREM_HINT.test(allText);
  const files = FILE_HINT.test(allText);
  const scheduled = SCHEDULE_HINT.test(allText);
  const orchestrated = avail >= 2 || WORKFLOW_HINT.test(allText);
  const saas = SAAS_HINT.test(req.existingSystems);

  b.external('src', sourceName, 'Existing system where the data or events originate.');
  b.assumptions.push({
    text: `"${sourceName}" is assumed to be the source and ${targets.map((t) => `"${t}"`).join(', ')} the target${targets.length > 1 ? 's' : ''}. Reorder the existing-systems list if that is wrong.`,
    field: 'existingSystems',
  });

  b.aws('bus', 'eventbridge', 'Central event bus that receives events and routes them by rule to the right processing path.', 'integration', 'EventBridge bus');
  if (files) {
    b.aws('sftp', 'transfer-family', 'Managed SFTP endpoint so the source can keep sending files the way it does today.', 'integration');
    b.aws('landing', 's3', 'Landing bucket for incoming files; each new file emits an event.', 'data', 'S3 landing bucket');
    b.link('src', 'sftp', 'SFTP upload').link('sftp', 'landing').link('landing', 'bus', 'object created');
    b.cite('reliability', 'Keep every received file in S3 so failed loads can be replayed without asking the source to resend.', 'svc-s3', 'svc-transfer');
  } else {
    b.aws('ingest', 'api-gateway', 'HTTPS endpoint that receives webhooks or pushed events from the source system.', 'integration', 'API Gateway webhook');
    b.link('src', 'ingest', 'webhook / API').link('ingest', 'bus', 'put event');
    b.aws('archive', 's3', 'Archive of raw payloads for audit and replay.', 'data', 'S3 payload archive');
  }
  if (scheduled) {
    b.cite('operations', 'Use EventBridge scheduling for timed runs (for example nightly syncs) instead of a server running cron.', 'svc-eventbridge');
    b.assumptions.push({ text: 'Some data moves on a schedule (detected from your description); the schedule itself is not yet defined.', field: 'description' });
  }

  b.aws('queue', 'sqs', 'Buffers work so bursts or target outages do not lose messages.', 'integration', 'SQS work queue');
  b.aws('dlq', 'sqs', 'Dead-letter queue holding messages that repeatedly failed, for inspection and redrive.', 'integration', 'SQS dead-letter queue');
  b.aws('state', 'dynamodb', 'Tracks processed message ids (idempotency) and sync checkpoints.', 'data', 'DynamoDB sync state');
  b.aws('secrets', 'secrets-manager', 'Stores API keys and credentials for the source and target systems.', 'security');

  if (orchestrated) {
    b.aws('flow', 'step-functions', 'Orchestrates the multi-step sync with retries, timeouts, and error branches.', 'integration', 'Step Functions workflow');
    b.aws('transform', 'lambda', 'Maps and validates records between the source and target formats.', 'integration', 'Lambda transform');
    b.link('bus', 'queue', 'route').link('queue', 'flow', 'start').link('flow', 'transform', 'invoke').link('queue', 'dlq', 'after retries');
    b.cite('reliability', 'Use Step Functions retry and catch rules so transient target failures are retried and permanent ones are routed for review.', 'svc-stepfunctions', 'wa-reliability');
  } else {
    b.aws('transform', 'lambda', 'Consumes the queue, maps records to the target format, and calls the target.', 'integration', 'Lambda processor');
    b.link('bus', 'queue', 'route').link('queue', 'transform', 'poll').link('queue', 'dlq', 'after retries');
  }
  b.link('transform', 'state', 'idempotency').link('transform', 'secrets', 'credentials');
  if (b.has('archive')) b.link('bus', 'archive', 'raw payloads');

  if (onPrem) {
    b.aws('network', 'vpc', 'VPC that hosts the processing that must reach on-premises systems.', 'security', 'VPC');
    b.aws('vpn', 'site-to-site-vpn', 'Encrypted tunnel from the VPC to the on-premises network.', 'integration', 'Site-to-Site VPN');
    b.cite('security', 'Reach on-premises systems over an encrypted Site-to-Site VPN rather than exposing them to the internet.', 'svc-site-to-site-vpn', 'svc-vpc');
    b.openQuestions.push('Which on-premises systems need network access, and can your network team support a VPN tunnel and route changes?');
  }

  targets.forEach((name, i) => {
    const id = `target_${i + 1}`;
    b.external(id, name, 'Existing system that receives the integrated data.');
    if (onPrem && ONPREM_HINT.test(name)) b.link('transform', 'vpn', 'private').link('vpn', id, 'deliver');
    else b.link('transform', id, 'deliver');
  });
  if (onPrem && !b.connections.some((c) => c.from === 'vpn')) {
    b.link('transform', 'vpn', 'private').link('vpn', 'src', 'private access');
  }

  b.aws('alerts', 'sns', 'Notifies the team when messages land in the dead-letter queue.', 'operations', 'SNS alerts');
  b.link('dlq', 'alerts', 'alarm');

  b.cite('reliability', 'Decouple systems with a queue and send repeatedly failing messages to a dead-letter queue instead of losing them.', 'svc-sqs', 'wa-reliability');
  b.cite('security', 'Keep third-party API credentials in Secrets Manager and grant each function access only to the secrets it needs.', 'svc-secretsmanager', 'wa-security');
  b.cite('performance', 'Lambda scales with queue depth; cap concurrency so the target system is not overwhelmed by bursts.', 'svc-lambda');
  b.assume('performance', 'Target system rate limits are unknown and assumed to be the main throughput constraint.');
  b.assume('cost', 'Cost drivers: number of events and messages, function duration, workflow state transitions, and any data transfer back to on-premises. Idle cost is low.');
  b.cite('operations', 'Alarm on dead-letter queue depth and on the age of the oldest message so stuck syncs are noticed quickly.', 'svc-cloudwatch', 'svc-sqs');

  b.dataFlow.push(
    files ? `"${sourceName}" uploads files over SFTP; they land in S3, which emits an event to EventBridge.` : `"${sourceName}" sends events or webhooks to API Gateway, which puts them on the EventBridge bus.`,
    'EventBridge rules route each event type to an SQS queue that buffers the work.',
    orchestrated ? 'A Step Functions workflow takes each message, calls a Lambda transform, and retries on failure.' : 'A Lambda function consumes the queue, validates, and transforms each record.',
    'Processed message ids are recorded in DynamoDB so duplicates are skipped.',
    `Transformed records are delivered to ${targets.map((t) => `"${t}"`).join(', ')}${onPrem ? ' (on-premises targets over the VPN)' : ''}.`,
    'Messages that keep failing go to the dead-letter queue, which raises an SNS alert.',
  );

  b.alt(
    saas
      ? {
          title: 'Amazon AppFlow managed flows',
          summary: 'Use AppFlow connectors to move data between the supported SaaS application and AWS without writing integration code.',
          pros: ['No code for supported connectors; scheduling and field mapping are built in.', 'Less to operate for a small team.'],
          cons: ['Only works for supported applications and directions.', 'Complex business rules still need custom processing.'],
          sourceIds: ['svc-appflow'],
        }
      : {
          title: 'Direct point-to-point Lambda',
          summary: 'Have a single function call the source and target directly without an event bus or queue.',
          pros: ['Fewer moving parts; quickest to build for one simple flow.'],
          cons: ['No buffering: a target outage loses or blocks data.', 'Every new system adds another hard-wired connection.'],
          sourceIds: ['svc-lambda'],
        },
    saas
      ? { reason: 'Whether a managed connector fits depends on which objects and directions your applications support, which the planner cannot check from your answers.' }
      : { reason: 'The planner always buffers integrations with a queue so failed deliveries are kept, so it does not draw an unbuffered design.' },
  );
  b.alt(
    orchestrated
      ? {
          title: 'Queue-only processing without Step Functions',
          summary: 'Drop the workflow and let a single Lambda consumer handle each message.',
          pros: ['Simpler and cheaper for single-step transforms.'],
          cons: ['Retries, branching, and partial failures must be coded by hand.', 'Harder to see where a sync failed.'],
          sourceIds: ['svc-sqs', 'svc-lambda'],
        }
      : {
          title: 'Add Step Functions orchestration',
          summary: 'Wrap processing in a Step Functions workflow when the sync has several steps or approvals.',
          pros: ['Visual execution history and built-in retry and error branches.'],
          cons: ['Extra service and per-transition cost; overkill for single-step transforms.'],
          sourceIds: ['svc-stepfunctions'],
        },
    !orchestrated
      ? addNote(req, CHOICE_NOTES.workflow)
      : avail >= 2
        ? { reason: 'The workflow comes with your downtime answer (almost always up, or stricter), so dropping it would also mean accepting more downtime. Change that answer to compare.' }
        : removeNote(req, CHOICE_NOTES.workflow, WORKFLOW_HINT, integrationText, 'Your own description asks for a multi-step workflow, so the planner keeps it. Edit that wording to compare.'),
  );

  b.openQuestions.push(
    `Does "${sourceName}" support webhooks or an event feed, or must it be polled?`,
    'What happens if the same record is delivered twice, and which system wins when the same record changes in both places?',
  );

  b.steps.push(
    `Set up an AWS account in ${req.region} with IAM roles, billing alerts, and infrastructure as code.`,
    'Document each system\'s API, authentication method, rate limits, and record format; store credentials in Secrets Manager.',
    files ? 'Stand up the SFTP endpoint and S3 landing bucket, then test with sample files.' : 'Create the webhook endpoint and event bus, then send test events from the source.',
    'Build the transform with idempotency checks and a dead-letter queue; test with malformed and duplicate records.',
    onPrem ? 'Work with the network team to establish the Site-to-Site VPN and routes to on-premises targets.' : 'Connect to the target system in a sandbox before production.',
    'Add dashboards and alarms on queue depth, failures, and latency; document the redrive procedure.',
  );

  addCrossCutting(b, req, true);
  return b;
}

/* ------------------------------------------------------------------ */
/* Pattern: AI knowledge assistant                                     */
/* ------------------------------------------------------------------ */

function aiAssistant(req: Requirements): PlanBuilder {
  const b = new PlanBuilder();
  const sens = SENSITIVITY_RANK[req.dataSensitivity];
  const allText = `${req.description}\n${req.existingSystems}`;
  const scanned = SCANNED_HINT.test(allText);
  const needsAuth = sens >= 1;

  b.actor('users', 'Employees', 'People asking questions through the chat interface.');
  b.aws('cdn', 'cloudfront', 'Serves the chat web interface and forwards API calls.', 'edge');
  b.aws('ui', 's3', 'Hosts the built chat front end.', 'data', 'S3 web assets');
  b.aws('api', 'api-gateway', 'HTTPS API for chat requests; enforces authentication and throttling.', 'app');
  b.aws('chat', 'lambda', 'Orchestrates each question: retrieves context, calls the model, and stores the conversation.', 'app', 'Lambda chat handler');
  b.aws('kb', 'bedrock-kb', 'Ingests the document set and retrieves the most relevant passages for each question.', 'ai', 'Bedrock Knowledge Base');
  b.aws('model', 'bedrock', 'Foundation model that writes answers grounded in the retrieved passages.', 'ai', 'Bedrock foundation model');
  b.aws('vectors', 'opensearch-serverless', 'Vector index that the knowledge base searches.', 'ai', 'OpenSearch Serverless vectors');
  b.aws('docs', 's3', 'Source documents for the knowledge base.', 'data', 'S3 document bucket');
  b.aws('history', 'dynamodb', 'Conversation history and user feedback on answers.', 'data', 'DynamoDB chat history');

  b.link('users', 'cdn', 'HTTPS').link('cdn', 'ui', 'static assets').link('cdn', 'api', '/chat').link('api', 'chat');
  b.link('chat', 'kb', 'retrieve').link('chat', 'model', 'generate').link('kb', 'vectors', 'vector search').link('docs', 'kb', 'sync and embed');
  b.link('chat', 'history', 'save turn');

  if (needsAuth) {
    b.aws('auth', 'cognito', 'Employee sign-in; tokens are checked on each chat request.', 'security');
    b.link('users', 'auth', 'sign in').link('api', 'auth', 'verify tokens');
    b.cite('security', 'Require sign-in with a managed identity service before anyone can query internal documents.', 'svc-cognito');
    b.assume('security', 'All signed-in users are assumed to be allowed to see every document in the knowledge base. If access differs by team or role, document-level permissions need their own design.');
  }

  if (scanned) {
    b.aws('ocr', 'textract', 'Extracts text from scanned documents before they are indexed.', 'ai', 'Textract OCR');
    b.link('ocr', 'docs', 'extracted text');
    b.assumptions.push({ text: 'Some documents are scanned images, so text is extracted with Textract before indexing.', field: 'description' });
  }

  const sources = parseSystems(req.existingSystems);
  sources.slice(0, 3).forEach((name, i) => {
    const id = `ext_${i + 1}`;
    b.external(id, name, 'Existing document source exported into the document bucket.');
    b.link(id, scanned && i === 0 ? 'ocr' : 'docs', 'export');
  });
  if (sources.length) {
    b.openQuestions.push(`How will documents leave ${sources.join(', ')}: a supported connector, a scheduled export, or a manual upload?`);
  } else {
    b.assumptions.push({ text: 'No existing document source was named; documents are assumed to be uploaded to S3 directly.', field: 'existingSystems' });
  }

  b.cite('reliability', 'Ground answers in your own documents with retrieval-augmented generation so the model is not relying on what it memorised.', 'svc-bedrock-kb');
  b.cite('operations', 'Review the design against the Well-Architected Generative AI Lens, including how answer quality will be evaluated and monitored.', 'wa-genai-lens');
  b.cite('security', 'Use Amazon Bedrock from inside your AWS account so prompts and documents are handled under your account controls.', 'svc-bedrock', 'wa-security');
  b.assume('security', 'Prompt-injection and data-leakage testing is assumed to be part of the pre-launch plan; this assistant does not evaluate model safety.');
  b.assume('reliability', 'Answers can still be wrong or incomplete. The UI is assumed to show which documents each answer came from and to make that limitation clear to users.');
  b.cite('performance', 'Model choice, prompt size, and how many passages are retrieved drive both latency and cost; measure them with real questions.', 'svc-bedrock', 'wa-performance');
  b.assume('cost', 'Cost drivers: model input and output tokens per question, embedding the document set (and re-embedding on updates), and the vector store\'s baseline capacity, which is billed even at low usage.');
  b.assume('operations', 'Someone must own the document set: removing outdated documents and re-syncing the knowledge base.');

  b.openQuestions.push(
    `Which foundation models are approved for this data, and are they available in ${req.region}? Confirm in the Amazon Bedrock console or documentation before committing.`,
    'Roughly how many documents and pages, in which formats, and how often do they change?',
    'How will answer quality be judged before launch (a test set of real questions with expected answers)?',
  );

  b.dataFlow.push(
    sources.length ? `Documents are exported from ${sources.join(', ')} into the S3 document bucket${scanned ? ' (scanned files pass through Textract first)' : ''}.` : 'Documents are uploaded to the S3 document bucket.',
    'The Bedrock Knowledge Base syncs the bucket, splits documents into chunks, embeds them, and stores vectors in OpenSearch Serverless.',
    needsAuth ? 'An employee signs in with Cognito and asks a question in the web UI.' : 'A user asks a question in the web UI.',
    'API Gateway invokes the chat Lambda, which retrieves relevant passages from the knowledge base.',
    'The Lambda sends the question and passages to a Bedrock foundation model and returns the answer with its source documents.',
    'The conversation turn and any feedback are saved to DynamoDB.',
  );

  b.alt(
    {
      title: 'Amazon Q Business (managed assistant)',
      summary: 'Use a managed generative AI assistant with built-in connectors instead of building retrieval and a chat UI.',
      pros: ['Much less to build and operate.', 'Built-in connectors for many enterprise data sources and a ready-made web experience.'],
      cons: ['Less control over prompts, model choice, and user interface.', 'Different cost model to evaluate against your user count.'],
      sourceIds: ['svc-q-business'],
    },
    { reason: 'It replaces the custom-built assistant with a managed product, and none of your answers selects it, so the planner does not draw it.' },
  );
  b.alt(
    {
      title: 'Custom retrieval without Knowledge Bases',
      summary: 'Write your own chunking, embedding, and retrieval code against the vector store and call the model directly.',
      pros: ['Full control over chunking, ranking, and metadata filtering.'],
      cons: ['Much more code to build, test, and maintain.', 'Ingestion, re-sync, and failure handling become your responsibility.'],
      sourceIds: ['svc-opensearch-serverless', 'svc-bedrock'],
    },
    { reason: 'It wires the same kinds of services together in your own code instead of a managed knowledge base, which the planner does not draw.' },
  );

  b.steps.push(
    `Set up an AWS account in ${req.region}; request access to the approved Bedrock models and confirm they are offered in that Region.`,
    'Collect a representative sample of documents and 30 to 50 real questions with expected answers.',
    'Create the S3 document bucket and a Bedrock Knowledge Base; sync the sample and test retrieval quality.',
    'Build the chat API (API Gateway + Lambda) that retrieves, generates, and returns cited answers.',
    needsAuth ? 'Add Cognito sign-in and confirm who is allowed to see which documents.' : 'Confirm all documents are safe to show to every user.',
    'Build the web UI, add feedback capture, then run the question set and review answers before a pilot.',
  );

  addCrossCutting(b, req, false);
  return b;
}

/* ------------------------------------------------------------------ */
/* Pattern: data pipeline and analytics                                */
/* ------------------------------------------------------------------ */

const pipelineText = (req: Requirements) => `${req.description}\n${req.existingSystems}\n${req.operationsNotes}`;

function dataPipeline(req: Requirements): PlanBuilder {
  const b = new PlanBuilder();
  const sens = SENSITIVITY_RANK[req.dataSensitivity];
  const avail = AVAILABILITY_RANK[req.availability];
  const allText = pipelineText(req);
  const streaming = STREAM_HINT.test(allText);
  const warehouse = WAREHOUSE_HINT.test(allText);
  const sftp = /\bs?ftp\b/i.test(allText);
  const orchestrated = avail >= 2 || WORKFLOW_HINT.test(allText);
  const sources = parseSystems(req.existingSystems).slice(0, 3);

  if (sources.length) {
    sources.forEach((name, i) => b.external(`src_${i + 1}`, name, 'Existing system the data comes from.'));
  } else {
    b.external('src_1', 'Your data sources', 'Applications or teams that produce the data.');
    b.assumptions.push({ text: 'No data source was named, so the plan shows a generic source. List the systems the data comes from to make it specific.', field: 'existingSystems' });
  }
  const srcIds = b.nodes.filter((n) => n.kind === 'external').map((n) => n.id);

  b.aws('raw', 's3', 'Raw zone: data exactly as received, kept unchanged so any load can be checked or re-run.', 'data', 'S3 raw data');
  if (streaming) {
    b.aws('ingest', 'firehose', 'Receives records continuously and delivers them to the raw zone in small batches.', 'integration', 'Data Firehose stream');
    srcIds.forEach((id) => b.link(id, 'ingest', 'send records'));
    b.link('ingest', 'raw', 'deliver batches');
    b.cite('performance', 'Amazon Data Firehose delivers streaming data to Amazon S3 without servers to run, so new records reach the raw zone within minutes.', 'svc-firehose');
  } else if (sftp) {
    b.aws('sftp', 'transfer-family', 'Managed SFTP endpoint so sources can keep sending export files the way they do today.', 'integration');
    srcIds.forEach((id) => b.link(id, 'sftp', 'SFTP upload'));
    b.link('sftp', 'raw');
  } else {
    srcIds.forEach((id) => b.link(id, 'raw', 'export files'));
  }

  b.aws('etl', 'glue', 'Glue jobs clean, combine, and convert raw data into query-ready tables; the Glue Data Catalog records each table\'s structure.', 'data', 'Glue jobs and Data Catalog');
  b.aws('curated', 's3', 'Curated zone: cleaned, combined data organised for queries.', 'data', 'S3 curated data');
  b.aws('schedule', 'eventbridge-scheduler', 'Starts the transform on a schedule (for example every night or every hour).', 'integration', 'EventBridge Scheduler');
  b.link('raw', 'etl', 'read').link('etl', 'curated', 'write tables');
  if (orchestrated) {
    b.aws('flow', 'step-functions', 'Runs the transform steps in order, retries failed steps, and records every run.', 'integration', 'Step Functions workflow');
    b.link('schedule', 'flow', 'start').link('flow', 'etl', 'run jobs');
    b.cite('reliability', 'Run the transform steps in a Step Functions workflow with retry and catch rules so a failed step is retried or reported, not silently skipped.', 'svc-stepfunctions', 'wa-reliability');
  } else {
    b.link('schedule', 'etl', 'start job');
  }

  b.actor('analysts', 'Analysts and managers', 'People who view dashboards and reports.');
  b.aws('dash', 'quick-sight', 'Interactive dashboards and reports for business users.', 'app', 'Quick Sight dashboards');
  b.link('analysts', 'dash', 'view dashboards');
  if (warehouse) {
    b.aws('warehouse', 'redshift-serverless', 'Data warehouse that serves frequent, complex dashboard queries from loaded copies of the curated tables.', 'data', 'Redshift Serverless warehouse');
    b.link('curated', 'warehouse', 'load').link('dash', 'warehouse', 'SQL');
    b.cite('performance', 'Amazon Redshift Serverless runs a data warehouse without managing clusters and can also query data in your S3 data lake.', 'svc-redshift-serverless');
  } else {
    b.aws('query', 'athena', 'Runs SQL directly on the curated data in S3, with no database to run.', 'data', 'Athena queries');
    b.link('dash', 'query', 'SQL').link('query', 'curated', 'read');
    b.cite('performance', 'Amazon Athena queries the data where it sits in Amazon S3 using standard SQL, so there is no database to load or size first.', 'svc-athena');
  }

  b.aws('alerts', 'sns', 'Tells the team when a load or transform fails.', 'operations', 'SNS alerts');
  b.link(orchestrated ? 'flow' : 'etl', 'alerts', 'on failure');

  b.cite('security', 'Keep the data buckets private and give each job, query, and dashboard access only to the data it needs.', 'svc-s3', 'svc-iam', 'wa-security');
  b.assume('security', 'Personal or sensitive fields are assumed to be removed or masked before data reaches the curated zone and dashboards. Confirm which fields analysts may see.');
  if (sens >= 1) {
    b.assume('security', 'Dashboard users are assumed to sign in to Amazon Quick Sight with your organisation\'s accounts. If different people may see different rows (for example only their own store), that needs its own design.');
  }
  b.cite('reliability', 'Keep raw data unchanged in S3 so a faulty transform can be fixed and re-run from the original data instead of asking sources to resend.', 'svc-s3', 'wa-reliability');
  b.assume('reliability', 'Each transform is assumed to be safe to re-run for the same period (re-running a night replaces that night\'s data rather than adding it twice).');
  b.cite('operations', 'Use the Glue Data Catalog as the one description of each table so queries, the warehouse, and dashboards agree on the data.', 'svc-glue');
  b.cite('operations', 'Alarm on failed or missing runs, not only on errors, so a pipeline that silently stops is noticed.', 'svc-cloudwatch', 'wa-operational');
  b.assume('performance', 'Curated data is assumed to be stored in a columnar format such as Parquet and organised by date, which usually reduces how much data each query reads.');
  if (req.expectedUsage === 'high' && !warehouse) {
    b.assume('performance', 'Heavy, all-day use was indicated. If many people run complex dashboards at the same time, compare the data-warehouse alternative.');
  }
  b.assume(
    'cost',
    `Cost drivers: data stored in S3, ${warehouse ? 'warehouse compute while queries run' : 'the amount of data each Athena query scans'}, Glue job run time${streaming ? ', the volume sent through Data Firehose' : ''}, and the number of dashboard users. Little runs between loads, so idle cost is low.`,
  );
  if (sens >= 3) {
    b.cautions.push({
      topic: 'Regulated data in analytics',
      message: 'An analytics store is another copy of regulated data and carries the same obligations. Decide with your compliance owner what must be removed or masked before it reaches the curated zone and dashboards.',
      sourceIds: ['wa-security'],
    });
  }

  const names = sources.length ? sources.map((n) => `"${n}"`).join(', ') : 'each source';
  b.dataFlow.push(
    streaming ? `${names} send records continuously to Amazon Data Firehose, which delivers them to the S3 raw zone.` : sftp ? `${names} upload export files over SFTP into the S3 raw zone.` : `${names} export files into the S3 raw zone.`,
    orchestrated ? 'On schedule, EventBridge Scheduler starts a Step Functions workflow that runs the Glue jobs in order.' : 'On schedule, EventBridge Scheduler starts the Glue job.',
    'Glue jobs clean and combine the raw data, write query-ready tables to the S3 curated zone, and record them in the Glue Data Catalog.',
    warehouse ? 'Curated tables are loaded into Redshift Serverless.' : 'Athena runs SQL directly on the curated tables in S3.',
    `Analysts and managers view Quick Sight dashboards, which query ${warehouse ? 'the warehouse' : 'through Athena'}.`,
    'Failed runs send an SNS alert; logs and metrics go to CloudWatch.',
  );

  b.alt(
    streaming
      ? {
          title: 'Batch file loads instead of streaming',
          summary: 'Have sources export files on a schedule instead of sending every record as it happens.',
          pros: ['Simpler for sources that can only export files.', 'Fewer moving parts and no stream to run.'],
          cons: ['Dashboards are only as fresh as the last load.', 'Large exports can take longer to process in one go.'],
          sourceIds: ['svc-s3', 'svc-glue'],
        }
      : {
          title: 'Stream records continuously (Amazon Data Firehose)',
          summary: 'Have sources send each record as it happens through Data Firehose, so dashboards update within minutes.',
          pros: ['Dashboards can show data within minutes instead of after the next load.', 'No export files to schedule or chase.'],
          cons: ['Every source must be able to send records as they happen.', 'One more managed service, billed by the volume sent.'],
          sourceIds: ['svc-firehose'],
        },
    streaming
      ? removeNote(req, CHOICE_NOTES.stream, STREAM_HINT, pipelineText, 'Your own description asks for continuous or real-time data, so the planner keeps the stream. Edit that wording to compare.')
      : addNote(req, CHOICE_NOTES.stream),
  );
  b.alt(
    warehouse
      ? {
          title: 'Query in place with Amazon Athena',
          summary: 'Drop the warehouse and query the curated data where it sits in S3.',
          pros: ['No warehouse to load, size, or tune.', 'Billed per query, which suits occasional use.'],
          cons: ['Complex queries from many users at once can be slower.', 'Each query\'s cost depends on how much data it scans.'],
          sourceIds: ['svc-athena'],
        }
      : {
          title: 'Data warehouse (Amazon Redshift Serverless)',
          summary: 'Load the curated data into a serverless data warehouse for dashboards that many people use all day.',
          pros: ['Better suited to frequent, complex queries from many users.', 'Familiar data-warehouse features for analysts.'],
          cons: ['Data has to be loaded into the warehouse, which adds a step.', 'Billed for warehouse compute while queries run, and more to tune than Athena.'],
          sourceIds: ['svc-redshift-serverless'],
        },
    warehouse
      ? removeNote(req, CHOICE_NOTES.warehouse, WAREHOUSE_HINT, pipelineText, 'Your own description asks for a data warehouse, so the planner keeps it. Edit that wording to compare.')
      : addNote(req, CHOICE_NOTES.warehouse),
  );

  b.openQuestions.push(
    'How fresh must the dashboards be: updated nightly, hourly, or within minutes?',
    'Roughly how much data arrives each day, and how long must the raw data be kept?',
    sources.length ? `How can data leave ${sources.join(', ')}: scheduled exports, an API, or a database connection?` : 'Which systems does the data come from, and how can it leave them: exports, an API, or a database connection?',
    'Who may see which data in the dashboards, and does anything need to be removed or masked first?',
  );

  b.steps.push(
    `Set up an AWS account in ${req.region} with IAM roles, billing alerts, and infrastructure as code.`,
    'List each data source: what it sends, how often, who owns it, and which fields are sensitive.',
    streaming ? 'Create the Data Firehose stream and have one source send test records into the raw zone.' : 'Create the raw-zone bucket and load one sample export from each source.',
    'Write the Glue transform for one source, register its tables in the Glue Data Catalog, and check the curated output.',
    warehouse ? 'Load the curated tables into Redshift Serverless and test the heaviest dashboard queries.' : 'Query the curated tables with Athena and check the numbers against the source systems.',
    'Build the first Quick Sight dashboard with a few real users, then schedule the pipeline and add failure alerts.',
    'Run a Well-Architected review of the result before relying on it.',
  );

  addCrossCutting(b, req, true);
  return b;
}

/* ------------------------------------------------------------------ */
/* Pattern: scheduled and batch jobs                                   */
/* ------------------------------------------------------------------ */

const jobsText = (req: Requirements) => `${req.description}\n${req.operationsNotes}`;

/** From AWS Batch to one Fargate task: drop the parallel-jobs sentence, and keep the run on a container (not Lambda) by noting it is long. */
function singleTask(req: Requirements, long: boolean): AlternativeSpec {
  const spec = removeNote(req, CHOICE_NOTES.parallel, PARALLEL_HINT, jobsText, 'Your own description asks for many parallel jobs, so the planner keeps AWS Batch. Edit that wording to compare.');
  if (!('changes' in spec) || long || req.operations === 'containers') return spec;
  const without = spec.changes[0].value;
  const value = without ? `${without} ${CHOICE_NOTES.long}` : CHOICE_NOTES.long;
  if (value.length > NOTES_MAX) return { reason: `Selecting it means adding a sentence to "Anything else we should know?", and that answer is already close to its ${NOTES_MAX}-character limit.` };
  return { changes: [{ field: 'operationsNotes', value, summary: `replaces "${CHOICE_NOTES.parallel}" with "${CHOICE_NOTES.long}"` }] };
}

function scheduledJobs(req: Requirements): PlanBuilder {
  const b = new PlanBuilder();
  const allText = jobsText(req);
  const parallel = PARALLEL_HINT.test(allText);
  const long = LONG_HINT.test(allText);
  const compute: 'lambda' | 'fargate' | 'batch' = parallel ? 'batch' : long || req.operations === 'containers' ? 'fargate' : 'lambda';
  const multiStep = WORKFLOW_HINT.test(allText);
  const files = JOB_FILE_HINT.test(allText);
  const sync = SYNC_HINT.test(allText);
  const onPrem = ONPREM_HINT.test(`${allText}\n${req.existingSystems}`);
  const systems = parseSystems(req.existingSystems).slice(0, 3);

  b.aws('schedule', 'eventbridge-scheduler', 'Starts each run at the set time (cron or rate schedule, in your time zone), with a retry limit if the start fails.', 'integration', 'EventBridge Scheduler');
  if (compute === 'lambda') {
    b.aws('job', 'lambda', 'Runs the job code; suits jobs that finish within 15 minutes.', 'app', 'Lambda job');
    b.cite('performance', 'A Lambda function runs for up to 15 minutes per invocation by default, so jobs that can run longer belong in a container task or AWS Batch.', 'svc-lambda');
  } else if (compute === 'fargate') {
    b.aws('job', 'ecs-fargate', 'Runs the job as a container task that starts for each run and stops when it finishes; no 15-minute limit.', 'app', 'ECS Fargate task');
    b.cite('performance', 'Run the job as a standalone ECS task on AWS Fargate and size its CPU and memory from a real run.', 'svc-ecs');
  } else {
    b.aws('job', 'batch', 'Queues the run\'s jobs and scales the compute that runs them in parallel.', 'app', 'AWS Batch jobs');
    b.cite('performance', 'AWS Batch queues jobs and scales compute capacity to run them, including on AWS Fargate, so large runs finish without a fixed fleet.', 'svc-batch');
  }
  if (compute !== 'lambda') {
    b.aws('network', 'vpc', 'Private subnets where the job containers run.', 'security', 'VPC (private subnets)');
    b.cite('security', 'Run job containers in private subnets and allow only the outbound access each job needs.', 'svc-vpc');
  }

  if (multiStep) {
    b.aws('flow', 'step-functions', 'Runs the job\'s steps in order, retries a failed step, and records every run.', 'integration', 'Step Functions workflow');
    b.link('schedule', 'flow', 'start run').link('flow', 'job', 'run step');
    b.cite('reliability', 'Model the steps as a Step Functions workflow with retry and catch rules so a failed step is retried or reported, and every run is visible.', 'svc-stepfunctions', 'wa-reliability');
  } else {
    b.link('schedule', 'job', 'start run');
  }
  const runner = multiStep ? 'flow' : 'job';

  b.aws('dlq', 'sqs', 'Holds runs or files that still failed after retries, for inspection and re-run.', 'integration', 'SQS dead-letter queue');
  if (files) {
    b.aws('inbox', 's3', 'Incoming files; each new file is queued for processing.', 'data', 'S3 incoming files');
    b.aws('queue', 'sqs', 'One message per file so each is processed once and retried if it fails.', 'integration', 'SQS file queue');
    b.link('inbox', 'queue', 'new file').link('queue', 'job', 'next file').link('queue', 'dlq', 'after retries');
    b.cite('reliability', 'Queue one message per file and send files that keep failing to a dead-letter queue instead of dropping them.', 'svc-sqs', 'wa-reliability');
  } else {
    b.link('schedule', 'dlq', 'failed starts');
    b.cite('reliability', 'Send runs that keep failing to a dead-letter queue instead of dropping them, and alarm on it.', 'svc-sqs', 'wa-reliability');
  }
  b.cite('reliability', 'Set a retry limit and a maximum retention time on each schedule so a temporary problem does not silently skip a run.', 'svc-eventbridge-scheduler');

  b.aws('output', 's3', 'Results of each run, such as generated reports or processed files.', 'data', 'S3 job output');
  b.link('job', 'output', 'write results');
  if (sync) {
    b.aws('state', 'dynamodb', 'Records each run and the last successful checkpoint so a re-run picks up where the last one stopped.', 'data', 'DynamoDB run history');
    b.link('job', 'state', 'checkpoint');
  }

  if (onPrem) {
    if (!b.has('network')) b.aws('network', 'vpc', 'VPC that hosts the job so it can reach on-premises systems privately.', 'security', 'VPC');
    b.aws('vpn', 'site-to-site-vpn', 'Encrypted tunnel from the VPC to the on-premises network.', 'integration', 'Site-to-Site VPN');
    b.cite('security', 'Reach on-premises systems over an encrypted Site-to-Site VPN rather than exposing them to the internet.', 'svc-site-to-site-vpn', 'svc-vpc');
    b.openQuestions.push('Which on-premises systems does the job need to reach, and can your network team support a VPN tunnel?');
  }
  systems.forEach((name, i) => {
    const id = `ext_${i + 1}`;
    b.external(id, name, 'Existing system the job reads from or writes to.');
    if (onPrem && ONPREM_HINT.test(name)) b.link('job', 'vpn', 'private').link('vpn', id, 'read / write');
    else b.link('job', id, 'read / write');
  });
  if (onPrem && !b.connections.some((c) => c.from === 'vpn')) b.link('job', 'vpn', 'private');
  if (systems.length) {
    b.aws('secrets', 'secrets-manager', 'Stores the credentials the job uses to reach your existing systems.', 'security');
    b.link('job', 'secrets', 'credentials');
    b.cite('security', 'Keep the credentials for your existing systems in Secrets Manager and let each job read only its own.', 'svc-secretsmanager', 'wa-security');
  } else {
    b.assumptions.push({ text: 'No existing system was named, so the job is assumed to work only with data in AWS. List the systems it reads from or writes to if that is wrong.', field: 'existingSystems' });
  }

  b.aws('notify', 'sns', 'Emails or messages the team when a run fails and, if wanted, when results are ready.', 'operations', 'SNS notifications');
  b.link(runner, 'notify', 'success / failure').link('dlq', 'notify', 'alarm');

  b.cite('security', 'Give each job its own IAM role that can reach only the data and secrets it uses.', 'svc-iam', 'wa-security');
  b.assume('reliability', 'Each job is assumed safe to re-run: running the same night twice must not double-count data or send duplicate messages.');
  b.cite('operations', 'Alarm when a scheduled run fails or does not happen at all, not only when the code reports an error.', 'svc-cloudwatch', 'wa-operational');
  b.assume('operations', 'Someone is assumed to own each job: reading failure notifications, re-running failed runs, and keeping the schedule current.');
  b.assume(
    'cost',
    `Cost drivers: how often and how long the job runs, the ${compute === 'lambda' ? 'function memory' : 'container CPU and memory'}, data stored, and notifications sent. Nothing runs between jobs, so idle cost is low${compute === 'lambda' ? '' : ', apart from networking such as NAT gateways that container jobs in private subnets may need'}.`,
  );

  const computeName = compute === 'lambda' ? 'a Lambda function' : compute === 'fargate' ? 'an ECS task on Fargate' : 'AWS Batch';
  b.dataFlow.push(
    multiStep ? 'At the scheduled time, EventBridge Scheduler starts a Step Functions workflow.' : `At the scheduled time, EventBridge Scheduler starts ${computeName}.`,
    multiStep ? `The workflow runs each step in ${computeName} in order, retrying a step that fails.` : 'If the start fails, the scheduler retries; starts that still fail go to the dead-letter queue.',
    files ? 'Each new file in the incoming bucket is queued; the job takes files from the queue, and files that keep failing go to the dead-letter queue.' : systems.length ? `The job reads from or writes to ${systems.map((n) => `"${n}"`).join(', ')}, using credentials from Secrets Manager.` : 'The job reads and writes its data in AWS.',
    `Results are written to the S3 output bucket${sync ? ', and the run and its checkpoint are recorded in DynamoDB' : ''}.`,
    'SNS tells the team when a run fails (and, if wanted, when results are ready); logs and metrics go to CloudWatch.',
  );

  const reverseCompute: AlternativeSpec =
    req.operations === 'containers' && !long
      ? { reason: 'The planner uses a container task because your team already uses containers. Change "Who will look after it day to day?" to compare.' }
      : removeNote(req, CHOICE_NOTES.long, LONG_HINT, jobsText, 'Your own description says runs can take longer than 15 minutes, which is more than a Lambda function allows, so the planner keeps the container task.');
  if (compute === 'lambda') {
    b.alt(
      {
        title: 'Container task (ECS on Fargate) for long jobs',
        summary: 'Run the job as a container task that starts for each run and stops when it finishes.',
        pros: ['No 15-minute limit on a run.', 'Existing scripts and tools can be packaged in a container as they are.'],
        cons: ['Slower to start than a function.', 'A container image, VPC, and networking to look after.'],
        sourceIds: ['svc-ecs', 'svc-lambda'],
      },
      addNote(req, CHOICE_NOTES.long),
    );
  } else if (compute === 'fargate') {
    b.alt(
      {
        title: 'Lambda function for short jobs',
        summary: 'Run the job as a function when every run finishes well within 15 minutes.',
        pros: ['Nothing to package or network: just the code.', 'Starts quickly and scales with the work.'],
        cons: ['A run cannot last longer than 15 minutes.', 'Large dependencies and memory-hungry jobs fit less well.'],
        sourceIds: ['svc-lambda'],
      },
      reverseCompute,
    );
  } else {
    b.alt(
      {
        title: 'Single container task (ECS on Fargate)',
        summary: 'Run each job as one container task instead of queueing many parallel jobs.',
        pros: ['Simpler: one task per run, no job queue or compute environment.', 'Easier to follow a run from start to end.'],
        cons: ['One task does all the work, so large runs take longer.', 'No built-in queueing of many jobs.'],
        sourceIds: ['svc-ecs'],
      },
      singleTask(req, long),
    );
  }
  if (compute !== 'batch') {
    b.alt(
      {
        title: 'AWS Batch for many parallel jobs',
        summary: 'Split each run into many jobs that AWS Batch queues and runs in parallel.',
        pros: ['Large runs finish sooner by spreading work across many containers.', 'Job queues, retries, and compute scaling are managed for you.'],
        cons: ['More concepts to learn: job definitions, queues, compute environments.', 'Overkill for a job that one task handles comfortably.'],
        sourceIds: ['svc-batch'],
      },
      addNote(req, CHOICE_NOTES.parallel),
    );
  }
  b.alt(
    multiStep
      ? {
          title: 'One job without a workflow',
          summary: 'Drop Step Functions and let the job run all its steps itself.',
          pros: ['Fewer moving parts for a job that is really one step.'],
          cons: ['Retries, partial failures, and run history must be coded by hand.', 'Harder to see which step failed.'],
          sourceIds: [compute === 'lambda' ? 'svc-lambda' : compute === 'fargate' ? 'svc-ecs' : 'svc-batch'],
        }
      : {
          title: 'Add Step Functions for multi-step jobs',
          summary: 'Wrap the job in a Step Functions workflow when a run has several steps that must happen in order.',
          pros: ['Each step is retried on its own, and every run has a visible history.', 'Steps can be added or changed without rewriting the job.'],
          cons: ['Another service to learn; overkill for a single-step job.'],
          sourceIds: ['svc-stepfunctions'],
        },
    multiStep
      ? removeNote(req, CHOICE_NOTES.workflow, WORKFLOW_HINT, jobsText, 'Your own description asks for a multi-step workflow, so the planner keeps it. Edit that wording to compare.')
      : addNote(req, CHOICE_NOTES.workflow),
  );

  b.openQuestions.push(
    'When should each job run, in which time zone, and what should happen if a run is missed: skip it or catch up?',
    'How long does the job take today, and how much data does one run handle?',
    'Who should be told when a run fails, and how quickly must someone respond?',
  );
  if (systems.length) b.openQuestions.push(`How does the job connect to ${systems.join(', ')}: an API, a database connection, or file exports?`);

  b.steps.push(
    `Set up an AWS account in ${req.region} with IAM roles, billing alerts, and infrastructure as code.`,
    'Write down each job: when it runs, how long it takes today, what it reads and writes, and who must hear when it fails.',
    compute === 'lambda' ? 'Build the job as a Lambda function and run it by hand against test data.' : compute === 'fargate' ? 'Package the job as a container image, define the ECS task, and run it by hand against test data.' : 'Package the job as a container image, create the AWS Batch job definition and queue, and run a small batch by hand.',
    multiStep ? 'Model the steps as a Step Functions workflow with retries on each step.' : 'Make the job safe to re-run, then test a failure and a re-run.',
    'Create the EventBridge Scheduler schedule (with its time zone), a retry limit, and the dead-letter queue.',
    'Subscribe the team to the SNS notifications, alarm on failed or missed runs, and document how to re-run a job.',
    'Run a Well-Architected review of the result before relying on it.',
  );

  addCrossCutting(b, req, sync);
  return b;
}

/* ------------------------------------------------------------------ */

const TITLES = {
  web_app: 'Web application',
  integration: 'Integration between existing systems',
  ai_assistant: 'AI knowledge assistant',
  data_pipeline: 'Data pipeline and analytics',
  scheduled_jobs: 'Scheduled and batch jobs',
} as const;

const PATTERNS: Record<keyof typeof TITLES, (req: Requirements) => PlanBuilder> = {
  web_app: webApp,
  integration,
  ai_assistant: aiAssistant,
  data_pipeline: dataPipeline,
  scheduled_jobs: scheduledJobs,
};

const hasPattern = (type: string): type is keyof typeof TITLES => Object.hasOwn(PATTERNS, type);

function build(input: Requirements): { req: Requirements; b: PlanBuilder; type: keyof typeof TITLES } {
  const req = resolveUnsure(input);
  if (!hasPattern(req.workloadType)) {
    throw new Error(`Demo mode has no template for workload type "${req.workloadType}"`);
  }
  return { req, b: PATTERNS[req.workloadType](req), type: req.workloadType };
}

export function buildDemoPlan(input: Requirements): Plan {
  const { req, b, type } = build(input);
  const awsCount = b.nodes.filter((n) => n.kind === 'aws').length;

  return {
    title: `${TITLES[type]} on AWS (${req.region})`,
    summary: `A starting-point design for: ${quote(req.description, 700)} It uses ${awsCount} components from the supported catalog, sized for ${USAGE_TEXT[req.expectedUsage]} usage, ${req.dataSensitivity} data, and a ${req.availability.replace('_', ' ')} availability target. Review the assumptions and open questions before relying on it; it is not production-ready.`,
    nodes: b.nodes,
    connections: b.connections,
    dataFlow: b.dataFlow,
    assumptions: b.assumptions,
    openQuestions: b.openQuestions,
    considerations: b.considerations,
    alternatives: b.alternatives,
    implementationSteps: b.steps,
    cautions: b.cautions,
  };
}

/** How each alternative in the demo plan can be drawn (requirement changes), or why it cannot. Keyed by alternative title. */
export function buildDemoAlternativeSpecs(input: Requirements): Record<string, AlternativeSpec> {
  return build(input).b.altSpecs;
}

export class DemoProvider implements ArchitectureProvider {
  readonly name = 'demo';

  preflight(req: Requirements): FollowUpQuestion[] {
    if (req.workloadType === 'other') {
      return [
        {
          field: 'workloadType',
          question:
            'Demo mode only has reviewed templates for a web application, an integration between existing systems, an AI knowledge assistant, a data pipeline for reports and dashboards, or jobs that run on a schedule. Which of these is closest to what you need?',
          why: 'Without a matching template the assistant would be guessing, so it asks instead.',
        },
      ];
    }
    return [];
  }

  async generatePlan(req: Requirements): Promise<unknown> {
    return buildDemoPlan(req);
  }

  alternativeSpecs(req: Requirements): Record<string, AlternativeSpec> {
    return buildDemoAlternativeSpecs(req);
  }
}
