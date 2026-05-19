import './_setup.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

import {
  solanaTools,
  handleSolanaTool,
  _internal,
} from '../tools/solana.js';
import {
  parseAddress,
  buildSolTransferInstruction,
  buildSplTransferCheckedInstruction,
  buildCreateAtaIdempotentInstruction,
  deriveAssociatedTokenAccount,
  buildVersionedTransaction,
  serializeUnsigned,
  deserializeUnsigned,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '../lib/solana-sign.js';

// ─── A pair of known-valid Solana addresses for tests ─────────────
const ALICE = '7uDsTC1u4eRkxsfvQHvi3vCSqGBHc4uS9wpYbobcdEUd'; // arbitrary valid base58 pubkey
const BOB = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';   // arbitrary valid base58 pubkey
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';  // real USDC mint on mainnet

// ─── Tool surface assertions ──────────────────────────────────────
describe('solana tool surface', () => {
  it('exports exactly the two expected tools with the chaingpt_solana_ prefix', () => {
    expect(solanaTools.map((t) => t.name).sort()).toEqual([
      'chaingpt_solana_build_transfer_tx',
      'chaingpt_solana_decode_tx',
    ]);
  });

  it('every solana tool has name + description + inputSchema with required fields', () => {
    for (const t of solanaTools) {
      expect(t.name).toMatch(/^chaingpt_solana_/);
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
      expect((t.inputSchema as any).type).toBe('object');
    }
  });

  it('does NOT export any tool that would accept a private key', () => {
    // Belt-and-suspenders: enforce that no input schema parameter is named anything that smells like a secret.
    const FORBIDDEN = /secret|privatekey|private_key|mnemonic|seedphrase|seed_phrase/i;
    for (const t of solanaTools) {
      const props = (t.inputSchema as any).properties ?? {};
      for (const key of Object.keys(props)) {
        expect(key).not.toMatch(FORBIDDEN);
      }
    }
  });
});

// ─── parseAddress ─────────────────────────────────────────────────
describe('parseAddress', () => {
  it('parses a valid base58 address', () => {
    const pk = parseAddress(ALICE);
    expect(pk).toBeInstanceOf(PublicKey);
    expect(pk.toBase58()).toBe(ALICE);
  });

  it('throws with a friendly label on a too-short input', () => {
    expect(() => parseAddress('abc', 'recipient')).toThrow(/recipient: not a Solana address/);
  });

  it('throws on a base58 string of the right length but invalid checksum', () => {
    // 43 valid-looking chars but not a real key on the curve
    expect(() => parseAddress('1'.repeat(43), 'from')).toThrow(/from:/);
  });
});

// ─── decimalToBaseUnits ───────────────────────────────────────────
describe('decimalToBaseUnits', () => {
  const { decimalToBaseUnits } = _internal;

  it('handles whole numbers', () => {
    expect(decimalToBaseUnits('1', 9)).toBe(1_000_000_000n);
    expect(decimalToBaseUnits('100', 6)).toBe(100_000_000n);
  });

  it('handles fractional amounts up to the decimal cap', () => {
    expect(decimalToBaseUnits('1.5', 9)).toBe(1_500_000_000n);
    expect(decimalToBaseUnits('0.000001', 6)).toBe(1n);
    expect(decimalToBaseUnits('1.5', 6)).toBe(1_500_000n);
  });

  it('handles zero', () => {
    expect(decimalToBaseUnits('0', 9)).toBe(0n);
    expect(decimalToBaseUnits('0.0', 9)).toBe(0n);
  });

  it('rejects more fractional digits than the mint has decimals', () => {
    expect(() => decimalToBaseUnits('1.1234567', 6))
      .toThrow(/7 fractional digits but mint has only 6/);
  });

  it('rejects malformed inputs', () => {
    expect(() => decimalToBaseUnits('abc', 9)).toThrow(/invalid decimal/);
    expect(() => decimalToBaseUnits('-1', 9)).toThrow(/invalid decimal/);
    expect(() => decimalToBaseUnits('1.2.3', 9)).toThrow(/invalid decimal/);
    expect(() => decimalToBaseUnits('', 9)).toThrow(/invalid decimal/);
  });

  it('refuses numeric inputs (forces caller to use string to avoid float drift)', () => {
    expect(() => decimalToBaseUnits(1.5 as any, 9)).toThrow(/amount must be a string/);
  });
});

// ─── ATA derivation ────────────────────────────────────────────────
describe('deriveAssociatedTokenAccount', () => {
  it('derives a deterministic ATA for (owner, mint)', () => {
    const owner = new PublicKey(ALICE);
    const mint = new PublicKey(USDC);
    const ata = deriveAssociatedTokenAccount(owner, mint);
    expect(ata).toBeInstanceOf(PublicKey);
    // Same inputs → same output
    expect(deriveAssociatedTokenAccount(owner, mint).toBase58()).toBe(ata.toBase58());
  });

  it('produces different ATAs for the classic Token vs Token-2022 program', () => {
    const owner = new PublicKey(ALICE);
    const mint = new PublicKey(USDC);
    const classic = deriveAssociatedTokenAccount(owner, mint, TOKEN_PROGRAM_ID);
    const t22 = deriveAssociatedTokenAccount(owner, mint, TOKEN_2022_PROGRAM_ID);
    expect(classic.toBase58()).not.toBe(t22.toBase58());
  });
});

// ─── Instruction builders ──────────────────────────────────────────
describe('instruction builders', () => {
  it('SOL transfer ix has correct program id + key layout', () => {
    const from = new PublicKey(ALICE);
    const to = new PublicKey(BOB);
    const ix = buildSolTransferInstruction({ from, to, lamports: 1_000_000_000 });
    // SystemProgram.transfer uses SystemProgram (11111111111111111111111111111111)
    expect(ix.programId.toBase58()).toBe('11111111111111111111111111111111');
    expect(ix.keys[0].pubkey.toBase58()).toBe(ALICE);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[1].pubkey.toBase58()).toBe(BOB);
    expect(ix.keys[1].isSigner).toBe(false);
  });

  it('SPL TransferChecked ix encodes amount + decimals at known offsets', () => {
    const from = new PublicKey(ALICE);
    const to = new PublicKey(BOB);
    const mint = new PublicKey(USDC);
    const sourceAta = deriveAssociatedTokenAccount(from, mint);
    const destAta = deriveAssociatedTokenAccount(to, mint);
    const ix = buildSplTransferCheckedInstruction({
      source: sourceAta,
      destination: destAta,
      owner: from,
      mint,
      amount: 1_500_000n, // 1.5 of a 6-decimal token
      decimals: 6,
    });
    expect(ix.programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    // discriminator
    expect(ix.data[0]).toBe(12);
    // amount little-endian u64 = 1_500_000
    expect(ix.data.readBigUInt64LE(1)).toBe(1_500_000n);
    // decimals byte
    expect(ix.data[9]).toBe(6);
    // keys: source, mint, dest, owner (signer)
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      sourceAta.toBase58(),
      mint.toBase58(),
      destAta.toBase58(),
      from.toBase58(),
    ]);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].isWritable).toBe(false);
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it('create-ATA-idempotent ix uses the right program + discriminator', () => {
    const from = new PublicKey(ALICE);
    const to = new PublicKey(BOB);
    const mint = new PublicKey(USDC);
    const destAta = deriveAssociatedTokenAccount(to, mint);
    const ix = buildCreateAtaIdempotentInstruction({ payer: from, ata: destAta, owner: to, mint });
    expect(ix.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    expect(ix.data.length).toBe(1);
    expect(ix.data[0]).toBe(1); // 1 = idempotent variant
    expect(ix.keys[0].pubkey.toBase58()).toBe(ALICE); // payer
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[1].pubkey.toBase58()).toBe(destAta.toBase58());
    expect(ix.keys[2].pubkey.toBase58()).toBe(BOB); // owner
  });
});

