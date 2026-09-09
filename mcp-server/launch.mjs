#!/usr/bin/env node
/**
 * Fail-closed launcher for the ChainGPT MCP server.
 *
 * The plugin cache is a high-trust execution context: Claude Code starts this
 * file automatically, and the resulting Node process can access the user's
 * environment and any credentials intentionally exposed to the MCP server.
 * Package installation must therefore be an explicit, separately reviewed
 * administrator/developer action. This launcher never invokes npm, npx, pnpm,
 * yarn, bun, a shell, or another package manager.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const missing = Object.keys(manifest.dependencies ?? {}).filter(name =>
  !existsSync(join(here, 'node_modules', name, 'package.json')));
if (!existsSync(join(here, 'dist', 'index.js'))) missing.push('dist/index.js');

if (missing.length > 0) {
  const lines = [
    '[chaingpt-mcp] startup blocked: reviewed runtime dependencies are not installed.',
    '[chaingpt-mcp] automatic package installation is disabled by security policy.',
    `[chaingpt-mcp] plugin directory: ${here}`,
    `[chaingpt-mcp] missing: ${missing.join(', ')}`,
    '[chaingpt-mcp] follow the reviewed local-checkout installation steps in README.md.',
    '[chaingpt-mcp] install with npm ci --omit=dev --ignore-scripts before supplying credentials.',
    '[chaingpt-mcp] do not bypass this check with copied or previously cached node_modules.',
  ];
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(78);
}

await import('./dist/index.js');
