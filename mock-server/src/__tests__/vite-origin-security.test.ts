import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const pageOrigin = 'http://127.0.0.1:5173';
const trustedHtml = '<!doctype html><html><body><script type="module">document.body.dataset.fixture = "trusted"</script></body></html>';

function moduleUrls(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map((match) => match[1]);
}

describe('Vite custom HTML transform origin boundary', () => {
  let root: string;
  let server: { transformIndexHtml(url: string, html: string): Promise<string>; close(): Promise<void> };
  beforeAll(async () => {
    const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
    root = mkdtempSync(join(tmpdir(), 'vite-origin-fixture-'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'index.html'), trustedHtml);
    server = await createServer({
      root, configFile: false, appType: 'custom', logLevel: 'silent',
      cacheDir: join(root, '.cache'),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
  });
  afterAll(async () => {
    if (server) await server.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it.each(['//untrusted.invalid/fixture.js?/../../package.json', '///untrusted.invalid/fixture.js?/../../package.json'])(
    'keeps generated module URLs on the app origin for %s', async (requestUrl) => {
      // The query's .. components must not make an attacker-controlled HTML
      // path look like the real package.json fixture. No attacker URL is fetched.
      const result = await server.transformIndexHtml(requestUrl, trustedHtml);
      const urls = moduleUrls(result);
      expect(urls.some((url) => url.includes('html-proxy'))).toBe(true);
      for (const url of urls) expect(new URL(url, pageOrigin).origin).toBe(pageOrigin);
    },
  );
  it('retains the ordinary inline-module transform for a real index page', async () => {
    const result = await server.transformIndexHtml('/index.html', trustedHtml);
    const urls = moduleUrls(result);
    expect(urls.some((url) => url.includes('index.html?html-proxy'))).toBe(true);
    for (const url of urls) expect(new URL(url, pageOrigin).origin).toBe(pageOrigin);
  });
});
