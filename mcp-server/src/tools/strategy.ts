import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-4 agent infrastructure — strategy planners + backtester.
 *
 * These tools don't execute on their own. They compute a strategy plan
 * (list of concrete steps) that Claude then executes one by one via the
 * Tier-1/2/3 tools (research, risk, dex, defi, hl, pm). This keeps the
 * "agentic" layer custody-free and reviewable — every action is still gated
 * by the existing acknowledgeMainnet refusal copy.
 *
 * Tools:
 *   chaingpt_strategy_dca_plan         Dollar-cost-average plan
 *   chaingpt_strategy_grid_plan        Grid-trading ladder for a price range
 *   chaingpt_strategy_funding_arb_plan Hyperliquid funding-rate arb suggester
 *   chaingpt_strategy_copy_plan        Mirror a target wallet's recent swaps
 *   chaingpt_backtest_dca              Replay a DCA strategy against historical data
 *
 * ERC-4337 session keys + bounded autonomous-mode-with-kill-switch are
 * intentionally deferred — they need a dedicated security review.
 */

export const strategyTools: Tool[] = [
  {
    name: 'chaingpt_strategy_dca_plan',
    description:
      'Build a dollar-cost-average plan for one token. Given a total budget, number of buys, and cadence, ' +
      'returns the list of swaps Claude should execute via chaingpt_dex_quote + chaingpt_dex_build_swap_tx. ' +
      'Each step also gets a recommended execution time (Unix seconds). Read-only — does not execute. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        outToken: { type: 'string', description: 'Token contract to buy (0x… or Solana mint).' },
        network: { type: 'string', description: 'EVM chain slug or "solana".' },
        totalUsd: { type: 'number', description: 'Total USD budget across all buys.' },
        intervals: { type: 'number', description: 'Number of buys to split the budget into. Default 7.', default: 7 },
        cadenceHours: { type: 'number', description: 'Hours between buys. Default 24 (daily).', default: 24 },
        startAtUnix: { type: 'number', description: 'When to start (Unix seconds). Defaults to now.' },
      },
      required: ['outToken', 'network', 'totalUsd'],
    },
  },
  {
    name: 'chaingpt_strategy_grid_plan',
    description:
      'Build a grid-trading ladder of limit orders between a lower and upper bound. Returns evenly-spaced ' +
      'buy + sell levels with sizes scaled to the total budget. Useful for range-bound markets. Output is a ' +
      'plan only — Claude executes via the appropriate place-order tool (chaingpt_hl_place_order_payload for ' +
      'Hyperliquid, chaingpt_pm_place_order_payload for Polymarket, or chaingpt_dex_build_swap_tx for spot). ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        venue: { type: 'string', enum: ['hyperliquid', 'polymarket', 'dex'], description: 'Where to place the grid.' },
        asset: { type: 'string', description: 'Asset reference: HL coin symbol ("BTC"), PM tokenId, or DEX outToken.' },
        priceLow: { type: 'number', description: 'Lower bound of the grid.' },
        priceHigh: { type: 'number', description: 'Upper bound of the grid.' },
        levels: { type: 'number', description: 'Number of price levels per side. Default 5.', default: 5 },
        totalUsd: { type: 'number', description: 'Total USD across all buy levels.' },
        midPrice: { type: 'number', description: 'Current mid; positions above are sells, below are buys. Optional.' },
      },
      required: ['venue', 'asset', 'priceLow', 'priceHigh', 'totalUsd'],
    },
  },
  {
    name: 'chaingpt_strategy_funding_arb_plan',
    description:
      'Suggest a Hyperliquid funding-rate arbitrage position. Given the current funding rate for a coin, ' +
      'returns: which side to take (long if funding < 0, short if funding > 0), expected hourly carry, ' +
      'annualized rate, suggested leverage, and the pre-flight tools Claude should run before submitting. ' +
      'Read-only — does not execute. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        coin: { type: 'string', description: 'HL asset symbol, e.g. "BTC".' },
        notionalUsd: { type: 'number', description: 'Target notional in USD.' },
        maxLeverage: { type: 'number', description: 'Max leverage to suggest (default 3 for low-risk).', default: 3 },
        minAnnualizedPct: { type: 'number', description: 'Skip if annualized funding < this %. Default 10.', default: 10 },
      },
      required: ['coin', 'notionalUsd'],
    },
  },
  {
    name: 'chaingpt_strategy_copy_plan',
    description:
      'Build a copy-trading plan: given a target wallet, fetch its recent DEX swaps and propose mirrored ' +
      'trades sized to a budget. Output is a plan only — Claude executes via chaingpt_dex_build_swap_tx ' +
      'with the same mainnet ack gate. Pre-flight: ALWAYS run chaingpt_risk_token on each token before ' +
      'mirroring. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        targetWallet: { type: 'string', description: 'Wallet to mirror (0x…).' },
        chain: { type: 'string', description: 'Chain to monitor.' },
        budgetUsd: { type: 'number', description: 'Total budget for mirrored trades.' },
        maxTrades: { type: 'number', description: 'Max number of trades to mirror. Default 5.', default: 5 },
        minTradeUsd: { type: 'number', description: 'Skip trades smaller than this. Default 100.', default: 100 },
      },
      required: ['targetWallet', 'chain', 'budgetUsd'],
    },
  },
  {
    name: 'chaingpt_backtest_dca',
    description:
      'Backtest a DCA strategy against historical price data from CoinGecko. Replays buys at fixed intervals ' +
      'and computes final P&L vs a buy-and-hold baseline. No keys required. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        coinId: { type: 'string', description: 'CoinGecko coin id, e.g. "bitcoin", "ethereum", "chaingpt".' },
        vs: { type: 'string', description: 'Quote currency. Default "usd".', default: 'usd' },
        days: { type: 'number', description: 'Lookback window in days (max 90 on free CoinGecko). Default 30.', default: 30 },
        intervals: { type: 'number', description: 'Number of DCA buys to spread across the window. Default 30.', default: 30 },
        totalBudget: { type: 'number', description: 'Total budget to DCA in (quote currency). Default 1000.', default: 1000 },
      },
      required: ['coinId'],
    },
  },
  {
    name: 'chaingpt_backtest_grid',
    description:
      'Backtest a grid-trading strategy against historical prices. Replays a fixed buy/sell ladder between ' +
      'priceLow and priceHigh through the full window, tracking trades triggered, average fill, final inventory, ' +
      'and grid P&L vs buy-and-hold. Uses CoinGecko historical data. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        coinId: { type: 'string', description: 'CoinGecko coin id.' },
        vs: { type: 'string', description: 'Quote currency. Default "usd".', default: 'usd' },
        days: { type: 'number', description: 'Lookback window in days. Default 30.', default: 30 },
        priceLow: { type: 'number', description: 'Lower bound of the grid (quote currency).' },
        priceHigh: { type: 'number', description: 'Upper bound of the grid (quote currency).' },
        levels: { type: 'number', description: 'Number of grid levels per side. Default 10.', default: 10 },
        totalBudget: { type: 'number', description: 'Total quote-currency budget (split equally per buy level). Default 1000.', default: 1000 },
        feeBps: { type: 'number', description: 'Per-trade fee in basis points. Default 10 (0.10%).', default: 10 },
      },
      required: ['coinId', 'priceLow', 'priceHigh'],
    },
  },
];

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

