# Migrating from Alchemy AI to ChainGPT

A guide for teams using Alchemy's APIs for blockchain data who want to add or switch to ChainGPT's AI layer.

---

## Complementary vs. Replacement

ChainGPT and Alchemy serve different primary purposes, with some overlap:

| Capability | Alchemy | ChainGPT | Recommendation |
|-----------|---------|----------|----------------|
| Raw RPC / node access | Core product | Not provided | Keep Alchemy |
| Block/transaction indexing | Alchemy SDK | Not provided | Keep Alchemy |
| NFT metadata retrieval | Alchemy NFT API | NFT Generator API | Complementary |
| AI NFT generation + minting | Not available | Full pipeline | Use ChainGPT |
| Token price/analytics | Token API + manual parsing | AI-powered natural language | Use ChainGPT |
| Smart contract verification | Contract verification | AI Generator + Auditor | Use ChainGPT for AI |
| Natural language blockchain queries | Not available | Core product | Use ChainGPT |
| AI news aggregation | Not available | Nova AI news API | Use ChainGPT |
| Wallet intelligence / Smart Money | Not available | Nansen integration | Use ChainGPT |
| Webhooks / event streaming | Alchemy Notify | Not provided | Keep Alchemy |
| Account abstraction infra | Alchemy AA SDK | Not provided | Keep Alchemy |

**TL;DR:** Keep Alchemy for low-level blockchain infrastructure (RPC, indexing, webhooks, AA). Use ChainGPT for AI-powered analysis, generation, and user-facing intelligence.

---

## Use Case 1: Natural Language Blockchain Queries

### Before (Alchemy — Manual Data Fetching + Parsing)

```javascript
import { Alchemy, Network } from 'alchemy-sdk';

const alchemy = new Alchemy({ apiKey: ALCHEMY_KEY, network: Network.ETH_MAINNET });

// To answer "What's happening with this wallet?" you need multiple API calls:
const balance = await alchemy.core.getBalance(walletAddress);
const tokens = await alchemy.core.getTokenBalances(walletAddress);
const nfts = await alchemy.nft.getNftsForOwner(walletAddress);
const transfers = await alchemy.core.getAssetTransfers({
  fromAddress: walletAddress,
  category: ['erc20', 'erc721'],
  maxCount: 10
});

// Then manually format everything into a human-readable summary
const ethBalance = parseFloat(balance.toString()) / 1e18;
const tokenList = tokens.tokenBalances
  .filter(t => t.tokenBalance !== '0x0')
  .map(t => `${t.contractAddress}: ${parseInt(t.tokenBalance, 16)}`);

console.log(`ETH: ${ethBalance}`);
console.log(`Tokens: ${tokenList.length}`);
console.log(`NFTs: ${nfts.totalCount}`);
// Still no AI analysis or Smart Money context...
```

### After (ChainGPT — Single Query)

```javascript
import { GeneralChat } from '@chaingpt/generalchat';

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY });

const response = await chat.createChatBlob({
  question: `Analyze wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045. 
    What tokens do they hold? Any Smart Money activity? What's the portfolio breakdown?`,
  chatHistory: 'off'
});

console.log(response.data.bot);
// Returns a full analysis with:
// - Token holdings with USD values
// - Recent transaction activity
// - Smart Money label (if tracked by Nansen)
// - Portfolio allocation breakdown
// - Notable DeFi positions
```

**Cost comparison:**
- Alchemy: 5+ API calls at Compute Unit costs (variable, ~$0.01-0.05 total) + your code to format
- ChainGPT: 1 API call at 0.5 credits ($0.005) + AI-formatted analysis included

---

## Use Case 2: NFT Capabilities

Alchemy provides NFT metadata retrieval. ChainGPT provides AI-powered NFT generation and minting.

### Alchemy (Read-Only NFT Data)

```javascript
// Alchemy: fetch existing NFT metadata
const nfts = await alchemy.nft.getNftsForOwner('0x...');
const metadata = await alchemy.nft.getNftMetadata('0x...contractAddress', '1');
const floor = await alchemy.nft.getFloorPrice('0x...contractAddress');
```

### ChainGPT (AI Generation + Minting)

```javascript
import { Nft } from '@chaingpt/nft';

const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY });

// Generate an AI image from a text prompt
const image = await nft.generateImage({
  prompt: 'Cyberpunk samurai in neon Tokyo',
  model: 'velogen',
  height: 512,
  width: 512
});

// Enhance the prompt for better results
const enhanced = await nft.enhancePrompt({
  prompt: 'cyberpunk samurai'
});
// Returns: "Ultra-detailed cinematic render of a cyberpunk samurai warrior..."

