import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { decodeAbiParameters, type Address, type Hex } from 'viem';
import { readKeystoreFile, loadAccount } from '../lib/agent-keystore.js';
import {
  loadPolicy,
  policyPath,
  checkPolicy,
  checkErc4337Gate,
  type TxIntent,
} from '../lib/agent-policy.js';
import { logActivity, spendStats } from '../lib/agent-activity.js';
import {
  encodeSingleExecute,
  encodeGetNonce,
  nexusNonceKey,
  readAccountId,
  classifyAccountId,
} from '../lib/erc7579.js';
import { SMART_SESSIONS_ADDRESS, encodeUseSignature, MOCK_ECDSA_SIG } from '../lib/smart-sessions.js';
import {
  ENTRY_POINT_V07,
  normalizeUserOp,
  computeUserOpHash,
  userOpToBundlerJson,
  bundlerRpc,
  type UserOpInput,
} from '../lib/erc4337.js';
import { resolveChain, rpcEndpoints } from '../lib/chains.js';
import { jsonRpcFallback } from '../lib/http.js';

/**
 * Agent wallet — ERC-4337 session-key surface.
 *
 * The agent acts THROUGH the user's smart account using a session granted
 * on-chain (chaingpt_aa_session_build_grant). Two independent fences apply
 * to every send:
 *   1. The LOCAL policy gate — erc4337 sub-policy (who/where) + the standard
 *      checkPolicy on the inner execution (value caps, address allowlists,
 *      velocity windows, memo).
 *   2. The CHAIN — Smart Sessions policy contracts validate the userOp at
 *      EntryPoint time: cumulative token caps, expiry, usage limits. This
 *      fence survives even a fully compromised host.
 * A bundler rejection of an over-cap op is the PRODUCT working: surface it
 * as a chain-side refusal, never retry around it.
 */

export const agentWallet4337Tools: Tool[] = [
  {
    name: 'chaingpt_agent_wallet_4337_sign_and_send',
    description:
      "Execute one call through the user's ERC-7579 smart account using the agent's on-chain session key: " +
      'builds the userOp, runs the LOCAL policy gates (erc4337 who/where + standard per-tx and velocity ' +
      'checks on the inner call), signs the userOpHash with the agent keystore, wraps it in the Smart ' +
      'Sessions USE envelope, submits to the bundler — where the CHAIN enforces the granted caps at ' +
      'validation time. v1 supports Biconomy Nexus 1.x accounts. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: { type: 'string', description: 'EVM chain slug.' },
        account: { type: 'string', description: "The user's smart account (userOp sender)." },
        permissionId: { type: 'string', description: 'The granted session (bytes32 from build_grant).' },
        target: { type: 'string', description: 'Inner call target (e.g. the ERC-20 token for a transfer).' },
        valueWei: { type: 'string', description: 'Inner call native value. Default "0".', default: '0' },
        data: { type: 'string', description: 'Inner call calldata. Default "0x".', default: '0x' },
        bundlerUrl: { type: 'string', description: 'Bundler RPC URL (https; policy can pin allowed hosts).' },
        memo: { type: 'string', description: 'Audit-trail memo. Required if policy.requireMemo=true.' },
        gasLimitMultiplierPct: { type: 'number', description: 'Headroom on bundler gas estimates. Default 120 (=+20%).', default: 120 },
        waitForReceipt: { type: 'boolean', description: 'Poll for the userOp receipt. Default true.', default: true },
      },
      required: ['chain', 'account', 'permissionId', 'target', 'bundlerUrl'],
    },
  },
];

function refusalBlock(reason: string, digest: string) {
  return {
    content: [{
      type: 'text',
      text: [
        `⛔ Policy refused this session-key operation.`,
        ``,
        `Reason:        ${reason}`,
        `Policy digest: ${digest}`,
        `Policy file:   ${policyPath()}`,
        ``,
        `If this refusal is wrong, an admin must edit the policy file with a text editor.`,
        `No MCP tool can relax these rules from inside the agent.`,
      ].join('\n'),
    }],
  };
}

