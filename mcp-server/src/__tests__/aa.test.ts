import './_setup.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  aaTools,
  handleAaTool,
} from '../tools/aa.js';
import {
  normalizeUserOp,
  computeUserOpHash,
  packUserOp,
  userOpToBundlerJson,
  ENTRY_POINT_V07,
  ENTRY_POINT_V06,
} from '../lib/erc4337.js';

// ─── A minimal but valid v0.7 UserOp for tests ─────────────────────
const BASE_USEROP = {
  sender: '0x1234567890123456789012345678901234567890',
  nonce: '0x1',
  callData: '0xdeadbeef',
  callGasLimit: '100000',
  verificationGasLimit: '100000',
  preVerificationGas: '21000',
  maxFeePerGas: '1000000000',
  maxPriorityFeePerGas: '1000000000',
};

// ─── Tool surface ──────────────────────────────────────────────────
describe('aa tool surface', () => {
  it('exports four tools with the chaingpt_aa_ prefix', () => {
    expect(aaTools.map((t) => t.name).sort()).toEqual([
      'chaingpt_aa_estimate_userop',
      'chaingpt_aa_pack_userop',
      'chaingpt_aa_userop_hash',
      'chaingpt_aa_userop_receipt',
    ]);
  });

  it('every tool has a populated description + input schema', () => {
    for (const t of aaTools) {
      expect(t.name).toMatch(/^chaingpt_aa_/);
      expect((t.description ?? '').length).toBeGreaterThan(40);
      expect((t.inputSchema as any).type).toBe('object');
    }
  });

  it('does NOT export any tool accepting a private key, owner key, session key, or signer', () => {
    const FORBIDDEN = /privatekey|private_key|ownerkey|owner_key|sessionkey|session_key|mnemonic|seedphrase|seed_phrase|signer\b/i;
    for (const t of aaTools) {
      const walk = (obj: any, path = ''): void => {
        if (!obj || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
          const here = path ? `${path}.${k}` : k;
          expect(k, `${t.name} schema key "${here}" must not look like a secret`).not.toMatch(FORBIDDEN);
          walk(obj[k], here);
        }
      };
      walk(t.inputSchema);
    }
  });

  it('exposes the canonical EntryPoint addresses', () => {
    expect(ENTRY_POINT_V07).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
    expect(ENTRY_POINT_V06).toBe('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789');
  });
});

// ─── normalizeUserOp ───────────────────────────────────────────────
describe('normalizeUserOp', () => {
  it('parses a minimal v0.7 op with decimal strings into bigints', () => {
    const op = normalizeUserOp(BASE_USEROP as any);
    expect(op.sender).toBe(BASE_USEROP.sender);
    expect(op.nonce).toBe(1n);
    expect(op.callGasLimit).toBe(100_000n);
    expect(op.maxFeePerGas).toBe(1_000_000_000n);
    expect(op.factory).toBeUndefined();
    expect(op.paymaster).toBeUndefined();
  });

  it('accepts hex strings for uint256 fields', () => {
    const op = normalizeUserOp({ ...BASE_USEROP, nonce: '0x10' } as any);
    expect(op.nonce).toBe(16n);
  });

  it('rejects an invalid sender address', () => {
    expect(() => normalizeUserOp({ ...BASE_USEROP, sender: 'not-an-address' } as any))
      .toThrow(/sender: not a 0x-prefixed 20-byte address/);
  });

  it('rejects callData that is not hex', () => {
    expect(() => normalizeUserOp({ ...BASE_USEROP, callData: 'deadbeef' } as any))
      .toThrow(/callData: not a 0x-prefixed hex string/);
  });

  it('rejects numeric values passed as JS numbers (forces string for uint256 precision)', () => {
    expect(() => normalizeUserOp({ ...BASE_USEROP, nonce: 1 as any } as any))
      .toThrow(/nonce: must be a string/);
  });

  it('requires factory + factoryData together', () => {
    expect(() => normalizeUserOp({ ...BASE_USEROP, factory: '0x1111111111111111111111111111111111111111' } as any))
      .toThrow(/factory and factoryData must be set together/);
  });

  it('requires paymaster gas limits when paymaster is set', () => {
    expect(() => normalizeUserOp({ ...BASE_USEROP, paymaster: '0x2222222222222222222222222222222222222222' } as any))
      .toThrow(/paymaster requires paymasterVerificationGasLimit/);
  });

  it('accepts a fully-specified paymaster op', () => {
    const op = normalizeUserOp({
      ...BASE_USEROP,
      paymaster: '0x2222222222222222222222222222222222222222',
      paymasterVerificationGasLimit: '50000',
      paymasterPostOpGasLimit: '30000',
    } as any);
    expect(op.paymaster).toBe('0x2222222222222222222222222222222222222222');
    expect(op.paymasterVerificationGasLimit).toBe(50_000n);
    expect(op.paymasterPostOpGasLimit).toBe(30_000n);
  });
});

