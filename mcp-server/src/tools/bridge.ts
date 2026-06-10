import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { encodeFunctionData, parseUnits, type Address, type Hex } from 'viem';
import { CHAINS, resolveChain } from '../lib/chains.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-6.1 cross-chain bridging. Custody-free.
 *
 * Across Protocol v3 is the highest-volume intent-based bridge by quote count.
 * https://docs.across.to/reference/api-reference
 *
 * Flow:
 *   1. chaingpt_bridge_quote — suggested fees + fill-time estimate
 *   2. chaingpt_bridge_build_deposit_tx — unsigned `depositV3` tx for the user's wallet
 *   3. user signs externally, broadcasts the deposit on origin chain
 *   4. relayer fills the destination side ~seconds later
 *
 * Token approval to the SpokePool contract is required before depositV3 if the
 * input token is ERC-20 (not native). Same chaingpt_dex_approve_tx flow.
 */

const ACROSS_BASE = 'https://app.across.to/api';

const ACROSS_CHAINS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'linea', 'scroll'];

// Across SpokePool v3 depositV3 ABI
const SPOKE_POOL_ABI = [
  {
    type: 'function',
    name: 'depositV3',
    stateMutability: 'payable',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'address' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityDeadline', type: 'uint32' },
      { name: 'message', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export const bridgeTools: Tool[] = [
  {
    name: 'chaingpt_bridge_quote',
    description:
      'Get a cross-chain bridge quote via Across Protocol v3. Returns fees (capital + gas + LP), estimated ' +
      'fill time, and SpokePool addresses. Covers all major EVM mainnets (Ethereum, Base, Arbitrum, Optimism, ' +
      'Polygon, BSC, Avalanche, Blast, Linea, Scroll). Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        inputToken: { type: 'string', description: 'Token contract on the origin chain (0x…).' },
        outputToken: { type: 'string', description: 'Token contract on the destination chain (0x…).' },
        originChain: { type: 'string', enum: ACROSS_CHAINS, description: 'Origin chain slug.' },
        destinationChain: { type: 'string', enum: ACROSS_CHAINS, description: 'Destination chain slug.' },
        amount: { type: 'string', description: 'Amount to bridge as decimal string, e.g. "100".' },
        decimals: { type: 'number', description: 'Token decimals (USDC=6, most ERC-20s=18).' },
      },
      required: ['inputToken', 'outputToken', 'originChain', 'destinationChain', 'amount', 'decimals'],
    },
  },
  {
    name: 'chaingpt_bridge_build_deposit_tx',
    description:
      'Build an UNSIGNED Across V3 depositV3 transaction for the user\'s wallet to sign + broadcast on the ' +
      'origin chain. Pre-requisite: the user must have approved the SpokePool contract to spend the input ' +
      'token (use chaingpt_dex_approve_tx with spender=<spokePoolAddress from quote>). Requires ' +
      '`acknowledgeMainnet: true`. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        inputToken: { type: 'string' },
        outputToken: { type: 'string' },
        originChain: { type: 'string', enum: ACROSS_CHAINS },
        destinationChain: { type: 'string', enum: ACROSS_CHAINS },
        amount: { type: 'string' },
        decimals: { type: 'number' },
        depositor: { type: 'string', description: 'Signer address on the origin chain.' },
        recipient: { type: 'string', description: 'Recipient on the destination chain. Default: depositor.' },
        fillDeadlineMinutes: {
          type: 'number',
          description: 'How long the deposit is valid before it can be refunded. Default 240 (4h).',
          default: 240,
        },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['inputToken', 'outputToken', 'originChain', 'destinationChain', 'amount', 'decimals', 'depositor'],
    },
  },
  {
    name: 'chaingpt_bridge_status',
    description:
      'Check the status of an Across bridge deposit by transaction hash. Returns whether the deposit was ' +
      'observed on origin chain and whether the corresponding fill landed on destination. Read-only. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        depositTxHash: { type: 'string', description: 'The origin-chain deposit transaction hash.' },
        originChain: { type: 'string', enum: ACROSS_CHAINS },
      },
      required: ['depositTxHash', 'originChain'],
    },
  },
];

function formatFeeBps(pct: string): string {
  // Across returns 18-decimal fixed-point. 100000000000000 = 0.0001 = 0.01% = 1 bps.
  const bps = Number(BigInt(pct) / 10n ** 12n) / 100;
  return `${bps.toFixed(2)} bps`;
}

