import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createWalletClient, createPublicClient, keccak256 } from 'viem';
import * as http from '../lib/http.js';
import * as sol from '../lib/solana-sign.js';
import * as key from '../lib/agent-keystore-solana.js';
import { base58Encode } from '../lib/tron-address.js';
import { handleAgentWalletTool } from '../tools/agent_wallet.js';
import { handleAgentWalletSolanaTool } from '../tools/agent_wallet_solana.js';
import { readReservations } from '../lib/signing-journal.js';
import { spendStats } from '../lib/agent-activity.js';

vi.mock('viem', async original => ({ ...await original<typeof import('viem')>(), createWalletClient: vi.fn(), createPublicClient: vi.fn() }));
vi.mock('../lib/agent-keystore.js', async original => ({ ...await original<typeof import('../lib/agent-keystore.js')>(), isKeystoreInitialized: () => true, loadAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }) }));
const root = mkdtempSync(join(tmpdir(), 'signer-regression-'));
const activity = join(root, 'activity.jsonl');
const policyFile = join(root, 'policy.json');
beforeEach(() => {
  vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); mkdirSync(root);
  process.env.CHAINGPT_ACTIVITY_FILE = activity; process.env.CHAINGPT_AGENT_POLICY_FILE = policyFile;
  process.env.CHAINGPT_DISABLE_KEYCHAIN = '1';
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('EVM uncertain sends', () => {
  it('signs once, freezes bytes across RPC fallback and retains an uncertain reservation', async () => {
    writeFileSync(policyFile, JSON.stringify({ version: 1, killSwitch: false, maxTxValueWei: '1000', maxDailySpendWei: '1000', maxDailyTxCount: 1 }));
    const prepare = vi.fn().mockResolvedValue({ nonce: 7, gas: 10n, maxFeePerGas: 2n, value: 5n });
    const sign = vi.fn().mockResolvedValue('0x0102');
    vi.mocked(createWalletClient).mockReturnValue({ prepareTransactionRequest: prepare, signTransaction: sign } as any);
    vi.mocked(createPublicClient).mockReturnValue({ getBytecode: vi.fn().mockResolvedValue('0x') } as any);
    const rpc = vi.spyOn(http, 'jsonRpcFallback').mockImplementation(async (_urls, method, params) => {
      if (method !== 'eth_sendRawTransaction') throw new Error('receipt unavailable');
      expect(params).toEqual(['0x0102']);
      expect(readReservations(activity)[0].state).toBe('prepared');
      throw new Error('response lost after acceptance');
    });
    const args = { chain: 'base', to: '0x2222222222222222222222222222222222222222', valueWei: '5', operationId: 'purchase:1' };
    const result = await handleAgentWalletTool('chaingpt_agent_wallet_sign_and_send', args);
    expect(result.content[0].text).toContain('uncertain');
    expect(readReservations(activity)[0]).toMatchObject({ hash: keccak256('0x0102'), valueWei: '25', state: 'prepared' });
    expect(spendStats(24, 'evm')).toMatchObject({ totalWei: 25n, txCount: 1, ok: true });
    await handleAgentWalletTool('chaingpt_agent_wallet_sign_and_send', args);
    expect(sign).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(1); expect(rpc.mock.calls.filter(c => c[1] === 'eth_sendRawTransaction')).toHaveLength(1);
  });
});

describe('Solana simulation and confirmation failures', () => {
  function fixture(missingAccount = false) {
    const agent = Keypair.generate(); const recipient = Keypair.generate().publicKey;
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: agent.publicKey, recentBlockhash: '11111111111111111111111111111111', instructions: [SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: recipient, lamports: 10 })] }).compileToV0Message());
    const conn = {
      getGenesisHash: vi.fn().mockResolvedValue('1'.repeat(32)),
      getBalance: vi.fn().mockResolvedValue(100000),
      simulateTransaction: vi.fn().mockResolvedValue({ value: { accounts: missingAccount ? [] : [{ lamports: 99970 }], err: null } }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 20 }),
      sendRawTransaction: vi.fn().mockImplementation(async (raw: Uint8Array) => {
        expect(readReservations(activity)[0].state).toBe('prepared');
        return base58Encode(VersionedTransaction.deserialize(raw).signatures[0]);
      }),
      confirmTransaction: vi.fn().mockRejectedValue(new Error('confirmation timeout')),
    };
    vi.spyOn(sol, 'withRpcFallback').mockImplementation(async (_net, fn) => fn(conn as any));
    vi.spyOn(key, 'isSolanaKeystoreInitialized').mockReturnValue(true);
    vi.spyOn(key, 'readSolanaKeystoreFile').mockReturnValue({ address: agent.publicKey.toBase58() } as any);
    const load = vi.spyOn(key, 'loadSolanaKeypair').mockReturnValue(agent);
    writeFileSync(policyFile, JSON.stringify({ version: 1, killSwitch: false, solana: { enabled: true, genesisHashes: { devnet: '1'.repeat(32) }, maxTxLamports: '100', maxDailySpendLamports: '100', maxDailyTxCount: 1 }, assetLimits: [{ chain: 'solana-devnet', asset: 'SOL', allowedRecipients: [recipient.toBase58()], maxTxAmount: '100', maxDailyAmount: '100' }] }));
    return { conn, load, args: { txBase64: Buffer.from(tx.serialize()).toString('base64'), network: 'devnet', operationId: 'sol:1' } };
  }
  it('records a broadcast even when confirmation polling times out; retry never signs again', async () => {
    const { conn, load, args } = fixture();
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', args);
    expect(r.content[0].text).toContain('confirmation polling failed');
    expect(readReservations(activity)[0].state).toBe('broadcast');
    expect(spendStats(24, 'solana')).toMatchObject({ totalWei: 30n, txCount: 1, ok: true });
    await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', args);
    expect(conn.sendRawTransaction).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
  });
  it('refuses a custom RPC serving the wrong cluster before signing', async () => {
    const { conn, load, args } = fixture();
    conn.getGenesisHash.mockResolvedValue('2'.repeat(32));
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', args);
    expect(r.content[0].text).toMatch(/could not be simulated/);
    expect(load).not.toHaveBeenCalled(); expect(conn.sendRawTransaction).not.toHaveBeenCalled();
  });
  it('refuses missing fee-payer simulation state before any signature or broadcast', async () => {
    const { conn, load, args } = fixture(true);
    const r = await handleAgentWalletSolanaTool('chaingpt_agent_wallet_solana_sign_and_send', args);
    expect(r.content[0].text).toMatch(/could not be simulated/);
    expect(load).not.toHaveBeenCalled(); expect(conn.sendRawTransaction).not.toHaveBeenCalled();
  });
});

