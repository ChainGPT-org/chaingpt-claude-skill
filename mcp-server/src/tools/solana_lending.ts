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
 *   Marginfi:  https://app.marginfi.com/api/v1/banks  (public, used by their app)
 *   Kamino:    https://api.kamino.finance/v2/markets, /v2/strategies
 *
 * Endpoint shapes can drift — parsing is defensive and unrecognized
 * structures surface a truncated raw response so the user can see what came
 * back without the tool exploding.
 */

const MARGINFI_API = 'https://app.marginfi.com/api/v1';
const KAMINO_API = 'https://api.kamino.finance';

export const solanaLendingTools: Tool[] = [
  // ─── Marginfi ─────────────────────────────────────────────────────
  {
    name: 'chaingpt_defi_marginfi_banks',
    description:
      'List Marginfi v2 lending banks on Solana mainnet. Each bank is a single-asset pool with utilization-driven ' +
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
      "Get a user's Marginfi account state: deposits per bank, borrows per bank, health factor (Marginfi's risk " +
      'metric is `assets - liabilities`, but they expose a 0–1 health ratio too). The user is identified by their ' +
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
        limit: { type: 'number', description: 'Max markets to return. Default 10.', default: 10 },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_defi_kamino_vaults',
    description:
      'List Kamino vault strategies on Solana mainnet (Kamino Multiply, automated yield strategies). Returns: ' +
      'strategy name, type, asset pair, current APY, TVL. Use for passive yield discovery. Read-only. ' +
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
  if (!isFinite(v as number) || v === 0) return '$0';
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
        res = await httpJson<any>(`${MARGINFI_API}/banks`);
      } catch (e: any) {
        return {
          content: [{
            type: 'text',
            text:
              `Marginfi banks endpoint unreachable: ${e?.message ?? e}. ` +
              `The API may have moved — check https://app.marginfi.com directly.`,
          }],
        };
      }
      const banks: any[] = Array.isArray(res) ? res : (res?.banks ?? res?.data ?? []);
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
      banks.sort((a, b) => sortKey[sortBy]?.(a) ?? 0 - (sortKey[sortBy]?.(b) ?? 0));
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
        lines.push(`• ${sym}    Supply APY: ${fmtPct(supplyApy)}    Borrow APY: ${fmtPct(borrowApy)}    Util: ${fmtPct(util)}`);
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
        res = await httpJson<any>(`${MARGINFI_API}/account?authority=${authority}`);
      } catch (e: any) {
        return {
          content: [{
            type: 'text',
            text:
              `Marginfi account lookup failed: ${e?.message ?? e}. The authority may not have a marginfi account, ` +
              `or the endpoint has moved. Check https://app.marginfi.com directly.`,
          }],
        };
      }
      const accounts: any[] = Array.isArray(res) ? res : (res?.accounts ?? [res]);
      const lines: string[] = [];
      lines.push(`Marginfi accounts for ${authority}: ${accounts.length}`);
      lines.push('');
      for (const acc of accounts) {
        const accAddr = pickField(acc, 'address', 'pubkey') ?? '?';
        const health = pickField(acc, 'health', 'healthRatio', 'healthFactor');
        const assets = pickField(acc, 'totalAssetsUsd', 'totalAssets', 'assetsUsd') ?? 0;
        const liabs = pickField(acc, 'totalLiabilitiesUsd', 'totalLiabilities', 'liabilitiesUsd') ?? 0;
        lines.push(`Account ${accAddr}`);
        lines.push(`  Total assets:       ${fmtUsdShort(assets)}`);
        lines.push(`  Total liabilities:  ${fmtUsdShort(liabs)}`);
        lines.push(`  Net equity:         ${fmtUsdShort(Number(assets) - Number(liabs))}`);
        if (health !== undefined) lines.push(`  Health ratio:       ${typeof health === 'number' ? health.toFixed(3) : health}`);

        const balances: any[] = pickField(acc, 'balances', 'positions') ?? [];
        for (const bal of balances) {
          const sym = pickField(bal, 'tokenSymbol', 'symbol') ?? '?';
          const dep = pickField(bal, 'depositUsd', 'depositedUsd', 'suppliedUsd') ?? 0;
          const bor = pickField(bal, 'borrowUsd', 'borrowedUsd') ?? 0;
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
      const limit = Number(args.limit ?? 10);
      let res: any;
      try {
        res = await httpJson<any>(`${KAMINO_API}/v2/markets`);
      } catch (e: any) {
        // Older endpoint shape
        try {
          res = await httpJson<any>(`${KAMINO_API}/kamino-market`);
        } catch (e2: any) {
          return {
            content: [{
              type: 'text',
              text:
                `Kamino markets endpoint unreachable: ${e?.message ?? e}. The API may have moved — ` +
                `check https://app.kamino.finance directly.`,
            }],
          };
        }
      }
      const markets: any[] = Array.isArray(res) ? res : (res?.markets ?? res?.data ?? []);
      markets.sort((a, b) => -Number(pickField(a, 'totalSuppliedUsd', 'supplyTvl', 'tvl') ?? 0) - (-Number(pickField(b, 'totalSuppliedUsd', 'supplyTvl', 'tvl') ?? 0)));
      const top = markets.slice(0, limit);

      const lines: string[] = [];
      lines.push(`Kamino lending markets — ${markets.length} total, showing top ${top.length}`);
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
        const reserves: any[] = pickField(m, 'reserves', 'assets') ?? [];
        if (reserves.length > 0) {
          const summary = reserves.slice(0, 5).map((r) => pickField(r, 'symbol', 'tokenSymbol') ?? '?').join(', ');
          lines.push(`    Top assets: ${summary}`);
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
        res = await httpJson<any>(`${KAMINO_API}/v2/strategies`);
      } catch (e: any) {
        try {
          res = await httpJson<any>(`${KAMINO_API}/strategies`);
        } catch (e2: any) {
          return {
            content: [{
              type: 'text',
              text:
                `Kamino strategies endpoint unreachable: ${e?.message ?? e}. The API may have moved — ` +
                `check https://app.kamino.finance directly.`,
            }],
          };
        }
      }
      const strategies: any[] = Array.isArray(res) ? res : (res?.strategies ?? res?.data ?? []);
      strategies.sort((a, b) => -Number(pickField(a, 'tvl', 'totalAssetsUsd', 'tvlUsd') ?? 0) - (-Number(pickField(b, 'tvl', 'totalAssetsUsd', 'tvlUsd') ?? 0)));
      const top = strategies.slice(0, limit);
      const lines: string[] = [];
      lines.push(`Kamino vault strategies — ${strategies.length} total, showing top ${top.length} by TVL`);
      lines.push('');
      if (top.length === 0) {
        lines.push(`(no strategies in response; raw: ${JSON.stringify(res).slice(0, 300)})`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      for (const s of top) {
        const name = pickField(s, 'name', 'strategyName') ?? '(unnamed strategy)';
        const type = pickField(s, 'type', 'strategyType') ?? '?';
        const apy = pickField(s, 'apy', 'netApy', 'totalApy');
        const tvl = pickField(s, 'tvl', 'totalAssetsUsd', 'tvlUsd');
        const tokenA = pickField(s, 'tokenA', 'tokenASymbol');
        const tokenB = pickField(s, 'tokenB', 'tokenBSymbol');
        const pair = tokenA && tokenB ? `${tokenA}/${tokenB}` : (tokenA ?? '?');
        const addr = pickField(s, 'address', 'strategy', 'pubkey') ?? '?';
        lines.push(`• ${name}    (${type})`);
        lines.push(`    Asset: ${pair}    APY: ${fmtPct(apy)}    TVL: ${fmtUsdShort(tvl)}`);
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
