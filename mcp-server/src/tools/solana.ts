import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import {
  makeConnection,
  withRpcFallback,
  parseAddress,
  buildVersionedTransaction,
  serializeUnsigned,
  deserializeUnsigned,
  buildSolTransferInstruction,
  buildSplTransferCheckedInstruction,
  buildCreateAtaIdempotentInstruction,
  deriveAssociatedTokenAccount,
  fetchMintInfo,
  isMainnet,
  SOL_LAMPORTS_PER_SOL,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type SolanaNetwork,
} from '../lib/solana-sign.js';

/**
 * Tier-6.5 Solana signing foundation. Custody-free.
 *
 * The plugin never sees a Solana private key. Every state-changing tool here
 * returns an unsigned base64-encoded VersionedTransaction. The user signs
 * externally (Phantom, Backpack, Solflare, hardware wallet) and broadcasts
 * via their preferred RPC.
 *
 * This module is the foundation that follow-up PRs build on for full
 * Drift / Marginfi / Kamino signed execution. Today's surface:
 *
 *   chaingpt_solana_build_transfer_tx — native SOL or SPL token transfer
 *   chaingpt_solana_decode_tx         — decode an unsigned tx for review
 *
 * The transfer tool handles SOL and any SPL token (Token + Token-2022),
 * derives Associated Token Accounts, fetches decimals from the mint
 * account, and includes an idempotent ATA-creation instruction so first-time
 * recipients work automatically.
 *
 * Mainnet safety gate: every state-changing tool refuses without
 * acknowledgeMainnet:true on the mainnet network. Same pattern as the EVM
 * tools — see feedback_mainnet_default.
 */

const NETWORKS: SolanaNetwork[] = ['mainnet', 'devnet', 'testnet'];

export const solanaTools: Tool[] = [
  {
    name: 'chaingpt_solana_build_transfer_tx',
    description:
      'Build an UNSIGNED Solana transfer transaction (custody-free). Handles native SOL transfers ' +
      'when `mint` is omitted, and SPL token transfers (classic Token + Token-2022 auto-detected) ' +
      'when `mint` is provided. Returns a base64-encoded VersionedTransaction the user signs with ' +
      'Phantom / Backpack / Solflare / hardware wallet. For SPL transfers, the tool auto-derives the ' +
      'sender + recipient Associated Token Accounts, fetches decimals from the mint, and includes an ' +
      'idempotent ATA-creation instruction so first-time-recipient transfers work without an extra ' +
      'setup step. MAINNET-gated: requires acknowledgeMainnet:true on network=mainnet. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description:
            'Base58 sender address. This is the wallet that will sign the transaction and pay fees. ' +
            'For SPL transfers, this is the OWNER address (not the ATA — the ATA is derived).',
        },
        to: {
          type: 'string',
          description:
            'Base58 recipient address (owner address, not ATA). For SPL transfers, the recipient ATA ' +
            'is derived; if it does not exist, an idempotent create-ATA instruction is included.',
        },
        amount: {
          type: 'string',
          description:
            'Human-readable amount as a string (e.g. "1.5" for 1.5 SOL or 1.5 USDC). Decimals are ' +
            'fetched from the mint for SPL transfers, or LAMPORTS_PER_SOL (9) for native SOL.',
        },
        mint: {
          type: 'string',
          description:
            'Optional. Base58 SPL token mint address. Omit for native SOL. Examples: USDC mainnet = ' +
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v ; USDT mainnet = Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB. ' +
            'Token-2022 mints are auto-detected from the mint account owner.',
        },
        network: {
          type: 'string',
          enum: NETWORKS,
          description: 'Solana network. Default: mainnet.',
          default: 'mainnet',
        },
        acknowledgeMainnet: {
          type: 'boolean',
          description:
            'Must be true when network=mainnet. Prevents accidental mainnet tx construction. ' +
            'See feedback_mainnet_default for rationale.',
          default: false,
        },
      },
      required: ['from', 'to', 'amount'],
    },
  },
  {
    name: 'chaingpt_solana_decode_tx',
    description:
      'Decode an unsigned base64-encoded Solana VersionedTransaction for human review. Returns the ' +
      'payer, blockhash, instructions list (program id + key list + data length), and the address-' +
      'lookup-table addresses if any. Use this to sanity-check what you are about to sign before ' +
      'forwarding to a wallet. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        txBase64: {
          type: 'string',
          description: 'The base64-encoded VersionedTransaction returned by build_transfer_tx (or any other Solana signer).',
        },
      },
      required: ['txBase64'],
    },
  },
];

