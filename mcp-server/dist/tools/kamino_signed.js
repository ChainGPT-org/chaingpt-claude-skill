import { PublicKey, VersionedTransaction, TransactionMessage, } from '@solana/web3.js';
import { parseAddress, makeConnection, serializeUnsigned, fetchMintInfo } from '../lib/solana-sign.js';
import { formatSimResult } from '../lib/solana-sim.js';
/**
 * Tier-6.5c Kamino Lending (klend) signed actions — deposit + withdraw.
 * Custody-free: the plugin builds an UNSIGNED Solana VersionedTransaction and
 * returns it base64-encoded. The user signs externally (Phantom / Backpack /
 * hardware wallet) and broadcasts. The plugin never holds a Solana key.
 *
 * Correctness: the instruction set is produced by Kamino's OWN SDK
 * (`@kamino-finance/klend-sdk`, `KaminoAction.buildDepositTxns` /
 * `buildWithdrawTxns`), which resolves the live on-chain reserve/obligation
 * PDAs, the correct account ordering, lookup tables, and the V2 instruction
 * variants. We do NOT hand-roll the instruction. Verified live against mainnet
 * (the program reaches `DepositReserveLiquidityAndObligationCollateralV2`),
 * which is why we pin klend-sdk 5.x (web3.js v1) — it decodes the current
 * on-chain program; the 7.x line moved to @solana/kit (web3.js v2), a
 * different paradigm from the rest of this codebase's Solana tools.
 *
 * The SDK is heavy; it is imported LAZILY (dynamic import inside the handler)
 * so the base MCP server startup is not slowed.
 *
 * Verification: every built tx is run through `simulateTransaction` against
 * mainnet before it is returned. A malformed instruction surfaces as a
 * pre-handler deserialize/account error; a well-formed instruction reaches the
 * Kamino program handler and then either succeeds or fails only for state
 * reasons (e.g. insufficient balance / no position). See lib/solana-sim.ts.
 *
 * Mainnet-only: Kamino runs on Solana mainnet. acknowledgeMainnet:true is
 * required, same gate as the Marginfi + EVM tools.
 */
const KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
// Kamino's canonical "Main" lending market (most reserves / deepest liquidity).
// Users can target a different market via the `market` arg.
const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
// Sentinel for "withdraw the entire position" — klend caps it at the actual balance.
const U64_MAX = '18446744073709551615';
export const kaminoSignedTools = [
    {
        name: 'chaingpt_defi_kamino_deposit_tx',
        description: 'Build an UNSIGNED Kamino Lending deposit transaction (Solana mainnet, custody-free). Lends/supplies a token ' +
            "into a Kamino reserve. The instructions are encoded by Kamino's own SDK (correct reserve/obligation PDAs + " +
            'lookup tables) and the built tx is simulated against mainnet before return. Creates the obligation if needed. ' +
            'Returns a base64 VersionedTransaction the user signs with Phantom / Backpack / hardware wallet. ' +
            'acknowledgeMainnet:true required. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Base58 owner address. Signs + pays fees + owns the deposit.' },
                symbol: { type: 'string', description: 'Token symbol of the reserve (e.g. "USDC", "SOL", "USDT"). Either symbol or mint is required.' },
                mint: { type: 'string', description: 'Base58 token mint of the reserve. Use instead of symbol for exact targeting.' },
                amount: { type: 'string', description: 'Human-readable amount as a string (e.g. "100" USDC, "1.5" SOL). Converted to base units via the mint decimals.' },
                market: { type: 'string', description: `Optional lending-market pubkey. Default: Kamino Main market (${KAMINO_MAIN_MARKET}).` },
                acknowledgeMainnet: { type: 'boolean', description: 'Must be true. Kamino is mainnet-only.', default: false },
            },
            required: ['from', 'amount'],
        },
    },
    {
        name: 'chaingpt_defi_kamino_withdraw_tx',
        description: 'Build an UNSIGNED Kamino Lending withdraw transaction (Solana mainnet, custody-free). Withdraws a previously ' +
            "supplied token from a Kamino reserve back to the user. Encoded by Kamino's SDK + simulated against mainnet " +
            'before return. Returns a base64 VersionedTransaction for external signing. acknowledgeMainnet:true required. ' +
            '0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Base58 owner address with the Kamino deposit position.' },
                symbol: { type: 'string', description: 'Token symbol of the reserve to withdraw from. Either symbol or mint required.' },
                mint: { type: 'string', description: 'Base58 token mint of the reserve. Use instead of symbol.' },
                amount: { type: 'string', description: 'Human-readable amount to withdraw. Ignored if withdrawAll=true.' },
                withdrawAll: { type: 'boolean', description: 'Withdraw the entire supplied balance for this reserve. Default false.', default: false },
                market: { type: 'string', description: `Optional lending-market pubkey. Default: Kamino Main market (${KAMINO_MAIN_MARKET}).` },
                acknowledgeMainnet: { type: 'boolean', description: 'Must be true. Kamino is mainnet-only.', default: false },
            },
            required: ['from'],
        },
    },
];
// Convert a human-readable decimal string to integer base units for `decimals`.
function toBaseUnits(human, decimals) {
    const s = human.trim();
    if (!/^\d+(\.\d+)?$/.test(s))
        throw new Error(`amount "${human}" is not a valid non-negative decimal number.`);
    const [whole, frac = ''] = s.split('.');
    if (frac.length > decimals) {
        throw new Error(`amount "${human}" has more decimal places than the token supports (${decimals}).`);
    }
    const fracPadded = frac.padEnd(decimals, '0');
    const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, '');
    return combined === '' ? '0' : combined;
}
async function buildKaminoAction(kind, args) {
    if (args.acknowledgeMainnet !== true) {
        return [
            `Refusing to build a Kamino mainnet ${kind} transaction without acknowledgeMainnet:true.`,
            ``,
            `Kamino Lending is Solana mainnet only. Re-call with acknowledgeMainnet:true after you have`,
            `verified the reserve (symbol/mint), the amount, and that ${args.from} has the position.`,
        ].join('\n');
    }
    const user = parseAddress(args.from, 'from');
    if (!args.symbol && !args.mint)
        throw new Error('Provide either symbol (e.g. "USDC") or mint to identify the reserve.');
    const amount = args.amount;
    const withdrawAll = args.withdrawAll === true;
    if (kind === 'deposit' && !amount)
        throw new Error('amount is required for deposit.');
    if (kind === 'withdraw' && !amount && !withdrawAll)
        throw new Error('Provide amount, or set withdrawAll:true.');
    // Lazy-load the heavy SDK only when a Kamino tx is actually requested.
    const klend = await import('@kamino-finance/klend-sdk');
    const { KaminoMarket, KaminoAction, VanillaObligation } = klend;
    const programId = new PublicKey(KLEND_PROGRAM_ID);
    const marketAddress = new PublicKey(args.market ?? KAMINO_MAIN_MARKET);
    const conn = makeConnection('mainnet');
    // recentSlotDurationMs ~450ms on mainnet; used by the SDK for slot math.
    const market = await KaminoMarket.load(conn, marketAddress, 450, programId, true);
    if (!market) {
        throw new Error(`Kamino market ${marketAddress.toBase58()} not found / failed to load. Check the market pubkey.`);
    }
    const reserve = args.mint
        ? market.getReserveByMint(new PublicKey(args.mint))
        : market.getReserveBySymbol(args.symbol);
    if (!reserve) {
        throw new Error(`No Kamino reserve for ${args.mint ? `mint ${args.mint}` : `symbol "${args.symbol}"`} in market ${marketAddress.toBase58()}. ` +
            `Check it against app.kamino.finance (symbol must match exactly), or pass a different market.`);
    }
    const mint = reserve.getLiquidityMint?.() ?? new PublicKey(reserve.state.liquidity.mintPubkey);
    // Convert human amount -> base units using the on-chain mint decimals.
    const { decimals } = await fetchMintInfo(conn, mint);
    const baseAmount = withdrawAll ? U64_MAX : toBaseUnits(amount, decimals);
    const obligation = new VanillaObligation(programId);
    const action = kind === 'deposit'
        ? await KaminoAction.buildDepositTxns(market, baseAmount, mint, user, obligation, true, undefined)
        : await KaminoAction.buildWithdrawTxns(market, baseAmount, mint, user, obligation, true, undefined);
    const ixs = [
        ...action.computeBudgetIxs,
        ...action.setupIxs,
        ...action.inBetweenIxs,
        ...action.lendingIxs,
        ...action.cleanupIxs,
    ];
    if (ixs.length === 0)
        throw new Error('Kamino SDK produced no instructions for this action.');
    const luts = action.lookupTableAccounts ?? [];
    const latest = await conn.getLatestBlockhash('finalized');
    const message = new TransactionMessage({
        payerKey: user,
        recentBlockhash: latest.blockhash,
        instructions: ixs,
    }).compileToV0Message(luts);
    const tx = new VersionedTransaction(message);
    const base64 = serializeUnsigned(tx);
    let simText;
    try {
        const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
        simText = formatSimResult(sim, 'Kamino');
    }
    catch (e) {
        simText = `Simulation: could not run (${e?.message ?? e}). Decode + review the tx manually before signing.`;
    }
    const tokenLabel = reserve.getTokenSymbol?.() ?? reserve.symbol ?? args.symbol ?? args.mint;
    return [
        `=== Kamino Lending ${kind} — UNSIGNED (Solana mainnet) ===`,
        ``,
        `owner:        ${user.toBase58()}`,
        `market:       ${marketAddress.toBase58()}`,
        `reserve:      ${reserve.address.toBase58()} (${tokenLabel})`,
        `amount:       ${withdrawAll ? 'ALL' : amount}`,
        `instructions: ${ixs.length} (lending: ${(action.lendingIxsLabels ?? []).join(', ')})`,
        `blockhash:    ${latest.blockhash}`,
        ``,
        simText,
        ``,
        `--- UNSIGNED VersionedTransaction (base64) ---`,
        base64,
        `--- END ---`,
        ``,
        `Next: review with chaingpt_solana_decode_tx, then sign with the wallet holding ${user.toBase58()} and submit.`,
        `Custody-free: the plugin built this tx but never signs it.`,
    ].join('\n');
}
export async function handleKaminoSignedTool(name, args) {
    let text;
    const safeArgs = args ?? {};
    try {
        if (name === 'chaingpt_defi_kamino_deposit_tx')
            text = await buildKaminoAction('deposit', safeArgs);
        else if (name === 'chaingpt_defi_kamino_withdraw_tx')
            text = await buildKaminoAction('withdraw', safeArgs);
        else
            throw new Error(`Unknown Kamino signed tool: ${name}`);
    }
    catch (e) {
        text = `Error in ${name}: ${e?.message ?? e}`;
    }
    return { content: [{ type: 'text', text }] };
}
