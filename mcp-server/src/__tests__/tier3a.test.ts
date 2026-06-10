/**
 * Tier-3a DEX-trading tool tests.
 *
 * Validates tool definitions, mainnet safety gate on both EVM and Solana
 * swap-build tools, and quote handlers with mocked HTTP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import './_setup.js';

import { dexTools, handleDexTool } from '../tools/dex.js';

describe('Tier-3a DEX tool definitions', () => {
  it('exposes 5 DEX tools', () => {
    const names = dexTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_dex_quote',
      'chaingpt_dex_build_swap_tx',
      'chaingpt_dex_approve_tx',
      'chaingpt_dex_jupiter_quote',
      'chaingpt_dex_jupiter_build_swap_tx',
    ]);
  });

  it('build_swap_tx exposes acknowledgeMainnet flag', () => {
    const t = dexTools.find((t) => t.name === 'chaingpt_dex_build_swap_tx')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeDefined();
  });

  it('jupiter_build_swap_tx exposes acknowledgeMainnet flag', () => {
    const t = dexTools.find((t) => t.name === 'chaingpt_dex_jupiter_build_swap_tx')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeDefined();
  });

  it('EVM tools restrict to OpenOcean-supported chains only', () => {
    const t = dexTools.find((t) => t.name === 'chaingpt_dex_quote')!;
    const enums = (t.inputSchema as any).properties.network.enum as string[];
    // All 10 supported EVM mainnets are present, no testnets
    for (const expected of ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'linea', 'scroll']) {
      expect(enums).toContain(expected);
    }
    expect(enums).not.toContain('sepolia');
  });
});

describe('Tier-3a mainnet safety gate', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaingpt_dex_build_swap_tx refuses without acknowledgeMainnet', async () => {
    const result = await handleDexTool('chaingpt_dex_build_swap_tx', {
      network: 'ethereum',
      inToken: '0x0000000000000000000000000000000000000000',
      outToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amountIn: '0.1',
      account: '0x1111111111111111111111111111111111111111',
    });
    expect(result.content[0].text).toContain('Mainnet swap refused');
    expect(result.content[0].text).toContain('chaingpt_risk_token');
  });

  it('chaingpt_dex_jupiter_build_swap_tx refuses without acknowledgeMainnet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ inAmount: '1000000000', outAmount: '500000', routePlan: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const result = await handleDexTool('chaingpt_dex_jupiter_build_swap_tx', {
      userPublicKey: 'So11111111111111111111111111111111111111112',
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '1',
    });
    expect(result.content[0].text).toContain('Solana mainnet swap refused');
  });
});

describe('Tier-3a quote handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaingpt_dex_quote surfaces OpenOcean response fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            inToken: { symbol: 'ETH', decimals: 18, address: '0xeee' },
            outToken: { symbol: 'USDC', decimals: 6, address: '0xa0b' },
            inAmount: '100000000000000000', // 0.1 ETH
            outAmount: '350000000', // 350 USDC
            minOutAmount: '346500000',
            estimatedGas: '200000',
            dexes: [{ dexCode: 'UniswapV3' }, { dexCode: 'CurveV2' }],
            price_impact: '0.05',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleDexTool('chaingpt_dex_quote', {
      network: 'ethereum',
      inToken: '0x0000000000000000000000000000000000000000',
      outToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amountIn: '0.1',
      // Pass explicit gasPriceGwei to skip the eth_gasPrice prefetch the handler does
      // when gasPrice isn't provided. Keeps this test to a single fetch call.
      gasPriceGwei: 30,
    });
    const text = res.content[0].text;
    expect(text).toContain('Swap quote');
    expect(text).toContain('ETH');
    expect(text).toContain('USDC');
    expect(text).toContain('UniswapV3');
  });

  it('chaingpt_dex_jupiter_quote surfaces input + output mints', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          inAmount: '1000000000',
          outAmount: '180000000',
          routePlan: [{ swapInfo: { ammKey: 'pool1' } }, { swapInfo: { ammKey: 'pool2' } }],
          priceImpactPct: '0.01',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleDexTool('chaingpt_dex_jupiter_quote', {
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '1',
    });
    const text = res.content[0].text;
    expect(text).toContain('Jupiter quote');
    expect(text).toContain('Route hops:      2');
  });

  it('chaingpt_dex_approve_tx returns the approval tx', async () => {
    // Mock the OpenOcean probe call that resolves the router address
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: { to: '0x6352a56caadc4f1e25cd6c75970fa768a3304e64' } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleDexTool('chaingpt_dex_approve_tx', {
      network: 'base',
      token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      owner: '0x1111111111111111111111111111111111111111',
      amount: 'max',
      decimals: 6,
      acknowledgeMainnet: true,
    });
    const text = res.content[0].text;
    expect(text).toContain('ERC-20 approval');
    expect(text).toContain('Spender');
    expect(text).toContain('Unsigned transaction');
    expect(text).toContain('"data"');
  });

  it('chaingpt_dex_approve_tx REFUSES without acknowledgeMainnet (approvals delegate spend authority)', async () => {
    const res = await handleDexTool('chaingpt_dex_approve_tx', {
      network: 'base',
      token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      owner: '0x1111111111111111111111111111111111111111',
      amount: 'max',
      decimals: 6,
    });
    const text = res.content[0].text;
    expect(text).toContain('Mainnet approval refused');
    expect(text).not.toContain('Unsigned transaction');
  });
});
