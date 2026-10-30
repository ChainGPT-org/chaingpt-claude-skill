# Dependency security notes

The September 2026 dependency review updated both npm graphs, pinned direct
dependencies to exact versions and regenerated their lockfiles. Use Node.js
**22.14+** (CI uses 24) and install from a reviewed checkout:

```bash
npm ci --prefix mcp-server --ignore-scripts
npm ci --prefix mock-server --ignore-scripts
```

For the shipped MCP build alone, add `--omit=dev`. Keep credentials unset during
installation and never reuse `node_modules` from an untrusted checkout.

## Combined October integration

PRs #109–#113 combine the wallet hardening and all dependency remediations.
Fresh lockfile audits of both complete graphs report **zero known findings at every severity**.
The sections and linked remediation reports below preserve their original standalone
validation snapshots; their remaining-alert counts do not describe the combined graph.
The current MCP SDK is **1.32.2**, and `proxy-addr` remains **2.0.8** in both graphs.

Integration validation on Node.js 26.9.0 passed **621 MCP tests and 61 mock tests**,
all seven offline test layers, 47 Solidity examples and 16 scanner regression tests.
All 76 committed build files reproduced byte for byte; boot smoke listed 155 unique tools.
Go/Rust example checks were skipped because those toolchains are unavailable.

Validation runs locally while repository GitHub Actions remains disabled. Live funded-chain
and authenticated upstream smoke tests are outside this offline validation. The legacy
Jito import limitation recorded during that validation is resolved by the
[scoped Jito compatibility follow-up](jito-compatibility.md).

## October 2026 proxy-trust patch (standalone snapshot)

