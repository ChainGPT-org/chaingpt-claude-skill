# Authenticated read-only API validation

Manual checks on **2026-10-29 Hawaii / 2026-10-30 UTC**, based on main
`33226cdb3b5ceaabff18c4aa53b88a0e1b96a4d3` plus this repair branch.
Repository GitHub Actions remained disabled; no workflow was dispatched.

## Coverage

Per-provider runs with existing project-specific credentials from Bitwarden:
**5 successful authenticated checks, 0 remaining failures, 2 cases not executed
because a scoped key was not identified**. No new credentials were created.

| Provider | Check | Result |
|---|---|---|
| Etherscan | Verified USDC source on Ethereum | PASS: source and compiler metadata returned |
| Etherscan | One recent transaction for a public wallet | PASS: authenticated transaction row returned |
| Moralis | USDC/WETH pool token balances on Ethereum | PASS: 100-token page with USDC/WETH; more results available and the total explicitly marked partial |
| Moralis | Public-wallet DeFi positions | PASS after repair: nine positions in a root array, including nested position labels and USD balances |
| Moralis | Public-wallet profitability summary | PASS: numeric trade/profit fields returned |
| 1inch | USDC to WETH quote | Not executed: no matching key found in the targeted vault search |
| ChainGPT | AI News SDK GET with limit 1 | Not executed: no scoped API key identified through the available vault UI |

A missing credential is not successful API coverage. The ChainGPT check is
read-only news retrieval and costs one API credit when executed. Chat, contract
or NFT generation, account changes, signing, approvals and broadcasting are not
part of these checks. No paid plan was enabled or account topped up.

The first Moralis balance request used Vitalik's wallet and received HTTP 400:
the provider reported too many ERC-20 balances for that wallet. Authentication
worked on the other routes. The balance fixture now uses the public Uniswap V2
USDC/WETH pool, not a claim that the oversized-wallet limitation was removed.
Balances are paginated; the tool labels partial pages and limits their displayed
total to returned tokens instead of claiming a complete wallet valuation.

## Repairs

- Moralis DeFi positions are returned as an array. The old handler read only
  `response.result`, so nine genuine positions were reported as none. Both the
  current array and the earlier result wrapper are accepted; unknown payloads
  now fail explicitly. Labels and USD balances come from the nested `position`.
- Zero-decimal ERC-20 balances no longer default to 18 decimals. Invalid token
  decimals fail rather than being guessed, and unknown balance envelopes are
  not treated as empty wallets.
- HTTP errors previously included credential-bearing URLs. Recognized secret
  query parameters and URL userinfo are now redacted. Authenticated requests
  omit raw response bodies, parser excerpts, network messages and original
  error causes, which can reflect credentials or their prefixes. HTTP status
  and a sanitized destination remain available. Public API diagnostics retain
  their useful bodies, including the known OpenOcean HTML access challenge.
- An opt-in authenticated smoke entry point reports only case status and safe
  HTTP codes. It never prints request headers, keys, raw provider output or
  arbitrary exception text. Missing keys produce SKIP; unknown providers fail
  before any request.
- Removed obsolete claims of a universally available free Moralis plan. Check
  [current Moralis plans](https://docs.moralis.com/get-started/pricing) for access
  and quotas. The [official documentation index](https://docs.moralis.com/llms.txt)
  links current API and migration guidance.

Existing keys were transferred only in memory to isolated one-use processes,
with empty ambient credentials, keychain access disabled, read-only source,
bounded scratch storage and an HTTPS GET endpoint allowlist. Only public chain
addresses were queried. Keys were not written into source, logs, screenshots,
command arguments, plaintext credential files or saved browser logins.

## Reproduction

Prepare dependencies and the offline test environment as described in
[TESTING.md](../TESTING.md). Supply only the selected service's scoped test key
through a secure process environment; do not paste keys into shell history or
commit a credential-bearing `.env` file.

```bash
npm run build --prefix mcp-server
node mcp-server/dist/authenticated-smoke-test.js etherscan
node mcp-server/dist/authenticated-smoke-test.js moralis
node mcp-server/dist/authenticated-smoke-test.js 1inch
# Explicitly opt in to a one-credit news read:
node mcp-server/dist/authenticated-smoke-test.js chaingpt
```

The environment variables are `ETHERSCAN_API_KEY`, `MORALIS_API_KEY`,
`ONEINCH_API_KEY` and `CHAINGPT_API_KEY`, respectively. With no provider argument,
the entry point selects all seven cases and skips missing keys. It is separate
from the default public smoke suite to avoid accidental authenticated quota use.
The [ChainGPT API reference](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk/ai-crypto-news-api-and-sdk-and-rss/javascript/api-reference)
and [SDK reference](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk/ai-crypto-news-api-and-sdk-and-rss/javascript/sdk-reference)
describe the news GET, authentication and credit cost.

These checks do not resolve the separately documented OpenOcean/Drift public
availability gaps, and do not replace funded testnet signing acceptance.
