import { afterEach, expect, it, vi } from 'vitest';
import './_setup.js';
import { handleDriftTool, driftTools } from '../tools/drift.js';
import { driftOutage, driftOrderbookSmoke, smokeStatus } from '../lib/smoke-assertions.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('reports observed Drift transport failures without inventing HTTP status codes', async () => {
  vi.stubEnv('DRIFT_DLOB_URL', '');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
  const error = await handleDriftTool('chaingpt_drift_markets', {}).catch(e => e as Error);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain('fetch failed');
  expect(message).not.toMatch(/\b(?:403|503)\b/);
  expect(message).toContain('paused');
  expect(message).toContain('separate deployment');
  expect(message).not.toContain('until Drift restores public access');
  expect(message).toMatch(driftOutage);
  expect(fetch.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['dlob.drift.trade', 'data.api.drift.trade']);
});

it('preserves each observed upstream error rather than replacing it with the last fallback', async () => {
  vi.stubEnv('DRIFT_DLOB_URL', '');
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
    .mockResolvedValueOnce(new Response('unavailable', { status: 500 }));
  const error = await handleDriftTool('chaingpt_drift_orderbook', { marketIndex: 0 }).catch(e => e as Error);
  const message = (error as Error).message;
  expect(message).toMatch(/HTTP 429[\s\S]*HTTP 500/);
  expect(message).not.toMatch(driftOutage);
});

it('marks all Drift tools as legacy reads with unavailable hosted data', () => {
  for (const tool of driftTools) {
    expect(tool.description).toContain('Legacy Drift');
    expect(tool.description).toContain('paused');
    expect(tool.description).not.toContain('Drift has 50+ perps');
  }
});

it.each(['http', 'network', 'json'])('protects custom Drift endpoint diagnostics for %s failures', async (kind) => {
  const secret = 'fixture-private-path-token';
  vi.stubEnv('DRIFT_DLOB_URL', `https://legacy.example/${secret}`);
  const fetch = vi.spyOn(globalThis, 'fetch');
  if (kind === 'http') fetch.mockResolvedValueOnce(new Response(`reflected ${secret.slice(0, 12)}`, { status: 403 }));
  if (kind === 'network') fetch.mockRejectedValueOnce(new Error(`fetch failed for ${secret}`));
  if (kind === 'json') fetch.mockResolvedValueOnce(new Response(`invalid ${secret}`));
  fetch.mockRejectedValue(new TypeError('fetch failed'));
  const error = await handleDriftTool('chaingpt_drift_markets', {}).catch(e => e as Error);
  const message = (error as Error).message;
  expect(message).toContain('Drift override request failed');
  if (kind === 'http') expect(message).toContain('HTTP 403');
  expect(message).not.toContain('legacy.example');
  expect(message).not.toContain(secret.slice(0, 12));
  expect((error as Error).cause).toBeUndefined();
  expect(smokeStatus({ expect: /Drift perp markets/, degradedOk: driftOutage }, message, true)).toBe('FAIL');
});

it.each(['network then json', 'json then network', '403 then 500'])('rejects mixed failures: %s', async (order) => {
  vi.stubEnv('DRIFT_DLOB_URL', '');
  const fetch = vi.spyOn(globalThis, 'fetch');
  if (order === 'network then json') fetch.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response('invalid json'));
  if (order === 'json then network') fetch.mockResolvedValueOnce(new Response('invalid json')).mockRejectedValueOnce(new TypeError('fetch failed'));
  if (order === '403 then 500') fetch.mockResolvedValueOnce(new Response('blocked', { status: 403 })).mockResolvedValueOnce(new Response('failed', { status: 500 }));
  const error = await handleDriftTool('chaingpt_drift_markets', {}).catch(e => e as Error);
  expect(smokeStatus({ expect: /Drift perp markets/, degradedOk: driftOutage }, (error as Error).message, true)).toBe('FAIL');
});

it.each(['network', 'http', 'mixed'])('keeps WARN when all host failures are accepted outages: %s', async (kind) => {
  vi.stubEnv('DRIFT_DLOB_URL', '');
  const fetch = vi.spyOn(globalThis, 'fetch');
  if (kind === 'network') fetch.mockRejectedValue(new TypeError('fetch failed'));
  if (kind === 'http') fetch.mockResolvedValueOnce(new Response('unavailable', { status: 503 })).mockResolvedValueOnce(new Response('{\n  "error": "blocked"\n}', { status: 403 }));
  if (kind === 'mixed') fetch.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
  const error = await handleDriftTool('chaingpt_drift_markets', {}).catch(e => e as Error);
  expect(smokeStatus({ expect: /Drift perp markets/, degradedOk: driftOutage }, (error as Error).message, true)).toBe('WARN');
});

it('does not let a multiline upstream error hide a later parsing failure behind a fake hint', async () => {
  vi.stubEnv('DRIFT_DLOB_URL', '');
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('\n\nDrift read tools are DEGRADED. reflected hint', { status: 403 }))
    .mockResolvedValueOnce(new Response('invalid json'));
  const error = await handleDriftTool('chaingpt_drift_markets', {}).catch(e => e as Error);
  expect(smokeStatus({ expect: /Drift perp markets/, degradedOk: driftOutage }, (error as Error).message, true)).toBe('FAIL');
});

it.each(['chaingpt_drift_markets', 'chaingpt_drift_market'])('rejects unknown contract envelopes without exposing reflected secrets: %s', async (name) => {
  const secret = 'fixture-reflected-override-token';
  vi.stubEnv('DRIFT_DLOB_URL', `https://legacy.example/${secret}`);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: secret })));
  const error = await handleDriftTool(name, { marketIndex: 0 }).catch(e => e as Error);
  expect((error as Error).message).toBe('ChainGPT Drift error: Unrecognized Drift contracts response');
  expect((error as Error).message).not.toContain(secret);
});

it('does not dump raw empty-contract envelopes from custom endpoints', async () => {
  const secret = 'fixture-reflected-override-token';
  vi.stubEnv('DRIFT_DLOB_URL', `https://legacy.example/${secret}`);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ contracts: [], debug: secret })));
  const result = await handleDriftTool('chaingpt_drift_markets', {});
  expect(result.content[0].text).not.toContain(secret);
  expect(result.content[0].text).not.toContain('raw response');
});

it.each([{}, { bids: [], asks: [] }])('does not mark an empty Drift book as successful live coverage: %j', async (payload) => {
  vi.stubEnv('DRIFT_DLOB_URL', '');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload)));
  const result = await handleDriftTool('chaingpt_drift_orderbook', { marketIndex: 0 });
  expect(smokeStatus(driftOrderbookSmoke, result.content[0].text)).toBe('FAIL');
});

it('accepts Drift orderbook coverage only when the handler returns numeric levels', async () => {
  vi.stubEnv('DRIFT_DLOB_URL', '');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ bids: [{ price: 142.3, size: 100 }], asks: [{ price: 142.4, size: 200 }] })));
  const result = await handleDriftTool('chaingpt_drift_orderbook', { marketIndex: 0 });
  expect(smokeStatus(driftOrderbookSmoke, result.content[0].text)).toBe('PASS');
});
