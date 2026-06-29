import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readUsage } from '../lib/usage.js';
/**
 * chaingpt_dashboard_serve — Marketplace-wide localhost dashboard.
 *
 * A separate, self-contained HTTP server with its own admin token, sessions
 * and CSRF model. It does NOT depend on the agent-wallet keystore being
 * initialized: a user who has only ever called `chaingpt_chat` or
 * `chaingpt_research_*` can still open the dashboard.
 *
 * Bind: 127.0.0.1 only. Default port 8788 (distinct from agent-wallet's 8787
 * so the two can coexist).
 *
 * Read-only by design. Signing flows stay in MCP tool calls — never proxied
 * through the browser.
 */
const PLUGIN_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const MCP_SERVER_PKG_JSON = join(PLUGIN_ROOT, 'mcp-server', 'package.json');
const MARKETPLACE_JSON = join(PLUGIN_ROOT, '.claude-plugin', 'marketplace.json');
const PLUGIN_JSON = join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
const SKILLS_DIR = join(PLUGIN_ROOT, 'skills');
const CHANGELOG_PATH = join(PLUGIN_ROOT, 'CHANGELOG.md');
const DASHBOARD_DIR = process.env.CHAINGPT_DASHBOARD_DIR?.trim()
    || join(homedir(), '.chaingpt-mcp', 'dashboard');