// ─── buildVersionedTransaction + ser/de round-trip ─────────────────
describe('buildVersionedTransaction round-trip', () => {
  it('builds, serializes, and deserializes back to the same instructions', async () => {
    const payer = new PublicKey(ALICE);
    const to = new PublicKey(BOB);
    const conn = {
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
        lastValidBlockHeight: 12345,
      }),
    } as any;
    const ix = buildSolTransferInstruction({ from: payer, to, lamports: 1000 });
    const { tx, blockhash, lastValidBlockHeight } = await buildVersionedTransaction({
      payer,
      instructions: [ix],
      connection: conn,
    });
    expect(blockhash).toBe('GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi');
    expect(lastValidBlockHeight).toBe(12345);

    const base64 = serializeUnsigned(tx);
    expect(base64).toMatch(/^[A-Za-z0-9+/=]+$/);

    const decoded = deserializeUnsigned(base64);
    expect(decoded).toBeInstanceOf(VersionedTransaction);
    expect(decoded.message.staticAccountKeys[0].toBase58()).toBe(ALICE);
    expect(decoded.message.recentBlockhash).toBe(blockhash);
    expect(decoded.message.compiledInstructions).toHaveLength(1);
  });

  it('throws on an empty instruction list', async () => {
    const payer = new PublicKey(ALICE);
    const conn = { getLatestBlockhash: vi.fn() } as any;
    await expect(buildVersionedTransaction({ payer, instructions: [], connection: conn }))
      .rejects.toThrow(/no instructions provided/);
  });
});

