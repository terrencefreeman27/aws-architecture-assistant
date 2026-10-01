/**
 * Curated registry of official AWS sources.
 *
 * Rules:
 * - Only official AWS documentation URLs (docs.aws.amazon.com).
 * - Every URL here was fetched and returned HTTP 200 with the listed page
 *   title on the `verifiedOn` date. Do not add a URL without doing the same.
 * - Plans cite sources by `id` only. A citation to an id that is not in this
 *   registry is treated as fabricated and is stripped by validation.
 */

export type SourceKind = 'well-architected' | 'whitepaper' | 'service-docs' | 'tooling';

export interface Source {
  id: string;
  title: string;
  url: string;
  kind: SourceKind;
  verifiedOn: string;
}

const VERIFIED = '2026-10-01';

const s = (id: string, title: string, url: string, kind: SourceKind): Source => ({
  id,
  title,
  url,
  kind,
  verifiedOn: VERIFIED,
});

export const SOURCES = [
  // AWS Well-Architected Framework and pillars
  s('wa-framework', 'AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html', 'well-architected'),
  s('wa-pillars', 'The pillars of the framework (Well-Architected)', 'https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html', 'well-architected'),
  s('wa-security', 'Security Pillar - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html', 'well-architected'),
  s('wa-reliability', 'Reliability Pillar - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html', 'well-architected'),
  s('wa-performance', 'Performance Efficiency Pillar - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html', 'well-architected'),
  s('wa-cost', 'Cost Optimization Pillar - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html', 'well-architected'),
  s('wa-operational', 'Operational Excellence Pillar - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html', 'well-architected'),
  s('wa-sustainability', 'Sustainability Pillar - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/sustainability-pillar/sustainability-pillar.html', 'well-architected'),
  s('wa-serverless-lens', 'Serverless Applications Lens - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html', 'well-architected'),
  s('wa-genai-lens', 'Generative AI Lens - AWS Well-Architected Framework', 'https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/generative-ai-lens.html', 'well-architected'),

  // Whitepapers
  s('wp-disaster-recovery', 'Disaster Recovery of Workloads on AWS: Recovery in the Cloud', 'https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-workloads-on-aws.html', 'whitepaper'),
  s('wp-fault-isolation', 'AWS Fault Isolation Boundaries', 'https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/abstract-and-introduction.html', 'whitepaper'),
  s('wp-aws-overview', 'Overview of Amazon Web Services', 'https://docs.aws.amazon.com/whitepapers/latest/aws-overview/introduction.html', 'whitepaper'),

  // Cost tooling (referenced for "how to estimate", never for numbers)
  s('tool-pricing-calculator', 'What is AWS Pricing Calculator?', 'https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html', 'tooling'),
  s('tool-budgets', 'Managing your costs with AWS Budgets', 'https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html', 'tooling'),

  // Service documentation (overview pages)
  s('svc-s3', 'What is Amazon S3?', 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html', 'service-docs'),
  s('svc-cloudfront', 'What is Amazon CloudFront?', 'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html', 'service-docs'),
  s('svc-route53', 'What is Amazon Route 53?', 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html', 'service-docs'),
  s('svc-apigateway', 'What is Amazon API Gateway?', 'https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html', 'service-docs'),
  s('svc-lambda', 'What is AWS Lambda?', 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html', 'service-docs'),
  s('svc-ecs', 'What is Amazon Elastic Container Service?', 'https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html', 'service-docs'),
  s('svc-ec2', 'What is Amazon EC2?', 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html', 'service-docs'),
  s('svc-alb', 'What is an Application Load Balancer?', 'https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html', 'service-docs'),
  s('svc-amplify', 'Welcome to AWS Amplify Hosting', 'https://docs.aws.amazon.com/amplify/latest/userguide/welcome.html', 'service-docs'),
  s('svc-dynamodb', 'What is Amazon DynamoDB?', 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html', 'service-docs'),
  s('svc-rds', 'What is Amazon Relational Database Service (Amazon RDS)?', 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html', 'service-docs'),
  s('svc-aurora', 'What is Amazon Aurora?', 'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html', 'service-docs'),
  s('svc-elasticache', 'What is Amazon ElastiCache?', 'https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html', 'service-docs'),
  s('svc-cognito', 'What is Amazon Cognito?', 'https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html', 'service-docs'),
  s('svc-waf', 'AWS WAF, AWS Firewall Manager, AWS Shield Advanced, and AWS Shield network security director', 'https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html', 'service-docs'),
  s('svc-iam', 'What is IAM?', 'https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html', 'service-docs'),
  s('svc-kms', 'AWS Key Management Service', 'https://docs.aws.amazon.com/kms/latest/developerguide/overview.html', 'service-docs'),
  s('svc-secretsmanager', 'What is AWS Secrets Manager?', 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html', 'service-docs'),
  s('svc-guardduty', 'What is Amazon GuardDuty?', 'https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html', 'service-docs'),
  s('svc-cloudtrail', 'What Is AWS CloudTrail?', 'https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html', 'service-docs'),
  s('svc-cloudwatch', 'What is Amazon CloudWatch?', 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html', 'service-docs'),
  s('svc-xray', 'What is AWS X-Ray?', 'https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html', 'service-docs'),
  s('svc-backup', 'What is AWS Backup?', 'https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html', 'service-docs'),
  s('svc-cloudformation', 'What is CloudFormation?', 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html', 'service-docs'),
  s('svc-systems-manager', 'What is AWS Systems Manager?', 'https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-systems-manager.html', 'service-docs'),
  s('svc-vpc', 'What is Amazon VPC?', 'https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html', 'service-docs'),
  s('svc-site-to-site-vpn', 'What is AWS Site-to-Site VPN?', 'https://docs.aws.amazon.com/vpn/latest/s2svpn/VPC_VPN.html', 'service-docs'),
  s('svc-sqs', 'What is Amazon Simple Queue Service?', 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html', 'service-docs'),
  s('svc-sns', 'What is Amazon SNS?', 'https://docs.aws.amazon.com/sns/latest/dg/welcome.html', 'service-docs'),
  s('svc-eventbridge', 'What Is Amazon EventBridge?', 'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html', 'service-docs'),
  s('svc-stepfunctions', 'What is Step Functions?', 'https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html', 'service-docs'),
  s('svc-appflow', 'What is Amazon AppFlow?', 'https://docs.aws.amazon.com/appflow/latest/userguide/what-is-appflow.html', 'service-docs'),
  s('svc-transfer', 'What is AWS Transfer Family?', 'https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html', 'service-docs'),
  s('svc-datasync', 'What is AWS DataSync?', 'https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html', 'service-docs'),
  s('svc-glue', 'What is AWS Glue?', 'https://docs.aws.amazon.com/glue/latest/dg/what-is-glue.html', 'service-docs'),
  s('svc-athena', 'What is Amazon Athena?', 'https://docs.aws.amazon.com/athena/latest/ug/what-is.html', 'service-docs'),
  s('svc-bedrock', 'Overview - Amazon Bedrock', 'https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html', 'service-docs'),
  s('svc-bedrock-kb', 'Amazon Bedrock Knowledge Bases', 'https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html', 'service-docs'),
  s('svc-opensearch-serverless', 'Amazon OpenSearch Serverless', 'https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless.html', 'service-docs'),
  s('svc-textract', 'What is Amazon Textract?', 'https://docs.aws.amazon.com/textract/latest/dg/what-is.html', 'service-docs'),
  s('svc-q-business', 'What is Amazon Q Business?', 'https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/what-is.html', 'service-docs'),
] as const satisfies readonly Source[];

export type SourceId = (typeof SOURCES)[number]['id'];

const SOURCE_MAP: ReadonlyMap<string, Source> = new Map(SOURCES.map((src) => [src.id, src]));

export function isKnownSource(id: string): id is SourceId {
  return SOURCE_MAP.has(id);
}

export function getSource(id: string): Source | undefined {
  return SOURCE_MAP.get(id);
}
