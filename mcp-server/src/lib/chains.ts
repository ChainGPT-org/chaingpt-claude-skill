/**
 * Canonical chain registry used by every Tier-1 Web3 tool.
 * Names here match DexScreener / GoPlus / CoinGecko slugs where possible
 * to keep tool implementations terse.
 */

export interface ChainInfo {
  /** Canonical short slug we expose to the user (kebab-case). */
  slug: string;
  /** EVM chain id. `null` for non-EVM chains (Solana). */
  chainId: number | null;
  /** Human-friendly name for output. */
  name: string;
  /** Native coin symbol. */
  native: string;
  /** DexScreener chain identifier. */
  dexscreener?: string;
  /** GoPlus security `chain_id`. */
  goplus?: string;
  /** Honeypot.is `chainID`. */
  honeypot?: number;
  /** CoinGecko `asset_platform_id` for token-by-contract lookups. */
  coingecko?: string;
  /** Default public JSON-RPC endpoint (no key). Used for gas oracle fallback. */
  publicRpc?: string;
  /** Block explorer base URL for `tx/`, `address/`, `token/` deeplinks. */
  explorer?: string;
}

export const CHAINS: Record<string, ChainInfo> = {
  ethereum: {
    slug: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    native: 'ETH',
    dexscreener: 'ethereum',
    goplus: '1',
    honeypot: 1,
    coingecko: 'ethereum',
    publicRpc: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
  },
  base: {
    slug: 'base',
    chainId: 8453,
    name: 'Base',
    native: 'ETH',
    dexscreener: 'base',
    goplus: '8453',
    coingecko: 'base',
    publicRpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
  },
  arbitrum: {
    slug: 'arbitrum',
    chainId: 42161,
    name: 'Arbitrum One',
    native: 'ETH',
    dexscreener: 'arbitrum',
    goplus: '42161',
    honeypot: 42161,
    coingecko: 'arbitrum-one',
    publicRpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
  },
  optimism: {
    slug: 'optimism',
    chainId: 10,
    name: 'OP Mainnet',
    native: 'ETH',
    dexscreener: 'optimism',
    goplus: '10',
    coingecko: 'optimistic-ethereum',
    publicRpc: 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io',
  },
  polygon: {
    slug: 'polygon',
    chainId: 137,
    name: 'Polygon PoS',
    native: 'POL',
    dexscreener: 'polygon',
    goplus: '137',
    coingecko: 'polygon-pos',
    publicRpc: 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com',
  },
  bsc: {
    slug: 'bsc',
    chainId: 56,
    name: 'BNB Smart Chain',
    native: 'BNB',
    dexscreener: 'bsc',
    goplus: '56',
    honeypot: 56,
    coingecko: 'binance-smart-chain',
    publicRpc: 'https://bsc-dataseed.binance.org',
    explorer: 'https://bscscan.com',
  },
  avalanche: {
    slug: 'avalanche',
    chainId: 43114,
    name: 'Avalanche C-Chain',
    native: 'AVAX',
    dexscreener: 'avalanche',
    goplus: '43114',
    coingecko: 'avalanche',
    publicRpc: 'https://api.avax.network/ext/bc/C/rpc',
    explorer: 'https://snowtrace.io',
  },
  blast: {
    slug: 'blast',
    chainId: 81457,
    name: 'Blast',
    native: 'ETH',
    dexscreener: 'blast',
    goplus: '81457',
    coingecko: 'blast',
    publicRpc: 'https://rpc.blast.io',
    explorer: 'https://blastscan.io',
  },
  linea: {
    slug: 'linea',
    chainId: 59144,
    name: 'Linea',
    native: 'ETH',
    dexscreener: 'linea',
    goplus: '59144',
    coingecko: 'linea',
    publicRpc: 'https://rpc.linea.build',
    explorer: 'https://lineascan.build',
  },
  scroll: {
    slug: 'scroll',
    chainId: 534352,
    name: 'Scroll',
    native: 'ETH',
    dexscreener: 'scroll',
    goplus: '534352',
    coingecko: 'scroll',
    publicRpc: 'https://rpc.scroll.io',
    explorer: 'https://scrollscan.com',
  },
  solana: {
    slug: 'solana',
    chainId: null,
    name: 'Solana',
    native: 'SOL',
    dexscreener: 'solana',
    goplus: 'solana',
    coingecko: 'solana',
    publicRpc: 'https://api.mainnet-beta.solana.com',
    explorer: 'https://solscan.io',
  },
};

/** Look up a chain by slug, chain id (as string or number), or common alias. Returns undefined if unknown. */
export function resolveChain(input: string | number | undefined | null): ChainInfo | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  const s = String(input).trim().toLowerCase();

  // Direct slug
  if (CHAINS[s]) return CHAINS[s];

  // Numeric chain id
  const asNum = Number(s);
  if (!isNaN(asNum)) {
    for (const c of Object.values(CHAINS)) {
      if (c.chainId === asNum) return c;
    }
  }

  // Common aliases
  const aliases: Record<string, string> = {
    eth: 'ethereum',
    mainnet: 'ethereum',
    binance: 'bsc',
    'bnb': 'bsc',
    'bnb-chain': 'bsc',
    'binance-smart-chain': 'bsc',
    avax: 'avalanche',
    'avalanche-c': 'avalanche',
    matic: 'polygon',
    'polygon-pos': 'polygon',
    arb: 'arbitrum',
    'arbitrum-one': 'arbitrum',
    op: 'optimism',
    'op-mainnet': 'optimism',
    sol: 'solana',
  };
  if (aliases[s] && CHAINS[aliases[s]]) return CHAINS[aliases[s]];

  return undefined;
}

/** All slugs, for tool-schema `enum` fields. */
export const ALL_CHAIN_SLUGS = Object.keys(CHAINS);

/** EVM-only slugs. */
export const EVM_CHAIN_SLUGS = Object.values(CHAINS)
  .filter((c) => c.chainId !== null)
  .map((c) => c.slug);