function decimalToBaseUnits(amount: string, decimals: number): bigint {
  if (typeof amount !== 'string') {
    throw new Error('amount must be a string (passed a number? use String(x) to avoid float drift)');
  }
  const cleaned = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`amount: invalid decimal "${amount}" (expected "1.5", "100", "0.000001")`);
  }
  const [whole, frac = ''] = cleaned.split('.');
  if (frac.length > decimals) {
    throw new Error(
      `amount "${amount}" has ${frac.length} fractional digits but mint has only ${decimals} decimals`,
    );
  }
  const padded = (frac + '0'.repeat(decimals - frac.length));
  return BigInt(whole + padded);
}

async function handleBuildTransferTx(args: any): Promise<string> {
  const network: SolanaNetwork = (args.network ?? 'mainnet') as SolanaNetwork;
  if (!NETWORKS.includes(network)) {
    throw new Error(`network: "${network}" not supported. Use one of: ${NETWORKS.join(', ')}`);
  }
  if (isMainnet(network) && args.acknowledgeMainnet !== true) {
    return [
      `Refusing to build a Solana mainnet transaction without acknowledgeMainnet:true.`,
      ``,
      `This guard prevents accidental real-money transactions. Re-call with acknowledgeMainnet:true`,
      `after you have:`,
      `  • verified the recipient address (Solana addresses are not reversible-typo-safe)`,
      `  • verified the amount and mint`,
      `  • set network correctly (devnet/testnet for testing)`,
    ].join('\n');
  }

  const from = parseAddress(args.from, 'from');
  const to = parseAddress(args.to, 'to');
  const amount: string = args.amount;
  const mintArg: string | undefined = args.mint;

  const instructions: TransactionInstruction[] = [];
  let summary: string[] = [];

  // For SPL transfers we need a fresh mint-info read off-chain. Wrap this in
  // withRpcFallback so a single endpoint outage doesn't break the whole call.
  if (!mintArg) {
    // Native SOL transfer
    const lamports = decimalToBaseUnits(amount, 9);
    instructions.push(buildSolTransferInstruction({ from, to, lamports }));
    summary.push(
      `Native SOL transfer`,
      `  from:    ${from.toBase58()}`,
      `  to:      ${to.toBase58()}`,
      `  amount:  ${amount} SOL (${lamports.toString()} lamports)`,
    );
  } else {
    const mint = parseAddress(mintArg, 'mint');
    const mintInfo = await withRpcFallback(network, (c) => fetchMintInfo(c, mint));
    const baseUnits = decimalToBaseUnits(amount, mintInfo.decimals);
    const sourceAta = deriveAssociatedTokenAccount(from, mint, mintInfo.tokenProgramId);
    const destAta = deriveAssociatedTokenAccount(to, mint, mintInfo.tokenProgramId);

    // Idempotent create-ATA for the recipient. Safe to always include — no-ops if it already exists.
    instructions.push(buildCreateAtaIdempotentInstruction({
      payer: from,
      ata: destAta,
      owner: to,
      mint,
      tokenProgramId: mintInfo.tokenProgramId,
    }));
    instructions.push(buildSplTransferCheckedInstruction({
      source: sourceAta,
      destination: destAta,
      owner: from,
      mint,
      amount: baseUnits,
      decimals: mintInfo.decimals,
      tokenProgramId: mintInfo.tokenProgramId,
    }));

    const tokenStandard = mintInfo.tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'SPL Token';
    summary.push(
      `${tokenStandard} transfer`,
      `  mint:        ${mint.toBase58()} (decimals=${mintInfo.decimals})`,
      `  from owner:  ${from.toBase58()}`,
      `  from ATA:    ${sourceAta.toBase58()}`,
      `  to owner:    ${to.toBase58()}`,
      `  to ATA:      ${destAta.toBase58()}  (create-if-missing instruction included)`,
      `  amount:      ${amount} (${baseUnits.toString()} base units)`,
    );
  }

  const { tx, blockhash, lastValidBlockHeight } = await withRpcFallback(network, (c) =>
    buildVersionedTransaction({ payer: from, instructions, connection: c }),
  );
  const base64 = serializeUnsigned(tx);

  return [
    `=== Solana ${network.toUpperCase()} unsigned transaction ===`,
    ``,
    ...summary,
    ``,
    `blockhash:         ${blockhash}`,
    `lastValidBlockHt:  ${lastValidBlockHeight}`,
    `instructions:      ${instructions.length}`,
    ``,
    `--- UNSIGNED VersionedTransaction (base64) ---`,
    base64,
    `--- END ---`,
    ``,
    `Next steps for the signer:`,
    `  1. Decode + review: chaingpt_solana_decode_tx with this base64`,
    `  2. Sign with the wallet that holds ${from.toBase58()}`,
    `  3. Submit via sendRawTransaction to ${network === 'mainnet' ? 'mainnet-beta.solana.com' : network + '.solana.com'}`,
    `  4. The tx is valid until block ${lastValidBlockHeight} (~ 2 minutes from now)`,
  ].join('\n');
}

