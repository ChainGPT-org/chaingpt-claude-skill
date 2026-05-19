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
import { keccak256, type Hex } from 'viem';

export interface ActionPayload {
  /** The original action object (kept verbatim so the user can verify before signing). */
  action: Record<string, unknown>;
  /** Nonce used in the action hash. Caller must include the same nonce in /exchange. */
  nonce: number;
  /** Optional vault address — for trades from a sub-account / vault. */
  vaultAddress?: string | null;
  /** keccak256 of (msgpack(action) + nonce + vault). Hex string with 0x prefix. */
  actionHash: Hex;
  /** EIP-712 typed data ready for the user's wallet to sign. */
  typedData: PhantomAgentTypedData;
  /** "a" for mainnet, "b" for testnet. */
  source: 'a' | 'b';
}

export interface PhantomAgentTypedData {
  domain: {
    chainId: number;
    name: 'Exchange';
    verifyingContract: '0x0000000000000000000000000000000000000000';
    version: '1';
  };
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    Agent: Array<{ name: string; type: string }>;
  };
  primaryType: 'Agent';
  message: {
    source: 'a' | 'b';
    connectionId: Hex;
  };
}

/**
 * Compute the Hyperliquid action hash.
 * Encodes the action with msgpack, appends nonce (BE-8) + vault flag (and bytes if non-null),
 * and keccak256's the result.
 */
export function actionHash(
  action: Record<string, unknown>,
  nonce: number,
  vaultAddress: string | null = null
): Hex {
  const encoded = msgpackEncode(action);
  const nonceBytes = new Uint8Array(8);
  // 8-byte big-endian uint64
  const view = new DataView(nonceBytes.buffer);
  view.setBigUint64(0, BigInt(nonce), false);

  let vaultBytes: Uint8Array;
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
  } else {
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
export function phantomAgentTypedData(hash: Hex, isMainnet = true): PhantomAgentTypedData {
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

/**
 * Build a full signing payload for a Hyperliquid L1 action.
 * Caller passes the action object; returns everything the user needs to sign + submit.
 */
export function buildActionPayload(
  action: Record<string, unknown>,
  opts: { nonce?: number; vaultAddress?: string | null; isMainnet?: boolean } = {}
): ActionPayload {
  const nonce = opts.nonce ?? Date.now();
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
