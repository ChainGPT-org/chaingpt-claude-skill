import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { resolveChain } from '../lib/chains.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-6.3 yield discovery: Pendle (yield trading) + Morpho (lending).
 *
 * Both are read-only — they surface APYs, TVL, and market shapes the user
 * needs to pick a deployment. Tx-building for Pendle/Morpho is intentionally
 * NOT included here: both protocols use complex multicall + permit2 patterns
 * that are best handled via their official SDKs once the user has picked a
 * specific market. These tools answer "what should I deploy into?" — not
 * "execute the deployment."
 */

const PENDLE_API = 'https://api-v2.pendle.finance/core';
const MORPHO_GQL = 'https://blue-api.morpho.org/graphql';

// Pendle deployments (chain id → ok)
const PENDLE_CHAIN_IDS = new Set([1, 10, 56, 42161, 5000, 8453]);

// Morpho Blue deployments
const MORPHO_CHAIN_SLUGS = ['ethereum', 'base'];

export const yieldTools: Tool[] = [
  // ─── Pendle ───────────────────────────────────────────────────────
  {
    name: 'chaingpt_defi_pendle_markets',
    description:
      'List active Pendle yield-trading markets on a chain. Each market lets you split a yield-bearing asset ' +
      '(e.g. stETH, sUSDe, USR) into PT (fixed-yield, redeemable at maturity) and YT (pure yield stream). ' +
      'Returns: market name, maturity date, fixed APY (from buying PT), implied APY, underlying TVL. ' +
      'Sorted by TVL descending. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          enum: ['ethereum', 'arbitrum', 'optimism', 'bsc', 'base', 'mantle'],
          description: 'Pendle-supported chain.',
        },
        limit: { type: 'number', description: 'Max markets to return. Default 20.', default: 20 },
      },
      required: ['network'],
    },
  },
  {
    name: 'chaingpt_defi_pendle_market',
    description:
      'Get a single Pendle market in detail: maturity, current PT/YT prices, fixed vs implied APY spread, ' +
      'liquidity, underlying yield source. Use after chaingpt_defi_pendle_markets to drill into a candidate. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: ['ethereum', 'arbitrum', 'optimism', 'bsc', 'base', 'mantle'] },
        marketAddress: { type: 'string', description: 'Pendle market contract address.' },
      },
      required: ['network', 'marketAddress'],
    },
  },

  // ─── Morpho Blue ───────────────────────────────────────────────────
  {
    name: 'chaingpt_defi_morpho_markets',
    description:
      'List active Morpho Blue lending markets. Each market is a (loan_token, collateral_token, oracle, ' +
      'lltv) tuple with isolated risk. Returns: market id, asset pair, LLTV (max loan-to-value), supply APY, ' +
      'borrow APY, supply + borrow TVL. Sorted by supply TVL. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: {
          type: 'string',
          enum: MORPHO_CHAIN_SLUGS,
          description: 'Chain. Morpho Blue is on Ethereum and Base.',
        },
        limit: { type: 'number', description: 'Max markets to return. Default 20.', default: 20 },
      },
      required: ['network'],
    },
  },
  {
    name: 'chaingpt_defi_morpho_vaults',
    description:
      'List MetaMorpho vaults — curated baskets of Morpho Blue markets run by professional risk curators ' +
      '(Gauntlet, Steakhouse, MEV Capital, Re7). For passive lenders: pick a vault rather than a raw market. ' +
      'Returns: vault name, curator, asset, supply APY, TVL. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: MORPHO_CHAIN_SLUGS },
        asset: {
          type: 'string',
          description: 'Optional: filter to vaults denominated in this asset symbol (e.g. "USDC", "WETH").',
        },
        limit: { type: 'number', description: 'Max vaults to return. Default 20.', default: 20 },
      },
      required: ['network'],
    },
  },
  {
    name: 'chaingpt_defi_morpho_position',
    description:
      "Get a user's Morpho Blue positions: which markets they're lending/borrowing in, sizes, health factors. " +
      'Returns positions across all markets and any MetaMorpho vault shares. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        network: { type: 'string', enum: MORPHO_CHAIN_SLUGS },
        address: { type: 'string', description: 'User wallet address (0x…).' },
      },
      required: ['network', 'address'],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────
