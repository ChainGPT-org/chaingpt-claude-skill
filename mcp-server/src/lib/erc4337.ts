/**
 * ERC-4337 v0.7 helper primitives. Custody-free.
 *
 * What this lib provides:
 *   - Packing a user-friendly UserOperation object into the v0.7
 *     PackedUserOperation struct (gas/fee fields concatenated into bytes32).
 *   - Computing the userOpHash that the smart-contract wallet's owner key
 *     (or session key) signs.
 *   - A tiny wrapper around the bundler-rpc methods
 *     (eth_estimateUserOperationGas, eth_getUserOperationReceipt,
 *     eth_supportedEntryPoints) so the user can drive a bundler over JSON-RPC
 *     without writing the boilerplate.
 *
 * Why this is a "foundation" rather than a full session-key flow:
 *
 *   ERC-4337 session keys live inside the smart-contract wallet's "validator"
 *   module. Every major SCW provider — Safe + Zodiac, Kernel/ZeroDev,
 *   Biconomy, Alchemy Smart Wallet — implements its own validator with its
 *   own session-key ABI. Picking one provider in this foundation would lock
 *   the plugin into a single vendor's session-key surface.
 *
 *   Instead, this lib gives users the shared primitives (packing + hashing +
 *   bundler-rpc) that ANY ERC-4337 v0.7 SCW needs, and leaves the per-provider
 *   session-key issuance / use as follow-up PRs that build on this foundation.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-4337 (v0.7 January 2024 update)
 * EntryPoint v0.7: 0x0000000071727De22E5E9d8BAf0edAc6f37da032 (same on every chain)
 */

import {
  type Address,
  type Hex,
  isAddress,
  isHex,
} from 'viem';
import {
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from 'viem/account-abstraction';
import { httpJson } from './http.js';

/** EntryPoint v0.7 canonical address (deterministic CREATE2 deployment). */
export const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;
/** EntryPoint v0.6 canonical address — kept for read-only inspection of legacy ops. */
export const ENTRY_POINT_V06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as const;

export type EntryPointVersion = '0.6' | '0.7';

/**
 * The user-friendly UserOperation v0.7 input shape we accept from MCP callers.
 * All numeric fields are accepted as strings (decimal or 0x-hex) so callers
 * don't have to deal with JSON number precision loss on uint256 values.
 */
export interface UserOpInput {
  sender: Address;
  nonce: string;                  // decimal or 0x-hex
  factory?: Address;              // initCode in v0.7 is split: factory + factoryData
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymaster?: Address;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterData?: Hex;
  signature?: Hex;                // empty until signed
}

function asBigInt(v: string | undefined, label: string): bigint {
  if (v === undefined || v === null) throw new Error(`${label}: required`);
  if (typeof v !== 'string') throw new Error(`${label}: must be a string (got ${typeof v})`);
  const s = v.trim();
  if (s.length === 0) throw new Error(`${label}: empty`);
  try {
    if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
    if (!/^\d+$/.test(s)) throw new Error('not a decimal integer');
    return BigInt(s);
  } catch (err: any) {
    throw new Error(`${label}: invalid uint256 "${v}" — ${err.message}`);
  }
}

function assertAddress(v: string | undefined, label: string, optional = false): Address | undefined {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw new Error(`${label}: required address`);
  }
  if (!isAddress(v)) throw new Error(`${label}: not a 0x-prefixed 20-byte address: "${v}"`);
  return v as Address;
}

function assertHex(v: string | undefined, label: string, optional = false): Hex | undefined {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw new Error(`${label}: required hex string`);
  }
  if (!isHex(v)) throw new Error(`${label}: not a 0x-prefixed hex string: "${v}"`);
  return v as Hex;
}

/**
 * Normalize a UserOpInput into the viem `UserOperation<'0.7'>` shape with
 * proper bigint typing. Throws on missing / malformed fields with a clear
 * label so the caller knows exactly which input was bad.
 */
