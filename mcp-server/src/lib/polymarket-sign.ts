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

import { hexToBytes, type Hex } from 'viem';
import * as crypto from 'crypto';

export const POLYMARKET_CTF_EXCHANGE: Hex = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
export const POLYMARKET_NEG_RISK_EXCHANGE: Hex = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
export const POLYGON_CHAIN_ID = 137;

export interface PolymarketOrder {
  /** Random uint256 — collision-avoidance salt. */
  salt: string;
  /** Wallet placing the order. */
  maker: Hex;
  /** Account that signed (almost always = maker). */
  signer: Hex;
  /** 0x0 = open to any taker. */
  taker: Hex;
  /** CLOB token id (the YES or NO outcome leg). Decimal string. */
  tokenId: string;
  /** Decimal string. For BUY: amount of USDC.e maker is giving. For SELL: amount of outcome tokens. */
  makerAmount: string;
  /** Decimal string. Complement of makerAmount. */
  takerAmount: string;
  /** Unix seconds; 0 = no expiration. */
  expiration: string;
  /** Always "0" for v2. */
  nonce: string;
  /** Maker fee in basis points. Typically "0". */
  feeRateBps: string;
  /** 0=BUY, 1=SELL. */
  side: 0 | 1;
  /** 0=EOA, 1=POLY_PROXY (Polymarket-managed), 2=POLY_GNOSIS_SAFE. */
  signatureType: 0 | 1 | 2;
}

export interface OrderTypedData {
  domain: {
    name: 'Polymarket CTF Exchange';
    version: '1';
    chainId: 137;
    verifyingContract: Hex;
  };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    Order: Array<{ name: string; type: string }>;
  };
  primaryType: 'Order';
  message: PolymarketOrder;
}

/** Construct the EIP-712 typed-data envelope for a Polymarket order. */
export function orderTypedData(
  order: PolymarketOrder,
  negRisk = false
): OrderTypedData {
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
export function buildOrder(opts: {
  maker: Hex;
  tokenId: string;
  /** Decimal price 0..1, e.g. "0.42" for 42% probability. */
  price: string;
  /** Number of outcome tokens, e.g. "100" for 100 shares. */
  size: string;
  side: 'BUY' | 'SELL';
  /** Optional Unix-seconds expiration. 0 = never. */
  expirationSec?: number;
  /** Optional fee bps (default 0). */
  feeRateBps?: number;
  /** Signature type (0 = EOA — default). */
  signatureType?: 0 | 1 | 2;
  /** Optional explicit salt. */
  salt?: string;
}): PolymarketOrder {
  const sizeUnits = BigInt(Math.round(Number(opts.size) * 1_000_000)); // outcome tokens have 6 decimals
  const priceUnits = BigInt(Math.round(Number(opts.price) * 1_000_000)); // USDC per token, 6 decimals
  const usdcAmount = (sizeUnits * priceUnits) / 1_000_000n;

  const isBuy = opts.side === 'BUY';
  return {
    salt: opts.salt ?? Math.floor(Math.random() * 1e18).toString(),
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
  maker: string
): Record<string, string> {
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

export function readCLOBCreds(): CLOBCreds | null {
  const apiKey = process.env.POLY_CLOB_API_KEY?.trim();
  const secret = process.env.POLY_CLOB_SECRET?.trim();
  const passphrase = process.env.POLY_CLOB_PASSPHRASE?.trim();
  if (apiKey && secret && passphrase) return { apiKey, secret, passphrase };
  return null;
}
