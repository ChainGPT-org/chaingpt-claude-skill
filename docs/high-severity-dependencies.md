# October 2026 high-severity dependency remediation

The review traced the high-severity audit findings to nine upstream packages.
Most of the affected MCP parent packages inherit the same TOML findings through
Anchor; replacing the parser removes those propagated findings without changing
the Kamino, Marginfi, Orca or Switchboard SDK versions.

## Changes and applicability

| Package | Resolution | Boundary and regression coverage |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | Direct pin `1.29.0` → `1.32.2` | [OAuth issuer binding](https://github.com/advisories/GHSA-6qxp-vccf-f47h), [task session isolation](https://github.com/advisories/GHSA-22jm-h49p-29qw), [validation resource limits](https://github.com/advisories/GHSA-46jr-4wx8-v453), and [HTTP body/batch limits](https://github.com/advisories/GHSA-f897-62hf-6gxq). Tests cover credentials bound to another issuer, task read/list/update/result isolation, an explicit tool-element budget, oversized bodies and batches. |
| `axios` | Legacy 0.x override `0.33.0` → `0.34.0` | [Inherited form-serializer options](https://github.com/advisories/GHSA-x97p-jq2g-jp4f). The Orca dependency path ignores an inherited visitor and still serializes nested fields. The existing 1.x resolution remains `1.20.0`. |
| `follow-redirects` | Override `1.16.1` | [Array headers](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8) and [custom header regex escaping](https://github.com/advisories/GHSA-8r9p-f939-6h3c). Loopback fixtures verify removal of built-in credentials and custom names containing `^` or `\|` on cross-origin redirects, for object and array header containers. |
| `toml` | Override `4.2.0` → `5.0.1` | [Array-of-tables](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p), [dotted paths](https://github.com/advisories/GHSA-9j65-hcg3-gc64), and [integer literal](https://github.com/advisories/GHSA-9qmh-m7c6-f92p) resource consumption. Tests exercise bounded stress fixtures, reject oversized integers, and parse Anchor-style configuration through both Anchor families. |
| `@grpc/grpc-js` | Override `1.14.5` | [Unauthorized certificates in `getAuthContext`](https://github.com/advisories/GHSA-m9gg-hp2v-232j). Tests verify unauthorized TLS sockets expose no authentication context and authorized sockets retain their certificate. The application does not configure a gRPC server or use this context for authentication. |
| `body-parser` | MCP 2.x override `2.4.0`; mock 1.x override `1.20.9` | [Late decompressor errors](https://github.com/advisories/GHSA-27r3-jxmh-p828). Child-process fixtures exercise Express 4 and 5 with gzip/deflate frames followed by trailing bytes, then verify that the server handles a health request. The mock app's global JSON middleware makes this path relevant before route authentication. |
| `zod` | Override all copies to `4.6.6` | [Oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Tests verify `.max()` rejects an oversized array before visiting its elements, through both the application and Switchboard resolution paths. Valid oracle jobs/feeds still normalize and serialize through protobuf; invalid empty inputs remain rejected. |
| `source-map-js` | Override `1.2.2` in both graphs | [Indexed source-map offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Tests reject invalid/oversized offsets and nested cumulative offsets at construction, while preserving valid mapping and source rendering. |
| `vite` | Override `8.2.4` in both graphs | [Bundled editor-launcher Windows path bypass](https://github.com/advisories/GHSA-587h-7wmj-h5pm). Lockfile regression guards cover every resolved Vite copy; both full Vitest suites exercise compatibility. The Windows exploit was not executed on the macOS test host. Vite is development tooling, not a production HTTP entry point here. |

The parser update also requires `iconv-lite` 0.7.3 and `qs` 6.16.1 in the MCP
graph. The latter is pinned explicitly. Both Express major versions stay at
their existing pins. The Switchboard prerelease Zod copy and its obsolete
`@zod/core` dependency are removed; all Zod consumers use the reviewed stable
release. This is an override across a prerelease range, so the oracle round-trip
tests are required when revisiting it.

TOML 5 is a major upgrade with a Node.js 20 minimum, within this repository's
existing Node.js 22.14+ requirement. Its default parse result keeps ordinary
configuration numbers as JavaScript numbers, and rejects values that cannot be
represented safely unless the caller explicitly opts into BigInt. No application
source parses protocol balances or transaction values through TOML.

## MCP configuration limits

The shipped entry point uses the low-level SDK `Server` with
`StdioServerTransport`. Its wallet/dashboard listeners use `node:http`. Source
inspection found no SDK HTTP transport, OAuth client/provider, or task store in
application code; those SDK advisory conditions are not enabled here.

Upgrading alone does not enable every SDK protection. Before introducing an HTTP
MCP endpoint, set a request-body limit appropriate to its tools, configure
`maxToolInputElements` on a high-level `McpServer`, and enforce equivalent limits
if retaining low-level handlers. A parsed-body HTTP adapter must enforce its own
parser limit. The SDK tests demonstrate the element guard with an explicit budget;
the option is disabled by default. Unconstrained Zod collections also still need
application limits; upgrading does not invent a `.max()` bound.

Before adding an OAuth client, bind configured credentials and persisted tokens
to their trusted issuer, preserve that field when saving, and clear or migrate
credentials saved without it. Bundled providers need an explicit trusted
`expectedIssuer`. Experimental tasks remain unused and deprecated; the session
fixture tests the patched store without enabling it in the application.

## Validation and remaining scope

The targeted metadata review assessed the nine selected patched releases, rather
than all publisher/CI properties in the repository's transitive graph. Changed
tarballs, including the Express 4 parser backport and required parser dependencies,
were checked against registry SHA512 integrity values. Fresh deterministic
installs used `npm ci --ignore-scripts`; no package lifecycle installation scripts
ran.

Local checks used Node.js 26.9.0 with fixture credentials, isolated state, blocked
external networking and bounded execution. The full suites passed **540 MCP
tests** and **38 mock tests**, including **46 new tests**. Both TypeScript checks
passed, the build reproduced all 71 committed MCP files byte for byte, and the
stdio boot smoke returned 155 unique tools. Stress cases run only
in child processes with a 128 MiB V8 heap cap, a three-second deadline and small
fixtures. Compressed-body tests have separate process/deadline bounds. Negative
controls using registry-verified older releases fail the corresponding behavioral
checks; the old gzip parser cases terminate with an uncaught `Z_DATA_ERROR`.
Restored patched files match the reviewed tarballs and pass the tests again.

Fresh `npm audit --package-lock-only` results contain **zero high findings** in
both graphs. The MCP graph retains nine moderate package findings; mock retains
six moderate package findings. Both still resolve the critical `proxy-addr`
finding on this independently based branch: its remediation is tracked separately
in [PR #110](https://github.com/ChainGPT-org/chaingpt-claude-skill/pull/110).
These are package findings, including propagated parent findings, not counts of
independent vulnerabilities. Re-run the audits after merging both changes.

GitHub Actions remains disabled under the incident hold. Local validation does
not constitute a release or deployment approval, and no live API smoke ran.