function pctFromDecimal(d: number | string | null | undefined): string {
  if (d === null || d === undefined) return 'n/a';
  const n = typeof d === 'string' ? Number(d) : d;
  if (!isFinite(n)) return 'n/a';
  return (n * 100).toFixed(2) + '%';
}

function formatUsdShort(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!isFinite(v) || v === 0) return '$0';
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
}

function daysUntil(timestamp: number | string): string {
  const ts = typeof timestamp === 'string' ? Date.parse(timestamp) / 1000 : Number(timestamp);
  if (!isFinite(ts)) return 'n/a';
  const now = Math.floor(Date.now() / 1000);
  const days = Math.round((ts - now) / 86_400);
  if (days < 0) return 'matured';
  if (days === 0) return 'today';
  return `${days}d`;
}

async function morphoGql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await httpJson<{ data?: T; errors?: Array<{ message: string }> }>(MORPHO_GQL, {
    method: 'POST',
    body: { query, variables },
  });
  if (res.errors?.length) {
    throw new Error(`Morpho GraphQL error: ${res.errors[0].message}`);
  }
  if (!res.data) throw new Error('Morpho GraphQL returned no data');
  return res.data;
}

// Morpho chain ids
const MORPHO_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
};

export async function handleYieldTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) return { content: [{ type: 'text', text: 'No arguments provided.' }] };

  try {
    // ── Pendle ────────────────────────────────────────────────────────
    if (name === 'chaingpt_defi_pendle_markets') {
      const network = String(args.network);
      const chain = resolveChain(network);
      if (!chain?.chainId || !PENDLE_CHAIN_IDS.has(chain.chainId)) {
        return { content: [{ type: 'text', text: `Pendle does not support ${network}.` }] };
      }
      const limit = Number(args.limit ?? 20);
      const res = await httpJson<any>(`${PENDLE_API}/v1/${chain.chainId}/markets/active`);
      const markets = Array.isArray(res?.markets) ? res.markets : [];
      // The list endpoint moved liquidity/APYs under `details` (mid-2026); keep old paths as fallback.
      const liqOf = (m: any) => Number(m?.details?.liquidity ?? m?.liquidity?.usd ?? 0);
      markets.sort((a: any, b: any) => liqOf(b) - liqOf(a));
      const top = markets.slice(0, limit);

      const lines: string[] = [];
      lines.push(`Pendle active markets — ${chain.name} (${markets.length} total, showing top ${top.length})`);
      lines.push('');
      lines.push(top.length === 0 ? '(no active markets)' : '');

      for (const m of top) {
        const name = m?.name ?? m?.pt?.symbol ?? m?.address?.slice(0, 10);
        const tvl = formatUsdShort(m?.details?.liquidity ?? m?.liquidity?.usd);
        const expiryDays = daysUntil(m?.expiry ?? 0);
        const ptAPY = pctFromDecimal(m?.details?.aggregatedApy ?? m?.aggregatedApy);
        const impliedAPY = pctFromDecimal(m?.details?.impliedApy ?? m?.impliedApy);
        lines.push(`• ${name}`);
        lines.push(`    Maturity:    ${expiryDays}    TVL: ${tvl}`);
        lines.push(`    Fixed APY (buy PT):  ${ptAPY}    Implied APY: ${impliedAPY}`);
        lines.push(`    Market: ${m?.address ?? 'n/a'}`);
        lines.push('');
      }
      lines.push('Next: chaingpt_defi_pendle_market network=' + network + ' marketAddress=<address> for detail.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_defi_pendle_market') {
      const network = String(args.network);
      const chain = resolveChain(network);
      if (!chain?.chainId || !PENDLE_CHAIN_IDS.has(chain.chainId)) {
        return { content: [{ type: 'text', text: `Pendle does not support ${network}.` }] };
      }
      const addr = String(args.marketAddress).toLowerCase();
      const res = await httpJson<any>(`${PENDLE_API}/v1/${chain.chainId}/markets/${addr}`);
      if (!res || res?.statusCode === 404) {
        return { content: [{ type: 'text', text: `Market ${addr} not found on ${chain.name}.` }] };
      }
      const lines: string[] = [];
      lines.push(`Pendle market — ${res?.name ?? addr}`);
      lines.push('');
      lines.push(`Chain:            ${chain.name}`);
      lines.push(`Address:          ${res?.address ?? addr}`);
      lines.push(`Maturity:         ${daysUntil(res?.expiry ?? 0)}`);
      lines.push(`TVL:              ${formatUsdShort(res?.liquidity?.usd)}`);
      lines.push(`Underlying APY:   ${pctFromDecimal(res?.underlyingApy)}`);
      lines.push(`Fixed APY (PT):   ${pctFromDecimal(res?.aggregatedApy)}`);
      lines.push(`Implied APY:     ${pctFromDecimal(res?.impliedApy)}`);
      lines.push(`YT floating APY:  ${pctFromDecimal(res?.ytFloatingApy)}`);
      lines.push('');
      if (res?.pt) lines.push(`PT (Principal Token):  ${res.pt.address}    symbol: ${res.pt.symbol ?? '?'}`);
      if (res?.yt) lines.push(`YT (Yield Token):      ${res.yt.address}    symbol: ${res.yt.symbol ?? '?'}`);
      if (res?.sy) lines.push(`SY (Standardized Yield): ${res.sy.address}    symbol: ${res.sy.symbol ?? '?'}`);
      lines.push('');
      lines.push('To deploy: use Pendle UI (https://app.pendle.finance) — multicall tx-building isn\'t in this skill yet.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── Morpho Blue ───────────────────────────────────────────────────
    if (name === 'chaingpt_defi_morpho_markets') {
      const network = String(args.network);
      if (!MORPHO_CHAIN_SLUGS.includes(network)) {
        return { content: [{ type: 'text', text: `Morpho Blue does not support ${network}.` }] };
      }
      const chainId = MORPHO_CHAIN_IDS[network];
      const limit = Number(args.limit ?? 20);
      const query = `query Markets($first: Int!, $where: MarketFilters) {
        markets(first: $first, where: $where, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
          items {
            marketId
            lltv
            loanAsset { symbol address decimals }
            collateralAsset { symbol address decimals }
            state { supplyApy borrowApy supplyAssetsUsd borrowAssetsUsd utilization }
          }
        }
      }`;
      // listed:true filters out unvetted markets with oracle-manipulated TVL/APY
      const data = await morphoGql<any>(query, { first: limit, where: { chainId_in: [chainId], listed: true } });
      const items = data?.markets?.items ?? [];

      const lines: string[] = [];
      lines.push(`Morpho Blue markets — ${network} (top ${items.length} by supply TVL)`);
      lines.push('');
      if (items.length === 0) lines.push('(no markets)');
      for (const m of items) {
        const loan = m.loanAsset?.symbol ?? '?';
        const coll = m.collateralAsset?.symbol ?? '?';
        const lltv = m.lltv ? (Number(m.lltv) / 1e18 * 100).toFixed(0) + '%' : 'n/a';
        const supplyApy = pctFromDecimal(m.state?.supplyApy);
        const borrowApy = pctFromDecimal(m.state?.borrowApy);
        const supplyTvl = formatUsdShort(m.state?.supplyAssetsUsd);
        const borrowTvl = formatUsdShort(m.state?.borrowAssetsUsd);
        const util = pctFromDecimal(m.state?.utilization);
        lines.push(`• ${loan} / ${coll}    LLTV ${lltv}`);
        lines.push(`    Supply APY: ${supplyApy}    Borrow APY: ${borrowApy}    Util: ${util}`);
        lines.push(`    Supply TVL: ${supplyTvl}    Borrow TVL: ${borrowTvl}`);
        lines.push(`    Market id: ${m.marketId}`);
        lines.push('');
      }
      lines.push('Next: chaingpt_defi_morpho_vaults for curated baskets, or chaingpt_defi_morpho_position for a wallet view.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_defi_morpho_vaults') {
      const network = String(args.network);
      if (!MORPHO_CHAIN_SLUGS.includes(network)) {
        return { content: [{ type: 'text', text: `Morpho Blue does not support ${network}.` }] };
      }
      const chainId = MORPHO_CHAIN_IDS[network];
      const limit = Number(args.limit ?? 20);
      const assetSym = args.asset ? String(args.asset).toUpperCase() : null;

      const query = `query Vaults($first: Int!, $where: VaultFilters) {
        vaults(first: $first, where: $where, orderBy: TotalAssetsUsd, orderDirection: Desc) {
          items {
            address
            name
            symbol
            asset { symbol address decimals }
            state { netApy totalAssetsUsd curators { name } }
          }
        }
      }`;
      const where: any = { chainId_in: [chainId] };
      if (assetSym) where.assetSymbol_in = [assetSym];
      const data = await morphoGql<any>(query, { first: limit, where });
      const items = data?.vaults?.items ?? [];

      const lines: string[] = [];
      lines.push(`MetaMorpho vaults — ${network}${assetSym ? ` (filter: ${assetSym})` : ''} (top ${items.length})`);
      lines.push('');
      if (items.length === 0) lines.push('(no vaults match)');
      for (const v of items) {
        const curators = v.state?.curators?.map((c: any) => c.name).join(', ') || 'unknown';
        lines.push(`• ${v.name} (${v.symbol ?? '?'})`);
        lines.push(`    Curator: ${curators}`);
        lines.push(`    Asset: ${v.asset?.symbol ?? '?'}    Net APY: ${pctFromDecimal(v.state?.netApy)}    TVL: ${formatUsdShort(v.state?.totalAssetsUsd)}`);
        lines.push(`    Vault: ${v.address}`);
        lines.push('');
      }
      lines.push('Deposit via https://app.morpho.org — the underlying is ERC-4626, so any 4626 frontend works.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_defi_morpho_position') {
      const network = String(args.network);
      if (!MORPHO_CHAIN_SLUGS.includes(network)) {
        return { content: [{ type: 'text', text: `Morpho Blue does not support ${network}.` }] };
      }
      const chainId = MORPHO_CHAIN_IDS[network];
      const address = String(args.address).toLowerCase();

      const query = `query User($address: String!, $chainId: Int!) {
        userByAddress(address: $address, chainId: $chainId) {
          address
          marketPositions {
            market {
              marketId
              loanAsset { symbol decimals }
              collateralAsset { symbol decimals }
              lltv
            }
            state {
              supplyAssetsUsd
              borrowAssetsUsd
              collateralUsd
            }
            healthFactor
          }
          vaultPositions {
            vault { name asset { symbol } address }
            state { assetsUsd }
          }
        }
      }`;
      let data: any;
      try {
        data = await morphoGql<any>(query, { address, chainId });
      } catch (e: any) {
        // User might not exist on Morpho at all — surface friendly
        if (e?.message?.includes('not found') || e?.message?.includes('null')) {
          return { content: [{ type: 'text', text: `No Morpho positions for ${address} on ${network}.` }] };
        }
        throw e;
      }
      const u = data?.userByAddress;
      if (!u) {
        return { content: [{ type: 'text', text: `No Morpho positions for ${address} on ${network}.` }] };
      }
      const lines: string[] = [];
      lines.push(`Morpho positions — ${address} on ${network}`);
      lines.push('');

      const mps = u.marketPositions ?? [];
      const active = mps.filter((p: any) => Number(p.state?.supplyAssetsUsd ?? 0) + Number(p.state?.borrowAssetsUsd ?? 0) + Number(p.state?.collateralUsd ?? 0) > 0);
      lines.push(`Market positions: ${active.length}`);
      for (const p of active) {
        const loan = p.market.loanAsset?.symbol ?? '?';
        const coll = p.market.collateralAsset?.symbol ?? '?';
        const hf = p.healthFactor !== null && p.healthFactor !== undefined ? Number(p.healthFactor).toFixed(2) : 'n/a';
        lines.push(`  • ${loan} / ${coll}    HF: ${hf}`);
        lines.push(`      Supplied: ${formatUsdShort(p.state?.supplyAssetsUsd)}    Borrowed: ${formatUsdShort(p.state?.borrowAssetsUsd)}    Collateral: ${formatUsdShort(p.state?.collateralUsd)}`);
      }

      const vps = u.vaultPositions ?? [];
      const activeVaults = vps.filter((p: any) => Number(p.state?.assetsUsd ?? 0) > 0);
      lines.push('');
      lines.push(`Vault positions: ${activeVaults.length}`);
      for (const p of activeVaults) {
        lines.push(`  • ${p.vault?.name} (${p.vault?.asset?.symbol ?? '?'}):  ${formatUsdShort(p.state?.assetsUsd)}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown yield tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Yield error: ${message}`);
  }
}
