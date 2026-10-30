import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'));
const expressPath = sdkRequire.resolve('express');
const orcaRequire = createRequire(require.resolve('@orca-so/whirlpool-sdk'));
const switchboardRequire = createRequire(require.resolve('@switchboard-xyz/common'));

describe('high-severity dependency graph invariants', () => {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const floors = {
    '@modelcontextprotocol/sdk': '1.32.0', '@grpc/grpc-js': '1.14.5',
    'follow-redirects': '1.16.1', 'source-map-js': '1.2.2',
    toml: '5.0.1', vite: '8.2.4', zod: '4.6.6',
  };
  it.each(Object.entries(floors))('keeps every resolved %s above its advisory floor', (name, minimum) => {
    const entries = Object.entries(lock.packages).filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, entry] of entries) {
      const version = (entry as { version: string }).version;
      expect(version, path).toMatch(/^\d+\.\d+\.\d+$/);
      const order = version.split('.').map(Number);
      const floor = minimum.split('.').map(Number);
      const first = order.findIndex((value, index) => value !== floor[index]);
      expect(first < 0 || order[first] > floor[first], `${path}: ${version}`).toBe(true);
    }
  });
});

describe('patched runtime dependencies', () => {
  it('ignores inherited Axios form visitors while preserving nested serialization', () => {
    const axios = orcaRequire('axios');
    const visitor = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'visitor');
    const append = vi.fn();
    try {
      Object.defineProperty(Object.prototype, 'visitor', { configurable: true, value: visitor });
      axios.toFormData({ account: { label: 'fixture' } }, { append });
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'visitor', original);
      else Reflect.deleteProperty(Object.prototype, 'visitor');
    }
    expect(visitor).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith('account[label]', 'fixture');
  });

  it('retains CommonJS and Buffer parsing for both Anchor dependency paths', () => {
    for (const anchor of ['@coral-xyz/anchor', '@project-serum/anchor']) {
      const anchorRequire = createRequire(require.resolve(anchor));
      const toml = anchorRequire('toml');
      const parsed = toml.parse(Buffer.from('[provider]\ncluster = "localnet"\n[programs.localnet]\nfixture = "11111111111111111111111111111111"\n[workspace]\nmembers = ["programs/fixture"]\n'));
      expect(parsed.provider.cluster).toBe('localnet');
      expect(parsed.workspace.members).toEqual(['programs/fixture']);
      expect(parsed.programs.localnet.fixture).toBe('11111111111111111111111111111111');
      expect(() => toml.parse('counter = ' + '9'.repeat(1000))).toThrow(/64-bit/);
    }
  });

  it.each(['tables', 'dotted'])('parses bounded %s stress fixtures without quadratic work', (shape) => {
    // The child has a heap cap and deadline; no unbounded stress runs in Vitest.
    const program = `
      const { parse } = require(${JSON.stringify(require.resolve('toml'))});
      const input = ${JSON.stringify(shape)} === 'tables'
        ? Array.from({length: 20000}, (_, i) => '[[item' + i + ']]\\nvalue=1\\n').join('')
        : Array(20000).fill('part').join('.') + '=1';
      const result = parse(input);
      if (!result || Object.keys(result).length === 0) process.exit(2);
    `;
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', program], { timeout: 3000, maxBuffer: 32 * 1024 });
    expect(child.error?.message ?? child.stderr.toString()).toBe('');
    expect(child.status).toBe(0);
  });

  it.each(['application', 'Switchboard'])('rejects oversized constrained Zod arrays before visiting %s elements', (path) => {
    const { z } = path === 'application' ? require('zod') : switchboardRequire('zod');
    let visits = 0;
    const schema = z.array(z.preprocess((value: unknown) => { visits++; return value; }, z.number())).max(2);
    const result = schema.safeParse(Array(1000).fill('invalid'));
    expect(result.success).toBe(false);
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0].code).toBe('too_big');
    expect(visits).toBe(0);
    expect(schema.parse([1, 2])).toEqual([1, 2]);
    expect(visits).toBe(2);
  });

  it('keeps Switchboard oracle normalization and protobuf serialization compatible with stable Zod', async () => {
    const { OracleJobUtils, OracleFeedUtils } = await import('@switchboard-xyz/common');
    const job = { tasks: [{ valueTask: { value: 7 } }] };
    const encoded = OracleJobUtils.serializeOracleJob(job);
    expect(OracleJobUtils.deserializeOracleJob(encoded).tasks[0].valueTask?.value).toBe(7);
    expect(OracleFeedUtils.normalizeOracleFeed({ jobs: [job] }).jobs).toHaveLength(1);
    expect(() => OracleJobUtils.normalizeOracleJob({ tasks: [] })).toThrow();
    expect(() => OracleFeedUtils.normalizeOracleFeed({ jobs: [] })).toThrow();
  });

  it.each([false, true])('exposes peer certificates only for authorized TLS sockets (authorized=%s)', (authorized) => {
    const { BaseServerInterceptingCall } = require('@grpc/grpc-js/build/src/server-interceptors.js');
    const certificate = { raw: Buffer.from('fixture-certificate') };
    const socket = Object.assign(Object.create(TLSSocket.prototype), {
      authorized, getPeerCertificate: () => certificate,
    });
    const context = BaseServerInterceptingCall.prototype.getAuthContext.call({ stream: { session: { socket } } });
    expect(context).toEqual(authorized ? { transportSecurityType: 'ssl', sslPeerCertificate: certificate } : {});
  });

  it.each(['gzip', 'deflate'])('keeps Express 5 alive after trailing bytes on a %s body', (encoding) => {
    const fixture = fileURLToPath(new URL('../../../scripts/fixtures/compressed-body.cjs', import.meta.url));
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', fixture, expressPath, encoding], { timeout: 5000, maxBuffer: 32 * 1024 });
    expect(child.error?.message ?? child.stderr.toString()).toBe('');
    expect(child.status).toBe(0);
    expect(child.stdout.toString()).toBe('compressed-body:ok\n');
  });
});

describe('redirect credential stripping', () => {
  const follow = require('follow-redirects');
  const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
  const close = (server: Server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  it.each(['object', 'array'])('strips built-in and regex-sensitive custom credentials from %s headers across origins', async (kind) => {
    const target = createServer((req, res) => res.end(JSON.stringify(req.headers)));
    const targetPort = await listen(target);
    const redirector = createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/target` }); res.end(); });
    const sourcePort = await listen(redirector);
    const headers = { Authorization: 'fixture-only', Cookie: 'fixture=only', 'Proxy-Authorization': 'fixture-only', 'X-Key^Name': 'fixture-only', 'X-Key|Name': 'fixture-only', 'X-Trace': 'retained' };
    try {
      const received = await new Promise<Record<string, string>>((resolve, reject) => {
        const req = follow.http.get(`http://127.0.0.1:${sourcePort}/start`, {
          headers: kind === 'array' ? Object.entries(headers).flat() : headers,
          sensitiveHeaders: ['X-Key^Name', 'X-Key|Name'], timeout: 1500,
        }, (res: NodeJS.ReadableStream) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolve(JSON.parse(body)));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('fixture redirect timed out')));
      });
      for (const name of ['authorization', 'cookie', 'proxy-authorization', 'x-key^name', 'x-key|name']) expect(received[name]).toBeUndefined();
      expect(received['x-trace']).toBe('retained');
    } finally {
      await Promise.all([close(redirector), close(target)]);
    }
  });
});
