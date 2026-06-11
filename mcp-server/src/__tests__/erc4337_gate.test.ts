import { describe, it, expect } from 'vitest';
import './_setup.js';
import { checkErc4337Gate, validatePolicyInput, type AgentPolicy } from '../lib/agent-policy.js';
import { POLICY_TEMPLATES } from '../lib/agent-policy-templates.js';

const SCW = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const BUNDLER = 'https://api.pimlico.io/v2/base-sepolia/rpc';

const base: AgentPolicy = {
  version: 1,
  killSwitch: false,
  erc4337: { enabled: true, allowedAccounts: [SCW], allowedBundlerHosts: ['api.pimlico.io'] },
};

const intent = (over: Partial<{ account: string; bundlerUrl: string }> = {}) => ({
  account: SCW,
  bundlerUrl: BUNDLER,
  ...over,
});

describe('checkErc4337Gate', () => {
  it('kill switch wins', () => {
    expect(checkErc4337Gate(intent(), { ...base, killSwitch: true }).allowed).toBe(false);
  });

  it('fails closed when erc4337 is absent, disabled, or string-"true" (migration guarantee)', () => {
    expect(checkErc4337Gate(intent(), { version: 1, killSwitch: false }).allowed).toBe(false);
    expect(checkErc4337Gate(intent(), { ...base, erc4337: { enabled: false } }).allowed).toBe(false);
    expect(checkErc4337Gate(intent(), { ...base, erc4337: { enabled: 'true' as unknown as boolean } }).allowed).toBe(false);
  });

  it('unrestricted does not bypass enabled, but bypasses the allowlists once enabled', () => {
    expect(checkErc4337Gate(intent(), { version: 1, killSwitch: false, unrestricted: true }).allowed).toBe(false);
    const yolo = { version: 1, killSwitch: false, unrestricted: true, erc4337: { enabled: true } } as AgentPolicy;
    expect(checkErc4337Gate(intent({ account: '0x9999999999999999999999999999999999999999' }), yolo).allowed).toBe(true);
  });

  it('account allowlist: undefined ⇒ any; [] ⇒ none; case-insensitive match', () => {
    const anyAcct = { ...base, erc4337: { enabled: true } };
    expect(checkErc4337Gate(intent({ account: '0x9999999999999999999999999999999999999999' }), anyAcct).allowed).toBe(true);
    const none = { ...base, erc4337: { enabled: true, allowedAccounts: [] } };
    expect(checkErc4337Gate(intent(), none).allowed).toBe(false);
    expect(checkErc4337Gate(intent({ account: SCW.toLowerCase() }), base).allowed).toBe(true);
    expect(checkErc4337Gate(intent({ account: '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb' }), base).allowed).toBe(false);
  });

  it('bundler: https enforced, host allowlist applied, malformed URL refused', () => {
    expect(checkErc4337Gate(intent({ bundlerUrl: 'http://api.pimlico.io/rpc' }), base).allowed).toBe(false);
    expect(checkErc4337Gate(intent({ bundlerUrl: 'https://evil.example.com/rpc' }), base).allowed).toBe(false);
    expect(checkErc4337Gate(intent({ bundlerUrl: 'not-a-url' }), base).allowed).toBe(false);
    expect(checkErc4337Gate(intent(), base).allowed).toBe(true);
  });

  it('validatePolicyInput accepts/rejects the erc4337 block correctly', () => {
    const ok = validatePolicyInput({ version: 1, killSwitch: false, erc4337: { enabled: true, allowedBundlerHosts: ['api.pimlico.io'] } });
    expect(ok.ok).toBe(true);
    expect(validatePolicyInput({ version: 1, killSwitch: false, erc4337: { allowedAccounts: [SCW] } }).ok).toBe(false); // missing enabled
    expect(validatePolicyInput({ version: 1, killSwitch: false, erc4337: { enabled: true, surprise: 1 } }).ok).toBe(false);
    expect(validatePolicyInput({ version: 1, killSwitch: false, erc4337: { enabled: true, allowedBundlerHosts: ['https://x.io'] } }).ok).toBe(false); // not bare hostname
  });

  it('every shipped template still validates with the new field present in defaults', () => {
    for (const t of POLICY_TEMPLATES) {
      const r = validatePolicyInput(t.policy);
      expect(r.ok, `${t.id}: ${r.error}`).toBe(true);
    }
  });
});
