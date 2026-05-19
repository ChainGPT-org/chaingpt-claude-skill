/**
 * Minimal HTTP helper used by Tier-1 read-only tools. Wraps Node 18+ global
 * `fetch` to give a consistent timeout, user-agent, and error surface.
 *
 * Kept dependency-free on purpose — Tier-1 tools must not balloon the MCP
 * server's install size.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'chaingpt-mcp/1.2 (+https://github.com/ChainGPT-org/chaingpt-claude-skill)';

export interface HttpOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function httpJson<T = unknown>(url: string, opts: HttpOpts = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}${text ? ` — ${text.slice(0, 200)}` : ''}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Minimal JSON-RPC client for public EVM RPC endpoints. */
export async function jsonRpc<T = unknown>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
  timeoutMs?: number
): Promise<T> {
  const res = await httpJson<{ result?: T; error?: { code: number; message: string } }>(rpcUrl, {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method, params },
    timeoutMs,
  });
  if (res.error) throw new Error(`RPC ${method} failed: ${res.error.message} (code ${res.error.code})`);
  return res.result as T;
}

/** Convert a hex-prefixed value to a JS number. Throws on overflow. */
export function hexToNumber(hex: string): number {
  const n = Number(BigInt(hex));
  if (!Number.isSafeInteger(n)) throw new Error(`hex value ${hex} exceeds safe-integer range`);
  return n;
}

/** Convert a hex-prefixed wei value to a decimal string of gwei (no precision loss). */
export function hexWeiToGwei(hex: string): string {
  const wei = BigInt(hex);
  const gwei = wei / 1_000_000_000n;
  const remainder = wei % 1_000_000_000n;
  if (remainder === 0n) return gwei.toString();
  // Show up to 3 decimal places of gwei
  const decimals = (Number(remainder) / 1e9).toFixed(3).replace(/^0\./, '.');
  return `${gwei}${decimals}`;
}
