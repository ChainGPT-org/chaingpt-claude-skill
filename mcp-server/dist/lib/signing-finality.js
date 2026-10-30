import { jsonRpcFallback } from './http.js';
/** An inclusion/confirmation timeout must not release a pending safety hold.
 * Nodes without finalized-block support retain the hold for administrator recovery.
 */
export async function finalizedEvmReceipt(rpcs, hash) {
    try {
        const receipt = await jsonRpcFallback(rpcs, 'eth_getTransactionReceipt', [hash]);
        if (receipt?.transactionHash?.toLowerCase() !== hash.toLowerCase() || !receipt.blockNumber || !receipt.blockHash)
            return false;
        const finalized = await jsonRpcFallback(rpcs, 'eth_getBlockByNumber', ['finalized', false]);
        if (!finalized?.number || BigInt(finalized.number) < BigInt(receipt.blockNumber))
            return false;
        const block = await jsonRpcFallback(rpcs, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
        return typeof block?.hash === 'string' && block.hash.toLowerCase() === receipt.blockHash.toLowerCase();
    }
    catch {
        return false;
    }
}
