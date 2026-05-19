/**
 * Tier-3b (Hyperliquid) + Tier-3c (Polymarket) read-only tool tests.
 * No mainnet ack flag — all 10 tools are read-only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import './_setup.js';

import { hyperliquidTools, handleHyperliquidTool } from '../tools/hyperliquid.js';
import { polymarketTools, handlePolymarketTool } from '../tools/polymarket.js';

describe('Tier-3b Hyperliquid tool definitions', () => {
  it('exposes the 6 read-only HL tools (signed-order tools live in tier3-signed-orders.test.ts)', () => {
    const names = hyperliquidTools.map((t) => t.name);
    for (const expected of [
      'chaingpt_hl_markets',
      'chaingpt_hl_mids',
      'chaingpt_hl_orderbook',
      'chaingpt_hl_account',
      'chaingpt_hl_fills',
      'chaingpt_hl_funding',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('read-only HL tools never require mainnet ack', () => {
    const readOnly = hyperliquidTools.filter((t) =>
      ['chaingpt_hl_markets', 'chaingpt_hl_mids', 'chaingpt_hl_orderbook',
       'chaingpt_hl_account', 'chaingpt_hl_fills', 'chaingpt_hl_funding'].includes(t.name)
    );
    for (const t of readOnly) {
      const props = (t.inputSchema as any).properties ?? {};
      expect(props.acknowledgeMainnet).toBeUndefined();
    }
  });
});

describe('Tier-3c Polymarket tool definitions', () => {
  it('exposes the 4 read-only PM tools (signed-order tools live in tier3-signed-orders.test.ts)', () => {
    const names = polymarketTools.map((t) => t.name);
    for (const expected of [
      'chaingpt_pm_markets',
      'chaingpt_pm_market',
      'chaingpt_pm_orderbook',
      'chaingpt_pm_trades',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('read-only PM tools never require mainnet ack', () => {
    const readOnly = polymarketTools.filter((t) =>
      ['chaingpt_pm_markets', 'chaingpt_pm_market',
       'chaingpt_pm_orderbook', 'chaingpt_pm_trades'].includes(t.name)
    );
    for (const t of readOnly) {
      const props = (t.inputSchema as any).properties ?? {};
      expect(props.acknowledgeMainnet).toBeUndefined();
    }
  });
});

describe('Tier-3b handler smoke tests', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaingpt_hl_markets parses universe[]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          universe: [
            { name: 'BTC', maxLeverage: 50, szDecimals: 5 },
            { name: 'ETH', maxLeverage: 50, szDecimals: 4 },
            { name: 'SOL', maxLeverage: 20, szDecimals: 2 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleHyperliquidTool('chaingpt_hl_markets', { type: 'perp' });
    const text = r.content[0].text;
    expect(text).toContain('Hyperliquid perp markets');
    expect(text).toContain('BTC');
    expect(text).toContain('max 50x');
  });

  it('chaingpt_hl_mids surfaces filtered mids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ BTC: '95000', ETH: '4500', SOL: '230', DOGE: '0.35' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleHyperliquidTool('chaingpt_hl_mids', { filter: ['BTC', 'ETH'] });
    const text = r.content[0].text;
    expect(text).toContain('BTC');
    expect(text).toContain('ETH');
    expect(text).not.toContain('DOGE');
    expect(text).toContain('95000');
  });

  it('chaingpt_hl_account formats positions correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          marginSummary: {
            accountValue: '10000',
            totalMarginUsed: '2000',
            totalRawUsd: '12000',
            totalNtlPos: '8000',
          },
          withdrawable: '8000',
          assetPositions: [
            {
              position: {
                coin: 'BTC',
                szi: '0.1',
                entryPx: '95000',
                unrealizedPnl: '50',
                leverage: { value: 5 },
                liquidationPx: '80000',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleHyperliquidTool('chaingpt_hl_account', { user: '0x1234' });
    const text = r.content[0].text;
    expect(text).toContain('LONG');
    expect(text).toContain('BTC');
    expect(text).toContain('lev=5x');
  });
});

describe('Tier-3c handler smoke tests', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaingpt_pm_markets formats the market list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            question: 'Will BTC hit $200k in 2026?',
            slug: 'will-btc-hit-200k-2026',
            volume24hr: 250000,
            liquidity: 80000,
            endDate: '2026-12-31T00:00:00Z',
            outcomePrices: '[0.42, 0.58]',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handlePolymarketTool('chaingpt_pm_markets', { search: 'BTC', limit: 1 });
    const text = r.content[0].text;
    expect(text).toContain('Will BTC hit $200k');
    expect(text).toContain('YES@ 42.0%');
    expect(text).toContain('vol24h=$250000');
  });

  it('chaingpt_pm_market enumerates outcomes with token ids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            question: 'Will Trump win the 2024 election?',
            slug: 'trump-2024',
            conditionId: '0xabc',
            volume24hr: 1000000,
            volume: 50000000,
            liquidity: 2000000,
            outcomes: '["Yes","No"]',
            outcomePrices: '[0.55, 0.45]',
            clobTokenIds: '["12345","67890"]',
            active: true,
            endDate: '2024-11-05T00:00:00Z',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handlePolymarketTool('chaingpt_pm_market', { slug: 'trump-2024' });
    const text = r.content[0].text;
    expect(text).toContain('Trump win the 2024 election');
    expect(text).toContain('Yes');
    expect(text).toContain('55.0%');
    expect(text).toContain('12345');
  });

  it('chaingpt_pm_orderbook formats bids and asks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          bids: [
            { price: '0.42', size: '1000' },
            { price: '0.41', size: '2500' },
          ],
          asks: [
            { price: '0.43', size: '800' },
            { price: '0.44', size: '1500' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handlePolymarketTool('chaingpt_pm_orderbook', { tokenId: '12345', depth: 2 });
    const text = r.content[0].text;
    expect(text).toContain('Polymarket orderbook');
    expect(text).toContain('0.4200');
    expect(text).toContain('0.4300');
  });
});
