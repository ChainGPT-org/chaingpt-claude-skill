#!/usr/bin/env node
/**
 * Demo launcher for the agent-wallet admin dashboard.
 *
 * Spins up a throwaway keystore + policy in /tmp/chaingpt-demo/ and starts
 * the UI server on http://127.0.0.1:8787. Does NOT touch your real
 * ~/.chaingpt-mcp/ directory.
 *
 * Usage:  node scripts/demo-agent-wallet-dashboard.mjs
 * Stop:   Ctrl-C
 */

import { rmSync } from 'node:fs';

// Env setup — must be set BEFORE the modules below load any state
process.env.CHAINGPT_API_KEY = 'demo-key-not-used';
process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE =
  'demo-passphrase-only-do-not-use-with-real-funds-1234567890';
process.env.CHAINGPT_KEYSTORE_FILE = '/tmp/chaingpt-demo/keystore.json';
process.env.CHAINGPT_AGENT_POLICY_FILE = '/tmp/chaingpt-demo/policy.json';
process.env.CHAINGPT_ADMIN_TOKEN_FILE = '/tmp/chaingpt-demo/.admin-token';

// Clean previous demo state so re-runs work
rmSync('/tmp/chaingpt-demo', { recursive: true, force: true });

const mod = await import('../mcp-server/dist/tools/agent_wallet.js');

const initRes = await mod.handleAgentWalletTool('chaingpt_agent_wallet_init', {});
console.log(initRes.content[0].text);
console.log('\n' + '─'.repeat(70) + '\n');

const port = Number(process.env.PORT || 8787);
const uiRes = await mod.handleAgentWalletTool('chaingpt_agent_wallet_serve_ui', {
  port,
  chains: ['ethereum', 'base', 'arbitrum'],
});
console.log(uiRes.content[0].text);

console.log('\n' + '─'.repeat(70));
console.log(`\n>>> Dashboard running. Open the URL in your browser. <<<`);
console.log(`>>> Ctrl-C to stop. State lives in /tmp/chaingpt-demo/. <<<\n`);

// Keep the event loop alive
setInterval(() => {}, 1 << 30);
