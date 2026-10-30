import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const buildDir = mkdtempSync(join(tmpdir(), 'authenticated-smoke-cli-'));
const script = join(buildDir, 'authenticated-smoke-test.js');
beforeAll(() => {
  const compiler = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
  const config = fileURLToPath(new URL('../../tsconfig.build.json', import.meta.url));
  const build = spawnSync(process.execPath, [compiler, '-p', config, '--outDir', buildDir], { encoding: 'utf8', timeout: 20000 });
  expect(build.status, build.stdout + build.stderr).toBe(0);
  writeFileSync(join(buildDir, 'package.json'), JSON.stringify({ type: 'module' }));
  symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(buildDir, 'node_modules'), 'dir');
}, 30000);
afterAll(() => rmSync(buildDir, { recursive: true, force: true }));
function run(provider?: string) {
  return spawnSync(process.execPath, [script, ...(provider ? [provider] : [])], { encoding: 'utf8', timeout: 5000,
    env: { ...process.env, ETHERSCAN_API_KEY: '', ONEINCH_API_KEY: '', MORALIS_API_KEY: '', CHAINGPT_API_KEY: '' } });
}
describe('authenticated smoke CLI', () => {
  it('skips all seven cases without credentials, with no successful-auth claims', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 passed, 0 failed, 7 skipped');
    expect(result.stdout).not.toContain('PASS');
  });
  it('limits execution to the selected provider', () => {
    const result = run('moralis');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 passed, 0 failed, 3 skipped');
    expect(result.stdout).not.toContain('etherscan');
  });
  it('rejects unknown providers before making requests', () => {
    const result = run('unknown');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown provider');
  });
});
