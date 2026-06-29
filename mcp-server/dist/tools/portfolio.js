import { httpJson } from '../lib/http.js';
/**
 * Tier-8: Multi-protocol live P&L / portfolio snapshot.
 *
 * Composes data we already fetch for individual tools into a single
 * cross-venue view. Designed to answer "where is my money right now and
 * what is it doing?" without the user calling 6+ tools in sequence.
 *
 * Fans out in parallel to:
 *   - Hyperliquid account state (REST POST /info)
 *   - Polymarket positions (data-api.polymarket.com)
 *   - Morpho Blue positions (blue-api.morpho.org GraphQL)
 *   - Drift Solana positions (data.api.drift.trade, if Solana addr given)
 *
 * Each venue is best-effort: a failure on one venue logs a warning line in
 * the output and the other venues still surface. The tool does NOT include
 * spot wallet balances (use chaingpt_wallet_balances for that) — focuses
 * on active positions where mark-to-market and uPnL matter.
 */
const HL_INFO = 'https://api.hyperliquid.xyz/info';
const PM_DATA = 'https://data-api.polymarket.com';
const MORPHO_GQL = 'https://blue-api.morpho.org/graphql';
const DRIFT_DATA = 'https://data.api.drift.trade';
export const portfolioTools = [
    {
        name: 'chaingpt_portfolio_snapshot',
        description: 'Multi-protocol portfolio snapshot for one user. Fans out in parallel to Hyperliquid, Polymarket, ' +
            'Morpho Blue, and (if a Solana address is given) Drift. Returns a consolidated view: total exposure ' +
            'across venues, open positions with uPnL where available, free / used collateral, and a risk summary. ' +
            'Read-only. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                evmAddress: { type: 'string', description: 'EVM wallet address (0x…). Used for Hyperliquid + Polymarket + Morpho.' },
                solanaAddress: { type: 'string', description: 'Solana wallet authority (base58). Used for Drift. Optional.' },
                venues: {
                    type: 'array',
                    items: { type: 'string', enum: ['hyperliquid', 'polymarket', 'morpho', 'drift'] },
                    description: 'Optional filter — only query these venues. Default: all applicable based on which addresses are provided.',
                },
            },
            required: [],
        },
    },
];
// ── Helpers ──────────────────────────────────────────────────────
function fmtUsdShort(n) {
    const v = typeof n === 'string' ? Number(n) : n;
    if (!isFinite(v) || v === 0)
        return '$0';
    const x = v;
    if (x >= 1_000_000_000)
        return `$${(x / 1_000_000_000).toFixed(2)}B`;
    if (x >= 1_000_000)
        return `$${(x / 1_000_000).toFixed(2)}M`;
    if (x >= 1_000)
        return `$${(x / 1_000).toFixed(1)}k`;
    if (x < 0 && x > -1_000)
        return `-$${(-x).toFixed(2)}`;
    return `$${x.toFixed(2)}`;
}
function fmtNum(n, decimals = 2) {
    const v = typeof n === 'string' ? Number(n) : n;
    if (!isFinite(v))
        return 'n/a';
    return v.toFixed(decimals);
}
async function fetchHyperliquid(user) {
    try {
        const state = await httpJson(HL_INFO, {
            method: 'POST',
            body: { type: 'clearinghouseState', user },
        });
        const accountValue = Number(state?.marginSummary?.accountValue ?? 0);
        const totalRawUsd = Number(state?.marginSummary?.totalRawUsd ?? 0);
        const positions = state?.assetPositions ?? [];
        const lines = [];
        let totalUpnl = 0;
        lines.push(`Hyperliquid — account value ${fmtUsdShort(accountValue)} (raw USD: ${fmtUsdShort(totalRawUsd)})`);
        if (positions.length === 0) {
            lines.push('  (no open positions)');
        }
        for (const ap of positions) {
            const p = ap?.position ?? {};
            const coin = p?.coin ?? '?';
            const szi = Number(p?.szi ?? 0);
            const entry = Number(p?.entryPx ?? 0);
            const upnl = Number(p?.unrealizedPnl ?? 0);
            totalUpnl += upnl;
            const lev = p?.leverage?.value ?? '?';
            lines.push(`  • ${coin}    size: ${fmtNum(szi, 4)}    entry: ${fmtNum(entry, 4)}    uPnL: ${fmtUsdShort(upnl)}    lev: ${lev}×`);
        }
        return { venue: 'hyperliquid', ok: true, totalUsd: accountValue, unrealizedPnl: totalUpnl, lines };
    }
    catch (e) {
        return { venue: 'hyperliquid', ok: false, totalUsd: 0, lines: [`Hyperliquid — error: ${e?.message ?? e}`], error: e?.message };
    }
}
async function fetchPolymarket(user) {
    try {
        const positions = await httpJson(`${PM_DATA}/positions?user=${user}`);
        const arr = Array.isArray(positions) ? positions : [];
        // Sum across ALL positions for the venue total, NOT just the displayed slice.
        // Otherwise totalUsd is understated for accounts with > 20 positions.
        let totalValue = 0;
        for (const p of arr) {
            totalValue += Number(p?.currentValue ?? p?.value ?? 0);
        }
        const lines = [];
        lines.push(`Polymarket — ${arr.length} position${arr.length === 1 ? '' : 's'}`);
        for (const p of arr.slice(0, 20)) {
            const market = p?.title ?? p?.market ?? '(unknown market)';
            const outcome = p?.outcome ?? '?';
            const size = Number(p?.size ?? 0);
            const currentValue = Number(p?.currentValue ?? p?.value ?? 0);
            const cost = Number(p?.totalBought ?? p?.initialValue ?? 0);
            const pnl = currentValue - cost;
            lines.push(`  • ${market.slice(0, 60)}${market.length > 60 ? '…' : ''}`);
            lines.push(`      ${outcome}    size: ${fmtNum(size, 0)}    value: ${fmtUsdShort(currentValue)}    P&L: ${fmtUsdShort(pnl)}`);
        }
        if (arr.length > 20)
            lines.push(`  …and ${arr.length - 20} more (total ${fmtUsdShort(totalValue)} reflects all positions)`);
        return { venue: 'polymarket', ok: true, totalUsd: totalValue, lines };
    }
    catch (e) {
        return { venue: 'polymarket', ok: false, totalUsd: 0, lines: [`Polymarket — error: ${e?.message ?? e}`], error: e?.message };
    }
}
async function fetchMorpho(address) {
    // Query both ethereum (1) + base (8453) in one user lookup per chain
    const query = `query User($address: String!, $chainId: Int!) {
    userByAddress(address: $address, chainId: $chainId) {
      marketPositions {
        market {
          uniqueKey
          loanAsset { symbol }
          collateralAsset { symbol }
        }
        state { supplyAssetsUsd borrowAssetsUsd collateralUsd }
        healthFactor
      }
      vaultPositions {
        vault { name asset { symbol } }
        state { assetsUsd }
      }
    }
  }`;
    const chains = [
        { id: 1, name: 'ethereum' },
        { id: 8453, name: 'base' },
    ];
    let totalSupplied = 0;
    let totalBorrowed = 0;
    let totalCollateral = 0;
    let totalVaults = 0;
    const lines = [];
    lines.push(`Morpho Blue — combined across Ethereum + Base`);
    let anyPositions = false;
    let anyError;
    // Track which chains failed vs succeeded so partial failures are visible
    // even when the other chain has positions. Without this, a totals-look-
    // complete result would hide that one chain was skipped.
    const failedChains = [];
    for (const c of chains) {
        try {
            const res = await httpJson(MORPHO_GQL, {
                method: 'POST',
                body: { query, variables: { address: address.toLowerCase(), chainId: c.id } },
            });
            const u = res?.data?.userByAddress;
            if (!u)
                continue;
            const mps = u.marketPositions ?? [];
            const vps = u.vaultPositions ?? [];
            const activeMps = mps.filter((p) => Number(p.state?.supplyAssetsUsd ?? 0) + Number(p.state?.borrowAssetsUsd ?? 0) + Number(p.state?.collateralUsd ?? 0) > 0);
            const activeVps = vps.filter((p) => Number(p.state?.assetsUsd ?? 0) > 0);
            if (activeMps.length === 0 && activeVps.length === 0)
                continue;
            anyPositions = true;
            for (const p of activeMps) {
                const supplied = Number(p.state?.supplyAssetsUsd ?? 0);
                const borrowed = Number(p.state?.borrowAssetsUsd ?? 0);
                const collat = Number(p.state?.collateralUsd ?? 0);
                totalSupplied += supplied;
                totalBorrowed += borrowed;
                totalCollateral += collat;
                const loan = p.market?.loanAsset?.symbol ?? '?';
                const coll = p.market?.collateralAsset?.symbol ?? '?';
                const hf = p.healthFactor !== null && p.healthFactor !== undefined ? Number(p.healthFactor).toFixed(2) : 'n/a';
                lines.push(`  [${c.name}] ${loan} / ${coll}    HF: ${hf}    Supplied: ${fmtUsdShort(supplied)}    Borrowed: ${fmtUsdShort(borrowed)}    Collateral: ${fmtUsdShort(collat)}`);
            }
            for (const p of activeVps) {
                const v = Number(p.state?.assetsUsd ?? 0);
                totalVaults += v;
                lines.push(`  [${c.name}] vault ${p.vault?.name ?? '?'} (${p.vault?.asset?.symbol ?? '?'}): ${fmtUsdShort(v)}`);
            }
        }
        catch (e) {
            anyError = e?.message;
            failedChains.push(c.name);
        }
    }
    if (!anyPositions) {
        return {
            venue: 'morpho',
            ok: !anyError,
            totalUsd: 0,
            lines: anyError ? [`Morpho Blue — error: ${anyError}`] : [`Morpho Blue — no positions`],
            error: anyError,
        };
    }
    // Surface partial failures even when the other chain succeeded — otherwise
    // the totals look complete when one chain was actually skipped.
    if (failedChains.length > 0) {
        lines.push(`  ⚠ Partial result — failed to fetch from: ${failedChains.join(', ')} (${anyError ?? 'unknown error'}). Totals exclude those chains.`);
    }
    const netExposure = totalSupplied + totalCollateral + totalVaults - totalBorrowed;
    return {
        venue: 'morpho',
        ok: failedChains.length === 0,
        totalUsd: netExposure,
        lines,
        error: failedChains.length > 0 ? `Partial: ${failedChains.join(', ')}` : undefined,
    };
}
async function fetchDrift(authority) {
    try {
        const res = await httpJson(`${DRIFT_DATA}/user?authority=${authority}&subAccountId=0`);
        const collateral = Number(res?.totalCollateral ?? res?.total_collateral ?? res?.collateral ?? 0);
        const freeCollateral = Number(res?.freeCollateral ?? res?.free_collateral ?? 0);
        const positions = res?.perpPositions ?? res?.positions ?? [];
        let totalUpnl = 0;
        const lines = [];
        lines.push(`Drift — total collateral ${fmtUsdShort(collateral)} (free ${fmtUsdShort(freeCollateral)})`);
        if (positions.length === 0)
            lines.push('  (no open positions)');
        for (const p of positions) {
            const sym = p?.marketSymbol ?? p?.symbol ?? `idx-${p?.marketIndex ?? '?'}`;
            const size = Number(p?.baseAssetAmount ?? p?.size ?? 0);
            const entry = Number(p?.entryPrice ?? p?.avgPrice ?? 0);
            const upnl = Number(p?.unrealizedPnl ?? p?.upnl ?? 0);
            totalUpnl += upnl;
            lines.push(`  • ${sym}    size: ${fmtNum(size, 4)}    entry: ${fmtNum(entry, 4)}    uPnL: ${fmtUsdShort(upnl)}`);
        }
        return { venue: 'drift', ok: true, totalUsd: collateral, unrealizedPnl: totalUpnl, lines };
    }
    catch (e) {
        return { venue: 'drift', ok: false, totalUsd: 0, lines: [`Drift — error: ${e?.message ?? e}`], error: e?.message };
    }
}
export async function handlePortfolioTool(name, args) {
    if (!args)
        return { content: [{ type: 'text', text: 'No arguments provided.' }] };
    if (name !== 'chaingpt_portfolio_snapshot') {
        return { content: [{ type: 'text', text: `Unknown portfolio tool: ${name}` }] };
    }
    const evmAddress = args.evmAddress ? String(args.evmAddress).toLowerCase() : null;
    const solanaAddress = args.solanaAddress ? String(args.solanaAddress) : null;
    const filter = Array.isArray(args.venues) ? args.venues : null;
    if (!evmAddress && !solanaAddress) {
        return {
            content: [{
                    type: 'text',
                    text: 'Provide at least one of evmAddress or solanaAddress.',
                }],
        };
    }
    const wanted = (v) => !filter || filter.includes(v);
    const tasks = [];
    if (evmAddress && wanted('hyperliquid'))
        tasks.push(fetchHyperliquid(evmAddress));
    if (evmAddress && wanted('polymarket'))
        tasks.push(fetchPolymarket(evmAddress));
    if (evmAddress && wanted('morpho'))
        tasks.push(fetchMorpho(evmAddress));
    if (solanaAddress && wanted('drift'))
        tasks.push(fetchDrift(solanaAddress));
    if (tasks.length === 0) {
        return { content: [{ type: 'text', text: 'No venues to query — check evmAddress / solanaAddress / venues filter.' }] };
    }
    const results = await Promise.all(tasks);
    const totalUsd = results.filter((r) => r.ok).reduce((s, r) => s + r.totalUsd, 0);
    const totalUpnl = results.filter((r) => r.ok && r.unrealizedPnl !== undefined).reduce((s, r) => s + (r.unrealizedPnl ?? 0), 0);
    const errored = results.filter((r) => !r.ok);
    const out = [];
    out.push(`Portfolio snapshot`);
    if (evmAddress)
        out.push(`  EVM:    ${evmAddress}`);
    if (solanaAddress)
        out.push(`  Solana: ${solanaAddress}`);
    out.push('');
    out.push(`Total cross-venue exposure: ${fmtUsdShort(totalUsd)}`);
    out.push(`Total unrealized PnL (perp venues): ${fmtUsdShort(totalUpnl)}`);
    if (errored.length > 0) {
        out.push(`Errored venues: ${errored.map((r) => r.venue).join(', ')}`);
    }
    out.push('');
    out.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    out.push('');
    for (const r of results) {
        out.push(...r.lines);
        out.push('');
    }
    out.push('Note: This does NOT include spot wallet balances. For ERC-20 / native balances, call chaingpt_wallet_balances.');
    return { content: [{ type: 'text', text: out.join('\n') }] };
}
