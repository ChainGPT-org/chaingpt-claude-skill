import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const script = fileURLToPath(new URL('../../dist/authenticated-smoke-test.js', import.meta.url));
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
