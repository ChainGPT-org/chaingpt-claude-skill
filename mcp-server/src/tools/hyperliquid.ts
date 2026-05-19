import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpJson } from '../lib/http.js';
import { buildActionPayload } from '../lib/hyperliquid-sign.js';

/**
 * Tier-3b Hyperliquid (HL) mainnet integration. Read tools + signed-order
 * payload builders (custody-free — user signs externally and submits).
 *
 * Hyperliquid is a perps DEX on its own L1 plus an Arbitrum bridge. Their
 * public REST API is https://api.hyperliquid.xyz with all reads going through
 * POST /info with a JSON `type` discriminator. No API key required.
 *
 * Read tools (6):
 *   chaingpt_hl_markets / mids / orderbook / account / fills / funding
 *
 * Signed-action tools (3 — v1.7):
 *   chaingpt_hl_place_order_payload      Build action + EIP-712 typed data
 *   chaingpt_hl_cancel_order_payload     Same, for cancels
 *   chaingpt_hl_submit_signed_action     Broadcast the signed action to /exchange
 *
 * Signing flow:
 *   1. Caller invokes _place_order_payload (or _cancel_order_payload). Server
 *      msgpack-encodes the action, computes keccak256(msgpack || nonce || vault),
 *      and returns the typed-data structure.
 *   2. User's wallet (MetaMask, Rabby, hardware, etc.) signs the EIP-712 typed
 *      data via personal_sign / eth_signTypedData_v4. The plugin never sees
 *      the private key.
 *   3. Caller invokes _submit_signed_action with the original action, nonce,
 *      vaultAddress, and the wallet's signature. Server POSTs to /exchange.
 */

const HL_INFO = 'https://api.hyperliquid.xyz/info';
const HL_EXCHANGE = 'https://api.hyperliquid.xyz/exchange';

async function info<T = any>(body: Record<string, unknown>): Promise<T> {
  return httpJson<T>(HL_INFO, { method: 'POST', body });
}

