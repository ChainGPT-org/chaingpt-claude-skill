/**
 * ERC-7579 account primitives — the account-side encodings needed to drive
 * modular smart accounts (Biconomy Nexus v1 is the v1 reference; Kernel v3 /
 * Safe7579 are follow-ups) from custody-free payload builders.
 *
 * Everything here is PURE encoding/classification over viem — no RPC, no
 * signing. RPC reads (accountId, nonce) take an endpoint list and go through
 * the shared jsonRpcFallback.
 */

import { concatHex, encodeAbiParameters, encodeFunctionData, encodePacked, decodeAbiParameters, type Address, type Hex } from 'viem';
import { jsonRpcFallback } from './http.js';

// execute(bytes32 mode, bytes executionCalldata) — ERC-7579 standard execution
export const ERC7579_EXECUTE_ABI = [{
  type: 'function',
  name: 'execute',
  stateMutability: 'payable',
  inputs: [
    { name: 'mode', type: 'bytes32' },
    { name: 'executionCalldata', type: 'bytes' },
  ],
  outputs: [],
}] as const;

// installModule(uint256 moduleTypeId, address module, bytes initData)
export const ERC7579_INSTALL_MODULE_ABI = [{
  type: 'function',
  name: 'installModule',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'moduleTypeId', type: 'uint256' },
    { name: 'module', type: 'address' },
    { name: 'initData', type: 'bytes' },
  ],
  outputs: [],
}] as const;

export const IS_MODULE_INSTALLED_ABI = [{
  type: 'function',
  name: 'isModuleInstalled',
  stateMutability: 'view',
  inputs: [
    { name: 'moduleTypeId', type: 'uint256' },
    { name: 'module', type: 'address' },
    { name: 'additionalContext', type: 'bytes' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export const ACCOUNT_ID_ABI = [{
  type: 'function',
  name: 'accountId',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'string' }],
}] as const;

export const ENTRYPOINT_GET_NONCE_ABI = [{
  type: 'function',
  name: 'getNonce',
  stateMutability: 'view',
  inputs: [
    { name: 'sender', type: 'address' },
    { name: 'key', type: 'uint192' },
  ],
  outputs: [{ name: 'nonce', type: 'uint256' }],
}] as const;

export const MODULE_TYPE_VALIDATOR = 1n;

/**
 * Mode bytes32 for a single default-exec call: CALLTYPE_SINGLE (0x00) +
 * EXECTYPE_DEFAULT (0x00) + 4 reserved zero bytes + 4 zero selector bytes +
 * 22 zero payload bytes — i.e. all zeros.
 */
export const MODE_SINGLE_DEFAULT: Hex = `0x${'00'.repeat(32)}`;

/** execute(single): executionCalldata = packed(target ++ value ++ data) */
export function encodeSingleExecute(target: Address, value: bigint, data: Hex): Hex {
  const executionCalldata = encodePacked(['address', 'uint256', 'bytes'], [target, value, data]);
  return encodeFunctionData({
    abi: ERC7579_EXECUTE_ABI,
    functionName: 'execute',
    args: [MODE_SINGLE_DEFAULT, executionCalldata],
  });
}

export function encodeInstallModule(module: Address, initData: Hex): Hex {
  return encodeFunctionData({
    abi: ERC7579_INSTALL_MODULE_ABI,
    functionName: 'installModule',
    args: [MODULE_TYPE_VALIDATOR, module, initData],
  });
}

/**
 * Nexus v1 nonce key (uint192): [3 bytes zero][1 byte validation mode 0x00]
 * [20 bytes validator address] — per Nexus NonceLib. The EntryPoint treats the
 * key opaquely; the account routes validation to the encoded validator.
 */
export function nexusNonceKey(validator: Address): bigint {
  const hex = `0x${'00'.repeat(3)}00${validator.slice(2)}` as Hex; // 24 bytes = uint192
  return BigInt(hex);
}

export type AccountKind =
  | { kind: 'nexus'; version: string }
  | { kind: 'kernel'; raw: string }
  | { kind: 'safe'; raw: string }
  | { kind: 'unknown'; raw: string };

/** Classify an ERC-7579 accountId() string (e.g. "biconomy.nexus.1.0.2"). */
export function classifyAccountId(id: string): AccountKind {
  const lower = id.toLowerCase();
  if (lower.includes('nexus')) {
    const m = lower.match(/nexus\.([\d.]+)/);
    return { kind: 'nexus', version: m?.[1] ?? 'unknown' };
  }
  if (lower.includes('kernel')) return { kind: 'kernel', raw: id };
  if (lower.includes('safe')) return { kind: 'safe', raw: id };
  return { kind: 'unknown', raw: id };
}

/** Read accountId() from a deployed ERC-7579 account. Throws if not deployed/7579. */
export async function readAccountId(rpcs: string[], account: Address): Promise<string> {
  const data = encodeFunctionData({ abi: ACCOUNT_ID_ABI, functionName: 'accountId', args: [] });
  const raw = await jsonRpcFallback<Hex>(rpcs, 'eth_call', [{ to: account, data }, 'latest']);
  const [id] = decodeAbiParameters([{ type: 'string' }], raw);
  return id as string;
}

/** Calldata helpers for read tools (the caller eth_calls these). */
export function encodeIsModuleInstalled(module: Address): Hex {
  return encodeFunctionData({
    abi: IS_MODULE_INSTALLED_ABI,
    functionName: 'isModuleInstalled',
    args: [MODULE_TYPE_VALIDATOR, module, '0x'],
  });
}

export function encodeGetNonce(sender: Address, key: bigint): Hex {
  return encodeFunctionData({ abi: ENTRYPOINT_GET_NONCE_ABI, functionName: 'getNonce', args: [sender, key] });
}

export { concatHex, encodeAbiParameters };
