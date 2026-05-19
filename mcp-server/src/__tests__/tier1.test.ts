/**
 * Tier-1 (Web3 toolkit) tool tests.
 *
 * Validates tool definitions for the new wallet / research / risk / onchain /
 * intel tool groups and runs a smoke handler test for each with mocked HTTP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @chaingpt/ainews used by intel.ts before any imports
vi.mock('@chaingpt/ainews', () => ({
  AINews: vi.fn().mockImplementation(() => ({
    getNews: vi.fn().mockResolvedValue({
      data: [{ title: 'ETH Update', pubDate: '2026-04-24', url: 'https://example.com/eth' }],
    }),
  })),
}));

process.env.CHAINGPT_API_KEY = 'test-key';

import { walletTools, handleWalletTool } from '../tools/wallet.js';
import { researchTools, handleResearchTool } from '../tools/research.js';
import { riskTools, handleRiskTool } from '../tools/risk.js';
import { onchainTools, handleOnchainTool } from '../tools/onchain.js';
import { intelTools, handleIntelTool } from '../tools/intel.js';

// ─── Tool definitions ────────────────────────────────────────────────

describe('Tier-1 tool definitions', () => {
  it('exposes 3 wallet tools', () => {
    const names = walletTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_wallet_balances',
      'chaingpt_wallet_positions',
      'chaingpt_wallet_pnl',
    ]);
  });

  it('exposes 3 research tools', () => {
    const names = researchTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_research_token',
      'chaingpt_research_pairs',
      'chaingpt_research_trending',
    ]);
  });

  it('exposes 4 risk tools', () => {
    const names = riskTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_risk_token',
      'chaingpt_risk_honeypot',
      'chaingpt_risk_address',
      'chaingpt_risk_contract_source',
    ]);
  });

  it('exposes 4 onchain tools', () => {
    const names = onchainTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_onchain_tx',
      'chaingpt_onchain_address',
      'chaingpt_onchain_gas',
      'chaingpt_onchain_block',
    ]);
  });

  it('exposes 2 intel tools', () => {
    const names = intelTools.map((t) => t.name);
    expect(names).toEqual(['chaingpt_intel_token', 'chaingpt_intel_wallet']);
  });

  it('all Tier-1 tools have description and object schema', () => {
    const all = [...walletTools, ...researchTools, ...riskTools, ...onchainTools, ...intelTools];
    for (const t of all) {
      expect(t.description!.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('every chain-taking tool restricts to known chain slugs', () => {
    const all = [...walletTools, ...researchTools, ...riskTools, ...onchainTools, ...intelTools];
    for (const t of all) {
      const props = (t.inputSchema as any).properties ?? {};
      const chain = props.chain;
      if (chain && chain.enum) {
        // Must be a non-empty array of strings
        expect(Array.isArray(chain.enum)).toBe(true);
        expect(chain.enum.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── Handler smoke tests with mocked fetch ───────────────────────────

describe('Tier-1 handler smoke tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('chaingpt_wallet_balances returns native-only fallback when MORALIS_API_KEY is unset', async () => {
    delete process.env.MORALIS_API_KEY;
    // Mock RPC eth_getBalance
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const res = await handleWalletTool('chaingpt_wallet_balances', {
      address: '0x0000000000000000000000000000000000000001',
      chains: ['ethereum'],
    });
    expect(res.content[0].text).toContain('No MORALIS_API_KEY');
    expect(res.content[0].text).toContain('1.000000 ETH');
  });

  it('chaingpt_research_token surfaces DexScreener fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          pairs: [
            {
              chainId: 'ethereum',
              dexId: 'uniswap',
              pairAddress: '0xpair',
              baseToken: { address: '0xbase', name: 'Test', symbol: 'TEST' },
              quoteToken: { address: '0xq', name: 'USDC', symbol: 'USDC' },
              priceUsd: '1.234',
              volume: { h24: 1_500_000 },
              liquidity: { usd: 10_000_000 },
              priceChange: { h24: 5.6 },
              marketCap: 50_000_000,
              fdv: 100_000_000,
              url: 'https://dexscreener.com/eth/0xpair',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleResearchTool('chaingpt_research_token', { query: 'TEST' });
    const text = res.content[0].text;
    expect(text).toContain('TEST/USDC');
    expect(text).toContain('uniswap');
    expect(text).toContain('1.5');
    expect(text).toContain('+5.60%');
  });

  it('chaingpt_risk_token reports honeypot flag', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 1,
          message: 'ok',
          result: {
            '0xabc0000000000000000000000000000000000001': {
              token_name: 'Scam',
              token_symbol: 'SCAM',
              is_honeypot: '1',
              holder_count: '12',
              buy_tax: '0.05',
              sell_tax: '0.99',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleRiskTool('chaingpt_risk_token', {
      address: '0xabc0000000000000000000000000000000000001',
      chain: 'ethereum',
    });
    const text = res.content[0].text;
    expect(text).toContain('Honeypot detected');
    expect(text).toContain('SCAM');
    expect(text).toContain('99.00%');
  });

  it('chaingpt_onchain_gas returns formatted breakdown when Etherscan responds', async () => {
    process.env.ETHERSCAN_API_KEY = 'test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: '1',
          message: 'OK',
          result: {
            SafeGasPrice: '20',
            ProposeGasPrice: '25',
            FastGasPrice: '30',
            suggestBaseFee: '18.5',
            gasUsedRatio: '0.4',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleOnchainTool('chaingpt_onchain_gas', { chain: 'ethereum' });
    const text = res.content[0].text;
    expect(text).toContain('Safe');
    expect(text).toContain('20 gwei');
    expect(text).toContain('30 gwei');
  });

  it('chaingpt_intel_token composes a DexScreener + GoPlus + news view', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      callCount += 1;
      const u = String(url);
      if (u.includes('dexscreener')) {
        return new Response(
          JSON.stringify({
            pairs: [
              {
                chainId: 'ethereum',
                dexId: 'uniswap',
                pairAddress: '0xpair',
                baseToken: { address: '0xbase0000000000000000000000000000000000ab', symbol: 'CGPT', name: 'ChainGPT' },
                quoteToken: { address: '0xq', symbol: 'USDC', name: 'USDC' },
                priceUsd: '0.12',
                volume: { h24: 1_000_000 },
                liquidity: { usd: 5_000_000 },
                marketCap: 30_000_000,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (u.includes('gopluslabs')) {
        return new Response(
          JSON.stringify({
            result: { '0xbase0000000000000000000000000000000000ab': { token_symbol: 'CGPT', holder_count: '12345' } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      // any other call (signal endpoint) returns empty so we still produce output
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const res = await handleIntelTool('chaingpt_intel_token', { query: 'CGPT', newsLimit: 1 });
    const text = res.content[0].text;
    expect(text).toContain('AI-enriched intel');
    expect(text).toContain('Market');
    expect(text).toContain('Security');
    expect(text).toContain('Recent news');
    expect(callCount).toBeGreaterThan(0);
  });
});
