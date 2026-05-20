#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import 'dotenv/config';

import { chatTools, handleChatTool } from './tools/chat.js';
import { nftTools, handleNftTool } from './tools/nft.js';
import { auditTools, handleAuditTool } from './tools/audit.js';
import { generatorTools, handleGeneratorTool } from './tools/generator.js';
import { newsTools, handleNewsTool } from './tools/news.js';
import { utilTools, handleUtilTool } from './tools/utils.js';
import { walletTools, handleWalletTool } from './tools/wallet.js';
import { researchTools, handleResearchTool } from './tools/research.js';
import { riskTools, handleRiskTool } from './tools/risk.js';
import { onchainTools, handleOnchainTool } from './tools/onchain.js';
import { intelTools, handleIntelTool } from './tools/intel.js';
import { deployTools, handleDeployTool } from './tools/deploy.js';
import { dexTools, handleDexTool } from './tools/dex.js';
import { defiTools, handleDefiTool } from './tools/defi.js';
import { hyperliquidTools, handleHyperliquidTool } from './tools/hyperliquid.js';
import { polymarketTools, handlePolymarketTool } from './tools/polymarket.js';
import { strategyTools, handleStrategyTool } from './tools/strategy.js';
import { bridgeTools, handleBridgeTool } from './tools/bridge.js';
import { aggregatorTools, handleAggregatorTool } from './tools/aggregators.js';
import { yieldTools, handleYieldTool } from './tools/yield.js';
import { driftTools, handleDriftTool } from './tools/drift.js';
import { portfolioTools, handlePortfolioTool } from './tools/portfolio.js';
import { solanaLendingTools, handleSolanaLendingTool } from './tools/solana_lending.js';
import { planTools, handlePlanTool } from './tools/plans.js';
import { agentWalletTools, handleAgentWalletTool } from './tools/agent_wallet.js';
import { aaTools, handleAaTool } from './tools/aa.js';
import { solanaTools, handleSolanaTool } from './tools/solana.js';
import { marginfiSignedTools, handleMarginfiSignedTool } from './tools/marginfi_signed.js';
import { dashboardTools, handleDashboardTool } from './tools/dashboard.js';

const API_KEY = process.env.CHAINGPT_API_KEY;
if (!API_KEY) {
  // Soft-warn instead of hard-exiting. Tools that genuinely need the key
  // (chat/NFT/audit/generator/news) will fail per-call with a clear message;
  // key-free tools (dashboard, decode-only utilities) still work. This lets
  // a user open /chaingpt:dashboard before they've signed up for credits.
  console.error(
    'WARN: CHAINGPT_API_KEY is not set. ChainGPT-product tools (chat/NFT/audit/generator/news) ' +
    'will fail. Other tools (dashboard, decode/build utilities) work. Get a key at https://app.chaingpt.org.'
  );
}

const server = new Server(
  { name: 'chaingpt', version: '1.14.0' },
  { capabilities: { tools: {} } }
);

// List all tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...chatTools,
    ...nftTools,
    ...auditTools,
    ...generatorTools,
    ...newsTools,
    ...utilTools,
    ...walletTools,
    ...researchTools,
    ...riskTools,
    ...onchainTools,
    ...intelTools,
    ...deployTools,
    ...dexTools,
    ...defiTools,
    ...hyperliquidTools,
    ...polymarketTools,
    ...strategyTools,
    ...bridgeTools,
    ...aggregatorTools,
    ...yieldTools,
    ...driftTools,
    ...portfolioTools,
    ...solanaLendingTools,
    ...marginfiSignedTools,
    ...planTools,
    ...agentWalletTools,
    ...aaTools,
    ...solanaTools,
    ...dashboardTools,
  ],
}));

