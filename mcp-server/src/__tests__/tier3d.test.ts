/**
 * Tier-3d DeFi-protocol tool tests.
 * Validates definitions + mainnet safety gates + handler smoke tests.
 */

import { describe, it, expect, vi } from 'vitest';

import './_setup.js';

import { defiTools, handleDefiTool } from '../tools/defi.js';

describe('Tier-3d DeFi tool definitions', () => {
  it('exposes 7 DeFi tools', () => {
    const names = defiTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_defi_aave_health',
      'chaingpt_defi_aave_supply_tx',
      'chaingpt_defi_aave_borrow_tx',
      'chaingpt_defi_aave_repay_tx',
      'chaingpt_defi_aave_withdraw_tx',
      'chaingpt_defi_lido_stake_tx',
      'chaingpt_defi_eigenlayer_deposit_tx',
    ]);
  });

  it('every build_tx tool has acknowledgeMainnet flag', () => {
    const buildTxTools = defiTools.filter((t) => t.name.endsWith('_tx'));
    for (const t of buildTxTools) {
      const props = (t.inputSchema as any).properties;
      expect(props.acknowledgeMainnet).toBeDefined();
    }
  });

  it('aave tools restrict to 7-chain network enum', () => {
    const t = defiTools.find((t) => t.name === 'chaingpt_defi_aave_health')!;
    const enums = (t.inputSchema as any).properties.network.enum as string[];
    for (const expected of ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche']) {
      expect(enums).toContain(expected);
    }
  });
});

describe('Tier-3d mainnet safety gates', () => {
  it('aave_supply_tx refuses without acknowledgeMainnet', async () => {
    const r = await handleDefiTool('chaingpt_defi_aave_supply_tx', {
      asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amount: '1000',
      decimals: 6,
      from: '0x1111111111111111111111111111111111111111',
      network: 'ethereum',
    });
    expect(r.content[0].text).toContain('Mainnet supply refused');
  });

  it('aave_borrow_tx refuses without acknowledgeMainnet', async () => {
    const r = await handleDefiTool('chaingpt_defi_aave_borrow_tx', {
      asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amount: '1000',
      decimals: 6,
      from: '0x1111111111111111111111111111111111111111',
      network: 'ethereum',
    });
    expect(r.content[0].text).toContain('Mainnet borrow refused');
  });

  it('lido_stake_tx refuses without acknowledgeMainnet', async () => {
    const r = await handleDefiTool('chaingpt_defi_lido_stake_tx', {
      amountEth: '1.0',
      from: '0x1111111111111111111111111111111111111111',
    });
    expect(r.content[0].text).toContain('Mainnet Lido stake refused');
  });

  it('eigenlayer_deposit_tx refuses without acknowledgeMainnet', async () => {
    const r = await handleDefiTool('chaingpt_defi_eigenlayer_deposit_tx', {
      strategy: '0x93c4b944D05dfe6df7645A86cd2206016c51564D',
      token: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      amount: '1.0',
      decimals: 18,
      from: '0x1111111111111111111111111111111111111111',
    });
    expect(r.content[0].text).toContain('Mainnet EigenLayer deposit refused');
  });
});

describe('Tier-3d build_tx handlers (post-ack)', () => {
  it('aave_supply_tx returns an unsigned tx targeting the pool', async () => {
    const r = await handleDefiTool('chaingpt_defi_aave_supply_tx', {
      asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amount: '1000',
      decimals: 6,
      from: '0x1111111111111111111111111111111111111111',
      network: 'ethereum',
      acknowledgeMainnet: true,
    });
    const text = r.content[0].text;
    expect(text).toContain('Aave V3 supply');
    expect(text).toContain('0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'); // mainnet pool
    expect(text).toContain('"chainId": 1');
    expect(text).toContain('Unsigned transaction');
  });

  it('lido_stake_tx returns a value-bearing tx to the Lido contract', async () => {
    const r = await handleDefiTool('chaingpt_defi_lido_stake_tx', {
      amountEth: '1.0',
      from: '0x1111111111111111111111111111111111111111',
      acknowledgeMainnet: true,
    });
    const text = r.content[0].text;
    expect(text).toContain('Lido stake');
    expect(text).toContain('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'); // stETH contract
    expect(text).toContain('Unsigned transaction');
  });

  it('aave_repay_tx supports amount="max" for full repayment', async () => {
    const r = await handleDefiTool('chaingpt_defi_aave_repay_tx', {
      asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amount: 'max',
      decimals: 6,
      from: '0x1111111111111111111111111111111111111111',
      acknowledgeMainnet: true,
    });
    expect(r.content[0].text).toContain('full debt (uint256 max)');
  });
});
