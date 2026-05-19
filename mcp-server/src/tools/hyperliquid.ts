import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-3b Hyperliquid (HL) mainnet integration. READ-ONLY in v1.6.
 *
 * Hyperliquid is a perps DEX on its own L1 plus an Arbitrum bridge. Their
 * public REST API is https://api.hyperliquid.xyz with all reads going through
 * POST /info with a JSON `type` discriminator. No API key required.
 *
 * Tools:
 *   - chaingpt_hl_markets         List of perp + spot universes (assets, max leverage, decimals)
 *   - chaingpt_hl_mids            Live mid prices for all assets
 *   - chaingpt_hl_orderbook       L2 orderbook for a specific asset
 *   - chaingpt_hl_account         Margin / positions / open-orders summary for a wallet
 *   - chaingpt_hl_fills           Recent fill history for a wallet
 *   - chaingpt_hl_funding         Funding history for a coin (last 24h)
 *
 * Signed order placement (POST /exchange with EIP-712 L1 actions) is intentionally
 * deferred to a follow-up PR — the signing scheme is non-trivial and deserves a
 * dedicated review pass.
 */

const HL_INFO = 'https://api.hyperliquid.xyz/info';

async function info<T = any>(body: Record<string, unknown>): Promise<T> {
  return httpJson<T>(HL_INFO, { method: 'POST', body });
}

export const hyperliquidTools: Tool[] = [
  {
    name: 'chaingpt_hl_markets',
    description:
      'List Hyperliquid perpetual + spot markets (assets, max leverage, decimals). Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['perp', 'spot'],
          description: 'Which universe to list. Default: perp.',
          default: 'perp',
        },
        limit: { type: 'number', description: 'Max markets to return. Default 50.', default: 50 },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_hl_mids',
    description:
      'Get live mid prices for all Hyperliquid assets in one call. Useful for quick portfolio mark-to-market. ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of coin symbols to filter to (e.g. ["BTC","ETH","SOL"]).',
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_hl_orderbook',
    description:
      'Get the L2 orderbook for a Hyperliquid asset (best bids + asks, by price level). Read-only. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        coin: { type: 'string', description: 'Asset symbol, e.g. "BTC", "ETH", "SOL".' },
        depth: { type: 'number', description: 'Max levels per side to show. Default 10.', default: 10 },
      },
      required: ['coin'],
    },
  },
  {
    name: 'chaingpt_hl_account',
    description:
      'Get the full Hyperliquid account state for a wallet: USDC balance, margin used, account value, ' +
      'leverage, open positions, and open orders. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user: { type: 'string', description: 'Wallet address (0x…).' },
      },
      required: ['user'],
    },
  },
  {
    name: 'chaingpt_hl_fills',
    description:
      'Recent fill history for a Hyperliquid account. Returns side, coin, price, size, fee, PnL per fill. ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user: { type: 'string', description: 'Wallet address (0x…).' },
        limit: { type: 'number', description: 'Max fills to return (default 20).', default: 20 },
      },
      required: ['user'],
    },
  },
  {
    name: 'chaingpt_hl_funding',
    description:
      'Funding-rate history for a Hyperliquid perp asset. Returns the last 24h of hourly funding rates. ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        coin: { type: 'string', description: 'Asset symbol, e.g. "BTC".' },
        hours: { type: 'number', description: 'How many hours of history (default 24, max 168).', default: 24 },
      },
      required: ['coin'],
    },
  },
];

function formatNum(v: unknown, decimals = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(decimals);
}

