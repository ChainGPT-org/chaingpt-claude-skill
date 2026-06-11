/**
 * Smart Sessions (ERC-7579 session-key module) — pure encoders + read ABIs.
 *
 * The trust-story endgame: the user's smart account grants the agent's
 * existing EOA a SCOPED on-chain session — cumulative per-token spend caps,
 * target+selector allowlists, time bounds, usage caps — enforced by audited
 * validator/policy contracts at EntryPoint validation time. Even a fully
 * compromised host (policy file rewritten, unrestricted mode) cannot exceed
 * what the chain granted.
 *
 * Stack: the vendor-neutral `erc7579/smartsessions` module (Rhinestone +
 * Biconomy co-authored; ChainLight/Ackee/Cantina audited) at deterministic
 * cross-chain addresses. We vendor ONLY addresses + ABI fragments + our own
 * viem encoders — no SDK dependency (module-sdk is in maintenance mode and
 * the module repo is AGPL; facts and interfaces are not code).
 *
 * Custody model: grant/revoke payloads are built UNSIGNED for the account
 * OWNER to sign externally. The agent later signs userOps only with its own
 * session key (the existing encrypted keystore EOA), wrapped as
 * `0x00 ++ permissionId ++ sig` (USE mode).
 *
 * NOTE on addresses: TWO SmartSession deployments exist in the wild. We pin
 * the v1.0.0 release deployment confirmed on Base Sepolia; `eth_getCode`
 * verification against this codehash happens in the status tool at runtime
 * (see TESTING.md). Re-pin deliberately, never silently.
 */

import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, type Address, type Hex } from 'viem';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { policyPath } from './agent-policy.js';

// ── Deterministic deployments (verify via eth_getCode before trusting) ──
export const SMART_SESSIONS_ADDRESS: Address = '0x00000000002B0eCfbD0496EE71e01257dA0E37DE';
export const OWNABLE_VALIDATOR_ADDRESS: Address = '0x000000000013fdB5234E4E3162a810F54d9f7E98';
export const ERC20_SPENDING_LIMIT_POLICY: Address = '0x000000000033212e272655d8a22402db819477a6';
export const TIME_FRAME_POLICY: Address = '0x0000000000D30f611fA3bf652ac6879428586930';
export const USAGE_LIMIT_POLICY: Address = '0x00000000001d4479FA2A947026204d0283ceDe4B';
export const VALUE_LIMIT_POLICY: Address = '0x000000000021dC45451291BCDfc9f0B46d6f0278';

// 65-byte mock ECDSA signature for bundler gas estimation (r=1, s=1, v=27).
export const MOCK_ECDSA_SIG: Hex = `0x${'00'.repeat(31)}01${'00'.repeat(31)}011b`;

// ── Session struct (mirrors smartsessions ISmartSession.Session) ──────
const POLICY_DATA = {
  type: 'tuple',
  components: [
    { name: 'policy', type: 'address' },
    { name: 'initData', type: 'bytes' },
  ],
} as const;

const ACTION_DATA = {
  type: 'tuple',
  components: [
    { name: 'actionTargetSelector', type: 'bytes4' },
    { name: 'actionTarget', type: 'address' },
    { name: 'actionPolicies', type: 'tuple[]', components: POLICY_DATA.components },
  ],
} as const;

const ERC7739_DATA = {
  type: 'tuple',
  components: [
    { name: 'allowedERC7739Content', type: 'string[]' },
    { name: 'erc1271Policies', type: 'tuple[]', components: POLICY_DATA.components },
  ],
} as const;

const SESSION_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'sessionValidator', type: 'address' },
    { name: 'sessionValidatorInitData', type: 'bytes' },
    { name: 'salt', type: 'bytes32' },
    { name: 'userOpPolicies', type: 'tuple[]', components: POLICY_DATA.components },
    { name: 'erc7739Policies', type: 'tuple', components: ERC7739_DATA.components },
    { name: 'actions', type: 'tuple[]', components: ACTION_DATA.components },
    { name: 'permitERC4337Paymaster', type: 'bool' },
  ],
} as const;

export interface PolicyData { policy: Address; initData: Hex }
export interface ActionData { actionTargetSelector: Hex; actionTarget: Address; actionPolicies: PolicyData[] }
export interface Session {
  sessionValidator: Address;
  sessionValidatorInitData: Hex;
  salt: Hex;
  userOpPolicies: PolicyData[];
  erc7739Policies: { allowedERC7739Content: string[]; erc1271Policies: PolicyData[] };
  actions: ActionData[];
  permitERC4337Paymaster: boolean;
}

export const ERC20_TRANSFER_SELECTOR: Hex = '0xa9059cbb';

export interface SessionCaps {
  /** The session key — the agent's existing keystore EOA. */
  agentAddress: Address;
  /** Cumulative on-chain per-token caps (base units). transfer() actions are registered per token. */
  tokenCaps: { token: Address; cap: bigint }[];
  /**
   * Extra protocol actions. v1: these get TimeFrame (+UsageLimit when set)
   * only — token movements they cause are fenced solely by approval caps.
   * Grant token-transfer actions only until param-rule policies land.
   */
  targets?: { target: Address; selector: Hex }[];
  /** REQUIRED — unbounded grants are refused by the builder. Unix seconds. */
  validUntil: number;
  validAfter?: number;
  maxUses?: bigint;
  nativeValueCap?: bigint;
  salt?: Hex;
}

function timeFramePolicy(validUntil: number, validAfter = 0): PolicyData {
  // initData: packed(uint48 validUntil ++ uint48 validAfter) per TimeFramePolicy
  return {
    policy: TIME_FRAME_POLICY,
    initData: encodePacked(['uint48', 'uint48'], [validUntil, validAfter]),
  };
}

