import { describe, it, expect } from 'vitest';
import './_setup.js';
import {
  checkSolanaPolicy,
  validatePolicyInput,
  type AgentPolicy,
  type SolanaTxIntent,
} from '../lib/agent-policy.js';
import { POLICY_TEMPLATES } from '../lib/agent-policy-templates.js';

const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SYS = '11111111111111111111111111111111';
const EVIL = 'EviLProgram1111111111111111111111111111111';

const base: AgentPolicy = {
  version: 1,
  killSwitch: false,
  solana: {
    enabled: true,
    allowedPrograms: [SYS, JUP],
    maxTxLamports: '100000000',
    maxDailySpendLamports: '300000000',
    maxDailyTxCount: 20,
    requireMemo: true,
  },
};

const okSim = { ok: true, lamportDelta: 1_000_000n };
const NO_SPEND = { totalWei: 0n, txCount: 0, ok: true };

function intent(over: Partial<SolanaTxIntent> = {}): SolanaTxIntent {
  return { programIds: [SYS], feePayer: 'agent', memo: 'test', sim: okSim, ...over };
}

describe('checkSolanaPolicy', () => {
  it('kill switch refuses everything', () => {
    const d = checkSolanaPolicy(intent(), { ...base, killSwitch: true }, NO_SPEND);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/kill switch/i);
  });

  it('fails closed when solana is absent or disabled (the migration guarantee)', () => {
    for (const p of [{ version: 1, killSwitch: false } as AgentPolicy, { ...base, solana: { enabled: false } }]) {
      const d = checkSolanaPolicy(intent(), p, NO_SPEND);
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/not enabled/i);
    }
  });

  it('unrestricted does NOT bypass solana.enabled, but bypasses per-tx checks once enabled', () => {
    const off = checkSolanaPolicy(intent(), { version: 1, killSwitch: false, unrestricted: true }, NO_SPEND);
    expect(off.allowed).toBe(false);
    const on = checkSolanaPolicy(
      intent({ programIds: [EVIL], memo: undefined, sim: { ok: false } }),
      { version: 1, killSwitch: false, unrestricted: true, solana: { enabled: true } },
      NO_SPEND
    );
    expect(on.allowed).toBe(true);
    const panic = checkSolanaPolicy(intent(), { version: 1, killSwitch: true, unrestricted: true, solana: { enabled: true } }, NO_SPEND);
    expect(panic.allowed).toBe(false);
  });

  it('blockedPrograms wins over allowedPrograms', () => {
    const p = { ...base, solana: { ...base.solana!, blockedPrograms: [JUP], allowedPrograms: [SYS, JUP] } };
    const d = checkSolanaPolicy(intent({ programIds: [SYS, JUP] }), p, NO_SPEND);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/blockedPrograms/);
  });

  it('allowedPrograms: undefined ⇒ any; [] ⇒ none; one off-list program among several ⇒ refuse', () => {
    const anyP = { ...base, solana: { ...base.solana!, allowedPrograms: undefined } };
    expect(checkSolanaPolicy(intent({ programIds: [EVIL] }), anyP, NO_SPEND).allowed).toBe(true);
    const noneP = { ...base, solana: { ...base.solana!, allowedPrograms: [] } };
    expect(checkSolanaPolicy(intent(), noneP, NO_SPEND).allowed).toBe(false);
    const d = checkSolanaPolicy(intent({ programIds: [SYS, EVIL] }), base, NO_SPEND);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain(EVIL);
  });

  it('maxTxLamports: sim unavailable ⇒ refuse (fail closed); over cap ⇒ refuse; at cap ⇒ allow', () => {
    const noSim = checkSolanaPolicy(intent({ sim: { ok: false } }), base, NO_SPEND);
    expect(noSim.allowed).toBe(false);
    expect(noSim.reason).toMatch(/could not be simulated/i);
    const over = checkSolanaPolicy(intent({ sim: { ok: true, lamportDelta: 100_000_001n } }), base, NO_SPEND);
    expect(over.allowed).toBe(false);
    const at = checkSolanaPolicy(intent({ sim: { ok: true, lamportDelta: 100_000_000n } }), base, NO_SPEND);
    expect(at.allowed).toBe(true);
  });

  it('velocity caps: missing/unreadable window refuses; spend-over refuses; count-over refuses', () => {
    expect(checkSolanaPolicy(intent(), base).allowed).toBe(false); // no spend window
    expect(checkSolanaPolicy(intent(), base, { totalWei: 0n, txCount: 0, ok: false }).allowed).toBe(false);
    const spendOver = checkSolanaPolicy(intent(), base, { totalWei: 299_500_000n, txCount: 3, ok: true });
    expect(spendOver.allowed).toBe(false);
    expect(spendOver.reason).toMatch(/Daily Solana spend cap/);
    const countOver = checkSolanaPolicy(intent(), base, { totalWei: 0n, txCount: 20, ok: true });
    expect(countOver.allowed).toBe(false);
    expect(countOver.reason).toMatch(/tx-count cap/);
  });

  it('requireMemo refuses memo-less intents', () => {
    const d = checkSolanaPolicy(intent({ memo: undefined }), base, NO_SPEND);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/memo/i);
  });
});

describe('policyDigest — nested canonicalization', () => {
  it('different solana sub-policies produce different digests', async () => {
    const { policyDigest } = await import('../lib/agent-policy.js');
    const a = { ...base };
    const b = { ...base, solana: { ...base.solana!, maxTxLamports: '999' } };
    expect(policyDigest(a)).not.toBe(policyDigest(b));
  });
});

describe('checkSolanaPolicy — type-strict enabled', () => {
  it('a hand-edited string "true" does NOT arm Solana', () => {
    const p = { version: 1, killSwitch: false, solana: { enabled: 'true' as unknown as boolean } } as AgentPolicy;
    expect(checkSolanaPolicy(intent(), p, NO_SPEND).allowed).toBe(false);
  });
});

describe('validatePolicyInput — solana sub-object', () => {
  const valid = {
    version: 1,
    killSwitch: false,
    solana: { enabled: true, allowedPrograms: [JUP], maxTxLamports: '1000', maxDailyTxCount: 5, requireMemo: true },
  };

  it('accepts a valid solana block', () => {
    const r = validatePolicyInput(valid);
    expect(r.ok).toBe(true);
    expect(r.policy?.solana?.enabled).toBe(true);
  });

  it('rejects bad base58, non-string lamports, unknown sub-field, missing enabled', () => {
    expect(validatePolicyInput({ ...valid, solana: { enabled: true, allowedPrograms: ['not-base58!'] } }).ok).toBe(false);
    expect(validatePolicyInput({ ...valid, solana: { enabled: true, maxTxLamports: 1000 } }).ok).toBe(false);
    expect(validatePolicyInput({ ...valid, solana: { enabled: true, surprise: 1 } }).ok).toBe(false);
    expect(validatePolicyInput({ ...valid, solana: { allowedPrograms: [JUP] } }).ok).toBe(false);
  });

  it('every shipped template (with a solana block) passes validation', () => {
    for (const t of POLICY_TEMPLATES) {
      const r = validatePolicyInput(t.policy);
      expect(r.ok, `${t.id}: ${r.error}`).toBe(true);
    }
  });
});
