import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-6.5 Solana lending: Marginfi + Kamino.
 *
 * Completes the Solana DeFi triad alongside Drift (perps). All read-only —
 * deploying capital on Solana requires Anchor program instructions + Ed25519
 * signing, which is a different flow than the EVM path and is intentionally
 * deferred.
 *
 *   Marginfi v2:  permissionless Solana lending. Banks = single-asset pools
 *                 with utilization-driven supply/borrow APYs. Cross-margin
 *                 across all banks via the user's marginfi account.
 *
 *   Kamino:       lending + leveraged-yield vaults (Kamino Multiply, K-Lend).
 *                 More opinionated than Marginfi — vault strategies handle
 *                 the rate selection + auto-compounding for passive lenders.
 *
 * Endpoints:
 *   Marginfi:  https://ai.0.xyz/v1/banks?venue=P0, /account/{address} (Project 0)
 *   Kamino:    https://api.kamino.finance/v2/kamino-market, /strategies/metrics
 *
 * Endpoint shapes can drift — unknown schemas fail explicitly; unavailable
 * financial metrics are shown as n/a, never as zero.
 */

const PROJECT0_API = 'https://ai.0.xyz/v1';
const KAMINO_API = 'https://api.kamino.finance';

export const solanaLendingTools: Tool[] = [
  // ─── Marginfi ─────────────────────────────────────────────────────
  {
    name: 'chaingpt_defi_marginfi_banks',
    description:
      'List Marginfi / Project 0 lending banks on Solana mainnet. Each bank is a single-asset pool with utilization-driven ' +
      'supply/borrow APYs. Returns: bank address, asset symbol, supply APY, borrow APY, total supplied USD, ' +
      'total borrowed USD, utilization. Sorted by supplied TVL. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max banks to return. Default 20.', default: 20 },
        sortBy: {
          type: 'string',
          enum: ['supplyTvl', 'supplyApy', 'borrowApy', 'utilization'],
          default: 'supplyTvl',
          description: 'Sort field.',
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_defi_marginfi_account',
    description:
      "Get a user's Marginfi / Project 0 account state: deposits per bank, borrows per bank, equity and health factor. " +
      'An empty account may have no health factor. The user is identified by their ' +
      'Solana authority pubkey (base58). Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        authority: { type: 'string', description: 'Solana wallet authority (base58 pubkey).' },
      },
      required: ['authority'],
    },
  },

  // ─── Kamino ────────────────────────────────────────────────────────
  {
    name: 'chaingpt_defi_kamino_markets',
    description:
      'List Kamino lending markets on Solana mainnet. Each market is a curated pool of assets with their own ' +
      'supply / borrow APYs. Returns: market address, name, total supplied USD, total borrowed USD, top assets. ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max markets to return (1–20). Default 10.', default: 10 },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_defi_kamino_vaults',
    description:
      'List Kamino vault strategies on Solana mainnet (Kamino Multiply, automated yield strategies). Returns: ' +
      'strategy name, type when available, asset pair, current APY, TVL. Use for passive yield discovery. Read-only. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max vaults to return. Default 15.', default: 15 },
      },
      required: [],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────
function fmtPct(d: number | string | null | undefined, decimals = 2): string {
  if (d === null || d === undefined) return 'n/a';
  const n = typeof d === 'string' ? Number(d) : d;
  if (!isFinite(n)) return 'n/a';
  // Marginfi/Kamino APIs sometimes return APYs already scaled to percentage (e.g. 5.2)
  // and sometimes as decimal (0.052). Be defensive: if it's > 1.5, assume already percentage.
  return (Math.abs(n) > 1.5 ? n : n * 100).toFixed(decimals) + '%';
}

function fmtUsdShort(n: unknown): string {
  const v = typeof n === 'string' ? Number(n) : (n as number);
  if (n === undefined || n === null || !isFinite(v as number)) return 'n/a';
  if (v === 0) return '$0';
  const x = v as number;
  if (x >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(2)}B`;
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}k`;
  return `$${x.toFixed(2)}`;
}

function pickField(obj: any, ...names: string[]): any {
  for (const n of names) {
    if (obj?.[n] !== undefined && obj?.[n] !== null) return obj[n];
  }
  return undefined;
}

