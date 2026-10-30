import { afterEach, expect, it, vi } from 'vitest';
import './_setup.js';
import { handleDriftTool, driftTools } from '../tools/drift.js';
import { driftOutage } from '../lib/smoke-assertions.js';

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
