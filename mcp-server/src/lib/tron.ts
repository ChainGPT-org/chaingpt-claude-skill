/**
 * TronGrid / full-node HTTP client. Custody-free: this module never holds a
 * key. It builds UNSIGNED transactions (the node does the protobuf encoding),
 * reads accounts/contracts, and broadcasts already-signed transactions. The
 * signer lives in tron-sign.ts.
 *
 * Networks: mainnet (api.trongrid.io) + Shasta/Nile testnets. Override the host
 * with TRON_RPC_URL; supply a TronGrid key via TRON_PRO_API_KEY (mainnet keyless
 * is throttled). See docs/tron/RESEARCH.md §5.
 */

import { httpJson } from './http.js';

export type TronNetwork = 'mainnet' | 'shasta' | 'nile';

const HOSTS: Record<TronNetwork, string> = {
  mainnet: 'https://api.trongrid.io',
  shasta: 'https://api.shasta.trongrid.io',
  nile: 'https://nile.trongrid.io',
};

/** Hosts we consider first-party/trusted for autonomous (agent-wallet) signing. */
export const TRUSTED_TRON_HOSTS = ['api.trongrid.io', 'api.shasta.trongrid.io', 'nile.trongrid.io'];

export function isTronMainnet(network: TronNetwork | undefined): boolean {
  return (network ?? 'mainnet') === 'mainnet';
}

/** Resolve the base host for a network. TRON_RPC_URL overrides for all networks. */
export function tronHost(network: TronNetwork = 'mainnet'): string {
  const override = process.env.TRON_RPC_URL?.trim();
  return (override || HOSTS[network]).replace(/\/+$/, '');
}

/** True when the active host is a first-party TronGrid host (or no override is set). */
export function isTrustedTronHost(network: TronNetwork = 'mainnet'): boolean {
  const override = process.env.TRON_RPC_URL?.trim();
  if (!override) return true;
  try {
    return TRUSTED_TRON_HOSTS.includes(new URL(override).hostname);
  } catch {
    return false;
  }
}

function tronHeaders(): Record<string, string> {
  const key = process.env.TRON_PRO_API_KEY?.trim();
  return key ? { 'TRON-PRO-API-KEY': key } : {};
}

/**
 * Convert a SUN bigint to the int64 the Tron HTTP API expects, refusing values
 * that would lose precision as a JS number (> ~9e15 SUN ≈ 9B TRX, unrealistic
 * for an agent) instead of silently truncating.
 */
function toApiAmount(sun: bigint): number {
  if (sun < 0n) throw new Error('amount cannot be negative');
  if (sun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`amount ${sun} SUN exceeds the Tron HTTP API safe integer range (${Number.MAX_SAFE_INTEGER}); split the transaction.`);
  }
  return Number(sun);
}

/** Low-level POST to a `/wallet/...` (or `/walletsolidity/...`) endpoint. */
export async function walletPost<T = any>(network: TronNetwork, path: string, body: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  const url = `${tronHost(network)}${path}`;
  return httpJson<T>(url, { method: 'POST', body, headers: tronHeaders(), timeoutMs });
}

// ── Reads ────────────────────────────────────────────────────────────

export interface TronAccount {
  /** TRX balance in SUN. Absent for a never-activated account. */
  balance?: number;
  address?: string;
  create_time?: number;
  account_resource?: Record<string, unknown>;
  assetV2?: Array<{ key: string; value: number }>;
  [k: string]: unknown;
}

/** getaccount — TRX balance (SUN) + TRC-10 holdings + resources. Empty object ⇒ unactivated. */
export async function getAccount(network: TronNetwork, addressBase58: string): Promise<TronAccount> {
  return walletPost<TronAccount>(network, '/wallet/getaccount', { address: addressBase58, visible: true });
}

export interface TronAccountResource {
  freeNetUsed?: number;
  freeNetLimit?: number;
  NetUsed?: number;
  NetLimit?: number;
  EnergyUsed?: number;
  EnergyLimit?: number;
  [k: string]: unknown;
}

export async function getAccountResource(network: TronNetwork, addressBase58: string): Promise<TronAccountResource> {
  return walletPost<TronAccountResource>(network, '/wallet/getaccountresource', { address: addressBase58, visible: true });
}

export interface ConstantContractResult {
  result?: { result?: boolean; code?: string; message?: string };
  constant_result?: string[];
  energy_used?: number;
  transaction?: unknown;
  [k: string]: unknown;
}

