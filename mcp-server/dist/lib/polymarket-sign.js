/**
 * Polymarket CLOB v2 order-signing helpers.
 *
 * Polymarket runs its CLOB (Central Limit Order Book) on Polygon mainnet
 * (chainId 137). Orders are EIP-712-signed against the CTF Exchange contract
 * and submitted to https://clob.polymarket.com/order.
 *
 * Reference: https://docs.polymarket.com/quickstart/orderbook-api/place-order/
 *            https://github.com/Polymarket/clob-client (TypeScript SDK)
 */
import * as crypto from 'crypto';
export const POLYMARKET_CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
export const POLYMARKET_NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
export const POLYGON_CHAIN_ID = 137;
/** Construct the EIP-712 typed-data envelope for a Polymarket order. */
export function orderTypedData(order, negRisk = false) {
    return {
        domain: {
            name: 'Polymarket CTF Exchange',
            version: '1',
            chainId: POLYGON_CHAIN_ID,
            verifyingContract: negRisk ? POLYMARKET_NEG_RISK_EXCHANGE : POLYMARKET_CTF_EXCHANGE,
        },
        types: {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
            ],
            Order: [
                { name: 'salt', type: 'uint256' },
                { name: 'maker', type: 'address' },
                { name: 'signer', type: 'address' },
                { name: 'taker', type: 'address' },
                { name: 'tokenId', type: 'uint256' },
                { name: 'makerAmount', type: 'uint256' },
                { name: 'takerAmount', type: 'uint256' },
                { name: 'expiration', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'feeRateBps', type: 'uint256' },
                { name: 'side', type: 'uint256' },
                { name: 'signatureType', type: 'uint256' },
            ],
        },
        primaryType: 'Order',
        message: order,
    };
}
/**
 * Build a Polymarket order from price + size in USDC.
 * Pricing on Polymarket: 1 outcome token = 1 USDC at full resolution.
 * A 50% YES order = 0.50 USDC per outcome token.
 *
 * USDC has 6 decimals. Outcome tokens have 6 decimals (ERC-1155).
 */
export function buildOrder(opts) {
    // Reject economically-invalid inputs at the helper boundary so we never
    // ship a real-money order with nonsensical maker/taker amounts.
    const size = Number(opts.size);
    const price = Number(opts.price);
    if (!Number.isFinite(size) || size <= 0) {
        throw new Error(`Polymarket size must be a positive finite number (got ${opts.size})`);
    }
    if (!Number.isFinite(price) || price <= 0 || price >= 1) {
        throw new Error(`Polymarket price must be in (0, 1) — quoted as USDC per outcome token (got ${opts.price})`);
    }
    const sizeUnits = BigInt(Math.round(size * 1_000_000)); // outcome tokens have 6 decimals
    const priceUnits = BigInt(Math.round(price * 1_000_000)); // USDC per token, 6 decimals
    const usdcAmount = (sizeUnits * priceUnits) / 1000000n;
    // Integer division can floor tiny orders to 0 USDC (e.g. 0.001 shares @ 0.01)
    // — a zero-cost real-money order must never leave this helper.
    if (usdcAmount === 0n) {
        throw new Error(`Polymarket order rounds to 0 USDC (size ${opts.size} × price ${opts.price}). Increase size or price.`);
    }
    const isBuy = opts.side === 'BUY';
    return {
        // Money-touching salt: must come from a CSPRNG, not Math.random().
        salt: opts.salt ?? BigInt('0x' + crypto.randomBytes(16).toString('hex')).toString(),
        maker: opts.maker,
        signer: opts.maker,
        taker: '0x0000000000000000000000000000000000000000',
        tokenId: opts.tokenId,
        makerAmount: (isBuy ? usdcAmount : sizeUnits).toString(),
        takerAmount: (isBuy ? sizeUnits : usdcAmount).toString(),
        expiration: String(opts.expirationSec ?? 0),
        nonce: '0',
        feeRateBps: String(opts.feeRateBps ?? 0),
        side: isBuy ? 0 : 1,
        signatureType: opts.signatureType ?? 0,
    };
}
/** Build HMAC headers for a POST to clob.polymarket.com endpoints. */
export function clobHeaders(creds, method, path, bodyJson, maker) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const message = ts + method + path + bodyJson;
    // Polymarket secret is base64; HMAC takes the decoded key bytes.
    const keyBytes = Buffer.from(creds.secret, 'base64');
    const hmac = crypto.createHmac('sha256', keyBytes).update(message).digest();
    // Polymarket uses base64-URL-safe (replace + → -, / → _).
    const sig = hmac.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    return {
        POLY_ADDRESS: maker,
        POLY_SIGNATURE: sig,
        POLY_TIMESTAMP: ts,
        POLY_API_KEY: creds.apiKey,
        POLY_PASSPHRASE: creds.passphrase,
        'content-type': 'application/json',
    };
}
export function readCLOBCreds() {
    const apiKey = process.env.POLY_CLOB_API_KEY?.trim();
    const secret = process.env.POLY_CLOB_SECRET?.trim();
    const passphrase = process.env.POLY_CLOB_PASSPHRASE?.trim();
    if (apiKey && secret && passphrase)
        return { apiKey, secret, passphrase };
    return null;
}
