/**
 * Hyperliquid L1-action signing helpers.
 *
 * Hyperliquid uses a "phantom agent" EIP-712 scheme for its L1 actions
 * (orders, cancels, leverage updates, etc.). The flow is:
 *
 *   1. Encode the action with msgpack
 *   2. Append nonce (8 bytes BE) + vault sentinel byte (+ vault address if non-null)
 *   3. keccak256 the result → actionHash
 *   4. Wrap actionHash in a "phantom Agent" EIP-712 typed-data structure
 *   5. User wallet signs the typed data
 *   6. POST {action, nonce, signature, vaultAddress?} to /exchange
 *
 * domain.chainId is 1337 (Hyperliquid's internal convention), NOT the chain
 * the user is signing on. verifyingContract is address(0).
 *
 * Reference: https://github.com/hyperliquid-dex/hyperliquid-python-sdk
 * (services/sign.py — action_hash + construct_phantom_agent + sign_l1_action)
 */
import { encode as msgpackEncode } from '@msgpack/msgpack';
import { keccak256 } from 'viem';
/**
 * Compute the Hyperliquid action hash.
 * Encodes the action with msgpack, appends nonce (BE-8) + vault flag (and bytes if non-null),
 * and keccak256's the result.
 */
export function actionHash(action, nonce, vaultAddress = null) {
    const encoded = msgpackEncode(action);
    const nonceBytes = new Uint8Array(8);
    // 8-byte big-endian uint64
    const view = new DataView(nonceBytes.buffer);
    view.setBigUint64(0, BigInt(nonce), false);
    let vaultBytes;
    if (vaultAddress) {
        const clean = vaultAddress.startsWith('0x') ? vaultAddress.slice(2) : vaultAddress;
        if (!/^[0-9a-fA-F]{40}$/.test(clean)) {
            throw new Error(`Invalid vault address: ${vaultAddress} (must be 0x + 40 hex chars)`);
        }
        vaultBytes = new Uint8Array(21);
        vaultBytes[0] = 0x01;
        for (let i = 0; i < 20; i++) {
            vaultBytes[i + 1] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        }
    }
    else {
        vaultBytes = new Uint8Array([0x00]);
    }
    const combined = new Uint8Array(encoded.length + 8 + vaultBytes.length);
    combined.set(encoded, 0);
    combined.set(nonceBytes, encoded.length);
    combined.set(vaultBytes, encoded.length + 8);
    return keccak256(combined);
}
/**
 * Build the EIP-712 typed-data structure that the user's wallet must sign.
 */
export function phantomAgentTypedData(hash, isMainnet = true) {
    return {
        domain: {
            chainId: 1337,
            name: 'Exchange',
            verifyingContract: '0x0000000000000000000000000000000000000000',
            version: '1',
        },
        types: {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
            ],
            Agent: [
                { name: 'source', type: 'string' },
                { name: 'connectionId', type: 'bytes32' },
            ],
        },
        primaryType: 'Agent',
        message: {
            source: isMainnet ? 'a' : 'b',
            connectionId: hash,
        },
    };
}
// Hyperliquid nonces must be strictly increasing per wallet. Bare Date.now()
// collides when two actions are built in the same millisecond (the exchange
// rejects the second with "nonce already used"). Keep a monotonic floor so
// consecutive calls in one process always increment.
let lastHlNonce = 0;
function nextHlNonce() {
    const now = Date.now();
    lastHlNonce = now > lastHlNonce ? now : lastHlNonce + 1;
    return lastHlNonce;
}
/**
 * Build a full signing payload for a Hyperliquid L1 action.
 * Caller passes the action object; returns everything the user needs to sign + submit.
 */
export function buildActionPayload(action, opts = {}) {
    const nonce = opts.nonce ?? nextHlNonce();
    const vault = opts.vaultAddress ?? null;
    const isMainnet = opts.isMainnet ?? true;
    const hash = actionHash(action, nonce, vault);
    return {
        action,
        nonce,
        vaultAddress: vault,
        actionHash: hash,
        typedData: phantomAgentTypedData(hash, isMainnet),
        source: isMainnet ? 'a' : 'b',
    };
}