async function handleDecodeTx(args: any): Promise<string> {
  if (typeof args.txBase64 !== 'string' || args.txBase64.length === 0) {
    throw new Error('txBase64 required (base64-encoded VersionedTransaction)');
  }
  let tx;
  try {
    tx = deserializeUnsigned(args.txBase64);
  } catch (err: any) {
    throw new Error(`Could not decode VersionedTransaction: ${err.message}`);
  }

  const msg = tx.message;
  const staticKeys = msg.staticAccountKeys.map((k) => k.toBase58());
  const numSigners = msg.header.numRequiredSignatures;
  const payer = staticKeys[0]; // index 0 is always the fee payer per the v0 message spec

  const lines: string[] = [];
  lines.push(`=== Decoded Solana VersionedTransaction (v${msg.version}) ===`);
  lines.push(``);
  lines.push(`payer:                    ${payer}`);
  lines.push(`recent blockhash:         ${msg.recentBlockhash}`);
  lines.push(`required signatures:      ${numSigners}`);
  lines.push(`readonly signed accts:    ${msg.header.numReadonlySignedAccounts}`);
  lines.push(`readonly unsigned accts:  ${msg.header.numReadonlyUnsignedAccounts}`);
  lines.push(`static account keys:      ${staticKeys.length}`);
  if (msg.addressTableLookups.length > 0) {
    lines.push(`address lookup tables:    ${msg.addressTableLookups.length}`);
    for (const lut of msg.addressTableLookups) {
      lines.push(`  - ${lut.accountKey.toBase58()} (writable indices: ${lut.writableIndexes.length}, readonly: ${lut.readonlyIndexes.length})`);
    }
  }
  lines.push(``);
  lines.push(`instructions: ${msg.compiledInstructions.length}`);
  for (let i = 0; i < msg.compiledInstructions.length; i++) {
    const ix = msg.compiledInstructions[i];
    const programId = staticKeys[ix.programIdIndex] ?? `<lookup-index ${ix.programIdIndex}>`;
    lines.push(`  [${i}] program: ${programId}`);
    lines.push(`      keys:    ${ix.accountKeyIndexes.length} accounts (indices: [${[...ix.accountKeyIndexes].join(', ')}])`);
    lines.push(`      data:    ${ix.data.length} bytes (0x${Buffer.from(ix.data).toString('hex').slice(0, 64)}${ix.data.length > 32 ? '…' : ''})`);
  }

  // Annotate well-known programs for at-a-glance review
  const KNOWN: Record<string, string> = {
    '11111111111111111111111111111111': 'System Program (native transfers / account creation)',
    [TOKEN_PROGRAM_ID.toBase58()]: 'SPL Token Program',
    [TOKEN_2022_PROGRAM_ID.toBase58()]: 'SPL Token-2022 Program',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token Program',
    'ComputeBudget111111111111111111111111111111': 'Compute Budget Program',
  };
  const programsUsed = new Set<string>();
  for (const ix of msg.compiledInstructions) {
    const pid = staticKeys[ix.programIdIndex];
    if (pid) programsUsed.add(pid);
  }
  const annotated = [...programsUsed].map((p) => `  • ${p}  ${KNOWN[p] ? '— ' + KNOWN[p] : ''}`);
  if (annotated.length > 0) {
    lines.push(``);
    lines.push(`Programs invoked:`);
    lines.push(...annotated);
  }
  return lines.join('\n');
}

export async function handleSolanaTool(name: string, args: any): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let text: string;
  // Normalize missing args to an empty object so handlers report clean
  // "field required" validation errors instead of TypeErrors on property access.
  const safeArgs = args ?? {};
  try {
    if (name === 'chaingpt_solana_build_transfer_tx') {
      text = await handleBuildTransferTx(safeArgs);
    } else if (name === 'chaingpt_solana_decode_tx') {
      text = await handleDecodeTx(safeArgs);
    } else {
      throw new Error(`Unknown Solana tool: ${name}`);
    }
  } catch (err: any) {
    text = `Error in ${name}: ${err.message}`;
  }
  return { content: [{ type: 'text', text }] };
}

// Re-export constants for tests
export const _internal = { decimalToBaseUnits, NETWORKS };
