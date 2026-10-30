import { it, expect, vi, afterEach } from 'vitest';
import { handleX402Tool } from '../tools/x402.js';
afterEach(() => vi.restoreAllMocks());
it('sends a JSON object, not a double-encoded string, to the facilitator', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ valid: true }) } as Response);
  const args = { action: 'verify', facilitatorUrl: 'https://fixture.invalid', paymentPayload: { fixture: 1 }, paymentRequirements: { fixture: 2 } };
  await handleX402Tool('chaingpt_x402_facilitator', args);
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body).toEqual({ paymentPayload: args.paymentPayload, paymentRequirements: args.paymentRequirements });
});
it('refuses signature assembly without the exact original authorization', async () => {
  const r = await handleX402Tool('chaingpt_x402_build_payment', { from: '0x1111111111111111111111111111111111111111', payTo: '0x2222222222222222222222222222222222222222', network: 'base', amount: '0.01', signature: '0x00' });
  expect(r.content[0].text).toMatch(/EXACT original authorization/);
});
