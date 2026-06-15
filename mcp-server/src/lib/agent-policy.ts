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



export interface Erc4337Policy {
  /** Master opt-in. Missing/false ⇒ refuse (fail closed, type-strict). */
  enabled: boolean;
  /** Smart-account (userOp sender) allowlist. undefined ⇒ any; [] ⇒ none. */
  allowedAccounts?: string[];
  /** Bundler hostname allowlist (https enforced regardless). undefined ⇒ any. */
  allowedBundlerHosts?: string[];
}

export interface SolanaPolicy {
  /** Master opt-in. Missing/false ⇒ every Solana signing op refused (fail closed). */
  enabled: boolean;
  /**
   * Program-id allowlist (base58) over ALL top-level instruction programs.
   * undefined ⇒ any program; [] ⇒ EXPLICIT EMPTY: none allowed (same
   * semantics as allowedToAddresses). NOTE: fences top-level instructions
   * only — inner CPIs are invisible; the lamport caps are the spend fence.
   */
  allowedPrograms?: string[];
  /** Blocklist — wins over allowedPrograms. */
  blockedPrograms?: string[];
  /** Max simulated fee-payer lamport delta per tx. Sim failure ⇒ refuse (fail closed). */
  maxTxLamports?: string;
  /** Rolling-24h lamport spend cap (solana-class ledger entries only). */
  maxDailySpendLamports?: string;
  /** Rolling-24h signed-tx count cap (solana-class only). */
  maxDailyTxCount?: number;
  requireMemo?: boolean;
}

export interface TronPolicy {
  /** Master opt-in. Missing/false ⇒ every Tron signing op refused (fail closed). */
  enabled: boolean;
  /**
   * Destination allowlist (base58 "T…"): the to-address for a native TRX send,
   * or the contract address for a TRC-20 / DeFi call. undefined ⇒ any; [] ⇒
   * EXPLICIT EMPTY: none allowed. Like the EVM allowedToAddresses, this gates
   * the contract, not the inner TRC-20 recipient.
   */
  allowedContracts?: string[];
  /** Blocklist (base58) — wins over allowedContracts. */
  blockedContracts?: string[];
  /** Max TRX value per tx, as a SUN string (native amount or contract call_value). Parse failure ⇒ refuse. */
  maxTxSun?: string;
  /** Rolling-24h SUN spend cap (tron-class ledger entries only). */
  maxDailySpendSun?: string;
  /** Rolling-24h signed-tx count cap (tron-class only). */
  maxDailyTxCount?: number;
  /** Max fee_limit (energy cap) per contract call, as a SUN string. Anti energy-drain. */
  maxFeeLimitSun?: string;
  requireMemo?: boolean;
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
  /**
   * Solana sub-policy. ABSENT or enabled:false ⇒ every Solana signing op is
   * refused (fail closed) — existing policy files never silently gain a
   * second chain. Enforced by checkSolanaPolicy at the solana sign chokepoint.
   */
  solana?: SolanaPolicy;
  /**
   * Tron sub-policy. ABSENT or enabled:false ⇒ every Tron signing op is
   * refused (fail closed) — existing policy files never silently gain a third
   * chain. Enforced by checkTronPolicy at the Tron sign chokepoint.
   */
  tron?: TronPolicy;
  /**
   * ERC-4337 session-key sub-policy. ABSENT or enabled:false ⇒ every 4337
   * signing op refused (fail closed). OFF even in the balanced default —
   * this surface acts on a THIRD-PARTY smart account, so opt-in is the only
   * correct posture. The on-chain session caps are the primary fence; this
   * gate controls whether the agent participates at all + which accounts
   * and bundlers it may touch.
   */
  erc4337?: Erc4337Policy;
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
  solana: { enabled: false },
  tron: { enabled: false },
  erc4337: { enabled: false },
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
  solana: {
    enabled: true,
    allowedPrograms: [
      '11111111111111111111111111111111',              // System
      'ComputeBudget111111111111111111111111111111',   // ComputeBudget
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',   // Token-2022
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',  // Associated Token
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',   // Jupiter v6
      'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',   // Marginfi v2
      'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',   // Kamino kLend
    ],
    maxTxLamports: '100000000',          // 0.1 SOL — mirrors the 0.1-native EVM cap
    maxDailySpendLamports: '300000000',  // 0.3 SOL per rolling 24h
    maxDailyTxCount: 20,
    requireMemo: true,
  },
  tron: {
    enabled: true,
    allowedContracts: [
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT
      'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', // WTRX
      'TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj', // SunSwap Smart Exchange Router
      'TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7', // JustLend Unitroller
      'TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd', // jUSDT
      'TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP', // jTRX
    ],
    maxTxSun: '100000000',          // 100 TRX per tx (call_value / native amount)
    maxDailySpendSun: '300000000',  // 300 TRX per rolling 24h
    maxDailyTxCount: 20,
    maxFeeLimitSun: '150000000',    // 150 TRX energy cap per contract call (anti energy-drain)
    requireMemo: true,
  },
  erc4337: { enabled: false }, // third-party-account surface: opt-in only, even in the balanced default
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
  // Stable hash for surfacing in status output. Recursively sort keys for
  // determinism. (A replacer ARRAY would filter NESTED keys too — the old
  // implementation serialized the `solana` sub-object as {} and gave
  // different Solana policies identical digests.)
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canonical(p))).digest('hex').slice(0, 16);
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

