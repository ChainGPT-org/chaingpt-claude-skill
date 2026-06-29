/**
 * Canonical chain registry used by every Tier-1 Web3 tool.
 * Names here match DexScreener / GoPlus / CoinGecko slugs where possible
 * to keep tool implementations terse.
 */
export const CHAINS = {
    ethereum: {
        slug: 'ethereum',
        chainId: 1,
        name: 'Ethereum',
        native: 'ETH',
        dexscreener: 'ethereum',
        goplus: '1',
        honeypot: 1,
        coingecko: 'ethereum',
        publicRpc: 'https://ethereum-rpc.publicnode.com',
        publicRpcFallbacks: [
            'https://rpc.ankr.com/eth',
            'https://eth.llamarpc.com',
            'https://cloudflare-eth.com',
        ],
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
        publicRpcFallbacks: ['https://base-rpc.publicnode.com', 'https://base.llamarpc.com'],
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
        publicRpcFallbacks: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.llamarpc.com'],
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
        publicRpcFallbacks: ['https://optimism-rpc.publicnode.com', 'https://optimism.llamarpc.com'],
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
        publicRpcFallbacks: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.llamarpc.com'],
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
        publicRpcFallbacks: ['https://bsc-rpc.publicnode.com', 'https://binance.llamarpc.com'],
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
        publicRpcFallbacks: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.llamarpc.com'],
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
    tron: {
        slug: 'tron',
        chainId: null,
        name: 'Tron',
        native: 'TRX',
        dexscreener: 'tron',
        goplus: 'tron',
        coingecko: 'tron',
        publicRpc: 'https://api.trongrid.io',
        explorer: 'https://tronscan.org',
    },
};
/** Look up a chain by slug, chain id (as string or number), or common alias. Returns undefined if unknown. */
export function resolveChain(input) {
    if (input === undefined || input === null || input === '')
        return undefined;
    const s = String(input).trim().toLowerCase();
    // Direct slug
    if (CHAINS[s])
        return CHAINS[s];
    // Numeric chain id
    const asNum = Number(s);
    if (!isNaN(asNum)) {
        for (const c of Object.values(CHAINS)) {
            if (c.chainId === asNum)
                return c;
        }
    }
    // Common aliases
    const aliases = {
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
        trx: 'tron',
        trc20: 'tron',
    };
    if (aliases[s] && CHAINS[aliases[s]])
        return CHAINS[aliases[s]];
    return undefined;
}
/** All slugs, for tool-schema `enum` fields. */
export const ALL_CHAIN_SLUGS = Object.keys(CHAINS);
/** EVM-only slugs. */
export const EVM_CHAIN_SLUGS = Object.values(CHAINS)
    .filter((c) => c.chainId !== null)
    .map((c) => c.slug);
/** Get the ordered list of RPC endpoints to try for a chain (primary first). */
export function rpcEndpoints(slug) {
    const c = CHAINS[slug];
    if (!c)
        return [];
    const list = [];
    if (c.publicRpc)
        list.push(c.publicRpc);
    if (c.publicRpcFallbacks)
        list.push(...c.publicRpcFallbacks);
    return list;
}
