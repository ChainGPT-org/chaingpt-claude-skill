# AI Crypto News - API, SDK & RSS Reference

## Overview

The ChainGPT AI News API provides AI-curated cryptocurrency and blockchain news with filtering by category, blockchain, and token. Available via REST API, JavaScript/Python SDKs, and free RSS feeds.

---

## REST API

### Get News

```
GET https://api.chaingpt.org/news
Authorization: Bearer <API_KEY>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `categoryId` | int or int[] | - | Filter by category (see table below) |
| `subCategoryId` | int or int[] | - | Filter by blockchain/sub-category |
| `tokenId` | int or int[] | - | Filter by token |
| `searchQuery` | string | - | Full-text search |
| `fetchAfter` | string | - | Date filter, format `YYYY-MM-DD` |
| `limit` | int | 10 | Number of articles to return |
| `offset` | int | 0 | Pagination offset |
| `sortBy` | string | `"createdAt"` | Sort field |

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "id": 12345,
      "title": "Ethereum Gas Fees Hit New Low After Dencun Upgrade",
      "description": "AI-generated summary of the article...",
      "url": "https://app.chaingpt.org/news/12345",
      "pubDate": "2025-03-15T10:30:00.000Z",
      "author": "ChainGPT AI",
      "imageUrl": "https://cdn.chaingpt.org/news/12345.jpg",
      "createdAt": "2025-03-15T10:30:00.000Z",
      "updatedAt": "2025-03-15T10:35:00.000Z",
      "isPublished": true,
      "isFeatured": false,
      "isTopStory": true,
      "viewsCount": 4521,
      "categoryId": 5,
      "subCategoryId": 15,
      "tokenId": 80,
      "category": { "id": 5, "name": "DeFi" },
      "subCategory": { "id": 15, "name": "Ethereum" },
      "token": { "id": 80, "name": "ETH", "symbol": "ETH" },
      "media": { "thumbnail": "...", "original": "..." },
      "newsTags": ["ethereum", "gas-fees", "dencun"]
    }
  ],
  "total": 1542,
  "limit": 10,
  "offset": 0
}
```

---

## Category IDs

| ID | Category |
|----|----------|
| 2 | Blockchain Gaming |
| 3 | DAO |
| 4 | DApps |
| 5 | DeFi |
| 6 | Lending |
| 7 | Metaverse |
| 8 | NFT |
| 9 | Stablecoins |
| 64 | Cryptocurrency |
| 66 | Smart Contracts |
| 74 | Web3.0 |
| 78 | Exchange |

---

## Sub-Category IDs (Blockchains)

| ID | Blockchain |
|----|------------|
| 11 | Bitcoin |
| 12 | BNB Chain |
| 13 | Cardano |
| 14 | EOS |
| 15 | Ethereum |
| 16 | Hedera |
| 17 | Hyperledger |
| 18 | Litecoin |
| 19 | Monero |
| 20 | Polygon |
| 21 | Ripple |
| 22 | Solana |
| 23 | Stellar |
| 24 | TRON |
| 25 | VeChain |
| 26 | Tezos |
| 27 | Cosmos |
| 28 | Arbitrum |
| 29 | Polkadot |
| 30 | NEAR Protocol |
| 31 | Avalanche |
| 32 | Base |
| 33 | Fantom |
| 34 | Algorand |
| 35 | Sui |
| 36 | Aptos |
| 37 | zkSync |
| 38 | StarkNet |
| 39 | Sei |
| 40 | Mantle |
| 41 | Linea |
| 42 | Scroll |
| 43 | Manta |
| 44 | Blast |
| 45 | Optimism |
| 46 | TON |
| 47 | Injective |
| 48 | Celestia |
| 49 | Berachain |
| 50 | Monad |

---

## Token IDs

| ID | Token |
|----|-------|
| 79 | BTC |
| 80 | ETH |
| 81 | USDT |
| 82 | BNB |
| 83 | XRP |
| 84 | ADA |
| 85 | SOL |
| 86 | TRX |
| 87 | DOGE |
| 88 | DOT |
| 89 | MATIC |
| 90 | LTC |
| 91 | SHIB |
| 92 | AVAX (mapped as 100 in some endpoints) |
| 93 | ATOM |
| 94 | UNI |
| 95 | XLM |
| 96 | LINK |
| 97 | XMR |
| 98 | ALGO |
| 99 | FIL |
| 100 | AVAX |
| 101 | NEAR |
| 102 | APT |
| 103 | SUI |
| 104 | SEI |
| 105 | INJ |
| 106 | TIA |
| 107 | TON |
| 108 | CGPT |

