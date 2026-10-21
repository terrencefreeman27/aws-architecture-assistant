import { RequirementsSchema, type Requirements } from './schema';

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  requirements: Requirements;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'web-app',
    name: 'Basic web application',
    blurb: 'Customer portal with sign-in and a small team.',
    requirements: RequirementsSchema.parse({
      description:
        'A customer portal where our clients sign in to view their orders, download invoices, and update their contact details.',
      workloadType: 'web_app',
      existingSystems: 'QuickBooks',
      expectedUsage: 'moderate',
      usageNotes: 'About 2,000 registered customers; a few hundred active per day.',
      dataSensitivity: 'confidential',
      region: 'us-east-1',
      availability: 'business_hours',
      recoveryNotes: '',
      budget: 'minimal',
      operations: 'small_team',
      operationsNotes: 'Two developers, comfortable with TypeScript, no dedicated ops staff.',
    }),
  },
  {
    id: 'integration',
    name: 'Integration between existing systems',
    blurb: 'Sync new CRM orders into an on-premises ERP.',
    requirements: RequirementsSchema.parse({
      description:
        'When a deal closes in our CRM, create the matching sales order in our ERP and send the order number back to the CRM. Failures must not be silently dropped.',
      workloadType: 'integration',
      existingSystems: 'Salesforce, on-premises ERP (SQL Server)',
      expectedUsage: 'spiky',
      usageNotes: 'Roughly 300 orders a day, with bursts at month end.',
      dataSensitivity: 'internal',
      region: 'us-east-2',
      availability: 'high',
      recoveryNotes: 'No order may be lost; a few hours of delay is acceptable.',
      budget: 'moderate',
      operations: 'small_team',
      operationsNotes: '',
    }),
  },
  {
    id: 'ai-assistant',
    name: 'AI knowledge assistant',
    blurb: 'Employees ask questions over internal policies.',
    requirements: RequirementsSchema.parse({
      description:
        'An internal assistant that answers employee questions about HR policies and IT procedures, citing the source document for each answer. Some older policies are scanned PDFs.',
      workloadType: 'ai_assistant',
      existingSystems: 'SharePoint, Confluence',
      expectedUsage: 'low',
      usageNotes: 'About 400 employees; maybe 100 questions a day.',
      dataSensitivity: 'internal',
      region: 'us-west-2',
      availability: 'business_hours',
      recoveryNotes: '',
      budget: 'moderate',
      operations: 'small_team',
      operationsNotes: '',
    }),
  },
  {
    id: 'data-pipeline',
    name: 'Sales reporting dashboards',
    blurb: 'Combine store and online sales for manager dashboards.',
    requirements: RequirementsSchema.parse({
      description:
        'Combine the daily sales exports from our store point-of-sale system with orders from our online shop, so managers can see sales by store, product, and week on dashboards.',
      workloadType: 'data_pipeline',
      existingSystems: 'Point-of-sale system (CSV exports), Shopify',
      expectedUsage: 'moderate',
      usageNotes: 'About 40 stores and 50,000 sales lines a day; 25 managers use the dashboards.',
      dataSensitivity: 'confidential',
      region: 'eu-west-1',
      availability: 'business_hours',
      recoveryNotes: '',
      budget: 'moderate',
      operations: 'small_team',
      operationsNotes: '',
    }),
  },
  {
    id: 'scheduled-jobs',
    name: 'Nightly report job',
    blurb: 'Build and email a sales report every night.',
    requirements: RequirementsSchema.parse({
      description:
        "Every night, pull the day's orders from our accounting system, build a sales summary report as a PDF, save it, and email managers a link. If the job fails, someone must be told.",
      workloadType: 'scheduled_jobs',
      existingSystems: 'NetSuite',
      expectedUsage: 'low',
      usageNotes: 'One run per night; about 2,000 orders a day.',
      dataSensitivity: 'internal',
      region: 'us-east-1',
      availability: 'business_hours',
      recoveryNotes: '',
      budget: 'minimal',
      operations: 'small_team',
      operationsNotes: 'One developer who writes Python scripts today.',
    }),
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
