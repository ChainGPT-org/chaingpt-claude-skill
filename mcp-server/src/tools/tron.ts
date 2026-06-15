import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpJson } from '../lib/http.js';
import {
  isTronAddress,
  tronToEvmAddress,
  tronToHex,
  base58ToHex21,
} from '../lib/tron-address.js';
import {
  type TronNetwork,
  isTronMainnet,
  getAccount,
  getAccountResource,
  getTransactionInfoById,
} from '../lib/tron.js';
import {
  readTrc20Balance,
  readTrc20Decimals,
  readTrc20Symbol,
  buildTrxTransfer,
  buildTrc20Transfer,
} from '../lib/tron-sign.js';
import {
  TRON_TOKENS,
  resolveTronToken,
  assertNotPoisoned,
  TRX_DECIMALS,
  SUN_PER_TRX,
  TRON_DEFI,
  DEFAULT_FEE_LIMIT_SUN,
} from '../lib/tron-tokens.js';
import {
  sunswapAmountsOut,
  justlendAccountLiquidity,
  justlendMarketBalances,
  buildJustlendTx,
  type JustlendMarket,
  type JustlendAction,
} from '../lib/tron-defi.js';

const NETWORK_ENUM = ['mainnet', 'shasta', 'nile'] as const;
const ACK = {
  acknowledgeMainnet: { type: 'boolean', description: 'Must be true to BUILD a mainnet (real-funds) transaction. Testnets do not require it.', default: false },
} as const;

