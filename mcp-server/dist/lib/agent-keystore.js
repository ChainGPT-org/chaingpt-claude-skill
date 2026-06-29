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
import { resolvePassphrase, provisionKeychainPassphrase, detectKeychainBackend, describeSecretSource, } from './agent-secret.js';
const SCRYPT_N = 16384; // 2^14 — slow enough to resist brute force, fast enough not to block startup
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const MIN_PASS_LEN = 16;
const DEFAULT_PATH = join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'keystore.json');
export function keystorePath() {
    return process.env.CHAINGPT_KEYSTORE_FILE?.trim() || DEFAULT_PATH;
}
function passphrase() {
    return resolvePassphrase().value;
}
/** Where the passphrase currently resolves from — surfaced in status output. */
export function passphraseSource() {
    return resolvePassphrase().source;
}
export { describeSecretSource };
function deriveKey(pass, salt) {
    return scryptSync(pass, salt, KEY_LEN, { N: SCRYPT_N });
}
export function encryptSecret(plain, pass) {
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = deriveKey(pass, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        authTag: authTag.toString('base64'),
        kdf: 'scrypt',
        kdfN: SCRYPT_N,
        cipher: 'aes-256-gcm',
    };
}
export function decryptSecret(f, pass) {
    const salt = Buffer.from(f.salt, 'base64');
    const iv = Buffer.from(f.iv, 'base64');
    const authTag = Buffer.from(f.authTag, 'base64');
    const ciphertext = Buffer.from(f.ciphertext, 'base64');
    const key = deriveKey(pass, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }
    catch {
        throw new Error('Keystore decrypt failed — wrong passphrase or tampered ciphertext.');
    }
}
/**
 * Resolve the keystore passphrase exactly as init does: env var → existing
 * keychain entry → auto-provision into the keychain. Throws with setup
 * guidance when no source is available. Shared by both keystore inits so
 * one admin secret covers both chains.
 */
export function resolveOrProvisionPassphrase() {
    const resolved = resolvePassphrase();
    let source = resolved.source;
    let pass = resolved.value;
    if (!pass) {
        const backend = detectKeychainBackend();
        if (backend) {
            const provisioned = provisionKeychainPassphrase();
            pass = provisioned.value;
            source = 'keychain';
        }
        else {
            throw new Error('No keystore passphrase available. Either set CHAINGPT_AGENT_WALLET_PASSPHRASE ' +
                '(min 16 chars) in your shell BEFORE starting the MCP server, or run on a host with ' +
                'an OS keychain (macOS Keychain / Linux libsecret) so one can be auto-generated.');
        }
    }
    if (pass.length < MIN_PASS_LEN) {
        throw new Error(`Passphrase must be at least ${MIN_PASS_LEN} characters.`);
    }
    return { pass, source };
}
export function isKeystoreInitialized() {
    return existsSync(keystorePath());
}
export function readKeystoreFile() {
    if (!isKeystoreInitialized())
        return null;
    try {
        return JSON.parse(readFileSync(keystorePath(), 'utf8'));
    }
    catch {
        return null;
    }
}
/**
 * Generate a new EOA, encrypt the private key, write to disk.
 * Refuses to overwrite an existing keystore (use a different path or
 * delete the file manually with shell access).
 */
export function initKeystore() {
    const path = keystorePath();
    if (isKeystoreInitialized()) {
        throw new Error(`Keystore already exists at ${path}. ` +
            `Refusing to overwrite — delete the file manually if you want to regenerate.`);
    }
    // Resolve the passphrase. Priority: env var → existing keychain entry →
    // auto-generate into the keychain (if a backend is available).
    const { pass, source } = resolveOrProvisionPassphrase();
    const priv = generatePrivateKey();
    const account = privateKeyToAccount(priv);
    const plain = Buffer.from(priv.slice(2), 'hex');
    const enc = encryptSecret(plain, pass);
    plain.fill(0);
    const file = {
        version: 1,
        address: account.address,
        ...enc,
        createdAt: new Date().toISOString(),
    };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
    try {
        chmodSync(dirname(path), 0o700);
    }
    catch { /* best-effort */ }
    return { address: account.address, path, passphraseSource: source };
}
export function loadAccount() {
    const pass = passphrase();
    if (!pass) {
        throw new Error('No keystore passphrase available; cannot decrypt the keystore. ' +
            'Set CHAINGPT_AGENT_WALLET_PASSPHRASE in your shell before starting the MCP server, ' +
            'or ensure the OS keychain entry created at init is still present (it may have been ' +
            'deleted, or the keychain is locked).');
    }
    const file = readKeystoreFile();
    if (!file) {
        throw new Error(`Keystore not found at ${keystorePath()}. ` +
            `Call chaingpt_agent_wallet_init first.`);
    }
    const plain = decryptSecret(file, pass);
    const priv = ('0x' + plain.toString('hex'));
    // Wipe the plaintext buffer ASAP (best-effort — JS strings are immutable)
    plain.fill(0);
    const account = privateKeyToAccount(priv);
    // Verify the stored address matches the decrypted key — paranoia check
    if (account.address.toLowerCase() !== file.address.toLowerCase()) {
        throw new Error('Keystore integrity check failed — decrypted key does not match recorded address.');
    }
    return account;
}
