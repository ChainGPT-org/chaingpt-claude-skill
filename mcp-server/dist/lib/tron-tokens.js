/**
 * Verified Tron mainnet token + DeFi contract registry.
 *
 * Every address here was verified against Tronscan / official docs and the
 * adversarial fact-check pass (see docs/tron/RESEARCH.md §6-7). DO NOT add an
 * address that has not been verified the same way — a wrong address sends funds
 * to the wrong place. Decimals are as load-bearing as the address.
 */
import { isTronAddress } from './tron-address.js';
/** Curated, verified TRC-20 tokens (symbol → metadata). Keys are UPPERCASE. */
export const TRON_TOKENS = {
    USDT: { symbol: 'USDT', name: 'Tether USD', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
    USDC: { symbol: 'USDC', name: 'USD Coin (sunset)', address: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6 },
    WTRX: { symbol: 'WTRX', name: 'Wrapped TRX', address: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', decimals: 6 },
    JST: { symbol: 'JST', name: 'JUST', address: 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9', decimals: 18 },
    SUN: { symbol: 'SUN', name: 'SUN', address: 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S', decimals: 18 },
    USDD: { symbol: 'USDD', name: 'Decentralized USD', address: 'TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz', decimals: 18 },
    TUSD: { symbol: 'TUSD', name: 'TrueUSD', address: 'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4', decimals: 18 },
    STUSDT: { symbol: 'stUSDT', name: 'Staked USDT', address: 'TThzxNRLrW2Brp9DcTQU8i4Wd9udCWEdZ3', decimals: 18 },
};
/**
 * Addresses that LOOK like a canonical token but are deprecated/dead and must
 * NEVER be resolved or transacted: USDDOLD, the old SUN, and a dead non-contract
 * account that a stale doc page once listed as USDD.
 */
export const TRON_POISONED_ADDRESSES = new Set([
    'TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn', // USDD 1.0 (USDDOLD)
    'TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9', // old SUN (1:1000 redenominated)
    'TCrEVahRbhDFB6uRXEWUg7wkptXvg47GKs', // dead / non-contract
]);
/** Native TRX pseudo-token (6 decimals; SUN is the base unit). */
export const TRX_DECIMALS = 6;
export const SUN_PER_TRX = 1000000n;
/**
 * Verified DeFi contracts. SunSwap V2 router is DEPRECATED (Tronscan-tagged) —
 * execution routes through the Smart Exchange Router; the V2 router is retained
 * only for its read-only getAmountsOut quote path.
 */
export const TRON_DEFI = {
    sunswap: {
        /** Current, non-deprecated routing entry point (V1/V2/V3/PSM aggregator). Use for swaps. */
        smartRouter: 'TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj',
        /** DEPRECATED Uniswap-V2 router. getAmountsOut still works for quoting. */
        v2Router: 'TXF1xDbVGdxFGbovmmmXvBGu8ZiE3Lq4mR',
        v2RouterDeprecated: true,
        v2Factory: 'TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY',
        v3Router: 'TQAvWQpT9H916GckwWDJNhYZvQMkuRL7PN',
        v3Factory: 'TThJt8zaJzJMhCEScH7zWKnp5buVZqys9x',
        wtrx: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR',
    },
    justlend: {
        /** The entry point you call (proxy). Never the bare Comptroller impl. */
        unitroller: 'TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7',
        /** jToken markets (underlying symbol → jToken address). jTRX is CEther (payable mint). */
        markets: {
            TRX: { jToken: 'TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP', underlying: null, isCEther: true },
            USDT: { jToken: 'TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd', underlying: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', isCEther: false },
            USDD: { jToken: 'TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf', underlying: 'TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz', isCEther: false },
        },
    },
};
/** Default per-tx fee_limit for TRC-20 / contract calls (energy cap), in SUN. 100 TRX. */
export const DEFAULT_FEE_LIMIT_SUN = 100000000n;
/** Throw if an address is a known-poisoned token. Call before resolving/transacting. */
export function assertNotPoisoned(address) {
    if (TRON_POISONED_ADDRESSES.has(address)) {
        throw new Error(`Address ${address} is a deprecated/dead Tron contract and is blocked. Use the current canonical address.`);
    }
}
/**
 * Resolve a symbol (e.g. "USDT") or a base58 contract address to curated token
 * metadata. Returns undefined for an unknown-but-valid address (the tools still
 * accept arbitrary TRC-20s — they just read decimals/symbol on-chain). Throws
 * for a poisoned address.
 */
export function resolveTronToken(symbolOrAddress) {
    if (typeof symbolOrAddress !== 'string' || symbolOrAddress.trim() === '')
        return undefined;
    const s = symbolOrAddress.trim();
    // Symbol match (case-insensitive; handle the stUSDT/STUSDT key).
    const upper = s.toUpperCase();
    if (TRON_TOKENS[upper])
        return TRON_TOKENS[upper];
    // Address match.
    if (isTronAddress(s)) {
        assertNotPoisoned(s);
        for (const t of Object.values(TRON_TOKENS)) {
            if (t.address === s)
                return t;
        }
    }
    return undefined;
}
/** All curated token symbols, for tool-schema hints. */
export const TRON_TOKEN_SYMBOLS = Object.values(TRON_TOKENS).map((t) => t.symbol);
