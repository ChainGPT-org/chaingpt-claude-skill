# Changelog

## [1.10.0] - 2026-05-19
### Added — Tier 6.5 Solana signing foundation + native/SPL transfer (2 new tools)
Custody-free Solana transaction building lands. The plugin now constructs unsigned `VersionedTransaction`s that the user signs in Phantom / Backpack / Solflare / hardware wallet and submits via their preferred RPC.

- **`mcp-server/src/lib/solana-sign.ts`** — foundation:
  - Public RPC fallback (`api.mainnet-beta.solana.com` → `solana-rpc.publicnode.com` for mainnet; devnet + testnet endpoints for the other networks). Override via `SOLANA_RPC_URL`.
  - `makeConnection(network)` with per-(network,endpoint) cache.
  - `parseAddress(addr, label)` — friendly base58 validation that surfaces the field name in the error.
  - `buildVersionedTransaction({ payer, instructions, connection })` — fetches a fresh blockhash, compiles a v0 message, returns an unsigned tx plus the blockhash + lastValidBlockHeight.
  - `serializeUnsigned` / `deserializeUnsigned` — base64 ser/de of `VersionedTransaction`.
  - SPL instruction builders: `buildSolTransferInstruction`, `buildSplTransferCheckedInstruction` (discriminator 12, always emits mint + decimals so the runtime catches mint-mismatch), `buildCreateAtaIdempotentInstruction` (discriminator 1, safe to always include before a first-time-recipient SPL transfer).
  - `deriveAssociatedTokenAccount(owner, mint, tokenProgramId?)` — canonical ATA PDA for both classic Token and Token-2022.
  - `fetchMintInfo(conn, mint)` — decodes mint decimals + auto-detects Token vs Token-2022 from the account owner.
- **`mcp-server/src/tools/solana.ts`** — tool surface:
  - `chaingpt_solana_build_transfer_tx` — native SOL or SPL token transfer. Decimals auto-fetched from the mint. ATAs auto-derived. Idempotent create-ATA prepended so first-time-recipient transfers work without an extra setup step. `acknowledgeMainnet:true` required on `network=mainnet`.
  - `chaingpt_solana_decode_tx` — decode an unsigned base64 versioned transaction (payer, blockhash, instruction list with program-id annotations for System / SPL Token / Token-2022 / Associated Token / Compute Budget).
- **`mcp-server/src/__tests__/solana.test.ts`** — 29 new vitest cases:
  - Tool surface assertions (exact names, schema validity).
  - "No tool accepts a secret-key-shaped parameter" — belt-and-suspenders custody-free guard that breaks the build if a future addition adds `privateKey` / `mnemonic` / `seedPhrase` to any schema.
  - `parseAddress` happy + error paths.
  - `decimalToBaseUnits` — whole, fractional, zero, over-precision, malformed, non-string.
  - ATA derivation determinism + Token-vs-Token-2022 divergence.
  - Instruction-builder layout assertions (discriminators, account ordering, writable/signer flags, amount + decimals byte positions).
  - `buildVersionedTransaction` round-trip — serialize, deserialize, assert structural identity.
  - Mainnet ack gate (refusal text + the explicit checklist).
  - Devnet happy path with mocked `Connection.getLatestBlockhash`.
  - Decode tool: full annotated output, error on garbage base64, error on missing arg.
  - Unknown tool name returns the friendly error path.
- **`skills/solana/SKILL.md`** — new sub-skill documenting the surface, custody model, mainnet gate, typical flow, why `TransferChecked` over `Transfer`, RPC override knob, and what is deliberately *not* yet implemented (Drift / Marginfi / Kamino signed actions — they reuse this foundation in follow-up PRs).
- **`@solana/web3.js@1.95.4`** added as a runtime dep on `mcp-server`. ~1MB transitive footprint.
- **Version bumped to 1.10.0** across `VERSION`, `.claude-plugin/plugin.json`, `mcp-server/package.json`, `mcp-server/src/index.ts` Server() literal, and the README badge.

Why this PR is foundational rather than full Drift/Marginfi/Kamino signing: each of those protocols needs careful per-instruction encoding (Anchor IDLs, oracle pubkeys, PDA derivation, market accounts). Doing all three at once in one autonomous PR is too much surface to land safely. The transfer tool exercises the entire pipeline (RPC, blockhash, instruction encoding, v0 message, base64 ser/de) end-to-end, and per-protocol signed actions can be layered on top in subsequent PRs without changing the foundation.

## [Unreleased] - 2026-05-19
### Added — Tier 7 ERC-4337 v0.7 account-abstraction foundation (4 new tools)
Custody-free shared primitives for every v0.7 smart-contract wallet. The plugin never sees an owner key or session key; it computes the userOpHash the signer signs and proxies read-only bundler-RPC calls. Provider-specific session-key issuance (Safe / Kernel / Biconomy / Alchemy SW) is queued as follow-up PRs that layer on this foundation.

