/**
 * Minimal HTTP helper used by Tier-1 read-only tools. Wraps Node 18+ global
 * `fetch` to give a consistent timeout, user-agent, and error surface.
 *
 * Kept dependency-free on purpose — Tier-1 tools must not balloon the MCP
 * server's install size.
 */
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'chaingpt-mcp/1.2 (+https://github.com/ChainGPT-org/chaingpt-claude-skill)';
/** Keep authentication material out of diagnostics, including reflected/truncated bodies. */
function requestDiagnostics(url, headers) {
    const credentialName = /^(?:api[-_]?key|key|access[-_]?token|token|secret|password|authorization|signature)$/i;
    let authenticated = Object.keys(headers ?? {}).some(name => credentialName.test(name.replace(/^x-/i, '')));
    try {
        const safe = new URL(url);
        if (safe.username || safe.password) {
            authenticated = true;
            safe.username = '[redacted]';
            safe.password = '[redacted]';
        }
        for (const name of new Set(safe.searchParams.keys())) {
            if (credentialName.test(name)) {
                authenticated = true;
                safe.searchParams.set(name, '[redacted]');
            }
        }
        return { url: safe.toString(), authenticated };
    }
    catch {
        return { url: '[invalid URL]', authenticated: true };
    }
}
export async function httpJson(url, opts = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const diagnostics = requestDiagnostics(url, opts.headers);
    let failureStatus;
    try {
        const hasBody = opts.body !== undefined;
        const res = await fetch(url, {
            method: opts.method ?? 'GET',
            headers: {
                accept: 'application/json',
                'user-agent': USER_AGENT,
                ...(hasBody ? { 'content-type': 'application/json' } : {}),
                ...(opts.headers ?? {}),
            },
            body: hasBody ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal,
        });
        if (!res.ok) {
            failureStatus = res.status;
            if (diagnostics.authenticated)
                throw new Error('Authenticated HTTP failure');
            const text = await safeText(res);
            throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}${text ? ` — ${text.slice(0, 200)}` : ''}`);
        }
        return (await res.json());
    }
    catch (error) {
        if (!diagnostics.authenticated)
            throw error;
        // Do not retain the original error/cause: fetch, parsers and servers can echo credentials.
        const prefix = failureStatus === undefined ? 'Authenticated request failed' : `HTTP ${failureStatus}`;
        throw new Error(`${prefix} for ${diagnostics.url} (authenticated response details omitted)`);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function safeText(res) {
    try {
        return await res.text();
    }
    catch {
        return '';
    }
}
/** Minimal JSON-RPC client for public EVM RPC endpoints. */
export async function jsonRpc(rpcUrl, method, params = [], timeoutMs) {
    const res = await httpJson(rpcUrl, {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method, params },
        timeoutMs,
    });
    if (res.error)
        throw new Error(`RPC ${method} failed: ${res.error.message} (code ${res.error.code})`);
    return res.result;
}
/**
 * Try a JSON-RPC call against an ordered list of endpoints. Returns the first
 * non-erroring result. If all endpoints fail, throws the last error.
 * Used when public RPCs are flaky / rate-limited.
 */
export async function jsonRpcFallback(rpcUrls, method, params = [], timeoutMs = 8_000) {
    if (rpcUrls.length === 0)
        throw new Error('No RPC endpoints provided');
    let lastErr;
    for (const url of rpcUrls) {
        try {
            return await jsonRpc(url, method, params, timeoutMs);
        }
        catch (e) {
            lastErr = e;
            continue;
        }
    }
    throw lastErr instanceof Error
        ? new Error(`All RPC endpoints failed for ${method}; last error: ${lastErr.message}`)
        : new Error(`All RPC endpoints failed for ${method}`);
}
/** Convert a hex-prefixed value to a JS number. Throws on overflow. */
export function hexToNumber(hex) {
    const n = Number(BigInt(hex));
    if (!Number.isSafeInteger(n))
        throw new Error(`hex value ${hex} exceeds safe-integer range`);
    return n;
}
/** Convert a hex-prefixed wei value to a decimal string of gwei (no precision loss). */
export function hexWeiToGwei(hex) {
    const wei = BigInt(hex);
    const gwei = wei / 1000000000n;
    const remainder = wei % 1000000000n;
    if (remainder === 0n)
        return gwei.toString();
    // Truncate (not round) to 3 decimal places of gwei to avoid carry into the integer part
    // for remainders near 1e9. We do this via integer math, then zero-pad.
    const millis = (remainder * 1000n) / 1000000000n; // 0..999
    const padded = millis.toString().padStart(3, '0');
    return `${gwei}.${padded}`;
}
