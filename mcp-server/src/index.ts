#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import 'dotenv/config';

import { chatTools, handleChatTool } from './tools/chat.js';
import { nftTools, handleNftTool } from './tools/nft.js';
import { auditTools, handleAuditTool } from './tools/audit.js';
import { generatorTools, handleGeneratorTool } from './tools/generator.js';
import { newsTools, handleNewsTool } from './tools/news.js';
import { utilTools, handleUtilTool } from './tools/utils.js';

const API_KEY = process.env.CHAINGPT_API_KEY;
if (!API_KEY) {
  console.error(
    'CHAINGPT_API_KEY environment variable is required. ' +
    'Get your key at https://app.chaingpt.org'
  );
  process.exit(1);
}

const server = new Server(
  { name: 'chaingpt', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// List all tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...chatTools,
    ...nftTools,
    ...auditTools,
    ...generatorTools,
    ...newsTools,
    ...utilTools,
  ],
}));

// Route tool calls to appropriate handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name.startsWith('chaingpt_chat')) return await handleChatTool(name, args);
    if (name.startsWith('chaingpt_nft')) return await handleNftTool(name, args);
    if (name.startsWith('chaingpt_audit')) return await handleAuditTool(name, args);
    if (name.startsWith('chaingpt_generate')) return await handleGeneratorTool(name, args);
    if (name.startsWith('chaingpt_news')) return await handleNewsTool(name, args);
    if (name.startsWith('chaingpt_')) return await handleUtilTool(name, args);

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error executing ${name}: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
