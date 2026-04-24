# ChainGPT Developer Kit for Claude Code

The most comprehensive [Claude Code skill](https://code.claude.com/docs/en/skills) for building with **ChainGPT's Web3 AI platform** — full API/SDK reference, 10 project templates, 45+ smart contract patterns, an MCP server for direct API access, a mock server for testing, and interactive developer tools.

Install it once, and Claude becomes your ChainGPT engineering co-pilot.

## What's Included

### API/SDK Reference (7 products)

| Product | What It Does |
|---------|-------------|
| **Web3 AI Chatbot & LLM** | Crypto-native LLM with live on-chain data, Nansen Smart Money, 33+ chains |
| **AI NFT Generator** | Text-to-image + on-chain NFT minting across 22+ chains, 4 AI models |
| **Smart Contract Generator** | Natural language to production Solidity contracts |
| **Smart Contract Auditor** | AI vulnerability detection with scored audit reports |
| **AI Crypto News** | Real-time AI-curated news, 24 categories, RSS feeds |
| **AgenticOS** | Open-source framework for autonomous X/Twitter AI agents |
| **Solidity LLM** | Open-source 2B-param model for Solidity code generation |

Plus **SaaS & Whitelabel** references (Launchpad $99K, Staking $9.5K, Vesting $9.5K, Telegram bots $1.5K+).

### 10 Project Scaffolding Templates

| Template | Products Used |
|----------|-------------|
| Web3 AI Chatbot (Express/TS) | LLM |
| NFT Minting Service | NFT Generator |
| Contract Audit CI/CD Pipeline | Auditor + GitHub Actions |
| Crypto News Dashboard | News API |
| AI Twitter Agent | AgenticOS |
| **AI-Powered NFT Marketplace** | NFT + LLM + Auditor + News |
| **DeFi Intelligence Dashboard** | LLM + News + Auditor |
| **Next.js Chatbot** | LLM + Next.js 14 App Router |
| **React Native Wallet + AI** | LLM + NFT + React Native |
| **Nuxt Crypto News App** | News API + Nuxt 3 SSR |

### 45+ Smart Contract Patterns

Audited, production-ready Solidity patterns Claude composes from instead of generating from scratch:
- **10 ERC-20 variants** — basic, burnable, taxable, reflection, governance, multi-chain
- **10 NFT patterns** — ERC-721, 721A, lazy mint, soulbound, dynamic, ERC-1155, revenue-sharing
- **10 DeFi patterns** — staking, vesting, bonding curve, AMM, flash loans, ERC-4626 vault
- **5 governance patterns** — Governor, multi-sig, DAO treasury, delegation
- **10 security patterns** — access control, upgradeable (UUPS), timelock, escrow, EIP-712

### MCP Server (12 tools)

Claude can call ChainGPT APIs directly — not just generate code. Ask "generate me an NFT of a samurai" and Claude actually calls the API, returns the image, and asks if you want to mint.

### Mock Server

Test without spending credits. Drop-in replacement for the real API with realistic responses, perfect for development and CI/CD.

### Interactive Skills

| Command | What It Does |
|---------|-------------|
| `/chaingpt-playground` | Test any ChainGPT API endpoint live from Claude |
| `/chaingpt-debug` | Diagnose and fix API errors instantly |
| `/chaingpt-hackathon` | Scaffold a complete hackathon project in 60 seconds |
| `/chaingpt-update` | Check for and apply skill updates |

### Migration Guides

Coming from OpenAI, Alchemy, or a custom solution? Guides with concept mapping, before/after code, and pricing comparisons.

### Credit Cost Estimator

Claude automatically estimates and reports credit costs before generating code that makes API calls.

## Installation

### Option 1: Git Clone (recommended)

```bash
# Per-project (shared with team via git)
git clone https://github.com/ChainGPT-org/chaingpt-claude-skill .claude/skills/chaingpt

# User-level (available in all projects)
git clone https://github.com/ChainGPT-org/chaingpt-claude-skill ~/.claude/skills/chaingpt
```

### Option 2: Claude Code Plugin (marketplace)

Coming soon — one-click install from the Claude Code plugin marketplace.

### Optional: Enable MCP Server (direct API access)

```bash
cd .claude/skills/chaingpt/mcp-server
npm install && npm run build
```

Add to your Claude Code config (`.claude/settings.json`):

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

### Optional: Enable Mock Server (test without credits)

```bash
cd .claude/skills/chaingpt/mock-server
npm install && npm run dev
# Runs on http://localhost:3001
```

## Usage

Just talk to Claude naturally:

```
> "Build me a Web3 AI chatbot with streaming responses"
> "Generate and mint an NFT on BSC using ChainGPT"
> "Set up smart contract auditing in my CI/CD pipeline"
> "Scaffold an NFT marketplace that uses 4 ChainGPT products"
> "Create a Next.js chatbot with ChainGPT"
> "What's the credit cost for generating 100 NFTs with NebulaForge XL?"
> "I'm getting a 404 error on the chat endpoint — help me debug"
> "I'm at a hackathon — scaffold me a DeFi project fast"
> "Write a staking contract" (uses patterns library, not from scratch)
> "I'm migrating from OpenAI — help me switch to ChainGPT"
```

## Directory Structure

```
chaingpt-claude-skill/
├── SKILL.md                         # Main skill entry point
├── VERSION                          # Current version
├── plugin.json                      # Plugin manifest
├── README.md
├── CONTRIBUTING.md                  # Contribution guidelines
├── CHANGELOG.md                     # Version history
├── LICENSE
│
├── reference/                       # Full API/SDK documentation (16 files)
│   ├── llm-chatbot.md
│   ├── nft-generator.md
│   ├── smart-contract-generator.md
│   ├── smart-contract-auditor.md
│   ├── crypto-news.md
│   ├── agenticos.md
│   ├── solidity-llm.md
│   ├── saas-whitelabel.md
│   ├── pricing.md
│   ├── error-codes.md
│   ├── product-selection.md         # Decision matrix & cost estimates
│   ├── wallet-integration.md        # MetaMask, WalletConnect, minting
│   ├── advanced-patterns.md         # Streaming, rate limiting, caching
│   ├── deployment.md                # Vercel, Railway, Docker, AWS Lambda
│   ├── cost-optimization.md         # Credit-saving strategies
│   └── typescript-types.md          # Complete TS interfaces
│
├── templates/                       # Project scaffolding (11 templates)
│   ├── chatbot-app.md
│   ├── nft-minting-service.md
│   ├── contract-auditor-ci.md
│   ├── news-dashboard.md
│   ├── twitter-agent.md
│   ├── combo-nft-marketplace.md     # Multi-product
│   ├── combo-defi-dashboard.md      # Multi-product
│   ├── composition-patterns.md      # 5 advanced multi-product patterns
│   ├── nextjs-chatbot.md            # Framework-specific
│   ├── react-native-wallet.md       # Framework-specific
│   └── nuxt-news-app.md             # Framework-specific
│
├── patterns/                        # 45+ Solidity patterns
│   ├── tokens.md (10 ERC-20 variants)
│   ├── nfts.md (10 NFT patterns)
│   ├── defi.md (10 DeFi patterns)
│   ├── governance.md (5 DAO patterns)
│   └── security.md (10 security patterns)
│
├── migration/                       # Platform migration guides
│   ├── from-openai.md
│   ├── from-alchemy.md
│   └── from-custom.md
│
├── skills/                          # Interactive sub-skills
│   ├── playground/SKILL.md
│   ├── debug/SKILL.md
│   ├── hackathon/SKILL.md
│   └── update/SKILL.md
│
├── mcp-server/                      # MCP server (12 tools)
│   ├── package.json
│   ├── src/index.ts
│   ├── src/tools/ (chat, nft, audit, generator, news, utils)
│   ├── src/__tests__/tools.test.ts  # 53 unit tests
│   └── README.md
│
├── mock-server/                     # Testing mock server
│   ├── package.json
│   ├── src/index.ts
│   ├── src/fixtures.ts
│   ├── src/__tests__/endpoints.test.ts  # 25 endpoint tests
│   └── README.md
│
├── scripts/                         # Development tooling
│   └── validate.sh                  # Skill validation script
│
└── examples/                        # Working code examples (8 files)
    ├── js/ (chatbot, nft, audit, news)
    └── python/ (chatbot, nft, audit, news)
```

## Prerequisites

1. **API Key** — Sign up at [app.chaingpt.org](https://app.chaingpt.org) (connect a crypto wallet)
2. **Credits** — Purchase at [app.chaingpt.org/addcredits](https://app.chaingpt.org/addcredits) (1,000 credits = $10, 15% bonus with $CGPT)
3. **Claude Code** — [Install Claude Code](https://code.claude.com) if you haven't already

## Links

- [ChainGPT Developer Docs](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk)
- [API Dashboard](https://app.chaingpt.org/apidashboard)
- [API Pricing](https://app.chaingpt.org/pricing)
- [Web3 AI Grant Program ($1M)](https://www.chaingpt.org/web3-ai-grant)
- [ChainGPT Pad Innovation Grants ($25K)](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk/chaingpt-pad-innovation-grant-program)
- [Solidity LLM on HuggingFace](https://huggingface.co/Chain-GPT/Solidity-LLM)
- [AgenticOS on GitHub](https://github.com/ChainGPT-org/AgenticOS)
- [Book a SaaS Demo](https://calendly.com/saaswl/demo)

## License

MIT
