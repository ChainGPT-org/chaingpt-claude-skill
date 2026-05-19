/**
 * Quote a DEX swap on mainnet with the full pre-flight pipeline.
 *
 * Demonstrates how Claude orchestrates a mainnet trade before asking the user
 * to sign:
 *   1. Confirm the OUT token isn't a honeypot (GoPlus)
 *   2. Get a quote (OpenOcean) — surface price impact + min-out
 *   3. Show the unsigned swap tx the user would need to sign
 *
 * No signing is performed — this script never asks for a private key.
 *
 * Run:
 *   node examples/js/dex-swap-preflight.js
 */
import 'dotenv/config';

const NETWORK = 'base'; // ethereum, base, arbitrum, optimism, polygon, bsc, etc.
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; // ETH on Base
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const AMOUNT = '0.01'; // 0.01 ETH
const ACCOUNT = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // example wallet

// OpenOcean chain slug map
const OO = { ethereum: 'eth', base: 'base', arbitrum: 'arbitrum', optimism: 'optimism', polygon: 'polygon', bsc: 'bsc' };
const CHAIN_IDS = { ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137, bsc: 56 };

// ─── 1. GoPlus honeypot check on the OUT token ───────────────────
async function checkOutTokenSafe(chainId, outToken) {
  if (outToken === NATIVE) return; // native coins are not honeypots
  const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${outToken}`);
  const json = await r.json();
  const row = json.result?.[outToken.toLowerCase()];
  if (!row) {
    console.log('⚠ GoPlus has no data for this token. Proceed with caution.');
    return;
  }
  if (row.is_honeypot === '1' || row.cannot_sell_all === '1') {
    throw new Error(`✗ REFUSING SWAP — ${outToken} is flagged as honeypot / cannot-sell-all by GoPlus.`);
  }
  console.log(`✓ GoPlus check passed — buy/sell tax ${(Number(row.buy_tax ?? 0) * 100).toFixed(2)}% / ${(Number(row.sell_tax ?? 0) * 100).toFixed(2)}%`);
}

// ─── 2. eth_gasPrice via public RPC ─────────────────────────────
async function fetchGasGwei() {
  const RPC = { ethereum: 'https://ethereum-rpc.publicnode.com', base: 'https://mainnet.base.org',
                arbitrum: 'https://arb1.arbitrum.io/rpc', optimism: 'https://mainnet.optimism.io',
                polygon: 'https://polygon-rpc.com', bsc: 'https://bsc-dataseed.binance.org' };
  const url = RPC[NETWORK];
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
  });
  const j = await r.json();
  return Number(BigInt(j.result) / 1_000_000_000n) || 1;
}

// ─── 3. OpenOcean quote ─────────────────────────────────────────
async function quote(inToken, outToken, amountIn, gasPriceGwei) {
  const url =
    `https://open-api.openocean.finance/v4/${OO[NETWORK]}/quote?` +
    new URLSearchParams({
      inTokenAddress: inToken,
      outTokenAddress: outToken,
      amount: amountIn,
      slippage: '1', // 1%
      account: ACCOUNT,
      gasPrice: String(gasPriceGwei),
    });
  const r = await fetch(url);
  const j = await r.json();
  const d = j.data;
  if (!d) throw new Error(`OpenOcean quote failed: ${JSON.stringify(j)}`);
  return d;
}

// ─── 4. OpenOcean swap (returns unsigned tx) ────────────────────
async function swapTx(inToken, outToken, amountIn, gasPriceGwei) {
  const url =
    `https://open-api.openocean.finance/v4/${OO[NETWORK]}/swap?` +
    new URLSearchParams({
      inTokenAddress: inToken,
      outTokenAddress: outToken,
      amount: amountIn,
      slippage: '1',
      account: ACCOUNT,
      gasPrice: String(gasPriceGwei),
    });
  const r = await fetch(url);
  const j = await r.json();
  return j.data;
}

// ─── Pipeline ────────────────────────────────────────────────────
try {
  console.log(`══ DEX swap pre-flight — ${AMOUNT} ETH → USDC on ${NETWORK} ══\n`);
  await checkOutTokenSafe(CHAIN_IDS[NETWORK], USDC);
  const gasGwei = await fetchGasGwei();
  console.log(`✓ Current gas: ${gasGwei} gwei`);
  const q = await quote(NATIVE, USDC, AMOUNT, gasGwei);
  const inSym = q.inToken?.symbol ?? 'ETH';
  const outSym = q.outToken?.symbol ?? 'USDC';
  const outAmt = Number(BigInt(q.outAmount) / 10n ** BigInt(q.outToken?.decimals ?? 6));
  console.log(`✓ Quote: ${AMOUNT} ${inSym} → ~${outAmt} ${outSym}`);
  console.log(`  Route: ${(q.dexes ?? []).map((d) => d.dexCode ?? d).slice(0, 3).join(' → ')}`);
  const tx = await swapTx(NATIVE, USDC, AMOUNT, gasGwei);
  console.log('\n──── Unsigned swap transaction ────');
  console.log(JSON.stringify({
    chainId: CHAIN_IDS[NETWORK],
    to: tx.to,
    data: tx.data?.slice(0, 80) + '…',
    value: tx.value,
    gas: tx.estimatedGas,
  }, null, 2));
  console.log('\nPaste into MetaMask / Rabby / sign via your wallet to execute.');
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
}
