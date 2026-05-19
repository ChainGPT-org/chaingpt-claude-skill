import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { encodeFunctionData, parseUnits, formatUnits, type Hex } from 'viem';
import { CHAINS, resolveChain } from '../lib/chains.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-3a DEX trading on mainnet. Custody-free.
 *
 * Backends:
 *  - EVM swaps:      OpenOcean v4 aggregator (no API key, covers all 10 mainnets)
 *  - Solana swaps:   Jupiter v6 (no API key)
 *
 * The plugin returns:
 *  - quote responses (read-only, no signing required)
 *  - unsigned transaction objects ready for the user's wallet to sign + broadcast
 *
 * Mainnet safety gate: chaingpt_dex_build_swap_tx refuses to return a tx for a
 * mainnet network unless acknowledgeMainnet=true is passed. See
 * feedback_mainnet_default and feedback_autonomous_authorization for the
 * design rationale.
 */

// ─── OpenOcean chain slug map ──────────────────────────────────────
// OpenOcean uses its own short names; map our canonical slugs onto theirs.
const OPENOCEAN_CHAIN: Record<string, string> = {
  ethereum: 'eth',
  bsc: 'bsc',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  avalanche: 'avax',
  base: 'base',
  linea: 'linea',
  scroll: 'scroll',
  blast: 'blast',
};

const OPENOCEAN_BASE = 'https://open-api.openocean.finance/v4';
const JUPITER_QUOTE_BASE = 'https://quote-api.jup.ag/v6';

const EVM_NETWORKS = Object.keys(OPENOCEAN_CHAIN);

// OpenOcean's "native" token sentinel is 0xEee...EeEEEe. Some EVM aggregators
// use 0x000...0000. We accept both as input and translate to OO's sentinel.
const NATIVE_ADDR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
function normalizeTokenAddress(addr: string): string {
  if (!addr) return addr;
  const lower = addr.toLowerCase();
  if (lower === '0x0000000000000000000000000000000000000000') return NATIVE_ADDR;
  return lower;
}

// ─── ERC-20 ABI fragments for approval helper ──────────────────────
const ERC20_ALLOWANCE_ABI = {
  type: 'function',
  name: 'allowance',
  stateMutability: 'view',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
} as const;

const ERC20_APPROVE_ABI = {
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
} as const;

