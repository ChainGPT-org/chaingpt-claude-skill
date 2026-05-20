import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  type TransactionInstruction,
  type AddressLookupTableAccount,
} from '@solana/web3.js';
import { parseAddress, makeConnection, serializeUnsigned } from '../lib/solana-sign.js';

/**
 * Tier-6.5b Marginfi v2 signed actions — deposit + withdraw. Custody-free.
 *
 * The plugin builds an UNSIGNED Solana VersionedTransaction and returns it
 * base64-encoded. The user signs externally (Phantom / Backpack / hardware
 * wallet) and broadcasts. The plugin never holds a Solana key.
 *
 * Correctness: the instruction encoding is produced by Marginfi's OWN SDK
 * (`@mrgnlabs/marginfi-client-v2`), which resolves the current on-chain IDL,
 * PDA derivations, account ordering, and arg layout. We do NOT hand-roll the
 * instruction — a prior investigation found the deposit arg layout drifted
 * between IDL 0.1.0 (1 arg) and 0.1.7 (2 args), so hand-rolling from a
 * convenient bundled IDL would have shipped malformed fund-moving txs. The
 * SDK is the single source of truth.
 *
 * The SDK is heavy (~94MB with Anchor). It is imported LAZILY (dynamic
 * import inside the handler) so the base MCP server startup is not slowed —
 * the 163-package tree only loads when someone actually builds a Marginfi tx.
 *
 * Bank preloading (correctness + speed): MarginfiClient.fetch by default runs
 * a getProgramAccounts scan that decodes EVERY bank on the production group
 * with the SDK's bundled IDL. As of mainnet today at least one live bank
 * carries an account/enum layout the published IDL (v6.4.1) cannot decode, so
 * the default fetch throws `Union.decode: Cannot read properties of null`
 * before it ever reaches our instruction. We sidestep that by resolving the
 * single target bank's address from Marginfi's published bank-metadata map and
 * passing it as `preloadedBankAddresses`, which makes the SDK `fetchMultiple`
 * only that bank (skipping the brittle full-group scan). This both fixes the
 * crash and removes a heavy gpa call. Verified live against mainnet.
 *
 * Verification: every built tx is run through `simulateTransaction` against
 * mainnet before it is returned. A malformed instruction surfaces as a
 * program deserialize / account-resolution error in the simulation; a
 * well-formed instruction either succeeds or fails only for state reasons
 * (e.g. insufficient balance), which still proves the encoding is correct.
 * The simulation result is included in the tool output.
 *
 * Mainnet-only: Marginfi v2 runs on Solana mainnet. acknowledgeMainnet:true
 * is required, same gate as the EVM tools.
 */

export const marginfiSignedTools: Tool[] = [
  {
    name: 'chaingpt_defi_marginfi_deposit_tx',
    description:
      'Build an UNSIGNED Marginfi v2 deposit transaction (Solana mainnet, custody-free). Lends a token into a ' +
      "Marginfi bank from the user's existing Marginfi account. The instruction is encoded by Marginfi's own SDK " +
      '(correct IDL + PDA derivations) and the built tx is simulated against mainnet before return. Returns a ' +
      'base64 VersionedTransaction the user signs with Phantom / Backpack / hardware wallet. Requires an existing ' +
      'Marginfi account for the address (create one at app.marginfi.com first). acknowledgeMainnet:true required. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Base58 owner address. Signs + pays fees. Must already have a Marginfi account.' },
        symbol: { type: 'string', description: 'Token symbol of the bank to deposit into (e.g. "USDC", "SOL"). Either symbol or mint is required.' },
        mint: { type: 'string', description: 'Base58 token mint address of the bank. Use instead of symbol for exact targeting.' },
        amount: { type: 'string', description: 'Human-readable amount as a string (e.g. "100" USDC, "1.5" SOL). Decimals handled by the SDK from the bank mint.' },
        acknowledgeMainnet: { type: 'boolean', description: 'Must be true. Marginfi is mainnet-only.', default: false },
      },
      required: ['from', 'amount'],
    },
  },
  {
    name: 'chaingpt_defi_marginfi_withdraw_tx',
    description:
      'Build an UNSIGNED Marginfi v2 withdraw transaction (Solana mainnet, custody-free). Withdraws a previously ' +
      'deposited token from a Marginfi bank back to the user. Encoded by Marginfi\'s SDK + simulated against ' +
      'mainnet before return. Returns a base64 VersionedTransaction for external signing. acknowledgeMainnet:true ' +
      'required. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Base58 owner address with the Marginfi deposit position.' },
        symbol: { type: 'string', description: 'Token symbol of the bank to withdraw from. Either symbol or mint required.' },
        mint: { type: 'string', description: 'Base58 token mint of the bank. Use instead of symbol.' },
        amount: { type: 'string', description: 'Human-readable amount to withdraw. Ignored if withdrawAll=true.' },
        withdrawAll: { type: 'boolean', description: 'Withdraw the entire deposited balance for this bank. Default false.', default: false },
        acknowledgeMainnet: { type: 'boolean', description: 'Must be true. Marginfi is mainnet-only.', default: false },
      },
      required: ['from'],
    },
  },
];

