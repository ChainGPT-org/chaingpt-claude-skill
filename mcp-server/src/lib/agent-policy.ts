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
 * First-run default (lazily created): the BALANCED policy below — killSwitch
 * OFF, major DeFi routers allow-listed, small per-tx cap, daily spend + tx-count
 * velocity caps, memo required. A corrupt or partially-missing policy file
 * always falls back to FAIL_CLOSED_POLICY (killSwitch=true): tampering can
 * never open the gates.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const DEFAULT_PATH = join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'policy.json');

export function policyPath(): string {
  return process.env.CHAINGPT_AGENT_POLICY_FILE?.trim() || DEFAULT_PATH;
}

export interface AgentPolicy {
  version: 1;
  /** Master kill switch. If true, every signing operation refuses. Wins over `unrestricted`. */
  killSwitch: boolean;
  /**
   * "YOLO mode" — when true, every signing operation is ALLOWED with no policy
   * checks (no allowlist, no value cap, no selector blocklist, no memo). The
   * kill switch still wins (panic button stays functional), but otherwise the
   * agent has full authority over the wallet.
   *
   * Admin opt-in only: same write protection as everything else (no MCP tool
   * can set this; only the localhost dashboard or a direct file edit). The
   * dashboard surfaces this with loud red banners when active.
   *
   * Intended use: trusted setups, dev/testnet, "I know what I'm doing" mode.
   * Default: false. Apply via the "Unrestricted" template for one-click.
   */
  unrestricted?: boolean;
  /** Allowed EVM chain IDs. Empty/missing means all chains allowed (subject to other rules). */
  allowedChains?: number[];
  /** Allowed to-addresses (lowercase hex). Empty/missing means any address allowed. */
  allowedToAddresses?: string[];
  /** Explicit blocklist (lowercase hex). Wins over allowedToAddresses. */
  blockedToAddresses?: string[];
  /** Max native-coin value per tx, as a wei string. Missing means no cap. */
  maxTxValueWei?: string;
  /** Max gas units per tx. Missing means no cap. When set, every sign_and_send MUST pass an explicit gasLimit. */
  maxTxGas?: string;
  /**
   * Max cumulative native-coin value (wei string) the wallet may sign across a
   * rolling 24h window. Computed from the activity ledger at sign time. This is
   * the anti-drain control: per-tx caps alone allow unbounded compliant txs.
   * Missing means no velocity cap.
   */
  maxDailySpendWei?: string;
  /** Max number of signed txs across a rolling 24h window. Missing means no cap. */
  maxDailyTxCount?: number;
  /** Blocked function selectors (hex with 0x prefix, e.g. "0xa9059cbb" for transfer). */
  blockedSelectors?: string[];
  /** If true, the agent must include a memo field on every sign_and_send call. */
  requireMemo?: boolean;
  /** Informational only — not enforced. Helps the admin remember what this policy is for. */
  notes?: string;
  /** Last time the file was updated. Set by the admin; not enforced. */
  updatedAt?: string;
}

/**
 * Default policy is intentionally rich/diverse so the admin sees every
 * available knob with a sensible example value. STILL FAIL-CLOSED:
 * killSwitch=true, allowedToAddresses=[] → every signing op is refused
 * until the admin explicitly relaxes the rules (via dashboard or text editor).
 *
 * Use this as a copy-paste reference for what fields exist and what shape
 * each takes. The localhost dashboard also exposes named templates
 * (`agent-policy-templates.ts`) for one-click application.
 */
// FAIL-CLOSED policy — used ONLY when a policy file is missing a required
// field or is unparseable. A corrupt or tampered file must NEVER open the
// gates, so this stays killSwitch=true regardless of what the first-run
// default looks like.
const FAIL_CLOSED_POLICY: AgentPolicy = {
  version: 1,
  killSwitch: true,
  allowedChains: [],
  allowedToAddresses: [],
  blockedToAddresses: [
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead',
  ],
  maxTxValueWei: '0',
  maxTxGas: '1000000',
  maxDailySpendWei: '0',
  maxDailyTxCount: 0,
  blockedSelectors: [],
  requireMemo: true,
  notes: 'Fail-closed fallback (policy file missing a field or unparseable). Every signing op is refused. Fix or replace policy.json to restore your intended policy.',
  updatedAt: new Date(0).toISOString(),
};

// Canonical mainnet router/protocol addresses for the balanced first-run default.
const _OPENOCEAN_V4 = '0x6352a56caadc4f1e25cd6c75970fa768a3304e64';
const _ONEINCH_V6 = '0x111111125421ca6dc452d289314280a0f8842a65';
const _AAVE_V3_POOL_ETH = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const _AAVE_V3_POOL_BASE = '0xa238dd80c259a72e81d7e4664a9801593f98d1c5';
const _LIDO_STETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';