function formatAmount(raw: string, decimals: number, decimalsToShow = 4): string {
  const wei = BigInt(raw);
  const div = 10n ** BigInt(decimals);
  const whole = wei / div;
  const frac = wei % div;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, decimalsToShow);
  return `${whole}.${fracStr}`;
}

export async function handleBridgeTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) return { content: [{ type: 'text', text: 'No arguments provided.' }] };

  try {
    if (name === 'chaingpt_bridge_quote' || name === 'chaingpt_bridge_build_deposit_tx') {
      const inputToken = String(args.inputToken);
      const outputToken = String(args.outputToken);
      const originChainSlug = String(args.originChain);
      const destChainSlug = String(args.destinationChain);
      const originChain = resolveChain(originChainSlug);
      const destChain = resolveChain(destChainSlug);
      if (!originChain?.chainId || !destChain?.chainId) {
        return { content: [{ type: 'text', text: `Unsupported chain pair: ${originChainSlug} → ${destChainSlug}` }] };
      }
      if (originChain.chainId === destChain.chainId) {
        return { content: [{ type: 'text', text: 'Origin and destination chains must differ for bridging.' }] };
      }
      const decimals = Number(args.decimals);
      const amountRaw = parseUnits(String(args.amount) as `${number}`, decimals);

      if (name === 'chaingpt_bridge_build_deposit_tx' && args.acknowledgeMainnet !== true) {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ Mainnet bridge refused. To bridge ${args.amount} on ${originChain.name} → ${destChain.name}, ` +
              `pass acknowledgeMainnet: true. Bridges are NOT trustless rollbacks — once the deposit lands, ` +
              `funds are committed to the relayer fill. Before flipping the flag:\n` +
              `  1. Run chaingpt_bridge_quote with the same params to see fees + fill time.\n` +
              `  2. Confirm the SpokePool approval is in place (chaingpt_dex_approve_tx).\n` +
              `  3. Confirm depositor + recipient addresses match what you control.\n` +
              `Then re-call with acknowledgeMainnet: true.`,
          }],
        };
      }

      // Fetch quote — needed for both quote tool and build-tx tool (gives us spokePoolAddress + fees + outputAmount)
      const url =
        `${ACROSS_BASE}/suggested-fees?` +
        new URLSearchParams({
          inputToken,
          outputToken,
          originChainId: String(originChain.chainId),
          destinationChainId: String(destChain.chainId),
          amount: amountRaw.toString(),
        });
      const quote = await httpJson<any>(url);
      if (!quote || quote.message || !quote.spokePoolAddress) {
        return {
          content: [{
            type: 'text',
            text: `Across quote error: ${JSON.stringify(quote, null, 2).slice(0, 600)}`,
          }],
        };
      }

      const inputAmount = amountRaw;
      const relayFeeTotal = BigInt(quote.relayFeeTotal ?? quote.totalRelayFee?.total ?? '0');
      const lpFeeTotal = BigInt(quote.lpFee?.total ?? '0');
      // Prefer the API's authoritative outputAmount. Fallback math note:
      // Across v3's relayFeeTotal/totalRelayFee already INCLUDES the LP fee —
      // subtracting a separately-computed LP fee again double-counts it
      // (prior bug; LP fee stays as a display-only component below).
      const outputAmount = quote.outputAmount !== undefined
        ? BigInt(quote.outputAmount)
        : inputAmount - relayFeeTotal;
      if (outputAmount <= 0n) {
        return {
          content: [{
            type: 'text',
            text:
              `Across bridge refused: relay fee (${relayFeeTotal}) + LP fee (${lpFeeTotal}) ≥ input ` +
              `(${inputAmount}). Output would be ${outputAmount} (non-positive). Increase the input ` +
              `amount or pick a less-loaded route.`,
          }],
        };
      }

      const lines: string[] = [];
      lines.push(`${name === 'chaingpt_bridge_build_deposit_tx' ? 'Bridge transaction' : 'Bridge quote'} — ${originChain.name} → ${destChain.name}`);
      lines.push('');
      lines.push(`Input:                ${formatAmount(inputAmount.toString(), decimals)} ${inputToken}`);
      lines.push(`Expected output:      ${formatAmount(outputAmount.toString(), decimals)} ${outputToken}`);
      lines.push(`Relay fee (incl. LP): ${formatAmount(relayFeeTotal.toString(), decimals)}  (${formatFeeBps(quote.relayFeePct ?? '0')})`);
      lines.push(`  of which LP fee:    ${formatAmount(lpFeeTotal.toString(), decimals)}  (${formatFeeBps(quote.lpFeePct ?? '0')})`);
      lines.push(`Fill time (est):      ~${quote.estimatedFillTimeSec ?? '?'}s`);
      lines.push(`SpokePool (origin):   ${quote.spokePoolAddress}`);
      lines.push(`Quote block:          ${quote.quoteBlock}`);

      if (name === 'chaingpt_bridge_quote') {
        lines.push('');
        lines.push('Next:');
        lines.push(`  1. chaingpt_dex_approve_tx token=${inputToken} spender=${quote.spokePoolAddress} (if ERC-20)`);
        lines.push('  2. chaingpt_bridge_build_deposit_tx (same params + acknowledgeMainnet: true)');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // Build the unsigned depositV3 tx
      const depositor = String(args.depositor) as Address;
      const recipient = ((args.recipient as string | undefined) || depositor) as Address;
      const fillDeadlineMin = Number(args.fillDeadlineMinutes ?? 240);
      const now = Math.floor(Date.now() / 1000);
      const fillDeadline = now + fillDeadlineMin * 60;
      const exclusivityDeadline = Number(quote.exclusivityDeadline ?? 0);
      const exclusivityAbs = exclusivityDeadline > 0 ? now + exclusivityDeadline : 0;

      const data = encodeFunctionData({
        abi: SPOKE_POOL_ABI,
        functionName: 'depositV3',
        args: [
          depositor,
          recipient,
          inputToken as Address,
          outputToken as Address,
          inputAmount,
          outputAmount,
          BigInt(destChain.chainId),
          (quote.exclusiveRelayer ?? '0x0000000000000000000000000000000000000000') as Address,
          Number(quote.timestamp ?? now),
          fillDeadline,
          exclusivityAbs,
          '0x' as Hex,
        ],
      });

      // Native-coin bridging requires the value to equal inputAmount; ERC-20 sets value=0
      const isNative =
        inputToken.toLowerCase() === '0x0000000000000000000000000000000000000000' ||
        inputToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      const value = isNative ? inputAmount : 0n;

      const tx = {
        chainId: originChain.chainId,
        to: quote.spokePoolAddress,
        data,
        value: '0x' + value.toString(16),
      };

      lines.push('');
      lines.push(`Depositor:            ${depositor}`);
      lines.push(`Recipient:            ${recipient}`);
      lines.push(`Fill deadline:        ${fillDeadlineMin}min`);
      lines.push('');
      lines.push('--- Unsigned transaction (paste into your wallet) ---');
      lines.push(JSON.stringify(tx, null, 2));
      lines.push('');
      lines.push('Sign on the ORIGIN chain. Once mined, the relayer will fill on destination within ~seconds.');
      lines.push(`Track with: chaingpt_bridge_status depositTxHash=<hash> originChain=${originChainSlug}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_bridge_status') {
      const hash = String(args.depositTxHash);
      const originChain = resolveChain(String(args.originChain));
      if (!originChain?.chainId) {
        return { content: [{ type: 'text', text: 'Unsupported origin chain.' }] };
      }
      const url = `${ACROSS_BASE}/deposit/status?originChainId=${originChain.chainId}&depositTxHash=${hash}`;
      try {
        const status = await httpJson<any>(url);
        const lines = [
          `Across deposit status — ${hash}`,
          '',
          `Origin chain:    ${originChain.name}`,
          `Status:          ${status.status ?? 'unknown'}`,
          status.depositId !== undefined ? `Deposit id:      ${status.depositId}` : '',
          status.fillTxHash ? `Fill tx hash:    ${status.fillTxHash}` : '',
          status.destinationChainId ? `Filled on:       chainId ${status.destinationChainId}` : '',
        ].filter(Boolean);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{
            type: 'text',
            text:
              `Across status check failed: ${msg}\n` +
              `Deposit may not yet be indexed (Across indexer can lag ~30s). ` +
              `Alternatively, check the SpokePool event logs directly on the destination chain.`,
          }],
        };
      }
    }

    return { content: [{ type: 'text', text: `Unknown bridge tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Bridge error: ${message}`);
  }
}
