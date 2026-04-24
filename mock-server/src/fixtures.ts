// ─── Chat Responses ────────────────────────────────────────────────
export const chatResponses: string[] = [
  `Bitcoin (BTC) is currently trading at approximately $67,450 with a 24-hour trading volume of $28.3 billion. The price has increased 2.4% in the last 24 hours. Key on-chain metrics show:\n\n- **Active addresses:** 1.02M (7-day avg)\n- **Hash rate:** 625 EH/s (all-time high)\n- **Exchange reserves:** Declining trend, suggesting accumulation\n- **Smart Money flow:** Net positive inflows via Nansen data\n\nThe current support level sits at $65,200 with resistance at $69,800. The Fear & Greed Index reads 62 (Greed), indicating bullish market sentiment.`,

  `Ethereum's gas fees are currently averaging 12 gwei for standard transactions, making it one of the most affordable periods for on-chain activity in recent months. Here's the breakdown:\n\n- **Low priority:** 8 gwei (~$0.38)\n- **Standard:** 12 gwei (~$0.57)\n- **Fast:** 18 gwei (~$0.86)\n\nThe Dencun upgrade's blob transactions have reduced L2 posting costs by approximately 95%. Layer 2 networks like Arbitrum and Base are processing transactions for under $0.01.\n\nFor NFT minting or DeFi interactions, standard priority should confirm within 2-3 minutes.`,

  `Here's an analysis of the top DeFi protocols by Total Value Locked (TVL):\n\n1. **Lido** — $33.2B (Liquid staking)\n2. **Aave** — $12.8B (Lending/borrowing)\n3. **EigenLayer** — $11.5B (Restaking)\n4. **Maker/Sky** — $8.9B (CDP/stablecoin)\n5. **Uniswap** — $5.7B (DEX)\n\nKey trends:\n- Restaking protocols have grown 340% in the last quarter\n- Real-world asset (RWA) tokenization is the fastest-growing DeFi category\n- Cross-chain liquidity is consolidating on Ethereum L2s\n\nSmart Money wallets (tracked via Nansen) are currently accumulating positions in liquid restaking tokens (LRTs) and RWA protocols.`,

  `The CGPT token is the utility token powering the ChainGPT ecosystem. Here are the current metrics:\n\n- **Price:** $0.142\n- **Market Cap:** $89.4M\n- **Circulating Supply:** 629.7M / 1B total\n- **Staking APY:** Variable, based on pool participation\n\n**Utility:**\n- API credit purchases (15% bonus when paying with CGPT)\n- Staking for DAO voting and tier access\n- ChainGPT Pad allocation tiers\n- AI NFT Generator premium features\n\nThe token operates on both Ethereum and BNB Chain with cross-chain bridges available.`,

  `Smart contract wallet adoption has accelerated significantly in 2025. Here's what you should know:\n\n**ERC-4337 (Account Abstraction) Stats:**\n- 12.4M UserOperations processed to date\n- 3.2M unique smart accounts deployed\n- Top bundlers: Pimlico, Alchemy, Biconomy\n\n**Key Benefits:**\n- Gas sponsorship (dApps pay gas for users)\n- Batch transactions (multiple actions in one tx)\n- Social recovery (no more lost seed phrases)\n- Session keys (approve once, interact freely)\n\n**Popular Implementations:**\n- Safe (formerly Gnosis Safe) — 45% market share\n- Kernel by ZeroDev — growing fast in DeFi\n- Coinbase Smart Wallet — consumer-focused\n\nFor developers building dApps, integrating ERC-4337 support can dramatically improve user onboarding and retention.`,

  `Cross-chain bridging volume has reached $4.2B in the past 30 days. Here are the safest and most liquid bridges:\n\n| Bridge | 30d Volume | Supported Chains | Security Model |\n|--------|-----------|-------------------|----------------|\n| Stargate | $1.8B | 15 chains | LayerZero messaging |\n| Across | $980M | 8 chains | Optimistic + UMA oracle |\n| Synapse | $620M | 12 chains | Threshold signatures |\n| Hop | $340M | 6 chains | Bonder network |\n\n**Safety Tips:**\n1. Always verify the bridge URL (bookmark official sites)\n2. Start with a small test transaction\n3. Check bridge TVL — higher TVL generally means more liquidity\n4. Use bridges with bug bounties and audit history\n5. Monitor https://defillama.com/bridges for real-time data`
];