---

## JavaScript SDK

### Installation

```bash
npm install --save @chaingpt/ainews
```

### Initialization

```javascript
const { AINews } = require("@chaingpt/ainews");

const news = new AINews({
  apiKey: "YOUR_API_KEY",
});
```

### Methods

#### getNews(options)

```javascript
const response = await news.getNews({
  categoryId: 5,          // DeFi
  subCategoryId: 15,      // Ethereum
  tokenId: 80,            // ETH
  searchQuery: "staking",
  fetchAfter: "2025-03-01",
  limit: 20,
  offset: 0,
  sortBy: "createdAt",
});

console.log(`Total: ${response.total}`);
response.data.forEach((article) => {
  console.log(`${article.title} - ${article.pubDate}`);
});
```

### Error Handling

```javascript
const { Errors } = require("@chaingpt/ainews");

try {
  const response = await news.getNews({ limit: 10 });
} catch (error) {
  if (error instanceof Errors.AINewsError) {
    console.error("News API error:", error.message);
  }
}
```

---

## Python SDK

### Installation

```bash
pip install chaingpt
```

### Initialization

```python
from chaingpt import ChainGPTClient

client = ChainGPTClient(api_key="YOUR_API_KEY")
```

### Methods

#### get_news

```python
response = client.news.get_news(
    category_id=5,          # DeFi
    sub_category_id=15,     # Ethereum
    token_id=80,            # ETH
    search_query="staking",
    fetch_after="2025-03-01",
    limit=20,
    offset=0,
    sort_by="createdAt"
)

# Response is GetNewsResponseModel
print(f"Total articles: {response.total}")
print(f"Returned: {response.limit}, offset: {response.offset}")

for article in response.data:
    print(f"{article.title} ({article.pub_date})")
```

---

## RSS Feeds (Free, No Auth Required)

Standard RSS 2.0 feeds, no API key needed.

| Feed | URL |
|------|-----|
| All News | `https://app.chaingpt.org/rssfeeds.xml` |
| Bitcoin | `https://app.chaingpt.org/rssfeeds-bitcoin.xml` |
| BNB Chain | `https://app.chaingpt.org/rssfeeds-bnb.xml` |
| Ethereum | `https://app.chaingpt.org/rssfeeds-ethereum.xml` |

- 30-day article retention
- Poll interval: every 5-10 minutes recommended
- Standard RSS 2.0 format compatible with all feed readers

---

## cURL Examples

### Get Latest News (All Categories)

```bash
curl -X GET "https://api.chaingpt.org/news?limit=10&offset=0&sortBy=createdAt" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Filter by Category (DeFi)

```bash
curl -X GET "https://api.chaingpt.org/news?categoryId=5&limit=15" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Filter by Multiple Categories

```bash
curl -X GET "https://api.chaingpt.org/news?categoryId=5&categoryId=8&limit=20" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Filter by Blockchain (Ethereum + Solana)

```bash
curl -X GET "https://api.chaingpt.org/news?subCategoryId=15&subCategoryId=22&limit=25" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Filter by Token (BTC News)

```bash
curl -X GET "https://api.chaingpt.org/news?tokenId=79&limit=10" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Search with Date Filter

```bash
curl -X GET "https://api.chaingpt.org/news?searchQuery=layer%202%20scaling&fetchAfter=2025-03-01&limit=10" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Combined Filters (DeFi + Ethereum + ETH Token + Search)

```bash
curl -X GET "https://api.chaingpt.org/news?categoryId=5&subCategoryId=15&tokenId=80&searchQuery=restaking&fetchAfter=2025-02-01&limit=10&sortBy=createdAt" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Full JavaScript Examples

### Latest Headlines Across Categories

```javascript
const { AINews } = require("@chaingpt/ainews");

async function getHeadlines() {
  const news = new AINews({ apiKey: process.env.CHAINGPT_API_KEY });

  const categories = [
    { id: 5, name: "DeFi" },
    { id: 8, name: "NFT" },
    { id: 64, name: "Cryptocurrency" },
    { id: 78, name: "Exchange" },
  ];

  for (const cat of categories) {
    const response = await news.getNews({
      categoryId: cat.id,
      limit: 3,
    });

    console.log(`\n=== ${cat.name} ===`);
    response.data.forEach((article) => {
      console.log(`  ${article.title}`);
      console.log(`  ${article.url}\n`);
    });
  }
}

getHeadlines();
```

### Multi-Token Tracker

```javascript
const { AINews } = require("@chaingpt/ainews");

