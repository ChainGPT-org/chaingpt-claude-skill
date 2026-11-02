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

import { type Hex } from 'viem';
import * as crypto from 'crypto';

export const POLYGON_CHAIN_ID = 137;
// Signing domains by book type. A CTF book's /book response has no `version`;
// a Polymarket Protocol V2 book returns `version: "v2"` and has a single exchange.
export const POLYMARKET_CTF_EXCHANGE: Hex = '0xE111180000d2663C0091e4f400237545B87B996B';
export const POLYMARKET_NEG_RISK_EXCHANGE: Hex = '0xe2222d279d744050d28e00520010520000310F59';
export const POLYMARKET_V2_EXCHANGE: Hex = '0xe3333700cA9d93003F00f0F71f8515005F6c00Aa';
const BYTES32_ZERO: Hex = `0x${'0'.repeat(64)}`;

/** 'v2' when the CLOB /book returns `version: "v2"`, otherwise 'ctf'. */
export type BookVersion = 'ctf' | 'v2';

export interface PolymarketOrder {
  /** Random uint256, kept below 2^48 so the CLOB's JSON-number salt matches what was signed. */
  salt: string;
  /** Wallet holding the funds (the proxy/Safe for those wallet types). */
  maker: Hex;
  /** EOA that signs (= maker for EOA wallets). */
  signer: Hex;
  /** Outcome asset id: the CLOB token id, or the position id on a v2 market. Decimal string. */
  tokenId: string;
  /** Decimal string. BUY: USDC the maker gives. SELL: outcome tokens. */
  makerAmount: string;
  /** Decimal string. Complement of makerAmount. */
  takerAmount: string;
  /** 0=BUY, 1=SELL. */
  side: 0 | 1;
  /** 0=EOA, 1=POLY_PROXY, 2=POLY_GNOSIS_SAFE, 3=POLY_1271 (deposit wallet). */
  signatureType: 0 | 1 | 2 | 3;
  /** Order creation time, Unix milliseconds. */
  timestamp: string;
  metadata: Hex;
  /** Builder code (bytes32), zero when none. */
  builder: Hex;
  /** Unix seconds, "0" = none. NOT signed: it travels in the POST body next to the signed fields. */
  expiration: string;
}

type SignedOrderFields = Omit<PolymarketOrder, 'expiration'>;

export interface OrderTypedData {
  domain: {
    name: 'Polymarket CTF Exchange';
    version: '2' | '3';
    chainId: number;
    verifyingContract: Hex;
  };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    Order: Array<{ name: string; type: string }>;
  };
  primaryType: 'Order';
  message: SignedOrderFields;
}

/** Construct the EIP-712 typed-data envelope for a Polymarket order. */
export function orderTypedData(
  order: PolymarketOrder,
  opts: { negRisk?: boolean; bookVersion?: BookVersion } = {}
): OrderTypedData {
  const { expiration: _unsigned, ...message } = order;
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

/**
 * Build a Polymarket order from price + size.
 * 1 outcome token pays 1 USDC at resolution, so a 50% YES order = 0.50 USDC per token.
 * USDC and outcome tokens both have 6 decimals.
 */
export function buildOrder(opts: {
  maker: Hex;
  tokenId: string;
  /** Decimal price 0..1 on the market's tick, e.g. "0.42". */
  price: string;
  /** Number of outcome tokens; rounded down to 2 decimals as the CLOB requires. */
  size: string;
  side: 'BUY' | 'SELL';
  /** Optional Unix-seconds expiration (GTD orders). 0 = never. */
  expirationSec?: number;
  /** Signature type (0 = EOA — default). */
  signatureType?: 0 | 1 | 2;
  /** Signing EOA when it differs from maker (proxy / Safe wallets). Default: maker. */
  signer?: Hex;
  /** Optional explicit salt. */
  salt?: string;
}): PolymarketOrder {
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
  // Sizes carry at most 2 decimals on every tick size: round down, as the official client does.
  const sizeUnits = (BigInt(Math.round(size * 1_000_000)) / 10_000n) * 10_000n;
  // With ≤4-decimal prices and 2-decimal sizes this product is exact.
  const usdcAmount = (sizeUnits * priceUnits) / 1_000_000n;
  // A zero-cost real-money order must never leave this helper.
  if (usdcAmount === 0n) {
    throw new Error(
      `Polymarket order rounds to 0 USDC (size ${opts.size} × price ${opts.price}). Increase size or price.`
    );
  }

  const isBuy = opts.side === 'BUY';
  return {
    // Money-touching salt: must come from a CSPRNG, not Math.random(). 48 bits so the CLOB API's numeric
    // salt (a JSON number) round-trips exactly and matches what was signed.
    salt: opts.salt ?? BigInt('0x' + crypto.randomBytes(6).toString('hex')).toString(),
    maker: opts.maker,
    signer: opts.signer ?? opts.maker,
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

// ─── HMAC for /order POST authentication ─────────────────────────

export interface CLOBCreds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/** Build HMAC headers for a POST to clob.polymarket.com endpoints. */
export function clobHeaders(
  creds: CLOBCreds,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  bodyJson: string,
  signer: string
): Record<string, string> {
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

export function readCLOBCreds(): CLOBCreds | null {
  const apiKey = process.env.POLY_CLOB_API_KEY?.trim();
  const secret = process.env.POLY_CLOB_SECRET?.trim();
  const passphrase = process.env.POLY_CLOB_PASSPHRASE?.trim();
  if (apiKey && secret && passphrase) return { apiKey, secret, passphrase };
  return null;
}
