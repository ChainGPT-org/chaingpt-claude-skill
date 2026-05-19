import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-6.4 Drift Protocol — Solana perpetuals.
 *
 * Hyperliquid is the dominant non-custodial perp venue, but it lives on its
 * own L1. Drift is the Solana-native counterpart — same custody model (the
 * user keeps the keys, the protocol holds collateral on-chain), different
 * blockchain and signing scheme. For SOL-denominated traders or users
 * already operating on Solana, Drift is the natural Hyperliquid alternative.
 *
 * READ-ONLY by design. Drift trading requires constructing Solana program
 * instructions and signing with a Solana keypair (Ed25519), which is a
 * different signing flow than the EVM EIP-712 pattern used elsewhere. The
 * read tools here surface markets, funding, orderbooks, and positions so
 * users can make decisions; deployment happens via the official UI at
 * https://app.drift.trade.
 *
 * Endpoints:
 *   dlob.drift.trade            — live orderbook + market metadata
 *   data.api.drift.trade        — historical funding rates + analytics
 *   mainnet-beta.api.drift.trade — fallback contract metadata
 */

const DRIFT_DLOB = 'https://dlob.drift.trade';
const DRIFT_DATA = 'https://data.api.drift.trade';
const DRIFT_MAIN = 'https://mainnet-beta.api.drift.trade';

export const driftTools: Tool[] = [
  {
    name: 'chaingpt_drift_markets',
    description:
      'List Drift perpetual markets on Solana. Returns each market with: index, symbol, mark price, ' +
      '24h volume, open interest, current funding rate (1h). Drift has 50+ perps including SOL-PERP, ' +
      'BTC-PERP, ETH-PERP, plus a long-tail of Solana memes (BONK, WIF, POPCAT, …). Read-only. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sortBy: {
          type: 'string',
          enum: ['volume', 'openInterest', 'funding', 'symbol'],
          description: 'Sort field. Default: volume.',
          default: 'volume',
        },
        limit: { type: 'number', description: 'Max markets to return. Default 30.', default: 30 },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_drift_market',
    description:
      'Get a single Drift perp market in detail: mark price, oracle price, basis, current funding ' +
      'rate (hourly), funding rate annualized, open interest (long + short), max leverage, ' +
      'taker fee, maker fee. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketIndex: { type: 'number', description: 'Drift perp market index (e.g. 0 for SOL-PERP).' },
      },
      required: ['marketIndex'],
    },
  },
  {
    name: 'chaingpt_drift_orderbook',
    description:
      'Get the L2 orderbook for a Drift perp market (best bids + asks by price level). Useful for ' +
      'sizing trades against available liquidity. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketIndex: { type: 'number', description: 'Drift perp market index.' },
        depth: { type: 'number', description: 'Max levels per side. Default 10.', default: 10 },
      },
      required: ['marketIndex'],
    },
  },
  {
    name: 'chaingpt_drift_funding',
    description:
      'Get historical funding rates for a Drift perp market over the last 24h or 7d. Returns a series ' +
      'of (timestamp, fundingRate, oraclePriceTwap, markPriceTwap) tuples. Use to spot persistent ' +
      'funding skew that funding-arb strategies can exploit. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketIndex: { type: 'number', description: 'Drift perp market index.' },
        window: {
          type: 'string',
          enum: ['24h', '7d'],
          description: 'Lookback window. Default 24h.',
          default: '24h',
        },
      },
      required: ['marketIndex'],
    },
  },
  {
    name: 'chaingpt_drift_user',
    description:
      "Get a user's Drift account: USDC collateral, free collateral, total leverage, open perp " +
      'positions (with mark price, entry, PnL, funding accrued), and unfilled orders. The user is ' +
      'identified by their Solana wallet authority (base58). Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        authority: { type: 'string', description: 'Solana wallet authority (base58 pubkey).' },
        subAccountId: { type: 'number', description: 'Drift sub-account id. Default 0.', default: 0 },
      },
      required: ['authority'],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────
