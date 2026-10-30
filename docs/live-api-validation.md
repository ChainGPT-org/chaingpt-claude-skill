# Live API validation

Manual run on **2026-10-30 UTC** (2026-10-29 Hawaii), based on main
`e600727380f546401ee64927d5ab0a1200755ff5` plus this repair branch.
GitHub Actions remained disabled. No workflow was dispatched.

## Result and limits

The 39-case read-only suite finished with **33 PASS, 0 FAIL, 3 WARN, 3 SKIP**.
PASS includes local compilation, refusal gates and plan listing; it is not a
count of 33 successful external API requests. Wallet checks used public native
balance RPC fallback, not authenticated Moralis ERC-20 scans. The suite does not
exercise paid ChainGPT SDK calls, funded wallets, broadcasts, deployments,
ERC-4337 testnet acceptance or every tool in the catalog.

| Coverage gap | Observed result | Follow-up |
|---|---|---|
| OpenOcean Base quote | HTTP 403 HTML access challenge (`Just a moment...`) after correcting request units | Retry from an allowed client/network when public API access is restored. The live quote and unsigned build remain unverified; mocked request regressions pass. |
| Drift markets and orderbook | Public data/DLOB hosts fail DNS resolution from this environment | Retry when Drift provides a reachable supported public data endpoint. The canned 403/503 hint is historical, not evidence of the current failure. |
| Etherscan source and address history (2 cases) | `ETHERSCAN_API_KEY` unavailable in the isolated test environment | Re-run with a scoped test key; both checks are SKIP, not missing-key-hint passes. |
| 1inch quote (1 case) | `ONEINCH_API_KEY` unavailable in the isolated test environment | Re-run with a scoped test key; the setup hint is tested offline. |

No secret was retrieved or sent. Execution used a fixture-only environment,
read-only checkout, bounded scratch storage and process limits, plus an HTTPS
host and read-operation allowlist. Requests were sequential; nothing was signed
or broadcast. Logs remained local.

## Repairs and regression coverage

- **OpenOcean v4:** replace deprecated human `amount`/gwei `gasPrice` parameters
  with `amountDecimals` (atomic token units) and `gasPriceDecimals` (wei).
  Fetch ERC-20 decimals, reject excess input precision and retain sub-gwei gas
  prices. A failed RPC must not invent a 30 gwei fee. The native-ETH JavaScript
  preflight example uses the same units. See the
  [official v4 reference](https://docs.openocean.finance/docs/swap-api/v4).
- **Jupiter:** use `api.jup.ag/swap/v1` for quote and unsigned transaction build,
  preserving Swap V1 behavior. Optional `JUPITER_API_KEY` is passed as `x-api-key`
  to both routes; keyless quotes passed live. The Lite host retires on
  2026-10-30. See [API setup](https://developers.jup.ag/docs/portal/setup) and the
  [developer platform changelog](https://developers.jup.ag/changelog/developer-platform).
- **Marginfi / Project 0:** the old app endpoint now reports that Marginfi moved
  to Project 0. Use `ai.0.xyz/v1/banks?venue=P0` and `/account/{address}`.
  Decode explicit percentage fields, USD totals, account equity/health and
  lend/borrow position sides. Unknown schemas fail; missing values stay `n/a`.
  See [Marginfi's current API guide](https://docs.marginfi.com/guides/mcp-server)
  and [Project 0 OpenAPI](https://ai.0.xyz/v1/openapi.json).
- **Kamino:** `/v2/kamino-market` returns market metadata, not TVL. Enrich only
  requested markets (maximum 20) from `/kamino-market/{address}/reserves/metrics`
  and sum explicit USD metrics. Listing order is not a global TVL ranking.
  Use `/strategies/metrics?env=mainnet-beta&status=LIVE` for vault TVL/APY,
  rather than treating old strategy summaries as zero-dollar vaults. Current
  vault `totalApy` values are percentages, including values below 1%; do not
  infer units from magnitude. See [Kamino API](https://api.kamino.finance/llms.txt)
  and the [official SDK API reference](https://github.com/Kamino-Finance/kliquidity-sdk/blob/master/docs/api-reference.md).
- **Morpho portfolio:** remove the obsolete `Market.uniqueKey` selection that
  made both portfolio user queries fail HTTP 400. Explicit GraphQL errors and
  missing data must appear as errored venues, not empty positions. See
  [Morpho user-position examples](https://docs.morpho.org/developers/api/morpho/).
- **Smoke integrity:** require financial data for lending, native balances for
  both requested chains, and a portfolio without errored venues. Separate
  missing credentials from PASS. Tolerate only the identified OpenOcean HTML
  challenge and Drift transport/access errors; a canned degradation banner
  cannot hide a parser bug or arbitrary API 403.

PR review also reproduced blank/nonnumeric metric coercion and incomplete Morpho user objects being accepted as empty positions. Numeric metrics now require finite numbers or nonblank numeric strings; an explicit null Morpho user remains an empty result, while absent position arrays produce a venue error. Ten additional regressions cover these cases, including genuine zero metrics and unavailable equity when component totals are invalid.

Fixture regressions live in `live_api_drift.test.ts` and `portfolio.test.ts`.
They exercise request units, decimals, sub-gwei gas, optional Jupiter headers,
current lending payloads, percentage units, unknown schemas and smoke result
classification. They cannot establish live OpenOcean or Drift availability.

## Reproduction

Prepare locked dependencies and local toolchains as described in [TESTING.md](../TESTING.md).
Run the offline harness and build, then explicitly run live smoke:

```bash
./scripts/test-all.sh --fast
npm run build --prefix mcp-server
CHAINGPT_API_KEY=smoke-test CHAINGPT_DISABLE_KEYCHAIN=1 CHAINGPT_USAGE=off node mcp-server/dist/smoke-test.js
```

Use an isolated test environment with real wallet secrets and unrelated API
credentials unset. Only supply optional Etherscan/1inch/Jupiter test keys for the
specific authenticated coverage you intend to validate. Never commit keys or
credential-bearing `.env` files. Exit zero means no hard failures: WARN and SKIP
remain explicit coverage gaps. Keep repository Actions disabled during the hold.
