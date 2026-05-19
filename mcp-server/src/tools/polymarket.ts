import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpJson } from '../lib/http.js';
import {
  buildOrder,
  clobHeaders,
  orderTypedData,
  readCLOBCreds,
  type PolymarketOrder,
} from '../lib/polymarket-sign.js';

/**
 * Tier-3c Polymarket mainnet integration. READ-ONLY in v1.6.
 *
 * Polymarket runs a CLOB on Polygon mainnet. Public reads use two surfaces:
 *   - Gamma API     : https://gamma-api.polymarket.com  (markets list, events, search)
 *   - CLOB API      : https://clob.polymarket.com       (orderbook, last-trade, midpoint)
 *
 * Order placement requires an EIP-712-signed CLOB order (0x v4 limit-order shape
 * with Polymarket-specific extensions). Deferred to a follow-up so the signing
 * scheme can get its own review pass.
 *
 * Ties into ChainGPT's existing PredictFi / Foresight AI surface — Polymarket
 * is the canonical onchain prediction market.
 */

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

export const polymarketTools: Tool[] = [
  {
    name: 'chaingpt_pm_markets',
    description:
      'List Polymarket prediction markets, sorted by 24h volume. Filter by search query, category, or ' +
      'closing window. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Full-text search over market questions.' },
        active: {
          type: 'boolean',
          description: 'Only return currently-active (not yet resolved) markets. Default true.',
          default: true,
        },
        closed: {
          type: 'boolean',
          description: 'Include resolved markets. Default false.',
          default: false,
        },
        limit: { type: 'number', description: 'Max markets to return (default 20, max 100).', default: 20 },
        order: {
          type: 'string',
          enum: ['volume24hr', 'liquidity', 'createdAt', 'endDate'],
          description: 'Sort order. Default volume24hr.',
          default: 'volume24hr',
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_pm_market',
    description:
      'Get details on one Polymarket market by slug or condition id: question, end date, current odds, ' +
      'YES/NO token addresses (which are the CLOB token IDs), 24h volume, liquidity. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Market slug from the URL, e.g. "will-bitcoin-hit-200k-by-2026".' },
        conditionId: { type: 'string', description: 'On-chain condition id (0x…). Alternative to slug.' },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_pm_orderbook',
    description:
      'Get the L2 orderbook for one Polymarket outcome token. The tokenId is the per-outcome ERC-1155 id ' +
      '(get it from chaingpt_pm_market). Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: { type: 'string', description: 'CLOB token id (decimal string, the YES or NO leg).' },
        depth: { type: 'number', description: 'Max levels per side. Default 10.', default: 10 },
      },
      required: ['tokenId'],
    },
  },
  {
    name: 'chaingpt_pm_trades',
    description:
      'Get recent fills on a Polymarket outcome token. Useful for confirming a market is liquid and seeing ' +
      'where size is going. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tokenId: { type: 'string', description: 'CLOB token id.' },
        limit: { type: 'number', description: 'Max trades (default 20).', default: 20 },
      },
      required: ['tokenId'],
    },
  },

  // ─── Signed-order payload builders ─────────────────────────────────
  {
    name: 'chaingpt_pm_place_order_payload',
    description:
      'Build a Polymarket CLOB order + EIP-712 typed-data payload for the user\'s wallet to sign. The plugin ' +
      'NEVER signs — it returns the typed data and the order JSON. After signing, call ' +
      'chaingpt_pm_submit_signed_order to broadcast (requires POLY_CLOB_API_KEY env). Requires ' +
      'acknowledgeMainnet=true. Polymarket settles on Polygon mainnet (chainId 137). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        maker: { type: 'string', description: 'Wallet placing the order (0x… on Polygon).' },
        tokenId: { type: 'string', description: 'CLOB token id from chaingpt_pm_market.' },
        side: { type: 'string', enum: ['BUY', 'SELL'], description: 'BUY = buying outcome tokens, SELL = selling them.' },
        price: { type: 'string', description: 'Decimal probability 0..1, e.g. "0.42" for 42%.' },
        size: { type: 'string', description: 'Number of outcome tokens (shares), e.g. "100".' },
        expirationSec: {
          type: 'number',
          description: 'Unix seconds when the order expires. 0 = never. Default 0.',
          default: 0,
        },
        feeRateBps: { type: 'number', default: 0 },
        negRisk: {
          type: 'boolean',
          description:
            'true if this market is on the Neg-Risk exchange (multi-outcome / scalar). Default false. ' +
            'Determines which verifyingContract is used in the EIP-712 domain.',
          default: false,
        },
        acknowledgeMainnet: { type: 'boolean', description: 'You must pass true. Polymarket orders are real-money trades.' },
      },
      required: ['maker', 'tokenId', 'side', 'price', 'size'],
    },
  },
  {
    name: 'chaingpt_pm_submit_signed_order',
    description:
      'POST a signed Polymarket order to the CLOB. Requires POLY_CLOB_API_KEY, POLY_CLOB_SECRET, and ' +
      'POLY_CLOB_PASSPHRASE env vars (derive via py-clob-client or the official TypeScript SDK first). ' +
      'Returns the CLOB response (order hash + status). 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        order: { description: 'The order object exactly as returned by chaingpt_pm_place_order_payload.' },
        signature: { type: 'string', description: '0x-prefixed signature from the user\'s wallet (eth_signTypedData_v4 over the typed data).' },
        owner: { type: 'string', description: 'Owner address (usually = maker).' },
        orderType: {
          type: 'string',
          enum: ['GTC', 'FOK', 'GTD'],
          description: 'Time-in-force: GTC=good-till-cancel, FOK=fill-or-kill, GTD=good-till-date. Default GTC.',
          default: 'GTC',
        },
      },
      required: ['order', 'signature'],
    },
  },
];

