import { httpJson } from '../lib/http.js';
import { X402_VERSION, X402_TOKENS, chainIdForNetwork, buildTransferWithAuthorizationTypedData, encodeXPaymentHeader, decodeBase64Header, parseAccepts, formatAtomic, freshNonce, X402_NETWORK_CHAINID, } from '../lib/x402.js';
import { isAddress } from 'viem';
/**
 * Tier-7 x402 — Coinbase's HTTP 402 agentic-payment protocol. Custody-free:
 * the plugin builds the EIP-712 authorization the payer signs and assembles the
 * X-PAYMENT header; it never holds a key. 0 ChainGPT credits.
 */
export const x402Tools = [
    {
        name: 'chaingpt_x402_decode',
        description: 'Decode an x402 challenge or header into human-readable terms. Accepts either a 402 response BODY (JSON with ' +
            'an accepts[] list of PaymentRequirements), or a base64 X-PAYMENT / X-PAYMENT-RESPONSE header value. Tells you ' +
            'what you would pay (amount, token, recipient, network, expiry) before you sign anything. No network calls. 0 credits.',
        inputSchema: {
            type: 'object',
            properties: {
                body: { type: 'object', description: '402 response JSON body (with accepts[]). Provide this OR header.' },
                header: { type: 'string', description: 'Base64 X-PAYMENT or X-PAYMENT-RESPONSE header value to decode.' },
            },
        },
    },
    {
        name: 'chaingpt_x402_build_payment',
        description: 'Build the UNSIGNED EIP-712 authorization for an x402 "exact" payment (EIP-3009 transferWithAuthorization, e.g. ' +
            'USDC on Base). Pass the chosen PaymentRequirements (from a 402 body) plus the payer address; get back the typed ' +
            'data to sign and its digest. If you also pass a signature (produced externally / by the agent wallet), it returns ' +
            'the ready-to-send base64 X-PAYMENT header. Custody-free — the plugin never signs. 0 credits.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Payer EVM address (signs + is debited).' },
                requirements: { type: 'object', description: 'A single PaymentRequirements object (scheme/network/asset/payTo/maxAmountRequired/extra). From a 402 body.' },
                network: { type: 'string', description: 'Override network if not using `requirements` (e.g. "base", "base-sepolia").' },
                symbol: { type: 'string', description: 'Token symbol if not using `requirements` (e.g. "USDC"). Resolves the EIP-712 domain.' },
                payTo: { type: 'string', description: 'Recipient address if not using `requirements`.' },
                amount: { type: 'string', description: 'Human amount (e.g. "0.01") if not using `requirements`. Converted via token decimals.' },
                maxAmountRequired: { type: 'string', description: 'Atomic amount override (takes precedence over `amount`).' },
                validForSeconds: { type: 'number', description: 'Authorization validity window from now (default 600s).' },
                signature: { type: 'string', description: 'Optional 0x signature of the typed data; if present, returns the final X-PAYMENT header.' },
            },
            required: ['from'],
        },
    },
    {
        name: 'chaingpt_x402_facilitator',
        description: 'Call an x402 facilitator endpoint over HTTP: "supported" (list chains/tokens/schemes), "verify" (check a ' +
            'payment payload against requirements), or "settle" (broadcast the authorization). The facilitator only ' +
            'broadcasts the signed authorization — it cannot change amount or destination. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['supported', 'verify', 'settle'], description: 'Which facilitator endpoint to call.' },
                facilitatorUrl: { type: 'string', description: 'Base URL of the facilitator (e.g. https://x402.org/facilitator). Required.' },
                paymentPayload: { type: 'object', description: 'The PaymentPayload (for verify/settle).' },
                paymentRequirements: { type: 'object', description: 'The PaymentRequirements the payload is being checked against (for verify/settle).' },
            },
            required: ['action', 'facilitatorUrl'],
        },
    },
    {
        name: 'chaingpt_x402_fetch',
        description: 'Fetch an x402-protected (HTTP 402) resource, custody-free. 2xx → returns the body. 402 → decodes ' +
            'the PaymentRequirements and (when `from` is given) builds the UNSIGNED EIP-3009 typed data the ' +
            'user signs in their own wallet; then re-call with xPaymentHeader (from chaingpt_x402_build_payment ' +
            'with the signature) to complete the paid request. The full agent-pays loop in one tool. ' +
            '0 ChainGPT credits (the payment itself is whatever the resource charges).',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The x402-protected URL.' },
                method: { type: 'string', enum: ['GET', 'POST'], description: 'Default GET.', default: 'GET' },
                body: { type: 'string', description: 'Request body for POST (sent as application/json).' },
                from: { type: 'string', description: "Payer address (0x…). Enables building the unsigned typed data on a 402." },
                xPaymentHeader: { type: 'string', description: 'Base64 X-PAYMENT header from chaingpt_x402_build_payment (after signing) — completes the paid request.' },
                maxBodyChars: { type: 'number', description: 'Truncate the response body in the output. Default 4000.', default: 4000 },
            },
            required: ['url'],
        },
    },
    {
        name: 'chaingpt_x402_create_requirements',
        description: 'Server-side helper: build a PaymentRequirements object + a complete 402 response body to monetize your own ' +
            'API endpoint with x402. You give price + recipient + network; it returns the JSON to serve with HTTP 402. 0 credits.',
        inputSchema: {
            type: 'object',
            properties: {
                network: { type: 'string', description: 'Network (e.g. "base", "base-sepolia").' },
                symbol: { type: 'string', description: 'Token symbol (e.g. "USDC"). Default USDC.' },
                amount: { type: 'string', description: 'Human price (e.g. "0.01").' },
                payTo: { type: 'string', description: 'Recipient address (your wallet).' },
                resource: { type: 'string', description: 'The URL/path being monetized.' },
                description: { type: 'string', description: 'Human description of what is being paid for.' },
                maxTimeoutSeconds: { type: 'number', description: 'Authorization timeout (default 60).' },
            },
            required: ['network', 'amount', 'payTo'],
        },
    },
];
function resolveToken(network, symbol) {
    const key = `${network}:${symbol.toUpperCase()}`;
    const token = X402_TOKENS[key];
    if (!token) {
        throw new Error(`No known EIP-3009 token for "${key}". Known: ${Object.keys(X402_TOKENS).join(', ')}. ` +
            `Pass full PaymentRequirements (with asset + extra.name/version) to use an arbitrary token.`);
    }
    return token;
}
function describeRequirements(r) {
    const sym = r.extra?.name ? '' : '';
    const known = Object.values(X402_TOKENS).find((t) => t.address.toLowerCase() === r.asset?.toLowerCase());
    const human = known ? `${formatAtomic(r.maxAmountRequired, known.decimals)} (${r.asset})` : `${r.maxAmountRequired} atomic of ${r.asset}`;
    return [
        `  scheme:   ${r.scheme}`,
        `  network:  ${r.network}`,
        `  pay:      ${human}${sym}`,
        `  payTo:    ${r.payTo}`,
        r.resource ? `  resource: ${r.resource}` : '',
        r.description ? `  desc:     ${r.description}` : '',
        r.maxTimeoutSeconds ? `  timeout:  ${r.maxTimeoutSeconds}s` : '',
    ].filter(Boolean).join('\n');
}
async function handleDecode(args) {
    if (args.header) {
        const decoded = decodeBase64Header(String(args.header));
        // Could be a PaymentPayload (X-PAYMENT) or a settlement response (X-PAYMENT-RESPONSE).
        if (decoded?.payload?.authorization) {
            const a = decoded.payload.authorization;
            return [
                `=== Decoded X-PAYMENT header ===`,
                `x402Version: ${decoded.x402Version}`,
                `scheme:      ${decoded.scheme}`,
                `network:     ${decoded.network}`,
                `from:        ${a.from}`,
                `to:          ${a.to}`,
                `value:       ${a.value} (atomic)`,
                `validAfter:  ${a.validAfter}`,
                `validBefore: ${a.validBefore} (${new Date(Number(a.validBefore) * 1000).toISOString()})`,
                `nonce:       ${a.nonce}`,
                `signature:   ${decoded.payload.signature?.slice(0, 18)}…`,
            ].join('\n');
        }
        return `=== Decoded header (JSON) ===\n${JSON.stringify(decoded, null, 2)}`;
    }
    const accepts = parseAccepts(args.body);
    if (accepts.length === 0)
        throw new Error('No PaymentRequirements found. Pass the 402 response `body` (with accepts[]) or a base64 `header`.');
    return [
        `=== x402 challenge — ${accepts.length} payment option(s) ===`,
        ...accepts.map((r, i) => `[${i}]\n${describeRequirements(r)}`),
        ``,
        `Next: chaingpt_x402_build_payment with the chosen requirements + your payer address.`,
    ].join('\n');
}
async function handleX402Fetch(args) {
    const url = String(args.url ?? '');
    if (!/^https:\/\//.test(url))
        throw new Error('url must be https://');
    const method = String(args.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    const maxBodyChars = Math.max(200, Number(args.maxBodyChars ?? 4000));
    const headers = { accept: 'application/json' };
    if (args.body !== undefined)
        headers['content-type'] = 'application/json';
    if (args.xPaymentHeader)
        headers['X-PAYMENT'] = String(args.xPaymentHeader);
    const res = await fetch(url, {
        method,
        headers,
        body: args.body !== undefined ? String(args.body) : undefined,
        signal: AbortSignal.timeout(30_000),
    });
    const bodyText = await res.text();
    if (res.status !== 402) {
        const paid = args.xPaymentHeader ? ' (paid via X-PAYMENT)' : '';
        return [
            `HTTP ${res.status}${paid} — ${url}`,
            '',
            bodyText.slice(0, maxBodyChars) + (bodyText.length > maxBodyChars ? `\n… (${bodyText.length - maxBodyChars} more chars truncated)` : ''),
        ].join('\n');
    }
    // 402 — decode the challenge
    let challenge;
    try {
        challenge = JSON.parse(bodyText);
    }
    catch {
        return `HTTP 402 from ${url}, but the body is not valid x402 JSON:\n${bodyText.slice(0, 800)}`;
    }
    const accepts = Array.isArray(challenge.accepts) ? challenge.accepts : [];
    if (accepts.length === 0) {
        return `HTTP 402 from ${url} with no \`accepts\` entries — the server's x402 challenge is malformed.`;
    }
    // Prefer an exact-scheme entry on a network we know how to price.
    const req = accepts.find((r) => r.scheme === 'exact' && X402_NETWORK_CHAINID[r.network] !== undefined) ?? accepts[0];
    const lines = [];
    lines.push(`HTTP 402 Payment Required — ${url}`);
    lines.push('');
    lines.push(`Scheme:    ${req.scheme}    Network: ${req.network}`);
    lines.push(`Price:     ${req.maxAmountRequired} atomic units of ${req.asset}`);
    lines.push(`Pay to:    ${req.payTo}`);
    lines.push(`Valid for: ${req.maxTimeoutSeconds ?? 600}s`);
    lines.push('');
    if (!args.from) {
        lines.push('Pass `from` (the payer wallet address) to get the UNSIGNED EIP-3009 typed data to sign.');
        lines.push('Flow: this tool (with from) → sign typed data in your wallet → chaingpt_x402_build_payment');
        lines.push('(same requirements + signature) → re-call this tool with xPaymentHeader=<the header>.');
        lines.push('');
        lines.push('--- Raw PaymentRequirements ---');
        lines.push(JSON.stringify(req, null, 2));
        return lines.join('\n');
    }
    // Build the unsigned payment for this exact challenge (custody-free — user signs).
    const built = await handleBuildPayment({ from: String(args.from), requirements: req });
    lines.push(built);
    lines.push('');
    lines.push(`After signing: chaingpt_x402_build_payment from=${args.from} requirements=<above> signature=<sig>`);
    lines.push(`→ then re-call chaingpt_x402_fetch url=${url} xPaymentHeader=<X-PAYMENT value> to complete the paid request.`);
    return lines.join('\n');
}
async function handleBuildPayment(args) {
    const from = String(args.from);
    if (!isAddress(from))
        throw new Error(`from is not a valid EVM address: ${from}`);
    const req = args.requirements;
    const network = String(req?.network ?? args.network ?? 'base');
    const chainId = chainIdForNetwork(network);
    // Resolve token: prefer the requirements' asset+extra; else the symbol map.
    let token;
    if (req?.asset && req.extra?.name && req.extra?.version) {
        const known = Object.values(X402_TOKENS).find((t) => t.address.toLowerCase() === req.asset.toLowerCase());
        token = { address: req.asset, name: req.extra.name, version: req.extra.version, decimals: known?.decimals ?? 6 };
    }
    else {
        token = resolveToken(network, String(args.symbol ?? 'USDC'));
    }
    const payTo = String(req?.payTo ?? args.payTo ?? '');
    if (!isAddress(payTo))
        throw new Error(`payTo (recipient) is not a valid EVM address: ${payTo}`);
    let atomic;
    if (req?.maxAmountRequired)
        atomic = req.maxAmountRequired;
    else if (args.maxAmountRequired)
        atomic = String(args.maxAmountRequired);
    else if (args.amount != null) {
        const [w, f = ''] = String(args.amount).split('.');
        if (f.length > token.decimals)
            throw new Error(`amount has more decimals than the token (${token.decimals}).`);
        atomic = (BigInt(w) * 10n ** BigInt(token.decimals) + BigInt((f.padEnd(token.decimals, '0')) || '0')).toString();
    }
    else {
        throw new Error('Provide an amount (via requirements.maxAmountRequired, maxAmountRequired, or amount).');
    }
    const now = Math.floor(Date.now() / 1000);
    const validBefore = now + Number(args.validForSeconds ?? req?.maxTimeoutSeconds ?? 600);
    const nonce = freshNonce();
    const { typedData, digest, authorization } = buildTransferWithAuthorizationTypedData({
        token, chainId, from, to: payTo, value: atomic, validAfter: 0, validBefore, nonce,
    });
    // Serialize typed data with bigints as strings for display.
    const typedDataJson = JSON.stringify(typedData, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    if (args.signature) {
        const payload = {
            x402Version: X402_VERSION,
            scheme: 'exact',
            network,
            payload: { signature: String(args.signature), authorization },
        };
        const header = encodeXPaymentHeader(payload);
        return [
            `=== x402 X-PAYMENT header (signed) ===`,
            `network: ${network}  token: ${token.name} (${token.address})`,
            `amount:  ${formatAtomic(atomic, token.decimals)}  to: ${payTo}`,
            ``,
            `Set this request header and retry the original request:`,
            `X-PAYMENT: ${header}`,
        ].join('\n');
    }
    return [
        `=== x402 payment — UNSIGNED EIP-712 (sign this) ===`,
        `network:  ${network} (chainId ${chainId})`,
        `token:    ${token.name} v${token.version} @ ${token.address}`,
        `pay:      ${formatAtomic(atomic, token.decimals)}  →  ${payTo}`,
        `from:     ${from}`,
        `expires:  ${new Date(validBefore * 1000).toISOString()}`,
        ``,
        `EIP-712 digest (what the signature commits to): ${digest}`,
        ``,
        `--- Typed data to sign (eth_signTypedData_v4) ---`,
        typedDataJson,
        ``,
        `Custody-free: sign this with the payer wallet (or the agent wallet), then re-call`,
        `chaingpt_x402_build_payment with the same args + signature=0x… to get the X-PAYMENT header.`,
    ].join('\n');
}
async function handleFacilitator(args) {
    const base = String(args.facilitatorUrl).replace(/\/+$/, '');
    const action = String(args.action);
    if (action === 'supported') {
        const res = await httpJson(`${base}/supported`, { method: 'GET' });
        return `=== facilitator /supported ===\n${JSON.stringify(res, null, 2)}`;
    }
    if (action === 'verify' || action === 'settle') {
        if (!args.paymentPayload || !args.paymentRequirements) {
            throw new Error(`${action} requires both paymentPayload and paymentRequirements.`);
        }
        const res = await httpJson(`${base}/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ paymentPayload: args.paymentPayload, paymentRequirements: args.paymentRequirements }),
        });
        return `=== facilitator /${action} ===\n${JSON.stringify(res, null, 2)}`;
    }
    throw new Error(`Unknown facilitator action "${action}". Use supported | verify | settle.`);
}
async function handleCreateRequirements(args) {
    const network = String(args.network);
    const chainId = chainIdForNetwork(network);
    const token = resolveToken(network, String(args.symbol ?? 'USDC'));
    const payTo = String(args.payTo);
    if (!isAddress(payTo))
        throw new Error(`payTo is not a valid EVM address: ${payTo}`);
    const [w, f = ''] = String(args.amount).split('.');
    if (f.length > token.decimals)
        throw new Error(`amount has more decimals than the token (${token.decimals}).`);
    const atomic = (BigInt(w) * 10n ** BigInt(token.decimals) + BigInt(f.padEnd(token.decimals, '0') || '0')).toString();
    const requirements = {
        scheme: 'exact',
        network,
        maxAmountRequired: atomic,
        resource: args.resource ? String(args.resource) : undefined,
        description: args.description ? String(args.description) : undefined,
        mimeType: 'application/json',
        payTo,
        maxTimeoutSeconds: Number(args.maxTimeoutSeconds ?? 60),
        asset: token.address,
        extra: { name: token.name, version: token.version },
    };
    const body = { x402Version: X402_VERSION, accepts: [requirements], error: 'X-PAYMENT header is required' };
    return [
        `=== x402 PaymentRequirements (serve with HTTP 402) — chainId ${chainId} ===`,
        `Price: ${args.amount} ${String(args.symbol ?? 'USDC').toUpperCase()} → ${payTo}`,
        ``,
        `--- 402 response body ---`,
        JSON.stringify(body, null, 2),
    ].join('\n');
}
export async function handleX402Tool(name, args) {
    let text;
    const a = args ?? {};
    try {
        if (name === 'chaingpt_x402_decode')
            text = await handleDecode(a);
        else if (name === 'chaingpt_x402_build_payment')
            text = await handleBuildPayment(a);
        else if (name === 'chaingpt_x402_facilitator')
            text = await handleFacilitator(a);
        else if (name === 'chaingpt_x402_fetch')
            text = await handleX402Fetch(a);
        else if (name === 'chaingpt_x402_create_requirements')
            text = await handleCreateRequirements(a);
        else
            throw new Error(`Unknown x402 tool: ${name}`);
    }
    catch (e) {
        text = `Error in ${name}: ${e?.message ?? e}`;
    }
    return { content: [{ type: 'text', text }] };
}
