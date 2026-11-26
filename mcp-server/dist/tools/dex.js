import { decodeFunctionData, encodeFunctionData, parseUnits, formatUnits } from 'viem';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { CHAINS, resolveChain, rpcEndpoints } from '../lib/chains.js';
import { httpJson, jsonRpcFallback } from '../lib/http.js';
import { checkedDecimals, fetchErc20Decimals } from '../lib/agent-erc20.js';
/**
 * Tier-3a DEX trading on mainnet. Custody-free.
 *
 * Backends:
 *  - EVM swaps:      OpenOcean v4 aggregator (no API key, covers all 10 mainnets)
 *  - Solana swaps:   Jupiter v6 (no API key)
 *
 * The plugin returns:
 *  - quote responses (read-only, no signing required)
 *  - unsigned transaction objects ready for the user's wallet to sign + broadcast
 *
 * Mainnet safety gate: chaingpt_dex_build_swap_tx refuses to return a tx for a
 * mainnet network unless acknowledgeMainnet=true is passed. See
 * feedback_mainnet_default and feedback_autonomous_authorization for the
 * design rationale.
 */
// ─── OpenOcean chain slug map ──────────────────────────────────────
// OpenOcean uses its own short names; map our canonical slugs onto theirs.
const OPENOCEAN_CHAIN = {
    ethereum: 'eth',
    bsc: 'bsc',
    polygon: 'polygon',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    avalanche: 'avax',
    base: 'base',
    linea: 'linea',
    scroll: 'scroll',
    blast: 'blast',
};
const OPENOCEAN_BASE = 'https://open-api.openocean.finance/v4';
// The Lite hostname retires on 2026-10-30; paths remain compatible on api.jup.ag.
const JUPITER_BASE = 'https://api.jup.ag/swap/v1';
const EVM_NETWORKS = Object.keys(OPENOCEAN_CHAIN);
// OpenOcean's "native" token sentinel is 0xEee...EeEEEe. Some EVM aggregators
// use 0x000...0000. We accept both as input and translate to OO's sentinel.
const NATIVE_ADDR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
function normalizeTokenAddress(addr) {
    if (!addr)
        return addr;
    const lower = addr.toLowerCase();
    if (lower === '0x0000000000000000000000000000000000000000')
        return NATIVE_ADDR;
    return lower;
}
// ─── ERC-20 ABI fragments for approval helper ──────────────────────
const ERC20_ALLOWANCE_ABI = {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
};
const ERC20_APPROVE_ABI = {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
};
// OpenOcean exchange router, the same address on every supported chain. Swap transactions must
// call it, and chaingpt_dex_approve_tx approves it.
const OPENOCEAN_ROUTER = '0x6352a56caadc4f1e25cd6c75970fa768a3304e64';
const OPENOCEAN_SWAP_ABI = [{
        type: 'function',
        name: 'swap',
        stateMutability: 'payable',
        inputs: [
            { name: 'caller', type: 'address' },
            {
                name: 'desc',
                type: 'tuple',
                components: [
                    { name: 'srcToken', type: 'address' },
                    { name: 'dstToken', type: 'address' },
                    { name: 'srcReceiver', type: 'address' },
                    { name: 'dstReceiver', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                    { name: 'minReturnAmount', type: 'uint256' },
                    { name: 'guaranteedAmount', type: 'uint256' },
                    { name: 'flags', type: 'uint256' },
                    { name: 'referrer', type: 'address' },
                    { name: 'permit', type: 'bytes' },
                ],
            },
            {
                name: 'calls',
                type: 'tuple[]',
                components: [
                    { name: 'target', type: 'uint256' },
                    { name: 'gasLimit', type: 'uint256' },
                    { name: 'value', type: 'uint256' },
                    { name: 'data', type: 'bytes' },
                ],
            },
        ],
        outputs: [{ name: 'returnAmount', type: 'uint256' }],
    }];
function decodeOpenOceanSwap(data) {
    try {
        return decodeFunctionData({ abi: OPENOCEAN_SWAP_ABI, data: String(data) });
    }
    catch {
        return null;
    }
}
/**
 * OpenOcean builds the calldata the user signs, so it must be the swap that was asked for: the
 * router's swap() for the requested tokens and amount, paying out to the account with at least the
 * shown minimum, and native value only for a native input. Throws otherwise.
 */
function checkOpenOceanSwap(data, want) {
    if (String(data?.to ?? '').toLowerCase() !== OPENOCEAN_ROUTER) {
        throw new Error(`OpenOcean returned a transaction to ${data?.to}, not the OpenOcean router; refusing to build it.`);
    }
    const desc = decodeOpenOceanSwap(data?.data)?.args?.[1];
    if (!desc)
        throw new Error('OpenOcean returned calldata that is not a router swap(); refusing to build it.');
    const value = BigInt(data?.value ?? 0);
    if (desc.srcToken.toLowerCase() !== want.inToken
        || desc.dstToken.toLowerCase() !== want.outToken
        || desc.dstReceiver.toLowerCase() !== want.account.toLowerCase()
        || desc.amount !== want.amount
        || want.minOut === undefined || desc.minReturnAmount < want.minOut || desc.minReturnAmount === 0n
        || value !== (want.inToken === NATIVE_ADDR ? want.amount : 0n)) {
        throw new Error('OpenOcean swap calldata does not match the requested tokens, amount, recipient, minimum output or value; refusing to build it.');
    }
}
// Solana programs a Jupiter swap transaction may call.
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SPL_ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const MAX_PRIORITY_FEE_LAMPORTS = 10000000n; // 0.01 SOL
// Jupiter v6 route instructions by Anchor discriminator: account positions of the transfer authority,
// the source and the destination token account, plus route's optional destination override.
const JUPITER_ROUTES = {
    e517cb977ae3ad2a: { authority: 1, source: 2, destination: 3, override: 4 }, // route
    c1209b3341d69c81: { authority: 2, source: 3, destination: 6 }, // shared_accounts_route
};
function associatedTokenAccount(owner, mint, tokenProgram) {
    return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(SPL_ATA))[0].toBase58();
}
function decodeSolanaTx(b64) {
    try {
        return VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
    }
    catch {
        return null;
    }
}
/**
 * Jupiter serializes the transaction the user signs, so decode it and accept only the swap that was
 * asked for: the user pays the fee; only compute-budget, SOL wrap/unwrap, token-account creation and
 * one Jupiter route instruction; the route spends the requested amount from the user's input-mint
 * account into the user's output-mint account; the priority fee is bounded. Throws otherwise.
 */
