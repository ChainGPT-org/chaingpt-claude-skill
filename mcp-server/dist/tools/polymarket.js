import { httpJson } from '../lib/http.js';
import { recoverTypedDataAddress } from 'viem';
import { buildOrder, clobHeaders, depositWalletTypedData, orderTypedData, readCLOBCreds, wrapDepositWalletSignature, POLYMARKET_NEG_RISK_EXCHANGE, } from '../lib/polymarket-sign.js';
/**
 * Tier-3c Polymarket mainnet integration. READ-ONLY in v1.6.
 *
 * Polymarket runs a CLOB on Polygon mainnet. Public reads use two surfaces:
 *   - Gamma API     : https://gamma-api.polymarket.com  (markets list, events, search)
 *   - CLOB API      : https://clob.polymarket.com       (orderbook, last-trade, midpoint)
 *
 * Order placement: chaingpt_pm_place_order_payload returns EIP-712 typed data in the
 * current CLOB order format (see lib/polymarket-sign.ts); the user's wallet signs it and
 * chaingpt_pm_submit_signed_order posts it.
 *
 * Ties into ChainGPT's existing PredictFi / Foresight AI surface — Polymarket
 * is the canonical onchain prediction market.
 */
const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
export const polymarketTools = [
    {
        name: 'chaingpt_pm_markets',
        description: 'List Polymarket prediction markets, sorted by 24h volume. Filter by search query, category, or ' +
            'closing window. Read-only. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
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
        description: 'Get details on one Polymarket market by slug or condition id: question, end date, current odds, ' +
            'YES/NO token addresses (which are the CLOB token IDs), 24h volume, liquidity. Read-only. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                slug: { type: 'string', description: 'Market slug from the URL, e.g. "will-bitcoin-hit-200k-by-2026".' },
                conditionId: { type: 'string', description: 'On-chain condition id (0x…). Alternative to slug.' },
            },
            required: [],
        },
    },
    {
        name: 'chaingpt_pm_orderbook',
        description: 'Get the L2 orderbook for one Polymarket outcome token. The tokenId is the per-outcome asset id ' +
            '(get it from chaingpt_pm_market). Also shows the book version, neg_risk, tick size and minimum order ' +
            'size that chaingpt_pm_place_order_payload needs. Read-only. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                tokenId: { type: 'string', description: 'CLOB token id (decimal string, the YES or NO leg).' },
                depth: { type: 'number', description: 'Max levels per side. Default 10.', default: 10 },
            },
            required: ['tokenId'],
        },
    },
    {
        name: 'chaingpt_pm_trades',
        description: 'Get recent fills on a Polymarket outcome token. Useful for confirming a market is liquid and seeing ' +
            'where size is going. Read-only. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
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
        description: 'Build a Polymarket CLOB order + EIP-712 typed-data payload for the user\'s wallet to sign. The plugin ' +
            'NEVER signs — it returns the typed data and the order JSON. The signing domain, tick size and minimum ' +
            'size come from the token\'s live order book. After signing, call ' +
            'chaingpt_pm_submit_signed_order to broadcast (requires POLY_CLOB_API_KEY env). Requires ' +
            'acknowledgeMainnet=true. Polymarket settles on Polygon mainnet (chainId 137). 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                maker: { type: 'string', description: 'Wallet placing the order (0x… on Polygon). For proxy/Safe wallets, the proxy (funder) address; for deposit wallets, the deposit wallet.' },
                signer: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'EOA that signs, when it differs from maker (proxy/Safe wallets, and the owner EOA of a deposit wallet). Default: maker.' },
                signatureType: { type: 'integer', enum: [0, 1, 2, 3], description: '0 = EOA (default), 1 = Polymarket proxy (email/Magic), 2 = Gnosis Safe proxy, 3 = deposit wallet (needs signer = its owner EOA).' },
                tokenId: { type: 'string', description: 'Outcome asset id from chaingpt_pm_market (the position id on a v2 market).' },
                side: { type: 'string', enum: ['BUY', 'SELL'], description: 'BUY = buying outcome tokens, SELL = selling them.' },
                price: { type: 'string', description: 'Decimal probability 0..1 on the book\'s tick_size, e.g. "0.42" for 42%.' },
                size: { type: 'string', description: 'Number of outcome tokens (shares), e.g. "100". Rounded down to 2 decimals; must meet the book\'s min_order_size.' },
                expirationSec: {
                    type: 'number',
                    description: 'Unix seconds when a GTD order expires (submit with orderType GTD; at least 3 minutes ahead). 0 = never. Default 0.',
                    default: 0,
                },
                acknowledgeMainnet: { type: 'boolean', description: 'You must pass true. Polymarket orders are real-money trades.' },
            },
            required: ['maker', 'tokenId', 'side', 'price', 'size'],
        },
    },
    {
        name: 'chaingpt_pm_submit_signed_order',
        description: 'POST a signed Polymarket order to the CLOB. Requires POLY_CLOB_API_KEY, POLY_CLOB_SECRET, and ' +
            'POLY_CLOB_PASSPHRASE env vars (derive via py-clob-client or the official TypeScript SDK first). ' +
            'Returns the CLOB response (order hash + status). 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                order: { description: 'The order object exactly as returned by chaingpt_pm_place_order_payload.' },
                signature: { type: 'string', description: '0x-prefixed signature from the user\'s wallet (eth_signTypedData_v4 over the typed data).' },
                owner: { type: 'string', description: 'CLOB API key of the order owner. Defaults to POLY_CLOB_API_KEY (Polymarket expects the API key here, not an address).' },
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
function formatNum(v, decimals = 2) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return 'n/a';
    return n.toFixed(decimals);
}
function formatPct(v, decimals = 1) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return 'n/a';
    return `${(n * 100).toFixed(decimals)}%`;
}
function clobSalt(salt) {
    const n = Number(salt);
    if (!/^\d+$/.test(String(salt)) || !Number.isSafeInteger(n)) {
        throw new Error('Order salt must be an integer below 2^53 so the CLOB API receives exactly the signed value. Rebuild the order with chaingpt_pm_place_order_payload.');
    }
    return n;
}
export async function handlePolymarketTool(name, args) {
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
            if (args.search)
                params.set('search', String(args.search));
            const url = `${GAMMA}/markets?${params}`;
            const markets = await httpJson(url);
            const list = Array.isArray(markets) ? markets : [];
            if (list.length === 0) {
                return { content: [{ type: 'text', text: 'No matching Polymarket markets found.' }] };
            }
            const lines = [`Polymarket markets (${list.length}, sorted by ${order}):`, ''];
            list.forEach((m, i) => {
                const vol = m.volume24hr ?? m.volume;
                const liq = m.liquidity;
                const endDate = m.endDate ? String(m.endDate).slice(0, 10) : 'n/a';
                const yesPrice = m.outcomePrices ? (Array.isArray(m.outcomePrices) ? m.outcomePrices[0] : JSON.parse(m.outcomePrices)[0]) : undefined;
                const yesPct = yesPrice !== undefined ? formatPct(yesPrice) : 'n/a';
                lines.push(`${(i + 1).toString().padStart(3)}. ${m.question}`);
                lines.push(`     YES@ ${yesPct}  |  vol24h=$${formatNum(vol)}  liq=$${formatNum(liq)}  ends ${endDate}`);
                if (m.slug)
                    lines.push(`     slug: ${m.slug}`);
            });
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (name === 'chaingpt_pm_market') {
            const slug = args.slug?.trim();
            const conditionId = args.conditionId?.trim();
            if (!slug && !conditionId) {
                return { content: [{ type: 'text', text: 'Either slug or conditionId is required.' }] };
            }
            const params = new URLSearchParams({ limit: '1' });
            if (slug)
                params.set('slug', slug);
            if (conditionId)
                params.set('condition_id', conditionId);
            const markets = await httpJson(`${GAMMA}/markets?${params}`);
            const m = (Array.isArray(markets) ? markets : [])[0];
            if (!m) {
                return { content: [{ type: 'text', text: 'Market not found.' }] };
            }
            // v2 markets trade by position id; CTF markets by CLOB token id.
            const rawIds = m.version === 'v2' ? m.positionIds : m.clobTokenIds;
            const tokenIds = rawIds ? (typeof rawIds === 'string' ? JSON.parse(rawIds) : rawIds) : [];
            const outcomes = m.outcomes ? (typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes) : ['YES', 'NO'];
            const prices = m.outcomePrices ? (typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices) : [];
            const lines = [];
            lines.push(`Polymarket: ${m.question}`);
            lines.push('');
            lines.push(`Slug:            ${m.slug}`);
            lines.push(`Condition id:    ${m.conditionId ?? m.condition_id ?? '(n/a)'}`);
            lines.push(`Status:          ${m.closed ? 'closed' : m.active ? 'active' : 'pending'}${m.endDate ? ` (ends ${String(m.endDate).slice(0, 10)})` : ''}`);
            lines.push(`Volume 24h:      $${formatNum(m.volume24hr)}`);
            lines.push(`Total volume:    $${formatNum(m.volume)}`);
            lines.push(`Liquidity:       $${formatNum(m.liquidity)}`);
            lines.push(`Market version:  ${m.version === 'v2' ? 'v2 (place orders with bookVersion "v2")' : 'ctf'}`);
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
            if (!tokenId)
                return { content: [{ type: 'text', text: 'tokenId is required.' }] };
            const depth = Math.min(Number(args.depth ?? 10), 50);
            const book = await httpJson(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`);
            const bids = (book?.bids ?? []).slice(0, depth);
            const asks = (book?.asks ?? []).slice(0, depth);
            const lines = [];
            lines.push(`Polymarket orderbook — tokenId ${tokenId}`);
            // Order signing needs these: the book version and neg_risk pick the signing domain.
            lines.push(`Book version: ${book?.version === 'v2' ? 'v2' : 'ctf'}  neg_risk: ${book?.neg_risk === true}  ` +
                `tick_size: ${book?.tick_size ?? 'n/a'}  min_order_size: ${book?.min_order_size ?? 'n/a'}`);
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
            if (!tokenId)
                return { content: [{ type: 'text', text: 'tokenId is required.' }] };
            const limit = Math.min(Number(args.limit ?? 20), 100);
            const trades = await httpJson(`${CLOB}/trades?token_id=${encodeURIComponent(tokenId)}&limit=${limit}`);
            const list = Array.isArray(trades) ? trades : trades?.data ?? [];
            if (!list || list.length === 0) {
                return { content: [{ type: 'text', text: `No recent trades for tokenId ${tokenId}.` }] };
            }
            const lines = [`Polymarket recent trades — tokenId ${tokenId} (${list.length}):`, ''];
            for (const t of list.slice(0, limit)) {
                const ts = t.timestamp || t.match_time;
                const tsStr = ts ? new Date(Number(ts) * (String(ts).length <= 11 ? 1000 : 1)).toISOString().slice(0, 19).replace('T', ' ') : '?';
                const side = (t.side || t.taker_side || '').toUpperCase().padEnd(4);
                lines.push(`  ${tsStr}  ${side} ${formatNum(t.size, 2).padStart(10)} @ ${formatNum(t.price, 4).padStart(8)}`);
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (name === 'chaingpt_pm_place_order_payload') {
            if (args.acknowledgeMainnet !== true) {
                return {
                    content: [{
                            type: 'text',
                            text: `⚠ Polymarket mainnet order refused. Pass acknowledgeMainnet: true to receive the signing ` +
                                `payload. Polymarket orders settle on Polygon mainnet — USDC.e is real money.\n` +
                                `Before flipping the flag:\n` +
                                `  1. Run chaingpt_pm_market and chaingpt_pm_orderbook to confirm the market + price.\n` +
                                `  2. Confirm the tokenId matches the YES (or NO) leg you intend.\n` +
                                `  3. Confirm the maker address is the wallet you control.\n` +
                                `Then re-call with acknowledgeMainnet: true.`,
                        }],
                };
            }
            const maker = String(args.maker);
            const tokenId = String(args.tokenId);
            const side = String(args.side);
            const price = String(args.price);
            const size = String(args.size);
            const expirationSec = Number(args.expirationSec ?? 0);
            const signer = args.signer ? String(args.signer) : undefined;
            const signatureType = args.signatureType;
            if (signer && signer.toLowerCase() !== maker.toLowerCase() && !signatureType) {
                return { content: [{ type: 'text', text: 'A signer different from maker means a proxy or Safe wallet: pass signatureType 1 (Polymarket proxy) or 2 (Gnosis Safe).' }] };
            }
            if (signatureType === 3 && (!signer || signer.toLowerCase() === maker.toLowerCase())) {
                return { content: [{ type: 'text', text: 'Deposit-wallet orders (signatureType 3) need maker = the deposit wallet and signer = the EOA that owns it.' }] };
            }
            // The book decides the signing domain and the price/size grid: a wrong guess means a signature the CLOB rejects.
            const book = await httpJson(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`);
            if (!book?.tick_size) {
                return { content: [{ type: 'text', text: `No Polymarket order book for token ${tokenId}. Check the token id with chaingpt_pm_market.` }] };
            }
            const bookVersion = book.version === 'v2' ? 'v2' : 'ctf';
            const negRisk = book.neg_risk === true;
            const order = buildOrder({
                maker, tokenId, side, price, size, expirationSec, signer, signatureType,
                tickSize: String(book.tick_size), minOrderSize: book.min_order_size === undefined ? undefined : String(book.min_order_size),
            });
            const typed = orderTypedData(order, { negRisk, bookVersion });
            if (signatureType === 3) {
                order.depositWallet = { owner: signer, exchange: typed.domain.verifyingContract, domainVersion: typed.domain.version };
            }
            const [usdc, shares] = (order.side === 0 ? [order.makerAmount, order.takerAmount] : [order.takerAmount, order.makerAmount]).map((v) => Number(v) / 1e6);
            const lines = [
                `Polymarket order — sign with your wallet, then call chaingpt_pm_submit_signed_order.`,
                '',
                `Side:           ${side}`,
                `Token id:       ${tokenId}`,
                `Price:          ${price} (${(Number(price) * 100).toFixed(2)}% implied)`,
                `Size:           ${shares} shares`,
                `USDC:           $${usdc}`,
                `Expiration:     ${expirationSec === 0 ? 'never' : `${new Date(expirationSec * 1000).toISOString()} (submit with orderType GTD)`}`,
                `Exchange:       ${bookVersion === 'v2' ? 'v2' : negRisk ? 'CTF Neg-Risk' : 'CTF'} (${typed.domain.verifyingContract}, domain version ${typed.domain.version})`,
                ...(signatureType === 3 ? [`Deposit wallet: ${maker}, signed by its owner ${signer}`] : []),
                '',
                '--- EIP-712 typed data (sign via eth_signTypedData_v4) ---',
                JSON.stringify(signatureType === 3 ? depositWalletTypedData(typed) : typed, null, 2),
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
                            text: `Polymarket CLOB credentials are required to submit orders. Set:\n` +
                                `  POLY_CLOB_API_KEY=<api_key>\n` +
                                `  POLY_CLOB_SECRET=<base64_secret>\n` +
                                `  POLY_CLOB_PASSPHRASE=<passphrase>\n\n` +
                                `Derive these once via the official Polymarket clob-client (TS) or py-clob-client. ` +
                                `See https://docs.polymarket.com/quickstart/orderbook-api/auth/`,
                        }],
                };
            }
            const order = args.order;
            // Legacy orders (taker/nonce/feeRateBps, no timestamp) were signed against retired exchanges.
            if (!order || typeof order !== 'object' || order.timestamp === undefined || order.metadata === undefined || order.builder === undefined) {
                return { content: [{ type: 'text', text: 'This order is not in the current Polymarket order format (no timestamp/metadata/builder). Rebuild it with chaingpt_pm_place_order_payload and sign the new typed data.' }] };
            }
            let signature = String(args.signature);
            let polyAddress = order.signer ?? order.maker;
            if (order.signatureType === 3) {
                // Deposit wallet: check the owner signed this exact order, then wrap the signature for ERC-1271.
                const dw = order.depositWallet;
                if (!dw) {
                    return { content: [{ type: 'text', text: 'Deposit-wallet order without its depositWallet details. Pass the order exactly as chaingpt_pm_place_order_payload returned it.' }] };
                }
                const td = orderTypedData(order, {
                    negRisk: dw.exchange.toLowerCase() === POLYMARKET_NEG_RISK_EXCHANGE.toLowerCase(),
                    bookVersion: dw.domainVersion === '3' ? 'v2' : 'ctf',
                });
                if (td.domain.verifyingContract.toLowerCase() !== dw.exchange.toLowerCase()) {
                    return { content: [{ type: 'text', text: `Unknown Polymarket exchange ${dw.exchange} (domain version ${dw.domainVersion}). Rebuild the order with chaingpt_pm_place_order_payload.` }] };
                }
                const wrapped = wrapDepositWalletSignature(signature, td);
                const recovered = await recoverTypedDataAddress({ ...depositWalletTypedData(td), signature });
                if (recovered.toLowerCase() !== dw.owner.toLowerCase()) {
                    return { content: [{ type: 'text', text: `The signature is from ${recovered}, not the deposit wallet's owner ${dw.owner}. Sign the typed data from chaingpt_pm_place_order_payload with the owner EOA.` }] };
                }
                signature = wrapped;
                polyAddress = dw.owner;
            }
            // Per the CLOB API: body.owner is the owner's API key; the POLY_ADDRESS header is the EOA behind that
            // key (the signer for EOA/proxy/Safe orders, the owner EOA for deposit wallets).
            // An address here (the old documented value) is ignored: the API wants the key.
            const owner = typeof args.owner === 'string' && !/^0x[0-9a-fA-F]{40}$/.test(args.owner) ? args.owner : creds.apiKey;
            const orderType = String(args.orderType ?? 'GTC');
            // Field set and order mirror the official client's orderToJsonV2. Wire format: salt as a JSON
            // number (the signed uint256 value, kept exact), side as "BUY"/"SELL", unsigned expiration alongside.
            const body = JSON.stringify({
                deferExec: false,
                postOnly: false,
                order: {
                    salt: clobSalt(order.salt),
                    maker: order.maker,
                    signer: order.signer,
                    tokenId: order.tokenId,
                    makerAmount: order.makerAmount,
                    takerAmount: order.takerAmount,
                    side: order.side === 0 ? 'BUY' : 'SELL',
                    signatureType: order.signatureType,
                    timestamp: order.timestamp,
                    expiration: order.expiration ?? '0',
                    metadata: order.metadata,
                    builder: order.builder,
                    signature,
                },
                owner,
                orderType,
            });
            const headers = clobHeaders(creds, 'POST', '/order', body, polyAddress);
            // 15s timeout — without it, a hung CLOB endpoint pins the tool indefinitely.
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 15_000);
            let res;
            try {
                res = await fetch('https://clob.polymarket.com/order', {
                    method: 'POST',
                    headers,
                    body,
                    signal: ac.signal,
                });
            }
            catch (e) {
                clearTimeout(t);
                return {
                    content: [{
                            type: 'text',
                            text: `Polymarket CLOB request failed: ${e?.name === 'AbortError' ? 'timed out after 15s' : (e?.message ?? e)}`,
                        }],
                };
            }
            finally {
                clearTimeout(t);
            }
            const text = await res.text();
            return {
                content: [{
                        type: 'text',
                        text: `Polymarket CLOB /order response (HTTP ${res.status}):\n${text}`,
                    }],
            };
        }
        return { content: [{ type: 'text', text: `Unknown Polymarket tool: ${name}` }] };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChainGPT Polymarket error: ${message}`);
    }
}
