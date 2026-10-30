import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('high-severity dependency graph invariants', () => {
  const lock = JSON.parse(readFileSync(resolve(__dirname, '../../package-lock.json'), 'utf8'));
  const floors = { 'body-parser': '1.20.9', 'source-map-js': '1.2.2', vite: '8.2.4' };
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

it.each(['gzip', 'deflate'])('keeps Express 4 alive after trailing bytes on a %s body', (encoding) => {
  const child = spawnSync(process.execPath, ['--max-old-space-size=128', resolve(__dirname, '../../../scripts/fixtures/compressed-body.cjs'), require.resolve('express'), encoding], { timeout: 5000, maxBuffer: 32 * 1024 });
  expect(child.error?.message ?? child.stderr.toString()).toBe('');
  expect(child.status).toBe(0);
  expect(child.stdout.toString()).toBe('compressed-body:ok\n');
});
