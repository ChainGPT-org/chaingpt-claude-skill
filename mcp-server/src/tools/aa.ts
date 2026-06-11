import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  normalizeUserOp,
  computeUserOpHash,
  packUserOp,
  userOpToBundlerJson,
  bundlerRpc,
  ENTRY_POINT_V07,
  type UserOpInput,
} from '../lib/erc4337.js';
import { CHAINS } from '../lib/chains.js';
import { resolveChainWithCustom } from '../lib/agent-custom-chains.js';

/**
 * Tier-7 ERC-4337 v0.7 foundation. Custody-free.
 *
 * The plugin never sees a smart-contract wallet's owner key or session key.
 * Every tool here either inspects a UserOperation, computes the hash that
 * the off-plugin signer will sign, or proxies a bundler-rpc call to a URL
 * the admin supplies.
 *
 * Per-provider session-key issuance / use (Safe, Kernel/ZeroDev, Biconomy,
 * Alchemy Smart Wallet) is queued as follow-up PRs that layer on this
 * foundation. The shared primitives — pack, hash, bundler-rpc — are the
 * same for every v0.7 SCW. The provider-specific bit is the validator
 * module's session-key ABI, which we deliberately leave out of this PR
 * so the plugin doesn't lock into a single vendor.
 */

const USEROP_PROPS = {
  sender: { type: 'string', description: '0x-prefixed smart-contract wallet address (the SCW that pays gas + executes the calldata).' },
  nonce: { type: 'string', description: 'Decimal or 0x-hex uint256. Bundler-supplied; some SCWs use a 2D nonce (key << 64 | seq).' },
  factory: { type: 'string', description: 'Optional. SCW factory address — set only on the FIRST userop for a counterfactual SCW (creates the wallet).' },
  factoryData: { type: 'string', description: 'Optional. Calldata for factory.createAccount(...). Required iff factory is set.' },
  callData: { type: 'string', description: 'Hex calldata the SCW will execute (e.g. encoded "execute(target,value,data)" or batch "executeBatch").' },
  callGasLimit: { type: 'string', description: 'Decimal or hex. Gas allocated to the SCW callData execution.' },
  verificationGasLimit: { type: 'string', description: 'Decimal or hex. Gas allocated to SCW validation (and paymaster validation if any).' },
  preVerificationGas: { type: 'string', description: 'Decimal or hex. Bundler-side gas overhead reimbursement.' },
  maxFeePerGas: { type: 'string', description: 'Decimal or hex. Same semantics as EIP-1559 maxFeePerGas.' },
  maxPriorityFeePerGas: { type: 'string', description: 'Decimal or hex. Same semantics as EIP-1559 maxPriorityFeePerGas.' },
  paymaster: { type: 'string', description: 'Optional. Paymaster contract address if a paymaster is sponsoring this op.' },
  paymasterVerificationGasLimit: { type: 'string', description: 'Required iff paymaster set. Gas for the paymaster\'s validatePaymasterUserOp.' },
  paymasterPostOpGasLimit: { type: 'string', description: 'Required iff paymaster set. Gas for the paymaster\'s postOp hook.' },
  paymasterData: { type: 'string', description: 'Optional. Calldata the paymaster expects (e.g. signed sponsorship token).' },
  signature: { type: 'string', description: 'Optional. SCW signature over userOpHash. Leave empty until signed.' },
};

