import { describe, it, expect } from 'vitest';
import {
  TRON_TOKENS,
  TRON_DEFI,
  TRON_POISONED_ADDRESSES,
  resolveTronToken,
  assertNotPoisoned,
} from '../lib/tron-tokens.js';
import { isTronAddress } from '../lib/tron-address.js';

describe('tron-tokens: registry integrity', () => {
  it('every curated token has a checksum-valid Tron address', () => {
    for (const t of Object.values(TRON_TOKENS)) {
      expect(isTronAddress(t.address), `${t.symbol} ${t.address}`).toBe(true);
      expect(t.decimals).toBeGreaterThanOrEqual(0);
    }
  });

  it('decimals split is correct (USDT/USDC/WTRX = 6, rest = 18)', () => {
    expect(TRON_TOKENS.USDT.decimals).toBe(6);
    expect(TRON_TOKENS.USDC.decimals).toBe(6);
    expect(TRON_TOKENS.WTRX.decimals).toBe(6);
    expect(TRON_TOKENS.JST.decimals).toBe(18);
    expect(TRON_TOKENS.USDD.decimals).toBe(18);
    expect(TRON_TOKENS.STUSDT.decimals).toBe(18);
  });

  it('every DeFi contract address is a checksum-valid Tron address', () => {
    const addrs = [
      TRON_DEFI.sunswap.smartRouter,
      TRON_DEFI.sunswap.v2Router,
      TRON_DEFI.sunswap.v2Factory,
      TRON_DEFI.sunswap.v3Router,
      TRON_DEFI.sunswap.v3Factory,
      TRON_DEFI.sunswap.wtrx,
      TRON_DEFI.justlend.unitroller,
      ...Object.values(TRON_DEFI.justlend.markets).map((m) => m.jToken),
      ...Object.values(TRON_DEFI.justlend.markets).map((m) => m.underlying).filter((x): x is string => !!x),
    ];
    for (const a of addrs) expect(isTronAddress(a), a).toBe(true);
  });

  it('the V2 router is flagged deprecated', () => {
    expect(TRON_DEFI.sunswap.v2RouterDeprecated).toBe(true);
  });

  it('WTRX in tokens and in DeFi point to the same contract', () => {
    expect(TRON_TOKENS.WTRX.address).toBe(TRON_DEFI.sunswap.wtrx);
  });
});

describe('tron-tokens: poisoned-address safety', () => {
  it('poisoned addresses are valid-looking but blocked', () => {
    for (const a of TRON_POISONED_ADDRESSES) {
      expect(isTronAddress(a), a).toBe(true); // they look real — that is the danger
      expect(() => assertNotPoisoned(a)).toThrow(/blocked|deprecated|dead/i);
    }
  });
  it('no curated token collides with a poisoned address', () => {
    for (const t of Object.values(TRON_TOKENS)) {
      expect(TRON_POISONED_ADDRESSES.has(t.address)).toBe(false);
    }
  });
  it('resolveTronToken throws on a poisoned address', () => {
    const oldSun = 'TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9';
    expect(() => resolveTronToken(oldSun)).toThrow();
  });
});

describe('tron-tokens: resolveTronToken', () => {
  it('resolves by symbol (case-insensitive)', () => {
    expect(resolveTronToken('usdt')?.address).toBe(TRON_TOKENS.USDT.address);
    expect(resolveTronToken('USDT')?.symbol).toBe('USDT');
    expect(resolveTronToken('stUSDT')?.decimals).toBe(18);
  });
  it('resolves by curated address', () => {
    expect(resolveTronToken(TRON_TOKENS.JST.address)?.symbol).toBe('JST');
  });
  it('returns undefined for an unknown-but-valid address and for junk', () => {
    expect(resolveTronToken('TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL')).toBeUndefined();
    expect(resolveTronToken('not-an-address')).toBeUndefined();
    expect(resolveTronToken('')).toBeUndefined();
  });
});
