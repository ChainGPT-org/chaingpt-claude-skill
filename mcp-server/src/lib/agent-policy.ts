/**
 * Policy file for the agent wallet.
 *
 * The policy lives in a JSON file on disk that the admin edits with their
 * text editor. **The agent has NO tool to modify this file.** Every tool
 * that would sign or broadcast a transaction loads this policy fresh on
 * each call and refuses if any rule is violated.
 *
 * This is the prompt-injection defense: even if an attacker convinces the
 * LLM to call sign_and_send with arbitrary inputs, the deterministic
 * policy check in code (loading a file the agent can't write) blocks the
 * action. The trust boundary is the tool code, not the LLM.
 *
 * Policy file path: $CHAINGPT_AGENT_POLICY_FILE or ~/.chaingpt-mcp/agent-wallet/policy.json
 *
 * Default policy (lazily created on first load): killSwitch=true. The admin
 * must explicitly relax it. This is fail-closed by design.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const DEFAULT_PATH = join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'policy.json');

export function policyPath(): string {
  return process.env.CHAINGPT_AGENT_POLICY_FILE?.trim() || DEFAULT_PATH;
}

export interface AgentPolicy {
  version: 1;
  /** Master kill switch. If true, every signing operation refuses. */
  killSwitch: boolean;
  /** Allowed EVM chain IDs. Empty/missing means all chains allowed (subject to other rules). */
  allowedChains?: number[];
  /** Allowed to-addresses (lowercase hex). Empty/missing means any address allowed. */
  allowedToAddresses?: string[];
  /** Explicit blocklist (lowercase hex). Wins over allowedToAddresses. */
  blockedToAddresses?: string[];
  /** Max native-coin value per tx, as a wei string. Missing means no cap. */
  maxTxValueWei?: string;
  /** Max gas units per tx. Missing means no cap. */
  maxTxGas?: string;
  /** Blocked function selectors (hex with 0x prefix, e.g. "0xa9059cbb" for transfer). */
  blockedSelectors?: string[];
  /** If true, the agent must include a memo field on every sign_and_send call. */
  requireMemo?: boolean;
  /** Informational only — not enforced. Helps the admin remember what this policy is for. */
  notes?: string;
  /** Last time the file was updated. Set by the admin; not enforced. */
  updatedAt?: string;
}

const DEFAULT_POLICY: AgentPolicy = {
  version: 1,
  killSwitch: true,
  notes:
    'Default policy: killSwitch=true. The agent will refuse every signing operation. ' +
    'Edit this file manually to relax the rules. Example: ' +
    '{"killSwitch":false,"allowedChains":[8453],"allowedToAddresses":["0x..."],"maxTxValueWei":"100000000000000000"}',
};

export function loadPolicy(): AgentPolicy {
  const path = policyPath();
  if (!existsSync(path)) {
    // Lazy-write a default file so the admin has something to edit
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify(DEFAULT_POLICY, null, 2));
    } catch { /* read-only filesystem or perms — fall through */ }
    return DEFAULT_POLICY;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as AgentPolicy;
    // Defensive: ensure version + killSwitch exist
    if (typeof parsed.killSwitch !== 'boolean') {
      return { ...DEFAULT_POLICY, notes: 'Policy file missing killSwitch — falling back to default (refuse all).' };
    }
    return parsed;
  } catch (e: any) {
    return { ...DEFAULT_POLICY, notes: `Policy file unparseable: ${e?.message ?? e}. Falling back to default (refuse all).` };
  }
}

export function policyDigest(p: AgentPolicy): string {
  // Stable hash for surfacing in status output. Sort keys for determinism.
  const ordered = JSON.stringify(p, Object.keys(p).sort());
  return createHash('sha256').update(ordered).digest('hex').slice(0, 16);
}

export interface TxIntent {
  chainId: number;
  to: string;
  value: bigint;
  data: string;
  gas?: bigint;
  memo?: string;
}

export interface PolicyCheck {
  allowed: boolean;
  reason: string;
  policyDigest: string;
}

