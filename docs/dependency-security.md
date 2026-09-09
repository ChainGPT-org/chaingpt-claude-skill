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

## Overrides and compatibility

| Graph | Override | Reason and verified API |
| --- | --- | --- |
| MCP | `bigint-buffer` → `npm:@exodus/bigint-buffer@1.1.5-exodus.1` | Replaces the unpatched native buffer-overflow implementation with the reviewed pure-JavaScript [Exodus fork](https://github.com/ExodusForks/bigint-buffer). The published code has no native binding or runtime dependency. Solana u64 encoding, endian conversions and long-buffer behavior are covered by regression tests. |
| MCP | `axios@<1` → `0.33.0` | Uses the 0.x security backport required by the legacy Orca graph. |
| MCP | `tmp` → `0.2.7` | Patched release retaining solc's `fileSync` and `removeCallback` APIs. |
| MCP | `toml` → `4.2.0` | Patched release retaining Anchor's CommonJS `parse` API. |
| MCP | `uuid@<11.1.1` → `11.1.1` | Patched release retaining CommonJS `v4` used by Jayson and SDKs. Newer ESM-only major versions are not interchangeable. |
| Mock | `qs` → `6.16.0` | Patched parser used through Express 4/body-parser. |

Vitest is pinned to **4.1.11** in both projects for patched test tooling.
Constructor mocks use function expressions, as required by [Vitest 4](https://v4.vitest.dev/guide/migration#spyon-and-fn-support-constructors).
Review these overrides again when upgrading their parent SDKs; do not blindly
force major-version changes to protocol libraries. Legacy Orca/Metaplex packages
remain deprecated upstream and should be migrated with protocol-specific tests.

## Remaining advisory assessment

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

The [dependency regression tests](../mcp-server/src/__tests__/dependency-security.test.ts)
parse JSON-RPC streams through Jayson and verify that its loaded dependency graph
contains StreamValues but no stream-json filter modules. Reassess the exception
if imports, stream processing or dependency versions change. Stream-json 3.5.0
fixes the advisory but changes to ESM and lowercase exports, incompatible with
Jayson's current CommonJS imports; a forced override is not a compatible fix.

## Verification

Fresh deterministic installs completed with lifecycle scripts disabled. All lockfile
tarball URLs use HTTPS npm registry URLs and include integrity hashes; the Exodus
tarball's hash and executable sources were reviewed. Offline validation with Node
24.19.0 passed **506 MCP tests across 36 files** and **26 mock tests**. The six new
dependency tests cover the replacement APIs and stream-json applicability.

Rerun the audits and [test guide](../TESTING.md) after dependency changes. Audit
results describe known advisories at a point in time; passing tests and integrity
hashes do not attest that all dependency code is free of unknown vulnerabilities.
