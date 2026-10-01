import { getService } from './catalog';
import type { ArchitectureProvider } from './provider';
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

const SENSITIVITY_RANK = { '': 0, public: 0, internal: 1, confidential: 2, regulated: 3 } as const;
const AVAILABILITY_RANK = { '': 0, best_effort: 0, business_hours: 1, high: 2, mission_critical: 3 } as const;

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

class PlanBuilder {
  nodes: PlanNode[] = [];
  connections: Connection[] = [];
  considerations: Record<Pillar, Claim[]> = { security: [], reliability: [], performance: [], operations: [], cost: [] };
  assumptions: Assumption[] = [];
  openQuestions: string[] = [];
  cautions: Caution[] = [];
  alternatives: Alternative[] = [];
  dataFlow: string[] = [];
  steps: string[] = [];

  aws(id: string, serviceId: string, role: string, tier: PlanNode['tier'], label?: string): this {
    const svc = getService(serviceId);
    if (!svc) throw new Error(`Demo template references unknown catalog service "${serviceId}"`);
    this.nodes.push({ id, kind: 'aws', serviceId, label: label ?? svc.name, role, tier, sourceIds: [...svc.sourceIds] });
    return this;
  }

  external(id: string, label: string, role: string): this {
    this.nodes.push({ id, kind: 'external', label, role, tier: 'external', sourceIds: [] });
    return this;
  }

  actor(id: string, label: string, role: string): this {
    this.nodes.push({ id, kind: 'actor', label, role, tier: 'users', sourceIds: [] });
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
    .map((p) => p.trim().replace(/^[-*]\s*/, ''))
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
    b.assumptions.push({ text: `Recovery targets taken from your notes: "${req.recoveryNotes.trim()}". The design has not been verified against them.`, field: 'recoveryNotes' });
  } else {
    b.openQuestions.push('What are the recovery point objective (RPO) and recovery time objective (RTO)? They decide the disaster-recovery strategy.');
    b.assumptions.push({
      text:
        avail >= 2
          ? 'No RPO/RTO given; assumed that Multi-AZ resilience within one Region plus backups is acceptable.'
          : 'No RPO/RTO given; assumed that restoring from backups within hours is acceptable.',
      field: 'recoveryNotes',
    });
  }
  b.cite('reliability', 'Choose a disaster-recovery strategy (backup and restore, pilot light, warm standby, or multi-site) from agreed RPO/RTO targets.', 'wp-disaster-recovery');

  if (!req.usageNotes.trim()) {
    b.openQuestions.push('Roughly how many users, requests per day, or GB of data do you expect at launch and at peak?');
    b.assumptions.push({ text: `Usage assumed to be ${USAGE_TEXT[req.expectedUsage] ?? 'unspecified'} with no specific numbers provided.`, field: 'usageNotes' });
  } else {
    b.assumptions.push({ text: `Usage based on your notes: "${req.usageNotes.trim()}".`, field: 'usageNotes' });
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
    b.assumptions.push({ text: `Constraint noted: "${req.operationsNotes.trim()}".`, field: 'operationsNotes' });
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
    b.alternatives.push({
      title: 'Serverless API (API Gateway + Lambda + DynamoDB)',
      summary: 'Replace the load balancer, containers, and relational database with a managed API, functions, and a serverless database.',
      pros: ['Scales to zero when idle, so low or spiky usage costs less.', 'No containers or database instances to patch or size.'],
      cons: ['Requires designing data access around DynamoDB keys instead of SQL joins.', 'Per-request pricing can cost more than containers at sustained high volume.', 'Function cold starts may add latency to some requests.'],
      sourceIds: ['svc-apigateway', 'svc-lambda', 'svc-dynamodb', 'wa-serverless-lens'],
    });
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
    b.alternatives.push({
      title: 'Containers (ALB + ECS Fargate + RDS)',
      summary: 'Run the backend as containers behind a load balancer with a managed relational database.',
      pros: ['Familiar SQL data model and frameworks; easy to port an existing app.', 'Predictable cost at sustained high load.', 'No function duration limits.'],
      cons: ['Load balancer, tasks, and database cost money even when idle.', 'More to operate: VPC design, scaling policies, database sizing and maintenance windows.'],
      sourceIds: ['svc-alb', 'svc-ecs', 'svc-rds'],
    });
  }