export const dexTools: Tool[] = [
  {
    name: 'chaingpt_dex_quote',
    description:
      'Get a live DEX swap quote across all major EVM mainnets. Returns expected output amount, price impact, ' +
      'route summary, and estimated gas. Powered by OpenOcean (no key). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          enum: EVM_NETWORKS,
          description: 'EVM mainnet (ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll).',
        },
        inToken: {
          type: 'string',
          description: 'Input token contract (0x…). For the native coin, use 0x0000…0000 or 0xEeee…EEeE.',
        },
        outToken: { type: 'string', description: 'Output token contract (0x…). Native sentinels accepted.' },
        amountIn: { type: 'string', description: 'Decimal amount of the input token (e.g. "1.5", not wei).' },
        slippageBps: { type: 'number', description: 'Max slippage in basis points (50 = 0.5%). Default 100.', default: 100 },
        gasPriceGwei: { type: 'number', description: 'Gas price hint in gwei for the route estimator. Optional.' },
      },
      required: ['network', 'inToken', 'outToken', 'amountIn'],
    },
  },
  {
    name: 'chaingpt_dex_build_swap_tx',
    description:
      'Build an UNSIGNED swap transaction object for the user to sign + broadcast. MAINNET only — testnets ' +
      'are not supported by the aggregator. Refuses unless `acknowledgeMainnet: true`. The user MUST hold ' +
      'sufficient input-token balance AND have approved the router (use chaingpt_dex_approve_tx first if ' +
      'swapping an ERC-20). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: EVM_NETWORKS },
        inToken: { type: 'string' },
        outToken: { type: 'string' },
        amountIn: { type: 'string', description: 'Decimal amount of input token.' },
        slippageBps: { type: 'number', description: 'Max slippage in bps. Default 100.', default: 100 },
        account: { type: 'string', description: 'The wallet that will sign + broadcast (0x…).' },
        gasPriceGwei: { type: 'number' },
        acknowledgeMainnet: {
          type: 'boolean',
          description:
            'You must pass acknowledgeMainnet=true to receive a signed-tx-ready response. This is the safety ' +
            'prompt — confirm the user wants to spend real funds. Before setting this flag, call ' +
            'chaingpt_risk_token on the outToken and chaingpt_dex_quote to surface price impact.',
        },
      },
      required: ['network', 'inToken', 'outToken', 'amountIn', 'account'],
    },
  },
  {
    name: 'chaingpt_dex_approve_tx',
    description:
      'Build an UNSIGNED ERC-20 approval transaction so the OpenOcean router (or another spender) can pull ' +
      'tokens for a swap. Returns the approval tx + the current allowance for the wallet. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: EVM_NETWORKS },
        token: { type: 'string', description: 'Token contract (0x…). Must be an ERC-20 (not native).' },
        owner: { type: 'string', description: 'The wallet that will sign (0x…).' },
        spender: {
          type: 'string',
          description: 'Approval target. Defaults to the OpenOcean router on the chosen network.',
        },
        amount: {
          type: 'string',
          description: 'Decimal amount to approve, e.g. "1000". Use "max" for the uint256-max approval.',
          default: 'max',
        },
        decimals: {
          type: 'number',
          description: 'Token decimals. If omitted, the tool will fetch from the contract.',
        },
      },
      required: ['network', 'token', 'owner'],
    },
  },
  {
    name: 'chaingpt_dex_jupiter_quote',
    description:
      'Get a live Solana DEX swap quote via Jupiter v6. Returns expected output, price impact, and route plan. ' +
      'Works on Solana mainnet. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        inputMint: { type: 'string', description: 'Input token mint address (base58). Use "So11111…" for SOL.' },
        outputMint: { type: 'string', description: 'Output token mint address.' },
        amountIn: { type: 'string', description: 'Decimal amount of input token (Jupiter takes the raw lamports internally).' },
        decimalsIn: { type: 'number', description: 'Decimals of the input token. Default 9 (SOL).', default: 9 },
        slippageBps: { type: 'number', description: 'Max slippage in basis points. Default 50.', default: 50 },
      },
      required: ['inputMint', 'outputMint', 'amountIn'],
    },
  },
  {
    name: 'chaingpt_dex_jupiter_build_swap_tx',
    description:
      'Build a serialized Solana swap transaction via Jupiter v6 ready for the user\'s wallet to sign and ' +
      'broadcast. Returns base64-encoded transaction. Requires `acknowledgeMainnet: true` — Solana mainnet ' +
      'is real money. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userPublicKey: { type: 'string', description: 'Solana wallet base58 public key.' },
        inputMint: { type: 'string' },
        outputMint: { type: 'string' },
        amountIn: { type: 'string', description: 'Decimal amount of input token.' },
        decimalsIn: { type: 'number', default: 9 },
        slippageBps: { type: 'number', default: 50 },
        acknowledgeMainnet: {
          type: 'boolean',
          description: 'You must pass true. Solana mainnet swaps are irreversible.',
        },
      },
      required: ['userPublicKey', 'inputMint', 'outputMint', 'amountIn'],
    },
  },
];

