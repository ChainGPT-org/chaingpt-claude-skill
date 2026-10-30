import { jsonRpcFallback } from './http.js';
import { toEventSelector } from 'viem';
/** An inclusion/confirmation timeout must not release a pending safety hold.
 * Nodes without finalized-block support retain the hold for administrator recovery.
 */
export async function finalizedEvmReceipt(rpcs: string[], hash: string): Promise<boolean> {
  try {
    const receipt = await jsonRpcFallback<any>(rpcs, 'eth_getTransactionReceipt', [hash]);
    return await receiptIsFinalized(rpcs, hash, receipt);
  } catch { return false; }
}

async function receiptIsFinalized(rpcs: string[], hash: string, receipt: any): Promise<boolean> {
  if (receipt?.transactionHash?.toLowerCase() !== hash.toLowerCase() || !receipt.blockNumber || !receipt.blockHash) return false;
  const finalized = await jsonRpcFallback<any>(rpcs, 'eth_getBlockByNumber', ['finalized', false]);
  if (!finalized?.number || BigInt(finalized.number) < BigInt(receipt.blockNumber)) return false;
  const block = await jsonRpcFallback<any>(rpcs, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
  return typeof block?.hash === 'string' && block.hash.toLowerCase() === receipt.blockHash.toLowerCase();
}

/** A bundler response alone cannot bind a user operation to an included transaction. */
export async function finalizedUserOperationReceipt(rpcs: string[], userOpHash: string, entryPoint: string, bundlerReceipt: any): Promise<boolean> {
  try {
    const hash = bundlerReceipt?.receipt?.transactionHash;
    if (typeof hash !== 'string' || bundlerReceipt?.userOpHash?.toLowerCase() !== userOpHash.toLowerCase()) return false;
    const receipt = await jsonRpcFallback<any>(rpcs, 'eth_getTransactionReceipt', [hash]);
    const event = toEventSelector('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)');
    if (!Array.isArray(receipt?.logs) || !receipt.logs.some((log: any) =>
      log.removed !== true && log.address?.toLowerCase() === entryPoint.toLowerCase() &&
      log.topics?.[0]?.toLowerCase() === event && log.topics?.[1]?.toLowerCase() === userOpHash.toLowerCase()
    )) return false;
    return await receiptIsFinalized(rpcs, hash, receipt);
  } catch { return false; }
}