export const aaTools: Tool[] = [
  {
    name: 'chaingpt_aa_userop_hash',
    description:
      'Compute the ERC-4337 v0.7 userOpHash — the digest that a smart-contract wallet\'s owner or ' +
      'session key signs. Hash = keccak256(keccak256(abi.encode(packedFields)) || entryPoint || ' +
      'chainId). Use this to prepare exactly the bytes the signer signs. Custody-free: the plugin ' +
      'does not sign. Pass the hash to your wallet (MetaMask, hardware wallet, viem signer) or to ' +
      'an SCW session key\'s personal_sign / EIP-712 flow. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userOp: {
          type: 'object',
          description: 'The user operation v0.7 fields. Numeric fields accept decimal or 0x-hex.',
          properties: USEROP_PROPS,
          required: ['sender', 'nonce', 'callData', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas'],
        },
        chain: {
          type: 'string',
          description: 'Canonical chain slug (e.g. ethereum, base, arbitrum) — used to resolve chainId.',
        },
        entryPoint: {
          type: 'string',
          description: `Optional EntryPoint address. Defaults to the canonical v0.7 EntryPoint ${ENTRY_POINT_V07}.`,
        },
      },
      required: ['userOp', 'chain'],
    },
  },
  {
    name: 'chaingpt_aa_pack_userop',
    description:
      'Pack a v0.7 UserOperation into the wire-format `PackedUserOperation` struct that the ' +
      'EntryPoint expects on the wire (gas limits + gas fees concatenated into bytes32). Returns ' +
      'the packed struct, the bundler-RPC JSON shape (uint256 fields → 0x-hex), and the userOpHash. ' +
      'Useful for inspecting exactly what a non-viem bundler will see. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userOp: {
          type: 'object',
          description: 'The user operation v0.7 fields.',
          properties: USEROP_PROPS,
          required: ['sender', 'nonce', 'callData', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas'],
        },
        chain: {
          type: 'string',
          description: 'Canonical chain slug — used to resolve chainId for the userOpHash.',
        },
        entryPoint: {
          type: 'string',
          description: `Optional EntryPoint address. Defaults to v0.7 ${ENTRY_POINT_V07}.`,
        },
      },
      required: ['userOp', 'chain'],
    },
  },
  {
    name: 'chaingpt_aa_estimate_userop',
    description:
      'Call eth_estimateUserOperationGas on a bundler RPC. The admin supplies the bundler URL ' +
      '(Pimlico / Alchemy AA / Stackup / Particle — all expose the same standard methods). Returns ' +
      'callGasLimit / verificationGasLimit / preVerificationGas / paymasterVerificationGasLimit / ' +
      'paymasterPostOpGasLimit estimates as hex strings. Read-only: does not submit the op. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bundlerUrl: {
          type: 'string',
          description: 'Full bundler RPC URL (https://). Examples: https://api.pimlico.io/v2/{chain}/rpc?apikey=… ; https://api.stackup.sh/v1/node/… ; https://{chain}.bundler.alchemy.com/{apiKey}.',
        },
        userOp: {
          type: 'object',
          description: 'The user operation v0.7 fields. Gas-limit fields can be 0/1 sentinels — the bundler will fill them in.',
          properties: USEROP_PROPS,
          required: ['sender', 'nonce', 'callData'],
        },
        entryPoint: {
          type: 'string',
          description: `Optional EntryPoint address. Defaults to v0.7 ${ENTRY_POINT_V07}.`,
        },
      },
      required: ['bundlerUrl', 'userOp'],
    },
  },
  {
    name: 'chaingpt_aa_userop_receipt',
    description:
      'Call eth_getUserOperationReceipt on a bundler RPC. Returns the receipt (tx hash, status, ' +
      'logs, gas used) for a previously submitted userOpHash, or null if not yet bundled. Use ' +
      'after eth_sendUserOperation to track inclusion. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bundlerUrl: { type: 'string', description: 'Full bundler RPC URL.' },
        userOpHash: { type: 'string', description: 'The 0x-prefixed userOpHash returned by chaingpt_aa_userop_hash (or by your bundler when you submitted).' },
      },
      required: ['bundlerUrl', 'userOpHash'],
    },
  },
  {
    name: 'chaingpt_aa_submit_userop',
    description:
      'Submit a SIGNED userOperation to a bundler (eth_sendUserOperation). Custody-free: refuses when ' +
      'the signature field is empty — sign the userOpHash externally first (owner wallet for grants; ' +
      'the agent session key signs only inside chaingpt_agent_wallet_4337_sign_and_send). Returns the ' +
      'userOpHash; track inclusion via chaingpt_aa_userop_receipt. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bundlerUrl: { type: 'string', description: 'Full bundler RPC URL (https).' },
        userOp: {
          type: 'object',
          description: 'The COMPLETE v0.7 userOperation including a non-empty signature.',
          properties: USEROP_PROPS,
          required: ['sender', 'nonce', 'callData', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'signature'],
        },
        entryPoint: { type: 'string', description: 'Defaults to the canonical v0.7 EntryPoint.' },
      },
      required: ['bundlerUrl', 'userOp'],
    },
  },
];

function chainIdFor(slug: string): number {
  const c = resolveChainWithCustom(slug);
  if (!c) throw new Error(`chain: "${slug}" not supported. Use one of: ${Object.keys(CHAINS).join(', ')} (or register a custom chain like base-sepolia).`);
  if (c.chainId === null) throw new Error(`chain: "${slug}" has no numeric chainId (non-EVM); ERC-4337 only applies to EVM chains`);
  return c.chainId;
}

async function handleUserOpHash(args: any): Promise<string> {
  const userOp = normalizeUserOp(args.userOp as UserOpInput);
  const chainId = chainIdFor(args.chain);
  const entryPoint = args.entryPoint ?? ENTRY_POINT_V07;
  const hash = computeUserOpHash({ userOp, entryPoint, chainId });
  return [
    `=== userOpHash (v0.7) ===`,
    ``,
    `chain:        ${args.chain} (chainId=${chainId})`,
    `entryPoint:   ${entryPoint}`,
    `sender:       ${userOp.sender}`,
    `nonce:        0x${userOp.nonce.toString(16)}`,
    ``,
    `userOpHash:   ${hash}`,
    ``,
    `Pass this hash to your wallet to sign. The signature goes into the userOp.signature field.`,
    `SimpleAccount + most v0.7 SCWs expect personal_sign over this hash; some expect EIP-712.`,
  ].join('\n');
}

