import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CHAINS, resolveChain, rpcEndpoints } from '../lib/chains.js';
import { hexToNumber, hexWeiToGwei, httpJson, jsonRpc, jsonRpcFallback } from '../lib/http.js';
import { detectMissingKey } from '../lib/etherscan.js';

/**
 * On-chain analytics. Read-only. Uses Etherscan v2 multichain endpoint
 * (one base URL + chainid query param for all supported EVM chains), with
 * RPC fallback for chains Etherscan doesn't index.
 *
 * - chaingpt_onchain_tx          : decode a transaction by hash (status, gas, value, method, logs summary)
 * - chaingpt_onchain_address     : recent native-token transfer history for an address
 * - chaingpt_onchain_gas         : multi-chain gas oracle (Etherscan-gas-tracker style + RPC fallback)
 * - chaingpt_onchain_block       : block info by number / "latest"
 *
 * ETHERSCAN_API_KEY is optional. Without it, you'll hit a low rate limit
 * but the tools still work.
 */

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';

function etherscanKey(): string {
  return process.env.ETHERSCAN_API_KEY?.trim() || 'YourApiKeyToken';
}

const EVM_TX_TOOL_CHAINS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'linea', 'scroll'];

export const onchainTools: Tool[] = [
  {
    name: 'chaingpt_onchain_tx',
    description:
      'Look up a transaction by hash. Returns status (success/failed/pending), from/to, value, gas used, ' +
      'effective gas price, method signature (if known), and block/timestamp. Works across all major EVM ' +
      'chains via Etherscan v2. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hash: { type: 'string', description: 'Transaction hash (0x…).' },
        chain: {
          type: 'string',
          enum: EVM_TX_TOOL_CHAINS,
          description: 'EVM chain slug. Default: ethereum.',
          default: 'ethereum',
        },
      },
      required: ['hash'],
    },
  },
  {
    name: 'chaingpt_onchain_address',
    description:
      'Get the recent transaction history for an address on an EVM chain. Returns up to 25 most-recent ' +
      'native-token transfers with timestamp, counterparty, value, method, and status. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'Wallet or contract address (0x…).' },
        chain: {
          type: 'string',
          enum: EVM_TX_TOOL_CHAINS,
          description: 'EVM chain slug. Default: ethereum.',
          default: 'ethereum',
        },
        limit: { type: 'number', description: 'Max transactions to return (default 25, max 100).', default: 25 },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_onchain_gas',
    description:
      'Get current gas prices for an EVM chain. Returns safe / standard / fast gwei estimates plus the ' +
      'current base fee. Uses Etherscan gas tracker where available, falls back to eth_gasPrice via public RPC. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: {
          type: 'string',
          enum: EVM_TX_TOOL_CHAINS,
          description: 'EVM chain slug. Default: ethereum.',
          default: 'ethereum',
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_onchain_block',
    description:
      'Get a block by number, or the latest block. Returns timestamp, miner/proposer, tx count, gas used, ' +
      'base fee. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: {
          type: 'string',
          enum: EVM_TX_TOOL_CHAINS,
          description: 'EVM chain slug. Default: ethereum.',
          default: 'ethereum',
        },
        number: {
          type: 'string',
          description: 'Block number (decimal), hex with "0x" prefix, or "latest". Default: latest.',
          default: 'latest',
        },
      },
      required: [],
    },
  },
];

interface EtherscanTxRow {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  txreceipt_status: string;
  methodId: string;
  functionName: string;
  input: string;
}

function formatWei(weiStr: string): string {
  try {
    const wei = BigInt(weiStr);
    const whole = wei / 10n ** 18n;
    const frac = wei % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, '0').slice(0, 6);
    return `${whole}.${fracStr}`;
  } catch {
    return weiStr;
  }
}

function formatTimestamp(ts: string): string {
  const n = Number(ts);
  if (!Number.isFinite(n)) return ts;
  return new Date(n * 1000).toISOString();
}

