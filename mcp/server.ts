import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  exportReport,
  getRequirementsSchema,
  getSources,
  listSupportedServices,
  missingQuestions,
  planArchitecture,
  unknownRequirementKeys,
} from '../shared/core';
import { REPORT_NOTICE } from '../shared/report';
import { RequirementsSchema } from '../shared/schema';

/**
 * MCP server over the shared core. Local and deterministic: the demo planner
 * only, no network, no model calls, no AWS credentials, no environment variables.
 */

export const SERVER_NAME = 'aws-architecture-assistant';
export const SERVER_VERSION = '0.1.0';

const RULES = [
  'Ask the user for any missing or unclear requirement; never invent an answer on their behalf. "unsure" is allowed only when the user actually says they are not sure.',
  'Plans are reviewable starting points and are NOT production-ready. Say so when presenting one.',
  'Never state cost figures or prices; the plans describe cost drivers only. Point users to AWS Pricing Calculator for estimates.',
  'Cite only sources returned by these tools (registry ids and URLs). Do not add other links or claims of compliance.',
].join(' ');

export const SERVER_INSTRUCTIONS = `Turns business requirements into a reviewable AWS architecture plan with a validated Mermaid diagram, using a deterministic rules-based demo planner (no network, no AWS access). Typical flow: get_requirements_schema to learn the fields, ask the user, get_missing_questions until complete, then plan_architecture or export_report. ${RULES}`;

const requirementsArg = {
  // loose(): same validation, but unknown keys reach the handler so they can be reported (the core still ignores them).
  requirements: RequirementsSchema.loose().describe(
    'The requirements as answered by the user. Use the exact field names and allowed values from get_requirements_schema. Empty string means not answered. Choice fields marked notSure in the schema also accept "unsure".',
  ),
};

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false } as const;

const json = (value: unknown) => JSON.stringify(value, null, 2);

function ok(structured: Record<string, unknown>, text = json(structured)): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

function fail(structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: json(structured) }], structuredContent: structured, isError: true };
}

/** Never let an unexpected exception escape a tool call. */
function safe<A>(handler: (args: A) => Promise<CallToolResult> | CallToolResult) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (err) {
      return fail({ status: 'internal_error', message: err instanceof Error ? err.message : String(err) });
    }
  };
}

const ignored = (raw: unknown) => {
  const keys = unknownRequirementKeys(raw);
  return keys.length ? { ignoredFields: keys } : {};
};

const ASK_USER = 'Ask the user these questions (in plain language) and call again with their answers. Do not answer them yourself.';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    'get_requirements_schema',
    {
      title: 'Requirements fields',
      description:
        'Lists every requirement field: plain-language label and question to ask the user, why it matters, whether it is required, allowed values with labels, and for choice fields that accept "unsure", the safe default the planner will assume. Call this first so you know what to ask. ' +
        RULES,
      annotations: READ_ONLY,
    },
    safe(() => ok(getRequirementsSchema())),
  );

  server.registerTool(
    'get_missing_questions',
    {
      title: 'Follow-up questions',
      description:
        'Checks whether the requirements are complete enough to plan. Returns status "complete", or "needs_more_information" with follow-up questions (field, question, why) and a completeness score. Ask the user these questions; do not fill in answers yourself. Invalid values return an error with the offending field paths.',
      inputSchema: requirementsArg,
      annotations: READ_ONLY,
    },
    safe(({ requirements }) => {
      const r = missingQuestions(requirements);
      if (r.kind === 'error') return fail({ status: 'invalid_requirements', message: r.message, issues: r.issues });
      return ok({
        status: r.kind === 'complete' ? 'complete' : 'needs_more_information',
        completeness: r.completeness,
        questions: r.questions,
        cautions: r.cautions,
        ...(r.kind === 'questions' ? { instruction: ASK_USER } : {}),
        ...ignored(requirements),
      });
    }),
  );

  server.registerTool(
    'plan_architecture',
    {
      title: 'Plan an AWS architecture',
      description:
        'Generates a reviewable AWS architecture plan from complete requirements: validated components, connections, data flow, assumptions (including any "unsure" defaults), open questions, Well-Architected considerations with source ids, alternatives, implementation steps, cautions, validation warnings, and a Mermaid flowchart generated from the validated data. If requirements are incomplete it returns status "needs_more_information" with questions instead of a plan; ask the user, do not guess. ' +
        RULES,
      inputSchema: requirementsArg,
      annotations: READ_ONLY,
    },
    safe(async ({ requirements }) => {
      const r = await planArchitecture(requirements);
      if (r.kind === 'error') return fail({ status: 'invalid_requirements', message: r.message, issues: r.issues });
      if (r.kind === 'questions') {
        return ok({ status: 'needs_more_information', completeness: r.completeness, questions: r.questions, cautions: r.cautions, instruction: ASK_USER, ...ignored(requirements) });
      }
      return ok({
        status: 'plan',
        notice: `Not production-ready. ${REPORT_NOTICE}`,
        provider: r.provider,
        generatedAt: r.generatedAt,
        completeness: r.completeness,
        plan: r.plan,
        mermaid: r.mermaid,
        warnings: r.warnings,
        ...ignored(requirements),
      });
    }),
  );

  server.registerTool(
    'export_report',
    {
      title: 'Markdown design document',
      description:
        'Returns the same self-contained Markdown design document the website downloads: requirements as entered, Mermaid diagram, components, data flow, assumptions, open questions, considerations by pillar, alternatives, implementation sequence, cautions, cited AWS documentation (registry sources only), and a share link that opens the requirements on the public demo site. The link carries the requirements in the URL fragment, so do not use it for secrets. If requirements are incomplete it returns questions instead; ask the user. ' +
        RULES,
      inputSchema: requirementsArg,
      annotations: READ_ONLY,
    },
    safe(async ({ requirements }) => {
      const r = await exportReport(requirements);
      if (r.kind === 'error') return fail({ status: 'invalid_requirements', message: r.message, issues: r.issues });
      if (r.kind === 'questions') {
        return ok({ status: 'needs_more_information', completeness: r.completeness, questions: r.questions, cautions: r.cautions, instruction: ASK_USER, ...ignored(requirements) });
      }
      return ok({ status: 'report', fileName: r.fileName, markdown: r.markdown, ...ignored(requirements) }, r.markdown);
    }),
  );

  server.registerTool(
    'list_supported_services',
    {
      title: 'Supported AWS services',
      description:
        'Lists the AWS services the planner may place in a design (id, name, category, short summary, source ids). Services outside this catalog are never added to a diagram.',
      annotations: READ_ONLY,
    },
    safe(() => ok({ services: listSupportedServices() })),
  );

  server.registerTool(
    'get_sources',
    {
      title: 'Curated AWS sources',
      description:
        'Returns entries from the curated registry of official AWS documentation pages (id, title, URL, kind, date verified). Pass ids from a plan to resolve its citations, or omit ids for the full registry. Unknown ids are listed in unknownIds; never cite a source that is not returned here.',
      inputSchema: {
        ids: z.array(z.string().max(100)).max(100).optional().describe('Source ids to look up, e.g. ["wa-security", "svc-lambda"]. Omit for all sources.'),
      },
      annotations: READ_ONLY,
    },
    safe(({ ids }) => ok(getSources(ids))),
  );

  return server;
}
