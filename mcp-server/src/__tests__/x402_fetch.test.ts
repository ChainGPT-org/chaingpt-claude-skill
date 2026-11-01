import { describe, it, expect, afterEach, vi } from 'vitest';
import './_setup.js';

// Offline DNS: example hosts resolve to a public documentation address; *.internal.test to loopback.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => [{ address: host.endsWith('.internal.test') ? '127.0.0.1' : '93.184.215.14', family: 4 }]),
}));

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

  it('asks for a budget before building a payment, and refuses a price above it', async () => {
    mockFetch(402, JSON.stringify(CHALLENGE));
    let t = (await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/v1/report', from: PAYER })).content[0].text;
    expect(t).toContain('Pass maxAtomicAmount');
    expect(t).not.toContain('TransferWithAuthorization');
    mockFetch(402, JSON.stringify(CHALLENGE));
    t = (await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/v1/report', from: PAYER, maxAtomicAmount: '9999' })).content[0].text;
    expect(t).toMatch(/exceeds maxAtomicAmount 9999/);
  });

  it('builds the unsigned EIP-3009 typed data when `from` is given', async () => {
    mockFetch(402, JSON.stringify(CHALLENGE));
    const r = await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/v1/report', from: PAYER, maxAtomicAmount: '10000' });
    const t = r.content[0].text;
    expect(t).toContain('TransferWithAuthorization');
    expect(t).toContain(PAYER);
    expect(t).toContain('--- PaymentRequirements (pass unchanged as `requirements`) ---');
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

describe('x402_fetch SSRF guards', () => {
  it('refuses hosts that resolve to loopback/private addresses and literal internal IPs', async () => {
    for (const url of ['https://metadata.internal.test/latest', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/x']) {
      const r = await handleX402Tool('chaingpt_x402_fetch', { url });
      expect(r.content[0].text, url).toMatch(/loopback, private or link-local/);
    }
  });

  it('does not follow redirects (the X-PAYMENT header must not travel to another host)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } }));
    const r = await handleX402Tool('chaingpt_x402_fetch', { url: 'https://api.example.com/pay', xPaymentHeader: 'abc' });
    expect(r.content[0].text).toMatch(/redirect .* not followed/);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
  });
});

describe('x402_build_payment server-controlled fields', () => {
  it('caps the validity window at one hour and shows unknown tokens in atomic units', async () => {
    const req = { ...CHALLENGE.accepts[0], asset: '0x' + '3'.repeat(40), maxTimeoutSeconds: 10 ** 9, extra: { name: 'Weird', version: '1' } };
    const t = (await handleX402Tool('chaingpt_x402_build_payment', { from: PAYER, requirements: req, maxAtomicAmount: '10000' })).content[0].text;
    const expires = Date.parse(/expires:\s+(\S+)/.exec(t)![1]);
    expect(expires - Date.now()).toBeLessThanOrEqual(3600_000 + 5_000);
    expect(t).toContain('unrecognised token: amounts shown in atomic units');
    expect(t).toMatch(/pay:\s+10000 /);
    // The label is display-only: the EIP-712 domain name is exactly what the server's requirements said.
    expect(t).toMatch(/"name": "Weird"/);
  });

  it('an authorization passed back without a signature still needs the budget and the one-hour cap', async () => {
    const req = { ...CHALLENGE.accepts[0] };
    const authorization = { from: PAYER, to: PAYEE, value: '10000', validAfter: '0',
      validBefore: String(Math.floor(Date.now() / 1000) + 365 * 86400), nonce: '0x' + '11'.repeat(32) };
    let t = (await handleX402Tool('chaingpt_x402_build_payment', { from: PAYER, requirements: req, authorization })).content[0].text;
    expect(t).toContain('Pass maxAtomicAmount');
    t = (await handleX402Tool('chaingpt_x402_build_payment', { from: PAYER, requirements: req, authorization, maxAtomicAmount: '10000' })).content[0].text;
    expect(t).toContain('limited to one hour');
    t = (await handleX402Tool('chaingpt_x402_build_payment', { from: PAYER, requirements: req, authorization, signature: '0x' + '00'.repeat(65) })).content[0].text;
    expect(t).toContain('limited to one hour');
  });
});
