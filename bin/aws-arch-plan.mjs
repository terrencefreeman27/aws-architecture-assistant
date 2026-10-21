#!/usr/bin/env node
// aws-arch-plan CLI. Loads the TypeScript sources through tsx, so it runs from
// a fresh clone after `npm install` with no build step.
import { tsImport } from 'tsx/esm/api';

try {
  const { main } = await tsImport('../cli/main.ts', import.meta.url);
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
