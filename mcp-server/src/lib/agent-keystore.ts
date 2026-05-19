/**
 * Encrypted keystore for the agent's EOA wallet.
 *
 * Threat model: an attacker who reads the keystore file from disk must NOT
 * be able to recover the private key without the passphrase. The passphrase
 * is admin-controlled via the env var CHAINGPT_AGENT_WALLET_PASSPHRASE and
 * never exposed to the LLM or any MCP tool output. Even if a prompt
 * injection convinces the agent to "show me your wallet status," the
 * passphrase stays in the env.
 *
 * Encryption: AES-256-GCM with a 256-bit key derived from the passphrase
 * via scrypt (N=2^14). Auth tag is verified on decrypt so any tampering
 * with the ciphertext fails loudly.
 *
 * File permissions: 0600 (owner read/write only) on POSIX. The directory
 * is created with 0700.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { PrivateKeyAccount } from 'viem/accounts';

const SCRYPT_N = 16384;  // 2^14 — slow enough to resist brute force, fast enough not to block startup
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const MIN_PASS_LEN = 16;

const DEFAULT_PATH = join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'keystore.json');

export function keystorePath(): string {
  return process.env.CHAINGPT_KEYSTORE_FILE?.trim() || DEFAULT_PATH;
}

function passphrase(): string | null {
  return process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE?.trim() || null;
}

function deriveKey(pass: string, salt: Buffer): Buffer {
  return scryptSync(pass, salt, KEY_LEN, { N: SCRYPT_N });
}

export interface KeystoreFile {
  version: 1;
  address: `0x${string}`;
  ciphertext: string;  // base64
  iv: string;          // base64
  salt: string;        // base64
  authTag: string;     // base64
  kdf: 'scrypt';
  kdfN: number;
  cipher: 'aes-256-gcm';
  createdAt: string;
}

export function isKeystoreInitialized(): boolean {
  return existsSync(keystorePath());
}

export function readKeystoreFile(): KeystoreFile | null {
  if (!isKeystoreInitialized()) return null;
  try {
    return JSON.parse(readFileSync(keystorePath(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Generate a new EOA, encrypt the private key, write to disk.
 * Refuses to overwrite an existing keystore (use a different path or
 * delete the file manually with shell access).
 */
export function initKeystore(): { address: `0x${string}`; path: string } {
  const path = keystorePath();
  if (isKeystoreInitialized()) {
    throw new Error(
      `Keystore already exists at ${path}. ` +
      `Refusing to overwrite — delete the file manually if you want to regenerate.`
    );
  }
  const pass = passphrase();
  if (!pass) {
    throw new Error(
      'CHAINGPT_AGENT_WALLET_PASSPHRASE env var is required to initialize the keystore. ' +
      'Set it in your shell BEFORE starting the MCP server. Min 16 chars.'
    );
  }
  if (pass.length < MIN_PASS_LEN) {
    throw new Error(`Passphrase must be at least ${MIN_PASS_LEN} characters.`);
  }

  const priv = generatePrivateKey();
  const account = privateKeyToAccount(priv);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(pass, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const privHexNoPrefix = priv.slice(2);
  const ciphertext = Buffer.concat([cipher.update(privHexNoPrefix, 'hex'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const file: KeystoreFile = {
    version: 1,
    address: account.address,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: authTag.toString('base64'),
    kdf: 'scrypt',
    kdfN: SCRYPT_N,
    cipher: 'aes-256-gcm',
    createdAt: new Date().toISOString(),
  };

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  try { chmodSync(dirname(path), 0o700); } catch { /* best-effort */ }
  return { address: account.address, path };
}

export function loadAccount(): PrivateKeyAccount {
  const pass = passphrase();
  if (!pass) {
    throw new Error(
      'CHAINGPT_AGENT_WALLET_PASSPHRASE env var is not set; cannot decrypt the keystore. ' +
      'Set it in your shell before starting the MCP server.'
    );
  }
  const file = readKeystoreFile();
  if (!file) {
    throw new Error(
      `Keystore not found at ${keystorePath()}. ` +
      `Call chaingpt_agent_wallet_init first.`
    );
  }
  const salt = Buffer.from(file.salt, 'base64');
  const iv = Buffer.from(file.iv, 'base64');
  const authTag = Buffer.from(file.authTag, 'base64');
  const ciphertext = Buffer.from(file.ciphertext, 'base64');
  const key = deriveKey(pass, salt);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Keystore decrypt failed — wrong passphrase or tampered ciphertext.');
  }
  const priv = ('0x' + plain.toString('hex')) as `0x${string}`;
  // Wipe the plaintext buffer ASAP (best-effort — JS strings are immutable)
  plain.fill(0);
  const account = privateKeyToAccount(priv);
  // Verify the stored address matches the decrypted key — paranoia check
  if (account.address.toLowerCase() !== file.address.toLowerCase()) {
    throw new Error('Keystore integrity check failed — decrypted key does not match recorded address.');
  }
  return account;
}
