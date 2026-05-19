#!/usr/bin/env node
/**
 * mcp-boot-smoke.mjs — boot smoke test for the built chaingpt-mcp server.
 *
 * Spawns `mcp-server/dist/index.js`, completes the MCP initialize handshake,
 * sends a tools/list request over JSON-RPC/stdio, and asserts the response
 * contains at least MIN_EXPECTED_TOOLS unique tool names.
 *
 * This catches regressions where a tool was removed but the router still
 * imports it (process won't boot), where a tool was registered twice (name
 * collision), or where a structural change to the tool surface silently
 * drops dozens of tools.
 *
 * Exit codes:
 *   0  boot succeeded and tool surface meets expectations
 *   1  boot failed, handshake failed, or tool count below MIN_EXPECTED_TOOLS
 *   2  invalid usage
 *
 * Env:
 *   CHAINGPT_MCP_BIN     path to the built server entrypoint (default: ../mcp-server/dist/index.js)
 *   MIN_EXPECTED_TOOLS   minimum acceptable tool count (default: 95)
 *   BOOT_SMOKE_TIMEOUT_MS  per-step timeout (default: 8000)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BIN = process.env.CHAINGPT_MCP_BIN
  ? resolve(process.env.CHAINGPT_MCP_BIN)
  : resolve(__dirname, '..', 'mcp-server', 'dist', 'index.js');
const MIN_EXPECTED_TOOLS = Number(process.env.MIN_EXPECTED_TOOLS ?? 95);
const STEP_TIMEOUT_MS = Number(process.env.BOOT_SMOKE_TIMEOUT_MS ?? 8000);

if (!existsSync(BIN)) {
  console.error(`[boot-smoke] FAIL: server binary not found at ${BIN}`);
  console.error('[boot-smoke] Build the server first: (cd mcp-server && npm run build)');
  process.exit(1);
}

// Redirect HOME to a fresh temp dir so the agent-wallet keystore loader
// (which reads from $HOME/.chaingpt-mcp/agent-wallet/) cannot see real state
// when this script runs on a developer machine that already has an init'd wallet.
const SMOKE_HOME = mkdtempSync(join(tmpdir(), 'chaingpt-mcp-boot-smoke-'));

// Spawn the server with a dummy CHAINGPT_API_KEY (server refuses to start without one).
const child = spawn(process.execPath, [BIN], {
  env: {
    ...process.env,
    HOME: SMOKE_HOME,
    USERPROFILE: SMOKE_HOME, // Windows fallback for the same purpose
    CHAINGPT_API_KEY: process.env.CHAINGPT_API_KEY ?? 'boot-smoke-not-a-real-key',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdoutBuf = '';
let stderrBuf = '';
let resolveResp;
const responses = new Map(); // id -> resolver

function expectResponse(id, timeoutMs = STEP_TIMEOUT_MS) {
  return new Promise((resolveOnce, rejectOnce) => {
    const t = setTimeout(() => {
      rejectOnce(new Error(`timeout waiting for response id=${id} after ${timeoutMs}ms`));
    }, timeoutMs);
    responses.set(id, (msg) => {
      clearTimeout(t);
      resolveOnce(msg);
    });
  });
}

child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString();
  const lines = stdoutBuf.split('\n');
  stdoutBuf = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      const cb = responses.get(msg.id);
      if (cb) {
        responses.delete(msg.id);
        cb(msg);
      }
    } catch {
      // Non-JSON line on stdout — MCP stdio is strict, so log it but don't fail.
      console.error(`[boot-smoke] non-JSON on stdout: ${trimmed.slice(0, 200)}`);
    }
  }
});

child.stderr.on('data', (chunk) => {
  stderrBuf += chunk.toString();
});

child.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[boot-smoke] server exited unexpectedly with code ${code}`);
    if (stderrBuf) console.error(`[boot-smoke] stderr:\n${stderrBuf}`);
    process.exitCode = process.exitCode ?? 1;
  }
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

async function main() {
  // Step 1: initialize handshake
  const initReq = {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'chaingpt-boot-smoke', version: '1.0.0' },
    },
  };
  const initRespP = expectResponse(0);
  send(initReq);
  const initResp = await initRespP;
  if (!initResp.result?.protocolVersion) {
    throw new Error(`initialize returned no protocolVersion: ${JSON.stringify(initResp)}`);
  }
  console.log(`[boot-smoke] initialize OK (server protocolVersion=${initResp.result.protocolVersion})`);

  // Step 2: tools/list
  const listReq = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const listRespP = expectResponse(1);
  send(listReq);
  const listResp = await listRespP;
  const tools = listResp.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`tools/list returned no array: ${JSON.stringify(listResp).slice(0, 300)}`);
  }

  // Assertions
  const names = tools.map((t) => t.name);
  const unique = new Set(names);
  if (unique.size !== names.length) {
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    throw new Error(`duplicate tool names: ${[...new Set(dupes)].join(', ')}`);
  }
  const malformed = tools.filter((t) => !t.name || !t.description || !t.inputSchema);
  if (malformed.length > 0) {
    throw new Error(
      `tools missing name/description/inputSchema: ${malformed.map((t) => t.name ?? '<unnamed>').join(', ')}`
    );
  }
  // Every tool must start with the chaingpt_ prefix (router relies on this).
  const badPrefix = names.filter((n) => !n.startsWith('chaingpt_'));
  if (badPrefix.length > 0) {
    throw new Error(`tools missing chaingpt_ prefix: ${badPrefix.join(', ')}`);
  }

  console.log(`[boot-smoke] tools/list OK — ${names.length} unique tools`);
  if (names.length < MIN_EXPECTED_TOOLS) {
    throw new Error(
      `tool count ${names.length} below minimum ${MIN_EXPECTED_TOOLS} — ` +
      `did a tool module get dropped?`
    );
  }
  console.log(`[boot-smoke] PASS (${names.length} ≥ ${MIN_EXPECTED_TOOLS})`);
}

function cleanup() {
  try { rmSync(SMOKE_HOME, { recursive: true, force: true }); } catch {}
}

main()
  .then(() => {
    child.kill();
    cleanup();
    // Give the kill a tick so we don't race with the exit handler.
    setTimeout(() => process.exit(0), 50);
  })
  .catch((err) => {
    console.error(`[boot-smoke] FAIL: ${err.message}`);
    if (stderrBuf) console.error(`[boot-smoke] server stderr:\n${stderrBuf}`);
    try { child.kill(); } catch {}
    cleanup();
    setTimeout(() => process.exit(1), 50);
  });
