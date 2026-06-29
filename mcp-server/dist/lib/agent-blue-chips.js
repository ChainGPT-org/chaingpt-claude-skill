/**
 * Curated registry of "blue chip" ERC-20s per chain.
 *
 * Blue chip = high-cap, audited, widely-used tokens — stablecoins, wrapped
 * natives, major LSTs, major DeFi governance. The registry is a STATIC
 * allowlist: only addresses listed here get auto-tracked when the agent
 * receives them. This is the spam-token defense — random meme drops can't
 * pollute the wallet view.
 *
 * Symbols + decimals are baked in so the scan doesn't have to do eth_call
 * for metadata it could be lied about.
 */
/**
 * Per-chain blue-chip list. Address must be lowercase. Source: official
 * docs of each protocol. Cross-check before adding new entries.
 */
export const BLUE_CHIPS = {
    ethereum: [
        { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6, label: 'Circle USD' },
        { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6, label: 'Tether USD' },
        { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', decimals: 18, label: 'MakerDAO DAI' },
        { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18, label: 'Wrapped Ether' },
        { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', symbol: 'WBTC', decimals: 8, label: 'Wrapped BTC' },
        { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', symbol: 'stETH', decimals: 18, label: 'Lido Staked ETH' },
        { address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', symbol: 'wstETH', decimals: 18, label: 'Wrapped stETH' },
        { address: '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7', symbol: 'rsETH', decimals: 18, label: 'KelpDAO rsETH' },
        { address: '0xbe9895146f7af43049ca1c1ae358b0541ea49704', symbol: 'cbETH', decimals: 18, label: 'Coinbase ETH' },
        { address: '0xae78736cd615f374d3085123a210448e74fc6393', symbol: 'rETH', decimals: 18, label: 'Rocket Pool ETH' },
        { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 },
        { address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK', decimals: 18, label: 'Chainlink' },
        { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', symbol: 'UNI', decimals: 18, label: 'Uniswap' },
        { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', symbol: 'AAVE', decimals: 18 },
        { address: '0xd533a949740bb3306d119cc777fa900ba034cd52', symbol: 'CRV', decimals: 18, label: 'Curve' },
        { address: '0x4691937a7508860f876c9c0a2a617e7d9e945d4b', symbol: 'WOO', decimals: 18 },
    ],
    base: [
        { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6, label: 'Circle USDC (Base)' },
        { address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', symbol: 'USDbC', decimals: 6, label: 'Bridged USDC' },
        { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, label: 'Wrapped ETH (Base)' },
        { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', symbol: 'DAI', decimals: 18 },
        { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', symbol: 'wstETH', decimals: 18 },
        { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', symbol: 'AERO', decimals: 18, label: 'Aerodrome' },
    ],
    arbitrum: [
        { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', decimals: 6, label: 'Circle USDC' },
        { address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', symbol: 'USDC.e', decimals: 6, label: 'Bridged USDC' },
        { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', decimals: 6 },
        { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI', decimals: 18 },
        { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18 },
        { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', symbol: 'WBTC', decimals: 8 },
        { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', symbol: 'ARB', decimals: 18, label: 'Arbitrum gov' },
        { address: '0x5979d7b546e38e414f7e9822514be443a4800529', symbol: 'wstETH', decimals: 18 },
        { address: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', symbol: 'LINK', decimals: 18 },
    ],
    optimism: [
        { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC', decimals: 6, label: 'Circle USDC' },
        { address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', symbol: 'USDC.e', decimals: 6 },
        { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT', decimals: 6 },
        { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI', decimals: 18 },
        { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
        { address: '0x4200000000000000000000000000000000000042', symbol: 'OP', decimals: 18, label: 'Optimism gov' },
        { address: '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb', symbol: 'wstETH', decimals: 18 },
    ],
    polygon: [
        { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC', decimals: 6 },
        { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', symbol: 'USDC.e', decimals: 6 },
        { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', symbol: 'USDT', decimals: 6 },
        { address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', symbol: 'DAI', decimals: 18 },
        { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', symbol: 'WMATIC', decimals: 18 },
        { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', symbol: 'WETH', decimals: 18 },
        { address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', symbol: 'WBTC', decimals: 8 },
    ],
    bsc: [
        { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT', decimals: 18, label: 'BSC-USD' },
        { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC', decimals: 18 },
        { address: '0xe9e7cea3dedca5984780bafc599bd69add087d56', symbol: 'BUSD', decimals: 18 },
        { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', symbol: 'WBNB', decimals: 18 },
        { address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', symbol: 'ETH', decimals: 18, label: 'Binance-Peg ETH' },
        { address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', symbol: 'BTCB', decimals: 18 },
    ],
    avalanche: [
        { address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', symbol: 'USDC', decimals: 6, label: 'Circle USDC' },
        { address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', symbol: 'USDT', decimals: 6 },
        { address: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70', symbol: 'DAI.e', decimals: 18 },
        { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', symbol: 'WAVAX', decimals: 18 },
        { address: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab', symbol: 'WETH.e', decimals: 18 },
    ],
};
export function getBlueChipsForChain(chain) {
    return BLUE_CHIPS[chain.toLowerCase()] ?? [];
}
export function allBlueChips() {
    const out = [];
    for (const [chain, tokens] of Object.entries(BLUE_CHIPS)) {
        for (const t of tokens)
            out.push({ ...t, chain });
    }
    return out;
}
