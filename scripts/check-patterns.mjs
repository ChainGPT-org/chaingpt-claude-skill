#!/usr/bin/env node
/**
 * check-patterns.mjs — compile every solidity code block in patterns/*.md.
 *
 * Why this exists:
 *   patterns/*.md contain ~47 Solidity snippets that the ChainGPT Solidity
 *   LLM uses as authoritative reference. They are also linked from the README
 *   and several SKILL.md files. If a snippet stops compiling — because an
 *   OpenZeppelin import path moved, a solc version changed semantics, or
 *   someone hand-edited a snippet — every downstream consumer silently breaks.
 *
 *   This script extracts every ```solidity fenced block, compiles it with the
 *   installed `solc` package (with @openzeppelin/contracts + -upgradeable
 *   resolved from node_modules), and fails on any errors.
 *
 * Resolver:
 *   solc's standard JSON interface accepts an `import` callback. We resolve:
 *     @openzeppelin/contracts/...            → mcp-server/node_modules/@openzeppelin/contracts/...
 *     @openzeppelin/contracts-upgradeable/...→ mcp-server/node_modules/@openzeppelin/contracts-upgradeable/...
 *   Any other import path returns an error in-band; solc reports a clear
 *   "File not found" so the offending pattern is easy to spot.
 *
 * Exit codes:
 *   0  every block compiled cleanly (warnings allowed)
 *   1  one or more blocks failed
 *   2  invalid usage / setup error
 *
 * Env:
 *   PATTERNS_DIR     dir of .md files to scan (default: ../patterns)
 *   PATTERNS_SOLC    path to solc.js (default: mcp-server/node_modules/solc)
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const PATTERNS_DIR = process.env.PATTERNS_DIR
  ? resolve(process.env.PATTERNS_DIR)
  : join(REPO_ROOT, 'patterns');
const MCP_NODE_MODULES = join(REPO_ROOT, 'mcp-server', 'node_modules');

const require = createRequire(import.meta.url);
// solc lives inside mcp-server/node_modules — load it from there.
let solc;
try {
  solc = require(join(MCP_NODE_MODULES, 'solc'));
} catch (err) {
  console.error('[check-patterns] FAIL: could not load solc from mcp-server/node_modules.');
  console.error('[check-patterns] Run: (cd mcp-server && npm ci)');
  console.error('[check-patterns] Error:', err.message);
  process.exit(2);
}
console.log(`[check-patterns] solc ${solc.version()}`);

if (!existsSync(PATTERNS_DIR)) {
  console.error(`[check-patterns] FAIL: patterns dir not found: ${PATTERNS_DIR}`);
  process.exit(2);
}

/**
 * Resolve an import string to a file path under mcp-server/node_modules.
 * Returns { contents } on success or { error } on miss.
 */
function importCallback(importPath) {
  // Only resolve @openzeppelin namespaces — every other path is an error.
  if (!importPath.startsWith('@openzeppelin/')) {
    return { error: `unsupported import path: ${importPath} (only @openzeppelin/* is resolvable in patterns/)` };
  }
  const resolved = join(MCP_NODE_MODULES, importPath);
  try {
    const contents = readFileSync(resolved, 'utf8');
    return { contents };
  } catch {
    return { error: `File not found: ${importPath} (looked at ${resolved})` };
  }
}

/**
 * Extract all ```solidity fenced blocks from markdown.
 * Returns [{ block, startLine, fence }] in source order.
 */
function extractSolidityBlocks(md, file) {
  const lines = md.split('\n');
  const blocks = [];
  let inBlock = false;
  let current = [];
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^```solidity\b/i.test(line.trim())) {
      inBlock = true;
      current = [];
      startLine = i + 2; // 1-indexed, first line of code
      continue;
    }
    if (inBlock && /^```\s*$/.test(line)) {
      blocks.push({ file, startLine, source: current.join('\n') });
      inBlock = false;
      continue;
    }
    if (inBlock) current.push(line);
  }
  if (inBlock) {
    console.error(`[check-patterns] WARN: unterminated solidity block in ${file} starting at line ${startLine}`);
  }
  return blocks;
}

/**
 * Compile a single Solidity block. Returns { ok, errors[], warnings[], contracts: string[] }.
 */
function compileBlock(source, label) {
  const input = {
    language: 'Solidity',
    sources: { [`${label}.sol`]: { content: source } },
    settings: {
      optimizer: { enabled: false },
      outputSelection: { '*': { '*': ['abi'] } },
    },
  };
  const raw = solc.compile(JSON.stringify(input), { import: importCallback });
  const out = JSON.parse(raw);
  const errors = [];
  const warnings = [];
  for (const msg of out.errors ?? []) {
    if (msg.severity === 'error') errors.push(msg.formattedMessage ?? msg.message);
    else warnings.push(msg.formattedMessage ?? msg.message);
  }
  const fileContracts = out.contracts?.[`${label}.sol`] ?? {};
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    contracts: Object.keys(fileContracts),
  };
}

// ── Run ─────────────────────────────────────────────────────────
const mdFiles = readdirSync(PATTERNS_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => join(PATTERNS_DIR, f));

if (mdFiles.length === 0) {
  console.error(`[check-patterns] FAIL: no pattern markdown files in ${PATTERNS_DIR}`);
  process.exit(2);
}

let totalBlocks = 0;
let totalPass = 0;
let totalFail = 0;
const failures = [];

for (const file of mdFiles) {
  const md = readFileSync(file, 'utf8');
  const blocks = extractSolidityBlocks(md, file);
  if (blocks.length === 0) {
    console.log(`[check-patterns] ${file.replace(REPO_ROOT + '/', '')}: 0 blocks`);
    continue;
  }
  console.log(`[check-patterns] ${file.replace(REPO_ROOT + '/', '')}: ${blocks.length} blocks`);
  for (const b of blocks) {
    totalBlocks++;
    const rel = file.replace(REPO_ROOT + '/', '');
    const label = `${rel}#L${b.startLine}`;
    const res = compileBlock(b.source, label.replace(/[^a-zA-Z0-9]/g, '_'));
    if (res.ok) {
      totalPass++;
      console.log(`  ✓ ${rel}:${b.startLine}  (${res.contracts.length} contract${res.contracts.length === 1 ? '' : 's'})`);
    } else {
      totalFail++;
      failures.push({ label, errors: res.errors });
      console.log(`  ✗ ${rel}:${b.startLine}`);
      for (const e of res.errors.slice(0, 3)) {
        const lines = e.split('\n').slice(0, 4).join('\n');
        console.log(lines.split('\n').map((l) => `      ${l}`).join('\n'));
      }
      if (res.errors.length > 3) {
        console.log(`      … and ${res.errors.length - 3} more error(s)`);
      }
    }
  }
}

console.log('');
console.log(`[check-patterns] ${totalPass}/${totalBlocks} blocks compiled cleanly`);
if (totalFail > 0) {
  console.error(`[check-patterns] FAIL: ${totalFail} block(s) did not compile`);
  process.exit(1);
}
console.log('[check-patterns] PASS');
process.exit(0);
