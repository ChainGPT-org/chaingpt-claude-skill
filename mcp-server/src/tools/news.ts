import { AINews } from '@chaingpt/ainews';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const news = new AINews({
  apiKey: process.env.CHAINGPT_API_KEY!,
});

export const newsTools: Tool[] = [
  {
    name: 'chaingpt_news_fetch',
    description:
      'Fetch AI-curated crypto and blockchain news articles. Supports filtering by category, blockchain, token, search text, and date. Costs 1 credit per 10 records returned (rounded up). Use chaingpt_news_categories to look up valid IDs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        categories: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Category IDs to filter by. Common: 5=DeFi, 8=NFT, 64=Cryptocurrency, 78=Exchange, 2=Gaming, 3=DAO, 4=DApps, 6=Lending, 7=Metaverse, 9=Stablecoins, 66=Smart Contracts, 74=Web3',
        },
        blockchains: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Blockchain sub-category IDs. Common: 11=Bitcoin, 12=BNB, 15=Ethereum, 20=Polygon, 22=Solana, 28=Arbitrum, 31=Avalanche, 32=Base, 45=Optimism',
        },
        tokens: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Token IDs. Common: 79=BTC, 80=ETH, 81=USDT, 82=BNB, 83=XRP, 85=SOL, 87=DOGE, 96=LINK, 108=CGPT',
        },
        search: {
          type: 'string',
          description: 'Full-text search query',
        },
        fetchAfter: {
          type: 'string',
          description: 'Only return articles published after this date (YYYY-MM-DD format)',
        },
        limit: {
          type: 'number',
          description: 'Number of articles to return (default 10, max varies). Cost: 1 credit per 10.',
          default: 10,
        },
        offset: {
          type: 'number',
          description: 'Pagination offset',
          default: 0,
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_news_categories',
    description:
      'Get the complete reference list of all category IDs, blockchain IDs, and token IDs for use with chaingpt_news_fetch. Free (0 credits).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

const CATEGORY_MAP: Record<number, string> = {
  2: 'Blockchain Gaming',
  3: 'DAO',
  4: 'DApps',
  5: 'DeFi',
  6: 'Lending',
  7: 'Metaverse',
  8: 'NFT',
  9: 'Stablecoins',
  64: 'Cryptocurrency',
  66: 'Smart Contracts',
  74: 'Web3.0',
  78: 'Exchange',
};

const BLOCKCHAIN_MAP: Record<number, string> = {
  11: 'Bitcoin',
  12: 'BNB Chain',
  13: 'Cardano',
  14: 'EOS',
  15: 'Ethereum',
  16: 'Hedera',
  17: 'Hyperledger',
  18: 'Litecoin',
  19: 'Monero',
  20: 'Polygon',
  21: 'Ripple',
  22: 'Solana',
  23: 'Stellar',
  24: 'TRON',
  25: 'VeChain',
  26: 'Tezos',
  27: 'Cosmos',
  28: 'Arbitrum',
  29: 'Polkadot',
  30: 'NEAR Protocol',
  31: 'Avalanche',
  32: 'Base',
  33: 'Fantom',
  34: 'Algorand',
  35: 'Sui',
  36: 'Aptos',
  37: 'zkSync',
  38: 'StarkNet',
  39: 'Sei',
  40: 'Mantle',
  41: 'Linea',
  42: 'Scroll',
  43: 'Manta',
  44: 'Blast',
  45: 'Optimism',
  46: 'TON',
  47: 'Injective',
  48: 'Celestia',
  49: 'Berachain',
  50: 'Monad',
};

const TOKEN_MAP: Record<number, string> = {
  79: 'BTC',
  80: 'ETH',
  81: 'USDT',
  82: 'BNB',
  83: 'XRP',
  84: 'ADA',
  85: 'SOL',
  86: 'TRX',
  87: 'DOGE',
  88: 'DOT',
  89: 'MATIC',
  90: 'LTC',
  91: 'SHIB',
  92: 'AVAX',
  93: 'ATOM',
  94: 'UNI',
  95: 'XLM',
  96: 'LINK',
  97: 'XMR',
  98: 'ALGO',
  99: 'FIL',
  100: 'AVAX',
  101: 'NEAR',
  102: 'APT',
  103: 'SUI',
  104: 'SEI',
  105: 'INJ',
  106: 'TIA',
  107: 'TON',
  108: 'CGPT',
};

export async function handleNewsTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) args = {};

  try {
    if (name === 'chaingpt_news_categories') {
      const output = [
        '## Category IDs',
        ...Object.entries(CATEGORY_MAP).map(([id, name]) => `  ${id}: ${name}`),
        '',
        '## Blockchain (Sub-Category) IDs',
        ...Object.entries(BLOCKCHAIN_MAP).map(([id, name]) => `  ${id}: ${name}`),
        '',
        '## Token IDs',
        ...Object.entries(TOKEN_MAP).map(([id, name]) => `  ${id}: ${name}`),
      ];

      return { content: [{ type: 'text', text: output.join('\n') }] };
    }

    if (name === 'chaingpt_news_fetch') {
      const params: Record<string, unknown> = {
        limit: (args.limit as number) || 10,
        offset: (args.offset as number) || 0,
        sortBy: 'createdAt',
      };

      // The SDK may accept single values or arrays — pass the first if array
      if (args.categories && Array.isArray(args.categories)) {
        params.categoryId = args.categories.length === 1 ? args.categories[0] : args.categories;
      }
      if (args.blockchains && Array.isArray(args.blockchains)) {
        params.subCategoryId =
          args.blockchains.length === 1 ? args.blockchains[0] : args.blockchains;
      }
      if (args.tokens && Array.isArray(args.tokens)) {
        params.tokenId = args.tokens.length === 1 ? args.tokens[0] : args.tokens;
      }
      if (args.search) params.searchQuery = args.search;
      if (args.fetchAfter) params.fetchAfter = args.fetchAfter;

      const response = await news.getNews(params as any);
      const data = (response as any).data || response;
      const total = (response as any).total;

      if (Array.isArray(data) && data.length > 0) {
        const articles = data.map((article: any, i: number) => {
          const parts = [`${i + 1}. ${article.title}`];
          if (article.description) {
            const desc =
              article.description.length > 300
                ? article.description.substring(0, 300) + '...'
                : article.description;
            parts.push(`   ${desc}`);
          }
          if (article.url) parts.push(`   URL: ${article.url}`);
          if (article.pubDate) parts.push(`   Published: ${article.pubDate}`);
          if (article.category?.name) parts.push(`   Category: ${article.category.name}`);
          if (article.subCategory?.name) parts.push(`   Blockchain: ${article.subCategory.name}`);
          if (article.token?.symbol) parts.push(`   Token: ${article.token.symbol}`);
          if (article.newsTags?.length)
            parts.push(`   Tags: ${article.newsTags.join(', ')}`);
          return parts.join('\n');
        });

        const header = total !== undefined ? `Found ${total} total articles. Showing ${data.length}:\n` : '';
        return { content: [{ type: 'text', text: header + articles.join('\n\n') }] };
      }

      return { content: [{ type: 'text', text: 'No news articles found matching your criteria.' }] };
    }

    return { content: [{ type: 'text', text: `Unknown news tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT News error: ${message}`);
  }
}