function usageLimitPolicy(maxUses: bigint): PolicyData {
  return { policy: USAGE_LIMIT_POLICY, initData: encodePacked(['uint128'], [maxUses]) as Hex };
}

function valueLimitPolicy(cap: bigint): PolicyData {
  return { policy: VALUE_LIMIT_POLICY, initData: encodeAbiParameters([{ type: 'uint256' }], [cap]) };
}

function spendingLimitPolicy(tokens: Address[], caps: bigint[]): PolicyData {
  // initData: abi.encode(address[] tokens, uint256[] limits)
  return {
    policy: ERC20_SPENDING_LIMIT_POLICY,
    initData: encodeAbiParameters([{ type: 'address[]' }, { type: 'uint256[]' }], [tokens, caps]),
  };
}

/** Assemble the Session struct from human-level caps. Throws on unsafe input. */
export function buildSession(caps: SessionCaps): Session {
  if (!caps.validUntil || caps.validUntil <= Math.floor(Date.now() / 1000)) {
    throw new Error('validUntil is required and must be in the future — unbounded session grants are refused by design.');
  }
  if (!caps.tokenCaps.length && !caps.targets?.length && caps.nativeValueCap === undefined) {
    throw new Error('Grant at least one token cap, target action, or native value cap — an empty session is meaningless.');
  }
  for (const t of caps.tokenCaps) {
    if (t.cap <= 0n) throw new Error(`Token cap for ${t.token} must be > 0 (the on-chain policy reverts on zero limits).`);
  }

  const timePolicies: PolicyData[] = [timeFramePolicy(caps.validUntil, caps.validAfter ?? 0)];
  if (caps.maxUses !== undefined) timePolicies.push(usageLimitPolicy(caps.maxUses));

  const actions: ActionData[] = [];
  for (const t of caps.tokenCaps) {
    actions.push({
      actionTargetSelector: ERC20_TRANSFER_SELECTOR,
      actionTarget: t.token,
      actionPolicies: [spendingLimitPolicy([t.token], [t.cap]), ...timePolicies],
    });
  }
  for (const extra of caps.targets ?? []) {
    const pols: PolicyData[] = [...timePolicies];
    if (caps.nativeValueCap !== undefined) pols.push(valueLimitPolicy(caps.nativeValueCap));
    actions.push({ actionTargetSelector: extra.selector, actionTarget: extra.target, actionPolicies: pols });
  }

  return {
    sessionValidator: OWNABLE_VALIDATOR_ADDRESS,
    // OwnableValidator-as-stateless-validator: abi.encode(threshold=1, owners=[agent])
    sessionValidatorInitData: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address[]' }],
      [1n, [caps.agentAddress]]
    ),
    salt: caps.salt ?? (`0x${'00'.repeat(32)}` as Hex),
    userOpPolicies: timePolicies,
    erc7739Policies: { allowedERC7739Content: [], erc1271Policies: [] },
    actions,
    permitERC4337Paymaster: false,
  };
}

/** permissionId = keccak256(abi.encode(sessionValidator, sessionValidatorInitData, salt)) */
export function getPermissionId(session: Session): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }],
      [session.sessionValidator, session.sessionValidatorInitData, session.salt]
    )
  );
}

const ENABLE_SESSIONS_ABI = [{
  type: 'function',
  name: 'enableSessions',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'sessions', type: 'tuple[]', components: SESSION_TUPLE.components }],
  outputs: [{ name: 'permissionIds', type: 'bytes32[]' }],
}] as const;

const REMOVE_SESSION_ABI = [{
  type: 'function',
  name: 'removeSession',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'permissionId', type: 'bytes32' }],
  outputs: [],
}] as const;

export function encodeEnableSessions(sessions: Session[]): Hex {
  return encodeFunctionData({ abi: ENABLE_SESSIONS_ABI, functionName: 'enableSessions', args: [sessions as never] });
}

export function encodeRemoveSession(permissionId: Hex): Hex {
  return encodeFunctionData({ abi: REMOVE_SESSION_ABI, functionName: 'removeSession', args: [permissionId] });
}

/** USE-mode session signature: packed(0x00 ++ permissionId ++ sig) */
export function encodeUseSignature(permissionId: Hex, sig: Hex): Hex {
  return encodePacked(['bytes1', 'bytes32', 'bytes'], ['0x00', permissionId, sig]) as Hex;
}

export const SMART_SESSION_READ_ABI = [
  {
    type: 'function',
    name: 'isPermissionEnabled',
    stateMutability: 'view',
    inputs: [
      { name: 'permissionId', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// ── Local convenience cache (NON-authoritative — chain is truth) ──────
export interface SessionRecord {
  account: Address;
  chainId: number;
  permissionId: Hex;
  caps: { agentAddress: string; tokenCaps: { token: string; cap: string }[]; validUntil: number };
  createdAt: string;
}

export function sessionsCachePath(): string {
  return process.env.CHAINGPT_SESSIONS_FILE?.trim() || join(dirname(policyPath()), 'sessions-4337.json');
}

export function appendSessionRecord(r: SessionRecord): void {
  const path = sessionsCachePath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const existing = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SessionRecord[]) : [];
    existing.push(r);
    writeFileSync(path, JSON.stringify(existing, null, 2), { mode: 0o600 });
  } catch { /* convenience cache — never block the grant flow */ }
}

export function readSessionRecords(): SessionRecord[] {
  try {
    const path = sessionsCachePath();
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf8')) as SessionRecord[];
  } catch {
    return [];
  }
}
