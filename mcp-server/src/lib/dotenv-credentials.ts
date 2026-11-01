// A .env in the working directory (often an untrusted project checkout) may supply API
// credentials only. Keystore/policy/ledger paths, the keystore passphrase, the wallet
// switch and RPC hosts must come from the real launch environment: a planted .env must
// not choose where keys live, which policy applies, or which node builds transactions.
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';

export const DOTENV_ALLOWED_KEYS = new Set([
  'CHAINGPT_API_KEY', 'ETHERSCAN_API_KEY', 'MORALIS_API_KEY', 'ONEINCH_API_KEY', 'JUPITER_API_KEY',
  'GOPLUS_API_KEY', 'TRON_PRO_API_KEY', 'POLY_CLOB_API_KEY', 'POLY_CLOB_SECRET', 'POLY_CLOB_PASSPHRASE',
]);

/** Copy allowed keys from `text` (dotenv format) into `env` without overriding; returns ignored keys. */
export function applyDotenvCredentials(text: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(parse(text))) {
    if (!DOTENV_ALLOWED_KEYS.has(key)) ignored.push(key);
    else if (env[key] === undefined) env[key] = value;
  }
  return ignored;
}

let text: string | null = null;
try { text = readFileSync('.env', 'utf8'); } catch { /* no .env: nothing to load */ }
if (text !== null) {
  const ignored = applyDotenvCredentials(text);
  if (ignored.length) {
    console.error(
      `WARN: ignored ${ignored.join(', ')} from ./.env. Only API credentials are read from a .env file; ` +
      'set paths, RPC URLs and wallet settings in the MCP server launch environment.',
    );
  }
}
