import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordToolUse, readUsage, _resetUsageCacheForTests } from '../lib/usage.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cgpt-usage-'));
  process.env.CHAINGPT_USAGE_FILE = join(dir, 'usage.json');
  delete process.env.CHAINGPT_USAGE;
  _resetUsageCacheForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CHAINGPT_USAGE_FILE;
  delete process.env.CHAINGPT_USAGE;
  _resetUsageCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('local usage counters', () => {
  it('counts calls and sorts top tools', () => {
    recordToolUse('chaingpt_research_token');
    recordToolUse('chaingpt_research_token');
    recordToolUse('chaingpt_onchain_gas');
    const u = readUsage();
    expect(u).not.toBeNull();
    expect(u!.total).toBe(3);
    expect(u!.top[0]).toMatchObject({ tool: 'chaingpt_research_token', count: 2 });
    expect(u!.top[1]).toMatchObject({ tool: 'chaingpt_onchain_gas', count: 1 });
  });

  it('flushes to disk (debounced) and stores ONLY names + counts + timestamps', () => {
    recordToolUse('chaingpt_dex_quote');
    vi.advanceTimersByTime(600);
    const raw = readFileSync(process.env.CHAINGPT_USAGE_FILE!, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.counts.chaingpt_dex_quote).toBe(1);
    // Privacy: nothing beyond since/counts/lastUsed may ever land in this file.
    expect(Object.keys(parsed).sort()).toEqual(['counts', 'lastUsed', 'since']);
  });

  it('CHAINGPT_USAGE=off disables recording and reading entirely', () => {
    process.env.CHAINGPT_USAGE = 'off';
    recordToolUse('chaingpt_dex_quote');
    vi.advanceTimersByTime(600);
    expect(existsSync(process.env.CHAINGPT_USAGE_FILE!)).toBe(false);
    expect(readUsage()).toBeNull();
  });

  it('returns null when nothing recorded yet', () => {
    expect(readUsage()).toBeNull();
  });
});
