import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

import './_setup.js';
process.env.CHAINGPT_DISABLE_KEYCHAIN = '1';
process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'super-long-passphrase-for-tests-only-1234';

const TMP = mkdtempSync(join(tmpdir(), 'chaingpt-aws-solana-test-'));
process.env.CHAINGPT_SOLANA_KEYSTORE_FILE = join(TMP, 'solana-keystore.json');
process.env.CHAINGPT_AGENT_POLICY_FILE = join(TMP, 'policy.json');
process.env.CHAINGPT_ACTIVITY_FILE = join(TMP, 'activity.jsonl');

import { agentWalletSolanaTools, handleAgentWalletSolanaTool } from '../tools/agent_wallet_solana.js';
import { initSolanaKeystore } from '../lib/agent-keystore-solana.js';

const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';

function unsignedTx(payer: Keypair, to: Keypair): string {
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to.publicKey, lamports: 1000 }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

let fetchCalls = 0;
const realFetch = globalThis.fetch;

beforeAll(() => {
  // Any RPC attempt in these offline tests is a bug — count and fail loudly.
  globalThis.fetch = ((...a: Parameters<typeof fetch>) => {
    fetchCalls++;
    throw new Error('offline test attempted a network call');
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(TMP, { recursive: true, force: true });
});

describe('agent wallet solana — tool surface', () => {
  it('exposes exactly the 3 expected tools, none of which writes the policy', () => {
    const names = agentWalletSolanaTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_agent_wallet_solana_init',
      'chaingpt_agent_wallet_solana_address',
      'chaingpt_agent_wallet_solana_sign_and_send',
    ]);
    for (const t of agentWalletSolanaTools) {
      expect(t.name).not.toMatch(/policy|unlock|export|set_/);
    }
  });
});

describe('agent wallet solana — sign_and_send handler (offline)', () => {
  it('missing keystore → init hint', async () => {
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', { txBase64: 'aaaa' });
    expect(r.content[0].text).toContain('chaingpt_agent_wallet_solana_init');
  });

  it('init works and refuses overwrite via the handler', async () => {
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_init', {});
    expect(r.content[0].text).toContain('Agent Solana wallet created');
    await expect(handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_init', {})).rejects.toThrow(/already exists/);
  });

  it('malformed base64 → friendly refusal', async () => {
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', { txBase64: 'not-a-tx', memo: 't' });
    expect(r.content[0].text).toMatch(/Could not parse txBase64/);
  });

  it('foreign fee payer → refused before any RPC', async () => {
    const stranger = Keypair.generate();
    const before = fetchCalls;
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', {
      txBase64: unsignedTx(stranger, Keypair.generate()),
      memo: 't',
    });
    expect(r.content[0].text).toMatch(/fee payer .* is not the agent wallet/);
    expect(fetchCalls).toBe(before);
  });

  it('kill switch → ⛔ refusal block without touching RPC', async () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({ version: 1, killSwitch: true, solana: { enabled: true } })
    );
    // build a tx whose fee payer IS the agent so the structural checks pass
    const { readSolanaKeystoreFile, loadSolanaKeypair } = await import('../lib/agent-keystore-solana.js');
    void readSolanaKeystoreFile;
    const agent = loadSolanaKeypair();
    const before = fetchCalls;
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', {
      txBase64: unsignedTx(agent, Keypair.generate()),
      memo: 't',
    });
    expect(r.content[0].text).toContain('⛔ Policy refused');
    expect(r.content[0].text).toMatch(/kill switch/i);
    expect(fetchCalls).toBe(before);
  });

  it('solana not enabled → fail-closed refusal without RPC', async () => {
    writeFileSync(
      process.env.CHAINGPT_AGENT_POLICY_FILE!,
      JSON.stringify({ version: 1, killSwitch: false }) // no solana block at all
    );
    const { loadSolanaKeypair } = await import('../lib/agent-keystore-solana.js');
    const agent = loadSolanaKeypair();
    const before = fetchCalls;
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', {
      txBase64: unsignedTx(agent, Keypair.generate()),
      memo: 't',
    });
    expect(r.content[0].text).toMatch(/not enabled/i);
    expect(fetchCalls).toBe(before);
  });
});
