/** Pure live-smoke assertions: importing this module never makes network calls. */
export interface SmokeExpectation {
  expect: string | RegExp;
  expectData?: RegExp;
  rejectData?: RegExp;
  requiresEnv?: string;
  degradedOk?: RegExp;
}

export function missingSmokeCredential(c: SmokeExpectation, env: NodeJS.ProcessEnv): string | undefined {
  return c.requiresEnv && !env[c.requiresEnv]?.trim() ? c.requiresEnv : undefined;
}

export function smokeStatus(c: SmokeExpectation, text: string, isError = false): 'PASS' | 'WARN' | 'FAIL' {
  const matches = c.expect instanceof RegExp ? c.expect.test(text) : text.includes(c.expect);
  if (!isError && matches && (!c.expectData || c.expectData.test(text)) && !c.rejectData?.test(text)) return 'PASS';
  return c.degradedOk?.test(text) ? 'WARN' : 'FAIL';
}

// Match the actual access challenge, not arbitrary 403 API validation errors.
export const openOceanChallenge = /HTTP 403[^\n]*https:\/\/open-api\.openocean\.finance\/[^\n]*<title>Just a moment\.\.\.<\/title>/i;
// Anchor before the canned DEGRADED hint, which contains 403/503 even on parsing bugs.
export const driftOutage = /^(?:ChainGPT Drift error: )?(?:fetch failed|HTTP (?:403|503) [^\n]*https:\/\/(?:dlob|data\.api|mainnet-beta\.api)\.drift\.trade\/)/i;

/** A fixed nonzero quote must contain a positive formatted output amount. */
export const positiveQuoteOutput = /Out \(expected\):\s+(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)(?=\s|$)/;