// ─── handleSolanaTool — build_transfer_tx ──────────────────────────
describe('handleSolanaTool — build_transfer_tx mainnet gate', () => {
  it('refuses to build on mainnet without acknowledgeMainnet:true', async () => {
    const res = await handleSolanaTool('chaingpt_solana_build_transfer_tx', {
      from: ALICE,
      to: BOB,
      amount: '0.001',
      network: 'mainnet',
    });
    const text = res.content[0].text;
    expect(text).toMatch(/Refusing to build a Solana mainnet transaction without acknowledgeMainnet:true/);
  });

  it('explicit mainnet refusal message lists what to verify before re-call', async () => {
    const res = await handleSolanaTool('chaingpt_solana_build_transfer_tx', {
      from: ALICE,
      to: BOB,
      amount: '1.0',
      network: 'mainnet',
      acknowledgeMainnet: false,
    });
    const text = res.content[0].text;
    expect(text).toMatch(/verified the recipient address/);
    expect(text).toMatch(/verified the amount/);
  });

  it('rejects an unsupported network', async () => {
    const res = await handleSolanaTool('chaingpt_solana_build_transfer_tx', {
      from: ALICE,
      to: BOB,
      amount: '1.0',
      network: 'eclipse', // not a Solana network we accept
    });
    const text = res.content[0].text;
    expect(text).toMatch(/network: "eclipse" not supported/);
  });
});

// ─── handleSolanaTool — build_transfer_tx happy path (devnet, mocked RPC) ──
describe('handleSolanaTool — devnet native SOL transfer', () => {
  beforeEach(() => {
    // Mock the Connection.getLatestBlockhash so we never hit the network.
    vi.spyOn(
      (require('@solana/web3.js') as any).Connection.prototype,
      'getLatestBlockhash',
    ).mockResolvedValue({
      blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
      lastValidBlockHeight: 200_000_000,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a SOL transfer on devnet without acknowledgeMainnet', async () => {
    const res = await handleSolanaTool('chaingpt_solana_build_transfer_tx', {
      from: ALICE,
      to: BOB,
      amount: '0.1',
      network: 'devnet',
    });
    const text = res.content[0].text;
    expect(text).toMatch(/Solana DEVNET unsigned transaction/);
    expect(text).toMatch(/Native SOL transfer/);
    expect(text).toMatch(/0.1 SOL .100000000 lamports/);
    expect(text).toMatch(/UNSIGNED VersionedTransaction \(base64\)/);
    // Extract and round-trip the base64 to confirm it is real
    const m = text.match(/--- UNSIGNED VersionedTransaction \(base64\) ---\n([A-Za-z0-9+/=]+)\n--- END ---/);
    expect(m).toBeTruthy();
    const tx = deserializeUnsigned(m![1]);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(ALICE);
  });

  it('rejects an invalid sender address with a clear error', async () => {
    const res = await handleSolanaTool('chaingpt_solana_build_transfer_tx', {
      from: 'not-base58',
      to: BOB,
      amount: '0.1',
      network: 'devnet',
    });
    const text = res.content[0].text;
    expect(text).toMatch(/Error in chaingpt_solana_build_transfer_tx/);
    expect(text).toMatch(/from:/);
  });

  it('rejects an amount with more fractional digits than SOL allows', async () => {
    const res = await handleSolanaTool('chaingpt_solana_build_transfer_tx', {
      from: ALICE,
      to: BOB,
      amount: '0.0000000001', // 10 frac digits > 9 (LAMPORTS_PER_SOL exponent)
      network: 'devnet',
    });
    const text = res.content[0].text;
    expect(text).toMatch(/10 fractional digits but mint has only 9/);
  });
});

// ─── handleSolanaTool — decode_tx ──────────────────────────────────
describe('handleSolanaTool — decode_tx', () => {
  it('decodes a freshly built native SOL tx back to its program ids + instruction count', async () => {
    // Build a tx with a stubbed connection, then feed its base64 back into decode_tx.
    const payer = new PublicKey(ALICE);
    const to = new PublicKey(BOB);
    const conn = {
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
        lastValidBlockHeight: 1,
      }),
    } as any;
    const ix = buildSolTransferInstruction({ from: payer, to, lamports: 5 });
    const { tx } = await buildVersionedTransaction({ payer, instructions: [ix], connection: conn });
    const base64 = serializeUnsigned(tx);

    const res = await handleSolanaTool('chaingpt_solana_decode_tx', { txBase64: base64 });
    const text = res.content[0].text;
    expect(text).toMatch(/Decoded Solana VersionedTransaction/);
    expect(text).toMatch(`payer:                    ${ALICE}`);
    expect(text).toMatch(/instructions: 1/);
    expect(text).toMatch(/System Program/);
  });

  it('returns a friendly error on garbage base64', async () => {
    const res = await handleSolanaTool('chaingpt_solana_decode_tx', { txBase64: 'not-a-tx' });
    const text = res.content[0].text;
    expect(text).toMatch(/Could not decode VersionedTransaction/);
  });

  it('requires txBase64', async () => {
    const res = await handleSolanaTool('chaingpt_solana_decode_tx', {});
    const text = res.content[0].text;
    expect(text).toMatch(/txBase64 required/);
  });
});

