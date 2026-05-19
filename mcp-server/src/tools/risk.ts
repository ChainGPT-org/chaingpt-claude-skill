import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ALL_CHAIN_SLUGS, CHAINS, resolveChain } from '../lib/chains.js';
import { httpJson } from '../lib/http.js';

/**
 * Risk & security tools. The whole point of this category is to enforce the
 * "check before you act" pattern that mirrors ChainGPT's Security Extension
 * positioning. Every executing tool we add in Tier 3 should auto-call one of
 * these as a pre-flight gate.
 *
 * - chaingpt_risk_token         : GoPlus token-security check (honeypot/tax/proxy/mintable)
 * - chaingpt_risk_honeypot      : Honeypot.is simulator (slippage + buy/sell tax)
 * - chaingpt_risk_address       : GoPlus malicious-address check (sanctions/phishing/scam)
 * - chaingpt_risk_contract_source : Etherscan v2 verified-source fetch + diff hints
 *
 * All four use free public endpoints. GoPlus + Honeypot need no key.
 * The source-fetch tool wants `ETHERSCAN_API_KEY` for higher rate limits but
 * Etherscan v2 free tier (5 req/s) works without one.
 */

const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';
const HONEYPOT_BASE = 'https://api.honeypot.is/v2';
const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';

function etherscanKey(): string {
  return process.env.ETHERSCAN_API_KEY?.trim() || 'YourApiKeyToken';
}

export const riskTools: Tool[] = [
  {
    name: 'chaingpt_risk_token',
    description:
      'Run a token-security check via GoPlus Labs. Flags honeypot, mintable, blacklist functions, ownership ' +
      'concentration, hidden buy/sell tax, anti-whale traps, proxy contracts, and more. ' +
      'Returns a one-line verdict + the list of risk flags. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Token contract address (0x… on EVM or base58 on Solana).',
        },
        chain: {
          type: 'string',
          enum: ALL_CHAIN_SLUGS,
          description: 'Chain slug. Default: ethereum.',
          default: 'ethereum',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_risk_honeypot',
    description:
      'Simulate a buy + sell of a token via Honeypot.is to detect honeypots, hidden taxes, and gas-bomb ' +
      'transfer functions. Returns simulation result, buy tax %, sell tax %, transfer tax %, and verdict. ' +
      'Supports Ethereum, BSC, Base, Arbitrum. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Token contract address (0x…).',
        },
        chain: {
          type: 'string',
          enum: ['ethereum', 'bsc', 'base', 'arbitrum'],
          description: 'Chain slug. Default: ethereum.',
          default: 'ethereum',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_risk_address',
    description:
      'Check whether a wallet or contract address is flagged for malicious behavior via GoPlus: sanctions, ' +
      'phishing, scam labels, mixer use, blacklist membership. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Address to check.',
        },
        chain: {
          type: 'string',
          enum: ALL_CHAIN_SLUGS,
          description: 'Chain slug. Default: ethereum.',
          default: 'ethereum',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_risk_contract_source',
    description:
      'Fetch the verified source code, ABI, and compiler settings for a contract from Etherscan v2 ' +
      '(works across all major EVM chains via a single endpoint). Returns whether the contract is verified, ' +
      'its compiler version, and a preview of the source. ETHERSCAN_API_KEY is optional but recommended. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Contract address (0x…).',
        },
        chain: {
          type: 'string',
          enum: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'linea', 'scroll'],
          description: 'EVM chain slug. Default: ethereum.',
          default: 'ethereum',
        },
        previewChars: {
          type: 'number',
          description: 'How many characters of source to include in the preview (default 1500).',
          default: 1500,
        },
      },
      required: ['address'],
    },
  },
];

interface GoplusTokenRow {
  is_honeypot?: string;
  honeypot_with_same_creator?: string;
  is_mintable?: string;
  is_proxy?: string;
  is_blacklisted?: string;
  is_whitelisted?: string;
  cannot_buy?: string;
  cannot_sell_all?: string;
  trading_cooldown?: string;
  buy_tax?: string;
  sell_tax?: string;
  transfer_pausable?: string;
  hidden_owner?: string;
  can_take_back_ownership?: string;
  owner_change_balance?: string;
  selfdestruct?: string;
  external_call?: string;
  token_name?: string;
  token_symbol?: string;
  holder_count?: string;
  total_supply?: string;
  creator_address?: string;
  owner_address?: string;
  anti_whale_modifiable?: string;
  is_anti_whale?: string;
  trust_list?: string;
}

