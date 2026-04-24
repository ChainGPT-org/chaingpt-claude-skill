# Crypto News Dashboard Template

Instructions for Claude to scaffold a complete crypto news dashboard with a backend API and vanilla frontend using the ChainGPT AI News SDK.

---

## What to Generate

### Project Structure

```
chaingpt-news-dashboard/
├── package.json
├── .env.example
├── tsconfig.json
├── src/
│   ├── index.ts          # Express server + static file serving
│   ├── newsService.ts    # ChainGPT News SDK wrapper with caching
│   └── routes.ts         # API route definitions
├── public/
│   ├── index.html        # Dashboard UI
│   ├── style.css         # Responsive styles
│   └── app.js            # Frontend JS (fetch + render)
└── README.md
```

### Dependencies

**Production:**
- `@chaingpt/ainews` — ChainGPT AI News SDK
- `express` — HTTP server + static file serving
- `dotenv` — environment variables
- `cors` — cross-origin support
- `node-cron` — optional scheduled auto-refresh for cache warming

**Dev:**
- `typescript`
- `ts-node`
- `@types/express`
- `nodemon`

### package.json scripts

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

---

## Backend Implementation

### src/newsService.ts

```typescript
import { AINews } from "@chaingpt/ainews";

const news = new AINews({ apiKey: process.env.CHAINGPT_API_KEY! });
```

**getNews(filters: NewsFilters): Promise\<NewsResponse\>**
- Call `news.getNews()` with parameters mapped from the filters object
- Parameters: `categoryId`, `subCategoryId`, `tokenId`, `searchQuery`, `fetchAfter`, `limit`, `offset`, `sortBy`
- Return the full response including `data`, `total`, `limit`, `offset`

**In-memory TTL cache (optional but recommended to reduce credit usage):**
```typescript
const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(filters: NewsFilters): string {
  return JSON.stringify(filters);
}

async function getNewsCached(filters: NewsFilters) {
  const key = getCacheKey(filters);
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.data;

  const result = await news.getNews(filters);
  cache.set(key, { data: result, expiry: Date.now() + CACHE_TTL });
  return result;
}
```

**Error handling:**
```typescript
import { Errors } from "@chaingpt/ainews";
// Catch Errors.AINewsError for SDK-specific errors
```

### src/routes.ts

**GET /api/news**
- Query params: `categoryId`, `subCategoryId`, `tokenId`, `limit` (default 20), `offset` (default 0), `searchQuery`, `fetchAfter`, `sortBy`
- Parse array params: `categoryId=5,8` should become `[5, 8]`
- Proxy to newsService.getNewsCached()
- Return JSON response

**GET /api/categories**
- Return the static category/subcategory/token ID maps as JSON (hardcoded from reference data below)
- This avoids extra API calls and gives the frontend everything it needs for filter dropdowns

**GET /api/rss**
- Return the list of available RSS feed URLs:
```json
{
  "feeds": {
    "all": "https://app.chaingpt.org/rss",
    "defi": "https://app.chaingpt.org/rss?categoryId=5",
    "nft": "https://app.chaingpt.org/rss?categoryId=8",
    "gaming": "https://app.chaingpt.org/rss?categoryId=2"
  }
}
```

### src/index.ts

- Express app serving both API routes and static files from `public/`
- `express.static("public")` for the frontend
- Mount API routes under `/api`
- Optional: `node-cron` job to warm the cache every 5 minutes with a default news fetch

---

## Frontend Implementation

### public/index.html

A clean, single-page dashboard:
- Header with "Crypto News Dashboard" title and "Powered by ChainGPT AI" subtitle
- Filter bar with:
  - Category dropdown (DeFi, NFT, Gaming, DAO, etc.)
  - Blockchain dropdown (Ethereum, BSC, Solana, etc.)
  - Token dropdown (BTC, ETH, SOL, etc.)
  - Search input field
  - "Refresh" button
  - Auto-refresh toggle (checkbox, refreshes every 60 seconds)
- News card grid (responsive, 1-3 columns depending on viewport)
- Pagination controls (Previous / Next with page indicator)
- Loading spinner during fetches
- Empty state message when no results

### public/style.css

Responsive, no-framework CSS:
- CSS custom properties for colors (easy theming):
  ```css
  :root {
    --bg-primary: #0f1117;
    --bg-card: #1a1d27;
    --text-primary: #e4e6eb;
    --text-secondary: #8b8fa3;
    --accent: #4f8cff;
    --accent-hover: #3a7af0;
    --border: #2a2d3a;
  }
  ```
- Dark theme by default (crypto/Web3 convention)
- Mobile-first: single column below 640px, two columns 640-1024px, three columns above
- Card style: image thumbnail, title, description (truncated), source, relative time, category badge
- Filter bar wraps gracefully on mobile

