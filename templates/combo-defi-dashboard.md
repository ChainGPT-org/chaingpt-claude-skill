# DeFi Intelligence Dashboard Template

Combines 3 ChainGPT products for a comprehensive DeFi monitoring tool:
- **Web3 AI Chatbot** — natural language queries about DeFi protocols, tokens, wallets
- **AI Crypto News** — real-time DeFi news filtered by protocol and chain
- **Smart Contract Auditor** — on-demand audit of any DeFi contract

### Project Structure
```
defi-dashboard/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts
│   ├── services/
│   │   ├── aiAnalyst.ts (LLM for market analysis, token research, wallet intelligence)
│   │   ├── newsAggregator.ts (DeFi news with real-time filters)
│   │   └── contractScanner.ts (audit DeFi contracts on demand)
│   ├── routes/
│   │   ├── analysis.ts (POST /analyze — natural language DeFi queries)
│   │   ├── news.ts (GET /news — filtered DeFi news)
│   │   └── audit.ts (POST /audit — contract security check)
│   └── types.ts
├── public/
│   ├── index.html (dashboard with 3 panels: AI analyst, news feed, contract scanner)
│   ├── style.css (dark theme, dashboard layout)
│   └── app.js
└── README.md
```

### Dependencies
@chaingpt/generalchat, @chaingpt/ainews, @chaingpt/smartcontractauditor, express, dotenv, cors

### Key Features
- AI Analyst panel: "What's the current state of Ethereum L2s?" → LLM with live on-chain data
- News panel: Real-time DeFi news (categoryId: 5), filterable by chain (Ethereum=15, BSC=12, Solana=22, Arbitrum=28)
- Contract Scanner: Paste any contract address/source → instant security assessment
- Context injection: Configure for specific DeFi protocol focus