/**
 * triggerconstantcontract — read-only contract call (balanceOf/decimals/symbol)
 * and the pre-broadcast revert check. `parameter` is the ABI-encoded args WITHOUT
 * the 4-byte selector (hex, no 0x). Never signs, never broadcasts.
 */
export async function triggerConstantContract(
  network: TronNetwork,
  args: { ownerBase58: string; contractBase58: string; functionSelector: string; parameter?: string },
): Promise<ConstantContractResult> {
  return walletPost<ConstantContractResult>(network, '/wallet/triggerconstantcontract', {
    owner_address: args.ownerBase58,
    contract_address: args.contractBase58,
    function_selector: args.functionSelector,
    parameter: args.parameter ?? '',
    visible: true,
  });
}

export interface TronTxInfo {
  id?: string;
  fee?: number;
  blockNumber?: number;
  blockTimeStamp?: number;
  contractResult?: string[];
  receipt?: { result?: string; energy_usage?: number; energy_fee?: number; net_usage?: number; [k: string]: unknown };
  log?: unknown[];
  [k: string]: unknown;
}

export async function getTransactionInfoById(network: TronNetwork, txId: string): Promise<TronTxInfo> {
  return walletPost<TronTxInfo>(network, '/wallet/gettransactioninfobyid', { value: txId.replace(/^0x/, '') });
}

export async function getNowBlock(network: TronNetwork): Promise<any> {
  return walletPost<any>(network, '/wallet/getnowblock', {});
}

// ── Builds (return UNSIGNED txs) ─────────────────────────────────────

export interface UnsignedTronTx {
  txID: string;
  raw_data: any;
  raw_data_hex: string;
  visible?: boolean;
  signature?: string[];
  [k: string]: unknown;
}

/** createtransaction — build an unsigned native TRX transfer (amount in SUN). */
export async function createTransaction(
  network: TronNetwork,
  args: { ownerBase58: string; toBase58: string; amountSun: bigint },
): Promise<UnsignedTronTx> {
  const res = await walletPost<UnsignedTronTx & { Error?: string }>(network, '/wallet/createtransaction', {
    owner_address: args.ownerBase58,
    to_address: args.toBase58,
    amount: toApiAmount(args.amountSun),
    visible: true,
  });
  if ((res as any).Error) throw new Error(`Tron createtransaction failed: ${(res as any).Error}`);
  if (!res.raw_data_hex || !res.txID) throw new Error(`Tron createtransaction returned no transaction (recipient activation issue?): ${JSON.stringify(res).slice(0, 200)}`);
  return res;
}

/**
 * triggersmartcontract — build an unsigned contract-call tx. `parameter` is the
 * ABI-encoded args without the selector (hex, no 0x). Returns the node response
 * whose `.transaction` is the unsigned tx to sign.
 */
export async function triggerSmartContract(
  network: TronNetwork,
  args: {
    ownerBase58: string;
    contractBase58: string;
    functionSelector: string;
    parameter?: string;
    feeLimitSun: bigint;
    callValueSun?: bigint;
  },
): Promise<{ result?: { result?: boolean; code?: string; message?: string }; transaction?: UnsignedTronTx; [k: string]: unknown }> {
  const res = await walletPost<any>(network, '/wallet/triggersmartcontract', {
    owner_address: args.ownerBase58,
    contract_address: args.contractBase58,
    function_selector: args.functionSelector,
    parameter: args.parameter ?? '',
    fee_limit: toApiAmount(args.feeLimitSun),
    call_value: toApiAmount(args.callValueSun ?? 0n),
    visible: true,
  });
  return res;
}

/** broadcasttransaction — submit a signed tx. HTTP is 200 even on failure; check `result`/`code`. */
export interface BroadcastResult {
  result?: boolean;
  txid?: string;
  code?: string;
  message?: string;
  [k: string]: unknown;
}
export async function broadcastTransaction(network: TronNetwork, signedTx: UnsignedTronTx): Promise<BroadcastResult> {
  return walletPost<BroadcastResult>(network, '/wallet/broadcasttransaction', signedTx as unknown as Record<string, unknown>);
}

/** Decode a possibly-hex (`message` field is hex) broadcast error to text. */
export function decodeBroadcastMessage(msg: string | undefined): string {
  if (!msg) return '';
  if (/^[0-9a-fA-F]+$/.test(msg) && msg.length % 2 === 0) {
    try {
      return Buffer.from(msg, 'hex').toString('utf8');
    } catch {
      return msg;
    }
  }
  return msg;
}
