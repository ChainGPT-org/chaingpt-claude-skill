/**
 * Tron address utilities. Pure + offline (no network, no key material).
 *
 * A Tron account is controlled by the SAME secp256k1 key as an Ethereum EOA;
 * only the address ENCODING differs (see docs/tron/RESEARCH.md §1-2):
 *
 *   - evm20:   the trailing 20 bytes = keccak256(pubkey)[-20:]  (what the TVM
 *              `address` type and ABI parameters hold — identical to the ETH EOA)
 *   - hex21:   0x41 ‖ evm20                                     (21 bytes; 0x41 = mainnet prefix)
 *   - base58:  Base58( hex21 ‖ SHA256(SHA256(hex21))[0:4] )     → 34 chars, always "T…"
 *
 * Consequence: the agent's existing EVM keystore address maps to its Tron
 * address by `tronAddressFromEvm(account.address)` — no separate key, ever.
 *
 * Hashing uses viem's `sha256` (a direct dependency). Base58 is hand-rolled
 * (BigInt) so we add no new dependency; it is covered by golden-vector tests.
 */

import { sha256 } from 'viem';

/** Bitcoin/Tron Base58 alphabet (no 0 O I l). */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TRON_MAINNET_PREFIX = 0x41;

/** A base58 Tron address: leading 'T', 34 chars total. (Structural only — call isTronAddress for checksum.) */
const TRON_BASE58_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
/** EVM 20-byte address, with or without 0x. */
const EVM_ADDR_RE = /^(0x)?[0-9a-fA-F]{40}$/;

// ── byte helpers ─────────────────────────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex at byte ${i}`);
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Double-SHA256, returning the first 4 bytes (the Base58Check checksum). */
function checksum4(payload: Uint8Array): Uint8Array {
  const once = hexToBytes(sha256(payload)); // viem sha256 → 0x-hex
  const twice = hexToBytes(sha256(once));
  return twice.slice(0, 4);
}

// ── base58 ───────────────────────────────────────────────────────────
export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    out = B58_ALPHABET[rem] + out;
  }
  return '1'.repeat(zeros) + out;
}

export function base58Decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  let num = 0n;
  for (const ch of str) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base58 character "${ch}"`);
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num = num / 256n;
  }
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros++;
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...bytes]);
}

// ── conversions ──────────────────────────────────────────────────────
/** Normalize an EVM address to its 20-byte form (no 0x, lowercase). Throws if malformed. */
export function normalizeEvmAddress(evm: string): string {
  if (typeof evm !== 'string' || !EVM_ADDR_RE.test(evm.trim())) {
    throw new Error(`not a 20-byte EVM address: "${evm}"`);
  }
  return evm.trim().replace(/^0x/, '').toLowerCase();
}

/** EVM 20-byte address → 21-byte Tron payload (0x41 ‖ evm20). */
export function evmToHex21(evm: string): Uint8Array {
  const evm20 = hexToBytes(normalizeEvmAddress(evm));
  return concatBytes(new Uint8Array([TRON_MAINNET_PREFIX]), evm20);
}

/** 21-byte Tron payload → base58check "T…" address. */
export function hex21ToBase58(hex21: Uint8Array): string {
  if (hex21.length !== 21) throw new Error(`Tron payload must be 21 bytes, got ${hex21.length}`);
  if (hex21[0] !== TRON_MAINNET_PREFIX) throw new Error(`Tron payload must start with 0x41, got 0x${hex21[0].toString(16)}`);
  return base58Encode(concatBytes(hex21, checksum4(hex21)));
}

/** EVM address (0x… 20-byte) → base58 Tron "T…" address. */
export function tronAddressFromEvm(evm: string): string {
  return hex21ToBase58(evmToHex21(evm));
}

/**
 * base58 "T…" address → 21-byte payload. Verifies the double-SHA256 checksum;
 * throws on a bad checksum or malformed input. This is the trust boundary for
 * any user-supplied Tron address.
 */
export function base58ToHex21(addr: string): Uint8Array {
  if (typeof addr !== 'string' || !TRON_BASE58_RE.test(addr)) {
    throw new Error(`not a Tron base58 address (expected "T" + 33 base58 chars): "${addr}"`);
  }
  const decoded = base58Decode(addr);
  if (decoded.length !== 25) throw new Error(`Tron address decodes to ${decoded.length} bytes, expected 25`);
  const payload = decoded.slice(0, 21);
  const check = decoded.slice(21);
  const expected = checksum4(payload);
  for (let i = 0; i < 4; i++) {
    if (check[i] !== expected[i]) throw new Error(`Tron address checksum mismatch for "${addr}"`);
  }
  if (payload[0] !== TRON_MAINNET_PREFIX) throw new Error(`Tron address is not mainnet (prefix 0x${payload[0].toString(16)})`);
  return payload;
}

/** base58 "T…" address → "41…"-prefixed 21-byte hex (for HTTP API visible:false fields). */
export function tronToHex(addr: string): string {
  return bytesToHex(base58ToHex21(addr));
}

/** base58 "T…" address → 0x-prefixed 20-byte EVM address (for ABI params / GoPlus / DexScreener). */
export function tronToEvmAddress(addr: string): `0x${string}` {
  return `0x${bytesToHex(base58ToHex21(addr).slice(1))}`;
}

/** Is this a structurally + checksum valid base58 Tron address? Never throws. */
export function isTronAddress(addr: unknown): addr is string {
  if (typeof addr !== 'string' || !TRON_BASE58_RE.test(addr)) return false;
  try {
    base58ToHex21(addr);
    return true;
  } catch {
    return false;
  }
}

/**
 * The 0x-prefixed 20-byte EVM form of a Tron address, accepting EITHER a
 * base58 "T…" or an already-EVM "0x…" input. Used when encoding a Tron
 * address into an ABI parameter (the TVM `address` type is the 20-byte form).
 */
export function toEvmAddressParam(addr: string): `0x${string}` {
  if (isTronAddress(addr)) return tronToEvmAddress(addr);
  return `0x${normalizeEvmAddress(addr)}`;
}

/**
 * Normalize any of the three address forms to canonical base58 "T…":
 *   - base58 "T…"        → returned as-is (checksum-verified)
 *   - "41…" 21-byte hex  → encoded to base58 (the form the node returns when visible!=true)
 *   - "0x…" 20-byte EVM  → encoded to base58
 * Throws on anything else. Used to canonicalize addresses decoded from a node's
 * raw_data before policy checks and cross-checking.
 */
export function normalizeToBase58(addr: string): string {
  if (typeof addr !== 'string') throw new Error('address must be a string');
  const s = addr.trim();
  // Save to a plain boolean: using the type-predicate result directly would
  // narrow the else-branch of an already-string value to `never`.
  const looksTron = Boolean(isTronAddress(s));
  if (looksTron) return s;
  const hex = s.replace(/^0x/, '');
  if (/^41[0-9a-fA-F]{40}$/.test(hex)) return hex21ToBase58(hexToBytes(hex));
  if (/^[0-9a-fA-F]{40}$/.test(hex)) return tronAddressFromEvm(s);
  throw new Error(`cannot normalize to a Tron address: "${addr}"`);
}
