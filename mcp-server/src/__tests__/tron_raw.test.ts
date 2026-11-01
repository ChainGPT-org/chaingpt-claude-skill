/** Tron unsigned builders: the node-built bytes must match the request (fixtures are real mainnet transactions). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTransaction } from '../lib/tron.js';
import { assertTronTxMatches, decodeTronRaw } from '../lib/tron-raw.js';
import { sha256 } from 'viem';
import { tronToHex } from '../lib/tron-address.js';

const TRANSFER = {"txID": "d3d56d0f721ec3a6ccf771c849f6db30cf91ebbb2701339d706c37c1b214355b", "raw_data_hex": "0a0204ad220880acab38ae4e36e240b283f5be99345a68080112640a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412330a1541d5c4f926122f02bc7518b832fa4f71cde6849768121541c686c48436aec3a1dfce4ac5a4526c39366985ba18c4b7f50770b2c9bdbb9934"};
const T = { owner: 'TVTWtro2qVLEryGWZybCA5iPd3GokWYfCg', to: 'TU4vEruvZwLLkSfV9bNw12EJTPvNr7Pvaa', amountSun: 16604100n };
const TRIGGER = {"txID": "c85d92525a88b4bfb15327d9dff5361e18756ea507960218b312ab81bca6f420", "raw_data_hex": "0a0204c42208ad88ec9a6e4d338140b8e4d7e499345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541084168e63ce17202eb6d391ed85adf91f7943c09121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb000000000000000000000000c0897495fc9905702867bbc2afe093273fe3753b0000000000000000000000000000000000000000000000000000000005f5e10070b8acbebb99349001c0f4a46b"};
const G = { owner: 'TAirmLtL6VHmj31Wr5LPd8zM8877777777', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', callValueSun: 0n, dataHex: 'a9059cbb000000000000000000000000c0897495fc9905702867bbc2afe093273fe3753b0000000000000000000000000000000000000000000000000000000005f5e100', feeLimitSun: 225000000n };
const OTHER = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('Tron raw transaction verification', () => {
  it('accepts real node-built transfers and contract calls that match the request', () => {
    expect(() => assertTronTxMatches(TRANSFER, { kind: 'transfer', ...T })).not.toThrow();
    expect(() => assertTronTxMatches(TRIGGER, { kind: 'trigger', ...G })).not.toThrow();
    expect(decodeTronRaw(TRANSFER.raw_data_hex).contract.type).toBe(1);
    expect(decodeTronRaw(TRIGGER.raw_data_hex).contract.type).toBe(31);
  });

  it('refuses a transaction whose recipient, amount, call data or fee limit differ from the request', () => {
    expect(() => assertTronTxMatches(TRANSFER, { kind: 'transfer', ...T, to: OTHER })).toThrow(/recipient/);
    expect(() => assertTronTxMatches(TRANSFER, { kind: 'transfer', ...T, amountSun: T.amountSun + 1n })).toThrow(/amount/);
    expect(() => assertTronTxMatches(TRIGGER, { kind: 'trigger', ...G, dataHex: G.dataHex.slice(0, -2) + (G.dataHex.endsWith('01') ? '02' : '01') })).toThrow(/call data/);
    expect(() => assertTronTxMatches(TRIGGER, { kind: 'trigger', ...G, feeLimitSun: G.feeLimitSun + 1n })).toThrow(/fee limit/);
    expect(() => assertTronTxMatches(TRIGGER, { kind: 'transfer', ...T })).toThrow(/owner|contract type/);
  });

  it('refuses a txID that is not SHA256(raw_data_hex)', () => {
    expect(() => assertTronTxMatches({ ...TRANSFER, txID: '00'.repeat(32) }, { kind: 'transfer', ...T })).toThrow(/txID/);
  });
});

describe('createTransaction checks what the node built', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns a matching node response and refuses one built for another recipient', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ...TRANSFER, raw_data: {}, visible: true }), { status: 200 }));
    await expect(createTransaction('mainnet', { ownerBase58: T.owner, toBase58: T.to, amountSun: T.amountSun })).resolves.toMatchObject({ txID: TRANSFER.txID });
    await expect(createTransaction('mainnet', { ownerBase58: T.owner, toBase58: OTHER, amountSun: T.amountSun })).rejects.toThrow(/recipient/);
  });
});

// Minimal protobuf encoder to build hostile node responses (java-tron keeps the LAST copy of a scalar field).
const varint = (x: bigint) => { const out: number[] = []; do { let b = Number(x & 0x7fn); x >>= 7n; if (x) b |= 0x80; out.push(b); } while (x); return Buffer.from(out); };
const vf = (n: number, x: bigint) => Buffer.concat([varint(BigInt(n << 3)), varint(x)]);
const bf = (n: number, b: Buffer) => Buffer.concat([varint(BigInt((n << 3) | 2)), varint(BigInt(b.length)), b]);
const addr = (a: string) => Buffer.from(tronToHex(a), 'hex');
const tx = (paramFields: Buffer[], contractExtra: Buffer[] = [], type = 1n) => {
  const any = Buffer.concat([bf(1, Buffer.from('type.googleapis.com/protocol.TransferContract')), bf(2, Buffer.concat(paramFields))]);
  const contract = Buffer.concat([vf(1, type), bf(2, any), ...contractExtra]);
  const raw = Buffer.concat([bf(1, Buffer.from('abcd', 'hex')), vf(8, 1_700_000_060_000n), bf(11, contract), vf(14, 1_700_000_000_000n)]).toString('hex');
  return { raw_data_hex: raw, txID: sha256(`0x${raw}`).slice(2) };
};
const ok = [bf(1, addr(T.owner)), bf(2, addr(T.to)), vf(3, T.amountSun)];

describe('strict decoding refuses fields a hostile node could add', () => {
  it('accepts a clean hand-built transfer', () => {
    expect(() => assertTronTxMatches(tx(ok), { kind: 'transfer', ...T })).not.toThrow();
  });
  it('refuses a second recipient/amount appended to the parameter (java-tron would use the last one)', () => {
    expect(() => assertTronTxMatches(tx([...ok, bf(2, addr(OTHER)), vf(3, 999_999_999n)]), { kind: 'transfer', ...T })).toThrow(/duplicate field 2/);
  });
  it('refuses TRC-10 token fields on a contract call, a permission id, and a memo', () => {
    const trig = [bf(1, addr(G.owner)), bf(2, addr(G.contract)), bf(4, Buffer.from(G.dataHex, 'hex')), vf(5, 1_000_000n), vf(6, 1_001_393n)];
    expect(() => decodeTronRaw(tx(trig, [], 31n).raw_data_hex)).toThrow(/unexpected field 5/);
    expect(() => decodeTronRaw(tx(ok, [vf(5, 2n)]).raw_data_hex)).toThrow(/contract: unexpected field 5/);
    const memo = Buffer.concat([Buffer.from(tx(ok).raw_data_hex, 'hex'), bf(10, Buffer.from('hi'))]).toString('hex');
    expect(() => decodeTronRaw(memo)).toThrow(/raw_data: unexpected field 10/);
  });
  it('refuses a value field re-sent with a different wire type', () => {
    expect(() => decodeTronRaw(tx([...ok.slice(0, 2), bf(3, Buffer.from('00', 'hex'))]).raw_data_hex)).toThrow(/unexpected field 3 \(wire type 2\)/);
  });
});