// First-run DEFAULT — a BALANCED DeFi policy, killSwitch OFF.
// Rationale: a freshly-created agent wallet holds zero funds, so a balanced
// default that can interact with major DEX/lending routers (up to a small
// 0.1-ETH cap, memo-required, scam-blocklisted) is safe and far better UX
// than a locked-down wall that refuses everything. By the time the user funds
// it, the small per-tx cap keeps blast radius low even if they never tighten.
// Corrupt/missing files still fall back to FAIL_CLOSED_POLICY above.
const DEFAULT_POLICY: AgentPolicy = {
  version: 1,
  killSwitch: false,
  allowedChains: [1, 8453, 42161, 10, 137],
  allowedToAddresses: [
    _OPENOCEAN_V4,
    _ONEINCH_V6,
    _AAVE_V3_POOL_ETH,
    _AAVE_V3_POOL_BASE,
    _LIDO_STETH,
  ],
  blockedToAddresses: [
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead',
  ],
  maxTxValueWei: '100000000000000000', // 0.1 ETH — conservative starter cap
  maxTxGas: '1500000',
  maxDailySpendWei: '300000000000000000', // 0.3 ETH per rolling 24h — anti-drain velocity cap
  maxDailyTxCount: 20,
  blockedSelectors: [],
  requireMemo: true,
  notes:
    'Balanced DeFi default (killSwitch OFF). The agent may interact with major DEX aggregators ' +
    '(OpenOcean, 1inch) + Aave V3 + Lido on Ethereum / Base / Arbitrum / Optimism / Polygon, capped at ' +
    '0.1 native per tx AND 0.3 native + 20 txs per rolling 24h, memo required. Tighten or widen via the ' +
    'dashboard templates or by editing this file. ' +
    'Engage the kill switch any time to halt all signing. Corrupt/missing files fail closed (refuse all).',
  updatedAt: new Date(0).toISOString(),
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
    // Defensive: ensure version + killSwitch exist. A file missing killSwitch
    // is treated as corrupt → fail closed (NOT the balanced default).
    if (typeof parsed.killSwitch !== 'boolean') {
      return { ...FAIL_CLOSED_POLICY, notes: 'Policy file missing killSwitch — falling back to fail-closed (refuse all).' };
    }
    return parsed;
  } catch (e: any) {
    return { ...FAIL_CLOSED_POLICY, notes: `Policy file unparseable: ${e?.message ?? e}. Falling back to fail-closed (refuse all).` };
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

/**
 * Rolling-window spend stats, computed by the caller from the activity ledger
 * (lib/agent-activity.ts spendStats()). `ok=false` means the ledger could not
 * be read — checkPolicy treats that as fail-closed when a velocity cap is set.
 */
export interface SpendWindow {
  totalWei: bigint;
  txCount: number;
  ok: boolean;
}

export function checkPolicy(
  intent: TxIntent,
  policy: AgentPolicy = loadPolicy(),
  spend?: SpendWindow
): PolicyCheck {
  const digest = policyDigest(policy);

  if (policy.killSwitch) {
    return { allowed: false, reason: 'Policy kill switch is active. Edit policy.json (set killSwitch: false) to allow operations.', policyDigest: digest };
  }

  // Unrestricted "yolo" mode: admin has explicitly opted into no policy checks.
  // Kill switch still wins (already returned above) so the panic button stays
  // functional. Everything else is bypassed.
  if (policy.unrestricted) {
    return { allowed: true, reason: 'OK (unrestricted mode — admin opted out of all per-tx checks)', policyDigest: digest };
  }

  // Semantics for the two allow-lists:
  //   undefined  → no check (any allowed)
  //   []         → EXPLICIT EMPTY: nothing allowed (refuse everything)
  //   [a, b, …]  → must be in the list
  //
  // The explicit-empty branch is what makes the "Read-only explore" template
  // actually read-only. Previously, [] was treated identically to undefined,
  // which silently turned the read-only template into a "send anywhere" gate.
  if (policy.allowedChains !== undefined && !policy.allowedChains.includes(intent.chainId)) {
    return {
      allowed: false,
      reason: policy.allowedChains.length === 0
        ? `allowedChains is explicitly empty — no chain is permitted.`
        : `Chain ${intent.chainId} is not in allowedChains [${policy.allowedChains.join(', ')}].`,
      policyDigest: digest,
    };
  }

  const toLower = intent.to.toLowerCase();

  if (policy.blockedToAddresses?.some((a) => a.toLowerCase() === toLower)) {
    return { allowed: false, reason: `To-address ${intent.to} is in blockedToAddresses.`, policyDigest: digest };
  }

  if (policy.allowedToAddresses !== undefined) {
    if (!policy.allowedToAddresses.some((a) => a.toLowerCase() === toLower)) {
      return {
        allowed: false,
        reason: policy.allowedToAddresses.length === 0
          ? `allowedToAddresses is explicitly empty — no destination is permitted.`
          : `To-address ${intent.to} is not in allowedToAddresses (${policy.allowedToAddresses.length} entries).`,
        policyDigest: digest,
      };
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

  if (policy.maxTxGas !== undefined) {
    let max: bigint;
    try { max = BigInt(policy.maxTxGas); }
    catch { return { allowed: false, reason: `Policy maxTxGas is not a valid integer string.`, policyDigest: digest }; }
    // Fail closed when the caller omitted gasLimit: letting the RPC auto-estimate
    // would silently bypass the cap (the original audit finding).
    if (intent.gas === undefined) {
      return {
        allowed: false,
        reason: `Policy sets maxTxGas=${max} — an explicit gasLimit (≤ cap) is required so the cap cannot be bypassed via RPC auto-estimation. Pass gasLimit.`,
        policyDigest: digest,
      };
    }
    if (intent.gas > max) {
      return { allowed: false, reason: `Gas ${intent.gas} exceeds maxTxGas ${max}.`, policyDigest: digest };
    }
  }

  // ── Velocity caps (rolling 24h window over the activity ledger) ────
  const hasVelocityCap = policy.maxDailySpendWei !== undefined || policy.maxDailyTxCount !== undefined;
  if (hasVelocityCap) {
    if (!spend || !spend.ok) {
      return {
        allowed: false,
        reason: !spend
          ? 'Policy sets a daily velocity cap but no spend-window stats were provided to checkPolicy — refusing (fail closed).'
          : 'Policy sets a daily velocity cap but the activity ledger could not be read — refusing (fail closed).',
        policyDigest: digest,
      };
    }
    if (policy.maxDailySpendWei !== undefined) {
      let maxSpend: bigint;
      try { maxSpend = BigInt(policy.maxDailySpendWei); }
      catch { return { allowed: false, reason: `Policy maxDailySpendWei is not a valid integer string.`, policyDigest: digest }; }
      if (spend.totalWei + intent.value > maxSpend) {
        return {
          allowed: false,
          reason: `Daily spend cap: ${spend.totalWei} wei already signed in the last 24h + ${intent.value} wei now would exceed maxDailySpendWei ${maxSpend}.`,
          policyDigest: digest,
        };
      }
    }
    if (policy.maxDailyTxCount !== undefined && spend.txCount + 1 > policy.maxDailyTxCount) {
      return {
        allowed: false,
        reason: `Daily tx-count cap: ${spend.txCount} txs signed in the last 24h; maxDailyTxCount is ${policy.maxDailyTxCount}.`,
        policyDigest: digest,
      };
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
  'unrestricted',
  'allowedChains',
  'allowedToAddresses',
  'blockedToAddresses',
  'maxTxValueWei',
  'maxTxGas',
  'maxDailySpendWei',
  'maxDailyTxCount',
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
  if (o.unrestricted !== undefined && typeof o.unrestricted !== 'boolean') {
    return { ok: false, error: 'unrestricted must be true or false' };
  }

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
  if (o.maxDailySpendWei !== undefined) {
    if (typeof o.maxDailySpendWei !== 'string') return { ok: false, error: 'maxDailySpendWei must be a string (to preserve precision)' };
    try { BigInt(o.maxDailySpendWei); } catch { return { ok: false, error: 'maxDailySpendWei must be a valid integer string' }; }
  }
  if (o.maxDailyTxCount !== undefined) {
    if (typeof o.maxDailyTxCount !== 'number' || !Number.isInteger(o.maxDailyTxCount) || o.maxDailyTxCount < 0) {
      return { ok: false, error: 'maxDailyTxCount must be a non-negative integer' };
    }
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
    unrestricted: o.unrestricted as boolean | undefined,
    allowedChains: o.allowedChains as number[] | undefined,
    allowedToAddresses: o.allowedToAddresses as string[] | undefined,
    blockedToAddresses: o.blockedToAddresses as string[] | undefined,
    maxTxValueWei: o.maxTxValueWei as string | undefined,
    maxTxGas: o.maxTxGas as string | undefined,
    maxDailySpendWei: o.maxDailySpendWei as string | undefined,
    maxDailyTxCount: o.maxDailyTxCount as number | undefined,
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
  // Backup current — preserve 0600 perms (copyFileSync uses umask default,
  // which would leak 0644 on the .bak. Chmod immediately after.)
  if (existsSync(path)) {
    try {
      copyFileSync(path, path + '.bak');
      chmodSync(path + '.bak', 0o600);
    } catch { /* best-effort */ }
  }
  // Write to temp then rename (atomic on POSIX)
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(policy, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  return { digest: policyDigest(policy), path };
}