export async function handleAgentWallet4337Tool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  args = args ?? {};

  try {
    if (name !== 'chaingpt_agent_wallet_4337_sign_and_send') {
      return { content: [{ type: 'text', text: `Unknown agent-wallet-4337 tool: ${name}` }] };
    }

    const file = readKeystoreFile();
    if (!file) {
      return { content: [{ type: 'text', text: 'Agent wallet not initialized. Call chaingpt_agent_wallet_init first (the agent EOA is the session key).' }] };
    }

    const account = String(args.account) as Address;
    const bundlerUrl = String(args.bundlerUrl ?? '');
    const permissionId = String(args.permissionId ?? '') as Hex;
    const target = String(args.target) as Address;
    const valueWei = BigInt(String(args.valueWei ?? '0'));
    const data = (String(args.data ?? '0x')) as Hex;
    const memo = args.memo ? String(args.memo) : undefined;
    const headroomPct = Math.max(100, Number(args.gasLimitMultiplierPct ?? 120));

    if (!/^0x[0-9a-fA-F]{64}$/.test(permissionId)) {
      return { content: [{ type: 'text', text: `permissionId must be a 0x bytes32 (got ${permissionId}).` }] };
    }

    // 1. LOCAL gate #1 — who/where (pre-RPC, fail closed)
    const policy = loadPolicy();
    const gate = checkErc4337Gate({ account, bundlerUrl }, policy);
    if (!gate.allowed) return refusalBlock(gate.reason, gate.policyDigest);

    // 2. Account kind — v1 signs only for Nexus 1.x
    const chain = resolveChain(String(args.chain));
    if (!chain?.chainId) {
      return { content: [{ type: 'text', text: `chain "${args.chain}" is not a known EVM chain.` }] };
    }
    const rpcs = rpcEndpoints(chain.slug);
    let accountKind = 'unknown';
    try {
      const id = await readAccountId(rpcs, account);
      const kind = classifyAccountId(id);
      accountKind = kind.kind;
      if (kind.kind !== 'nexus') {
        return {
          content: [{
            type: 'text',
            text: `v1 supports Biconomy Nexus 1.x accounts (accountId "${id}" → ${kind.kind}). Kernel v3 and Safe7579 signing are queued follow-ups — the session libs already speak their shared module.`,
          }],
        };
      }
    } catch {
      return { content: [{ type: 'text', text: `Could not read accountId() from ${account} on ${chain.slug} — is the smart account deployed?` }] };
    }

    // 3. Build the userOp skeleton
    const callData = encodeSingleExecute(target, valueWei, data);
    const nonceRaw = await jsonRpcFallback<Hex>(rpcs, 'eth_call', [
      { to: ENTRY_POINT_V07, data: encodeGetNonce(account, nexusNonceKey(SMART_SESSIONS_ADDRESS)) },
      'latest',
    ]);
    const nonce = decodeAbiParameters([{ type: 'uint256' }], nonceRaw)[0] as bigint;

    const feeHex = await jsonRpcFallback<Hex>(rpcs, 'eth_gasPrice', []);
    const gasPrice = BigInt(feeHex);
    const maxFeePerGas = (gasPrice * 125n) / 100n;
    const maxPriorityFeePerGas = gasPrice / 10n > 0n ? gasPrice / 10n : 1n;

    const baseOp: UserOpInput = {
      sender: account,
      nonce: `0x${nonce.toString(16)}`,
      callData,
      callGasLimit: '0x30000',
      verificationGasLimit: '0x60000',
      preVerificationGas: '0x10000',
      maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
      maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
      signature: encodeUseSignature(permissionId, MOCK_ECDSA_SIG),
    };

    // 4. Bundler gas estimation (with the mock session signature)
    try {
      const est = await bundlerRpc<{ callGasLimit: Hex; verificationGasLimit: Hex; preVerificationGas: Hex }>({
        url: bundlerUrl,
        method: 'eth_estimateUserOperationGas',
        params: [userOpToBundlerJson(normalizeUserOp(baseOp)), ENTRY_POINT_V07],
      });
      const bump = (h: Hex) => `0x${((BigInt(h) * BigInt(headroomPct)) / 100n).toString(16)}`;
      baseOp.callGasLimit = bump(est.callGasLimit);
      baseOp.verificationGasLimit = bump(est.verificationGasLimit);
      baseOp.preVerificationGas = bump(est.preVerificationGas);
    } catch (e: any) {
      return {
        content: [{
          type: 'text',
          text:
            `Bundler refused gas estimation: ${e?.message ?? e}\n\n` +
            `If the message mentions signature/validation (AA23/AA24) or a SmartSession error, the CHAIN-side ` +
            `session likely rejects this op (not enabled, expired, over-cap, or unregistered target/selector) — ` +
            `check chaingpt_aa_session_status. That refusal is the on-chain fence working.`,
        }],
      };
    }

    // 5. LOCAL gate #2 — the standard per-tx + velocity checks on the INNER call
    const intent: TxIntent = {
      chainId: chain.chainId,
      to: target,
      value: valueWei,
      data,
      gas: BigInt(baseOp.callGasLimit!),
      memo,
    };
    const decision = checkPolicy(intent, policy, spendStats(24, 'evm'));
    if (!decision.allowed) return refusalBlock(decision.reason, decision.policyDigest);

    // 6. Sign the real userOpHash with the agent's session key
    const userOp = normalizeUserOp(baseOp);
    const userOpHash = computeUserOpHash({ userOp, entryPoint: ENTRY_POINT_V07, chainId: chain.chainId });
    const agent = loadAccount();
    const sig = await agent.sign({ hash: userOpHash as Hex });
    userOp.signature = encodeUseSignature(permissionId, sig);

    // 7. Submit — the chain's validation is the authoritative fence
    let submittedHash: string;
    try {
      submittedHash = await bundlerRpc<string>({
        url: bundlerUrl,
        method: 'eth_sendUserOperation',
        params: [userOpToBundlerJson(userOp), ENTRY_POINT_V07],
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const chainSide = /AA2\d|AA3\d|SmartSession|policy|signature error|validation/i.test(msg);
      return {
        content: [{
          type: 'text',
          text: chainSide
            ? `⛔ CHAIN-SIDE refusal: ${msg}\n\nThe on-chain session caps blocked this operation — even local policy approval cannot override the chain. This is the designed trust boundary. Check remaining allowance/expiry via chaingpt_aa_session_status.`
            : `Bundler submission failed: ${msg}`,
        }],
      };
    }

    // 8. Optional receipt poll
    let txHash = '';
    if (args.waitForReceipt !== false) {
      for (let i = 0; i < 20 && !txHash; i++) {
        try {
          const r = await bundlerRpc<any>({ url: bundlerUrl, method: 'eth_getUserOperationReceipt', params: [submittedHash] });
          if (r?.receipt?.transactionHash) {
            txHash = r.receipt.transactionHash;
            if (r.success === false) {
              return { content: [{ type: 'text', text: `userOp ${submittedHash} was included in ${txHash} but the inner call REVERTED. Inspect the tx on the explorer.` }] };
            }
          }
        } catch { /* keep polling */ }
        if (!txHash) await new Promise((res) => setTimeout(res, 3000));
      }
    }

    // 9. Journal (EVM class — counts in the standard velocity window)
    try {
      logActivity({
        ts: new Date().toISOString(),
        chain: chain.slug,
        chainId: chain.chainId,
        from: file.address,
        to: target,
        valueWei: valueWei.toString(),
        hash: txHash || submittedHash,
        memo,
        policyDigest: decision.policyDigest,
      });
    } catch { /* best-effort */ }

    return {
      content: [{
        type: 'text',
        text: [
          `✓ Session-key userOp ${txHash ? 'INCLUDED' : 'submitted'} — ${chain.name} (${accountKind} account).`,
          ``,
          `userOpHash:    ${submittedHash}`,
          txHash ? `Tx:            ${chain.explorer ? `${chain.explorer}/tx/${txHash}` : txHash}` : `Receipt:       pending (chaingpt_aa_userop_receipt to poll)`,
          `Inner call:    ${target} value=${valueWei} data=${data.slice(0, 18)}…`,
          `Session:       ${permissionId}`,
          `Memo:          ${memo ?? '(none)'}`,
          ``,
          `Both fences held: local policy gate AND the on-chain session caps.`,
        ].join('\n'),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Agent Wallet (4337) error: ${message}`);
  }
}