- **`mcp-server/src/lib/erc4337.ts`** — primitives built on viem v2.49's audited `viem/account-abstraction` module:
  - `normalizeUserOp` — accepts user-friendly string inputs (decimal or 0x-hex), converts to bigint with per-field error labels, validates factory+factoryData and paymaster gas-limit pairing.
  - `computeUserOpHash` — v0.7 hash = keccak256(keccak256(abi.encode(packedFields)) ++ entryPoint ++ chainId). The bytes a signer signs.
  - `packUserOp` — converts to the on-the-wire `PackedUserOperation` struct (gas limits + fees packed into bytes32).
  - `userOpToBundlerJson` — bigint-safe conversion to the bundler-RPC JSON shape (uint256 → 0x-hex).
  - `bundlerRpc` — thin POST wrapper for `eth_estimateUserOperationGas` / `eth_getUserOperationReceipt` / `eth_supportedEntryPoints` against any v0.7 bundler URL (Pimlico, Alchemy, Stackup, Particle).
  - Canonical EntryPoint addresses exported for v0.7 and v0.6.
- **`mcp-server/src/tools/aa.ts`** — 4 tools:
  - `chaingpt_aa_userop_hash` — compute the hash the signer signs (chainId + EntryPoint contribute to the hash, so cross-chain replay is impossible).
  - `chaingpt_aa_pack_userop` — emit both the EntryPoint-wire `PackedUserOperation` struct and the bundler-RPC JSON shape, with the userOpHash inline. Useful for inspection.
  - `chaingpt_aa_estimate_userop` — POSTs `eth_estimateUserOperationGas` to an admin-supplied bundler URL.
  - `chaingpt_aa_userop_receipt` — POSTs `eth_getUserOperationReceipt`; returns "Not yet bundled" on null result, full receipt JSON otherwise.
- **`mcp-server/src/__tests__/aa.test.ts`** — 30 cases including:
  - Tool surface (exact names, schema validity, descriptions ≥40 chars).
  - **Custody-free invariant test:** walks every input schema and asserts no parameter name matches `/privatekey|ownerkey|sessionkey|mnemonic|seedphrase|signer/`. Catches accidental future additions that would weaken custody.
  - `normalizeUserOp` over decimal/hex, missing fields, invalid sender, non-hex callData, JS-number-as-uint256 (refused for precision), factory+factoryData pairing, paymaster gas-limit pairing.
  - `computeUserOpHash` determinism, sensitivity to chainId, sensitivity to EntryPoint, sensitivity to any input field.
  - `packUserOp` shape — bytes32 packed fields, empty initCode / paymasterAndData when omitted.
  - `userOpToBundlerJson` hex encoding + paymaster-field gating.
  - `chaingpt_aa_estimate_userop` mocked fetch — assertions on POST URL, body envelope, params[0]=userOp, params[1]=EntryPoint, response shape.
  - Bundler-side error surfaced verbatim to the caller.
  - `chaingpt_aa_userop_receipt` mocked null → "Not yet bundled" and mocked receipt → JSON formatting.
- **`skills/aa/SKILL.md`** — new sub-skill documenting the surface, custody invariant, foundation vs per-provider distinction, typical signed-userop flow, why `eth_sendUserOperation` is deliberately not proxied (irreversible step stays in user code), bundler URL conventions, what is deliberately NOT done yet (per-provider session-key issuance, paymaster sponsorship, EIP-7702).

Why this is a "foundation" rather than a full session-key flow: each major SCW provider (Safe + Zodiac, Kernel/ZeroDev, Biconomy, Alchemy SW) has its own validator-module ABI for session keys. Picking one would lock the plugin into a single vendor. Shipping the shared primitives that every v0.7 SCW needs lets provider-specific PRs layer on top without re-engineering the foundation.

### Added — SSE streaming demo + Go/Rust SDK examples
Closes three "Next up" roadmap items in one minimal PR: SSE demo, Go example, Rust example. Each is intentionally self-contained (own README, own deps) so users can copy a single directory out and run it.

- **`examples/sse/`** — Server-Sent Events demo around `GeneralChat.createChatStream(...)`:
  - `server.js` — Express endpoint `GET /sse/chat?q=...` that pipes the chat stream to the browser as SSE. Sends named `token` / `done` / `error` events. 15s `: keep-alive` heartbeat prevents intermediate proxies from idling the connection out. Sets `x-accel-buffering: no` so nginx/CDNs don't buffer.
  - `client.html` — single-file browser EventSource client. Renders tokens as they arrive, closes the connection on `done`, displays errors inline.
  - `README.md` — run instructions + SSE wire-format primer + "why SSE over WebSockets" rationale.
- **`examples/go/`** — stdlib-only Go program calling `POST /news/getNews`:
  - `main.go` — `net/http` + `encoding/json`, single file, no SDK dep. Honors `CHAINGPT_API_BASE` so it can target the mock server.
  - `go.mod` — module declaration (`go 1.21`, zero deps).
  - `README.md` — run + override instructions, link to the gateway docs.
