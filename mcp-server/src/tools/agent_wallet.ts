import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createWalletClient, createPublicClient, http as viemHttp, type Hex } from 'viem';
import QRCode from 'qrcode';
import { CHAINS } from '../lib/chains.js';
import { jsonRpcFallback } from '../lib/http.js';
import {
  initKeystore,
  isKeystoreInitialized,
  loadAccount,
  readKeystoreFile,
  keystorePath,
  passphraseSource,
  describeSecretSource,
} from '../lib/agent-keystore.js';
import {
  loadPolicy,
  checkPolicy,
  policyPath,
  policyDigest,
  validatePolicyInput,
  savePolicy,
  type TxIntent,
  type AgentPolicy,
} from '../lib/agent-policy.js';
import { POLICY_TEMPLATES, findTemplate } from '../lib/agent-policy-templates.js';
import { loadTrackedTokens, addTrackedToken, removeTrackedToken, tokensPath, type TrackedToken } from '../lib/agent-tokens.js';
import { fetchErc20Balance, fetchErc20Meta, formatTokenAmount } from '../lib/agent-erc20.js';
import { logActivity, readActivity, activityPath, spendStats } from '../lib/agent-activity.js';

// Same dir-derived admin token path, available everywhere it's needed.
// Derived from the policy DIRECTORY, not via filename regex (which would
// silently collide with the policy file when admin uses a non-policy.json name).
function adminTokenPath(): string {
  return process.env.CHAINGPT_ADMIN_TOKEN_FILE?.trim()
    || join(dirname(policyPath()), '.admin-token');
}
import {
  loadCustomChains,
  addCustomChain,
  removeCustomChain,
  customChainsPath,
  resolveChainWithCustom,
  rpcEndpointsWithCustom,
  mergedChains,
} from '../lib/agent-custom-chains.js';
import { BLUE_CHIPS, getBlueChipsForChain } from '../lib/agent-blue-chips.js';

/**
 * Tier-5 agent-wallet tools — the agent has its own EOA, and the admin sets
 * policies that the agent cannot bypass.
 *
 * Security architecture:
 *
 *   1. Keystore (~/.chaingpt-mcp/agent-wallet/keystore.json) is encrypted with
 *      a passphrase from CHAINGPT_AGENT_WALLET_PASSPHRASE env. The passphrase
 *      is admin-controlled and never echoed in any tool output.
 *
 *   2. Policy file (~/.chaingpt-mcp/agent-wallet/policy.json) is loaded fresh
 *      on every signing operation. The agent has NO tool to write it; admin
 *      edits with their text editor.
 *
 *   3. Default policy: killSwitch=true → refuses every signing operation
 *      until the admin explicitly relaxes the rules.
 *
 *   4. Every chaingpt_agent_wallet_sign_and_send call:
 *        a. Loads the policy file (fresh).
 *        b. Runs checkPolicy() — pure code, deterministic, ignores LLM context.
 *        c. Refuses if any rule fails. The agent CAN be prompt-injected into
 *           trying to drain funds, but the tool layer refuses.
 */

const SUPPORTED_CHAINS = Object.keys(CHAINS).filter((s) => CHAINS[s].chainId !== null);

export const agentWalletTools: Tool[] = [
  {
    name: 'chaingpt_agent_wallet_init',
    description:
      'Initialize the agent\'s wallet — generates a fresh EOA, encrypts the private key with the passphrase ' +
      'in CHAINGPT_AGENT_WALLET_PASSPHRASE, writes the encrypted keystore to disk (0600 perms). One-shot: ' +
      'refuses if a keystore already exists. Returns the public address. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'chaingpt_agent_wallet_address',
    description:
      'Return the agent\'s public EOA address (for receiving funds). Does NOT need the passphrase — reads ' +
      'only the public field of the keystore file. Returns a warning if not initialized. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'chaingpt_agent_wallet_status',
    description:
      'Show the agent wallet\'s full status: address, keystore path, current policy summary + digest, policy ' +
      'file path. Use this as the first step before any signing — confirms what guardrails are active. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'chaingpt_agent_wallet_balances',
    description:
      'Get the agent\'s native-coin balance across one or more EVM chains. Uses public-RPC fallbacks per chain. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chains: {
          type: 'array',
          items: { type: 'string', enum: SUPPORTED_CHAINS },
          description: 'List of chain slugs. Default: ["ethereum", "base", "arbitrum"].',
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_agent_wallet_policy',
    description:
      'Display the current policy file content + digest. Read-only — this tool does NOT modify the policy. ' +
      'The admin edits ~/.chaingpt-mcp/agent-wallet/policy.json directly with a text editor. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'chaingpt_agent_wallet_sign_and_send',
    description:
      'Sign and broadcast an EVM transaction from the agent\'s wallet. Every call: loads the policy file ' +
      'fresh, runs checkPolicy(), and refuses if any rule fails (kill switch, chain whitelist, address ' +
      'whitelist, value cap, function-selector blocklist, memo requirement). This is the only tool that ' +
      'can move the agent\'s funds. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: { type: 'string', enum: SUPPORTED_CHAINS, description: 'EVM chain slug.' },
        to: { type: 'string', description: 'Destination address (0x…).' },
        valueWei: { type: 'string', description: 'Native-coin value in wei (string to preserve precision). Default "0".', default: '0' },
        data: { type: 'string', description: 'Hex calldata (0x… or empty for plain transfer). Default "0x".', default: '0x' },
        gasLimit: { type: 'string', description: 'Gas limit (units). REQUIRED when the policy sets maxTxGas (the gate refuses auto-estimation so the cap cannot be bypassed); otherwise optional, defaulting to eth_estimateGas + 20% headroom.' },
        memo: { type: 'string', description: 'Audit-trail memo. Required if policy.requireMemo=true.' },
      },
      required: ['chain', 'to'],
    },
  },
  {
    name: 'chaingpt_agent_wallet_serve_ui',
    description:
      'Start a local HTML dashboard on a localhost port. Read-only view: address, multi-chain balances, ' +
      'current policy + digest, policy file path. Admin opens the URL in a browser to monitor the agent ' +
      'without going through the LLM. Returns the URL. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        port: { type: 'number', description: 'Port to bind. Default 8787.', default: 8787 },
        chains: {
          type: 'array',
          items: { type: 'string', enum: SUPPORTED_CHAINS },
          description: 'Chains to show balances for. Default ["ethereum","base","arbitrum"].',
        },
      },
      required: [],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────
function fmtEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 6);
  return `${whole}.${fracStr}`;
}

async function getNativeBalance(chainSlug: string, address: string): Promise<bigint> {
  const endpoints = rpcEndpointsWithCustom(chainSlug);
  if (endpoints.length === 0) throw new Error(`No RPC endpoints for ${chainSlug}`);
  const hex = await jsonRpcFallback<string>(endpoints, 'eth_getBalance', [address, 'latest']);
  return BigInt(hex);
}

// Upper bound for a single balance fetch during dashboard render. Kept short so
// the page stays responsive even when a public RPC is slow/rate-limiting; a
// timed-out cell just shows "RPC error" and the user can hit Refresh.
const BALANCE_RENDER_TIMEOUT_MS = 3500;

// Resolve/reject `p`, but reject after `ms` if it hasn't settled. The original
// promise is left to settle in the background (its rejection is swallowed so it
// can't surface as an unhandledRejection); we just stop awaiting it.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  p.catch(() => {});
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`balance fetch timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// Short-lived balance cache. The dashboard re-renders on every POST (policy
// save, kill-switch flip, …) and auto-reloads every 30s, so without a cache a
// degraded RPC is hit on each interaction. Successful balances are cached
// briefly; failures are cached for a shorter window so a recovered RPC shows
// fresh data soon. This keeps the page responsive and cuts redundant RPC load.
type BalanceCacheEntry = { ok: boolean; value?: bigint; expiry: number };
const balanceCache = new Map<string, BalanceCacheEntry>();
const BAL_TTL_OK_MS = 30_000;
const BAL_TTL_ERR_MS = 15_000;

async function cachedBalance(key: string, fetchFn: () => Promise<bigint>): Promise<bigint> {
  const now = Date.now();
  const hit = balanceCache.get(key);
  if (hit && hit.expiry > now) {
    if (hit.ok) return hit.value as bigint;
    throw new Error('cached RPC error');
  }
  try {
    const v = await withTimeout(fetchFn(), BALANCE_RENDER_TIMEOUT_MS);
    balanceCache.set(key, { ok: true, value: v, expiry: now + BAL_TTL_OK_MS });
    return v;
  } catch (e) {
    balanceCache.set(key, { ok: false, expiry: now + BAL_TTL_ERR_MS });
    throw e;
  }
}

let runningServer: Server | null = null;
let runningPort: number | null = null;

// Admin-auth state for the localhost dashboard. Token is regenerated on each
// serve_ui call. Sessions are in-memory only (no persistence across restarts).
let adminToken: string | null = null;
const sessions = new Map<string, number>(); // sessionId -> expiry ms
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

function generateToken(): string {
  return randomBytes(24).toString('hex'); // 48-char hex, 192 bits
}

function timingSafeStrEqual(a: string, b: string): boolean {
  // Double-HMAC pattern: hash both inputs to a fixed length first so the
  // comparison leaks neither content nor LENGTH (a bare length pre-check is
  // a small timing oracle on how long the expected token is).
  const key = randomBytes(32);
  const ha = createHmac('sha256', key).update(a).digest();
  const hb = createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(ha, hb);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function checkSession(req: IncomingMessage): boolean {
  const sid = parseCookies(req.headers.cookie).cg_admin_sid;
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(sid);
    return false;
  }
  // Slide the expiry on each authed request
  sessions.set(sid, Date.now() + SESSION_TTL_MS);
  return true;
}

function createSession(): string {
  const sid = generateToken();
  sessions.set(sid, Date.now() + SESSION_TTL_MS);
  return sid;
}

function checkHost(req: IncomingMessage, port: number): boolean {
  // DNS-rebinding defense: a hostile page can rebind its domain to 127.0.0.1
  // and the victim browser will then reach this server with Host: attacker.tld.
  // Origin checks cover state-changing POSTs; this covers everything else.
  const host = req.headers.host ?? '';
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function checkOrigin(req: IncomingMessage, port: number): boolean {
  // Block cross-origin POSTs (CSRF defense). Browsers always set Origin on
  // form/fetch POSTs. We require it to be a localhost URL on our port.
  const origin = req.headers.origin;
  if (!origin) {
    // Same-origin form submits sometimes omit Origin; allow if Referer matches
    const referer = req.headers.referer;
    if (!referer) return false;
    return referer.startsWith(`http://127.0.0.1:${port}/`) || referer.startsWith(`http://localhost:${port}/`);
  }
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

