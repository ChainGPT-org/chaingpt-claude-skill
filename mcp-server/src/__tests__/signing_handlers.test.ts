import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as http from '../lib/http.js';

const root = mkdtempSync(join(tmpdir(), 'signer-regression-'));
const activity = join(root, 'activity.jsonl');
const policyFile = join(root, 'policy.json');
beforeEach(() => {
  vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); mkdirSync(root);
  process.env.CHAINGPT_ACTIVITY_FILE = activity; process.env.CHAINGPT_AGENT_POLICY_FILE = policyFile;
  process.env.CHAINGPT_DISABLE_KEYCHAIN = '1';
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

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