Dependabot alerts **#132 (MCP)** and **#131 (mock)** identify the same critical
[CVE-2026-90711 / GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
in `proxy-addr` 2.0.7. Certain IPv6 proxy-trust subnets incorrectly match IPv4
peers, allowing forged `X-Forwarded-For` values to influence Express's `req.ip`
and `req.ips`. Both packages override this dependency to **2.0.8**, the first
patched release, and commit its registry integrity hash in their lockfiles.
This is a patch-only change; Express and its other dependencies are unchanged.

At the time of the isolated proxy patch, the MCP path was `@modelcontextprotocol/sdk@1.29.0 → express@5.2.1 → proxy-addr`.
The shipped MCP entry point uses stdio; its wallet/dashboard HTTP listeners use
`node:http`. The mock path is `express@4.22.1 → proxy-addr`; the mock app retains
Express's default `trust proxy = false`. No application source enables Express
proxy trust. These defaults limit current exposure; the installed vulnerable
dependency still needs the patch, including for future HTTP transport changes.

Regression tests in
[MCP](../mcp-server/src/__tests__/proxy-trust.test.ts) and
[mock](../mock-server/src/__tests__/proxy-trust.test.ts) resolve `proxy-addr`
through the Express instance used by each dependency tree. They exercise both
single-subnet and multiple-subnet compiler paths, IPv4 and mapped IPv6 peers,
malformed mapped prefixes, native IPv6 boundaries, forwarded-header spoofing,
valid IPv4/mapped proxy subnets, and stopping at an untrusted intermediate hop.
The mock tests also check that the shipped app ignores forwarded client IPs.
Reassess proxy-trust configuration whenever HTTP listeners or parent SDKs change.

Verification on Node.js **26.9.0** used fresh `npm ci --ignore-scripts` installs.
All **518 MCP tests** and **39 mock tests** passed, including 25 new regression
tests. As a negative control, the same tests loaded the registry-verified 2.0.7
implementation: eight security cases failed in each graph while the valid-proxy
compatibility cases passed. Restoring 2.0.8 made all new tests pass again.
Both TypeScript checks passed, the MCP build reproduced all 71 committed output
files byte for byte, and the stdio boot smoke returned 155 unique tools.

A fresh `npm audit --package-lock-only` reported **zero critical findings in both
graphs**. MCP retained 25 high and 10 moderate package findings; mock retained
3 high and 4 moderate. A same-session audit of the unchanged base confirmed that
these remaining findings predate this patch; no new advisory package findings
were introduced. This patch addresses the two critical alerts, not every advisory
in either graph. The September review below is a historical snapshot.

## Overrides and compatibility

| Graph | Override | Reason and verified API |
| --- | --- | --- |
| MCP | `bigint-buffer` → `npm:@exodus/bigint-buffer@1.1.5-exodus.1` | Replaces the unpatched native buffer-overflow implementation with the reviewed pure-JavaScript [Exodus fork](https://github.com/ExodusForks/bigint-buffer). The published code has no native binding or runtime dependency. Solana u64 encoding, endian conversions and long-buffer behavior are covered by regression tests. |
| MCP + mock | `proxy-addr` → `2.0.8` | Patches CVE-2026-90711. Covers trust matching and Express client-IP resolution in both dependency trees. |
| MCP | `axios@<1` → `0.34.0` | Uses the 0.x security backport required by the legacy Orca graph; inherited form-serialization options are covered by a regression test. |
| MCP | `tmp` → `0.2.7` | Patched release retaining solc's `fileSync` and `removeCallback` APIs. |
| MCP | `toml` → `5.0.1` | Fixes parser resource-consumption advisories. Both Anchor families retain CommonJS `parse`, including Buffer input. Large integers now follow TOML's signed 64-bit bounds; unsafe JavaScript integers need the explicit `bigint` option. |
| MCP | `uuid@<11.1.1` → `11.1.1` | Patched release retaining CommonJS `v4` used by legacy SDKs. Newer ESM-only major versions are not interchangeable. |
| MCP | `jayson` → `5.0.0` | Retains Solana's browser-client API and removes stream-json. TCP/TLS stream frames now require their configured delimiter. |
| MCP / `jito-ts` only | `@solana/web3.js` → direct dependency pin (`1.99.0`) | Removes the legacy Solana private WebSocket imports. Jito/Pyth imports, HTTP RPC, WebSocket subscriptions, bundle serialization and tips have offline regression coverage. |
| Mock | `qs` → `6.16.1` | Fixes hostile comma-array coercion while retaining Express 4/body-parser query APIs. |

The [October high-severity remediation](high-severity-dependencies.md) documents
the newer SDK and additional overrides, regression coverage, and remaining
advisories. The [moderate-severity follow-up](moderate-severity-dependencies.md)
records their resolution and the compatibility limits. The September audit
figures below are historical.

The [low-severity verification](low-severity-dependencies.md) maps the remaining
default-branch alerts to fixes already selected in those PRs and adds targeted
Vite, gRPC and URI regressions without another dependency upgrade.

Vitest is pinned to **4.1.12** in both projects for patched test tooling.
Constructor mocks use function expressions, as required by [Vitest 4](https://v4.vitest.dev/guide/migration#spyon-and-fn-support-constructors).
Review these overrides again when upgrading their parent SDKs; do not blindly
force major-version changes to protocol libraries. Legacy Orca/Metaplex packages
remain deprecated upstream and should be migrated with protocol-specific tests.

## September 2026 advisory assessment (historical)

At review time, a full `npm audit --package-lock-only` reported **3 moderate
package findings for MCP and zero for mock**, with **no high or critical findings**
in either graph. The MCP findings all propagate from one advisory through
`@solana/web3.js → jayson → stream-json`.

[GHSA-528h-pc64-c93x / CVE-2026-71429](https://github.com/advisories/GHSA-528h-pc64-c93x)
affects quadratic path computation in stream-json's pick/ignore/filter/replace
filters. The advisory explicitly excludes StreamValues, StreamArray and
StreamObject. Jayson 4.3.0 imports only StreamValues and Verifier, and no application
code imports the affected filters. Solana's Node bundle uses Jayson's browser
client. This advisory is assessed as **not reachable in the reviewed graph**;
the raw audit still reports it.

The September tests verified StreamValues without filter imports. That narrow
exception is superseded by the October removal of stream-json through Jayson 5;
later advisories also affect its Assembler. The current
[dependency regression tests](../mcp-server/src/__tests__/dependency-security.test.ts)
verify framed JSON-RPC parsing with no stream-json modules loaded. The fix avoids
forcing an ESM-only stream-json major under Jayson's older CommonJS imports.

## September 2026 verification (historical)

Fresh deterministic installs completed with lifecycle scripts disabled. All lockfile
tarball URLs use HTTPS npm registry URLs and include integrity hashes; the Exodus
tarball's hash and executable sources were reviewed. Offline validation with Node
24.19.0 passed **506 MCP tests across 36 files** and **26 mock tests**. The six new
dependency tests cover the replacement APIs and stream-json applicability.

Rerun the audits and [test guide](../TESTING.md) after dependency changes. Audit
results describe known advisories at a point in time; passing tests and integrity
hashes do not attest that all dependency code is free of unknown vulnerabilities.
