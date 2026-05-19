/**
 * Tracked ERC-20 tokens for the agent wallet dashboard.
 *
 * Stored in a flat JSON file ~/.chaingpt-mcp/agent-wallet/tracked-tokens.json
 * (overridable via CHAINGPT_TRACKED_TOKENS_FILE). Admin-managed via the
 * localhost dashboard — NOT exposed via any MCP tool the agent can call.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { policyPath } from './agent-policy.js';

export interface TrackedToken {
  /** Lowercase chain slug (must match chains.ts). */
  chain: string;
  /** ERC-20 contract address, lowercase hex. */
  address: string;
  /** ERC-20 symbol (fetched once via eth_call). */
  symbol: string;
  /** Decimals (fetched once via eth_call). */
  decimals: number;
  /** Optional admin-set label, e.g. "USDC on Base". */
  label?: string;
  /** ISO timestamp added. */
  addedAt: string;
}

export function tokensPath(): string {
  // Co-locate with the policy file but derive from its DIRECTORY — not via
  // filename regex replacement, which silently no-ops (and would clobber the
  // policy file) when CHAINGPT_AGENT_POLICY_FILE has a non-policy.json suffix.
  return process.env.CHAINGPT_TRACKED_TOKENS_FILE?.trim()
    || join(dirname(policyPath()), 'tracked-tokens.json');
}

export function loadTrackedTokens(): TrackedToken[] {
  const path = tokensPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is TrackedToken =>
      typeof t === 'object' && t !== null &&
      typeof t.chain === 'string' && typeof t.address === 'string' &&
      typeof t.symbol === 'string' && typeof t.decimals === 'number'
    );
  } catch {
    return [];
  }
}

export function saveTrackedTokens(tokens: TrackedToken[]): void {
  const path = tokensPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    try {
      copyFileSync(path, path + '.bak');
      chmodSync(path + '.bak', 0o600);
    } catch { /* best-effort */ }
  }
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

const HEX_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function addTrackedToken(t: Omit<TrackedToken, 'addedAt'> & { addedAt?: string }): TrackedToken[] {
  if (!HEX_ADDR_RE.test(t.address)) throw new Error(`Invalid token address: ${t.address}`);
  if (!t.symbol) throw new Error(`Missing symbol`);
  if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) {
    throw new Error(`Invalid decimals: ${t.decimals}`);
  }
  const tokens = loadTrackedTokens();
  const chainLower = t.chain.toLowerCase();
  const addrLower = t.address.toLowerCase();
  const key = `${chainLower}:${addrLower}`;
  if (tokens.some((x) => `${x.chain.toLowerCase()}:${x.address.toLowerCase()}` === key)) {
    throw new Error(`Already tracked: ${t.symbol} on ${chainLower} (${addrLower})`);
  }
  tokens.push({
    chain: chainLower,
    address: addrLower,
    symbol: t.symbol,
    decimals: t.decimals,
    label: t.label,
    addedAt: t.addedAt ?? new Date().toISOString(),
  });
  saveTrackedTokens(tokens);
  return tokens;
}

export function removeTrackedToken(chain: string, address: string): TrackedToken[] {
  const tokens = loadTrackedTokens();
  const key = `${chain.toLowerCase()}:${address.toLowerCase()}`;
  const filtered = tokens.filter((x) => `${x.chain.toLowerCase()}:${x.address.toLowerCase()}` !== key);
  saveTrackedTokens(filtered);
  return filtered;
}
