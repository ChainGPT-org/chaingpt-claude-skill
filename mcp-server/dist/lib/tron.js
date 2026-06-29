/**
 * TronGrid / full-node HTTP client. Custody-free: this module never holds a
 * key. It builds UNSIGNED transactions (the node does the protobuf encoding),
 * reads accounts/contracts, and broadcasts already-signed transactions. The
 * signer lives in tron-sign.ts.
 *
 * Networks: mainnet (api.trongrid.io) + Shasta/Nile testnets. Override the host
 * with TRON_RPC_URL; supply a TronGrid key via TRON_PRO_API_KEY (mainnet keyless
 * is throttled). See docs/tron/RESEARCH.md §5.
 */
import { httpJson } from './http.js';
const HOSTS = {
    mainnet: 'https://api.trongrid.io',
    shasta: 'https://api.shasta.trongrid.io',
    nile: 'https://nile.trongrid.io',
};
/** Hosts we consider first-party/trusted for autonomous (agent-wallet) signing. */
export const TRUSTED_TRON_HOSTS = ['api.trongrid.io', 'api.shasta.trongrid.io', 'nile.trongrid.io'];
export function isTronMainnet(network) {
    return (network ?? 'mainnet') === 'mainnet';
}
/** Resolve the base host for a network. TRON_RPC_URL overrides for all networks. */
export function tronHost(network = 'mainnet') {
    const override = process.env.TRON_RPC_URL?.trim();
    return (override || HOSTS[network]).replace(/\/+$/, '');
}
/** True when the active host is a first-party TronGrid host (or no override is set). */
export function isTrustedTronHost(network = 'mainnet') {
    const override = process.env.TRON_RPC_URL?.trim();
    if (!override)
        return true;
    try {
        return TRUSTED_TRON_HOSTS.includes(new URL(override).hostname);
    }
    catch {
        return false;
    }
}
function tronHeaders() {
    const key = process.env.TRON_PRO_API_KEY?.trim();
    return key ? { 'TRON-PRO-API-KEY': key } : {};
}
/**
 * Convert a SUN bigint to the int64 the Tron HTTP API expects, refusing values
 * that would lose precision as a JS number (> ~9e15 SUN ≈ 9B TRX, unrealistic
 * for an agent) instead of silently truncating.
 */
function toApiAmount(sun) {
    if (sun < 0n)
        throw new Error('amount cannot be negative');
    if (sun > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`amount ${sun} SUN exceeds the Tron HTTP API safe integer range (${Number.MAX_SAFE_INTEGER}); split the transaction.`);
    }
    return Number(sun);
}
/** Low-level POST to a `/wallet/...` (or `/walletsolidity/...`) endpoint. */
export async function walletPost(network, path, body, timeoutMs) {
    const url = `${tronHost(network)}${path}`;
    return httpJson(url, { method: 'POST', body, headers: tronHeaders(), timeoutMs });
}
/** getaccount — TRX balance (SUN) + TRC-10 holdings + resources. Empty object ⇒ unactivated. */
export async function getAccount(network, addressBase58) {
    return walletPost(network, '/wallet/getaccount', { address: addressBase58, visible: true });
}
export async function getAccountResource(network, addressBase58) {
    return walletPost(network, '/wallet/getaccountresource', { address: addressBase58, visible: true });
}
/**
 * triggerconstantcontract — read-only contract call (balanceOf/decimals/symbol)
 * and the pre-broadcast revert check. `parameter` is the ABI-encoded args WITHOUT
 * the 4-byte selector (hex, no 0x). Never signs, never broadcasts.
 */
export async function triggerConstantContract(network, args) {
    return walletPost(network, '/wallet/triggerconstantcontract', {
        owner_address: args.ownerBase58,
        contract_address: args.contractBase58,
        function_selector: args.functionSelector,
        parameter: args.parameter ?? '',
        visible: true,
    });
}
export async function getTransactionInfoById(network, txId) {
    return walletPost(network, '/wallet/gettransactioninfobyid', { value: txId.replace(/^0x/, '') });
}
export async function getNowBlock(network) {
    return walletPost(network, '/wallet/getnowblock', {});
}
/** createtransaction — build an unsigned native TRX transfer (amount in SUN). */
export async function createTransaction(network, args) {
    const res = await walletPost(network, '/wallet/createtransaction', {
        owner_address: args.ownerBase58,
        to_address: args.toBase58,
        amount: toApiAmount(args.amountSun),
        visible: true,
    });
    if (res.Error)
        throw new Error(`Tron createtransaction failed: ${res.Error}`);
    if (!res.raw_data_hex || !res.txID)
        throw new Error(`Tron createtransaction returned no transaction (recipient activation issue?): ${JSON.stringify(res).slice(0, 200)}`);
    return res;
}
/**
 * triggersmartcontract — build an unsigned contract-call tx. `parameter` is the
 * ABI-encoded args without the selector (hex, no 0x). Returns the node response
 * whose `.transaction` is the unsigned tx to sign.
 */
export async function triggerSmartContract(network, args) {
    const res = await walletPost(network, '/wallet/triggersmartcontract', {
        owner_address: args.ownerBase58,
        contract_address: args.contractBase58,
        function_selector: args.functionSelector,
        parameter: args.parameter ?? '',
        fee_limit: toApiAmount(args.feeLimitSun),
        call_value: toApiAmount(args.callValueSun ?? 0n),
        visible: true,
    });
    return res;
}
export async function broadcastTransaction(network, signedTx) {
    return walletPost(network, '/wallet/broadcasttransaction', signedTx);
}
/** Decode a possibly-hex (`message` field is hex) broadcast error to text. */
export function decodeBroadcastMessage(msg) {
    if (!msg)
        return '';
    if (/^[0-9a-fA-F]+$/.test(msg) && msg.length % 2 === 0) {
        try {
            return Buffer.from(msg, 'hex').toString('utf8');
        }
        catch {
            return msg;
        }
    }
    return msg;
}
