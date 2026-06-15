import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tronTools, handleTronTool, _internal } from '../tools/tron.js';
import { agentWalletTronTools, handleAgentWalletTronTool } from '../tools/agent_wallet_tron.js';
import { initKeystore } from '../lib/agent-keystore.js';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const RECIP = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL';

let dir: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cgpt-tron-'));
  process.env.CHAINGPT_KEYSTORE_FILE = join(dir, 'keystore.json');
  process.env.CHAINGPT_AGENT_POLICY_FILE = join(dir, 'policy.json');
  process.env.CHAINGPT_ACTIVITY_FILE = join(dir, 'activity.jsonl');
  process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'test-passphrase-1234567890';
  delete process.env.TRON_RPC_URL;
  fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('network blocked in test'));
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.CHAINGPT_KEYSTORE_FILE;
  delete process.env.CHAINGPT_AGENT_POLICY_FILE;
  delete process.env.CHAINGPT_ACTIVITY_FILE;
  delete process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE;
  rmSync(dir, { recursive: true, force: true });
});

describe('tron tools: registration', () => {
  it('exposes the expected read/build tools, all chaingpt_tron-prefixed with schemas', () => {
    expect(tronTools.length).toBeGreaterThanOrEqual(12);
    for (const t of tronTools) {
      expect(t.name.startsWith('chaingpt_tron')).toBe(true);
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toBeTruthy();
    }
    const names = tronTools.map((t) => t.name);
    expect(names).toContain('chaingpt_tron_build_transfer_tx');
    expect(names).toContain('chaingpt_tron_lend_justlend_build_tx');
  });
  it('agent-wallet tron tools have no _init (reuses EVM keystore) but has address + sign_and_send', () => {
    const names = agentWalletTronTools.map((t) => t.name);
    expect(names).toEqual(['chaingpt_agent_wallet_tron_address', 'chaingpt_agent_wallet_tron_sign_and_send']);
  });
});

describe('tron tools: offline unit helpers', () => {
  it('parseUnits/formatUnits round-trip with decimals', () => {
    expect(_internal.parseUnits('12.5', 6)).toBe(12_500_000n);
    expect(_internal.formatUnits(12_500_000n, 6)).toBe('12.5');
    expect(() => _internal.parseUnits('1.1234567', 6)).toThrow();
    expect(_internal.formatUnits(1_000_000n, 6)).toBe('1');
  });
  it('swapLeg maps TRX → WTRX (native) and symbols → addresses', () => {
    expect(_internal.swapLeg('TRX').isNative).toBe(true);
    expect(_internal.swapLeg('USDT').address).toBe(USDT);
    expect(_internal.swapLeg('USDT').isNative).toBe(false);
  });
});

describe('tron tools: validate_address is offline', () => {
  it('validates a good address and rejects junk without any network call', async () => {
    const ok = await handleTronTool('chaingpt_tron_validate_address', { address: USDT });
    expect(ok.content[0].text).toMatch(/Valid Tron address/);
    const bad = await handleTronTool('chaingpt_tron_validate_address', { address: '0xdeadbeef' });
    expect(bad.content[0].text).toMatch(/not a valid/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('tron tools: mainnet-ack gate makes ZERO network calls', () => {
  it('build_transfer_tx refuses mainnet without acknowledgeMainnet and never hits the network', async () => {
    const r = await handleTronTool('chaingpt_tron_build_transfer_tx', { from: RECIP, to: USDT, amountTrx: '1', network: 'mainnet' });
    expect(r.content[0].text).toMatch(/acknowledgeMainnet/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('build_trc20_transfer_tx refuses mainnet without acknowledgeMainnet and never hits the network', async () => {
    const r = await handleTronTool('chaingpt_tron_build_trc20_transfer_tx', { from: RECIP, token: 'USDT', to: USDT, amount: '1', network: 'mainnet' });
    expect(r.content[0].text).toMatch(/acknowledgeMainnet/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('agent-wallet tron: policy refusal paths make ZERO network calls', () => {
  it('refuses sign_and_send when tron is not enabled in policy — no network', async () => {
    initKeystore();
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({ version: 1, killSwitch: false, tron: { enabled: false } }));
    const r = await handleAgentWalletTronTool('chaingpt_agent_wallet_tron_sign_and_send', { kind: 'trx_transfer', to: RECIP, amount: '1', network: 'mainnet' });
    expect(r.content[0].text).toMatch(/not enabled|Policy refused/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('kill switch refuses sign_and_send — no network', async () => {
    initKeystore();
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({ version: 1, killSwitch: true, tron: { enabled: true } }));
    const r = await handleAgentWalletTronTool('chaingpt_agent_wallet_tron_sign_and_send', { kind: 'trx_transfer', to: RECIP, amount: '1', network: 'mainnet' });
    expect(r.content[0].text).toMatch(/kill switch/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('refuses a non-TronGrid host for autonomous signing — no network', async () => {
    initKeystore();
    process.env.TRON_RPC_URL = 'https://evil.example.com';
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({ version: 1, killSwitch: false, tron: { enabled: true, requireMemo: false } }));
    const r = await handleAgentWalletTronTool('chaingpt_agent_wallet_tron_sign_and_send', { kind: 'trx_transfer', to: RECIP, amount: '1', network: 'mainnet', memo: 'x' });
    expect(r.content[0].text).toMatch(/first-party TronGrid/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