- **`examples/rust/`** — reqwest (blocking, rustls-tls) + serde program calling the same news endpoint:
  - `src/main.rs` — single source file with friendly error reporting and `CHAINGPT_API_BASE` override.
  - `Cargo.toml` — pinned reqwest 0.12 with rustls instead of native-tls so the binary works in Alpine/scratch containers without OpenSSL.
  - `README.md` — run + override instructions, "why blocking", "why rustls" rationale.
- **`scripts/test-all.sh`** — examples layer extended:
  - `find examples/js examples/sse` instead of just `examples/js` (catches the new SSE server).
  - When `go` is on PATH, runs `go vet ./...` under `examples/go/`.
  - When `cargo` is on PATH, runs `cargo check` under `examples/rust/`.
  - Both Go and Rust report `skip` (not `fail`) when the toolchain is absent, so the layer stays green on machines without those compilers.
- **README roadmap** — SSE streaming demo and Multi-language SDK examples (Go, Rust) checked off in the "Next up" section.

## [Unreleased] - 2026-05-19
### Added — Unified test harness (`scripts/test-all.sh` + `TESTING.md`)
- `scripts/test-all.sh` — single orchestrator that runs all six test layers (validate / typecheck / mcp-test / mock-test / examples / live smoke). Supports `--fast` to skip live smoke, `--only <layer>` for a single layer, `--skip-drift` for when `dlob.drift.trade` is in an outage. Summary report with per-layer timing and pass/fail/skip counts.
- `TESTING.md` — full testing guide. Layer-by-layer reference, what each upstream the smoke test hits, how to add tests for a new capability, failure-mode cheat-sheet, the contract that every PR must add tests in the same PR.
- README "Testing" section rewritten to point at `test-all.sh` + `TESTING.md` with a six-layer summary table.
- `CONTRIBUTING.md` Testing Requirements section rewritten — every PR adding a capability must add tests in the same PR.
- `smoke-test.ts` honors `SKIP_DRIFT_SMOKE=1` to skip Drift cases when the public DLOB endpoint is down (it 503s periodically).

### Fixed — Test infrastructure
- `mock-server/src/index.ts` no longer calls `app.listen()` at module load when `process.env.VITEST` is set. Eliminates `EADDRINUSE :3001` noise when running `npm test` while another process holds port 3001.
- `mcp-server/package.json` and `mock-server/package.json` `"build"` scripts now invoke `node ./node_modules/typescript/bin/tsc` directly, sidestepping the rogue transitive `tsc@2.0.4` shim package (pulled in by `@chaingpt/smartcontractgenerator`) that printed "This is not the tsc command you are looking for" and aborted the build.
- New `"smoke"` npm script in `mcp-server`: `npm run smoke` builds + runs the live smoke in one shot.

### Added — Creator Sidekick template (11th project template)
- `templates/creator-sidekick.md` — full-stack template for creator-economy platforms combining 3 ChainGPT products (LLM + NFT + News). Targets the previously-uncovered crypto-native creator vertical (video, podcast, streaming) with tipping coach, script-to-thumbnail pipeline (text + actual PNG), and daily creator brief. Includes documented workarounds for SDK error-handler edge cases and JSON shape drift.
- README updated to reflect 11 project templates (was 10).
- `skills/chaingpt/SKILL.md` template-routing table updated with creator-sidekick request triggers.

### Added — Agent-wallet dashboard polish + custom chains + blue-chip auto-scan + unrestricted mode
Major UX pass on the agent-wallet localhost admin dashboard. The dashboard is now a real wallet UI (MetaMask / Rabby / Trust patterns) instead of a single-column form dump.

**Dashboard rewrite (tabbed):**
- **Assets / Policy / Activity / Settings** tabs (URL-hash-routable: `#policy`, etc.)
- **Assets** tab: address card with copy button + larger QR, balance list for all 10 built-in EVM chains + every custom chain, custom token tracker (paste any ERC-20 — symbol/decimals auto-fetched via `eth_call`), 🔍 scan-blue-chips button, hide-zero toggle persisted to localStorage, 30s auto-refresh while on Assets tab.
- **Policy** tab: kill-switch banner, **9 quick template cards** (one-click apply), form-based editor with chain checkboxes / repeatable address rows / wei-gwei-ether unit dropdown / selector rows / memo toggle / notes, raw JSON editor as power-user fallback.
- **Activity** tab: every `sign_and_send` appended to `activity.jsonl`, surfaced newest-first with explorer links + memo display.
- **Settings** tab: custom-chain registration form, file paths, security checklist.

