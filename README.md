<div align="center">

<img src="https://raw.githubusercontent.com/ChainGPT-org/chaingpt-claude-skill/refs/heads/main/653ba24987df35fe63c92a17_chaingpt-logo-head.png" alt="ChainGPT" width="140" />

# ChainGPT Developer Kit for Claude Code

**The only Claude Code skill that turns your AI assistant into a Web3 engineering co-pilot.**

Full API reference. **66 MCP tools** (18 ChainGPT-AI + 16 generic Web3 + 5 mainnet deploy + 5 mainnet DEX + 7 mainnet DeFi + 9 Hyperliquid + 6 Polymarket). 45+ Solidity patterns. 10 project templates. Zero context-switching.

[![npm version](https://img.shields.io/badge/version-1.7.0-blue?style=flat-square)](https://github.com/ChainGPT-org/chaingpt-claude-skill/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-79_passing-brightgreen?style=flat-square)](#testing)
[![Claude Code](https://img.shields.io/badge/Claude_Code-skill-blueviolet?style=flat-square)](https://code.claude.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange?style=flat-square)](CONTRIBUTING.md)

[Get Started](#-quickstart) · [Features](#-what-you-get) · [MCP Server](#-mcp-server--12-tools) · [Templates](#-10-project-templates) · [Docs](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk)

</div>

---

<br/>

## The Problem

Building with Web3 AI APIs means constantly switching between docs, SDKs, and Stack Overflow. You paste an endpoint, get the params wrong, burn credits debugging, and repeat.

**This skill fixes that.** Install it once and Claude already knows every ChainGPT endpoint, parameter, credit cost, and best practice — so you just describe what you want built.

<br/>

## Demo

```
You:  "Generate an NFT of a cyberpunk samurai and mint it on Polygon"

Claude: I'll use the ChainGPT NFT Generator to create your image and mint it on-chain.

       1. Generating image with VisionaryForge model... ✓
       2. Queuing for on-chain minting on Polygon (chainId: 137)... ✓
       3. Polling for completion... ✓

       ✅ NFT minted successfully!
       Collection ID: cgpt-a8f3...
       Token URI: ipfs://QmX7k...
       View on PolygonScan →

       Cost: 2 credits ($0.02)
```

No docs. No boilerplate. Just results.

<br/>

## ⚡ Quickstart

**One command. That's it.**

**Claude Code (plugin install):**
```
/plugin install ChainGPT-org/chaingpt-claude-skill
```

**Manual install (git clone):**
```bash
git clone https://github.com/ChainGPT-org/chaingpt-claude-skill .claude/skills/chaingpt
```

> [!TIP]
> For user-level install (all projects): clone to `~/.claude/skills/chaingpt` instead.

Now open Claude Code and ask it anything about ChainGPT — it just works.

<br/>

## 🧰 What You Get

<table>
<tr>
<td width="50%" valign="top">

### 📖 Complete API Reference
Every endpoint, parameter, and response format for all **7 products** — with real API response examples, credit costs, and SDK snippets in JS + Python.

### 🤖 61 MCP Tools
Claude doesn't just _write_ code — it **calls every major Web3 surface directly**. Generate images, mint NFTs, audit contracts, fetch news, scan wallets across 11 chains, run rug checks, decode transactions, deploy contracts to mainnet with the audit-before-deploy gate, swap tokens via OpenOcean + Jupiter, lend on Aave V3, stake on Lido, restake on EigenLayer, read Hyperliquid perp positions + funding rates, AND track Polymarket prediction-market odds — all custody-free, all from the chat.

### 📋 10 Project Templates
Production-ready scaffolds for Next.js, React Native, Express, Nuxt, and more. Multi-product compositions included.

</td>
<td width="50%" valign="top">

### 🔐 45+ Solidity Patterns
Audited, battle-tested smart contract patterns Claude composes from — ERC-20 variants, NFTs, DeFi, governance, security.

### 🧪 79 Passing Tests
53 MCP server unit tests + 26 mock server endpoint tests. CI-ready out of the box.

### 🛠️ Developer Tools
Interactive playground, debug assistant, hackathon scaffolder, cost estimator, and migration guides from OpenAI/Alchemy.

</td>
</tr>
</table>

<br/>

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                              │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │   SKILL.md   │  │  Reference   │  │    Templates &     │    │
│  │  Entry Point  │  │  16 docs     │  │    Patterns (56)   │    │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘    │
│         │                 │                    │                │
│         └────────┬────────┴────────────────────┘                │
│                  ▼                                              │
│         ┌────────────────┐         ┌──────────────────┐        │
│         │   MCP Server   │────────▶│  ChainGPT APIs   │        │
│         │   12 tools     │         │  api.chaingpt.org │        │
│         └────────────────┘         └──────────────────┘        │
│                  │                                              │
│                  ▼                                              │
│         ┌────────────────┐                                     │
│         │  Mock Server   │  ← Zero-credit local testing        │
│         │  localhost:3001│                                      │
│         └────────────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
```

<br/>

## 📦 Products Covered

| Product | What It Does | Cost |
|---------|-------------|------|
| **Web3 AI Chatbot & LLM** | Crypto-native LLM with live on-chain data, Nansen Smart Money, 33+ chains | 0.5 credits |
| **AI NFT Generator** | Text-to-image + on-chain minting across 22+ chains, 4 AI models | 1–14.25 credits |
| **Smart Contract Generator** | Natural language → production Solidity contracts | 1 credit |
| **Smart Contract Auditor** | AI vulnerability detection with scored audit reports | 1 credit |
| **AI Crypto News** | Real-time AI-curated news, 24 categories, RSS feeds | 0.1 credits |
| **AgenticOS** | Open-source autonomous X/Twitter AI agents | 1 credit/tweet |
| **Solidity LLM** | Open-source 2B-param model for Solidity code generation | Free |

Plus **SaaS & Whitelabel** references — Launchpad, Staking, Vesting, Telegram bots.

> 1 credit = $0.01 USD · 15% bonus when paying with $CGPT

<br/>

## 🔌 MCP Server — 66 Tools

The MCP server gives Claude **direct API and on-chain access** — not just code generation.

### ChainGPT AI products (18 tools)

| Tool | What It Does |
|------|-------------|
| `chaingpt_chat` | Ask the Web3 AI chatbot anything |
| `chaingpt_chat_with_context` | Chat with custom company/token context injection |
| `chaingpt_chat_history` | Retrieve past conversations |
| `chaingpt_nft_generate_image` | Generate AI art from text prompts |
| `chaingpt_nft_enhance_prompt` | AI-improve prompts for better results |
| `chaingpt_nft_generate_and_mint` | Full pipeline: generate → queue → poll → mint |
| `chaingpt_nft_get_chains` | List supported blockchains for minting |
| `chaingpt_audit_contract` | Run an AI security audit on Solidity code |
| `chaingpt_generate_contract` | Generate smart contracts from descriptions |
| `chaingpt_news_fetch` | Fetch crypto news with category filtering |
| `chaingpt_news_categories` | List available news categories |
| `chaingpt_estimate_credits` / `chaingpt_check_balance` | Cost + balance utilities |

### Generic Web3 toolkit (16 tools — new in 1.2)

Broken into 4 utility groups (14 tools) plus 2 AI-enriched composed tools.

Works across **11 chains**: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll, solana.

| Tool | What It Does | Backend |
|------|-------------|---------|
| `chaingpt_wallet_balances` | Multi-chain wallet native + ERC-20 balances | Moralis (opt) + public RPC |
| `chaingpt_wallet_positions` | DeFi positions (Aave / Uniswap / Lido / etc.) | Moralis |
| `chaingpt_wallet_pnl` | Realized + unrealized profit/loss | Moralis |
| `chaingpt_research_token` | Live price, liquidity, volume, market cap | DexScreener |
| `chaingpt_research_pairs` | All trading pairs for a token | DexScreener |
| `chaingpt_research_trending` | Trending tokens across chains | DexScreener |
| `chaingpt_risk_token` | Honeypot / mintable / proxy / tax flags | GoPlus |
| `chaingpt_risk_honeypot` | Buy + sell simulation | Honeypot.is |
| `chaingpt_risk_address` | Sanctions / phishing / mixer check | GoPlus |
| `chaingpt_risk_contract_source` | Fetch verified source code + ABI | Etherscan v2 |
| `chaingpt_onchain_tx` | Decode any transaction by hash | Etherscan v2 |
| `chaingpt_onchain_address` | Recent activity for any address | Etherscan v2 |
| `chaingpt_onchain_gas` | Multi-chain gas oracle | Etherscan v2 + RPC |
| `chaingpt_onchain_block` | Block info by number or "latest" | Public RPC |

### AI-enriched composed tools (the strategic differentiator)

| Tool | What It Does |
|------|-------------|
| `chaingpt_intel_token` | One call → DexScreener + GoPlus + ChainGPT news + AI signal. The recommended "research this token" tool. Costs ~1 ChainGPT credit. |
| `chaingpt_intel_wallet` | Portfolio + per-holding risk-rating across chains. Free read. |

### Mainnet contract deployment (5 tools — new in 1.3)

Custody-free pipeline. The plugin builds an unsigned tx; the user signs externally (MetaMask / Rabby / hardware wallet / ERC-4337 smart account / WalletConnect). MAINNET is the default; testnet is an opt-in via the `network` parameter.

| Tool | What It Does |
|------|-------------|
| `chaingpt_deploy_compile` | Compile Solidity 0.8.x → bytecode + ABI + warnings |
| `chaingpt_deploy_estimate` | Preview gas cost on the target mainnet (or testnet) |
| `chaingpt_deploy_build_tx` | Build the unsigned deployment tx. **Refuses mainnet without `acknowledgeMainnet: true`** |
| `chaingpt_deploy_verify` | Submit source to Etherscan v2 (works across all major EVM chains) |
| `chaingpt_deploy_verify_status` | Poll verification GUID |

**Mainnets** (default): ethereum · base · arbitrum · optimism · polygon · bsc · avalanche · blast · linea · scroll.
**Testnets** (opt-in): sepolia · base-sepolia · arbitrum-sepolia · optimism-sepolia · polygon-amoy · bsc-testnet.

The `chaingpt-deploy` skill enforces the mandatory pipeline: **generate → audit → compile → estimate → confirm → build-tx → user-signs → verify**. Never bypass the audit step on mainnet.

### Mainnet DEX trading (5 tools — new in 1.4)

Custody-free. Plugin builds the unsigned swap tx; user signs externally. Same `acknowledgeMainnet` safety pattern as deploy.

| Tool | What It Does | Backend |
|------|-------------|---------|
| `chaingpt_dex_quote` | Live EVM swap quote (price, impact, route) | OpenOcean v4 |
| `chaingpt_dex_build_swap_tx` | Build unsigned EVM swap. **Mainnet ack required** | OpenOcean v4 |
| `chaingpt_dex_approve_tx` | ERC-20 approval helper (auto-resolves router) | viem encode |
| `chaingpt_dex_jupiter_quote` | Live Solana swap quote | Jupiter v6 |
| `chaingpt_dex_jupiter_build_swap_tx` | Serialized Solana swap tx (base64). **Mainnet ack required** | Jupiter v6 |

EVM chains: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll. Plus Solana mainnet. The `chaingpt-trade` skill codifies the mandatory pre-flight: **`chaingpt_risk_token` on the buy token + `chaingpt_dex_quote` BEFORE `chaingpt_dex_build_swap_tx`**.

### Mainnet DeFi protocols (7 tools — new in 1.5)

Custody-free. Same `acknowledgeMainnet` safety pattern. The `chaingpt-defi` skill enforces a mandatory `chaingpt_defi_aave_health` check before any borrow / withdraw.

| Tool | What It Does |
|------|-------------|
| `chaingpt_defi_aave_health` | Read account health factor, collateral, debt, LTV — Aave V3, 7 chains |
| `chaingpt_defi_aave_supply_tx` | Build supply tx (lend) — Aave V3 |
| `chaingpt_defi_aave_borrow_tx` | Build borrow tx — Aave V3 |
| `chaingpt_defi_aave_repay_tx` | Build repay tx (incl. `max` for full repayment) — Aave V3 |
| `chaingpt_defi_aave_withdraw_tx` | Build withdraw tx — Aave V3 |
| `chaingpt_defi_lido_stake_tx` | Stake native ETH → stETH on Lido (Ethereum mainnet) |
| `chaingpt_defi_eigenlayer_deposit_tx` | Restake stETH / rETH / cbETH into EigenLayer (Ethereum mainnet) |

Aave V3 chains: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche.

### Hyperliquid + Polymarket (10 tools — new in 1.6)

Live mainnet data from the two highest-volume non-EVM-aggregator markets in crypto. **Read-only** in this release — signed order placement (Hyperliquid EIP-712 L1 actions, Polymarket CLOB orders) is deferred to a follow-up. No API keys required.

| Tool | What It Does |
|------|-------------|
| `chaingpt_hl_markets` | List Hyperliquid perp + spot universes |
| `chaingpt_hl_mids` | Live mid prices for all HL assets |
| `chaingpt_hl_orderbook` | L2 orderbook for one HL asset |
| `chaingpt_hl_account` | Full account state — margin / positions / open orders |
| `chaingpt_hl_fills` | Recent fill history for a wallet |
| `chaingpt_hl_funding` | Funding-rate history (auto-annualized) |
| `chaingpt_pm_markets` | Discover Polymarket markets, full-text search, volume sort |
| `chaingpt_pm_market` | Detail on one market — outcomes / prices / token ids |
| `chaingpt_pm_orderbook` | L2 orderbook for one outcome token |
| `chaingpt_pm_trades` | Recent fills on one outcome token |

Polymarket tools tie into ChainGPT's existing **PredictFi / Foresight AI** surface — same domain (event-outcome markets), but live mainnet data rather than ChainGPT-curated commentary.

### Optional API keys (graceful fallback when absent)

| Env var | Unlocks | Get one |
|---|---|---|
| `MORALIS_API_KEY` | Full multi-chain ERC-20 scan + DeFi positions + P&L | https://moralis.io (25k req/month free) |
| `ETHERSCAN_API_KEY` | Higher Etherscan rate limit (works across all EVM chains via v2) | https://etherscan.io/myapikey (free) |

<details>
<summary><b>Setup MCP Server (optional)</b></summary>

If installed via `/plugin install`, the MCP server is configured automatically via `.mcp.json`. Just set your API key:

```bash
export CHAINGPT_API_KEY="your-key-here"
```

For manual installs, build and configure:

```bash
cd .claude/skills/chaingpt/mcp-server
npm install && npm run build
```

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "chaingpt": {
      "command": "node",
      "args": [".claude/skills/chaingpt/mcp-server/dist/index.js"],
      "env": { "CHAINGPT_API_KEY": "your-key-here" }
    }
  }
}
```

</details>

<br/>

## 📋 10 Project Templates

| Template | Stack | Products |
|----------|-------|----------|
| Web3 AI Chatbot | Express + TypeScript | LLM |
| NFT Minting Service | Node.js | NFT Generator |
| Contract Audit CI/CD | GitHub Actions | Auditor |
| Crypto News Dashboard | Vanilla JS | News API |
| AI Twitter Agent | Node.js | AgenticOS |
| **NFT Marketplace** | Next.js + wagmi | NFT + LLM + Auditor + News |
| **DeFi Dashboard** | React + Recharts | LLM + News + Auditor |
| **Next.js Chatbot** | Next.js 14 App Router | LLM |
| **React Native Wallet** | Expo + React Native | LLM + NFT |
| **Nuxt News App** | Nuxt 3 SSR | News API |

<br/>

## 🔐 45+ Smart Contract Patterns

Audited, production-ready Solidity patterns Claude composes from instead of generating from scratch:

| Category | Count | Examples |
|----------|-------|---------|
| **ERC-20 Tokens** | 10 | Basic, burnable, taxable, reflection, governance, multi-chain |
| **NFTs** | 10 | ERC-721, 721A, lazy mint, soulbound, dynamic, ERC-1155, revenue-sharing |
| **DeFi** | 10 | Staking, vesting, bonding curve, AMM, flash loans, ERC-4626 vault |
| **Governance** | 5 | Governor, multi-sig, DAO treasury, delegation |
| **Security** | 10 | Access control, upgradeable (UUPS), timelock, escrow, EIP-712 |

<br/>

## 💬 Usage Examples

Just talk to Claude naturally:

```
"Build me a Web3 AI chatbot with streaming responses"
```
```
"Generate and mint an NFT on BSC using ChainGPT"
```
```
"Set up smart contract auditing in my CI/CD pipeline"
```
```
"Scaffold an NFT marketplace that uses 4 ChainGPT products"
```
```
"What's the credit cost for generating 100 NFTs with NebulaForge XL?"
```
```
"Write a staking contract"  →  uses patterns library, not from scratch
```
```
"I'm migrating from OpenAI — help me switch to ChainGPT"
```
```
"I'm at a hackathon — scaffold me a DeFi project fast"
```

<br/>

## 🧪 Testing

> **Use the mock server to develop and test without spending a single credit.**

The mock server is a full drop-in replacement for the ChainGPT API — realistic responses, simulated latency, credit tracking — so you can build, iterate, and run CI/CD pipelines without touching your API quota.

### Start the mock server

```bash
cd .claude/skills/chaingpt/mock-server
npm install && npm run dev
# → http://localhost:3001
```

Point your `CHAINGPT_BASE_URL` at `http://localhost:3001` and everything works exactly as it would in production. **No API key required.**

### Run the full test suite

**79 tests passing** across two suites:

```bash
# MCP Server tests (53 tests)
cd mcp-server && npm install && npm test

# Mock Server tests (26 tests)
cd mock-server && npm install && npm test

# Skill validation (118 structural checks)
bash scripts/validate.sh
```

The CI workflow (`.github/workflows/ci.yml`) runs all three automatically on every push and pull request.

<br/>

## 🗂️ Project Structure

<details>
<summary><b>Click to expand (76 files)</b></summary>

```
chaingpt-claude-skill/
├── .claude-plugin/
│   └── plugin.json                   # Plugin manifest (name, version, author)
├── .mcp.json                         # MCP server configuration
├── VERSION                           # Semantic version
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE
│
├── skills/                           # All skills (auto-discovered)
│   ├── chaingpt/SKILL.md             #   Main skill — API reference (341 lines)
│   ├── playground/SKILL.md           #   Interactive API testing
│   ├── debug/SKILL.md                #   Troubleshoot API errors
│   ├── hackathon/SKILL.md            #   60-second project scaffolder
│   └── update/SKILL.md               #   Check for skill updates
│
├── reference/                        # API & SDK documentation (16 files)
│   ├── llm-chatbot.md                #   Web3 AI Chatbot & LLM
│   ├── nft-generator.md              #   AI NFT Generator
│   ├── smart-contract-generator.md   #   Smart Contract Generator
│   ├── smart-contract-auditor.md     #   Smart Contract Auditor
│   ├── crypto-news.md                #   AI Crypto News
│   ├── agenticos.md                  #   AgenticOS (Twitter AI)
│   ├── solidity-llm.md               #   Solidity LLM (HuggingFace)
│   ├── saas-whitelabel.md            #   Whitelabel SaaS products
│   ├── pricing.md                    #   Credit costs & billing
│   ├── error-codes.md                #   Error handling reference
│   ├── product-selection.md          #   Decision matrix
│   ├── wallet-integration.md         #   MetaMask, WalletConnect
│   ├── advanced-patterns.md          #   Streaming, caching, circuit breaker
│   ├── deployment.md                 #   Vercel, Railway, Docker, Lambda
│   ├── cost-optimization.md          #   Save ~84% on credits
│   └── typescript-types.md           #   Complete TS interfaces
│
├── templates/                        # Project scaffolding (11 files)
├── patterns/                         # Solidity patterns (5 files, 45+ patterns)
├── migration/                        # Platform migration guides (3 files)
├── mcp-server/                       # MCP server — 12 tools, 53 tests
├── mock-server/                      # Testing mock server — 26 tests
├── scripts/                          # Validation tooling
└── examples/                         # Working code — JS + Python (8 files)
```

</details>

<br/>

## 🗺️ Roadmap

- [x] Complete API reference for all 7 products
- [x] MCP server with 12 direct-access tools
- [x] 10 project templates including multi-product compositions
- [x] 45+ audited Solidity patterns
- [x] Mock server for zero-credit testing
- [x] 79 passing tests (MCP + mock server)
- [x] Migration guides (OpenAI, Alchemy, custom)
- [x] Cost optimization & wallet integration docs
- [ ] Claude Code plugin marketplace listing
- [ ] Video tutorials & walkthroughs
- [ ] SSE streaming demo server
- [ ] Community template submissions
- [ ] Multi-language SDK examples (Go, Rust)

<br/>

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Validate your changes before submitting
bash scripts/validate.sh
```

<br/>

## 📄 Prerequisites

| Requirement | Link |
|-------------|------|
| **ChainGPT API Key** | [app.chaingpt.org](https://app.chaingpt.org) — connect a wallet to sign up |
| **API Credits** | [Buy credits](https://app.chaingpt.org/addcredits) — 1,000 credits = $10 |
| **Claude Code** | [code.claude.com](https://code.claude.com) |

<br/>

## 🔗 Links

<div align="center">

[Developer Docs](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk) · [API Dashboard](https://app.chaingpt.org/apidashboard) · [Pricing](https://app.chaingpt.org/pricing) · [Web3 AI Grant ($1M)](https://www.chaingpt.org/web3-ai-grant) · [Pad Innovation Grant ($25K)](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk/chaingpt-pad-innovation-grant-program)

[Solidity LLM on HuggingFace](https://huggingface.co/Chain-GPT/Solidity-LLM) · [AgenticOS on GitHub](https://github.com/ChainGPT-org/AgenticOS) · [Book a SaaS Demo](https://calendly.com/saaswl/demo)

</div>

<br/>

## 📜 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built by [ChainGPT](https://www.chaingpt.org)** — AI Infrastructure for Web3

If this skill saved you time, consider giving it a ⭐

</div>
