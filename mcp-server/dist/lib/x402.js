/**
 * x402 payment-protocol helpers (Coinbase's HTTP 402 for agentic payments).
 *
 * Custody-free: we build the EIP-712 typed data the payer signs (EIP-3009
 * `transferWithAuthorization`) and assemble the base64 `X-PAYMENT` header from
 * an externally-produced signature. The plugin never holds a key and never
 * signs. The facilitator (which only broadcasts the signed authorization and
 * cannot alter amount or destination) is called read-through over HTTP.
 *
 * Flow recap:
 *   1. Client hits a resource → server replies 402 + JSON body { accepts:[PaymentRequirements] }.
 *   2. Client picks a requirement, signs an EIP-3009 authorization (EIP-712),
 *      base64-encodes a PaymentPayload into the `X-PAYMENT` request header, retries.
 *   3. Server / facilitator /verify then /settle; replies 200 + `X-PAYMENT-RESPONSE`.
 *
 * Only the `exact` EVM scheme (EIP-3009 path, e.g. USDC/EURC) is built here —
 * that is the dominant production path. Permit2 / ERC-7710 schemes are out of
 * scope for the builder (we still decode any scheme).
 */
import { hashTypedData, isAddress, getAddress } from 'viem';
import { randomBytes } from 'node:crypto';
export const X402_VERSION = 1;
// Known EIP-3009 tokens, keyed by `${network}:${symbol}`. `name`/`version` are
// the EIP-712 domain fields the token's contract uses (must match exactly or
// the signature is rejected on settle). USDC uses version "2".
export const X402_TOKENS = {
    'base:USDC': { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2', decimals: 6 },
    'base-sepolia:USDC': { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2', decimals: 6 },
};
// Map an x402 `network` string to an EVM chainId for the EIP-712 domain.
export const X402_NETWORK_CHAINID = {
    base: 8453,
    'base-sepolia': 84532,
    polygon: 137,
    arbitrum: 42161,
};
export function chainIdForNetwork(network) {
    const id = X402_NETWORK_CHAINID[network];
    if (!id)
        throw new Error(`Unknown x402 network "${network}". Known: ${Object.keys(X402_NETWORK_CHAINID).join(', ')}.`);
    return id;
}
/** A fresh 32-byte EIP-3009 nonce as a 0x hex string. */
export function freshNonce() {
    return ('0x' + randomBytes(32).toString('hex'));
}
/**
 * Build the EIP-712 typed data for an EIP-3009 `transferWithAuthorization`.
 * Returns the typed-data object (for the wallet to sign) and its digest (the
 * value an ecrecover would run against — handy for verification + tests).
 */
export function buildTransferWithAuthorizationTypedData(opts) {
    for (const [label, v] of [['from', opts.from], ['to', opts.to], ['token', opts.token.address]]) {
        if (!isAddress(v))
            throw new Error(`${label} is not a valid EVM address: ${v}`);
    }
    const nonce = opts.nonce ?? freshNonce();
    const message = {
        from: getAddress(opts.from),
        to: getAddress(opts.to),
        value: opts.value,
        validAfter: String(opts.validAfter ?? 0),
        validBefore: String(opts.validBefore),
        nonce,
    };
    const typedData = {
        domain: {
            name: opts.token.name,
            version: opts.token.version,
            chainId: opts.chainId,
            verifyingContract: getAddress(opts.token.address),
        },
        types: {
            TransferWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' },
            ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
            from: message.from,
            to: message.to,
            value: BigInt(message.value),
            validAfter: BigInt(message.validAfter),
            validBefore: BigInt(message.validBefore),
            nonce: message.nonce,
        },
    };
    const digest = hashTypedData(typedData);
    return { typedData, digest, authorization: message };
}
/** Assemble + base64-encode the `X-PAYMENT` header value from a signed authorization. */
export function encodeXPaymentHeader(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}
/** Decode a base64 `X-PAYMENT` / `X-PAYMENT-RESPONSE` header value to its JSON object. */
export function decodeBase64Header(headerValue) {
    const json = Buffer.from(headerValue.trim(), 'base64').toString('utf8');
    return JSON.parse(json);
}
/** Pull the PaymentRequirements list out of a 402 response body (tolerant of shapes). */
export function parseAccepts(body) {
    if (!body || typeof body !== 'object')
        return [];
    const b = body;
    const accepts = (b.accepts ?? b.paymentRequirements ?? b.requirements);
    if (Array.isArray(accepts))
        return accepts;
    // Some servers return a single requirement object.
    if (b.scheme && b.payTo && b.asset)
        return [b];
    return [];
}
/** Human-readable amount for a token with `decimals`. */
export function formatAtomic(atomic, decimals) {
    try {
        const v = BigInt(atomic);
        const base = 10n ** BigInt(decimals);
        const whole = v / base;
        const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
        return frac ? `${whole}.${frac}` : `${whole}`;
    }
    catch {
        return atomic;
    }
}
