import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  exportReport,
  getRequirementsSchema,
  getSample,
  getSources,
  listSamples,
  listSupportedServices,
  missingQuestions,
  planArchitecture,
  unknownRequirementKeys,
} from '../shared/core';
import { REPORT_NOTICE } from '../shared/report';
import { FIELD_META } from '../shared/requirements';
import type { FollowUpQuestion, RequirementField, ValidationIssue } from '../shared/schema';

/**
 * aws-arch-plan: a thin command line over the shared core (same pipeline as the
 * website, demo planner only, no network). Exit codes: 0 success, 1 usage or
 * invalid input, 2 requirements incomplete (questions printed to stderr).
 */

export const USAGE = `Usage: aws-arch-plan <command> [options]

Commands:
  plan <file|-> [--format json|md|mermaid]   Plan an architecture from a requirements JSON file (or "-" for stdin).
                                             json (default): validated plan + Mermaid + warnings
                                             md: the Markdown design document; mermaid: the diagram source
  questions <file|->                         Follow-up questions for incomplete requirements (JSON)
  catalog                                    Supported AWS services (JSON)
  sources [id...]                            Curated AWS documentation sources, optionally by id (JSON)
  schema                                     Requirement fields, allowed values, and "unsure" defaults (JSON)
  samples [id]                               List samples, or print one sample's requirements JSON

Options:
  -f, --format <json|md|mermaid>   Output format for "plan" (default json)
  -h, --help                       Show this help

Exit codes: 0 ok, 1 invalid usage or input, 2 requirements incomplete (questions on stderr).
Plans are reviewable starting points, not production-ready, and contain no cost figures.`;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
}

class CliError extends Error {
  constructor(message: string, readonly code = 1) {
    super(message);
  }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function readRequirements(source: string | undefined, io: Io): Promise<unknown> {
  if (!source) throw new CliError('Missing requirements file. Pass a path, or "-" to read JSON from stdin.');
  let raw: string;
  try {
    raw = source === '-' ? await io.readStdin() : await readFile(source, 'utf8');
  } catch (err) {
    throw new CliError(`Could not read ${source === '-' ? 'stdin' : source}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CliError(`${source === '-' ? 'stdin' : source} is not valid JSON: ${(err as Error).message}`);
  }
}

const formatIssues = (issues: ValidationIssue[]) =>
  issues.map((i) => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`).join('\n');

const formatQuestions = (questions: FollowUpQuestion[]) =>
  questions
    .map((q) => {
      const label = FIELD_META[q.field as RequirementField]?.label;
      return `  - ${q.field}${label ? ` (${label})` : ''}: ${q.question}\n    Why: ${q.why}`;
    })
    .join('\n');

function warnIgnored(input: unknown, io: Io) {
  const keys = unknownRequirementKeys(input);
  if (keys.length) io.stderr(`Warning: ignoring unknown field(s): ${keys.join(', ')}\n`);
}

const invalid = (message: string, issues: ValidationIssue[]) => new CliError(`${message}\n${formatIssues(issues)}`);

const incomplete = (questions: FollowUpQuestion[]) =>
  new CliError(`Requirements are incomplete, so no plan was generated. Answer these and try again:\n${formatQuestions(questions)}`, 2);

async function plan(file: string | undefined, format: string, io: Io) {
  if (!['json', 'md', 'mermaid'].includes(format)) throw new CliError(`Unknown format "${format}". Use json, md, or mermaid.`);
  const input = await readRequirements(file, io);
  warnIgnored(input, io);
  if (format === 'md') {
    const r = await exportReport(input);
    if (r.kind === 'error') throw invalid(r.message, r.issues);
    if (r.kind === 'questions') throw incomplete(r.questions);
    return io.stdout(r.markdown.endsWith('\n') ? r.markdown : `${r.markdown}\n`);
  }
  const r = await planArchitecture(input);
  if (r.kind === 'error') throw invalid(r.message, r.issues);
  if (r.kind === 'questions') throw incomplete(r.questions);
  if (format === 'mermaid') return io.stdout(`${r.mermaid}\n`);
  io.stdout(
    json({
      status: 'plan',
      notice: `Not production-ready. ${REPORT_NOTICE}`,
      provider: r.provider,
      generatedAt: r.generatedAt,
      completeness: r.completeness,
      plan: r.plan,
      mermaid: r.mermaid,
      warnings: r.warnings,
    }),
  );
}

async function questions(file: string | undefined, io: Io) {
  const input = await readRequirements(file, io);
  warnIgnored(input, io);
  const r = missingQuestions(input);
  if (r.kind === 'error') throw invalid(r.message, r.issues);
  io.stdout(json({ status: r.kind === 'complete' ? 'complete' : 'needs_more_information', completeness: r.completeness, questions: r.questions, cautions: r.cautions }));
}

function samples(id: string | undefined, io: Io) {
  if (!id) return io.stdout(json(listSamples().map(({ id, name, blurb }) => ({ id, name, blurb }))));
  const sample = getSample(id);
  if (!sample) throw new CliError(`Unknown sample "${id}". Available: ${listSamples().map((s) => s.id).join(', ')}`);
  io.stdout(json(sample.requirements));
}

/** Runs the CLI and returns the exit code. Never throws. */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { format: { type: 'string', short: 'f', default: 'json' }, help: { type: 'boolean', short: 'h' } },
      });
    } catch (err) {
      throw new CliError(`${(err as Error).message}\n\n${USAGE}`);
    }
    const { values, positionals } = parsed;
    const [command, ...rest] = positionals;
    if (values.help || !command || command === 'help') {
      io.stdout(`${USAGE}\n`);
      return command || values.help ? 0 : 1;
    }
    const tooMany = (max: number) => {
      if (rest.length > max) throw new CliError(`Too many arguments for "${command}".\n\n${USAGE}`);
    };
    switch (command) {
      case 'plan':
        tooMany(1);
        await plan(rest[0], values.format!, io);
        break;
      case 'questions':
        tooMany(1);
        await questions(rest[0], io);
        break;
      case 'catalog':
        tooMany(0);
        io.stdout(json(listSupportedServices()));
        break;
      case 'sources': {
        const r = getSources(rest);
        if (r.unknownIds.length) throw new CliError(`Unknown source id(s): ${r.unknownIds.join(', ')}`);
        io.stdout(json(r.sources));
        break;
      }
      case 'schema':
        tooMany(0);
        io.stdout(json(getRequirementsSchema()));
        break;
      case 'samples':
        tooMany(1);
        samples(rest[0], io);
        break;
      default:
        throw new CliError(`Unknown command "${command}".\n\n${USAGE}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      io.stderr(`${err.message}\n`);
      return err.code;
    }
    io.stderr(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(): Promise<void> {
  const code = await run(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    readStdin: () => readAll(process.stdin),
  });
  process.exitCode = code;
}
