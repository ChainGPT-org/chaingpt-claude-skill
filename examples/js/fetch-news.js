/**
 * ChainGPT AI Crypto News — Fetch & Filter Example
 *
 * Demonstrates: filtered queries, multi-category, date ranges, pagination
 * Install: npm install @chaingpt/ainews dotenv
 */
import 'dotenv/config';
import { AINews, Errors } from '@chaingpt/ainews';

const news = new AINews({ apiKey: process.env.CHAINGPT_API_KEY });

// Category IDs for reference
const CATEGORIES = {
  BLOCKCHAIN_GAMING: 2, DAO: 3, DAPPS: 4, DEFI: 5,
  LENDING: 6, METAVERSE: 7, NFT: 8, STABLECOINS: 9,
  CRYPTOCURRENCY: 64, SMART_CONTRACTS: 66, WEB3: 74, EXCHANGE: 78
};

const BLOCKCHAINS = {
  BITCOIN: 11, BNB_CHAIN: 12, ETHEREUM: 15, POLYGON: 20,
  SOLANA: 22, ARBITRUM: 28, AVALANCHE: 31, BASE: 32, OPTIMISM: 45
};

const TOKENS = {
  BTC: 79, ETH: 80, USDT: 81, BNB: 82, XRP: 83,
  SOL: 85, DOGE: 87, LINK: 96, AVAX: 92
};

// 1. Latest DeFi news
async function defiNews() {
  const res = await news.getNews({
    categoryId: [CATEGORIES.DEFI],
    limit: 5,
    sortBy: 'createdAt'
  });
  console.log('=== Latest DeFi News ===');
  res.data.forEach(article => {
    console.log(`  ${article.title}`);
    console.log(`  ${article.url}\n`);
  });
}

// 2. Ethereum-specific news about a token
async function ethTokenNews() {
  const res = await news.getNews({
    subCategoryId: [BLOCKCHAINS.ETHEREUM],
    tokenId: [TOKENS.ETH],
    limit: 10
  });
  console.log('=== ETH on Ethereum ===');
  res.data.forEach(a => console.log(`  [${a.pubDate}] ${a.title}`));
}

// 3. Search with keyword
async function searchNews(query) {
  const res = await news.getNews({
    searchQuery: query,
    limit: 10
  });
  console.log(`=== Search: "${query}" ===`);
  res.data.forEach(a => console.log(`  ${a.title} — ${a.url}`));
}

// 4. Paginated fetch (all news in last 7 days)
async function recentNewsPaginated() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let offset = 0;
  const limit = 10;
  let total = 0;

  console.log('=== Last 7 Days (paginated) ===');
  let hasMore = true;
  while (hasMore) {
    const res = await news.getNews({
      fetchAfter: weekAgo,
      limit,
      offset
    });
    res.data.forEach(a => console.log(`  ${a.title}`));
    total += res.data.length;
    offset += limit;
    hasMore = res.data.length === limit;
  }
  console.log(`Total articles: ${total}`);
}

(async () => {
  try {
    await defiNews();
    await ethTokenNews();
    await searchNews('Bitcoin ETF');
    // await recentNewsPaginated();  // May use many credits
  } catch (error) {
    if (error instanceof Errors.AINewsError) {
      console.error('News Error:', error.message);
    } else {
      throw error;
    }
  }
})();
