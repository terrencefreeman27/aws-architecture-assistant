/**
 * Official AWS Architecture Icons for catalog services.
 *
 * The SVGs are vendored unmodified in vendor/aws-architecture-icons/ (see the
 * NOTICE.md there for source and usage terms). This module holds only the
 * mapping and the SVG-to-icon-pack conversion, so it stays small and testable;
 * the SVG text itself is bundled into the lazily loaded diagram chunk.
 */

/** Mermaid icon-pack prefix: nodes reference icons as "aws:<catalog id>". */
export const AWS_ICON_PREFIX = 'aws';

/** Catalog service id -> vendored file name. */
export const SERVICE_ICON_FILES: Readonly<Record<string, string>> = {
  cloudfront: 'Arch_Amazon-CloudFront_48.svg',
  route53: 'Arch_Amazon-Route-53_48.svg',
  waf: 'Arch_AWS-WAF_48.svg',
  'amplify-hosting': 'Arch_AWS-Amplify_48.svg',
  'api-gateway': 'Arch_Amazon-API-Gateway_48.svg',
  lambda: 'Arch_AWS-Lambda_48.svg',
  'ecs-fargate': 'Arch_Amazon-Elastic-Container-Service_48.svg',
  ec2: 'Arch_Amazon-EC2_48.svg',
  alb: 'Arch_Elastic-Load-Balancing_48.svg',
  s3: 'Arch_Amazon-Simple-Storage-Service_48.svg',
  dynamodb: 'Arch_Amazon-DynamoDB_48.svg',
  rds: 'Arch_Amazon-RDS_48.svg',
  aurora: 'Arch_Amazon-Aurora_48.svg',
  elasticache: 'Arch_Amazon-ElastiCache_48.svg',
  glue: 'Arch_AWS-Glue_48.svg',
  athena: 'Arch_Amazon-Athena_48.svg',
  eventbridge: 'Arch_Amazon-EventBridge_48.svg',
  sqs: 'Arch_Amazon-Simple-Queue-Service_48.svg',
  sns: 'Arch_Amazon-Simple-Notification-Service_48.svg',
  'step-functions': 'Arch_AWS-Step-Functions_48.svg',
  appflow: 'Arch_Amazon-AppFlow_48.svg',
  'transfer-family': 'Arch_AWS-Transfer-Family_48.svg',
  datasync: 'Arch_AWS-DataSync_48.svg',
  bedrock: 'Arch_Amazon-Bedrock_48.svg',
  'bedrock-kb': 'Arch_Amazon-Bedrock_48.svg',
  'opensearch-serverless': 'Arch_Amazon-OpenSearch-Service_48.svg',
  textract: 'Arch_Amazon-Textract_48.svg',
  'q-business': 'Arch_Amazon-Q_48.svg',
  cognito: 'Arch_Amazon-Cognito_48.svg',
  iam: 'Arch_AWS-Identity-and-Access-Management_48.svg',
  kms: 'Arch_AWS-Key-Management-Service_48.svg',
  'secrets-manager': 'Arch_AWS-Secrets-Manager_48.svg',
  guardduty: 'Arch_Amazon-GuardDuty_48.svg',
  cloudwatch: 'Arch_Amazon-CloudWatch_48.svg',
  xray: 'Arch_AWS-X-Ray_48.svg',
  cloudtrail: 'Arch_AWS-CloudTrail_48.svg',
  backup: 'Arch_AWS-Backup_48.svg',
  cloudformation: 'Arch_AWS-CloudFormation_48.svg',
  'systems-manager': 'Arch_AWS-Systems-Manager_48.svg',
  vpc: 'Arch_Amazon-Virtual-Private-Cloud_48.svg',
  'site-to-site-vpn': 'Arch_AWS-Site-to-Site-VPN_48.svg',
};

/** Icon names must be safe to place inside a quoted Mermaid shape-data string. */
const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "aws:<id>" when the service has a vendored icon, otherwise undefined (the node falls back to a plain box). */
export function serviceIconName(serviceId: string | undefined): string | undefined {
  if (!serviceId || !Object.hasOwn(SERVICE_ICON_FILES, serviceId) || !ICON_NAME.test(serviceId)) return undefined;
  return `${AWS_ICON_PREFIX}:${serviceId}`;
}

export interface IconData {
  body: string;
  width: number;
  height: number;
}

/** Iconify JSON as accepted by mermaid.registerIconPacks. */
export interface IconPack {
  prefix: string;
  icons: Record<string, IconData>;
}

/**
 * Converts one vendored SVG file into Iconify icon data: the inner markup plus
 * the viewBox size. Removes the XML prolog, comments, <title>/<desc>, and id
 * attributes (ids would repeat when an icon appears twice). Rejects anything
 * that could reference or run external content.
 */
export function svgToIconData(svg: string): IconData {
  const open = /<svg\b[^>]*>/i.exec(svg);
  const close = svg.lastIndexOf('</svg>');
  if (!open || close < 0) throw new Error('Not an SVG document');
  const viewBox = /viewBox="\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*"/.exec(open[0]);
  if (!viewBox) throw new Error('SVG has no 0-origin viewBox');

  const body = svg
    .slice(open.index + open[0].length, close)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>|<desc>[\s\S]*?<\/desc>/g, '')
    .replace(/\s+id="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .trim();

  if (/<(script|image|foreignObject|use|style|a)\b|\bhref=|\bon[a-z]+=|url\(/i.test(body)) {
    throw new Error('SVG contains disallowed content');
  }
  return { body, width: Number(viewBox[1]), height: Number(viewBox[2]) };
}

/** Builds the icon pack from vendored file contents keyed by file name. Every mapped file must be present. */
export function buildIconPack(filesByName: Readonly<Record<string, string>>): IconPack {
  const icons: Record<string, IconData> = {};
  for (const [serviceId, file] of Object.entries(SERVICE_ICON_FILES)) {
    const svg = filesByName[file];
    if (svg === undefined) throw new Error(`Missing vendored icon ${file} for ${serviceId}`);
    icons[serviceId] = svgToIconData(svg);
  }
  return { prefix: AWS_ICON_PREFIX, icons };
}
