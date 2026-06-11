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
import { dirname, join } from 'node:path';
import { policyPath } from './agent-policy.js';

export interface ActivityEntry {
  ts: string;           // ISO timestamp
  chain: string;        // EVM slug (ethereum/base/…) or 'solana'
  chainId: number;
  from: string;
  to: string;
  valueWei: string;     // base units: wei (EVM) or simulated fee-payer lamport delta (Solana)
  hash: string;
  memo?: string;
  policyDigest: string;
}

export function activityPath(): string {
  // Derive from the policy DIRECTORY, not via regex replace on the filename.
  // The replace silently no-ops if the policy filename isn't policy.json,
  // which would cause the JSONL append to clobber the policy file itself.
  return process.env.CHAINGPT_ACTIVITY_FILE?.trim()
    || join(dirname(policyPath()), 'activity.jsonl');
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

/**
 * Rolling-window spend stats for the velocity caps (maxDailySpendWei /
 * maxDailyTxCount). Reads the FULL ledger (not the tail) so the window is
 * complete. `ok: false` means the ledger exists but could not be read —
 * checkPolicy treats that as fail-closed when a velocity cap is configured.
 *
 * Threat-model note: this file shares the policy file's protection level —
 * no MCP tool can write or delete it. The agent cannot reset its own window.
 */
/**
 * Chain class for ledger filtering. 'evm' sums wei across EVM chains;
 * 'solana' sums lamports. The two MUST never sum together — they are
 * different units. 'all' (default) preserves the historical unfiltered
 * behavior for display callers; the security chokepoints always pass an
 * explicit class.
 */
export type ChainClass = 'evm' | 'solana' | 'all';

function entryClass(e: ActivityEntry): Exclude<ChainClass, 'all'> {
  // 'solana', 'solana-devnet', 'solana-testnet' — all clusters share the class.
  // Devnet/testnet sends therefore CONSUME the lamport caps: conservative on
  // purpose (a cap that over-counts fails safe; one that under-counts does not).
  return e.chain.startsWith('solana') ? 'solana' : 'evm';
}

export function spendStats(windowHours = 24, chainClass: ChainClass = 'all'): { totalWei: bigint; txCount: number; ok: boolean } {
  const path = activityPath();
  if (!existsSync(path)) return { totalWei: 0n, txCount: 0, ok: true };
  try {
    const cutoff = Date.now() - windowHours * 3_600_000;
    let totalWei = 0n;
    let txCount = 0;
    for (const l of readFileSync(path, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      let e: ActivityEntry;
      try { e = JSON.parse(l) as ActivityEntry; } catch { continue; }
      const t = Date.parse(e?.ts ?? '');
      if (!isFinite(t) || t < cutoff) continue;
      if (chainClass !== 'all' && entryClass(e) !== chainClass) continue;
      txCount++;
      try { totalWei += BigInt(e?.valueWei ?? '0'); } catch { /* malformed value — count the tx, skip the value */ }
    }
    return { totalWei, txCount, ok: true };
  } catch {
    return { totalWei: 0n, txCount: 0, ok: false };
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
