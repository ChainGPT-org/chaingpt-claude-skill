# Provider warning and credential follow-up

Manual read-only checks on **2026-10-30 UTC / 2026-10-30 Hawaii**, starting from main
`64b70c31d3560a366c343548d9573fb0aadb7ea5`.
GitHub Actions remained disabled; no workflow was dispatched.
The Etherscan receipt completed at 10:04 UTC / 00:04 Hawaii; public smoke
completed at 10:09 UTC / 00:09 Hawaii. These are subsequent checks, separate
from the October 29 Hawaii run retained in `live-api-validation.md`.

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

- All seven offline layers passed: **720 MCP + 61 mock-server tests** (781
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

## PR review validation

Review added sixteen regressions for custom-endpoint diagnostic privacy and
multi-host outage classification. Custom Drift endpoints may carry path tokens;
failures now retain only an HTTP status when available, omitting the override
URL, reflected body, parser/network text and cause. Public failures remain
readable, with embedded line breaks normalized so a reflected hint cannot hide
another host's failure. The smoke classifier requires every host to have an
accepted transport/access failure; any parser error, unknown override failure
or unexpected HTTP status produces FAIL. Unknown contract envelopes fail
explicitly; empty contract results no longer dump raw response objects that
could reflect a private endpoint token. The orderbook smoke case now requires
numeric price/size levels; an empty or unknown book is missing live coverage,
not a healthy result.

Six external-review regressions, three additional raw-response regressions and
two empty-orderbook regressions failed before their respective repairs. The full offline suite,
bundled build comparison and dependency audits were rerun for merge review.
Authenticated 1inch/ChainGPT checks remain unrun, as requested; no manual key
entry or credential retrieval is needed to review and merge these repairs.

The CLI fixture still compiles current source into its temporary directory. It
now uses TypeScript's emit-only mode because the full typecheck runs separately;
this avoids duplicating that analysis in a unit worker and retains the runtime
assertions. Compilation has a bounded timeout with explicit failure diagnostics.
After an initial build timeout and aggregate sandbox deadline, all seven layers
were rerun individually within the existing per-run sandbox limits.

Merge-review dependency coverage includes both locked npm projects, all 132
locked Rust registry crates, Go 1.27.3 standard-library OSV checks (the Go example
has no third-party modules), and open Dependabot alerts.

The existing hostile-IPv6 regression also separated its one-second parser CPU
budget from Node startup/module loading, while retaining a ten-second hard
child-process deadline and 128 MiB heap limit. This removes a startup-sensitive
timeout without accepting an expensive parser operation.

The final boot check used the harness's existing `BOOT_SMOKE_TIMEOUT_MS=30000`
setting after the default eight-second handshake timed out on the loaded host.
The initialize handshake and 155-tool assertions remain required; the default
setting and production launcher were not changed.