**New features:**
- **Unrestricted "YOLO" mode** (`policy.unrestricted: true`) — opt-in admin toggle that bypasses every per-tx check. Kill switch still wins (panic button stays functional). Dashboard shows pulsing orange banner + logo dot when active. New **🚨 Unrestricted** template card for one-click apply.
- **Custom EVM chains** — admin can add chains not in the built-in registry (slug, chainId, name, native symbol, RPC URL, optional fallbacks + explorer). Validated server-side: slug format, chainId/slug collision check against built-ins, https URL check. Persisted to `~/.chaingpt-mcp/agent-wallet/custom-chains.json` (0600, atomic write + `.bak`). Merged into chain lookup so the agent can sign on the new chain immediately.
- **Blue-chip token auto-scan** with spam filter — a curated allowlist of major stablecoins, wrapped natives, LSTs, and DeFi blue chips per chain (USDC/USDT/DAI/WETH/WBTC/stETH/wstETH/etc.). Click "🔍 Scan & auto-add blue chips" → server calls `balanceOf(agent)` for each entry, auto-tracks the ones with non-zero balance. Only addresses in the static allowlist are eligible — random meme drops can't pollute the wallet view.
- **Custom token tracker** — paste any ERC-20 contract + chain; symbol + decimals auto-fetched. Friendly error "No contract code at X on Y, or address does not implement ERC-20 decimals()" when the address is wrong.
- **Default policy is now rich/diverse** — first-load default demonstrates every available policy field with example values + inline comments (chain IDs, router addresses, gas presets, selectors). Still fail-closed (killSwitch=true, no allowed addresses).
- **Policy templates expanded to 9** (was 5): Locked down · Read-only explore · DCA bot (Base+OpenOcean) · Yield farmer (Aave+Lido+DEX) · Cross-chain rebalancer (Across+DEX) · Power user · ERC-20 only · **🚨 Unrestricted** · 📋 Show all knobs.

**New API endpoints (all require valid admin session + Origin check):**
- `POST /api/scan-bluechips` — auto-track blue chips with non-zero balance
- `POST /api/chains/add` / `POST /api/chains/remove` / `GET /api/chains`
- `POST /api/tokens/add` / `POST /api/tokens/remove` / `GET /api/tokens`
- `POST /api/policy/template` / `GET /api/templates`
- `GET /api/activity`

**Security fixes / hardening:**
- **`.bak` permission leak fixed** — `copyFileSync` was creating backups with 0644 (world-readable) while the source files were 0600. All three save paths (policy / tracked-tokens / custom-chains) now `chmod 0600` immediately after backup. Test asserts the perms.
- **BigInt-safe wei conversion** in form editor — pure BigInt decimal-to-wei math instead of `Math.floor(Number(x) * 1e9)` which lost precision for big values.
- **Friendlier error for non-ERC-20 token-add** — was leaking "Cannot convert 0x to a BigInt", now returns "No contract code at X on Y".

**New libs:**
- `lib/agent-policy-templates.ts` — 9-template registry
- `lib/agent-tokens.ts` — tracked-token persistence
- `lib/agent-erc20.ts` — minimal `balanceOf` / `decimals` / `symbol` / `name` via `eth_call` (no viem dep)
- `lib/agent-activity.ts` — JSONL activity log
- `lib/agent-custom-chains.ts` — custom EVM chain registry
- `lib/agent-blue-chips.ts` — curated per-chain allowlist of major tokens

**Tests:** 242 → 249 (+7 covering unrestricted mode, custom-chains validation, blue-chip registry sanity, `.bak` perm assertion).

**Threat model preserved:** still no MCP tool can write the policy file, tracked-tokens file, or custom-chains file. The LLM has no HTTP-issuing tool that could reach the localhost dashboard's POST endpoints. The dashboard binds to `127.0.0.1` only.

## [1.9.0] - 2026-05-19
### Added — Tier 5 agent wallet with admin-controlled policy gate (7 new tools)
The agent has its own EOA. The admin sets policies the agent CANNOT bypass — even under prompt injection.

- **Encrypted keystore** at `~/.chaingpt-mcp/agent-wallet/keystore.json`. AES-256-GCM + scrypt (N=2^14) KDF. Passphrase from `CHAINGPT_AGENT_WALLET_PASSPHRASE` env var; agent never sees it. File 0600, dir 0700.
- **Policy file** at `~/.chaingpt-mcp/agent-wallet/policy.json`. Admin edits with a text editor. **No MCP tool writes this file** — that's the defense against prompt-injected "relax your own rules" attacks.
- **Defaults fail-closed:** new policy is `killSwitch: true`. Agent refuses every signing op until admin opts in.
- **Deterministic policy gate** runs on every `chaingpt_agent_wallet_sign_and_send` call: chain whitelist, allow/block address lists, max value, max gas, blocked function selectors, optional memo requirement. Loaded fresh on each call.

Tools:
- `chaingpt_agent_wallet_init` — generate + encrypt + persist (one-shot, refuses overwrite)
- `chaingpt_agent_wallet_address` — public address (for receiving funds, no decryption)
- `chaingpt_agent_wallet_status` — full overview + policy digest + kill-switch state
- `chaingpt_agent_wallet_balances` — multi-chain native-coin balances
- `chaingpt_agent_wallet_policy` — display current policy (read-only)
- `chaingpt_agent_wallet_sign_and_send` — the only fund-moving tool; policy-gated
- `chaingpt_agent_wallet_serve_ui` — local admin **dashboard** on `127.0.0.1:8787` with token-gated login, inline policy editor, and one-click kill switch

