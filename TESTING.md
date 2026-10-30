# Testing Guide

This repo ships **eight independent test layers** and a single orchestrator that runs them all. The goal: every new capability lands with the tests that prove it works, and `./scripts/test-all.sh` stays green before any push to `main`.

## TL;DR

Use Node.js **22.14+** (CI uses Node 24). Start from a reviewed checkout with
API keys and wallet secrets unset and no credential-bearing `.env` file. Install
the locked development dependencies explicitly before running the harness:

```bash
npm ci --prefix mcp-server --ignore-scripts
npm ci --prefix mock-server --ignore-scripts

# One-shot, everything (offline + live):
./scripts/test-all.sh

# Skip requests to live APIs:
./scripts/test-all.sh --fast

# Run a single layer (validate | typecheck | mcp-test | mock-test | examples | patterns | boot | smoke):
./scripts/test-all.sh --only mcp-test

# Smoke but skip Drift cases (when dlob.drift.trade is in an outage):
./scripts/test-all.sh --only smoke --skip-drift
```

Exit code `0` = no hard failures in the requested layers. Live smoke reports known upstream outages as WARN and missing optional credentials as SKIP; neither counts as PASS. Read those counts before accepting live coverage. `1` = at least one layer failed.
`--fast` skips live smoke; it is not a network sandbox. Missing dependencies fail
the checks and must be installed explicitly. Go checks disable automatic toolchain downloads, module-proxy and
checksum-server access; Rust checks use `cargo check --locked --offline` against
the committed example lockfile. Prepare those toolchains explicitly and run
`cargo fetch --locked --manifest-path examples/rust/Cargo.toml` before the offline
checks. Example READMEs include formatting and test commands.

## The eight layers