async function trackTokens() {
  const news = new AINews({ apiKey: process.env.CHAINGPT_API_KEY });

  // Get news for BTC, ETH, and SOL
  const response = await news.getNews({
    tokenId: [79, 80, 85],
    fetchAfter: "2025-03-01",
    limit: 25,
    sortBy: "createdAt",
  });

  console.log(`Found ${response.total} articles`);
  response.data.forEach((article) => {
    const tokenName = article.token?.symbol || "N/A";
    console.log(`[${tokenName}] ${article.title} - ${article.pubDate}`);
  });
}

trackTokens();
```

---

## Full Python Examples

### Daily News Digest

```python
from chaingpt import ChainGPTClient
from datetime import datetime, timedelta

client = ChainGPTClient(api_key="YOUR_API_KEY")

yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

# Get top stories from yesterday
response = client.news.get_news(
    fetch_after=yesterday,
    limit=25,
    sort_by="createdAt"
)

print(f"News Digest - {yesterday}")
print(f"Total articles: {response.total}\n")

for i, article in enumerate(response.data, 1):
    print(f"{i}. {article.title}")
    if article.is_top_story:
        print("   [TOP STORY]")
    print(f"   Category: {article.category.name if article.category else 'N/A'}")
    print(f"   {article.url}\n")
```

### Blockchain-Specific News Monitor

```python
from chaingpt import ChainGPTClient

client = ChainGPTClient(api_key="YOUR_API_KEY")

blockchains = {
    "Ethereum": 15,
    "Solana": 22,
    "Arbitrum": 28,
    "Base": 32,
    "Avalanche": 31,
}

for chain_name, chain_id in blockchains.items():
    response = client.news.get_news(
        sub_category_id=chain_id,
        limit=5
    )
    
    print(f"\n{'='*50}")
    print(f" {chain_name} ({response.total} total articles)")
    print(f"{'='*50}")
    
    for article in response.data:
        print(f"  - {article.title}")
        print(f"    Views: {article.views_count} | {article.pub_date}")
```

### DeFi + NFT Combined Search

```python
from chaingpt import ChainGPTClient

client = ChainGPTClient(api_key="YOUR_API_KEY")

# Search across DeFi (5) and NFT (8) categories
response = client.news.get_news(
    category_id=[5, 8],
    search_query="airdrop",
    fetch_after="2025-03-01",
    limit=20
)

print(f"Found {response.total} articles about airdrops in DeFi/NFT")
for article in response.data:
    tags = ", ".join(article.news_tags) if article.news_tags else "none"
    print(f"  {article.title}")
    print(f"  Tags: {tags}")
    print(f"  Featured: {article.is_featured} | Top: {article.is_top_story}\n")