**Admin dashboard (localhost only):**
- Admin token rotated on every (re)start, printed in tool output + saved to `.admin-token` (0600). Login required to access the dashboard.
- Session cookie: HttpOnly + SameSite=Strict + 1h sliding TTL.
- Origin + Referer check on every POST (CSRF defense).
- Inline policy JSON editor — server-side validation rejects unknown fields, malformed addresses, non-integer wei. Atomic write to disk with `.bak` backup of the previous version.
- One-click kill switch toggle.
- LLM cannot reach the dashboard: no MCP tool issues HTTP requests, and the policy-write function is imported only by the HTTP handler, not by any agent-facing tool.

New `skills/agent-wallet/SKILL.md` documents the threat model, policy file format, dashboard endpoints, and seven layers of defense.

32 new tests covering keystore round-trip, all policy refusal paths, sign-and-send gate, a hard test that the tool surface contains NO "set policy" or "unlock" or "export key" surface (catches future regressions), policy-JSON schema validation, atomic-save-with-backup, and a full end-to-end HTTP flow: login → edit policy → kill-switch flip → invalid input rejection → CSRF defense → logout.

### Added — Tier 6.5 Solana lending (4 new tools)
Completes the Solana DeFi triad alongside Drift (perps).
- **Marginfi v2** (`chaingpt_defi_marginfi_banks / account`) — list banks with supply/borrow APYs + utilization; user account view with deposits/borrows + health ratio.
- **Kamino** (`chaingpt_defi_kamino_markets / vaults`) — lending markets + vault strategies (Kamino Multiply, automated yield).
- Read-only. Defensive endpoint parsing: tries v2 then falls back to legacy paths; surfaces a friendly error pointing at the official UI when both endpoints fail.

### Added — Strategy plan persistence (4 new tools)
File-backed save/load/list/delete for multi-session strategies.
- `chaingpt_strategy_save_plan / load_plan / list_plans / delete_plan`
- Stored as JSON under `~/.chaingpt-mcp/plans/` (overridable via `$CHAINGPT_PLAN_DIR`).
- Plans stay on the user's machine — no remote upload.
- Filesystem-safe name sanitization prevents path-traversal.
- `delete_plan` requires explicit `confirm: true`.

### Added — Grid backtester (1 new tool)
`chaingpt_backtest_grid` replays a buy/sell ladder against historical CoinGecko prices. Reports buys filled, sells filled, total fees paid, realized P&L from grid spreads, inventory held, and the delta vs buy-and-hold. Catches the "oscillating range = grid wins, trending = B&H wins" intuition empirically.

### Changed — CI split for fast feedback
`.github/workflows/ci.yml` now runs four parallel jobs: `typecheck` (`tsc --noEmit`), `test-mcp` (vitest mcp-server), `test-mock` (vitest mock-server), and `validate` (file/frontmatter checks). Previously these were serial — a vitest failure delayed seeing the validate failure by minutes.

### Added — Tier 6 protocol breadth (~17 new tools)
Plugin grows from "EVM trading + DeFi" into a multi-protocol Web3 toolkit.

- **Cross-chain bridging** (3 tools, `chaingpt_bridge_*`) — Across Protocol v3 across 10 EVM mainnets. `_quote` returns fees + estimated fill time + SpokePool addresses; `_build_deposit_tx` returns the unsigned `depositV3` tx (mainnet-ack gated); `_status` tracks a deposit by origin-chain tx hash. Custody-free.
- **1inch v6 aggregator** (2 tools, `chaingpt_dex_1inch_*`) — key-gated on `ONEINCH_API_KEY` with a friendly setup hint when missing; better routing than OpenOcean on Ethereum + L2 blue-chip pairs.
- **CoW Protocol intent-based swaps** (2 tools, `chaingpt_dex_cow_*`) — MEV-protected for large trades. User signs an EIP-712 order intent (not a tx); CoW solvers settle on-chain via the GPv2 Settlement contract.
- **Pendle yield-strip discovery** (2 tools, `chaingpt_defi_pendle_*`) — list active markets, fixed APY (buy PT), implied APY, YT floating APY, maturity days. Supports ethereum / arbitrum / optimism / bsc / base / mantle.
- **Morpho Blue lending** (3 tools, `chaingpt_defi_morpho_*`) — isolated markets (loan / collateral / LLTV), MetaMorpho curated vaults (Gauntlet, Steakhouse, MEV Capital), user positions with health factor.
- **Drift Solana perps** (5 tools, `chaingpt_drift_*`) — Solana-native Hyperliquid alternative. Markets / orderbook / funding / user account. Read-only; Ed25519 signing deferred.

### Added — Tier 8 multi-protocol portfolio (1 tool)
`chaingpt_portfolio_snapshot` fans out in parallel to Hyperliquid + Polymarket + Morpho + Drift for one user. Returns consolidated cross-venue exposure + uPnL. Per-venue best-effort — a failure on one venue logs a warning line in the output and the other venues still surface.