function checkJupiterSwap(b64, want) {
    const refusal = (why) => new Error(`Jupiter swap transaction refused: ${why}.`);
    const tx = decodeSolanaTx(b64);
    if (!tx)
        throw refusal('it could not be decoded');
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    // Lookup-table accounts cannot be resolved offline, so a checked position that uses one fails.
    const key = (index) => (index !== undefined && index < keys.length ? keys[index] : undefined);
    const owned = (account, mint) => account !== undefined
        && (account === associatedTokenAccount(want.user, mint, SPL_TOKEN) || account === associatedTokenAccount(want.user, mint, SPL_TOKEN_2022));
    if (keys[0] !== want.user)
        throw refusal('the fee payer is not userPublicKey');
    let unitLimit = 1400000n;
    let unitPrice = 0n;
    let routes = 0;
    for (const ix of tx.message.compiledInstructions) {
        const program = key(ix.programIdIndex);
        const account = (n) => key(ix.accountKeyIndexes[n]);
        const data = Buffer.from(ix.data);
        if (program === COMPUTE_BUDGET) {
            if (data[0] === 2 && data.length === 5)
                unitLimit = BigInt(data.readUInt32LE(1));
            else if (data[0] === 3 && data.length === 9)
                unitPrice = data.readBigUInt64LE(1);
            else if (data[0] !== 1 && data[0] !== 4)
                throw refusal('it has an unknown compute-budget instruction');
        }
        else if (program === SYSTEM_PROGRAM) {
            // Only wrapping SOL: a transfer from the user into the user's own wSOL account.
            if (data.length !== 12 || data.readUInt32LE(0) !== 2 || account(0) !== want.user
                || account(1) !== associatedTokenAccount(want.user, WSOL_MINT, SPL_TOKEN)) {
                throw refusal("it moves SOL somewhere other than the user's wSOL account");
            }
        }
        else if (program === SPL_TOKEN || program === SPL_TOKEN_2022) {
            // Only wSOL bookkeeping: syncNative, or closeAccount back to the user.
            if (!(data.length === 1 && (data[0] === 17 || (data[0] === 9 && account(1) === want.user && account(2) === want.user)))) {
                throw refusal('it has a token instruction other than wSOL sync or close-to-user');
            }
        }
        else if (program === SPL_ATA) {
            if (data.length > 1 || (data.length === 1 && data[0] > 1) || account(0) !== want.user || account(2) !== want.user) {
                throw refusal('it creates a token account for someone other than the user');
            }
        }
        else if (program === JUPITER_V6) {
            const route = JUPITER_ROUTES[data.subarray(0, 8).toString('hex')];
            if (!route)
                throw refusal('it calls a Jupiter instruction other than a route');
            if (account(route.authority) !== want.user || !owned(account(route.source), want.inputMint)
                || !owned(account(route.destination), want.outputMint)
                || (route.override !== undefined && account(route.override) !== JUPITER_V6 && account(route.override) !== account(route.destination))) {
                throw refusal("the route does not swap from and to the user's own token accounts");
            }
            // Route args end with in_amount u64, quoted_out_amount u64, slippage_bps u16, platform_fee_bps u8.
            const tail = data.subarray(data.length - 19);
            if (data.length < 27 || tail.readBigUInt64LE(0) !== want.amount || tail.readUInt16LE(16) > want.slippageBps || tail[18] !== 0) {
                throw refusal('the route amount, slippage or platform fee differs from the request');
            }
            routes++;
        }
        else {
            throw refusal(`it calls an unexpected program ${program ?? '(lookup-table account)'}`);
        }
    }
    if (routes !== 1)
        throw refusal('it does not contain exactly one Jupiter route');
    if ((unitPrice * unitLimit) / 1000000n > MAX_PRIORITY_FEE_LAMPORTS)
        throw refusal('its priority fee exceeds 0.01 SOL');
}
export const dexTools = [
    {
        name: 'chaingpt_dex_quote',
        description: 'Get a live DEX swap quote across all major EVM mainnets. Returns expected output amount, price impact, ' +
            'route summary, and estimated gas. Powered by OpenOcean (no key). 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                network: {
                    type: 'string',
                    enum: EVM_NETWORKS,
                    description: 'EVM mainnet (ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll).',
                },
                inToken: {
                    type: 'string',
                    description: 'Input token contract (0x…). For the native coin, use 0x0000…0000 or 0xEeee…EEeE.',
                },
                outToken: { type: 'string', description: 'Output token contract (0x…). Native sentinels accepted.' },
                amountIn: { type: 'string', description: 'Decimal amount of the input token (e.g. "1.5", not wei).' },
                slippageBps: { type: 'integer', minimum: 0, maximum: 5000, description: 'Max slippage in basis points (50 = 0.5%). Default 100.', default: 100 },
                gasPriceGwei: { type: 'number', description: 'Gas price hint in gwei for the route estimator. Optional.' },
            },
            required: ['network', 'inToken', 'outToken', 'amountIn'],
        },
    },
    {
        name: 'chaingpt_dex_build_swap_tx',
        description: 'Build an UNSIGNED swap transaction object for the user to sign + broadcast. MAINNET only — testnets ' +
            'are not supported by the aggregator. Refuses unless `acknowledgeMainnet: true`. The user MUST hold ' +
            'sufficient input-token balance AND have approved the router (use chaingpt_dex_approve_tx first if ' +
            'swapping an ERC-20). 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                network: { type: 'string', enum: EVM_NETWORKS },
                inToken: { type: 'string' },
                outToken: { type: 'string' },
                amountIn: { type: 'string', description: 'Decimal amount of input token.' },
                slippageBps: { type: 'integer', minimum: 0, maximum: 5000, description: 'Max slippage in bps. Default 100.', default: 100 },
                account: { type: 'string', description: 'The wallet that will sign + broadcast (0x…).' },
                gasPriceGwei: { type: 'number' },
                acknowledgeMainnet: {
                    type: 'boolean',
                    description: 'You must pass acknowledgeMainnet=true to receive a signed-tx-ready response. This is the safety ' +
                        'prompt — confirm the user wants to spend real funds. Before setting this flag, call ' +
                        'chaingpt_risk_token on the outToken and chaingpt_dex_quote to surface price impact.',
                },
            },
            required: ['network', 'inToken', 'outToken', 'amountIn', 'account'],
        },
    },
    {
        name: 'chaingpt_dex_approve_tx',
        description: 'Build an UNSIGNED ERC-20 approval transaction so the OpenOcean router (or another spender) can pull ' +
            'tokens for a swap. Returns the approval tx + the current allowance for the wallet. ' +
            'MAINNET: requires acknowledgeMainnet: true (approvals delegate spend authority). 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                network: { type: 'string', enum: EVM_NETWORKS },
                token: { type: 'string', description: 'Token contract (0x…). Must be an ERC-20 (not native).' },
                owner: { type: 'string', description: 'The wallet that will sign (0x…).' },
                spender: {
                    type: 'string',
                    description: 'Approval target. Defaults to the OpenOcean router on the chosen network.',
                },
                amount: {
                    type: 'string',
                    description: 'Decimal amount to approve, e.g. "1000". Use "max" for the uint256-max approval.',
                    default: 'max',
                },
                decimals: {
                    type: 'number',
                    description: 'Token decimals. If omitted, the tool will fetch from the contract.',
                },
                acknowledgeMainnet: {
                    type: 'boolean',
                    description: 'Must be true — approvals execute on mainnet and delegate spend authority to the spender.',
                },
            },
            required: ['network', 'token', 'owner', 'acknowledgeMainnet'],
        },
    },
    {
        name: 'chaingpt_dex_jupiter_quote',
        description: 'Get a live Solana DEX swap quote via Jupiter v6. Returns expected output, price impact, and route plan. ' +
            'Works on Solana mainnet. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                inputMint: { type: 'string', description: 'Input token mint address (base58). Use "So11111…" for SOL.' },
                outputMint: { type: 'string', description: 'Output token mint address.' },
                amountIn: { type: 'string', description: 'Decimal amount of input token (Jupiter takes the raw lamports internally).' },
                decimalsIn: { type: 'number', description: 'Decimals of the input token. Default 9 (SOL).', default: 9 },
                decimalsOut: { type: 'number', description: 'Decimals of the OUTPUT token (6 for USDC, 9 for SOL). Used only for display; omit to see raw units.' },
                slippageBps: { type: 'integer', minimum: 0, maximum: 5000, description: 'Max slippage in basis points. Default 50.', default: 50 },
            },
            required: ['inputMint', 'outputMint', 'amountIn'],
        },
    },
    {
        name: 'chaingpt_dex_jupiter_build_swap_tx',
        description: 'Build a serialized Solana swap transaction via Jupiter v6 ready for the user\'s wallet to sign and ' +
            'broadcast. Returns base64-encoded transaction. Requires `acknowledgeMainnet: true` — Solana mainnet ' +
            'is real money. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                userPublicKey: { type: 'string', description: 'Solana wallet base58 public key.' },
                inputMint: { type: 'string' },
                outputMint: { type: 'string' },
                amountIn: { type: 'string', description: 'Decimal amount of input token.' },
                decimalsIn: { type: 'number', default: 9 },
                decimalsOut: { type: 'number', description: 'Decimals of the OUTPUT token. Display only.' },
                slippageBps: { type: 'integer', minimum: 0, maximum: 5000, default: 50 },
                acknowledgeMainnet: {
                    type: 'boolean',
                    description: 'You must pass true. Solana mainnet swaps are irreversible.',
                },
            },
            required: ['userPublicKey', 'inputMint', 'outputMint', 'amountIn'],
        },
    },
];
function formatLargeFloat(n, decimals = 6) {
    if (!Number.isFinite(n))
        return 'n/a';
    if (Math.abs(n) >= 1e9)
        return `${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6)
        return `${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3)
        return `${(n / 1e3).toFixed(2)}K`;
    return n.toFixed(decimals);
}
export async function handleDexTool(name, args) {
    if (!args) {
        return { content: [{ type: 'text', text: 'No arguments provided.' }] };
    }
    try {
        if (name === 'chaingpt_dex_quote' || name === 'chaingpt_dex_build_swap_tx') {
            const network = String(args.network || '');
            const ooChain = OPENOCEAN_CHAIN[network];
            if (!ooChain) {
                return { content: [{ type: 'text', text: `OpenOcean does not support network: ${network}` }] };
            }
            const inToken = normalizeTokenAddress(String(args.inToken || ''));
            const outToken = normalizeTokenAddress(String(args.outToken || ''));
            const amountIn = String(args.amountIn || '');
            const slippageBps = Number(args.slippageBps ?? 100);
            const slippagePct = slippageBps / 100; // OpenOcean uses percentage (e.g. 1 = 1%)
            const gasPriceGwei = args.gasPriceGwei;
            if (name === 'chaingpt_dex_build_swap_tx') {
                if (args.acknowledgeMainnet !== true) {
                    return {
                        content: [{
                                type: 'text',
                                text: `⚠ Mainnet swap refused. To execute a swap on ${CHAINS[network]?.name ?? network}, pass ` +
                                    `acknowledgeMainnet: true. This is the safety prompt — DEX swaps on mainnet spend real funds ` +
                                    `and are irreversible. Before setting that flag:\n` +
                                    `  1. Run chaingpt_dex_quote with the same params to see the expected output and price impact.\n` +
                                    `  2. Run chaingpt_risk_token on the outToken to confirm it isn't a honeypot.\n` +
                                    `  3. Confirm the slippageBps (default 100 = 1.0%). For volatile coins, raise it; for stables, lower it.\n` +
                                    `  4. Confirm the account is the wallet you control.\n` +
                                    `Then re-call with acknowledgeMainnet: true.`,
                            }],
                    };
                }
            }
            const account = args.account || '0x0000000000000000000000000000000000000000';
            const path = name === 'chaingpt_dex_build_swap_tx' ? 'swap' : 'quote';
            if (path === 'swap' && (!/^0x[0-9a-fA-F]{40}$/.test(account) || /^0x0{40}$/.test(account))) {
                throw new Error('account must be the 0x address of the wallet that will sign the swap.');
            }
            // V4 uses atomic token amounts and gas prices in wei. Do not truncate sub-gwei fees.
            const inDecimals = inToken === NATIVE_ADDR ? 18 : await fetchErc20Decimals(network, inToken);
            if (!/^\d+(?:\.\d+)?$/.test(amountIn) || (amountIn.split('.')[1]?.length ?? 0) > inDecimals)
                throw new Error('amountIn must be a decimal within the input token precision.');
            const amountRaw = parseUnits(amountIn, inDecimals);
            if (amountRaw <= 0n)
                throw new Error('amountIn must be positive.');
            let resolvedGasPrice;
            if (gasPriceGwei !== undefined) {
                const gasDecimal = typeof gasPriceGwei === 'number' && Number.isFinite(gasPriceGwei) ? gasPriceGwei.toFixed(9) : String(gasPriceGwei);
                if (!/^\d+(?:\.\d{1,9})?$/.test(gasDecimal) || Number(gasDecimal) !== Number(gasPriceGwei))
                    throw new Error('gasPriceGwei must be a nonnegative decimal with at most 9 fractional digits.');
                resolvedGasPrice = parseUnits(gasDecimal, 9);
            }
            else {
                const endpoints = rpcEndpoints(network);
                if (endpoints.length === 0) {
                    return {
                        content: [{
                                type: 'text',
                                text: `OpenOcean requires a gasPrice. No public RPC configured for ${network}; pass gasPriceGwei explicitly.`,
                            }],
                    };
                }
                try {
                    const gpHex = await jsonRpcFallback(endpoints, 'eth_gasPrice', []);
                    resolvedGasPrice = BigInt(gpHex);
                }
                catch {
                    throw new Error('Could not fetch gas price; pass gasPriceGwei explicitly.');
                }
            }
            const params = new URLSearchParams({
                inTokenAddress: inToken,
                outTokenAddress: outToken,
                amountDecimals: amountRaw.toString(),
                slippage: String(slippagePct),
                account,
                gasPriceDecimals: resolvedGasPrice.toString(),
            });
            const url = `${OPENOCEAN_BASE}/${ooChain}/${path}?${params.toString()}`;
            const res = await httpJson(url);
            const data = res?.data ?? res;
            if (!data || (res?.code && res.code !== 200) || !/^\d+$/.test(String(data?.outAmount))) {
                return {
                    content: [{
                            type: 'text',
                            text: `OpenOcean ${path} failed: ${JSON.stringify(res, null, 2)}`,
                        }],
                };
            }
            const inDec = Number(data.inToken?.decimals ?? 18);
            const outDec = Number(data.outToken?.decimals ?? 18);
            const inAmt = data.inAmount ? formatUnits(BigInt(data.inAmount), inDec) : amountIn;
            const outAmt = data.outAmount ? formatUnits(BigInt(data.outAmount), outDec) : 'n/a';
            // OpenOcean's quote endpoint often omits minOutAmount — derive it from
            // the expected output and the slippage tolerance instead of showing n/a.
            const minOutRaw = data.minOutAmount
                ? BigInt(data.minOutAmount)
                : data.outAmount
                    ? (BigInt(data.outAmount) * BigInt(Math.round(10_000 - slippagePct * 100))) / 10000n
                    : undefined;
            const minOut = minOutRaw !== undefined ? formatUnits(minOutRaw, outDec) : 'n/a';
            const lines = [];
            lines.push(`${name === 'chaingpt_dex_build_swap_tx' ? 'Swap transaction' : 'Swap quote'} — ${CHAINS[network]?.name ?? network}`);
            lines.push('');
            lines.push(`In:              ${inAmt} ${data.inToken?.symbol ?? '?'} (${data.inToken?.address ?? inToken})`);
            lines.push(`Out (expected):  ${outAmt} ${data.outToken?.symbol ?? '?'} (${data.outToken?.address ?? outToken})`);
            lines.push(`Min out:         ${minOut} ${data.outToken?.symbol ?? '?'} (after ${slippagePct}% slippage)`);
            if (data.price_impact !== undefined)
                lines.push(`Price impact:    ${data.price_impact}`);
            if (data.estimatedGas)
                lines.push(`Est. gas:        ${data.estimatedGas}`);
            if (data.dexes && Array.isArray(data.dexes)) {
                lines.push(`Route:           ${data.dexes.map((d) => d.dexCode ?? d).slice(0, 5).join(' → ')}`);
            }
            if (name === 'chaingpt_dex_build_swap_tx') {
                checkOpenOceanSwap(data, { inToken, outToken, amount: amountRaw, account, minOut: minOutRaw });
                const tx = {
                    chainId: CHAINS[network]?.chainId,
                    to: data.to,
                    data: data.data,
                    value: data.value ? '0x' + BigInt(data.value).toString(16) : '0x0',
                    gas: data.estimatedGas ? '0x' + BigInt(data.estimatedGas).toString(16) : undefined,
                    gasPrice: data.gasPrice ? '0x' + BigInt(data.gasPrice).toString(16) : undefined,
                };
                lines.push('');
                lines.push('--- Unsigned transaction (paste into your wallet) ---');
                lines.push(JSON.stringify(tx, null, 2));
                lines.push('');
                lines.push('Reminder: if the inToken is an ERC-20, you must approve the router first via chaingpt_dex_approve_tx.');
                lines.push(`Router (spender): ${data.to}`);
            }
            else {
                lines.push('');
                lines.push('Next: chaingpt_dex_build_swap_tx with the same params + acknowledgeMainnet: true.');
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (name === 'chaingpt_dex_approve_tx') {
            const network = String(args.network || '');
            const ooChain = OPENOCEAN_CHAIN[network];
            if (!ooChain) {
                return { content: [{ type: 'text', text: `Unsupported network for approval: ${network}` }] };
            }
            // Same mainnet gate as every other tx-building tool. An approval is the
            // most dangerous tx in the flow (it delegates spend authority), so it
            // must not be the one tool without the acknowledgement.
            if (args.acknowledgeMainnet !== true) {
                return {
                    content: [{
                            type: 'text',
                            text: `⚠ Mainnet approval refused. This builds an ERC-20 approve() that delegates spend authority ` +
                                `to a router on ${network} MAINNET. Re-run with acknowledgeMainnet: true after confirming ` +
                                `the token, spender, and amount. Tip: approve a bounded amount instead of "max" when possible.`,
                        }],
                };
            }
            const token = String(args.token || '').toLowerCase();
            if (!token || token === NATIVE_ADDR || token === '0x0000000000000000000000000000000000000000') {
                return { content: [{ type: 'text', text: 'Native coins do not need approval — call build_swap_tx directly.' }] };
            }
            const owner = String(args.owner || '');
            const amountInput = String(args.amount ?? 'max');
            // Resolve the OpenOcean router for this chain. Known router addresses are stable across chains;
            // hard-code the canonical Pathfinder router. If the user passes `spender` explicitly we honor it.
            // (Pre-1.6 we resolved via a probe swap call, but OpenOcean now requires gasPrice on every call,
            // and a hard-coded address avoids that extra round-trip + RPC dependency.)
            let spender = args.spender || '';
            if (!spender) {
                // OpenOcean Pathfinder router — same address across all major EVM mainnets via CREATE2.
                // Source: https://docs.openocean.finance/dev/openocean-api-3.0/api-reference#exchange-contract
                spender = OPENOCEAN_ROUTER;
            }
            // Determine decimals + current allowance via RPC if possible.
            // If decimals omitted, fetch them on-chain — defaulting to 18 silently
            // mis-sizes approvals for 6-decimal tokens like USDC.
            const chain = resolveChain(network);
            let decimals = 0;
            if (String(args.amount ?? 'max') === 'max') { // same default as amountInput below
                // unlimited approval: no amount to scale, so decimals are not needed
            }
            else if (args.decimals !== undefined) {
                try {
                    decimals = await checkedDecimals(network, token, args.decimals);
                }
                catch (e) {
                    return { content: [{ type: 'text', text: `Refused: ${e?.message ?? e}` }] };
                }
            }
            else {
                try {
                    decimals = await fetchErc20Decimals(network, token);
                }
                catch (e) {
                    return {
                        content: [{
                                type: 'text',
                                text: `Could not fetch decimals for ${token} on ${network} (${e?.message ?? e}). ` +
                                    `Decimals are always checked on-chain, so restore RPC access for ${network} and retry, or approve the unlimited amount (amount: "max"), which needs no decimals.`,
                            }],
                    };
                }
            }
            const amount = amountInput === 'max'
                ? (1n << 256n) - 1n
                : parseUnits(amountInput, decimals);
            const approveData = encodeFunctionData({
                abi: [ERC20_APPROVE_ABI],
                functionName: 'approve',
                args: [spender, amount],
            });
            const tx = {
                chainId: chain?.chainId,
                to: token,
                data: approveData,
                value: '0x0',
            };
            const lines = [];
            lines.push(`ERC-20 approval — ${CHAINS[network]?.name ?? network}`);
            lines.push('');
            lines.push(`Token:           ${token}`);
            lines.push(`Owner:           ${owner}`);
            lines.push(`Spender:         ${spender}  (OpenOcean router)`);
            lines.push(`Amount:          ${amountInput === 'max' ? 'unlimited (uint256 max)' : `${amountInput} (× 10^${decimals})`}`);
            lines.push('');
            lines.push('--- Unsigned transaction (paste into your wallet) ---');
            lines.push(JSON.stringify(tx, null, 2));
            lines.push('');
            lines.push('After this approval is confirmed on chain, call chaingpt_dex_build_swap_tx to do the actual swap.');
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (name === 'chaingpt_dex_jupiter_quote' || name === 'chaingpt_dex_jupiter_build_swap_tx') {
            const inputMint = String(args.inputMint || '');
            const outputMint = String(args.outputMint || '');
            const amountIn = String(args.amountIn || '');
            const decimalsIn = Number(args.decimalsIn ?? 9);
            const slippageBps = Number(args.slippageBps ?? 50);
            const rawAmount = parseUnits(amountIn, decimalsIn).toString();
            const quoteUrl = `${JUPITER_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
                `&amount=${rawAmount}&slippageBps=${slippageBps}`;
            const apiKey = process.env.JUPITER_API_KEY?.trim();
            const headers = apiKey ? { 'x-api-key': apiKey } : undefined;
            const quote = await httpJson(quoteUrl, { headers });
            if (!quote || quote.error) {
                return { content: [{ type: 'text', text: `Jupiter quote error: ${quote?.error ?? 'unknown'}` }] };
            }
            // Jupiter doesn't return token decimals. NEVER guess them (a wrong guess
            // displays amounts off by 1000x) — show raw units unless the caller
            // passed decimalsOut explicitly.
            const decimalsOut = args.decimalsOut !== undefined ? Number(args.decimalsOut) : undefined;
            const lines = [];
            lines.push(`${name === 'chaingpt_dex_jupiter_build_swap_tx' ? 'Jupiter swap tx' : 'Jupiter quote'} — Solana mainnet`);
            lines.push('');
            lines.push(`Input mint:      ${inputMint}`);
            lines.push(`Output mint:     ${outputMint}`);
            lines.push(`Amount in:       ${amountIn} (raw: ${quote.inAmount})`);
            lines.push(decimalsOut !== undefined
                ? `Amount out:      ${formatUnits(BigInt(quote.outAmount), decimalsOut)} (raw: ${quote.outAmount})`
                : `Amount out:      ${quote.outAmount} raw units — pass decimalsOut (e.g. 6 for USDC) for a human-readable amount`);
            if (quote.priceImpactPct)
                lines.push(`Price impact:    ${Number(quote.priceImpactPct).toFixed(4)}%`);
            if (quote.routePlan)
                lines.push(`Route hops:      ${quote.routePlan.length}`);
            if (name === 'chaingpt_dex_jupiter_quote') {
                lines.push('');
                lines.push('Next: chaingpt_dex_jupiter_build_swap_tx with userPublicKey + acknowledgeMainnet: true.');
                return { content: [{ type: 'text', text: lines.join('\n') }] };
            }
            // Build swap tx (Solana mainnet ack gate)
            if (args.acknowledgeMainnet !== true) {
                return {
                    content: [{
                            type: 'text',
                            text: `⚠ Solana mainnet swap refused. Pass acknowledgeMainnet: true to receive the signed-tx-ready ` +
                                `transaction. This is the safety prompt — Jupiter swaps on Solana mainnet are irreversible.`,
                        }],
                };
            }
            const userPublicKey = String(args.userPublicKey || '');
            if (!userPublicKey) {
                return { content: [{ type: 'text', text: 'userPublicKey is required for swap-tx build.' }] };
            }
            if (quote.inputMint !== inputMint || quote.outputMint !== outputMint || String(quote.inAmount) !== rawAmount) {
                throw new Error('Jupiter quote does not match the requested mints or amount; refusing to build the swap.');
            }
            const swap = await httpJson(`${JUPITER_BASE}/swap`, {
                method: 'POST',
                headers,
                body: {
                    quoteResponse: quote,
                    userPublicKey,
                    wrapAndUnwrapSol: true,
                    dynamicComputeUnitLimit: true,
                },
            });
            const swapTransaction = swap?.swapTransaction;
            if (typeof swapTransaction !== 'string' || !swapTransaction)
                throw new Error('Jupiter returned no swapTransaction.');
            checkJupiterSwap(swapTransaction, { user: userPublicKey, inputMint, outputMint, amount: BigInt(rawAmount), slippageBps });
            lines.push('');
            lines.push('--- Serialized swap transaction (base64) ---');
            lines.push(swapTransaction);
            lines.push('');
            lines.push('Decode this base64 string into a VersionedTransaction in your wallet, sign, and send.');
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        return { content: [{ type: 'text', text: `Unknown DEX tool: ${name}` }] };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChainGPT DEX error: ${message}`);
    }
}
