# Tron (TVM) Reference

Tron is integrated as a first-class **non-EVM** chain (`chainId: null`), parallel to Solana. This page is the developer reference for the Tron tool surface.

## Why Tron is different from the EVM chains

| Aspect | EVM | Tron |
|---|---|---|
| Address | `0x…` 20-byte | base58 `T…` (= `0x41` + 20-byte + Base58Check) |
| Key | secp256k1 | **same** secp256k1 (only encoding differs) |
| Native unit | wei (18 dec) | SUN (6 dec); 1 TRX = 1,000,000 SUN |
| Tx fee | gas in native | Bandwidth (bytes) + Energy (compute, capped by `fee_limit`) |
| RPC | JSON-RPC `eth_*` | TronGrid HTTP `/wallet/*` |
| Token | ERC-20 | TRC-20 (same ABI) |
| Explorer | etherscan-likes | tronscan.org |

Because the same key controls both an ETH EOA and a Tron account, the agent wallet reuses the EVM keystore — there is no separate Tron keystore and no `_init`.

## Signing model (agent wallet)

Build-via-node, then sign locally:

1. The node (`/wallet/createtransaction` or `/wallet/triggersmartcontract`) returns the unsigned tx with `raw_data`, `raw_data_hex`, and `txID`.
2. We recompute `txID == SHA256(raw_data_hex)` locally and refuse to sign on mismatch.
3. We cross-check the decoded `raw_data` (owner / destination / value) against the requested intent.
4. We sign the 32-byte txID with the agent's secp256k1 key (viem `account.sign`), mapping viem's `v ∈ {27,28}` to Tron's `recid = v - 27`, producing a 65-byte `r‖s‖recid` signature.
5. We broadcast via `/wallet/broadcasttransaction` (HTTP 200 even on failure — we check `result`/`code`).

The agent-wallet `sign_and_send` takes a STRUCTURED INTENT (`trx_transfer` / `trc20_transfer` / `contract_call`), never raw bytes, so the policy gate always operates on canonical node-generated `raw_data`.

## Policy (`tron` sub-policy)

Fail-closed: absent or `enabled !== true` ⇒ every Tron signing op is refused (existing policy files never silently gain a third chain; `unrestricted` does not bypass this).

```jsonc
"tron": {
  "enabled": true,
  "allowedContracts": ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "..."], // base58; gates destination/contract
  "maxTxSun": "100000000",        // 100 TRX per tx (native amount / call_value)
  "maxDailySpendSun": "300000000",
  "maxDailyTxCount": 20,
  "maxFeeLimitSun": "150000000",  // energy-drain cap
  "requireMemo": true
}
```

The velocity ledger tracks Tron spend in **SUN**, isolated from EVM wei and Solana lamports.

**Cap semantics (important):** `maxTxSun` / `maxDailySpendSun` meter **native TRX value** (a transfer's amount, or a contract call's `call_value`). A TRC-20 transfer moves 0 native TRX, so those SUN caps do not bound the token amount (the same limitation as the EVM `maxTxValueWei`, which caps native value only). Token transfers are fenced instead by: the destination (token-contract) **allowlist**, `maxDailyTxCount`, `maxFeeLimitSun`, the revert pre-check, and a **calldata cross-check** — `sign_and_send` verifies the built tx's selector + recipient + amount byte-for-byte against the request, so a malicious/compromised node cannot alter the recipient or amount. For autonomous token signing, rely on the allowlist + tx-count cap (+ the first-party-TronGrid-host pin), not the SUN cap.

## Verified mainnet addresses

| Token | Address | Decimals |
|---|---|---|
| USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 |
| USDC (sunset) | `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` | 6 |
| WTRX | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` | 6 |
| JST | `TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9` | 18 |
| SUN | `TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S` | 18 |
| USDD | `TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz` | 18 |
| TUSD | `TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4` | 18 |
| stUSDT | `TThzxNRLrW2Brp9DcTQU8i4Wd9udCWEdZ3` | 18 |

DeFi: SunSwap Smart Router `TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj`, V2 router (deprecated, quote-only) `TXF1xDbVGdxFGbovmmmXvBGu8ZiE3Lq4mR`; JustLend Unitroller `TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7` (jTRX/jUSDT/jUSDD). **Poisoned (blocked):** USDDOLD `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn`, old SUN `TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9`.

## Environment

- `TRON_PRO_API_KEY` — TronGrid API key (header `TRON-PRO-API-KEY`). Mainnet keyless is throttled.
- `TRON_RPC_URL` — override the node host (mainnet `https://api.trongrid.io`, Shasta, Nile). Agent-wallet signing refuses a non-TronGrid host.

## Data providers

DexScreener (`tron`), GoPlus (`tron`), CoinGecko (`tron`) support Tron. **OpenOcean, 1inch, and Moralis do not** — DEX uses SunSwap directly. Across supports Tron; Stargate does not.

## Deferred (documented)

SunSwap V3 quoting (no verified Quoter), Tron bridges (Across spoke address unverified), TRC-721 NFT tooling, and freeze/stake resource management. Arbitrary verified contract calls can still be executed via the agent-wallet `contract_call` intent under the policy gate.
