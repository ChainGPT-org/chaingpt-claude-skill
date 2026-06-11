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
import { kaminoSignedTools, handleKaminoSignedTool } from './tools/kamino_signed.js';
import { x402Tools, handleX402Tool } from './tools/x402.js';
import { baseTools, handleBaseTool } from './tools/base.js';
import { miniappTools, handleMiniappTool } from './tools/miniapp.js';
import { erc8004Tools, handleErc8004Tool } from './tools/erc8004.js';
import { dashboardTools, handleDashboardTool } from './tools/dashboard.js';
import { agentWalletSolanaTools, handleAgentWalletSolanaTool } from './tools/agent_wallet_solana.js';
import { recordToolUse } from './lib/usage.js';

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
  { name: 'chaingpt', version: '1.20.0' },
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
    ...kaminoSignedTools,
    ...x402Tools,
    ...baseTools,
    ...miniappTools,
    ...erc8004Tools,
    ...planTools,
    ...agentWalletTools,
    ...agentWalletSolanaTools,
    ...aaTools,
    ...solanaTools,
    ...dashboardTools,
  ],
}));

// ChainGPT-product tools are credit-billed and need a real API key. Catching
// this BEFORE the upstream call turns a cryptic "Invalid API Key" into a
// 30-second setup fix.
const KEY_REQUIRED_PREFIXES = [
  'chaingpt_chat',
  'chaingpt_nft',
  'chaingpt_audit',
  'chaingpt_generate',
  'chaingpt_news',
  'chaingpt_intel',
];

const API_KEY_SETUP_HELP = [
  'This tool calls the ChainGPT API and needs CHAINGPT_API_KEY.',
  '',
  'Setup (one time):',
  '  1. Get a key: https://app.chaingpt.org → API Dashboard → Create key',
  '  2. Buy credits (1,000 credits = $10; most calls cost 1 credit)',
  '  3. Export it where Claude Code can see it, e.g. in ~/.zshrc:',
  '       export CHAINGPT_API_KEY=sk-...',
  '  4. Restart Claude Code (the MCP server reads the env at boot)',
  '',
  'Key-free tools (research, risk, DEX quotes, bridge, perps reads, …) work without it.',
].join('\n');

// Route tool calls to appropriate handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  recordToolUse(name); // local-only counter (see lib/usage.ts privacy model)

  try {
    if (!API_KEY && KEY_REQUIRED_PREFIXES.some((p) => name.startsWith(p))) {
      return { content: [{ type: 'text', text: API_KEY_SETUP_HELP }] };
    }
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
    // Marginfi/Kamino: *_tx tools are signed actions; everything else is a read.
    // Prefix + suffix routing (not exact-match) so a future *_tx tool can never
    // silently fall through to the generic DeFi handler.
    if (name.startsWith('chaingpt_defi_marginfi') || name.startsWith('chaingpt_defi_kamino')) {
      if (name.endsWith('_tx')) {
        return name.startsWith('chaingpt_defi_marginfi')
          ? await handleMarginfiSignedTool(name, args)
          : await handleKaminoSignedTool(name, args);
      }
      return await handleSolanaLendingTool(name, args);
    }
    if (name.startsWith('chaingpt_x402')) return await handleX402Tool(name, args);
    if (name.startsWith('chaingpt_base_')) return await handleBaseTool(name, args);
    if (name.startsWith('chaingpt_miniapp')) return await handleMiniappTool(name, args);
    if (name.startsWith('chaingpt_erc8004')) return await handleErc8004Tool(name, args);
    if (name.startsWith('chaingpt_defi')) return await handleDefiTool(name, args);
    if (name.startsWith('chaingpt_hl')) return await handleHyperliquidTool(name, args);
    if (name.startsWith('chaingpt_pm')) return await handlePolymarketTool(name, args);
    // ORDER: the solana sub-prefix must route before the generic agent-wallet prefix.
    if (name.startsWith('chaingpt_agent_wallet_solana')) return await handleAgentWalletSolanaTool(name, args);
    if (name.startsWith('chaingpt_agent_wallet')) return await handleAgentWalletTool(name, args);
    if (name.startsWith('chaingpt_dashboard')) return await handleDashboardTool(name, args);
    if (name === 'chaingpt_strategy_save_plan' || name === 'chaingpt_strategy_load_plan' || name === 'chaingpt_strategy_list_plans' || name === 'chaingpt_strategy_delete_plan' || name === 'chaingpt_strategy_due_steps' || name === 'chaingpt_strategy_mark_step') return await handlePlanTool(name, args);
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
    // Upstream rejected the key (expired, typo'd, out of credits) — attach the
    // setup recipe instead of echoing a bare API error.
    if (/invalid api key|unauthorized|401/i.test(message) && KEY_REQUIRED_PREFIXES.some((p) => name.startsWith(p))) {
      return {
        content: [{ type: 'text', text: `Error executing ${name}: ${message}\n\nYour CHAINGPT_API_KEY looks invalid or expired.\n\n${API_KEY_SETUP_HELP}` }],
        isError: true,
      };
    }
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
