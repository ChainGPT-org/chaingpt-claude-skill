#!/usr/bin/env node
// Live MCP exercise for the v1.16.0 changes: drives the REAL server over
// stdio (boot + routing + handlers + live upstreams), not the handler
// functions directly. Local verification harness — not part of CI layers.
import { spawn } from 'node:child_process';

const server = spawn('node', ['dist/index.js'], {
  cwd: new URL('../mcp-server', import.meta.url).pathname,
  env: { ...process.env, CHAINGPT_API_KEY: '' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
server.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {}
  }
});

let nextId = 1;
function rpc(method, params, timeoutMs = 45000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const call = (name, args) => rpc('tools/call', { name, arguments: args });
const text = (r) => r?.result?.content?.[0]?.text ?? JSON.stringify(r?.error ?? r);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail?.slice(0, 220)}`}`);
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'exercise-v116', version: '1.0' },
});
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

// 1. Morpho markets — fixed schema + listed filter + real data
let t = text(await call('chaingpt_defi_morpho_markets', { network: 'ethereum', limit: 3 }));
check('morpho_markets returns APY+TVL data', /Supply APY: \d/.test(t) && /Supply TVL: \$\d/.test(t), t);

// 2. Morpho vaults — curators from state
t = text(await call('chaingpt_defi_morpho_vaults', { network: 'ethereum', asset: 'USDC', limit: 3 }));
check('morpho_vaults returns curator + APY', /Curator: (?!unknown)/.test(t) && /Net APY: \d/.test(t), t);

// 3. Pendle — details.* mapping
t = text(await call('chaingpt_defi_pendle_markets', { network: 'ethereum', limit: 3 }));
check('pendle_markets returns TVL + fixed APY', /TVL: \$\d/.test(t) && /Fixed APY \(buy PT\):\s+\d/.test(t), t);

// 4. Drift — degraded message (not bare upstream error)
t = text(await call('chaingpt_drift_markets', { limit: 3 }));
check('drift degraded message present (or live data)', /DEGRADED|Drift perp markets/.test(t), t);

// 5. dex_quote — derived min-out
t = text(await call('chaingpt_dex_quote', {
  network: 'ethereum',
  inToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  outToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  amountIn: '1',
}));
check('dex_quote min-out is numeric (no n/a)', /Min out:\s+[\d.]+ /.test(t), t);

// 6. approve_tx — refuses without ack
t = text(await call('chaingpt_dex_approve_tx', {
  network: 'ethereum',
  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
}));
check('approve_tx refuses without acknowledgeMainnet', /Mainnet approval refused/.test(t), t);

// 7. trending — enriched output
t = text(await call('chaingpt_research_trending', { limit: 5 }));
check('trending enriched with price/liq', /Price \$|no DexScreener pair data/.test(t) && /PAID boosts/.test(t), t);

// 8. gas — utilization average
t = text(await call('chaingpt_onchain_gas', { chain: 'ethereum' }));
check('gas shows averaged utilization', /Utilization: \d+% \(avg/.test(t) || !/gasUsedRatio|Gas used %/.test(t), t);

// 9. missing API key → setup help, not raw error
t = text(await call('chaingpt_news_fetch', { limit: 3 }));
check('missing key returns setup recipe', /CHAINGPT_API_KEY/.test(t) && /app\.chaingpt\.org/.test(t), t);

// 10. agent wallet status (read-only, local)
t = text(await call('chaingpt_agent_wallet_status', {}));
check('agent_wallet_status works', /Policy digest|not initialized/i.test(t), t);

server.kill();
const fails = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - fails}/${checks.length} exercise checks passed`);
process.exit(fails ? 1 : 0);