### Added — Tier 10 live-API smoke CI
- New `.github/workflows/smoke.yml` runs the smoke harness daily at 09:00 UTC + on-demand via `workflow_dispatch`.
- On scheduled-run failure, opens a deduplicated GitHub issue labeled `smoke-failure` / `live-api` so endpoint drift gets caught within 24h.
- Extended `src/smoke-test.ts` with new cases for the tier-6 / tier-8 / blue-chip / plans surface. Total smoke surface: **43 cases** (up from 28 at the start of this release cycle).

### Added — Skills
- `skills/bridge/SKILL.md` — Across cross-chain pipeline (quote → approve → build_deposit → status).
- `skills/drift/SKILL.md` — Drift Solana perps read tools + when-to-use-vs-Hyperliquid guidance.

### Changed
- Routing in `mcp-server/src/index.ts`: `chaingpt_dex_1inch` / `_cow` are matched BEFORE the generic `chaingpt_dex` prefix; `chaingpt_defi_pendle` / `_morpho` matched BEFORE generic `chaingpt_defi`.
- `skills/trade/SKILL.md` now documents 1inch + CoW alternatives alongside the default OpenOcean.
- `skills/defi/SKILL.md` adds Pendle + Morpho discovery flows.
- Plugin to v1.9.0; MCP server to v1.9.0.

### Test count
- Unit tests: 142 → 242 (+100 across 8 new test files: bridge, aggregators, yield, drift, portfolio, solana_lending, plans, agent_wallet).
- Live-API smoke: 28 → 43 cases wired (agent-wallet tests are local-only — no remote endpoints).

## [1.8.0] - 2026-05-19
### Added — Tier 4 agent infrastructure: strategy planners + backtester
The agent layer that composes Tier 1-3 tools into multi-step plans. **Strategy tools return plans, they don't execute** — every step the plan lists is a separate `chaingpt_dex_build_swap_tx` / `chaingpt_hl_place_order_payload` / etc. call with its own mainnet ack gate. Keeps the agent surface reviewable and refusal-safe.

- **5 new tools**:
  - `chaingpt_strategy_dca_plan` — dollar-cost-average schedule (timestamps + sizes)
  - `chaingpt_strategy_grid_plan` — buy + sell limit ladder around a midpoint (HL / PM / DEX variants)
  - `chaingpt_strategy_funding_arb_plan` — Hyperliquid funding-rate carry suggester (side / leverage / hourly+daily carry)
  - `chaingpt_strategy_copy_plan` — mirror a target wallet's recent swaps (with mandatory per-token risk-check)
  - `chaingpt_backtest_dca` — replay DCA against CoinGecko historical data + B&H baseline
- New `skills/strategy/SKILL.md` codifies the execution discipline (plan → user confirms → execute step-by-step, never auto-loop).

### Deferred — ERC-4337 session keys + bounded autonomous mode
Mentioned in the Tier 4 roadmap but intentionally not in this release. Account-abstraction signing + key-revocation flows + spending-limit enforcement need a dedicated security-review pass; bundling them here would dilute review attention. Roadmap stub left in the strategy skill for a follow-up.

### Changed
- Plugin to v1.8.0; MCP server to v1.8.0.

## [1.7.0] - 2026-05-19
### Added — Signed-order placement for Hyperliquid + Polymarket
Closes out the deferred work from 1.6. Both markets can now build signed-order payloads end-to-end. Same custody-free pattern as the rest of the plugin — the plugin builds the EIP-712 typed data; the user's wallet signs externally; a separate `_submit_*` tool broadcasts the signed action.

- **5 new tools (3 Hyperliquid + 2 Polymarket)**:
  - `chaingpt_hl_place_order_payload` — build action + EIP-712 typed data for an HL limit order. Refuses without `acknowledgeMainnet`.
  - `chaingpt_hl_cancel_order_payload` — same for cancels (no ack required — cancels can only remove orders).
  - `chaingpt_hl_submit_signed_action` — POST signed action to HL `/exchange`. Normalizes 0x-hex sigs into `{r,s,v}`.
  - `chaingpt_pm_place_order_payload` — build Polymarket CTF Exchange order on Polygon mainnet (chainId 137). Supports Neg-Risk exchange too. Refuses without ack.
  - `chaingpt_pm_submit_signed_order` — POST signed order to Polymarket CLOB. HMAC-authenticated; requires `POLY_CLOB_API_KEY` / `POLY_CLOB_SECRET` / `POLY_CLOB_PASSPHRASE` env (returns friendly setup hint when unset).
- New helper modules:
  - `lib/hyperliquid-sign.ts` — msgpack-encoded action hash + phantom-Agent typed-data envelope (matches the py-clob-client reference implementation).
  - `lib/polymarket-sign.ts` — order builder with USDC.e ↔ outcome-token amount math, EIP-712 typed-data envelope (CTF + Neg-Risk variants), HMAC headers for CLOB auth.
- Adds `@msgpack/msgpack@^3.1` as runtime dep.

### Fixed — Production readiness pass (from 1.6 smoke tests)
A live-API smoke harness (`src/smoke-test.ts`) was run against every new tool; surfaced and fixed 4 production bugs that mocked unit tests had missed:

