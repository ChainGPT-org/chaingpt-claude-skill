/**
 * Centralized Etherscan v2 multichain helper.
 *
 * Etherscan v2 ships a single endpoint (https://api.etherscan.io/v2/api) with a
 * `chainid` query param that works across all major EVM mainnets + testnets.
 * Most endpoints now require an API key — the legacy `YourApiKeyToken`
 * placeholder is rejected as "Missing/Invalid API Key".
 *
 * This helper exposes the base URL, a key resolver, and a friendly error
 * detector so each tool surface gets the same actionable message when the key
 * is unset rather than a raw Etherscan rejection.
 */

export const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';

/**
 * Returns the configured Etherscan API key, or `null` if unset.
 * The legacy `YourApiKeyToken` placeholder used to work on Etherscan v1's
 * permissive free tier; v2 rejects it.
 */
export function etherscanKey(): string | null {
  const k = process.env.ETHERSCAN_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

/** Build a query string with the resolved key already included. */
export function withEtherscanKey(params: URLSearchParams | Record<string, string>): URLSearchParams {
  const sp = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const k = etherscanKey();
  if (k) sp.set('apikey', k);
  return sp;
}

/**
 * Check whether the response indicates a missing-key rejection. Returns a
 * friendly help text if yes, otherwise null. Pass it `{status, message, result}`
 * shape that all Etherscan v2 endpoints return.
 */
export function detectMissingKey(res: {
  status?: string;
  message?: string;
  result?: unknown;
}): string | null {
  const rs = String(res?.result ?? '');
  const ms = String(res?.message ?? '');
  if (
    rs.toLowerCase().includes('missing/invalid api key') ||
    ms.toLowerCase().includes('missing/invalid api key') ||
    rs.toLowerCase().includes('invalid api key') ||
    (res?.status === '0' && (ms === 'NOTOK' || ms === 'No transactions found'))
  ) {
    if (rs.toLowerCase().includes('api key')) {
      return (
        'Etherscan rejected the request — no valid `ETHERSCAN_API_KEY` is set. ' +
        'Get a free key at https://etherscan.io/myapikey and export ETHERSCAN_API_KEY=<your-key>. ' +
        'The free tier (5 req/s, 100k/day) works across all EVM chains via Etherscan v2.'
      );
    }
  }
  return null;
}