// ─── Smart Contract (ERC-20) ───────────────────────────────────────
export const sampleERC20Contract = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MyToken
 * @dev ERC-20 token with burn, permit (gasless approvals), and owner-only minting.
 *      Compatible with all EVM chains (Ethereum, BSC, Polygon, Arbitrum, Base, etc.)
 */
contract MyToken is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18; // 1 million tokens

    /// @notice Tracks total minted to enforce max supply
    uint256 public totalMinted;

    /// @notice Emitted when new tokens are minted
    event TokensMinted(address indexed to, uint256 amount);

    constructor(
        address initialOwner
    ) ERC20("MyToken", "MTK") ERC20Permit("MyToken") Ownable(initialOwner) {
        // Mint initial supply to the deployer
        _mint(initialOwner, 500_000 * 10**18);
        totalMinted = 500_000 * 10**18;
    }

    /**
     * @notice Mint new tokens (owner only)
     * @param to Recipient address
     * @param amount Amount to mint (in wei)
     */
    function mint(address to, uint256 amount) public onlyOwner {
        require(totalMinted + amount <= MAX_SUPPLY, "MyToken: exceeds max supply");
        totalMinted += amount;
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Batch transfer to multiple recipients
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to transfer
     */
    function batchTransfer(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(recipients.length == amounts.length, "MyToken: length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            transfer(recipients[i], amounts[i]);
        }
    }
}`;

// ─── Audit Report ──────────────────────────────────────────────────
export const sampleAuditReport = `## Smart Contract Audit Report

**Overall Security Score: 72/100**

**Contract:** TokenSale.sol
**Compiler:** Solidity ^0.8.20
**Framework:** OpenZeppelin 5.x

---

### Critical Issues (1)

**C-01: Reentrancy Vulnerability in \`withdraw()\`**
- **Severity:** Critical
- **Location:** Line 87-95
- **Description:** The \`withdraw()\` function sends ETH before updating the internal balance mapping. An attacker can re-enter the function and drain the contract.
\`\`\`solidity
// VULNERABLE CODE
function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool success, ) = msg.sender.call{value: amount}("");  // <- External call before state update
    require(success, "Transfer failed");
    balances[msg.sender] = 0;  // <- State updated AFTER external call
}
\`\`\`
- **Recommendation:** Apply checks-effects-interactions pattern or use OpenZeppelin's \`ReentrancyGuard\`:
\`\`\`solidity
function withdraw() external nonReentrant {
    uint256 amount = balances[msg.sender];
    balances[msg.sender] = 0;  // <- Update state BEFORE external call
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Transfer failed");
}
\`\`\`

---

### High Issues (2)

**H-01: Missing Access Control on \`setPrice()\`**
- **Severity:** High
- **Location:** Line 42
- **Description:** The \`setPrice()\` function is public with no access modifier. Any address can change the token sale price.
- **Recommendation:** Add \`onlyOwner\` modifier.

**H-02: Unchecked Return Value on Token Transfer**
- **Severity:** High
- **Location:** Line 110
- **Description:** The ERC-20 \`transfer()\` return value is not checked. Some tokens (like USDT) don't revert on failure.
- **Recommendation:** Use OpenZeppelin's \`SafeERC20\` library.

---

### Medium Issues (2)

**M-01: Timestamp Dependence**
- **Severity:** Medium
- **Location:** Line 55
- **Description:** Sale end time relies on \`block.timestamp\`, which miners can manipulate by ~15 seconds.
- **Recommendation:** Use block numbers instead, or accept the ~15s variance.

**M-02: No Maximum Purchase Limit**
- **Severity:** Medium
- **Location:** Line 68
- **Description:** No cap on individual purchases allows a single buyer to acquire the entire supply.
- **Recommendation:** Implement a per-address maximum allocation.

---

### Low Issues (3)

**L-01: Missing Event Emissions** — State-changing functions don't emit events (Lines 42, 87, 110)
**L-02: Floating Pragma** — Use a fixed compiler version instead of \`^0.8.20\`
**L-03: Missing Zero-Address Checks** — Constructor doesn't validate that token address is non-zero

---

### Informational (2)

**I-01: Gas Optimization** — \`balances\` mapping reads could be cached in a local variable (saves ~100 gas per call)
**I-02: NatSpec Missing** — Public functions lack documentation comments

---

### Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 2 |
| Medium | 2 |
| Low | 3 |
| Informational | 2 |

**Total findings:** 10
**Recommendation:** Do NOT deploy without fixing Critical and High issues. The reentrancy vulnerability (C-01) can result in complete loss of funds.`;

