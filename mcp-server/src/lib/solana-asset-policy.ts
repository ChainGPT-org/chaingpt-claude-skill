import type { VersionedTransaction } from '@solana/web3.js';
import type { AgentPolicy } from './agent-policy.js';
import type { AssetSpend } from './signing-journal.js';

/** Restricted mode accepts canonical direct transfers only. Opaque CPIs, LUTs,
 * approvals/delegates, account authority changes and token hooks are refused.
 * Token recipients are destination TOKEN ACCOUNT addresses, not wallet owners.
 */
export function solanaAssetSpends(tx: VersionedTransaction, network: string, policy: AgentPolicy): AssetSpend[] {
  if (policy.unrestricted === true) return [];
  const msg = tx.message;
  if ('addressTableLookups' in msg && msg.addressTableLookups.length) throw new Error('Restricted signing refuses address lookup tables.');
  const out: AssetSpend[] = [];
  let instructionCount = 0;
  for (const ix of msg.compiledInstructions) {
    const program = msg.staticAccountKeys[ix.programIdIndex]?.toBase58();
    const bytes = Buffer.from(ix.data);
    const keys = Array.from(ix.accountKeyIndexes).map(i => msg.staticAccountKeys[i]?.toBase58());
    if (keys.some(k => !k)) throw new Error('Unresolved instruction account.');
    if (program === 'ComputeBudget111111111111111111111111111111') continue;
    if (program === '11111111111111111111111111111111' && bytes.length === 12 && bytes.readUInt32LE() === 2 && keys.length === 2 && keys[0] === msg.staticAccountKeys[0].toBase58()) {
      out.push({ asset: `solana-${network}:SOL`, recipient: keys[1]!, amount: bytes.readBigUInt64LE(4).toString() });
      instructionCount++; continue;
    }
    if (['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(program ?? '') && bytes.length === 10 && bytes[0] === 12 && keys.length === 4 && keys[3] === msg.staticAccountKeys[0].toBase58()) {
      out.push({ asset: `solana-${network}:${keys[1]}`, recipient: keys[2]!, amount: bytes.readBigUInt64LE(1).toString() });
      instructionCount++; continue;
    }
    throw new Error('Restricted Solana signing supports canonical SOL and SPL transferChecked instructions only. Sign opaque protocol transactions externally.');
  }
  if (instructionCount !== 1) throw new Error('Restricted Solana signing requires exactly one transfer.');
  return out;
}
