// The agent wallet (key custody + autonomous signing) is OFF by default while open
// bug-bounty findings are reviewed. This module must be imported BEFORE the .env loader (lib/dotenv-credentials)
// so only the real launch environment can enable it, never a .env file in the working dir.
export const AGENT_WALLET_ENABLED = process.env.CHAINGPT_AGENT_WALLET_ENABLED === 'true';
export const AGENT_WALLET_DISABLED_MESSAGE = 'The ChainGPT agent wallet is disabled in this release while security reports are reviewed. ' +
    'Unsigned transaction tools still work: sign them in your own wallet. To move funds left on an old ' +
    'agent address, run `node scripts/export-agent-key.mjs` yourself in a terminal and import the key into ' +
    'your own wallet.';
export const isAgentWalletTool = (name) => name.startsWith('chaingpt_agent_wallet');
