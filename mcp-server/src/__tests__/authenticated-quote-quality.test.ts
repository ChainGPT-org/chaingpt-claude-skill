import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAggregatorTool } from '../tools/aggregators.js';
import { positiveQuoteOutput, smokeStatus } from '../lib/smoke-assertions.js';
beforeEach(() => vi.stubEnv('ONEINCH_API_KEY', 'fixture-oneinch-key'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('authenticated quote data quality', () => {
  it.each([undefined, '0', '1000000000000000'])('requires a positive output from the actual 1inch formatter: %s', async amount => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ dstAmount: amount, dstToken: { symbol: 'WETH', decimals: 18 } })));
    const r = await handleAggregatorTool('chaingpt_dex_1inch_quote', { network: 'ethereum', inToken: '0x1111111111111111111111111111111111111111', outToken: '0x2222222222222222222222222222222222222222', amountIn: '100', decimalsIn: 6 });
    expect(smokeStatus({ expect: /1inch v6 quote/, expectData: positiveQuoteOutput }, r.content[0].text)).toBe(amount === '1000000000000000' ? 'PASS' : 'FAIL');
  });
});
