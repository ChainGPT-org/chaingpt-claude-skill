# Tron Integration — Implementation Plan & Scope

> Goal: ship complete Tron (TVM) support in the ChainGPT Claude Skill at parity
> with the EVM/BNB chains and Solana — read, research, risk, transfer (custody-free
> *and* agent-wallet-signed), TRC-20 + native, SunSwap DEX, JustLend lending —
> using the verified facts in `RESEARCH.md`. Target: a new tool tier, mirroring the
> Solana integration, on a feature branch off live `main` (v1.21.0).

## A. Design decisions (locked)

1. **Tron is a non-EVM chain** (`chainId: null` in `chains.ts`), parallel to Solana — not a custom EVM chain. It gets a dedicated client (`tron.ts`), address lib (`tron-address.ts`), signer (`tron-sign.ts`), and token/protocol registry (`tron-tokens.ts`).
2. **Key reuse:** the Tron account is controlled by the **same secp256k1 key as the EVM keystore** (`agent-keystore.ts`). No new keystore (Solana needed one; Tron does not). The agent's Tron address = base58check(`0x41` + its EVM 20-byte address).
3. **Signing model:** build-via-node (`createtransaction`/`triggersmartcontract`) → verify `txID==SHA256(raw_data_hex)` locally → cross-check decoded fields against intent → secp256k1-sign txID (`r‖s‖recid`) → broadcast. No protobuf hand-rolling, no tronweb dependency.
4. **Deps:** add only `@scure/base` (base58; already transitive via viem). Everything else (sha256, keccak256, secp256k1 `sign`, ABI encode/decode, hex) comes from the existing `viem` dep.
5. **Custody-free first:** every state-changing `tools/tron.ts` builder returns an **unsigned** tx (for TronLink/external signing) and refuses mainnet without `acknowledgeMainnet: true` — identical custody posture to the EVM/Solana tools. The agent-wallet path (`agent_wallet_tron.ts`) is the opt-in autonomous-signing surface, policy-fenced.
6. **Agent-wallet input = structured intent**, not LLM-supplied raw bytes. `sign_and_send` builds the tx itself from `{kind, to, amount, token/contract, callValue, feeLimit, memo}`, so the policy gate always operates on canonical, node-generated `raw_data` that the LLM cannot forge. (Solana could accept base64 because it deserializes the canonical signed bytes; Tron's canonical bytes are protobuf, so we build rather than parse.)

## B. New files

### lib/
| File | Responsibility |
|---|---|
| `tron-address.ts` | base58check ↔ hex21 ↔ evm20; `isTronAddress`; `tronAddressFromEvm`; `tronAddressFromPrivateKeyAccount`; ABI-param address padding. Pure, fully unit-testable offline. |
| `tron.ts` | TronGrid HTTP client: base-URL/network resolution (`TRON_RPC_URL`, `TRON_PRO_API_KEY`), `getAccount`, `getAccountResource`, `triggerConstantContract`, `triggerSmartContract` (build), `createTransaction` (build), `broadcastTransaction`, `getTransactionInfo`, `readTrc20` (balanceOf/decimals/symbol). Fail-friendly errors; fallback host list. |
| `tron-sign.ts` | `deriveTronAddress(account)`; `verifyTxId(raw_data_hex, txID)`; `signTronTx(account, unsignedTx)` → attach `r‖s‖recid`; high-level `buildTrxTransfer`, `buildTrc20Transfer`, `buildContractCall` (return `{unsignedTx, summary}`); `decodeRawData` (read contractType/owner/to/amount/contract/callValue from node JSON for cross-checking). |
| `tron-tokens.ts` | Verified TRC-20 registry (USDT/USDC/WTRX/JST/SUN/USDD/TUSD/stUSDT + decimals) and DeFi contract registry (SunSwap V2/V3 routers+factories, Smart Router, JustLend Unitroller + jTRX/jUSDT/jUSDD, WTRX). Poisoned-address blocklist. `resolveTronToken(symbolOrAddress)`. |

### tools/
| File | Tools (names) | Notes |
|---|---|---|
| `tron.ts` | `chaingpt_tron_balances`, `_token_balance`, `_account_resources`, `_tx_info`, `_validate_address`, `_research_token`, `_risk_token`, `_build_transfer_tx`, `_build_trc20_transfer_tx`, `_dex_sunswap_quote`, `_dex_sunswap_build_swap_tx`, `_lend_justlend_account`, `_lend_justlend_build_tx` | Custody-free reads + unsigned builders. Research via DexScreener/CoinGecko, risk via GoPlus (`tron` slug). Mainnet builders require `acknowledgeMainnet:true`. |
| `agent_wallet_tron.ts` | `chaingpt_agent_wallet_tron_address`, `chaingpt_agent_wallet_tron_sign_and_send` | No `_init` (reuses EVM keystore). `_address` shows the agent's Tron address + TRX balance + bandwidth/energy. `_sign_and_send` takes a structured intent, builds, runs `checkTronPolicy`, pre-checks revert via `triggerconstantcontract`, signs, broadcasts, journals to `spendStats(24,'tron')`. |

### tests/ (mcp-server, vitest)
`__tests__/tron-address.test.ts` (vectors: known T-addr ↔ hex ↔ evm, checksum reject), `tron-sign.test.ts` (txID verify, recid conversion, raw_data decode/cross-check, signature shape), `tron-policy.test.ts` (`checkTronPolicy` fail-closed matrix: disabled, killSwitch, contract allow/block, SUN caps, velocity, memo, unrestricted-still-needs-enabled), `tron-tools.test.ts` (offline builder shape, mainnet-ack gate, **zero network calls on refusal paths** — spy on fetch), `tron-tokens.test.ts` (registry integrity + poisoned-address exclusion).

## C. Files to modify

| File | Change |
|---|---|
| `lib/chains.ts` | Add `tron` entry (`chainId:null`, `native:'TRX'`, `dexscreener:'tron'`, `goplus:'tron'`, `coingecko:'tron'`, `explorer:'https://tronscan.org'`). Add aliases `trx`/`trc20`→`tron`. (`EVM_CHAIN_SLUGS` auto-excludes it via `chainId!==null`.) |
| `lib/agent-policy.ts` | Add `TronPolicy` interface (`enabled`, `allowedContracts?`, `blockedContracts?`, `maxTxSun?`, `maxDailySpendSun?`, `maxDailyTxCount?`, `maxFeeLimitSun?`, `requireMemo?`); `tron?: TronPolicy` on `AgentPolicy`; `checkTronPolicy(intent, policy, spend)` mirroring `checkSolanaPolicy` (fail-closed if `tron?.enabled!==true`; killSwitch wins; unrestricted still requires enabled). Add `tron` to `FAIL_CLOSED_POLICY` (`{enabled:false}`) and `DEFAULT_POLICY` (`{enabled:true, allowedContracts:[USDT, SunSwapV2Router, JustLend Unitroller, jUSDT], maxTxSun:'100000000' (100 TRX), maxDailySpendSun:'300000000', maxDailyTxCount:20, maxFeeLimitSun:'150000000', requireMemo:true}`). Extend `validatePolicyInput` + `ALLOWED_POLICY_FIELDS` with a `tron` block (base58 `T…` validation, SUN integer-string validation). |
| `lib/agent-activity.ts` | Confirm `spendStats(hours, 'tron')` class filtering works (same mechanism as `'solana'`); `logActivity({chain:'tron', valueWei:<SUN string>, …})`. (Likely no change — verify the class param is generic.) |
| `src/index.ts` | Import + register `tronTools`/`handleTronTool` and `agentWalletTronTools`/`handleAgentWalletTronTool`. Routing: `chaingpt_agent_wallet_tron` **before** `chaingpt_agent_wallet`; `chaingpt_tron` before the `chaingpt_` catch-all. |
| `VERSION`, `.claude-plugin/plugin.json`, `marketplace.json`, `mcp-server/package.json`, `src/index.ts` (Server version) | Bump in lockstep → **v1.22.0**. |
| `README.md`, `CHANGELOG.md` | Tron tier section + tool/test counts (validate.sh enforces consistency); CHANGELOG entry (Added/Fixed/Tests). |
| `skills/tron/SKILL.md` | New skill doc (the Tron pipeline: research → risk → transfer/swap/lend, custody-free + agent-wallet). Add to `validate.sh` REQUIRED_FILES + frontmatter checks. |
| `reference/tron.md` | User-facing reference (addresses, fee model, signing model, env vars). |
| mock-server | Add Tron endpoint stubs if the mock pattern requires them for offline tool tests (mirror how Solana/EVM are mocked). |
| `scripts/mcp-boot-smoke.mjs` / smoke | Tron read smoke case (e.g. `chaingpt_tron_balances` against a known address; offline-safe boot assertion that the tools list includes the new names). |

## D. Parity matrix (EVM/Solana feature → Tron)

| Capability | EVM | Solana | Tron (this plan) |
|---|---|---|---|
| Native balance | wallet_balances | solana_balance | `tron_balances` (TRX + resources) |
| Token balance | erc20 read | SPL read | `tron_token_balance` (TRC-20 via triggerconstantcontract) |
| Address validate | viem | base58 | `tron_validate_address` |
| Tx/receipt lookup | onchain_tx | — | `tron_tx_info` |
| Token research | research (DexScreener) | research | `tron_research_token` (DexScreener `tron`) |
| Token risk | risk (GoPlus) | risk | `tron_risk_token` (GoPlus `tron`) |
| Native transfer (unsigned) | build tx | build transfer | `tron_build_transfer_tx` |
| Token transfer (unsigned) | build tx | SPL transfer | `tron_build_trc20_transfer_tx` |
| DEX swap | OpenOcean/1inch/CoW | Jupiter | `tron_dex_sunswap_quote` + `_build_swap_tx` |
| Lending | Aave V3 | Marginfi/Kamino | `tron_lend_justlend_account` + `_build_tx` |
| Agent-wallet sign+send | agent_wallet | agent_wallet_solana | `agent_wallet_tron_sign_and_send` |
| Policy fence | checkPolicy | checkSolanaPolicy | `checkTronPolicy` |
| Velocity ledger | wei | lamports | SUN (`spendStats 'tron'`) |
| Mainnet ack guard | ✅ | ✅ | ✅ (`acknowledgeMainnet`) |

Out of scope for v1 (documented as future): SunSwap V3 quoting (no verified Quoter), Tron bridges (Across address unverified), TRC-721 NFT tooling, freeze/stake resource management tools.

## E. Security checklist (must hold; audited in Phase 6)

- [ ] Tron signing reuses the encrypted keystore; raw private key never returned by any tool or logged.
- [ ] `checkTronPolicy` is the single decision point; fail-closed when `tron.enabled!==true`, killSwitch wins, unrestricted does NOT bypass the enabled gate.
- [ ] `sign_and_send` builds from intent (no LLM bytes); cross-checks node `raw_data` decode == requested to/amount/owner; recomputes & verifies `txID==SHA256(raw_data_hex)` before signing.
- [ ] Per-tx SUN cap + rolling-24h SUN spend + tx-count caps enforced; fail-closed if the ledger can't be read.
- [ ] `fee_limit` capped by `maxFeeLimitSun` (anti energy-drain).
- [ ] Pre-broadcast `triggerconstantcontract` revert check; never broadcast a tx that constant-calls to a revert (mirrors Solana's "never broadcast a sim-failure").
- [ ] Refusal paths make **zero network calls** (test asserts via fetch spy).
- [ ] recid conversion correct (`v-27`), signature is 65 bytes, never `+27`.
- [ ] Poisoned addresses (USDDOLD/oldSUN/dead) excluded from the registry and not resolvable as a known token.

## F. Phase gates (per the user's loop)

1. **Plan audit (Phase 4):** adversarial review of THIS doc + RESEARCH.md (hallucinated addresses, EVM-isms that break on Tron, missing parity, security holes). Fix → re-audit until clean.
2. **Build (Phase 5):** TDD — address + sign + policy tests first, then libs, then tools, then registration + counts.
3. **Code audit (Phase 6):** code-reviewer + security-review subagents on the diff. Fix → re-audit until clean.
4. **Test (Phase 7):** `./scripts/test-all.sh --fast` green (validate · typecheck · vitest · mock · examples · patterns · boot) + a live MCP exercise of the new Tron read tools. Fix → re-run until green.
5. **Deliver (Phase 8):** lockstep version bump, CHANGELOG, brain capture, push to `main` (PR if branch protection / CodeRabbit blocks direct push).

## G. Phase 4 audit resolutions (both critics: "safe to build with these fixes")

**Signing (M2, technical audit):** viem `account.sign({hash})` returns `Promise<Hex>` (serialized 65-byte r‖s‖v, v∈{27,28}), NOT an object. Parse last byte → `recid = v - 27`. Keep the raw key inside the viem account (no raw-key export).

**SunSwap router (M1, technical audit):** the V2 router `TXF1xD…` is Tronscan-tagged DEPRECATED. Route swap EXECUTION through the **Smart Exchange Router `TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj`**. Quote via V2 `getAmountsOut` (read-only, fine) OR require a caller-supplied `minAmountOut` so slippage/funds stay caller-controlled. `tron-tokens.ts` marks the V2 router deprecated.

**JustLend (m1, technical audit):** mint/borrow/repay return a uint error code (0=ok); redeem/redeemUnderlying REVERT on error. Builders are unsigned-tx only, so this is informational for users; the JustLend read tool must not assume "never reverts".

**Node-trust residual (§5, technical audit):** recomputing `txID==SHA256(raw_data_hex)` proves the txID matches the protobuf we broadcast, but not that the JSON `raw_data` we cross-check equals that protobuf. ACCEPTED residual risk: agent-wallet builds from intent (no LLM bytes) + policy fence (caps, allowlist, revert pre-check) + default to first-party TronGrid. Document it; flag a non-TronGrid host when used for agent signing. Future hardening: independent protobuf decode of `raw_data_hex`.

**C1 (CRITICAL, integration audit) — agent-activity.ts REQUIRES a code change (not "no change"):**
- `lib/agent-activity.ts:61` add `'tron'` to `ChainClass`.
- `lib/agent-activity.ts:63-68` make `entryClass` 3-way: `startsWith('solana')→'solana'`; `=== 'tron' || startsWith('tron')→'tron'`; else `'evm'`.
- Update the `ActivityEntry` doc comments (lines 17, 21) to mention tron / SUN.
- Extend `__tests__/agent_activity.test.ts` with a tron-isolation case (SUN never sums into wei/lamports).
- Tron ledger entries: `logActivity({chain:'tron', valueWei:<SUN string>, chainId:0, …})`; spend via `spendStats(24,'tron')`.

**C2 (CRITICAL, integration audit) — non-gated counts must be hand-updated.** `validate.sh` checks VERSION consistency only, NOT tool/test counts. Update the hardcoded tool count (currently "140") at README.md (lines ~9,145,178,353,385,449,797,812,866,880), marketplace.json:5, mcp-server/package.json description → new total = 140 + 15 tron tools = **155**. Update vitest test count ("428…") at README.md (badge line 13, ~780,866,886) to the new total after the tron tests land.

**C3 (CRITICAL, integration audit) — full version-lockstep set for v1.22.0** (all hard-fail in validate.sh except where noted): `VERSION`, `.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json:13`, `mcp-server/package.json:3`, `mcp-server/src/index.ts:63` (`Server` version), **`README.md:11` version badge** (was missing from §C). mock-server/package.json is WARN-only (optional).

**M1 (integration audit) — `ALL_CHAIN_SLUGS` auto-includes tron.** It feeds the `chain` enum of `chaingpt_wallet_balances`, `chaingpt_risk_token`, `chaingpt_risk_address`. EVM RPC paths already guard `chainId===null` (safe; verified at wallet.ts:148, onchain.ts:161/216/256/308), and `EVM_CHAIN_SLUGS` correctly excludes tron. Decision: KEEP tron in the shared enum — `risk_token`/`risk_address` on tron WORK via the GoPlus `tron` slug (a bonus); `wallet_balances`/`onchain` degrade gracefully (return the null-chain message). Add tests: risk-on-tron resolves the GoPlus slug; wallet/onchain on tron degrade gracefully (no crash, no viem client built).

**M3 (integration audit) — two registration sites.** Add `...tronTools, ...agentWalletTronTools` to the `ListToolsRequestSchema` spread (index.ts:69-107) AND the route handlers. `chaingpt_agent_wallet_tron` must precede `chaingpt_agent_wallet` (line 197); `chaingpt_tron` must precede the `chaingpt_` catch-all (line 207). No prefix collisions exist.

**M4 (integration audit) — handler return shapes.** Read tools (`handleTronTool`) use the literal `{ type: 'text'; text: string }` shape (matches `handleSolanaTool`). The agent-wallet handler (`handleAgentWalletTronTool`) uses the widened `{ type: string; text: string }` shape (matches `handleAgentWalletSolanaTool`).

**m1 deps (integration audit) — do NOT assume `@scure/base` is transitive.** FINAL: add NO new dependency. Use `sha256`/`keccak256` from `viem` (direct dep, re-exported) and hand-roll base58/base58check (BigInt-based, ~25 lines, unit-tested with known vectors). Removes the transitive-dep question entirely.

**Policy validation (M2 integration audit):** add `'tron'` to `ALLOWED_POLICY_FIELDS` and a net-new `tron` validator block in `validatePolicyInput` with a base58 `T…` regex (`/^T[1-9A-HJ-NP-Za-km-z]{33}$/`) for `allowedContracts`/`blockedContracts` and SUN integer-string validation for the caps.

**Boot smoke (m2 integration audit):** floor check (`MIN_EXPECTED_TOOLS ?? 95`) + unique names + every name `chaingpt_`-prefixed + has name/description/inputSchema. New tools satisfy all trivially. mock-server changes NOT required (tron tool tests use the in-process fetch-spy pattern).

**Skill frontmatter (m5 integration audit):** `skills/tron/SKILL.md` MUST have valid `---` frontmatter with `name:`/`description:` (validate.sh hard-fails the per-skill loop otherwise). Add `skills/tron/SKILL.md` + `reference/tron.md` to `validate.sh` REQUIRED_FILES.

## H. DeFi scope (v1) — correctness over breadth
Ship: JustLend read (`getAccountLiquidity` + per-market balances) + unsigned build for supply/withdraw/borrow/repay against the VERIFIED Unitroller + jTRX/jUSDT/jUSDD. SunSwap swap quote (V2 `getAmountsOut`) + unsigned build via the Smart Exchange Router with a required/derived `minAmountOut`. Both are unsigned builders (custody-free) plus agent-wallet execution gated by the policy contract-allowlist. Deferred (documented): SunSwap V3 quoting (no verified Quoter), Tron bridges (Across address unverified), TRC-721 tooling, freeze/stake resource tools.
