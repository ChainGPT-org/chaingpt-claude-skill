import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey } from '@solana/web3.js';

import './_setup.js';
// Never touch the real OS keychain from tests — force env-var-only resolution.
process.env.CHAINGPT_DISABLE_KEYCHAIN = '1';
process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'super-long-passphrase-for-tests-only-1234';

const TMP = mkdtempSync(join(tmpdir(), 'chaingpt-solana-keystore-test-'));

import {
  initSolanaKeystore,
  loadSolanaKeypair,
  isSolanaKeystoreInitialized,
  readSolanaKeystoreFile,
} from '../lib/agent-keystore-solana.js';

let n = 0;
beforeEach(() => {
  // fresh keystore path per test
  process.env.CHAINGPT_SOLANA_KEYSTORE_FILE = join(TMP, `ks-${n++}.json`);
});

afterAll(() => {
  delete process.env.CHAINGPT_SOLANA_KEYSTORE_FILE;
  rmSync(TMP, { recursive: true, force: true });
});

describe('Solana keystore', () => {
  it('init creates a 0600 ed25519 keystore with a valid base58 address', () => {
    const { address, path } = initSolanaKeystore();
    expect(() => new PublicKey(address)).not.toThrow();
    const file = readSolanaKeystoreFile()!;
    expect(file.curve).toBe('ed25519');
    expect(file.cipher).toBe('aes-256-gcm');
    expect(file.kdf).toBe('scrypt');
    expect(file.address).toBe(address);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('init refuses to overwrite an existing keystore', () => {
    initSolanaKeystore();
    expect(() => initSolanaKeystore()).toThrow(/already exists/);
  });

  it('roundtrip: decrypted keypair reproduces the recorded address', () => {
    const { address } = initSolanaKeystore();
    const kp = loadSolanaKeypair();
    expect(kp.publicKey.toBase58()).toBe(address);
    expect(isSolanaKeystoreInitialized()).toBe(true);
  });

  it('wrong passphrase fails decryption loudly', () => {
    initSolanaKeystore();
    const orig = process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE;
    process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = 'a-completely-different-passphrase-456';
    try {
      expect(() => loadSolanaKeypair()).toThrow(/decrypt failed/);
    } finally {
      process.env.CHAINGPT_AGENT_WALLET_PASSPHRASE = orig;
    }
  });

  it('tampered ciphertext fails the GCM auth tag', () => {
    initSolanaKeystore();
    const path = process.env.CHAINGPT_SOLANA_KEYSTORE_FILE!;
    const file = JSON.parse(readFileSync(path, 'utf8'));
    const buf = Buffer.from(file.ciphertext, 'base64');
    buf[0] ^= 0xff;
    file.ciphertext = buf.toString('base64');
    writeFileSync(path, JSON.stringify(file));
    expect(() => loadSolanaKeypair()).toThrow(/decrypt failed/);
  });

  it('missing keystore gives the init hint', () => {
    expect(() => loadSolanaKeypair()).toThrow(/chaingpt_agent_wallet_solana_init/);
  });
});
