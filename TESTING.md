# Testing Guide

This repo ships **eight independent test layers** and a single orchestrator that runs them all. The goal: every new capability lands with the tests that prove it works, and `./scripts/test-all.sh` stays green before any push to `main`.

## TL;DR

```bash
# One-shot, everything (offline + live):
./scripts/test-all.sh

# Skip the live-API smoke (faster, fully offline):
./scripts/test-all.sh --fast

# Run a single layer (validate | typecheck | mcp-test | mock-test | examples | patterns | boot | smoke):
./scripts/test-all.sh --only mcp-test

# Smoke but skip Drift cases (when dlob.drift.trade is in an outage):
./scripts/test-all.sh --only smoke --skip-drift
```

Exit code `0` = every requested layer passed. `1` = at least one layer failed.

## The eight layers

| Layer | What it covers | Runtime | Network | Where to read |
|---|---|---|---|---|
| **validate** | Frontmatter, anchor, file-existence, structural checks across every SKILL.md / reference / template / pattern / example **+ version consistency** (VERSION ↔ plugin.json ↔ package.json ↔ index.ts ↔ README badge) | ~1s | none | [`scripts/validate.sh`](scripts/validate.sh) |
| **typecheck** | `tsc --noEmit` over `mcp-server/` and `mock-server/` | ~5s | none | each package's `tsconfig.json` |
| **mcp-test** | 250 vitest cases covering every MCP tool handler, policy gate, signing logic, schema validation, fixture-based unit tests | ~3s | none (HTTP is mocked) | [`mcp-server/src/__tests__/`](mcp-server/src/__tests__/) |
| **mock-test** | 26 vitest cases against the mock-server's express app via supertest | ~10s | none | [`mock-server/src/__tests__/`](mock-server/src/__tests__/) |
| **examples** | `node --check` on every JS example, `python3 -m ast` parse on every Python example | ~2s | none | [`examples/`](examples/) |
| **patterns** | `solc` compile every ```` ```solidity ```` block under `patterns/*.md` (47 blocks) with `@openzeppelin/contracts` + `-upgradeable` resolved from `node_modules`. Catches OZ-import bitrot, version-drift NatSpec errors, and event/return-type collisions. | ~10s | none | [`scripts/check-patterns.mjs`](scripts/check-patterns.mjs) |
| **boot** | Spawns the built `mcp-server/dist/index.js`, completes the MCP `initialize` handshake, sends a `tools/list` JSON-RPC request over stdio, asserts ≥ 95 unique `chaingpt_*`-prefixed tools with valid `name`/`description`/`inputSchema`. Catches missing-export and double-registration regressions invisible to vitest. | ~2s | none | [`scripts/mcp-boot-smoke.mjs`](scripts/mcp-boot-smoke.mjs) |
| **smoke** | ~39 live-API cases hitting DexScreener, GoPlus, OpenOcean, Across, Hyperliquid, Polymarket, Morpho, Pendle, Drift, Jupiter, Marginfi, Kamino, etc. Catches drift between our wiring and what upstreams actually return. | ~30s | **yes** | [`mcp-server/src/smoke-test.ts`](mcp-server/src/smoke-test.ts) |

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
3. Policy: `{"version":1,"killSwitch":false,"solana":{"enabled":true,"allowedPrograms":["11111111111111111111111111111111"],"maxTxLamports":"10000000","requireMemo":true}}`
4. `chaingpt_solana_build_transfer_tx` — 0.001 SOL to the agent's own address, network=devnet.
5. `chaingpt_agent_wallet_solana_sign_and_send txBase64=<…> memo=devnet-e2e network=devnet`
6. Assert: confirmed signature on solscan (?cluster=devnet), `activity.jsonl` gained a `chain:"solana"` entry, and `chaingpt_agent_wallet_status` shows the Solana 24h window.

Mainnet refusal proofs (free, no funds): an unfunded mainnet wallet + any Jupiter tx → simulation fails → refusal (fail-closed proof). An off-allowlist program → deterministic refusal.

## Manual live verification — ERC-4337 session keys (Base Sepolia)

The on-chain-refusal claim ships only after this loop passes (tag gate for v1.21.0):

1. Create + fund a Biconomy Nexus 1.x account on Base Sepolia (Biconomy SDK or dashboard; outside the plugin). Deploy/choose a test ERC-20.
2. `chaingpt_agent_wallet_init` (if needed) → the agent EOA is the session key.
3. `chaingpt_aa_session_build_grant chain=<custom base-sepolia> account=<SCW> tokenCaps=[{token,<cap=100 tokens>}] validUntil=<now+24h>` → owner signs the userOpHash → `chaingpt_aa_submit_userop` (Pimlico Base Sepolia v0.7 bundler).
4. `chaingpt_aa_session_status` → ENABLED.
5. Agent sends 40 tokens twice (both succeed), third 40 → **chain refuses** (cumulative 120 > 100).
6. **Headline test:** set local policy `unrestricted: true` + `erc4337.enabled: true`, retry the over-cap transfer → the bundler/EntryPoint STILL refuses. Screenshot for the README.
7. Expiry + revoke refusals. Freeze the live permissionId as the golden vector in smart_sessions.test.ts.

## Running individual layers directly

You don't have to use `test-all.sh` — every layer has a native command:

```bash
# 1. validate
./scripts/validate.sh

# 2. typecheck
cd mcp-server  && node node_modules/typescript/bin/tsc --noEmit
cd mock-server && node node_modules/typescript/bin/tsc --noEmit

# 3. mcp-server unit + integration
cd mcp-server && npm ci && npm test
cd mcp-server && npm run test:watch        # watch mode

# 4. mock-server endpoints
cd mock-server && npm ci && npm test

# 5. example syntax
find examples/js -name "*.js" -exec node --check {} \;
find examples/python -name "*.py" -exec python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" {} \;

# 6. solidity pattern compilation
node scripts/check-patterns.mjs        # needs (cd mcp-server && npm ci) once

# 7. MCP boot smoke (built server, tools/list assert)
(cd mcp-server && npm run build) && node scripts/mcp-boot-smoke.mjs

# 8. live smoke
cd mcp-server && npm run build && CHAINGPT_API_KEY=smoke-test node dist/smoke-test.js
```

## What "live smoke" hits

The smoke test exists because vitest mocks the upstream APIs. If GoPlus reshapes its response or Across deprecates an endpoint, the unit tests stay green — but the plugin breaks in production. Live smoke catches that within 24h (it runs on a daily cron in `.github/workflows/smoke.yml`).

Cases by upstream:

- **DexScreener** — research_token, research_pairs, research_trending
- **GoPlus + Honeypot** — risk_token, risk_address, risk_contract_source
- **Etherscan family** — onchain_gas, onchain_block, onchain_address (requires `ETHERSCAN_API_KEY` for the last two; falls back to friendly hint without)
- **Moralis / RPC fallback** — wallet_balances (no key required; falls back to direct RPC)
- **Solidity compiler (local)** — deploy_compile
- **OpenOcean v4** — dex_quote, dex_build_swap_tx (the build path tests the mainnet-acknowledgement gate, not a real broadcast)
- **Jupiter v6** — dex_jupiter_quote
- **Aave V3 on-chain reads** — defi_aave_health
- **1inch** — dex_1inch_quote (key gated; without `ONEINCH_API_KEY` we assert the friendly hint)
- **CoW Protocol** — dex_cow_create_order (mainnet ack gate)
- **Pendle + Morpho APIs** — defi_pendle_markets, defi_morpho_markets, defi_morpho_vaults
- **Hyperliquid public info** — hl_markets, hl_mids, hl_orderbook, hl_funding
- **Polymarket CLOB** — pm_markets
- **Across** — bridge_quote, bridge_build_deposit_tx (mainnet ack gate)
- **Drift DLOB** — drift_markets, drift_orderbook *(use `SKIP_DRIFT_SMOKE=1` if upstream is down)*
- **Marginfi + Kamino** — defi_marginfi_banks, defi_kamino_markets, defi_kamino_vaults
- **Strategy backtest** — backtest_grid (CoinGecko free tier)

Refusal-path cases (no broadcast — we check the gate fires correctly):

- deploy_build_tx, dex_build_swap_tx, defi_aave_supply_tx, defi_lido_stake_tx, bridge_build_deposit_tx, dex_cow_create_order — each one MUST refuse when `acknowledgeMainnet: true` is omitted.

## CI gates

Two GitHub Actions workflows enforce the harness:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — runs `typecheck`, `mcp-test`, `mock-test`, `validate`, `patterns`, and `boot-smoke` in parallel on every push and every PR. Required for merge.
- [`.github/workflows/smoke.yml`](.github/workflows/smoke.yml) — runs `smoke` daily at 09:00 UTC plus manual `workflow_dispatch`. On scheduled-run failure, opens a GitHub issue labelled `smoke-failure`. Not required for merge (intentional: an upstream outage shouldn't block PRs).

## Adding tests for a new capability

**Every PR that adds a tool, handler, or behavior must add tests in the same PR.** No exceptions — the harness is the single source of truth for "does this still work."

For a new MCP tool in `mcp-server/src/tools/<area>.ts`:

1. Add a vitest file in `mcp-server/src/__tests__/<area>.test.ts` (or extend an existing one).
2. Import the test setup: `import './_setup.js';` — this stubs `CHAINGPT_API_KEY` so the server module loads.
3. Mock any upstream fetch with `vi.spyOn(globalThis, 'fetch')` and return a hand-crafted response that matches the real shape.
4. Assert: tool schema accepts valid input and rejects bad input; handler returns the expected text shape; mainnet-state-changing tools refuse without `acknowledgeMainnet: true`.
5. If the tool hits a public mainnet API that doesn't need a key, add a case to `mcp-server/src/smoke-test.ts` so we catch upstream drift daily.
6. Run `./scripts/test-all.sh --fast` locally before pushing. CI runs the same checks plus typecheck.

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
| smoke red on Drift only | `dlob.drift.trade` 503 is common — they go down ~weekly for hours | re-run with `SKIP_DRIFT_SMOKE=1`. If down for >24h, page the Drift Discord. |
| `npm run build` red | the rogue `tsc@2.0.4` shim package | the build script intentionally calls `node ./node_modules/typescript/bin/tsc`. If you see "This is not the tsc command you are looking for," your script regressed back to bare `tsc` |
| `EADDRINUSE :3001` | something else is on port 3001 | tests pass anyway — the mock-server only calls `app.listen` when `process.env.VITEST` is unset. Find the squatter with `lsof -i :3001` |

## API keys for local development

The harness runs end-to-end without any keys. Optional keys unlock additional smoke coverage:

```bash
export CHAINGPT_API_KEY=...      # required for any tool that hits the ChainGPT plugin API
export MORALIS_API_KEY=...       # wallet_balances multi-chain; falls back to direct RPC without
export ETHERSCAN_API_KEY=...     # on-chain reads on EVM; without it the tool surfaces a friendly hint
export ONEINCH_API_KEY=...       # 1inch v6 quote; without it the tool returns a setup hint (which the smoke test asserts)
```

Never commit a real key. The smoke workflow reads from GitHub Secrets.

## The contract

If you add a capability and don't add a test, **someone else will break it within a week**. The harness exists so that doesn't happen. Treat a green `./scripts/test-all.sh` as a precondition for `git push`, the same way you treat "code compiles."
