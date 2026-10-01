import type { SourceId } from './sources';

/**
 * Supported AWS component catalog. A plan may only place AWS components whose
 * `serviceId` appears here; anything else is flagged and removed from the
 * diagram by validation.
 *
 * `summary` is a short, general description of the service. Each entry points
 * at the official overview page it was written from.
 */

export type ServiceCategory =
  | 'edge'
  | 'compute'
  | 'data'
  | 'integration'
  | 'ai'
  | 'security'
  | 'operations'
  | 'network';

export interface CatalogService {
  id: string;
  name: string;
  category: ServiceCategory;
  summary: string;
  sourceIds: SourceId[];
}

const c = (
  id: string,
  name: string,
  category: ServiceCategory,
  summary: string,
  sourceIds: SourceId[],
): CatalogService => ({ id, name, category, summary, sourceIds });

export const CATALOG: readonly CatalogService[] = [
  // Edge and delivery
  c('cloudfront', 'Amazon CloudFront', 'edge', 'Content delivery network that caches and serves content from edge locations close to users.', ['svc-cloudfront']),
  c('route53', 'Amazon Route 53', 'edge', 'DNS service for routing users to application endpoints.', ['svc-route53']),
  c('waf', 'AWS WAF', 'security', 'Web application firewall that filters HTTP(S) requests to protected resources using rules.', ['svc-waf']),
  c('amplify-hosting', 'AWS Amplify Hosting', 'edge', 'Managed hosting and CI/CD for static and server-rendered web front ends.', ['svc-amplify']),

  // Compute and APIs
  c('api-gateway', 'Amazon API Gateway', 'compute', 'Managed service for creating, securing, and operating HTTP, REST, and WebSocket APIs.', ['svc-apigateway']),
  c('lambda', 'AWS Lambda', 'compute', 'Runs code in response to events without provisioning or managing servers.', ['svc-lambda']),
  c('ecs-fargate', 'Amazon ECS on AWS Fargate', 'compute', 'Runs containerized services without managing the underlying servers.', ['svc-ecs']),
  c('ec2', 'Amazon EC2', 'compute', 'Resizable virtual servers when full control over the operating system is required.', ['svc-ec2']),
  c('alb', 'Application Load Balancer', 'network', 'Distributes HTTP(S) traffic across targets such as containers or instances in multiple Availability Zones.', ['svc-alb']),

  // Data
  c('s3', 'Amazon S3', 'data', 'Object storage for files, static assets, documents, and archives.', ['svc-s3']),
  c('dynamodb', 'Amazon DynamoDB', 'data', 'Serverless key-value and document database.', ['svc-dynamodb']),
  c('rds', 'Amazon RDS', 'data', 'Managed relational database (for example PostgreSQL or MySQL).', ['svc-rds']),
  c('aurora', 'Amazon Aurora', 'data', 'MySQL- and PostgreSQL-compatible managed relational database.', ['svc-aurora']),
  c('elasticache', 'Amazon ElastiCache', 'data', 'Managed in-memory cache to reduce latency and database load.', ['svc-elasticache']),
  c('glue', 'AWS Glue', 'data', 'Serverless data integration (ETL) service for preparing and moving data.', ['svc-glue']),
  c('athena', 'Amazon Athena', 'data', 'Serverless SQL queries over data stored in Amazon S3.', ['svc-athena']),

  // Integration
  c('eventbridge', 'Amazon EventBridge', 'integration', 'Serverless event bus and scheduler that routes events between applications and services.', ['svc-eventbridge']),
  c('sqs', 'Amazon SQS', 'integration', 'Managed message queues that decouple producers from consumers.', ['svc-sqs']),
  c('sns', 'Amazon SNS', 'integration', 'Publish/subscribe messaging and notifications.', ['svc-sns']),
  c('step-functions', 'AWS Step Functions', 'integration', 'Visual workflow orchestration with built-in retries and error handling.', ['svc-stepfunctions']),
  c('appflow', 'Amazon AppFlow', 'integration', 'Managed data flows between supported SaaS applications and AWS services.', ['svc-appflow']),
  c('transfer-family', 'AWS Transfer Family', 'integration', 'Managed SFTP/FTPS/FTP endpoints for file exchange into Amazon S3 or Amazon EFS.', ['svc-transfer']),
  c('datasync', 'AWS DataSync', 'integration', 'Online data movement between on-premises storage and AWS storage services.', ['svc-datasync']),

  // AI
  c('bedrock', 'Amazon Bedrock', 'ai', 'Managed access to foundation models through an API.', ['svc-bedrock']),
  c('bedrock-kb', 'Amazon Bedrock Knowledge Bases', 'ai', 'Managed retrieval-augmented generation (RAG): ingests documents and retrieves relevant passages for model responses.', ['svc-bedrock-kb']),
  c('opensearch-serverless', 'Amazon OpenSearch Serverless', 'ai', 'Serverless search and vector store collections.', ['svc-opensearch-serverless']),
  c('textract', 'Amazon Textract', 'ai', 'Extracts text and data from scanned documents.', ['svc-textract']),
  c('q-business', 'Amazon Q Business', 'ai', 'Managed generative AI assistant that answers questions over connected enterprise data.', ['svc-q-business']),

  // Security and identity
  c('cognito', 'Amazon Cognito', 'security', 'User sign-up, sign-in, and access control for web and mobile apps.', ['svc-cognito']),
  c('iam', 'AWS IAM', 'security', 'Controls who and what can access AWS resources, using least-privilege policies.', ['svc-iam']),
  c('kms', 'AWS KMS', 'security', 'Creates and controls the keys used to encrypt data.', ['svc-kms']),
  c('secrets-manager', 'AWS Secrets Manager', 'security', 'Stores and rotates credentials such as database passwords and API keys.', ['svc-secretsmanager']),
  c('guardduty', 'Amazon GuardDuty', 'security', 'Threat detection that monitors accounts and workloads for suspicious activity.', ['svc-guardduty']),

  // Operations
  c('cloudwatch', 'Amazon CloudWatch', 'operations', 'Metrics, logs, dashboards, and alarms for monitoring resources and applications.', ['svc-cloudwatch']),
  c('xray', 'AWS X-Ray', 'operations', 'Distributed tracing to follow requests across services.', ['svc-xray']),
  c('cloudtrail', 'AWS CloudTrail', 'operations', 'Records account activity and API calls for auditing.', ['svc-cloudtrail']),
  c('backup', 'AWS Backup', 'operations', 'Centralized, policy-based backups across AWS services.', ['svc-backup']),
  c('cloudformation', 'AWS CloudFormation', 'operations', 'Infrastructure as code: provisions resources from templates.', ['svc-cloudformation']),
  c('systems-manager', 'AWS Systems Manager', 'operations', 'Operational management for resources, including parameters and patching.', ['svc-systems-manager']),

  // Network
  c('vpc', 'Amazon VPC', 'network', 'Logically isolated virtual network for AWS resources.', ['svc-vpc']),
  c('site-to-site-vpn', 'AWS Site-to-Site VPN', 'network', 'Encrypted connection between an on-premises network and a VPC.', ['svc-site-to-site-vpn']),
];

const CATALOG_MAP: ReadonlyMap<string, CatalogService> = new Map(CATALOG.map((svc) => [svc.id, svc]));

export function getService(id: string): CatalogService | undefined {
  return CATALOG_MAP.get(id);
}

export function isSupportedService(id: string): boolean {
  return CATALOG_MAP.has(id);
}
