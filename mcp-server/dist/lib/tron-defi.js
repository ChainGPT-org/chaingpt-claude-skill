/**
 * Tron DeFi protocol adapters: SunSwap (read-only quote) and JustLend
 * (read + supply/withdraw/borrow/repay builders). All builders return UNSIGNED
 * txs (custody-free); execution goes through external signing or the
 * agent-wallet Tron sign-and-send under policy. Addresses are verified in
 * tron-tokens.ts. ABIs used are the standard Uniswap-V2 / Compound-V2 shapes.
 */
import { decodeAbiParameters } from 'viem';
import { toEvmAddressParam } from './tron-address.js';
import { triggerConstantContract } from './tron.js';
import { encodeParams, encodeUint256Param, buildContractCall, decodeUint } from './tron-sign.js';
import { TRON_DEFI } from './tron-tokens.js';
// Any valid base58 address works as the `owner_address` of a read-only call.
const READ_DUMMY = TRON_DEFI.sunswap.v2Router;
// ── SunSwap (quote via deprecated-but-standard V2 getAmountsOut) ──────
/**
 * Quote a swap along `pathBase58` via SunSwap V2 `getAmountsOut`. Read-only.
 * The path must be in WTRX terms for any TRX leg (path[0]/path[last] = WTRX).
 * Returns the amount array (amounts[last] is the output estimate).
 */
export async function sunswapAmountsOut(network, amountIn, pathBase58) {
    if (pathBase58.length < 2)
        throw new Error('swap path needs at least 2 tokens');
    const pathEvm = pathBase58.map((a) => toEvmAddressParam(a));
    const parameter = encodeParams([{ type: 'uint256' }, { type: 'address[]' }], [amountIn, pathEvm]);
    const r = await triggerConstantContract(network, {
        ownerBase58: READ_DUMMY,
        contractBase58: TRON_DEFI.sunswap.v2Router,
        functionSelector: 'getAmountsOut(uint256,address[])',
        parameter,
    });
    const res = r.constant_result?.[0];
    if (!res)
        throw new Error('SunSwap getAmountsOut returned no result (no V2 pool for this path?)');
    const [amounts] = decodeAbiParameters([{ type: 'uint256[]' }], `0x${res}`);
    return amounts.map((a) => a);
}
function market(symbol) {
    const m = TRON_DEFI.justlend.markets[symbol.toUpperCase()];
    if (!m)
        throw new Error(`unknown JustLend market "${symbol}" (supported: ${Object.keys(TRON_DEFI.justlend.markets).join(', ')})`);
    return m;
}
/** Account-wide liquidity (USD, 1e18). shortfall>0 ⇒ liquidatable. error must be 0. */
export async function justlendAccountLiquidity(network, ownerBase58) {
    const parameter = encodeParams([{ type: 'address' }], [toEvmAddressParam(ownerBase58)]);
    const r = await triggerConstantContract(network, {
        ownerBase58,
        contractBase58: TRON_DEFI.justlend.unitroller,
        functionSelector: 'getAccountLiquidity(address)',
        parameter,
    });
    const res = r.constant_result?.[0];
    if (!res)
        throw new Error('JustLend getAccountLiquidity returned no result');
    const [error, liquidity, shortfall] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], `0x${res}`);
    return { error: error, liquidity: liquidity, shortfall: shortfall };
}
/** Per-market supplied + borrowed underlying balances (constant-call simulates the accruing reads). */
export async function justlendMarketBalances(network, ownerBase58, symbol) {
    const { jToken } = market(symbol);
    const parameter = encodeParams([{ type: 'address' }], [toEvmAddressParam(ownerBase58)]);
    const [sup, bor] = await Promise.all([
        triggerConstantContract(network, { ownerBase58, contractBase58: jToken, functionSelector: 'balanceOfUnderlying(address)', parameter }),
        triggerConstantContract(network, { ownerBase58, contractBase58: jToken, functionSelector: 'borrowBalanceCurrent(address)', parameter }),
    ]);
    const supplied = sup.constant_result?.[0] ? decodeUint(sup.constant_result[0]) : 0n;
    const borrowed = bor.constant_result?.[0] ? decodeUint(bor.constant_result[0]) : 0n;
    return { supplied, borrowed };
}
/**
 * Build an unsigned JustLend action tx. `amount` is in the underlying's base
 * units (e.g. USDT 6 decimals; TRX in SUN). TRC-20 markets need a prior
 * `approve` before `supply`/`repay`. jTRX is CEther (payable mint/repay).
 */
export async function buildJustlendTx(network, args) {
    const { jToken, underlying, isCEther } = market(args.market);
    if (args.amount <= 0n)
        throw new Error('amount must be positive');
    const word = encodeUint256Param(args.amount);
    const common = { ownerBase58: args.ownerBase58, feeLimitSun: args.feeLimitSun };
    switch (args.action) {
        case 'approve':
            if (isCEther || !underlying)
                throw new Error('the TRX market needs no approval');
            return buildContractCall(network, {
                ...common,
                contractBase58: underlying,
                functionSelector: 'approve(address,uint256)',
                parameter: encodeParams([{ type: 'address' }, { type: 'uint256' }], [toEvmAddressParam(jToken), args.amount]),
            });
        case 'supply':
            return isCEther
                ? buildContractCall(network, { ...common, contractBase58: jToken, functionSelector: 'mint()', callValueSun: args.amount })
                : buildContractCall(network, { ...common, contractBase58: jToken, functionSelector: 'mint(uint256)', parameter: word });
        case 'withdraw':
            return buildContractCall(network, { ...common, contractBase58: jToken, functionSelector: 'redeemUnderlying(uint256)', parameter: word });
        case 'borrow':
            return buildContractCall(network, { ...common, contractBase58: jToken, functionSelector: 'borrow(uint256)', parameter: word });
        case 'repay':
            return isCEther
                ? buildContractCall(network, { ...common, contractBase58: jToken, functionSelector: 'repayBorrow()', callValueSun: args.amount })
                : buildContractCall(network, { ...common, contractBase58: jToken, functionSelector: 'repayBorrow(uint256)', parameter: word });
        default:
            throw new Error(`unknown JustLend action: ${args.action}`);
    }
}
