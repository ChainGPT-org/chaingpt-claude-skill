import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chaingpt-launcher-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(new URL('../mcp-server/launch.mjs', import.meta.url), join(dir, 'launch.mjs'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    type: 'module', dependencies: { '@fixture/dep': '1.0.0' },
  }));
  return dir;
}

function launch(dir) {
  // No package manager on PATH. Missing dependencies must block execution.
  return spawnSync(process.execPath, [join(dir, 'launch.mjs')], {
    cwd: dir, env: { PATH: dir }, encoding: 'utf8', timeout: 5000,
  });
}

test('missing dependencies fail closed before importing the server', t => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/index.js'), 'throw new Error("must not execute");');
  const result = launch(dir);
  assert.equal(result.status, 78);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /missing: @fixture\/dep/);
  assert.doesNotMatch(result.stderr, /must not execute/);
});

test('missing build fails closed even with installed dependencies', t => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'node_modules/@fixture/dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/@fixture/dep/package.json'), '{}');
  const result = launch(dir);
  assert.equal(result.status, 78);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /missing: dist\/index.js/);
});

test('prepared install imports the server without a package manager', t => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'node_modules/@fixture/dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/@fixture/dep/package.json'), '{}');
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/index.js'), 'process.stdout.write("fixture-started");');
  const result = launch(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'fixture-started');
  assert.equal(result.stderr, '');
});
