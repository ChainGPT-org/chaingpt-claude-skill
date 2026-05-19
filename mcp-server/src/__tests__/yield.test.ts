/**
 * Yield discovery tests — Pendle + Morpho Blue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.CHAINGPT_API_KEY = 'test-key';

import { yieldTools, handleYieldTool } from '../tools/yield.js';

describe('Yield tool definitions', () => {
  it('exposes 5 yield tools', () => {
    const names = yieldTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_defi_pendle_markets',
      'chaingpt_defi_pendle_market',
      'chaingpt_defi_morpho_markets',
      'chaingpt_defi_morpho_vaults',
      'chaingpt_defi_morpho_position',
    ]);
  });

  it('Morpho tools restrict to Ethereum + Base', () => {
    for (const t of yieldTools.filter((t) => t.name.includes('morpho'))) {
      const networks = (t.inputSchema as any).properties.network.enum;
      expect(networks).toEqual(['ethereum', 'base']);
    }
  });

  it('Pendle markets allows multiple chains', () => {
    const t = yieldTools.find((t) => t.name === 'chaingpt_defi_pendle_markets')!;
    const networks = (t.inputSchema as any).properties.network.enum;
    expect(networks).toContain('ethereum');
    expect(networks).toContain('arbitrum');
    expect(networks).toContain('mantle');
  });

  it('no yield tool requires acknowledgeMainnet (all read-only)', () => {
    for (const t of yieldTools) {
      expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeUndefined();
    }
  });
});

describe('Pendle handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('pendle_markets surfaces fixed/implied APYs and TVL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          markets: [
            {
              name: 'sUSDe-26DEC2025',
              address: '0xa1b2c3d4e5f6789012345678901234567890abcd',
              expiry: Math.floor(Date.now() / 1000) + 86400 * 90,
              aggregatedApy: 0.15,
              impliedApy: 0.18,
              ytFloatingApy: 0.22,
              liquidity: { usd: 12_500_000 },
              pt: { address: '0xaa', symbol: 'PT-sUSDe' },
              yt: { address: '0xbb', symbol: 'YT-sUSDe' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleYieldTool('chaingpt_defi_pendle_markets', { network: 'ethereum' });
    const t = r.content[0].text;
    expect(t).toContain('Pendle active markets');
    expect(t).toContain('Ethereum');
    expect(t).toContain('sUSDe-26DEC2025');
    expect(t).toContain('15.00%'); // fixed APY
    expect(t).toContain('18.00%'); // implied APY
    expect(t).toContain('$12.50M');
  });

  it('pendle rejects unsupported networks', async () => {
    const r = await handleYieldTool('chaingpt_defi_pendle_markets', { network: 'avalanche' });
    expect(r.content[0].text).toContain('does not support');
  });

  it('pendle_market returns detail with PT/YT/SY addresses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'stETH-26JUN2026',
          address: '0xa1b2c3d4e5f6789012345678901234567890abcd',
          expiry: Math.floor(Date.now() / 1000) + 86400 * 180,
          aggregatedApy: 0.045,
          impliedApy: 0.052,
          ytFloatingApy: 0.07,
          underlyingApy: 0.038,
          liquidity: { usd: 50_000_000 },
          pt: { address: '0x111', symbol: 'PT-stETH' },
          yt: { address: '0x222', symbol: 'YT-stETH' },
          sy: { address: '0x333', symbol: 'SY-stETH' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleYieldTool('chaingpt_defi_pendle_market', {
      network: 'ethereum',
      marketAddress: '0xa1b2c3d4e5f6789012345678901234567890abcd',
    });
    const t = r.content[0].text;
    expect(t).toContain('Pendle market');
    expect(t).toContain('stETH-26JUN2026');
    expect(t).toContain('PT (Principal Token)');
    expect(t).toContain('YT (Yield Token)');
    expect(t).toContain('SY (Standardized Yield)');
    expect(t).toContain('4.50%'); // fixed APY
  });
});

describe('Morpho handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('morpho_markets surfaces market pairs with supply/borrow APYs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            markets: {
              items: [
                {
                  uniqueKey: '0xabcabc',
                  lltv: '860000000000000000', // 86% in WAD
                  loanAsset: { symbol: 'USDC', address: '0xa0b8', decimals: 6 },
                  collateralAsset: { symbol: 'WETH', address: '0xc02a', decimals: 18 },
                  state: {
                    supplyApy: 0.058,
                    borrowApy: 0.072,
                    supplyAssetsUsd: 89_000_000,
                    borrowAssetsUsd: 67_000_000,
                    utilization: 0.75,
                  },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleYieldTool('chaingpt_defi_morpho_markets', { network: 'ethereum' });
    const t = r.content[0].text;
    expect(t).toContain('Morpho Blue markets');
    expect(t).toContain('USDC / WETH');
    expect(t).toContain('LLTV 86%');
    expect(t).toContain('5.80%'); // supply APY
    expect(t).toContain('7.20%'); // borrow APY
    expect(t).toContain('$89.00M');
  });

  it('morpho_vaults surfaces curated baskets with curators', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            vaults: {
              items: [
                {
                  address: '0xvault',
                  name: 'Gauntlet USDC Prime',
                  symbol: 'gUSDC',
                  asset: { symbol: 'USDC', address: '0xa0b8', decimals: 6 },
                  state: { netApy: 0.064, totalAssetsUsd: 245_000_000 },
                  metadata: { curators: [{ name: 'Gauntlet' }] },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleYieldTool('chaingpt_defi_morpho_vaults', { network: 'ethereum', asset: 'USDC' });
    const t = r.content[0].text;
    expect(t).toContain('MetaMorpho vaults');
    expect(t).toContain('Gauntlet USDC Prime');
    expect(t).toContain('Curator: Gauntlet');
    expect(t).toContain('6.40%');
    expect(t).toContain('$245.00M');
  });

  it('morpho_position returns market + vault positions for a user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            userByAddress: {
              address: '0x1111111111111111111111111111111111111111',
              marketPositions: [
                {
                  market: {
                    uniqueKey: '0xabc',
                    loanAsset: { symbol: 'USDC', decimals: 6 },
                    collateralAsset: { symbol: 'WETH', decimals: 18 },
                    lltv: '860000000000000000',
                  },
                  state: {
                    supplyAssetsUsd: 0,
                    borrowAssetsUsd: 50_000,
                    collateralUsd: 80_000,
                  },
                  healthFactor: 1.45,
                },
              ],
              vaultPositions: [
                {
                  vault: {
                    name: 'Gauntlet USDC Prime',
                    asset: { symbol: 'USDC' },
                    address: '0xvault',
                  },
                  state: { assetsUsd: 25_000 },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleYieldTool('chaingpt_defi_morpho_position', {
      network: 'ethereum',
      address: '0x1111111111111111111111111111111111111111',
    });
    const t = r.content[0].text;
    expect(t).toContain('Morpho positions');
    expect(t).toContain('USDC / WETH');
    expect(t).toContain('HF: 1.45');
    expect(t).toContain('Gauntlet USDC Prime');
    expect(t).toContain('$25.0k');
  });

  it('morpho rejects unsupported networks', async () => {
    const r = await handleYieldTool('chaingpt_defi_morpho_markets', { network: 'polygon' });
    expect(r.content[0].text).toContain('does not support polygon');
  });
});
