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
// Anchor before the canned DEGRADED hint, which contains 403/503 even on parsing bugs.
export const driftOutage = /^(?:ChainGPT Drift error: )?(?:fetch failed|HTTP (?:403|503) [^\n]*https:\/\/(?:dlob|data\.api|mainnet-beta\.api)\.drift\.trade\/)/i;