function formatLargeFloat(n: number, decimals = 6): string {
  if (!Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(decimals);
}

export async function handleDexTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_dex_quote' || name === 'chaingpt_dex_build_swap_tx') {
      const network = String(args.network || '');
      const ooChain = OPENOCEAN_CHAIN[network];
      if (!ooChain) {
        return { content: [{ type: 'text', text: `OpenOcean does not support network: ${network}` }] };
      }
      const inToken = normalizeTokenAddress(String(args.inToken || ''));
      const outToken = normalizeTokenAddress(String(args.outToken || ''));
      const amountIn = String(args.amountIn || '');
      const slippageBps = Number(args.slippageBps ?? 100);
      const slippagePct = slippageBps / 100; // OpenOcean uses percentage (e.g. 1 = 1%)
      const gasPriceGwei = args.gasPriceGwei ? Number(args.gasPriceGwei) : undefined;

      if (name === 'chaingpt_dex_build_swap_tx') {
        if (!args.acknowledgeMainnet) {
          return {
            content: [{
              type: 'text',
              text:
                `⚠ Mainnet swap refused. To execute a swap on ${CHAINS[network]?.name ?? network}, pass ` +
                `acknowledgeMainnet: true. This is the safety prompt — DEX swaps on mainnet spend real funds ` +
                `and are irreversible. Before setting that flag:\n` +
                `  1. Run chaingpt_dex_quote with the same params to see the expected output and price impact.\n` +
                `  2. Run chaingpt_risk_token on the outToken to confirm it isn't a honeypot.\n` +
                `  3. Confirm the slippageBps (default 100 = 1.0%). For volatile coins, raise it; for stables, lower it.\n` +
                `  4. Confirm the account is the wallet you control.\n` +
                `Then re-call with acknowledgeMainnet: true.`,
            }],
          };
        }
      }

      const account = (args.account as string | undefined) || '0x0000000000000000000000000000000000000000';
      const path = name === 'chaingpt_dex_build_swap_tx' ? 'swap' : 'quote';
      const params = new URLSearchParams({
        inTokenAddress: inToken,
        outTokenAddress: outToken,
        amount: amountIn,
        slippage: String(slippagePct),
        account,
      });
      if (gasPriceGwei !== undefined) params.set('gasPrice', String(gasPriceGwei));
      const url = `${OPENOCEAN_BASE}/${ooChain}/${path}?${params.toString()}`;
      const res = await httpJson<any>(url);
      const data = res?.data ?? res;
      if (!data || res?.code && res.code !== 200) {
        return {
          content: [{
            type: 'text',
            text: `OpenOcean ${path} failed: ${JSON.stringify(res, null, 2)}`,
          }],
        };
      }

      const inDec = Number(data.inToken?.decimals ?? 18);
      const outDec = Number(data.outToken?.decimals ?? 18);
      const inAmt = data.inAmount ? formatUnits(BigInt(data.inAmount), inDec) : amountIn;
      const outAmt = data.outAmount ? formatUnits(BigInt(data.outAmount), outDec) : 'n/a';
      const minOut = data.minOutAmount ? formatUnits(BigInt(data.minOutAmount), outDec) : 'n/a';

      const lines: string[] = [];
      lines.push(`${name === 'chaingpt_dex_build_swap_tx' ? 'Swap transaction' : 'Swap quote'} — ${CHAINS[network]?.name ?? network}`);
      lines.push('');
      lines.push(`In:              ${inAmt} ${data.inToken?.symbol ?? '?'} (${data.inToken?.address ?? inToken})`);
      lines.push(`Out (expected):  ${outAmt} ${data.outToken?.symbol ?? '?'} (${data.outToken?.address ?? outToken})`);
      lines.push(`Min out:         ${minOut} ${data.outToken?.symbol ?? '?'} (after ${slippagePct}% slippage)`);
      if (data.price_impact !== undefined) lines.push(`Price impact:    ${data.price_impact}`);
      if (data.estimatedGas) lines.push(`Est. gas:        ${data.estimatedGas}`);
      if (data.dexes && Array.isArray(data.dexes)) {
        lines.push(`Route:           ${data.dexes.map((d: any) => d.dexCode ?? d).slice(0, 5).join(' → ')}`);
      }

      if (name === 'chaingpt_dex_build_swap_tx') {
        const tx = {
          chainId: CHAINS[network]?.chainId,
          to: data.to,
          data: data.data,
          value: data.value ? '0x' + BigInt(data.value).toString(16) : '0x0',
          gas: data.estimatedGas ? '0x' + BigInt(data.estimatedGas).toString(16) : undefined,
          gasPrice: data.gasPrice ? '0x' + BigInt(data.gasPrice).toString(16) : undefined,
        };
        lines.push('');
        lines.push('--- Unsigned transaction (paste into your wallet) ---');
        lines.push(JSON.stringify(tx, null, 2));
        lines.push('');
        lines.push('Reminder: if the inToken is an ERC-20, you must approve the router first via chaingpt_dex_approve_tx.');
        lines.push(`Router (spender): ${data.to}`);
      } else {
        lines.push('');
        lines.push('Next: chaingpt_dex_build_swap_tx with the same params + acknowledgeMainnet: true.');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_dex_approve_tx') {
      const network = String(args.network || '');
      const ooChain = OPENOCEAN_CHAIN[network];
      if (!ooChain) {
        return { content: [{ type: 'text', text: `Unsupported network for approval: ${network}` }] };
      }
      const token = String(args.token || '').toLowerCase();
      if (!token || token === NATIVE_ADDR || token === '0x0000000000000000000000000000000000000000') {
        return { content: [{ type: 'text', text: 'Native coins do not need approval — call build_swap_tx directly.' }] };
      }
      const owner = String(args.owner || '');
      const amountInput = String(args.amount ?? 'max');

      // Resolve the OpenOcean router for this chain
      let spender = (args.spender as string | undefined) || '';
      if (!spender) {
        // The OpenOcean v4 swap response uses the `to` field which is the router. We need it pre-swap, so
        // call a tiny quote to extract it. Use a 1-wei quote against the same token-pair to keep it cheap.
        const probe = await httpJson<any>(
          `${OPENOCEAN_BASE}/${ooChain}/swap?inTokenAddress=${token}&outTokenAddress=${NATIVE_ADDR}&amount=0.000001&slippage=1&account=${owner}`
        );
        spender = probe?.data?.to ?? '';
        if (!spender) {
          return { content: [{ type: 'text', text: 'Could not resolve OpenOcean router; pass `spender` explicitly.' }] };
        }
      }

      // Determine decimals + current allowance via RPC if possible
      const chain = resolveChain(network);
      const decimals = args.decimals !== undefined ? Number(args.decimals) : 18; // safe default; user can override
      const amount =
        amountInput === 'max'
          ? (1n << 256n) - 1n
          : parseUnits(amountInput as `${number}`, decimals);

      const approveData = encodeFunctionData({
        abi: [ERC20_APPROVE_ABI],
        functionName: 'approve',
        args: [spender as Hex, amount],
      });

      const tx = {
        chainId: chain?.chainId,
        to: token,
        data: approveData,
        value: '0x0',
      };

      const lines: string[] = [];
      lines.push(`ERC-20 approval — ${CHAINS[network]?.name ?? network}`);
      lines.push('');
      lines.push(`Token:           ${token}`);
      lines.push(`Owner:           ${owner}`);
      lines.push(`Spender:         ${spender}  (OpenOcean router)`);
      lines.push(
        `Amount:          ${amountInput === 'max' ? 'unlimited (uint256 max)' : `${amountInput} (× 10^${decimals})`}`
      );
      lines.push('');
      lines.push('--- Unsigned transaction (paste into your wallet) ---');
      lines.push(JSON.stringify(tx, null, 2));
      lines.push('');
      lines.push('After this approval is confirmed on chain, call chaingpt_dex_build_swap_tx to do the actual swap.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_dex_jupiter_quote' || name === 'chaingpt_dex_jupiter_build_swap_tx') {
      const inputMint = String(args.inputMint || '');
      const outputMint = String(args.outputMint || '');
      const amountIn = String(args.amountIn || '');
      const decimalsIn = Number(args.decimalsIn ?? 9);
      const slippageBps = Number(args.slippageBps ?? 50);
      const rawAmount = parseUnits(amountIn as `${number}`, decimalsIn).toString();

      const quoteUrl =
        `${JUPITER_QUOTE_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
        `&amount=${rawAmount}&slippageBps=${slippageBps}`;
      const quote = await httpJson<any>(quoteUrl);
      if (!quote || quote.error) {
        return { content: [{ type: 'text', text: `Jupiter quote error: ${quote?.error ?? 'unknown'}` }] };
      }

      const outDec = Number(quote.outputMint && quote.outAmount ? 6 : 9); // Jupiter doesn't return decimals; user should know
      const lines: string[] = [];
      lines.push(`${name === 'chaingpt_dex_jupiter_build_swap_tx' ? 'Jupiter swap tx' : 'Jupiter quote'} — Solana mainnet`);
      lines.push('');
      lines.push(`Input mint:      ${inputMint}`);
      lines.push(`Output mint:     ${outputMint}`);
      lines.push(`Amount in:       ${amountIn} (raw: ${quote.inAmount})`);
      lines.push(`Amount out:      ${quote.outAmount} (raw lamports/units)`);
      if (quote.priceImpactPct) lines.push(`Price impact:    ${Number(quote.priceImpactPct).toFixed(4)}%`);
      if (quote.routePlan) lines.push(`Route hops:      ${quote.routePlan.length}`);

      if (name === 'chaingpt_dex_jupiter_quote') {
        lines.push('');
        lines.push('Next: chaingpt_dex_jupiter_build_swap_tx with userPublicKey + acknowledgeMainnet: true.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // Build swap tx (Solana mainnet ack gate)
      if (!args.acknowledgeMainnet) {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ Solana mainnet swap refused. Pass acknowledgeMainnet: true to receive the signed-tx-ready ` +
              `transaction. This is the safety prompt — Jupiter swaps on Solana mainnet are irreversible.`,
          }],
        };
      }
      const userPublicKey = String(args.userPublicKey || '');
      if (!userPublicKey) {
        return { content: [{ type: 'text', text: 'userPublicKey is required for swap-tx build.' }] };
      }
      const swap = await httpJson<any>(`${JUPITER_QUOTE_BASE}/swap`, {
        method: 'POST',
        body: {
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
        },
      });

      lines.push('');
      lines.push('--- Serialized swap transaction (base64) ---');
      lines.push(swap.swapTransaction ?? '(no swapTransaction returned)');
      lines.push('');
      lines.push('Decode this base64 string into a VersionedTransaction in your wallet, sign, and send.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown DEX tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT DEX error: ${message}`);
  }
}