// ─── computeUserOpHash determinism ─────────────────────────────────
describe('computeUserOpHash', () => {
  it('is deterministic for identical inputs', () => {
    const op = normalizeUserOp(BASE_USEROP as any);
    const h1 = computeUserOpHash({ userOp: op, chainId: 1 });
    const h2 = computeUserOpHash({ userOp: op, chainId: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('produces a DIFFERENT hash on a different chain (the chainId is in the hash)', () => {
    const op = normalizeUserOp(BASE_USEROP as any);
    const ethHash = computeUserOpHash({ userOp: op, chainId: 1 });
    const baseHash = computeUserOpHash({ userOp: op, chainId: 8453 });
    expect(ethHash).not.toBe(baseHash);
  });

  it('produces a different hash on a different EntryPoint', () => {
    const op = normalizeUserOp(BASE_USEROP as any);
    const v07 = computeUserOpHash({ userOp: op, chainId: 1, entryPoint: ENTRY_POINT_V07 });
    const otherEp = computeUserOpHash({
      userOp: op,
      chainId: 1,
      entryPoint: '0x4337433743374337433743374337433743374337',
    });
    expect(v07).not.toBe(otherEp);
  });

  it('changes when any input field changes', () => {
    const op = normalizeUserOp(BASE_USEROP as any);
    const opNonce2 = normalizeUserOp({ ...BASE_USEROP, nonce: '2' } as any);
    expect(computeUserOpHash({ userOp: op, chainId: 1 }))
      .not.toBe(computeUserOpHash({ userOp: opNonce2, chainId: 1 }));
  });
});

// ─── packUserOp shape ──────────────────────────────────────────────
describe('packUserOp', () => {
  it('returns a struct with the expected fields and bytes32 packed gas limits/fees', () => {
    const op = normalizeUserOp(BASE_USEROP as any);
    const packed = packUserOp(op);
    expect(packed.sender).toBe(op.sender);
    expect(packed.nonce).toBe(op.nonce);
    expect(packed.callData).toBe(op.callData);
    // bytes32 packed fields: 0x + 64 hex chars
    expect(packed.accountGasLimits).toMatch(/^0x[0-9a-f]{64}$/);
    expect(packed.gasFees).toMatch(/^0x[0-9a-f]{64}$/);
    // initCode is 0x when no factory; paymasterAndData is 0x when no paymaster
    expect(packed.initCode).toBe('0x');
    expect(packed.paymasterAndData).toBe('0x');
  });
});

// ─── userOpToBundlerJson ──────────────────────────────────────────
describe('userOpToBundlerJson', () => {
  it('hex-encodes every uint256 field for the bundler RPC convention', () => {
    const op = normalizeUserOp(BASE_USEROP as any);
    const json = userOpToBundlerJson(op);
    expect(json.sender).toBe(op.sender);
    expect(json.nonce).toBe('0x1');
    expect(json.callGasLimit).toBe('0x186a0');         // 100_000
    expect(json.maxFeePerGas).toBe('0x3b9aca00');      // 1_000_000_000
    expect(json.factory).toBeUndefined();
    expect(json.paymaster).toBeUndefined();
  });

  it('includes paymaster fields only when paymaster is set', () => {
    const op = normalizeUserOp({
      ...BASE_USEROP,
      paymaster: '0x2222222222222222222222222222222222222222',
      paymasterVerificationGasLimit: '50000',
      paymasterPostOpGasLimit: '30000',
    } as any);
    const json = userOpToBundlerJson(op);
    expect(json.paymaster).toBe('0x2222222222222222222222222222222222222222');
    expect(json.paymasterVerificationGasLimit).toBe('0xc350');
    expect(json.paymasterPostOpGasLimit).toBe('0x7530');
  });
});

// ─── handleAaTool — userop_hash ────────────────────────────────────
describe('handleAaTool — userop_hash', () => {
  it('returns the hash and metadata for a valid input on a known chain', async () => {
    const res = await handleAaTool('chaingpt_aa_userop_hash', {
      userOp: BASE_USEROP,
      chain: 'ethereum',
    });
    const text = res.content[0].text;
    expect(text).toMatch(/userOpHash \(v0\.7\)/);
    expect(text).toMatch(/chain:        ethereum \(chainId=1\)/);
    expect(text).toMatch(new RegExp(`entryPoint:   ${ENTRY_POINT_V07}`));
    expect(text).toMatch(/userOpHash:   0x[0-9a-f]{64}/);
  });

  it('errors on an unsupported chain slug', async () => {
    const res = await handleAaTool('chaingpt_aa_userop_hash', { userOp: BASE_USEROP, chain: 'mainframe' });
    expect(res.content[0].text).toMatch(/chain: "mainframe" not supported/);
  });

  it('errors when sender is invalid', async () => {
    const res = await handleAaTool('chaingpt_aa_userop_hash', {
      userOp: { ...BASE_USEROP, sender: '0xdeadbeef' },
      chain: 'ethereum',
    });
    expect(res.content[0].text).toMatch(/sender: not a 0x-prefixed 20-byte address/);
  });
});

// ─── handleAaTool — pack_userop ────────────────────────────────────
describe('handleAaTool — pack_userop', () => {
  it('emits both the on-the-wire PackedUserOperation and the bundler-rpc JSON', async () => {
    const res = await handleAaTool('chaingpt_aa_pack_userop', {
      userOp: BASE_USEROP,
      chain: 'base',
    });
    const text = res.content[0].text;
    expect(text).toMatch(/PackedUserOperation v0\.7/);
    expect(text).toMatch(/chainId=8453/);
    expect(text).toMatch(/on-the-wire PackedUserOperation/);
    expect(text).toMatch(/"accountGasLimits": "0x[0-9a-f]{64}"/);
    expect(text).toMatch(/"gasFees": "0x[0-9a-f]{64}"/);
    expect(text).toMatch(/bundler-rpc JSON/);
    expect(text).toMatch(/"callGasLimit": "0x186a0"/);
  });
});

// ─── handleAaTool — estimate_userop (mocked bundler) ───────────────
describe('handleAaTool — estimate_userop', () => {
  let fetchSpy: any;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            callGasLimit: '0x186a0',
            verificationGasLimit: '0x186a0',
            preVerificationGas: '0x5208',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTs the bundler-rpc envelope and returns the result text', async () => {
    const res = await handleAaTool('chaingpt_aa_estimate_userop', {
      bundlerUrl: 'https://example.bundler.test/rpc',
      userOp: BASE_USEROP,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.bundler.test/rpc');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.method).toBe('eth_estimateUserOperationGas');
    expect(body.params[1]).toBe(ENTRY_POINT_V07);
    expect(body.params[0].sender).toBe(BASE_USEROP.sender);

    const text = res.content[0].text;
    expect(text).toMatch(/eth_estimateUserOperationGas \(v0\.7\)/);
    expect(text).toMatch(/"callGasLimit": "0x186a0"/);
  });

  it('surfaces a bundler-side error message back to the caller', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid userOp' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const res = await handleAaTool('chaingpt_aa_estimate_userop', {
      bundlerUrl: 'https://example.bundler.test/rpc',
      userOp: BASE_USEROP,
    });
    expect(res.content[0].text).toMatch(/bundler rpc eth_estimateUserOperationGas returned -32602: invalid userOp/);
  });

  it('errors when bundlerUrl is missing or not https', async () => {
    const res = await handleAaTool('chaingpt_aa_estimate_userop', {
      bundlerUrl: '',
      userOp: BASE_USEROP,
    });
    expect(res.content[0].text).toMatch(/bundlerUrl required/);
  });
});

// ─── handleAaTool — userop_receipt (mocked bundler) ────────────────
describe('handleAaTool — userop_receipt', () => {
  let fetchSpy: any;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns the "not yet bundled" message on a null result', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const res = await handleAaTool('chaingpt_aa_userop_receipt', {
      bundlerUrl: 'https://example.bundler.test/rpc',
      userOpHash: '0x' + 'a'.repeat(64),
    });
    expect(res.content[0].text).toMatch(/Not yet bundled/);
  });

  it('returns the receipt JSON when the bundler has one', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1, result: {
        userOpHash: '0xabc',
        success: true,
        receipt: { transactionHash: '0xdeadbeef', status: '0x1' },
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await handleAaTool('chaingpt_aa_userop_receipt', {
      bundlerUrl: 'https://example.bundler.test/rpc',
      userOpHash: '0x' + 'a'.repeat(64),
    });
    const text = res.content[0].text;
    expect(text).toMatch(/eth_getUserOperationReceipt/);
    expect(text).toMatch(/"transactionHash": "0xdeadbeef"/);
  });

  it('rejects a userOpHash without 0x prefix', async () => {
    const res = await handleAaTool('chaingpt_aa_userop_receipt', {
      bundlerUrl: 'https://example.bundler.test/rpc',
      userOpHash: 'not-a-hash',
    });
    expect(res.content[0].text).toMatch(/userOpHash required \(0x-prefixed\)/);
  });
});

// ─── unknown name ──────────────────────────────────────────────────
describe('handleAaTool — unknown name', () => {
  it('returns a friendly error', async () => {
    const res = await handleAaTool('chaingpt_aa_nothing', {});
    expect(res.content[0].text).toMatch(/Unknown AA tool/);
  });
});
