# October 2026 moderate-severity dependency follow-up

> Historical standalone-branch validation. For the merged graph and current integration results,
> see [dependency security notes](dependency-security.md#combined-october-integration).

This change builds on [PR #111](https://github.com/ChainGPT-org/chaingpt-claude-skill/pull/111).
Seven upstream packages account for the remaining nine MCP and six mock moderate
package findings, including parent findings propagated through the same package.
Fresh lockfile audits report zero moderate and zero high findings in both graphs.
The critical `proxy-addr` fix remains separately tracked in
[PR #110](https://github.com/ChainGPT-org/chaingpt-claude-skill/pull/110); one critical
package finding remains in each graph on this branch until that fix is combined.

## Changes and regression coverage

| Package | Resolution | Tested boundary |
| --- | --- | --- |
| `@hono/node-server` | `1.19.17` → `2.1.3` override | [Static middleware double decoding](https://github.com/advisories/GHSA-rmxm-3fg6-px4f). A malformed path cannot skip prefix authentication and then decode into a protected file. Ordinary public files and encoded spaces still work. |
| `hono` | `4.13.7` → `4.13.11` override | [The same core static-middleware boundary](https://github.com/advisories/GHSA-5r4p-p66f-jhc7), tested independently from the Node adapter. |
| `fast-uri` | `3.1.7` → `3.1.9` override | [Host case](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [encoded schemes](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), and [host confusion](https://github.com/advisories/GHSA-wjr9-j795-jxcr). Tests cover percent-encoded host case, malformed schemes/authorities, relative-reference equivalence and valid Ajv schema resolution. |
| `ip-address` | `10.7.0` → `10.7.4` override | [Cross-family subnet matching](https://github.com/advisories/GHSA-j6r3-76f7-8jcv), [unbounded diagnostics](https://github.com/advisories/GHSA-h3mg-xc3c-68pw), and [zone regex cost](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5). Valid same-family membership and scoped IPv6 remain supported. The hostile zone case runs in a child with a 128 MiB heap cap and 1.5-second deadline. |
| `vitest` and its matching internal packages | Direct pin `4.1.12` in both servers | [`@vitest/mocker` source injection](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and [backslash traversal](https://github.com/advisories/GHSA-xp26-3454-mjgp). Generated modules preserve hostile URL/export metadata as data; redirect registration rejects slash and backslash escapes while accepting an allowed path. |
| `qs` | Mock override `6.16.0` → `6.16.1` | [Comma-array coercion](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw). Hostile own `toString` values do not crash either encoding path; ordinary serialization and parsing remain compatible. This clears propagated Express/body-parser/superagent findings. MCP already uses this version. |
| `jayson` | `4.3.0` → `5.0.0` override | Removes stream-json and stream-chain entirely, including [Assembler prototype mutation](https://github.com/advisories/GHSA-mjw6-4jj6-33hc), [JSONC rescanning](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x), and [path-filter complexity](https://github.com/advisories/GHSA-528h-pc64-c93x). Tests cover own `__proto__` data, split UTF-8, revivers, malformed/unterminated frames, Solana RPC and the browser-client API. |

Vitest remains on the patched 4.x line. Existing Vite, Rolldown/native bindings,
PostCSS, Chai and other unrelated build-tool resolutions stay at their reviewed
base versions. The lockfiles remove stream-json's unused dependency chain rather
than aliasing incompatible exports or suppressing advisory results.

## Compatibility and applicability

Jayson 5 and the Hono Node adapter require Node.js 20, within this project's
existing Node.js 22.14+ requirement. The MCP SDK pin from PR #111 explicitly
permits the 2.x Hono adapter. Jayson is a major override across legacy parent
ranges; keep the Solana compatibility tests when revisiting it.

Solana's browser-client path remains compatible. Tests make fixture-only
`Connection.getVersion()` calls through the root and Marginfi Solana copies and
exercise the browser client resolved by Jito's legacy Solana copy. A full import
of that legacy Jito Solana copy fails on an existing `rpc-websockets` private
export mismatch, also reproduced with Jayson 4.3.0. That unrelated compatibility
issue remains; the browser-client test does not establish full Jito support.

Jayson 5's generic stream parser now requires delimiter-terminated frames
(newline by default), including the final frame. Callers relying on undelimited
JSON streaming must add the delimiter or stay outside that API. Solana's HTTP
browser client does not use this stream parser. Truncated frames now produce one
error instead of silently accepting a partial framing contract.
The generic decoder buffers incomplete frames; any future TCP/TLS server using
it also needs frame-size and read-time limits before accepting untrusted peers.

Hono's static middleware rejects remaining percent signs by default, preventing
a second decode from selecting a different protected path. Reassess routing and
authentication before opting into `allowPercentInPath`. Fast-uri still reports
malformed inputs with `parse().error`; `normalize()` preserves such input rather
than turning it into an active scheme. Callers must check the error field.

The shipped server remains stdio. Its wallet/dashboard listeners use `node:http`,
not Hono static middleware or Express rate-limit. The mock app does not explicitly
use comma-format query serialization. Vitest runs in CLI mode; it does not expose
a browser mock-registration server here. The tests deliberately exercise these
dependency boundaries without enabling those services in the application.

The mocker traversal test exercises cross-platform path normalization and registry
rejection on macOS, not a complete Windows filesystem/browser exploit. No real
credentials, production endpoints or deployed services are involved.

## Verification procedure

Install deterministically with lifecycle scripts disabled:

```bash
npm ci --prefix mcp-server --ignore-scripts
npm ci --prefix mock-server --ignore-scripts
```

The targeted metadata review assessed the seven selected releases; it is not an
audit of every transitive publisher or CI configuration. Changed tarballs were
checked against registry SHA512 metadata. In particular, ip-address publishes a
`prepare` hook that changes Git hook configuration; installation disables it along
with all other lifecycle hooks. No hook configuration change is required.

Run both complete test suites, both TypeScript checks, the committed-build check,
repository validation and the stdio boot smoke. Negative controls use
registry-verified older releases in the same bounded OS sandbox, then restore the
patched files and rerun validation. GitHub Actions remains disabled under the
incident hold. No live API smoke or deployment is part of this change.

Local verification on Node.js 26.9.0 passed **566 MCP tests and 45 mock tests**,
including **33 new regression tests**. Both TypeScript checks passed, the build
reproduced all 71 committed MCP files byte for byte, and boot smoke returned 155
unique tools. Older releases fail the targeted boundary tests; restored patched
package copies match the reviewed archives and pass again. All execution used
isolated state, fixture credentials, blocked external networking and bounded
resources.

The existing validator intermittently reported valid frontmatter keys as missing
on macOS: `grep -q` exited early, giving its `echo` producer SIGPIPE under
`pipefail`. This branch reuses the four native Bash field checks already included
in PR #109, preserving the required-field checks without that pipeline. The
original run reported nine false failures; validation with the fix passes all
179 checks, with the existing internal mock-version warning.
