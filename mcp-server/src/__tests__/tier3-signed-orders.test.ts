/**
 * Tier-3 signed-order tests (Hyperliquid + Polymarket).
 * Validates definitions + mainnet safety gates + payload-build correctness.
 */

import { describe, it, expect, vi } from 'vitest';

import './_setup.js';

import { hyperliquidTools, handleHyperliquidTool } from '../tools/hyperliquid.js';
import { polymarketTools, handlePolymarketTool } from '../tools/polymarket.js';
import { actionHash, phantomAgentTypedData, buildActionPayload } from '../lib/hyperliquid-sign.js';
import { buildOrder, orderTypedData, POLYMARKET_CTF_EXCHANGE } from '../lib/polymarket-sign.js';

describe('Hyperliquid signed-order tool definitions', () => {
  it('exposes 3 signed-action tools (place_order, cancel_order, submit_signed_action)', () => {
    const names = hyperliquidTools.map((t) => t.name);
    expect(names).toContain('chaingpt_hl_place_order_payload');
    expect(names).toContain('chaingpt_hl_cancel_order_payload');
    expect(names).toContain('chaingpt_hl_submit_signed_action');
  });

  it('place_order_payload requires acknowledgeMainnet', () => {
    const t = hyperliquidTools.find((t) => t.name === 'chaingpt_hl_place_order_payload')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeDefined();
  });

  it('cancel_order_payload does NOT require ack (cancels can only remove orders)', () => {
    const t = hyperliquidTools.find((t) => t.name === 'chaingpt_hl_cancel_order_payload')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeUndefined();
  });
});

describe('Hyperliquid action-hash helper', () => {
  it('produces a deterministic actionHash for the same inputs', () => {
    const action = { type: 'order', orders: [{ a: 0, b: true, p: '95000', s: '0.1', r: false, t: { limit: { tif: 'Gtc' } } }], grouping: 'na' };
    const h1 = actionHash(action, 1234, null);
    const h2 = actionHash(action, 1234, null);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('different nonces produce different hashes', () => {
    const action = { type: 'cancel', cancels: [{ a: 0, o: 1 }] };
    expect(actionHash(action, 1, null)).not.toBe(actionHash(action, 2, null));
  });

  it('typed-data envelope has the right HL convention (chainId 1337, name Exchange)', () => {
    const td = phantomAgentTypedData('0x' + 'a'.repeat(64) as `0x${string}`, true);
    expect(td.domain.chainId).toBe(1337);
    expect(td.domain.name).toBe('Exchange');
    expect(td.message.source).toBe('a'); // 'a' for mainnet
    expect(td.primaryType).toBe('Agent');
  });

  it('buildActionPayload returns action + typedData + nonce + hash', () => {
    const action = { type: 'order', orders: [{ a: 0, b: true, p: '1', s: '1', r: false, t: { limit: { tif: 'Gtc' } } }], grouping: 'na' };
    const p = buildActionPayload(action, { nonce: 42 });
    expect(p.action).toBe(action);
    expect(p.nonce).toBe(42);
    expect(p.actionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.typedData.message.connectionId).toBe(p.actionHash);
  });
});

describe('Hyperliquid handler smoke', () => {
  it('place_order_payload refuses without acknowledgeMainnet', async () => {
    const r = await handleHyperliquidTool('chaingpt_hl_place_order_payload', {
      asset: 0, isBuy: true, price: '95000', size: '0.01',
    });
    expect(r.content[0].text).toContain('Hyperliquid mainnet order refused');
  });

  it('place_order_payload returns typed data + action with ack', async () => {
    const r = await handleHyperliquidTool('chaingpt_hl_place_order_payload', {
      asset: 0, isBuy: true, price: '95000', size: '0.01', acknowledgeMainnet: true,
    });
    const t = r.content[0].text;
    expect(t).toContain('EIP-712 typed data');
    expect(t).toContain('"primaryType": "Agent"');
    expect(t).toContain('"type": "order"');
  });

  it('cancel_order_payload returns typed data without ack required', async () => {
    const r = await handleHyperliquidTool('chaingpt_hl_cancel_order_payload', {
      asset: 0, orderId: 12345,
    });
    const t = r.content[0].text;
    expect(t).toContain('Hyperliquid cancel');
    expect(t).toContain('"type": "cancel"');
  });

  it('submit_signed_action normalizes 0x-hex signature into r/s/v', async () => {
    const sig = '0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const r = await handleHyperliquidTool('chaingpt_hl_submit_signed_action', {
      action: { type: 'cancel', cancels: [{ a: 0, o: 1 }] },
      nonce: 1000,
      signature: sig,
    });
    expect(r.content[0].text).toContain('status');
    vi.restoreAllMocks();
  });
});

