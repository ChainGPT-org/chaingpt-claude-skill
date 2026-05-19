import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
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

function dashboardHtml(address: string, policyJson: string, digest: string, balanceRows: string, ksPath: string, polPath: string): string {
  // Simple self-contained HTML — no external deps, no inline JS that fetches the wallet's private state.
  // Includes a basic QR code via the goqr.me API (which doesn't see the private key).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ChainGPT Agent Wallet</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: ui-monospace, "SF Mono", Menlo, monospace; background: #0a0e1a; color: #e6edf3; max-width: 720px; margin: 24px auto; padding: 0 16px; line-height: 1.45; }
  h1 { color: #58a6ff; font-size: 20px; margin-bottom: 4px; }
  .subtle { color: #7d8590; font-size: 13px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px 16px; margin: 16px 0; }
  .card h2 { font-size: 14px; margin: 0 0 8px; color: #d2a8ff; text-transform: uppercase; letter-spacing: 0.5px; }
  pre { background: #0d1117; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  .addr { font-size: 15px; word-break: break-all; color: #79c0ff; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; border-bottom: 1px solid #21262d; font-size: 13px; }
  td:last-child { text-align: right; }
  .digest { color: #ffa657; }
  .killswitch-on { color: #f85149; font-weight: bold; }
  .killswitch-off { color: #3fb950; }
  img.qr { background: white; padding: 6px; border-radius: 4px; }
  footer { color: #484f58; font-size: 11px; margin-top: 24px; }
</style>
</head>
<body>
  <h1>ChainGPT Agent Wallet</h1>
  <div class="subtle">Read-only dashboard. Refresh the page to update.</div>

  <div class="card">
    <h2>Deposit address</h2>
    <div class="addr">${address}</div>
    <div style="margin-top: 12px;">
      <img class="qr" alt="QR code" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=ethereum:${address}" width="180" height="180" />
    </div>
    <div class="subtle" style="margin-top: 8px;">Send EVM-compatible assets to this address on any of the agent's allowed chains.</div>
  </div>

  <div class="card">
    <h2>Balances (native coin)</h2>
    <table>${balanceRows}</table>
  </div>

  <div class="card">
    <h2>Active policy <span class="digest">[${digest}]</span></h2>
    <pre>${policyJson}</pre>
    <div class="subtle">Edit at <code>${polPath}</code></div>
  </div>

  <div class="card">
    <h2>Keystore</h2>
    <div class="subtle">Encrypted at <code>${ksPath}</code>. Private key is AES-256-GCM-encrypted; passphrase lives only in the MCP server's env.</div>
  </div>

  <footer>ChainGPT Claude Skill agent-wallet dashboard. Refresh to update balances/policy.</footer>
</body>
</html>`;
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

      const handler = async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = req.url || '/';
          // Pre-fetch balances on every page load so refresh = re-fetch
          const policy = loadPolicy();
          const digest = policyDigest(policy);

          if (url.startsWith('/api/status')) {
            const balances: Record<string, string> = {};
            for (const c of chains) {
              try {
                const bal = await getNativeBalance(c, file.address);
                balances[c] = bal.toString();
              } catch { balances[c] = 'error'; }
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ address: file.address, balances, policyDigest: digest }));
            return;
          }
          // Default: HTML dashboard
          const balanceRows = await Promise.all(chains.map(async (c) => {
            const chain = resolveChain(c);
            if (!chain) return `<tr><td>${c}</td><td>unknown</td></tr>`;
            try {
              const bal = await getNativeBalance(c, file.address);
              return `<tr><td>${chain.name}</td><td>${fmtEth(bal)} ${chain.native}</td></tr>`;
            } catch (e: any) {
              return `<tr><td>${chain.name}</td><td>(RPC error)</td></tr>`;
            }
          }));
          const html = dashboardHtml(
            file.address,
            JSON.stringify(policy, null, 2),
            digest,
            balanceRows.join(''),
            keystorePath(),
            policyPath(),
          );
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
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
            `✓ Agent wallet UI running at ${url}`,
            ``,
            `The dashboard is read-only — it surfaces address, balances, and policy.`,
            `Bound to 127.0.0.1 only (not exposed on the network).`,
            ``,
            `Open ${url} in a browser. Refresh the page to update balances.`,
            ``,
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
