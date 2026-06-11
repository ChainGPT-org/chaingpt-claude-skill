import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData, parseAbi, size, slice, type Hex } from 'viem';

import './_setup.js';
import {
  buildSession,
  getPermissionId,
  encodeEnableSessions,
  encodeRemoveSession,
  encodeUseSignature,
  appendSessionRecord,
  readSessionRecords,
  MOCK_ECDSA_SIG,
  OWNABLE_VALIDATOR_ADDRESS,
  ERC20_SPENDING_LIMIT_POLICY,
  TIME_FRAME_POLICY,
  ERC20_TRANSFER_SELECTOR,
} from '../lib/smart-sessions.js';
import {
  encodeSingleExecute,
  encodeInstallModule,
  nexusNonceKey,
  classifyAccountId,
  MODE_SINGLE_DEFAULT,
} from '../lib/erc7579.js';

const AGENT = '0x1111111111111111111111111111111111111111' as const;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const FUTURE = Math.floor(Date.now() / 1000) + 86_400;

const caps = () => ({
  agentAddress: AGENT,
  tokenCaps: [{ token: USDC, cap: 100_000_000n }], // 100 USDC
  validUntil: FUTURE,
});

describe('smart-sessions encoders', () => {
  it('buildSession assembles the expected structure', () => {
    const s = buildSession(caps());
    expect(s.sessionValidator).toBe(OWNABLE_VALIDATOR_ADDRESS);
    expect(s.actions).toHaveLength(1);
    expect(s.actions[0].actionTarget).toBe(USDC);
    expect(s.actions[0].actionTargetSelector).toBe(ERC20_TRANSFER_SELECTOR);
    expect(s.actions[0].actionPolicies.map((p) => p.policy)).toContain(ERC20_SPENDING_LIMIT_POLICY);
    expect(s.actions[0].actionPolicies.map((p) => p.policy)).toContain(TIME_FRAME_POLICY);
    expect(s.userOpPolicies.map((p) => p.policy)).toContain(TIME_FRAME_POLICY);
    expect(s.permitERC4337Paymaster).toBe(false);
  });

  it('refuses unbounded, past-dated, empty, and zero-cap grants', () => {
    expect(() => buildSession({ ...caps(), validUntil: 0 })).toThrow(/validUntil/);
    expect(() => buildSession({ ...caps(), validUntil: 1000 })).toThrow(/future/);
    expect(() => buildSession({ agentAddress: AGENT, tokenCaps: [], validUntil: FUTURE })).toThrow(/at least one/);
    expect(() => buildSession({ ...caps(), tokenCaps: [{ token: USDC, cap: 0n }] })).toThrow(/> 0/);
  });

  it('permissionId is deterministic and salt-sensitive', () => {
    const a = getPermissionId(buildSession(caps()));
    const b = getPermissionId(buildSession(caps()));
    const c = getPermissionId(buildSession({ ...caps(), salt: `0x${'11'.repeat(32)}` as Hex }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('enableSessions calldata round-trips through decodeFunctionData', () => {
    const session = buildSession(caps());
    const data = encodeEnableSessions([session]);
    const decoded = decodeFunctionData({
      abi: parseAbi([
        'struct PolicyData { address policy; bytes initData; }',
        'struct ActionData { bytes4 actionTargetSelector; address actionTarget; PolicyData[] actionPolicies; }',
        'struct ERC7739Data { string[] allowedERC7739Content; PolicyData[] erc1271Policies; }',
        'struct Session { address sessionValidator; bytes sessionValidatorInitData; bytes32 salt; PolicyData[] userOpPolicies; ERC7739Data erc7739Policies; ActionData[] actions; bool permitERC4337Paymaster; }',
        'function enableSessions(Session[] sessions) returns (bytes32[])',
      ]),
      data,
    });
    expect(decoded.functionName).toBe('enableSessions');
    const arg = (decoded.args as any)[0][0];
    expect(arg.sessionValidator.toLowerCase()).toBe(OWNABLE_VALIDATOR_ADDRESS.toLowerCase());
    expect(arg.actions).toHaveLength(1);
    expect(arg.actions[0].actionTarget.toLowerCase()).toBe(USDC.toLowerCase());
  });

  it('removeSession calldata decodes', () => {
    const pid = getPermissionId(buildSession(caps()));
    const decoded = decodeFunctionData({
      abi: parseAbi(['function removeSession(bytes32 permissionId)']),
      data: encodeRemoveSession(pid),
    });
    expect(decoded.args![0]).toBe(pid);
  });

  it('USE signature layout is 0x00 ++ permissionId ++ sig (1+32+65 bytes)', () => {
    const pid = getPermissionId(buildSession(caps()));
    const wrapped = encodeUseSignature(pid, MOCK_ECDSA_SIG);
    expect(size(wrapped)).toBe(1 + 32 + 65);
    expect(slice(wrapped, 0, 1)).toBe('0x00');
    expect(slice(wrapped, 1, 33)).toBe(pid);
    expect(slice(wrapped, 33)).toBe(MOCK_ECDSA_SIG);
  });
});

describe('erc7579 primitives', () => {
  it('encodeSingleExecute: execute selector + zero mode + packed tail', () => {
    const data = encodeSingleExecute(USDC, 5n, '0xdeadbeef');
    expect(data.slice(0, 10)).toBe('0xe9ae5c53');
    const decoded = decodeFunctionData({
      abi: parseAbi(['function execute(bytes32 mode, bytes executionCalldata)']),
      data,
    });
    expect(decoded.args![0]).toBe(MODE_SINGLE_DEFAULT);
    const tail = decoded.args![1] as Hex;
    expect(tail.toLowerCase()).toBe((USDC.toLowerCase() + 5n.toString(16).padStart(64, '0') + 'deadbeef'));
  });

  it('encodeInstallModule targets module type 1 (validator)', () => {
    const decoded = decodeFunctionData({
      abi: parseAbi(['function installModule(uint256 moduleTypeId, address module, bytes initData)']),
      data: encodeInstallModule(OWNABLE_VALIDATOR_ADDRESS, '0x1234'),
    });
    expect(decoded.args![0]).toBe(1n);
    expect((decoded.args![1] as string).toLowerCase()).toBe(OWNABLE_VALIDATOR_ADDRESS.toLowerCase());
  });

  it('nexusNonceKey: validator occupies the low 20 bytes, mode byte zero', () => {
    const key = nexusNonceKey(OWNABLE_VALIDATOR_ADDRESS);
    expect(key).toBe(BigInt(OWNABLE_VALIDATOR_ADDRESS)); // 3 zero bytes + 0x00 mode + address = just the address value
    expect(key < 2n ** 192n).toBe(true);
  });

  it('classifyAccountId matrix', () => {
    expect(classifyAccountId('biconomy.nexus.1.0.2')).toEqual({ kind: 'nexus', version: '1.0.2' });
    expect(classifyAccountId('kernel.advanced.v3.1').kind).toBe('kernel');
    expect(classifyAccountId('safe7579.v1.0.0').kind).toBe('safe');
    expect(classifyAccountId('weird.account.v9').kind).toBe('unknown');
  });
});

describe('sessions cache', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cgpt-sessions-'));
    process.env.CHAINGPT_SESSIONS_FILE = join(dir, 'sessions-4337.json');
  });
  afterAll(() => {
    delete process.env.CHAINGPT_SESSIONS_FILE;
  });

  it('appends, reads back, and is 0600', () => {
    appendSessionRecord({
      account: AGENT,
      chainId: 84532,
      permissionId: `0x${'ab'.repeat(32)}` as Hex,
      caps: { agentAddress: AGENT, tokenCaps: [{ token: USDC, cap: '100000000' }], validUntil: FUTURE },
      createdAt: new Date().toISOString(),
    });
    const records = readSessionRecords();
    expect(records).toHaveLength(1);
    expect(records[0].chainId).toBe(84532);
    expect(statSync(process.env.CHAINGPT_SESSIONS_FILE!).mode & 0o777).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
  });

  it('corrupt cache returns [] (never throws)', () => {
    writeFileSync(process.env.CHAINGPT_SESSIONS_FILE!, 'not-json');
    expect(readSessionRecords()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
