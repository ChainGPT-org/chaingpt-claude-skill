/**
 * Encrypted keystore for the agent's SOLANA wallet (Ed25519).
 *
 * Same threat model and cipher as the EVM keystore (lib/agent-keystore.ts):
 * AES-256-GCM over the 64-byte secret key, key derived via scrypt from the
 * SAME admin passphrase (env var or the one OS-keychain entry). One admin
 * secret deliberately covers both keystores — one backup story, zero new
 * setup UX; the keystores remain independent files, and compromise of the
 * passphrase already compromises the EVM key.
 *
 * The cipher implementation is imported from agent-keystore.ts so it exists
 * exactly once and cannot drift between chains.
 *
 * File: ~/.chaingpt-mcp/agent-wallet/solana-keystore.json (0600, dir 0700)
 * Override: CHAINGPT_SOLANA_KEYSTORE_FILE
 */

import { Keypair } from '@solana/web3.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  encryptSecret,
  decryptSecret,
  resolveOrProvisionPassphrase,
  type EncryptedSecret,
} from './agent-keystore.js';
import { resolvePassphrase, type SecretSource } from './agent-secret.js';

const DEFAULT_PATH = join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'solana-keystore.json');

export function solanaKeystorePath(): string {
  return process.env.CHAINGPT_SOLANA_KEYSTORE_FILE?.trim() || DEFAULT_PATH;
}

export interface SolanaKeystoreFile extends EncryptedSecret {
  version: 1;
  curve: 'ed25519';
  address: string; // base58 public key
  createdAt: string;
}

export function isSolanaKeystoreInitialized(): boolean {
  return existsSync(solanaKeystorePath());
}

export function readSolanaKeystoreFile(): SolanaKeystoreFile | null {
  if (!isSolanaKeystoreInitialized()) return null;
  try {
    return JSON.parse(readFileSync(solanaKeystorePath(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Generate a new Ed25519 keypair, encrypt the 64-byte secret key, write to
 * disk. Refuses to overwrite an existing keystore.
 */
export function initSolanaKeystore(): { address: string; path: string; passphraseSource: SecretSource } {
  const path = solanaKeystorePath();
  if (isSolanaKeystoreInitialized()) {
    throw new Error(
      `Solana keystore already exists at ${path}. ` +
      `Refusing to overwrite — delete the file manually if you want to regenerate.`
    );
  }
  const { pass, source } = resolveOrProvisionPassphrase();

  const keypair = Keypair.generate();
  const plain = Buffer.from(keypair.secretKey); // 64 bytes (seed + pubkey)
  const enc = encryptSecret(plain, pass);
  plain.fill(0);

  const file: SolanaKeystoreFile = {
    version: 1,
    curve: 'ed25519',
    address: keypair.publicKey.toBase58(),
    ...enc,
    createdAt: new Date().toISOString(),
  };

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  try { chmodSync(dirname(path), 0o700); } catch { /* best-effort */ }
  return { address: file.address, path, passphraseSource: source };
}

/** Decrypt and return the keypair. The plaintext buffer is wiped after use. */
export function loadSolanaKeypair(): Keypair {
  const pass = resolvePassphrase().value;
  if (!pass) {
    throw new Error(
      'No keystore passphrase available; cannot decrypt the Solana keystore. ' +
      'Set CHAINGPT_AGENT_WALLET_PASSPHRASE in your shell before starting the MCP server, ' +
      'or ensure the OS keychain entry created at init is still present.'
    );
  }
  const file = readSolanaKeystoreFile();
  if (!file) {
    throw new Error(
      `Solana keystore not found at ${solanaKeystorePath()}. ` +
      `Call chaingpt_agent_wallet_solana_init first.`
    );
  }
  const plain = decryptSecret(file, pass);
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(Uint8Array.from(plain));
  } finally {
    plain.fill(0);
  }
  // Paranoia: decrypted key must reproduce the recorded address.
  if (keypair.publicKey.toBase58() !== file.address) {
    throw new Error('Solana keystore integrity check failed — decrypted key does not match recorded address.');
  }
  return keypair;
}