// Read-only Wallet shim for the Marginfi SDK. The SDK only needs `publicKey`
// to derive accounts + set the fee payer when building instructions; we never
// call the sign methods (the user signs externally). If anything tries to
// sign, it throws loudly — a guarantee the plugin never signs Solana txs.
function readonlyWallet(pubkey: PublicKey): any {
  const refuse = async (): Promise<never> => {
    throw new Error('custody-free: the agent wallet shim never signs — the user signs externally.');
  };
  return { publicKey: pubkey, signTransaction: refuse, signAllTransactions: refuse };
}

function fmtSim(sim: { value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }): string {
  const { err, logs, unitsConsumed } = sim.value;
  if (err === null) {
    return [
      `Simulation: ✅ OK (the Marginfi program accepted the instruction)`,
      unitsConsumed ? `  compute units: ${unitsConsumed}` : '',
    ].filter(Boolean).join('\n');
  }
  // A non-null err can be a benign STATE error (insufficient funds, no position
  // yet) — which still proves the encoding deserialized — or a real ENCODING
  // error. The reliable signal: Anchor logs `Program log: Instruction: <name>`
  // only AFTER it has successfully deserialized the instruction data AND
  // resolved every account. So if we see that line, our encoding is correct and
  // any further error is the program rejecting on business rules (state). We do
  // NOT pattern-match the error string for "AccountNotFound" etc. — Marginfi's
  // program-level `BankAccountNotFound` (no position in that bank) is a benign
  // state error that would false-positive on a naive substring check.
  const errStr = typeof err === 'string' ? err : JSON.stringify(err);
  const logStr = (logs ?? []).join('\n');
  const reachedHandler = /Program log: Instruction:/.test(logStr);
  // Errors that fire BEFORE the handler runs => the instruction never
  // deserialized / accounts didn't resolve => real encoding/account problem.
  const preHandlerEncodingError = /InstructionDidNotDeserialize|InvalidInstructionData|insufficient account keys|Failed to (de)?serialize|Program failed to complete|An account required by the instruction is missing/i.test(
    errStr + '\n' + logStr,
  );
  const encodingProblem = !reachedHandler && preHandlerEncodingError;
  return [
    `Simulation: ⚠ returned an error — ${errStr}`,
    encodingProblem
      ? `  ⛔ ENCODING/ACCOUNT problem — the instruction did not deserialize or an account failed to resolve. DO NOT sign this tx.`
      : reachedHandler
        ? `  ✅ Encoding verified: the Marginfi program deserialized the instruction and ran its handler. This is a STATE error (e.g. insufficient balance, or no position in this bank yet) — the tx is correctly built; it just won't succeed for THIS account/amount right now.`
        : `  This is likely a STATE error — the encoding appears fine. Review the logs below before signing.`,
    `  Program logs (tail):`,
    ...(logs ?? []).slice(-8).map((l) => `    ${l}`),
  ].join('\n');
}

