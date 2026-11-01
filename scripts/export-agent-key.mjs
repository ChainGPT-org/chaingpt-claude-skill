#!/usr/bin/env node
/**
 * Human-run recovery for funds left in a retired agent wallet.
 *
 * Direct agent-wallet signing (EVM EOA, Solana, Tron) was removed: the only autonomous path left is an
 * ERC-4337 session key bounded by on-chain caps. Any funds still sitting on the old agent addresses are
 * recovered by importing the key into a wallet you control (MetaMask / Rabby for EVM, TronLink for Tron —
 * same key — and Phantom / Solflare for Solana), then moving them out.
 *
 * Run it yourself in a terminal: it refuses without an interactive TTY and prints the key only after you
 * type the confirmation phrase. Never paste the output into an AI chat. It never runs through the MCP server.
 *
 *   node scripts/export-agent-key.mjs
 */
import { createInterface } from 'node:readline/promises';

const dist = new URL('../mcp-server/dist/lib/', import.meta.url);
const { readKeystoreFile, keystorePath, decryptSecret } = await import(new URL('agent-keystore.js', dist));
const { resolvePassphrase } = await import(new URL('agent-secret.js', dist));
const { readSolanaKeystoreFile } = await import(new URL('agent-keystore-solana.js', dist));
const { base58Encode } = await import(new URL('tron-address.js', dist));

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Refusing: run this yourself in an interactive terminal, not through an agent or a pipe.');
  process.exit(1);
}

const evm = readKeystoreFile();
const sol = readSolanaKeystoreFile();
if (!evm && !sol) {
  console.log(`No agent-wallet keystore found (looked at ${keystorePath()}). Nothing to export.`);
  process.exit(0);
}

console.log('Agent-wallet keys found:');
if (evm) console.log(`  EVM / Tron address: ${evm.address}`);
if (sol) console.log(`  Solana address:     ${sol.address}`);
console.log('\nThe private keys will be printed in clear text. Anyone who sees them controls these funds.');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Type EXPORT MY KEYS to continue: ');
rl.close();
if (answer.trim() !== 'EXPORT MY KEYS') {
  console.log('Cancelled.');
  process.exit(1);
}

const pass = resolvePassphrase().value;
if (!pass) {
  console.error('No keystore passphrase: set CHAINGPT_AGENT_WALLET_PASSPHRASE or unlock the OS keychain entry used at init.');
  process.exit(1);
}

if (evm) {
  const key = decryptSecret(evm, pass);
  console.log(`\nEVM private key (MetaMask/Rabby; also imports into TronLink without the 0x): 0x${key.toString('hex')}`);
  key.fill(0);
}
if (sol) {
  const secret = decryptSecret(sol, pass);
  console.log(`\nSolana secret key, base58 (Phantom/Solflare "import private key"): ${base58Encode(Uint8Array.from(secret))}`);
  secret.fill(0);
}
console.log('\nMove the funds to your own wallet, then delete ~/.chaingpt-mcp/agent-wallet/ if you no longer need it.');
