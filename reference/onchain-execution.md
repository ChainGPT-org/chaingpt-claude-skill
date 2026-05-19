# On-chain Execution — Deploy · DEX · DeFi

The 17 state-changing tools added in plugin v1.3–v1.5. All **mainnet-first** by design, all **custody-free** — the plugin builds an unsigned transaction; the user signs externally via MetaMask, Rabby, hardware wallet, ERC-4337 smart account, or WalletConnect.

**Every state-changing tool refuses to return a transaction unless `acknowledgeMainnet: true` is passed.** This is the safety prompt that forces an explicit confirmation step before any mainnet action.

## Mainnet vs testnet defaults

| Tier | Mainnets (default) | Testnets (opt-in via `network`) |
|---|---|---|
| Deploy | ethereum · base · arbitrum · optimism · polygon · bsc · avalanche · blast · linea · scroll | sepolia · base-sepolia · arbitrum-sepolia · optimism-sepolia · polygon-amoy · bsc-testnet |
| DEX | ethereum · base · arbitrum · optimism · polygon · bsc · avalanche · blast · linea · scroll · solana | n/a — OpenOcean + Jupiter are mainnet-only |
| DeFi | ethereum · base · arbitrum · optimism · polygon · bsc · avalanche (Aave); ethereum (Lido + EigenLayer) | n/a — these protocols only exist on mainnet |

If the user says "test", "testnet", "dry run", or names a testnet chain (e.g. "sepolia"), pass `network: "sepolia"` and skip the ack. Otherwise the call is mainnet.

## Tier 2: Contract deployment (v1.3, 5 tools)

The mandatory pipeline (enforced by `chaingpt-deploy` skill):

```text
chaingpt_generate_contract       (optional — from a natural-language description)
       │
       ▼
chaingpt_audit_contract          MANDATORY for mainnet. Costs 1 credit. Never skip.
       │
       ▼
chaingpt_deploy_compile          solc 0.8.x, returns bytecode + ABI
       │
       ▼
chaingpt_deploy_estimate         gas + USD cost preview
       │
       ▼
chaingpt_deploy_build_tx         REFUSES mainnet without acknowledgeMainnet=true
       │
       ▼
[user signs externally + broadcasts]
       │
       ▼
chaingpt_deploy_verify           submit source to Etherscan v2 multichain
       │
       ▼
chaingpt_deploy_verify_status    poll until ✓ Verified
```

Required env: `CHAINGPT_API_KEY` (for the audit step). Optional: `ETHERSCAN_API_KEY` (for verification — without it, verify returns a friendly hint).

### Key behaviors

- 10% gas-limit buffer added to `estimateGas` results.
- The build-tx refusal returns a 4-step checklist (audit / show cost / confirm args / confirm from-address) so the LLM is forced to surface the pre-flight before retry.
- Etherscan v2 verification works across all major EVM chains via one endpoint — the chain is specified by `chainid` query param.

## Tier 3a: DEX trading (v1.4, 5 tools)

Custody-free swap building.

```text
chaingpt_research_token            confirm you're swapping the token you think
chaingpt_risk_token                MANDATORY — honeypot check on the OUT token
chaingpt_dex_quote                 expected output, price impact, route
       │
       ▼
chaingpt_dex_approve_tx            if inToken is ERC-20 and allowance is insufficient
[user signs approval]
       │
       ▼
chaingpt_dex_build_swap_tx         REFUSES mainnet without ack
[user signs swap]
       │
       ▼
chaingpt_onchain_tx                confirm execution
```

Backends: **OpenOcean v4** for EVM (no API key), **Jupiter v6** for Solana (no API key).

OpenOcean Pathfinder router (canonical, same across EVM chains via CREATE2): `0x6352a56caadc4f1e25cd6c75970fa768a3304e64`. Used as the default spender by `chaingpt_dex_approve_tx`.

If `gasPriceGwei` is omitted on a DEX build/quote call, the tool fetches current gas via the chain's public RPC fallback chain — OpenOcean v4 requires `gasPrice` on every call so this can't be skipped.

### Honeypot refusal protocol

The `chaingpt-trade` skill REFUSES to build a swap tx outright if `chaingpt_risk_token` raises `is_honeypot` or `cannot_sell_all`, even with `acknowledgeMainnet: true`. The user must explicitly override the refusal in plain English.

## Tier 3d: DeFi protocols (v1.5, 7 tools)

Aave V3 across 7 chains + Lido stETH staking + EigenLayer restaking. Mandatory pre-flight via `chaingpt_defi_aave_health` before any borrow or withdraw.

### Aave V3 Pool addresses

| Chain | Pool |
|---|---|
| ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| arbitrum / optimism / polygon / avalanche | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` (same address via CREATE2) |
| bsc | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` |

### Lido + EigenLayer (Ethereum mainnet only)

- **Lido stETH**: `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`. Send native ETH via `submit(referral)`. stETH **rebases** — the balance grows daily; don't store the staked amount as a static balance.
- **EigenLayer StrategyManager**: `0x858646372CC42E1A627fcE94aa7A7033e7CF075A`. Call `depositIntoStrategy(strategy, token, amount)`. **7-day withdrawal queue** — funds are illiquid for a week after deposit.

Common EigenLayer strategies:
- stETH: `0x93c4b944D05dfe6df7645A86cd2206016c51564D`
- rETH: `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2`
- cbETH: `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc`

### Health-factor read

`chaingpt_defi_aave_health` is free and read-only. Returns:
- Total collateral (USD)
- Total debt (USD)
- Available to borrow (USD)
- Current LTV %
- Liquidation threshold %
- Health factor (1.0 = liquidation imminent; ∞ if no debt)

Auto-warning when HF < 1.05. Surface this to the user before any borrow / withdraw.

## Unsigned transaction shape

All build-tx tools return an EIP-1559 transaction object:

```json
{
  "chainId": 8453,
  "to": "0x6352a56caadc4f1e25cd6c75970fa768a3304e64",
  "data": "0x90411a32…",
  "value": "0x0",
  "gas": "0x4c4b40",
  "maxFeePerGas": "0x...",
  "maxPriorityFeePerGas": "0x...",
  "type": "0x2"
}
```

For deploy specifically, `to: null` indicates contract creation.

The user pastes this into MetaMask's "send transaction" / Rabby's import-tx feature, or calls `wallet.sendTransaction(tx)` from a script.

## What this never does

- Custody anything. The plugin never sees a private key — there is **no** parameter for it on any tool, and any prompt asking for one should be refused.
- Execute autonomously. Every transaction requires an external user-controlled signature.
- Override the mainnet refusal silently. Even with `acknowledgeMainnet: true`, the refusal copy is logged so the user has a paper trail of what they confirmed.

## Optional API keys

| Env var | Unlocks | Where to get |
|---|---|---|
| `ETHERSCAN_API_KEY` | Contract verification + on-chain queries | https://etherscan.io/myapikey (free) |
| `CHAINGPT_API_KEY` | Audit step in deploy pipeline; intel-token news fetch | https://app.chaingpt.org |
