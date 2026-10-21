#!/usr/bin/env node
// Starts the MCP server over stdio. Loads the TypeScript sources through tsx,
// so it runs from a fresh clone after `npm install` with no build step.
import { tsImport } from 'tsx/esm/api';

try {
  const { main } = await tsImport('../mcp/stdio.ts', import.meta.url);
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
