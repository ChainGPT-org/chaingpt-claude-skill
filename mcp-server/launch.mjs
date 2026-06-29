#!/usr/bin/env node
/**
 * Zero-dependency launcher for the ChainGPT MCP server.
 *
 * Claude Code copies plugin files into its cache AS-IS and does NOT run
 * `npm install` or any build step (see plugins-reference docs). The runtime
 * dependencies (solc, @solana/web3.js, viem, …) can't be bundled into a single
 * file (solc loads its compiler blob via runtime require), so on first launch —
 * or after a plugin update wipes the cache — we install them once, then start
 * the real server. Subsequent launches skip straight to the import.
 *
 * ponytail: one-time runtime `npm install`. The cleaner long-term fix is to
 * publish @chaingpt/mcp-server to npm and run it via `npx`; do that if the
 * first-launch install latency becomes a problem.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Presence of the MCP SDK is our proxy for "deps are installed".
const sdkInstalled = existsSync(join(here, 'node_modules', '@modelcontextprotocol', 'sdk'));

if (!sdkInstalled) {
  // NEVER write to stdout — it is the MCP JSON-RPC channel. Send our own
  // progress and npm's entire output to stderr (fd 2).
  process.stderr.write('[chaingpt-mcp] first launch: installing dependencies (one-time, ~30-60s)…\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    execFileSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: here,
      stdio: ['ignore', 2, 2],
    });
  } catch (err) {
    process.stderr.write(`[chaingpt-mcp] dependency install failed: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}

await import('./dist/index.js');
