/**
 * AI Signals feed tool tests.
 *
 * Validates the chaingpt_signals_feed tool definition and runs handler
 * smoke tests with mocked fetch (same conventions as tier1.test.ts).
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// Save + restore CHAINGPT_API_KEY around the test run so we don't pollute
// the global env for sibling test files.
const ORIGINAL_API_KEY = process.env.CHAINGPT_API_KEY;
beforeAll(() => {
  process.env.CHAINGPT_API_KEY = 'stub-test-fixture';
});
afterAll(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.CHAINGPT_API_KEY;
  else process.env.CHAINGPT_API_KEY = ORIGINAL_API_KEY;
});

import { signalsTools, handleSignalsTool } from '../tools/signals.js';

// ─── Tool definitions ────────────────────────────────────────────────

describe('Signals tool definitions', () => {
  it('exposes 1 signals tool', () => {
    expect(signalsTools.map((t) => t.name)).toEqual(['chaingpt_signals_feed']);
  });

  it('has description (incl. credit cost) and object schema', () => {
    const tool = signalsTools[0];
    expect(tool.description!.length).toBeGreaterThan(20);
    expect(tool.description).toMatch(/1 credit per 10/i);
    expect(tool.inputSchema.type).toBe('object');
  });

  it('declares the documented optional params with correct shapes', () => {
    const props = (signalsTools[0].inputSchema as any).properties;
    expect(props.cmcId.type).toBe('number');
    expect(props.sentiment.enum).toEqual(['bullish', 'bearish', 'neutral']);
    expect(props.limit.default).toBe(10);
    expect(props.from.type).toBe('number');
    expect(props.to.type).toBe('number');
    expect((signalsTools[0].inputSchema as any).required).toEqual([]);
  });
});

// ─── Handler smoke tests with mocked fetch ───────────────────────────

describe('Signals handler smoke tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const okResponse = (payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('chaingpt_signals_feed POSTs filters + bearer key and returns the raw JSON', async () => {
    const upstream = {
      data: [
        { cmcId: 1027, symbol: 'ETH', sentiment: 'bullish', title: 'ETH Ethereum - OI spike' },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse(upstream));

    const res = await handleSignalsTool('chaingpt_signals_feed', {
      cmcId: 1027,
      sentiment: 'bullish',
      limit: 5,
      from: 1754600000,
      to: 1754700000,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.chaingpt.org/ai-signal/details');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer stub-test-fixture'
    );
    expect(JSON.parse(init.body as string)).toEqual({
      limit: 5,
      cmcId: 1027,
      sentiment: 'bullish',
      from: 1754600000,
      to: 1754700000,
    });

    // Raw JSON passthrough — parseable and identical to the upstream payload.
    expect(JSON.parse(res.content[0].text)).toEqual(upstream);
  });

  it('defaults limit to 10 and omits absent filters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ data: [] }));
    await handleSignalsTool('chaingpt_signals_feed', {});
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ limit: 10 });
  });

  it('clamps limit to the documented max of 50', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ data: [] }));
    await handleSignalsTool('chaingpt_signals_feed', { limit: 500 });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ limit: 50 });
  });

  it('wraps upstream HTTP errors in a ChainGPT Signals error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"Invalid API Key"}', { status: 401, statusText: 'Unauthorized' })
    );
    await expect(
      handleSignalsTool('chaingpt_signals_feed', {})
    ).rejects.toThrow(/ChainGPT Signals error: HTTP 401/);
  });

  it('returns a friendly message for unknown signals tool names', async () => {
    const res = await handleSignalsTool('chaingpt_signals_bogus', {});
    expect(res.content[0].text).toContain('Unknown signals tool');
  });
});
