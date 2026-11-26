/**
 * Tier-3a DEX-trading tool tests.
 *
 * Validates tool definitions, mainnet safety gate on both EVM and Solana
 * swap-build tools, and quote handlers with mocked HTTP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import './_setup.js';

import { encodeFunctionData } from 'viem';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { dexTools, handleDexTool } from '../tools/dex.js';

describe('Tier-3a DEX tool definitions', () => {
  it('exposes 5 DEX tools', () => {
    const names = dexTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_dex_quote',
      'chaingpt_dex_build_swap_tx',
      'chaingpt_dex_approve_tx',
      'chaingpt_dex_jupiter_quote',
      'chaingpt_dex_jupiter_build_swap_tx',
    ]);
  });

  it('build_swap_tx exposes acknowledgeMainnet flag', () => {
    const t = dexTools.find((t) => t.name === 'chaingpt_dex_build_swap_tx')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeDefined();
  });

  it('jupiter_build_swap_tx exposes acknowledgeMainnet flag', () => {
    const t = dexTools.find((t) => t.name === 'chaingpt_dex_jupiter_build_swap_tx')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeDefined();
  });

  it('EVM tools restrict to OpenOcean-supported chains only', () => {
    const t = dexTools.find((t) => t.name === 'chaingpt_dex_quote')!;
    const enums = (t.inputSchema as any).properties.network.enum as string[];
    // All 10 supported EVM mainnets are present, no testnets
    for (const expected of ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'linea', 'scroll']) {
      expect(enums).toContain(expected);
    }
    expect(enums).not.toContain('sepolia');
  });
});

describe('Tier-3a mainnet safety gate', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaingpt_dex_build_swap_tx refuses without acknowledgeMainnet', async () => {
    const result = await handleDexTool('chaingpt_dex_build_swap_tx', {
      network: 'ethereum',
      inToken: '0x0000000000000000000000000000000000000000',
      outToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amountIn: '0.1',
      account: '0x1111111111111111111111111111111111111111',
    });
    expect(result.content[0].text).toContain('Mainnet swap refused');
    expect(result.content[0].text).toContain('chaingpt_risk_token');
  });

  it('chaingpt_dex_jupiter_build_swap_tx refuses without acknowledgeMainnet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ inAmount: '1000000000', outAmount: '500000', routePlan: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const result = await handleDexTool('chaingpt_dex_jupiter_build_swap_tx', {
      userPublicKey: 'So11111111111111111111111111111111111111112',
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '1',
    });
    expect(result.content[0].text).toContain('Solana mainnet swap refused');
  });
});

describe('Tier-3a quote handlers', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chaingpt_dex_quote surfaces OpenOcean response fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            inToken: { symbol: 'ETH', decimals: 18, address: '0xeee' },
            outToken: { symbol: 'USDC', decimals: 6, address: '0xa0b' },
            inAmount: '100000000000000000', // 0.1 ETH
            outAmount: '350000000', // 350 USDC
            minOutAmount: '346500000',
            estimatedGas: '200000',
            dexes: [{ dexCode: 'UniswapV3' }, { dexCode: 'CurveV2' }],
            price_impact: '0.05',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleDexTool('chaingpt_dex_quote', {
      network: 'ethereum',
      inToken: '0x0000000000000000000000000000000000000000',
      outToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amountIn: '0.1',
      // Pass explicit gasPriceGwei to skip the eth_gasPrice prefetch the handler does
      // when gasPrice isn't provided. Keeps this test to a single fetch call.
      gasPriceGwei: 30,
    });
    const text = res.content[0].text;
    expect(text).toContain('Swap quote');
    expect(text).toContain('ETH');
    expect(text).toContain('USDC');
    expect(text).toContain('UniswapV3');
  });

  it('chaingpt_dex_jupiter_quote surfaces input + output mints', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          inAmount: '1000000000',
          outAmount: '180000000',
          routePlan: [{ swapInfo: { ammKey: 'pool1' } }, { swapInfo: { ammKey: 'pool2' } }],
          priceImpactPct: '0.01',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleDexTool('chaingpt_dex_jupiter_quote', {
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '1',
    });
    const text = res.content[0].text;
    expect(text).toContain('Jupiter quote');
    expect(text).toContain('Route hops:      2');
  });

  it('chaingpt_dex_approve_tx returns the approval tx', async () => {
    // Mock the OpenOcean probe call that resolves the router address
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: { to: '0x6352a56caadc4f1e25cd6c75970fa768a3304e64' } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const res = await handleDexTool('chaingpt_dex_approve_tx', {
      network: 'base',
      token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      owner: '0x1111111111111111111111111111111111111111',
      amount: 'max',
      decimals: 6,
      acknowledgeMainnet: true,
    });
    const text = res.content[0].text;
    expect(text).toContain('ERC-20 approval');
    expect(text).toContain('Spender');
    expect(text).toContain('Unsigned transaction');
    expect(text).toContain('"data"');
  });

  it('chaingpt_dex_approve_tx refuses caller decimals that do not match the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(63) + '6' }), // decimals() == 6
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await handleDexTool('chaingpt_dex_approve_tx', {
      network: 'base', token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', owner: '0x1111111111111111111111111111111111111111', // gitleaks:allow (public token contract address)
      amount: '100', decimals: 18, acknowledgeMainnet: true,
    });
    expect(res.content[0].text).toMatch(/Refused: decimals 18 does not match/);
  });

  it('chaingpt_dex_approve_tx REFUSES without acknowledgeMainnet (approvals delegate spend authority)', async () => {
    const res = await handleDexTool('chaingpt_dex_approve_tx', {
      network: 'base',
      token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      owner: '0x1111111111111111111111111111111111111111',
      amount: 'max',
      decimals: 6,
    });
    const text = res.content[0].text;
    expect(text).toContain('Mainnet approval refused');
    expect(text).not.toContain('Unsigned transaction');
  });
});

// ─── Aggregator-built transactions must be the requested swap ─────────────
const OO_ROUTER = '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64';
const OO_ABI = [{
  type: 'function', name: 'swap', stateMutability: 'payable',
  inputs: [
    { name: 'caller', type: 'address' },
    { name: 'desc', type: 'tuple', components: [
      { name: 'srcToken', type: 'address' }, { name: 'dstToken', type: 'address' },
      { name: 'srcReceiver', type: 'address' }, { name: 'dstReceiver', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'minReturnAmount', type: 'uint256' },
      { name: 'guaranteedAmount', type: 'uint256' }, { name: 'flags', type: 'uint256' },
      { name: 'referrer', type: 'address' }, { name: 'permit', type: 'bytes' },
    ] },
    { name: 'calls', type: 'tuple[]', components: [
      { name: 'target', type: 'uint256' }, { name: 'gasLimit', type: 'uint256' },
      { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
    ] },
  ],
  outputs: [{ name: 'returnAmount', type: 'uint256' }],
}] as const;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0x2222222222222222222222222222222222222222';
const ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

function ooSwapCalldata(over: Partial<{ dstReceiver: `0x${string}`; amount: bigint; minReturnAmount: bigint; dstToken: `0x${string}` }> = {}) {
  const executor = '0x70e003cc4f8cc3f1320e1e7e266c97fe3672f9cf';
  return encodeFunctionData({
    abi: OO_ABI, functionName: 'swap',
    args: [executor, {
      srcToken: ETH, dstToken: over.dstToken ?? USDC, srcReceiver: executor, dstReceiver: over.dstReceiver ?? ACCOUNT,
      amount: over.amount ?? 100000000000000000n, minReturnAmount: over.minReturnAmount ?? 346500000n,
      guaranteedAmount: 349000000n, flags: 0n, referrer: '0x0000000000000000000000000000000000000000', permit: '0x',
    }, []],
  });
}

function mockOpenOceanSwap(over: Record<string, unknown> = {}) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
    code: 200,
    data: {
      inToken: { symbol: 'ETH', decimals: 18, address: ETH }, outToken: { symbol: 'USDC', decimals: 6, address: USDC },
      inAmount: '100000000000000000', outAmount: '350000000', minOutAmount: '346500000', estimatedGas: '200000',
      to: OO_ROUTER, value: '100000000000000000', data: ooSwapCalldata(), ...over,
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const buildEthToUsdc = () => handleDexTool('chaingpt_dex_build_swap_tx', {
  network: 'ethereum', inToken: '0x0000000000000000000000000000000000000000', outToken: USDC,
  amountIn: '0.1', account: ACCOUNT, gasPriceGwei: 30, acknowledgeMainnet: true,
});

describe('OpenOcean swap tx is checked against the request', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns a router swap that matches the request', async () => {
    mockOpenOceanSwap();
    const text = (await buildEthToUsdc()).content[0].text;
    expect(text).toContain('Unsigned transaction');
    expect(text).toContain(OO_ROUTER);
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ['a different target contract', { to: ATTACKER }],
    ['calldata that is not swap()', { data: '0x095ea7b3' + '0'.repeat(128) }],
    ['output paid to someone else', { data: ooSwapCalldata({ dstReceiver: ATTACKER }) }],
    ['a different output token', { data: ooSwapCalldata({ dstToken: ATTACKER }) }],
    ['a different input amount', { data: ooSwapCalldata({ amount: 200000000000000000n }) }],
    ['a lower minimum than shown', { data: ooSwapCalldata({ minReturnAmount: 1n }) }],
    ['native value above the input', { value: '900000000000000000' }],
  ];
  for (const [label, over] of cases) {
    it(`refuses ${label}`, async () => {
      mockOpenOceanSwap(over);
      await expect(buildEthToUsdc()).rejects.toThrow(/refusing to build it/);
    });
  }

  it('refuses to build a swap without a real account', async () => {
    await expect(handleDexTool('chaingpt_dex_build_swap_tx', {
      network: 'ethereum', inToken: '0x0000000000000000000000000000000000000000', outToken: USDC,
      amountIn: '0.1', gasPriceGwei: 30, acknowledgeMainnet: true,
    })).rejects.toThrow(/account must be/);
  });
});

const JUP = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const WSOL = 'So11111111111111111111111111111111111111112';
const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ata = (owner: PublicKey, mint: string) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), new PublicKey(mint).toBuffer()], ATA_PROGRAM)[0];

function routeData(inAmount: bigint, slippageBps = 50, feeBps = 0) {
  const tail = Buffer.alloc(19);
  tail.writeBigUInt64LE(inAmount, 0);
  tail.writeBigUInt64LE(180000000n, 8);
  tail.writeUInt16LE(slippageBps, 16);
  tail[18] = feeBps;
  // route discriminator, then an (empty) route plan vec, then the fixed tail
  return Buffer.concat([Buffer.from('e517cb977ae3ad2a', 'hex'), Buffer.from([0, 0, 0, 0]), tail]);
}

function jupiterSwapTx(user: PublicKey, over: { transferTo?: PublicKey; destination?: PublicKey; feePayer?: PublicKey; unitPrice?: number; inAmount?: bigint } = {}) {
  const wsol = ata(user, WSOL);
  const usdc = ata(user, SOL_USDC);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: over.unitPrice ?? 1_000 }),
    SystemProgram.transfer({ fromPubkey: user, toPubkey: over.transferTo ?? wsol, lamports: 1_000_000_000 }),
    new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: wsol, isSigner: false, isWritable: true }], data: Buffer.from([17]) }),
    new TransactionInstruction({
      programId: JUP,
      keys: [TOKEN, user, wsol, over.destination ?? usdc, JUP, new PublicKey(SOL_USDC)].map((pubkey, i) => ({ pubkey, isSigner: i === 1, isWritable: i === 2 || i === 3 })),
      data: routeData(over.inAmount ?? 1_000_000_000n),
    }),
    new TransactionInstruction({
      programId: TOKEN,
      keys: [{ pubkey: wsol, isSigner: false, isWritable: true }, { pubkey: user, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }],
      data: Buffer.from([9]),
    }),
  ];
  const message = new TransactionMessage({ payerKey: over.feePayer ?? user, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

function mockJupiter(swapTransaction: string, quote: Record<string, unknown> = {}) {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ inputMint: WSOL, outputMint: SOL_USDC, inAmount: '1000000000', outAmount: '180000000', routePlan: [], ...quote }))
    .mockResolvedValueOnce(json({ swapTransaction }));
}

describe('Jupiter swap tx is checked against the request', () => {
  beforeEach(() => vi.restoreAllMocks());
  const user = Keypair.generate().publicKey;
  const build = () => handleDexTool('chaingpt_dex_jupiter_build_swap_tx', {
    userPublicKey: user.toBase58(), inputMint: WSOL, outputMint: SOL_USDC, amountIn: '1', acknowledgeMainnet: true,
  });

  it('returns a wrap + route + unwrap transaction for the user', async () => {
    const tx = jupiterSwapTx(user);
    mockJupiter(tx);
    expect((await build()).content[0].text).toContain(tx);
  });

  const cases: Array<[string, Parameters<typeof jupiterSwapTx>[1]]> = [
    ['SOL sent to another account', { transferTo: Keypair.generate().publicKey }],
    ['swap output paid to another account', { destination: ata(Keypair.generate().publicKey, SOL_USDC) }],
    ['another fee payer', { feePayer: Keypair.generate().publicKey }],
    ['a different route amount', { inAmount: 5_000_000_000n }],
    ['a priority fee above 0.01 SOL', { unitPrice: 1_000_000_000 }],
  ];
  for (const [label, over] of cases) {
    it(`refuses ${label}`, async () => {
      mockJupiter(jupiterSwapTx(user, over));
      await expect(build()).rejects.toThrow(/Jupiter swap transaction refused/);
    });
  }

  it('refuses a quote for other mints or another amount', async () => {
    mockJupiter(jupiterSwapTx(user), { outputMint: WSOL });
    await expect(build()).rejects.toThrow(/does not match the requested mints or amount/);
  });
});
