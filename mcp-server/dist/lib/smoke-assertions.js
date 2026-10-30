export function missingSmokeCredential(c, env) {
    return c.requiresEnv && !env[c.requiresEnv]?.trim() ? c.requiresEnv : undefined;
}
export function smokeStatus(c, text, isError = false) {
    const matches = c.expect instanceof RegExp ? c.expect.test(text) : text.includes(c.expect);
    if (!isError && matches && (!c.expectData || c.expectData.test(text)) && !c.rejectData?.test(text))
        return 'PASS';
    return c.degradedOk?.test(text) ? 'WARN' : 'FAIL';
}
// Match the actual access challenge, not arbitrary 403 API validation errors.
export const openOceanChallenge = /HTTP 403[^\n]*https:\/\/open-api\.openocean\.finance\/[^\n]*<title>Just a moment\.\.\.<\/title>/i;
// Every host must have an accepted transport/access failure. Drift emits one
// line per host before its own hint; a parser error on any fallback is a FAIL.
const driftHostOutage = String.raw `(?:fetch failed|HTTP (?:403|503) [^\n]*https:\/\/(?:dlob|data\.api|mainnet-beta\.api)\.drift\.trade\/[^\n]*)`;
export const driftOutage = new RegExp(`^(?:ChainGPT Drift error: )?${driftHostOutage}(?:\\n${driftHostOutage})*(?:\\n\\n?Drift read tools are DEGRADED\\b[\\s\\S]*)?$`, 'i');
export const driftOrderbookSmoke = {
    expect: /Drift L2 orderbook/i,
    expectData: /\$\d+\.\d+\s+size\s+\d+\.\d+/,
    degradedOk: driftOutage,
};
/** A fixed nonzero quote must contain a positive formatted output amount. */
export const positiveQuoteOutput = /Out \(expected\):\s+(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)(?=\s|$)/;