// Queue for on-chain minting
const job = await nft.generateNftQueue({
  prompt: 'Cyberpunk samurai in neon Tokyo',
  model: 'velogen',
  height: 512,
  width: 512,
  walletAddress: '0x...',
  chainId: 137,  // Polygon
  amount: 5
});

// Track progress
const progress = await nft.getProgress(job.collectionId);

// Mint to blockchain
const minted = await nft.mintNft({
  collectionId: job.collectionId,
  name: 'Cyber Samurai Collection',
  symbol: 'CSAM',
  ids: [1, 2, 3, 4, 5]
});
```

**Hybrid approach:** Use Alchemy to read existing NFT data from the blockchain. Use ChainGPT to generate new NFTs and mint them.

---

## Use Case 3: Smart Contract Tools

### Alchemy (Contract Verification)

Alchemy provides contract verification through Etherscan integration and basic contract interaction via the SDK. No generation or auditing.

### ChainGPT (AI Generation + Auditing)

```javascript
import { SmartContractGenerator } from '@chaingpt/smartcontractgenerator';
import { SmartContractAuditor } from '@chaingpt/smartcontractauditor';

const generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY });
const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY });

// Generate a smart contract from natural language
const contract = await generator.createSmartContractBlob({
  question: 'Create an ERC-721 NFT contract with royalties, whitelist minting, and reveal functionality',
  chatHistory: 'off'
});

console.log(contract.data.bot);
// Returns complete, deployable Solidity code

// Then audit it
const audit = await auditor.createSmartContractAuditBlob({
  question: `Audit this contract for security vulnerabilities:\n\n${contract.data.bot}`,
  chatHistory: 'off'
});

console.log(audit.data.bot);
// Returns scored audit report with findings and recommendations
```

---

## Use Case 4: News and Market Intelligence

Alchemy does not provide a news or market intelligence API. Teams typically use CoinGecko, CoinMarketCap, or custom scrapers.

### ChainGPT (AI-Curated News)

```javascript
// Fetch AI-curated crypto news
const res = await fetch('https://api.chaingpt.org/news?categoryId=5&limit=10', {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});
const { data } = await res.json();

// Each article includes:
// - AI-generated summary
// - Category and blockchain tags
// - Token associations
// - Featured/top story flags
// - Publication metadata
```

Filter by category (DeFi, NFT, Gaming, etc.), blockchain (Ethereum, BSC, Solana), or specific tokens.

---

## Recommended Architecture

For most Web3 applications, the optimal setup combines both services:

```
Your Application
    |
    +-- Alchemy SDK
    |     |-- RPC calls (transactions, contract reads)
    |     |-- Event webhooks (Alchemy Notify)
    |     |-- NFT metadata retrieval
    |     |-- Account abstraction (ERC-4337)
    |
    +-- ChainGPT SDK
          |-- AI chatbot (natural language queries)
          |-- Smart contract generation
          |-- Smart contract auditing
          |-- AI NFT generation + minting
          |-- Crypto news aggregation
          |-- Wallet intelligence (Smart Money)
```

### Example: DeFi Dashboard with AI

```javascript
import { Alchemy } from 'alchemy-sdk';
import { GeneralChat } from '@chaingpt/generalchat';

// Alchemy for raw data
const alchemy = new Alchemy({ apiKey: ALCHEMY_KEY, network: Network.ETH_MAINNET });
const balance = await alchemy.core.getBalance(userWallet);

// ChainGPT for AI analysis
const chat = new GeneralChat({ apiKey: CHAINGPT_KEY });
const analysis = await chat.createChatBlob({
  question: `Given this wallet holds ${ethers.formatEther(balance)} ETH, 
    what DeFi strategies would you recommend based on current market conditions?`,
  chatHistory: 'on',
  sdkUniqueId: `user-${userId}`
});
```

---

## Migration Checklist

1. [ ] Identify which Alchemy features you use (RPC, NFT data, webhooks, AA)
2. [ ] Keep Alchemy for infrastructure (RPC, indexing, webhooks)
3. [ ] Get a ChainGPT API key at [app.chaingpt.org](https://app.chaingpt.org)
4. [ ] Install ChainGPT SDKs: `npm install @chaingpt/generalchat @chaingpt/nft @chaingpt/smartcontractgenerator @chaingpt/smartcontractauditor`
5. [ ] Replace manual data-formatting code with ChainGPT AI queries
6. [ ] Add AI NFT generation if applicable
7. [ ] Add smart contract generation/auditing to your development workflow
8. [ ] Integrate crypto news API for market intelligence features
9. [ ] Test with the [mock server](../mock-server/) during development
10. [ ] Monitor credit usage and optimize query patterns
