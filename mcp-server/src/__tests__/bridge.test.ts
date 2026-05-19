/**
 * Bridge tool tests (Across Protocol).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.CHAINGPT_API_KEY = 'test-key';

import { bridgeTools, handleBridgeTool } from '../tools/bridge.js';

describe('Bridge tool definitions', () => {
  it('exposes 3 bridge tools', () => {
    const names = bridgeTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_bridge_quote',
      'chaingpt_bridge_build_deposit_tx',
      'chaingpt_bridge_status',
    ]);
  });

  it('build_deposit_tx requires acknowledgeMainnet', () => {
    const t = bridgeTools.find((t) => t.name === 'chaingpt_bridge_build_deposit_tx')!;
    expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeDefined();
  });

  it('quote does NOT require ack (read-only)', () => {
    const t = bridgeTools.find((t) => t.name === 'chaingpt_bridge_quote')!;
    expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeUndefined();
  });

  it('all chain enums restrict to Across-supported set', () => {
    for (const t of bridgeTools) {
      const props = (t.inputSchema as any).properties;
      for (const key of ['originChain', 'destinationChain']) {
        if (props[key]?.enum) {
          expect(props[key].enum).toContain('ethereum');
          expect(props[key].enum).toContain('base');
          expect(props[key].enum).not.toContain('solana'); // EVM only
        }
      }
    }
  });
});

describe('Bridge mainnet safety gate', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refuses build_deposit_tx without acknowledgeMainnet', async () => {
    const r = await handleBridgeTool('chaingpt_bridge_build_deposit_tx', {
      inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
      outputToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC on Ethereum
      originChain: 'base',
      destinationChain: 'ethereum',
      amount: '100',
      decimals: 6,
      depositor: '0x1111111111111111111111111111111111111111',
    });
    expect(r.content[0].text).toContain('Mainnet bridge refused');
  });

  it('refuses when origin and destination are the same chain', async () => {
    const r = await handleBridgeTool('chaingpt_bridge_quote', {
      inputToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      outputToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      originChain: 'ethereum',
      destinationChain: 'ethereum',
      amount: '100',
      decimals: 6,
    });
    expect(r.content[0].text).toContain('must differ');
  });
});

describe('Bridge handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('quote handler surfaces fees + fill time from Across response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          estimatedFillTimeSec: 4,
          relayFeeTotal: '50000',  // 0.05 USDC
          relayFeePct: '500000000000000',
          lpFeePct: '100000000000000',
          spokePoolAddress: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
          quoteBlock: '25127940',
          timestamp: String(Math.floor(Date.now() / 1000)),
          exclusiveRelayer: '0x394311A6Aaa0D8E3411D8b62DE4578D41322d1bD',
          exclusivityDeadline: 18,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleBridgeTool('chaingpt_bridge_quote', {
      inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      outputToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      originChain: 'base',
      destinationChain: 'ethereum',
      amount: '100',
      decimals: 6,
    });
    const t = r.content[0].text;
    expect(t).toContain('Bridge quote');
    expect(t).toContain('Base → Ethereum');
    expect(t).toContain('~4s');
    expect(t).toContain('SpokePool');
  });

  it('build_deposit_tx with ack returns unsigned tx targeting the SpokePool', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          estimatedFillTimeSec: 4,
          relayFeeTotal: '50000',
          relayFeePct: '500000000000000',
          lpFeePct: '100000000000000',
          spokePoolAddress: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
          quoteBlock: '25127940',
          timestamp: String(Math.floor(Date.now() / 1000)),
          exclusiveRelayer: '0x394311A6Aaa0D8E3411D8b62DE4578D41322d1bD',
          exclusivityDeadline: 18,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleBridgeTool('chaingpt_bridge_build_deposit_tx', {
      inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      outputToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      originChain: 'base',
      destinationChain: 'ethereum',
      amount: '100',
      decimals: 6,
      depositor: '0x1111111111111111111111111111111111111111',
      acknowledgeMainnet: true,
    });
    const t = r.content[0].text;
    expect(t).toContain('Bridge transaction');
    expect(t).toContain('Unsigned transaction');
    expect(t).toContain('0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64');
    expect(t).toContain('"chainId": 8453'); // Base
  });

  it('native-coin bridging includes the value in the tx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          estimatedFillTimeSec: 4,
          relayFeeTotal: '500000000000000',
          relayFeePct: '500000000000000',
          lpFeePct: '0',
          spokePoolAddress: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
          quoteBlock: '25127940',
          timestamp: String(Math.floor(Date.now() / 1000)),
          exclusiveRelayer: '0x0000000000000000000000000000000000000000',
          exclusivityDeadline: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleBridgeTool('chaingpt_bridge_build_deposit_tx', {
      inputToken: '0x0000000000000000000000000000000000000000', // native
      outputToken: '0x0000000000000000000000000000000000000000',
      originChain: 'base',
      destinationChain: 'arbitrum',
      amount: '0.01',
      decimals: 18,
      depositor: '0x1111111111111111111111111111111111111111',
      acknowledgeMainnet: true,
    });
    const t = r.content[0].text;
    // Native bridging: value should be non-zero (0.01e18 in hex)
    expect(t).toMatch(/"value":\s*"0x2386f26fc10000"/); // 0.01e18 = 10000000000000000 = 0x2386f26fc10000
  });
});