async function buildMarginfiAction(kind: 'deposit' | 'withdraw', args: any): Promise<string> {
  if (args.acknowledgeMainnet !== true) {
    return [
      `Refusing to build a Marginfi mainnet ${kind} transaction without acknowledgeMainnet:true.`,
      ``,
      `Marginfi v2 is Solana mainnet only. Re-call with acknowledgeMainnet:true after you have`,
      `verified the bank (symbol/mint), the amount, and that ${args.from} has the position.`,
    ].join('\n');
  }
  const user = parseAddress(args.from, 'from');
  if (!args.symbol && !args.mint) throw new Error('Provide either symbol (e.g. "USDC") or mint to identify the bank.');
  const amount: string | undefined = args.amount;
  const withdrawAll = args.withdrawAll === true;
  if (kind === 'deposit' && !amount) throw new Error('amount is required for deposit.');
  if (kind === 'withdraw' && !amount && !withdrawAll) throw new Error('Provide amount, or set withdrawAll:true.');

  // Lazy-load the heavy SDK only when a Marginfi tx is actually requested.
  const { MarginfiClient, getConfig } = await import('@mrgnlabs/marginfi-client-v2');
  const { loadBankMetadatas, loadStakedBankMetadatas } = await import('@mrgnlabs/mrgn-common');

  // Resolve the target bank address from Marginfi's published metadata so we
  // can preload exactly one bank and skip the brittle full-group scan (see the
  // file header). Metadata maps bankAddress -> { tokenAddress(mint), tokenSymbol }.
  const metadata: Record<string, { tokenAddress?: string; tokenSymbol?: string }> = {
    ...(await loadBankMetadatas().catch(() => ({}))),
    ...(await loadStakedBankMetadatas().catch(() => ({}))),
  };
  const wantSymbol = (args.symbol ?? '').toUpperCase();
  const wantMint = args.mint as string | undefined;
  const matched = Object.entries(metadata).find(([, m]) =>
    wantMint ? m.tokenAddress === wantMint : (m.tokenSymbol ?? '').toUpperCase() === wantSymbol,
  );
  if (!matched) {
    throw new Error(
      `No Marginfi bank found for ${wantMint ? `mint ${wantMint}` : `symbol "${args.symbol}"`}. ` +
      `Check it against app.marginfi.com — the symbol must match exactly (e.g. "USDC", "SOL", "USDT").`,
    );
  }
  const targetBankAddress = new PublicKey(matched[0]);

  const conn: Connection = makeConnection('mainnet');
  const wallet = readonlyWallet(user);
  const client = await MarginfiClient.fetch(getConfig('production'), wallet, conn, {
    readOnly: true,
    preloadedBankAddresses: [targetBankAddress],
  } as any);

  // We preloaded exactly targetBankAddress, so resolving by its pubkey is the
  // most direct + reliable path. The symbol/mint getters are fallbacks only.
  // Each getter is called inside an explicit guard so it never receives
  // undefined (getBankByMint/getBankByTokenSymbol throw on a nullish arg).
  let bank = client.getBankByPk(targetBankAddress);
  if (!bank && wantMint) bank = client.getBankByMint(wantMint);
  if (!bank && args.symbol) bank = client.getBankByTokenSymbol(args.symbol);
  if (!bank) {
    throw new Error(`Resolved bank ${targetBankAddress.toBase58()} but the SDK did not load it. The bank may be deprecated or the metadata is stale.`);
  }

  const accounts = await client.getMarginfiAccountsForAuthority(user);
  if (accounts.length === 0) {
    throw new Error(
      `No Marginfi account exists for ${user.toBase58()}. Create one first (deposit once via app.marginfi.com, ` +
      `or a future version will prepend an account-creation instruction). This tool deposits into an existing account.`,
    );
  }
  const account = accounts[0];

  let instructions: TransactionInstruction[];
  if (kind === 'deposit') {
    const wrapper = await account.makeDepositIx(amount as string, bank.address);
    instructions = wrapper.instructions;
  } else {
    const wrapper = await account.makeWithdrawIx(withdrawAll ? (amount ?? '0') : (amount as string), bank.address, withdrawAll);
    instructions = wrapper.instructions;
  }

  // Marginfi uses address-lookup tables; include them so the v0 message compiles compactly.
  const luts: AddressLookupTableAccount[] = (client as any).addressLookupTables ?? [];
  const latest = await conn.getLatestBlockhash('finalized');
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message(luts);
  const tx = new VersionedTransaction(message);
  const base64 = serializeUnsigned(tx);

  // VERIFY: simulate against mainnet. replaceRecentBlockhash avoids blockhash
  // staleness; sigVerify:false because the tx is intentionally unsigned.
  let simText: string;
  try {
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    simText = fmtSim(sim as any);
  } catch (e: any) {
    simText = `Simulation: could not run (${e?.message ?? e}). Decode + review the tx manually before signing.`;
  }

  const tokenLabel = (bank as any).tokenSymbol || (bank as any).meta?.tokenSymbol || args.symbol || args.mint;
  return [
    `=== Marginfi v2 ${kind} — UNSIGNED (Solana mainnet) ===`,
    ``,
    `owner:        ${user.toBase58()}`,
    `bank:         ${bank.address.toBase58()} (${tokenLabel})`,
    `amount:       ${withdrawAll ? 'ALL' : amount}`,
    `instructions: ${instructions.length}`,
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

export async function handleMarginfiSignedTool(name: string, args: any): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let text: string;
  const safeArgs = args ?? {};
  try {
    if (name === 'chaingpt_defi_marginfi_deposit_tx') text = await buildMarginfiAction('deposit', safeArgs);
    else if (name === 'chaingpt_defi_marginfi_withdraw_tx') text = await buildMarginfiAction('withdraw', safeArgs);
    else throw new Error(`Unknown Marginfi signed tool: ${name}`);
  } catch (e: any) {
    text = `Error in ${name}: ${e?.message ?? e}`;
  }
  return { content: [{ type: 'text', text }] };
}
