import { describe, it, expect } from 'vitest';
import {
  base58Encode,
  base58Decode,
  tronAddressFromEvm,
  tronToEvmAddress,
  tronToHex,
  base58ToHex21,
  isTronAddress,
  toEvmAddressParam,
  normalizeEvmAddress,
} from '../lib/tron-address.js';

// Golden vector from developers.tron.network/docs/account:
//   TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL
//   ⇄ hex21 418840E6C55B9ADA326D211D818C34A994AECED808
//   ⇄ evm   0x8840E6C55B9ADA326D211D818C34A994AECED808
const GOLDEN = {
  base58: 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
  hex21: '418840e6c55b9ada326d211d818c34a994aeced808',
  evm: '0x8840E6C55B9ADA326D211D818C34A994AECED808',
};

// A handful of VERIFIED mainnet TRC-20 contract addresses (see RESEARCH.md §6/§7).
const VERIFIED = [
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT
  'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', // WTRX
  'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9', // JST
  'TXF1xDbVGdxFGbovmmmXvBGu8ZiE3Lq4mR', // SunSwap V2 router
  'TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7', // JustLend Unitroller
];

describe('tron-address: golden vector', () => {
  it('evm → base58', () => {
    expect(tronAddressFromEvm(GOLDEN.evm)).toBe(GOLDEN.base58);
  });
  it('base58 → evm (case-normalized)', () => {
    expect(tronToEvmAddress(GOLDEN.base58)).toBe(`0x${GOLDEN.evm.slice(2).toLowerCase()}`);
  });
  it('base58 → 41-hex', () => {
    expect(tronToHex(GOLDEN.base58)).toBe(GOLDEN.hex21);
  });
  it('round-trips evm → base58 → evm', () => {
    const back = tronToEvmAddress(tronAddressFromEvm(GOLDEN.evm));
    expect(back).toBe(`0x${GOLDEN.evm.slice(2).toLowerCase()}`);
  });
});

describe('tron-address: base58 codec', () => {
  it('encode/decode round-trips arbitrary bytes incl. leading zeros', () => {
    const samples = [
      new Uint8Array([0, 0, 1, 2, 3]),
      new Uint8Array([255, 254, 0, 17]),
      new Uint8Array([0]),
    ];
    for (const s of samples) {
      expect([...base58Decode(base58Encode(s))]).toEqual([...s]);
    }
  });
  it('rejects an invalid base58 character', () => {
    expect(() => base58Decode('0OIl')).toThrow(/invalid base58/);
  });
});

describe('tron-address: validation', () => {
  it('accepts every verified mainnet address', () => {
    for (const a of VERIFIED) expect(isTronAddress(a)).toBe(true);
    expect(isTronAddress(GOLDEN.base58)).toBe(true);
  });
  it('rejects a one-character-mutated address (checksum)', () => {
    // flip the final char of USDT to a different valid base58 char
    const usdt = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const mutated = usdt.slice(0, -1) + (usdt.endsWith('t') ? 'u' : 't');
    expect(isTronAddress(mutated)).toBe(false);
    expect(() => base58ToHex21(mutated)).toThrow(/checksum/);
  });
  it('rejects non-Tron / malformed inputs', () => {
    expect(isTronAddress('0x8840E6C55B9ADA326D211D818C34A994AECED808')).toBe(false);
    expect(isTronAddress('NPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL')).toBe(false); // no T
    expect(isTronAddress('')).toBe(false);
    expect(isTronAddress(null)).toBe(false);
    expect(isTronAddress(12345)).toBe(false);
  });
  it('normalizeEvmAddress strips 0x + lowercases, rejects junk', () => {
    expect(normalizeEvmAddress(GOLDEN.evm)).toBe(GOLDEN.evm.slice(2).toLowerCase());
    expect(() => normalizeEvmAddress('0x1234')).toThrow();
  });
});

describe('tron-address: ABI param encoding', () => {
  it('toEvmAddressParam accepts base58 and 0x forms identically', () => {
    expect(toEvmAddressParam(GOLDEN.base58)).toBe(`0x${GOLDEN.evm.slice(2).toLowerCase()}`);
    expect(toEvmAddressParam(GOLDEN.evm)).toBe(`0x${GOLDEN.evm.slice(2).toLowerCase()}`);
  });
});
