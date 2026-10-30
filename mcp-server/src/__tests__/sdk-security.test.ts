import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

describe('patched MCP SDK security boundaries', () => {
  it.each(['trusted', 'untrusted'])('binds pre-registered OAuth credentials to the %s issuer', async (issuer) => {
    // All metadata is an in-memory fixture; no network or real credentials.
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ access_token: 'renewed-fixture', token_type: 'Bearer' }), { headers: { 'content-type': 'application/json' } }));
    const selectedIssuer = `https://${issuer}.example`;
    const provider: OAuthClientProvider = {
      redirectUrl: new URL('http://127.0.0.1/callback'),
      clientMetadata: { redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'client_secret_post' },
      clientInformation: () => ({ client_id: 'fixture-client', client_secret: 'fixture-only', issuer: 'https://trusted.example' }),
      tokens: () => ({ access_token: 'fixture-only', token_type: 'Bearer', refresh_token: 'fixture-only', issuer: 'https://trusted.example' }),
      saveTokens: vi.fn(), redirectToAuthorization: vi.fn(), saveCodeVerifier: vi.fn(), codeVerifier: () => 'fixture-verifier',
      discoveryState: () => ({
        authorizationServerUrl: selectedIssuer,
        resourceMetadata: { resource: 'https://mcp.example/mcp', authorization_servers: [selectedIssuer] },
        authorizationServerMetadata: {
          issuer: selectedIssuer, authorization_endpoint: `${selectedIssuer}/authorize`,
          token_endpoint: `${selectedIssuer}/token`, response_types_supported: ['code'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          code_challenge_methods_supported: ['S256'],
        },
      }),
    };
    if (issuer === 'untrusted') {
      await expect(auth(provider, { serverUrl: 'https://mcp.example/mcp', fetchFn })).rejects.toThrow(/bound to authorization server/);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(provider.saveTokens).not.toHaveBeenCalled();
    } else {
      expect(await auth(provider, { serverUrl: 'https://mcp.example/mcp', fetchFn })).toBe('AUTHORIZED');
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(String(fetchFn.mock.calls[0][0])).toBe('https://trusted.example/token');
      expect(provider.saveTokens).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'renewed-fixture', issuer: 'https://trusted.example' }));
    }
  });

  it('isolates task reads, lists, status changes and results by session', async () => {
    const store = new InMemoryTaskStore();
    try {
      const request = { method: 'tools/call' as const, params: { name: 'fixture' } };
      const owner = await store.createTask({ ttl: null }, 1, request, 'owner');
      const other = await store.createTask({ ttl: null }, 2, request, 'other');
      expect((await store.getTask(owner.taskId, 'owner'))?.taskId).toBe(owner.taskId);
      expect(await store.getTask(owner.taskId, 'other')).toBeNull();
      expect((await store.listTasks(undefined, 'owner')).tasks.map((task) => task.taskId)).toEqual([owner.taskId]);
      expect((await store.listTasks(undefined, 'other')).tasks.map((task) => task.taskId)).toEqual([other.taskId]);
      await expect(store.updateTaskStatus(owner.taskId, 'cancelled', undefined, 'other')).rejects.toThrow(/not found/);
      expect((await store.getTask(owner.taskId, 'owner'))?.status).toBe('working');
      const result = { content: [{ type: 'text' as const, text: 'owner-only' }] };
      await store.storeTaskResult(owner.taskId, 'completed', result, 'owner');
      expect(await store.getTaskResult(owner.taskId, 'owner')).toEqual(result);
      await expect(store.getTaskResult(owner.taskId, 'other')).rejects.toThrow(/not found/);
    } finally {
      store.cleanup();
    }
  });

  it('enforces an explicit element budget before validating or executing a tool', async () => {
    // This repo uses low-level stdio Server, outside the HTTP advisory's scope.
    // This fixture verifies the opt-in guard required for future McpServer HTTP use.
    const server = new McpServer({ name: 'security-fixture', version: '1' }, { maxToolInputElements: 8 });
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    server.registerTool('bounded', { inputSchema: { items: z.array(z.string()) } }, handler);
    const client = new Client({ name: 'fixture-client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.callTool({ name: 'bounded', arguments: { items: ['allowed'] } })).isError).not.toBe(true);
      const oversized = await client.callTool({ name: 'bounded', arguments: { items: Array(20).fill('item') } });
      expect(oversized.isError).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it.each(['declared', 'streamed'])('rejects an oversized %s HTTP body before JSON-RPC validation', async (kind) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, maxRequestBodySize: 128 });
    const message = vi.fn();
    transport.onmessage = message;
    try {
      const response = await transport.handleRequest(new Request('http://127.0.0.1/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(kind === 'declared' ? { 'content-length': '256' } : {}) },
        body: ' '.repeat(256),
      }));
      expect(response.status).toBe(413);
      expect(message).not.toHaveBeenCalled();
    } finally { await transport.close(); }
  });

  it('rejects oversized JSON-RPC batches before dispatch', async () => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const message = vi.fn();
    transport.onmessage = message;
    try {
      const response = await transport.handleRequest(new Request('http://127.0.0.1/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(Array.from({ length: 101 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'ping' }))),
      }));
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toMatch(/Batch/);
      expect(message).not.toHaveBeenCalled();
    } finally { await transport.close(); }
  });
});
