/**
 * Solana transaction-building utilities. Custody-free: the plugin never sees
 * a private key. Every function returns either a VersionedTransaction object
 * or its base64 serialization. The user signs externally (Phantom, Backpack,
 * Solflare, hardware wallet via solana-keygen, etc.) and broadcasts via their
 * preferred RPC.
 *
 * Parallel design notes vs the EVM path:
 *
 *   - EVM (viem): we return { to, data, value, chainId } objects. The user's
 *     wallet (or signer) builds + signs + broadcasts.
 *   - Solana: we return a base64-encoded VersionedTransaction (v0 message)
 *     with a fresh blockhash. The user signs the message bytes and submits.
 *
 * Solana versioned transactions are the v2 standard since 2023. Legacy
 * transactions still work, but versioned tx supports address-lookup tables
 * which become important for any non-trivial DeFi call.
 *
 * RPC: we use a public RPC fallback chain so users don't need to plug in their
 * own. Matches the EVM `jsonRpcFallback` pattern in lib/http.ts. Default chain:
 *   - https://api.mainnet-beta.solana.com  (Solana Labs public)
 *   - https://solana-rpc.publicnode.com    (PublicNode)
 *   - https://api.devnet.solana.com        (only when network=devnet)
 *
 * Users with a higher-throughput RPC (Helius, QuickNode, Triton) can override
 * via the SOLANA_RPC_URL env var.
 *
 * Threat model: this lib only constructs unsigned transactions. There is no
 * code path that holds or transmits a secret key. Callers must reject any
 * MCP-level attempt to pass `payerSecretKey` or similar.
 */
import { Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL, } from '@solana/web3.js';
// SPL Token program (classic v1). Token-2022 has its own program id; we
// detect it from the mint owner before encoding instructions.
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
// SPL Token instruction discriminators. Stable across program versions for
// the instructions we care about.
const TOKEN_IX_TRANSFER_CHECKED = 12;
const RPC_ENDPOINTS = {
    mainnet: [
        'https://api.mainnet-beta.solana.com',
        'https://solana-rpc.publicnode.com',
    ],
    devnet: ['https://api.devnet.solana.com'],
    testnet: ['https://api.testnet.solana.com'],
};
export function isMainnet(network) {
    return (network ?? 'mainnet') === 'mainnet';
}
/**
 * Build a Connection for `network`. When `SOLANA_RPC_URL` is set, that single
 * endpoint is used. Otherwise the first entry in `RPC_ENDPOINTS[network]` is
 * used as the primary; `withRpcFallback` provides retry across the rest.
 *
 * The connection is cached per (network, endpoint) tuple so repeated calls
 * within one session reuse the underlying HTTP keep-alive socket.
 */
const connCache = new Map();
export function makeConnection(network = 'mainnet') {
    const override = process.env.SOLANA_RPC_URL;
    const endpoint = override ?? RPC_ENDPOINTS[network][0];
    const key = `${network}:${endpoint}`;
    let conn = connCache.get(key);
    if (!conn) {
        conn = new Connection(endpoint, 'confirmed');
        connCache.set(key, conn);
    }
    return conn;
}
/**
 * List the endpoints the fallback chain will try, in order. Exposed so
 * `withRpcFallback` and tests can see exactly what's in play.
 */
export function rpcEndpointsFor(network = 'mainnet') {
    const override = process.env.SOLANA_RPC_URL;
    if (override)
        return [override, ...RPC_ENDPOINTS[network]];
    return [...RPC_ENDPOINTS[network]];
}
/**
 * Run an RPC call against the network's endpoint list, falling back to the
 * next endpoint on transient failure. Each endpoint gets one shot; we don't
 * retry the same endpoint twice because the typical failure modes here are
 * "endpoint is wedged" (won't help) or "endpoint is rate-limiting" (delay
 * doesn't help on a sub-second timescale).
 *
 * Errors from every endpoint are aggregated and the final throw carries the
 * full chain so the user can debug.
 */
export async function withRpcFallback(network, fn) {
    const endpoints = rpcEndpointsFor(network);
    const errors = [];
    for (const endpoint of endpoints) {
        const key = `${network}:${endpoint}`;
        let conn = connCache.get(key);
        if (!conn) {
            conn = new Connection(endpoint, 'confirmed');
            connCache.set(key, conn);
        }
        try {
            return await fn(conn);
        }
        catch (err) {
            errors.push(`${endpoint}: ${err?.message ?? String(err)}`);
        }
    }
    throw new Error(`All Solana RPC endpoints failed for ${network}:\n  ${errors.join('\n  ')}`);
}
/**
 * Parse a base58 Solana address. Returns a PublicKey or throws with a friendly
 * message. Most callers should use this rather than the raw PublicKey
 * constructor so the user gets "invalid address" not a cryptic base58 trace.
 */
export function parseAddress(addr, label = 'address') {
    if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44) {
        throw new Error(`${label}: not a Solana address (expected base58 32-44 chars, got "${addr}")`);
    }
    try {
        return new PublicKey(addr);
    }
    catch (err) {
        throw new Error(`${label}: invalid Solana address "${addr}" — ${err.message}`);
    }
}
/**
 * Build a versioned (v0) transaction message from a list of instructions,
 * fetching a fresh blockhash from the supplied connection. Returns the
 * unsigned VersionedTransaction. Caller is responsible for serializing it.
 */
