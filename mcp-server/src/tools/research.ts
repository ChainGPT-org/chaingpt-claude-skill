import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ALL_CHAIN_SLUGS, CHAINS, resolveChain } from '../lib/chains.js';
import { httpJson } from '../lib/http.js';

/**
 * Token research tools backed by DexScreener (no key required, ~60 rps).
 *
 * - chaingpt_research_token : look up a token by symbol or contract address
 * - chaingpt_research_pairs : list trading pairs / pools for a token
 * - chaingpt_research_trending : 24h trending tokens (DexScreener "boosted")
 *
 * DexScreener returns the same shape across all chains so the multi-chain
 * UX comes for free. We add chain-name resolution and pretty-print top
 * fields developers actually care about: price, 24h volume, liquidity,
 * FDV/market cap, top pair URL.
 */

const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number };
  fdv?: number;
  marketCap?: number;
  url?: string;
  pairCreatedAt?: number;
}

interface DexScreenerResponse {
  pairs?: DexScreenerPair[];
  schemaVersion?: string;
}

export const researchTools: Tool[] = [
  {
    name: 'chaingpt_research_token',
    description:
      'Look up live market data for a token by contract address or symbol search. Returns price, 24h volume, ' +
      'liquidity, market cap, FDV, top trading pair, and primary DEX. Multi-chain. Powered by DexScreener. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Either a contract address (0x… on EVM, base58 on Solana) or a token symbol like "WIF" or "CGPT". ' +
            'Symbol searches return the top match across all chains.',
        },
        chain: {
          type: 'string',
          enum: ALL_CHAIN_SLUGS,
          description: 'Restrict to a specific chain. Optional; if omitted, returns the top pair across all chains.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'chaingpt_research_pairs',
    description:
      'List trading pairs (pools) for a token contract address on a given chain. Returns up to 10 pairs sorted ' +
      'by liquidity, with DEX, quote token, price, 24h volume, and pool URL. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Token contract address.',
        },
        chain: {
          type: 'string',
          enum: ALL_CHAIN_SLUGS,
          description: 'Chain slug. Optional; if omitted, returns pairs from all chains where the token exists.',
        },
        limit: {
          type: 'number',
          description: 'Max number of pairs to return (default 10).',
          default: 10,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_research_trending',
    description:
      'Get the currently trending / boosted tokens on DexScreener. Useful for surfacing what is moving across ' +
      'chains right now. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: {
          type: 'string',
          enum: ALL_CHAIN_SLUGS,
          description: 'Restrict to a chain. Optional.',
        },
        limit: {
          type: 'number',
          description: 'Number of tokens to return (default 10, max 30).',
          default: 10,
        },
      },
      required: [],
    },
  },
];

function formatPair(p: DexScreenerPair, idx?: number): string[] {
  const lines: string[] = [];
  const prefix = idx !== undefined ? `${idx + 1}. ` : '';
  lines.push(
    `${prefix}${p.baseToken.symbol}/${p.quoteToken.symbol} on ${p.chainId} via ${p.dexId}`
  );
  if (p.priceUsd) lines.push(`   Price (USD):    $${Number(p.priceUsd).toPrecision(6)}`);
  if (p.priceChange?.h24 !== undefined)
    lines.push(`   24h change:     ${p.priceChange.h24 >= 0 ? '+' : ''}${p.priceChange.h24.toFixed(2)}%`);
  if (p.volume?.h24 !== undefined)
    lines.push(`   24h volume:     $${formatLarge(p.volume.h24)}`);
  if (p.liquidity?.usd !== undefined)
    lines.push(`   Liquidity:      $${formatLarge(p.liquidity.usd)}`);
  if (p.marketCap !== undefined) lines.push(`   Market cap:     $${formatLarge(p.marketCap)}`);
  if (p.fdv !== undefined) lines.push(`   FDV:            $${formatLarge(p.fdv)}`);
  lines.push(`   Pair address:   ${p.pairAddress}`);
  if (p.url) lines.push(`   DexScreener:    ${p.url}`);
  return lines;
}

function formatLarge(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

export async function handleResearchTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_research_token') {
      const query = String(args.query || '').trim();
      if (!query) return { content: [{ type: 'text', text: 'Error: query is required.' }] };
      const chain = resolveChain(args.chain as string | undefined);

      const isAddress = /^0x[0-9a-fA-F]{40}$/.test(query) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query);
      const url = isAddress
        ? `${DEXSCREENER_BASE}/tokens/${query}`
        : `${DEXSCREENER_BASE}/search?q=${encodeURIComponent(query)}`;

      const res = await httpJson<DexScreenerResponse>(url);
      let pairs = res.pairs ?? [];
      if (chain) pairs = pairs.filter((p) => p.chainId === chain.dexscreener);
      if (pairs.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No DexScreener pairs found for "${query}"${chain ? ` on ${chain.name}` : ''}.`,
          }],
        };
      }
      // Sort by 24h volume desc, pick top
      pairs.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
      const top = pairs[0];
      const lines: string[] = [];
      lines.push(`Top result for "${query}":`);
      lines.push('');
      lines.push(...formatPair(top));
      if (pairs.length > 1) {
        lines.push('');
        lines.push(`(+${pairs.length - 1} more pairs — use chaingpt_research_pairs to enumerate.)`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_research_pairs') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const chain = resolveChain(args.chain as string | undefined);
      const limit = Math.min(Number(args.limit ?? 10), 30);

      const url = `${DEXSCREENER_BASE}/tokens/${address}`;
      const res = await httpJson<DexScreenerResponse>(url);
      let pairs = res.pairs ?? [];
      if (chain) pairs = pairs.filter((p) => p.chainId === chain.dexscreener);
      if (pairs.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No pairs found for ${address}${chain ? ` on ${chain.name}` : ''}.`,
          }],
        };
      }
      pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      pairs = pairs.slice(0, limit);
      const lines: string[] = [];
      lines.push(`Found ${pairs.length} pair(s) for ${address}, sorted by liquidity:`);
      lines.push('');
      pairs.forEach((p, i) => {
        lines.push(...formatPair(p, i));
        lines.push('');
      });
      return { content: [{ type: 'text', text: lines.join('\n').trim() }] };
    }

    if (name === 'chaingpt_research_trending') {
      const chain = resolveChain(args.chain as string | undefined);
      const limit = Math.min(Number(args.limit ?? 10), 30);
      const url = chain
        ? `https://api.dexscreener.com/token-boosts/latest/v1`
        : `https://api.dexscreener.com/token-boosts/latest/v1`;
      const res = await httpJson<any[]>(url);
      const boosted = Array.isArray(res) ? res : [];
      let filtered = boosted;
      if (chain) {
        filtered = boosted.filter((b: any) => b.chainId === chain.dexscreener);
      }
      filtered = filtered.slice(0, limit);
      if (filtered.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No trending tokens found${chain ? ` on ${chain.name}` : ''}.`,
          }],
        };
      }
      const lines: string[] = [];
      lines.push(`Trending tokens${chain ? ` on ${chain.name}` : ''}:`);
      lines.push('');
      filtered.forEach((b: any, i: number) => {
        const desc = b.description ? ` — ${String(b.description).slice(0, 80)}` : '';
        lines.push(`${i + 1}. [${b.chainId}] ${b.tokenAddress}${desc}`);
        if (b.url) lines.push(`   ${b.url}`);
      });
      lines.push('');
      lines.push('Tip: feed any tokenAddress into chaingpt_research_token for full market data.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown research tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Research error: ${message}`);
  }
}
