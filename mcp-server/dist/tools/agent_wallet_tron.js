import { isKeystoreInitialized, readKeystoreFile, loadAccount, keystorePath, } from '../lib/agent-keystore.js';
import { loadPolicy, policyPath, checkTronPolicy } from '../lib/agent-policy.js';
import { logActivity, spendStats } from '../lib/agent-activity.js';
import { isTrustedTronHost, getAccount, broadcastTransaction, decodeBroadcastMessage, } from '../lib/tron.js';
import { toFunctionSelector } from 'viem';
import { deriveTronAddress, decodeRawData, signUnsignedTx, buildTrxTransfer, buildContractCall, constantPrecheck, readTrc20Decimals, encodeAddressParam, encodeUint256Param, } from '../lib/tron-sign.js';
import { tronAddressFromEvm, isTronAddress } from '../lib/tron-address.js';
import { resolveTronToken, assertNotPoisoned, TRX_DECIMALS, DEFAULT_FEE_LIMIT_SUN } from '../lib/tron-tokens.js';
import { parseUnits, formatUnits } from './tron.js';
/**
 * Agent wallet — Tron surface. Unlike Solana, Tron reuses the EVM keystore: the
 * SAME secp256k1 key controls both accounts (only the address encoding differs),
 * so there is no `_init` — the agent's Tron address is derived from the existing
 * EVM keystore. Signing is gated by the deterministic `tron` policy sub-object
 * that no MCP tool can write.
 *
 * sign_and_send takes a STRUCTURED INTENT (not LLM-supplied bytes) and builds
 * the tx itself, so the policy gate always operates on canonical node-generated
 * raw_data. Sequence: cheap policy short-circuit (pre-network) → build → decode
 * + cross-check vs intent → verify txID==SHA256(raw_data_hex) (inside sign) →
 * checkTronPolicy → revert pre-check (contract calls) → sign → broadcast → journal.
 */
