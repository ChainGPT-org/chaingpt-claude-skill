import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { type Hex } from 'viem';
import { CHAINS, resolveChain } from '../lib/chains.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-6.2 alternative DEX aggregators: 1inch v6 + CoW Protocol.
 *
 * The existing chaingpt_dex_* tools default to OpenOcean (no key, multi-chain).
 * These additions give users two alternatives:
 *
 *   1inch v6 — best routing on most pairs, more reliable on Ethereum mainnet.
 *              Requires ONEINCH_API_KEY (free tier at https://1inch.dev).
 *
 *   CoW Protocol — MEV-protected solver-based swaps. Best for large size where
 *                  sandwich attacks would eat the trade. Different signing model:
 *                  user signs an order intent (EIP-712), not a transaction.
 *                  CoW solvers find the best route and settle on-chain.
 */

const ONEINCH_BASE = 'https://api.1inch.dev/swap/v6.0';
const COW_API_BASE = 'https://api.cow.fi';

// 1inch supported chains (v6 — mainnet ids)
const ONEINCH_CHAINS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche'];

// CoW supports a subset of EVM mainnets
const COW_NETWORKS: Record<string, string> = {
  ethereum: 'mainnet',
  base: 'base',
  arbitrum: 'arbitrum_one',
};

// CoW GPv2 Settlement contract (same address on all CoW-supported chains via CREATE2)
const COW_SETTLEMENT: Hex = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';

// CoW Vault Relayer (this is what users approve for ERC-20 spending)
const COW_VAULT_RELAYER: Hex = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110';

function oneinchKey(): string | null {
  return process.env.ONEINCH_API_KEY?.trim() || null;
}

function oneinchHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, accept: 'application/json' };
}

const NATIVE_ADDR_1INCH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
function normalize(addr: string): string {
  if (!addr) return addr;
  const lower = addr.toLowerCase();
  if (lower === '0x0000000000000000000000000000000000000000') return NATIVE_ADDR_1INCH;
  return lower;
}

export const aggregatorTools: Tool[] = [
  // ─── 1inch v6 ─────────────────────────────────────────────────────
  {
    name: 'chaingpt_dex_1inch_quote',
    description:
      'Get a swap quote from 1inch v6. Generally better routing than OpenOcean on Ethereum + L2s for large ' +
      'pairs. Requires ONEINCH_API_KEY (free tier at https://1inch.dev). Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: ONEINCH_CHAINS, description: 'EVM chain.' },
        inToken: { type: 'string', description: 'Input token contract (0x… or 0x0000…0000 for native).' },
        outToken: { type: 'string', description: 'Output token contract.' },
        amountIn: { type: 'string', description: 'Decimal amount of input token, e.g. "1.5".' },
        decimalsIn: { type: 'number', description: 'Input token decimals.' },
      },
      required: ['network', 'inToken', 'outToken', 'amountIn', 'decimalsIn'],
    },
  },
  {
    name: 'chaingpt_dex_1inch_swap_tx',
    description:
      'Build an UNSIGNED 1inch v6 swap transaction. Requires ONEINCH_API_KEY + acknowledgeMainnet=true. ' +
      'The user must approve the 1inch router to spend the input token first (use chaingpt_dex_approve_tx with ' +
      'spender=<router address from quote response>). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: ONEINCH_CHAINS },
        inToken: { type: 'string' },
        outToken: { type: 'string' },
        amountIn: { type: 'string' },
        decimalsIn: { type: 'number' },
        from: { type: 'string', description: 'Signer / from address (0x…).' },
        slippageBps: { type: 'number', description: 'Max slippage in basis points. Default 100 (1%).', default: 100 },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['network', 'inToken', 'outToken', 'amountIn', 'decimalsIn', 'from'],
    },
  },

  // ─── CoW Protocol ─────────────────────────────────────────────────
  {
    name: 'chaingpt_dex_cow_create_order',
    description:
      'Create a CoW Protocol swap order. CoW uses an intent model: instead of returning a tx, this returns ' +
      'the order shape + EIP-712 typed data the user signs. CoW solvers then settle the swap on-chain. ' +
      'Best for large swaps where MEV sandwich attacks would otherwise eat the trade. ' +
      'Refuses mainnet without acknowledgeMainnet=true. Supports Ethereum mainnet, Base, Arbitrum One. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: Object.keys(COW_NETWORKS) },
        sellToken: { type: 'string', description: 'Token being sold (0x…). Native ETH not supported on CoW — wrap to WETH first.' },
        buyToken: { type: 'string', description: 'Token being bought (0x…).' },
        sellAmount: { type: 'string', description: 'Decimal amount of sellToken.' },
        sellDecimals: { type: 'number' },
        from: { type: 'string', description: 'Order owner (0x…).' },
        slippageBps: { type: 'number', description: 'Max slippage in bps. Default 100 (1%).', default: 100 },
        validForMinutes: { type: 'number', description: 'How long the order is valid. Default 30.', default: 30 },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['network', 'sellToken', 'buyToken', 'sellAmount', 'sellDecimals', 'from'],
    },
  },
  {
    name: 'chaingpt_dex_cow_submit_signed_order',
    description:
      'Submit a signed CoW Protocol order. The user signs the order returned by chaingpt_dex_cow_create_order ' +
      'externally (eth_signTypedData_v4), then passes the order + signature here. Returns the order UID which ' +
      'can be tracked on https://explorer.cow.fi. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: Object.keys(COW_NETWORKS) },
        order: { description: 'The order object exactly as returned by create_order.' },
        signature: { type: 'string', description: '0x-prefixed signature from eth_signTypedData_v4.' },
        signingScheme: {
          type: 'string',
          enum: ['eip712', 'ethsign', 'presign'],
          description: 'Signing scheme. Default eip712 (most wallets).',
          default: 'eip712',
        },
      },
      required: ['network', 'order', 'signature'],
    },
  },
];

