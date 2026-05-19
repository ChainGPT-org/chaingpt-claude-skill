/**
 * Research a token end-to-end and gate on the AI audit.
 *
 * Demonstrates the canonical "research → risk → audit" funnel:
 *   1. DexScreener  — live market data
 *   2. GoPlus       — security flags
 *   3. Etherscan v2 — verified source fetch
 *   4. ChainGPT     — AI security audit (1 credit)
 *
 * This is the pre-flight pattern Claude follows before recommending any
 * mainnet interaction with an unknown token.
 *
 * Run:
 *   CHAINGPT_API_KEY=... ETHERSCAN_API_KEY=... node examples/js/research-token-and-audit.js
 */
import 'dotenv/config';
import { SmartContractAuditor } from '@chaingpt/smartcontractauditor';

const CHAIN = 'ethereum';
const TOKEN = '0x9840652dc04fb9db2c43853633f0f62be6f00f98'; // CGPT on Ethereum

// ─── 1. DexScreener: market data ─────────────────────────────────
async function marketData(address) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  const data = await res.json();
  if (!data.pairs || data.pairs.length === 0) throw new Error('No DexScreener data');
  const top = data.pairs.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0];
  console.log(`\n▎ Market — ${top.baseToken.symbol}/${top.quoteToken.symbol} on ${top.chainId} via ${top.dexId}`);
  console.log(`  Price (USD):     $${Number(top.priceUsd).toPrecision(6)}`);
  console.log(`  24h change:      ${(top.priceChange?.h24 ?? 0).toFixed(2)}%`);
  console.log(`  24h volume:      $${(top.volume?.h24 ?? 0).toLocaleString()}`);
  console.log(`  Liquidity:       $${(top.liquidity?.usd ?? 0).toLocaleString()}`);
  console.log(`  Market cap:      $${(top.marketCap ?? 0).toLocaleString()}`);
  return top;
}

// ─── 2. GoPlus: token security flags ────────────────────────────
async function tokenRisk(chainId, address) {
  const res = await fetch(
    `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`
  );
  const json = await res.json();
  const row = json.result?.[address.toLowerCase()];
  if (!row) throw new Error('GoPlus has no data for this token');
  const flags = [];
  if (row.is_honeypot === '1') flags.push('HONEYPOT');
  if (row.is_mintable === '1') flags.push('mintable');
  if (row.is_proxy === '1') flags.push('proxy');
  if (row.cannot_sell_all === '1') flags.push('cannot-sell-all');
  if (row.hidden_owner === '1') flags.push('hidden-owner');
  console.log(`\n▎ Security — ${row.token_name} (${row.token_symbol})`);
  console.log(`  Holders:         ${row.holder_count ?? 'n/a'}`);
  console.log(`  Buy / sell tax:  ${(Number(row.buy_tax ?? 0) * 100).toFixed(2)}% / ${(Number(row.sell_tax ?? 0) * 100).toFixed(2)}%`);
  console.log(`  Flags:           ${flags.length === 0 ? '✓ none' : '⚠ ' + flags.join(', ')}`);
  if (flags.includes('HONEYPOT') || flags.includes('cannot-sell-all')) {
    throw new Error('Critical risk flag — refusing to proceed to audit');
  }
  return row;
}

// ─── 3. Etherscan v2: verified source ───────────────────────────
async function fetchSource(chainId, address) {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) {
    console.log('\n▎ Source fetch — SKIPPED (set ETHERSCAN_API_KEY for full audit)');
    return null;
  }
  const url =
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode` +
    `&address=${address}&apikey=${key}`;
  const res = await fetch(url);
  const json = await res.json();
  const row = json.result?.[0];
  if (!row || !row.SourceCode) {
    console.log('\n▎ Source fetch — contract not verified on Etherscan');
    return null;
  }
  let source = row.SourceCode;
  // Etherscan returns multi-file source as a `{{json}}` blob; extract the first file's content
  if (source.startsWith('{{') && source.endsWith('}}')) {
    const parsed = JSON.parse(source.slice(1, -1));
    if (parsed.sources) {
      const first = Object.entries(parsed.sources)[0];
      source = first[1].content ?? '';
    }
  }
  console.log(`\n▎ Source — ${row.ContractName} (${row.CompilerVersion})`);
  console.log(`  ${source.split('\n').length} lines, ${source.length} chars`);
  return source;
}

// ─── 4. ChainGPT: AI audit (1 credit) ───────────────────────────
async function audit(source) {
  if (!source) return;
  const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY });
  const res = await auditor.auditSmartContractBlob({
    question: `Audit this contract for security issues:\n\n${source.slice(0, 12000)}`,
    chatHistory: 'off',
  });
  console.log('\n▎ ChainGPT AI Audit');
  console.log(res?.data?.bot ?? '(no response)');
}

// ─── Pipeline ────────────────────────────────────────────────────
const CHAIN_IDS = { ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137, bsc: 56 };

try {
  console.log(`══ Research + audit pipeline — ${TOKEN} on ${CHAIN} ══`);
  await marketData(TOKEN);
  await tokenRisk(CHAIN_IDS[CHAIN], TOKEN);
  const source = await fetchSource(CHAIN_IDS[CHAIN], TOKEN);
  await audit(source);
  console.log('\n══ Pipeline complete. ══');
} catch (err) {
  console.error(`\n✗ Pipeline halted: ${err.message}`);
  process.exit(1);
}
