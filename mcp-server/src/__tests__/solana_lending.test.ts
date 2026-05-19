/**
 * Solana lending tools — Marginfi + Kamino.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.CHAINGPT_API_KEY = 'test-key';

import { solanaLendingTools, handleSolanaLendingTool } from '../tools/solana_lending.js';

describe('Solana lending tool definitions', () => {
  it('exposes 4 read-only tools', () => {
    expect(solanaLendingTools.map((t) => t.name)).toEqual([
      'chaingpt_defi_marginfi_banks',
      'chaingpt_defi_marginfi_account',
      'chaingpt_defi_kamino_markets',
      'chaingpt_defi_kamino_vaults',
    ]);
  });

  it('no Solana lending tool requires acknowledgeMainnet', () => {
    for (const t of solanaLendingTools) {
      expect((t.inputSchema as any).properties.acknowledgeMainnet).toBeUndefined();
    }
  });
});

describe('Marginfi handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('banks surfaces top by supply TVL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          banks: [
            {
              tokenSymbol: 'USDC',
              supplyApy: 0.05,
              borrowApy: 0.08,
              totalSuppliedUsd: 120_000_000,
              totalBorrowedUsd: 70_000_000,
              utilization: 0.58,
              address: 'BankPubkey1',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleSolanaLendingTool('chaingpt_defi_marginfi_banks', {});
    const t = r.content[0].text;
    expect(t).toContain('Marginfi v2 banks');
    expect(t).toContain('USDC');
    expect(t).toContain('5.00%'); // supply APY
    expect(t).toContain('8.00%'); // borrow APY
    expect(t).toContain('$120.00M');
  });

  it('banks surfaces friendly error when endpoint dies', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await handleSolanaLendingTool('chaingpt_defi_marginfi_banks', {});
    expect(r.content[0].text).toContain('Marginfi banks endpoint unreachable');
  });

  it('account returns deposit/borrow breakdown', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            address: 'AccountPubkey1',
            health: 0.75,
            totalAssetsUsd: 50_000,
            totalLiabilitiesUsd: 12_000,
            balances: [
              { tokenSymbol: 'SOL', depositUsd: 35_000, borrowUsd: 0 },
              { tokenSymbol: 'USDC', depositUsd: 15_000, borrowUsd: 12_000 },
            ],
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleSolanaLendingTool('chaingpt_defi_marginfi_account', {
      authority: 'BvKbRRtJSnRkJMTKVgvA3SHLkXKi5ABZF8N3RhVwxe5o',
    });
    const t = r.content[0].text;
    expect(t).toContain('Marginfi accounts');
    expect(t).toContain('SOL');
    expect(t).toContain('Health ratio:       0.750');
    expect(t).toContain('Net equity:         $38.0k');
  });
});

describe('Kamino handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('markets surfaces top by TVL with top assets', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          markets: [
            {
              name: 'Main Market',
              totalSuppliedUsd: 850_000_000,
              totalBorrowedUsd: 320_000_000,
              address: 'MarketPubkey1',
              reserves: [
                { symbol: 'USDC' },
                { symbol: 'SOL' },
                { symbol: 'jitoSOL' },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleSolanaLendingTool('chaingpt_defi_kamino_markets', { limit: 5 });
    const t = r.content[0].text;
    expect(t).toContain('Kamino lending markets');
    expect(t).toContain('Main Market');
    expect(t).toContain('$850.00M');
    expect(t).toContain('Top assets: USDC, SOL, jitoSOL');
  });

  it('vaults surfaces strategies with APY + TVL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          strategies: [
            {
              name: 'JLP Multiply 5x',
              type: 'multiply',
              apy: 0.18,
              tvl: 45_000_000,
              tokenA: 'JLP',
              address: 'StrategyPubkey1',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await handleSolanaLendingTool('chaingpt_defi_kamino_vaults', { limit: 5 });
    const t = r.content[0].text;
    expect(t).toContain('Kamino vault strategies');
    expect(t).toContain('JLP Multiply 5x');
    expect(t).toContain('(multiply)');
    expect(t).toContain('18.00%');
    expect(t).toContain('$45.00M');
  });

  it('markets falls back gracefully when both endpoints fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NXDOMAIN'));
    const r = await handleSolanaLendingTool('chaingpt_defi_kamino_markets', {});
    expect(r.content[0].text).toContain('Kamino markets endpoint unreachable');
  });
});
