import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const layoutRequire = createRequire(require.resolve('@solana/buffer-layout-utils'));

describe('security dependency replacements', () => {
  it('uses the reviewed pure-JavaScript bigint implementation through Solana layouts', () => {
    const manifest = layoutRequire('bigint-buffer/package.json');
    expect(manifest.name).toBe('@exodus/bigint-buffer');
    expect(manifest.dependencies).toBeUndefined();

    const { u64 } = require('@solana/buffer-layout-utils');
    const bytes = Buffer.alloc(8);
    const value = (1n << 64n) - 1n;
    u64().encode(value, bytes, 0);
    expect(bytes.toString('hex')).toBe('ffffffffffffffff');
    expect(u64().decode(bytes)).toBe(value);
  });

  it('converts long buffers without native bindings and leaves input unchanged', () => {
    const { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE } = layoutRequire('bigint-buffer');
    const bytes = Buffer.alloc(256, 0xff);
    const original = Buffer.from(bytes);
    const value = (1n << 2048n) - 1n;
    expect(toBigIntLE(bytes)).toBe(value);
    expect(toBigIntBE(bytes)).toBe(value);
    expect(toBufferLE(value, 256)).toEqual(original);
    expect(toBufferBE(value, 256)).toEqual(original);
    expect(bytes).toEqual(original);
    expect(() => toBigIntLE(null)).toThrow();
  });

  it('preserves little-endian and big-endian protocol encoding', () => {
    const { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE } = layoutRequire('bigint-buffer');
    const value = 0x0102030405060708n;
    expect(toBufferLE(value, 8).toString('hex')).toBe('0807060504030201');
    expect(toBufferBE(value, 8).toString('hex')).toBe('0102030405060708');
    expect(toBigIntLE(Buffer.from('0807060504030201', 'hex'))).toBe(value);
    expect(toBigIntBE(Buffer.from('0102030405060708', 'hex'))).toBe(value);
  });

  it('keeps the CommonJS UUID and TOML APIs used by the SDKs', () => {
    const { v4, validate } = require('uuid');
    expect(validate(v4())).toBe(true);
    expect(require('toml').parse('[provider]\ncluster = "localnet"\n')).toEqual({
      provider: { cluster: 'localnet' },
    });
    const jayson = require('jayson');
    expect(validate(jayson.Utils.generateId())).toBe(true);
  });

  it('preserves the temporary-file API used by the Solidity compiler', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chaingpt-dependency-test-'));
    try {
      const file = require('tmp').fileSync({ dir: directory, postfix: '.smt2' });
      expect(existsSync(file.name)).toBe(true);
      expect(file.name.endsWith('.smt2')).toBe(true);
      file.removeCallback();
      expect(existsSync(file.name)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('parses JSON-RPC values without loading the vulnerable stream-json path filters', async () => {
    // GHSA-528h-pc64-c93x explicitly excludes StreamValues. Jayson uses it
    // directly; a forced stream-json 3.x override would break its CJS imports.
    const jayson = require('jayson');
    const parsed = await new Promise<unknown[]>((resolve, reject) => {
      const values: unknown[] = [];
      jayson.Utils.parseStream(
        Readable.from(['{"jsonrpc":"2.0","id":1,"result":', '{"nested":[1,2]}}\n', '{"jsonrpc":"2.0","id":2,"result":null}']),
        {},
        (error: Error | null, value: unknown) => {
          if (error) return reject(error);
          values.push(value);
          if (values.length === 2) resolve(values);
        },
      );
    });
    expect(parsed).toEqual([
      { jsonrpc: '2.0', id: 1, result: { nested: [1, 2] } },
      { jsonrpc: '2.0', id: 2, result: null },
    ]);
    const loaded = new Set<string>();
    const visit = (entry: NodeJS.Module | undefined): void => {
      if (!entry || loaded.has(entry.filename)) return;
      loaded.add(entry.filename);
      entry.children.forEach(visit);
    };
    visit(require.cache[require.resolve('jayson')]);
    const jsonModules = [...loaded].filter((path) => path.includes('/stream-json/'));
    expect(jsonModules.some((path) => path.endsWith('/streamers/StreamValues.js'))).toBe(true);
    expect(jsonModules.filter((path) => path.includes('/filters/'))).toEqual([]);
  });
});
