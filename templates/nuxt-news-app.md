# Nuxt 3 Crypto News Application Template

Server-side rendered crypto news app with ChainGPT AI News API.

### Project Structure
```
nuxt-crypto-news/
├── package.json
├── nuxt.config.ts
├── tsconfig.json
├── .env.example
├── server/
│   ├── api/
│   │   ├── news.get.ts (proxy to ChainGPT News API)
│   │   └── categories.get.ts (return category maps)
│   └── utils/
│       └── chaingpt.ts (SDK initialization)
├── pages/
│   ├── index.vue (news feed with filters)
│   ├── category/[id].vue (category-specific feed)
│   └── article/[id].vue (article detail)
├── components/
│   ├── NewsCard.vue
│   ├── CategoryFilter.vue
│   ├── BlockchainFilter.vue
│   └── SearchBar.vue
├── composables/
│   └── useNews.ts (data fetching composable)
└── README.md
```

### Dependencies
nuxt, @chaingpt/ainews, @nuxtjs/tailwindcss

### Key Implementation
- **server/api/news.get.ts**: Nitro server route, parses query params, calls AINews SDK, returns JSON. Caches results for 5 minutes with Nuxt's built-in caching.
- **pages/index.vue**: SSR-rendered news feed, filter chips for categories (DeFi=5, NFT=8, Gaming=2, Exchange=78), blockchain filter dropdown, infinite scroll pagination
- **composables/useNews.ts**: useFetch wrapper with reactive filters
- **CategoryFilter.vue**: Chip-based multi-select with all 24 category IDs
- **BlockchainFilter.vue**: Dropdown with key blockchain IDs (Bitcoin=11, Ethereum=15, Solana=22, BNB=12, etc.)
- **RSS integration**: Also display RSS feed URL for each filter combination

Include all category/subcategory/token ID maps inline in the template so Claude generates complete filter components.
