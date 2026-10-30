import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { serveStatic as coreStatic } from 'hono/serve-static';
import { serveStatic as nodeStatic } from '@hono/node-server/serve-static';
import { describe, expect, it } from 'vitest';

describe.each(['core', 'node'] as const)('Hono %s static path boundaries', (adapter) => {
  it('does not decode a malformed routed path into a protected file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hono-path-fixture-'));
    mkdirSync(join(root, 'private!'));
    writeFileSync(join(root, 'private!', 'ordinary.txt'), 'private-fixture-canary');
    writeFileSync(join(root, 'public.txt'), 'public-fixture');
    writeFileSync(join(root, 'public space.txt'), 'encoded-public-fixture');
    const app = new Hono();
    app.use('/private!/*', async (context) => context.text('denied', 401));
    app.use('*', adapter === 'node' ? nodeStatic({ root }) : coreStatic({
      root,
      getContent: async (path) => {
        try { return readFileSync(path); } catch { return null; }
      },
    }));
    try {
      const publicResponse = await app.request('/public.txt');
      expect(publicResponse.status).toBe(200);
      expect(await publicResponse.text()).toBe('public-fixture');
      const encodedPublicResponse = await app.request('/public%20space.txt');
      expect(encodedPublicResponse.status).toBe(200);
      expect(await encodedPublicResponse.text()).toBe('encoded-public-fixture');
      expect((await app.request('/private!/ordinary.txt')).status).toBe(401);
      // One decode leaves %70 in the routed path; a second turns it into p.
      const response = await app.request('/%%37%30rivate!/ordinary.txt');
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('private-fixture-canary');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
