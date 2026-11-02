/**
 * Polymarket CLOB order-signing helpers (current order format).
 *
 * Polymarket runs its CLOB (Central Limit Order Book) on Polygon mainnet
 * (chainId 137). Orders are EIP-712-signed against an exchange contract and
 * submitted to https://clob.polymarket.com/order.
 *
 * Reference: https://docs.polymarket.com/developers/CLOB/orders/create-order
 *            https://github.com/Polymarket/clob-client-v2 (src/config.ts, order-utils/)
 */
import { hashDomain, hashStruct, toHex } from 'viem';
import * as crypto from 'crypto';
export const POLYGON_CHAIN_ID = 137;
// Signing domains by book type. A CTF book's /book response has no `version`;
// a Polymarket Protocol V2 book returns `version: "v2"` and has a single exchange.
export const POLYMARKET_CTF_EXCHANGE = '0xE111180000d2663C0091e4f400237545B87B996B';
export const POLYMARKET_NEG_RISK_EXCHANGE = '0xe2222d279d744050d28e00520010520000310F59';
export const POLYMARKET_V2_EXCHANGE = '0xe3333700cA9d93003F00f0F71f8515005F6c00Aa';
const BYTES32_ZERO = `0x${'0'.repeat(64)}`;
/** Construct the EIP-712 typed-data envelope for a Polymarket order. */
export function orderTypedData(order, opts = {}) {
    const { expiration: _unsigned, depositWallet: _local, ...message } = order;
    const v2 = opts.bookVersion === 'v2'; // v2 books have one exchange; neg_risk does not pick it
    return {
        domain: {
            name: 'Polymarket CTF Exchange',
            version: v2 ? '3' : '2',
            chainId: POLYGON_CHAIN_ID,
            verifyingContract: v2 ? POLYMARKET_V2_EXCHANGE : opts.negRisk ? POLYMARKET_NEG_RISK_EXCHANGE : POLYMARKET_CTF_EXCHANGE,
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
                { name: 'tokenId', type: 'uint256' },
                { name: 'makerAmount', type: 'uint256' },
                { name: 'takerAmount', type: 'uint256' },
                { name: 'side', type: 'uint8' },
                { name: 'signatureType', type: 'uint8' },
                { name: 'timestamp', type: 'uint256' },
                { name: 'metadata', type: 'bytes32' },
                { name: 'builder', type: 'bytes32' },
            ],
        },
        primaryType: 'Order',
        message,
    };
}
// ─── Deposit wallets (signatureType 3, POLY_1271) ───────────────────
// The wallet contract validates via ERC-1271 using ERC-7739 nested typed data: its owner EOA signs a
// TypedDataSign envelope (exchange domain, the Order as `contents`, the wallet's own domain fields), and
// the posted signature is that inner signature followed by what the wallet needs to rebuild the hash.
// Mirrors buildOrderSignature in clob-client-v2 src/order-utils/exchangeOrderBuilderV2.ts.
const ORDER_TYPE_STRING = 'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,' +
    'uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)';