const NETWORK_ENUM = ['mainnet', 'shasta', 'nile'];
export const agentWalletTronTools = [
    {
        name: 'chaingpt_agent_wallet_tron_address',
        description: "Show the agent's Tron address (derived from the SAME key as the EVM agent wallet — no separate keystore) and its TRX balance. Fund this address to give the agent Tron working capital. 0 ChainGPT credits.",
        inputSchema: {
            type: 'object',
            properties: { network: { type: 'string', enum: NETWORK_ENUM, default: 'mainnet' } },
            required: [],
        },
    },
    {
        name: 'chaingpt_agent_wallet_tron_sign_and_send',
        description: 'Build, sign, and broadcast a Tron transaction autonomously — gated by the deterministic `tron` policy chokepoint. Takes a structured intent (trx_transfer / trc20_transfer / contract_call), never raw bytes; the built tx is cross-checked (owner + destination + value + calldata) against the request before signing. The SUN caps (per-tx maxTxSun + rolling-24h maxDailySpendSun) meter NATIVE TRX value (call_value) — a TRC-20 transfer moves 0 native TRX, so token transfers are fenced by the destination (token-contract) allowlist + maxDailyTxCount + maxFeeLimitSun + the calldata cross-check, NOT by a token-amount cap. Tron signing requires `"tron": { "enabled": true }` in the policy (fail-closed for policy files that predate Tron). 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['trx_transfer', 'trc20_transfer', 'contract_call'], description: 'Intent type.' },
                to: { type: 'string', description: 'trx_transfer: recipient. trc20_transfer: token recipient.' },
                amount: { type: 'string', description: 'trx_transfer: TRX amount. trc20_transfer: token amount (human units).' },
                token: { type: 'string', description: 'trc20_transfer: TRC-20 symbol or contract address.' },
                contract: { type: 'string', description: 'contract_call: target contract address.' },
                functionSelector: { type: 'string', description: 'contract_call: e.g. "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)".' },
                parameter: { type: 'string', description: 'contract_call: ABI-encoded args WITHOUT the 4-byte selector (hex, no 0x).' },
                callValueTrx: { type: 'string', description: 'contract_call: TRX to attach (payable calls). Default 0.' },
                feeLimitTrx: { type: 'string', description: 'Max TRX burnable for energy. Default 100 (policy-capped).' },
                memo: { type: 'string', description: 'Audit-trail memo. Required if policy.tron.requireMemo=true.' },
                network: { type: 'string', enum: NETWORK_ENUM, default: 'mainnet' },
            },
            required: ['kind'],
        },
    },
];
function refusalBlock(reason, digest) {
    return {
        content: [{
                type: 'text',
                text: [
                    `⛔ Policy refused this Tron transaction.`,
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
function text(s) {
    return { content: [{ type: 'text', text: s }] };
}
export async function handleAgentWalletTronTool(name, args) {
    const a = args ?? {};
    const network = (String(a.network ?? 'mainnet'));
    try {
        if (name === 'chaingpt_agent_wallet_tron_address') {
            const file = readKeystoreFile();
            if (!file)
                return text('Agent wallet not initialized. Call chaingpt_agent_wallet_init first (the EVM keystore is shared with Tron).');
            const tronAddr = tronAddressFromEvm(file.address);
            let balanceLine = 'Balance:    (RPC unavailable)';
            try {
                const acct = await getAccount(network, tronAddr);
                balanceLine = acct.balance === undefined
                    ? `Balance:    0 TRX (account not yet activated — fund with ~1.1 TRX)`
                    : `Balance:    ${formatUnits(BigInt(acct.balance), TRX_DECIMALS)} TRX (${network})`;
            }
            catch { /* friendly placeholder */ }
            return text([
                `Agent Tron wallet (same key as the EVM agent wallet)`,
                ``,
                `Tron address: ${tronAddr}`,
                `EVM address:  ${file.address}`,
                balanceLine,
                `Keystore:     ${keystorePath()}`,
                `Explorer:     https://tronscan.org/#/address/${tronAddr}`,
            ].join('\n'));
        }
        if (name === 'chaingpt_agent_wallet_tron_sign_and_send') {
            if (!isKeystoreInitialized()) {
                return text('Agent wallet not initialized. Call chaingpt_agent_wallet_init first (the EVM keystore is shared with Tron).');
            }
            const file = readKeystoreFile();
            const agentTron = tronAddressFromEvm(file.address);
            const kind = String(a.kind ?? '');
            const memo = a.memo ? String(a.memo) : undefined;
            const feeLimitSun = a.feeLimitTrx !== undefined ? parseUnits(String(a.feeLimitTrx), TRX_DECIMALS) : DEFAULT_FEE_LIMIT_SUN;
            // 1. Cheap policy short-circuit BEFORE any network call (kill switch / not enabled).
            const policy = loadPolicy();
            if (policy.killSwitch || policy.tron?.enabled !== true) {
                // These branches return before any velocity check, so no ledger read needed.
                const decision = checkTronPolicy({ owner: agentTron, to: agentTron, valueSun: 0n, feeLimitSun: 0n, memo }, policy, undefined);
                return refusalBlock(decision.reason, decision.policyDigest);
            }
            // Autonomous signing against a non-TronGrid host is refused (build-then-sign
            // trusts the node's protobuf encoding of our intent).
            if (!isTrustedTronHost(network)) {
                return text('⛔ Refused: autonomous Tron signing requires a first-party TronGrid host. TRON_RPC_URL points elsewhere; unset it or use a trongrid.io host for agent-wallet signing.');
            }
            // 2. Resolve the operation + build the UNSIGNED tx (the node does the protobuf).
            let contract = null;
            let functionSelector = '';
            let parameter = '';
            let callValueSun = 0n;
            let policyTo;
            let policyValueSun;
            let summary;
            let unsigned;
            if (kind === 'trx_transfer') {
                const to = String(a.to ?? '');
                if (!isTronAddress(to))
                    return text(`Invalid recipient address: "${to}"`);
                assertNotPoisoned(to);
                const amountSun = parseUnits(String(a.amount ?? ''), TRX_DECIMALS);
                // Never broadcast a native transfer the agent can't fund.
                const acct = await getAccount(network, agentTron);
                const bal = BigInt(acct.balance ?? 0);
                const FEE_BUFFER_SUN = 1000000n; // reserve ~1 TRX for bandwidth/energy burn
                if (bal < amountSun + FEE_BUFFER_SUN)
                    return text(`⛔ Refused: agent balance ${formatUnits(bal, TRX_DECIMALS)} TRX is less than the ${formatUnits(amountSun, TRX_DECIMALS)} TRX transfer plus a ~1 TRX fee buffer.`);
                unsigned = await buildTrxTransfer(network, { ownerBase58: agentTron, toBase58: to, amountSun });
                policyTo = to;
                policyValueSun = amountSun;
                summary = [`Type:   native TRX transfer`, `To:     ${to}`, `Amount: ${formatUnits(amountSun, TRX_DECIMALS)} TRX`];
            }
            else if (kind === 'trc20_transfer') {
                const to = String(a.to ?? '');
                if (!isTronAddress(to))
                    return text(`Invalid recipient address: "${to}"`);
                assertNotPoisoned(to);
                const tok = resolveTronToken(String(a.token ?? ''));
                const tokenAddr = tok?.address ?? String(a.token ?? '');
                if (!isTronAddress(tokenAddr))
                    return text(`Invalid token: "${a.token}"`);
                assertNotPoisoned(tokenAddr);
                // Unknown tokens: read decimals on-chain — never assume 6 (an 18-decimal
                // token would otherwise be off by 10^12).
                const decimals = tok ? tok.decimals : await readTrc20Decimals(network, agentTron, tokenAddr);
                const amount = parseUnits(String(a.amount ?? ''), decimals);
                contract = tokenAddr;
                functionSelector = 'transfer(address,uint256)';
                parameter = encodeAddressParam(to) + encodeUint256Param(amount);
                unsigned = await buildContractCall(network, { ownerBase58: agentTron, contractBase58: tokenAddr, functionSelector, parameter, feeLimitSun });
                policyTo = tokenAddr;
                policyValueSun = 0n;
                summary = [`Type:   TRC-20 transfer`, `Token:  ${tok?.symbol ?? tokenAddr}`, `To:     ${to}`, `Amount: ${formatUnits(amount, decimals)}`];
            }
            else if (kind === 'contract_call') {
                const c = String(a.contract ?? '');
                if (!isTronAddress(c))
                    return text(`Invalid contract address: "${c}"`);
                assertNotPoisoned(c);
                functionSelector = String(a.functionSelector ?? '');
                if (!/^[A-Za-z_][\w]*\(.*\)$/.test(functionSelector))
                    return text(`Invalid functionSelector: "${functionSelector}" (e.g. "transfer(address,uint256)").`);
                parameter = a.parameter ? String(a.parameter).replace(/^0x/, '') : '';
                if (parameter && !/^[0-9a-fA-F]*$/.test(parameter))
                    return text('parameter must be hex (no 0x).');
                callValueSun = a.callValueTrx !== undefined ? parseUnits(String(a.callValueTrx), TRX_DECIMALS) : 0n;
                contract = c;
                unsigned = await buildContractCall(network, { ownerBase58: agentTron, contractBase58: c, functionSelector, parameter, feeLimitSun, callValueSun });
                policyTo = c;
                policyValueSun = callValueSun;
                summary = [`Type:   contract call`, `Contract: ${c}`, `Function: ${functionSelector}`, `callValue: ${formatUnits(callValueSun, TRX_DECIMALS)} TRX`];
            }
            else {
                return text(`Unknown kind "${kind}". Use trx_transfer | trc20_transfer | contract_call.`);
            }
            // 3. Decode the node's raw_data and CROSS-CHECK against the intent (defense in
            //    depth: the owner must be the agent; the destination + value must match).
            const decoded = decodeRawData(unsigned.raw_data);
            if (decoded.ownerBase58 !== agentTron) {
                return text(`⛔ Refused: built tx owner ${decoded.ownerBase58} is not the agent ${agentTron}.`);
            }
            if (decoded.toBase58 !== policyTo) {
                return text(`⛔ Refused: built tx destination ${decoded.toBase58} does not match the requested ${policyTo} (node mismatch).`);
            }
            if (decoded.valueSun !== policyValueSun) {
                return text(`⛔ Refused: built tx value ${decoded.valueSun} SUN does not match the requested ${policyValueSun} SUN (node mismatch).`);
            }
            // Cross-check the CALLDATA (selector + recipient + amount) against what we
            // asked the node to build. Closes the node-trust gap: a malicious/buggy
            // node cannot encode a different TRC-20 recipient/amount (or contract call)
            // than requested — the calldata is deterministic, so it must match exactly.
            if (contract) {
                const expectedData = (toFunctionSelector(functionSelector).slice(2) + parameter).toLowerCase();
                if ((decoded.data ?? '').toLowerCase() !== expectedData) {
                    return text(`⛔ Refused: built tx calldata does not match the requested call (node mismatch).`);
                }
            }
            // 4. The single policy decision point (fail-closed velocity semantics inside).
            const intent = { owner: agentTron, to: policyTo, valueSun: policyValueSun, feeLimitSun: contract ? feeLimitSun : 0n, memo };
            const decision = checkTronPolicy(intent, policy, spendStats(24, 'tron'));
            if (!decision.allowed)
                return refusalBlock(decision.reason, decision.policyDigest);
            // 5. Revert pre-check for contract calls (never broadcast a tx that would revert).
            if (contract) {
                const pre = await constantPrecheck(network, { ownerBase58: agentTron, contractBase58: contract, functionSelector, parameter });
                if (!pre.ok) {
                    return text(`⛔ Refused: the call reverts in simulation (${pre.message || 'constant call failed'}). A policy-fenced agent never broadcasts a tx that cannot succeed. Fix the inputs (balance? approval? slippage?) and retry.`);
                }
            }
            // 6. Verify txID==SHA256(raw_data_hex) and sign (signUnsignedTx enforces it).
            const account = loadAccount();
            if (deriveTronAddress(account) !== agentTron) {
                return text('⛔ Refused: decrypted key does not derive the recorded Tron address (keystore integrity).');
            }
            const signed = await signUnsignedTx(account, unsigned);
            // 7. Broadcast.
            const result = await broadcastTransaction(network, signed);
            if (result.result !== true) {
                return text(`Broadcast rejected by the node: ${result.code ?? ''} ${decodeBroadcastMessage(result.message)}`.trim());
            }
            const txid = result.txid ?? unsigned.txID;
            // 8. Journal — feeds the SUN velocity caps (tron-class only).
            try {
                logActivity({
                    ts: new Date().toISOString(),
                    chain: network === 'mainnet' ? 'tron' : `tron-${network}`,
                    chainId: 0,
                    from: agentTron,
                    to: policyTo,
                    valueWei: policyValueSun.toString(),
                    hash: txid,
                    memo,
                    policyDigest: decision.policyDigest,
                });
            }
            catch { /* best-effort */ }
            return text([
                `✓ Signed and broadcast on Tron ${network}.`,
                ``,
                ...summary,
                `txID:          ${txid}`,
                `Explorer:      https://tronscan.org/#/transaction/${txid.replace(/^0x/, '')}`,
                `Spend counted: ${formatUnits(policyValueSun, TRX_DECIMALS)} TRX (journaled to the velocity ledger)`,
                `Memo:          ${memo ?? '(none)'}`,
                `Policy digest: ${decision.policyDigest}`,
            ].join('\n'));
        }
        return text(`Unknown agent-wallet-tron tool: ${name}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChainGPT Agent Wallet (Tron) error: ${message}`);
    }
}