// ─── News Articles ─────────────────────────────────────────────────
export const sampleNewsArticles = [
  {
    id: 10001,
    title: "Ethereum Gas Fees Hit New Low After Pectra Upgrade",
    description: "Average gas fees on Ethereum mainnet have dropped to single-digit gwei levels following the successful Pectra upgrade, making DeFi interactions more accessible than ever. Layer 2 networks are now processing transactions for fractions of a cent.",
    url: "https://app.chaingpt.org/news/10001",
    pubDate: "2026-04-24T08:30:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10001.jpg",
    createdAt: "2026-04-24T08:30:00.000Z",
    updatedAt: "2026-04-24T08:35:00.000Z",
    isPublished: true,
    isFeatured: true,
    isTopStory: true,
    viewsCount: 8432,
    categoryId: 5,
    subCategoryId: 15,
    tokenId: 80,
    category: { id: 5, name: "DeFi" },
    subCategory: { id: 15, name: "Ethereum" },
    token: { id: 80, name: "ETH", symbol: "ETH" },
    media: { thumbnail: "https://cdn.chaingpt.org/news/10001_thumb.jpg", original: "https://cdn.chaingpt.org/news/10001.jpg" },
    newsTags: ["ethereum", "gas-fees", "pectra", "upgrade"]
  },
  {
    id: 10002,
    title: "Bitcoin Surpasses $100K as Institutional Demand Surges",
    description: "Bitcoin has crossed the $100,000 mark for the first time, driven by record inflows into spot Bitcoin ETFs and growing adoption by sovereign wealth funds. On-chain data shows accumulation by long-term holders at an all-time high.",
    url: "https://app.chaingpt.org/news/10002",
    pubDate: "2026-04-23T14:15:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10002.jpg",
    createdAt: "2026-04-23T14:15:00.000Z",
    updatedAt: "2026-04-23T14:20:00.000Z",
    isPublished: true,
    isFeatured: true,
    isTopStory: true,
    viewsCount: 15230,
    categoryId: 64,
    subCategoryId: 11,
    tokenId: 1,
    category: { id: 64, name: "Cryptocurrency" },
    subCategory: { id: 11, name: "Bitcoin" },
    token: { id: 1, name: "Bitcoin", symbol: "BTC" },
    media: { thumbnail: "https://cdn.chaingpt.org/news/10002_thumb.jpg", original: "https://cdn.chaingpt.org/news/10002.jpg" },
    newsTags: ["bitcoin", "etf", "institutional", "price"]
  },
  {
    id: 10003,
    title: "Uniswap v4 Launches With Custom Hook Ecosystem",
    description: "Uniswap v4 has officially launched on Ethereum mainnet, introducing a hooks system that allows developers to customize pool behavior. Over 200 custom hooks are already available, enabling features like dynamic fees, TWAP orders, and limit orders natively.",
    url: "https://app.chaingpt.org/news/10003",
    pubDate: "2026-04-23T10:00:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10003.jpg",
    createdAt: "2026-04-23T10:00:00.000Z",
    updatedAt: "2026-04-23T10:05:00.000Z",
    isPublished: true,
    isFeatured: false,
    isTopStory: false,
    viewsCount: 6789,
    categoryId: 5,
    subCategoryId: 15,
    tokenId: 158,
    category: { id: 5, name: "DeFi" },
    subCategory: { id: 15, name: "Ethereum" },
    token: { id: 158, name: "Uniswap", symbol: "UNI" },
    media: { thumbnail: "https://cdn.chaingpt.org/news/10003_thumb.jpg", original: "https://cdn.chaingpt.org/news/10003.jpg" },
    newsTags: ["uniswap", "v4", "hooks", "defi"]
  },
  {
    id: 10004,
    title: "NFT Market Rebounds With AI-Generated Collections Leading Volume",
    description: "The NFT market has seen a 180% increase in trading volume over the past month, with AI-generated art collections dominating the top charts. Platforms integrating AI generation tools are reporting record minting activity across Ethereum, Base, and Polygon.",
    url: "https://app.chaingpt.org/news/10004",
    pubDate: "2026-04-22T16:45:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10004.jpg",
    createdAt: "2026-04-22T16:45:00.000Z",
    updatedAt: "2026-04-22T16:50:00.000Z",
    isPublished: true,
    isFeatured: false,
    isTopStory: false,
    viewsCount: 4321,
    categoryId: 8,
    subCategoryId: 15,
    tokenId: null,
    category: { id: 8, name: "NFT" },
    subCategory: { id: 15, name: "Ethereum" },
    token: null,
    media: { thumbnail: "https://cdn.chaingpt.org/news/10004_thumb.jpg", original: "https://cdn.chaingpt.org/news/10004.jpg" },
    newsTags: ["nft", "ai-art", "trading-volume"]
  },
  {
    id: 10005,
    title: "Solana DeFi TVL Crosses $20B as Ecosystem Matures",
    description: "Solana's DeFi ecosystem has surpassed $20 billion in total value locked, driven by growth in lending protocols and liquid staking. The network processed over 65 million transactions in the past 24 hours with average fees under $0.001.",
    url: "https://app.chaingpt.org/news/10005",
    pubDate: "2026-04-22T12:00:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10005.jpg",
    createdAt: "2026-04-22T12:00:00.000Z",
    updatedAt: "2026-04-22T12:05:00.000Z",
    isPublished: true,
    isFeatured: false,
    isTopStory: true,
    viewsCount: 7654,
    categoryId: 5,
    subCategoryId: null,
    tokenId: 200,
    category: { id: 5, name: "DeFi" },
    subCategory: null,
    token: { id: 200, name: "Solana", symbol: "SOL" },
    media: { thumbnail: "https://cdn.chaingpt.org/news/10005_thumb.jpg", original: "https://cdn.chaingpt.org/news/10005.jpg" },
    newsTags: ["solana", "defi", "tvl"]
  },
  {
    id: 10006,
    title: "EU MiCA Regulations: First Wave of Crypto Licenses Granted",
    description: "The European Securities and Markets Authority (ESMA) has issued the first batch of MiCA licenses to 34 crypto asset service providers. Major exchanges including Binance and Kraken have received full authorization to operate across all EU member states.",
    url: "https://app.chaingpt.org/news/10006",
    pubDate: "2026-04-21T09:30:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10006.jpg",
    createdAt: "2026-04-21T09:30:00.000Z",
    updatedAt: "2026-04-21T09:35:00.000Z",
    isPublished: true,
    isFeatured: false,
    isTopStory: false,
    viewsCount: 5432,
    categoryId: 64,
    subCategoryId: null,
    tokenId: null,
    category: { id: 64, name: "Cryptocurrency" },
    subCategory: null,
    token: null,
    media: { thumbnail: "https://cdn.chaingpt.org/news/10006_thumb.jpg", original: "https://cdn.chaingpt.org/news/10006.jpg" },
    newsTags: ["regulation", "mica", "eu", "compliance"]
  },
  {
    id: 10007,
    title: "Aave Deploys on Five New Chains in Q2 Expansion",
    description: "Aave has expanded to five new blockchain networks in Q2 2026, including Berachain, Scroll, and Mantle. The lending protocol now operates on 15 chains with total deposits exceeding $25 billion, solidifying its position as the leading decentralized lending platform.",
    url: "https://app.chaingpt.org/news/10007",
    pubDate: "2026-04-21T07:00:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10007.jpg",
    createdAt: "2026-04-21T07:00:00.000Z",
    updatedAt: "2026-04-21T07:05:00.000Z",
    isPublished: true,
    isFeatured: false,
    isTopStory: false,
    viewsCount: 3456,
    categoryId: 6,
    subCategoryId: 15,
    tokenId: 130,
    category: { id: 6, name: "Lending" },
    subCategory: { id: 15, name: "Ethereum" },
    token: { id: 130, name: "Aave", symbol: "AAVE" },
    media: { thumbnail: "https://cdn.chaingpt.org/news/10007_thumb.jpg", original: "https://cdn.chaingpt.org/news/10007.jpg" },
    newsTags: ["aave", "lending", "multichain", "expansion"]
  },
  {
    id: 10008,
    title: "GameFi Sector Sees 300% User Growth as AAA Titles Launch",
    description: "The blockchain gaming sector has experienced explosive growth with several AAA-quality titles launching on major networks. Daily active wallets interacting with gaming contracts have surged from 1.2M to 4.8M in the past quarter.",
    url: "https://app.chaingpt.org/news/10008",
    pubDate: "2026-04-20T15:30:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10008.jpg",
    createdAt: "2026-04-20T15:30:00.000Z",
    updatedAt: "2026-04-20T15:35:00.000Z",
    isPublished: true,
    isFeatured: false,
    isTopStory: false,
    viewsCount: 6123,
    categoryId: 2,
    subCategoryId: 12,
    tokenId: null,
    category: { id: 2, name: "Blockchain Gaming" },
    subCategory: { id: 12, name: "BNB Chain" },
    token: null,
    media: { thumbnail: "https://cdn.chaingpt.org/news/10008_thumb.jpg", original: "https://cdn.chaingpt.org/news/10008.jpg" },
    newsTags: ["gaming", "gamefi", "aaa", "adoption"]
  },
  {
    id: 10009,
    title: "Stablecoin Market Cap Hits $250B as USDC Gains Ground",
    description: "The total stablecoin market capitalization has reached $250 billion, with USDC narrowing the gap on USDT. Circle's regulatory-first approach and MiCA compliance have driven institutional preference for USDC in European markets.",
    url: "https://app.chaingpt.org/news/10009",
    pubDate: "2026-04-20T11:00:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10009.jpg",
    createdAt: "2026-04-20T11:00:00.000Z",
    updatedAt: "2026-04-20T11:05:00.000Z",
    isPublished: true,
    isFeatured: false,
    isTopStory: false,
    viewsCount: 4567,
    categoryId: 9,
    subCategoryId: 15,
    tokenId: 50,
    category: { id: 9, name: "Stablecoins" },
    subCategory: { id: 15, name: "Ethereum" },
    token: { id: 50, name: "USD Coin", symbol: "USDC" },
    media: { thumbnail: "https://cdn.chaingpt.org/news/10009_thumb.jpg", original: "https://cdn.chaingpt.org/news/10009.jpg" },
    newsTags: ["stablecoin", "usdc", "usdt", "market-cap"]
  },
  {
    id: 10010,
    title: "Smart Contract Exploits Drop 60% YoY Thanks to AI Auditing",
    description: "A new report shows that smart contract exploits have decreased by 60% year-over-year, attributed largely to the adoption of AI-powered auditing tools. ChainGPT's Smart Contract Auditor and similar platforms have helped developers identify vulnerabilities before deployment.",
    url: "https://app.chaingpt.org/news/10010",
    pubDate: "2026-04-19T13:15:00.000Z",
    author: "ChainGPT AI",
    imageUrl: "https://cdn.chaingpt.org/news/10010.jpg",
    createdAt: "2026-04-19T13:15:00.000Z",
    updatedAt: "2026-04-19T13:20:00.000Z",
    isPublished: true,
    isFeatured: true,
    isTopStory: false,
    viewsCount: 9876,
    categoryId: 66,
    subCategoryId: null,
    tokenId: null,
    category: { id: 66, name: "Smart Contracts" },
    subCategory: null,
    token: null,
    media: { thumbnail: "https://cdn.chaingpt.org/news/10010_thumb.jpg", original: "https://cdn.chaingpt.org/news/10010.jpg" },
    newsTags: ["security", "audit", "ai", "smart-contracts"]
  }
];

