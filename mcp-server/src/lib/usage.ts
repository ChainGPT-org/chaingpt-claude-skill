/**
 * Local-only tool-usage counters.
 *
 * Answers "what has my agent actually been doing?" — per-tool call counts
 * surfaced in the dashboard and nowhere else.
 *
 * PRIVACY MODEL (deliberate):
 *   - Counts live in ONE local file: ~/.chaingpt-mcp/usage.json.
 *   - Nothing is ever transmitted anywhere. There is no remote endpoint,
 *     no analytics SDK, no phone-home. Grep this file to verify.
 *   - Only tool NAMES, counts and last-called timestamps are stored —
 *     never arguments, addresses, amounts, or results.
 *   - Disable entirely with CHAINGPT_USAGE=off.
 *
 * Write strategy: in-memory increment + debounced flush (500ms, unref'd so
 * it never keeps the process alive). Counting is best-effort by design — a
 * lost increment on crash is fine; blocking a tool call on disk I/O is not.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

interface UsageFile {
  since: string;
  counts: Record<string, number>;
  lastUsed: Record<string, string>;
}

function usagePath(): string {
  return process.env.CHAINGPT_USAGE_FILE?.trim() || join(homedir(), '.chaingpt-mcp', 'usage.json');
}

function enabled(): boolean {
  return (process.env.CHAINGPT_USAGE ?? 'on').toLowerCase() !== 'off';
}

let cache: UsageFile | null = null;
let flushTimer: NodeJS.Timeout | null = null;

// Single-process assumption: the cache is read once and flushes overwrite the
// file. Two server processes sharing one file = last-writer-wins (acceptable
// for best-effort stats; do not build billing on this).
function load(): UsageFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(usagePath(), 'utf8')) as UsageFile;
    if (!cache.counts) cache.counts = {};
    if (!cache.lastUsed) cache.lastUsed = {};
  } catch {
    cache = { since: new Date().toISOString(), counts: {}, lastUsed: {} };
  }
  return cache;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      const path = usagePath();
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify(cache, null, 2), { mode: 0o600 });
    } catch { /* best-effort — never break a tool call over usage stats */ }
  }, 500);
  flushTimer.unref?.();
}

/** Record one tool invocation. Synchronous, allocation-light, never throws. */
export function recordToolUse(tool: string): void {
  if (!enabled()) return;
  // A non-compliant client can send arbitrary tool names; don't let garbage
  // grow the file or pollute the dashboard table.
  if (!tool || tool.length > 128 || !tool.startsWith('chaingpt_')) return;
  try {
    const u = load();
    u.counts[tool] = (u.counts[tool] ?? 0) + 1;
    u.lastUsed[tool] = new Date().toISOString();
    scheduleFlush();
  } catch { /* never break the tool call */ }
}

/** Read usage for display. Returns null when disabled or empty. */
export function readUsage(): { since: string; total: number; top: Array<{ tool: string; count: number; lastUsed: string }> } | null {
  if (!enabled()) return null;
  const u = load();
  const entries = Object.entries(u.counts);
  if (entries.length === 0) return null;
  const top = entries
    .map(([tool, count]) => ({ tool, count, lastUsed: u.lastUsed[tool] ?? '' }))
    .sort((a, b) => b.count - a.count);
  return { since: u.since, total: top.reduce((a, t) => a + t.count, 0), top };
}

/** Test hook: drop the in-memory cache so a fresh file is read. */
export function _resetUsageCacheForTests(): void {
  cache = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