export async function buildVersionedTransaction(opts) {
    const { payer, instructions, connection } = opts;
    if (instructions.length === 0) {
        throw new Error('buildVersionedTransaction: no instructions provided');
    }
    const latest = await connection.getLatestBlockhash('finalized');
    const message = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latest.blockhash,
        instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    return { tx, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
}
/** Base64-serialize an unsigned VersionedTransaction.
 *
 * VersionedTransaction.serialize() takes no options; it writes whatever lives
 * in `tx.signatures`, which defaults to zero-filled byte arrays of the right
 * count for the v0 message. Those zero bytes are placeholders the signer
 * replaces with real Ed25519 signatures before submission.
 */
export function serializeUnsigned(tx) {
    return Buffer.from(tx.serialize()).toString('base64');
}
/** Inverse of `serializeUnsigned`. Useful for downstream tools that want to inspect a built tx. */
export function deserializeUnsigned(base64) {
    return VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
}
// ─── Native SOL transfer ────────────────────────────────────────────
/**
 * SystemProgram.transfer's `lamports` parameter accepts either `number` or
 * `bigint` in @solana/web3.js 1.91+, and bigint preserves precision for
 * uint64 amounts above 2^53 (≈ 9 × 10^15 lamports — only a corner case for
 * SOL itself, but easy to hit for SPL tokens that share the lamports path).
 * We pass bigint through untouched.
 */
export function buildSolTransferInstruction(opts) {
    return SystemProgram.transfer({
        fromPubkey: opts.from,
        toPubkey: opts.to,
        lamports: opts.lamports,
    });
}
// ─── Associated Token Account derivation ─────────────────────────────
/**
 * Derive an SPL Associated Token Account (ATA) address for (owner, mint).
 * This is the canonical token-holding account derived at:
 *   PDA(seeds=[owner, tokenProgram, mint], program=ASSOCIATED_TOKEN_PROGRAM_ID)
 */
export function deriveAssociatedTokenAccount(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}
// ─── SPL Token Transfer (Checked variant) ────────────────────────────
/**
 * Build a TransferChecked instruction for the classic SPL Token program.
 * "Checked" means we include the mint pubkey + expected decimals; the
 * runtime verifies they match the source account, preventing a mint-mismatch
 * footgun. Strictly safer than the un-checked transfer.
 *
 * For Token-2022 mints, pass tokenProgramId = TOKEN_2022_PROGRAM_ID. The
 * instruction layout is identical between the two programs for this op.
 */
export function buildSplTransferCheckedInstruction(opts) {
    const programId = opts.tokenProgramId ?? TOKEN_PROGRAM_ID;
    // Layout: discriminator (u8) + amount (u64-le) + decimals (u8) = 10 bytes
    const data = Buffer.alloc(10);
    data.writeUInt8(TOKEN_IX_TRANSFER_CHECKED, 0);
    data.writeBigUInt64LE(opts.amount, 1);
    data.writeUInt8(opts.decimals, 9);
    return new TransactionInstruction({
        keys: [
            { pubkey: opts.source, isSigner: false, isWritable: true },
            { pubkey: opts.mint, isSigner: false, isWritable: false },
            { pubkey: opts.destination, isSigner: false, isWritable: true },
            { pubkey: opts.owner, isSigner: true, isWritable: false },
        ],
        programId,
        data,
    });
}
// ─── ATA Creation (idempotent) ───────────────────────────────────────
/**
 * Build a CreateAssociatedTokenAccountIdempotent instruction. Safe to include
 * unconditionally — if the ATA already exists, the runtime no-ops instead of
 * failing. Use this before any first-time-recipient SPL transfer.
 *
 * Instruction discriminator for the idempotent variant is 1 (vs 0 for the
 * fail-if-exists variant).
 */
export function buildCreateAtaIdempotentInstruction(opts) {
    return new TransactionInstruction({
        keys: [
            { pubkey: opts.payer, isSigner: true, isWritable: true },
            { pubkey: opts.ata, isSigner: false, isWritable: true },
            { pubkey: opts.owner, isSigner: false, isWritable: false },
            { pubkey: opts.mint, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System
            { pubkey: opts.tokenProgramId ?? TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        data: Buffer.from([1]), // 1 = create idempotent
    });
}
// ─── Mint Info Fetch ─────────────────────────────────────────────────
/**
 * Fetch the decimals + token program owner for an SPL mint. The mint account
 * layout for both classic Token and Token-2022 starts with the same 44-byte
 * "Mint" struct: mintAuthorityOption(4) + mintAuthority(32) + supply(8) +
 * decimals(1) + isInitialized(1). We only need decimals + the program owner
 * (to distinguish Token vs Token-2022).
 */
export async function fetchMintInfo(conn, mint) {
    const info = await conn.getAccountInfo(mint, 'confirmed');
    if (!info) {
        throw new Error(`mint ${mint.toBase58()}: account not found on this network`);
    }
    const tokenProgramId = info.owner;
    if (!tokenProgramId.equals(TOKEN_PROGRAM_ID) && !tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)) {
        throw new Error(`mint ${mint.toBase58()}: owner is ${tokenProgramId.toBase58()} ` +
            `(expected SPL Token or Token-2022 program)`);
    }
    if (info.data.length < 45) {
        throw new Error(`mint ${mint.toBase58()}: account data too short (${info.data.length} bytes)`);
    }
    // decimals is byte index 44 (mintAuthorityOption[4] + mintAuthority[32] + supply[8])
    const decimals = info.data[44];
    return { decimals, tokenProgramId };
}
// ─── Helpers exposed to callers ──────────────────────────────────────
export const SOL_LAMPORTS_PER_SOL = LAMPORTS_PER_SOL; // re-export for tools
