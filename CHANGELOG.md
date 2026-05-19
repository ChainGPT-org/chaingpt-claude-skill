# Changelog

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