const RISK_FLAGS: Array<{ field: keyof GoplusTokenRow; label: string }> = [
  { field: 'is_honeypot', label: 'Honeypot detected' },
  { field: 'cannot_buy', label: 'Cannot buy' },
  { field: 'cannot_sell_all', label: 'Cannot sell all' },
  { field: 'is_blacklisted', label: 'Has blacklist function' },
  { field: 'transfer_pausable', label: 'Transfers can be paused' },
  { field: 'is_mintable', label: 'Mintable (supply not fixed)' },
  { field: 'is_proxy', label: 'Proxy contract (logic upgradeable)' },
  { field: 'hidden_owner', label: 'Hidden owner' },
  { field: 'can_take_back_ownership', label: 'Ownership can be reclaimed' },
  { field: 'owner_change_balance', label: 'Owner can change balances' },
  { field: 'selfdestruct', label: 'Selfdestruct function present' },
  { field: 'external_call', label: 'External call risk' },
  { field: 'trading_cooldown', label: 'Trading cooldown enforced' },
  { field: 'anti_whale_modifiable', label: 'Anti-whale rules are modifiable' },
];

export async function handleRiskTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_risk_token') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || !chain.goplus) {
        return { content: [{ type: 'text', text: `GoPlus does not support chain: ${args.chain}` }] };
      }
      const url = `${GOPLUS_BASE}/token_security/${chain.goplus}?contract_addresses=${address}`;
      const res = await httpJson<{ code: number; message: string; result: Record<string, GoplusTokenRow> }>(url);
      if (res.code !== 1 && res.code !== 0) {
        return { content: [{ type: 'text', text: `GoPlus error: ${res.message ?? 'unknown'}` }] };
      }
      const row = res.result?.[address.toLowerCase()];
      if (!row) {
        return {
          content: [{
            type: 'text',
            text: `GoPlus has no data for ${address} on ${chain.name}. (Token may be too new or not indexed.)`,
          }],
        };
      }

      const flagged = RISK_FLAGS.filter((f) => row[f.field] === '1');
      const lines: string[] = [];
      lines.push(`Token security — ${row.token_name ?? '(unknown)'} (${row.token_symbol ?? '?'})`);
      lines.push(`Chain:           ${chain.name}`);
      lines.push(`Contract:        ${address}`);
      if (row.holder_count) lines.push(`Holders:         ${row.holder_count}`);
      if (row.buy_tax || row.sell_tax) {
        const buy = row.buy_tax ? `${(Number(row.buy_tax) * 100).toFixed(2)}%` : '?';
        const sell = row.sell_tax ? `${(Number(row.sell_tax) * 100).toFixed(2)}%` : '?';
        lines.push(`Buy / sell tax:  ${buy} / ${sell}`);
      }
      lines.push('');
      if (flagged.length === 0) {
        lines.push('✓ No risk flags raised by GoPlus.');
      } else {
        lines.push(`⚠ ${flagged.length} risk flag(s) raised:`);
        for (const f of flagged) lines.push(`  - ${f.label}`);
      }
      lines.push('');
      lines.push('Reminder: GoPlus is a heuristic. For high-value actions, also run chaingpt_audit_contract.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_risk_honeypot') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || !chain.honeypot) {
        return { content: [{ type: 'text', text: `Honeypot.is does not support chain: ${args.chain}` }] };
      }
      const url = `${HONEYPOT_BASE}/IsHoneypot?address=${address}&chainID=${chain.honeypot}`;
      const res = await httpJson<any>(url);
      const lines: string[] = [];
      lines.push(`Honeypot simulation — ${res?.token?.symbol ?? '?'} (${address})`);
      lines.push(`Chain:           ${chain.name}`);
      lines.push('');
      const isHoneypot = res?.honeypotResult?.isHoneypot;
      lines.push(isHoneypot ? '⚠ Honeypot detected.' : '✓ Buy + sell simulation succeeded.');
      const tax = res?.simulationResult ?? {};
      if (tax.buyTax !== undefined) lines.push(`Buy tax:         ${Number(tax.buyTax).toFixed(2)}%`);
      if (tax.sellTax !== undefined) lines.push(`Sell tax:        ${Number(tax.sellTax).toFixed(2)}%`);
      if (tax.transferTax !== undefined) lines.push(`Transfer tax:    ${Number(tax.transferTax).toFixed(2)}%`);
      if (res?.summary?.risk) lines.push(`Overall risk:    ${res.summary.risk}`);
      if (Array.isArray(res?.flags) && res.flags.length > 0) {
        lines.push('');
        lines.push('Flags raised:');
        for (const f of res.flags) lines.push(`  - ${f}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_risk_address') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || !chain.goplus) {
        return { content: [{ type: 'text', text: `GoPlus does not support chain: ${args.chain}` }] };
      }
      const url = `${GOPLUS_BASE}/address_security/${address}?chain_id=${chain.goplus}`;
      const res = await httpJson<{ code: number; message: string; result?: Record<string, string> }>(url);
      const r = res.result ?? {};
      const flagFields = [
        ['cybercrime', 'Cybercrime'],
        ['money_laundering', 'Money laundering'],
        ['number_of_malicious_contracts_created', 'Created malicious contracts'],
        ['gas_abuse', 'Gas abuse'],
        ['financial_crime', 'Financial crime'],
        ['darkweb_transactions', 'Darkweb activity'],
        ['reinit', 'Reinit pattern'],
        ['phishing_activities', 'Phishing'],
        ['fake_kyc', 'Fake KYC'],
        ['blacklist_doubt', 'Blacklisted (suspected)'],
        ['fake_standard_interface', 'Fake token-standard interface'],
        ['stealing_attack', 'Stealing attack'],
        ['blackmail_activities', 'Blackmail activity'],
        ['sanctioned', 'Sanctioned'],
        ['malicious_mining_activities', 'Malicious mining'],
        ['mixer', 'Mixer'],
        ['fake_news', 'Fake news / scam token'],
        ['honeypot_related_address', 'Linked to known honeypot'],
      ] as const;
      const flagged = flagFields.filter(([k]) => r[k] && r[k] !== '0' && r[k] !== '');
      const lines: string[] = [];
      lines.push(`Address risk — ${address} on ${chain.name}`);
      lines.push('');
      if (flagged.length === 0) {
        lines.push('✓ No malicious-address flags from GoPlus.');
      } else {
        lines.push(`⚠ ${flagged.length} flag(s) raised:`);
        for (const [, label] of flagged) lines.push(`  - ${label}`);
      }
      lines.push('');
      lines.push('Note: a clean GoPlus result is not the same as a clean address. For destination wallets in');
      lines.push('large transfers, also cross-check on-chain history with chaingpt_onchain_address.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_risk_contract_source') {
      const address = String(args.address || '').trim();
      if (!address) return { content: [{ type: 'text', text: 'Error: address is required.' }] };
      const chain = resolveChain((args.chain as string | undefined) ?? 'ethereum');
      if (!chain || chain.chainId === null) {
        return { content: [{ type: 'text', text: `Etherscan source fetch requires an EVM chain.` }] };
      }
      const previewChars = Number(args.previewChars ?? 1500);
      const url =
        `${ETHERSCAN_V2_BASE}?chainid=${chain.chainId}&module=contract&action=getsourcecode` +
        `&address=${address}&apikey=${etherscanKey()}`;
      const res = await httpJson<{ status: string; message: string; result: any[] }>(url);
      const row = res.result?.[0];
      if (!row || !row.SourceCode) {
        return {
          content: [{
            type: 'text',
            text:
              `No verified source code for ${address} on ${chain.name}.\n` +
              `Either the contract isn't verified yet, or Etherscan rate-limited the request. ` +
              `Set ETHERSCAN_API_KEY to lift the rate limit.`,
          }],
        };
      }

      // Etherscan returns either a raw .sol string or a JSON-wrapped multi-file string starting with "{{"
      let source = row.SourceCode as string;
      let fileCount = 1;
      if (source.startsWith('{{') && source.endsWith('}}')) {
        try {
          const parsed = JSON.parse(source.slice(1, -1));
          if (parsed.sources && typeof parsed.sources === 'object') {
            fileCount = Object.keys(parsed.sources).length;
            const firstFile = Object.entries(parsed.sources)[0] as [string, any];
            source = `// ${firstFile[0]}\n${firstFile[1].content ?? ''}`;
          }
        } catch {
          /* fall through with raw */
        }
      }

      const lines: string[] = [];
      lines.push(`Contract source — ${row.ContractName} (${address}) on ${chain.name}`);
      lines.push(`Compiler:        ${row.CompilerVersion}`);
      lines.push(`Optimization:    ${row.OptimizationUsed === '1' ? `on (${row.Runs} runs)` : 'off'}`);
      lines.push(`License:         ${row.LicenseType ?? 'n/a'}`);
      lines.push(`Proxy:           ${row.Proxy === '1' ? `yes — implementation: ${row.Implementation}` : 'no'}`);
      lines.push(`Files:           ${fileCount}`);
      lines.push(`Explorer:        ${chain.explorer}/address/${address}#code`);
      lines.push('');
      lines.push(`--- Source preview (${Math.min(previewChars, source.length)} / ${source.length} chars) ---`);
      lines.push(source.slice(0, previewChars));
      if (source.length > previewChars) lines.push('\n... (truncated; raise previewChars to see more)');
      lines.push('');
      lines.push('Tip: pipe this into chaingpt_audit_contract for an AI security audit.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown risk tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Risk error: ${message}`);
  }
}
