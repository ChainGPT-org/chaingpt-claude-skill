import { it, expect, vi, afterEach } from 'vitest';

// Offline DNS: fixture hosts resolve to a public documentation address. The bundler/facilitator transport is
// stubbed after the real https + public-host checks run.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]) }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/public-url.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/public-url.js')>();
  return {
    ...real,
    publicJson: async (url: string, opts: { method?: string; body?: unknown } = {}) => {
      await real.assertPublicUrl(url, { httpsOnly: true });
      const res: Response = await fetchMock(url, { method: opts.method, body: JSON.stringify(opts.body) });
      return JSON.parse(await real.readBounded(res, 1_000_000));
    },
  };
});
import { handleX402Tool } from '../tools/x402.js';
afterEach(() => vi.restoreAllMocks());
it('sends a JSON object, not a double-encoded string, to the facilitator', async () => {
  const fetch = fetchMock.mockResolvedValue(new Response(JSON.stringify({ valid: true }), { status: 200 }));
  const args = { action: 'verify', facilitatorUrl: 'https://facilitator.example', paymentPayload: { fixture: 1 }, paymentRequirements: { fixture: 2 } };
  await handleX402Tool('chaingpt_x402_facilitator', args);
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body).toEqual({ paymentPayload: args.paymentPayload, paymentRequirements: args.paymentRequirements });
});
it('refuses signature assembly without the exact original authorization', async () => {
  const r = await handleX402Tool('chaingpt_x402_build_payment', { from: '0x1111111111111111111111111111111111111111', payTo: '0x2222222222222222222222222222222222222222', network: 'base', amount: '0.01', signature: '0x00' });
  expect(r.content[0].text).toMatch(/EXACT original authorization/);
});