- **Jupiter v6 domain** (`quote-api.jup.ag`) no longer resolves — migrated to `lite-api.jup.ag/swap/v1`.
- **OpenOcean v4 now requires `gasPrice`** on every call — added an `eth_gasPrice` prefetch via the chain's public-RPC fallback chain when the user doesn't supply one.
- **Etherscan rejects `YourApiKeyToken` placeholder** — new `lib/etherscan.ts` helper detects the rejection and returns a friendly setup hint (with the get-a-key URL + rate limits) instead of the raw error.
- **Aave health timed out** on viem's default public RPC — switched to a viem `fallback` transport using our chain registry's primary + fallback RPC list.

### Added — Reliability infrastructure
- `publicRpcFallbacks: string[]` on every EVM chain in the registry.
- `rpcEndpoints(slug)` helper returns the ordered list.
- `jsonRpcFallback()` tries each endpoint in turn; used by wallet (native balance), onchain (gas oracle, block info), and dex (gas-price prefetch).
- Primary RPC URLs switched from llamarpc to publicnode.com (more stable).

### Added — Documentation
- `reference/web3-toolkit.md` — Tier 1: wallet / research / risk / on-chain / intel (16 tools)
- `reference/onchain-execution.md` — Tier 2 + 3a + 3d: deploy / DEX / DeFi (17 tools)
- `reference/markets-data.md` — Tier 3b + 3c: Hyperliquid + Polymarket (10 tools + signed-order pattern)
- `examples/js/research-token-and-audit.js` — full research → risk → audit funnel
- `examples/js/dex-swap-preflight.js` — honeypot check + quote + unsigned-tx build
- `examples/python/aave_health_monitor.py` — multi-wallet × multi-chain Aave V3 HF monitor

### Changed
- Plugin to v1.7.0; MCP server to v1.7.0.

## [1.6.0] - 2026-05-18
### Added — Tier 3b + 3c: Hyperliquid + Polymarket read-only data
Live mainnet data for the two highest-volume non-EVM-aggregator markets in crypto. Read-only in this release — signed order placement (Hyperliquid EIP-712 L1 actions; Polymarket CLOB signed orders) is deferred to a follow-up so each signing scheme can get its own dedicated review.

- **6 new Hyperliquid tools**:
  - `chaingpt_hl_markets` / `chaingpt_hl_mids` / `chaingpt_hl_orderbook`
  - `chaingpt_hl_account` (margin / positions / open orders) / `chaingpt_hl_fills` / `chaingpt_hl_funding`
  - All via `POST /info` against the public Hyperliquid API. No key required.
- **4 new Polymarket tools**:
  - `chaingpt_pm_markets` / `chaingpt_pm_market`
  - `chaingpt_pm_orderbook` / `chaingpt_pm_trades`
  - Uses Polymarket Gamma API for market discovery + CLOB API for orderbook and trades.
- New `skills/hyperliquid/SKILL.md` and `skills/polymarket/SKILL.md`. Both clearly flag the read-only scope and outline the custody-free pattern that signed-orders will use in the follow-up.
- Ties Polymarket into ChainGPT's existing PredictFi / Foresight AI surface.

### Changed
- Plugin to v1.6.0; MCP server to v1.6.0.

## [1.5.0] - 2026-05-18
### Added — Tier 3d: MAINNET DeFi protocols
Custody-free DeFi for the three highest-volume primitives. Same mainnet-first design — plugin builds unsigned tx, user signs externally, `acknowledgeMainnet: true` required for state-changing tools.

- **7 new DeFi tools**:
  - `chaingpt_defi_aave_health` — read account health factor + collateral/debt/LTV on Aave V3 (7 chains). 0 ack required.
  - `chaingpt_defi_aave_supply_tx` / `_borrow_tx` / `_repay_tx` / `_withdraw_tx` — Aave V3 position management. Mainnet ack required.
  - `chaingpt_defi_lido_stake_tx` — stake native ETH for stETH on Ethereum mainnet. Mainnet ack required.
  - `chaingpt_defi_eigenlayer_deposit_tx` — restake LSTs (stETH / rETH / cbETH / …) into EigenLayer strategies on Ethereum mainnet. Mainnet ack required.
- Aave V3 supported on: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche.
- New `skills/defi/SKILL.md` codifies the pipelines (supply / borrow / stake / restake) and the mandatory pre-flight: **always check health factor before borrowing or withdrawing**.

### Changed
- Plugin to v1.5.0; MCP server to v1.5.0.

## [1.4.0] - 2026-05-18
### Added — Tier 3a: MAINNET DEX trading
First execution tier. Custody-free pattern preserved (plugin builds unsigned tx, user signs externally). Mainnet swaps default; the build-tx tool refuses without explicit `acknowledgeMainnet: true` acknowledgement.

- **5 new DEX tools**:
  - `chaingpt_dex_quote` — live EVM swap quote via OpenOcean v4 aggregator (no API key)
  - `chaingpt_dex_build_swap_tx` — build unsigned swap tx; refuses mainnet without ack
  - `chaingpt_dex_approve_tx` — ERC-20 approval helper (auto-resolves OpenOcean router)
  - `chaingpt_dex_jupiter_quote` — Solana quote via Jupiter v6
  - `chaingpt_dex_jupiter_build_swap_tx` — Solana serialized swap tx; refuses without ack