// ── Solana policy chokepoint ─────────────────────────────────────────

export interface SolanaTxIntent {
  /** Base58 program ids of ALL top-level instructions in the message. */
  programIds: string[];
  /** Base58 fee payer (must equal the agent's Solana address — checked by the handler). */
  feePayer: string;
  memo?: string;
  /**
   * Simulation outcome from the handler. ok=false ⇒ RPC/sim unavailable —
   * fail closed whenever any lamport cap is configured. lamportDelta is the
   * simulated fee-payer balance decrease (spend incl. fees), clamped ≥ 0.
   */
  sim: { ok: boolean; lamportDelta?: bigint; err?: string | null };
}

/**
 * The single deterministic decision point for Solana signing — the exact
 * counterpart of checkPolicy for EVM. Pure: reads nothing but its inputs.
 * Callers pass spendStats(24, 'solana') so lamports never mix with wei.
 */
export function checkSolanaPolicy(
  intent: SolanaTxIntent,
  policy: AgentPolicy = loadPolicy(),
  spend?: SpendWindow
): PolicyCheck {
  const digest = policyDigest(policy);

  if (policy.killSwitch) {
    return { allowed: false, reason: 'Policy kill switch is active. Edit policy.json (set killSwitch: false) to allow operations.', policyDigest: digest };
  }

  const sol = policy.solana;
  // Fail closed for every policy file that predates Solana support: the
  // admin must explicitly opt in. unrestricted does NOT bypass this —
  // YOLO mode was granted for the EVM surface; silently arming a second
  // chain the admin never enabled violates least surprise.
  if (sol?.enabled !== true) { // type-strict: a hand-edited "true"/1 must not arm a chain
    return {
      allowed: false,
      reason: 'Solana signing is not enabled in the policy. An admin must add `"solana": { "enabled": true, ... }` via the dashboard or a text editor.',
      policyDigest: digest,
    };
  }

  if (policy.unrestricted) {
    return { allowed: true, reason: 'OK (unrestricted mode — admin opted out of all per-tx checks; solana.enabled was still required)', policyDigest: digest };
  }

  if (sol.blockedPrograms?.length) {
    const blocked = new Set(sol.blockedPrograms);
    const hit = intent.programIds.find((p) => blocked.has(p));
    if (hit) {
      return { allowed: false, reason: `Program ${hit} is in solana.blockedPrograms.`, policyDigest: digest };
    }
  }

  if (sol.allowedPrograms !== undefined) {
    if (sol.allowedPrograms.length === 0) {
      return { allowed: false, reason: 'solana.allowedPrograms is explicitly empty — no program is permitted.', policyDigest: digest };
    }
    const allowed = new Set(sol.allowedPrograms);
    const off = intent.programIds.find((p) => !allowed.has(p));
    if (off) {
      return { allowed: false, reason: `Program ${off} is not in solana.allowedPrograms (${sol.allowedPrograms.length} entries).`, policyDigest: digest };
    }
  }

  if (sol.maxTxLamports !== undefined) {
    let max: bigint;
    try { max = BigInt(sol.maxTxLamports); }
    catch { return { allowed: false, reason: 'Policy solana.maxTxLamports is not a valid integer string.', policyDigest: digest }; }
    if (!intent.sim.ok || intent.sim.lamportDelta === undefined) {
      return {
        allowed: false,
        reason: 'solana.maxTxLamports is set but the transaction could not be simulated — refusing (fail closed). Check SOLANA_RPC_URL.',
        policyDigest: digest,
      };
    }
    if (intent.sim.lamportDelta > max) {
      return { allowed: false, reason: `Simulated spend ${intent.sim.lamportDelta} lamports exceeds solana.maxTxLamports ${max}.`, policyDigest: digest };
    }
  }

  const hasVelocityCap = sol.maxDailySpendLamports !== undefined || sol.maxDailyTxCount !== undefined;
  if (hasVelocityCap) {
    if (!spend || !spend.ok) {
      return {
        allowed: false,
        reason: !spend
          ? 'Policy sets a Solana daily velocity cap but no spend-window stats were provided — refusing (fail closed).'
          : 'Policy sets a Solana daily velocity cap but the activity ledger could not be read — refusing (fail closed).',
        policyDigest: digest,
      };
    }
    if (sol.maxDailySpendLamports !== undefined) {
      let maxSpend: bigint;
      try { maxSpend = BigInt(sol.maxDailySpendLamports); }
      catch { return { allowed: false, reason: 'Policy solana.maxDailySpendLamports is not a valid integer string.', policyDigest: digest }; }
      if (!intent.sim.ok || intent.sim.lamportDelta === undefined) {
        return {
          allowed: false,
          reason: 'solana.maxDailySpendLamports is set but the transaction could not be simulated — refusing (fail closed).',
          policyDigest: digest,
        };
      }
      if (spend.totalWei + intent.sim.lamportDelta > maxSpend) {
        return {
          allowed: false,
          reason: `Daily Solana spend cap: ${spend.totalWei} lamports already signed in the last 24h + ${intent.sim.lamportDelta} now would exceed maxDailySpendLamports ${maxSpend}.`,
          policyDigest: digest,
        };
      }
    }
    if (sol.maxDailyTxCount !== undefined && spend.txCount + 1 > sol.maxDailyTxCount) {
      return {
        allowed: false,
        reason: `Daily Solana tx-count cap: ${spend.txCount} txs signed in the last 24h; maxDailyTxCount is ${sol.maxDailyTxCount}.`,
        policyDigest: digest,
      };
    }
  }

  if (sol.requireMemo && !intent.memo) {
    return { allowed: false, reason: 'Solana policy requires every signing operation to include a memo (audit trail). Provide one via the `memo` arg.', policyDigest: digest };
  }

  return { allowed: true, reason: 'OK', policyDigest: digest };
}