// ─── Supported Chains ──────────────────────────────────────────────
export const supportedChains = [
  { name: "Ethereum", chainId: 1 },
  { name: "Cronos", chainId: 25 },
  { name: "BSC", chainId: 56 },
  { name: "Viction", chainId: 88 },
  { name: "Polygon", chainId: 137 },
  { name: "Sonic", chainId: 146 },
  { name: "X Layer", chainId: 196 },
  { name: "BTTC", chainId: 199 },
  { name: "opBNB", chainId: 204 },
  { name: "Hedera", chainId: 295 },
  { name: "5ire", chainId: 995 },
  { name: "COREDAO", chainId: 1116 },
  { name: "Sei", chainId: 1329 },
  { name: "Mantle", chainId: 5000 },
  { name: "Base", chainId: 8453 },
  { name: "Immutable", chainId: 13371 },
  { name: "Arbitrum", chainId: 42161 },
  { name: "Avalanche", chainId: 43114 },
  { name: "Linea", chainId: 59144 },
  { name: "Bera Chain", chainId: 80094 },
  { name: "Scroll", chainId: 534352 },
  { name: "SKALE", chainId: 1350216234 }
];

// ─── Simplified ABI ────────────────────────────────────────────────
export const simplifiedABI = [
  {
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "baseURI", type: "string" },
      { name: "maxSupply", type: "uint256" }
    ],
    name: "createCollection",
    outputs: [{ name: "collectionAddress", type: "address" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "collectionAddress", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenURI", type: "string" }
    ],
    name: "mint",
    outputs: [{ name: "tokenId", type: "uint256" }],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      { name: "collectionAddress", type: "address" },
      { name: "to", type: "address[]" },
      { name: "tokenURIs", type: "string[]" }
    ],
    name: "batchMint",
    outputs: [{ name: "tokenIds", type: "uint256[]" }],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ name: "collectionAddress", type: "address" }],
    name: "getCollectionInfo",
    outputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "totalSupply", type: "uint256" },
      { name: "maxSupply", type: "uint256" },
      { name: "owner", type: "address" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "name", type: "string" }
    ],
    name: "CollectionCreated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "tokenId", type: "uint256" }
    ],
    name: "NFTMinted",
    type: "event"
  }
];