async function handleUserOpPack(args: any): Promise<string> {
  const userOp = normalizeUserOp(args.userOp as UserOpInput);
  const chainId = chainIdFor(args.chain);
  const entryPoint = args.entryPoint ?? ENTRY_POINT_V07;
  const packed = packUserOp(userOp);
  const bundlerJson = userOpToBundlerJson(userOp);
  const hash = computeUserOpHash({ userOp, entryPoint, chainId });
  return [
    `=== PackedUserOperation v0.7 ===`,
    ``,
    `chain:        ${args.chain} (chainId=${chainId})`,
    `entryPoint:   ${entryPoint}`,
    `userOpHash:   ${hash}`,
    ``,
    `--- on-the-wire PackedUserOperation (the struct the EntryPoint takes) ---`,
    JSON.stringify({
      sender: packed.sender,
      nonce: `0x${packed.nonce.toString(16)}`,
      initCode: packed.initCode,
      callData: packed.callData,
      accountGasLimits: packed.accountGasLimits,
      preVerificationGas: `0x${packed.preVerificationGas.toString(16)}`,
      gasFees: packed.gasFees,
      paymasterAndData: packed.paymasterAndData,
      signature: packed.signature,
    }, null, 2),
    ``,
    `--- bundler-rpc JSON (the shape sent to eth_sendUserOperation) ---`,
    JSON.stringify(bundlerJson, null, 2),
  ].join('\n');
}

async function handleEstimateUserOp(args: any): Promise<string> {
  if (typeof args.bundlerUrl !== 'string' || !args.bundlerUrl.startsWith('http')) {
    throw new Error('bundlerUrl required (https://… your bundler RPC)');
  }
  const userOp = normalizeUserOp(args.userOp as UserOpInput);
  const entryPoint = args.entryPoint ?? ENTRY_POINT_V07;
  const bundlerJson = userOpToBundlerJson(userOp);
  const result = await bundlerRpc<Record<string, string>>({
    url: args.bundlerUrl,
    method: 'eth_estimateUserOperationGas',
    params: [bundlerJson, entryPoint],
  });
  return [
    `=== eth_estimateUserOperationGas (v0.7) ===`,
    ``,
    `bundler:    ${args.bundlerUrl.split('?')[0]}…`,
    `entryPoint: ${entryPoint}`,
    `sender:     ${userOp.sender}`,
    ``,
    `--- bundler response ---`,
    JSON.stringify(result, null, 2),
  ].join('\n');
}

async function handleSubmitUserOp(args: any): Promise<string> {
  const userOp = normalizeUserOp(args.userOp as UserOpInput);
  if (!userOp.signature || userOp.signature === '0x') {
    throw new Error(
      'Refused: userOp.signature is empty. This tool is custody-free — compute the hash with ' +
      'chaingpt_aa_userop_hash, sign it EXTERNALLY (owner wallet / hardware wallet), then resubmit ' +
      'with the signature filled in.'
    );
  }
  const entryPoint = args.entryPoint ?? ENTRY_POINT_V07;
  const result = await bundlerRpc<string>({
    url: String(args.bundlerUrl),
    method: 'eth_sendUserOperation',
    params: [userOpToBundlerJson(userOp), entryPoint],
  });
  return [
    `=== userOp submitted ===`,
    ``,
    `userOpHash:  ${result}`,
    `EntryPoint:  ${entryPoint}`,
    ``,
    `Track inclusion: chaingpt_aa_userop_receipt bundlerUrl=<same> userOpHash=${result}`,
  ].join('\n');
}

async function handleUserOpReceipt(args: any): Promise<string> {
  if (typeof args.bundlerUrl !== 'string' || !args.bundlerUrl.startsWith('http')) {
    throw new Error('bundlerUrl required (https://… your bundler RPC)');
  }
  if (typeof args.userOpHash !== 'string' || !args.userOpHash.startsWith('0x')) {
    throw new Error('userOpHash required (0x-prefixed)');
  }
  const result = await bundlerRpc<any>({
    url: args.bundlerUrl,
    method: 'eth_getUserOperationReceipt',
    params: [args.userOpHash],
  });
  if (result === null) {
    return [
      `=== eth_getUserOperationReceipt ===`,
      `userOpHash: ${args.userOpHash}`,
      ``,
      `Not yet bundled. The bundler returned null. Retry in a few seconds.`,
    ].join('\n');
  }
  return [
    `=== eth_getUserOperationReceipt ===`,
    `userOpHash: ${args.userOpHash}`,
    ``,
    JSON.stringify(result, null, 2),
  ].join('\n');
}

export async function handleAaTool(name: string, args: any): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let text: string;
  try {
    if (name === 'chaingpt_aa_userop_hash') text = await handleUserOpHash(args);
    else if (name === 'chaingpt_aa_pack_userop') text = await handleUserOpPack(args);
    else if (name === 'chaingpt_aa_estimate_userop') text = await handleEstimateUserOp(args);
    else if (name === 'chaingpt_aa_userop_receipt') text = await handleUserOpReceipt(args);
    else if (name === 'chaingpt_aa_submit_userop') text = await handleSubmitUserOp(args);
    else throw new Error(`Unknown AA tool: ${name}`);
  } catch (err: any) {
    text = `Error in ${name}: ${err.message}`;
  }
  return { content: [{ type: 'text', text }] };
}
