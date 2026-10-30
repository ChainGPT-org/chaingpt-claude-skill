import { decodeFunctionData, parseAbi } from 'viem';
import type { AgentPolicy } from './agent-policy.js';
import { readReservations, type AssetSpend } from './signing-journal.js';

export interface AssetLimit {
  chain: string; asset: string; allowedRecipients: string[];
  maxTxAmount: string; maxDailyAmount: string;
}
const ERC20 = parseAbi(['function transfer(address to,uint256 amount)', 'function approve(address spender,uint256 amount)']);
export function evmAssetSpends(chain: string, to: string, data: string, value: bigint, policy: AgentPolicy): AssetSpend[] {
  if (policy.unrestricted === true || data === '0x' || data === '') return [];
  if (value !== 0n) throw new Error('Restricted signing refuses opaque payable contract calls. Use external signing.');
  let call;
  try { call = decodeFunctionData({ abi: ERC20, data: data as `0x${string}` }); }
  catch { throw new Error('Restricted signing supports only native transfers and exact ERC-20 transfer/approve calls. Use external signing for opaque protocol calls.'); }
  if (data.length !== 138) throw new Error('Non-canonical token calldata refused.');
  const [recipient, amount] = call.args;
  if (call.functionName === 'approve' && amount === (1n << 256n) - 1n) throw new Error('Unlimited approvals are refused in restricted mode.');
  return [{ asset: `${chain}:${to.toLowerCase()}`, recipient: recipient.toLowerCase(), amount: amount.toString() }];
}
export function checkAssetLimits(chain: string, spends: AssetSpend[], policy: AgentPolicy, activityFile: string): void {
  if (policy.unrestricted === true) return;
  const records = readReservations(activityFile);
  for (const spend of spends) {
    const rule = policy.assetLimits?.find(r => r.chain === chain && `${chain}:${r.asset}` === spend.asset);
    if (!rule || !rule.allowedRecipients.includes(spend.recipient)) throw new Error('Token or recipient is not explicitly authorized by assetLimits.');
    const amount = BigInt(spend.amount);
    const cutoff = Date.now() - 86400000;
    const used = records.filter(r => r.state !== 'confirmed' || Date.parse(r.ts) >= cutoff)
      .flatMap(r => r.assets).filter(a => a.asset === spend.asset).reduce((n, a) => n + BigInt(a.amount), 0n);
    const current = spends.filter(a => a.asset === spend.asset).reduce((n, a) => n + BigInt(a.amount), 0n);
    if (current > BigInt(rule.maxTxAmount) || used + current > BigInt(rule.maxDailyAmount)) throw new Error('Token spending limit exceeded.');
  }
}
