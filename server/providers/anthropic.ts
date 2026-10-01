import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { CATALOG } from '../../shared/catalog';
import type { ArchitectureProvider } from '../../shared/provider';
import { PlanSchema, type Requirements } from '../../shared/schema';
import { SOURCES } from '../../shared/sources';

/**
 * Optional live provider (off by default). Runs server-side only; the API key
 * is read from ANTHROPIC_API_KEY by the SDK and never leaves the server.
 * Output is requested as structured JSON matching PlanSchema, and the caller
 * still runs it through the same validation and catalog/citation checks as
 * demo output. It is never called from tests.
 */

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

function systemPrompt(): string {
  const catalog = CATALOG.map((s) => `- ${s.id}: ${s.name} (${s.category}) - ${s.summary}`).join('\n');
  const sources = SOURCES.map((s) => `- ${s.id}: ${s.title}`).join('\n');
  return [
    'You design reviewable starting-point AWS architectures for people who know their business problem but not AWS.',
    'Return only data matching the provided JSON schema. Never write diagram code; the application draws the diagram from your nodes and connections.',
    '',
    'Rules:',
    '- AWS nodes (kind "aws") must use a serviceId from the supported catalog below. Do not suggest services outside it; if one seems necessary, say so in cautions instead.',
    '- Existing systems the user names are kind "external"; people are kind "actor". Node ids: lowercase letters, digits, underscores.',
    '- Every connection must reference node ids you declared.',
    '- Cite sources only by the ids listed below. Never invent ids or URLs. Mark a claim basis "source" only when a listed source plausibly supports it; otherwise mark it "assumption".',
    '- Never give dollar figures or exact cost estimates. Describe cost drivers and relative tradeoffs.',
    '- Do not claim the design is production-ready, compliant with any regulation, or guaranteed to meet an availability level.',
    '- Include at least one alternative with pros and cons, explicit assumptions tied to requirement fields where possible, and open questions.',
    '',
    'Supported catalog (serviceId: name):',
    catalog,
    '',
    'Curated sources (id: title):',
    sources,
  ].join('\n');
}

export class AnthropicProvider implements ArchitectureProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { model?: string } = {}) {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
    this.model = options.model || DEFAULT_ANTHROPIC_MODEL;
  }

  async generatePlan(req: Requirements): Promise<unknown> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: systemPrompt(),
      output_config: { effort: 'medium', format: zodOutputFormat(PlanSchema) },
      messages: [
        {
          role: 'user',
          content: `Design an AWS architecture plan for these requirements (JSON):\n${JSON.stringify(req, null, 2)}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') throw new Error('The model declined this request.');
    if (response.stop_reason === 'max_tokens') throw new Error('The model response was cut off before the plan was complete.');
    if (!response.parsed_output) throw new Error('The model did not return structured plan data.');
    return response.parsed_output;
  }
}