export async function handleOnchainTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_onchain_tx') {
      const hash = String(args.hash || '').trim();
      if (!hash) return { content: [{ type: 'text', text: 'Error: hash is required.' }] };
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || chain.chainId === null) {
        return { content: [{ type: 'text', text: `chain must be an EVM chain.` }] };
      }

      // Use Etherscan's proxy module which is RPC-shaped. detectMissingKey()
      // returns a friendly hint if the request failed due to a missing key
      // (Etherscan v2 rejects the legacy YourApiKeyToken placeholder).
      const txUrl =
        `${ETHERSCAN_V2}?chainid=${chain.chainId}&module=proxy&action=eth_getTransactionByHash` +
        `&txhash=${hash}&apikey=${etherscanKey() ?? 'YourApiKeyToken'}`;
      const txRes = await httpJson<{ result: any }>(txUrl);
      const txKeyHint = detectMissingKey(txRes);
      if (txKeyHint) return { content: [{ type: 'text', text: txKeyHint }] };
      const tx = txRes.result;
      if (!tx) {
        return { content: [{ type: 'text', text: `No transaction found for ${hash} on ${chain.name}.` }] };
      }

      const receiptUrl =
        `${ETHERSCAN_V2}?chainid=${chain.chainId}&module=proxy&action=eth_getTransactionReceipt` +
        `&txhash=${hash}&apikey=${etherscanKey() ?? 'YourApiKeyToken'}`;
      const receiptRes = await httpJson<{ result: any }>(receiptUrl);
      const receiptKeyHint = detectMissingKey(receiptRes);
      if (receiptKeyHint) return { content: [{ type: 'text', text: receiptKeyHint }] };
      const receipt = receiptRes.result;

      const lines: string[] = [];
      lines.push(`Transaction ${hash}`);
      lines.push(`Chain:           ${chain.name}`);
      lines.push(`Block:           ${tx.blockNumber ? hexToNumber(tx.blockNumber) : '(pending)'}`);
      lines.push(`From:            ${tx.from}`);
      lines.push(`To:              ${tx.to ?? '(contract creation)'}`);
      lines.push(`Value:           ${formatWei(BigInt(tx.value ?? '0x0').toString())} ${chain.native}`);
      if (receipt) {
        const status = receipt.status === '0x1' ? 'success' : 'failed';
        lines.push(`Status:          ${status}`);
        lines.push(`Gas used:        ${hexToNumber(receipt.gasUsed)}`);
        if (receipt.effectiveGasPrice) {
          lines.push(`Gas price:       ${hexWeiToGwei(receipt.effectiveGasPrice)} gwei`);
        }
        if (Array.isArray(receipt.logs)) lines.push(`Log entries:     ${receipt.logs.length}`);
      } else {
        lines.push(`Status:          pending`);
      }
      if (tx.input && tx.input !== '0x') {
        lines.push(`Method id:       ${tx.input.slice(0, 10)} (input length: ${(tx.input.length - 2) / 2} bytes)`);
      }
      lines.push(`Explorer:        ${chain.explorer}/tx/${hash}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_onchain_address') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || chain.chainId === null) {
        return { content: [{ type: 'text', text: `chain must be an EVM chain.` }] };
      }
      const limit = Math.min(Number(args.limit ?? 25), 100);

      const url =
        `${ETHERSCAN_V2}?chainid=${chain.chainId}&module=account&action=txlist&address=${address}` +
        `&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc&apikey=${etherscanKey()}`;
      const res = await httpJson<{ status: string; message: string; result: EtherscanTxRow[] | string }>(url);
      const keyHint = detectMissingKey(res);
      if (keyHint) return { content: [{ type: 'text', text: keyHint }] };
      if (typeof res.result === 'string' || !Array.isArray(res.result)) {
        return {
          content: [{
            type: 'text',
            text: `Etherscan: ${res.message ?? 'no results'}. ${typeof res.result === 'string' ? res.result : ''}`,
          }],
        };
      }
      const txs = res.result;
      if (txs.length === 0) {
        return { content: [{ type: 'text', text: `No transactions found for ${address} on ${chain.name}.` }] };
      }
      const lines: string[] = [];
      lines.push(`Last ${txs.length} transactions for ${address} on ${chain.name}:`);
      lines.push('');
      for (const tx of txs) {
        const dir = tx.from.toLowerCase() === address.toLowerCase() ? 'OUT →' : 'IN  ←';
        const counter = tx.from.toLowerCase() === address.toLowerCase() ? tx.to : tx.from;
        const status = tx.isError === '1' || tx.txreceipt_status === '0' ? '✗' : '✓';
        const method = tx.functionName ? tx.functionName.split('(')[0] : tx.methodId === '0x' ? 'transfer' : tx.methodId;
        lines.push(
          `${status} ${formatTimestamp(tx.timeStamp).slice(0, 19).replace('T', ' ')}  ${dir} ${counter}  ${formatWei(tx.value)} ${chain.native}  [${method}]`
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_onchain_gas') {
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || chain.chainId === null) {
        return { content: [{ type: 'text', text: `chain must be an EVM chain.` }] };
      }
      // Try Etherscan gas tracker (ethereum + a few others). Falls through
      // to the public-RPC fallback below if Etherscan rejects (e.g. missing key).
      try {
        const url = `${ETHERSCAN_V2}?chainid=${chain.chainId}&module=gastracker&action=gasoracle&apikey=${etherscanKey() ?? 'YourApiKeyToken'}`;
        const res = await httpJson<{ status: string; result: any }>(url);
        // detectMissingKey is intentionally NOT used here — gas tracker has a
        // graceful fallback to RPC eth_gasPrice below; we'd rather degrade
        // silently than block the user on the key.
        if (res.status === '1' && res.result) {
          const r = res.result;
          const lines = [
            `Gas — ${chain.name}`,
            '',
            `Safe:        ${r.SafeGasPrice} gwei`,
            `Standard:    ${r.ProposeGasPrice} gwei`,
            `Fast:        ${r.FastGasPrice} gwei`,
            r.suggestBaseFee ? `Base fee:    ${Number(r.suggestBaseFee).toFixed(3)} gwei` : '',
            // gasUsedRatio is a CSV of the last ~5 blocks' utilization (0..1) — average it
            r.gasUsedRatio
              ? `Utilization: ${(
                  (String(r.gasUsedRatio).split(',').map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0) /
                    Math.max(1, String(r.gasUsedRatio).split(',').map(Number).filter(Number.isFinite).length)) * 100
                ).toFixed(0)}% (avg of last ${String(r.gasUsedRatio).split(',').length} blocks)`
              : '',
          ].filter(Boolean);
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
      } catch {
        /* fall through to RPC */
      }

      // RPC fallback (try the chain's RPC list)
      const rpcs = rpcEndpoints(chain.slug);
      if (rpcs.length === 0) {
        return { content: [{ type: 'text', text: `No gas data available for ${chain.name}.` }] };
      }
      const gasPriceHex = await jsonRpcFallback<string>(rpcs, 'eth_gasPrice', []);
      const lines = [
        `Gas — ${chain.name} (RPC fallback, no breakdown available)`,
        '',
        `eth_gasPrice:  ${hexWeiToGwei(gasPriceHex)} gwei`,
        '',
        '(Set ETHERSCAN_API_KEY for safe/standard/fast breakdown.)',
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_onchain_block') {
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || chain.chainId === null) {
        return { content: [{ type: 'text', text: `chain must be an EVM chain.` }] };
      }
      const raw = String(args.number ?? 'latest');
      let blockTag: string;
      if (raw === 'latest' || raw === 'finalized' || raw === 'safe' || raw === 'earliest') {
        blockTag = raw;
      } else if (raw.startsWith('0x')) {
        blockTag = raw;
      } else if (/^\d+$/.test(raw)) {
        blockTag = '0x' + BigInt(raw).toString(16);
      } else {
        return { content: [{ type: 'text', text: `Invalid block: ${raw}` }] };
      }
      const rpcs = rpcEndpoints(chain.slug);
      if (rpcs.length === 0) {
        return { content: [{ type: 'text', text: `No public RPC available for ${chain.name}.` }] };
      }
      const block = await jsonRpcFallback<any>(rpcs, 'eth_getBlockByNumber', [blockTag, false]);
      if (!block) return { content: [{ type: 'text', text: `Block not found: ${raw}` }] };

      const lines = [
        `Block ${hexToNumber(block.number)} on ${chain.name}`,
        '',
        `Hash:            ${block.hash}`,
        `Timestamp:       ${formatTimestamp(BigInt(block.timestamp).toString())}`,
        `Tx count:        ${Array.isArray(block.transactions) ? block.transactions.length : 'n/a'}`,
        `Gas used:        ${hexToNumber(block.gasUsed)} / ${hexToNumber(block.gasLimit)}`,
        block.baseFeePerGas ? `Base fee:        ${hexWeiToGwei(block.baseFeePerGas)} gwei` : '',
        block.miner ? `Miner/proposer:  ${block.miner}` : '',
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown onchain tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Onchain error: ${message}`);
  }
}
