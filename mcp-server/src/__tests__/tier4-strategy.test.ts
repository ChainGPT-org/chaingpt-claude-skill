/**
 * Tier-4 strategy tools — definitions + plan-building correctness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import './_setup.js';

import { strategyTools, handleStrategyTool } from '../tools/strategy.js';

describe('Strategy tool definitions', () => {
  it('exposes 6 strategy / backtest tools', () => {
    const names = strategyTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_strategy_dca_plan',
      'chaingpt_strategy_grid_plan',
      'chaingpt_strategy_funding_arb_plan',
      'chaingpt_strategy_copy_plan',
      'chaingpt_backtest_dca',
      'chaingpt_backtest_grid',
    ]);
  });

  it('no strategy tool exposes acknowledgeMainnet (they only plan, never execute)', () => {
    for (const t of strategyTools) {
      const props = (t.inputSchema as any).properties ?? {};
      expect(props.acknowledgeMainnet).toBeUndefined();
    }
  });
});

describe('DCA planner', () => {
  it('splits the total budget evenly across intervals', async () => {
    const r = await handleStrategyTool('chaingpt_strategy_dca_plan', {
      outToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      network: 'ethereum',
      totalUsd: 1000,
      intervals: 10,
      cadenceHours: 24,
    });
    const t = r.content[0].text;
    expect(t).toContain('DCA plan');
    expect(t).toContain('$100.00'); // 1000 / 10 = 100
    // 10 numbered steps
    for (let i = 1; i <= 10; i++) expect(t).toContain(`${i.toString().padStart(3)}. at`);
  });
});

describe('Grid planner', () => {
  it('produces buy + sell ladders with the right shape', async () => {
    const r = await handleStrategyTool('chaingpt_strategy_grid_plan', {
      venue: 'hyperliquid',
      asset: 'BTC',
      priceLow: 90000,
      priceHigh: 100000,
      levels: 5,
      totalUsd: 1000,
      midPrice: 95000,
    });
    const t = r.content[0].text;
    expect(t).toContain('BUY ladder');
    expect(t).toContain('SELL ladder');
    expect(t).toContain('chaingpt_hl_place_order_payload');
  });

  it('refuses priceLow >= priceHigh', async () => {
    const r = await handleStrategyTool('chaingpt_strategy_grid_plan', {
      venue: 'dex', asset: 'x', priceLow: 100, priceHigh: 50, totalUsd: 100,
    });
    expect(r.content[0].text).toContain('priceLow must be less than priceHigh');
  });
});

describe('Funding-arb planner', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('recommends SHORT when funding is positive and above threshold', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([
        { time: Date.now() - 3600 * 1000, fundingRate: '0.00005' }, // 0.005% / hr → ~43.8% annualized
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const r = await handleStrategyTool('chaingpt_strategy_funding_arb_plan', {
      coin: 'BTC',
      notionalUsd: 10000,
      maxLeverage: 3,
      minAnnualizedPct: 10,
    });
    const t = r.content[0].text;
    expect(t).toContain('SHORT');
    expect(t).toContain('Funding-arb plan');
  });

  it('skips the arb when funding is below threshold', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([
        { time: Date.now() - 3600 * 1000, fundingRate: '0.000001' }, // ~0.876% annualized
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const r = await handleStrategyTool('chaingpt_strategy_funding_arb_plan', {
      coin: 'BTC',
      notionalUsd: 10000,
      minAnnualizedPct: 10,
    });
    expect(r.content[0].text).toContain('below the 10% threshold');
  });
});

describe('Copy planner', () => {
  it('emits the 5-step plan referencing the right tools', async () => {
    const r = await handleStrategyTool('chaingpt_strategy_copy_plan', {
      targetWallet: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      chain: 'base',
      budgetUsd: 500,
      maxTrades: 3,
    });
    const t = r.content[0].text;
    expect(t).toContain('chaingpt_onchain_address');
    expect(t).toContain('chaingpt_risk_token');
    expect(t).toContain('chaingpt_dex_build_swap_tx');
  });
});

describe('Grid backtester', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('captures fills when price oscillates inside the range', async () => {
    // Sinusoidal price between 90 and 110 over 100 candles — should trigger many grid fills.
    const now = Date.now();
    const prices: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++) {
      const ts = now - (100 - i) * 3600 * 1000;
      const p = 100 + Math.sin(i / 5) * 8; // oscillates 92..108
      prices.push([ts, p]);
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ prices }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const r = await handleStrategyTool('chaingpt_backtest_grid', {
      coinId: 'ethereum',
      days: 5,
      priceLow: 90,
      priceHigh: 110,
      levels: 5,
      totalBudget: 1000,
      feeBps: 10,
    });
    const t = r.content[0].text;
    expect(t).toContain('Backtest — Grid');
    expect(t).toContain('Buys filled');
    expect(t).toContain('Sells filled');
    expect(t).toContain('Realized P&L from grid spreads');
    expect(t).toContain('Inventory held');
    expect(t).toContain('Buy-and-hold baseline');
    // The oscillating regime should trigger > 0 buys + sells
    const buysMatch = t.match(/Buys filled:\s+(\d+)/);
    const sellsMatch = t.match(/Sells filled:\s+(\d+)/);
    expect(buysMatch).not.toBeNull();
    expect(sellsMatch).not.toBeNull();
    expect(Number(buysMatch![1])).toBeGreaterThan(0);
    expect(Number(sellsMatch![1])).toBeGreaterThan(0);
  });

  it('refuses priceLow >= priceHigh', async () => {
    const r = await handleStrategyTool('chaingpt_backtest_grid', {
      coinId: 'ethereum',
      priceLow: 100,
      priceHigh: 50,
    });
    expect(r.content[0].text).toContain('priceLow must be less than priceHigh');
  });
});

describe('DCA backtester', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('computes DCA P&L vs buy-and-hold when price trends down then up', async () => {
    // Mock 30 daily prices: start 100, drop to 50, rebound to 110.
    const now = Date.now();
    const prices: Array<[number, number]> = [];
    for (let i = 0; i < 30; i++) {
      const t = now - (30 - i) * 24 * 3600 * 1000;
      // V-shape: 100 → 50 → 110
      const p = i < 15 ? 100 - i * 3 : 50 + (i - 15) * 4;
      prices.push([t, p]);
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ prices }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const r = await handleStrategyTool('chaingpt_backtest_dca', {
      coinId: 'bitcoin',
      days: 30,
      intervals: 10,
      totalBudget: 1000,
    });
    const t = r.content[0].text;
    expect(t).toContain('Backtest');
    expect(t).toContain('DCA results');
    expect(t).toContain('Buy-and-hold baseline');
    expect(t).toMatch(/P&L:\s+[+-]?\d/);
  });
});