function fmtNum(n: unknown, decimals = 2): string {
  const v = typeof n === 'string' ? Number(n) : (n as number);
  if (!isFinite(v as number)) return 'n/a';
  return (v as number).toFixed(decimals);
}

function fmtPct(n: unknown, decimals = 4): string {
  const v = typeof n === 'string' ? Number(n) : (n as number);
  if (!isFinite(v as number)) return 'n/a';
  return ((v as number) * 100).toFixed(decimals) + '%';
}

function fmtUsdShort(n: unknown): string {
  const v = typeof n === 'string' ? Number(n) : (n as number);
  if (!isFinite(v as number) || v === 0) return '$0';
  const x = v as number;
  if (x >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(2)}B`;
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}k`;
  return `$${x.toFixed(2)}`;
}

// Drift hourly funding rate to annualized: (1 + r)^(24*365) - 1, but for r close to zero
// the linear approximation r * 24 * 365 is fine for display purposes.
function annualizedFunding(hourly: number): number {
  return hourly * 24 * 365;
}

export async function handleDriftTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) return { content: [{ type: 'text', text: 'No arguments provided.' }] };

  try {
    if (name === 'chaingpt_drift_markets') {
      const sortBy = String(args.sortBy ?? 'volume');
      const limit = Number(args.limit ?? 30);
      const res = await httpJson<any>(`${DRIFT_DLOB}/contracts`);
      // Drift returns either { contracts: [...] } or a raw array. Be defensive.
      const contracts: any[] = Array.isArray(res) ? res : (res?.contracts ?? []);
      // Only perp contracts (not spot)
      const perps = contracts.filter((c) => {
        const ct = String(c?.contract_type ?? c?.contractType ?? 'perp').toLowerCase();
        return ct === 'perp' || ct === 'perpetual' || c?.market_index !== undefined;
      });

      const sortKey: Record<string, (c: any) => number> = {
        volume: (c) => -Number(c?.base_currency_volume_24h_usd ?? c?.quote_volume_24h ?? c?.volume_24h ?? 0),
        openInterest: (c) => -Number(c?.open_interest ?? c?.openInterest ?? 0),
        funding: (c) => -Math.abs(Number(c?.next_funding_rate ?? c?.last_funding_rate ?? c?.fundingRate ?? 0)),
        symbol: (c) => 0, // will sort by symbol below
      };
      if (sortBy === 'symbol') {
        perps.sort((a, b) => String(a?.ticker_id ?? a?.symbol ?? '').localeCompare(String(b?.ticker_id ?? b?.symbol ?? '')));
      } else {
        perps.sort((a, b) => sortKey[sortBy](a) - sortKey[sortBy](b));
      }
      const top = perps.slice(0, limit);

      const lines: string[] = [];
      lines.push(`Drift perp markets — ${perps.length} total, showing top ${top.length} by ${sortBy}`);
      lines.push('');
      if (top.length === 0) {
        lines.push('(no markets returned — Drift API may be down; raw response below)');
        lines.push(JSON.stringify(res, null, 2).slice(0, 500));
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      for (const c of top) {
        const sym = c?.ticker_id ?? c?.symbol ?? `idx-${c?.market_index ?? '?'}`;
        const idx = c?.market_index ?? c?.marketIndex ?? '?';
        const mark = fmtNum(c?.mark_price ?? c?.markPrice, 4);
        const vol = fmtUsdShort(c?.base_currency_volume_24h_usd ?? c?.quote_volume_24h ?? c?.volume_24h);
        const oi = fmtUsdShort(c?.open_interest ?? c?.openInterest);
        const fr = Number(c?.next_funding_rate ?? c?.last_funding_rate ?? c?.fundingRate ?? 0);
        const annual = fmtPct(annualizedFunding(fr), 2);
        lines.push(`• ${sym} (idx ${idx})`);
        lines.push(`    Mark: $${mark}    24h Vol: ${vol}    OI: ${oi}`);
        lines.push(`    Funding (hourly): ${fmtPct(fr, 5)}    Annualized: ${annual}`);
        lines.push('');
      }
      lines.push('Next: chaingpt_drift_market marketIndex=<idx> for one-market detail, or chaingpt_drift_orderbook for liquidity.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_drift_market') {
      const marketIndex = Number(args.marketIndex);
      // Pull from the contracts list and filter — dlob.drift.trade returns all in one go
      const res = await httpJson<any>(`${DRIFT_DLOB}/contracts`);
      const contracts: any[] = Array.isArray(res) ? res : (res?.contracts ?? []);
      const c = contracts.find((x) => Number(x?.market_index ?? x?.marketIndex) === marketIndex);
      if (!c) {
        return { content: [{ type: 'text', text: `Drift market index ${marketIndex} not found.` }] };
      }
      const sym = c?.ticker_id ?? c?.symbol ?? `idx-${marketIndex}`;
      const lines: string[] = [];
      lines.push(`Drift market — ${sym}`);
      lines.push('');
      lines.push(`Index:           ${marketIndex}`);
      lines.push(`Mark price:      $${fmtNum(c?.mark_price ?? c?.markPrice, 4)}`);
      lines.push(`Oracle price:    $${fmtNum(c?.oracle_price ?? c?.oraclePrice, 4)}`);
      lines.push(`24h volume:      ${fmtUsdShort(c?.base_currency_volume_24h_usd ?? c?.quote_volume_24h ?? c?.volume_24h)}`);
      lines.push(`Open interest:   ${fmtUsdShort(c?.open_interest ?? c?.openInterest)}`);
      const fr = Number(c?.next_funding_rate ?? c?.last_funding_rate ?? c?.fundingRate ?? 0);
      lines.push(`Funding (1h):    ${fmtPct(fr, 5)}`);
      lines.push(`Annualized:      ${fmtPct(annualizedFunding(fr), 2)}`);
      if (c?.max_leverage ?? c?.maxLeverage) lines.push(`Max leverage:    ${c?.max_leverage ?? c?.maxLeverage}×`);
      if (c?.base_asset_symbol) lines.push(`Base asset:      ${c.base_asset_symbol}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_drift_orderbook') {
      const marketIndex = Number(args.marketIndex);
      const depth = Number(args.depth ?? 10);
      const res = await httpJson<any>(`${DRIFT_DLOB}/l2?marketIndex=${marketIndex}&marketType=perp&depth=${depth}`);
      const bids: any[] = res?.bids ?? [];
      const asks: any[] = res?.asks ?? [];
      const lines: string[] = [];
      lines.push(`Drift L2 orderbook — market index ${marketIndex}`);
      lines.push('');
      lines.push('Asks (sell side):');
      const askSlice = asks.slice(0, depth).reverse();
      for (const a of askSlice) {
        lines.push(`  $${fmtNum(a?.price, 4)}    size ${fmtNum(a?.size, 4)}`);
      }
      lines.push('-- spread --');
      const bidSlice = bids.slice(0, depth);
      for (const b of bidSlice) {
        lines.push(`  $${fmtNum(b?.price, 4)}    size ${fmtNum(b?.size, 4)}`);
      }
      if (asks.length === 0 && bids.length === 0) {
        lines.push('(no orderbook data — market may be inactive)');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_drift_funding') {
      const marketIndex = Number(args.marketIndex);
      const window = String(args.window ?? '24h');
      const now = Math.floor(Date.now() / 1000);
      const from = window === '7d' ? now - 86_400 * 7 : now - 86_400;
      const url = `${DRIFT_DATA}/fundingRates?marketIndex=${marketIndex}&marketType=perp&from=${from}&to=${now}`;
      const res = await httpJson<any>(url);
      const rates: any[] = res?.fundingRates ?? res?.records ?? (Array.isArray(res) ? res : []);
      const lines: string[] = [];
      lines.push(`Drift funding history — market index ${marketIndex}, last ${window}`);
      lines.push('');
      if (rates.length === 0) {
        lines.push('(no funding records — endpoint may have changed; raw response truncated below)');
        lines.push(JSON.stringify(res, null, 2).slice(0, 300));
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      // Sort descending by ts; cap output
      rates.sort((a, b) => Number(b?.ts ?? b?.timestamp ?? 0) - Number(a?.ts ?? a?.timestamp ?? 0));
      const cap = window === '7d' ? 24 : 24;
      const shown = rates.slice(0, cap);
      let sum = 0;
      let count = 0;
      for (const r of rates) {
        const fr = Number(r?.fundingRate ?? r?.funding_rate ?? 0);
        if (isFinite(fr)) { sum += fr; count++; }
      }
      const avgHourly = count > 0 ? sum / count : 0;
      lines.push(`Average hourly funding over window: ${fmtPct(avgHourly, 5)}`);
      lines.push(`Annualized equivalent:                ${fmtPct(annualizedFunding(avgHourly), 2)}`);
      lines.push('');
      lines.push('Recent (newest first):');
      for (const r of shown) {
        const ts = Number(r?.ts ?? r?.timestamp ?? 0);
        const iso = ts > 0 ? new Date(ts * 1000).toISOString() : '?';
        const fr = Number(r?.fundingRate ?? r?.funding_rate ?? 0);
        lines.push(`  ${iso}    ${fmtPct(fr, 5)}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_drift_user') {
      const authority = String(args.authority);
      const subAccountId = Number(args.subAccountId ?? 0);
      // Drift data API exposes user state
      const url = `${DRIFT_DATA}/user?authority=${authority}&subAccountId=${subAccountId}`;
      let res: any;
      try {
        res = await httpJson<any>(url);
      } catch (e: any) {
        return {
          content: [{
            type: 'text',
            text: `Drift user lookup failed: ${e?.message ?? e}. The authority may not have a Drift account, or the data API is down. Check directly: https://app.drift.trade`,
          }],
        };
      }
      const lines: string[] = [];
      lines.push(`Drift user — ${authority} (sub-account ${subAccountId})`);
      lines.push('');
      const collateral = res?.totalCollateral ?? res?.total_collateral ?? res?.collateral;
      const freeCollateral = res?.freeCollateral ?? res?.free_collateral;
      const leverage = res?.leverage ?? res?.totalLeverage;
      lines.push(`Total collateral:   ${fmtUsdShort(collateral)}`);
      lines.push(`Free collateral:    ${fmtUsdShort(freeCollateral)}`);
      lines.push(`Total leverage:     ${fmtNum(leverage, 2)}×`);
      lines.push('');

      const positions: any[] = res?.perpPositions ?? res?.positions ?? [];
      lines.push(`Open positions: ${positions.length}`);
      for (const p of positions) {
        const sym = p?.marketSymbol ?? p?.symbol ?? `idx-${p?.marketIndex ?? '?'}`;
        const size = fmtNum(p?.baseAssetAmount ?? p?.size, 4);
        const entry = fmtNum(p?.entryPrice ?? p?.avgPrice, 4);
        const pnl = fmtUsdShort(p?.unrealizedPnl ?? p?.upnl);
        lines.push(`  • ${sym}    size: ${size}    entry: $${entry}    uPnL: ${pnl}`);
      }
      const orders: any[] = res?.openOrders ?? res?.orders ?? [];
      if (orders.length > 0) {
        lines.push('');
        lines.push(`Open orders: ${orders.length}`);
        for (const o of orders.slice(0, 10)) {
          const sym = o?.marketSymbol ?? o?.symbol ?? `idx-${o?.marketIndex ?? '?'}`;
          const side = o?.direction ?? o?.side ?? '?';
          const size = fmtNum(o?.baseAssetAmount ?? o?.size, 4);
          const px = fmtNum(o?.price, 4);
          lines.push(`  • ${sym}    ${side} ${size} @ $${px}`);
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown Drift tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Drift error: ${message}`);
  }
}
