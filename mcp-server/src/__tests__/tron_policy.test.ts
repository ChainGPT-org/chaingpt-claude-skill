import { describe, it, expect } from 'vitest';
import { checkTronPolicy, type AgentPolicy, type TronTxIntent } from '../lib/agent-policy.js';

const ROUTER = 'TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const RANDOM = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL';

function basePolicy(over: Partial<AgentPolicy> = {}): AgentPolicy {
  return {
    version: 1,
    killSwitch: false,
    tron: {
      enabled: true,
      allowedContracts: [ROUTER, USDT],
      maxTxSun: '100000000',
      maxDailySpendSun: '300000000',
      maxDailyTxCount: 20,
      maxFeeLimitSun: '150000000',
      requireMemo: true,
    },
    ...over,
  };
}

function intent(over: Partial<TronTxIntent> = {}): TronTxIntent {
  return {
    owner: RANDOM,
    to: USDT,
    valueSun: 0n,
    feeLimitSun: 100000000n,
    memo: 'test',
    ...over,
  };
}

const okSpend = { totalWei: 0n, txCount: 0, ok: true };

describe('checkTronPolicy: fail-closed gating', () => {
  it('refuses when tron sub-policy is absent (predates Tron support)', () => {
    const p = basePolicy({ tron: undefined });
    expect(checkTronPolicy(intent(), p, okSpend).allowed).toBe(false);
  });
  it('refuses when tron.enabled is not strictly true', () => {
    expect(checkTronPolicy(intent(), basePolicy({ tron: { enabled: false } }), okSpend).allowed).toBe(false);
    // hand-edited truthy-but-not-true must NOT arm the chain
    expect(checkTronPolicy(intent(), basePolicy({ tron: { enabled: 1 as unknown as boolean } }), okSpend).allowed).toBe(false);
  });
  it('kill switch wins over everything', () => {
    expect(checkTronPolicy(intent(), basePolicy({ killSwitch: true }), okSpend).allowed).toBe(false);
  });
  it('unrestricted allows — but still requires tron.enabled', () => {
    expect(checkTronPolicy(intent(), basePolicy({ unrestricted: true }), okSpend).allowed).toBe(true);
    const off = checkTronPolicy(intent(), basePolicy({ unrestricted: true, tron: { enabled: false } }), okSpend);
    expect(off.allowed).toBe(false);
  });
});

describe('checkTronPolicy: allow/block lists', () => {
  it('refuses a destination not in allowedContracts', () => {
    const r = checkTronPolicy(intent({ to: RANDOM }), basePolicy(), okSpend);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not in tron.allowedContracts/);
  });
  it('explicit empty allowedContracts permits nothing', () => {
    const p = basePolicy();
    p.tron!.allowedContracts = [];
    expect(checkTronPolicy(intent(), p, okSpend).allowed).toBe(false);
  });
  it('undefined allowedContracts permits any destination', () => {
    const p = basePolicy();
    delete p.tron!.allowedContracts;
    expect(checkTronPolicy(intent({ to: RANDOM }), p, okSpend).allowed).toBe(true);
  });
  it('blockedContracts wins over allowedContracts', () => {
    const p = basePolicy();
    p.tron!.blockedContracts = [USDT];
    expect(checkTronPolicy(intent({ to: USDT }), p, okSpend).allowed).toBe(false);
  });
});

describe('checkTronPolicy: value + fee caps', () => {
  it('refuses value over maxTxSun', () => {
    expect(checkTronPolicy(intent({ valueSun: 100000001n }), basePolicy(), okSpend).allowed).toBe(false);
    expect(checkTronPolicy(intent({ valueSun: 100000000n }), basePolicy(), okSpend).allowed).toBe(true);
  });
  it('refuses fee_limit over maxFeeLimitSun', () => {
    expect(checkTronPolicy(intent({ feeLimitSun: 150000001n }), basePolicy(), okSpend).allowed).toBe(false);
  });
});

describe('checkTronPolicy: velocity caps (fail closed)', () => {
  it('refuses when a velocity cap is set but no spend window provided', () => {
    expect(checkTronPolicy(intent(), basePolicy(), undefined).allowed).toBe(false);
  });
  it('refuses when the ledger could not be read (ok=false)', () => {
    expect(checkTronPolicy(intent(), basePolicy(), { totalWei: 0n, txCount: 0, ok: false }).allowed).toBe(false);
  });
  it('refuses when daily spend would be exceeded', () => {
    const spend = { totalWei: 250000000n, txCount: 1, ok: true };
    expect(checkTronPolicy(intent({ valueSun: 100000000n }), basePolicy(), spend).allowed).toBe(false);
  });
  it('refuses when daily tx-count would be exceeded', () => {
    const spend = { totalWei: 0n, txCount: 20, ok: true };
    expect(checkTronPolicy(intent(), basePolicy(), spend).allowed).toBe(false);
  });
});

describe('checkTronPolicy: memo + happy path', () => {
  it('refuses when requireMemo and no memo', () => {
    expect(checkTronPolicy(intent({ memo: undefined }), basePolicy(), okSpend).allowed).toBe(false);
  });
  it('allows a fully compliant intent', () => {
    const r = checkTronPolicy(intent(), basePolicy(), okSpend);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('OK');
  });
});
