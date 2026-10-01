import express, { type NextFunction, type Request, type Response } from 'express';
import { CATALOG } from '../shared/catalog';
import { DemoProvider } from '../shared/demoProvider';
import type { ArchitectureProvider } from '../shared/provider';
import { RequirementsSchema } from '../shared/schema';
import { SCENARIOS } from '../shared/scenarios';
import { planFromRequirements } from '../shared/service';
import { SOURCES } from '../shared/sources';

export interface ProviderSelection {
  provider: ArchitectureProvider;
  note?: string;
}

/**
 * Pick the provider from the environment. Demo is the default; the live
 * provider is used only when explicitly enabled AND a key is present.
 */
export async function selectProvider(env: NodeJS.ProcessEnv = process.env): Promise<ProviderSelection> {
  if (env.MODEL_PROVIDER === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      return { provider: new DemoProvider(), note: 'MODEL_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; using demo mode.' };
    }
    const { AnthropicProvider } = await import('./providers/anthropic');
    return { provider: new AnthropicProvider({ model: env.ANTHROPIC_MODEL }) };
  }
  return { provider: new DemoProvider() };
}

export function createApp(provider: ArchitectureProvider) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: provider.name, demo: provider.name === 'demo' });
  });
  app.get('/api/catalog', (_req, res) => res.json(CATALOG));
  app.get('/api/sources', (_req, res) => res.json(SOURCES));
  app.get('/api/scenarios', (_req, res) => res.json(SCENARIOS));

  app.post('/api/plan', async (req, res) => {
    const parsed = RequirementsSchema.safeParse(req.body?.requirements);
    if (!parsed.success) {
      res.status(400).json({
        kind: 'error',
        provider: provider.name,
        message: 'Requirements failed validation.',
        issues: parsed.error.issues.map((i) => ({ code: 'schema', message: i.message, path: i.path.join('.') })),
      });
      return;
    }
    const result = await planFromRequirements(parsed.data, provider);
    res.status(result.kind === 'error' ? 422 : 200).json(result);
  });

  app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({ message: status === 500 ? 'Internal error' : 'Bad request' });
  });

  return app;
}
