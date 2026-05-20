import { describe, it, expect } from 'vitest';
import './_setup.js';
import { kaminoSignedTools, handleKaminoSignedTool } from '../tools/kamino_signed.js';

// These tests are OFFLINE: they only exercise the input-validation guards that
// run BEFORE any RPC/SDK call (acknowledgeMainnet gate, symbol/mint + amount
// requirements). The actual instruction encoding is verified live against
// mainnet (see _brain/wiki + the PR description), which a unit test can't do.

describe('Kamino signed-action tool definitions', () => {
  it('exposes exactly the deposit + withdraw tools', () => {
    expect(kaminoSignedTools.map((t) => t.name).sort()).toEqual([
      'chaingpt_defi_kamino_deposit_tx',
      'chaingpt_defi_kamino_withdraw_tx',
    ]);
  });

  it('both tools require the acknowledgeMainnet gate field', () => {
    for (const t of kaminoSignedTools) {
      const props = (t.inputSchema as any).properties;
      expect(props.acknowledgeMainnet).toBeDefined();
      expect(props.acknowledgeMainnet.type).toBe('boolean');
    }
  });

  it('deposit requires from + amount; withdraw requires from', () => {
    const dep = kaminoSignedTools.find((t) => t.name.endsWith('deposit_tx'))!;
    const wd = kaminoSignedTools.find((t) => t.name.endsWith('withdraw_tx'))!;
    expect((dep.inputSchema as any).required).toEqual(['from', 'amount']);
    expect((wd.inputSchema as any).required).toEqual(['from']);
  });
});

describe('Kamino signed-action gate + validation (offline)', () => {
  const FROM = 'FDMkknZ9Z3jMwcuSTQUADxXHARnA83jr6mnQACKsE48f';

  it('refuses to build without acknowledgeMainnet:true', async () => {
    const r = await handleKaminoSignedTool('chaingpt_defi_kamino_deposit_tx', {
      from: FROM, symbol: 'USDC', amount: '1',
    });
    expect(r.content[0].text).toMatch(/Refusing to build a Kamino mainnet deposit/);
  });

  it('withdraw also refuses without acknowledgeMainnet:true', async () => {
    const r = await handleKaminoSignedTool('chaingpt_defi_kamino_withdraw_tx', {
      from: FROM, symbol: 'USDC', amount: '1',
    });
    expect(r.content[0].text).toMatch(/Refusing to build a Kamino mainnet withdraw/);
  });

  it('requires symbol or mint (after the gate passes)', async () => {
    const r = await handleKaminoSignedTool('chaingpt_defi_kamino_deposit_tx', {
      from: FROM, amount: '1', acknowledgeMainnet: true,
    });
    expect(r.content[0].text).toMatch(/Provide either symbol .* or mint/);
  });

  it('deposit requires an amount', async () => {
    const r = await handleKaminoSignedTool('chaingpt_defi_kamino_deposit_tx', {
      from: FROM, symbol: 'USDC', acknowledgeMainnet: true,
    });
    expect(r.content[0].text).toMatch(/amount is required for deposit/);
  });

  it('rejects a malformed owner address', async () => {
    const r = await handleKaminoSignedTool('chaingpt_defi_kamino_deposit_tx', {
      from: 'not-a-real-address', symbol: 'USDC', amount: '1', acknowledgeMainnet: true,
    });
    expect(r.content[0].text).toMatch(/Error in chaingpt_defi_kamino_deposit_tx/);
  });

  it('withdraw needs amount or withdrawAll', async () => {
    const r = await handleKaminoSignedTool('chaingpt_defi_kamino_withdraw_tx', {
      from: FROM, symbol: 'USDC', acknowledgeMainnet: true,
    });
    expect(r.content[0].text).toMatch(/Provide amount, or set withdrawAll:true/);
  });
});
