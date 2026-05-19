import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AINews } from '@chaingpt/ainews';
import { ALL_CHAIN_SLUGS, resolveChain } from '../lib/chains.js';
import { httpJson } from '../lib/http.js';

/**
 * AI-enriched intel tools — the strategic differentiator of this expansion.
 *
 * These compose Tier-1 read-only Web3 data (market, risk, on-chain) with
 * ChainGPT's own AI products (news, signals, audit framing) so that every
 * "research this token" or "research this wallet" call ALSO triggers a
 * ChainGPT credit burn and surfaces ChainGPT-native context that no other
 * Claude Code Web3 plugin can produce.
 *
 * - chaingpt_intel_token : market data + GoPlus risk + ChainGPT news + AI signals (1 chained call)
 * - chaingpt_intel_wallet: balances summary + risk-rate every holding above $X
 *
 * Credit cost is funneled through the existing AINews call (1 credit per 10
 * news items). The risk + market layers stay free. Future versions can add
 * a chaingpt_chat summarization call (0.5 credits) for narrative output.
 */

const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';
const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';
const CHAINGPT_API_BASE = 'https://api.chaingpt.org';

let _news: AINews | null = null;
function newsClient(): AINews {
  if (!_news) _news = new AINews({ apiKey: process.env.CHAINGPT_API_KEY! });
  return _news;
}

export const intelTools: Tool[] = [
  {
    name: 'chaingpt_intel_token',
    description:
      'AI-enriched token research. Composes: live market data (DexScreener) + security flags (GoPlus) + ' +
      'recent ChainGPT crypto news mentioning the token + AI signals bullishness when available. ' +
      'This is the recommended one-shot research call before any trade. ' +
      'Costs ~1 ChainGPT credit (the news fetch). Market + risk layers are free.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Token symbol (e.g. "CGPT", "WIF") or contract address.',
        },
        chain: {
          type: 'string',
          enum: ALL_CHAIN_SLUGS,
          description: 'Restrict the market + risk lookup to a chain. Optional.',
        },
        newsLimit: {
          type: 'number',
          description: 'Number of recent ChainGPT news articles to include. Default 5. Cost: 1 credit per 10.',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'chaingpt_intel_wallet',
    description:
      'AI-enriched wallet research. Pulls portfolio holdings, risk-rates the top tokens via GoPlus, and ' +
      'surfaces any ChainGPT AI signals on those tokens. Use this as the "is this wallet safe to interact ' +
      'with" or "what is this whale holding" call. Requires MORALIS_API_KEY for portfolio scan. ' +
      '0 ChainGPT credits (signals fetch is free read).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'EVM wallet address (0x…).' },
        chains: {
          type: 'array',
          items: { type: 'string', enum: ALL_CHAIN_SLUGS },
          description: 'Chains to scan. Default: [ethereum, base, arbitrum, polygon, bsc].',
        },
        minUsdValue: {
          type: 'number',
          description: 'Only risk-rate holdings above this USD value. Default 100.',
          default: 100,
        },
        maxTokens: {
          type: 'number',
          description: 'Max number of tokens to risk-rate. Default 10.',
          default: 10,
        },
      },
      required: ['address'],
    },
  },
];

