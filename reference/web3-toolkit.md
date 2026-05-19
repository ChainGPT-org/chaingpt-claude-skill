# Web3 Toolkit — Wallet · Research · Risk · On-chain · Intel

The 16 read-only Web3 tools added in plugin v1.2.0. Works across **11 chains** (ethereum · base · arbitrum · optimism · polygon · bsc · avalanche · blast · linea · scroll · solana). All MCP tools live in the plugin; if you're building outside Claude Code, the same underlying APIs are listed below for direct use.

## When to reach for which tool

| Intent | Tool | Backend |
|---|---|---|
| Multi-chain wallet balances | `chaingpt_wallet_balances` | Moralis (opt key) + public RPC |
| DeFi positions across protocols | `chaingpt_wallet_positions` | Moralis |
| Realized + unrealized P&L | `chaingpt_wallet_pnl` | Moralis |
| Token price / volume / liquidity | `chaingpt_research_token` | DexScreener |
| All pools for a token | `chaingpt_research_pairs` | DexScreener |
| Trending tokens right now | `chaingpt_research_trending` | DexScreener |
| Honeypot / mintable / proxy flags | `chaingpt_risk_token` | GoPlus |
| Buy + sell simulation (real) | `chaingpt_risk_honeypot` | Honeypot.is |
| Sanctioned / phishing / mixer | `chaingpt_risk_address` | GoPlus |
| Verified source + ABI fetch | `chaingpt_risk_contract_source` | Etherscan v2 |
| Decode tx by hash | `chaingpt_onchain_tx` | Etherscan v2 |
| Address recent activity | `chaingpt_onchain_address` | Etherscan v2 |
| Multi-chain gas oracle | `chaingpt_onchain_gas` | Etherscan v2 + public RPC |
| Block info (latest or by number) | `chaingpt_onchain_block` | Public RPC |
| **Composed: research → risk → news → signal** | `chaingpt_intel_token` | DexScreener + GoPlus + ChainGPT news + AI signal |
| **Composed: wallet + per-holding risk-rate** | `chaingpt_intel_wallet` | Moralis + GoPlus |

## Optional API keys

Tools degrade gracefully when these are absent — set them for full functionality:

| Env var | Unlocks | Where to get |
|---|---|---|
| `MORALIS_API_KEY` | Multi-chain ERC-20 scan + DeFi positions + P&L | https://moralis.io (free 25k req/mo) |
| `ETHERSCAN_API_KEY` | Higher rate limit on all EVM chains via v2 | https://etherscan.io/myapikey (free 5 req/s) |

Without `MORALIS_API_KEY`, wallet_balances returns native-coin only via public RPC.
Without `ETHERSCAN_API_KEY`, onchain_address and risk_contract_source return a friendly hint telling the user to set the key.

## chaingpt_wallet_balances

Multi-chain native + ERC-20 balances for one wallet.

```jsonc
{
  "address": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  "chains": ["ethereum", "base", "arbitrum", "polygon", "bsc"],
  "includeNative": true,
  "minUsdValue": 1
}
```

Returns native + ERC-20 balances per chain, sorted by USD value descending. Filters out dust below `minUsdValue`. Total at the bottom.

Direct API: `GET https://deep-index.moralis.io/api/v2.2/wallets/{addr}/tokens?chain={ethSlug}`.
Native fallback: `eth_getBalance` via the chain's public RPC.

## chaingpt_research_token

Live market data for a token by symbol or address. The most common "research this token" entry point.

```jsonc
{
  "query": "CGPT",      // symbol or contract address
  "chain": "ethereum"   // optional filter
}
```

Returns top pair by 24h volume: price, 24h change, 24h volume, liquidity, market cap, FDV, DEX, pair address.

Direct API: `https://api.dexscreener.com/latest/dex/tokens/{address}` or `/search?q={query}`. No key, ~60 rps.

## chaingpt_risk_token