```

---

## Pricing

| Action | Cost |
|--------|------|
| News retrieval (per 10 records) | 1 credit |
| Example: limit=25 | 3 credits |
| Example: limit=10 | 1 credit |
| Example: limit=1 | 1 credit |
| RSS feeds | Free (no auth) |
| Rate limit | 200 requests/min |

Credits are charged per 10 records returned (rounded up). Setting `limit=25` costs 3 credits. Setting `limit=10` costs 1 credit.

---

## Response Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | int | Unique article ID |
| `title` | string | Article headline |
| `description` | string | AI-generated article summary |
| `url` | string | Full article URL |
| `pubDate` | string (ISO 8601) | Publication date |
| `author` | string | Author name |
| `imageUrl` | string | Featured image URL |
| `createdAt` | string (ISO 8601) | Creation timestamp |
| `updatedAt` | string (ISO 8601) | Last update timestamp |
| `isPublished` | boolean | Publication status |
| `isFeatured` | boolean | Featured article flag |
| `isTopStory` | boolean | Top story flag |
| `viewsCount` | int | Number of views |
| `categoryId` | int | Category ID |
| `subCategoryId` | int | Sub-category (blockchain) ID |
| `tokenId` | int | Token ID |
| `category` | object | `{ id, name }` |
| `subCategory` | object | `{ id, name }` |
| `token` | object | `{ id, name, symbol }` |
| `media` | object | `{ thumbnail, original }` |
| `newsTags` | string[] | Array of tag strings |

---

## Response Examples

### GET /news — Success (Multiple Articles)

```json
{
  "status": "success",
  "data": [
    {
      "id": 28473,
      "title": "Ethereum Layer 2 TVL Surpasses $50 Billion as Arbitrum and Base Lead Growth",
      "description": "The total value locked across Ethereum Layer 2 networks has crossed the $50 billion milestone for the first time, with Arbitrum holding $21.3B and Base reaching $12.8B. The surge is attributed to increased DeFi activity and lower transaction costs following the Dencun upgrade's blob fee reduction.",
      "url": "https://app.chaingpt.org/news/28473",
      "pubDate": "2026-04-24T08:15:00.000Z",
      "author": "ChainGPT AI",
      "imageUrl": "https://cdn.chaingpt.org/news/28473.jpg",
      "createdAt": "2026-04-24T08:15:00.000Z",
      "updatedAt": "2026-04-24T08:20:12.000Z",
      "isPublished": true,
      "isFeatured": true,
      "isTopStory": true,
      "viewsCount": 8742,
      "categoryId": 5,
      "subCategoryId": 15,
      "tokenId": 80,
      "category": { "id": 5, "name": "DeFi" },
      "subCategory": { "id": 15, "name": "Ethereum" },
      "token": { "id": 80, "name": "ETH", "symbol": "ETH" },
      "media": {
        "thumbnail": "https://cdn.chaingpt.org/news/28473_thumb.jpg",
        "original": "https://cdn.chaingpt.org/news/28473.jpg"
      },
      "newsTags": ["ethereum", "layer-2", "arbitrum", "base", "tvl"]
    },
    {
      "id": 28471,
      "title": "Solana DEX Volume Hits Record $14.2B in 24 Hours Amid Memecoin Frenzy",
      "description": "Decentralized exchange trading volume on Solana has reached an all-time high of $14.2 billion in the past 24 hours. Raydium and Jupiter accounted for 78% of the volume, driven by a wave of memecoin launches and speculative trading activity.",
      "url": "https://app.chaingpt.org/news/28471",
      "pubDate": "2026-04-24T06:45:00.000Z",
      "author": "ChainGPT AI",
      "imageUrl": "https://cdn.chaingpt.org/news/28471.jpg",
      "createdAt": "2026-04-24T06:45:00.000Z",
      "updatedAt": "2026-04-24T06:50:30.000Z",
      "isPublished": true,
      "isFeatured": false,
      "isTopStory": false,
      "viewsCount": 5219,
      "categoryId": 5,
      "subCategoryId": 22,
      "tokenId": 85,
      "category": { "id": 5, "name": "DeFi" },
      "subCategory": { "id": 22, "name": "Solana" },
      "token": { "id": 85, "name": "SOL", "symbol": "SOL" },
      "media": {
        "thumbnail": "https://cdn.chaingpt.org/news/28471_thumb.jpg",
        "original": "https://cdn.chaingpt.org/news/28471.jpg"
      },
      "newsTags": ["solana", "dex", "raydium", "jupiter", "memecoin"]
    }
  ],
  "total": 1542,
  "limit": 10,
  "offset": 0
}
```

### GET /news — Filtered by Token (Single Result)

```json
{
  "status": "success",
  "data": [
    {
      "id": 28465,
      "title": "Bitcoin Mining Difficulty Reaches All-Time High After Fourth Halving Adjustment",
      "description": "Bitcoin's mining difficulty has adjusted upward by 3.2% to a record 92.7 trillion, reflecting continued hashrate growth despite compressed miner margins post-halving. Analysts note that large-scale miners with access to cheap energy remain profitable while smaller operations face increasing pressure.",
      "url": "https://app.chaingpt.org/news/28465",
      "pubDate": "2026-04-23T22:10:00.000Z",
      "author": "ChainGPT AI",
      "imageUrl": "https://cdn.chaingpt.org/news/28465.jpg",
      "createdAt": "2026-04-23T22:10:00.000Z",
      "updatedAt": "2026-04-23T22:15:00.000Z",
      "isPublished": true,
      "isFeatured": false,
      "isTopStory": true,
      "viewsCount": 12340,
      "categoryId": 64,
      "subCategoryId": 11,
      "tokenId": 79,
      "category": { "id": 64, "name": "Cryptocurrency" },
      "subCategory": { "id": 11, "name": "Bitcoin" },
      "token": { "id": 79, "name": "BTC", "symbol": "BTC" },
      "media": {
        "thumbnail": "https://cdn.chaingpt.org/news/28465_thumb.jpg",
        "original": "https://cdn.chaingpt.org/news/28465.jpg"
      },
      "newsTags": ["bitcoin", "mining", "difficulty", "halving"]
    }
  ],
  "total": 387,
  "limit": 1,
  "offset": 0
}
```

### Error — Invalid API Key

```json
{
  "status": false,
  "message": "Unauthorized: Invalid API key"
}
```

### Error — Invalid Category ID

```json
{
  "status": false,
  "message": "Validation error: 'categoryId' value 999 is not a valid category"
}
```
