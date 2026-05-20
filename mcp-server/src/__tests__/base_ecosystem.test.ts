import { describe, it, expect } from 'vitest';
import './_setup.js';
import { x402Tools, handleX402Tool } from '../tools/x402.js';
import { baseTools, handleBaseTool } from '../tools/base.js';
import { miniappTools, handleMiniappTool } from '../tools/miniapp.js';
import { erc8004Tools, handleErc8004Tool } from '../tools/erc8004.js';
import { buildTransferWithAuthorizationTypedData, X402_TOKENS } from '../lib/x402.js';
import { normalizeBasename } from '../lib/basenames.js';

// Offline/deterministic tests. Live on-chain reads (Basename + ERC-8004
// resolution) are verified separately against Base mainnet, not here.

describe('x402 — tool surface + EIP-712 builder', () => {
  it('exposes the four x402 tools', () => {
    expect(x402Tools.map((t) => t.name).sort()).toEqual([
      'chaingpt_x402_build_payment',
      'chaingpt_x402_create_requirements',
      'chaingpt_x402_decode',
      'chaingpt_x402_facilitator',
    ]);
  });

  it('EIP-3009 typed data is deterministic and amount-sensitive', () => {
    const base = {
      token: X402_TOKENS['base:USDC'],
      chainId: 8453,
      from: '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9',
      to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      value: '10000',
      validAfter: 0,
      validBefore: 1893456000,
      nonce: ('0x' + '11'.repeat(32)) as `0x${string}`,
    };
    const a = buildTransferWithAuthorizationTypedData(base);
    const b = buildTransferWithAuthorizationTypedData(base);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.typedData.primaryType).toBe('TransferWithAuthorization');
    expect(a.typedData.domain.verifyingContract.toLowerCase()).toBe(X402_TOKENS['base:USDC'].address.toLowerCase());
    // changing the amount must change the digest
    const c = buildTransferWithAuthorizationTypedData({ ...base, value: '20000' });
    expect(c.digest).not.toBe(a.digest);
  });

  it('decode parses a 402 body into options', async () => {
    const body = {
      x402Version: 1,
      accepts: [{
        scheme: 'exact', network: 'base', maxAmountRequired: '10000',
        payTo: '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        maxTimeoutSeconds: 60, extra: { name: 'USD Coin', version: '2' },
      }],
    };
    const r = await handleX402Tool('chaingpt_x402_decode', { body });
    expect(r.content[0].text).toMatch(/1 payment option/);
    expect(r.content[0].text).toMatch(/0\.01/); // 10000 atomic USDC = 0.01
  });

  it('build_payment returns unsigned typed data, and a header once signed', async () => {
    const argsBase = { from: '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9', network: 'base', symbol: 'USDC', payTo: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '0.01' };
    const unsigned = await handleX402Tool('chaingpt_x402_build_payment', argsBase);
    expect(unsigned.content[0].text).toMatch(/UNSIGNED EIP-712/);
    expect(unsigned.content[0].text).toMatch(/EIP-712 digest/);
    const signed = await handleX402Tool('chaingpt_x402_build_payment', { ...argsBase, signature: '0x' + 'ab'.repeat(65) });
    expect(signed.content[0].text).toMatch(/X-PAYMENT: [A-Za-z0-9+/=]+/);
  });

  it('create_requirements emits a 402 body', async () => {
    const r = await handleX402Tool('chaingpt_x402_create_requirements', { network: 'base', amount: '0.05', payTo: '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9' });
    expect(r.content[0].text).toMatch(/"accepts"/);
    expect(r.content[0].text).toMatch(/"maxAmountRequired": "50000"/);
  });
});

describe('Base / Basenames — surface + offline guards', () => {
  it('exposes the three base tools', () => {
    expect(baseTools.map((t) => t.name).sort()).toEqual([
      'chaingpt_base_name_availability',
      'chaingpt_base_register_name_tx',
      'chaingpt_base_resolve_name',
    ]);
  });

  it('normalizeBasename handles label and full forms', () => {
    expect(normalizeBasename('alice')).toEqual({ full: 'alice.base.eth', label: 'alice' });
    expect(normalizeBasename('alice.base.eth')).toEqual({ full: 'alice.base.eth', label: 'alice' });
    expect(() => normalizeBasename('a.b.base.eth')).toThrow();
  });

  it('register_name_tx refuses mainnet without acknowledgeMainnet (offline)', async () => {
    const r = await handleBaseTool('chaingpt_base_register_name_tx', { name: 'alice', owner: '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9' });
    expect(r.content[0].text).toMatch(/Refusing to build a mainnet Basename registration/);
  });
});

describe('Mini Apps — generation + validation (offline)', () => {
  it('exposes the three miniapp tools', () => {
    expect(miniappTools.map((t) => t.name).sort()).toEqual([
      'chaingpt_miniapp_embed',
      'chaingpt_miniapp_manifest',
      'chaingpt_miniapp_validate',
    ]);
  });

  it('manifest includes required miniapp fields + frame alias', async () => {
    const r = await handleMiniappTool('chaingpt_miniapp_manifest', { name: 'My App', homeUrl: 'https://app.example.com', iconUrl: 'https://app.example.com/icon.png', primaryCategory: 'finance' });
    const text = r.content[0].text;
    expect(text).toMatch(/"miniapp"/);
    expect(text).toMatch(/"frame"/);
    expect(text).toMatch(/"version": "1"/);
    expect(text).toMatch(/accountAssociation/);
  });

  it('embed emits both fc:miniapp and fc:frame', async () => {
    const r = await handleMiniappTool('chaingpt_miniapp_embed', { imageUrl: 'https://x.com/i.png', buttonTitle: 'Launch', appUrl: 'https://x.com' });
    expect(r.content[0].text).toMatch(/name="fc:miniapp"/);
    expect(r.content[0].text).toMatch(/name="fc:frame"/);
  });

  it('validate flags missing required fields and passes a good manifest', async () => {
    const bad = await handleMiniappTool('chaingpt_miniapp_validate', { manifest: { miniapp: { version: '1' } } });
    expect(bad.content[0].text).toMatch(/INVALID/);
    const good = await handleMiniappTool('chaingpt_miniapp_validate', { manifest: { version: '1', name: 'X', homeUrl: 'https://a.com', iconUrl: 'https://a.com/i.png' } });
    expect(good.content[0].text).toMatch(/VALID/);
  });
});

describe('ERC-8004 — surface + offline tools', () => {
  it('exposes the three erc8004 tools', () => {
    expect(erc8004Tools.map((t) => t.name).sort()).toEqual([
      'chaingpt_erc8004_agentcard',
      'chaingpt_erc8004_registries',
      'chaingpt_erc8004_resolve_agent',
    ]);
  });

  it('registries returns the canonical singleton addresses', async () => {
    const r = await handleErc8004Tool('chaingpt_erc8004_registries', {});
    expect(r.content[0].text).toMatch(/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/);
    expect(r.content[0].text).toMatch(/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63/);
  });

  it('agentcard emits a spec-compliant registration-v1 card', async () => {
    const r = await handleErc8004Tool('chaingpt_erc8004_agentcard', { name: 'Test Agent', description: 'does things', x402Support: true, agentId: '7', chain: 'base' });
    const text = r.content[0].text;
    expect(text).toMatch(/registration-v1/);
    expect(text).toMatch(/"x402Support": true/);
    expect(text).toMatch(/eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/);
  });
});
