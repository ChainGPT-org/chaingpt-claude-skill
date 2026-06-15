/**
 * Tron transaction signing + TRC-20 helpers.
 *
 * Custody model: the agent's Tron account is controlled by the SAME secp256k1
 * key as the EVM keystore (see tron-address.ts). We never hand-roll protobuf:
 * the node builds the unsigned tx (raw_data + raw_data_hex + txID), we VERIFY
 * `txID == SHA256(raw_data_hex)` locally, then sign that 32-byte hash with the
 * viem account and attach a 65-byte `r‖s‖recid` signature.
 *
 * Security: signUnsignedTx refuses any tx whose txID doesn't match its
 * raw_data_hex (the bytes actually broadcast), so a tampered/mismatched tx is
 * never signed. See docs/tron/RESEARCH.md §4 and docs/tron/PLAN.md §G.
 */

import { sha256, decodeAbiParameters, encodeAbiParameters } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { tronAddressFromEvm, toEvmAddressParam, normalizeToBase58 } from './tron-address.js';
import {
  type TronNetwork,
  type UnsignedTronTx,
  triggerConstantContract,
  triggerSmartContract,
  createTransaction,
  decodeBroadcastMessage,
} from './tron.js';
import { DEFAULT_FEE_LIMIT_SUN } from './tron-tokens.js';

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ── ABI encoding (inputs) — hand-rolled to avoid viem address-checksum quirks ──
/** Encode a Tron/EVM address as a 32-byte (64 hex) ABI word. */
export function encodeAddressParam(addr: string): string {
  return toEvmAddressParam(addr).slice(2).toLowerCase().padStart(64, '0');
}
/** Encode a non-negative bigint as a uint256 ABI word (64 hex). */
export function encodeUint256Param(v: bigint): string {
  if (v < 0n) throw new Error('uint256 cannot be negative');
  const h = v.toString(16);
  if (h.length > 64) throw new Error('uint256 overflow');
  return h.padStart(64, '0');
}

/**
 * Encode a full ABI parameter tuple (handles dynamic arrays) via viem and
 * return the hex WITHOUT the 0x prefix — the shape the TronGrid `parameter`
 * field expects (no 4-byte selector). Tron addresses must be passed in their
 * 0x EVM form (use toEvmAddressParam).
 */
export function encodeParams(params: ReadonlyArray<{ type: string }>, values: ReadonlyArray<unknown>): string {
  return encodeAbiParameters(params as any, values as any).slice(2);
}

// ── ABI decoding (outputs) — viem (no address-checksum concern on decode) ──
export function decodeUint(res: string): bigint {
  const hex = res.startsWith('0x') ? res : `0x${res}`;
  const [v] = decodeAbiParameters([{ type: 'uint256' }], hex as `0x${string}`);
  return v as bigint;
}
export function decodeStringResult(res: string): string {
  const hex = res.startsWith('0x') ? res : `0x${res}`;
  const [v] = decodeAbiParameters([{ type: 'string' }], hex as `0x${string}`);
  return v as string;
}

// ── TRC-20 reads (via triggerconstantcontract) ───────────────────────
export async function readTrc20Decimals(network: TronNetwork, owner: string, token: string): Promise<number> {
  const r = await triggerConstantContract(network, { ownerBase58: owner, contractBase58: token, functionSelector: 'decimals()' });
  const res = r.constant_result?.[0];
  if (!res) throw new Error(`decimals() on ${token} returned no result`);
  return Number(decodeUint(res));
}
export async function readTrc20Symbol(network: TronNetwork, owner: string, token: string): Promise<string> {
  const r = await triggerConstantContract(network, { ownerBase58: owner, contractBase58: token, functionSelector: 'symbol()' });
  const res = r.constant_result?.[0];
  if (!res) throw new Error(`symbol() on ${token} returned no result`);
  return decodeStringResult(res);
}
export async function readTrc20Balance(network: TronNetwork, token: string, holder: string): Promise<bigint> {
  const r = await triggerConstantContract(network, {
    ownerBase58: holder,
    contractBase58: token,
    functionSelector: 'balanceOf(address)',
    parameter: encodeAddressParam(holder),
  });
  const res = r.constant_result?.[0];
  if (!res) throw new Error(`balanceOf on ${token} returned no result`);
  return decodeUint(res);
}

// ── Signing ──────────────────────────────────────────────────────────
/** The agent's base58 Tron address — derived from the same secp256k1 EVM key. */
export function deriveTronAddress(account: PrivateKeyAccount): string {
  return tronAddressFromEvm(account.address);
}

/** Tron txID = SHA256(protobuf(raw_data)) = SHA256(raw_data_hex bytes). Returns 64 hex (no 0x). */
export function computeTxId(rawDataHex: string): string {
  return sha256(hexToBytes(rawDataHex)).slice(2).toLowerCase();
}

/** True iff the declared txID matches SHA256(raw_data_hex) — the bytes actually broadcast. */
export function verifyTxId(rawDataHex: string, txID: string): boolean {
  if (!rawDataHex || !txID) return false;
  return computeTxId(rawDataHex) === txID.replace(/^0x/, '').toLowerCase();
}

/**
 * Sign a 32-byte txID hash with the agent's secp256k1 key. viem `account.sign`
 * returns a serialized hex sig `r(32)‖s(32)‖v(1)` with v∈{27,28}; Tron wants
 * `r‖s‖recid` with recid∈{0,1}, so we map recid = v - 27. Returns 130 hex (no 0x).
 */
