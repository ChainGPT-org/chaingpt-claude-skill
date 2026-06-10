import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spendStats, logActivity } from '../lib/agent-activity.js';

// spendStats feeds the velocity caps in checkPolicy — its window math and
// fail-closed semantics are load-bearing for the anti-drain control.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cgpt-activity-'));
  process.env.CHAINGPT_ACTIVITY_FILE = join(dir, 'activity.jsonl');
});

afterEach(() => {
  delete process.env.CHAINGPT_ACTIVITY_FILE;
  rmSync(dir, { recursive: true, force: true });
});

function entry(tsOffsetMs: number, valueWei: string) {
  return JSON.stringify({
    ts: new Date(Date.now() + tsOffsetMs).toISOString(),
    chain: 'base',
    chainId: 8453,
    from: '0xfrom',
    to: '0xto',
    valueWei,
    hash: '0xhash',
    policyDigest: 'digest',
  });
}

describe('spendStats', () => {
  it('returns zeros (ok) when the ledger does not exist yet', () => {
    const s = spendStats(24);
    expect(s).toEqual({ totalWei: 0n, txCount: 0, ok: true });
  });

  it('sums value and counts txs inside the rolling window only', () => {
    writeFileSync(
      process.env.CHAINGPT_ACTIVITY_FILE!,
      [
        entry(-1 * 3_600_000, '1000'),      // 1h ago — counted
        entry(-23 * 3_600_000, '500'),      // 23h ago — counted
        entry(-25 * 3_600_000, '999999'),   // 25h ago — outside window
      ].join('\n') + '\n'
    );
    const s = spendStats(24);
    expect(s.ok).toBe(true);
    expect(s.txCount).toBe(2);
    expect(s.totalWei).toBe(1500n);
  });

  it('skips malformed lines without losing the rest', () => {
    writeFileSync(
      process.env.CHAINGPT_ACTIVITY_FILE!,
      ['not-json', entry(-60_000, '42'), '{"ts":"garbage-date","valueWei":"7"}'].join('\n') + '\n'
    );
    const s = spendStats(24);
    expect(s.ok).toBe(true);
    expect(s.txCount).toBe(1);
    expect(s.totalWei).toBe(42n);
  });

  it('round-trips through logActivity', () => {
    logActivity({
      ts: new Date().toISOString(),
      chain: 'base',
      chainId: 8453,
      from: '0xfrom',
      to: '0xto',
      valueWei: '12345',
      hash: '0xabc',
      policyDigest: 'digest',
    });
    const s = spendStats(24);
    expect(s.txCount).toBe(1);
    expect(s.totalWei).toBe(12345n);
  });
});
