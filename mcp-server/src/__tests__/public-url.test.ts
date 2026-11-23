import { describe, it, expect, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => host === 'slow.example' ? new Promise(() => {}) : ({
    'public.example': [{ address: '93.184.215.14', family: 4 }],
    'mixed.example': [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.5', family: 4 }],
    'mapped.example': [{ address: '::ffff:127.0.0.1', family: 6 }],
    'rebind.example': [{ address: '93.184.215.14', family: 4 }],
    'rebind6.example': [{ address: '93.184.215.14', family: 4 }],
  } as Record<string, unknown>)[host] ?? [{ address: '127.0.0.1', family: 4 }]),
}));

// The connect-time lookup. A rebinding DNS server answered the first query (above) with a public address;
// by the time the socket connects it answers with a private one.
vi.mock('node:dns', () => ({
  lookup: vi.fn((host: string, _opts: unknown, cb: (err: Error | null, addrs: { address: string; family: number }[]) => void) =>
    cb(null, host === 'rebind6.example' ? [{ address: '::ffff:169.254.169.254', family: 6 }] : [{ address: '10.0.0.5', family: 4 }])),
}));

import { lookup as connectLookup } from 'node:dns';
import { assertPublicUrl, parsePublicJson, publicFetch, publicJson, readBounded } from '../lib/public-url.js';
import { bundlerRpc } from '../lib/erc4337.js';

describe('assertPublicUrl', () => {
  it('allows public hosts', async () => {
    await expect(assertPublicUrl('https://public.example/card.json')).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('http://public.example/card.json')).resolves.toBeInstanceOf(URL);
  });

  it('refuses loopback, private, link-local, metadata and mapped addresses', async () => {
    for (const u of ['http://localhost/', 'http://127.0.0.1:8545/', 'http://10.1.2.3/', 'http://192.168.0.1/', 'http://169.254.169.254/',
      'http://[::1]/', 'http://[fd00::1]/', 'http://[::7f00:1]/', 'http://[::ffff:0:7f00:1]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:7f00:1::]/', 'http://[fec0::1]/', 'http://mixed.example/', 'http://mapped.example/', 'http://0.0.0.0/']) {
      await expect(assertPublicUrl(u), u).rejects.toThrow(/loopback, private or link-local/);
    }
  });

  it('refuses non-http schemes and plain http when https is required', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/must be http/);
    await expect(assertPublicUrl('http://public.example/', { httpsOnly: true })).rejects.toThrow(/must be https/);
  });
});

describe('publicFetch', () => {
  it('refuses the connection when DNS rebinds to a private address after the first check', async () => {
    for (const u of ['http://rebind.example/card.json', 'https://rebind.example/card.json', 'https://rebind6.example/']) {
      await expect(assertPublicUrl(u), u).resolves.toBeInstanceOf(URL);
      await expect(publicFetch(u), u).rejects.toThrow(/loopback, private or link-local/);
    }
    expect(connectLookup).toHaveBeenCalledWith('rebind.example', expect.objectContaining({ all: true }), expect.any(Function));
  });

  it('keeps the up-front checks', async () => {
    await expect(publicFetch('http://127.0.0.1:8545/')).rejects.toThrow(/loopback, private or link-local/);
    await expect(publicFetch('http://public.example/', {}, { httpsOnly: true })).rejects.toThrow(/must be https/);
  });

  it('rejects an unparsable URL without keeping it (or a key in it) anywhere on the error', async () => {
    let err: unknown;
    try { await publicFetch('https://card.example:bad/agent.json?api_key=SECRET-KEY-2'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBeUndefined();
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('SECRET-KEY-2');
    expect(Object.values(err as object).join(' ')).not.toContain('SECRET-KEY-2');
  });
});

describe('publicJson (bundler / facilitator transport)', () => {
  it('refuses private, metadata and plain-http endpoints before connecting', async () => {
    for (const u of ['https://127.0.0.1:4337/rpc', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]/', 'https://internal.bundler/rpc', 'https://mixed.example/']) {
      await expect(publicJson(u), u).rejects.toThrow(/loopback, private or link-local/);
    }
    await expect(publicJson('http://public.example/supported')).rejects.toThrow(/must be https/);
  });

  it('rejects an unparsable endpoint without keeping the URL (or a key in it) anywhere on the error', async () => {
    let err: unknown;
    try { await publicJson('https://bundler.example:bad/rpc?api_key=SECRET-KEY-1'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBeUndefined();
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('SECRET-KEY-1');
    expect(Object.values(err as object).join(' ')).not.toContain('SECRET-KEY-1');
  });

  it('applies the timeout to the DNS check too', async () => {
    const t0 = Date.now();
    await expect(publicJson('https://slow.example/rpc', { timeoutMs: 50 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('an already-aborted signal wins, and the refused check is not left unhandled', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const ac = new AbortController();
      const reason = new Error('caller gave up');
      ac.abort(reason);
      await expect(publicFetch('https://127.0.0.1/', { signal: ac.signal })).rejects.toBe(reason);
      await new Promise(r => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('is the transport bundlerRpc uses', async () => {
    await expect(bundlerRpc({ url: 'https://127.0.0.1:4337/', method: 'eth_supportedEntryPoints', params: [] })).rejects.toThrow(/loopback, private or link-local/);
  });
});

describe('readBounded', () => {
  it('reads small bodies and refuses oversized ones by header or by stream', async () => {
    await expect(readBounded(new Response('{"ok":1}'), 100)).resolves.toBe('{"ok":1}');
    await expect(readBounded(new Response('x'.repeat(101)), 100)).rejects.toThrow(/exceeds 100 bytes/);
    await expect(readBounded(new Response('x', { headers: { 'content-length': '5000' } }), 100)).rejects.toThrow(/exceeds 100 bytes/);
  });
});

describe('JSON decoding of bounded bodies', () => {
  it('strips a UTF-8 BOM so BOM-prefixed JSON (x402 challenges, agent cards) still parses', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"x402Version":1}')]);
    const text = await readBounded(new Response(bom), 100);
    expect(text).toBe('{"x402Version":1}');
    expect(parsePublicJson(text, 'facilitator.example')).toEqual({ x402Version: 1 });
  });

  it('reports invalid JSON by host only, without the body or the parser error', () => {
    let err: unknown;
    try { parsePublicJson('<html>key=sk-live-REFLECTED-123</html>', 'bundler.example'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Invalid JSON response from bundler.example');
    expect((err as Error).cause).toBeUndefined();
    expect(String((err as Error).stack)).not.toContain('REFLECTED');
  });
});
