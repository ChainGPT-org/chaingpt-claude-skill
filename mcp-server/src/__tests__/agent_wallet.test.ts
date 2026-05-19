/**
 * Agent wallet tests — keystore round-trip + policy gate + tool surface.
 *
 * Uses a tmp keystore + policy file path via env vars to avoid touching
 * the user's real ~/.chaingpt-mcp/agent-wallet/ during tests.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CHAINGPT_API_KEY = 'test-key';
process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'super-long-passphrase-for-tests-only-1234';

const TMP = mkdtempSync(join(tmpdir(), 'chaingpt-agent-wallet-test-'));
process.env.CHAINGPT_KEYSTORE_FILE = join(TMP, 'keystore.json');
process.env.CHAINGPT_AGENT_POLICY_FILE = join(TMP, 'policy.json');

import { agentWalletTools, handleAgentWalletTool, _stopUiForTests } from '../tools/agent_wallet.js';
import { initKeystore, loadAccount, isKeystoreInitialized } from '../lib/agent-keystore.js';
import { checkPolicy, loadPolicy, type TxIntent } from '../lib/agent-policy.js';
import { rmSync as rmS } from 'node:fs';

function resetState() {
  try { rmS(process.env.CHAINGPT_KEYSTORE_FILE!, { force: true }); } catch {}
  try { rmS(process.env.CHAINGPT_AGENT_POLICY_FILE!, { force: true }); } catch {}
}

afterAll(() => {
  _stopUiForTests();
  rmSync(TMP, { recursive: true, force: true });
});

describe('Agent wallet tool definitions', () => {
  it('exposes 7 agent-wallet tools', () => {
    expect(agentWalletTools.map((t) => t.name)).toEqual([
      'chaingpt_agent_wallet_init',
      'chaingpt_agent_wallet_address',
      'chaingpt_agent_wallet_status',
      'chaingpt_agent_wallet_balances',
      'chaingpt_agent_wallet_policy',
      'chaingpt_agent_wallet_sign_and_send',
      'chaingpt_agent_wallet_serve_ui',
    ]);
  });

  it('no agent-wallet tool exposes a "set policy" or "unlock" surface', () => {
    // Hard test of the threat model: the agent must NEVER have a tool that
    // can modify the policy or read the passphrase. If a future change adds
    // one, this test will catch it.
    for (const t of agentWalletTools) {
      expect(t.name).not.toMatch(/set.*policy|unlock|reveal|export.*key|disable.*killswitch/i);
    }
  });
});

describe('Keystore', () => {
  beforeEach(() => resetState());

  it('init creates an encrypted keystore + readable address', async () => {
    expect(isKeystoreInitialized()).toBe(false);
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    const t = r.content[0].text;
    expect(t).toContain('initialized');
    expect(t).toMatch(/0x[0-9a-fA-F]{40}/);
    expect(isKeystoreInitialized()).toBe(true);
  });

  it('init refuses to overwrite an existing keystore', async () => {
    await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    expect(r.content[0].text).toContain('already exists');
  });

  it('address tool returns the public address without needing decryption', async () => {
    await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_address', {});
    expect(r.content[0].text).toMatch(/Agent wallet address: 0x[0-9a-fA-F]{40}/);
  });

  it('round-trip: init + loadAccount yields a matching address', () => {
    resetState();
    const { address } = initKeystore();
    const account = loadAccount();
    expect(account.address.toLowerCase()).toBe(address.toLowerCase());
  });

  it('loadAccount with wrong passphrase fails', () => {
    resetState();
    initKeystore();
    const old = process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE;
    process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'wrong-passphrase-but-still-long-enough';
    expect(() => loadAccount()).toThrow(/decrypt failed/i);
    process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = old;
  });

  it('init refuses passphrase shorter than 16 chars', () => {
    resetState();
    const old = process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE;
    process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'short';
    expect(() => initKeystore()).toThrow(/at least 16/i);
    process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = old;
  });
});

describe('Policy gate', () => {
  beforeEach(() => resetState());

  const intent: TxIntent = {
    chainId: 8453,  // Base
    to: '0x1111111111111111111111111111111111111111',
    value: 10n ** 16n,  // 0.01 ETH
    data: '0x',
  };

  it('default policy (killSwitch=true) refuses every tx', () => {
    const policy = loadPolicy();
    expect(policy.killSwitch).toBe(true);
    const decision = checkPolicy(intent, policy);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/kill switch/i);
  });

  it('allows when killSwitch off and intent matches', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({ version: 1, killSwitch: false, allowedChains: [8453] }),
    );
    const decision = checkPolicy(intent, loadPolicy());
    expect(decision.allowed).toBe(true);
  });

  it('refuses when chain not in allowedChains', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({ version: 1, killSwitch: false, allowedChains: [1] }), // only Ethereum
    );
    const decision = checkPolicy(intent, loadPolicy()); // intent is on Base (8453)
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/Chain 8453/);
  });

  it('refuses when to-address not in allowedToAddresses', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({
        version: 1,
        killSwitch: false,
        allowedToAddresses: ['0x2222222222222222222222222222222222222222'],
      }),
    );
    const decision = checkPolicy(intent, loadPolicy());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not in allowedToAddresses/);
  });

  it('blockedToAddresses wins over allowedToAddresses', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({
        version: 1,
        killSwitch: false,
        allowedToAddresses: [intent.to],
        blockedToAddresses: [intent.to],
      }),
    );
    const decision = checkPolicy(intent, loadPolicy());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/blockedToAddresses/);
  });

  it('refuses when value exceeds maxTxValueWei', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({
        version: 1,
        killSwitch: false,
        maxTxValueWei: '1000000000000000', // 0.001 ETH
      }),
    );
    const decision = checkPolicy(intent, loadPolicy()); // intent value is 0.01 ETH
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/exceeds maxTxValueWei/);
  });

  it('refuses when function selector is blocked', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({
        version: 1,
        killSwitch: false,
        blockedSelectors: ['0xa9059cbb'], // ERC-20 transfer
      }),
    );
    const decision = checkPolicy(
      { ...intent, data: '0xa9059cbb000000000000000000000000aaaa' },
      loadPolicy(),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/Function selector/);
  });

  it('refuses when memo required but missing', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({ version: 1, killSwitch: false, requireMemo: true }),
    );
    const decision = checkPolicy(intent, loadPolicy());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/memo/i);
  });

  it('allows when memo required and provided', () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({ version: 1, killSwitch: false, requireMemo: true }),
    );
    const decision = checkPolicy({ ...intent, memo: 'auto-rebalance run 42' }, loadPolicy());
    expect(decision.allowed).toBe(true);
  });
});

describe('sign_and_send end-to-end gate', () => {
  beforeEach(() => resetState());

  it('refuses when wallet not initialized', async () => {
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_sign_and_send', {
      chain: 'base',
      to: '0x1111111111111111111111111111111111111111',
      valueWei: '100',
    });
    expect(r.content[0].text).toContain('not initialized');
  });

  it('refuses with policy reason when killSwitch is on (default)', async () => {
    await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_sign_and_send', {
      chain: 'base',
      to: '0x1111111111111111111111111111111111111111',
      valueWei: '100',
    });
    expect(r.content[0].text).toContain('Policy refused');
    expect(r.content[0].text).toMatch(/kill switch/i);
  });

  it('refuses for unknown chain even after wallet init', async () => {
    await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({ version: 1, killSwitch: false }));
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_sign_and_send', {
      chain: 'nonsense-chain',
      to: '0x1111111111111111111111111111111111111111',
    });
    expect(r.content[0].text).toContain('Unknown or non-EVM chain');
  });

  it('refuses for malformed to-address', async () => {
    await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({ version: 1, killSwitch: false }));
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_sign_and_send', {
      chain: 'base',
      to: 'not-an-address',
    });
    expect(r.content[0].text).toContain('Invalid to-address');
  });

  it('status surfaces policy state + passphrase env state', async () => {
    await handleAgentWalletTool('chaingpt_agent_wallet_init', {});
    const r = await handleAgentWalletTool('chaingpt_agent_wallet_status', {});
    const t = r.content[0].text;
    expect(t).toContain('Agent wallet status');
    expect(t).toContain('Policy digest');
    expect(t).toContain('Kill switch:     ON');
    expect(t).toContain('Passphrase env:  set');
  });
});