const ADMIN_TOKEN_PATH = join(DASHBOARD_DIR, '.admin-token');
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const COOKIE = 'cg_dash_sid';
export const dashboardTools = [
    {
        name: 'chaingpt_dashboard_serve',
        description: 'Boot the marketplace dashboard — a localhost web UI with five read-only panels (Overview, Skills, ' +
            'Activity, Health, About). Bind 127.0.0.1 only, admin-token auth, same-origin CSRF defense. ' +
            'Default port 8788. Returns the URL and admin token. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                port: { type: 'number', description: 'Port to bind. Default 8788.', default: 8788 },
            },
            required: [],
        },
    },
];
// ── State ──────────────────────────────────────────────────────────
let runningServer = null;
let runningPort = null;
let adminToken = null;
const sessions = new Map(); // sid -> expiry ms
// ── Helpers ────────────────────────────────────────────────────────
function generateToken() {
    return randomBytes(24).toString('hex'); // 48-char hex, 192 bits
}
function timingSafeStrEqual(a, b) {
    // Double-HMAC pattern: hash both inputs to a fixed length first so the
    // comparison leaks neither content nor LENGTH (a bare length pre-check is
    // a small timing oracle on how long the expected token is).
    const key = randomBytes(32);
    const ha = createHmac('sha256', key).update(a).digest();
    const hb = createHmac('sha256', key).update(b).digest();
    return timingSafeEqual(ha, hb);
}
function parseCookies(header) {
    if (!header)
        return {};
    const out = {};
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq <= 0)
            continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k)
            out[k] = v;
    }
    return out;
}
function checkSession(req) {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (!sid)
        return false;
    const exp = sessions.get(sid);
    if (!exp)
        return false;
    if (Date.now() > exp) {
        sessions.delete(sid);
        return false;
    }
    sessions.set(sid, Date.now() + SESSION_TTL_MS);
    return true;
}
function createSession() {
    const sid = generateToken();
    sessions.set(sid, Date.now() + SESSION_TTL_MS);
    return sid;
}
function checkHost(req, port) {
    // DNS-rebinding defense: a hostile page can rebind its domain to 127.0.0.1
    // and the victim browser will then reach this server with Host: attacker.tld.
    // Origin checks cover state-changing POSTs; this covers everything else.
    const host = req.headers.host ?? '';
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
function checkOrigin(req, port) {
    const origin = req.headers.origin;
    if (!origin) {
        const referer = req.headers.referer;
        if (!referer)
            return false;
        return referer.startsWith(`http://127.0.0.1:${port}/`)
            || referer.startsWith(`http://localhost:${port}/`);
    }
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}
async function readBody(req, maxBytes = 64 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (c) => {
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
function parseFormBody(body) {
    const out = {};
    for (const part of body.split('&')) {
        if (!part)
            continue;
        const eq = part.indexOf('=');
        if (eq < 0)
            continue;
        const k = decodeURIComponent(part.slice(0, eq));
        const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
        out[k] = v;
    }
    return out;
}
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function jsonResponse(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
}
function readJsonSafe(path) {
    try {
        if (!existsSync(path))
            return null;
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
function provisionAdminToken() {
    const tok = generateToken();
    mkdirSync(DASHBOARD_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(ADMIN_TOKEN_PATH, tok, { mode: 0o600 });
    return tok;
}
function readSkillFrontmatter(skillDir) {
    const skillFile = join(skillDir, 'SKILL.md');
    if (!existsSync(skillFile))
        return null;
    try {
        const raw = readFileSync(skillFile, 'utf8');
        if (!raw.startsWith('---'))
            return null;
        const end = raw.indexOf('\n---', 3);
        if (end < 0)
            return null;
        const fm = raw.slice(3, end);
        const out = {};
        // Minimal YAML: handle  key: "value" or  key: value (possibly multi-line via quoted strings)
        const lineRe = /^(\w[\w-]*)\s*:\s*("(?:[^"\\]|\\.)*"|[^\n]+)$/gm;
        let m;
        while ((m = lineRe.exec(fm)) !== null) {
            let v = m[2].trim();
            if (v.startsWith('"') && v.endsWith('"')) {
                v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
            out[m[1]] = v;
        }
        if (!out.name && !out.description)
            return null;
        return { name: out.name || '', description: out.description || '' };
    }
    catch {
        return null;
    }
}
function listSkills() {
    if (!existsSync(SKILLS_DIR))
        return [];
    const out = [];
    let entries = [];
    try {
        entries = readdirSync(SKILLS_DIR);
    }
    catch {
        return [];
    }
    for (const slug of entries.sort()) {
        const full = join(SKILLS_DIR, slug);
        try {
            if (!statSync(full).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        const fm = readSkillFrontmatter(full);
        if (!fm)
            continue;
        out.push({ slug, name: fm.name || slug, description: fm.description });
    }
    return out;
}
function readActivityRows(limit = 50) {
    const candidate = process.env.CHAINGPT_ACTIVITY_FILE?.trim()
        || join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'activity.jsonl');
    if (!existsSync(candidate))
        return [];
    try {
        const raw = readFileSync(candidate, 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim());
        const rows = [];
        for (const l of lines) {
            try {
                const p = JSON.parse(l);
                if (p && typeof p.hash === 'string') {
                    rows.push({
                        ts: String(p.ts || ''),
                        chain: String(p.chain || ''),
                        from: String(p.from || ''),
                        to: String(p.to || ''),
                        valueWei: String(p.valueWei || '0'),
                        hash: String(p.hash),
                        memo: p.memo ? String(p.memo) : undefined,
                    });
                }
            }
            catch { /* skip malformed */ }
        }
        rows.reverse();
        return rows.slice(0, limit);
    }
    catch {
        return [];
    }
}
// ── Agent wallet read-only inspection ─────────────────────────────
// The dashboard never decrypts the keystore — it only reads what's
// publicly readable on disk: the wallet address (stored in plain in the
// keystore JSON), the policy file, and the tracked-tokens list. Writes
// and decryption stay in the dedicated agent-wallet admin UI on port 8787.
const AGENT_WALLET_DIR = join(homedir(), '.chaingpt-mcp', 'agent-wallet');
const AGENT_KEYSTORE = join(AGENT_WALLET_DIR, 'keystore.json');
const AGENT_POLICY = join(AGENT_WALLET_DIR, 'policy.json');
const AGENT_TOKENS = join(AGENT_WALLET_DIR, 'tracked-tokens.json');
const AGENT_CUSTOM_CHAINS = join(AGENT_WALLET_DIR, 'custom-chains.json');
function getWallet() {
    const keystore = readJsonSafe(AGENT_KEYSTORE);
    const policy = readJsonSafe(AGENT_POLICY);
    const tokens = readJsonSafe(AGENT_TOKENS) ?? [];
    const chains = readJsonSafe(AGENT_CUSTOM_CHAINS) ?? [];
    const chains_ = policy?.allowedChains ?? [];
    const allowedAddr = policy?.allowedToAddresses ?? [];
    const blockedAddr = policy?.blockedToAddresses ?? [];
    // Digest = first 12 chars of a stable JSON hash, surfaced so the user can
    // confirm at a glance which version of the policy is in effect.
    let digest = '';
    if (policy) {
        try {
            const stable = JSON.stringify(policy, Object.keys(policy).sort());
            // Cheap, deterministic, non-cryptographic — only used as a visual fingerprint
            let h = 0;
            for (let i = 0; i < stable.length; i++) {
                h = ((h << 5) - h + stable.charCodeAt(i)) | 0;
            }
            digest = (h >>> 0).toString(16).padStart(8, '0');
        }
        catch {
            digest = '';
        }
    }
    return {
        initialized: existsSync(AGENT_KEYSTORE),
        address: keystore?.address ?? null,
        policy: {
            found: !!policy,
            killSwitch: policy ? policy.killSwitch !== false : true, // default true
            unrestricted: !!(policy && policy.unrestricted === true),
            chainCount: Array.isArray(chains_) ? chains_.length : 0,
            allowedAddressCount: Array.isArray(allowedAddr) ? allowedAddr.length : 0,
            blockedAddressCount: Array.isArray(blockedAddr) ? blockedAddr.length : 0,
            maxTxValueWei: policy && typeof policy.maxTxValueWei === 'string' ? policy.maxTxValueWei : null,
            maxGasWei: policy && typeof policy.maxGasWei === 'string' ? policy.maxGasWei : null,
            memoRequired: !!(policy && policy.memoRequired === true),
            rawDigest: digest,
        },
        trackedTokenCount: Array.isArray(tokens) ? tokens.length : 0,
        customChainCount: Array.isArray(chains) ? chains.length : 0,
        activityCount: readActivityRows(10000).length,
        walletUiHint: 'For full wallet management — balances across every chain, policy editing forms with kill switch, ' +
            'tracked-token manager, custom-chain registration, signed activity timeline — run ' +
            'chaingpt_agent_wallet_serve_ui in Claude. That opens the dedicated wallet admin UI on port 8787 ' +
            'with its own admin token.',
        paths: {
            walletDir: AGENT_WALLET_DIR,
            keystore: AGENT_KEYSTORE,
            policy: AGENT_POLICY,
        },
    };
}
function getOverview() {
    const pluginPkg = readJsonSafe(PLUGIN_JSON) || {};
    const marketplacePkg = readJsonSafe(MARKETPLACE_JSON) || {};
    const mcpPkg = readJsonSafe(MCP_SERVER_PKG_JSON) || {};
    const keystoreCandidate = join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'keystore.json');
    return {
        pluginName: String(pluginPkg.name || 'chaingpt'),
        pluginVersion: String(pluginPkg.version || 'unknown'),
        marketplaceVersion: String(marketplacePkg.plugins?.[0]?.version || 'unknown'),
        mcpServerVersion: String(mcpPkg.version || 'unknown'),
        skillCount: listSkills().length,
        agentWalletInitialized: existsSync(keystoreCandidate),
        agentWalletUiHint: 'Run chaingpt_agent_wallet_serve_ui (port 8787) to open the wallet panel.',
        homepage: String(pluginPkg.homepage || 'https://github.com/ChainGPT-org/chaingpt-claude-skill'),
    };
}
function getHealth() {
    const env = [
        { key: 'CHAINGPT_API_KEY', label: 'ChainGPT API (chat/NFT/audit/generator/news)', set: !!process.env.CHAINGPT_API_KEY, required: true },
        { key: 'CHAINGPT_AGENT_WALLET_PASSPHRASE', label: 'Agent-wallet keystore passphrase', set: !!process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE, required: false },
        { key: 'ETHERSCAN_API_KEY', label: 'Etherscan (source/honeypot lookups)', set: !!process.env.ETHERSCAN_API_KEY, required: false },
        { key: 'MORALIS_API_KEY', label: 'Moralis (portfolio enrichment)', set: !!process.env.MORALIS_API_KEY, required: false },
        { key: 'GOPLUS_API_KEY', label: 'GoPlus (risk scanning)', set: !!process.env.GOPLUS_API_KEY, required: false },
    ];
    const dirs = [
        { path: PLUGIN_ROOT, exists: existsSync(PLUGIN_ROOT) },
        { path: SKILLS_DIR, exists: existsSync(SKILLS_DIR) },
        { path: MCP_SERVER_PKG_JSON, exists: existsSync(MCP_SERVER_PKG_JSON) },
        { path: DASHBOARD_DIR, exists: existsSync(DASHBOARD_DIR) },
    ];
    return { env, dirs, node: process.version, usage: readUsage() };
}
function readChangelogTop(maxBytes = 4096) {
    if (!existsSync(CHANGELOG_PATH))
        return '';
    try {
        const raw = readFileSync(CHANGELOG_PATH, 'utf8');
        return raw.slice(0, maxBytes);
    }
    catch {
        return '';
    }
}
// ── HTML / CSS / JS payload ────────────────────────────────────────
const BASE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #0d1117; color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; }
a { color: #58a6ff; text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; background: #161b22; padding: 1px 5px; border-radius: 3px; }
.shell { max-width: 1100px; margin: 0 auto; padding: 24px; }
.bar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid #21262d; margin-bottom: 20px; }
.brand { font-weight: 700; font-size: 18px; letter-spacing: -0.01em; }
.brand .pip { display: inline-block; width: 8px; height: 8px; background: #2ea043; border-radius: 50%; margin-right: 8px; vertical-align: 1px; }
.tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #21262d; }
.tab { padding: 9px 14px; cursor: pointer; color: #7d8590; border-bottom: 2px solid transparent; user-select: none; font-weight: 500; }
.tab:hover { color: #e6edf3; }
.tab.active { color: #e6edf3; border-bottom-color: #f78166; }
.panel { display: none; }
.panel.active { display: block; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px 16px; }
.card h3 { margin: 0 0 6px 0; font-size: 14px; font-weight: 600; }
.card p { margin: 0; color: #8b949e; font-size: 13px; }
.kv { display: grid; grid-template-columns: 200px 1fr; gap: 8px 16px; }
.kv .k { color: #8b949e; }
.kv .v { font-family: ui-monospace, monospace; word-break: break-all; }
.subtle { color: #7d8590; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #21262d; }
.row:last-child { border-bottom: 0; }
.tag { display: inline-block; font-size: 11px; padding: 2px 7px; border-radius: 999px; background: #21262d; color: #8b949e; }
.tag.ok { background: #14351f; color: #56d364; }
.tag.warn { background: #3d2911; color: #e8a44a; }
.tag.miss { background: #3a1417; color: #f85149; }
button { background: #238636; color: #fff; border: 0; border-radius: 4px; padding: 7px 14px; font-weight: 600; cursor: pointer; font-size: 13px; }
button:hover { background: #2ea043; }
button.secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
button.secondary:hover { background: #30363d; }
input { padding: 9px 11px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 13px; }
.empty { padding: 32px; text-align: center; color: #7d8590; border: 1px dashed #30363d; border-radius: 6px; }
.error { background: #5d1a1f; border: 1px solid #f85149; color: #ffa6a0; padding: 10px; border-radius: 4px; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: #8b949e; font-weight: 500; padding: 8px 8px; border-bottom: 1px solid #30363d; }
td { padding: 8px 8px; border-bottom: 1px solid #21262d; font-family: ui-monospace, monospace; }
pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; overflow: auto; font-size: 12.5px; }
`;
function loginHtml(error) {
    const errorBlock = error ? `<div class="error">${escapeHtml(error)}</div>` : '';
    return `<!doctype html><html><head><meta charset="utf-8"/><title>ChainGPT Dashboard — Login</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>${BASE_CSS}
.login { max-width: 420px; margin: 80px auto; }
.login form { display: flex; flex-direction: column; gap: 10px; margin: 14px 0; }
.hint { color: #7d8590; font-size: 12px; line-height: 1.5; }
</style></head><body>
<div class="login">
<div class="brand"><span class="pip"></span>ChainGPT Dashboard</div>
<div class="subtle">Admin login</div>
${errorBlock}
<form method="POST" action="/login">
<input type="password" name="token" placeholder="Paste admin token" autofocus required />
<button type="submit">Unlock</button>
</form>
<p class="hint">The admin token was printed when you ran <code>/chaingpt:dashboard</code>. It's also stored at <code>${escapeHtml(ADMIN_TOKEN_PATH)}</code> (0600). It rotates every time the dashboard server is (re)started.</p>
</div>
</body></html>`;
}
function dashboardHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"/><title>ChainGPT Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>${BASE_CSS}</style></head><body>
<div class="shell">
  <div class="bar">
    <div class="brand"><span class="pip"></span>ChainGPT Dashboard</div>
    <div><a href="#" id="logout">Sign out</a></div>
  </div>
  <div class="tabs">
    <div class="tab active" data-tab="overview">Overview</div>
    <div class="tab" data-tab="wallet">Wallet</div>
    <div class="tab" data-tab="skills">Skills</div>
    <div class="tab" data-tab="activity">Activity</div>
    <div class="tab" data-tab="health">Health</div>
    <div class="tab" data-tab="about">About</div>
  </div>
  <div id="panel-overview" class="panel active"><div class="empty">Loading…</div></div>
  <div id="panel-wallet" class="panel"><div class="empty">Loading…</div></div>
  <div id="panel-skills" class="panel"><div class="empty">Loading…</div></div>
  <div id="panel-activity" class="panel"><div class="empty">Loading…</div></div>
  <div id="panel-health" class="panel"><div class="empty">Loading…</div></div>
  <div id="panel-about" class="panel"><div class="empty">Loading…</div></div>
</div>
<script>
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const loaded = { overview: false, wallet: false, skills: false, activity: false, health: false, about: false };

async function fetchJson(path) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

function renderOverview(d) {
  return \`
    <div class="grid">
      <div class="card"><h3>Plugin</h3><p><code>\${esc(d.pluginName)}</code> v\${esc(d.pluginVersion)}</p></div>
      <div class="card"><h3>MCP server</h3><p>v\${esc(d.mcpServerVersion)}</p></div>
      <div class="card"><h3>Marketplace</h3><p>v\${esc(d.marketplaceVersion)}</p></div>
      <div class="card"><h3>Skills</h3><p>\${d.skillCount} installed</p></div>
      <div class="card"><h3>Agent wallet</h3><p>\${d.agentWalletInitialized ? '<span class=\\"tag ok\\">initialized</span>' : '<span class=\\"tag warn\\">not initialized</span>'}<br/><span class="subtle">\${esc(d.agentWalletUiHint)}</span></p></div>
      <div class="card"><h3>Docs</h3><p><a href="\${esc(d.homepage)}" target="_blank" rel="noopener">Open homepage ↗</a></p></div>
    </div>
  \`;
}

function renderWallet(d) {
  if (!d.initialized) {
    return \`<div class="empty">
      <strong>Agent wallet not initialized.</strong><br/>
      Run <code>chaingpt_agent_wallet_init</code> in Claude to create the encrypted EOA keystore.<br/>
      <span class="subtle" style="display:block;margin-top:8px;max-width:560px;margin-left:auto;margin-right:auto">
        First set <code>CHAINGPT_AGENT_WALLET_PASSPHRASE</code> (≥16 chars) in your shell, then ask Claude to "initialize the agent wallet."
      </span>
    </div>\`;
  }
  const p = d.policy;
  const killTag = p.killSwitch
    ? '<span class="tag miss">KILL SWITCH ENGAGED</span>'
    : (p.unrestricted ? '<span class="tag warn">🚨 UNRESTRICTED</span>' : '<span class="tag ok">live (policy-gated)</span>');
  const policyRows = p.found ? \`
    <div class="kv">
      <div class="k">Kill switch</div><div class="v">\${p.killSwitch ? 'ON — agent refuses every signing op' : 'off — policy gate is active'}</div>
      <div class="k">Mode</div><div class="v">\${p.unrestricted ? '🚨 UNRESTRICTED (bypasses per-tx checks)' : 'policy-gated'}</div>
      <div class="k">Allowed chains</div><div class="v">\${p.chainCount}</div>
      <div class="k">Allowed addresses</div><div class="v">\${p.allowedAddressCount}</div>
      <div class="k">Blocked addresses</div><div class="v">\${p.blockedAddressCount}</div>
      <div class="k">Max tx value (wei)</div><div class="v">\${esc(p.maxTxValueWei || '— (unset)')}</div>
      <div class="k">Max gas (wei)</div><div class="v">\${esc(p.maxGasWei || '— (unset)')}</div>
      <div class="k">Memo required</div><div class="v">\${p.memoRequired ? 'yes' : 'no'}</div>
      <div class="k">Policy digest</div><div class="v">\${esc(p.rawDigest || '—')}</div>
    </div>
  \` : '<div class="subtle">No policy file found. The agent will refuse to sign until policy.json exists and admin opts in.</div>';
  const cta = \`
    <div class="card" style="margin-top:14px;border-color:#1f6feb;background:#0c1c3a">
      <h3 style="color:#79c0ff">Open the full Wallet Admin UI</h3>
      <p style="margin:6px 0 10px 0">For balances across every chain, kill-switch toggle, policy edit forms, 9 quick templates (including 🚨 Unrestricted), tracked-token manager, custom-chain registration, and the full signed-activity timeline:</p>
      <pre style="margin:0">In Claude:  ask the agent to run <code>chaingpt_agent_wallet_serve_ui</code>

It prints a URL on <code>127.0.0.1:8787</code> and a one-time admin token.
Open the URL, paste the token, and the dedicated wallet UI loads.</pre>
    </div>
  \`;
  return \`
    <div class="grid">
      <div class="card">
        <h3>Agent EOA address</h3>
        <p style="font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all;margin-top:6px">\${esc(d.address || '— not readable')}</p>
        <p style="margin-top:8px"><button class="secondary" onclick="navigator.clipboard.writeText('\${esc(d.address || '')}');this.textContent='Copied ✓';setTimeout(()=>this.textContent='Copy address',1500)">Copy address</button></p>
      </div>
      <div class="card">
        <h3>Status</h3>
        <p>\${killTag}</p>
        <p class="subtle" style="margin-top:8px">Signed txs to date: \${d.activityCount}</p>
      </div>
      <div class="card">
        <h3>Tracked assets</h3>
        <p>\${d.trackedTokenCount} ERC-20 tokens · \${d.customChainCount} custom chains</p>
        <p class="subtle" style="margin-top:8px">Manage via the full Wallet Admin UI.</p>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Policy</h3>\${policyRows}</div>
    \${cta}
    <div class="card" style="margin-top:14px">
      <h3>Files on disk</h3>
      <div class="kv">
        <div class="k">Wallet dir</div><div class="v">\${esc(d.paths.walletDir)}</div>
        <div class="k">Keystore</div><div class="v">\${esc(d.paths.keystore)} (0600, AES-256-GCM)</div>
        <div class="k">Policy file</div><div class="v">\${esc(d.paths.policy)} (admin edits via dashboard or text editor)</div>
      </div>
    </div>
  \`;
}

function renderSkills(rows) {
  if (!rows.length) return '<div class="empty">No skills found at <code>skills/</code>.</div>';
  return '<div class="grid">' + rows.map(s => \`
    <div class="card">
      <h3>\${esc(s.name || s.slug)}</h3>
      <p style="margin-top:6px">\${esc(s.description)}</p>
      <p style="margin-top:10px"><span class="tag">\${esc(s.slug)}</span></p>
    </div>\`).join('') + '</div>';
}

function renderActivity(rows) {
  if (!rows.length) return '<div class="empty">No agent-wallet activity logged yet.<br/><span class="subtle">When the agent signs a tx, it appears here.</span></div>';
  return '<table><thead><tr><th>When</th><th>Chain</th><th>To</th><th>Value (wei)</th><th>Hash</th><th>Memo</th></tr></thead><tbody>' +
    rows.map(r => \`<tr><td>\${esc(r.ts)}</td><td>\${esc(r.chain)}</td><td>\${esc(r.to)}</td><td>\${esc(r.valueWei)}</td><td>\${esc(r.hash.slice(0,18))}…</td><td>\${esc(r.memo || '')}</td></tr>\`).join('') +
    '</tbody></table>';
}

function renderHealth(d) {
  const envRows = d.env.map(e => {
    const tag = e.set ? '<span class="tag ok">set</span>' : (e.required ? '<span class="tag miss">missing</span>' : '<span class="tag warn">optional</span>');
    return \`<div class="row"><div style="flex:1"><code>\${esc(e.key)}</code><br/><span class="subtle">\${esc(e.label)}</span></div>\${tag}</div>\`;
  }).join('');
  const dirRows = d.dirs.map(x => \`<div class="row"><div style="flex:1"><code>\${esc(x.path)}</code></div>\${x.exists ? '<span class="tag ok">present</span>' : '<span class="tag miss">missing</span>'}</div>\`).join('');
  const usage = d.usage && d.usage.top && d.usage.top.length
    ? d.usage.top.slice(0, 15).map(u => \`<div class="row"><div style="flex:1"><code>\${esc(u.tool)}</code></div><span class="subtle" style="margin-right:10px">\${esc((u.lastUsed||'').slice(0,16).replace('T',' '))}</span><span class="tag ok">\${esc(String(u.count))}</span></div>\`).join('')
    : '<div class="subtle">No tool calls recorded yet (or CHAINGPT_USAGE=off).</div>';
  const usageNote = d.usage ? \`<p class="subtle" style="margin-top:8px">\${esc(String(d.usage.total))} calls since \${esc((d.usage.since||'').slice(0,10))}. Local-only — stored in ~/.chaingpt-mcp/usage.json, never transmitted. Tool names, counts + last-called timestamps only.</p>\` : '';
  return \`
    <div class="card"><h3>Node runtime</h3><p>\${esc(d.node)}</p></div>
    <div class="card" style="margin-top:12px"><h3>Tool usage (top 15, local-only)</h3>\${usage}\${usageNote}</div>
    <div class="card" style="margin-top:12px"><h3>Environment variables</h3>\${envRows}</div>
    <div class="card" style="margin-top:12px"><h3>Paths</h3>\${dirRows}</div>
  \`;
}

function renderAbout(d) {
  const cl = d.changelog ? '<pre>' + esc(d.changelog) + '</pre>' : '<div class="subtle">No CHANGELOG.md found.</div>';
  return \`
    <div class="card"><h3>About</h3>
      <p><code>\${esc(d.pluginName)}</code> v\${esc(d.pluginVersion)} — <a href="\${esc(d.homepage)}" target="_blank" rel="noopener">\${esc(d.homepage)}</a></p>
      <p class="subtle" style="margin-top:8px">Dashboard binds 127.0.0.1 only. Admin token at <code>\${esc(d.adminTokenPath)}</code> (0600).</p>
    </div>
    <div class="card" style="margin-top:12px"><h3>CHANGELOG (top)</h3>\${cl}</div>
  \`;
}

async function load(tab) {
  if (loaded[tab]) return;
  const root = $('#panel-' + tab);
  try {
    if (tab === 'overview') root.innerHTML = renderOverview(await fetchJson('/dashboard/api/overview'));
    else if (tab === 'wallet') root.innerHTML = renderWallet(await fetchJson('/dashboard/api/wallet'));
    else if (tab === 'skills') root.innerHTML = renderSkills(await fetchJson('/dashboard/api/skills'));
    else if (tab === 'activity') root.innerHTML = renderActivity(await fetchJson('/dashboard/api/activity'));
    else if (tab === 'health') root.innerHTML = renderHealth(await fetchJson('/dashboard/api/health'));
    else if (tab === 'about') root.innerHTML = renderAbout(await fetchJson('/dashboard/api/about'));
    loaded[tab] = true;
  } catch (e) {
    root.innerHTML = '<div class="error">' + esc(e.message) + '</div>';
  }
}

$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.panel').forEach(p => p.classList.remove('active'));
  const tab = t.dataset.tab;
  $('#panel-' + tab).classList.add('active');
  load(tab);
}));

$('#logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
  location.href = '/';
});

load('overview');
</script>
</body></html>`;
}
// ── HTTP handler ───────────────────────────────────────────────────
function createHandler(port) {
    return async (req, res) => {
        if (!checkHost(req, port)) {
            res.writeHead(421, { 'content-type': 'text/plain' });
            res.end('Host check failed (DNS-rebinding defense). Use http://127.0.0.1:' + port);
            return;
        }
        const url = req.url || '/';
        const method = (req.method || 'GET').toUpperCase();
        try {
            // Login
            if (url === '/login' && method === 'POST') {
                if (!checkOrigin(req, port)) {
                    res.writeHead(403);
                    res.end('Origin check failed');
                    return;
                }
                const body = await readBody(req);
                const form = parseFormBody(body);
                const tok = form.token || '';
                if (!adminToken || !timingSafeStrEqual(tok, adminToken)) {
                    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
                    res.end(loginHtml('Invalid token.'));
                    return;
                }
                const sid = createSession();
                res.writeHead(302, {
                    location: '/',
                    'set-cookie': `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
                });
                res.end();
                return;
            }
            // Logout
            if (url === '/logout' && method === 'POST') {
                const sid = parseCookies(req.headers.cookie)[COOKIE];
                if (sid)
                    sessions.delete(sid);
                res.writeHead(204, {
                    'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
                });
                res.end();
                return;
            }
            // Login gate
            const authed = checkSession(req);
            // Root
            if (url === '/' || url === '/dashboard' || url === '/dashboard/') {
                if (!authed) {
                    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                    res.end(loginHtml(null));
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end(dashboardHtml());
                return;
            }
            // API panel routes — all require session
            if (url.startsWith('/dashboard/api/')) {
                if (!authed) {
                    jsonResponse(res, 401, { error: 'unauthorized' });
                    return;
                }
                if (url === '/dashboard/api/overview') {
                    jsonResponse(res, 200, getOverview());
                    return;
                }
                if (url === '/dashboard/api/wallet') {
                    jsonResponse(res, 200, getWallet());
                    return;
                }
                if (url === '/dashboard/api/skills') {
                    jsonResponse(res, 200, listSkills());
                    return;
                }
                if (url === '/dashboard/api/activity') {
                    jsonResponse(res, 200, readActivityRows(50));
                    return;
                }
                if (url === '/dashboard/api/health') {
                    jsonResponse(res, 200, getHealth());
                    return;
                }
                if (url === '/dashboard/api/about') {
                    const o = getOverview();
                    jsonResponse(res, 200, {
                        pluginName: o.pluginName,
                        pluginVersion: o.pluginVersion,
                        homepage: o.homepage,
                        adminTokenPath: ADMIN_TOKEN_PATH,
                        changelog: readChangelogTop(),
                    });
                    return;
                }
                jsonResponse(res, 404, { error: 'not found' });
                return;
            }
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Not found');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
                res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
                res.end('Error: ' + msg);
            }
            catch { /* response may already be sent */ }
        }
    };
}
// ── Server lifecycle ───────────────────────────────────────────────
async function startServer(port) {
    if (runningServer && runningPort === port) {
        // Re-issue a fresh token but reuse server
        adminToken = provisionAdminToken();
        return { url: `http://127.0.0.1:${port}`, token: adminToken, alreadyRunning: true };
    }
    if (runningServer && runningPort !== port) {
        await new Promise((resolveClose) => runningServer.close(() => resolveClose()));
        runningServer = null;
        runningPort = null;
    }
    adminToken = provisionAdminToken();
    const handler = createHandler(port);
    const server = createServer(handler);
    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', rejectListen);
            resolveListen();
        });
    });
    runningServer = server;
    runningPort = port;
    return { url: `http://127.0.0.1:${port}`, token: adminToken, alreadyRunning: false };
}
// ── MCP handler ────────────────────────────────────────────────────
export async function handleDashboardTool(name, args) {
    if (name !== 'chaingpt_dashboard_serve') {
        return { content: [{ type: 'text', text: `Unknown dashboard tool: ${name}` }], isError: true };
    }
    const port = Number(args?.port) || 8788;
    const { url, token, alreadyRunning } = await startServer(port);
    const note = alreadyRunning
        ? 'Dashboard server was already running on this port — admin token rotated.'
        : 'Dashboard server started.';
    const body = [
        note,
        '',
        `URL:           ${url}`,
        `Admin token:   ${token}`,
        `Token file:    ${ADMIN_TOKEN_PATH} (0600)`,
        '',
        'Open the URL, paste the token on the login screen. The token rotates on every',
        'invocation of chaingpt_dashboard_serve. The server binds 127.0.0.1 only.',
    ].join('\n');
    return { content: [{ type: 'text', text: body }] };
}
