/**
 * Real-world smoke test for Tier 1-3 tools. Run with:
 *
 *   CHAINGPT_API_KEY=test node node_modules/typescript/bin/tsc && \
 *     CHAINGPT_API_KEY=test node dist/smoke-test.js
 *
 * Hits live mainnet APIs with no mocks to catch any wiring bugs the
 * unit tests can't surface. Tests the read-only and quote/build paths
 * that don't require a wallet. Exits non-zero on any failure.
 */

import { handleResearchTool } from './tools/research.js';
import { handleRiskTool } from './tools/risk.js';
import { handleOnchainTool } from './tools/onchain.js';
import { handleDexTool } from './tools/dex.js';
import { handleDefiTool } from './tools/defi.js';
import { handleHyperliquidTool } from './tools/hyperliquid.js';
import { handlePolymarketTool } from './tools/polymarket.js';
import { handleWalletTool } from './tools/wallet.js';
import { handleDeployTool } from './tools/deploy.js';

interface SmokeCase {
  name: string;
  fn: () => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  /** A substring that the output MUST contain for the test to pass. */
  expect: string | RegExp;
  /** If true, log full output; otherwise just first 200 chars. */
  verbose?: boolean;
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Canonical mainnet addresses used by smoke tests
const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH_ETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const CGPT_ETH = '0x9840652dc04fb9db2c43853633f0f62be6f00f98';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// A high-traffic public wallet (Vitalik) for read-only address scans
const VITALIK = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

const cases: SmokeCase[] = [
  // ─── Tier 1: research ────────────────────────────────────────────
  {
    name: 'research_token (CGPT by symbol)',
    fn: () => handleResearchTool('chaingpt_research_token', { query: 'CGPT' }),
    expect: /CGPT|chaingpt/i,
  },
  {
    name: 'research_token (WETH by address on ethereum)',
    fn: () =>
      handleResearchTool('chaingpt_research_token', { query: WETH_ETH, chain: 'ethereum' }),
    expect: /WETH|Wrapped Ether/i,
  },
  {
    name: 'research_pairs (USDC pairs on base)',
    fn: () =>
      handleResearchTool('chaingpt_research_pairs', {
        address: USDC_BASE,
        chain: 'base',
        limit: 3,
      }),
    expect: /USDC|pair/i,
  },
  {
    name: 'research_trending',
    fn: () => handleResearchTool('chaingpt_research_trending', { limit: 3 }),
    expect: /Trending tokens/i,
  },

  // ─── Tier 1: risk ────────────────────────────────────────────────
  {
    name: 'risk_token (USDC on ethereum)',
    fn: () =>
      handleRiskTool('chaingpt_risk_token', { address: USDC_ETH, chain: 'ethereum' }),
    expect: /USDC|Token security/i,
  },
  {
    name: 'risk_address (Vitalik wallet)',
    fn: () =>
      handleRiskTool('chaingpt_risk_address', { address: VITALIK, chain: 'ethereum' }),
    expect: /Address risk/i,
  },
  {
    name: 'risk_contract_source (USDC verified source — or friendly key-missing hint)',
    fn: () =>
      handleRiskTool('chaingpt_risk_contract_source', {
        address: USDC_ETH,
        chain: 'ethereum',
        previewChars: 200,
      }),
    // Without ETHERSCAN_API_KEY, the tool surfaces a friendly hint; with a key it returns source.
    expect: /Contract source|verified|Source preview|ETHERSCAN_API_KEY/i,
  },

  // ─── Tier 1: onchain ─────────────────────────────────────────────
  {
    name: 'onchain_gas (ethereum)',
    fn: () => handleOnchainTool('chaingpt_onchain_gas', { chain: 'ethereum' }),
    expect: /gwei|Gas/i,
  },
  {
    name: 'onchain_block (base latest)',
    fn: () => handleOnchainTool('chaingpt_onchain_block', { chain: 'base', number: 'latest' }),
    expect: /Block \d+|Timestamp/i,
  },
  {
    name: 'onchain_address (Vitalik recent txs — or friendly key-missing hint)',
    fn: () =>
      handleOnchainTool('chaingpt_onchain_address', {
        address: VITALIK,
        chain: 'ethereum',
        limit: 3,
      }),
    expect: /transaction|tx|recent|ETHERSCAN_API_KEY/i,
  },

  // ─── Tier 1: wallet ──────────────────────────────────────────────
  {
    name: 'wallet_balances (Vitalik, RPC fallback w/o Moralis key)',
    fn: () =>
      handleWalletTool('chaingpt_wallet_balances', {
        address: VITALIK,
        chains: ['ethereum', 'base'],
      }),
    expect: /Wallet|ETH/i,
  },

  // ─── Tier 2: deploy (compile only — no network needed) ───────────
  {
    name: 'deploy_compile (minimal contract)',
    fn: () =>
      handleDeployTool('chaingpt_deploy_compile', {
        source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Hello { string public greeting = "hi"; }`,
      }),
    expect: /Hello|Compiled contract|Bytecode size/i,
  },
  {
    name: 'deploy_build_tx (mainnet refusal without ack)',
    fn: () =>
      handleDeployTool('chaingpt_deploy_build_tx', {
        bytecode: '0x6080604052',
        network: 'ethereum',
      }),
    expect: /Mainnet deploy refused/i,
  },

  // ─── Tier 3a: DEX (quote only — no signing) ──────────────────────
  {
    name: 'dex_quote (ETH→USDC on base)',
    fn: () =>
      handleDexTool('chaingpt_dex_quote', {
        network: 'base',
        inToken: '0x0000000000000000000000000000000000000000',
        outToken: USDC_BASE,
        amountIn: '0.01',
      }),
    expect: /Swap quote|expected|USDC/i,
  },
  {
    name: 'dex_build_swap_tx (mainnet refusal without ack)',
    fn: () =>
      handleDexTool('chaingpt_dex_build_swap_tx', {
        network: 'ethereum',
        inToken: '0x0000000000000000000000000000000000000000',
        outToken: USDC_ETH,
        amountIn: '0.01',
        account: VITALIK,
      }),
    expect: /Mainnet swap refused/i,
  },
  {
    name: 'dex_jupiter_quote (SOL→USDC)',
    fn: () =>
      handleDexTool('chaingpt_dex_jupiter_quote', {
        inputMint: SOL_MINT,
        outputMint: USDC_SOL_MINT,
        amountIn: '0.01',
        decimalsIn: 9,
      }),
    expect: /Jupiter quote|outAmount|Amount out/i,
  },

  // ─── Tier 3d: DeFi (Aave health read only) ───────────────────────
  {
    name: 'defi_aave_health (Vitalik on ethereum — likely empty position)',
    fn: () =>
      handleDefiTool('chaingpt_defi_aave_health', {
        user: VITALIK,
        network: 'ethereum',
      }),
    expect: /Aave V3 health|Total collateral|Health factor/i,
  },
  {
    name: 'defi_aave_supply_tx (mainnet refusal without ack)',
    fn: () =>
      handleDefiTool('chaingpt_defi_aave_supply_tx', {
        asset: USDC_ETH,
        amount: '100',
        decimals: 6,
        from: VITALIK,
        network: 'ethereum',
      }),
    expect: /Mainnet supply refused/i,
  },
  {
    name: 'defi_lido_stake_tx (refusal without ack)',
    fn: () =>
      handleDefiTool('chaingpt_defi_lido_stake_tx', {
        amountEth: '1.0',
        from: VITALIK,
      }),
    expect: /Mainnet Lido stake refused/i,
  },

  // ─── Tier 3b: Hyperliquid ────────────────────────────────────────
  {
    name: 'hl_markets (perp universe)',
    fn: () => handleHyperliquidTool('chaingpt_hl_markets', { type: 'perp', limit: 5 }),
    expect: /BTC|ETH|markets/i,
  },
  {
    name: 'hl_mids (filter BTC + ETH)',
    fn: () => handleHyperliquidTool('chaingpt_hl_mids', { filter: ['BTC', 'ETH'] }),
    expect: /BTC|ETH/i,
  },
  {
    name: 'hl_orderbook (BTC depth=5)',
    fn: () => handleHyperliquidTool('chaingpt_hl_orderbook', { coin: 'BTC', depth: 5 }),
    expect: /Bid|Ask|orderbook/i,
  },
  {
    name: 'hl_funding (BTC last 24h)',
    fn: () => handleHyperliquidTool('chaingpt_hl_funding', { coin: 'BTC', hours: 24 }),
    expect: /funding|rate=/i,
  },

  // ─── Tier 3c: Polymarket ─────────────────────────────────────────
  {
    name: 'pm_markets (top by volume)',
    fn: () =>
      handlePolymarketTool('chaingpt_pm_markets', { limit: 3, order: 'volume24hr', active: true }),
    expect: /Polymarket markets|YES|vol24h/i,
  },
];

let pass = 0;
let fail = 0;
const failures: Array<{ name: string; reason: string }> = [];

console.log(`\n${YELLOW}══ ChainGPT plugin smoke test — ${cases.length} cases ══${RESET}\n`);

for (const c of cases) {
  process.stdout.write(`  ${c.name.padEnd(60)} `);
  try {
    const result = await c.fn();
    const text = result.content?.[0]?.text ?? '';
    const matches =
      c.expect instanceof RegExp ? c.expect.test(text) : text.includes(c.expect);
    if (matches && !result.isError) {
      console.log(`${GREEN}PASS${RESET}`);
      pass++;
      if (c.verbose) console.log(`    ${text.slice(0, 300)}`);
    } else {
      console.log(`${RED}FAIL${RESET}`);
      const reason = !matches
        ? `expected ${c.expect}, got: ${text.slice(0, 200)}`
        : `result marked isError: ${text.slice(0, 200)}`;
      failures.push({ name: c.name, reason });
      fail++;
    }
  } catch (err: any) {
    console.log(`${RED}ERROR${RESET}`);
    failures.push({ name: c.name, reason: err?.message ?? String(err) });
    fail++;
  }
}

console.log(`\n${YELLOW}════════════════════════════════════════════════════${RESET}`);
console.log(` Results: ${GREEN}${pass} passed${RESET}, ${fail > 0 ? RED : GREEN}${fail} failed${RESET}`);
console.log(`${YELLOW}════════════════════════════════════════════════════${RESET}\n`);

if (failures.length > 0) {
  console.log(`${RED}Failures:${RESET}`);
  for (const f of failures) {
    console.log(`  ${RED}✗${RESET} ${f.name}`);
    console.log(`    ${f.reason}\n`);
  }
  process.exit(1);
}
process.exit(0);
