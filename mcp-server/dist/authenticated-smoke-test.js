/** Explicit opt-in authenticated reads. Keys come only from the process environment.
 * No signing, generation, account changes, or broadcasts. News fetch costs 1 credit.
 * Run: node mcp-server/dist/authenticated-smoke-test.js [etherscan|1inch|moralis|chaingpt]
 */
import { handleRiskTool } from './tools/risk.js';
import { handleOnchainTool } from './tools/onchain.js';
import { handleAggregatorTool } from './tools/aggregators.js';
import { handleWalletTool } from './tools/wallet.js';
import { handleNewsTool } from './tools/news.js';
import { smokeStatus, missingSmokeCredential } from './lib/smoke-assertions.js';
const wallet = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const cases = [
    { provider: 'etherscan', name: 'verified contract source', requiresEnv: 'ETHERSCAN_API_KEY',
        run: () => handleRiskTool('chaingpt_risk_contract_source', { chain: 'ethereum', address: usdc, previewChars: 100 }),
        expect: /Source preview/, rejectData: /No verified source code|ETHERSCAN_API_KEY/ },
    { provider: 'etherscan', name: 'recent public-wallet transactions', requiresEnv: 'ETHERSCAN_API_KEY',
        run: () => handleOnchainTool('chaingpt_onchain_address', { chain: 'ethereum', address: wallet, limit: 1 }),
        expect: /Last \d+ transactions/, rejectData: /ETHERSCAN_API_KEY/ },
    { provider: '1inch', name: 'USDC to WETH quote', requiresEnv: 'ONEINCH_API_KEY',
        run: () => handleAggregatorTool('chaingpt_dex_1inch_quote', { network: 'ethereum', inToken: usdc, outToken: weth, amountIn: '100', decimalsIn: 6 }),
        expect: /1inch v6 quote/, expectData: /Out \(expected\):\s+[\d.]+/, rejectData: /ONEINCH_API_KEY|failed/i },
    { provider: 'moralis', name: 'authenticated token balances', requiresEnv: 'MORALIS_API_KEY',
        run: () => handleWalletTool('chaingpt_wallet_balances', { address: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc', chains: ['ethereum'], minUsdValue: 1 }),
        expect: /Ethereum — \$[\d.]+ across \d+ token/, expectData: /USDC[\s\S]*WETH|WETH[\s\S]*USDC/, rejectData: /MORALIS_API_KEY|n\/a/ },
    { provider: 'moralis', name: 'DeFi positions', requiresEnv: 'MORALIS_API_KEY',
        run: () => handleWalletTool('chaingpt_wallet_positions', { address: wallet, chain: 'ethereum' }),
        expect: /DeFi positions for|No DeFi positions found/, rejectData: /MORALIS_API_KEY|unknown protocol/ },
    { provider: 'moralis', name: 'profitability summary', requiresEnv: 'MORALIS_API_KEY',
        run: () => handleWalletTool('chaingpt_wallet_pnl', { address: wallet, chain: 'ethereum' }),
        expect: /P&L summary/, expectData: /Total realized profit:\s+\$[\d.,-]+/, rejectData: /MORALIS_API_KEY|n\/a|NaN/ },
    { provider: 'chaingpt', name: 'AI News SDK GET (1 credit)', requiresEnv: 'CHAINGPT_API_KEY',
        run: () => handleNewsTool('chaingpt_news_fetch', { limit: 1 }),
        expect: /1\. \S/, rejectData: /undefined|No news articles found/ },
];
const provider = process.argv[2];
if (provider && !cases.some(c => c.provider === provider)) {
    console.error('Unknown provider. Use etherscan, 1inch, moralis, or chaingpt.');
    process.exit(2);
}
let passed = 0, failed = 0, skipped = 0;
for (const c of cases.filter(c => !provider || c.provider === provider)) {
    if (missingSmokeCredential(c, process.env)) {
        console.log(`SKIP ${c.provider}: ${c.name} (missing ${c.requiresEnv})`);
        skipped++;
        continue;
    }
    try {
        const result = await c.run();
        const status = smokeStatus(c, result.content.map(v => v.text).join('\n'));
        console.log(`${status} ${c.provider}: ${c.name}`);
        if (status === 'PASS')
            passed++;
        else
            failed++;
    }
    catch (error) {
        // Neither provider output nor arbitrary exception text belongs in an auth smoke log.
        const status = (error instanceof Error ? error.message : '').match(/\bHTTP (\d{3})\b/)?.[1];
        console.log(`FAIL ${c.provider}: ${c.name} (${status ? `HTTP ${status}` : 'request or response validation failed'})`);
        failed++;
    }
}
console.log(`Authenticated reads: ${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exitCode = failed ? 1 : 0;