export async function handleHyperliquidTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_hl_markets') {
      const universeType = String(args.type ?? 'perp');
      const limit = Math.min(Number(args.limit ?? 50), 200);
      const meta = await info<any>({ type: universeType === 'spot' ? 'spotMeta' : 'meta' });
      const universe = (meta?.universe ?? []) as any[];

      const lines: string[] = [];
      lines.push(`Hyperliquid ${universeType} markets (${universe.length} total, showing ${Math.min(limit, universe.length)}):`);
      lines.push('');
      universe.slice(0, limit).forEach((u: any, i: number) => {
        const max = u.maxLeverage ? `max ${u.maxLeverage}x` : '';
        const sz = u.szDecimals !== undefined ? `szDec=${u.szDecimals}` : '';
        lines.push(`${(i + 1).toString().padStart(3)}. ${u.name ?? u.tokens?.join('/')}  ${max}  ${sz}`);
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_mids') {
      const mids = await info<Record<string, string>>({ type: 'allMids' });
      const filter = Array.isArray(args.filter)
        ? new Set((args.filter as unknown[]).filter((x): x is string => typeof x === 'string').map((s) => s.toUpperCase()))
        : null;
      const entries = Object.entries(mids)
        .filter(([k]) => !filter || filter.has(k.toUpperCase()))
        .sort(([a], [b]) => a.localeCompare(b));
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: 'No matching mids found.' }] };
      }
      const lines = [`Hyperliquid mids (${entries.length} symbols):`, ''];
      for (const [coin, price] of entries) lines.push(`  ${coin.padEnd(12)} ${price}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_orderbook') {
      const coin = String(args.coin || '').toUpperCase();
      if (!coin) return { content: [{ type: 'text', text: 'coin is required.' }] };
      const depth = Math.min(Number(args.depth ?? 10), 50);
      const book = await info<any>({ type: 'l2Book', coin });
      const bids = (book?.levels?.[0] ?? []).slice(0, depth);
      const asks = (book?.levels?.[1] ?? []).slice(0, depth);
      const lines: string[] = [];
      lines.push(`Hyperliquid orderbook — ${coin}`);
      lines.push('');
      lines.push(`  ${'Bid Size'.padStart(12)}   ${'Bid Px'.padStart(10)}  │  ${'Ask Px'.padStart(10)}   ${'Ask Size'.padStart(12)}`);
      lines.push(`  ${'─'.repeat(12)}   ${'─'.repeat(10)}  │  ${'─'.repeat(10)}   ${'─'.repeat(12)}`);
      const rows = Math.max(bids.length, asks.length);
      for (let i = 0; i < rows; i++) {
        const b = bids[i];
        const a = asks[i];
        const bSz = b ? formatNum(b.sz, 4).padStart(12) : ' '.repeat(12);
        const bPx = b ? formatNum(b.px, 2).padStart(10) : ' '.repeat(10);
        const aPx = a ? formatNum(a.px, 2).padStart(10) : ' '.repeat(10);
        const aSz = a ? formatNum(a.sz, 4).padStart(12) : ' '.repeat(12);
        lines.push(`  ${bSz}   ${bPx}  │  ${aPx}   ${aSz}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_account') {
      const user = String(args.user || '').trim();
      if (!user) return { content: [{ type: 'text', text: 'user is required.' }] };
      const state = await info<any>({ type: 'clearinghouseState', user });
      const ms = state?.marginSummary ?? {};
      const positions = (state?.assetPositions ?? []) as any[];
      const lines: string[] = [];
      lines.push(`Hyperliquid account — ${user}`);
      lines.push('');
      lines.push(`Account value:           $${formatNum(ms.accountValue)}`);
      lines.push(`Total margin used:       $${formatNum(ms.totalMarginUsed)}`);
      lines.push(`Total raw USD:           $${formatNum(ms.totalRawUsd)}`);
      lines.push(`Total notional:          $${formatNum(ms.totalNtlPos)}`);
      lines.push(`Withdrawable:            $${formatNum(state?.withdrawable)}`);
      lines.push('');
      if (positions.length === 0) {
        lines.push('No open positions.');
      } else {
        lines.push(`Open positions (${positions.length}):`);
        for (const p of positions) {
          const pos = p.position;
          if (!pos) continue;
          const side = Number(pos.szi) > 0 ? 'LONG ' : 'SHORT';
          const sz = Math.abs(Number(pos.szi));
          const lev = pos.leverage?.value ?? '?';
          lines.push(
            `  ${side} ${pos.coin?.padEnd(8) ?? '?'}  size=${formatNum(sz, 4)}  entry=$${formatNum(pos.entryPx)}  ` +
            `unPnL=$${formatNum(pos.unrealizedPnl)}  lev=${lev}x  liq=$${formatNum(pos.liquidationPx)}`
          );
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_fills') {
      const user = String(args.user || '').trim();
      if (!user) return { content: [{ type: 'text', text: 'user is required.' }] };
      const limit = Math.min(Number(args.limit ?? 20), 100);
      const fills = await info<any[]>({ type: 'userFills', user });
      const slice = (Array.isArray(fills) ? fills : []).slice(0, limit);
      if (slice.length === 0) {
        return { content: [{ type: 'text', text: `No fills found for ${user}.` }] };
      }
      const lines: string[] = [`Hyperliquid fills — ${user} (${slice.length} most recent):`, ''];
      for (const f of slice) {
        const side = f.side === 'B' ? 'BUY ' : f.side === 'A' ? 'SELL' : f.side;
        const ts = f.time ? new Date(Number(f.time)).toISOString().slice(0, 19).replace('T', ' ') : 'n/a';
        lines.push(
          `  ${ts}  ${side} ${(f.coin ?? '?').padEnd(8)} ${formatNum(f.sz, 4).padStart(12)} @ $${formatNum(f.px)}  ` +
          `fee=$${formatNum(f.fee, 4)}  pnl=$${formatNum(f.closedPnl, 2)}`
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_funding') {
      const coin = String(args.coin || '').toUpperCase();
      if (!coin) return { content: [{ type: 'text', text: 'coin is required.' }] };
      const hours = Math.min(Number(args.hours ?? 24), 168);
      const startTime = Date.now() - hours * 3600 * 1000;
      const history = await info<any[]>({ type: 'fundingHistory', coin, startTime });
      const slice = Array.isArray(history) ? history : [];
      if (slice.length === 0) {
        return { content: [{ type: 'text', text: `No funding history for ${coin} in last ${hours}h.` }] };
      }
      const lines: string[] = [`Hyperliquid funding history — ${coin} (last ${hours}h):`, ''];
      for (const h of slice) {
        const ts = new Date(Number(h.time)).toISOString().slice(0, 19).replace('T', ' ');
        const rate = (Number(h.fundingRate) * 100).toFixed(4);
        const premium = h.premium !== undefined ? `premium=${formatNum(h.premium, 4)}` : '';
        lines.push(`  ${ts}  rate=${rate}%  ${premium}`);
      }
      // Compute annualized rate
      const lastRate = Number(slice[slice.length - 1].fundingRate);
      if (Number.isFinite(lastRate)) {
        const annualized = (lastRate * 24 * 365 * 100).toFixed(2);
        lines.push('');
        lines.push(`Latest annualized (1h × 8760): ${annualized}%`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown Hyperliquid tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Hyperliquid error: ${message}`);
  }
}