  b.cite('performance', 'Cache static assets at the edge with CloudFront to reduce latency for distant users and load on the origin.', 'svc-cloudfront', 'wa-performance');
  b.alternatives.push({
    title: 'AWS Amplify Hosting for the front end',
    summary: 'Use Amplify Hosting for build, deploy, and hosting of the front end instead of wiring S3 and CloudFront yourself.',
    pros: ['Built-in CI/CD from a Git repository and preview environments.', 'Less configuration for a small team.'],
    cons: ['Less fine-grained control over caching and edge behaviour.', 'Another service and deployment model to learn.'],
    sourceIds: ['svc-amplify'],
  });

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

function integration(req: Requirements): PlanBuilder {
  const b = new PlanBuilder();
  const avail = AVAILABILITY_RANK[req.availability];
  const allText = `${req.description}\n${req.existingSystems}\n${req.operationsNotes}`;
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

  b.alternatives.push(
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
  );
  b.alternatives.push(
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

  b.alternatives.push(
    {
      title: 'Amazon Q Business (managed assistant)',
      summary: 'Use a managed generative AI assistant with built-in connectors instead of building retrieval and a chat UI.',
      pros: ['Much less to build and operate.', 'Built-in connectors for many enterprise data sources and a ready-made web experience.'],
      cons: ['Less control over prompts, model choice, and user interface.', 'Different cost model to evaluate against your user count.'],
      sourceIds: ['svc-q-business'],
    },
    {
      title: 'Custom retrieval without Knowledge Bases',
      summary: 'Write your own chunking, embedding, and retrieval code against the vector store and call the model directly.',
      pros: ['Full control over chunking, ranking, and metadata filtering.'],
      cons: ['Much more code to build, test, and maintain.', 'Ingestion, re-sync, and failure handling become your responsibility.'],
      sourceIds: ['svc-opensearch-serverless', 'svc-bedrock'],
    },
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

const TITLES = {
  web_app: 'Web application',
  integration: 'Integration between existing systems',
  ai_assistant: 'AI knowledge assistant',
} as const;

export function buildDemoPlan(req: Requirements): Plan {
  if (req.workloadType !== 'web_app' && req.workloadType !== 'integration' && req.workloadType !== 'ai_assistant') {
    throw new Error(`Demo mode has no template for workload type "${req.workloadType}"`);
  }
  const b = req.workloadType === 'web_app' ? webApp(req) : req.workloadType === 'integration' ? integration(req) : aiAssistant(req);
  const awsCount = b.nodes.filter((n) => n.kind === 'aws').length;

  return {
    title: `${TITLES[req.workloadType]} on AWS (${req.region})`,
    summary: `A starting-point design for: ${req.description.trim()} It uses ${awsCount} components from the supported catalog, sized for ${USAGE_TEXT[req.expectedUsage]} usage, ${req.dataSensitivity} data, and a ${req.availability.replace('_', ' ')} availability target. Review the assumptions and open questions before relying on it; it is not production-ready.`,
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

export class DemoProvider implements ArchitectureProvider {
  readonly name = 'demo';

  preflight(req: Requirements): FollowUpQuestion[] {
    if (req.workloadType === 'other') {
      return [
        {
          field: 'workloadType',
          question:
            'Demo mode only has reviewed templates for a web application, an integration between existing systems, or an AI knowledge assistant. Which of these is closest to what you need?',
          why: 'Without a matching template the assistant would be guessing, so it asks instead.',
        },
      ];
    }
    return [];
  }

  async generatePlan(req: Requirements): Promise<unknown> {
    return buildDemoPlan(req);
  }
}