/** Current APIs explicitly label percentages; never infer their units from magnitude. */
function fmtPercent(value: unknown): string {
  return value !== undefined && value !== null && Number.isFinite(Number(value)) ? Number(value).toFixed(2) + '%' : 'n/a';
}

function currentBank(b: any): any {
  if (!b.rates || !b.size) return b;
  return { ...b, supplyApy: Number(b.rates.total_deposit_apy_pct) / 100,
    borrowApy: Number(b.rates.total_borrow_apy_pct) / 100,
    utilization: Number(b.rates.utilization_pct) / 100,
    totalSuppliedUsd: b.size.deposits_usd, totalBorrowedUsd: b.size.borrows_usd };
}

export async function handleSolanaLendingTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) return { content: [{ type: 'text', text: 'No arguments provided.' }] };

  try {
    // ── Marginfi ────────────────────────────────────────────────────
    if (name === 'chaingpt_defi_marginfi_banks') {
      const limit = Number(args.limit ?? 20);
      const sortBy = String(args.sortBy ?? 'supplyTvl');
      let res: any;
      try {
        res = await httpJson<any>(`${PROJECT0_API}/banks?venue=P0`);
      } catch (e: any) {
        return {
          content: [{
            type: 'text',
            text:
              `Marginfi banks endpoint unreachable: ${e?.message ?? e}. ` +
              `Check https://docs.marginfi.com/guides/mcp-server for Project 0 API availability.`,
          }],
        };
      }
      const rows = Array.isArray(res) ? res : (res?.banks ?? res?.data);
      if (!Array.isArray(rows)) throw new Error('Unrecognized Project 0 banks response.');
      const banks: any[] = rows.filter(b => !b.venue || b.venue === 'P0').map(currentBank);
      if (banks.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `Marginfi banks: no banks returned. Raw response (truncated): ${JSON.stringify(res).slice(0, 400)}`,
          }],
        };
      }

      const sortKey: Record<string, (b: any) => number> = {
        supplyTvl: (b) => -Number(pickField(b, 'totalSuppliedUsd', 'totalDepositedUsd', 'depositTvl') ?? 0),
        supplyApy: (b) => -Number(pickField(b, 'supplyApy', 'lendingApr', 'depositApy') ?? 0),
        borrowApy: (b) => -Number(pickField(b, 'borrowApy', 'borrowingApr') ?? 0),
        utilization: (b) => -Number(pickField(b, 'utilization', 'utilizationRate') ?? 0),
      };
      banks.sort((a, b) => {
        const av = sortKey[sortBy]?.(a) ?? 0;
        const bv = sortKey[sortBy]?.(b) ?? 0;
        return av - bv;
      });
      const top = banks.slice(0, limit);

      const lines: string[] = [];
      lines.push(`Marginfi v2 banks — ${banks.length} total, showing top ${top.length} by ${sortBy}`);
      lines.push('');
      for (const b of top) {
        const sym = pickField(b, 'tokenSymbol', 'symbol', 'mintSymbol', 'asset') ?? '?';
        const supplyApy = pickField(b, 'supplyApy', 'lendingApr', 'depositApy');
        const borrowApy = pickField(b, 'borrowApy', 'borrowingApr');
        const supplyTvl = pickField(b, 'totalSuppliedUsd', 'totalDepositedUsd', 'depositTvl');
        const borrowTvl = pickField(b, 'totalBorrowedUsd', 'borrowTvl');
        const util = pickField(b, 'utilization', 'utilizationRate');
        const addr = pickField(b, 'address', 'bankAddress', 'pubkey') ?? '?';
        lines.push(`• ${sym}    Supply APY: ${b.rates ? fmtPercent(b.rates.total_deposit_apy_pct) : fmtPct(supplyApy)}    Borrow APY: ${b.rates ? fmtPercent(b.rates.total_borrow_apy_pct) : fmtPct(borrowApy)}    Util: ${b.rates ? fmtPercent(b.rates.utilization_pct) : fmtPct(util)}`);
        lines.push(`    Supplied: ${fmtUsdShort(supplyTvl)}    Borrowed: ${fmtUsdShort(borrowTvl)}`);
        lines.push(`    Bank: ${addr}`);
        lines.push('');
      }
      lines.push('Next: chaingpt_defi_marginfi_account authority=<solana-pubkey> for a wallet position view.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_defi_marginfi_account') {
      const authority = String(args.authority);
      let res: any;
      try {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(authority)) throw new Error('Invalid Solana authority address.');
        res = await httpJson<any>(`${PROJECT0_API}/account/${authority}`);
      } catch (e: any) {
        return {
          content: [{
            type: 'text',
            text:
              `Marginfi account lookup failed: ${e?.message ?? e}. The authority may not have a marginfi account. ` +
              `Check https://docs.marginfi.com/guides/mcp-server for current availability.`,
          }],
        };
      }
      const accounts: any[] = Array.isArray(res) ? res : res?.accounts;
      if (!Array.isArray(accounts)) throw new Error('Unrecognized Project 0 account response.');
      const lines: string[] = [];
      lines.push(`Marginfi accounts for ${authority}: ${accounts.length}`);
      lines.push('');
      for (const acc of accounts) {
        const accAddr = pickField(acc, 'address', 'pubkey') ?? '?';
        const health = typeof acc.health === 'object' ? acc.health?.health_factor ?? 'n/a (empty account)' : pickField(acc, 'health', 'healthRatio', 'healthFactor');
        const assets = acc.equity?.total_assets_usd ?? pickField(acc, 'totalAssetsUsd', 'totalAssets', 'assetsUsd');
        const liabs = acc.equity?.total_liabilities_usd ?? pickField(acc, 'totalLiabilitiesUsd', 'totalLiabilities', 'liabilitiesUsd');
        lines.push(`Account ${accAddr}`);
        lines.push(`  Total assets:       ${fmtUsdShort(assets)}`);
        lines.push(`  Total liabilities:  ${fmtUsdShort(liabs)}`);
        lines.push(`  Net equity:         ${fmtUsdShort(Number(assets) - Number(liabs))}`);
        if (health !== undefined) lines.push(`  Health ratio:       ${typeof health === 'number' ? health.toFixed(3) : health}`);

        const balances: any[] = pickField(acc, 'balances', 'positions') ?? [];
        for (const bal of balances) {
          const sym = pickField(bal, 'tokenSymbol', 'symbol') ?? '?';
          const dep = bal.side === 'lend' ? bal.amount_usd : bal.side === 'borrow' ? 0 : pickField(bal, 'depositUsd', 'depositedUsd', 'suppliedUsd');
          const bor = bal.side === 'borrow' ? bal.amount_usd : bal.side === 'lend' ? 0 : pickField(bal, 'borrowUsd', 'borrowedUsd');
          if (Number(dep) > 0 || Number(bor) > 0) {
            lines.push(`    • ${sym}    deposit: ${fmtUsdShort(dep)}    borrow: ${fmtUsdShort(bor)}`);
          }
        }
        lines.push('');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Kamino ──────────────────────────────────────────────────────
    if (name === 'chaingpt_defi_kamino_markets') {
      const requestedLimit = Number(args.limit ?? 10);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error('limit must be a positive integer.');
      const limit = Math.min(20, requestedLimit);
      let res: any;
      try {
        res = await httpJson<any>(`${KAMINO_API}/v2/kamino-market`);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Kamino markets endpoint unreachable: ${e?.message ?? e}.` }] };
      }
      const markets: any[] = Array.isArray(res) ? res : (res?.markets ?? res?.data);
      if (!Array.isArray(markets)) throw new Error('Unrecognized Kamino markets response.');
      // The list is metadata, not a TVL ranking. Bound enrichment to the requested rows.
      const top = markets.slice(0, limit);
      for (let i = 0; i < top.length; i++) {
        const m = top[i];
        if (pickField(m, 'totalSuppliedUsd', 'supplyTvl', 'tvl') !== undefined) continue;
        const address = pickField(m, 'lendingMarket', 'address', 'pubkey');
        try {
          if (typeof address !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error('Invalid market address.');
          const reserves = await httpJson<any[]>(`${KAMINO_API}/kamino-market/${address}/reserves/metrics`);
          if (!Array.isArray(reserves) || !reserves.length || reserves.some(r => ['totalSupplyUsd', 'totalBorrowUsd'].some(k => r[k] == null || !Number.isFinite(Number(r[k]))))) throw new Error('Reserve metrics unavailable.');
          top[i] = { ...m, totalSuppliedUsd: reserves.reduce((n, r) => n + Number(r.totalSupplyUsd), 0),
            totalBorrowedUsd: reserves.reduce((n, r) => n + Number(r.totalBorrowUsd), 0),
            reserves: reserves.map(r => ({ symbol: r.liquidityToken })) };
        } catch (e: any) { top[i] = { ...m, metricsError: e?.message ?? String(e) }; }
      }

      const lines: string[] = [];
      lines.push(`Kamino lending markets — ${markets.length} total, showing ${top.length}`);
      lines.push('');
      if (top.length === 0) {
        lines.push(`(no markets in response; raw: ${JSON.stringify(res).slice(0, 300)})`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      for (const m of top) {
        const name = pickField(m, 'name', 'marketName', 'lendingMarketName') ?? '(unnamed market)';
        const supplyTvl = pickField(m, 'totalSuppliedUsd', 'supplyTvl', 'tvl');
        const borrowTvl = pickField(m, 'totalBorrowedUsd', 'borrowTvl');
        const addr = pickField(m, 'address', 'lendingMarket', 'pubkey') ?? '?';
        lines.push(`• ${name}`);
        lines.push(`    Supplied: ${fmtUsdShort(supplyTvl)}    Borrowed: ${fmtUsdShort(borrowTvl)}`);
        lines.push(`    Market: ${addr}`);
        if (m.metricsError) lines.push(`    Metrics unavailable: ${m.metricsError}`);
        const reserves: any[] = pickField(m, 'reserves', 'assets') ?? [];
        if (reserves.length > 0) {
          const summary = reserves.slice(0, 5).map((r) => pickField(r, 'symbol', 'tokenSymbol') ?? '?').join(', ');
          lines.push(`    Assets (first 5): ${summary}`);
        }
        lines.push('');
      }
      lines.push('Next: chaingpt_defi_kamino_vaults for automated yield strategies (passive deployment).');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_defi_kamino_vaults') {
      const limit = Number(args.limit ?? 15);
      let res: any;
      try {
        res = await httpJson<any>(`${KAMINO_API}/strategies/metrics?env=mainnet-beta&status=LIVE`);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Kamino strategies endpoint unreachable: ${e?.message ?? e}.` }] };
      }
      const strategies: any[] = Array.isArray(res) ? res : (res?.strategies ?? res?.data);
      if (!Array.isArray(strategies)) throw new Error('Unrecognized Kamino strategies response.');
      strategies.sort((a, b) => Number(pickField(b, 'totalValueLocked', 'tvl', 'totalAssetsUsd', 'tvlUsd') ?? 0) - Number(pickField(a, 'totalValueLocked', 'tvl', 'totalAssetsUsd', 'tvlUsd') ?? 0));
      const top = strategies.slice(0, limit);
      const lines: string[] = [];
      lines.push(`Kamino vault strategies — ${strategies.length} total, showing top ${top.length} by TVL`);
      lines.push('');
      if (top.length === 0) {
        lines.push(`(no strategies in response; raw: ${JSON.stringify(res).slice(0, 300)})`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      for (const s of top) {
        const name = pickField(s, 'name', 'strategyName') ?? ([s.tokenA, s.tokenB].filter(Boolean).join('/') || '(unnamed strategy)');
        const type = pickField(s, 'type', 'strategyType') ?? '?';
        const apyPercent = s.kaminoApy?.totalApy ?? s.apy?.totalApy;
        const apy = pickField(s, 'apy', 'netApy', 'totalApy');
        const tvl = pickField(s, 'totalValueLocked', 'tvl', 'totalAssetsUsd', 'tvlUsd');
        const tokenA = pickField(s, 'tokenA', 'tokenASymbol');
        const tokenB = pickField(s, 'tokenB', 'tokenBSymbol');
        const pair = tokenA && tokenB ? `${tokenA}/${tokenB}` : (tokenA ?? '?');
        const addr = pickField(s, 'address', 'strategy', 'pubkey') ?? '?';
        lines.push(`• ${name}    (${type})`);
        lines.push(`    Asset: ${pair}    APY: ${apyPercent !== undefined ? fmtPercent(apyPercent) : fmtPct(apy)}    TVL: ${fmtUsdShort(tvl)}`);
        lines.push(`    Strategy: ${addr}`);
        lines.push('');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown Solana lending tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Solana lending error: ${message}`);
  }
}