export async function signTxId(account: PrivateKeyAccount, txID: string): Promise<string> {
  const clean = txID.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('txID must be 32-byte hex');
  if (typeof account.sign !== 'function') throw new Error('agent account cannot sign a raw hash (viem account.sign missing)');
  const sigHex = await account.sign({ hash: `0x${clean}` });
  const sig = sigHex.replace(/^0x/, '');
  if (sig.length !== 130) throw new Error(`unexpected signature length ${sig.length}`);
  const v = Number.parseInt(sig.slice(128, 130), 16);
  const recid = v >= 27 ? v - 27 : v;
  if (recid !== 0 && recid !== 1) throw new Error(`unexpected recovery id ${recid}`);
  return sig.slice(0, 128) + recid.toString(16).padStart(2, '0');
}

/**
 * Verify the txID matches the broadcast bytes, then sign and attach the
 * signature. Refuses a tampered tx. The returned object is ready to broadcast.
 */
export async function signUnsignedTx(account: PrivateKeyAccount, tx: UnsignedTronTx): Promise<UnsignedTronTx> {
  if (!verifyTxId(tx.raw_data_hex, tx.txID)) {
    throw new Error('Tron txID does not match SHA256(raw_data_hex) — refusing to sign a tampered transaction.');
  }
  const signature = await signTxId(account, tx.txID);
  return { ...tx, signature: [signature] };
}

// ── raw_data decode (for cross-checking node output against intent) ───
export interface DecodedTronTx {
  contractType: string;
  ownerBase58: string;
  /** recipient (TransferContract) or contract address (TriggerSmartContract). */
  toBase58: string;
  /** native amount (TransferContract) or call_value (TriggerSmartContract), in SUN. */
  valueSun: bigint;
  /** calldata (hex, no 0x) for contract calls. */
  data?: string;
}

/**
 * Read the policy-relevant fields out of the node's JSON raw_data. We build
 * with visible:true so addresses come back base58; normalizeToBase58 also
 * tolerates the 41-hex form defensively.
 */
export function decodeRawData(rawData: any): DecodedTronTx {
  const c = rawData?.contract?.[0];
  if (!c) throw new Error('raw_data has no contract');
  const type = String(c.type);
  const val = c.parameter?.value ?? {};
  // Check the contract type BEFORE touching addresses so an unsupported type
  // fails with the right message rather than an address-normalize error.
  if (type === 'TransferContract') {
    return {
      contractType: type,
      ownerBase58: normalizeToBase58(String(val.owner_address)),
      toBase58: normalizeToBase58(String(val.to_address)),
      valueSun: BigInt(val.amount ?? 0),
    };
  }
  if (type === 'TriggerSmartContract') {
    return {
      contractType: type,
      ownerBase58: normalizeToBase58(String(val.owner_address)),
      toBase58: normalizeToBase58(String(val.contract_address)),
      valueSun: BigInt(val.call_value ?? 0),
      data: typeof val.data === 'string' ? val.data : undefined,
    };
  }
  throw new Error(`unsupported Tron contract type: ${type}`);
}

// ── Unsigned-tx builders (the node does the protobuf) ────────────────
export async function buildTrxTransfer(
  network: TronNetwork,
  args: { ownerBase58: string; toBase58: string; amountSun: bigint },
): Promise<UnsignedTronTx> {
  if (args.amountSun <= 0n) throw new Error('amount must be positive');
  return createTransaction(network, args);
}

export async function buildTrc20Transfer(
  network: TronNetwork,
  args: { ownerBase58: string; tokenBase58: string; toBase58: string; amount: bigint; feeLimitSun?: bigint },
): Promise<UnsignedTronTx> {
  if (args.amount <= 0n) throw new Error('amount must be positive');
  const parameter = encodeAddressParam(args.toBase58) + encodeUint256Param(args.amount);
  return buildContractCall(network, {
    ownerBase58: args.ownerBase58,
    contractBase58: args.tokenBase58,
    functionSelector: 'transfer(address,uint256)',
    parameter,
    feeLimitSun: args.feeLimitSun ?? DEFAULT_FEE_LIMIT_SUN,
  });
}

export async function buildContractCall(
  network: TronNetwork,
  args: { ownerBase58: string; contractBase58: string; functionSelector: string; parameter?: string; feeLimitSun?: bigint; callValueSun?: bigint },
): Promise<UnsignedTronTx> {
  const res = await triggerSmartContract(network, {
    ownerBase58: args.ownerBase58,
    contractBase58: args.contractBase58,
    functionSelector: args.functionSelector,
    parameter: args.parameter,
    feeLimitSun: args.feeLimitSun ?? DEFAULT_FEE_LIMIT_SUN,
    callValueSun: args.callValueSun ?? 0n,
  });
  if (res.result && res.result.result === false) {
    throw new Error(`Tron contract build refused: ${decodeBroadcastMessage(res.result.code || res.result.message)}`);
  }
  if (!res.transaction || !res.transaction.raw_data_hex) {
    throw new Error(`triggersmartcontract returned no transaction: ${JSON.stringify(res).slice(0, 200)}`);
  }
  return res.transaction;
}

/**
 * Pre-broadcast revert check via triggerconstantcontract. Returns ok=false with
 * a message when the call would revert. Mirrors Solana's "never broadcast a
 * sim-failure". `parameter` is the ABI args without the selector.
 */
export async function constantPrecheck(
  network: TronNetwork,
  args: { ownerBase58: string; contractBase58: string; functionSelector: string; parameter?: string },
): Promise<{ ok: boolean; message?: string; energyUsed?: number }> {
  const r = await triggerConstantContract(network, args);
  const ok = r.result?.result === true;
  return { ok, message: decodeBroadcastMessage(r.result?.code || r.result?.message), energyUsed: r.energy_used };
}
