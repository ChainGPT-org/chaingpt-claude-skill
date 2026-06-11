import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import './_setup.js';
process.env.CHAINGPT_DISABLE_KEYCHAIN = '1';
process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'super-long-passphrase-for-tests-only-1234';

const TMP = mkdtempSync(join(tmpdir(), 'cgpt-aa-sessions-test-'));
process.env.CHAINGPT_KEYSTORE_FILE = join(TMP, 'keystore.json');
process.env.CHAINGPT_AGENT_POLICY_FILE = join(TMP, 'policy.json');
process.env.CHAINGPT_ACTIVITY_FILE = join(TMP, 'activity.jsonl');
process.env.CHAINGPT_SESSIONS_FILE = join(TMP, 'sessions-4337.json');

import { aaSessionTools, handleAaSessionTool } from '../tools/aa_sessions.js';
import { agentWallet4337Tools, handleAgentWallet4337Tool } from '../tools/agent_wallet_4337.js';
import { aaTools, handleAaTool } from '../tools/aa.js';
import { initKeystore } from '../lib/agent-keystore.js';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SCW = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FUTURE = Math.floor(Date.now() / 1000) + 86_400;
const PID = `0x${'ab'.repeat(32)}`;

// Schema keys must never imply the plugin handles raw key material.
const FORBIDDEN = /sessionkey|session_key|privatekey|private_key|mnemonic|seedphrase|seed_phrase|passphrase/i;

let fetchCalls = 0;
const realFetch = globalThis.fetch;

