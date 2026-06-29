import { VersionedTransaction } from '@solana/web3.js';
import { initSolanaKeystore, isSolanaKeystoreInitialized, readSolanaKeystoreFile, loadSolanaKeypair, solanaKeystorePath, } from '../lib/agent-keystore-solana.js';
import { describeSecretSource } from '../lib/agent-keystore.js';
import { loadPolicy, policyPath, checkSolanaPolicy, } from '../lib/agent-policy.js';
import { logActivity, spendStats } from '../lib/agent-activity.js';
import { withRpcFallback, makeConnection } from '../lib/solana-sign.js';
/**
 * Agent wallet — Solana surface. The Ed25519 counterpart of the EVM
 * agent-wallet tools: the agent signs autonomously, but ONLY inside the
 * `solana` policy sub-object that no MCP tool can write.
 *
 * Composition: any existing builder (chaingpt_dex_jupiter_build_swap_tx,
 * chaingpt_defi_marginfi_*_tx, chaingpt_defi_kamino_*_tx,
 * chaingpt_solana_build_transfer_tx) → optional chaingpt_solana_decode_tx
 * review → chaingpt_agent_wallet_solana_sign_and_send.
 *
 * Security sequence in sign_and_send (order matters):
 *   parse → structural checks (sole signer, agent is fee payer, program-id
 *   enumeration) → cheap policy short-circuit (killSwitch / solana.enabled,
 *   pre-RPC) → simulate (fee-payer lamport delta) → checkSolanaPolicy (the
 *   single decision point, fail-closed) → refuse sim-failing txs → refresh
 *   blockhash → sign → send → journal to the velocity ledger.
 */