describe('Polymarket signed-order tool definitions', () => {
  it('exposes 2 signed-order tools', () => {
    const names = polymarketTools.map((t) => t.name);
    expect(names).toContain('chaingpt_pm_place_order_payload');
    expect(names).toContain('chaingpt_pm_submit_signed_order');
  });

  it('place_order_payload requires acknowledgeMainnet', () => {
    const t = polymarketTools.find((t) => t.name === 'chaingpt_pm_place_order_payload')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeDefined();
  });
});

describe('Polymarket order-build helper', () => {
  it('BUY order: makerAmount in USDC, takerAmount in outcome tokens', () => {
    const o = buildOrder({
      maker: '0x1111111111111111111111111111111111111111',
      tokenId: '12345',
      side: 'BUY',
      price: '0.42',
      size: '100',
    });
    expect(o.side).toBe(0);
    // makerAmount = 42 USDC = 42_000_000 micro-units
    expect(o.makerAmount).toBe('42000000');
    // takerAmount = 100 shares * 1e6 = 100_000_000
    expect(o.takerAmount).toBe('100000000');
  });

  it('SELL order: roles flipped', () => {
    const o = buildOrder({
      maker: '0x1111111111111111111111111111111111111111',
      tokenId: '12345',
      side: 'SELL',
      price: '0.42',
      size: '100',
    });
    expect(o.side).toBe(1);
    expect(o.makerAmount).toBe('100000000');
    expect(o.takerAmount).toBe('42000000');
  });

  it('typed data uses chainId 137 + CTF Exchange by default', () => {
    const o = buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.5', size: '10' });
    const td = orderTypedData(o, false);
    expect(td.domain.chainId).toBe(137);
    expect(td.domain.name).toBe('Polymarket CTF Exchange');
    expect(td.domain.verifyingContract).toBe(POLYMARKET_CTF_EXCHANGE);
  });

  it('negRisk=true uses the Neg-Risk exchange contract', () => {
    const o = buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.5', size: '10' });
    const td = orderTypedData(o, true);
    expect(td.domain.verifyingContract).not.toBe(POLYMARKET_CTF_EXCHANGE);
  });
});

describe('Polymarket handler smoke', () => {
  it('place_order_payload refuses without ack', async () => {
    const r = await handlePolymarketTool('chaingpt_pm_place_order_payload', {
      maker: '0x1111111111111111111111111111111111111111',
      tokenId: '12345',
      side: 'BUY',
      price: '0.42',
      size: '100',
    });
    expect(r.content[0].text).toContain('Polymarket mainnet order refused');
  });

  it('place_order_payload returns typed data with ack', async () => {
    const r = await handlePolymarketTool('chaingpt_pm_place_order_payload', {
      maker: '0x1111111111111111111111111111111111111111',
      tokenId: '12345',
      side: 'BUY',
      price: '0.42',
      size: '100',
      acknowledgeMainnet: true,
    });
    const t = r.content[0].text;
    expect(t).toContain('Polymarket order');
    expect(t).toContain('"primaryType": "Order"');
    expect(t).toContain('"chainId": 137');
  });

  it('submit_signed_order returns credential-setup hint when env vars unset', async () => {
    delete process.env.POLY_CLOB_API_KEY;
    delete process.env.POLY_CLOB_SECRET;
    delete process.env.POLY_CLOB_PASSPHRASE;
    const r = await handlePolymarketTool('chaingpt_pm_submit_signed_order', {
      order: { maker: '0xaaa', side: 0 } as any,
      signature: '0x' + 'a'.repeat(130),
    });
    expect(r.content[0].text).toContain('Polymarket CLOB credentials are required');
    expect(r.content[0].text).toContain('POLY_CLOB_API_KEY');
  });
});