export function normalizeUserOp(input: UserOpInput): UserOperation<'0.7'> {
  const sender = assertAddress(input.sender, 'sender') as Address;
  const callData = assertHex(input.callData, 'callData') as Hex;
  const factory = assertAddress(input.factory, 'factory', true);
  const factoryData = assertHex(input.factoryData, 'factoryData', true);
  const paymaster = assertAddress(input.paymaster, 'paymaster', true);
  const paymasterData = assertHex(input.paymasterData, 'paymasterData', true);
  const signature = assertHex(input.signature, 'signature', true) ?? ('0x' as Hex);

  // Cross-field validation
  if (Boolean(factory) !== Boolean(factoryData)) {
    throw new Error('factory and factoryData must be set together (or both omitted)');
  }
  if (paymaster && (!input.paymasterVerificationGasLimit || !input.paymasterPostOpGasLimit)) {
    throw new Error('paymaster requires paymasterVerificationGasLimit + paymasterPostOpGasLimit');
  }

  return {
    sender,
    nonce: asBigInt(input.nonce, 'nonce'),
    factory,
    factoryData,
    callData,
    callGasLimit: asBigInt(input.callGasLimit, 'callGasLimit'),
    verificationGasLimit: asBigInt(input.verificationGasLimit, 'verificationGasLimit'),
    preVerificationGas: asBigInt(input.preVerificationGas, 'preVerificationGas'),
    maxFeePerGas: asBigInt(input.maxFeePerGas, 'maxFeePerGas'),
    maxPriorityFeePerGas: asBigInt(input.maxPriorityFeePerGas, 'maxPriorityFeePerGas'),
    paymaster,
    paymasterVerificationGasLimit: paymaster ? asBigInt(input.paymasterVerificationGasLimit, 'paymasterVerificationGasLimit') : undefined,
    paymasterPostOpGasLimit: paymaster ? asBigInt(input.paymasterPostOpGasLimit, 'paymasterPostOpGasLimit') : undefined,
    paymasterData,
    signature,
  } as UserOperation<'0.7'>;
}

/**
 * Compute the userOpHash a signer signs. v0.7 hash is:
 *   keccak256(keccak256(abi.encode(...packedFields)) ++ entryPoint ++ chainId)
 * viem implements this verbatim.
 */
export function computeUserOpHash(opts: {
  userOp: UserOperation<'0.7'>;
  entryPoint?: Address;
  chainId: number;
}): Hex {
  return getUserOperationHash({
    userOperation: opts.userOp,
    entryPointAddress: (opts.entryPoint ?? ENTRY_POINT_V07) as Address,
    entryPointVersion: '0.7',
    chainId: opts.chainId,
  });
}

/**
 * Pack a normalized UserOp into the on-the-wire PackedUserOperation shape
 * (with the bytes32 packed gas-limit / gas-fee fields). Useful when sending
 * to a non-viem bundler that expects exactly the EntryPoint v0.7 struct.
 */
export function packUserOp(userOp: UserOperation<'0.7'>) {
  return toPackedUserOperation(userOp);
}

/**
 * BigInt-safe JSON serialization. JSON.stringify chokes on bigint; we cast
 * every bigint to "0x"-prefixed hex (the bundler RPC convention).
 */
export function userOpToBundlerJson(userOp: UserOperation<'0.7'>): Record<string, string> {
  const hex = (b: bigint | undefined) => (b === undefined ? undefined : `0x${b.toString(16)}`);
  const out: Record<string, string | undefined> = {
    sender: userOp.sender,
    nonce: hex(userOp.nonce),
    factory: userOp.factory,
    factoryData: userOp.factoryData,
    callData: userOp.callData,
    callGasLimit: hex(userOp.callGasLimit),
    verificationGasLimit: hex(userOp.verificationGasLimit),
    preVerificationGas: hex(userOp.preVerificationGas),
    maxFeePerGas: hex(userOp.maxFeePerGas),
    maxPriorityFeePerGas: hex(userOp.maxPriorityFeePerGas),
    paymaster: userOp.paymaster,
    paymasterVerificationGasLimit: hex(userOp.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: hex(userOp.paymasterPostOpGasLimit),
    paymasterData: userOp.paymasterData,
    signature: userOp.signature,
  };
  // Drop undefineds so the bundler doesn't see explicit nulls.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return cleaned;
}

// ─── Bundler RPC helpers ───────────────────────────────────────────
/**
 * Send an arbitrary JSON-RPC method to a bundler endpoint. Bundlers
 * implement a small set of methods on top of the standard JSON-RPC shape:
 *   eth_estimateUserOperationGas, eth_sendUserOperation,
 *   eth_getUserOperationReceipt, eth_getUserOperationByHash,
 *   eth_supportedEntryPoints.
 *
 * We don't ship the user's bundler URL — they pass it in (Pimlico, Alchemy,
 * Stackup, Particle, etc. — all expose the same surface).
 */
export async function bundlerRpc<T = unknown>(opts: {
  url: string;
  method: string;
  params: unknown[];
}): Promise<T> {
  const res = await httpJson<{ result?: T; error?: { code: number; message: string } }>(opts.url, {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: opts.method, params: opts.params },
  });
  if (res.error) {
    throw new Error(`bundler rpc ${opts.method} returned ${res.error.code}: ${res.error.message}`);
  }
  if (res.result === undefined) {
    throw new Error(`bundler rpc ${opts.method}: no result and no error in response`);
  }
  return res.result;
}
