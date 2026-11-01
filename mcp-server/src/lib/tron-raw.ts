// The Tron node builds the transaction bytes (protobuf) that the user then signs in TronLink. Before showing an
// unsigned tx, decode raw_data_hex and check it is exactly what was asked for: a wrong or hostile node must not
// be able to swap the recipient, amount, contract or calldata while echoing the request back in its JSON.
//
// Strict on purpose: java-tron keeps the LAST copy of a scalar field and merges repeated message fields, so
// any duplicate, unexpected field or unexpected wire type is refused rather than interpreted.
import { sha256 } from 'viem';
import { tronToHex } from './tron-address.js';

const VARINT = 0, BYTES = 2;
type Value = bigint | Uint8Array;

function readFields(buf: Uint8Array): Array<{ n: number; wt: number; v: Value }> {
  const out: Array<{ n: number; wt: number; v: Value }> = [];
  let i = 0;
  const varint = (): bigint => {
    let r = 0n, s = 0n;
    for (;;) {
      if (i >= buf.length || s > 63n) throw new Error('malformed varint');
      const b = buf[i++];
      r |= BigInt(b & 0x7f) << s;
      if (!(b & 0x80)) return r;
      s += 7n;
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const n = key >> 3, wt = key & 7;
    if (wt === VARINT) out.push({ n, wt, v: varint() });
    else if (wt === BYTES) {
      const len = Number(varint());
      if (i + len > buf.length) throw new Error('truncated field');
      out.push({ n, wt, v: buf.subarray(i, i + len) });
      i += len;
    } else throw new Error(`unexpected wire type ${wt}`);
  }
  return out;
}

/** Decode one message, allowing only the listed field numbers (with their wire type), each at most once. */
function strict(buf: Uint8Array, allowed: Record<number, number>, where: string, repeatable: number[] = []): Map<number, Value[]> {
  const m = new Map<number, Value[]>();
  for (const f of readFields(buf)) {
    if (allowed[f.n] !== f.wt) throw new Error(`${where}: unexpected field ${f.n} (wire type ${f.wt})`);
    const list = m.get(f.n) ?? [];
    if (list.length && !repeatable.includes(f.n)) throw new Error(`${where}: duplicate field ${f.n}`);
    list.push(f.v);
    m.set(f.n, list);
  }
  return m;
}

// Transaction.raw: ref_block_bytes 1, ref_block_num 3, ref_block_hash 4, expiration 8, contract 11, timestamp 14,
// fee_limit 18. Memo (10), auths (9) and scripts (12) are never produced by our requests and are refused.
const RAW = { 1: BYTES, 3: VARINT, 4: BYTES, 8: VARINT, 11: BYTES, 14: VARINT, 18: VARINT };
const CONTRACT = { 1: VARINT, 2: BYTES };          // type, parameter (Any). No Permission_id / provider.
const ANY = { 1: BYTES, 2: BYTES };                // type_url, value
const PARAMS: Record<number, Record<number, number>> = {
  1: { 1: BYTES, 2: BYTES, 3: VARINT },            // TransferContract: owner, to, amount
  31: { 1: BYTES, 2: BYTES, 3: VARINT, 4: BYTES }, // TriggerSmartContract: owner, contract, call_value, data (no TRC-10 token fields)
};

export interface TronRawContract { type: number; values: Map<number, Value> }

/** Decode Transaction.raw strictly: its single contract (type + parameter fields), fee_limit, expiry window. */
export function decodeTronRaw(rawDataHex: string): { contract: TronRawContract; feeLimit: bigint; expiration: bigint; timestamp: bigint } {
  const raw = strict(Uint8Array.from(Buffer.from(rawDataHex, 'hex')), RAW, 'raw_data', [11]);
  const contracts = raw.get(11) ?? [];
  if (contracts.length !== 1) throw new Error(`expected exactly one contract, got ${contracts.length}`);
  const c = strict(contracts[0] as Uint8Array, CONTRACT, 'contract');
  const type = Number((c.get(1)?.[0] as bigint | undefined) ?? 0n);
  if (!PARAMS[type]) throw new Error(`unsupported contract type ${type}`);
  const any = strict(c.get(2)?.[0] as Uint8Array ?? new Uint8Array(), ANY, 'parameter');
  const value = (any.get(2)?.[0] as Uint8Array | undefined) ?? new Uint8Array();
  const p = strict(value, PARAMS[type], `contract type ${type}`);
  const values = new Map([...p].map(([n, v]) => [n, v[0]] as const));
  const scalar = (n: number) => (raw.get(n)?.[0] as bigint | undefined) ?? 0n;
  return { contract: { type, values }, feeLimit: scalar(18), expiration: scalar(8), timestamp: scalar(14) };
}

export type TronIntent =
  | { kind: 'transfer'; owner: string; to: string; amountSun: bigint }
  | { kind: 'trigger'; owner: string; contract: string; callValueSun: bigint; dataHex: string; feeLimitSun: bigint };

const MAX_VALIDITY_MS = 24n * 3600n * 1000n;

/** Throws unless txID = SHA256(raw_data_hex) and the decoded contract matches the intent exactly. */
export function assertTronTxMatches(tx: { txID: string; raw_data_hex: string }, intent: TronIntent): void {
  if (sha256(`0x${tx.raw_data_hex}`).slice(2).toLowerCase() !== tx.txID.replace(/^0x/, '').toLowerCase()) {
    throw new Error('Tron node returned a txID that does not match its raw_data_hex; refusing to use it.');
  }
  const { contract, feeLimit, expiration, timestamp } = decodeTronRaw(tx.raw_data_hex);
  const v = contract.values;
  const hex = (n: number) => { const b = v.get(n); return b instanceof Uint8Array ? Buffer.from(b).toString('hex') : ''; };
  const num = (n: number) => { const x = v.get(n); return typeof x === 'bigint' ? x : 0n; }; // proto3 omits zero values
  const fail = (what: string) => { throw new Error(`Tron node built a transaction whose ${what} differs from the request; refusing to use it.`); };
  if (timestamp > 0n && expiration - timestamp > MAX_VALIDITY_MS) fail('expiration (more than 24h)');
  if (hex(1) !== tronToHex(intent.owner).toLowerCase()) fail('owner');
  if (intent.kind === 'transfer') {
    if (contract.type !== 1) fail('contract type');
    if (hex(2) !== tronToHex(intent.to).toLowerCase()) fail('recipient');
    if (num(3) !== intent.amountSun) fail('amount');
    if (feeLimit !== 0n) fail('fee limit');
  } else {
    if (contract.type !== 31) fail('contract type');
    if (hex(2) !== tronToHex(intent.contract).toLowerCase()) fail('contract address');
    if (num(3) !== intent.callValueSun) fail('call value');
    if (hex(4) !== intent.dataHex.replace(/^0x/, '').toLowerCase()) fail('call data');
    if (feeLimit !== intent.feeLimitSun) fail('fee limit');
  }
}
