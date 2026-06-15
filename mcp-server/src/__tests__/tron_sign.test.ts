import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, toFunctionSelector } from 'viem';
import {
  encodeAddressParam,
  encodeUint256Param,
  decodeUint,
  decodeStringResult,
  computeTxId,
  verifyTxId,
  signTxId,
  signUnsignedTx,
  deriveTronAddress,
  decodeRawData,
} from '../lib/tron-sign.js';
import { tronAddressFromEvm, tronToEvmAddress } from '../lib/tron-address.js';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const RECIP = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL';
// Deterministic test key (privkey = 1). secp256k1 — same key form as EVM.
const account = privateKeyToAccount(`0x${'0'.repeat(63)}1`);

describe('tron-sign: ABI input encoding', () => {
  it('encodeAddressParam left-pads the 20-byte EVM form to 32 bytes', () => {
    const word = encodeAddressParam(USDT);
    expect(word).toHaveLength(64);
    expect(word.startsWith('0'.repeat(24))).toBe(true); // 12 leading zero bytes
    expect(word.endsWith(tronToEvmAddress(USDT).slice(2).toLowerCase())).toBe(true);
  });
  it('encodeUint256Param encodes amounts', () => {
    expect(encodeUint256Param(1_000_000n)).toBe('0'.repeat(59) + 'f4240');
    expect(encodeUint256Param(0n)).toBe('0'.repeat(64));
    expect(() => encodeUint256Param(-1n)).toThrow();
  });
  it('builds the canonical TRC-20 transfer calldata the agent-wallet cross-check expects', () => {
    expect(toFunctionSelector('transfer(address,uint256)')).toBe('0xa9059cbb');
    const expected = toFunctionSelector('transfer(address,uint256)').slice(2) + encodeAddressParam(USDT) + encodeUint256Param(1_000_000n);
    expect(expected).toMatch(/^a9059cbb/);
    expect(expected.length).toBe(8 + 64 + 64); // selector + address word + amount word
  });
});

describe('tron-sign: ABI output decoding', () => {
  it('decodeUint reads a uint256 result', () => {
    expect(decodeUint('0'.repeat(59) + 'f4240')).toBe(1_000_000n);
  });
  it('decodeStringResult reads an ABI string (symbol)', () => {
    // ABI-encode "USDT": offset(0x20) | length(4) | "USDT" right-padded
    const hex =
      '0'.repeat(62) + '20' +
      '0'.repeat(62) + '04' +
      Buffer.from('USDT').toString('hex').padEnd(64, '0');
    expect(decodeStringResult(hex)).toBe('USDT');
  });
});

describe('tron-sign: txID verification', () => {
  const rawDataHex = '0a02abcd2208deadbeefdeadbeef40c0843d5a65';
  it('computeTxId is SHA256(raw_data_hex) and verifyTxId round-trips', () => {
    const txID = computeTxId(rawDataHex);
    expect(txID).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTxId(rawDataHex, txID)).toBe(true);
    expect(verifyTxId(rawDataHex, '0x' + txID)).toBe(true);
  });
  it('rejects a mismatched txID', () => {
    expect(verifyTxId(rawDataHex, 'f'.repeat(64))).toBe(false);
  });
  it('signUnsignedTx refuses a tampered tx (txID != SHA256(raw_data_hex))', async () => {
    await expect(
      signUnsignedTx(account, { txID: 'a'.repeat(64), raw_data: {}, raw_data_hex: rawDataHex }),
    ).rejects.toThrow(/does not match SHA256/);
  });
});

describe('tron-sign: signing produces a recoverable r‖s‖recid signature', () => {
  it('signTxId recovers to the agent address (recid mapping correct)', async () => {
    const txID = computeTxId('0a0201020208aabbccdd40d0843d5a64');
    const sig = await signTxId(account, txID);
    expect(sig).toHaveLength(130);
    const recid = Number.parseInt(sig.slice(128, 130), 16);
    expect([0, 1]).toContain(recid);
    // Reconstruct the EVM-form signature (v = recid + 27) and recover.
    const evmSig = `0x${sig.slice(0, 128)}${(recid + 27).toString(16).padStart(2, '0')}` as `0x${string}`;
    const recovered = await recoverAddress({ hash: `0x${txID}`, signature: evmSig });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
  it('signUnsignedTx attaches a single signature when the txID matches', async () => {
    const raw_data_hex = '0a02f00d2208cafebabecafebabe40e0843d5a63';
    const txID = computeTxId(raw_data_hex);
    const signed = await signUnsignedTx(account, { txID, raw_data: {}, raw_data_hex });
    expect(signed.signature).toHaveLength(1);
    expect(signed.signature![0]).toMatch(/^[0-9a-f]{130}$/);
  });
});

describe('tron-sign: deriveTronAddress + decodeRawData', () => {
  it('derives the Tron address from the same EVM key', () => {
    expect(deriveTronAddress(account)).toBe(tronAddressFromEvm(account.address));
  });
  it('decodes a TransferContract raw_data (base58 visible form)', () => {
    const d = decodeRawData({
      contract: [{ type: 'TransferContract', parameter: { value: { owner_address: RECIP, to_address: USDT, amount: 1_000_000 } } }],
    });
    expect(d).toEqual({ contractType: 'TransferContract', ownerBase58: RECIP, toBase58: USDT, valueSun: 1_000_000n });
  });
  it('decodes a TriggerSmartContract raw_data with call_value', () => {
    const d = decodeRawData({
      contract: [{ type: 'TriggerSmartContract', parameter: { value: { owner_address: RECIP, contract_address: USDT, call_value: 5, data: 'a9059cbb' } } }],
    });
    expect(d.contractType).toBe('TriggerSmartContract');
    expect(d.toBase58).toBe(USDT);
    expect(d.valueSun).toBe(5n);
    expect(d.data).toBe('a9059cbb');
  });
  it('normalizes a 41-hex address form in raw_data', () => {
    const hex41 = '418840e6c55b9ada326d211d818c34a994aeced808'; // == RECIP
    const d = decodeRawData({
      contract: [{ type: 'TransferContract', parameter: { value: { owner_address: hex41, to_address: hex41, amount: 1 } } }],
    });
    expect(d.ownerBase58).toBe(RECIP);
  });
  it('rejects an unsupported contract type', () => {
    expect(() => decodeRawData({ contract: [{ type: 'VoteWitnessContract', parameter: { value: {} } }] })).toThrow(/unsupported/);
  });
});
