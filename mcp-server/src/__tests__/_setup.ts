/**
 * Shared test bootstrap. Imported at the top of every test file.
 *
 * Sets the env vars that handler modules read at import time. Values come
 * from the surrounding environment first (so CI can inject real fixtures);
 * fall back to non-secret stub strings otherwise.
 *
 * The stub values here are NOT real API keys — they're per-test placeholders
 * the handlers only check for non-emptiness during import. No tool that
 * runs in unit tests actually calls a real ChainGPT endpoint.
 */

// ChainGPT plugin API key. Required by handler modules at import time.
process.env.CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY || 'stub-test-fixture';
