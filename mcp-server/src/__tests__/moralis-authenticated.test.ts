import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWalletTool } from '../tools/wallet.js';
const wallet = '0x1111111111111111111111111111111111111111';
const json = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => vi.stubEnv('MORALIS_API_KEY', 'fixture-moralis-key'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('authenticated Moralis responses', () => {
  it('reads the live root-array DeFi schema, including nested position labels and USD values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([{ protocol_name: 'Aave', position: { label: 'Supply', balance_usd: 123.45 } }]));
    const result = await handleWalletTool('chaingpt_wallet_positions', { address: wallet });
    expect(result.content[0].text).toContain('Aave — Supply ($123.45)');
    expect(result.content[0].text).not.toContain('No DeFi positions');
  });
  it('accepts an explicitly empty DeFi array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    expect((await handleWalletTool('chaingpt_wallet_positions', { address: wallet })).content[0].text).toContain('No DeFi positions');
  });
  it('does not treat unknown DeFi payloads as empty accounts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ message: 'API changed' }));
    await expect(handleWalletTool('chaingpt_wallet_positions', { address: wallet })).rejects.toThrow('Unrecognized Moralis positions');
  });
  it('does not treat unknown balance payloads as an empty wallet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ message: 'API changed' }));
    await expect(handleWalletTool('chaingpt_wallet_balances', { address: wallet, chains: ['ethereum'] })).rejects.toThrow('Unrecognized Moralis balances');
  });
  it('preserves zero token decimals in authenticated balances', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ result: [{ token_address: wallet, symbol: 'ZERO', balance: '123', decimals: 0, usd_value: 123 }] }));
    const result = await handleWalletTool('chaingpt_wallet_balances', { address: wallet, chains: ['ethereum'] });
    expect(result.content[0].text).toMatch(/ZERO\s+123(?:\.0*)? \(\$123.00\)/);
  });
  it('marks paginated balance values as partial instead of a complete wallet total', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ cursor: 'fixture-next-page', result: [{ token_address: wallet, symbol: 'USDC', balance: '1000000', decimals: 6, usd_value: 1 }] }));
    const result = await handleWalletTool('chaingpt_wallet_balances', { address: wallet, chains: ['ethereum'] });
    expect(result.content[0].text).toContain('Additional tokens are available');
    expect(result.content[0].text).toContain('Partial total (returned tokens only): $1.00');
  });

});