export const agentWalletSolanaTools = [
    {
        name: 'chaingpt_agent_wallet_solana_init',
        description: "Create the agent's Solana wallet: generate an Ed25519 keypair, encrypt it (AES-256-GCM, same " +
            'admin passphrase as the EVM keystore), write solana-keystore.json. One-time; refuses to overwrite. ' +
            'Solana signing additionally requires `"solana": { "enabled": true }` in the policy — fail-closed ' +
            'for every policy file that predates Solana support. 0 ChainGPT credits.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'chaingpt_agent_wallet_solana_address',
        description: "Show the agent's Solana address (base58) and current SOL balance. Fund this address to give the " +
            'agent Solana working capital — the balance itself is the outermost spending cap. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                network: { type: 'string', enum: ['mainnet', 'devnet', 'testnet'], description: 'Default mainnet.', default: 'mainnet' },
            },
            required: [],
        },
    },
    {
        name: 'chaingpt_agent_wallet_solana_sign_and_send',
        description: 'Sign an UNSIGNED Solana VersionedTransaction (base64, from any chaingpt builder tool) with the ' +
            "agent's Ed25519 key and broadcast it — gated by the deterministic Solana policy chokepoint: " +
            'program-id allowlist, simulated fee-payer lamport caps (fail-closed on simulation failure), ' +
            'rolling-24h velocity caps, memo requirement, kill switch. The agent must be the sole signer and ' +
            'fee payer. No MCP tool can relax the policy. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                txBase64: { type: 'string', description: 'Unsigned VersionedTransaction, base64 (from a chaingpt builder tool).' },
                memo: { type: 'string', description: 'Audit-trail memo. Required if policy.solana.requireMemo=true.' },
                network: { type: 'string', enum: ['mainnet', 'devnet', 'testnet'], description: 'Default mainnet.', default: 'mainnet' },
                waitForConfirmation: { type: 'boolean', description: 'Wait for confirmed commitment. Default true.', default: true },
                skipPreflight: { type: 'boolean', description: 'Skip RPC preflight on send (the policy gate already simulated). Default false.', default: false },
            },
            required: ['txBase64'],
        },
    },
];
const fmtSol = (lamports) => (Number(lamports) / 1e9).toFixed(6);
export async function handleAgentWalletSolanaTool(name, args) {
    args = args ?? {};
    try {
        if (name === 'chaingpt_agent_wallet_solana_init') {
            const { address, path, passphraseSource } = initSolanaKeystore();
            return {
                content: [{
                        type: 'text',
                        text: [
                            `✓ Agent Solana wallet created.`,
                            ``,
                            `Address:     ${address}`,
                            `Keystore:    ${path} (AES-256-GCM, 0600)`,
                            `Passphrase:  ${describeSecretSource(passphraseSource)} (same admin secret as the EVM keystore)`,
                            ``,
                            `Next:`,
                            `  1. Enable Solana in the policy (admin-only): add "solana": { "enabled": true, ... } —`,
                            `     the Balanced DeFi template ships a tight starter block (0.1 SOL/tx, 0.3 SOL/day, 20 tx/day).`,
                            `  2. Fund ${address} with only the working capital you intend the agent to use.`,
                            `  3. Build any unsigned tx (Jupiter / Marginfi / Kamino / transfer) → chaingpt_agent_wallet_solana_sign_and_send.`,
                        ].join('\n'),
                    }],
            };
        }
        if (name === 'chaingpt_agent_wallet_solana_address') {
            const file = readSolanaKeystoreFile();
            if (!file) {
                return { content: [{ type: 'text', text: 'Agent Solana wallet not initialized. Call chaingpt_agent_wallet_solana_init first.' }] };
            }
            const network = (String(args.network ?? 'mainnet'));
            let balanceLine = 'Balance:     (RPC unavailable)';
            try {
                const { PublicKey } = await import('@solana/web3.js');
                const lamports = await withRpcFallback(network, (conn) => conn.getBalance(new PublicKey(file.address)));
                balanceLine = `Balance:     ${fmtSol(BigInt(lamports))} SOL (${network})`;
            }
            catch { /* surface the friendly placeholder */ }
            return {
                content: [{
                        type: 'text',
                        text: [`Agent Solana wallet`, ``, `Address:     ${file.address}`, balanceLine, `Keystore:    ${solanaKeystorePath()}`].join('\n'),
                    }],
            };
        }
        if (name === 'chaingpt_agent_wallet_solana_sign_and_send') {
            if (!isSolanaKeystoreInitialized()) {
                return { content: [{ type: 'text', text: 'Agent Solana wallet not initialized. Call chaingpt_agent_wallet_solana_init first.' }] };
            }
            const file = readSolanaKeystoreFile();
            const agentAddress = file.address;
            const network = (String(args.network ?? 'mainnet'));
            const memo = args.memo ? String(args.memo) : undefined;
            const skipPreflight = Boolean(args.skipPreflight ?? false);
            const waitForConfirmation = args.waitForConfirmation !== false;
            // 1. Parse
            let tx;
            try {
                tx = VersionedTransaction.deserialize(Buffer.from(String(args.txBase64 ?? ''), 'base64'));
            }
            catch (e) {
                return { content: [{ type: 'text', text: `Could not parse txBase64 as a VersionedTransaction: ${e?.message ?? e}. Pass the base64 emitted by a chaingpt builder tool.` }] };
            }
            const msg = tx.message;
            // 2. Structural checks — deterministic, pre-RPC
            if (msg.header.numRequiredSignatures !== 1) {
                return {
                    content: [{
                            type: 'text',
                            text: `⛔ Refused: transaction requires ${msg.header.numRequiredSignatures} signatures. The agent only signs transactions where it is the SOLE signer (co-signing someone else's tx is out of scope by design).`,
                        }],
                };
            }
            const feePayer = msg.staticAccountKeys[0]?.toBase58() ?? '';
            if (feePayer !== agentAddress) {
                return {
                    content: [{
                            type: 'text',
                            text: `⛔ Refused: fee payer ${feePayer} is not the agent wallet ${agentAddress}. Rebuild the unsigned tx with the agent's address as payer/user (the builder tools take an address argument).`,
                        }],
                };
            }
            let programIds;
            try {
                programIds = [...new Set(msg.compiledInstructions.map((ix) => {
                        const p = msg.staticAccountKeys[ix.programIdIndex];
                        if (!p)
                            throw new Error(`programIdIndex ${ix.programIdIndex} is out of bounds`);
                        return p.toBase58();
                    }))];
            }
            catch (e) {
                return {
                    content: [{
                            type: 'text',
                            text: `⛔ Refused: malformed transaction (${e?.message ?? e}). The structural checks are deterministic — a tx whose instruction program cannot be resolved is never signed.`,
                        }],
                };
            }
            // 3. Cheap policy short-circuit BEFORE any RPC (kill switch / not enabled)
            const policy = loadPolicy();
            if (policy.killSwitch || !policy.solana?.enabled) {
                const decision = checkSolanaPolicy({ programIds, feePayer, memo, sim: { ok: false } }, policy, spendStats(24, 'solana'));
                return refusalBlock(decision.reason, decision.policyDigest);
            }
            // 4. Simulate — fee-payer lamport delta is the spend measure
            let sim = { ok: false };
            try {
                const result = await withRpcFallback(network, async (conn) => {
                    const pre = await conn.getBalance(msg.staticAccountKeys[0]);
                    const s = await conn.simulateTransaction(tx, {
                        sigVerify: false,
                        replaceRecentBlockhash: true,
                        accounts: { encoding: 'base64', addresses: [feePayer] },
                    });
                    return { pre, s };
                });
                const acct = result.s.value.accounts?.[0];
                if (acct === null) {
                    // The fee payer vanished from the simulated post-state (e.g. drained
                    // to zero). Distinct from "accounts missing": treat as simulation
                    // unavailable so every lamport cap fails CLOSED instead of metering 0.
                    sim = { ok: false };
                }
                else {
                    const post = acct?.lamports;
                    const delta = post !== undefined ? BigInt(result.pre) - BigInt(post) : undefined;
                    sim = {
                        ok: true,
                        lamportDelta: delta !== undefined && delta > 0n ? delta : 0n,
                        err: result.s.value.err ? JSON.stringify(result.s.value.err) : null,
                    };
                }
            }
            catch {
                sim = { ok: false };
            }
            // 5. The single policy decision point (fail-closed semantics inside)
            const decision = checkSolanaPolicy({ programIds, feePayer, memo, sim }, policy, spendStats(24, 'solana'));
            if (!decision.allowed) {
                return refusalBlock(decision.reason, decision.policyDigest);
            }
            // 6a. Never broadcast UNSIMULATED — applies even in unrestricted mode
            // (the policy gate allows unrestricted before the lamport checks run,
            // so this handler-level refusal is the backstop).
            if (!sim.ok) {
                return {
                    content: [{
                            type: 'text',
                            text: `⛔ Refused: the transaction could not be simulated (RPC unavailable or fee-payer state unreadable). A policy-fenced agent never broadcasts blind — not even in unrestricted mode. Check SOLANA_RPC_URL and retry.`,
                        }],
                };
            }
            // 6b. Never autonomously broadcast a tx that simulates to failure
            if (sim.ok && sim.err) {
                return {
                    content: [{
                            type: 'text',
                            text: `⛔ Refused: the transaction simulates to failure (${sim.err}). A policy-fenced agent never broadcasts a tx that cannot succeed — it would only burn fees. Fix the underlying build (balance? slippage? stale route?) and retry.`,
                        }],
                };
            }
            // 7. Sign ONCE, then send. The tx is signed exactly one time and the
            // serialized bytes are frozen BEFORE any retry loop: re-signing inside a
            // fallback would mint a second, different transaction (new blockhash ⇒
            // new signature) and a confirmation timeout could double-spend. Retrying
            // sendRawTransaction with the SAME bytes is safe — validators dedupe by
            // signature. confirmTransaction is never retried by re-sending.
            const keypair = loadSolanaKeypair();
            const { blockhash, lastValidBlockHeight } = await withRpcFallback(network, (conn) => conn.getLatestBlockhash('finalized'));
            tx.message.recentBlockhash = blockhash; // sole signer → safe to refresh
            tx.sign([keypair]);
            const rawTx = tx.serialize();
            const signature = await withRpcFallback(network, (conn) => conn.sendRawTransaction(rawTx, { skipPreflight }));
            if (waitForConfirmation) {
                try {
                    await makeConnection(network).confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
                }
                catch (e) {
                    // The tx was broadcast; only the confirmation poll failed. Surface
                    // that honestly instead of retrying anything.
                    return {
                        content: [{
                                type: 'text',
                                text: `Transaction SENT (signature ${signature}) but confirmation polling failed: ${e?.message ?? e}. Check https://solscan.io/tx/${signature} before doing anything else — do NOT re-send.`,
                            }],
                    };
                }
            }
            const lamportDelta = sim.lamportDelta ?? 0n;
            // 8. Journal — feeds the lamport velocity caps
            try {
                logActivity({
                    ts: new Date().toISOString(),
                    chain: network === 'mainnet' ? 'solana' : `solana-${network}`,
                    chainId: 0,
                    from: agentAddress,
                    to: programIds.join(','),
                    valueWei: lamportDelta.toString(),
                    hash: signature,
                    memo,
                    policyDigest: decision.policyDigest,
                });
            }
            catch { /* best-effort */ }
            return {
                content: [{
                        type: 'text',
                        text: [
                            `✓ Signed and ${waitForConfirmation ? 'confirmed' : 'sent'} on Solana ${network}.`,
                            ``,
                            `Signature:      ${signature}`,
                            `Explorer:       https://solscan.io/tx/${signature}${network !== 'mainnet' ? `?cluster=${network}` : ''}`,
                            `Simulated cost: ${fmtSol(lamportDelta)} SOL (fee-payer delta, journaled to the velocity ledger)`,
                            `Programs:       ${programIds.join(', ')}`,
                            `Memo:           ${memo ?? '(none)'}`,
                            `Policy digest:  ${decision.policyDigest}`,
                        ].join('\n'),
                    }],
            };
        }
        return { content: [{ type: 'text', text: `Unknown agent-wallet-solana tool: ${name}` }] };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChainGPT Agent Wallet (Solana) error: ${message}`);
    }
}
function refusalBlock(reason, digest) {
    return {
        content: [{
                type: 'text',
                text: [
                    `⛔ Policy refused this Solana transaction.`,
                    ``,
                    `Reason:        ${reason}`,
                    `Policy digest: ${digest}`,
                    `Policy file:   ${policyPath()}`,
                    ``,
                    `If this refusal is wrong, an admin must edit the policy file with a text editor.`,
                    `No MCP tool can relax these rules from inside the agent.`,
                ].join('\n'),
            }],
    };
}