export function checkPolicy(intent: TxIntent, policy: AgentPolicy = loadPolicy()): PolicyCheck {
  const digest = policyDigest(policy);

  if (policy.killSwitch) {
    return { allowed: false, reason: 'Policy kill switch is active. Edit policy.json (set killSwitch: false) to allow operations.', policyDigest: digest };
  }

  if (policy.allowedChains && policy.allowedChains.length > 0 && !policy.allowedChains.includes(intent.chainId)) {
    return { allowed: false, reason: `Chain ${intent.chainId} is not in allowedChains [${policy.allowedChains.join(', ')}].`, policyDigest: digest };
  }

  const toLower = intent.to.toLowerCase();

  if (policy.blockedToAddresses?.some((a) => a.toLowerCase() === toLower)) {
    return { allowed: false, reason: `To-address ${intent.to} is in blockedToAddresses.`, policyDigest: digest };
  }

  if (policy.allowedToAddresses && policy.allowedToAddresses.length > 0) {
    if (!policy.allowedToAddresses.some((a) => a.toLowerCase() === toLower)) {
      return { allowed: false, reason: `To-address ${intent.to} is not in allowedToAddresses (${policy.allowedToAddresses.length} entries).`, policyDigest: digest };
    }
  }

  if (policy.maxTxValueWei !== undefined) {
    let max: bigint;
    try { max = BigInt(policy.maxTxValueWei); }
    catch { return { allowed: false, reason: `Policy maxTxValueWei is not a valid integer string.`, policyDigest: digest }; }
    if (intent.value > max) {
      return { allowed: false, reason: `Value ${intent.value} wei exceeds maxTxValueWei ${max}.`, policyDigest: digest };
    }
  }

  if (policy.maxTxGas !== undefined && intent.gas !== undefined) {
    let max: bigint;
    try { max = BigInt(policy.maxTxGas); }
    catch { return { allowed: false, reason: `Policy maxTxGas is not a valid integer string.`, policyDigest: digest }; }
    if (intent.gas > max) {
      return { allowed: false, reason: `Gas ${intent.gas} exceeds maxTxGas ${max}.`, policyDigest: digest };
    }
  }

  if (policy.blockedSelectors && intent.data && intent.data.length >= 10) {
    const selector = intent.data.slice(0, 10).toLowerCase();
    if (policy.blockedSelectors.map((s) => s.toLowerCase()).includes(selector)) {
      return { allowed: false, reason: `Function selector ${selector} is in blockedSelectors.`, policyDigest: digest };
    }
  }

  if (policy.requireMemo && !intent.memo) {
    return { allowed: false, reason: 'Policy requires every signing operation to include a memo field (audit trail). Provide one via the `memo` arg.', policyDigest: digest };
  }

  return { allowed: true, reason: 'OK', policyDigest: digest };
}

// ── Policy editing (USED ONLY BY THE LOCALHOST ADMIN UI) ─────────────
//
// IMPORTANT: validatePolicyInput + savePolicy must NEVER be exposed via any
// MCP tool. They are called only from the localhost HTTP handler in
// tools/agent_wallet.ts, which requires admin authentication.
//
// The MCP tool surface that the LLM can see is read-only on the policy.
// This file's threat-model header is the source of truth for that rule.

const ALLOWED_POLICY_FIELDS = new Set<keyof AgentPolicy>([
  'version',
  'killSwitch',
  'allowedChains',
  'allowedToAddresses',
  'blockedToAddresses',
  'maxTxValueWei',
  'maxTxGas',
  'blockedSelectors',
  'requireMemo',
  'notes',
  'updatedAt',
]);

export interface ValidationResult {
  ok: boolean;
  /** Valid policy object (set when ok=true). */
  policy?: AgentPolicy;
  /** Human-readable error (set when ok=false). */
  error?: string;
}

const HEX_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;

