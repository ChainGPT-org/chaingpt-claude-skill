/**
 * Portfolio snapshot tool tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import './_setup.js';

import { portfolioTools, handlePortfolioTool } from '../tools/portfolio.js';

describe('Portfolio tool definitions', () => {
  it('exposes 1 portfolio tool', () => {
    expect(portfolioTools.map((t) => t.name)).toEqual(['chaingpt_portfolio_snapshot']);
  });

  it('snapshot does not require any address (it errors gracefully)', () => {
    const t = portfolioTools[0];
    expect((t.inputSchema as any).required).toEqual([]);
  });

  it('venues enum restricts to known venues', () => {
    const t = portfolioTools[0];
    const venues = (t.inputSchema as any).properties.venues.items.enum;
    expect(venues).toEqual(['hyperliquid', 'polymarket', 'morpho', 'drift']);
  });
});

describe('Portfolio snapshot handler', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refuses with no addresses', async () => {
    const r = await handlePortfolioTool('chaingpt_portfolio_snapshot', {});
    expect(r.content[0].text).toContain('Provide at least one');
  });

  it('aggregates Hyperliquid + Polymarket + Morpho for an EVM address', async () => {
    let callIndex = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      callIndex++;
      if (u.includes('hyperliquid.xyz/info')) {
        return new Response(JSON.stringify({
          marginSummary: { accountValue: '12500.50', totalRawUsd: '13000' },
          assetPositions: [
            { position: { coin: 'BTC', szi: '0.1', entryPx: '67000', unrealizedPnl: '50', leverage: { value: 5 } } },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('data-api.polymarket.com')) {
        return new Response(JSON.stringify([
          { title: 'Will BTC hit 100k by 2026?', outcome: 'Yes', size: 1000, currentValue: 650, totalBought: 500 },
        ]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('blue-api.morpho.org')) {
        return new Response(JSON.stringify({
          data: {
            userByAddress: {
              marketPositions: [
                {
                  market: {
                    uniqueKey: '0xabc',
                    loanAsset: { symbol: 'USDC' },
                    collateralAsset: { symbol: 'WETH' },
                  },
                  state: { supplyAssetsUsd: 0, borrowAssetsUsd: 5_000, collateralUsd: 12_000 },
                  healthFactor: 2.1,
                },
              ],
              vaultPositions: [],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const r = await handlePortfolioTool('chaingpt_portfolio_snapshot', {
      evmAddress: '0x1111111111111111111111111111111111111111',
    });
    const t = r.content[0].text;
    expect(t).toContain('Portfolio snapshot');
    expect(t).toContain('Hyperliquid');
    expect(t).toContain('account value $12.5k');
    expect(t).toContain('Polymarket');
    expect(t).toContain('Will BTC hit 100k');
    expect(t).toContain('Morpho Blue');
    expect(t).toContain('USDC / WETH');
    expect(t).toContain('Total cross-venue exposure');
  });

  it('venues filter limits which APIs get called', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        marginSummary: { accountValue: '5000', totalRawUsd: '5000' },
        assetPositions: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const r = await handlePortfolioTool('chaingpt_portfolio_snapshot', {
      evmAddress: '0x1111111111111111111111111111111111111111',
      venues: ['hyperliquid'],
    });
    const t = r.content[0].text;
    expect(t).toContain('Hyperliquid');
    expect(t).not.toContain('Polymarket');
    expect(t).not.toContain('Morpho');
    // Only hyperliquid should have been called
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  it('Drift is queried when solanaAddress is given', async () => {
    let driftCalled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('data.api.drift.trade')) {
        driftCalled = true;
        return new Response(JSON.stringify({
          totalCollateral: 5_000,
          freeCollateral: 4_200,
          perpPositions: [
            { marketSymbol: 'SOL-PERP', baseAssetAmount: 50, entryPrice: 140, unrealizedPnl: 100 },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r = await handlePortfolioTool('chaingpt_portfolio_snapshot', {
      solanaAddress: 'BvKbRRtJSnRkJMTKVgvA3SHLkXKi5ABZF8N3RhVwxe5o',
      venues: ['drift'],
    });
    const t = r.content[0].text;
    expect(driftCalled).toBe(true);
    expect(t).toContain('Drift');
    expect(t).toContain('SOL-PERP');
    expect(t).toContain('$5.0k');
  });

  it('gracefully surfaces venue errors without breaking the whole snapshot', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('hyperliquid.xyz')) {
        throw new Error('network unreachable');
      }
      if (u.includes('polymarket')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('morpho')) {
        return new Response(JSON.stringify({ data: { userByAddress: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r = await handlePortfolioTool('chaingpt_portfolio_snapshot', {
      evmAddress: '0x1111111111111111111111111111111111111111',
    });
    const t = r.content[0].text;
    expect(t).toContain('Errored venues: hyperliquid');
    // The successful venues should still be there
    expect(t).toContain('Polymarket');
    expect(t).toContain('Morpho');
  });
});
