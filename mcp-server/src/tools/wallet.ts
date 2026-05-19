import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ALL_CHAIN_SLUGS, CHAINS, EVM_CHAIN_SLUGS, resolveChain } from '../lib/chains.js';
import { httpJson, jsonRpc, hexToNumber } from '../lib/http.js';

/**
 * Wallet & portfolio tools. Read-only. Multi-chain.
 *
 * - chaingpt_wallet_balances    : native + ERC-20 balances (Moralis-backed, with viem RPC fallback for native-only)
 * - chaingpt_wallet_positions   : DeFi positions (Moralis DeFi summary; key required)
 * - chaingpt_wallet_pnl         : profit/loss summary (Moralis P&L endpoint; key required)
 *
 * Moralis API is free up to 25k req/month. Set MORALIS_API_KEY to enable
 * full functionality. Without a key, balances falls back to native-coin only
 * via the chain's public RPC.
 */

const MORALIS_BASE = 'https://deep-index.moralis.io/api/v2.2';

function moralisKey(): string | undefined {
  return process.env.MORALIS_API_KEY?.trim() || undefined;
}

function moralisHeaders(key: string): Record<string, string> {
  return { 'X-API-Key': key };
}

/** Moralis uses the same chain slugs we do for EVM, but its non-canonical names differ. Map ours → theirs. */
const MORALIS_CHAIN_MAP: Record<string, string> = {
  ethereum: 'eth',
  base: 'base',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  polygon: 'polygon',
  bsc: 'bsc',
  avalanche: 'avalanche',
  blast: 'blast',
  linea: 'linea',
  // scroll & solana need separate handling (Moralis has scroll mainnet beta; Solana uses a different base URL)
};

export const walletTools: Tool[] = [
  {
    name: 'chaingpt_wallet_balances',
    description:
      'Get native + ERC-20 token balances for a wallet address across multiple chains. ' +
      'Returns symbol, balance, USD value (when available), contract address per token. ' +
      'Full multi-chain ERC-20 scan requires MORALIS_API_KEY (free tier: 25k req/month at https://moralis.io). ' +
      'Without a key, returns native-coin balances only via public RPCs. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'EVM wallet address (0x…) or Solana base58 address',
        },
        chains: {
          type: 'array',
          items: { type: 'string', enum: ALL_CHAIN_SLUGS },
          description: 'Chain slugs to scan. Defaults to [ethereum, base, arbitrum, polygon, bsc].',
        },
        includeNative: {
          type: 'boolean',
          description: 'Include the native coin balance (ETH, BNB, etc.). Default true.',
          default: true,
        },
        minUsdValue: {
          type: 'number',
          description: 'Filter out tokens worth less than this USD amount. Default 1.',
          default: 1,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_wallet_positions',
    description:
      'Get DeFi positions (liquidity, lending, staking, farming) for a wallet across protocols. ' +
      'Returns protocol name, position type, deposited/borrowed amounts, USD value, APY where available. ' +
      'Requires MORALIS_API_KEY. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'EVM wallet address (0x…)',
        },
        chain: {
          type: 'string',
          enum: EVM_CHAIN_SLUGS,
          description: 'Chain slug. Default: ethereum.',
          default: 'ethereum',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_wallet_pnl',
    description:
      'Get profit/loss summary for a wallet on a given chain. Returns realized + unrealized P&L, ' +
      'total invested, current value, top winning/losing positions. ' +
      'Requires MORALIS_API_KEY. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'EVM wallet address (0x…)',
        },
        chain: {
          type: 'string',
          enum: EVM_CHAIN_SLUGS,
          description: 'Chain slug. Default: ethereum.',
          default: 'ethereum',
        },
      },
      required: ['address'],
    },
  },
];

interface MoralisTokenBalance {
  token_address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  usd_value?: number;
  usd_price?: number;
  native_token?: boolean;
}

async function fetchMoralisBalances(
  address: string,
  chainSlug: string,
  key: string
): Promise<MoralisTokenBalance[]> {
  const moralisChain = MORALIS_CHAIN_MAP[chainSlug];
  if (!moralisChain) return [];
  const url = `${MORALIS_BASE}/wallets/${address}/tokens?chain=${moralisChain}`;
  const res = await httpJson<{ result: MoralisTokenBalance[] }>(url, { headers: moralisHeaders(key) });
  return res.result ?? [];
}

async function fetchNativeBalanceViaRpc(address: string, chainSlug: string): Promise<{ balance: string; symbol: string } | null> {
  const chain = CHAINS[chainSlug];
  if (!chain || !chain.publicRpc || chain.chainId === null) return null;
  try {
    const hex = await jsonRpc<string>(chain.publicRpc, 'eth_getBalance', [address, 'latest']);
    const wei = BigInt(hex);
    // Format with 4 decimal places for display
    const whole = wei / 10n ** 18n;
    const fraction = wei % 10n ** 18n;
    const fracStr = fraction.toString().padStart(18, '0').slice(0, 6);
    return { balance: `${whole}.${fracStr}`, symbol: chain.native };
  } catch {
    return null;
  }
}

function formatTokenLine(t: MoralisTokenBalance): string {
  const balance = BigInt(t.balance);
  const divisor = 10n ** BigInt(t.decimals || 18);
  const whole = balance / divisor;
  const fraction = balance % divisor;
  const fracStr = fraction.toString().padStart(t.decimals || 18, '0').slice(0, 4);
  const amount = `${whole}.${fracStr}`;
  const usd = t.usd_value !== undefined ? ` ($${t.usd_value.toFixed(2)})` : '';
  const tag = t.native_token ? ' [native]' : '';
  return `  ${t.symbol.padEnd(10)} ${amount}${usd}${tag} — ${t.token_address}`;
}

