# AI-Powered NFT Marketplace Template

A full-stack app combining 4 ChainGPT products:
- **AI NFT Generator** — create AI art from prompts
- **Web3 AI Chatbot** — describe what you want, AI interprets and generates
- **Smart Contract Auditor** — verify collection contracts before minting
- **AI Crypto News** — trending NFT news feed in the marketplace

### Project Structure
```
nft-marketplace/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts (Express server)
│   ├── services/
│   │   ├── nftService.ts (AI image generation + minting via @chaingpt/nft)
│   │   ├── chatService.ts (natural language → prompt refinement via @chaingpt/generalchat)
│   │   ├── auditService.ts (contract verification via @chaingpt/smartcontractauditor)
│   │   └── newsService.ts (NFT news feed via @chaingpt/ainews)
│   ├── routes/
│   │   ├── nft.ts (generate, mint, collections, progress)
│   │   ├── chat.ts (describe → generate flow)
│   │   ├── audit.ts (verify contract)
│   │   └── news.ts (NFT category news)
│   └── types.ts
├── public/
│   ├── index.html (marketplace UI)
│   ├── create.html (AI creation studio)
│   ├── style.css
│   └── app.js
└── README.md
```

### Dependencies
@chaingpt/nft, @chaingpt/generalchat, @chaingpt/smartcontractauditor, @chaingpt/ainews, express, dotenv, cors

### Key Flows
1. **Describe & Create:** User describes what they want → LLM interprets → NFT Generator creates → User reviews → Mint
2. **Browse & Discover:** Gallery of AI-generated NFTs + trending NFT news feed (category ID 8)
3. **Verify:** Before minting from any external contract, audit it for security
4. **Multi-chain:** Support BSC (56), Ethereum (1), Polygon (137), Base (8453)

### Implementation Details for Each Service
- nftService: generateImage, generateAndMint, enhancePrompt, getCollections, getSupportedChains
- chatService: interpretDescription (takes natural language, returns structured prompt + style + model recommendation)
- auditService: quickAudit (returns pass/fail + summary), fullAudit (detailed report)
- newsService: getNftNews (categoryId: 8, with subcategory filters)

### Credit Cost Estimate
- Prompt refinement via LLM: 0.5 credits
- Image generation: 1-3 credits (depends on model/upscale)
- Contract audit: 1 credit
- News fetch: 1 credit per 10 articles
- Typical "describe → create → mint" flow: ~2-4.5 credits
