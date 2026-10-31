// The agent wallet (key custody + autonomous signing) is OFF by default while open
// bug-bounty findings are reviewed. This module must be imported BEFORE 'dotenv/config'
// so only the real launch environment can enable it, never a .env file in the working dir.
export const AGENT_WALLET_ENABLED = process.env.CHAINGPT_AGENT_WALLET_ENABLED === 'true';

export const AGENT_WALLET_DISABLED_MESSAGE =
  'The ChainGPT agent wallet is disabled in this release while security reports are reviewed. ' +
  'Unsigned transaction tools still work: sign them in your own wallet. To move funds out of an ' +
  'existing agent wallet, restart the MCP server with CHAINGPT_AGENT_WALLET_ENABLED=true set in its ' +
  'launch environment (not a .env file), withdraw, then remove it again.';

export const isAgentWalletTool = (name: string) => name.startsWith('chaingpt_agent_wallet');
