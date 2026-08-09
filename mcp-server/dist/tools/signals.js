import { httpJson } from '../lib/http.js';
/**
 * AI Signals feed — read-only wrapper over the public ChainGPT gateway
 * endpoint behind https://app.chaingpt.org/ai-crypto-alerts.
 *
 * Same auth model as the other ChainGPT-product tools: CHAINGPT_API_KEY as a
 * bearer token. The missing-key UX is handled centrally in index.ts via
 * KEY_REQUIRED_PREFIXES ('chaingpt_signals'), exactly like news/chat/intel.
 */
const CHAINGPT_API_BASE = 'https://api.chaingpt.org';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
export const signalsTools = [
    {
        name: 'chaingpt_signals_feed',
        description: 'Fetch recent ChainGPT AI crypto-alert signals (the feed behind https://app.chaingpt.org/ai-crypto-alerts): ' +
            'anomaly-driven pump/dump/neutral alerts with sentiment and narration per token. ' +
            'Optionally filter by CoinMarketCap ID, sentiment, and a unix-seconds time window. Returns the raw JSON. ' +
            'Costs 1 credit per 10 signals returned, rounded up (ceil(results/10)).',
        inputSchema: {
            type: 'object',
            properties: {
                cmcId: {
                    type: 'number',
                    description: 'CoinMarketCap coin ID to filter by (e.g. 1=BTC, 1027=ETH).',
                },
                sentiment: {
                    type: 'string',
                    enum: ['bullish', 'bearish', 'neutral'],
                    description: 'Only return signals with this sentiment.',
                },
                limit: {
                    type: 'number',
                    description: 'Number of signals to return (default 10, max 50). Cost: 1 credit per 10 returned, rounded up.',
                    default: DEFAULT_LIMIT,
                },
                from: {
                    type: 'number',
                    description: 'Only signals created at or after this unix timestamp (seconds).',
                },
                to: {
                    type: 'number',
                    description: 'Only signals created at or before this unix timestamp (seconds).',
                },
            },
            required: [],
        },
    },
];
export async function handleSignalsTool(name, args) {
    if (!args)
        args = {};
    try {
        if (name === 'chaingpt_signals_feed') {
            const rawLimit = Number(args.limit ?? DEFAULT_LIMIT);
            const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT, 1), MAX_LIMIT);
            const body = { limit };
            if (args.cmcId !== undefined)
                body.cmcId = Number(args.cmcId);
            if (args.sentiment !== undefined)
                body.sentiment = String(args.sentiment);
            if (args.from !== undefined)
                body.from = Number(args.from);
            if (args.to !== undefined)
                body.to = Number(args.to);
            const res = await httpJson(`${CHAINGPT_API_BASE}/ai-signal/details`, {
                method: 'POST',
                body,
                headers: { Authorization: `Bearer ${process.env.CHAINGPT_API_KEY}` },
            });
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        }
        return { content: [{ type: 'text', text: `Unknown signals tool: ${name}` }] };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChainGPT Signals error: ${message}`);
    }
}
