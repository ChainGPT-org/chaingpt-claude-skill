/**
 * Drift Solana perps tool tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import './_setup.js';

import { driftTools, handleDriftTool } from '../tools/drift.js';

describe('Drift tool definitions', () => {
  it('exposes 5 read-only Drift tools', () => {
    const names = driftTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_drift_markets',
      'chaingpt_drift_market',
      'chaingpt_drift_orderbook',
      'chaingpt_drift_funding',
      'chaingpt_drift_user',
    ]);
  });

  it('no Drift tool requires acknowledgeMainnet (all read-only)', () => {
    for (const t of driftTools) {
      expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeUndefined();
    }
  });

  it('markets sort options are valid', () => {
    const t = driftTools.find((t) => t.name === 'chaingpt_drift_markets')!;
    const sorts = (t.inputSchema as any).properties.sortBy.enum;
    expect(sorts).toEqual(['volume', 'openInterest', 'funding', 'symbol']);
  });
});

describe('Drift handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('markets surfaces top perps sorted by volume', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          contracts: [
            {
              ticker_id: 'SOL-PERP',
              market_index: 0,
              contract_type: 'perp',
              mark_price: '142.35',
              base_currency_volume_24h_usd: 285_000_000,
              open_interest: 89_000_000,
              next_funding_rate: '0.00001',
              max_leverage: 20,
            },
            {
              ticker_id: 'BTC-PERP',
              market_index: 1,
              contract_type: 'perp',
              mark_price: '67500.50',
              base_currency_volume_24h_usd: 195_000_000,
              open_interest: 78_000_000,
              next_funding_rate: '0.000005',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleDriftTool('chaingpt_drift_markets', {});
    const t = r.content[0].text;
    expect(t).toContain('Drift perp markets');
    expect(t).toContain('SOL-PERP');
    expect(t).toContain('BTC-PERP');
    expect(t).toContain('$285.00M');
    expect(t).toContain('Annualized');
  });

  it('market detail surfaces mark, oracle, funding for one market', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          contracts: [
            {
              ticker_id: 'SOL-PERP',
              market_index: 0,
              contract_type: 'perp',
              mark_price: '142.35',
              oracle_price: '142.40',
              open_interest: 89_000_000,
              next_funding_rate: '0.00001',
              max_leverage: 20,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleDriftTool('chaingpt_drift_market', { marketIndex: 0 });
    const t = r.content[0].text;
    expect(t).toContain('Drift market — SOL-PERP');
    expect(t).toContain('Mark price:      $142.3500');
    expect(t).toContain('Oracle price:    $142.4000');
    expect(t).toContain('Max leverage:    20×');
  });

  it('market returns helpful message for unknown index', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ contracts: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleDriftTool('chaingpt_drift_market', { marketIndex: 999 });
    expect(r.content[0].text).toContain('not found');
  });

  it('orderbook returns L2 bids/asks with spread separator', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          bids: [
            { price: 142.30, size: 100 },
            { price: 142.25, size: 200 },
          ],
          asks: [
            { price: 142.40, size: 150 },
            { price: 142.45, size: 80 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleDriftTool('chaingpt_drift_orderbook', { marketIndex: 0, depth: 2 });
    const t = r.content[0].text;
    expect(t).toContain('Drift L2 orderbook');
    expect(t).toContain('Asks (sell side)');
    expect(t).toContain('$142.4000');
    expect(t).toContain('-- spread --');
    expect(t).toContain('$142.3000');
  });

  it('funding history surfaces average + annualized', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          fundingRates: [
            { ts: 1715000000, fundingRate: 0.00001 },
            { ts: 1714996400, fundingRate: 0.000015 },
            { ts: 1714992800, fundingRate: 0.000008 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleDriftTool('chaingpt_drift_funding', { marketIndex: 0, window: '24h' });
    const t = r.content[0].text;
    expect(t).toContain('Drift funding history');
    expect(t).toContain('Average hourly funding');
    expect(t).toContain('Annualized');
    expect(t).toContain('Recent (newest first)');
  });

  it('user surfaces positions + open orders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          totalCollateral: 25_000,
          freeCollateral: 18_500,
          leverage: 1.5,
          perpPositions: [
            {
              marketSymbol: 'SOL-PERP',
              baseAssetAmount: 100.5,
              entryPrice: 140.20,
              unrealizedPnl: 250,
            },
          ],
          openOrders: [
            {
              marketSymbol: 'BTC-PERP',
              direction: 'long',
              baseAssetAmount: 0.1,
              price: 65000,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleDriftTool('chaingpt_drift_user', {
      authority: 'BvKbRRtJSnRkJMTKVgvA3SHLkXKi5ABZF8N3RhVwxe5o',
    });
    const t = r.content[0].text;
    expect(t).toContain('Drift user');
    expect(t).toContain('$25.0k');
    expect(t).toContain('SOL-PERP');
    expect(t).toContain('BTC-PERP');
    expect(t).toContain('1.50×');
  });
});