export async function handleStrategyTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) return { content: [{ type: 'text', text: 'No arguments provided.' }] };

  try {
    if (name === 'chaingpt_strategy_dca_plan') {
      const outToken = String(args.outToken);
      const network = String(args.network);
      const totalUsd = Number(args.totalUsd);
      const intervals = Math.max(1, Math.min(Number(args.intervals ?? 7), 365));
      const cadenceHours = Math.max(0.5, Number(args.cadenceHours ?? 24));
      const startUnix = Number(args.startAtUnix ?? Math.floor(Date.now() / 1000));
      const perBuyUsd = totalUsd / intervals;

      const lines: string[] = [
        `DCA plan — ${formatUsd(totalUsd)} into ${outToken} on ${network}`,
        '',
        `Steps:           ${intervals}`,
        `Cadence:         every ${cadenceHours}h`,
        `Per-buy size:    ${formatUsd(perBuyUsd)}`,
        `First buy:       ${new Date(startUnix * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        '',
        'Execution steps (Claude executes each via chaingpt_dex_build_swap_tx with acknowledgeMainnet=true):',
        '',
      ];
      for (let i = 0; i < intervals; i++) {
        const at = startUnix + i * cadenceHours * 3600;
        lines.push(`  ${(i + 1).toString().padStart(3)}. at ${new Date(at * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC — buy ${formatUsd(perBuyUsd)} of ${outToken}`);
      }
      lines.push('');
      lines.push('Pre-flight (run once before step 1):');
      lines.push(`  chaingpt_risk_token address=${outToken} chain=${network}`);
      lines.push(`  chaingpt_research_token query=${outToken} chain=${network}`);
      lines.push('');
      lines.push('Each buy:');
      // Solana DCA uses Jupiter; EVM DCA uses OpenOcean/1inch/CoW via the
      // chaingpt_dex_* / aggregators tools.
      if (network.toLowerCase() === 'solana') {
        lines.push(`  chaingpt_dex_jupiter_quote outputMint=${outToken} amountIn=<per-buy-converted>`);
        lines.push(`  chaingpt_dex_jupiter_build_swap_tx ... acknowledgeMainnet=true`);
      } else {
        lines.push(`  chaingpt_dex_quote network=${network} ... amountIn=<per-buy-usd-converted-to-quote>`);
        lines.push(`  chaingpt_dex_build_swap_tx ... acknowledgeMainnet=true`);
      }

      // Machine-readable plan for scheduled execution: save it with
      // chaingpt_strategy_save_plan, then a scheduled agent can drive it
      // idempotently via chaingpt_strategy_due_steps + _mark_step.
      const executable = {
        kind: 'dca',
        network,
        outToken,
        perBuyUsd: Number(perBuyUsd.toFixed(2)),
        steps: Array.from({ length: intervals }, (_, i) => ({
          id: i + 1,
          atUnix: startUnix + i * cadenceHours * 3600,
          action: 'buy',
          usd: Number(perBuyUsd.toFixed(2)),
        })),
      };
      lines.push('');
      lines.push('--- Scheduled execution (optional) ---');
      lines.push('Save this plan, then run it on a schedule (see the scheduled-autonomy skill):');
      lines.push(`  chaingpt_strategy_save_plan name=<your-name> type=dca payload=<the JSON below>`);
      lines.push('Each scheduled tick: chaingpt_strategy_due_steps → execute → chaingpt_strategy_mark_step.');
      lines.push('');
      lines.push(JSON.stringify(executable, null, 2));
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_strategy_grid_plan') {
      const venue = String(args.venue);
      const asset = String(args.asset);
      const priceLow = Number(args.priceLow);
      const priceHigh = Number(args.priceHigh);
      const levels = Math.max(2, Math.min(Number(args.levels ?? 5), 25));
      const totalUsd = Number(args.totalUsd);
      const mid = args.midPrice !== undefined ? Number(args.midPrice) : (priceLow + priceHigh) / 2;

      if (priceLow >= priceHigh) {
        return { content: [{ type: 'text', text: 'priceLow must be less than priceHigh.' }] };
      }

      const buyLevels: Array<{ price: number; usd: number }> = [];
      const sellLevels: Array<{ price: number; usd: number }> = [];
      const stepBuy = (mid - priceLow) / levels;
      const stepSell = (priceHigh - mid) / levels;
      const buyUsdPer = totalUsd / 2 / levels;
      for (let i = 1; i <= levels; i++) {
        buyLevels.push({ price: priceLow + stepBuy * (i - 1), usd: buyUsdPer });
        sellLevels.push({ price: mid + stepSell * i, usd: buyUsdPer });
      }

      const lines: string[] = [
        `Grid plan — ${asset} on ${venue}`,
        '',
        `Range:           ${priceLow} … ${priceHigh}  (mid: ${mid})`,
        `Levels per side: ${levels}`,
        `Total budget:    ${formatUsd(totalUsd)}  (split ${formatUsd(totalUsd / 2)} each side)`,
        `USD per level:   ${formatUsd(buyUsdPer)}`,
        '',
        'BUY ladder (limit orders below mid):',
      ];
      buyLevels.forEach((l, i) =>
        lines.push(`  ${(i + 1).toString().padStart(2)}. buy ${formatUsd(l.usd)} at ${l.price.toFixed(6)}`)
      );
      lines.push('');
      lines.push('SELL ladder (limit orders above mid):');
      sellLevels.forEach((l, i) =>
        lines.push(`  ${(i + 1).toString().padStart(2)}. sell ${formatUsd(l.usd)} at ${l.price.toFixed(6)}`)
      );

      lines.push('');
      lines.push('Execution:');
      if (venue === 'hyperliquid') {
        lines.push('  chaingpt_hl_place_order_payload (one per level) with isBuy + price + size');
      } else if (venue === 'polymarket') {
        lines.push('  chaingpt_pm_place_order_payload (one per level) with side + price + size');
      } else {
        lines.push('  chaingpt_dex_build_swap_tx (one per level — spot DEXes do market not limit; use price as the slippage anchor)');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_strategy_funding_arb_plan') {
      const coin = String(args.coin).toUpperCase();
      const notional = Number(args.notionalUsd);
      const maxLev = Math.max(1, Number(args.maxLeverage ?? 3));
      const minAnnualizedPct = Number(args.minAnnualizedPct ?? 10);

      // Fetch the latest funding rate from Hyperliquid
      const startTime = Date.now() - 24 * 3600 * 1000;
      const history = await httpJson<any[]>('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        body: { type: 'fundingHistory', coin, startTime },
      });
      const arr = Array.isArray(history) ? history : [];
      if (arr.length === 0) {
        return { content: [{ type: 'text', text: `No funding history for ${coin}. Is the symbol correct?` }] };
      }
      const latest = Number(arr[arr.length - 1].fundingRate);
      const annualizedPct = latest * 24 * 365 * 100;
      const absAnnualized = Math.abs(annualizedPct);

      if (absAnnualized < minAnnualizedPct) {
        return {
          content: [{
            type: 'text',
            text:
              `${coin} funding is ${(latest * 100).toFixed(4)}% / hr (annualized ${annualizedPct.toFixed(2)}%) — below the ${minAnnualizedPct}% threshold. ` +
              `Skip this arb.`,
          }],
        };
      }

      // If funding > 0: longs pay shorts → we want to SHORT (collect carry).
      // If funding < 0: shorts pay longs → we want to LONG.
      const side = latest > 0 ? 'SHORT' : 'LONG';
      const hourlyCarry = (Math.abs(latest) * notional).toFixed(4);
      const dailyCarry = (Math.abs(latest) * notional * 24).toFixed(4);
      const suggestedLev = Math.min(maxLev, Math.max(1, Math.round(absAnnualized / 20)));

      const lines = [
        `Funding-arb plan — ${coin} on Hyperliquid`,
        '',
        `Current funding:    ${(latest * 100).toFixed(4)}% / hr  (annualized ${annualizedPct.toFixed(2)}%)`,
        `Suggested side:     ${side}  (you collect the carry)`,
        `Notional:           ${formatUsd(notional)}`,
        `Suggested leverage: ${suggestedLev}x  (capped at ${maxLev}x)`,
        `Hourly carry:       $${hourlyCarry}`,
        `Daily carry (est):  $${dailyCarry}`,
        '',
        'Pre-flight before placing the perp:',
        `  chaingpt_hl_orderbook coin=${coin} depth=5     # confirm spread is tight`,
        `  chaingpt_hl_account user=<your-wallet>           # confirm margin available`,
        '',
        'Execute (custody-free pattern):',
        `  chaingpt_hl_place_order_payload asset=<index> isBuy=${side === 'LONG'} price=<mid-or-aggressive> size=<calculated> acknowledgeMainnet=true`,
        '  [sign the EIP-712 typed data in your wallet]',
        '  chaingpt_hl_submit_signed_action action=<from-above> signature=<wallet-sig> nonce=<from-above>',
        '',
        'Risk notes:',
        '  - Funding can flip sign — monitor with chaingpt_hl_funding every few hours.',
        '  - Pure funding arbs eventually decay; the size of the carry implies others will pile in and compress it.',
        '  - Hedge the directional exposure if you can (e.g. spot long while perp short).',
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_strategy_copy_plan') {
      const targetWallet = String(args.targetWallet);
      const chain = String(args.chain);
      const budget = Number(args.budgetUsd);
      const maxTrades = Math.max(1, Math.min(Number(args.maxTrades ?? 5), 20));
      const minTradeUsd = Number(args.minTradeUsd ?? 100);

      const lines = [
        `Copy-trade plan — mirror ${targetWallet} on ${chain}`,
        '',
        `Budget:          ${formatUsd(budget)}`,
        `Max trades:      ${maxTrades}`,
        `Min trade size:  ${formatUsd(minTradeUsd)}`,
        '',
        'Step 1 — read target wallet activity:',
        `  chaingpt_onchain_address address=${targetWallet} chain=${chain} limit=${maxTrades * 3}`,
        '',
        'Step 2 — for each candidate swap discovered, decode the input data via:',
        '  chaingpt_onchain_tx hash=<hash>  (gets method id + value)',
        '',
        'Step 3 — for each unique outToken found, run pre-flight:',
        `  chaingpt_risk_token address=<outToken> chain=${chain}`,
        '  REFUSE the mirror if honeypot / cannot-sell-all fires.',
        '',
        'Step 4 — scale each mirrored trade to your budget:',
        `  per-trade-usd = min(${formatUsd(budget / maxTrades)}, mirror size × your-position-as-pct-of-target)`,
        '',
        'Step 5 — execute (custody-free):',
        `  chaingpt_dex_build_swap_tx network=${chain} ... acknowledgeMainnet=true`,
        '',
        'Strategy caveats:',
        '  - You will always lag the target by some delay; large trades by the target may have already moved price.',
        '  - The target may use private mempools (Flashbots) — you cannot fully replicate their fills.',
        '  - Mirror only trades > minTradeUsd to filter dust + spam tokens the target may have airdropped.',
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_backtest_dca') {
      const coinId = String(args.coinId).toLowerCase();
      const vs = String(args.vs ?? 'usd');
      const days = Math.max(1, Math.min(Number(args.days ?? 30), 90));
      const intervals = Math.max(2, Math.min(Number(args.intervals ?? 30), 365));
      const totalBudget = Number(args.totalBudget ?? 1000);

      // CoinGecko free tier: /coins/{id}/market_chart?vs_currency=usd&days=30
      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${vs}&days=${days}`;
      const res = await httpJson<{ prices: Array<[number, number]> }>(url);
      const prices = res.prices ?? [];
      if (prices.length < intervals) {
        return {
          content: [{
            type: 'text',
            text: `Not enough price data: got ${prices.length} candles, need ≥${intervals}. Try fewer intervals or more days.`,
          }],
        };
      }

      // Sample `intervals` evenly across the price series.
      const step = Math.floor(prices.length / intervals);
      const perBuy = totalBudget / intervals;
      let totalTokens = 0;
      const buys: Array<{ ts: number; price: number; tokens: number }> = [];
      for (let i = 0; i < intervals; i++) {
        const idx = i * step;
        const [ts, p] = prices[idx];
        const tokens = perBuy / p;
        totalTokens += tokens;
        buys.push({ ts, price: p, tokens });
      }

      const endPrice = prices[prices.length - 1][1];
      const dcaFinal = totalTokens * endPrice;
      const dcaPnlPct = ((dcaFinal - totalBudget) / totalBudget) * 100;
      const dcaAvgEntry = totalBudget / totalTokens;

      // Baseline: buy-and-hold at the first price
      const startPrice = prices[0][1];
      const bhTokens = totalBudget / startPrice;
      const bhFinal = bhTokens * endPrice;
      const bhPnlPct = ((bhFinal - totalBudget) / totalBudget) * 100;

      const lines = [
        `Backtest — DCA into ${coinId} over ${days}d in ${intervals} buys`,
        '',
        `Total invested:     ${formatUsd(totalBudget)}`,
        `Start price:        $${startPrice.toFixed(6)}`,
        `End price:          $${endPrice.toFixed(6)}  (${(((endPrice - startPrice) / startPrice) * 100).toFixed(2)}% move)`,
        '',
        'DCA results:',
        `  Tokens acquired:  ${totalTokens.toFixed(4)}`,
        `  Avg entry:        $${dcaAvgEntry.toFixed(6)}`,
        `  Final value:      ${formatUsd(dcaFinal)}`,
        `  P&L:              ${dcaPnlPct >= 0 ? '+' : ''}${dcaPnlPct.toFixed(2)}%`,
        '',
        'Buy-and-hold baseline (all at start):',
        `  Tokens acquired:  ${bhTokens.toFixed(4)}`,
        `  Final value:      ${formatUsd(bhFinal)}`,
        `  P&L:              ${bhPnlPct >= 0 ? '+' : ''}${bhPnlPct.toFixed(2)}%`,
        '',
        `Delta DCA vs B&H:   ${(dcaPnlPct - bhPnlPct).toFixed(2)} pct points`,
        dcaPnlPct > bhPnlPct
          ? '→ DCA outperformed in this period (price probably trended down then up).'
          : '→ B&H outperformed (price probably trended up; DCA missed the early entry).',
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_backtest_grid') {
      const coinId = String(args.coinId).toLowerCase();
      const vs = String(args.vs ?? 'usd');
      const days = Math.max(1, Math.min(Number(args.days ?? 30), 90));
      const priceLow = Number(args.priceLow);
      const priceHigh = Number(args.priceHigh);
      const levels = Math.max(2, Math.min(Number(args.levels ?? 10), 50));
      const totalBudget = Number(args.totalBudget ?? 1000);
      const feeBps = Math.max(0, Math.min(Number(args.feeBps ?? 10), 1000));

      if (priceLow >= priceHigh) {
        return { content: [{ type: 'text', text: 'priceLow must be less than priceHigh.' }] };
      }

      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${vs}&days=${days}`;
      const res = await httpJson<{ prices: Array<[number, number]> }>(url);
      const prices = res.prices ?? [];
      if (prices.length < 10) {
        return {
          content: [{
            type: 'text',
            text: `Not enough price data: got ${prices.length} candles. Try a longer window.`,
          }],
        };
      }

      // Build grid: `levels` buy levels below mid, `levels` sell levels above mid.
      const mid = (priceLow + priceHigh) / 2;
      const buyLevels: number[] = [];
      const sellLevels: number[] = [];
      for (let i = 1; i <= levels; i++) {
        buyLevels.push(priceLow + ((mid - priceLow) * (i - 1)) / levels);
        sellLevels.push(mid + ((priceHigh - mid) * i) / levels);
      }
      // Allocate budget evenly across buy levels (quote-currency per level)
      const perBuyQuote = totalBudget / levels;
      const feeRate = feeBps / 10_000;

      // Track inventory: { tokens, costBasis, buyOrders (open levels), sellOrders }
      // At each price tick: any unfilled buy whose price ≥ current candle gets filled;
      // any unfilled sell whose price ≤ current candle gets filled.
      // After a buy fills, place a sell order at the next-higher level.
      // After a sell fills, place a buy order at the next-lower level.
      type Order = { side: 'buy' | 'sell'; price: number; size: number };
      const openOrders: Order[] = buyLevels.map((p) => ({ side: 'buy', price: p, size: perBuyQuote / p }));
      let cashQuote = totalBudget;
      let tokensHeld = 0;
      let realizedQuotePnl = 0;
      let totalFees = 0;
      let buysFilled = 0;
      let sellsFilled = 0;

      for (const [, candlePrice] of prices) {
        // Iterate buy fills first (a buy gets hit when candle dips at/below its price)
        for (let i = openOrders.length - 1; i >= 0; i--) {
          const o = openOrders[i];
          if (o.side === 'buy' && candlePrice <= o.price) {
            const cost = o.size * o.price;
            if (cashQuote < cost) continue; // skip if out of cash
            const fee = cost * feeRate;
            cashQuote -= cost + fee;
            totalFees += fee;
            tokensHeld += o.size;
            buysFilled++;
            // Replace with a sell order one level up (or at mid+step if at top of buy ladder)
            const sellTarget = sellLevels.find((p) => p > o.price && !openOrders.some((x) => x.side === 'sell' && Math.abs(x.price - p) < 1e-9));
            if (sellTarget !== undefined) {
              openOrders.splice(i, 1, { side: 'sell', price: sellTarget, size: o.size });
            } else {
              openOrders.splice(i, 1);
            }
          } else if (o.side === 'sell' && candlePrice >= o.price) {
            const proceeds = o.size * o.price;
            const fee = proceeds * feeRate;
            cashQuote += proceeds - fee;
            totalFees += fee;
            tokensHeld -= o.size;
            // Realized PnL = sell - buy (we assume FIFO matching at grid step pricing)
            // Approximate: each grid sell captures the (sellPrice - nextLowerBuyPrice) spread × size
            const buyMatch = buyLevels.find((p) => p < o.price && !openOrders.some((x) => x.side === 'buy' && Math.abs(x.price - p) < 1e-9));
            if (buyMatch !== undefined) {
              realizedQuotePnl += (o.price - buyMatch) * o.size;
              openOrders.splice(i, 1, { side: 'buy', price: buyMatch, size: o.size });
            } else {
              openOrders.splice(i, 1);
            }
            sellsFilled++;
          }
        }
      }

      const endPrice = prices[prices.length - 1][1];
      const startPrice = prices[0][1];
      const finalValue = cashQuote + tokensHeld * endPrice;
      const gridPnl = finalValue - totalBudget;
      const gridPnlPct = (gridPnl / totalBudget) * 100;
      const bhTokens = totalBudget / startPrice;
      const bhFinal = bhTokens * endPrice;
      const bhPnl = bhFinal - totalBudget;
      const bhPnlPct = (bhPnl / totalBudget) * 100;

      const lines = [
        `Backtest — Grid on ${coinId} over ${days}d`,
        '',
        `Range:              $${priceLow.toFixed(4)} – $${priceHigh.toFixed(4)}    Levels per side: ${levels}`,
        `Start price:        $${startPrice.toFixed(4)}    End price: $${endPrice.toFixed(4)}    Move: ${(((endPrice - startPrice) / startPrice) * 100).toFixed(2)}%`,
        `Total budget:       ${formatUsd(totalBudget)}    Fee: ${(feeBps / 100).toFixed(2)}%`,
        '',
        'Grid results:',
        `  Buys filled:      ${buysFilled}`,
        `  Sells filled:     ${sellsFilled}`,
        `  Total fees paid:  ${formatUsd(totalFees)}`,
        `  Realized P&L from grid spreads:  ${formatUsd(realizedQuotePnl)}`,
        `  Inventory held:   ${tokensHeld.toFixed(6)} tokens (worth ${formatUsd(tokensHeld * endPrice)} at end)`,
        `  Cash remaining:   ${formatUsd(cashQuote)}`,
        `  Final value:      ${formatUsd(finalValue)}`,
        `  Net P&L:          ${gridPnl >= 0 ? '+' : ''}${formatUsd(gridPnl)}    (${gridPnlPct >= 0 ? '+' : ''}${gridPnlPct.toFixed(2)}%)`,
        '',
        'Buy-and-hold baseline (all at start price):',
        `  Final value:      ${formatUsd(bhFinal)}    P&L: ${bhPnlPct >= 0 ? '+' : ''}${bhPnlPct.toFixed(2)}%`,
        '',
        `Delta Grid vs B&H: ${(gridPnlPct - bhPnlPct).toFixed(2)} pct points`,
        gridPnlPct > bhPnlPct
          ? '→ Grid outperformed (mean-reverting / range-bound regime).'
          : '→ B&H outperformed (trending regime — grid sold winners too early).',
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown strategy tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Strategy error: ${message}`);
  }
}