/** Typed data the deposit wallet's owner EOA signs (eth_signTypedData_v4). */
export function depositWalletTypedData(td) {
    return {
        domain: td.domain,
        types: {
            EIP712Domain: td.types.EIP712Domain,
            TypedDataSign: [
                { name: 'contents', type: 'Order' },
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
                { name: 'salt', type: 'bytes32' },
            ],
            Order: td.types.Order,
        },
        primaryType: 'TypedDataSign',
        message: {
            contents: td.message,
            name: 'DepositWallet',
            version: '1',
            chainId: td.domain.chainId,
            verifyingContract: td.message.signer, // the deposit wallet
            salt: BYTES32_ZERO,
        },
    };
}
/** innerSig (65 bytes) ‖ exchange domain separator ‖ Order struct hash ‖ Order type string ‖ uint16 its length. */
export function wrapDepositWalletSignature(innerSig, td) {
    if (!/^0x[0-9a-fA-F]{130}$/.test(innerSig))
        throw new Error('Deposit-wallet orders need the 65-byte signature from the owner EOA.');
    const typeHex = toHex(ORDER_TYPE_STRING).slice(2);
    const types = td.types; // viem's generic typed-data inference doesn't follow our declared field list
    return (`0x${innerSig.slice(2)}${hashDomain({ domain: td.domain, types }).slice(2)}` +
        `${hashStruct({ data: td.message, primaryType: 'Order', types }).slice(2)}` +
        `${typeHex}${ORDER_TYPE_STRING.length.toString(16).padStart(4, '0')}`);
}
/**
 * Build a Polymarket order from price + size.
 * 1 outcome token pays 1 USDC at resolution, so a 50% YES order = 0.50 USDC per token.
 * USDC and outcome tokens both have 6 decimals.
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
    const priceUnits = BigInt(Math.round(price * 1_000_000)); // USDC per token, 6 decimals
    if (priceUnits % 100n !== 0n) {
        throw new Error(`Polymarket price ${opts.price} has more than 4 decimals; no market tick allows that.`);
    }
    if (opts.tickSize !== undefined) {
        const tickUnits = BigInt(Math.round(Number(opts.tickSize) * 1_000_000));
        if (tickUnits <= 0n || priceUnits % tickUnits !== 0n || priceUnits > 1000000n - tickUnits) {
            throw new Error(`Polymarket price ${opts.price} is not on this market's tick (${opts.tickSize}).`);
        }
    }
    // Sizes carry at most 2 decimals on every tick size: round down, as the official client does.
    const sizeUnits = (BigInt(Math.round(size * 1_000_000)) / 10000n) * 10000n;
    if (opts.minOrderSize !== undefined && Number(sizeUnits) / 1e6 < Number(opts.minOrderSize)) {
        throw new Error(`Polymarket size ${opts.size} is below this market's minimum order size (${opts.minOrderSize} shares).`);
    }
    // With ≤4-decimal prices and 2-decimal sizes this product is exact.
    const usdcAmount = (sizeUnits * priceUnits) / 1000000n;
    // A zero-cost real-money order must never leave this helper.
    if (usdcAmount === 0n) {
        throw new Error(`Polymarket order rounds to 0 USDC (size ${opts.size} × price ${opts.price}). Increase size or price.`);
    }
    const isBuy = opts.side === 'BUY';
    return {
        // Money-touching salt: must come from a CSPRNG, not Math.random(). 48 bits so the CLOB API's numeric
        // salt (a JSON number) round-trips exactly and matches what was signed.
        salt: opts.salt ?? BigInt('0x' + crypto.randomBytes(6).toString('hex')).toString(),
        maker: opts.maker,
        signer: opts.signatureType === 3 ? opts.maker : opts.signer ?? opts.maker,
        tokenId: opts.tokenId,
        makerAmount: (isBuy ? usdcAmount : sizeUnits).toString(),
        takerAmount: (isBuy ? sizeUnits : usdcAmount).toString(),
        side: isBuy ? 0 : 1,
        signatureType: opts.signatureType ?? 0,
        timestamp: Date.now().toString(),
        metadata: BYTES32_ZERO,
        builder: BYTES32_ZERO,
        expiration: String(opts.expirationSec ?? 0),
    };
}
/** Build HMAC headers for a POST to clob.polymarket.com endpoints. */
export function clobHeaders(creds, method, path, bodyJson, signer) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const message = ts + method + path + bodyJson;
    // Polymarket secret is base64; HMAC takes the decoded key bytes.
    const keyBytes = Buffer.from(creds.secret, 'base64');
    const hmac = crypto.createHmac('sha256', keyBytes).update(message).digest();
    // Polymarket uses base64-URL-safe (replace + → -, / → _).
    const sig = hmac.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    return {
        POLY_ADDRESS: signer,
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
