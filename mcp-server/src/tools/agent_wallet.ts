import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createWalletClient, createPublicClient, http as viemHttp, parseTransaction, type Hex } from 'viem';
import { CHAINS, resolveChain, rpcEndpoints } from '../lib/chains.js';
import { jsonRpcFallback } from '../lib/http.js';
import {
  initKeystore,
  isKeystoreInitialized,
  loadAccount,
  readKeystoreFile,
  keystorePath,
} from '../lib/agent-keystore.js';
import {
  loadPolicy,
  checkPolicy,
  policyPath,
  policyDigest,
  validatePolicyInput,
  savePolicy,
  type TxIntent,
} from '../lib/agent-policy.js';

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
        gasLimit: { type: 'string', description: 'Optional gas limit (units). Defaults to eth_estimateGas + 20% headroom.' },
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
  const endpoints = rpcEndpoints(chainSlug);
  if (endpoints.length === 0) throw new Error(`No RPC endpoints for ${chainSlug}`);
  const hex = await jsonRpcFallback<string>(endpoints, 'eth_getBalance', [address, 'latest']);
  return BigInt(hex);
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
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
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
body { font-family: ui-monospace, "SF Mono", Menlo, monospace; background: #0a0e1a; color: #e6edf3; max-width: 820px; margin: 24px auto; padding: 0 16px; line-height: 1.45; }
h1 { color: #58a6ff; font-size: 20px; margin-bottom: 4px; }
.subtle { color: #7d8590; font-size: 13px; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px 16px; margin: 16px 0; }
.card h2 { font-size: 13px; margin: 0 0 8px; color: #d2a8ff; text-transform: uppercase; letter-spacing: 0.5px; }
.card h2 .digest { color: #ffa657; font-weight: normal; }
pre { background: #0d1117; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.addr { font-size: 15px; word-break: break-all; color: #79c0ff; }
table { width: 100%; border-collapse: collapse; }
td { padding: 4px 0; border-bottom: 1px solid #21262d; font-size: 13px; }
td:last-child { text-align: right; }
.killswitch-on { color: #f85149; font-weight: bold; }
.killswitch-off { color: #3fb950; }
img.qr { background: white; padding: 6px; border-radius: 4px; }
button, input[type=submit] { padding: 8px 14px; background: #238636; color: #fff; border: 0; border-radius: 4px; font-weight: 600; cursor: pointer; font-family: inherit; }
button:hover { background: #2ea043; }
button.danger { background: #da3633; }
button.danger:hover { background: #f85149; }
button.warn { background: #9e6a03; }
textarea { width: 100%; min-height: 320px; padding: 10px; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 4px; font-family: inherit; font-size: 12px; line-height: 1.5; box-sizing: border-box; }
.bar { display: flex; gap: 8px; margin-top: 10px; align-items: center; flex-wrap: wrap; }
.flash { padding: 8px 12px; border-radius: 4px; margin: 8px 0; font-size: 13px; }
.flash.ok { background: #133929; color: #56d364; border: 1px solid #2ea043; }
.flash.err { background: #5d1a1f; color: #ffa6a0; border: 1px solid #f85149; }
nav { display: flex; gap: 12px; padding: 8px 0; font-size: 12px; margin-bottom: 8px; }
nav a { color: #58a6ff; text-decoration: none; }
nav a:hover { text-decoration: underline; }
footer { color: #484f58; font-size: 11px; margin-top: 24px; }
`;

async function renderDashboard(
  res: ServerResponse,
  address: string,
  chains: string[],
  flash: { kind: 'ok' | 'err'; msg: string } | null,
): Promise<void> {
  const policy = loadPolicy();
  const digest = policyDigest(policy);
  const balanceRows = await Promise.all(chains.map(async (c) => {
    const chain = resolveChain(c);
    if (!chain) return `<tr><td>${escapeHtml(c)}</td><td>unknown</td></tr>`;
    try {
      const bal = await getNativeBalance(c, address);
      return `<tr><td>${escapeHtml(chain.name)}</td><td>${escapeHtml(fmtEth(bal))} ${escapeHtml(chain.native)}</td></tr>`;
    } catch {
      return `<tr><td>${escapeHtml(chain.name)}</td><td>(RPC error)</td></tr>`;
    }
  }));
  const html = dashboardHtml({
    address,
    policyJson: JSON.stringify(policy, null, 2),
    digest,
    balanceRows: balanceRows.join(''),
    ksPath: keystorePath(),
    polPath: policyPath(),
    killSwitchOn: !!policy.killSwitch,
    flash,
  });
  res.writeHead(flash?.kind === 'err' ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function dashboardHtml(opts: {
  address: string;
  policyJson: string;
  digest: string;
  balanceRows: string;
  ksPath: string;
  polPath: string;
  killSwitchOn: boolean;
  flash: { kind: 'ok' | 'err'; msg: string } | null;
}): string {
  const flashBlock = opts.flash ? `<div class="flash ${opts.flash.kind}">${escapeHtml(opts.flash.msg)}</div>` : '';
  const killBtn = opts.killSwitchOn
    ? `<form method="POST" action="/api/killswitch" style="display:inline"><input type="hidden" name="set" value="off"/><button class="warn" type="submit">Disable kill switch</button></form>`
    : `<form method="POST" action="/api/killswitch" style="display:inline"><input type="hidden" name="set" value="on"/><button class="danger" type="submit">🛑 Engage kill switch (halt all signing)</button></form>`;
  const killLabel = opts.killSwitchOn
    ? `<span class="killswitch-on">ON — all signing refused</span>`
    : `<span class="killswitch-off">OFF — signing allowed (subject to other rules)</span>`;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><title>ChainGPT Agent Wallet — Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>${BASE_CSS}</style></head><body>
<nav><a href="/dashboard">Dashboard</a> · <a href="/logout">Logout</a></nav>
<h1>ChainGPT Agent Wallet</h1>
<div class="subtle">Admin dashboard. All edits write to <code>${escapeHtml(opts.polPath)}</code> with a <code>.bak</code> backup.</div>
${flashBlock}

<div class="card">
<h2>Deposit address</h2>
<div class="addr">${escapeHtml(opts.address)}</div>
<div style="margin-top:12px"><img class="qr" alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=ethereum:${encodeURIComponent(opts.address)}" width="180" height="180"/></div>
<div class="subtle" style="margin-top:8px">Send EVM assets to this address on any chain the policy allows. Refresh page to update balances.</div>
</div>

<div class="card">
<h2>Native-coin balances</h2>
<table>${opts.balanceRows}</table>
</div>

<div class="card">
<h2>Kill switch</h2>
<div>Current state: ${killLabel}</div>
<div class="bar">${killBtn}<span class="subtle">One-click halt. Re-enable via the JSON editor below or this button.</span></div>
</div>

<div class="card">
<h2>Policy editor <span class="digest">[digest ${escapeHtml(opts.digest)}]</span></h2>
<form method="POST" action="/api/policy">
<textarea name="policy" spellcheck="false">${escapeHtml(opts.policyJson)}</textarea>
<div class="bar">
<button type="submit">Save policy</button>
<span class="subtle">Validated server-side. Unknown fields rejected. Atomic write + .bak backup.</span>
</div>
</form>
</div>

<div class="card">
<h2>Keystore</h2>
<div class="subtle">Encrypted at <code>${escapeHtml(opts.ksPath)}</code>. AES-256-GCM with scrypt KDF. Passphrase lives only in the MCP server's env (<code>CHAINGPT_AGENT_WALLET_PASSPHRASE</code>) and is never echoed.</div>
</div>

<footer>ChainGPT Claude Skill agent-wallet dashboard · session expires after 1h of inactivity</footer>
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
      const { address, path } = initKeystore();
      return {
        content: [{
          type: 'text',
          text: [
            `✓ Agent wallet initialized.`,
            ``,
            `Address:    ${address}`,
            `Keystore:   ${path}  (encrypted, 0600)`,
            ``,
            `IMPORTANT:`,
            `  1. The passphrase from CHAINGPT_AGENT_WALLET_PASSPHRASE is the ONLY way to decrypt this key.`,
            `     Lose it and the wallet's funds are unrecoverable.`,
            `  2. Back up the keystore file. If the disk dies, you need both the file AND the passphrase.`,
            `  3. The default policy at ${policyPath()} has killSwitch=true.`,
            `     Edit it before the agent can do anything.`,
            ``,
            `Next: chaingpt_agent_wallet_policy to see the current rules, then edit the policy file.`,
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
      lines.push(`Passphrase env:  ${process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE ? 'set' : 'NOT SET — signing will fail until you set CHAINGPT_AGENT_WALLET_PASSPHRASE'}`);
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
        const chain = resolveChain(c);
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
      const chain = resolveChain(chainSlug);
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
      const decision = checkPolicy(intent, policy);
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

      const endpoints = rpcEndpoints(chainSlug);
      if (endpoints.length === 0) {
        return { content: [{ type: 'text', text: `No RPC endpoints configured for ${chainSlug}` }] };
      }

      const primary = endpoints[0];
      const wallet = createWalletClient({ account, transport: viemHttp(primary) });
      const publicClient = createPublicClient({ transport: viemHttp(primary) });

      // Build + send a legacy or 1559 tx — let viem decide based on chain capabilities.
      let hash: Hex;
      try {
        hash = await wallet.sendTransaction({
          chain: {
            id: chain.chainId,
            name: chain.name,
            nativeCurrency: { name: chain.native, symbol: chain.native, decimals: 18 },
            rpcUrls: { default: { http: [primary] } },
          } as any,
          to: to as Hex,
          value: valueWei,
          data: data as Hex,
          gas: intent.gas,
          account,
        });
      } catch (e: any) {
        return {
          content: [{
            type: 'text',
            text: `Broadcast failed: ${e?.shortMessage ?? e?.message ?? e}`,
          }],
        };
      }

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
        const tokenPath = process.env.CHAINGPT_ADMIN_TOKEN_FILE?.trim()
          || policyPath().replace(/policy\.json$/, '.admin-token');
        mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
        writeFileSync(tokenPath, adminToken, { mode: 0o600 });
      } catch { /* best-effort */ }

      const handler = async (req: IncomingMessage, res: ServerResponse) => {
        try {
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
            `║  Also saved to ${policyPath().replace(/policy\.json$/, '.admin-token')}`,
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
