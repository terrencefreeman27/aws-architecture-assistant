import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server';

/** Runs the MCP server over stdio. stdout carries protocol messages only; diagnostics go to stderr. */
export async function main(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error('aws-architecture-assistant MCP server running on stdio (demo planner, local only)');
}