// Route tool calls to appropriate handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Tool routing by name prefix. ORDER MATTERS — more specific prefixes must come
    // before less specific ones. The catch-all "chaingpt_" must be last.
    //
    // ChainGPT-product wrappers (Tier 0 — original 1.0/1.1 plugin surface):
    //   chaingpt_chat*       -> chat handler
    //   chaingpt_nft*        -> nft handler
    //   chaingpt_audit*      -> audit handler
    //   chaingpt_generate*   -> generator handler
    //   chaingpt_news*       -> news handler
    //
    // Tier 1 — generic Web3 toolkit (new in 1.2):
    //   chaingpt_wallet*     -> wallet handler  (balances/positions/pnl)
    //   chaingpt_research*   -> research handler (DexScreener)
    //   chaingpt_risk*       -> risk handler    (GoPlus/Honeypot/source)
    //   chaingpt_onchain*    -> onchain handler (tx/gas/address-history/block)
    //   chaingpt_intel*      -> intel handler   (composed AI-enriched views — burn credits)
    //
    // Catch-all utility tools (estimate_credits, check_balance) must stay last.
    if (name.startsWith('chaingpt_chat')) return await handleChatTool(name, args);
    if (name.startsWith('chaingpt_nft')) return await handleNftTool(name, args);
    if (name.startsWith('chaingpt_audit')) return await handleAuditTool(name, args);
    if (name.startsWith('chaingpt_generate')) return await handleGeneratorTool(name, args);
    if (name.startsWith('chaingpt_news')) return await handleNewsTool(name, args);
    if (name.startsWith('chaingpt_wallet')) return await handleWalletTool(name, args);
    if (name.startsWith('chaingpt_research')) return await handleResearchTool(name, args);
    if (name.startsWith('chaingpt_risk')) return await handleRiskTool(name, args);
    if (name.startsWith('chaingpt_onchain')) return await handleOnchainTool(name, args);
    if (name.startsWith('chaingpt_intel')) return await handleIntelTool(name, args);
    if (name.startsWith('chaingpt_deploy')) return await handleDeployTool(name, args);
    if (name.startsWith('chaingpt_dex_1inch') || name.startsWith('chaingpt_dex_cow')) return await handleAggregatorTool(name, args);
    if (name.startsWith('chaingpt_dex')) return await handleDexTool(name, args);
    if (name.startsWith('chaingpt_defi_pendle') || name.startsWith('chaingpt_defi_morpho')) return await handleYieldTool(name, args);
    if (name === 'chaingpt_defi_marginfi_deposit_tx' || name === 'chaingpt_defi_marginfi_withdraw_tx') return await handleMarginfiSignedTool(name, args);
    if (name.startsWith('chaingpt_defi_marginfi') || name.startsWith('chaingpt_defi_kamino')) return await handleSolanaLendingTool(name, args);
    if (name.startsWith('chaingpt_defi')) return await handleDefiTool(name, args);
    if (name.startsWith('chaingpt_hl')) return await handleHyperliquidTool(name, args);
    if (name.startsWith('chaingpt_pm')) return await handlePolymarketTool(name, args);
    if (name.startsWith('chaingpt_agent_wallet')) return await handleAgentWalletTool(name, args);
    if (name.startsWith('chaingpt_dashboard')) return await handleDashboardTool(name, args);
    if (name === 'chaingpt_strategy_save_plan' || name === 'chaingpt_strategy_load_plan' || name === 'chaingpt_strategy_list_plans' || name === 'chaingpt_strategy_delete_plan') return await handlePlanTool(name, args);
    if (name.startsWith('chaingpt_strategy') || name.startsWith('chaingpt_backtest')) return await handleStrategyTool(name, args);
    if (name.startsWith('chaingpt_bridge')) return await handleBridgeTool(name, args);
    if (name.startsWith('chaingpt_drift')) return await handleDriftTool(name, args);
    if (name.startsWith('chaingpt_portfolio')) return await handlePortfolioTool(name, args);
    if (name.startsWith('chaingpt_aa_')) return await handleAaTool(name, args);
    if (name.startsWith('chaingpt_solana')) return await handleSolanaTool(name, args);
    if (name.startsWith('chaingpt_')) return await handleUtilTool(name, args);

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error executing ${name}: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
