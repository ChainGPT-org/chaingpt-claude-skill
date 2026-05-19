/**
 * Minimal ERC-20 read helpers — no viem dep for these calls so the dashboard
 * stays lightweight. Uses eth_call against the chain's public-RPC fallback chain.
 */

import { jsonRpcFallback } from './http.js';
import { rpcEndpoints } from './chains.js';

// Selectors
const SEL_BALANCE_OF = '0x70a08231';  // balanceOf(address)
const SEL_DECIMALS = '0x313ce567';     // decimals()
const SEL_SYMBOL = '0x95d89b41';       // symbol()
const SEL_NAME = '0x06fdde03';         // name()

function leftPad32(hexNoPrefix: string): string {
  return hexNoPrefix.padStart(64, '0');
}

function callData(selector: string, args: string[] = []): string {
  return selector + args.map(leftPad32).join('');
}

async function ethCall(chain: string, to: string, data: string): Promise<string> {
  const endpoints = rpcEndpoints(chain);
  if (endpoints.length === 0) throw new Error(`No RPC for ${chain}`);
  return await jsonRpcFallback<string>(endpoints, 'eth_call', [
    { to, data },
    'latest',
  ]);
}

function decodeUint256(hex: string): bigint {
  return BigInt(hex);
}

function decodeUint8(hex: string): number {
  return Number(BigInt(hex));
}

function decodeString(hex: string): string {
  // Handle both ABI-encoded dynamic strings and old-style bytes32-padded strings
  if (!hex || hex === '0x') return '';
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  // Old-style: 32-byte fixed value, trim trailing zeros and decode as utf8
  if (h.length === 64) {
    const trimmed = h.replace(/0+$/, '');
    if (trimmed.length % 2 !== 0) return Buffer.from(trimmed + '0', 'hex').toString('utf8').replace(/\0+$/, '');
    return Buffer.from(trimmed, 'hex').toString('utf8').replace(/\0+$/, '');
  }
  // Dynamic-string encoding: offset(32) + length(32) + data
  try {
    const lenHex = h.slice(64, 128);
    const len = Number(BigInt('0x' + lenHex));
    const dataHex = h.slice(128, 128 + len * 2);
    return Buffer.from(dataHex, 'hex').toString('utf8');
  } catch {
    return '';
  }
}

function isEmptyResponse(hex: string): boolean {
  return !hex || hex === '0x' || hex === '0x0';
}

export async function fetchErc20Balance(chain: string, token: string, holder: string): Promise<bigint> {
  const args = [holder.toLowerCase().replace(/^0x/, '')];
  const res = await ethCall(chain, token.toLowerCase(), callData(SEL_BALANCE_OF, args));
  if (isEmptyResponse(res)) return 0n;  // address has no contract code
  return decodeUint256(res);
}

export async function fetchErc20Decimals(chain: string, token: string): Promise<number> {
  const res = await ethCall(chain, token.toLowerCase(), SEL_DECIMALS);
  if (isEmptyResponse(res)) {
    throw new Error(`No contract code at ${token} on ${chain}, or the address does not implement ERC-20 decimals().`);
  }
  return decodeUint8(res);
}

export async function fetchErc20Symbol(chain: string, token: string): Promise<string> {
  const res = await ethCall(chain, token.toLowerCase(), SEL_SYMBOL);
  if (isEmptyResponse(res)) {
    throw new Error(`No contract code at ${token} on ${chain}, or the address does not implement ERC-20 symbol().`);
  }
  return decodeString(res);
}

export async function fetchErc20Name(chain: string, token: string): Promise<string> {
  const res = await ethCall(chain, token.toLowerCase(), SEL_NAME);
  return decodeString(res);
}

/** Convenience: fetch symbol + decimals together. Both needed when adding a tracked token. */
export async function fetchErc20Meta(chain: string, token: string): Promise<{ symbol: string; decimals: number }> {
  const [symbol, decimals] = await Promise.all([
    fetchErc20Symbol(chain, token),
    fetchErc20Decimals(chain, token),
  ]);
  return { symbol, decimals };
}

export function formatTokenAmount(raw: bigint, decimals: number, showDecimals = 4): string {
  const div = 10n ** BigInt(decimals);
  const whole = raw / div;
  const frac = raw % div;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, showDecimals);
  return `${whole}.${fracStr}`;
}