async function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function loginHtml(error: string | null): string {
  const errorBlock = error ? `<div class="error">${escapeHtml(error)}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>ChainGPT Agent Wallet — Login</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>${BASE_CSS}
.login { max-width: 420px; margin: 80px auto; }
.login form { display: flex; flex-direction: column; gap: 10px; }
.login input[type=password] { padding: 10px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 14px; }
.login button { padding: 10px; background: #238636; color: #fff; border: 0; border-radius: 4px; font-weight: 600; cursor: pointer; }
.login button:hover { background: #2ea043; }
.error { background: #5d1a1f; border: 1px solid #f85149; color: #ffa6a0; padding: 10px; border-radius: 4px; margin-bottom: 12px; }
.hint { color: #7d8590; font-size: 12px; line-height: 1.5; }
</style></head><body>
<div class="login">
<h1>ChainGPT Agent Wallet</h1>
<div class="subtle">Admin login</div>
${errorBlock}
<form method="POST" action="/login">
<input type="password" name="token" placeholder="Paste admin token" autofocus required />
<button type="submit">Unlock</button>
</form>
<p class="hint">The admin token was printed in the MCP tool output when you ran <code>chaingpt_agent_wallet_serve_ui</code>. It's also stored at <code>~/.chaingpt-mcp/agent-wallet/.admin-token</code> (0600). It rotates every time the UI server is (re)started.</p>
</div>
</body></html>`;
}

const BASE_CSS = `
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0e1a; color: #e6edf3; max-width: 980px; margin: 0 auto; padding: 0 16px 60px; line-height: 1.5; min-height: 100vh; }
code, pre, .mono, .addr, textarea { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
h1 { color: #f0f6fc; font-size: 22px; margin: 24px 0 0; font-weight: 600; }
h2 { font-size: 12px; margin: 0 0 12px; color: #d2a8ff; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
h3 { font-size: 14px; margin: 0 0 8px; color: #e6edf3; font-weight: 500; }
.subtle, small { color: #7d8590; font-size: 13px; }

/* Header */
header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0 8px; border-bottom: 1px solid #21262d; margin-bottom: 16px; }
header .brand { display: flex; align-items: center; gap: 12px; }
header .brand-text { display: flex; flex-direction: column; }
header .brand h1 { margin: 0; line-height: 1.1; }
.logo-dot { width: 10px; height: 10px; border-radius: 50%; background: #3fb950; box-shadow: 0 0 8px #3fb950; }
.logo-dot.killed { background: #f85149; box-shadow: 0 0 8px #f85149; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
header .actions { display: flex; gap: 8px; }

/* Tabs */
.tabs { display: flex; gap: 4px; margin: 0 0 16px; border-bottom: 1px solid #21262d; }
.tab { background: transparent; color: #7d8590; border: 0; padding: 10px 16px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; font-family: inherit; font-weight: 500; }
.tab:hover { color: #e6edf3; }
.tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
.tab-pane { display: none; }
.tab-pane.active { display: block; }

/* Cards */
.card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 18px; margin: 16px 0; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin: 0 0 12px; gap: 8px; flex-wrap: wrap; }
.card-head h2 { margin: 0; }
.card-head .actions { display: flex; gap: 6px; align-items: center; }
.digest { color: #ffa657; font-weight: normal; font-size: 11px; font-family: ui-monospace, monospace; }

/* Buttons */
button, .btn { padding: 7px 14px; background: #238636; color: #fff; border: 0; border-radius: 6px; font-weight: 500; cursor: pointer; font-family: inherit; font-size: 13px; transition: background 0.15s; }
button:hover, .btn:hover { background: #2ea043; }
button.secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
button.secondary:hover { background: #30363d; }
button.danger { background: #da3633; }
button.danger:hover { background: #f85149; }
button.warn { background: #9e6a03; }
button.warn:hover { background: #b07807; }
button.ghost { background: transparent; color: #58a6ff; padding: 4px 8px; }
button.ghost:hover { background: rgba(88, 166, 255, 0.15); color: #79c0ff; }
button.small { padding: 4px 10px; font-size: 12px; }

/* Forms */
input[type=text], input[type=password], input[type=number], select { padding: 8px 12px; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; font-family: inherit; font-size: 13px; width: 100%; }
input:focus, select:focus, textarea:focus { outline: none; border-color: #58a6ff; }
textarea { width: 100%; min-height: 280px; padding: 10px 12px; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; font-size: 12px; line-height: 1.6; resize: vertical; }
label { display: block; font-size: 12px; color: #7d8590; margin-bottom: 4px; margin-top: 12px; font-weight: 500; }
label.inline { display: inline-flex; align-items: center; gap: 8px; margin: 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; }
.form-grid .full { grid-column: 1 / -1; }
.help { font-size: 11px; color: #6e7681; margin-top: 4px; line-height: 1.4; }

/* Repeatable address rows */
.repeatable .row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
.repeatable .row input { flex: 1; }
.repeatable .row button.remove { padding: 4px 10px; }

/* Asset / balance list */
.balance-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #21262d; align-items: center; gap: 12px; }
.balance-row:last-child { border-bottom: 0; }
.balance-row .left { display: flex; gap: 10px; align-items: center; flex: 1; min-width: 0; }
.chain-pill { font-size: 10px; padding: 2px 8px; background: #1f6feb33; color: #79c0ff; border-radius: 10px; font-weight: 600; letter-spacing: 0.3px; white-space: nowrap; }
.chain-pill.eth { background: #6f42c133; color: #d2a8ff; }
.chain-pill.base { background: #1f6feb33; color: #79c0ff; }
.chain-pill.arbitrum { background: #28a7e133; color: #56d4dd; }
.chain-pill.optimism { background: #da363333; color: #ff8585; }
.chain-pill.polygon { background: #8954ff33; color: #b07aff; }
.chain-pill.bsc { background: #ffa65733; color: #ffc380; }
.chain-pill.avalanche { background: #e8444433; color: #ff8585; }
.balance-row .amount { font-family: ui-monospace, monospace; font-size: 14px; }
.balance-row .sym { color: #7d8590; font-size: 12px; margin-left: 4px; }
.zero-balance { opacity: 0.4; }
.zero-balance.hide { display: none; }
.token-name { font-size: 13px; }
.token-label { color: #7d8590; font-size: 11px; }

/* Address card */
.addr { font-size: 15px; word-break: break-all; color: #79c0ff; font-weight: 500; }
.addr-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #0d1117; border-radius: 6px; }
.copy-btn { padding: 4px 10px; font-size: 11px; background: #21262d; color: #79c0ff; }
.copy-btn.copied { background: #133929; color: #56d364; }

/* QR */
img.qr { background: white; padding: 8px; border-radius: 8px; }

/* Templates grid */
.template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.template { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 12px; cursor: pointer; text-align: left; color: #e6edf3; transition: all 0.15s; }
.template:hover { background: #161b22; border-color: #58a6ff; transform: translateY(-1px); }
.template .emoji { font-size: 24px; margin-bottom: 6px; display: block; }
.template strong { display: block; font-size: 13px; margin-bottom: 4px; }
.template small { color: #7d8590; font-size: 11px; line-height: 1.4; display: block; }
.template form { margin: 0; }
.template button { width: 100%; background: transparent; color: inherit; padding: 0; text-align: left; font-weight: normal; }

/* Kill switch */
.killswitch-on { color: #f85149; font-weight: bold; }
.killswitch-off { color: #3fb950; font-weight: bold; }
.kill-banner { background: linear-gradient(90deg, #5d1a1f 0%, #3a1115 100%); border: 1px solid #f85149; color: #ffa6a0; padding: 12px 16px; border-radius: 8px; margin: 12px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.kill-banner.off { background: linear-gradient(90deg, #133929 0%, #0a2417 100%); border-color: #3fb950; color: #aff5bd; }
.kill-banner.unrestricted { background: linear-gradient(90deg, #5d3a00 0%, #361f00 100%); border-color: #fb8500; color: #ffd591; animation: throb 2s infinite; }
@keyframes throb { 0%, 100% { box-shadow: 0 0 0 0 rgba(251, 133, 0, 0.4); } 50% { box-shadow: 0 0 0 6px rgba(251, 133, 0, 0); } }
.logo-dot.unrestricted { background: #fb8500; box-shadow: 0 0 8px #fb8500; animation: pulse 1s infinite; }

/* Activity */
.activity-row { display: flex; gap: 12px; padding: 10px; border-bottom: 1px solid #21262d; align-items: center; }
.activity-row:hover { background: #0d1117; }
.activity-row:last-child { border-bottom: 0; }
.activity-row .icon { font-size: 18px; }
.activity-row .meta { flex: 1; min-width: 0; }
.activity-row .meta .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.activity-row .meta .ts { color: #7d8590; font-size: 11px; }
.activity-row .meta .target { font-family: ui-monospace, monospace; font-size: 12px; color: #7d8590; }
.activity-row .meta .target a { color: #58a6ff; text-decoration: none; }
.activity-row .meta .memo { font-size: 12px; color: #d2a8ff; margin-top: 2px; }

/* Toast */
.toast { position: fixed; bottom: 20px; right: 20px; background: #161b22; border: 1px solid #30363d; padding: 12px 16px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); animation: slideIn 0.2s; max-width: 360px; font-size: 13px; z-index: 1000; }
.toast.ok { border-color: #3fb950; }
.toast.err { border-color: #f85149; }
.toast .close { margin-left: 8px; cursor: pointer; opacity: 0.5; }
.toast .close:hover { opacity: 1; }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* Flash (server-rendered) */
.flash { padding: 10px 14px; border-radius: 6px; margin: 12px 0; font-size: 13px; }
.flash.ok { background: #133929; color: #56d364; border: 1px solid #2ea043; }
.flash.err { background: #5d1a1f; color: #ffa6a0; border: 1px solid #f85149; }

/* Login */
.login-page { max-width: 420px; margin: 80px auto; }
.login-page form { display: flex; flex-direction: column; gap: 10px; }

/* Misc */
.bar { display: flex; gap: 8px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
hr { border: 0; border-top: 1px solid #21262d; margin: 16px 0; }
footer { color: #484f58; font-size: 11px; margin-top: 32px; text-align: center; padding-top: 16px; border-top: 1px solid #21262d; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) {
  .grid-2 { grid-template-columns: 1fr; }
  .form-grid { grid-template-columns: 1fr; }
  header { flex-direction: column; align-items: flex-start; gap: 8px; }
}
`;

