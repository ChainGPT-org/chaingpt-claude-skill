# Tron Integration — Verified Research Dossier

> Compiled 2026-06-15 for the ChainGPT Claude Skill Tron integration. Every
> contract address and protocol fact here was verified against an authoritative
> source (official docs, Tronscan token/contract API, or a live on-chain getter).
> **Wrong addresses are dangerous — never substitute an address not in these tables.**

## 1. Why Tron is a non-EVM chain (and what that means for us)

Tron runs the **TVM** (Tron Virtual Machine), bytecode-compatible with the EVM
(Solidity compiles to it), but the **account, address, fee, and transaction
layers are different**. So Tron slots in exactly like Solana did: a new chain
with `chainId: null`, a dedicated signer/client lib, and its own tool tier — NOT
a custom EVM chain (it can't use `eth_call` / RLP / viem transports).

### The one fact that simplifies everything
**The same secp256k1 private key controls both an Ethereum EOA and a Tron account.**
TRON key generation is *identical* to Ethereum (ECDSA secp256k1, address =
`keccak256(pubkey)[-20:]`). The only difference is the address *encoding*:

- **Ethereum:** `0x` + the 20 bytes (EIP-55 checksum casing)
- **Tron:** prepend byte `0x41` → 21 bytes → Base58Check → `T...` (34 chars)

⇒ **The agent's existing EVM keystore key signs Tron with no new key management.**
Unlike Solana (which needed a separate Ed25519 keystore), Tron reuses
`agent-keystore.ts`. We only derive the Tron address from the same key.
Source: https://developers.tron.network/docs/account ("TRON's key pair generation
algorithm is exactly the same as that of Ethereum… except for the digits `41` in
the header part, the remaining parts are identical").

## 2. Address encoding (tron-address.ts)

- **hex21** = `0x41` ‖ 20-byte EVM address (21 bytes total). `0x41` = mainnet prefix.
- **base58check** = Base58(`hex21` ‖ `SHA256(SHA256(hex21))[0:4]`) → 34 chars, always `T…`.
- **EVM 20-byte** = `hex21` minus the `0x41` prefix (what the TVM `address` type holds, and what goes in ABI params).
- Base58 alphabet excludes `0 O I l`.
- Derive Tron address from a privkey: viem `privateKeyToAddress` → 20-byte hex → prepend `41` → base58check.

Implement with viem (`keccak256`, `sha256`, hex utils) + `@scure/base` (`base58`). No tronweb.

## 3. Units & fees

- **1 TRX = 1,000,000 SUN** (10^6). TRX decimals = 6. All on-chain amounts (`amount`, `call_value`, `fee_limit`) are in **SUN**.
- **Bandwidth** pays for tx bytes (600 free/day/account; else 1,000 SUN/byte burned).
- **Energy** pays for TVM execution (TRC-20/contract calls); shortfall burns 0.0001 TRX (100 SUN) per Energy unit.
- **`fee_limit`** (on contract calls) = max TRX in SUN burnable for Energy. Required on `triggersmartcontract`. Practical default for a TRC-20 transfer: 100 TRX = `100_000_000` SUN (we'll make it configurable + policy-capped).
- **New-account activation:** sending to an unactivated address costs ~1.1 TRX (1 TRX creation fee + 0.1 TRX bandwidth burn). Budget for it; surface a warning.
- Stake 2.0: `freezeBalanceV2` / `unfreezeBalanceV2` (14-day unbond) / `delegateResource`.

## 4. Transaction build + sign + broadcast (tron-sign.ts) — the chosen model

We **build via the node, then sign the txID locally** (key never leaves the box;
no protobuf hand-rolling). Steps:

1. **Build (online):** `POST /wallet/createtransaction` (TRX) or
   `POST /wallet/triggersmartcontract` (TRC-20/contract). The node returns the
   unsigned tx with `raw_data` (JSON), **`raw_data_hex`** (the protobuf bytes), and `txID`.
2. **Verify (local):** recompute `txID == SHA256(hexToBytes(raw_data_hex))`. Reject on mismatch.
   This is the trustless check — the signature covers this hash.
3. **Cross-check (local):** decode the node's JSON `raw_data.contract[0]` and confirm
   `owner_address`, `to_address`/`contract_address`, `amount`/`call_value` equal the requested intent.
4. **Sign (local):** secp256k1-sign the 32-byte txID with the agent key →
   **65-byte `r‖s‖recid`** where `recid ∈ {0,1}`. viem `account.sign({hash})` returns a
   *serialized hex* signature (`Promise<Hex>`): 65 bytes = r(32) ‖ s(32) ‖ v(1) with
   v ∈ {27,28}. Parse the last byte as v and set `recid = v - 27`. Do NOT add 27.
   (The lower-level `sign({hash, privateKey, to:'object'})` returns `{r,s,yParity}` where
   `yParity` IS the recid (0/1) directly, but it needs the raw key; we keep the key inside
   the viem account and parse the hex from `account.sign`.) Verified against viem source.
5. **Broadcast:** `POST /wallet/broadcasttransaction` with `{raw_data, raw_data_hex, txID, signature:[hex]}`.
   Response `{result:true, txid}` or `{code, message}` (HTTP is 200 even on failure — check `result`/`code`).

- **txID = SHA256(protobuf(raw_data))** — SHA256, NOT keccak. (Keccak is only for *address* derivation.)
- Read-only contract calls (balanceOf/decimals/symbol): `POST /wallet/triggerconstantcontract` — no sign, no broadcast; returns `constant_result` (hex array). Also used as the pre-broadcast "will it revert?" check.
- `visible:true` in requests ⇒ addresses are base58 `T…`; else hex `41…`.
- ABI `parameter` (for trigger*): ABI-encoded args **without** the 4-byte selector; addresses are the 20-byte EVM form left-padded to 32 bytes. Use viem `encodeAbiParameters`.

## 5. TronGrid / node HTTP API (tron.ts client)

- **Base URLs:** mainnet `https://api.trongrid.io` · Shasta `https://api.shasta.trongrid.io` · Nile `https://nile.trongrid.io`. Override via `TRON_RPC_URL`.
- **Auth:** header `TRON-PRO-API-KEY: <key>` (env `TRON_PRO_API_KEY`). Mainnet keyless is throttled; free keyed tier ~15 QPS / 100k req/day.
- **Endpoints (POST `/wallet/...`):**
  - `getaccount` → `balance` (SUN), `assetV2` (TRC-10), `account_resource`
  - `getaccountresource` → bandwidth/energy used+limit
  - `triggerconstantcontract` → read TRC-20 (balanceOf/decimals/symbol) + revert pre-check (`constant_result`, `energy_used`)
  - `triggersmartcontract` → build unsigned contract-call tx (`transaction`)
  - `createtransaction` → build unsigned TRX transfer
  - `broadcasttransaction` → submit signed tx
  - `getnowblock` → ref block (for offline build, if ever needed)
  - `gettransactioninfobyid` → receipt (`fee`, `receipt.energy_usage`, `contractResult`, logs)
- **TronGrid v1 indexer (GET):** `/v1/accounts/{addr}/transactions/trc20` (TRC-20 transfer history, `meta.fingerprint` cursor).

## 6. Token standards & VERIFIED mainnet TRC-20 addresses

TRC-20 ABI ≡ ERC-20 (`transfer/balanceOf/decimals/symbol/approve/allowance/transferFrom`,
events `Transfer`/`Approval`). TRC-10 = native numeric-ID tokens (in `assetV2`). TRC-721 ≈ ERC-721.

| Token | Symbol | Base58 address | Decimals |
|---|---|---|---|
| Tether USD | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 |
| USD Coin *(sunset; no replacement)* | USDC | `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` | 6 |
| Wrapped TRX | WTRX | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` | **6** (not 18) |
| JUST | JST | `TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9` | 18 |
| SUN *(new; not the old `TKkeibo…`)* | SUN | `TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S` | 18 |
| Decentralized USD *(2.0; not the old `TPYmHE…`)* | USDD | `TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz` | 18 |
| TrueUSD | TUSD | `TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4` | 18 |
| Staked USDT (RWA, rebasing) | stUSDT | `TThzxNRLrW2Brp9DcTQU8i4Wd9udCWEdZ3` | 18 |

**Poisoned addresses to NEVER use:** `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` (USDDOLD),
`TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9` (old SUN), `TCrEVahRbhDFB6uRXEWUg7wkptXvg47GKs` (dead/non-contract).
Decimals split: USDT/USDC/WTRX = 6; everything else above = 18.

## 7. DeFi protocols (VERIFIED addresses)

### SunSwap (dominant DEX — Uniswap fork; keeps "ETH" naming where "ETH"=WTRX)
- **Smart Exchange Router (V1/V2/V3/PSM aggregator) `TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj` — USE THIS for swap execution.** It is the current, non-deprecated routing entry point.
- **V2 Router `TXF1xDbVGdxFGbovmmmXvBGu8ZiE3Lq4mR` — Tronscan-tagged DEPRECATED.** Functions, but do not build new execution on it. Its read-only `getAmountsOut` is fine for a quote approximation. V2 Factory `TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY`.
- **V3 Router (SwapRouter)** `TQAvWQpT9H916GckwWDJNhYZvQMkuRL7PN` · **V3 Factory** `TThJt8zaJzJMhCEScH7zWKnp5buVZqys9x`
- V2 has on-chain `getAmountsOut(amountIn, path)` for quoting; **V3 has none** (Quoter address UNKNOWN). For execution prefer the Smart Router; quote via V2 `getAmountsOut` or require a caller-supplied `minAmountOut` (slippage stays caller-controlled, funds safe).
- TRX→token: `swapExactETHForTokens` (payable, TRX as callValue, `path[0]=WTRX`). token→TRX: `swapExactTokensForETH` (`path[last]=WTRX`). token→token: `swapExactTokensForTokens`. **approve the router first** for any token-in leg.
- By TVL: V1 > V2 > V3; by volume: V3 dominates (~94%).

### JustLend DAO (dominant lending — Compound V2 fork; jToken model)
- **Unitroller (the entry point you call)** `TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7`
- Markets: **jTRX** `TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP` (CEther — `mint()`/`repayBorrow()` payable) · **jUSDT** `TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd` · **jUSDD** `TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf`
- Supply `mint(uint)` (TRC-20, needs approve first) / withdraw `redeem`/`redeemUnderlying` / `borrow(uint)` / `repayBorrow(uint)` (pass 2^256-1 for full).
  TRC-20 markets **return a uint error code (0=success)** for mint/borrow/repay, but **redeem/redeemUnderlying REVERT on error**. Handle BOTH: check the return code AND catch reverts. (jTRX is CEther: mint/repayBorrow are payable and revert on failure.)
- Read health on the Unitroller: `getAccountLiquidity(addr) → (error, liquidity, shortfall)` (USD 1e18; shortfall>0 = liquidatable). `enterMarkets([jToken])` before collateral counts.
- Balances: `balanceOfUnderlying`/`borrowBalanceCurrent` (accrue; static-call) or gas-free `balanceOf`×`exchangeRateStored`/`borrowBalanceStored`.

### WTRX
`TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR`, decimals 6, WETH9 shape: `deposit()` payable / `withdraw(uint256)`.

### Data-provider coverage (chains.ts slugs)
| Provider | Tron? | Identifier |
|---|---|---|
| DexScreener | ✅ | `chainId = tron` |
| GoPlus Security | ✅ | `chain_id = tron` (string) → `…/token_security/tron` |
| CoinGecko | ✅ | asset platform `tron` |
| DefiLlama | ✅ | chain `Tron` |
| **OpenOcean** | ❌ | not supported — no Tron swap aggregation |
| **Moralis** | ❌ | not supported |
| **1inch** | ❌ | EVM-only |

⇒ Risk (GoPlus) + research/price (DexScreener/CoinGecko) work via the existing tool pattern. DEX swaps use **SunSwap directly** (no OpenOcean fallback on Tron).

### Bridges
- **Across supports Tron** (chainId `728126428`). Stargate does **NOT** (don't route it). BTTC is the protocol-native lock-and-mint bridge; native USDT moves mostly via CEXes / Allbridge Core / Symbiosis.

### Explorer
Tronscan `https://tronscan.org/#/address|transaction|token20|block/<x>`. API `https://apilist.tronscanapi.com/api/` (key via `TRON-PRO-API-KEY`).

## 8. TVL ranking (DefiLlama, 2026-06-15) — Tron chain ≈ $4.53B
JustLend (~$4.6B) · JustCryptos bridge (~$4.1B) · SunSwap V1 ($519M) / V2 ($283M) / V3 ($276M) · USDD ($162M). Only ~8 protocols have non-negligible TVL.

## 9. Open UNKNOWNs (handle defensively in code)
- SunSwap V3 Quoter + Universal Router addresses — not verified; V3 quoting deferred (V2 `getAmountsOut` is the quote path).
- Exact Energy cost per TRC-20 transfer (varies; first-transfer-to-new-holder costs more) — use a generous policy-capped `fee_limit`, never a hardcoded energy assumption.
- SunSwap V1 per-token exchanges resolve at runtime via factory `getExchange(token)` — don't hardcode.
- Across TRON spoke-pool address — confirmed supported but pull+verify the exact address before any direct call (we won't ship a Tron bridge builder in v1).