- 10 EVM mainnets supported: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll. Plus Solana mainnet.
- New `skills/trade/SKILL.md` codifies the mandatory pre-flight (`chaingpt_risk_token` + `chaingpt_dex_quote` before build-tx) and the refusal protocol for honeypot-flagged tokens.

### Changed
- Plugin to v1.4.0; MCP server to v1.4.0.

## [1.3.0] - 2026-05-18
### Added — Tier 2 expansion: MAINNET-FIRST contract deployment lifecycle

The plugin can now deploy contracts to real EVM mainnets with a mandatory audit-before-deploy gate. **Custody-free**: the plugin builds an unsigned transaction; the user signs externally via MetaMask, Rabby, hardware wallet, ERC-4337 smart account, or WalletConnect.

- **5 new deploy tools**:
  - `chaingpt_deploy_compile` — solc 0.8.x compile, returns bytecode + ABI + warnings
  - `chaingpt_deploy_estimate` — gas + USD-equivalent cost preview on the target network
  - `chaingpt_deploy_build_tx` — build unsigned tx; **refuses mainnet deploy unless `acknowledgeMainnet: true`**
  - `chaingpt_deploy_verify` — submit source to Etherscan v2 (works across all major EVM mainnets + testnets via one endpoint)
  - `chaingpt_deploy_verify_status` — poll verification GUID
- **10 mainnets** + **6 testnets** supported: mainnets default, testnets opt-in.
- New `skills/deploy/SKILL.md` codifies the mandatory pipeline: generate → audit → compile → estimate → confirm → build-tx → user-signs → verify.
- New `mcp-server/src/lib/solc.ts` thin wrapper.
- Adds `viem@^2.49` for chain registry, fee estimation, and tx encoding.

### Mainnet safety design
- `chaingpt_deploy_build_tx` returns a refusal with a 4-step checklist instead of a tx when `network` is a mainnet and `acknowledgeMainnet` is absent.
- 10% safety buffer added to gas-limit estimate.
- The skill enforces that an audit must be surfaced to the user before any mainnet build-tx call.

### Changed
- Plugin to v1.3.0; MCP server to v1.3.0.

## [1.2.0] - 2026-05-18
### Added — Tier 1 expansion: generic Web3 toolkit
The plugin is no longer just a ChainGPT-API wrapper. Adds 16 new read-only Web3 tools that work alongside the existing ChainGPT AI tools to make this the default Web3 surface for Claude Code.

- **Wallet & portfolio (3 tools)** — `chaingpt_wallet_balances`, `chaingpt_wallet_positions`, `chaingpt_wallet_pnl`. Multi-chain via Moralis (optional key) with public-RPC fallback for native balances.
- **Token research (3 tools)** — `chaingpt_research_token`, `chaingpt_research_pairs`, `chaingpt_research_trending`. DexScreener-backed, no key required.
- **Risk & security (4 tools)** — `chaingpt_risk_token` (GoPlus), `chaingpt_risk_honeypot` (Honeypot.is), `chaingpt_risk_address` (GoPlus address risk), `chaingpt_risk_contract_source` (Etherscan v2 verified-source fetch).
- **On-chain analytics (4 tools)** — `chaingpt_onchain_tx`, `chaingpt_onchain_address`, `chaingpt_onchain_gas`, `chaingpt_onchain_block`. Etherscan v2 multichain + RPC fallback.
- **AI-enriched intel (2 tools)** — `chaingpt_intel_token` composes DexScreener + GoPlus + ChainGPT news + AI signals into a single research call. `chaingpt_intel_wallet` portfolio + per-holding risk-rating.
- 11-chain registry: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll, solana.
- Optional env vars (graceful degradation when absent): `MORALIS_API_KEY`, `ETHERSCAN_API_KEY`.
- New `skills/research/` and `skills/security/` skill files for "AI-enriched token research" and "audit before action" workflows.

### Changed
- Plugin description rewritten to reflect dual identity (ChainGPT AI products + generic Web3 toolkit).
- MCP server bumped to v1.2.0; dispatcher updated with new prefixes.

## [1.1.0] - 2026-04-24
### Added
- API response examples in all reference files
- Wallet integration guide
- Product selection decision matrix
- Streaming & rate limiting patterns
- Deployment guides (Vercel, Railway, Docker, AWS Lambda)
- Cost optimization guide
- TypeScript type definitions
- Multi-product composition patterns (5 new)
- Validation scripts
- CONTRIBUTING.md
- MCP server and mock server tests

## [1.0.0] - 2025-01-15
### Added
- Initial release
- 7 product API/SDK references
- 10 project scaffolding templates
- 45+ smart contract patterns
- 3 migration guides
- 4 interactive sub-skills
- MCP server with 12 tools
- Mock server for testing
- 8 working code examples (JS + Python)