function formatNum(v: unknown, decimals = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(decimals);
}

function formatPct(v: unknown, decimals = 1): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(decimals)}%`;
}

export async function handlePolymarketTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_pm_markets') {
      const limit = Math.min(Number(args.limit ?? 20), 100);
      const order = String(args.order ?? 'volume24hr');
      const params = new URLSearchParams({
        limit: String(limit),
        order,
        ascending: 'false',
        active: String(args.active ?? true),
        closed: String(args.closed ?? false),
      });
      if (args.search) params.set('search', String(args.search));
      const url = `${GAMMA}/markets?${params}`;
      const markets = await httpJson<any[]>(url);
      const list = Array.isArray(markets) ? markets : [];
      if (list.length === 0) {
        return { content: [{ type: 'text', text: 'No matching Polymarket markets found.' }] };
      }
      const lines: string[] = [`Polymarket markets (${list.length}, sorted by ${order}):`, ''];
      list.forEach((m: any, i: number) => {
        const vol = m.volume24hr ?? m.volume;
        const liq = m.liquidity;
        const endDate = m.endDate ? String(m.endDate).slice(0, 10) : 'n/a';
        const yesPrice = m.outcomePrices ? (Array.isArray(m.outcomePrices) ? m.outcomePrices[0] : JSON.parse(m.outcomePrices)[0]) : undefined;
        const yesPct = yesPrice !== undefined ? formatPct(yesPrice) : 'n/a';
        lines.push(
          `${(i + 1).toString().padStart(3)}. ${m.question}`
        );
        lines.push(`     YES@ ${yesPct}  |  vol24h=$${formatNum(vol)}  liq=$${formatNum(liq)}  ends ${endDate}`);
        if (m.slug) lines.push(`     slug: ${m.slug}`);
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_pm_market') {
      const slug = (args.slug as string | undefined)?.trim();
      const conditionId = (args.conditionId as string | undefined)?.trim();
      if (!slug && !conditionId) {
        return { content: [{ type: 'text', text: 'Either slug or conditionId is required.' }] };
      }
      const params = new URLSearchParams({ limit: '1' });
      if (slug) params.set('slug', slug);
      if (conditionId) params.set('condition_id', conditionId);
      const markets = await httpJson<any[]>(`${GAMMA}/markets?${params}`);
      const m = (Array.isArray(markets) ? markets : [])[0];
      if (!m) {
        return { content: [{ type: 'text', text: 'Market not found.' }] };
      }

      const tokenIds = m.clobTokenIds ? (typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds) : [];
      const outcomes = m.outcomes ? (typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes) : ['YES', 'NO'];
      const prices = m.outcomePrices ? (typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices) : [];

      const lines: string[] = [];
      lines.push(`Polymarket: ${m.question}`);
      lines.push('');
      lines.push(`Slug:            ${m.slug}`);
      lines.push(`Condition id:    ${m.conditionId ?? m.condition_id ?? '(n/a)'}`);
      lines.push(`Status:          ${m.closed ? 'closed' : m.active ? 'active' : 'pending'}${m.endDate ? ` (ends ${String(m.endDate).slice(0, 10)})` : ''}`);
      lines.push(`Volume 24h:      $${formatNum(m.volume24hr)}`);
      lines.push(`Total volume:    $${formatNum(m.volume)}`);
      lines.push(`Liquidity:       $${formatNum(m.liquidity)}`);
      lines.push('');
      lines.push('Outcomes:');
      for (let i = 0; i < outcomes.length; i++) {
        const px = prices[i] !== undefined ? formatPct(prices[i]) : 'n/a';
        const tid = tokenIds[i] ?? '(no token id)';
        lines.push(`  ${outcomes[i].padEnd(8)} ${px}   tokenId=${tid}`);
      }
      lines.push('');
      lines.push('Use chaingpt_pm_orderbook with one of the tokenIds above to see live bids/asks.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_pm_orderbook') {
      const tokenId = String(args.tokenId || '').trim();
      if (!tokenId) return { content: [{ type: 'text', text: 'tokenId is required.' }] };
      const depth = Math.min(Number(args.depth ?? 10), 50);
      const book = await httpJson<any>(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`);
      const bids = (book?.bids ?? []).slice(0, depth);
      const asks = (book?.asks ?? []).slice(0, depth);
      const lines: string[] = [];
      lines.push(`Polymarket orderbook — tokenId ${tokenId}`);
      lines.push('');
      lines.push(`  ${'Bid Size'.padStart(12)}   ${'Bid Px'.padStart(8)}  │  ${'Ask Px'.padStart(8)}   ${'Ask Size'.padStart(12)}`);
      lines.push(`  ${'─'.repeat(12)}   ${'─'.repeat(8)}  │  ${'─'.repeat(8)}   ${'─'.repeat(12)}`);
      const rows = Math.max(bids.length, asks.length);
      for (let i = 0; i < rows; i++) {
        const b = bids[i];
        const a = asks[i];
        const bSz = b ? formatNum(b.size, 2).padStart(12) : ' '.repeat(12);
        const bPx = b ? formatNum(b.price, 4).padStart(8) : ' '.repeat(8);
        const aPx = a ? formatNum(a.price, 4).padStart(8) : ' '.repeat(8);
        const aSz = a ? formatNum(a.size, 2).padStart(12) : ' '.repeat(12);
        lines.push(`  ${bSz}   ${bPx}  │  ${aPx}   ${aSz}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_pm_trades') {
      const tokenId = String(args.tokenId || '').trim();
      if (!tokenId) return { content: [{ type: 'text', text: 'tokenId is required.' }] };
      const limit = Math.min(Number(args.limit ?? 20), 100);
      const trades = await httpJson<any[]>(
        `${CLOB}/trades?token_id=${encodeURIComponent(tokenId)}&limit=${limit}`
      );
      const list = Array.isArray(trades) ? trades : (trades as any)?.data ?? [];
      if (!list || list.length === 0) {
        return { content: [{ type: 'text', text: `No recent trades for tokenId ${tokenId}.` }] };
      }
      const lines: string[] = [`Polymarket recent trades — tokenId ${tokenId} (${list.length}):`, ''];
      for (const t of list.slice(0, limit)) {
        const ts = t.timestamp || t.match_time;
        const tsStr = ts ? new Date(Number(ts) * (String(ts).length <= 11 ? 1000 : 1)).toISOString().slice(0, 19).replace('T', ' ') : '?';
        const side = (t.side || t.taker_side || '').toUpperCase().padEnd(4);
        lines.push(
          `  ${tsStr}  ${side} ${formatNum(t.size, 2).padStart(10)} @ ${formatNum(t.price, 4).padStart(8)}`
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_pm_place_order_payload') {
      if (!args.acknowledgeMainnet) {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ Polymarket mainnet order refused. Pass acknowledgeMainnet: true to receive the signing ` +
              `payload. Polymarket orders settle on Polygon mainnet — USDC.e is real money.\n` +
              `Before flipping the flag:\n` +
              `  1. Run chaingpt_pm_market and chaingpt_pm_orderbook to confirm the market + price.\n` +
              `  2. Confirm the tokenId matches the YES (or NO) leg you intend.\n` +
              `  3. Confirm the maker address is the wallet you control.\n` +
              `Then re-call with acknowledgeMainnet: true.`,
          }],
        };
      }
      const maker = String(args.maker) as `0x${string}`;
      const tokenId = String(args.tokenId);
      const side = String(args.side) as 'BUY' | 'SELL';
      const price = String(args.price);
      const size = String(args.size);
      const expirationSec = Number(args.expirationSec ?? 0);
      const feeRateBps = Number(args.feeRateBps ?? 0);
      const negRisk = Boolean(args.negRisk ?? false);

      const order = buildOrder({ maker, tokenId, side, price, size, expirationSec, feeRateBps });
      const typed = orderTypedData(order, negRisk);

      const usdcCost = (Number(price) * Number(size)).toFixed(4);
      const lines = [
        `Polymarket order — sign with your wallet, then call chaingpt_pm_submit_signed_order.`,
        '',
        `Side:           ${side}`,
        `Token id:       ${tokenId}`,
        `Price:          ${price} (${(Number(price) * 100).toFixed(2)}% implied)`,
        `Size:           ${size} shares`,
        `USDC.e cost:    ~$${usdcCost}`,
        `Expiration:     ${expirationSec === 0 ? 'never' : new Date(expirationSec * 1000).toISOString()}`,
        `Exchange:       ${negRisk ? 'Neg-Risk' : 'CTF'} (${typed.domain.verifyingContract})`,
        '',
        '--- EIP-712 typed data (sign via eth_signTypedData_v4) ---',
        JSON.stringify(typed, null, 2),
        '',
        '--- order (pass back to submit_signed_order) ---',
        JSON.stringify(order, null, 2),
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_pm_submit_signed_order') {
      const creds = readCLOBCreds();
      if (!creds) {
        return {
          content: [{
            type: 'text',
            text:
              `Polymarket CLOB credentials are required to submit orders. Set:\n` +
              `  POLY_CLOB_API_KEY=<api_key>\n` +
              `  POLY_CLOB_SECRET=<base64_secret>\n` +
              `  POLY_CLOB_PASSPHRASE=<passphrase>\n\n` +
              `Derive these once via the official Polymarket clob-client (TS) or py-clob-client. ` +
              `See https://docs.polymarket.com/quickstart/orderbook-api/auth/`,
          }],
        };
      }
      const order = args.order as PolymarketOrder;
      const signature = String(args.signature);
      const owner = (args.owner as string | undefined) ?? order.maker;
      const orderType = String(args.orderType ?? 'GTC');

      const body = JSON.stringify({
        order: { ...order, signature },
        owner,
        orderType,
      });
      const headers = clobHeaders(creds, 'POST', '/order', body, owner);
      const res = await fetch('https://clob.polymarket.com/order', {
        method: 'POST',
        headers,
        body,
      });
      const text = await res.text();
      return {
        content: [{
          type: 'text',
          text: `Polymarket CLOB /order response (HTTP ${res.status}):\n${text}`,
        }],
      };
    }

    return { content: [{ type: 'text', text: `Unknown Polymarket tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Polymarket error: ${message}`);
  }
}