// ── unit helpers ─────────────────────────────────────────────────────
export function parseUnits(human: string | number, decimals: number): bigint {
  const s = String(human).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount "${human}"`);
  const [int, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`amount "${human}" has more than ${decimals} decimal places`);
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}
export function formatUnits(v: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : `${int}`;
}
const fmtTrx = (sun: bigint) => `${formatUnits(sun, TRX_DECIMALS)} TRX`;
const net = (a: Record<string, unknown>): TronNetwork => (String(a.network ?? 'mainnet') as TronNetwork);

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}
function requireAddress(addr: unknown, label = 'address'): string {
  const s = String(addr ?? '');
  if (!isTronAddress(s)) throw new Error(`${label} is not a valid Tron base58 address: "${s}"`);
  assertNotPoisoned(s);
  return s;
}
function mainnetGate(network: TronNetwork, a: Record<string, unknown>): string | null {
  if (isTronMainnet(network) && a.acknowledgeMainnet !== true) {
    return 'Refused to build a MAINNET transaction without acknowledgeMainnet:true. This tool returns an UNSIGNED tx (custody-free) — set acknowledgeMainnet:true once you have reviewed the parameters, then sign it in TronLink (or via the agent wallet).';
  }
  return null;
}

export const tronTools: Tool[] = [
  {
    name: 'chaingpt_tron_validate_address',
    description: 'Validate a Tron base58 "T…" address and show its hex (41…) and EVM (0x…) forms. Pure/offline, 0 ChainGPT credits.',
    inputSchema: { type: 'object' as const, properties: { address: { type: 'string', description: 'Tron base58 address.' } }, required: ['address'] },
  },
  {
    name: 'chaingpt_tron_balances',
    description: "Read a Tron account's TRX balance + bandwidth/energy resources, plus TRC-20 balances for the given tokens (default USDT). 0 ChainGPT credits.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'Tron base58 address.' },
        tokens: { type: 'array', items: { type: 'string' }, description: 'TRC-20 symbols (USDT, USDD, …) or contract addresses to also read. Default ["USDT"].' },
        network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' },
      },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_tron_token_balance',
    description: 'Read a single TRC-20 balance (resolves symbol + decimals on-chain when not in the curated registry). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'Holder Tron address.' },
        token: { type: 'string', description: 'TRC-20 symbol (USDT, …) or contract address.' },
        network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' },
      },
      required: ['address', 'token'],
    },
  },
  {
    name: 'chaingpt_tron_account_resources',
    description: "Read a Tron account's bandwidth + energy (used/limit) and staked resources. 0 ChainGPT credits.",
    inputSchema: {
      type: 'object' as const,
      properties: { address: { type: 'string' }, network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' } },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_tron_tx_info',
    description: 'Look up a Tron transaction receipt by id (fee, energy, result, block). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: { txid: { type: 'string' }, network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' } },
      required: ['txid'],
    },
  },
  {
    name: 'chaingpt_tron_research_token',
    description: 'Market research for a Tron token via DexScreener (price, liquidity, 24h volume across SunSwap pairs). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string', description: 'TRC-20 symbol or contract address.' } },
      required: ['token'],
    },
  },
  {
    name: 'chaingpt_tron_risk_token',
    description: 'Security scan for a Tron TRC-20 via GoPlus (honeypot, mintable, owner privileges, tax). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string', description: 'TRC-20 symbol or contract address.' } },
      required: ['token'],
    },
  },
  {
    name: 'chaingpt_tron_build_transfer_tx',
    description: 'Build an UNSIGNED native TRX transfer (custody-free — sign externally or via the agent wallet). Mainnet requires acknowledgeMainnet:true. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Sender Tron address.' },
        to: { type: 'string', description: 'Recipient Tron address.' },
        amountTrx: { type: 'string', description: 'Amount in TRX (e.g. "12.5").' },
        network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' },
        ...ACK,
      },
      required: ['from', 'to', 'amountTrx'],
    },
  },
  {
    name: 'chaingpt_tron_build_trc20_transfer_tx',
    description: 'Build an UNSIGNED TRC-20 transfer (custody-free). Resolves token decimals from the registry or on-chain. Mainnet requires acknowledgeMainnet:true. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string' },
        token: { type: 'string', description: 'TRC-20 symbol (USDT, …) or contract address.' },
        to: { type: 'string' },
        amount: { type: 'string', description: 'Human amount in token units (e.g. "100" USDT).' },
        feeLimitTrx: { type: 'string', description: 'Max TRX burnable for energy. Default 100.' },
        network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' },
        ...ACK,
      },
      required: ['from', 'token', 'to', 'amount'],
    },
  },
  {
    name: 'chaingpt_tron_dex_sunswap_quote',
    description: 'Quote a SunSwap swap (read-only, via V2 getAmountsOut). Provide token symbols/addresses; TRX legs are auto-routed through WTRX. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenIn: { type: 'string', description: 'Input token: "TRX", a symbol, or a contract address.' },
        tokenOut: { type: 'string', description: 'Output token: "TRX", a symbol, or a contract address.' },
        amountIn: { type: 'string', description: 'Human input amount.' },
        network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
    },
  },
  {
    name: 'chaingpt_tron_lend_justlend_account',
    description: 'Read a JustLend account: USD account liquidity / shortfall + per-market supplied/borrowed (TRX, USDT, USDD). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: { address: { type: 'string' }, network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' } },
      required: ['address'],
    },
  },
  {
    name: 'chaingpt_tron_lend_justlend_build_tx',
    description: 'Build an UNSIGNED JustLend action (approve/supply/withdraw/borrow/repay) for a market (TRX/USDT/USDD). TRC-20 supply/repay need a prior approve. Mainnet requires acknowledgeMainnet:true. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string' },
        market: { type: 'string', enum: ['TRX', 'USDT', 'USDD'], description: 'Underlying market.' },
        action: { type: 'string', enum: ['approve', 'supply', 'withdraw', 'borrow', 'repay'] },
        amount: { type: 'string', description: 'Human amount in the underlying (TRX or token units).' },
        feeLimitTrx: { type: 'string', description: 'Max TRX burnable for energy. Default 100.' },
        network: { type: 'string', enum: NETWORK_ENUM as unknown as string[], default: 'mainnet' },
        ...ACK,
      },
      required: ['from', 'market', 'action', 'amount'],
    },
  },
];

// Resolve a token arg to {address, symbol, decimals}, reading on-chain when unknown.
async function resolveToken(network: TronNetwork, tokenArg: string): Promise<{ address: string; symbol: string; decimals: number }> {
  const curated = resolveTronToken(tokenArg);
  if (curated) return { address: curated.address, symbol: curated.symbol, decimals: curated.decimals };
  const address = requireAddress(tokenArg, 'token');
  const [decimals, symbol] = await Promise.all([
    readTrc20Decimals(network, address, address),
    readTrc20Symbol(network, address, address).catch(() => 'TRC20'),
  ]);
  return { address, symbol, decimals };
}

// "TRX" | symbol | address → base58 address for a swap leg (TRX → WTRX).
function swapLeg(tokenArg: string): { address: string; isNative: boolean; symbol: string } {
  if (String(tokenArg).trim().toUpperCase() === 'TRX') {
    return { address: TRON_DEFI.sunswap.wtrx, isNative: true, symbol: 'TRX' };
  }
  const curated = resolveTronToken(tokenArg);
  if (curated) return { address: curated.address, isNative: false, symbol: curated.symbol };
  return { address: requireAddress(tokenArg, 'token'), isNative: false, symbol: 'TRC20' };
}

function unsignedTxBlock(label: string, tx: { txID: string; raw_data_hex: string }, extra: string[]): ReturnType<typeof text> {
  return text([
    label,
    '',
    `txID:          ${tx.txID}`,
    ...extra,
    '',
    'This is an UNSIGNED transaction. Sign it in TronLink, or autonomously via chaingpt_agent_wallet_tron_sign_and_send (policy-fenced).',
    `raw_data_hex:  ${tx.raw_data_hex}`,
  ].join('\n'));
}

export async function handleTronTool(name: string, args: Record<string, unknown> | undefined): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const a = args ?? {};
  try {
    switch (name) {
      case 'chaingpt_tron_validate_address': {
        const s = String(a.address ?? '');
        if (!isTronAddress(s)) return text(`✗ "${s}" is not a valid Tron base58 address (T + 33 base58 chars + checksum).`);
        return text([`✓ Valid Tron address`, '', `base58:  ${s}`, `hex:     ${tronToHex(s)}`, `evm:     ${tronToEvmAddress(s)}`, `explorer: https://tronscan.org/#/address/${s}`].join('\n'));
      }

      case 'chaingpt_tron_account_resources': {
        const addr = requireAddress(a.address);
        const network = net(a);
        const r = await getAccountResource(network, addr);
        const freeNet = (r.freeNetLimit ?? 0) - (r.freeNetUsed ?? 0);
        return text([
          `Tron resources for ${addr} (${network})`,
          '',
          `Free bandwidth: ${freeNet} / ${r.freeNetLimit ?? 0}`,
          `Staked bandwidth: ${(r.NetLimit ?? 0) - (r.NetUsed ?? 0)} / ${r.NetLimit ?? 0}`,
          `Energy:         ${(r.EnergyLimit ?? 0) - (r.EnergyUsed ?? 0)} / ${r.EnergyLimit ?? 0}`,
        ].join('\n'));
      }

      case 'chaingpt_tron_balances': {
        const addr = requireAddress(a.address);
        const network = net(a);
        const acct = await getAccount(network, addr);
        const sun = BigInt(acct.balance ?? 0);
        // Native TRX is shown above; drop it (and any blanks) from the TRC-20 list.
        const requested = Array.isArray(a.tokens) && a.tokens.length ? (a.tokens as string[]) : ['USDT'];
        const tokenArgs = requested.filter((t) => String(t).trim() !== '' && String(t).trim().toUpperCase() !== 'TRX');
        const lines = [`Tron balances for ${addr} (${network})`, '', `TRX: ${fmtTrx(sun)}`];
        if (acct.balance === undefined) lines.push('(account not yet activated — fund it with ~1.1 TRX to activate)');
        for (const t of tokenArgs) {
          try {
            const { address, symbol, decimals } = await resolveToken(network, t);
            const bal = await readTrc20Balance(network, address, addr);
            lines.push(`${symbol}: ${formatUnits(bal, decimals)}`);
          } catch (e: any) {
            lines.push(`${t}: (read failed — ${e?.message ?? e})`);
          }
        }
        return text(lines.join('\n'));
      }

      case 'chaingpt_tron_token_balance': {
        const addr = requireAddress(a.address);
        const network = net(a);
        const { address, symbol, decimals } = await resolveToken(network, String(a.token ?? ''));
        const bal = await readTrc20Balance(network, address, addr);
        return text(`${symbol} balance of ${addr}: ${formatUnits(bal, decimals)} (${bal} base units, ${decimals} decimals)`);
      }

      case 'chaingpt_tron_tx_info': {
        const network = net(a);
        const info = await getTransactionInfoById(network, String(a.txid ?? ''));
        if (!info || Object.keys(info).length === 0) return text(`No info found for tx ${a.txid} on ${network} (unconfirmed or wrong network?).`);
        return text([
          `Tron tx ${info.id ?? a.txid} (${network})`,
          '',
          `Block:    ${info.blockNumber ?? '?'}`,
          `Result:   ${info.receipt?.result ?? (info.contractResult ? 'see contractResult' : '?')}`,
          `Fee:      ${fmtTrx(BigInt(info.fee ?? 0))}`,
          `Energy:   ${info.receipt?.energy_usage ?? 0}`,
          `Explorer: https://tronscan.org/#/transaction/${(info.id ?? String(a.txid)).replace(/^0x/, '')}`,
        ].join('\n'));
      }

      case 'chaingpt_tron_research_token': {
        const { address, symbol } = await resolveToken('mainnet', String(a.token ?? ''));
        const pairs = await httpJson<any[]>(`https://api.dexscreener.com/token-pairs/v1/tron/${address}`);
        if (!Array.isArray(pairs) || pairs.length === 0) return text(`No DexScreener pairs found for ${symbol} (${address}) on Tron.`);
        const top = pairs.sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0)).slice(0, 3);
        const lines = [`DexScreener — ${symbol} (${address})`, ''];
        for (const p of top) {
          lines.push(`${p.baseToken?.symbol}/${p.quoteToken?.symbol} on ${p.dexId}: $${p.priceUsd ?? '?'} · liq $${Math.round(p.liquidity?.usd ?? 0).toLocaleString()} · 24h vol $${Math.round(p.volume?.h24 ?? 0).toLocaleString()}`);
        }
        return text(lines.join('\n'));
      }

      case 'chaingpt_tron_risk_token': {
        const { address, symbol } = await resolveToken('mainnet', String(a.token ?? ''));
        const r = await httpJson<{ code: number; message: string; result: Record<string, any> }>(
          `https://api.gopluslabs.io/api/v1/token_security/tron?contract_addresses=${address}`,
        );
        const sec = r.result?.[address] ?? r.result?.[address.toLowerCase()] ?? Object.values(r.result ?? {})[0];
        if (!sec) return text(`GoPlus returned no security data for ${symbol} (${address}). (code ${r.code}: ${r.message})`);
        const flag = (v: any) => (v === '1' ? '⚠️ YES' : v === '0' ? 'no' : String(v ?? '?'));
        return text([
          `GoPlus security — ${symbol} (${address})`,
          '',
          `Honeypot:        ${flag(sec.is_honeypot)}`,
          `Mintable:        ${flag(sec.is_mintable)}`,
          `Open source:     ${sec.is_open_source === '1' ? 'yes' : 'no'}`,
          `Owner can change balance: ${flag(sec.owner_change_balance)}`,
          `Buy tax:         ${sec.buy_tax ?? '?'}`,
          `Sell tax:        ${sec.sell_tax ?? '?'}`,
          `Holders:         ${sec.holder_count ?? '?'}`,
        ].join('\n'));
      }

      case 'chaingpt_tron_build_transfer_tx': {
        const from = requireAddress(a.from, 'from');
        const to = requireAddress(a.to, 'to');
        const network = net(a);
        const gate = mainnetGate(network, a);
        if (gate) return text(gate);
        const amountSun = parseUnits(String(a.amountTrx ?? ''), TRX_DECIMALS);
        const tx = await buildTrxTransfer(network, { ownerBase58: from, toBase58: to, amountSun });
        return unsignedTxBlock(`✓ Unsigned TRX transfer (${network})`, tx, [
          `From:          ${from}`,
          `To:            ${to}`,
          `Amount:        ${fmtTrx(amountSun)}`,
        ]);
      }

      case 'chaingpt_tron_build_trc20_transfer_tx': {
        const from = requireAddress(a.from, 'from');
        const to = requireAddress(a.to, 'to');
        const network = net(a);
        const gate = mainnetGate(network, a);
        if (gate) return text(gate);
        const { address, symbol, decimals } = await resolveToken(network, String(a.token ?? ''));
        const amount = parseUnits(String(a.amount ?? ''), decimals);
        const feeLimitSun = a.feeLimitTrx !== undefined ? parseUnits(String(a.feeLimitTrx), TRX_DECIMALS) : DEFAULT_FEE_LIMIT_SUN;
        const tx = await buildTrc20Transfer(network, { ownerBase58: from, tokenBase58: address, toBase58: to, amount, feeLimitSun });
        return unsignedTxBlock(`✓ Unsigned ${symbol} (TRC-20) transfer (${network})`, tx, [
          `From:          ${from}`,
          `To:            ${to}`,
          `Token:         ${symbol} ${address}`,
          `Amount:        ${formatUnits(amount, decimals)} ${symbol}`,
          `fee_limit:     ${fmtTrx(feeLimitSun)}`,
        ]);
      }

      case 'chaingpt_tron_dex_sunswap_quote': {
        const network = net(a);
        const tin = swapLeg(String(a.tokenIn ?? ''));
        const tout = swapLeg(String(a.tokenOut ?? ''));
        const inDec = tin.isNative ? TRX_DECIMALS : (await resolveToken(network, tin.address)).decimals;
        const outDec = tout.isNative ? TRX_DECIMALS : (await resolveToken(network, tout.address)).decimals;
        const amountIn = parseUnits(String(a.amountIn ?? ''), inDec);
        const path = tin.address === tout.address ? [tin.address] : [tin.address, tout.address];
        if (path.length < 2) return text('tokenIn and tokenOut resolve to the same contract.');
        const amounts = await sunswapAmountsOut(network, amountIn, path);
        const out = amounts[amounts.length - 1];
        return text([
          `SunSwap quote (V2, ${network})`,
          '',
          `In:  ${formatUnits(amountIn, inDec)} ${tin.symbol}`,
          `Out: ~${formatUnits(out, outDec)} ${tout.symbol}`,
          `Path: ${tin.symbol} → ${tout.symbol}${tin.isNative || tout.isNative ? ' (via WTRX)' : ''}`,
          '',
          'Quote only. SunSwap V2 liquidity is being wound down in favour of V3 — treat this as indicative and set a slippage-protected minAmountOut when executing.',
        ].join('\n'));
      }

      case 'chaingpt_tron_lend_justlend_account': {
        const addr = requireAddress(a.address);
        const network = net(a);
        const liq = await justlendAccountLiquidity(network, addr);
        const lines = [`JustLend account ${addr} (${network})`, ''];
        if (liq.error !== 0n) lines.push(`⚠️ comptroller error code ${liq.error}`);
        lines.push(`Liquidity:  $${formatUnits(liq.liquidity, 18)}`);
        lines.push(`Shortfall:  $${formatUnits(liq.shortfall, 18)}${liq.shortfall > 0n ? '  ⚠️ LIQUIDATABLE' : ''}`);
        lines.push('');
        for (const m of ['TRX', 'USDT', 'USDD'] as JustlendMarket[]) {
          try {
            const { supplied, borrowed } = await justlendMarketBalances(network, addr, m);
            const dec = m === 'TRX' ? TRX_DECIMALS : TRON_TOKENS[m].decimals;
            lines.push(`${m}: supplied ${formatUnits(supplied, dec)} · borrowed ${formatUnits(borrowed, dec)}`);
          } catch (e: any) {
            lines.push(`${m}: (read failed — ${e?.message ?? e})`);
          }
        }
        return text(lines.join('\n'));
      }

      case 'chaingpt_tron_lend_justlend_build_tx': {
        const from = requireAddress(a.from, 'from');
        const network = net(a);
        const gate = mainnetGate(network, a);
        if (gate) return text(gate);
        const marketSym = String(a.market ?? '').toUpperCase() as JustlendMarket;
        const action = String(a.action ?? '') as JustlendAction;
        const dec = marketSym === 'TRX' ? TRX_DECIMALS : (TRON_TOKENS[marketSym]?.decimals ?? 18);
        const amount = parseUnits(String(a.amount ?? ''), dec);
        const feeLimitSun = a.feeLimitTrx !== undefined ? parseUnits(String(a.feeLimitTrx), TRX_DECIMALS) : DEFAULT_FEE_LIMIT_SUN;
        const tx = await buildJustlendTx(network, { ownerBase58: from, market: marketSym, action, amount, feeLimitSun });
        return unsignedTxBlock(`✓ Unsigned JustLend ${action} ${marketSym} (${network})`, tx, [
          `From:          ${from}`,
          `Market:        ${marketSym}`,
          `Action:        ${action}`,
          `Amount:        ${formatUnits(amount, dec)} ${marketSym}`,
          ...(action === 'supply' || action === 'repay') && marketSym !== 'TRX' ? ['Note:          TRC-20 markets require a prior `approve` of the jToken.'] : [],
        ]);
      }

      default:
        return text(`Unknown tron tool: ${name}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Tron tool error: ${message}`);
  }
}

// exposed for tests
export const _internal = { parseUnits, formatUnits, swapLeg, base58ToHex21, SUN_PER_TRX };