GoPlus token-security check. Flags honeypot, mintable, proxy, hidden owner, blacklist function, transfer pausable, buy/sell tax, selfdestruct.

```jsonc
{
  "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "chain": "ethereum"
}
```

Output starts with a one-line verdict (✓ clean / ⚠ N flags), then lists the supporting evidence. **For any swap above $1,000, always run this first.**

Direct API: `https://api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses={addr}`. No key.

## chaingpt_risk_honeypot

Real buy+sell simulation via Honeypot.is. More expensive than GoPlus but catches honeypots that static analysis misses. Supports ethereum, bsc, base, arbitrum.

```jsonc
{
  "address": "0x…",
  "chain": "bsc"
}
```

Output: verdict, buy tax %, sell tax %, transfer tax %, list of flags.

## chaingpt_risk_contract_source

Fetch the verified source code, ABI, and compiler settings for a contract. Works across all major EVM chains via Etherscan v2.

```jsonc
{
  "address": "0x…",
  "chain": "ethereum",
  "previewChars": 1500
}
```

Returns: contract name, compiler version (e.g. `v0.8.24+commit.e11b9ed9` — needed for verification), optimization settings, license, proxy status (with implementation address), source preview. Pipe the source into `chaingpt_audit_contract` for the AI audit.

## chaingpt_onchain_tx

Decode any EVM transaction by hash.

```jsonc
{ "hash": "0x…", "chain": "ethereum" }
```

Returns status (success/failed/pending), from, to, value (native), gas used, effective gas price, method id, log entry count, explorer link.

## chaingpt_onchain_gas

Multi-chain gas oracle.

```jsonc
{ "chain": "ethereum" }
```

With ETHERSCAN_API_KEY: safe / standard / fast gwei breakdown + base fee + gas used %.
Without key: falls back to `eth_gasPrice` via public RPC.

## chaingpt_intel_token — the strategic differentiator

Composes DexScreener (market) + GoPlus (risk) + ChainGPT news + AI signal in one call. **The recommended "research this token" tool** — costs ~1 ChainGPT credit (the news fetch). The market + risk layers are free.

```jsonc
{
  "query": "CGPT",       // symbol or address
  "chain": "ethereum",   // optional restriction
  "newsLimit": 5         // recent ChainGPT news articles to include
}
```

Output is a 4-section report:
1. **Market** — price, 24h change, volume, liquidity, market cap, FDV
2. **Security** — holders, tax, GoPlus flags
3. **AI signal** — ChainGPT bullishness + narrative tag (free read)
4. **Recent news** — N most-recent ChainGPT news mentions

This is the "one call covers it" research tool. Skill files (`chaingpt-research`) instruct Claude to prefer this over the granular tools for first-pass research.

## Public APIs used (no SDK)

| API | URL | Auth |
|---|---|---|
| DexScreener | `api.dexscreener.com/latest/dex/...` | none |
| GoPlus | `api.gopluslabs.io/api/v1/...` | none |
| Honeypot.is | `api.honeypot.is/v2/IsHoneypot` | none |
| Etherscan v2 | `api.etherscan.io/v2/api?chainid={id}&...` | `ETHERSCAN_API_KEY` (free 5 req/s) |
| Moralis | `deep-index.moralis.io/api/v2.2/...` | `X-API-Key: ${MORALIS_API_KEY}` (free 25k req/mo) |

## Common workflows

**"Should I buy X?"**
```text
chaingpt_intel_token query="X"
```
One call covers market data + risk + news + AI signal.

**"What's this wallet holding?"**
```text
chaingpt_intel_wallet address="0x…"
```
Portfolio + per-holding risk-rating, sorted by USD value.

**"Is this contract safe to interact with?"**
```text
chaingpt_risk_token            address=<contract>  chain=<chain>
chaingpt_risk_contract_source  address=<contract>  chain=<chain>
chaingpt_audit_contract        sourceCode=<from previous>
```
GoPlus heuristics + verified source + ChainGPT AI audit.