function formatAmount(raw: string, decimals: number, decimalsToShow = 4): string {
  try {
    const wei = BigInt(raw);
    const div = 10n ** BigInt(decimals);
    const whole = wei / div;
    const frac = wei % div;
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, decimalsToShow);
    return `${whole}.${fracStr}`;
  } catch {
    return raw;
  }
}

function rawAmount(decimal: string, decimals: number): bigint {
  // Parse "1.5" into raw integer string with `decimals` decimals
  const [intPart, fracPart = ''] = decimal.split('.');
  const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}

export async function handleAggregatorTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) return { content: [{ type: 'text', text: 'No arguments provided.' }] };

  try {
    // ── 1inch ────────────────────────────────────────────────────────
    if (name === 'chaingpt_dex_1inch_quote' || name === 'chaingpt_dex_1inch_swap_tx') {
      const key = oneinchKey();
      if (!key) {
        return {
          content: [{
            type: 'text',
            text:
              `1inch v6 requires ONEINCH_API_KEY. Get a free key at https://1inch.dev (Developer Portal → ` +
              `My APIs → Create new). Then export ONEINCH_API_KEY=<your-key>. Free tier covers ~1 req/sec.\n\n` +
              `Alternatively, use chaingpt_dex_quote (defaults to OpenOcean — no key required).`,
          }],
        };
      }
      const network = String(args.network);
      const chain = resolveChain(network);
      if (!chain?.chainId) {
        return { content: [{ type: 'text', text: `Unsupported 1inch chain: ${network}` }] };
      }
      const inToken = normalize(String(args.inToken));
      const outToken = normalize(String(args.outToken));
      const decimalsIn = Number(args.decimalsIn);
      const amount = rawAmount(String(args.amountIn), decimalsIn).toString();

      if (name === 'chaingpt_dex_1inch_swap_tx' && !args.acknowledgeMainnet) {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ Mainnet swap refused. Pass acknowledgeMainnet: true to receive the 1inch unsigned tx. ` +
              `Pre-flight: run chaingpt_risk_token on the outToken first.`,
          }],
        };
      }

      const isSwap = name === 'chaingpt_dex_1inch_swap_tx';
      const path = isSwap ? 'swap' : 'quote';
      const params = new URLSearchParams({ src: inToken, dst: outToken, amount });
      if (isSwap) {
        params.set('from', String(args.from));
        params.set('slippage', String(Number(args.slippageBps ?? 100) / 100));
      }
      const url = `${ONEINCH_BASE}/${chain.chainId}/${path}?${params.toString()}`;
      const res = await httpJson<any>(url, { headers: oneinchHeaders(key) });
      if (!res || res.error || res.statusCode) {
        return {
          content: [{
            type: 'text',
            text: `1inch ${path} failed: ${JSON.stringify(res, null, 2).slice(0, 500)}`,
          }],
        };
      }

      const lines: string[] = [];
      lines.push(`${isSwap ? '1inch v6 swap' : '1inch v6 quote'} — ${chain.name}`);
      lines.push('');
      const inSym = res?.srcToken?.symbol ?? res?.fromToken?.symbol ?? '?';
      const outSym = res?.dstToken?.symbol ?? res?.toToken?.symbol ?? '?';
      const outAmt = res?.dstAmount ?? res?.toAmount ?? res?.toTokenAmount ?? '0';
      lines.push(`In:              ${args.amountIn} ${inSym}`);
      lines.push(`Out (expected):  ${formatAmount(outAmt, Number(res?.dstToken?.decimals ?? res?.toToken?.decimals ?? 18))} ${outSym}`);
      if (res.gas) lines.push(`Est. gas:        ${res.gas}`);
      if (res.protocols && Array.isArray(res.protocols)) {
        const protoNames = res.protocols.flat(2).map((p: any) => p.name).filter(Boolean);
        lines.push(`Route:           ${[...new Set(protoNames)].slice(0, 5).join(' → ')}`);
      }

      if (isSwap && res.tx) {
        lines.push('');
        lines.push('--- Unsigned transaction ---');
        lines.push(JSON.stringify({
          chainId: chain.chainId,
          to: res.tx.to,
          data: res.tx.data,
          value: res.tx.value ? '0x' + BigInt(res.tx.value).toString(16) : '0x0',
          gas: res.tx.gas ? '0x' + BigInt(res.tx.gas).toString(16) : undefined,
        }, null, 2));
        lines.push('');
        lines.push(`Reminder: approve ${res.tx.to} on the inToken first if it's an ERC-20.`);
      } else if (!isSwap) {
        lines.push('');
        lines.push('Next: chaingpt_dex_1inch_swap_tx with same params + acknowledgeMainnet: true.');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── CoW Protocol ─────────────────────────────────────────────────
    if (name === 'chaingpt_dex_cow_create_order') {
      if (!args.acknowledgeMainnet) {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ CoW order refused without acknowledgeMainnet. CoW orders are real-money trades — once ` +
              `signed and submitted, solvers will execute them. Run a fresh chaingpt_risk_token on the buyToken ` +
              `before flipping the flag.`,
          }],
        };
      }
      const network = String(args.network);
      const cowNet = COW_NETWORKS[network];
      if (!cowNet) {
        return { content: [{ type: 'text', text: `CoW does not support ${network}.` }] };
      }
      const sellToken = String(args.sellToken).toLowerCase() as Hex;
      const buyToken = String(args.buyToken).toLowerCase() as Hex;
      const sellDecimals = Number(args.sellDecimals);
      const sellAmount = rawAmount(String(args.sellAmount), sellDecimals);
      const slippageBps = Number(args.slippageBps ?? 100);
      const validForMin = Number(args.validForMinutes ?? 30);
      const validTo = Math.floor(Date.now() / 1000) + validForMin * 60;
      const from = String(args.from).toLowerCase() as Hex;

      // Quote first to get the buy amount + fee
      const quoteRes = await httpJson<any>(`${COW_API_BASE}/${cowNet}/api/v1/quote`, {
        method: 'POST',
        body: {
          sellToken,
          buyToken,
          from,
          receiver: from,
          sellAmountBeforeFee: sellAmount.toString(),
          kind: 'sell',
          partiallyFillable: false,
          appData: '0x0000000000000000000000000000000000000000000000000000000000000000',
        },
      });
      const q = quoteRes.quote;
      if (!q) {
        return {
          content: [{
            type: 'text',
            text: `CoW quote failed: ${JSON.stringify(quoteRes, null, 2).slice(0, 500)}`,
          }],
        };
      }

      // Apply slippage to buyAmount: buyAmountMin = buyAmount * (10000 - slippage) / 10000
      const buyAmountMin = (BigInt(q.buyAmount) * BigInt(10_000 - slippageBps)) / 10_000n;

      const order = {
        sellToken: q.sellToken,
        buyToken: q.buyToken,
        receiver: q.receiver ?? from,
        sellAmount: q.sellAmount,
        buyAmount: buyAmountMin.toString(),
        validTo,
        appData: q.appData ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
        feeAmount: q.feeAmount,
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
      };

      const chainId = resolveChain(network)?.chainId ?? 1;
      const typedData = {
        domain: {
          name: 'Gnosis Protocol',
          version: 'v2',
          chainId,
          verifyingContract: COW_SETTLEMENT,
        },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          Order: [
            { name: 'sellToken', type: 'address' },
            { name: 'buyToken', type: 'address' },
            { name: 'receiver', type: 'address' },
            { name: 'sellAmount', type: 'uint256' },
            { name: 'buyAmount', type: 'uint256' },
            { name: 'validTo', type: 'uint32' },
            { name: 'appData', type: 'bytes32' },
            { name: 'feeAmount', type: 'uint256' },
            { name: 'kind', type: 'string' },
            { name: 'partiallyFillable', type: 'bool' },
            { name: 'sellTokenBalance', type: 'string' },
            { name: 'buyTokenBalance', type: 'string' },
          ],
        },
        primaryType: 'Order',
        message: order,
      };

      const lines = [
        `CoW Protocol order — ${network}`,
        '',
        `Sell:                 ${formatAmount(order.sellAmount, sellDecimals)} ${sellToken}`,
        `Min receive:          ${order.buyAmount} (raw units of ${buyToken})`,
        `Fee:                  ${order.feeAmount} (raw units of ${sellToken}, paid by CoW solver from sellAmount)`,
        `Valid for:            ${validForMin}min`,
        `Slippage:             ${slippageBps / 100}%`,
        '',
        'Pre-flight (BEFORE signing):',
        `  chaingpt_dex_approve_tx network=${network} token=${sellToken} spender=${COW_VAULT_RELAYER}`,
        '  (CoW uses a Vault Relayer for ERC-20 spending; one-time approval per token)',
        '',
        '--- EIP-712 typed data (sign via eth_signTypedData_v4) ---',
        JSON.stringify(typedData, null, 2),
        '',
        '--- order (pass back to submit_signed_order) ---',
        JSON.stringify(order, null, 2),
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_dex_cow_submit_signed_order') {
      const network = String(args.network);
      const cowNet = COW_NETWORKS[network];
      if (!cowNet) {
        return { content: [{ type: 'text', text: `CoW does not support ${network}.` }] };
      }
      const order = args.order as Record<string, unknown>;
      const signature = String(args.signature);
      const signingScheme = String(args.signingScheme ?? 'eip712');

      const body = { ...order, signature, signingScheme };
      const res = await fetch(`${COW_API_BASE}/${cowNet}/api/v1/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      // CoW returns the order UID as a quoted string on success
      let uid: string | null = null;
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string') uid = parsed;
      } catch { /* fall through */ }

      const lines = [
        `CoW Protocol /orders response (HTTP ${res.status}):`,
        '',
        uid ? `✓ Order UID: ${uid}` : `Response: ${text.slice(0, 500)}`,
        '',
        uid ? `Track at: https://explorer.cow.fi/orders/${uid}` : '',
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown aggregator tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Aggregator error: ${message}`);
  }
}