export const hyperliquidTools: Tool[] = [
  {
    name: 'chaingpt_hl_markets',
    description:
      'List Hyperliquid perpetual + spot markets (assets, max leverage, decimals). Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['perp', 'spot'],
          description: 'Which universe to list. Default: perp.',
          default: 'perp',
        },
        limit: { type: 'number', description: 'Max markets to return. Default 50.', default: 50 },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_hl_mids',
    description:
      'Get live mid prices for all Hyperliquid assets in one call. Useful for quick portfolio mark-to-market. ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of coin symbols to filter to (e.g. ["BTC","ETH","SOL"]).',
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_hl_orderbook',
    description:
      'Get the L2 orderbook for a Hyperliquid asset (best bids + asks, by price level). Read-only. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        coin: { type: 'string', description: 'Asset symbol, e.g. "BTC", "ETH", "SOL".' },
        depth: { type: 'number', description: 'Max levels per side to show. Default 10.', default: 10 },
      },
      required: ['coin'],
    },
  },
  {
    name: 'chaingpt_hl_account',
    description:
      'Get the full Hyperliquid account state for a wallet: USDC balance, margin used, account value, ' +
      'leverage, open positions, and open orders. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user: { type: 'string', description: 'Wallet address (0x…).' },
      },
      required: ['user'],
    },
  },
  {
    name: 'chaingpt_hl_fills',
    description:
      'Recent fill history for a Hyperliquid account. Returns side, coin, price, size, fee, PnL per fill. ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user: { type: 'string', description: 'Wallet address (0x…).' },
        limit: { type: 'number', description: 'Max fills to return (default 20).', default: 20 },
      },
      required: ['user'],
    },
  },
  {
    name: 'chaingpt_hl_funding',
    description:
      'Funding-rate history for a Hyperliquid perp asset. Returns the last 24h of hourly funding rates. ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        coin: { type: 'string', description: 'Asset symbol, e.g. "BTC".' },
        hours: { type: 'number', description: 'How many hours of history (default 24, max 168).', default: 24 },
      },
      required: ['coin'],
    },
  },

  // ─── Signed-action payload builders ─────────────────────────────────
  {
    name: 'chaingpt_hl_place_order_payload',
    description:
      'Build the action + EIP-712 typed-data payload for a Hyperliquid limit order. The plugin does NOT ' +
      'sign — it returns the typed data for the user\'s wallet to sign externally. Then call ' +
      'chaingpt_hl_submit_signed_action with the resulting signature. Requires acknowledgeMainnet=true ' +
      '(orders place real money on Hyperliquid mainnet). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        asset: { type: 'number', description: 'Asset index from chaingpt_hl_markets (e.g. BTC=0, ETH=1).' },
        isBuy: { type: 'boolean', description: 'true=long, false=short.' },
        price: { type: 'string', description: 'Limit price as decimal string, e.g. "95000".' },
        size: { type: 'string', description: 'Position size in base asset, e.g. "0.01".' },
        reduceOnly: { type: 'boolean', description: 'Reduce-only order. Default false.', default: false },
        tif: {
          type: 'string',
          enum: ['Gtc', 'Ioc', 'Alo'],
          description: 'Time-in-force: Gtc=good-till-cancel, Ioc=immediate-or-cancel, Alo=add-liquidity-only.',
          default: 'Gtc',
        },
        vaultAddress: {
          type: 'string',
          description: 'Optional vault / sub-account address. Omit for the signer\'s own account.',
        },
        nonce: {
          type: 'number',
          description: 'Optional nonce (defaults to Date.now() ms).',
        },
        acknowledgeMainnet: {
          type: 'boolean',
          description: 'You must pass true. Hyperliquid mainnet orders are real-money trades.',
        },
      },
      required: ['asset', 'isBuy', 'price', 'size'],
    },
  },
  {
    name: 'chaingpt_hl_cancel_order_payload',
    description:
      'Build the action + EIP-712 typed-data payload for a Hyperliquid order cancel. Cancels do not require ' +
      'acknowledgeMainnet (cancels can only remove orders, not lose money). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        asset: { type: 'number', description: 'Asset index.' },
        orderId: { type: 'number', description: 'The order id (oid) to cancel.' },
        vaultAddress: { type: 'string', description: 'Optional vault address.' },
        nonce: { type: 'number' },
      },
      required: ['asset', 'orderId'],
    },
  },
  {
    name: 'chaingpt_hl_submit_signed_action',
    description:
      'POST a signed Hyperliquid action to /exchange. Takes the action object + nonce returned by a ' +
      '*_payload tool plus the signature the user produced from their wallet. Returns the Hyperliquid response ' +
      '(status + fills / errors). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { description: 'The action object exactly as returned by the *_payload tool.' },
        nonce: { type: 'number', description: 'Same nonce that was used in the payload.' },
        signature: {
          description:
            'The signature from the user\'s wallet. Either an object {r, s, v} or a 0x-prefixed hex string.',
        },
        vaultAddress: { type: 'string', description: 'Same vault address (if any) that was used in the payload.' },
      },
      required: ['action', 'nonce', 'signature'],
    },
  },
];

function formatNum(v: unknown, decimals = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(decimals);
}

