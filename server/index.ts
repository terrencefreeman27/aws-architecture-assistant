import { createApp, selectProvider } from './app';

// Load a local .env if present (never committed). Demo mode needs none.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

const { provider, note } = await selectProvider();
if (note) console.warn(note);

const port = Number(process.env.API_PORT ?? 4080);
createApp(provider).listen(port, () => {
  console.log(`API listening on http://localhost:${port} (provider: ${provider.name})`);
});
