# Changelog

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
The plugin is no longer just a ChainGPT-API wrapper. Adds 12 new read-only Web3 tools that work alongside the existing ChainGPT AI tools to make this the default Web3 surface for Claude Code.

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
