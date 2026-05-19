/**
 * Activity log for agent-initiated transactions.
 *
 * Every time chaingpt_agent_wallet_sign_and_send broadcasts a tx (after the
 * policy check passes), we append an entry here. The dashboard reads this
 * to render the Activity tab.
 *
 * Stored as JSONL (one JSON object per line) for cheap append + tail.
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { policyPath } from './agent-policy.js';

export interface ActivityEntry {
  ts: string;           // ISO timestamp
  chain: string;        // slug
  chainId: number;
  from: string;
  to: string;
  valueWei: string;
  hash: string;
  memo?: string;
  policyDigest: string;
}

function activityPath(): string {
  return process.env.CHAINGPT_ACTIVITY_FILE?.trim()
    || policyPath().replace(/policy\.json$/, 'activity.jsonl');
}

export function logActivity(e: ActivityEntry): void {
  const path = activityPath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, JSON.stringify(e) + '\n', { mode: 0o600 });
  } catch {
    // Activity logging is best-effort — failure here must not break the tx flow
  }
}

export function readActivity(limit = 50): ActivityEntry[] {
  const path = activityPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const entries: ActivityEntry[] = [];
    for (const l of lines) {
      try {
        const parsed = JSON.parse(l) as ActivityEntry;
        if (parsed && typeof parsed.hash === 'string') entries.push(parsed);
      } catch { /* skip malformed */ }
    }
    // newest first
    entries.reverse();
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}