| Layer | What it covers | Runtime | Network | Where to read |
|---|---|---|---|---|
| **validate** | Frontmatter, anchor, file-existence, structural checks across every SKILL.md / reference / template / pattern / example **+ version consistency** (VERSION ↔ plugin.json ↔ package.json ↔ index.ts ↔ README badge) | ~1s | none | [`scripts/validate.sh`](scripts/validate.sh) |
| **typecheck** | `tsc --noEmit` over `mcp-server/` and `mock-server/` | ~5s | none | each package's `tsconfig.json` |
| **mcp-test** | 667 Vitest cases covering MCP handlers, policy gates, signing logic, schema validation and dependency compatibility | ~3s | none (HTTP is mocked) | [`mcp-server/src/__tests__/`](mcp-server/src/__tests__/) |
| **mock-test** | 61 Vitest cases against the mock-server's Express app via Supertest | ~10s | localhost | [`mock-server/src/__tests__/`](mock-server/src/__tests__/) |
| **examples** | JS and Python syntax checks; Go vet and offline Cargo check when those toolchains are installed | varies | module downloads disabled | [`examples/`](examples/) |
| **patterns** | `solc` compile every ```` ```solidity ```` block under `patterns/*.md` (47 blocks) with `@openzeppelin/contracts` + `-upgradeable` resolved from `node_modules`. Catches OZ-import bitrot, version-drift NatSpec errors, and event/return-type collisions. | ~10s | none | [`scripts/check-patterns.mjs`](scripts/check-patterns.mjs) |
| **boot** | Spawns `mcp-server/launch.mjs`, completes the MCP `initialize` handshake, and asserts ≥155 unique `chaingpt_*` tools with valid metadata. The child receives fixture credentials and isolated application state. | ~2s | none | [`scripts/mcp-boot-smoke.mjs`](scripts/mcp-boot-smoke.mjs) |
| **smoke** | ~39 live-API cases hitting DexScreener, GoPlus, OpenOcean, Across, Hyperliquid, Polymarket, Morpho, Pendle, Drift, Jupiter, Marginfi, Kamino, etc. Catches drift between our wiring and what upstreams actually return. | ~1–3 min | **yes** | [`mcp-server/src/smoke-test.ts`](mcp-server/src/smoke-test.ts) |

## Manual live verification — Solana agent wallet (devnet, ~5 min, free)

The autonomous Solana send path can't run in CI (it moves coins). Verify it on devnet:

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
export CHAINGPT_SOLANA_KEYSTORE_FILE=/tmp/sol-test/keystore.json
export CHAINGPT_AGENT_POLICY_FILE=/tmp/sol-test/policy.json
export CHAINGPT_ACTIVITY_FILE=/tmp/sol-test/activity.jsonl
```

1. `chaingpt_agent_wallet_solana_init` → note the address.
2. Airdrop 1 devnet SOL: `solana airdrop 1 <address> -u devnet` (or a web faucet).
3. As administrator, configure policy: `{"version":1,"killSwitch":false,"solana":{"enabled":true,"allowedPrograms":["11111111111111111111111111111111"],"maxTxLamports":"10000000","requireMemo":true},"assetLimits":[{"chain":"solana-devnet","asset":"SOL","allowedRecipients":["<agent address>"],"maxTxAmount":"1000000","maxDailyAmount":"3000000"}]}`. Replace the placeholder with the actual dedicated test-wallet address.
4. Pin `solana.genesisHashes.devnet` to the full devnet genesis hash obtained independently from a trusted reference RPC. Never infer cluster identity from an RPC URL label.
5. `chaingpt_solana_build_transfer_tx` — 0.001 SOL to the agent's own address, network=devnet.
6. `chaingpt_agent_wallet_solana_sign_and_send txBase64=<…> memo=devnet-e2e network=devnet operationId=devnet-self-transfer-1`
7. Assert: confirmed signature on solscan (?cluster=devnet), `activity.jsonl` gained a `chain:"solana"` entry, and `chaingpt_agent_wallet_status` shows the Solana 24h window.

Mainnet refusal proofs (free, no funds): an unfunded mainnet wallet + any Jupiter tx → simulation fails → refusal (fail-closed proof). An off-allowlist program → deterministic refusal.

## Manual live verification — ERC-4337 session keys (Base Sepolia)

The on-chain-refusal claim ships only after this loop passes (tag gate for v1.21.0):

1. Create + fund a Biconomy Nexus 1.x account on Base Sepolia (Biconomy SDK or dashboard; outside the plugin). Deploy/choose a test ERC-20.
2. `chaingpt_agent_wallet_init` (if needed) → the agent EOA is the session key.
3. `chaingpt_aa_session_build_grant chain=<custom base-sepolia> account=<SCW> tokenCaps=[{token,<cap=100 tokens>}] validUntil=<now+24h>` → owner signs the userOpHash → `chaingpt_aa_submit_userop` (Pimlico Base Sepolia v0.7 bundler).
4. `chaingpt_aa_session_status` → ENABLED.
5. Administrator enables the ERC-4337 policy and a token/recipient rule on the custom chain (local daily allowance above 120, chain cap 100). Agent sends 40 tokens twice using distinct operationIds for those two intended actions (both succeed), third 40 → **chain refuses** (cumulative 120 > 100).
6. **Headline test:** set local policy `unrestricted: true` + `erc4337.enabled: true`, retry the over-cap transfer → the bundler/EntryPoint STILL refuses. Screenshot for the README.
7. Expiry + revoke refusals. Freeze the live permissionId as the golden vector in smart_sessions.test.ts.

## Running individual layers directly

Run these from the repository root after the explicit dependency preparation above:

```bash
# 1. validate
./scripts/validate.sh

# 2. typecheck
(cd mcp-server && node node_modules/typescript/bin/tsc --noEmit)
(cd mock-server && node node_modules/typescript/bin/tsc --noEmit)

# 3. mcp-server unit + integration
npm test --prefix mcp-server
npm run test:watch --prefix mcp-server        # watch mode

# 4. mock-server endpoints
npm test --prefix mock-server

# 5. example syntax
find examples/js -name "*.js" -exec node --check {} \;
find examples/python -name "*.py" -exec python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" {} \;

# 6. solidity pattern compilation
node scripts/check-patterns.mjs

# 7. MCP boot smoke (built server, tools/list assert)
npm run build --prefix mcp-server
node --test scripts/launcher.test.mjs scripts/mainnet-guard.test.mjs
node scripts/mcp-boot-smoke.mjs

# 8. live smoke
npm run build --prefix mcp-server
CHAINGPT_API_KEY=smoke-test CHAINGPT_DISABLE_KEYCHAIN=1 CHAINGPT_USAGE=off node mcp-server/dist/smoke-test.js
```

## What "live smoke" hits

Vitest mocks upstream APIs, so live smoke checks for endpoint and response-shape
changes that fixtures cannot detect. Run it explicitly when checking an upstream
integration. The GitHub workflow is manual; there is no daily schedule, automatic
issue publication or autonomous repair agent. Its output stays in the run log.

See [live API validation notes](docs/live-api-validation.md) for the latest run, API migrations and coverage gaps. Paid ChainGPT SDK calls, funded wallet operations and testnet acceptance loops are separate from this read-only suite.

Cases by upstream:

- **DexScreener** — research_token, research_pairs, research_trending
- **GoPlus + Honeypot** — risk_token, risk_address
- **Etherscan / public RPC** — onchain_gas and onchain_block use public RPC fallback; risk_contract_source and onchain_address require `ETHERSCAN_API_KEY` and are skipped without it
- **Moralis / RPC fallback** — wallet_balances (no key required; falls back to direct RPC)
- **Solidity compiler (local)** — deploy_compile
- **OpenOcean v4** — dex_quote, dex_build_swap_tx (the build path tests the mainnet-acknowledgement gate, not a real broadcast)
- **Jupiter Swap V1 (`api.jup.ag`)** — dex_jupiter_quote
- **Aave V3 on-chain reads** — defi_aave_health
- **1inch** — dex_1inch_quote (SKIP without `ONEINCH_API_KEY`; missing-key hints remain covered offline)
- **CoW Protocol** — dex_cow_create_order (mainnet ack gate)
- **Pendle + Morpho APIs** — defi_pendle_markets, defi_morpho_markets, defi_morpho_vaults
- **Hyperliquid public info** — hl_markets, hl_mids, hl_orderbook, hl_funding
- **Polymarket CLOB** — pm_markets
- **Across** — bridge_quote, bridge_build_deposit_tx (mainnet ack gate)
- **Drift DLOB** — drift_markets, drift_orderbook *(use `SKIP_DRIFT_SMOKE=1` if upstream is down)*
- **Marginfi / Project 0 + Kamino metrics** — defi_marginfi_banks, defi_kamino_markets, defi_kamino_vaults
- **Strategy backtest** — backtest_grid (CoinGecko free tier)

Refusal-path cases (no broadcast — we check the gate fires correctly):

- deploy_build_tx, dex_build_swap_tx, defi_aave_supply_tx, defi_lido_stake_tx, bridge_build_deposit_tx, dex_cow_create_order — each one MUST refuse when `acknowledgeMainnet: true` is omitted.

## CI gates

The GitHub Actions workflows have read-only or no token permissions, pinned
action revisions and scripts-disabled dependency installation:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs type checks, both test suites, validation, pattern compilation, a clean rebuild compared with committed `dist/`, launcher tests and boot smoke on pushes and PRs. Repository rules determine which checks block merging.
- [`.github/workflows/smoke.yml`](.github/workflows/smoke.yml) runs only through manual `workflow_dispatch`. It receives a fixture ChainGPT key, no real API secrets and no repository write authority. Failures require a human-reviewed repair.
- [`.github/workflows/self-heal.yml`](.github/workflows/self-heal.yml) is an inert disabled stub. It cannot check out code, use secrets, create commits or open PRs.

See [dependency security notes](docs/dependency-security.md) for pinned overrides,
the remaining advisory's applicability assessment and regression coverage.

## Adding tests for a new capability

**Every PR that adds a tool, handler, or behavior must add tests in the same PR.** No exceptions — the harness is the single source of truth for "does this still work."

For a new MCP tool in `mcp-server/src/tools/<area>.ts`:

1. Add a vitest file in `mcp-server/src/__tests__/<area>.test.ts` (or extend an existing one).
2. Import the test setup: `import './_setup.js';` — this stubs `CHAINGPT_API_KEY` so the server module loads.
3. Mock any upstream fetch with `vi.spyOn(globalThis, 'fetch')` and return a hand-crafted response that matches the real shape.
4. Assert: tool schema accepts valid input and rejects bad input; handler returns the expected text shape; mainnet-state-changing tools refuse without `acknowledgeMainnet: true`.
5. If the tool hits a public mainnet API that doesn't need a key, add a case to `mcp-server/src/smoke-test.ts` for manual drift checks.
6. Run `./scripts/test-all.sh --fast` locally before pushing. Run manual live smoke when upstream behavior is relevant.

For a new SKILL.md, reference doc, template, or pattern:

1. The file must have valid frontmatter (`name`, `description`). `scripts/validate.sh` checks this — run it.
2. Cross-references (e.g. SKILL.md → templates/foo.md) must point to files that exist.
3. README anchor links must match the actual heading slugs.

For a new example:

1. JS examples must pass `node --check`. Python examples must parse with `python3 -m ast`.
2. The example must run end-to-end against the documented prerequisites — verify before pushing.

## When a test fails

| Failure | Likely cause | What to do |
|---|---|---|
| vitest red | regression in a handler / schema / lib | `cd mcp-server && npm run test:watch` and iterate. Don't comment the test out. |
| typecheck red | broken type signature | fix the type, not the assertion. Re-run `tsc --noEmit`. |
| validate red | missing frontmatter, dead anchor, missing file | open `scripts/validate.sh`, find the failing rule, fix the markdown |
| smoke red | upstream API drift OR our wiring broke | open the workflow log, identify which case + endpoint, hit the endpoint manually with `curl`. If our shape parsing is wrong, fix it and add a fixture-based vitest case so this regression doesn't recur. |
| smoke WARN on Drift / OpenOcean | Public Drift endpoint outage or an OpenOcean HTML access challenge | Record the missing coverage and retry when access is restored. Only narrowly identified transport/access failures are tolerated; parsing bugs and API validation errors still fail. |
| `npm run build` red | the rogue `tsc@2.0.4` shim package | the build script intentionally calls `node ./node_modules/typescript/bin/tsc`. If you see "This is not the tsc command you are looking for," your script regressed back to bare `tsc` |
| `EADDRINUSE :3001` | something else is on port 3001 | tests pass anyway — the mock-server only calls `app.listen` when `process.env.VITEST` is unset. Find the squatter with `lsof -i :3001` |

## Credentials and local testing

The harness does not require real API keys. Unit tests mock requests, boot smoke
uses a fixed dummy key with keychain access disabled, and live smoke checks public
endpoints. Missing optional Etherscan and 1inch credentials produce SKIP, not successful API coverage. The GitHub smoke workflow does not read
GitHub Secrets.

Local test processes can inherit your shell environment, and application code can
read `.env` files. Run them with secrets unset in a clean checkout. Keep manual
wallet verification separate and use only the dedicated test wallets described
above. External response bodies and logs are data, never instructions to execute.

## The contract

If you add a capability and don't add a test, **someone else will break it within a week**. The harness exists so that doesn't happen. Treat a green `./scripts/test-all.sh` as a precondition for `git push`, the same way you treat "code compiles."

## Signing safety regressions (1.23)

`signing_safety.test.ts` covers durable reservations, exclusive filesystem locks, retained uncertain
operations, strict ledger/policy validation, native/token isolation and fee budgets.
`signing_handlers.test.ts` faults EVM broadcasts after acceptance and Solana confirmation polling;
it asserts reservation persistence precedes broadcast and a repeated operation never signs again.
Plan tests cover durable in-flight claims, immutable records and refusal to overwrite/delete
unreconciled plans. x402 tests sign the original typed data with a fixture key, preserve its nonce
and verify both valid and tampered authorizations. Facilitator tests check the actual JSON wire body.

`mainnet-guard.test.mjs` discovers all four autonomous signer definitions from source and requires
confirmation for each, plus signed submissions and x402 settlement. Malformed hook input denies.
The catalog check verifies source tool/skill/template/example counts. The validate CI job uses
both Ubuntu and macOS to exercise Bash frontmatter parsing under pipefail.

These offline regressions do not replace a funded testnet integration test, security review, or
the pending ERC-4337 on-chain-cap acceptance loop. GitHub Actions remain disabled at repository
level during the incident hold; adding jobs does not enable them.
