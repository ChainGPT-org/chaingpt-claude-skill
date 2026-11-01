// The Tron node builds the transaction bytes (protobuf) that the user then signs in TronLink. Before showing an
// unsigned tx, decode raw_data_hex and check it is exactly what was asked for: a wrong or hostile node must not
// be able to swap the recipient, amount, contract or calldata while echoing the request back in its JSON.
import { sha256 } from 'viem';
import { tronToHex } from './tron-address.js';

type Field = { n: number; v: bigint | Uint8Array };

function fields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = (): bigint => {
    let r = 0n, s = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error('truncated varint');
      const b = buf[i++];
      r |= BigInt(b & 0x7f) << s;
      if (!(b & 0x80)) return r;
      s += 7n;
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const n = key >> 3, wt = key & 7;
    if (wt === 0) out.push({ n, v: varint() });
    else if (wt === 2) {
      const len = Number(varint());
      if (i + len > buf.length) throw new Error('truncated field');
      out.push({ n, v: buf.subarray(i, i + len) });
      i += len;
    } else if (wt === 1) i += 8;
    else if (wt === 5) i += 4;
    else throw new Error(`unsupported wire type ${wt}`);
  }
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const one = (fs: Field[], n: number) => fs.find(f => f.n === n)?.v;

export interface TronRawContract { type: number; values: Map<number, bigint | Uint8Array> }

/** Decode Transaction.raw: its single contract (type + parameter fields) and fee_limit. */
export function decodeTronRaw(rawDataHex: string): { contract: TronRawContract; feeLimit: bigint } {
  const raw = fields(Uint8Array.from(Buffer.from(rawDataHex, 'hex')));
  const contracts = raw.filter(f => f.n === 11);
  if (contracts.length !== 1) throw new Error(`expected exactly one contract, got ${contracts.length}`);
  const c = fields(contracts[0].v as Uint8Array);
  const any = fields(one(c, 2) as Uint8Array);
  const value = one(any, 2) as Uint8Array | undefined;
  const values = new Map((value ? fields(value) : []).map(f => [f.n, f.v] as const));
  return { contract: { type: Number(one(c, 1) ?? 0n), values }, feeLimit: (one(raw, 18) as bigint | undefined) ?? 0n };
}

export type TronIntent =
  | { kind: 'transfer'; owner: string; to: string; amountSun: bigint }
  | { kind: 'trigger'; owner: string; contract: string; callValueSun: bigint; dataHex: string; feeLimitSun: bigint };

/** Throws unless txID = SHA256(raw_data_hex) and the decoded contract matches the intent exactly. */
export function assertTronTxMatches(tx: { txID: string; raw_data_hex: string }, intent: TronIntent): void {
  if (sha256(`0x${tx.raw_data_hex}`).slice(2).toLowerCase() !== tx.txID.replace(/^0x/, '').toLowerCase()) {
    throw new Error('Tron node returned a txID that does not match its raw_data_hex; refusing to use it.');
  }
  const { contract, feeLimit } = decodeTronRaw(tx.raw_data_hex);
  const v = contract.values;
  const addr = (n: number) => { const b = v.get(n); return b instanceof Uint8Array ? hex(b) : ''; };
  const num = (n: number) => { const x = v.get(n); return typeof x === 'bigint' ? x : 0n; };
  const fail = (what: string) => { throw new Error(`Tron node built a transaction whose ${what} differs from the request; refusing to use it.`); };
  if (addr(1) !== tronToHex(intent.owner).toLowerCase()) fail('owner');
  if (intent.kind === 'transfer') {
    if (contract.type !== 1) fail('contract type');
    if (addr(2) !== tronToHex(intent.to).toLowerCase()) fail('recipient');
    if (num(3) !== intent.amountSun) fail('amount');
  } else {
    if (contract.type !== 31) fail('contract type');
    if (addr(2) !== tronToHex(intent.contract).toLowerCase()) fail('contract address');
    if (num(3) !== intent.callValueSun) fail('call value');
    const data = v.get(4);
    if (!(data instanceof Uint8Array) || hex(data) !== intent.dataHex.replace(/^0x/, '').toLowerCase()) fail('call data');
    if (feeLimit !== intent.feeLimitSun) fail('fee limit');
  }
}
