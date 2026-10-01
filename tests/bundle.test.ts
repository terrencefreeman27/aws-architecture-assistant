import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

/**
 * Builds the real client bundle (same vite.config.ts as `npm run build`, into a
 * temp dir) and checks that the live provider and its secrets never ship to
 * the browser, while the in-browser demo planner does.
 */
const FORBIDDEN = [
  '@anthropic-ai',
  'ANTHROPIC_API_KEY',
  'api.anthropic.com',
  'anthropic-version',
  'AnthropicProvider',
  'You design reviewable starting-point AWS architectures', // the live provider's system prompt
];

let outDir = '';
let bundle = '';

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'aws-arch-bundle-'));
  await build({ configFile: resolve('vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const files = await readdir(join(outDir, 'assets'));
  bundle = (await Promise.all(files.map((f) => readFile(join(outDir, 'assets', f), 'utf8')))).join('\n');
  bundle += await readFile(join(outDir, 'index.html'), 'utf8');
}, 180_000);

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe('client bundle', () => {
  it.each(FORBIDDEN)('does not contain %s', (marker) => {
    expect(bundle.includes(marker)).toBe(false);
  });

  it('includes the in-browser demo planner, catalog, and sources', () => {
    expect(bundle).toContain('Demo planner (runs in your browser)');
    expect(bundle).toContain('docs.aws.amazon.com');
  });
});