// ── Tron policy chokepoint ───────────────────────────────────────────

export interface TronTxIntent {
  /** base58 owner — must equal the agent's Tron address (checked by the handler). */
  owner: string;
  /** base58 destination: the to-address (native TRX) or contract address (TRC-20 / DeFi). */
  to: string;
  /** TRX value moved by this tx, in SUN: `amount` for a transfer, `call_value` for a contract call. */
  valueSun: bigint;
  /** fee_limit (energy cap) in SUN for contract calls; 0n for a plain TRX transfer. */
  feeLimitSun: bigint;
  memo?: string;
}

/**
 * The single deterministic decision point for Tron signing — the exact
 * counterpart of checkPolicy / checkSolanaPolicy. Pure: reads nothing but its
 * inputs. Callers pass spendStats(24, 'tron') so SUN never mixes with wei/lamports.
 */
export function checkTronPolicy(
  intent: TronTxIntent,
  policy: AgentPolicy = loadPolicy(),
  spend?: SpendWindow
): PolicyCheck {
  const digest = policyDigest(policy);

  if (policy.killSwitch) {
    return { allowed: false, reason: 'Policy kill switch is active. Edit policy.json (set killSwitch: false) to allow operations.', policyDigest: digest };
  }

  const tron = policy.tron;
  // Fail closed for every policy file that predates Tron support: the admin
  // must explicitly opt in. unrestricted does NOT bypass this — silently
  // arming a third chain the admin never enabled violates least surprise.
  if (tron?.enabled !== true) { // type-strict: a hand-edited "true"/1 must not arm a chain
    return {
      allowed: false,
      reason: 'Tron signing is not enabled in the policy. An admin must add `"tron": { "enabled": true, ... }` via the dashboard or a text editor.',
      policyDigest: digest,
    };
  }

  if (policy.unrestricted) {
    return { allowed: true, reason: 'OK (unrestricted mode — admin opted out of all per-tx checks; tron.enabled was still required)', policyDigest: digest };
  }

  if (tron.blockedContracts?.length) {
    const blocked = new Set(tron.blockedContracts);
    if (blocked.has(intent.to)) {
      return { allowed: false, reason: `Destination ${intent.to} is in tron.blockedContracts.`, policyDigest: digest };
    }
  }

  if (tron.allowedContracts !== undefined) {
    if (tron.allowedContracts.length === 0) {
      return { allowed: false, reason: 'tron.allowedContracts is explicitly empty — no destination is permitted.', policyDigest: digest };
    }
    if (!tron.allowedContracts.includes(intent.to)) {
      return { allowed: false, reason: `Destination ${intent.to} is not in tron.allowedContracts (${tron.allowedContracts.length} entries).`, policyDigest: digest };
    }
  }

  if (tron.maxTxSun !== undefined) {
    let max: bigint;
    try { max = BigInt(tron.maxTxSun); }
    catch { return { allowed: false, reason: 'Policy tron.maxTxSun is not a valid integer string.', policyDigest: digest }; }
    if (intent.valueSun > max) {
      return { allowed: false, reason: `Value ${intent.valueSun} SUN exceeds tron.maxTxSun ${max}.`, policyDigest: digest };
    }
  }

  if (tron.maxFeeLimitSun !== undefined) {
    let max: bigint;
    try { max = BigInt(tron.maxFeeLimitSun); }
    catch { return { allowed: false, reason: 'Policy tron.maxFeeLimitSun is not a valid integer string.', policyDigest: digest }; }
    if (intent.feeLimitSun > max) {
      return { allowed: false, reason: `fee_limit ${intent.feeLimitSun} SUN exceeds tron.maxFeeLimitSun ${max}.`, policyDigest: digest };
    }
  }

  const hasVelocityCap = tron.maxDailySpendSun !== undefined || tron.maxDailyTxCount !== undefined;
  if (hasVelocityCap) {
    if (!spend || !spend.ok) {
      return {
        allowed: false,
        reason: !spend
          ? 'Policy sets a Tron daily velocity cap but no spend-window stats were provided — refusing (fail closed).'
          : 'Policy sets a Tron daily velocity cap but the activity ledger could not be read — refusing (fail closed).',
        policyDigest: digest,
      };
    }
    if (tron.maxDailySpendSun !== undefined) {
      let maxSpend: bigint;
      try { maxSpend = BigInt(tron.maxDailySpendSun); }
      catch { return { allowed: false, reason: 'Policy tron.maxDailySpendSun is not a valid integer string.', policyDigest: digest }; }
      if (spend.totalWei + intent.valueSun > maxSpend) {
        return {
          allowed: false,
          reason: `Daily Tron spend cap: ${spend.totalWei} SUN already signed in the last 24h + ${intent.valueSun} now would exceed maxDailySpendSun ${maxSpend}.`,
          policyDigest: digest,
        };
      }
    }
    if (tron.maxDailyTxCount !== undefined && spend.txCount + 1 > tron.maxDailyTxCount) {
      return {
        allowed: false,
        reason: `Daily Tron tx-count cap: ${spend.txCount} txs signed in the last 24h; maxDailyTxCount is ${tron.maxDailyTxCount}.`,
        policyDigest: digest,
      };
    }
  }

  if (tron.requireMemo && !intent.memo) {
    return { allowed: false, reason: 'Tron policy requires every signing operation to include a memo (audit trail). Provide one via the `memo` arg.', policyDigest: digest };
  }

  return { allowed: true, reason: 'OK', policyDigest: digest };
}