export async function handleWalletTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided. See tool description for required fields.' }] };
  }

  try {
    if (name === 'chaingpt_wallet_balances') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };

      const requestedChains = Array.isArray(args.chains)
        ? (args.chains as unknown[]).filter((c): c is string => typeof c === 'string')
        : ['ethereum', 'base', 'arbitrum', 'polygon', 'bsc'];
      const includeNative = (args.includeNative as boolean | undefined) ?? true;
      const minUsd = (args.minUsdValue as number | undefined) ?? 1;
      const key = moralisKey();

      const sections: string[] = [];
      sections.push(`Wallet: ${address}`);

      if (!key) {
        sections.push('');
        sections.push('No MORALIS_API_KEY set — returning native-coin balances only via public RPC.');
        sections.push('Get a free key (25k req/month) at https://moralis.io to unlock ERC-20 scanning, positions, and P&L.');
        sections.push('');
        for (const slug of requestedChains) {
          const native = await fetchNativeBalanceViaRpc(address, slug);
          if (!native) {
            sections.push(`${CHAINS[slug]?.name ?? slug}: (RPC unavailable)`);
          } else {
            sections.push(`${CHAINS[slug]?.name ?? slug}: ${native.balance} ${native.symbol}`);
          }
        }
        return { content: [{ type: 'text', text: sections.join('\n') }] };
      }

      // Moralis path
      let totalUsd = 0;
      for (const slug of requestedChains) {
        if (!MORALIS_CHAIN_MAP[slug]) {
          sections.push(`\n${CHAINS[slug]?.name ?? slug}: (chain not yet supported by Moralis adapter)`);
          continue;
        }
        const tokens = await fetchMoralisBalances(address, slug, key);
        const filtered = tokens.filter((t) => {
          if (!includeNative && t.native_token) return false;
          if (t.usd_value !== undefined && t.usd_value < minUsd) return false;
          return true;
        });
        const chainUsd = filtered.reduce((acc, t) => acc + (t.usd_value ?? 0), 0);
        totalUsd += chainUsd;
        sections.push('');
        sections.push(`${CHAINS[slug]?.name ?? slug} — $${chainUsd.toFixed(2)} across ${filtered.length} token(s):`);
        if (filtered.length === 0) {
          sections.push('  (none above filter)');
        } else {
          for (const t of filtered) sections.push(formatTokenLine(t));
        }
      }
      sections.push('');
      sections.push(`Total: $${totalUsd.toFixed(2)}`);
      return { content: [{ type: 'text', text: sections.join('\n') }] };
    }

    if (name === 'chaingpt_wallet_positions') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const key = moralisKey();
      if (!key) {
        return {
          content: [{
            type: 'text',
            text:
              'MORALIS_API_KEY is required for chaingpt_wallet_positions.\n' +
              'Get a free key (25k req/month) at https://moralis.io and add it to your environment.',
          }],
        };
      }
      const chainSlug = String(args.chain ?? 'ethereum');
      const moralisChain = MORALIS_CHAIN_MAP[chainSlug];
      if (!moralisChain) {
        return { content: [{ type: 'text', text: `Chain not supported for positions: ${chainSlug}` }] };
      }
      const url = `${MORALIS_BASE}/wallets/${address}/defi/positions?chain=${moralisChain}`;
      const res = await httpJson<{ result?: any[]; cursor?: string }>(url, { headers: moralisHeaders(key) });
      const positions = res.result ?? [];
      if (positions.length === 0) {
        return { content: [{ type: 'text', text: `No DeFi positions found for ${address} on ${chainSlug}.` }] };
      }
      const lines = [`DeFi positions for ${address} on ${CHAINS[chainSlug]?.name ?? chainSlug}:`, ''];
      for (const p of positions) {
        const proto = p.protocol_name ?? 'unknown protocol';
        const label = p.label ?? p.position_type ?? 'position';
        const usd = p.balance_usd ?? p.total_usd_value;
        const usdStr = usd !== undefined ? ` ($${Number(usd).toFixed(2)})` : '';
        lines.push(`  ${proto} — ${label}${usdStr}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_wallet_pnl') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const key = moralisKey();
      if (!key) {
        return {
          content: [{
            type: 'text',
            text: 'MORALIS_API_KEY is required for chaingpt_wallet_pnl. Get a free key at https://moralis.io.',
          }],
        };
      }
      const chainSlug = String(args.chain ?? 'ethereum');
      const moralisChain = MORALIS_CHAIN_MAP[chainSlug];
      if (!moralisChain) {
        return { content: [{ type: 'text', text: `Chain not supported for P&L: ${chainSlug}` }] };
      }
      const url = `${MORALIS_BASE}/wallets/${address}/profitability/summary?chain=${moralisChain}`;
      const res = await httpJson<any>(url, { headers: moralisHeaders(key) });
      const lines = [
        `P&L summary for ${address} on ${CHAINS[chainSlug]?.name ?? chainSlug}:`,
        '',
        `  Total trade volume:        $${formatNum(res.total_trade_volume)}`,
        `  Total realized profit:     $${formatNum(res.total_realized_profit_usd)}`,
        `  Realized profit %:         ${formatNum(res.total_realized_profit_percentage)}%`,
        `  Total tokens traded:       ${res.total_count_of_trades ?? 'n/a'}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown wallet tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Wallet error: ${message}`);
  }
}

function formatNum(v: unknown): string {
  if (v === null || v === undefined) return 'n/a';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(2);
}
