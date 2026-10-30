import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { withSigningLock, reserveOperation, saveReservation, findOperation, readReservations, operationFingerprint, journalDir } from '../lib/signing-journal.js';
import { checkAssetLimits, evmAssetSpends } from '../lib/asset-policy.js';
import { spendStats, logActivity } from '../lib/agent-activity.js';
import { loadPolicy, validatePolicyInput, checkPolicy, type AgentPolicy } from '../lib/agent-policy.js';

const root = mkdtempSync(join(tmpdir(), 'signing-safety-'));
const activity = join(root, 'activity.jsonl');
const policyFile = join(root, 'policy.json');
const token = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const policy: AgentPolicy = { version: 1, killSwitch: false, assetLimits: [{ chain: 'base', asset: token, allowedRecipients: [recipient], maxTxAmount: '100', maxDailyAmount: '150' }] };
const base = { operationId: 'order:1', fingerprint: 'fp', chainClass: 'evm', valueWei: '70', assets: [{ asset: `base:${token}`, recipient, amount: '90' }] };
beforeEach(() => {
  rmSync(root, { recursive: true, force: true }); mkdirSync(root);
  process.env.CHAINGPT_ACTIVITY_FILE = activity;
  process.env.CHAINGPT_AGENT_POLICY_FILE = policyFile;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('durable signing reservations', () => {
  it('refuses overlapping signing across independently acquired filesystem locks', async () => {
    let release!: () => void;
    const first = withSigningLock(activity, () => new Promise<void>(r => { release = r; }));
    await expect(withSigningLock(activity, async () => {})).rejects.toThrow(/busy/);
    release(); await first;
    await expect(withSigningLock(activity, async () => 1)).resolves.toBe(1);
  });
  it('reserves before any broadcast and retains uncertain operations beyond 24h', () => {
    const r = reserveOperation(activity, base);
    saveReservation(activity, { ...r, ts: '2000-01-01T00:00:00Z', state: 'prepared' });
    expect(spendStats(24, 'evm')).toEqual({ totalWei: 70n, txCount: 1, ok: true });
    expect(findOperation(activity, 'order:1', 'fp')?.state).toBe('prepared');
    expect(() => reserveOperation(activity, base)).toThrow(/already/);
    expect(() => findOperation(activity, 'order:1', 'changed')).toThrow(/different/);
  });
  it('counts a known broadcast once even when the display ledger records it too', () => {
    const r = reserveOperation(activity, base);
    saveReservation(activity, { ...r, hash: 'hash', state: 'broadcast' });
    logActivity({ ts: r.ts, chain: 'base', chainId: 8453, from: token, to: recipient, valueWei: '5', hash: 'hash', policyDigest: 'x' });
    expect(spendStats(24, 'evm').totalWei).toBe(70n);
  });
  it('ages out only confirmed reservations, never pending ones', () => {
    const r = reserveOperation(activity, base);
    saveReservation(activity, { ...r, state: 'confirmed', ts: '2000-01-01T00:00:00Z' });
    expect(spendStats(24, 'evm').txCount).toBe(0);
  });
  it('fails closed on corrupt safety or legacy ledgers', () => {
    mkdirSync(journalDir(activity)); writeFileSync(join(journalDir(activity), 'broken.json'), '{}');
    expect(spendStats(24, 'evm').ok).toBe(false);
    rmSync(journalDir(activity), { recursive: true }); writeFileSync(activity, '{broken');
    expect(spendStats(24, 'evm').ok).toBe(false);
  });
  it('does not authorize a send when a reservation cannot be persisted', () => {
    writeFileSync(journalDir(activity), 'not a directory');
    expect(() => reserveOperation(activity, base)).toThrow();
  });
  it('requires a valid stable operation id and fingerprints JSON canonically', () => {
    expect(() => findOperation(activity, undefined as any, 'fp')).toThrow(/operationId/);
    expect(operationFingerprint({ a: 1, b: { z: 2, y: 3 } })).toBe(operationFingerprint({ b: { y: 3, z: 2 }, a: 1 }));
  });
});
describe('asset and policy fences', () => {
  const abi = parseAbi(['function transfer(address to,uint256 amount)', 'function approve(address spender,uint256 amount)']);
  const transfer = (amount: bigint) => encodeFunctionData({ abi, functionName: 'transfer', args: [recipient, amount] });
  it('meters token transfers that carry zero native value', () => {
    const assets = evmAssetSpends('base', token, transfer(90n), 0n, policy);
    checkAssetLimits('base', assets, policy, activity);
    reserveOperation(activity, { ...base, assets });
    expect(() => checkAssetLimits('base', assets, policy, activity)).toThrow(/limit exceeded/);
  });
  it('refuses unknown token recipients and amounts over the per-tx cap', () => {
    expect(() => checkAssetLimits('base', [{ ...base.assets[0], recipient: token }], policy, activity)).toThrow(/not explicitly/);
    expect(() => checkAssetLimits('base', [{ ...base.assets[0], amount: '101' }], policy, activity)).toThrow(/limit/);
  });
  it('refuses opaque protocol calldata and unlimited approvals', () => {
    expect(() => evmAssetSpends('base', token, '0xdeadbeef', 0n, policy)).toThrow(/opaque/);
    const data = encodeFunctionData({ abi, functionName: 'approve', args: [recipient, (1n << 256n) - 1n] });
    expect(() => evmAssetSpends('base', token, data, 0n, policy)).toThrow(/Unlimited/);
  });
  it('starts disabled and rejects string booleans or malformed monetary limits on disk', () => {
    expect(loadPolicy().killSwitch).toBe(true);
    for (const extra of [{ unrestricted: 'false' }, { maxTxValueWei: '-1' }, { version: 2 }]) {
      writeFileSync(policyFile, JSON.stringify({ version: 1, killSwitch: false, ...extra }));
      expect(loadPolicy().killSwitch).toBe(true);
    }
  });
  it('does not bypass checks for truthy non-boolean unrestricted values', () => {
    const r = checkPolicy({ chainId: 1, to: token, value: 1n, data: '0x' }, { version: 1, killSwitch: false, unrestricted: 'false' as any, maxTxValueWei: '0' });
    expect(r.allowed).toBe(false);
  });
  it('rejects invalid asset policy shapes', () => {
    expect(validatePolicyInput({ ...policy, assetLimits: [{ ...policy.assetLimits![0], allowedRecipients: [] }] }).ok).toBe(false);
    expect(validatePolicyInput({ ...policy, assetLimits: [...policy.assetLimits!, ...policy.assetLimits!] }).ok).toBe(false);
  });
});

describe('Tron fee reserves', () => {
  it('includes current bandwidth and account activation prices, plus the energy cap', async () => {
    const { tronFeeReserve } = await import('../lib/tron-fee-budget.js');
    const { isTrustedTronHost } = await import('../lib/tron.js');
    const previous = process.env.TRON_RPC_URL;
    try {
      for (const url of ['http://api.trongrid.io', 'https://api.shasta.trongrid.io', 'https://user:pass@api.trongrid.io', 'https://api.trongrid.io:8443']) { process.env.TRON_RPC_URL = url; expect(isTrustedTronHost('mainnet')).toBe(false); }
      process.env.TRON_RPC_URL = 'https://api.trongrid.io'; expect(isTrustedTronHost('mainnet')).toBe(true);
    } finally { if (previous === undefined) delete process.env.TRON_RPC_URL; else process.env.TRON_RPC_URL = previous; }
    const prices = { chainParameter: [{ key: 'getTransactionFee', value: 1000 }, { key: 'getCreateAccountFee', value: 100000 }, { key: 'getCreateNewAccountFeeInSystemContract', value: 1000000 }] };
    expect(tronFeeReserve('ab'.repeat(100), 2000n, true, prices)).toBe(1458000n);
    expect(() => tronFeeReserve('ab', 0n, false, {})).toThrow(/unavailable/);
    expect(() => tronFeeReserve('ab'.repeat(5000), 0n, false, prices)).toThrow(/size/);
  });
});