// ─── Chat History ──────────────────────────────────────────────────
export const sampleChatHistory = [
  {
    id: "ch_001",
    sdkUniqueId: "session-abc123",
    user: "What is the current Bitcoin price?",
    bot: "Bitcoin is currently trading at approximately $98,750...",
    model: "general_assistant",
    createdAt: "2026-04-24T08:00:00.000Z"
  },
  {
    id: "ch_002",
    sdkUniqueId: "session-abc123",
    user: "How does Ethereum staking work?",
    bot: "Ethereum staking involves depositing 32 ETH to run a validator node...",
    model: "general_assistant",
    createdAt: "2026-04-24T07:55:00.000Z"
  },
  {
    id: "ch_003",
    sdkUniqueId: "session-def456",
    user: "Create an ERC-721 contract with royalties",
    bot: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;...",
    model: "smart_contract_generator",
    createdAt: "2026-04-24T07:50:00.000Z"
  },
  {
    id: "ch_004",
    sdkUniqueId: "session-def456",
    user: "Audit this token sale contract",
    bot: "## Audit Report\n\nOverall Score: 85/100...",
    model: "smart_contract_auditor",
    createdAt: "2026-04-24T07:45:00.000Z"
  },
  {
    id: "ch_005",
    sdkUniqueId: "session-ghi789",
    user: "What are the top DeFi protocols right now?",
    bot: "The top DeFi protocols by TVL are: 1. Lido ($33.2B)...",
    model: "general_assistant",
    createdAt: "2026-04-24T07:40:00.000Z"
  }
];