const DASHBOARD_JS = `
// Tabs
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', e => {
    const tab = e.currentTarget.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    history.replaceState(null, '', '#' + tab);
  });
});
// Open hash tab on load
const hash = location.hash.replace('#', '');
if (hash) {
  const t = document.querySelector('.tab[data-tab=' + JSON.stringify(hash) + ']');
  if (t) t.click();
}

// Toast helper
function toast(msg, kind) {
  kind = kind || 'ok';
  const div = document.createElement('div');
  div.className = 'toast ' + kind;
  div.innerHTML = msg + ' <span class="close">×</span>';
  document.body.appendChild(div);
  div.querySelector('.close').addEventListener('click', () => div.remove());
  setTimeout(() => div.remove(), 6000);
}

// Copy buttons
document.addEventListener('click', e => {
  if (!e.target.classList.contains('copy-btn')) return;
  const text = e.target.dataset.copy;
  navigator.clipboard.writeText(text).then(() => {
    const orig = e.target.textContent;
    e.target.textContent = '✓ copied';
    e.target.classList.add('copied');
    setTimeout(() => { e.target.textContent = orig; e.target.classList.remove('copied'); }, 1500);
  }).catch(() => toast('Copy failed', 'err'));
});

// Hide-zero toggle
const hideZeroCb = document.getElementById('hide-zero');
if (hideZeroCb) {
  const applyHide = () => {
    document.querySelectorAll('.balance-row.zero-balance').forEach(r => r.classList.toggle('hide', hideZeroCb.checked));
  };
  hideZeroCb.addEventListener('change', () => {
    localStorage.setItem('cg-hide-zero', hideZeroCb.checked ? '1' : '0');
    applyHide();
  });
  if (localStorage.getItem('cg-hide-zero') === '1') { hideZeroCb.checked = true; applyHide(); }
}

// Refresh button
const refreshBtn = document.getElementById('refresh-balances');
if (refreshBtn) refreshBtn.addEventListener('click', () => location.reload());

// Auto-refresh every 30s when on Assets tab
let autoRefreshTimer = null;
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (document.querySelector('.tab.active')?.dataset.tab === 'assets' && !document.hidden) {
      location.reload();
    }
  }, 30000);
}
startAutoRefresh();

// Repeatable address rows
document.addEventListener('click', e => {
  if (e.target.classList.contains('add-row')) {
    const tpl = e.target.previousElementSibling;
    const clone = tpl.firstElementChild.cloneNode(true);
    clone.querySelector('input').value = '';
    tpl.appendChild(clone);
  } else if (e.target.classList.contains('remove-row')) {
    e.target.closest('.row').remove();
  }
});

// Form-based policy save: collect repeatable fields into JSON before submit
const formPolicyForm = document.getElementById('form-policy-form');
if (formPolicyForm) {
  formPolicyForm.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(formPolicyForm);
    const allowedChains = fd.getAll('allowedChains').map(Number).filter(n => Number.isInteger(n) && n > 0);
    const allowedToAddresses = [...formPolicyForm.querySelectorAll('input[name="allowed"]')].map(i => i.value.trim()).filter(Boolean);
    const blockedToAddresses = [...formPolicyForm.querySelectorAll('input[name="blocked"]')].map(i => i.value.trim()).filter(Boolean);
    const blockedSelectors = [...formPolicyForm.querySelectorAll('input[name="selector"]')].map(i => i.value.trim()).filter(Boolean);
    const valueAmt = String(fd.get('valueAmount') || '0').trim();
    const valueUnit = fd.get('valueUnit') || 'wei';
    // BigInt-safe decimal → wei conversion (no Number, no precision loss)
    function decToWei(amount, unit) {
      const decimals = unit === 'ether' ? 18 : unit === 'gwei' ? 9 : 0;
      const cleaned = amount.replace(/[, ]/g, '');
      if (decimals === 0) {
        if (!/^-?\\d+$/.test(cleaned)) throw new Error('wei value must be an integer string');
        return BigInt(cleaned);
      }
      if (!/^-?\\d+(\\.\\d+)?$/.test(cleaned)) throw new Error('value must be a decimal number');
      const negative = cleaned.startsWith('-');
      const abs = negative ? cleaned.slice(1) : cleaned;
      const [intPart, fracPart = ''] = abs.split('.');
      const padded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
      const wei = BigInt(intPart || '0') * (10n ** BigInt(decimals)) + BigInt(padded || '0');
      return negative ? -wei : wei;
    }
    let maxTxValueWei = '0';
    try {
      maxTxValueWei = decToWei(valueAmt, valueUnit).toString();
    } catch (e) { toast('Invalid value amount: ' + e.message, 'err'); return; }
    const policy = {
      version: 1,
      killSwitch: fd.get('killSwitch') === 'on',
      unrestricted: fd.get('unrestricted') === 'on',
      allowedChains,
      allowedToAddresses,
      blockedToAddresses,
      maxTxValueWei,
      maxTxGas: String(fd.get('maxTxGas') || '1000000'),
      blockedSelectors,
      requireMemo: fd.get('requireMemo') === 'on',
      notes: String(fd.get('notes') || ''),
    };
    // Submit as a raw form to /api/policy
    const f = document.createElement('form');
    f.method = 'POST'; f.action = '/api/policy';
    const i = document.createElement('input'); i.type = 'hidden'; i.name = 'policy'; i.value = JSON.stringify(policy);
    f.appendChild(i);
    document.body.appendChild(f); f.submit();
  });
}

// ── Apply a policy template via fetch — NO page reload, stay on Policy tab ──
document.addEventListener('click', async function(e) {
  var btn = (e.target && e.target.closest) ? e.target.closest('.template-apply') : null;
  if (!btn) return;
  e.preventDefault();
  var id = btn.getAttribute('data-template');
  var prevOpacity = btn.style.opacity;
  btn.style.opacity = '0.5';
  try {
    var r = await fetch('/api/policy/template', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'fetch' },
      body: 'template=' + encodeURIComponent(id),
      credentials: 'same-origin'
    });
    var data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || ('HTTP ' + r.status));
    applyPolicyToForm(data.policy);
    toast('Applied ' + data.emoji + ' ' + data.name + ' — saved + live · digest ' + data.digest, 'ok');
  } catch (err) {
    toast('Template apply failed: ' + err.message, 'err');
  } finally {
    btn.style.opacity = prevOpacity;
  }
});

function setRepeatable(repeatableEl, name, values) {
  if (!repeatableEl) return;
  var vals = (values && values.length) ? values : [''];
  var sample = repeatableEl.querySelector('.row');
  repeatableEl.innerHTML = '';
  for (var i = 0; i < vals.length; i++) {
    var row;
    if (sample) { row = sample.cloneNode(true); }
    else {
      row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<input type="text"/><button type="button" class="remove secondary remove-row">x</button>';
    }
    var inp = row.querySelector('input');
    inp.value = vals[i];
    inp.setAttribute('name', name);
    repeatableEl.appendChild(row);
  }
}

function applyPolicyToForm(p) {
  var form = document.getElementById('form-policy-form');
  if (!form || !p) return;
  var ks = form.querySelector('input[name="killSwitch"]'); if (ks) ks.checked = !!p.killSwitch;
  var un = form.querySelector('input[name="unrestricted"]'); if (un) un.checked = !!p.unrestricted;
  var chains = p.allowedChains || [];
  form.querySelectorAll('input[name="allowedChains"]').forEach(function(cb) {
    cb.checked = chains.indexOf(Number(cb.value)) !== -1;
  });
  form.querySelectorAll('.repeatable').forEach(function(g) {
    var probe = g.querySelector('input');
    if (!probe) return;
    var nm = probe.getAttribute('name');
    if (nm === 'allowed') setRepeatable(g, 'allowed', p.allowedToAddresses || []);
    else if (nm === 'blocked') setRepeatable(g, 'blocked', p.blockedToAddresses || []);
    else if (nm === 'selector') setRepeatable(g, 'selector', p.blockedSelectors || []);
  });
  var va = form.querySelector('input[name="valueAmount"]'); if (va) va.value = p.maxTxValueWei || '0';
  var vu = form.querySelector('select[name="valueUnit"]'); if (vu) vu.value = 'wei';
  var mg = form.querySelector('input[name="maxTxGas"]'); if (mg) mg.value = p.maxTxGas || '1000000';
  var rm = form.querySelector('input[name="requireMemo"]'); if (rm) rm.checked = !!p.requireMemo;
  var nt = form.querySelector('textarea[name="notes"]'); if (nt) nt.value = p.notes || '';
  updateKillBanner(p);
  var raw = document.querySelector('textarea[name="policy"]');
  if (raw) { try { raw.value = JSON.stringify(p, null, 2); } catch (e2) {} }
}

function updateKillBanner(p) {
  var banner = document.querySelector('.kill-banner');
  if (!banner) return;
  banner.classList.remove('off', 'unrestricted');
  if (p.killSwitch) {
    banner.innerHTML = '<span><strong>🛑 Kill switch ENGAGED</strong> — every signing operation is refused.</span>'
      + '<form method="POST" action="/api/killswitch" style="margin:0"><input type="hidden" name="set" value="off"/><button class="warn small" type="submit">Disable</button></form>';
  } else if (p.unrestricted) {
    banner.classList.add('unrestricted');
    banner.innerHTML = '<span><strong>🚨 UNRESTRICTED MODE</strong> — agent can sign any transaction with no policy checks. Kill switch still works (one-click halt below).</span>'
      + '<form method="POST" action="/api/killswitch" style="margin:0"><input type="hidden" name="set" value="on"/><button class="danger small" type="submit">🛑 Engage kill switch</button></form>';
  } else {
    banner.classList.add('off');
    banner.innerHTML = '<span>✓ Kill switch off — signing allowed (subject to per-tx rules)</span>'
      + '<form method="POST" action="/api/killswitch" style="margin:0"><input type="hidden" name="set" value="on"/><button class="danger small" type="submit">🛑 Engage</button></form>';
  }
}
`;

