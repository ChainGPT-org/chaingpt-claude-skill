# Provider warning and credential follow-up

Manual read-only checks on **2026-10-30 UTC / Hawaii**, starting from main
`64b70c31d3560a366c343548d9573fb0aadb7ea5`.
GitHub Actions remained disabled; no workflow was dispatched.

## Findings and remaining coverage

| Provider | Current evidence | Result / required next step |
|---|---|---|
| Etherscan | Existing Claude-labeled project key selected from the service-specific Bitwarden entry; verified USDC source and one recent public-wallet transaction both returned HTTP 200 and passed data assertions | **2 authenticated PASS, 0 FAIL, 0 SKIP.** This covers the two Etherscan cases skipped by the credential-free public suite. |
| OpenOcean | A bounded v4 Base ETH/USDC quote with atomic amount/gas parameters returned HTTP 403 and the `Just a moment...` HTML challenge | **WARN remains.** The [official error reference](https://docs.openocean.finance/docs/developer-resources/errors) directs 403 callers to request IP allowlisting from the provider. No valid live quote or unsigned build was established; no provider support message or access-policy change was made. |
| Drift market list and orderbook | Both legacy hosts still fail DNS resolution from this environment. The [legacy app](https://app.drift.trade/) reports the program paused; the [official migration guide](https://docs.velocity.exchange/developers/migrate-from-drift) confirms Velocity is a separate program deployment with no carried-over state | **2 WARN remain.** Restoring the legacy service or adding a separately identified Velocity integration requires independent acceptance. Replacing the hostname would return a different protocol's data under Drift names. |
| 1inch | Targeted Bitwarden search did not identify a matching scoped key | **Not executed.** A scoped test key with quote access is required; this is not successful authenticated coverage. |
| ChainGPT news | No scoped API key identified; further direct pop-out access was blocked by browser security policy | **Not executed.** Requires a scoped existing key for the one-credit news GET; no key, account or paid plan was created. |

The vault extension was checked directly in Brave's ChainGPT profile and was
unlocked. Etherscan credential selection and API calls stayed in memory, with
status-only results, a one-use local form, empty ambient credentials, keychain
access disabled, read-only source, bounded scratch storage and an HTTPS GET
endpoint allowlist. No secrets entered source control, logs, screenshots,
command arguments or a plaintext credential file. No signing, broadcasting,
wallet connection, account migration or provider permission changes occurred.

## Repository repairs

- Drift failures retain each actual upstream error. A DNS failure no longer
  acquires historical HTTP 403/503 claims from a canned hint, and the final
  fallback no longer erases an earlier observed failure.
- All five tool descriptions identify legacy Drift and the hosted-data gap.
  The skill and troubleshooting instructions no longer suggest active trading
  workflows or changing Solana RPC as a remedy for unavailable HTTP services.
- Velocity is explicitly a separate deployment. Defaults remain pointed at
  legacy Drift; no automatic protocol switch was added.
- Three regressions failed against the old implementation and pass after the
  repair. They cover accurate diagnostics, preservation of fallback errors,
  legacy-only destinations and catalog availability descriptions.

## Validation

- All seven offline layers passed: **704 MCP + 61 mock-server tests** (765
  total), typechecks, Go vet, locked offline Cargo check, 47 Solidity blocks,
  structural validation and a 155-tool server boot. Structural validation has
  the existing internal mock-server version warning.
- All 78 bundled JavaScript files match the compiled source.
- Fresh public smoke: **33 PASS, 0 FAIL, 3 WARN, 3 SKIP**. The three warnings
  are the OpenOcean and two legacy Drift failures above. This run deliberately
  used a fixture-only environment, so it still skips Etherscan twice and 1inch
  once; the separate authenticated Etherscan receipt above covers its two cases.
  ChainGPT's paid news GET is outside the default public suite and remains unrun.
- Both locked npm audits report zero vulnerabilities; GitHub reports no open
  Dependabot alerts. No dependencies or workflows changed.
- No live quote, legacy Drift data, 1inch quote or ChainGPT news success is
  inferred from passing offline fixtures or an exit-zero smoke summary.
