# Changelog

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