interface RenderContext {
  address: string;
  chains: string[];
  flash: { kind: 'ok' | 'err'; msg: string } | null;
}

async function renderDashboard(res: ServerResponse, address: string, chains: string[], flash: { kind: 'ok' | 'err'; msg: string } | null): Promise<void> {
  const policy = loadPolicy();
  const digest = policyDigest(policy);

  // Balances are fetched in PARALLEL with a short per-call timeout so a slow
  // or unreachable RPC can't block the whole dashboard render. Previously each
  // chain/token was awaited sequentially against an 8s-per-endpoint fallback,
  // so a degraded public RPC stacked into a multi-second (or timed-out) render
  // on every page load. Each cell now degrades independently to "RPC error".
  const nativeResults = await Promise.all(
    chains.map(async (c) => {
      const chain = resolveChainWithCustom(c);
      if (!chain) return null;
      try {
        const bal = await cachedBalance(`native:${c}:${address}`, () => getNativeBalance(c, address));
        return { c, chain, amount: fmtEth(bal), isZero: bal === 0n, isError: false };
      } catch {
        return { c, chain, amount: '?', isZero: false, isError: true };
      }
    }),
  );
  const nativeRows: string[] = [];
  for (const r of nativeResults) {
    if (!r) continue;
    const { c, chain, amount, isZero, isError } = r;
    const zeroClass = isZero ? ' zero-balance' : '';
    const valueCell = isError
      ? `<span style="color:#7d8590">RPC error</span>`
      : `<span class="amount">${escapeHtml(amount)}</span><span class="sym">${escapeHtml(chain.native)}</span>`;
    nativeRows.push(
      `<div class="balance-row${zeroClass}">
        <div class="left">
          <span class="chain-pill ${c}">${escapeHtml(chain.name.toUpperCase())}</span>
          <span class="token-name">Native (${escapeHtml(chain.native)})</span>
        </div>
        <div>${valueCell}</div>
      </div>`
    );
  }

  // Tracked tokens — same parallel + timeout treatment.
  const tracked = loadTrackedTokens();
  const tokenResults = await Promise.all(
    tracked.map(async (t) => {
      const chain = resolveChainWithCustom(t.chain);
      if (!chain) return null;
      try {
        const raw = await cachedBalance(`erc20:${t.chain}:${t.address}:${address}`, () => fetchErc20Balance(t.chain, t.address, address));
        return { t, chain, amount: formatTokenAmount(raw, t.decimals), isZero: raw === 0n, isError: false };
      } catch {
        return { t, chain, amount: '?', isZero: false, isError: true };
      }
    }),
  );
  const tokenRows: string[] = [];
  for (const r of tokenResults) {
    if (!r) continue;
    const { t, chain, amount, isZero, isError } = r;
    const zeroClass = isZero ? ' zero-balance' : '';
    const valueCell = isError
      ? `<span style="color:#7d8590">RPC error</span>`
      : `<span class="amount">${escapeHtml(amount)}</span><span class="sym">${escapeHtml(t.symbol)}</span>`;
    tokenRows.push(
      `<div class="balance-row${zeroClass}">
        <div class="left">
          <span class="chain-pill ${t.chain}">${escapeHtml(chain.name.toUpperCase())}</span>
          <div style="min-width:0">
            <div class="token-name">${escapeHtml(t.symbol)}${t.label ? ` <span class="token-label">— ${escapeHtml(t.label)}</span>` : ''}</div>
            <div class="token-label mono" style="font-size:10px">${escapeHtml(t.address)}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <div>${valueCell}</div>
          <form method="POST" action="/api/tokens/remove" style="display:inline">
            <input type="hidden" name="chain" value="${escapeHtml(t.chain)}"/>
            <input type="hidden" name="address" value="${escapeHtml(t.address)}"/>
            <button class="ghost small" type="submit" title="Stop tracking">×</button>
          </form>
        </div>
      </div>`
    );
  }

  // Activity
  const activity = readActivity(20);
  const activityRows = activity.length === 0
    ? `<div class="subtle" style="padding:12px">No transactions yet. When the agent runs <code>chaingpt_agent_wallet_sign_and_send</code> and the policy allows it, entries will appear here.</div>`
    : activity.map((a) => {
        const chain = resolveChainWithCustom(a.chain);
        const txLink = chain?.explorer ? `${chain.explorer}/tx/${a.hash}` : '#';
        const addrLink = chain?.explorer ? `${chain.explorer}/address/${a.to}` : '#';
        const valueEth = fmtEth(BigInt(a.valueWei));
        return `<div class="activity-row">
          <div class="icon">→</div>
          <div class="meta">
            <div class="top">
              <span><span class="chain-pill ${a.chain}">${escapeHtml((chain?.name ?? a.chain).toUpperCase())}</span> <strong>${escapeHtml(valueEth)} ${escapeHtml(chain?.native ?? '?')}</strong></span>
              <span class="ts">${escapeHtml(a.ts.slice(0, 19).replace('T', ' '))} UTC</span>
            </div>
            <div class="target">to <a href="${escapeHtml(addrLink)}" target="_blank">${escapeHtml(a.to)}</a></div>
            <div class="target">tx <a href="${escapeHtml(txLink)}" target="_blank">${escapeHtml(a.hash)}</a></div>
            ${a.memo ? `<div class="memo">"${escapeHtml(a.memo)}"</div>` : ''}
          </div>
        </div>`;
      }).join('');

  // Generate QR locally — no third-party egress (admin address stays on-device).
  let qrDataUri = '';
  try {
    qrDataUri = await QRCode.toDataURL(`ethereum:${address}`, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
  } catch { /* fall back to no QR */ }

  const flashBlock = flash ? `<div class="flash ${flash.kind}">${escapeHtml(flash.msg)}</div>` : '';
  const html = renderTabbedDashboard({
    address,
    digest,
    policy,
    policyJson: JSON.stringify(policy, null, 2),
    nativeRows: nativeRows.join(''),
    tokenRows: tokenRows.join(''),
    activityHtml: activityRows,
    chains,
    flashBlock,
    qrDataUri,
  });
  res.writeHead(flash?.kind === 'err' ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

interface TabbedOpts {
  address: string;
  digest: string;
  policy: AgentPolicy;
  policyJson: string;
  nativeRows: string;
  tokenRows: string;
  activityHtml: string;
  chains: string[];
  flashBlock: string;
  qrDataUri: string;
}

function renderTabbedDashboard(o: TabbedOpts): string {
  const killOn = !!o.policy.killSwitch;
  const unrestricted = !!o.policy.unrestricted && !killOn;
  const killBanner = killOn
    ? `<div class="kill-banner"><span><strong>🛑 Kill switch ENGAGED</strong> — every signing operation is refused.</span><form method="POST" action="/api/killswitch" style="margin:0"><input type="hidden" name="set" value="off"/><button class="warn small" type="submit">Disable</button></form></div>`
    : (unrestricted
        ? `<div class="kill-banner unrestricted"><span><strong>🚨 UNRESTRICTED MODE</strong> — agent can sign any transaction with no policy checks. Kill switch still works (one-click halt below).</span><form method="POST" action="/api/killswitch" style="margin:0"><input type="hidden" name="set" value="on"/><button class="danger small" type="submit">🛑 Engage kill switch</button></form></div>`
        : `<div class="kill-banner off"><span>✓ Kill switch off — signing allowed (subject to per-tx rules)</span><form method="POST" action="/api/killswitch" style="margin:0"><input type="hidden" name="set" value="on"/><button class="danger small" type="submit">🛑 Engage</button></form></div>`);

  // Templates grid. Buttons (not forms) — applied via fetch so the page does
  // NOT reload and the admin stays on the Policy tab. Progressive enhancement:
  // if JS is disabled the noscript form below still works.
  const templateCards = POLICY_TEMPLATES.map((t) => `
    <button type="button" class="template template-apply" data-template="${escapeHtml(t.id)}">
      <span class="emoji">${t.emoji}</span>
      <strong>${escapeHtml(t.name)}</strong>
      <small>${escapeHtml(t.description)}</small>
    </button>
  `).join('');

  // Form-based policy editor — merged built-in + custom chains
  const mergedChainList = Object.values(mergedChains()).filter((c) => c.chainId !== null);
  const chainOptions = mergedChainList.map((c) => {
    const checked = o.policy.allowedChains?.includes(c.chainId!) ? 'checked' : '';
    const isCustom = !CHAINS[c.slug];
    return `<label class="inline"><input type="checkbox" name="allowedChains" value="${c.chainId}" ${checked}/> ${escapeHtml(c.name)} <small style="opacity:0.6">(${c.chainId}${isCustom ? ' · custom' : ''})</small></label>`;
  }).join('');

  const allowedRows = (o.policy.allowedToAddresses ?? ['']).map((a) =>
    `<div class="row"><input type="text" name="allowed" value="${escapeHtml(a)}" placeholder="0x..."/><button type="button" class="remove secondary remove-row">×</button></div>`
  ).join('');
  const blockedRows = (o.policy.blockedToAddresses ?? ['']).map((a) =>
    `<div class="row"><input type="text" name="blocked" value="${escapeHtml(a)}" placeholder="0x..."/><button type="button" class="remove secondary remove-row">×</button></div>`
  ).join('');
  const selectorRows = (o.policy.blockedSelectors ?? ['']).map((s) =>
    `<div class="row"><input type="text" name="selector" value="${escapeHtml(s)}" placeholder="0xa9059cbb"/><button type="button" class="remove secondary remove-row">×</button></div>`
  ).join('');

  const maxValueWei = o.policy.maxTxValueWei ?? '0';

  // Token-add chain options — merged built-in + custom
  const tokenChainOptions = mergedChainList.map((c) =>
    `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}${!CHAINS[c.slug] ? ' (custom)' : ''}</option>`
  ).join('');

  // Custom-chains listing for the Settings tab
  const customChainsList = loadCustomChains();
  const customChainsRows = customChainsList.length === 0
    ? `<p class="help">No custom chains yet. Use the form above to add one (chain ID, RPC URL, native symbol).</p>`
    : customChainsList.map((c) => `
      <div class="balance-row">
        <div class="left">
          <span class="chain-pill">${escapeHtml(c.slug.toUpperCase())}</span>
          <div>
            <div class="token-name">${escapeHtml(c.name)} <small class="token-label">(chainId ${c.chainId}, ${escapeHtml(c.native)})</small></div>
            <div class="token-label mono" style="font-size:10px">${escapeHtml(c.rpcUrl)}</div>
          </div>
        </div>
        <form method="POST" action="/api/chains/remove" style="margin:0">
          <input type="hidden" name="slug" value="${escapeHtml(c.slug)}"/>
          <button class="ghost small" type="submit" title="Remove">×</button>
        </form>
      </div>`).join('');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><title>ChainGPT Agent Wallet</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>${BASE_CSS}</style>
</head><body>

<header>
  <div class="brand">
    <span class="logo-dot ${killOn ? 'killed' : unrestricted ? 'unrestricted' : ''}"></span>
    <div class="brand-text">
      <h1>ChainGPT Agent Wallet</h1>
      <small>${killOn ? 'Kill switch ENGAGED' : unrestricted ? 'UNRESTRICTED MODE' : 'Operational'} · digest <span class="digest">${escapeHtml(o.digest)}</span></small>
    </div>
  </div>
  <div class="actions">
    <a class="btn secondary small" href="/logout">Logout</a>
  </div>
</header>

<div class="tabs">
  <button class="tab active" data-tab="assets">Assets</button>
  <button class="tab" data-tab="policy">Policy</button>
  <button class="tab" data-tab="activity">Activity</button>
  <button class="tab" data-tab="settings">Settings</button>
</div>

${o.flashBlock}

<!-- ASSETS TAB -->
<section id="tab-assets" class="tab-pane active">
  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h2>Deposit address</h2></div>
      <div class="addr-row">
        <span class="addr mono">${escapeHtml(o.address)}</span>
        <button class="copy-btn" data-copy="${escapeHtml(o.address)}">Copy</button>
      </div>
      <div style="margin-top:14px; text-align:center">
        ${o.qrDataUri
          ? `<img class="qr" alt="QR code for receive address" src="${escapeHtml(o.qrDataUri)}" width="220" height="220"/>`
          : `<div class="help">(QR rendering unavailable)</div>`}
      </div>
      <p class="help">EVM-compatible address. Funds can arrive on any of the ${Object.values(CHAINS).filter((c)=>c.chainId!==null).length} supported chains. QR generated locally — never leaves the dashboard.</p>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Add custom token</h2>
      </div>
      <form method="POST" action="/api/tokens/add">
        <label>Chain</label>
        <select name="chain" required>${tokenChainOptions}</select>
        <label>ERC-20 contract address</label>
        <input type="text" name="address" placeholder="0x..." pattern="0x[0-9a-fA-F]{40}" required/>
        <label>Label (optional)</label>
        <input type="text" name="label" placeholder="USDC on Base"/>
        <p class="help">Symbol + decimals are fetched automatically via <code>eth_call</code> on add.</p>
        <div class="bar">
          <button type="submit">Add token</button>
        </div>
      </form>
      <hr/>
      <form method="POST" action="/api/scan-bluechips">
        <p class="help" style="margin-top:0">Scan the curated blue-chip registry across all chains for tokens the agent already holds and auto-add them. Spam-token defense: only addresses on the static allowlist are eligible.</p>
        <div class="bar"><button type="submit" class="secondary">🔍 Scan & auto-add blue chips</button></div>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>Balances</h2>
      <div class="actions">
        <label class="inline subtle"><input type="checkbox" id="hide-zero"/> Hide zero</label>
        <button class="secondary small" id="refresh-balances">↻ Refresh</button>
      </div>
    </div>
    <div>${o.nativeRows}</div>
    ${o.tokenRows ? `<hr/><div>${o.tokenRows}</div>` : '<hr/><p class="help">No custom tokens tracked yet — add one above.</p>'}
  </div>
</section>

<!-- POLICY TAB -->
<section id="tab-policy" class="tab-pane">
  ${killBanner}

  <div class="card">
    <div class="card-head"><h2>Quick templates</h2><small>Click to apply. Templates serve double duty as reference for what fields exist.</small></div>
    <div class="template-grid">${templateCards}</div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Form editor</h2><small>No JSON required. Form values are converted to a strict policy + validated server-side.</small></div>
    <form id="form-policy-form">
      <div class="form-grid">
        <div class="full">
          <label class="inline">
            <input type="checkbox" name="killSwitch" ${killOn ? 'checked' : ''}/>
            <strong>Kill switch</strong> — when ON, every signing operation is refused
          </label>
        </div>

        <div class="full">
          <label class="inline" style="color:#ffd591">
            <input type="checkbox" name="unrestricted" ${o.policy.unrestricted ? 'checked' : ''}/>
            <strong>🚨 Unrestricted mode</strong> — bypass ALL per-tx checks. Kill switch still works as the master override.
          </label>
          <p class="help" style="color:#ffd591">Use only on trusted setups (dev / testnet / fully-audited prompts). When this is on, the agent can send funds to any address with no allowlist or value cap.</p>
        </div>

        <div class="full">
          <label>Allowed chains</label>
          <div style="display:flex; flex-wrap:wrap; gap:8px 16px">${chainOptions}</div>
          <p class="help">Empty selection means no chains allowed (combined with kill switch off → still nothing happens).</p>
        </div>

        <div>
          <label>Allowed to-addresses</label>
          <div class="repeatable">${allowedRows}</div>
          <button type="button" class="secondary small add-row">+ Add address</button>
          <p class="help">If non-empty, agent can only send to addresses in this list.</p>
        </div>

        <div>
          <label>Blocked to-addresses</label>
          <div class="repeatable">${blockedRows}</div>
          <button type="button" class="secondary small add-row">+ Add address</button>
          <p class="help">Wins over allowed. Curate from chainabuse.com / Forta alerts.</p>
        </div>

        <div>
          <label>Max native value per tx</label>
          <div style="display:flex; gap:6px">
            <input type="text" name="valueAmount" value="${escapeHtml(maxValueWei)}" style="flex:1"/>
            <select name="valueUnit" style="width:auto"><option value="wei" selected>wei</option><option value="gwei">gwei</option><option value="ether">ether</option></select>
          </div>
          <p class="help">Default unit is wei (raw). "0" means no native transfers allowed.</p>
        </div>

        <div>
          <label>Max gas per tx (units)</label>
          <input type="text" name="maxTxGas" value="${escapeHtml(o.policy.maxTxGas ?? '1000000')}"/>
          <p class="help">Caps gas spend per tx. Aave supply ~600k; multicall ~1.2M.</p>
        </div>

        <div class="full">
          <label>Blocked function selectors (4-byte hex)</label>
          <div class="repeatable">${selectorRows}</div>
          <button type="button" class="secondary small add-row">+ Add selector</button>
          <p class="help">Example: <code>0xa9059cbb</code> blocks ERC-20 <code>transfer</code>.</p>
        </div>

        <div class="full">
          <label class="inline">
            <input type="checkbox" name="requireMemo" ${o.policy.requireMemo ? 'checked' : ''}/>
            Require memo on every sign_and_send (audit trail)
          </label>
        </div>

        <div class="full">
          <label>Notes</label>
          <textarea name="notes" style="min-height:80px">${escapeHtml(o.policy.notes ?? '')}</textarea>
        </div>
      </div>
      <div class="bar">
        <button type="submit">Save policy</button>
        <small>Validated server-side. Atomic write + .bak backup of the previous version.</small>
      </div>
    </form>
  </div>

  <div class="card">
    <div class="card-head"><h2>Raw JSON editor</h2><small>Power-user fallback. Same validation as the form editor.</small></div>
    <form method="POST" action="/api/policy">
      <textarea name="policy" spellcheck="false">${escapeHtml(o.policyJson)}</textarea>
      <div class="bar"><button type="submit">Save raw JSON</button></div>
    </form>
  </div>
</section>

<!-- ACTIVITY TAB -->
<section id="tab-activity" class="tab-pane">
  <div class="card">
    <div class="card-head"><h2>Recent transactions</h2><small>Agent-initiated only. Last 20 shown.</small></div>
    <div>${o.activityHtml}</div>
  </div>
</section>

<!-- SETTINGS TAB -->
<section id="tab-settings" class="tab-pane">
  <div class="card">
    <div class="card-head"><h2>Custom chains</h2><small>Add EVM chains not in the built-in registry. Persisted to <code>${escapeHtml(customChainsPath())}</code>.</small></div>
    <form method="POST" action="/api/chains/add">
      <div class="form-grid">
        <div>
          <label>Slug (kebab-case)</label>
          <input type="text" name="slug" placeholder="zora" pattern="[a-z][a-z0-9-]{1,30}" required/>
        </div>
        <div>
          <label>Chain ID</label>
          <input type="number" name="chainId" placeholder="7777777" min="1" required/>
        </div>
        <div>
          <label>Display name</label>
          <input type="text" name="name" placeholder="Zora Network" required/>
        </div>
        <div>
          <label>Native symbol</label>
          <input type="text" name="native" placeholder="ETH" required/>
        </div>
        <div class="full">
          <label>RPC URL (primary, https)</label>
          <input type="text" name="rpcUrl" placeholder="https://rpc.zora.energy" pattern="https?://.+" required/>
        </div>
        <div class="full">
          <label>RPC fallbacks (comma-separated, optional)</label>
          <input type="text" name="rpcFallbacks" placeholder="https://alt1.example, https://alt2.example"/>
        </div>
        <div class="full">
          <label>Block explorer URL (optional)</label>
          <input type="text" name="explorer" placeholder="https://explorer.zora.energy"/>
        </div>
      </div>
      <div class="bar"><button type="submit">Add chain</button></div>
    </form>
    <hr/>
    <h3 style="font-size:13px;color:#7d8590;margin:8px 0">Currently registered (${customChainsList.length})</h3>
    ${customChainsRows}
  </div>

  <div class="card">
    <div class="card-head"><h2>File paths</h2></div>
    <div class="form-grid">
      <div><label>Keystore</label><code class="addr">${escapeHtml(keystorePath())}</code></div>
      <div><label>Policy</label><code class="addr">${escapeHtml(policyPath())}</code></div>
      <div><label>Tracked tokens</label><code class="addr">${escapeHtml(tokensPath())}</code></div>
      <div><label>Custom chains</label><code class="addr">${escapeHtml(customChainsPath())}</code></div>
      <div><label>Activity log</label><code class="addr">${escapeHtml(activityPath())}</code></div>
    </div>
    <p class="help">All files are written with 0600 perms in a 0700 directory. Backups are written with the same perms on every save.</p>
  </div>
  <div class="card">
    <div class="card-head"><h2>Security</h2></div>
    <ul style="padding-left:18px; font-size:13px; line-height:1.7">
      <li>Server bound to <code>127.0.0.1</code> only — never network-exposed.</li>
      <li>Login required (admin token, rotated every restart).</li>
      <li>Session cookie HttpOnly + SameSite=Strict + 1h sliding TTL.</li>
      <li>Origin + Referer check on every POST (CSRF defense).</li>
      <li>Policy edits validated against a strict schema before atomic write.</li>
      <li>Keystore: AES-256-GCM + scrypt KDF. Passphrase only in env, never echoed.</li>
      <li>No MCP tool can write the policy file — only this localhost UI can. The LLM has no HTTP-issuing tool that could reach localhost.</li>
    </ul>
  </div>
  <div class="card">
    <div class="card-head"><h2>Session</h2></div>
    <p>Session expires after 1h of inactivity. <a href="/logout" style="color:#58a6ff">Logout now</a>.</p>
  </div>
</section>

<footer>ChainGPT Claude Skill agent-wallet · digest ${escapeHtml(o.digest)} · session 1h sliding TTL</footer>

<script>${DASHBOARD_JS}</script>
</body></html>`;
}

export async function handleAgentWalletTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  args ??= {};

  try {
    // ── init ────────────────────────────────────────────────────────
    if (name === 'chaingpt_agent_wallet_init') {
      const { address, path, passphraseSource } = initKeystore();
      const sourceLine = passphraseSource === 'keychain'
        ? [
            `Passphrase: auto-generated + stored in your OS keychain (${describeSecretSource('keychain')}).`,
            `            You don't need to remember or type it — the MCP server reads it from the keychain.`,
            `            ⚠ It is the ONLY way to decrypt this key. If you wipe the keychain entry`,
            `            without a backup, the wallet's funds become unrecoverable. To export it for`,
            `            backup on macOS:  security find-generic-password -s chaingpt-mcp-agent-wallet -a keystore-passphrase -w`,
          ]
        : [
            `Passphrase: from CHAINGPT_AGENT_WALLET_PASSPHRASE (env var).`,
            `            This is the ONLY way to decrypt the key. Lose it and the funds are unrecoverable.`,
          ];
      return {
        content: [{
          type: 'text',
          text: [
            `✓ Agent wallet initialized.`,
            ``,
            `Address:    ${address}`,
            `Keystore:   ${path}  (encrypted, 0600)`,
            ...sourceLine,
            ``,
            `IMPORTANT:`,
            `  1. Back up the keystore file. If the disk dies, you need both the file AND the passphrase.`,
            `  2. The default policy at ${policyPath()} is "Balanced DeFi" (killSwitch OFF) — the agent`,
            `     can swap on OpenOcean/1inch, lend on Aave, stake on Lido up to 0.1 native per tx.`,
            `     Open the dashboard or edit the policy file to tighten/widen before funding.`,
            ``,
            `Next: chaingpt_agent_wallet_policy to see the current rules, or open the admin UI to edit them.`,
          ].join('\n'),
        }],
      };
    }

    // ── address ─────────────────────────────────────────────────────
    if (name === 'chaingpt_agent_wallet_address') {
      const file = readKeystoreFile();
      if (!file) {
        return { content: [{ type: 'text', text: `Agent wallet not initialized. Call chaingpt_agent_wallet_init first.` }] };
      }
      return { content: [{ type: 'text', text: `Agent wallet address: ${file.address}` }] };
    }

    // ── status ──────────────────────────────────────────────────────
    if (name === 'chaingpt_agent_wallet_status') {
      const file = readKeystoreFile();
      const policy = loadPolicy();
      const digest = policyDigest(policy);
      const lines: string[] = [];
      lines.push(`Agent wallet status`);
      lines.push(``);
      if (!file) {
        lines.push(`Keystore:        NOT INITIALIZED — run chaingpt_agent_wallet_init`);
      } else {
        lines.push(`Address:         ${file.address}`);
        lines.push(`Keystore path:   ${keystorePath()}`);
        lines.push(`Keystore cipher: ${file.cipher} / kdf=${file.kdf} N=${file.kdfN}`);
        lines.push(`Created:         ${file.createdAt}`);
      }
      lines.push(``);
      lines.push(`Policy digest:   ${digest}`);
      lines.push(`Policy path:     ${policyPath()}`);
      lines.push(`Kill switch:     ${policy.killSwitch ? 'ON (refuses every signing op)' : 'off'}`);
      if (policy.allowedChains?.length) lines.push(`Allowed chains:  ${policy.allowedChains.join(', ')}`);
      if (policy.allowedToAddresses?.length) lines.push(`Allowed to:      ${policy.allowedToAddresses.length} addresses`);
      if (policy.blockedToAddresses?.length) lines.push(`Blocked to:      ${policy.blockedToAddresses.length} addresses`);
      if (policy.maxTxValueWei) lines.push(`Max value/tx:    ${policy.maxTxValueWei} wei (${fmtEth(BigInt(policy.maxTxValueWei))} native)`);
      if (policy.requireMemo) lines.push(`Memo required:   yes`);
      lines.push(``);
      {
        const src = passphraseSource();
        // Keep the legacy "Passphrase env:" line so existing tooling/tests that grep it still work.
        lines.push(`Passphrase env:  ${process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE ? 'set' : 'not set'}`);
        lines.push(`Passphrase src:  ${src === 'none' ? 'NONE — signing will fail. Set CHAINGPT_AGENT_WALLET_PASSPHRASE or re-init on a host with an OS keychain.' : describeSecretSource(src)}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── balances ────────────────────────────────────────────────────
    if (name === 'chaingpt_agent_wallet_balances') {
      const file = readKeystoreFile();
      if (!file) {
        return { content: [{ type: 'text', text: `Agent wallet not initialized. Call chaingpt_agent_wallet_init first.` }] };
      }
      const chains = Array.isArray(args.chains) && (args.chains as string[]).length > 0
        ? (args.chains as string[])
        : ['ethereum', 'base', 'arbitrum'];
      const lines: string[] = [`Agent wallet balances — ${file.address}`, ''];
      for (const c of chains) {
        const chain = resolveChainWithCustom(c);
        if (!chain) { lines.push(`  ${c}: unknown chain`); continue; }
        try {
          const bal = await getNativeBalance(c, file.address);
          lines.push(`  ${chain.name.padEnd(20)} ${fmtEth(bal)} ${chain.native}`);
        } catch (e: any) {
          lines.push(`  ${chain.name.padEnd(20)} (RPC error: ${e?.message ?? e})`);
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── policy ──────────────────────────────────────────────────────
    if (name === 'chaingpt_agent_wallet_policy') {
      const policy = loadPolicy();
      const digest = policyDigest(policy);
      const lines = [
        `Active policy — digest ${digest}`,
        `File:    ${policyPath()}`,
        ``,
        JSON.stringify(policy, null, 2),
        ``,
        `To modify: edit the file above with your text editor. There is NO MCP tool that writes this file —`,
        `that is by design (the agent cannot be prompt-injected into relaxing its own constraints).`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── sign_and_send ───────────────────────────────────────────────
    if (name === 'chaingpt_agent_wallet_sign_and_send') {
      if (!isKeystoreInitialized()) {
        return { content: [{ type: 'text', text: `Agent wallet not initialized. Call chaingpt_agent_wallet_init first.` }] };
      }
      const chainSlug = String(args.chain);
      const chain = resolveChainWithCustom(chainSlug);
      if (!chain?.chainId) {
        return { content: [{ type: 'text', text: `Unknown or non-EVM chain: ${chainSlug}` }] };
      }
      const to = String(args.to);
      if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
        return { content: [{ type: 'text', text: `Invalid to-address: ${to}` }] };
      }
      const valueWei = BigInt(String(args.valueWei ?? '0'));
      const data = String(args.data ?? '0x');
      const memo = args.memo ? String(args.memo) : undefined;
      const gasLimitStr = args.gasLimit ? String(args.gasLimit) : undefined;

      const intent: TxIntent = {
        chainId: chain.chainId,
        to,
        value: valueWei,
        data,
        gas: gasLimitStr ? BigInt(gasLimitStr) : undefined,
        memo,
      };

      const policy = loadPolicy();
      // Velocity caps need the rolling 24h window from the activity ledger.
      // checkPolicy fails closed if a cap is set and these stats are absent/unreadable.
      const decision = checkPolicy(intent, policy, spendStats(24));
      if (!decision.allowed) {
        return {
          content: [{
            type: 'text',
            text: [
              `⛔ Policy refused this transaction.`,
              ``,
              `Reason:        ${decision.reason}`,
              `Policy digest: ${decision.policyDigest}`,
              `Policy file:   ${policyPath()}`,
              ``,
              `If this refusal is wrong, an admin must edit the policy file with a text editor.`,
              `No MCP tool can relax these rules from inside the agent.`,
            ].join('\n'),
          }],
        };
      }

      // Decrypt the key, sign, send. The plaintext key never leaves this scope.
      let account;
      try { account = loadAccount(); }
      catch (e: any) { return { content: [{ type: 'text', text: `Keystore load failed: ${e?.message ?? e}` }] }; }

      const endpoints = rpcEndpointsWithCustom(chainSlug);
      if (endpoints.length === 0) {
        return { content: [{ type: 'text', text: `No RPC endpoints configured for ${chainSlug}` }] };
      }

      // Try each RPC endpoint in order — single RPC outage should NOT cause
      // an avoidable failure when fallback URLs are configured.
      let hash: Hex | null = null;
      let lastError: unknown = null;
      for (const rpc of endpoints) {
        try {
          const wallet = createWalletClient({ account, transport: viemHttp(rpc) });
          hash = await wallet.sendTransaction({
            chain: {
              id: chain.chainId,
              name: chain.name,
              nativeCurrency: { name: chain.native, symbol: chain.native, decimals: 18 },
              rpcUrls: { default: { http: [rpc] } },
            } as any,
            to: to as Hex,
            value: valueWei,
            data: data as Hex,
            gas: intent.gas,
            account,
          });
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (!hash) {
        const e = lastError as any;
        return {
          content: [{
            type: 'text',
            text: `Broadcast failed across ${endpoints.length} RPC endpoint(s): ${e?.shortMessage ?? e?.message ?? String(e)}`,
          }],
        };
      }

      // Log to activity feed for the dashboard
      try {
        logActivity({
          ts: new Date().toISOString(),
          chain: chainSlug,
          chainId: chain.chainId,
          from: account.address,
          to,
          valueWei: valueWei.toString(),
          hash,
          memo,
          policyDigest: decision.policyDigest,
        });
      } catch { /* best-effort */ }

      const explorer = chain.explorer ? `${chain.explorer}/tx/${hash}` : '(no explorer configured)';
      return {
        content: [{
          type: 'text',
          text: [
            `✓ Transaction broadcast.`,
            ``,
            `Hash:           ${hash}`,
            `Chain:          ${chain.name}`,
            `From:           ${account.address}`,
            `To:             ${to}`,
            `Value:          ${valueWei} wei (${fmtEth(valueWei)} ${chain.native})`,
            `Memo:           ${memo ?? '(none)'}`,
            `Explorer:       ${explorer}`,
            ``,
            `Policy digest at sign time: ${decision.policyDigest}`,
          ].join('\n'),
        }],
      };
    }

    // ── serve_ui ────────────────────────────────────────────────────
    if (name === 'chaingpt_agent_wallet_serve_ui') {
      const file = readKeystoreFile();
      if (!file) {
        return { content: [{ type: 'text', text: `Agent wallet not initialized. Call chaingpt_agent_wallet_init first.` }] };
      }
      const port = Number(args.port ?? 8787);
      const chains = Array.isArray(args.chains) && (args.chains as string[]).length > 0
        ? (args.chains as string[])
        : ['ethereum', 'base', 'arbitrum'];

      // Stop any existing server so re-calling on the same port works
      if (runningServer) {
        try { runningServer.close(); } catch { /* ignore */ }
        runningServer = null;
      }

      // Rotate admin token on every (re)start, persist to a 0600 file so the
      // admin can recover it without re-running the tool
      adminToken = generateToken();
      sessions.clear();
      try {
        const tokenPath = adminTokenPath();
        mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
        writeFileSync(tokenPath, adminToken, { mode: 0o600 });
      } catch { /* best-effort */ }

      const handler = async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!checkHost(req, port)) {
            res.writeHead(421, { 'content-type': 'text/plain' });
            res.end('Host check failed (DNS-rebinding defense). Use http://127.0.0.1:' + port);
            return;
          }
          const url = req.url || '/';
          const method = (req.method || 'GET').toUpperCase();

          // ── POST /login ─────────────────────────────────────────────
          if (method === 'POST' && url === '/login') {
            if (!checkOrigin(req, port)) {
              res.writeHead(403, { 'content-type': 'text/plain' });
              res.end('Origin check failed');
              return;
            }
            const body = await readBody(req);
            const fields = parseFormBody(body);
            const submitted = fields.token ?? '';
            if (!adminToken || !timingSafeStrEqual(submitted, adminToken)) {
              res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
              res.end(loginHtml('Invalid admin token.'));
              return;
            }
            const sid = createSession();
            res.writeHead(302, {
              'set-cookie': `cg_admin_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
              'location': '/dashboard',
            });
            res.end();
            return;
          }

          // ── GET /logout ─────────────────────────────────────────────
          if (url === '/logout') {
            const sid = parseCookies(req.headers.cookie).cg_admin_sid;
            if (sid) sessions.delete(sid);
            res.writeHead(302, {
              'set-cookie': `cg_admin_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
              'location': '/',
            });
            res.end();
            return;
          }

          // ── Auth gate for everything below ──────────────────────────
          const authed = checkSession(req);
          if (!authed) {
            // Unauthed → either show login (GET /) or redirect
            if (method === 'GET' && (url === '/' || url === '/dashboard')) {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
              res.end(loginHtml(null));
              return;
            }
            res.writeHead(401, { 'content-type': 'text/plain' });
            res.end('Authentication required. Visit / to log in.');
            return;
          }

          // ── POST /api/policy ────────────────────────────────────────
          if (method === 'POST' && url === '/api/policy') {
            if (!checkOrigin(req, port)) {
              res.writeHead(403, { 'content-type': 'text/plain' });
              res.end('Origin check failed');
              return;
            }
            const body = await readBody(req);
            const fields = parseFormBody(body);
            const policyJson = fields.policy ?? '';
            let parsed: unknown;
            try { parsed = JSON.parse(policyJson); }
            catch (e: any) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Invalid JSON: ${e?.message ?? e}` });
              return;
            }
            const validation = validatePolicyInput(parsed);
            if (!validation.ok || !validation.policy) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Policy rejected: ${validation.error}` });
              return;
            }
            try {
              const { digest, path } = savePolicy(validation.policy);
              renderDashboard(res, file.address, chains, { kind: 'ok', msg: `Saved. New digest ${digest}. Backup at ${path}.bak.` });
            } catch (e: any) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Save failed: ${e?.message ?? e}` });
            }
            return;
          }

          // ── POST /api/killswitch ────────────────────────────────────
          if (method === 'POST' && url === '/api/killswitch') {
            if (!checkOrigin(req, port)) {
              res.writeHead(403, { 'content-type': 'text/plain' });
              res.end('Origin check failed');
              return;
            }
            const body = await readBody(req);
            const fields = parseFormBody(body);
            const set = fields.set === 'on';
            const current = loadPolicy();
            const newPolicy = { ...current, killSwitch: set };
            const validation = validatePolicyInput(newPolicy);
            if (!validation.ok || !validation.policy) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Could not toggle: ${validation.error}` });
              return;
            }
            try {
              const { digest } = savePolicy(validation.policy);
              renderDashboard(res, file.address, chains, {
                kind: 'ok',
                msg: `Kill switch ${set ? 'ENGAGED' : 'disabled'}. New digest ${digest}.`,
              });
            } catch (e: any) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Save failed: ${e?.message ?? e}` });
            }
            return;
          }

          // ── POST /api/policy/template (apply a preset) ──────────────
          // When called via fetch (x-requested-with: fetch), returns JSON so the
          // dashboard can update the policy form IN PLACE without a page reload.
          // Falls back to a full re-render for the no-JS / form-submit path.
          if (method === 'POST' && url === '/api/policy/template') {
            if (!checkOrigin(req, port)) { res.writeHead(403); res.end('Origin check failed'); return; }
            const wantsJson = (req.headers['x-requested-with'] === 'fetch');
            const body = await readBody(req);
            const fields = parseFormBody(body);
            const tmpl = findTemplate(fields.template ?? '');
            if (!tmpl) {
              if (wantsJson) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: `Unknown template: ${fields.template}` })); return; }
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Unknown template: ${fields.template}` });
              return;
            }
            const validation = validatePolicyInput({ ...tmpl.policy, updatedAt: new Date().toISOString() });
            if (!validation.ok || !validation.policy) {
              if (wantsJson) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: `Template invalid: ${validation.error}` })); return; }
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Template invalid: ${validation.error}` });
              return;
            }
            try {
              const { digest } = savePolicy(validation.policy);
              if (wantsJson) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, name: tmpl.name, emoji: tmpl.emoji, digest, policy: validation.policy }));
                return;
              }
              renderDashboard(res, file.address, chains, { kind: 'ok', msg: `Applied template "${tmpl.name}" ${tmpl.emoji}. New digest ${digest}.` });
            } catch (e: any) {
              if (wantsJson) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: `Save failed: ${e?.message ?? e}` })); return; }
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Save failed: ${e?.message ?? e}` });
            }
            return;
          }

          // ── POST /api/scan-bluechips ────────────────────────────────
          // Scans the curated blue-chip registry for tokens the agent already
          // holds and auto-adds them to the tracked list. Spam-token defense:
          // only addresses in the static allowlist are eligible.
          if (method === 'POST' && url === '/api/scan-bluechips') {
            if (!checkOrigin(req, port)) { res.writeHead(403); res.end('Origin check failed'); return; }
            const existing = loadTrackedTokens();
            const key = (chain: string, addr: string) => `${chain}:${addr.toLowerCase()}`;
            const have = new Set(existing.map((t) => key(t.chain, t.address)));
            let added = 0;
            const scanned: string[] = [];
            for (const [chain, tokens] of Object.entries(BLUE_CHIPS)) {
              if (!resolveChainWithCustom(chain)) continue;
              for (const tok of tokens) {
                if (have.has(key(chain, tok.address))) continue;
                try {
                  const bal = await fetchErc20Balance(chain, tok.address, file.address);
                  if (bal > 0n) {
                    addTrackedToken({ chain, address: tok.address, symbol: tok.symbol, decimals: tok.decimals, label: tok.label });
                    have.add(key(chain, tok.address));
                    added++;
                    scanned.push(`${tok.symbol} on ${chain}`);
                  }
                } catch { /* skip RPC errors */ }
              }
            }
            const msg = added === 0
              ? 'Scan complete — no untracked blue-chip balances found.'
              : `Scan complete — added ${added} token${added === 1 ? '' : 's'}: ${scanned.join(', ')}.`;
            renderDashboard(res, file.address, chains, { kind: 'ok', msg });
            return;
          }

          // ── POST /api/chains/add ────────────────────────────────────
          if (method === 'POST' && url === '/api/chains/add') {
            if (!checkOrigin(req, port)) { res.writeHead(403); res.end('Origin check failed'); return; }
            const body = await readBody(req);
            const fields = parseFormBody(body);
            const result = addCustomChain({
              slug: (fields.slug ?? '').toLowerCase().trim(),
              chainId: Number(fields.chainId ?? 0),
              name: (fields.name ?? '').trim(),
              native: (fields.native ?? '').trim().toUpperCase(),
              rpcUrl: (fields.rpcUrl ?? '').trim(),
              rpcFallbacks: fields.rpcFallbacks
                ? fields.rpcFallbacks.split(',').map((s) => s.trim()).filter(Boolean)
                : undefined,
              explorer: fields.explorer?.trim() || undefined,
            });
            if (!result.ok) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Custom chain rejected: ${result.error}` });
              return;
            }
            renderDashboard(res, file.address, chains, { kind: 'ok', msg: `Custom chain "${fields.slug}" added (chainId ${fields.chainId}).` });
            return;
          }

          // ── POST /api/chains/remove ─────────────────────────────────
          if (method === 'POST' && url === '/api/chains/remove') {
            if (!checkOrigin(req, port)) { res.writeHead(403); res.end('Origin check failed'); return; }
            const body = await readBody(req);
            const fields = parseFormBody(body);
            try {
              removeCustomChain(fields.slug ?? '');
              renderDashboard(res, file.address, chains, { kind: 'ok', msg: `Custom chain "${fields.slug}" removed.` });
            } catch (e: any) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Remove failed: ${e?.message ?? e}` });
            }
            return;
          }

          // ── GET /api/chains ─────────────────────────────────────────
          if (url === '/api/chains') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              builtIn: Object.values(CHAINS).filter((c) => c.chainId !== null).map((c) => ({ slug: c.slug, chainId: c.chainId, name: c.name, native: c.native })),
              custom: loadCustomChains(),
            }, null, 2));
            return;
          }

          // ── POST /api/tokens/add ────────────────────────────────────
          if (method === 'POST' && url === '/api/tokens/add') {
            if (!checkOrigin(req, port)) { res.writeHead(403); res.end('Origin check failed'); return; }
            const body = await readBody(req);
            const fields = parseFormBody(body);
            const chainSlug = fields.chain ?? '';
            const tokenAddr = (fields.address ?? '').toLowerCase();
            const label = fields.label?.trim() || undefined;
            if (!resolveChainWithCustom(chainSlug)) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Unknown chain: ${chainSlug}` });
              return;
            }
            if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddr)) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Invalid token address: ${tokenAddr}` });
              return;
            }
            try {
              const meta = await fetchErc20Meta(chainSlug, tokenAddr);
              if (!meta.symbol) {
                renderDashboard(res, file.address, chains, { kind: 'err', msg: `Could not fetch symbol for ${tokenAddr} on ${chainSlug} — is it really an ERC-20?` });
                return;
              }
              addTrackedToken({ chain: chainSlug, address: tokenAddr, symbol: meta.symbol, decimals: meta.decimals, label });
              renderDashboard(res, file.address, chains, { kind: 'ok', msg: `Now tracking ${meta.symbol} on ${chainSlug}.` });
            } catch (e: any) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Add failed: ${e?.message ?? e}` });
            }
            return;
          }

          // ── POST /api/tokens/remove ─────────────────────────────────
          if (method === 'POST' && url === '/api/tokens/remove') {
            if (!checkOrigin(req, port)) { res.writeHead(403); res.end('Origin check failed'); return; }
            const body = await readBody(req);
            const fields = parseFormBody(body);
            try {
              removeTrackedToken(fields.chain ?? '', fields.address ?? '');
              renderDashboard(res, file.address, chains, { kind: 'ok', msg: `Stopped tracking ${fields.address} on ${fields.chain}.` });
            } catch (e: any) {
              renderDashboard(res, file.address, chains, { kind: 'err', msg: `Remove failed: ${e?.message ?? e}` });
            }
            return;
          }

          // ── GET /api/tokens ─────────────────────────────────────────
          if (url === '/api/tokens') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(loadTrackedTokens(), null, 2));
            return;
          }

          // ── GET /api/activity ───────────────────────────────────────
          if (url === '/api/activity') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(readActivity(50), null, 2));
            return;
          }

          // ── GET /api/templates ──────────────────────────────────────
          if (url === '/api/templates') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(POLICY_TEMPLATES.map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, description: t.description })), null, 2));
            return;
          }

          // ── GET /api/policy ─────────────────────────────────────────
          if (url === '/api/policy') {
            const policy = loadPolicy();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ policy, digest: policyDigest(policy) }, null, 2));
            return;
          }

          // ── GET /api/status ─────────────────────────────────────────
          if (url.startsWith('/api/status')) {
            const balances: Record<string, string> = {};
            for (const c of chains) {
              try { balances[c] = (await getNativeBalance(c, file.address)).toString(); }
              catch { balances[c] = 'error'; }
            }
            const policy = loadPolicy();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ address: file.address, balances, policyDigest: policyDigest(policy) }));
            return;
          }

          // ── GET / or /dashboard ─────────────────────────────────────
          if (method === 'GET' && (url === '/' || url === '/dashboard')) {
            await renderDashboard(res, file.address, chains, null);
            return;
          }

          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Not found');
        } catch (e: any) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(`Server error: ${e?.message ?? e}`);
        }
      };

      const server = createServer(handler);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
      runningServer = server;
      runningPort = port;

      const url = `http://127.0.0.1:${port}/`;
      return {
        content: [{
          type: 'text',
          text: [
            `✓ Agent wallet admin dashboard running at ${url}`,
            ``,
            `╔═════════════════════════════════════════════════════════════╗`,
            `║  ADMIN TOKEN (paste once at /login)                         ║`,
            `║                                                             ║`,
            `║  ${adminToken}  ║`,
            `║                                                             ║`,
            `║  Also saved to ${adminTokenPath()}`,
            `╚═════════════════════════════════════════════════════════════╝`,
            ``,
            `What the dashboard does:`,
            `  • Address + QR code for receiving funds`,
            `  • Live multi-chain native balances`,
            `  • Active policy + digest`,
            `  • Edit the policy JSON inline (validated server-side, atomic write + .bak)`,
            `  • One-click kill switch toggle`,
            ``,
            `Security:`,
            `  • Bound to 127.0.0.1 only — not exposed on the network`,
            `  • Login required (admin token rotated on every restart)`,
            `  • Session cookie HttpOnly + SameSite=Strict + 1h sliding TTL`,
            `  • Origin + Referer check on every POST`,
            `  • Policy edits validated against a strict schema`,
            ``,
            `Open ${url} in a browser.`,
            `To stop: kill the MCP server process or re-call this tool with a different port.`,
          ].join('\n'),
        }],
      };
    }

    return { content: [{ type: 'text', text: `Unknown agent-wallet tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Agent wallet error: ${message}` }] };
  }
}

// Exported for tests
export function _stopUiForTests() {
  if (runningServer) { runningServer.close(); runningServer = null; runningPort = null; }
}
export function _runningUiPort() { return runningPort; }