// ── ERC-4337 session-key gate ────────────────────────────────────────

export interface Erc4337Intent {
  /** The smart account (userOp sender) the agent would act through. */
  account: string;
  /** The bundler endpoint the userOp would be submitted to. */
  bundlerUrl: string;
}

/**
 * Local gate for the 4337 surface. Deliberately thin: WHO (which accounts)
 * and WHERE (which bundlers) — the inner execution intent then goes through
 * the unchanged checkPolicy, and the on-chain session policies are the
 * authoritative spend fence.
 */
export function checkErc4337Gate(
  intent: Erc4337Intent,
  policy: AgentPolicy = loadPolicy()
): PolicyCheck {
  const digest = policyDigest(policy);

  if (policy.killSwitch) {
    return { allowed: false, reason: 'Policy kill switch is active. Edit policy.json (set killSwitch: false) to allow operations.', policyDigest: digest };
  }
  const sub = policy.erc4337;
  if (sub?.enabled !== true) { // type-strict, fail closed — third-party-account surface
    return {
      allowed: false,
      reason: 'ERC-4337 session-key signing is not enabled in the policy. An admin must add `"erc4337": { "enabled": true, ... }` via the dashboard or a text editor.',
      policyDigest: digest,
    };
  }
  if (policy.unrestricted) {
    return { allowed: true, reason: 'OK (unrestricted mode — erc4337.enabled was still required)', policyDigest: digest };
  }

  const account = intent.account.toLowerCase();
  if (sub.allowedAccounts !== undefined) {
    if (sub.allowedAccounts.length === 0) {
      return { allowed: false, reason: 'erc4337.allowedAccounts is explicitly empty — no smart account is permitted.', policyDigest: digest };
    }
    if (!sub.allowedAccounts.some((a) => a.toLowerCase() === account)) {
      return { allowed: false, reason: `Smart account ${intent.account} is not in erc4337.allowedAccounts (${sub.allowedAccounts.length} entries).`, policyDigest: digest };
    }
  }

  let host: string;
  try {
    const u = new URL(intent.bundlerUrl);
    if (u.protocol !== 'https:') {
      return { allowed: false, reason: 'bundlerUrl must be https.', policyDigest: digest };
    }
    host = u.hostname;
  } catch {
    return { allowed: false, reason: `bundlerUrl is not a valid URL: ${intent.bundlerUrl}`, policyDigest: digest };
  }
  if (sub.allowedBundlerHosts !== undefined) {
    if (!sub.allowedBundlerHosts.some((h) => h.toLowerCase() === host.toLowerCase())) {
      return { allowed: false, reason: `Bundler host ${host} is not in erc4337.allowedBundlerHosts.`, policyDigest: digest };
    }
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
  'solana',
  'tron',
  'erc4337',
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
  const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (o.erc4337 !== undefined) {
    if (o.erc4337 === null || typeof o.erc4337 !== 'object' || Array.isArray(o.erc4337)) {
      return { ok: false, error: 'erc4337 must be an object' };
    }
    const e4 = o.erc4337 as Record<string, unknown>;
    const E4_FIELDS = new Set(['enabled', 'allowedAccounts', 'allowedBundlerHosts']);
    for (const k of Object.keys(e4)) {
      if (!E4_FIELDS.has(k)) return { ok: false, error: `Unknown erc4337 policy field: ${k}` };
    }
    if (typeof e4.enabled !== 'boolean') return { ok: false, error: 'erc4337.enabled must be true or false' };
    if (e4.allowedAccounts !== undefined) {
      if (!Array.isArray(e4.allowedAccounts)) return { ok: false, error: 'erc4337.allowedAccounts must be an array of addresses' };
      for (const a of e4.allowedAccounts) {
        if (typeof a !== 'string' || !HEX_ADDR_RE.test(a)) return { ok: false, error: `erc4337.allowedAccounts entries must be 0x addresses, got ${a}` };
      }
    }
    if (e4.allowedBundlerHosts !== undefined) {
      if (!Array.isArray(e4.allowedBundlerHosts)) return { ok: false, error: 'erc4337.allowedBundlerHosts must be an array of hostnames' };
      for (const h of e4.allowedBundlerHosts) {
        if (typeof h !== 'string' || !/^[a-z0-9.-]+$/i.test(h)) return { ok: false, error: `erc4337.allowedBundlerHosts entries must be bare hostnames, got ${h}` };
      }
    }
  }
  if (o.solana !== undefined) {
    if (o.solana === null || typeof o.solana !== 'object' || Array.isArray(o.solana)) {
      return { ok: false, error: 'solana must be an object' };
    }
    const sol = o.solana as Record<string, unknown>;
    const SOLANA_FIELDS = new Set(['enabled', 'allowedPrograms', 'blockedPrograms', 'maxTxLamports', 'maxDailySpendLamports', 'maxDailyTxCount', 'requireMemo']);
    for (const k of Object.keys(sol)) {
      if (!SOLANA_FIELDS.has(k)) return { ok: false, error: `Unknown solana policy field: ${k}` };
    }
    if (typeof sol.enabled !== 'boolean') return { ok: false, error: 'solana.enabled must be true or false' };
    for (const listField of ['allowedPrograms', 'blockedPrograms'] as const) {
      const v = sol[listField];
      if (v !== undefined) {
        if (!Array.isArray(v)) return { ok: false, error: `solana.${listField} must be an array of base58 program ids` };
        for (const p of v) {
          if (typeof p !== 'string' || !BASE58_RE.test(p)) {
            return { ok: false, error: `solana.${listField} entries must be base58 program ids (32-44 chars), got ${p}` };
          }
        }
      }
    }
    for (const lamportField of ['maxTxLamports', 'maxDailySpendLamports'] as const) {
      const v = sol[lamportField];
      if (v !== undefined) {
        if (typeof v !== 'string') return { ok: false, error: `solana.${lamportField} must be a string (to preserve precision)` };
        try { BigInt(v); } catch { return { ok: false, error: `solana.${lamportField} must be a valid integer string` }; }
      }
    }
    if (sol.maxDailyTxCount !== undefined && (typeof sol.maxDailyTxCount !== 'number' || !Number.isInteger(sol.maxDailyTxCount) || sol.maxDailyTxCount < 0)) {
      return { ok: false, error: 'solana.maxDailyTxCount must be a non-negative integer' };
    }
    if (sol.requireMemo !== undefined && typeof sol.requireMemo !== 'boolean') {
      return { ok: false, error: 'solana.requireMemo must be true or false' };
    }
  }
  if (o.tron !== undefined) {
    if (o.tron === null || typeof o.tron !== 'object' || Array.isArray(o.tron)) {
      return { ok: false, error: 'tron must be an object' };
    }
    const tron = o.tron as Record<string, unknown>;
    const TRON_FIELDS = new Set(['enabled', 'allowedContracts', 'blockedContracts', 'maxTxSun', 'maxDailySpendSun', 'maxDailyTxCount', 'maxFeeLimitSun', 'requireMemo']);
    for (const k of Object.keys(tron)) {
      if (!TRON_FIELDS.has(k)) return { ok: false, error: `Unknown tron policy field: ${k}` };
    }
    if (typeof tron.enabled !== 'boolean') return { ok: false, error: 'tron.enabled must be true or false' };
    const TRON_ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
    for (const listField of ['allowedContracts', 'blockedContracts'] as const) {
      const v = tron[listField];
      if (v !== undefined) {
        if (!Array.isArray(v)) return { ok: false, error: `tron.${listField} must be an array of base58 Tron addresses` };
        for (const a of v) {
          if (typeof a !== 'string' || !TRON_ADDR_RE.test(a)) {
            return { ok: false, error: `tron.${listField} entries must be base58 "T…" addresses, got ${a}` };
          }
        }
      }
    }
    for (const sunField of ['maxTxSun', 'maxDailySpendSun', 'maxFeeLimitSun'] as const) {
      const v = tron[sunField];
      if (v !== undefined) {
        if (typeof v !== 'string') return { ok: false, error: `tron.${sunField} must be a string (to preserve precision)` };
        try { BigInt(v); } catch { return { ok: false, error: `tron.${sunField} must be a valid integer string` }; }
      }
    }
    if (tron.maxDailyTxCount !== undefined && (typeof tron.maxDailyTxCount !== 'number' || !Number.isInteger(tron.maxDailyTxCount) || tron.maxDailyTxCount < 0)) {
      return { ok: false, error: 'tron.maxDailyTxCount must be a non-negative integer' };
    }
    if (tron.requireMemo !== undefined && typeof tron.requireMemo !== 'boolean') {
      return { ok: false, error: 'tron.requireMemo must be true or false' };
    }
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
    solana: o.solana as SolanaPolicy | undefined,
    tron: o.tron as TronPolicy | undefined,
    erc4337: o.erc4337 as Erc4337Policy | undefined,
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