export function validatePolicyInput(input: unknown): ValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Policy must be a JSON object.' };
  }
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED_POLICY_FIELDS.has(k as keyof AgentPolicy)) {
      return { ok: false, error: `Unknown policy field: ${k}` };
    }
  }
  if (o.version !== 1) return { ok: false, error: 'version must be 1' };
  if (typeof o.killSwitch !== 'boolean') return { ok: false, error: 'killSwitch must be true or false' };

  if (o.allowedChains !== undefined) {
    if (!Array.isArray(o.allowedChains)) return { ok: false, error: 'allowedChains must be an array of integers' };
    for (const c of o.allowedChains) {
      if (typeof c !== 'number' || !Number.isInteger(c) || c < 1) {
        return { ok: false, error: `allowedChains entries must be positive integers, got ${c}` };
      }
    }
  }
  for (const listField of ['allowedToAddresses', 'blockedToAddresses'] as const) {
    const v = o[listField];
    if (v !== undefined) {
      if (!Array.isArray(v)) return { ok: false, error: `${listField} must be an array of addresses` };
      for (const a of v) {
        if (typeof a !== 'string' || !HEX_ADDR_RE.test(a)) {
          return { ok: false, error: `${listField} entries must be 0x-prefixed 20-byte hex addresses, got ${a}` };
        }
      }
    }
  }
  if (o.maxTxValueWei !== undefined) {
    if (typeof o.maxTxValueWei !== 'string') return { ok: false, error: 'maxTxValueWei must be a string (to preserve precision)' };
    try { BigInt(o.maxTxValueWei); } catch { return { ok: false, error: 'maxTxValueWei must be a valid integer string' }; }
  }
  if (o.maxTxGas !== undefined) {
    if (typeof o.maxTxGas !== 'string') return { ok: false, error: 'maxTxGas must be a string' };
    try { BigInt(o.maxTxGas); } catch { return { ok: false, error: 'maxTxGas must be a valid integer string' }; }
  }
  if (o.blockedSelectors !== undefined) {
    if (!Array.isArray(o.blockedSelectors)) return { ok: false, error: 'blockedSelectors must be an array' };
    for (const s of o.blockedSelectors) {
      if (typeof s !== 'string' || !HEX_SELECTOR_RE.test(s)) {
        return { ok: false, error: `blockedSelectors entries must be 0x-prefixed 4-byte hex (e.g. "0xa9059cbb"), got ${s}` };
      }
    }
  }
  if (o.requireMemo !== undefined && typeof o.requireMemo !== 'boolean') {
    return { ok: false, error: 'requireMemo must be true or false' };
  }
  if (o.notes !== undefined && typeof o.notes !== 'string') {
    return { ok: false, error: 'notes must be a string' };
  }
  // updatedAt: we set this ourselves, so anything from input is overwritten

  const policy: AgentPolicy = {
    version: 1,
    killSwitch: o.killSwitch,
    allowedChains: o.allowedChains as number[] | undefined,
    allowedToAddresses: o.allowedToAddresses as string[] | undefined,
    blockedToAddresses: o.blockedToAddresses as string[] | undefined,
    maxTxValueWei: o.maxTxValueWei as string | undefined,
    maxTxGas: o.maxTxGas as string | undefined,
    blockedSelectors: o.blockedSelectors as string[] | undefined,
    requireMemo: o.requireMemo as boolean | undefined,
    notes: o.notes as string | undefined,
    updatedAt: new Date().toISOString(),
  };
  // Drop undefined keys for clean serialization
  for (const k of Object.keys(policy)) {
    if ((policy as any)[k] === undefined) delete (policy as any)[k];
  }
  return { ok: true, policy };
}

/**
 * Atomic write of a new policy to disk. Backs up the previous file to
 * `policy.json.bak` first. Returns the new digest.
 *
 * MUST only be called from the localhost admin UI handler, never from an
 * MCP tool. There is no MCP tool that imports or invokes this function.
 */
export function savePolicy(policy: AgentPolicy): { digest: string; path: string } {
  const path = policyPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Backup current
  if (existsSync(path)) {
    try { copyFileSync(path, path + '.bak'); } catch { /* best-effort */ }
  }
  // Write to temp then rename (atomic on POSIX)
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(policy, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  return { digest: policyDigest(policy), path };
}