interface DexPair {
  chainId: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { symbol: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  url?: string;
}

interface GoplusTokenRow {
  is_honeypot?: string;
  is_mintable?: string;
  is_proxy?: string;
  cannot_sell_all?: string;
  hidden_owner?: string;
  buy_tax?: string;
  sell_tax?: string;
  token_symbol?: string;
  holder_count?: string;
}

async function fetchSignal(symbol: string): Promise<{ bullishness?: number; tag?: string; raw?: any } | null> {
  const key = process.env.CHAINGPT_API_KEY;
  if (!key) return null;
  try {
    const res = await httpJson<any>(`${CHAINGPT_API_BASE}/ai-signal/details?symbol=${encodeURIComponent(symbol)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = res?.data ?? res;
    return {
      bullishness: data?.bullishness ?? data?.score,
      tag: data?.tag ?? data?.narrative,
      raw: data,
    };
  } catch {
    return null;
  }
}

export async function handleIntelTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_intel_token') {
      const query = String(args.query || '').trim();
      if (!query) return { content: [{ type: 'text', text: 'Error: query is required.' }] };
      const chain = resolveChain(args.chain as string | undefined);
      const newsLimit = Math.min(Number(args.newsLimit ?? 5), 30);

      const isAddress = /^0x[0-9a-fA-F]{40}$/.test(query) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query);

      // 1. Market data via DexScreener
      const dsUrl = isAddress
        ? `${DEXSCREENER_BASE}/tokens/${query}`
        : `${DEXSCREENER_BASE}/search?q=${encodeURIComponent(query)}`;
      let pairs: DexPair[] = [];
      try {
        const dsRes = await httpJson<{ pairs?: DexPair[] }>(dsUrl);
        pairs = dsRes.pairs ?? [];
        if (chain) pairs = pairs.filter((p) => p.chainId === chain.dexscreener);
        pairs.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
      } catch {
        /* market section will be empty */
      }
      const top = pairs[0];
      const symbol = top?.baseToken.symbol ?? (isAddress ? '?' : query.toUpperCase());
      const contract = top?.baseToken.address ?? (isAddress ? query : undefined);
      const resolvedChain = top ? resolveChain(top.chainId) : chain;

      // 2. Risk via GoPlus (only if we have contract + EVM chain)
      let riskFlags: string[] = [];
      let riskMeta: GoplusTokenRow | null = null;
      if (contract && resolvedChain?.goplus && resolvedChain.chainId !== null) {
        try {
          const goRes = await httpJson<{ result: Record<string, GoplusTokenRow> }>(
            `${GOPLUS_BASE}/token_security/${resolvedChain.goplus}?contract_addresses=${contract}`
          );
          riskMeta = goRes.result?.[contract.toLowerCase()] ?? null;
          if (riskMeta) {
            const checks: Array<[keyof GoplusTokenRow, string]> = [
              ['is_honeypot', 'honeypot'],
              ['cannot_sell_all', 'cannot sell all'],
              ['is_mintable', 'mintable'],
              ['is_proxy', 'proxy'],
              ['hidden_owner', 'hidden owner'],
            ];
            riskFlags = checks.filter(([k]) => riskMeta?.[k] === '1').map(([, label]) => label);
          }
        } catch {
          /* risk section will say "unavailable" */
        }
      }

      // 3. News via @chaingpt/ainews (credit-billed)
      let newsArticles: any[] = [];
      try {
        const newsRes: any = await newsClient().getNews({
          searchQuery: symbol,
          limit: newsLimit,
          offset: 0,
          sortBy: 'createdAt',
        } as any);
        newsArticles = newsRes?.data ?? [];
      } catch {
        /* surface the failure inline */
      }

      // 4. AI signal (free read)
      const signal = await fetchSignal(symbol);

      // Assemble
      const lines: string[] = [];
      lines.push(`══ AI-enriched intel — ${symbol} ══`);
      lines.push('');

      lines.push('▎ Market');
      if (top) {
        if (top.priceUsd) lines.push(`  Price (USD):       $${Number(top.priceUsd).toPrecision(6)}`);
        if (top.priceChange?.h24 !== undefined)
          lines.push(`  24h change:        ${top.priceChange.h24 >= 0 ? '+' : ''}${top.priceChange.h24.toFixed(2)}%`);
        if (top.volume?.h24) lines.push(`  24h volume:        $${formatLarge(top.volume.h24)}`);
        if (top.liquidity?.usd) lines.push(`  Liquidity:         $${formatLarge(top.liquidity.usd)}`);
        if (top.marketCap) lines.push(`  Market cap:        $${formatLarge(top.marketCap)}`);
        if (top.fdv) lines.push(`  FDV:               $${formatLarge(top.fdv)}`);
        lines.push(`  Top pair chain:    ${top.chainId}`);
        if (contract) lines.push(`  Contract:          ${contract}`);
      } else {
        lines.push('  (no DexScreener data)');
      }

      lines.push('');
      lines.push('▎ Security');
      if (!contract) {
        lines.push('  (skipped — could not resolve contract)');
      } else if (!riskMeta) {
        lines.push('  (GoPlus has no data — token may be too new or chain unsupported)');
      } else {
        if (riskMeta.holder_count) lines.push(`  Holders:           ${riskMeta.holder_count}`);
        if (riskMeta.buy_tax || riskMeta.sell_tax) {
          const buy = riskMeta.buy_tax ? `${(Number(riskMeta.buy_tax) * 100).toFixed(2)}%` : '?';
          const sell = riskMeta.sell_tax ? `${(Number(riskMeta.sell_tax) * 100).toFixed(2)}%` : '?';
          lines.push(`  Buy / sell tax:    ${buy} / ${sell}`);
        }
        if (riskFlags.length === 0) {
          lines.push('  ✓ No critical GoPlus flags.');
        } else {
          lines.push(`  ⚠ Flags:           ${riskFlags.join(', ')}`);
        }
      }

      lines.push('');
      lines.push('▎ AI signal (ChainGPT)');
      if (!signal) {
        lines.push('  (no signal — CHAINGPT_API_KEY missing or coin not tracked)');
      } else {
        if (signal.bullishness !== undefined) lines.push(`  Bullishness:       ${signal.bullishness}`);
        if (signal.tag) lines.push(`  Tag/narrative:     ${signal.tag}`);
        if (!signal.bullishness && !signal.tag) lines.push('  (signal returned but empty)');
      }

      lines.push('');
      lines.push(`▎ Recent news (${newsArticles.length})`);
      if (newsArticles.length === 0) {
        lines.push('  (no recent ChainGPT news mentions found)');
      } else {
        newsArticles.forEach((n: any, i: number) => {
          const date = n.pubDate ? ` [${String(n.pubDate).slice(0, 10)}]` : '';
          lines.push(`  ${i + 1}. ${n.title}${date}`);
          if (n.url) lines.push(`     ${n.url}`);
        });
      }

      lines.push('');
      lines.push('───');
      lines.push('Next steps: chaingpt_chat for narrative analysis · chaingpt_audit_contract for code review');
      lines.push(`         · chaingpt_research_pairs ${contract ?? '<address>'} for liquidity breakdown`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_intel_wallet') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const moralisKey = process.env.MORALIS_API_KEY?.trim();
      if (!moralisKey) {
        return {
          content: [{
            type: 'text',
            text:
              'MORALIS_API_KEY is required for chaingpt_intel_wallet.\n' +
              'Get a free key (25k req/month) at https://moralis.io.',
          }],
        };
      }
      const requestedChains = (args.chains as string[] | undefined) ?? ['ethereum', 'base', 'arbitrum', 'polygon', 'bsc'];
      const minUsd = Number(args.minUsdValue ?? 100);
      const maxTokens = Number(args.maxTokens ?? 10);

      const moralisMap: Record<string, string> = {
        ethereum: 'eth', base: 'base', arbitrum: 'arbitrum', optimism: 'optimism',
        polygon: 'polygon', bsc: 'bsc', avalanche: 'avalanche', blast: 'blast', linea: 'linea',
      };

      const allHoldings: Array<{ chainSlug: string; token: any }> = [];
      for (const slug of requestedChains) {
        if (!moralisMap[slug]) continue;
        try {
          const res = await httpJson<{ result: any[] }>(
            `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${moralisMap[slug]}`,
            { headers: { 'X-API-Key': moralisKey } }
          );
          for (const t of res.result ?? []) {
            if ((t.usd_value ?? 0) >= minUsd) allHoldings.push({ chainSlug: slug, token: t });
          }
        } catch {
          /* skip chain */
        }
      }
      allHoldings.sort((a, b) => (b.token.usd_value ?? 0) - (a.token.usd_value ?? 0));
      const top = allHoldings.slice(0, maxTokens);

      const lines: string[] = [];
      lines.push(`══ AI-enriched wallet intel — ${address} ══`);
      lines.push('');
      if (top.length === 0) {
        lines.push(`No holdings above $${minUsd} found across requested chains.`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      const totalUsd = allHoldings.reduce((acc, h) => acc + (h.token.usd_value ?? 0), 0);
      lines.push(`Total tracked value: $${totalUsd.toFixed(2)} across ${allHoldings.length} positions ≥ $${minUsd}`);
      lines.push('');
      lines.push(`Risk-rating top ${top.length} holdings:`);
      lines.push('');

      for (const { chainSlug, token } of top) {
        const c = resolveChain(chainSlug);
        if (!c?.goplus || token.native_token) {
          lines.push(
            `  ${token.symbol.padEnd(10)} $${(token.usd_value ?? 0).toFixed(2).padStart(10)}  [${chainSlug}]  (native or risk-skip)`
          );
          continue;
        }
        let verdict = '?';
        try {
          const goRes = await httpJson<{ result: Record<string, GoplusTokenRow> }>(
            `${GOPLUS_BASE}/token_security/${c.goplus}?contract_addresses=${token.token_address}`
          );
          const row = goRes.result?.[token.token_address.toLowerCase()];
          if (!row) {
            verdict = 'no GoPlus data';
          } else {
            const flagged: string[] = [];
            if (row.is_honeypot === '1') flagged.push('honeypot');
            if (row.cannot_sell_all === '1') flagged.push('cannot-sell-all');
            if (row.is_mintable === '1') flagged.push('mintable');
            if (row.hidden_owner === '1') flagged.push('hidden-owner');
            verdict = flagged.length === 0 ? '✓ clean' : `⚠ ${flagged.join(',')}`;
          }
        } catch {
          verdict = '(check failed)';
        }
        lines.push(
          `  ${token.symbol.padEnd(10)} $${(token.usd_value ?? 0).toFixed(2).padStart(10)}  [${chainSlug}]  ${verdict}`
        );
      }
      lines.push('');
      lines.push('Tip: feed flagged tokens into chaingpt_audit_contract for a deep AI audit.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown intel tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Intel error: ${message}`);
  }
}

function formatLarge(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}
