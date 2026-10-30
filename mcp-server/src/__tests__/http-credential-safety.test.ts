import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpJson } from '../lib/http.js';
import { handleRiskTool } from '../tools/risk.js';

const secret = 'fixture-private-api-key-do-not-log';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('authenticated HTTP diagnostics', () => {
  it('sends the real Etherscan key but omits it and reflected bodies from errors', async () => {
    const url = `https://api.etherscan.io/v2/api?chainid=1&apikey=${secret}`;
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`invalid key ${secret}`, { status: 401 }));
    const error = await httpJson(url).catch(e => e);
    expect(fetch.mock.calls[0][0]).toBe(url);
    expect(String(error)).toContain('HTTP 401');
    expect(String(error)).toContain('api.etherscan.io/v2/api');
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain('invalid key');
  });

  it.each(['Authorization', 'X-API-Key', 'api-key', 'Cookie'])('omits credential-bearing response details for %s', async name => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('prefix '.repeat(25) + secret.slice(0, 12), { status: 403 }));
    const error = await httpJson('https://api.example.test/read', { headers: { [name]: secret } }).catch(e => e);
    expect(String(error)).toContain('HTTP 403');
    expect(String(error)).not.toContain('prefix');
    expect(String(error)).not.toContain(secret.slice(0, 12));
  });

  it('does not retain secret-bearing network error messages or causes', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`failed for ${secret}`, { cause: { credential: secret } }));
    const error = await httpJson(`https://api.example.test/read?access_token=${secret}`).catch(e => e);
    expect(String(error)).not.toContain(secret);
    if (!(error instanceof Error)) throw new Error('Expected a sanitized request error.');
    expect(error.cause).toBeUndefined();
  });

  it('omits authenticated JSON parser excerpts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`not json ${secret}`));
    const error = await httpJson('https://api.example.test/read', { headers: { 'x-api-key': secret } }).catch(e => e);
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain('not json');
  });

  it('redacts URL userinfo and credential parameter variants', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('invalid URL'));
    const error = await httpJson(`https://reader:${secret}@api.example.test/read?API_KEY=${secret}&token=${secret}`).catch(e => e);
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain('reader');
  });

  it('preserves useful public API error bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<title>Just a moment...</title>', { status: 403 }));
    await expect(httpJson('https://open-api.openocean.finance/v4/base/quote')).rejects.toThrow('<title>Just a moment...</title>');
  });
  it.each(['http', 'network'])('does not expose credentials placed after a URL fragment on %s failure', async failure => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    if (failure === 'http') fetch.mockResolvedValue(new Response('missing API key', { status: 401 }));
    else fetch.mockRejectedValue(new Error(`request failed for #apikey=${secret}`));
    const url = `https://api.etherscan.io/v2/api?module=contract&address=0x123#fragment&apikey=${secret}`;
    const error = await httpJson(url).catch(e => e);
    expect(fetch.mock.calls[0][0]).toBe(url);
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain('#fragment');
  });

  it('cancels an authenticated rejected response body instead of leaving it unconsumed', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 403 }));
    await expect(httpJson('https://api.example.test/read', { headers: { 'x-api-key': secret } })).rejects.toThrow('HTTP 403');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps an Etherscan key private when a source-lookup address introduces a fragment', async () => {
    vi.stubEnv('ETHERSCAN_API_KEY', secret);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream rejection', { status: 403 }));
    const error = await handleRiskTool('chaingpt_risk_contract_source', { chain: 'ethereum', address: '0x1111111111111111111111111111111111111111#fragment' }).catch(e => e);
    expect(String(error)).toContain('HTTP 403');
    expect(String(error)).not.toContain(secret);
  });

  it('protects auth_token query values and reflected response text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`rejected token ${secret}`, { status: 403 }));
    const error = await httpJson(`https://api.example.test/read?auth_token=${secret}`).catch(e => e);
    expect(String(error)).toContain('HTTP 403');
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain('rejected token');
  });

});