### public/app.js

Vanilla JavaScript (no build step required):

```javascript
// Category/Subcategory/Token ID maps — inline for filter dropdowns
const CATEGORIES = {
  2: "Blockchain Gaming", 3: "DAO", 4: "DApps", 5: "DeFi",
  6: "Lending", 7: "Metaverse", 8: "NFT", 9: "Stablecoins",
  64: "Cryptocurrency", 66: "Smart Contracts", 74: "Web3.0", 78: "Exchange"
};

const BLOCKCHAINS = {
  11: "Bitcoin", 12: "BNB Chain", 13: "Cardano", 15: "Ethereum",
  20: "Polygon", 22: "Solana", 28: "Arbitrum", 31: "Avalanche",
  32: "Base", 35: "Sui", 36: "Aptos", 37: "zkSync",
  44: "Blast", 45: "Optimism", 46: "TON", 49: "Berachain"
};

const TOKENS = {
  79: "BTC", 80: "ETH", 81: "USDT", 82: "BNB", 83: "XRP",
  84: "ADA", 85: "SOL", 86: "TRX", 87: "DOGE", 88: "DOT",
  89: "MATIC", 92: "AVAX", 94: "UNI", 96: "LINK", 108: "CGPT"
};
```

**Functions to implement:**
- `populateFilters()` — fill dropdowns from the maps above
- `fetchNews(filters)` — GET `/api/news` with query params, handle loading state
- `renderCards(articles)` — create card elements from article data
- `formatTimeAgo(dateString)` — "2 hours ago", "3 days ago" etc.
- `handleFilterChange()` — debounced, triggers fetchNews with current filter values
- `setupAutoRefresh()` — setInterval that calls fetchNews, controlled by toggle
- `handlePagination(direction)` — update offset and re-fetch

**Card rendering:**
```javascript
function renderCard(article) {
  return `
    <div class="news-card">
      <img src="${article.imageUrl || article.media?.thumbnail || ''}"
           alt="${article.title}" class="card-image" loading="lazy">
      <div class="card-body">
        <span class="card-category">${article.category?.name || ''}</span>
        <h3 class="card-title">${article.title}</h3>
        <p class="card-desc">${truncate(article.description, 120)}</p>
        <div class="card-footer">
          <span class="card-time">${formatTimeAgo(article.pubDate)}</span>
          <a href="${article.url}" target="_blank" class="card-link">Read more</a>
        </div>
      </div>
    </div>
  `;
}
```

---

## Category/Subcategory/Token ID Reference

Include these as constants in both backend and frontend:

### Categories
| ID | Name |
|----|------|
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

### Blockchains (Sub-Categories)
| ID | Name |
|----|------|
| 11 | Bitcoin |
| 12 | BNB Chain |
| 13 | Cardano |
| 14 | EOS |
| 15 | Ethereum |
| 16 | Hedera |
| 20 | Polygon |
| 22 | Solana |
| 28 | Arbitrum |
| 29 | Polkadot |
| 30 | NEAR Protocol |
| 31 | Avalanche |
| 32 | Base |
| 35 | Sui |
| 36 | Aptos |
| 37 | zkSync |
| 38 | StarkNet |
| 39 | Sei |
| 40 | Mantle |
| 44 | Blast |
| 45 | Optimism |
| 46 | TON |
| 49 | Berachain |

### Tokens
| ID | Symbol |
|----|--------|
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
| 92 | AVAX |
| 94 | UNI |
| 96 | LINK |
| 108 | CGPT |

---

## .env.example

```
CHAINGPT_API_KEY=your_api_key_here
PORT=3002
CACHE_TTL_MS=300000
AUTO_REFRESH_CRON=*/5 * * * *
```

---

## Usage Instructions

```bash
npm install
cp .env.example .env  # Add your ChainGPT API key
npm run dev
# Open http://localhost:3002 in your browser
```

API usage:
```bash
# Get latest DeFi news
curl "http://localhost:3002/api/news?categoryId=5&limit=10"

# Search for Ethereum staking news
curl "http://localhost:3002/api/news?searchQuery=staking&subCategoryId=15"

# Get category maps
curl "http://localhost:3002/api/categories"
```

---

## SDK Reference Notes

- SDK: `@chaingpt/ainews`, class `AINews`
- REST endpoint: `GET https://api.chaingpt.org/news`
- Response shape: `{ status, data: [articles], total, limit, offset }`
- Each article has: id, title, description, url, pubDate, imageUrl, category, subCategory, token, media, newsTags
- Free RSS feeds available at `https://app.chaingpt.org/rss` (no API key needed)
- Error class: `Errors.AINewsError`