// ─── handleSolanaTool — unknown tool name + missing args guard ─────
describe('handleSolanaTool — unknown name + missing args guard', () => {
  it('returns a friendly error on an unknown solana tool', async () => {
    const res = await handleSolanaTool('chaingpt_solana_does_not_exist', {});
    expect(res.content[0].text).toMatch(/Unknown Solana tool/);
  });

  it('does NOT throw a TypeError when args is undefined — mainnet gate refuses cleanly', async () => {
    // args=undefined defaults network='mainnet' and acknowledgeMainnet=undefined, so the
    // mainnet refusal kicks in (which is exactly the defensive behavior we want — the
    // pre-flight gate catches missing args BEFORE any address parsing). The key assertion
    // is that the handler did not throw a TypeError accessing props on undefined.
    const res = await handleSolanaTool('chaingpt_solana_build_transfer_tx', undefined as any);
    const text = res.content[0].text;
    expect(text).toMatch(/Refusing to build a Solana mainnet transaction/);
  });

  it('does NOT throw on null args for decode_tx', async () => {
    const res = await handleSolanaTool('chaingpt_solana_decode_tx', null as any);
    expect(res.content[0].text).toMatch(/txBase64 required/);
  });
});

// ─── withRpcFallback ───────────────────────────────────────────────
describe('withRpcFallback', () => {
  it('returns the first successful endpoint result without trying the rest', async () => {
    const { withRpcFallback } = await import('../lib/solana-sign.js');
    let calls = 0;
    const result = await withRpcFallback('mainnet', async () => {
      calls++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('falls back to the next endpoint when the first throws', async () => {
    const { withRpcFallback, rpcEndpointsFor } = await import('../lib/solana-sign.js');
    const endpoints = rpcEndpointsFor('mainnet');
    expect(endpoints.length).toBeGreaterThanOrEqual(2);

    let calls = 0;
    const result = await withRpcFallback('mainnet', async () => {
      calls++;
      if (calls === 1) throw new Error('endpoint #1 down');
      return 'recovered';
    });
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('throws a chain-aggregated error when every endpoint fails', async () => {
    const { withRpcFallback } = await import('../lib/solana-sign.js');
    let calls = 0;
    await expect(
      withRpcFallback('mainnet', async () => {
        calls++;
        throw new Error(`failure #${calls}`);
      }),
    ).rejects.toThrow(/All Solana RPC endpoints failed for mainnet/);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

// ─── lamports precision ────────────────────────────────────────────
describe('buildSolTransferInstruction lamports precision', () => {
  it('passes bigint through unchanged — no Number() coercion that loses precision above 2^53', () => {
    const huge = 2n ** 60n; // well above MAX_SAFE_INTEGER (2^53)
    const ix = buildSolTransferInstruction({
      from: new PublicKey(ALICE),
      to: new PublicKey(BOB),
      lamports: huge,
    });
    // SystemProgram instruction-data layout: [u32 discriminator=2, u64 LE lamports]
    // i.e. lamports occupies bytes 4..12 of the instruction data.
    expect(ix.data.length).toBeGreaterThanOrEqual(12);
    expect(ix.data.readBigUInt64LE(4)).toBe(huge);
  });
});
