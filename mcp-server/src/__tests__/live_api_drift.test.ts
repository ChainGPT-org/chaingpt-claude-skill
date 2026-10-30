import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import './_setup.js';
import { handleDexTool } from '../tools/dex.js';
import { handleSolanaLendingTool } from '../tools/solana_lending.js';
import { smokeStatus, missingSmokeCredential, openOceanChallenge, driftOutage } from '../lib/smoke-assertions.js';

const native = '0x0000000000000000000000000000000000000000';
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const sol = 'So11111111111111111111111111111111111111112';
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const quote = { code: 200, data: { inToken: { decimals: 18 }, outToken: { decimals: 6 }, outAmount: '1230000' } };
const text = (r: Awaited<ReturnType<typeof handleDexTool>>) => r.content[0].text;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('OpenOcean v4 atomic units', () => {
  it('preserves sub-gwei RPC gas and native input precision', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ result: '0x3b9aca' })).mockResolvedValueOnce(response(quote));
    await handleDexTool('chaingpt_dex_quote', { network: 'base', inToken: native, outToken: usdc, amountIn: '0.01' });
    const url = new URL(String(fetch.mock.calls[1][0]));
    expect(url.searchParams.get('amountDecimals')).toBe('10000000000000000');
    expect(url.searchParams.get('gasPriceDecimals')).toBe(String(0x3b9aca));
    expect(url.searchParams.has('amount')).toBe(false);
    expect(url.searchParams.has('gasPrice')).toBe(false);
  });

  it('uses on-chain decimals for USDC and converts explicit gwei exactly', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ result: '0x06' })).mockResolvedValueOnce(response(quote));
    await handleDexTool('chaingpt_dex_quote', { network: 'base', inToken: usdc, outToken: native, amountIn: '1.234567', gasPriceGwei: 0.000000001 });
    const url = new URL(String(fetch.mock.calls[1][0]));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).params[0].data).toBe('0x313ce567');
    expect(url.searchParams.get('amountDecimals')).toBe('1234567');
    expect(url.searchParams.get('gasPriceDecimals')).toBe('1');
  });

  it('rejects excess token precision rather than rounding a quote', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ result: '0x06' }));
    await expect(handleDexTool('chaingpt_dex_quote', { network: 'base', inToken: usdc, outToken: native, amountIn: '0.0000001', gasPriceGwei: 1 })).rejects.toThrow('input token precision');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not invent a gas price when RPCs fail', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(handleDexTool('chaingpt_dex_quote', { network: 'base', inToken: native, outToken: usdc, amountIn: '1' })).rejects.toThrow('Could not fetch gas price');
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('openocean'))).toBe(true);
  });

  it('does not format an error-shaped 200 response as a quote', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ code: 200, data: { message: 'bad request' } }));
    const r = await handleDexTool('chaingpt_dex_quote', { network: 'base', inToken: native, outToken: usdc, amountIn: '1', gasPriceGwei: 1 });
    expect(text(r)).toContain('OpenOcean quote failed');
    expect(text(r)).not.toContain('Swap quote');
  });
});

describe('Jupiter canonical Swap V1 host', () => {
  it('supports keyless quote requests on api.jup.ag', async () => {
    vi.stubEnv('JUPITER_API_KEY', '');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ inAmount: '10000000', outAmount: '1000000' }));
    await handleDexTool('chaingpt_dex_jupiter_quote', { inputMint: sol, outputMint: sol, amountIn: '0.01' });
    expect(String(fetch.mock.calls[0][0])).toMatch(/^https:\/\/api\.jup\.ag\/swap\/v1\/quote\?/);
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty('x-api-key');
  });

  it('passes an optional key to both quote and unsigned build, without broadcast', async () => {
    vi.stubEnv('JUPITER_API_KEY', 'fixture-jupiter-key');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ inAmount: '1', outAmount: '1' })).mockResolvedValueOnce(response({ swapTransaction: 'unsigned-fixture' }));
    const r = await handleDexTool('chaingpt_dex_jupiter_build_swap_tx', { inputMint: sol, outputMint: sol, amountIn: '1', userPublicKey: sol, acknowledgeMainnet: true });
    expect(text(r)).toContain('unsigned-fixture');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('https://api.jup.ag/swap/v1/swap');
    for (const [, init] of fetch.mock.calls) expect(init?.headers).toHaveProperty('x-api-key', 'fixture-jupiter-key');
  });
});