beforeAll(() => {
  initKeystore();
  globalThis.fetch = ((..._a: Parameters<typeof fetch>) => {
    fetchCalls++;
    throw new Error('offline test attempted a network call');
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(TMP, { recursive: true, force: true });
});

describe('tool surface', () => {
  it('exposes the 3 session tools + the 4337 send + submit_userop', () => {
    expect(aaSessionTools.map((t) => t.name)).toEqual([
      'chaingpt_aa_session_build_grant',
      'chaingpt_aa_session_build_revoke',
      'chaingpt_aa_session_status',
    ]);
    expect(agentWallet4337Tools.map((t) => t.name)).toEqual(['chaingpt_agent_wallet_4337_sign_and_send']);
    expect(aaTools.map((t) => t.name)).toContain('chaingpt_aa_submit_userop');
  });

  it('custody invariant: no schema key suggests raw key handling', () => {
    for (const t of [...aaSessionTools, ...agentWallet4337Tools]) {
      for (const key of Object.keys((t.inputSchema as any).properties ?? {})) {
        expect(key).not.toMatch(FORBIDDEN);
      }
    }
  });
});

describe('build_grant (offline, moduleInstalled passed explicitly)', () => {
  it('emits permissionId + execute-wrapped calldata + the owner recipe, and caches the record', async () => {
    const r = await handleAaSessionTool('chaingpt_aa_session_build_grant', {
      chain: 'base',
      account: SCW,
      tokenCaps: [{ token: USDC, cap: '100000000' }],
      validUntil: FUTURE,
      moduleInstalled: true,
    });
    const t = r.content[0].text;
    expect(t).toContain('Permission id:      0x');
    expect(t).toContain('account callData');
    expect(t).toMatch(/0xe9ae5c53/); // execute(single) selector
    expect(t).toContain('chaingpt_aa_submit_userop');
    expect(t).toContain('never the agent key');
    const status = await handleAaSessionTool('chaingpt_aa_session_status', {});
    expect(status.content[0].text).toMatch(/Need chain|Session status|Cached grants/);
  });

  it('embeds installModule when moduleInstalled=false', async () => {
    const r = await handleAaSessionTool('chaingpt_aa_session_build_grant', {
      chain: 'base',
      account: SCW,
      tokenCaps: [{ token: USDC, cap: '5000000' }],
      validUntil: FUTURE,
      moduleInstalled: false,
      salt: `0x${'22'.repeat(32)}`,
    });
    const { toFunctionSelector } = await import('viem');
    const sel = toFunctionSelector('function installModule(uint256,address,bytes)').slice(2);
    expect(r.content[0].text).toContain(sel);
  });

  it('refuses unbounded grants and zero caps (builder guards)', async () => {
    await expect(handleAaSessionTool('chaingpt_aa_session_build_grant', {
      chain: 'base', account: SCW, tokenCaps: [{ token: USDC, cap: '1' }], validUntil: 0, moduleInstalled: true,
    })).rejects.toThrow(/validUntil/);
    await expect(handleAaSessionTool('chaingpt_aa_session_build_grant', {
      chain: 'base', account: SCW, tokenCaps: [{ token: USDC, cap: '0' }], validUntil: FUTURE, moduleInstalled: true,
    })).rejects.toThrow(/> 0/);
  });
});

describe('build_revoke', () => {
  it('emits removeSession calldata; validates permissionId shape', async () => {
    const ok = await handleAaSessionTool('chaingpt_aa_session_build_revoke', { chain: 'base', account: SCW, permissionId: PID });
    expect(ok.content[0].text).toContain('chain-level kill');
    const bad = await handleAaSessionTool('chaingpt_aa_session_build_revoke', { chain: 'base', account: SCW, permissionId: '0x1234' });
    expect(bad.content[0].text).toMatch(/bytes32/);
  });
});

describe('chaingpt_aa_submit_userop custody gate', () => {
  const baseOp = {
    sender: SCW, nonce: '0x0', callData: '0x', callGasLimit: '0x1', verificationGasLimit: '0x1',
    preVerificationGas: '0x1', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1',
  };
  it('refuses an empty signature without touching the network', async () => {
    const before = fetchCalls;
    const r = await handleAaTool('chaingpt_aa_submit_userop', { bundlerUrl: 'https://bundler.example', userOp: { ...baseOp, signature: '0x' } });
    expect(r.content[0].text).toMatch(/signature is empty|Refused/i);
    expect(fetchCalls).toBe(before);
  });
});

describe('4337 sign_and_send refusal paths (offline)', () => {
  it('erc4337 gate disabled → ⛔ pre-RPC (zero network calls)', async () => {
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({ version: 1, killSwitch: false }));
    const before = fetchCalls;
    const r = await handleAgentWallet4337Tool('chaingpt_agent_wallet_4337_sign_and_send', {
      chain: 'base', account: SCW, permissionId: PID, target: USDC, bundlerUrl: 'https://bundler.example', memo: 't',
    });
    expect(r.content[0].text).toContain('⛔');
    expect(r.content[0].text).toMatch(/not enabled/i);
    expect(fetchCalls).toBe(before);
  });

  it('bundler host outside the allowlist → ⛔ pre-RPC', async () => {
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({
      version: 1, killSwitch: false, erc4337: { enabled: true, allowedBundlerHosts: ['api.pimlico.io'] },
    }));
    const before = fetchCalls;
    const r = await handleAgentWallet4337Tool('chaingpt_agent_wallet_4337_sign_and_send', {
      chain: 'base', account: SCW, permissionId: PID, target: USDC, bundlerUrl: 'https://evil.example/rpc', memo: 't',
    });
    expect(r.content[0].text).toMatch(/not in erc4337.allowedBundlerHosts/);
    expect(fetchCalls).toBe(before);
  });

  it('malformed permissionId refused before anything else', async () => {
    writeFileSync(process.env.CHAINGPT_AGENT_POLICY_FILE!, JSON.stringify({ version: 1, killSwitch: false, erc4337: { enabled: true } }));
    const r = await handleAgentWallet4337Tool('chaingpt_agent_wallet_4337_sign_and_send', {
      chain: 'base', account: SCW, permissionId: '0xnope', target: USDC, bundlerUrl: 'https://b.example', memo: 't',
    });
    expect(r.content[0].text).toMatch(/bytes32/);
  });
});
