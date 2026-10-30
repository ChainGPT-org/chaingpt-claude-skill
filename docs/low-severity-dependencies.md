# October 2026 low-severity dependency verification

> Historical standalone-branch validation. For the merged graph and current integration results,
> see [dependency security notes](dependency-security.md#combined-october-integration).

The two open low-severity Dependabot alerts, **#156 (mock)** and **#157 (MCP)**,
identify the same Vite advisory:
[CVE-2026-112945 / GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw).
The existing **Vite 8.2.4** pin in PR #111 already fixes it in both graphs.
This follow-up builds on [PR #112](https://github.com/ChainGPT-org/chaingpt-claude-skill/pull/112)
and adds behavioral coverage without changing manifests or lockfiles.

Fresh audits of this prepared stack report **zero low, moderate or high package
findings** in both graphs. Default-branch alerts remain open until the fixing
dependency PRs are merged and rescanned. The independent critical `proxy-addr`
fix is still tracked in [PR #110](https://github.com/ChainGPT-org/chaingpt-claude-skill/pull/110);
that one critical package finding per graph remains on this branch.

## Regression coverage

The tests exercise the previously selected fixes, including low advisories that
were grouped under a higher package severity in earlier npm audit output:

| Dependency | Fixed version already selected | Behavioral check |
| --- | --- | --- |
| Vite, both graphs | `8.2.4` in PR #111 | Invoke the public `transformIndexHtml` API in custom middleware mode against synthetic HTML with an inline module. Request URLs containing an off-origin prefix and query-only `..` components must not produce off-origin script URLs. Ordinary index-page transforms remain functional. |
| `@grpc/grpc-js`, MCP | `1.14.5` in PR #111 | [Unexpected handler error disclosure](https://github.com/advisories/GHSA-f596-whhp-79r4) is tested over fixture-only loopback RPCs for unary, server-streaming, client-streaming and bidirectional methods. Unexpected exception details stay private, while a deliberate application error retains its public code and message. |
| `fast-uri`, MCP | `3.1.9` in PR #112 | [Suffix-reference scheme injection](https://github.com/advisories/GHSA-333x-w4r6-6crp) is covered for dangerous and ordinary colon-bearing paths. Serialization cannot activate a URI scheme or change the resolved origin. Existing PR #112 tests already cover the related relative-path equivalence advisory. |

The suffix tests specify a known synthetic `scheme` with `reference: 'suffix'`,
selecting path/suffix parsing instead of suffix-as-authority parsing. This option
does not turn normalization into validation: malformed inputs can be preserved,
and callers must reject `parse().error` before using a URL for security decisions.

gRPC redaction is the default behavior. An explicit
`GRPC_NODE_DEBUG_SEND_ERROR_DETAILS` debug setting can intentionally expose error
details; keep it unset on servers handling untrusted clients. The tests isolate
their environment and verify the default, plus an explicit public error control.

## Applicability and validation limits

Vite is development-only tooling here, used by Vitest. Application source does
not embed a Vite custom HTML middleware server or a gRPC service. The fixtures
deliberately exercise those dependency APIs without enabling either in the
application. The Vite test verifies the generated module URL boundary using the
same URL resolution semantics a browser applies; it does not launch a browser or
fetch an attacker script. No production data, credentials or endpoints are used.

Negative controls load registry-verified Vite 8.2.2 in each graph, grpc-js 1.14.4,
and fast-uri 3.1.7. The vulnerable behavior fails the corresponding tests; patched
files are restored before the full suites run. All target code runs with isolated
state, blocked external networking, loopback-only fixture traffic and bounded
resources. No dependencies or installation hooks are added by this PR.

The full suites pass **577 MCP tests and 48 mock tests**, including **14 new
regression tests**. Both TypeScript checks pass, the MCP build reproduces all 71
committed output files byte for byte, boot smoke returns 155 unique tools, and
all 179 repository validation checks pass with the existing mock-version warning.

GitHub Actions remains disabled under the incident hold. Merge PR #111 before
PR #112 and this follow-up, then rescan the combined result with PR #110. Local
test results do not constitute a release or deployment approval.