export async function handleHyperliquidTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_hl_markets') {
      const universeType = String(args.type ?? 'perp');
      const limit = Math.min(Number(args.limit ?? 50), 200);
      const meta = await info<any>({ type: universeType === 'spot' ? 'spotMeta' : 'meta' });
      const universe = (meta?.universe ?? []) as any[];

      const lines: string[] = [];
      lines.push(`Hyperliquid ${universeType} markets (${universe.length} total, showing ${Math.min(limit, universe.length)}):`);
      lines.push('');
      universe.slice(0, limit).forEach((u: any, i: number) => {
        const max = u.maxLeverage ? `max ${u.maxLeverage}x` : '';
        const sz = u.szDecimals !== undefined ? `szDec=${u.szDecimals}` : '';
        lines.push(`${(i + 1).toString().padStart(3)}. ${u.name ?? u.tokens?.join('/')}  ${max}  ${sz}`);
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_mids') {
      const mids = await info<Record<string, string>>({ type: 'allMids' });
      const filter = Array.isArray(args.filter)
        ? new Set((args.filter as unknown[]).filter((x): x is string => typeof x === 'string').map((s) => s.toUpperCase()))
        : null;
      const entries = Object.entries(mids)
        .filter(([k]) => !filter || filter.has(k.toUpperCase()))
        .sort(([a], [b]) => a.localeCompare(b));
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: 'No matching mids found.' }] };
      }
      const lines = [`Hyperliquid mids (${entries.length} symbols):`, ''];
      for (const [coin, price] of entries) lines.push(`  ${coin.padEnd(12)} ${price}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_orderbook') {
      const coin = String(args.coin || '').toUpperCase();
      if (!coin) return { content: [{ type: 'text', text: 'coin is required.' }] };
      const depth = Math.min(Number(args.depth ?? 10), 50);
      const book = await info<any>({ type: 'l2Book', coin });
      const bids = (book?.levels?.[0] ?? []).slice(0, depth);
      const asks = (book?.levels?.[1] ?? []).slice(0, depth);
      const lines: string[] = [];
      lines.push(`Hyperliquid orderbook — ${coin}`);
      lines.push('');
      lines.push(`  ${'Bid Size'.padStart(12)}   ${'Bid Px'.padStart(10)}  │  ${'Ask Px'.padStart(10)}   ${'Ask Size'.padStart(12)}`);
      lines.push(`  ${'─'.repeat(12)}   ${'─'.repeat(10)}  │  ${'─'.repeat(10)}   ${'─'.repeat(12)}`);
      const rows = Math.max(bids.length, asks.length);
      for (let i = 0; i < rows; i++) {
        const b = bids[i];
        const a = asks[i];
        const bSz = b ? formatNum(b.sz, 4).padStart(12) : ' '.repeat(12);
        const bPx = b ? formatNum(b.px, 2).padStart(10) : ' '.repeat(10);
        const aPx = a ? formatNum(a.px, 2).padStart(10) : ' '.repeat(10);
        const aSz = a ? formatNum(a.sz, 4).padStart(12) : ' '.repeat(12);
        lines.push(`  ${bSz}   ${bPx}  │  ${aPx}   ${aSz}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_account') {
      const user = String(args.user || '').trim();
      if (!user) return { content: [{ type: 'text', text: 'user is required.' }] };
      const state = await info<any>({ type: 'clearinghouseState', user });
      const ms = state?.marginSummary ?? {};
      const positions = (state?.assetPositions ?? []) as any[];
      const lines: string[] = [];
      lines.push(`Hyperliquid account — ${user}`);
      lines.push('');
      lines.push(`Account value:           $${formatNum(ms.accountValue)}`);
      lines.push(`Total margin used:       $${formatNum(ms.totalMarginUsed)}`);
      lines.push(`Total raw USD:           $${formatNum(ms.totalRawUsd)}`);
      lines.push(`Total notional:          $${formatNum(ms.totalNtlPos)}`);
      lines.push(`Withdrawable:            $${formatNum(state?.withdrawable)}`);
      lines.push('');
      if (positions.length === 0) {
        lines.push('No open positions.');
      } else {
        lines.push(`Open positions (${positions.length}):`);
        for (const p of positions) {
          const pos = p.position;
          if (!pos) continue;
          const side = Number(pos.szi) > 0 ? 'LONG ' : 'SHORT';
          const sz = Math.abs(Number(pos.szi));
          const lev = pos.leverage?.value ?? '?';
          lines.push(
            `  ${side} ${pos.coin?.padEnd(8) ?? '?'}  size=${formatNum(sz, 4)}  entry=$${formatNum(pos.entryPx)}  ` +
            `unPnL=$${formatNum(pos.unrealizedPnl)}  lev=${lev}x  liq=$${formatNum(pos.liquidationPx)}`
          );
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_fills') {
      const user = String(args.user || '').trim();
      if (!user) return { content: [{ type: 'text', text: 'user is required.' }] };
      const limit = Math.min(Number(args.limit ?? 20), 100);
      const fills = await info<any[]>({ type: 'userFills', user });
      const slice = (Array.isArray(fills) ? fills : []).slice(0, limit);
      if (slice.length === 0) {
        return { content: [{ type: 'text', text: `No fills found for ${user}.` }] };
      }
      const lines: string[] = [`Hyperliquid fills — ${user} (${slice.length} most recent):`, ''];
      for (const f of slice) {
        const side = f.side === 'B' ? 'BUY ' : f.side === 'A' ? 'SELL' : f.side;
        const ts = f.time ? new Date(Number(f.time)).toISOString().slice(0, 19).replace('T', ' ') : 'n/a';
        lines.push(
          `  ${ts}  ${side} ${(f.coin ?? '?').padEnd(8)} ${formatNum(f.sz, 4).padStart(12)} @ $${formatNum(f.px)}  ` +
          `fee=$${formatNum(f.fee, 4)}  pnl=$${formatNum(f.closedPnl, 2)}`
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_funding') {
      const coin = String(args.coin || '').toUpperCase();
      if (!coin) return { content: [{ type: 'text', text: 'coin is required.' }] };
      const hours = Math.min(Number(args.hours ?? 24), 168);
      const startTime = Date.now() - hours * 3600 * 1000;
      const history = await info<any[]>({ type: 'fundingHistory', coin, startTime });
      const slice = Array.isArray(history) ? history : [];
      if (slice.length === 0) {
        return { content: [{ type: 'text', text: `No funding history for ${coin} in last ${hours}h.` }] };
      }
      const lines: string[] = [`Hyperliquid funding history — ${coin} (last ${hours}h):`, ''];
      for (const h of slice) {
        const ts = new Date(Number(h.time)).toISOString().slice(0, 19).replace('T', ' ');
        const rate = (Number(h.fundingRate) * 100).toFixed(4);
        const premium = h.premium !== undefined ? `premium=${formatNum(h.premium, 4)}` : '';
        lines.push(`  ${ts}  rate=${rate}%  ${premium}`);
      }
      // Compute annualized rate
      const lastRate = Number(slice[slice.length - 1].fundingRate);
      if (Number.isFinite(lastRate)) {
        const annualized = (lastRate * 24 * 365 * 100).toFixed(2);
        lines.push('');
        lines.push(`Latest annualized (1h × 8760): ${annualized}%`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_place_order_payload') {
      if (args.acknowledgeMainnet !== true) {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ Hyperliquid mainnet order refused. Pass acknowledgeMainnet: true to receive the signing ` +
              `payload. Hyperliquid orders place real money on the L1 perps book and execute immediately on ` +
              `submit. Before flipping the flag:\n` +
              `  1. Run chaingpt_hl_account to confirm the wallet has margin available.\n` +
              `  2. Run chaingpt_hl_mids and chaingpt_hl_orderbook to confirm the limit price is sane.\n` +
              `  3. Confirm asset, side, size, and price match what you intend.\n` +
              `Then re-call with acknowledgeMainnet: true.`,
          }],
        };
      }
      const asset = Number(args.asset);
      const isBuy = Boolean(args.isBuy);
      const price = String(args.price);
      const size = String(args.size);
      const reduceOnly = Boolean(args.reduceOnly ?? false);
      const tif = String(args.tif ?? 'Gtc') as 'Gtc' | 'Ioc' | 'Alo';
      const vaultAddress = (args.vaultAddress as string | undefined) ?? null;
      const nonce = Number(args.nonce ?? Date.now());

      // Hyperliquid order action shape
      const action = {
        type: 'order',
        orders: [{ a: asset, b: isBuy, p: price, s: size, r: reduceOnly, t: { limit: { tif } } }],
        grouping: 'na',
      };

      const payload = buildActionPayload(action, { nonce, vaultAddress, isMainnet: true });
      const lines = [
        `Hyperliquid order — sign with your wallet, then call chaingpt_hl_submit_signed_action.`,
        '',
        `Asset:         ${asset}`,
        `Side:          ${isBuy ? 'BUY (long)' : 'SELL (short)'}`,
        `Size:          ${size}`,
        `Limit price:   ${price}`,
        `TIF:           ${tif}${reduceOnly ? '  (reduce-only)' : ''}`,
        `Nonce:         ${payload.nonce}`,
        vaultAddress ? `Vault:         ${vaultAddress}` : '',
        '',
        '--- EIP-712 typed data (sign via eth_signTypedData_v4) ---',
        JSON.stringify(payload.typedData, null, 2),
        '',
        '--- action (pass back to submit_signed_action) ---',
        JSON.stringify(payload.action, null, 2),
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_cancel_order_payload') {
      const asset = Number(args.asset);
      const orderId = Number(args.orderId);
      const vaultAddress = (args.vaultAddress as string | undefined) ?? null;
      const nonce = Number(args.nonce ?? Date.now());
      const action = { type: 'cancel', cancels: [{ a: asset, o: orderId }] };
      const payload = buildActionPayload(action, { nonce, vaultAddress, isMainnet: true });
      const lines = [
        `Hyperliquid cancel — sign with your wallet, then call chaingpt_hl_submit_signed_action.`,
        '',
        `Asset:         ${asset}`,
        `Order id:      ${orderId}`,
        `Nonce:         ${payload.nonce}`,
        vaultAddress ? `Vault:         ${vaultAddress}` : '',
        '',
        '--- EIP-712 typed data ---',
        JSON.stringify(payload.typedData, null, 2),
        '',
        '--- action ---',
        JSON.stringify(payload.action, null, 2),
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_hl_submit_signed_action') {
      const action = args.action as Record<string, unknown>;
      const nonce = Number(args.nonce);
      const sigInput = args.signature as any;
      const vaultAddress = (args.vaultAddress as string | undefined) ?? null;
      if (!action || !sigInput) {
        return { content: [{ type: 'text', text: 'action and signature are required.' }] };
      }
      // Same vault-address validation we apply in payload-building (actionHash).
      // Without it, a malformed vault here would be sent straight to HL /exchange.
      if (vaultAddress) {
        const clean = vaultAddress.startsWith('0x') ? vaultAddress.slice(2) : vaultAddress;
        if (!/^[0-9a-fA-F]{40}$/.test(clean)) {
          return {
            content: [{ type: 'text', text: `Invalid vaultAddress: ${vaultAddress} (must be 0x + 40 hex chars)` }],
          };
        }
      }

      // Normalize signature into the {r, s, v} object Hyperliquid expects.
      let signature: { r: string; s: string; v: number };
      if (typeof sigInput === 'string') {
        const hex = sigInput.startsWith('0x') ? sigInput.slice(2) : sigInput;
        if (hex.length !== 130) {
          return { content: [{ type: 'text', text: `Invalid signature hex length: ${hex.length} (expected 130).` }] };
        }
        signature = {
          r: '0x' + hex.slice(0, 64),
          s: '0x' + hex.slice(64, 128),
          v: parseInt(hex.slice(128, 130), 16),
        };
      } else if (typeof sigInput === 'object' && 'r' in sigInput && 's' in sigInput && 'v' in sigInput) {
        signature = { r: String(sigInput.r), s: String(sigInput.s), v: Number(sigInput.v) };
      } else {
        return { content: [{ type: 'text', text: 'Signature must be 0x-hex (130 chars) or {r,s,v}.' }] };
      }

      const body: Record<string, unknown> = { action, nonce, signature };
      if (vaultAddress) body.vaultAddress = vaultAddress;

      const res = await httpJson<any>(HL_EXCHANGE, { method: 'POST', body });
      return { content: [{ type: 'text', text: 'Hyperliquid /exchange response:\n' + JSON.stringify(res, null, 2) }] };
    }

    return { content: [{ type: 'text', text: `Unknown Hyperliquid tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Hyperliquid error: ${message}`);
  }
}
