import { describe, it, expect, afterEach, vi } from 'vitest';
import './_setup.js';
import { handleX402Tool } from '../tools/x402.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYER = '0x1111111111111111111111111111111111111111';
const PAYEE = '0x2222222222222222222222222222222222222222';

const CHALLENGE = {
  x402Version: 1,
  accepts: [{
    scheme: 'exact',
    network: 'base',
    maxAmountRequired: '10000',
    resource: 'https://api.example.com/v1/report',
    payTo: PAYEE,
    maxTimeoutSeconds: 60,
    asset: USDC_BASE,
    extra: { name: 'USD Coin', version: '2' },
  }],
  error: 'X-PAYMENT header is required',
};

function mockFetch(status: number, body: string) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, { status, headers: { 'content-type': 'application/json' } })
  );
}

afterEach(() => vi.restoreAllMocks());

describe('chaingpt_x402_fetch', () => {
  it('returns the body on 2xx', async () => {
    mockFetch(200, JSON.stringify({ data: 'free content' }));
    const r = await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/free' });
    expect(r.content[0].text).toContain('HTTP 200');
    expect(r.content[0].text).toContain('free content');
  });

  it('rejects non-https URLs', async () => {
    const r = await handleX402Tool('chaingpt_x402_fetch', { url: 'http://insecure.example.com' });
    expect(r.content[0].text).toMatch(/https/);
  });

  it('decodes a 402 challenge and asks for `from` when absent', async () => {
    mockFetch(402, JSON.stringify(CHALLENGE));
    const r = await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/v1/report' });
    const t = r.content[0].text;
    expect(t).toContain('HTTP 402 Payment Required');
    expect(t).toContain('10000');
    expect(t).toContain(PAYEE);
    expect(t).toContain('Pass `from`');
  });

  it('builds the unsigned EIP-3009 typed data when `from` is given', async () => {
    mockFetch(402, JSON.stringify(CHALLENGE));
    const r = await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/v1/report', from: PAYER });
    const t = r.content[0].text;
    expect(t).toContain('TransferWithAuthorization');
    expect(t).toContain(PAYER);
    expect(t).toContain('xPaymentHeader');
  });

  it('sends the X-PAYMENT header on retry and reports paid success', async () => {
    const spy = mockFetch(200, JSON.stringify({ data: 'paid content' }));
    const r = await handleX402Tool('chaingpt_x402_fetch', {
      url: 'https://api.example.com/v1/report',
      xPaymentHeader: 'BASE64HEADER',
    });
    expect(r.content[0].text).toContain('paid via X-PAYMENT');
    expect(r.content[0].text).toContain('paid content');
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-PAYMENT']).toBe('BASE64HEADER');
  });

  it('handles a malformed 402 body gracefully', async () => {
    mockFetch(402, 'not json');
    const r = await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/v1/report' });
    expect(r.content[0].text).toMatch(/not valid x402 JSON/);
  });
});
