/**
 * Aggregator tool tests — 1inch v6 + CoW Protocol.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import './_setup.js';

import { aggregatorTools, handleAggregatorTool } from '../tools/aggregators.js';

describe('Aggregator tool definitions', () => {
  it('exposes 4 aggregator tools', () => {
    const names = aggregatorTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_dex_1inch_quote',
      'chaingpt_dex_1inch_swap_tx',
      'chaingpt_dex_cow_create_order',
      'chaingpt_dex_cow_submit_signed_order',
    ]);
  });

  it('1inch_swap_tx requires acknowledgeMainnet', () => {
    const t = aggregatorTools.find((t) => t.name === 'chaingpt_dex_1inch_swap_tx')!;
    expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeDefined();
  });

  it('cow_create_order requires acknowledgeMainnet', () => {
    const t = aggregatorTools.find((t) => t.name === 'chaingpt_dex_cow_create_order')!;
    expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeDefined();
  });

  it('1inch_quote is read-only (no ack)', () => {
    const t = aggregatorTools.find((t) => t.name === 'chaingpt_dex_1inch_quote')!;
    expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeUndefined();
  });

  it('CoW network enum restricts to CoW-supported chains', () => {
    const t = aggregatorTools.find((t) => t.name === 'chaingpt_dex_cow_create_order')!;
    const networks = (t.inputSchema as any).properties.network.enum;
    expect(networks).toContain('ethereum');
    expect(networks).toContain('base');
    expect(networks).toContain('arbitrum');
    expect(networks).not.toContain('solana');
    expect(networks).not.toContain('polygon'); // CoW v1 dropped polygon
  });
});

describe('1inch tools — key gating', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.ONEINCH_API_KEY;
  });
  afterEach(() => {
    delete process.env.ONEINCH_API_KEY;
  });

  it('returns friendly setup hint when ONEINCH_API_KEY is missing', async () => {
    const r = await handleAggregatorTool('chaingpt_dex_1inch_quote', {
      network: 'ethereum',
      inToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      outToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      amountIn: '100',
      decimalsIn: 6,
    });
    expect(r.content[0].text).toContain('ONEINCH_API_KEY');
    expect(r.content[0].text).toContain('https://1inch.dev');
  });

  it('1inch_swap_tx refuses without acknowledgeMainnet (even with key)', async () => {
    process.env.ONEINCH_API_KEY = 'test-1inch-key';
    const r = await handleAggregatorTool('chaingpt_dex_1inch_swap_tx', {
      network: 'ethereum',
      inToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      outToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      amountIn: '100',
      decimalsIn: 6,
      from: '0x1111111111111111111111111111111111111111',
    });
    expect(r.content[0].text).toContain('Mainnet swap refused');
  });

  it('1inch_quote with key + mocked response returns formatted output', async () => {
    process.env.ONEINCH_API_KEY = 'test-1inch-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          dstAmount: '50000000000000000', // 0.05 WETH (18 decimals)
          srcToken: { symbol: 'USDC', decimals: 6 },
          dstToken: { symbol: 'WETH', decimals: 18 },
          protocols: [[[{ name: 'UNISWAP_V3' }]]],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleAggregatorTool('chaingpt_dex_1inch_quote', {
      network: 'ethereum',
      inToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      outToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      amountIn: '100',
      decimalsIn: 6,
    });
    const t = r.content[0].text;
    expect(t).toContain('1inch v6 quote');
    expect(t).toContain('Ethereum');
    expect(t).toContain('USDC');
    expect(t).toContain('WETH');
    expect(t).toContain('UNISWAP_V3');
  });

  it('1inch_swap_tx with ack + key returns unsigned tx targeting 1inch router', async () => {
    process.env.ONEINCH_API_KEY = 'test-1inch-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          dstAmount: '50000000000000000',
          srcToken: { symbol: 'USDC', decimals: 6 },
          dstToken: { symbol: 'WETH', decimals: 18 },
          tx: {
            from: '0x1111111111111111111111111111111111111111',
            to: '0x111111125421cA6dc452d289314280a0f8842A65', // 1inch v6 router
            data: '0x12aa3caf',
            value: '0',
            gas: '300000',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleAggregatorTool('chaingpt_dex_1inch_swap_tx', {
      network: 'ethereum',
      inToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      outToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      amountIn: '100',
      decimalsIn: 6,
      from: '0x1111111111111111111111111111111111111111',
      acknowledgeMainnet: true,
    });
    const t = r.content[0].text;
    expect(t).toContain('Unsigned transaction');
    expect(t).toContain('0x111111125421cA6dc452d289314280a0f8842A65');
    expect(t).toContain('"chainId": 1');
  });
});

describe('CoW Protocol tools', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('cow_create_order refuses without acknowledgeMainnet', async () => {
    const r = await handleAggregatorTool('chaingpt_dex_cow_create_order', {
      network: 'ethereum',
      sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      sellAmount: '100',
      sellDecimals: 6,
      from: '0x1111111111111111111111111111111111111111',
    });
    expect(r.content[0].text).toContain('CoW order refused');
  });

  it('cow_create_order with ack returns EIP-712 typed data + order', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          quote: {
            sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            receiver: '0x1111111111111111111111111111111111111111',
            sellAmount: '99500000', // after fee
            buyAmount: '50000000000000000',
            feeAmount: '500000',
            appData: '0x0000000000000000000000000000000000000000000000000000000000000000',
            kind: 'sell',
            partiallyFillable: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleAggregatorTool('chaingpt_dex_cow_create_order', {
      network: 'ethereum',
      sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      sellAmount: '100',
      sellDecimals: 6,
      from: '0x1111111111111111111111111111111111111111',
      acknowledgeMainnet: true,
    });
    const t = r.content[0].text;
    expect(t).toContain('CoW Protocol order');
    expect(t).toContain('Gnosis Protocol'); // EIP-712 domain name
    expect(t).toContain('0x9008D19f58AAbD9eD0D60971565AA8510560ab41'); // Settlement contract
    expect(t).toContain('0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'); // Vault Relayer for approval
    expect(t).toContain('eth_signTypedData_v4');
  });

  it('cow_submit_signed_order POSTs to CoW API and returns UID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify('0xabc123deadbeef'),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleAggregatorTool('chaingpt_dex_cow_submit_signed_order', {
      network: 'ethereum',
      order: {
        sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        sellAmount: '100000000',
        buyAmount: '50000000000000000',
        validTo: 9999999999,
        feeAmount: '500000',
        kind: 'sell',
        partiallyFillable: false,
      },
      signature: '0xdeadbeef',
    });
    const t = r.content[0].text;
    expect(t).toContain('Order UID');
    expect(t).toContain('0xabc123deadbeef');
    expect(t).toContain('explorer.cow.fi');
  });

  it('cow rejects unsupported networks', async () => {
    const r = await handleAggregatorTool('chaingpt_dex_cow_create_order', {
      network: 'polygon',
      sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      sellAmount: '100',
      sellDecimals: 6,
      from: '0x1111111111111111111111111111111111111111',
      acknowledgeMainnet: true,
    });
    expect(r.content[0].text).toContain('does not support polygon');
  });
});