describe('current Solana lending schemas', () => {
  it('reads Project 0 banks and preserves explicit percent units and USD values', async () => {
    const bank = (symbol: string, pct: number, venue = 'P0') => ({ symbol, venue, address: sol, rates: { total_deposit_apy_pct: pct, total_borrow_apy_pct: 200, utilization_pct: 0.5 }, size: { deposits_usd: '2000', borrows_usd: '10' } });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ banks: [bank('LOW', 0.5), bank('HIGH', 200), bank('OTHER', 1000, 'OTHER')] }));
    const t = text(await handleSolanaLendingTool('chaingpt_defi_marginfi_banks', { sortBy: 'supplyApy' }));
    expect(fetch.mock.calls[0][0]).toBe('https://ai.0.xyz/v1/banks?venue=P0');
    expect(t).toContain('Supply APY: 0.50%');
    expect(t).toContain('Supply APY: 200.00%');
    expect(t).toContain('Supplied: $2.0k');
    expect(t.indexOf('HIGH')).toBeLessThan(t.indexOf('LOW'));
    expect(t).not.toContain('OTHER');
  });

  it('formats Project 0 equity, position sides, and empty account health', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ accounts: [{ address: sol, health: { health_factor: null }, equity: { total_assets_usd: '100', total_liabilities_usd: '20' }, positions: [{ symbol: 'SOL', side: 'lend', amount_usd: '100' }, { symbol: 'USDC', side: 'borrow', amount_usd: '20' }] }] }));
    const t = text(await handleSolanaLendingTool('chaingpt_defi_marginfi_account', { authority: sol }));
    expect(fetch.mock.calls[0][0]).toBe(`https://ai.0.xyz/v1/account/${sol}`);
    expect(t).toContain('Net equity:         $80.00');
    expect(t).toContain('n/a (empty account)');
    expect(t).toContain('SOL    deposit: $100.00    borrow: $0');
    expect(t).toContain('USDC    deposit: $0    borrow: $20.00');
    expect(t).not.toContain('[object Object]');
  });

  it('joins only requested Kamino metadata rows to reserve metrics', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response([{ name: 'Market', lendingMarket: sol }, { lendingMarket: 'unused' }])).mockResolvedValueOnce(response([{ liquidityToken: 'SOL', totalSupplyUsd: '100.25', totalBorrowUsd: '10.5' }, { liquidityToken: 'USDC', totalSupplyUsd: '20.5', totalBorrowUsd: '1.5' }]));
    const t = text(await handleSolanaLendingTool('chaingpt_defi_kamino_markets', { limit: 1 }));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://api.kamino.finance/v2/kamino-market', `https://api.kamino.finance/kamino-market/${sol}/reserves/metrics`]);
    expect(t).toContain('Supplied: $120.75    Borrowed: $12.00');
    expect(t).toContain('SOL, USDC');
    expect(t).not.toContain('showing top');
  });

  it('reports missing reserve metrics as n/a, not zero', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response([{ lendingMarket: sol }])).mockResolvedValueOnce(response([{ liquidityToken: 'SOL' }]));
    const t = text(await handleSolanaLendingTool('chaingpt_defi_kamino_markets', {}));
    expect(t).toContain('Supplied: n/a    Borrowed: n/a');
    expect(t).toContain('Metrics unavailable');
    expect(t).not.toContain('$0');
  });

  it('uses LIVE vault metrics with percent APY and current TVL, sorted by TVL', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([{ strategy: 'Low', tokenA: 'SOL', tokenB: 'USDC', totalValueLocked: '500', kaminoApy: { totalApy: '0.5' } }, { strategy: 'High', totalValueLocked: '2000', apy: { totalApy: '200' } }]));
    const t = text(await handleSolanaLendingTool('chaingpt_defi_kamino_vaults', {}));
    expect(fetch.mock.calls[0][0]).toBe('https://api.kamino.finance/strategies/metrics?env=mainnet-beta&status=LIVE');
    expect(t).toContain('SOL/USDC');
    expect(t).toContain('APY: 0.50%    TVL: $500.00');
    expect(t).toContain('APY: 200.00%    TVL: $2.0k');
    expect(t.indexOf('Strategy: High')).toBeLessThan(t.indexOf('Strategy: Low'));
  });

  it.each(['marginfi_banks', 'marginfi_account', 'kamino_markets', 'kamino_vaults'])('rejects unknown %s response shapes', async name => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ message: 'API moved' }));
    await expect(handleSolanaLendingTool(`chaingpt_defi_${name}`, { authority: sol })).rejects.toThrow('Unrecognized');
  });
});

describe('live-smoke result integrity', () => {
  const c = { expect: /Kamino/, expectData: /TVL: \$\d/, rejectData: /unreachable|n\/a/ };
  it('rejects endpoint hints, incomplete rows and isError results', () => {
    expect(smokeStatus(c, 'Kamino endpoint unreachable')).toBe('FAIL');
    expect(smokeStatus(c, 'Kamino TVL: $10 and TVL: n/a')).toBe('FAIL');
    expect(smokeStatus(c, 'Kamino TVL: $10', true)).toBe('FAIL');
    expect(smokeStatus(c, 'Kamino TVL: $10')).toBe('PASS');
  });
  it('skips missing or whitespace credentials independently of the endpoint', () => {
    expect(missingSmokeCredential({ ...c, requiresEnv: 'KEY' }, { KEY: ' ' })).toBe('KEY');
    expect(missingSmokeCredential({ ...c, requiresEnv: 'KEY' }, { KEY: 'fixture' })).toBeUndefined();
  });
  it('only tolerates the actual OpenOcean challenge, not arbitrary API 403s', () => {
    const c = { expect: /Swap quote/, degradedOk: openOceanChallenge };
    expect(smokeStatus(c, 'HTTP 403 for https://open-api.openocean.finance/v4/base/quote — <title>Just a moment...</title>', true)).toBe('WARN');
    expect(smokeStatus(c, 'HTTP 403 for https://open-api.openocean.finance/v4/base/quote — {"error":"bad amount"}', true)).toBe('FAIL');
  });
  it('does not hide parser errors behind the canned Drift degradation hint', () => {
    const c = { expect: /Drift perp markets/, degradedOk: driftOutage };
    const hint = '\nDrift read tools are DEGRADED (403 / 503)';
    expect(smokeStatus(c, 'ChainGPT Drift error: rows.map is not a function' + hint, true)).toBe('FAIL');
    expect(smokeStatus(c, 'ChainGPT Drift error: fetch failed' + hint, true)).toBe('WARN');
  });
});