it('keeps an EVM hold until inclusion is canonical and finalized', async () => {
  const { finalizedEvmReceipt } = await import('../lib/signing-finality.js');
  let finalHeight = '0x1';
  let canonicalHash = '0xaaa';
  vi.spyOn(http, 'jsonRpcFallback').mockImplementation(async (_rpcs, method, params) => {
    if (method === 'eth_getTransactionReceipt') return { transactionHash: '0xfixture', blockNumber: '0x2', blockHash: '0xaaa' } as any;
    return (params?.[0] === 'finalized' ? { number: finalHeight } : { hash: canonicalHash }) as any;
  });
  expect(await finalizedEvmReceipt(['https://fixture.invalid'], '0xfixture')).toBe(false);
  finalHeight = '0x3';
  expect(await finalizedEvmReceipt(['https://fixture.invalid'], '0xfixture')).toBe(true);
  canonicalHash = '0xbbb';
  expect(await finalizedEvmReceipt(['https://fixture.invalid'], '0xfixture')).toBe(false);
});

describe('ERC-4337 finality binds the reserved operation', () => {
  it.each(['matching', 'other-operation', 'other-entrypoint', 'missing-event', 'removed-event', 'wrong-bundler-hash', 'wrong-transaction', 'not-finalized', 'reorg'])(
    'retains the hold unless canonical inclusion is proven (%s)', async kind => {
      const { finalizedUserOperationReceipt } = await import('../lib/signing-finality.js');
      const { toEventSelector } = await import('viem');
      const operation = '0x' + 'ab'.repeat(32);
      const entryPoint = '0x' + '11'.repeat(20);
      const log = {
        address: kind === 'other-entrypoint' ? '0x' + '22'.repeat(20) : entryPoint,
        topics: [toEventSelector('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'), kind === 'other-operation' ? '0x' + 'cd'.repeat(32) : operation],
        removed: kind === 'removed-event',
      };
      const rpc = vi.spyOn(http, 'jsonRpcFallback').mockImplementation(async (_urls, method, params) => {
        if (method === 'eth_getTransactionReceipt') return {
          transactionHash: kind === 'wrong-transaction' ? '0xother' : '0xtx', blockNumber: '0x2', blockHash: '0xaaa',
          logs: kind === 'missing-event' ? [] : [log],
        } as any;
        return (params?.[0] === 'finalized' ? { number: kind === 'not-finalized' ? '0x1' : '0x3' } : { hash: kind === 'reorg' ? '0xbbb' : '0xaaa' }) as any;
      });
      const receipt = { userOpHash: kind === 'wrong-bundler-hash' ? '0xwrong' : operation, receipt: { transactionHash: '0xtx' } };
      expect(await finalizedUserOperationReceipt(['https://fixture.invalid'], operation, entryPoint, receipt)).toBe(kind === 'matching');
      if (kind === 'wrong-bundler-hash') expect(rpc).not.toHaveBeenCalled();
    },
  );
});