// ─── Prompt Enhancement Prefixes ───────────────────────────────────
export const promptEnhancements = [
  "Ultra-detailed, photorealistic digital painting of",
  "Stunning cinematic 8K render of",
  "Masterfully crafted high-resolution artwork depicting",
  "Award-winning digital illustration featuring",
  "Breathtaking hyperrealistic concept art of"
];

export const promptSuffixes = [
  ", volumetric lighting, ray tracing, octane render, trending on ArtStation",
  ", dramatic studio lighting, professional color grading, 4K ultra HD",
  ", ambient occlusion, global illumination, cinematic composition, masterpiece quality",
  ", intricate details, vibrant colors, depth of field, professional digital art",
  ", atmospheric perspective, golden hour lighting, ultra-sharp focus, award-winning photography"
];

// ─── Credit Cost Map ───────────────────────────────────────────────
export const creditCosts: Record<string, number> = {
  "chat:general_assistant": 0.5,
  "chat:general_assistant:history": 1.0,
  "chat:smart_contract_generator": 1.0,
  "chat:smart_contract_generator:history": 2.0,
  "chat:smart_contract_auditor": 2.0,
  "chat:smart_contract_auditor:history": 4.0,
  "chat:chatHistory": 0,
  "nft:generate-image": 1.0,
  "nft:generate-multiple-images": 1.0,  // per image
  "nft:generate-nft-queue": 1.0,       // per image
  "nft:progress": 0,
  "nft:mint-nft": 0,
  "nft:enhancePrompt": 0.5,
  "nft:get-chains": 0,
  "nft:abi": 0,
  "news": 0.1
};

// ─── Placeholder PNG ───────────────────────────────────────────────
// A valid 1x1 purple PNG (smallest possible valid PNG)
// This is the raw byte representation of a tiny PNG file
export const placeholderPngBytes: number[] = [
  137, 80, 78, 71, 13, 10, 26, 10,   // PNG signature
  0, 0, 0, 13, 73, 72, 68, 82,       // IHDR chunk
  0, 0, 0, 1, 0, 0, 0, 1,            // 1x1 pixels
  8, 2, 0, 0, 0, 144, 119, 83,       // 8-bit RGB
  222, 0, 0, 0, 12, 73, 68, 65,      // IDAT chunk
  84, 8, 215, 99, 104, 96, 248,      // compressed data (purple pixel)
  15, 0, 0, 3, 1, 1, 0, 120,         //
  171, 212, 71, 0, 0, 0, 0, 73,      // IEND chunk
  69, 78, 68, 174, 66, 96, 130       //
];
