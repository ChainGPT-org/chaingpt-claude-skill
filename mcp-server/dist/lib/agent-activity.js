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
export function activityPath() {
    // Derive from the policy DIRECTORY, not via regex replace on the filename.
    // The replace silently no-ops if the policy filename isn't policy.json,
    // which would cause the JSONL append to clobber the policy file itself.
    return process.env.CHAINGPT_ACTIVITY_FILE?.trim()
        || join(dirname(policyPath()), 'activity.jsonl');
}
export function logActivity(e) {
    const path = activityPath();
    try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        appendFileSync(path, JSON.stringify(e) + '\n', { mode: 0o600 });
    }
    catch {
        // Activity logging is best-effort — failure here must not break the tx flow
    }
}
function entryClass(e) {
    // Cluster suffixes ('solana-devnet', 'tron-nile', …) all share their base
    // class. Testnet sends therefore CONSUME the same caps: conservative on
    // purpose (a cap that over-counts fails safe; one that under-counts does not).
    if (e.chain.startsWith('solana'))
        return 'solana';
    if (e.chain === 'tron' || e.chain.startsWith('tron'))
        return 'tron';
    return 'evm';
}
export function spendStats(windowHours = 24, chainClass = 'all') {
    const path = activityPath();
    if (!existsSync(path))
        return { totalWei: 0n, txCount: 0, ok: true };
    try {
        const cutoff = Date.now() - windowHours * 3_600_000;
        let totalWei = 0n;
        let txCount = 0;
        for (const l of readFileSync(path, 'utf8').split('\n')) {
            if (!l.trim())
                continue;
            let e;
            try {
                e = JSON.parse(l);
            }
            catch {
                continue;
            }
            const t = Date.parse(e?.ts ?? '');
            if (!isFinite(t) || t < cutoff)
                continue;
            if (chainClass !== 'all' && entryClass(e) !== chainClass)
                continue;
            txCount++;
            try {
                totalWei += BigInt(e?.valueWei ?? '0');
            }
            catch { /* malformed value — count the tx, skip the value */ }
        }
        return { totalWei, txCount, ok: true };
    }
    catch {
        return { totalWei: 0n, txCount: 0, ok: false };
    }
}
export function readActivity(limit = 50) {
    const path = activityPath();
    if (!existsSync(path))
        return [];
    try {
        const raw = readFileSync(path, 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim());
        const entries = [];
        for (const l of lines) {
            try {
                const parsed = JSON.parse(l);
                if (parsed && typeof parsed.hash === 'string')
                    entries.push(parsed);
            }
            catch { /* skip malformed */ }
        }
        // newest first
        entries.reverse();
        return entries.slice(0, limit);
    }
    catch {
        return [];
    }
}
