import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'));
const ajvRequire = createRequire(sdkRequire.resolve('ajv'));
const rateLimitRequire = createRequire(sdkRequire.resolve('express-rate-limit'));
const uri = ajvRequire('fast-uri');
const { Address4, Address6, AddressError } = rateLimitRequire('ip-address');

describe('moderate dependency graph invariants', () => {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  it('removes stream-json and stream-chain rather than overriding incompatible module exports', () => {
    expect(Object.keys(lock.packages).filter((path) => /node_modules\/(stream-json|stream-chain)$/.test(path))).toEqual([]);
    expect(() => require.resolve('stream-json')).toThrow();
  });
});

describe('URI normalization at the SDK/Ajv dependency path', () => {
  it('normalizes percent-encoded uppercase hosts consistently', () => {
    expect(uri.parse('//%41.example').host).toBe('a.example');
    expect(uri.equal('//%41.example', '//a.example')).toBe(true);
  });
  it.each(['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)', '%68ttp://a.example/'])(
    'does not activate an encoded scheme in %s', (input) => {
      expect(uri.parse(input).error).toBeTruthy();
      expect(uri.normalize(input)).toBe(input);
    },
  );
  it.each(['http://a@b@evil.example/', 'https://go\tod.example/'])(
    'rejects ambiguous host canonicalization for %s', (input) => {
      expect(uri.parse(input).error).toBeTruthy();
      expect(uri.normalize(input)).toBe(input);
    },
  );
  it.each(['../resource', 'a/../resource'])('preserves relative-reference meaning for %s', (reference) => {
    const base = 'https://fixture.example/one/two/';
    expect(uri.resolve(base, uri.normalize(reference))).toBe(uri.resolve(base, reference));
  });
  it('retains valid JSON Schema URI resolution', () => {
    const Ajv = sdkRequire('ajv');
    const validator = new Ajv().addSchema({ $id: 'https://fixture.example/types', type: 'string' })
      .compile({ type: 'object', properties: { value: { $ref: 'https://fixture.example/types' } } });
    expect(validator({ value: 'valid' })).toBe(true);
    expect(validator({ value: 1 })).toBe(false);
  });
});

describe('IP allowlist and parser boundaries', () => {
  it.each(['isInSubnet', 'isHostInSubnet'])('keeps address families separate in %s', (method) => {
    expect(new Address6('a00::1')[method](new Address4('10.0.0.0/8'))).toBe(false);
    expect(new Address4('32.0.0.1')[method](new Address6('2000::/3'))).toBe(false);
    expect(new Address4('10.1.2.3')[method](new Address4('10.0.0.0/8'))).toBe(true);
    expect(new Address6('2001:db8::1')[method](new Address6('2001:db8::/32'))).toBe(true);
  });
  it('bounds invalid IPv6 diagnostics and preserves legitimate zone identifiers', () => {
    let error: Error | undefined;
    try { new Address6('!'.repeat(10000)); } catch (caught) { error = caught as Error; }
    expect(error).toBeInstanceOf(AddressError);
    expect(error!.message.length).toBeLessThan(100);
    expect(Address6.isValid('fe80::1%eth0')).toBe(true);
    expect(Address6.isValid('2001:db8::1/64')).toBe(true);
  });
  it('rejects hostile IPv6 zone input within a bounded child process', () => {
    const source = `const { Address6 } = require(${JSON.stringify(rateLimitRequire.resolve('ip-address'))});
      if (Address6.isValid('%'.repeat(100000) + '\\n')) process.exit(2);`;
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', source], { timeout: 1500, maxBuffer: 32 * 1024 });
    expect(child.error?.message ?? child.stderr.toString()).toBe('');
    expect(child.status).toBe(0);
  });
});

describe('Jayson 5 compatibility through Solana consumers', () => {
  const jayson = require('jayson');
  async function parse(chunks: (string | Buffer)[], options = {}) {
    const values: any[] = [];
    const errors: Error[] = [];
    const stream = Readable.from(chunks);
    jayson.Utils.parseStream(stream, options, (error: Error | null, value: unknown) => error ? errors.push(error) : values.push(value));
    await new Promise<void>((resolve) => stream.on('end', () => setImmediate(resolve)));
    return { values, errors };
  }
  it('keeps __proto__ as an own JSON property without replacing object prototypes', async () => {
    const result = await parse(['{"jsonrpc":"2.0","id":1,"result":{"__proto__":{"canary":"inherited"},"ok":true}}\n']);
    expect(result.errors).toEqual([]);
    const value = result.values[0].result;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value.canary).toBeUndefined();
    expect(value.ok).toBe(true);
  });
  it('decodes split UTF-8 frames and applies the documented reviver', async () => {
    const bytes = Buffer.from('{"jsonrpc":"2.0","id":1,"result":"🧪"}\n{"jsonrpc":"2.0","id":2,"result":2}\n');
    const result = await parse([...bytes].map((byte) => Buffer.from([byte])), {
      reviver: (key: string, value: unknown) => key === 'result' && value === 2 ? 3 : value,
    });
    expect(result.errors).toEqual([]);
    expect(result.values.map((value) => value.result)).toEqual(['🧪', 3]);
  });
  it('reports malformed or unterminated frames once', async () => {
    const malformed = await parse(['{"id":}\n', '{}\n']);
    expect(malformed.errors).toHaveLength(1);
    expect(malformed.values).toEqual([]);
    const truncated = await parse(['{"id":1}']);
    expect(truncated.errors).toHaveLength(1);
    expect(truncated.values).toEqual([]);
  });
  it.each(['@solana/web3.js', '@mrgnlabs/mrgn-common'])('preserves Solana RPC calls through %s', async (consumer) => {
    const consumerRequire = createRequire(require.resolve(consumer));
    const { Connection } = consumer === '@solana/web3.js' ? require(consumer) : consumerRequire('@solana/web3.js');
    const fetch = vi.fn(async (_url: unknown, options: { body: string }) => {
      const request = JSON.parse(options.body);
      expect(request.method).toBe('getVersion');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { 'solana-core': 'fixture', 'feature-set': 1 } }), { headers: { 'content-type': 'application/json' } });
    });
    const connection = new Connection('http://127.0.0.1:8899', { fetch, httpAgent: false });
    expect(await connection.getVersion()).toEqual({ 'solana-core': 'fixture', 'feature-set': 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves the browser-client API resolved by the legacy Jito Solana dependency', async () => {
    const jitoRequire = createRequire(require.resolve('jito-ts'));
    const legacyRequire = createRequire(jitoRequire.resolve('@solana/web3.js'));
    const BrowserClient = legacyRequire('jayson/lib/client/browser');
    const client = new BrowserClient((body: string, callback: (error: Error | null, result: string) => void) => {
      const request = JSON.parse(body);
      expect(request.method).toBe('getVersion');
      callback(null, JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'fixture-version' }));
    });
    const result = await new Promise((resolve, reject) => client.request('getVersion', [], (error: Error | null, response: { result: string }) => error ? reject(error) : resolve(response.result)));
    expect(result).toBe('fixture-version');
  });
});
