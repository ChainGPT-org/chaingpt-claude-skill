/**
 * Tier-3 signed-order tests (Hyperliquid + Polymarket).
 * Validates definitions + mainnet safety gates + payload-build correctness.
 */

import { describe, it, expect, vi } from 'vitest';

import './_setup.js';

import { hyperliquidTools, handleHyperliquidTool } from '../tools/hyperliquid.js';
import { polymarketTools, handlePolymarketTool } from '../tools/polymarket.js';
import { actionHash, phantomAgentTypedData, buildActionPayload } from '../lib/hyperliquid-sign.js';
import {
  buildOrder, orderTypedData, depositWalletTypedData, wrapDepositWalletSignature, type PolymarketOrder,
  POLYMARKET_CTF_EXCHANGE, POLYMARKET_NEG_RISK_EXCHANGE, POLYMARKET_V2_EXCHANGE,
} from '../lib/polymarket-sign.js';

// A CLOB /book response: the place-order tool reads the signing domain and price/size grid from it.
const mockBook = (book: Record<string, unknown> = {}) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
  new Response(JSON.stringify({ tick_size: '0.01', min_order_size: '5', neg_risk: false, bids: [], asks: [], ...book }), { status: 200 }));
import { hashDomain, hashStruct, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

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

  it('CTF books sign against domain version "2"; neg_risk picks the exchange', () => {
    const o = buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.5', size: '10' });
    const td = orderTypedData(o);
    expect(td.domain).toEqual({ name: 'Polymarket CTF Exchange', version: '2', chainId: 137, verifyingContract: POLYMARKET_CTF_EXCHANGE });
    expect(orderTypedData(o, { negRisk: true }).domain.verifyingContract).toBe(POLYMARKET_NEG_RISK_EXCHANGE);
  });

  it('v2 books sign against domain version "3" on the single v2 exchange, whatever neg_risk says', () => {
    const o = buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.5', size: '10' });
    const td = orderTypedData(o, { bookVersion: 'v2', negRisk: true });
    expect(td.domain).toMatchObject({ version: '3', verifyingContract: POLYMARKET_V2_EXCHANGE });
  });

  it('signs the current Order struct: no taker/nonce/feeRateBps/expiration, uint8 side + signatureType', () => {
    const o = buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.5', size: '10', expirationSec: 2_000_000_000 });
    const td = orderTypedData(o);
    expect(td.types.Order.map((f) => f.name)).toEqual(
      ['salt', 'maker', 'signer', 'tokenId', 'makerAmount', 'takerAmount', 'side', 'signatureType', 'timestamp', 'metadata', 'builder']);
    expect(td.message).not.toHaveProperty('expiration');
    expect(o.expiration).toBe('2000000000'); // kept for the POST body
    expect(Math.abs(Number(o.timestamp) - Date.now())).toBeLessThan(60_000); // unix ms
  });

  // Vector from Polymarket's own clients (py-clob-client-v2 tests/order_utils/test_exchange_order_builder_v2.py,
  // also rs-clob-client-v2 tests/order.rs): a POLY_1271 signature on Amoy (80002) whose ERC-7739 wrapper embeds
  // the exchange's domain separator and the Order struct hash right after the 65-byte inner signature.
  it('matches the domain separator and Order struct hash in the official client vector', () => {
    const expected =
      '0xa3a093c83b6c20c83355c16ce94c92e6e9fcbdeb840618cc74f6c57a42ad145b' +
      '2b98db73d2c73cbf1f2b6af288566ae81960ddbc3a13921027358a8bff3be6ff1c' +
      'a440cbd865bc0c6243d7a8df9a8bf48a8827b0a4abbb61c30e96d305423af148' +
      'd23d42d3ad94e65d78258cecaf8dcbaddac0f73dc085040f2c12bb595dd83804';
    const domainSeparator = '0x' + expected.slice(2 + 130, 2 + 130 + 64);
    const structHash = '0x' + expected.slice(2 + 130 + 64, 2 + 130 + 128);
    const wallet = '0x1111111111111111111111111111111111111111' as const;
    const order: PolymarketOrder = {
      salt: '479249096354', maker: wallet, signer: wallet, tokenId: '1234',
      makerAmount: '100000000', takerAmount: '50000000', side: 0, signatureType: 3,
      timestamp: '1710000000000', metadata: `0x${'0'.repeat(64)}`, builder: `0x${'0'.repeat(64)}`, expiration: '0',
    };
    const td = orderTypedData(order); // the CTF exchange address is the same on Amoy and Polygon
    const amoyDomain = { ...td.domain, chainId: 80002 };
    expect(hashDomain({ domain: amoyDomain, types: td.types } as any)).toBe(domainSeparator);
    expect(hashStruct({ data: td.message, primaryType: 'Order', types: td.types } as any)).toBe(structHash);
  });

  it('reproduces the official client vector\'s full deposit-wallet signature', async () => {
    // Same vector, signed by the public Hardhat dev key #0 (deterministic ECDSA), Amoy, CTF exchange.
    const expected =
      '0xa3a093c83b6c20c83355c16ce94c92e6e9fcbdeb840618cc74f6c57a42ad145b' +
      '2b98db73d2c73cbf1f2b6af288566ae81960ddbc3a13921027358a8bff3be6ff1c' +
      'a440cbd865bc0c6243d7a8df9a8bf48a8827b0a4abbb61c30e96d305423af148' +
      'd23d42d3ad94e65d78258cecaf8dcbaddac0f73dc085040f2c12bb595dd83804' +
      '4f726465722875696e743235362073616c742c61646472657373206d616b65722c' +
      '61646472657373207369676e65722c75696e7432353620746f6b656e49642c75' +
      '696e74323536206d616b6572416d6f756e742c75696e743235362074616b6572' +
      '416d6f756e742c75696e743820736964652c75696e7438207369676e61747572' +
      '65547970652c75696e743235362074696d657374616d702c6279746573333220' +
      '6d657461646174612c62797465733332206275696c6465722900ba';
    const owner = privateKeyToAccount(('0x' + 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`);
    const wallet = '0x1111111111111111111111111111111111111111' as const;
    const order: PolymarketOrder = {
      salt: '479249096354', maker: wallet, signer: wallet, tokenId: '1234',
      makerAmount: '100000000', takerAmount: '50000000', side: 0, signatureType: 3,
      timestamp: '1710000000000', metadata: `0x${'0'.repeat(64)}`, builder: `0x${'0'.repeat(64)}`, expiration: '0',
    };
    const base = orderTypedData(order);
    const td = { ...base, domain: { ...base.domain, chainId: 80002 } };
    const inner = await owner.signTypedData(depositWalletTypedData(td) as any);
    expect(wrapDepositWalletSignature(inner, td)).toBe(expected);
  });

  it('checks the book\'s tick size and minimum order size', () => {
    const o = { maker: '0xaaa' as any, tokenId: '1', side: 'BUY' as const, tickSize: '0.01', minOrderSize: '5' };
    expect(() => buildOrder({ ...o, price: '0.425', size: '10' })).toThrow(/not on this market's tick/);
    expect(() => buildOrder({ ...o, price: '0.995', size: '10', tickSize: '0.001' })).not.toThrow();
    expect(() => buildOrder({ ...o, price: '0.42', size: '4.99' })).toThrow(/below this market's minimum/);
    expect(buildOrder({ ...o, price: '0.42', size: '5' }).takerAmount).toBe('5000000');
  });

  it('typed data signs and recovers with eth_signTypedData_v4 semantics', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const o = buildOrder({ maker: account.address, tokenId: '1234', side: 'SELL', price: '0.42', size: '10' });
    const td = orderTypedData(o, { negRisk: true });
    const signature = await account.signTypedData(td as any);
    expect(await recoverTypedDataAddress({ ...td, signature } as any)).toBe(account.address);
  });

  it('rounds size down to 2 decimals and rejects prices finer than any tick', () => {
    const o = buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.52', size: '10.299' });
    expect(o.takerAmount).toBe('10290000');
    expect(o.makerAmount).toBe('5350800'); // 10.29 × 0.52, exact
    expect(buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.5', size: '0.29' }).takerAmount).toBe('290000');
    expect(() => buildOrder({ maker: '0xaaa' as any, tokenId: '1', side: 'BUY', price: '0.12345', size: '10' })).toThrow(/more than 4 decimals/);
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
    const spy = mockBook();
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
    expect(t).toContain('"version": "2"');
    expect(String(spy.mock.calls[0][0])).toContain('/book?token_id=12345');
    spy.mockRestore();
  });

  it('place_order_payload takes neg_risk and the price grid from the book', async () => {
    const spy = mockBook({ neg_risk: true, tick_size: '0.1' });
    try {
      const base = { maker: '0x1111111111111111111111111111111111111111', tokenId: '12345', side: 'BUY', size: '100', acknowledgeMainnet: true };
      expect((await handlePolymarketTool('chaingpt_pm_place_order_payload', { ...base, price: '0.4' })).content[0].text).toContain(POLYMARKET_NEG_RISK_EXCHANGE);
      await expect(handlePolymarketTool('chaingpt_pm_place_order_payload', { ...base, price: '0.42' })).rejects.toThrow(/not on this market's tick/);
    } finally { spy.mockRestore(); }
  });

  it('place_order_payload uses the v2 domain when the book is v2', async () => {
    const spy = mockBook({ version: 'v2', neg_risk: true });
    const r = await handlePolymarketTool('chaingpt_pm_place_order_payload', {
      maker: '0x1111111111111111111111111111111111111111', tokenId: '12345', side: 'BUY', price: '0.42', size: '100',
      acknowledgeMainnet: true,
    });
    spy.mockRestore();
    expect(r.content[0].text).toContain(POLYMARKET_V2_EXCHANGE);
    expect(r.content[0].text).toContain('"version": "3"');
  });

  it('deposit-wallet orders: owner signs TypedDataSign, submit wraps it and authenticates as the owner', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const wallet = '0x' + '1'.repeat(40);
    let spy = mockBook();
    const r = await handlePolymarketTool('chaingpt_pm_place_order_payload', {
      maker: wallet, signer: owner.address, signatureType: 3, tokenId: '12345', side: 'BUY', price: '0.42', size: '100', acknowledgeMainnet: true,
    });
    spy.mockRestore();
    const t = r.content[0].text;
    const typed = JSON.parse(t.split('--- EIP-712 typed data (sign via eth_signTypedData_v4) ---')[1].split('--- order')[0]);
    const order = JSON.parse(t.split('--- order (pass back to submit_signed_order) ---')[1]);
    expect(typed.primaryType).toBe('TypedDataSign');
    expect([order.maker, order.signer, order.depositWallet.owner]).toEqual([wallet, wallet, owner.address]);

    process.env.POLY_CLOB_API_KEY = 'k'; process.env.POLY_CLOB_SECRET = 'cw=='; process.env.POLY_CLOB_PASSPHRASE = 'p';
    spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success":true}', { status: 200 }));
    try {
      const stranger = await privateKeyToAccount(generatePrivateKey()).signTypedData(typed);
      const refused = await handlePolymarketTool('chaingpt_pm_submit_signed_order', { order, signature: stranger });
      expect(refused.content[0].text).toContain("not the deposit wallet's owner");
      expect(spy).not.toHaveBeenCalled();

      const signature = await owner.signTypedData(typed);
      await handlePolymarketTool('chaingpt_pm_submit_signed_order', { order, signature });
      const init = spy.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(String(init.body));
      expect(body.order.signature).toBe(wrapDepositWalletSignature(signature, orderTypedData(order)));
      expect(body.order).not.toHaveProperty('depositWallet');
      expect((init.headers as Record<string, string>).POLY_ADDRESS).toBe(owner.address);
    } finally {
      spy.mockRestore();
      delete process.env.POLY_CLOB_API_KEY; delete process.env.POLY_CLOB_SECRET; delete process.env.POLY_CLOB_PASSPHRASE;
    }
  });

  it('submit_signed_order refuses legacy-format orders instead of posting a dead signature', async () => {
    process.env.POLY_CLOB_API_KEY = 'k'; process.env.POLY_CLOB_SECRET = 'cw=='; process.env.POLY_CLOB_PASSPHRASE = 'p';
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const legacy = { salt: '1', maker: '0x' + 'a'.repeat(40), side: 0, taker: '0x' + '0'.repeat(40), nonce: '0', feeRateBps: '0' };
      const r = await handlePolymarketTool('chaingpt_pm_submit_signed_order', { order: legacy as any, signature: '0x' + 'a'.repeat(130) });
      expect(r.content[0].text).toContain('not in the current Polymarket order format');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      delete process.env.POLY_CLOB_API_KEY; delete process.env.POLY_CLOB_SECRET; delete process.env.POLY_CLOB_PASSPHRASE;
    }
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

  it('proxy-wallet orders keep maker = proxy and signer = EOA', () => {
    const proxy = ('0x' + 'a'.repeat(40)) as `0x${string}`, eoa = ('0x' + 'b'.repeat(40)) as `0x${string}`;
    const o = buildOrder({ maker: proxy, signer: eoa, signatureType: 1, tokenId: '1', price: '0.5', size: '10', side: 'BUY' });
    expect([o.maker, o.signer, o.signatureType]).toEqual([proxy, eoa, 1]);
  });

  it('new orders use salts that survive the CLOB API\'s numeric salt exactly', () => {
    for (let i = 0; i < 50; i++) {
      const o = buildOrder({ maker: ('0x' + '1'.repeat(40)) as `0x${string}`, tokenId: '1', price: '0.5', size: '10', side: 'BUY' });
      expect(Number.isSafeInteger(Number(o.salt))).toBe(true);
    }
  });

  it('submit_signed_order sends the API key as owner and the signer as POLY_ADDRESS', async () => {
    process.env.POLY_CLOB_API_KEY = 'fixture-api-key';
    process.env.POLY_CLOB_SECRET = Buffer.from('fixture-secret').toString('base64');
    process.env.POLY_CLOB_PASSPHRASE = 'fixture-passphrase';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, orderID: '0x1' }), { status: 200 }));
    try {
      const maker = ('0x' + 'a'.repeat(40)) as `0x${string}`, signer = ('0x' + 'b'.repeat(40)) as `0x${string}`; // proxy wallet: maker != signer
      const order = { ...buildOrder({ maker, signer, signatureType: 1, tokenId: '7', side: 'BUY', price: '0.5', size: '10', expirationSec: 2_000_000_000 }), salt: '281474976710655' };
      await handlePolymarketTool('chaingpt_pm_submit_signed_order', { order: order as any, signature: '0x' + 'a'.repeat(130), orderType: 'GTD' });
      const init = spy.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(String(init.body));
      expect(body.owner).toBe('fixture-api-key');
      expect(body.order.side).toBe('BUY');
      expect(body.order.salt).toBe(281474976710655); // the signed value, exactly, as a JSON number
      expect((init.headers as Record<string, string>).POLY_ADDRESS).toBe(signer);
      // Current wire format: signed fields + unsigned expiration, no legacy taker/nonce/feeRateBps.
      expect(Object.keys(body.order).sort()).toEqual(
        ['builder', 'expiration', 'maker', 'makerAmount', 'metadata', 'salt', 'side', 'signature', 'signatureType', 'signer', 'takerAmount', 'timestamp', 'tokenId']);
      expect(body.order.expiration).toBe('2000000000');
      expect(body.order.signatureType).toBe(1);
      expect([body.deferExec, body.postOnly, body.orderType]).toEqual([false, false, 'GTD']);
    } finally {
      spy.mockRestore();
      delete process.env.POLY_CLOB_API_KEY; delete process.env.POLY_CLOB_SECRET; delete process.env.POLY_CLOB_PASSPHRASE;
    }
  });
});
