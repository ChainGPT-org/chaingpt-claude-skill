# Wallet signing contract and migration

Version 1.23 changes the signing API. Unsigned builders remain available for external wallets.
No release or funded-chain acceptance is implied by the offline tests.

## Enable deliberately

A new policy has `killSwitch: true`, Solana/Tron disabled and ERC-4337 disabled.
Existing policy files are not silently rewritten. Every load validates the full schema;
string booleans, negative limits, unknown fields and malformed asset rules fail closed.
An administrator should review existing funds, outstanding approvals and pending transactions
before enabling the updated signer. Presets are explicit administrative opt-ins, not first-run defaults.

Restricted signing supports:

| Surface | Supported autonomous operations |
| --- | --- |
| EVM / ERC-4337 inner calls | Native transfers to non-contract recipients; exact ERC-20 `transfer` and bounded `approve` |
| Solana | One direct SOL or SPL `transferChecked`, optionally with ComputeBudget instructions; no lookup tables or opaque CPIs |
| Tron | Native TRX or structured TRC-20 transfers; generic contract calls require external signing |

DEX, lending and other opaque protocol transactions must use the unsigned builder and external
signing until a reviewed adapter can bind their complete asset effects. Existing `unrestricted`
mode remains an explicit administrator opt-out from per-operation limits. It does not provide
bounded spending and is not the suggested workaround for an unsupported protocol.

Solana signing also requires administrator-verified `solana.genesisHashes` pins for each enabled
cluster. Compare the RPC genesis hash with the pin on signing calls, including custom RPC overrides.
A URL or a tool argument alone is not proof of cluster identity. Read-only address/balance views do
not require pins.

## Independent native and asset budgets

Native limits include conservative fee reservations: EVM gas times maximum fee, Solana's
observed fee-payer decrease with a direct-transfer-plus-message-fee floor, and Tron energy
`fee_limit` plus bandwidth and activation prices from current chain parameters. Reservations
may overcount actual costs. Tron pricing assumes the queried protocol prices remain applicable
until inclusion; governance changes require reconciliation/repricing. EVM wei, Solana lamports
and Tron SUN never share a total. Native budgets alone do not authorize token spending.

Configure explicit `assetLimits` in the admin policy, with amounts in **base units**:

```json
{
  "version": 1,
  "killSwitch": false,
  "allowedChains": [8453],
  "allowedToAddresses": ["0x1111111111111111111111111111111111111111"],
  "maxTxValueWei": "10000000000000000",
  "maxDailySpendWei": "30000000000000000",
  "maxDailyTxCount": 5,
  "requireMemo": true,
  "assetLimits": [{
    "chain": "base",
    "asset": "0x1111111111111111111111111111111111111111",
    "allowedRecipients": ["0x2222222222222222222222222222222222222222"],
    "maxTxAmount": "1000000",
    "maxDailyAmount": "3000000"
  }]
}
```

These are dummy addresses, not a recommended token or destination. EVM asset and recipient
addresses must be lowercase. Tron addresses retain their case and use chain `tron-mainnet`,
`tron-shasta` or `tron-nile`. Solana rules use `solana-mainnet`, `solana-devnet` or
`solana-testnet`; asset is the mint address, or `SOL`. SPL recipients are the exact destination
**token account** addresses, not their wallet owners. SOL recipients are wallet addresses.
Approvals consume the approved amount from the token budget; unlimited approvals are refused.
Token rules authorize a trusted contract implementation. Decoding a selector does not prove that
an unreviewed/malicious token (or an upgraded proxy) cannot perform additional actions. Review token
contracts and existing approvals; these limits bind signed intent, not arbitrary malicious contract code.

## One operation, one identity

Every agent signer requires `operationId`: 1–180 safe characters, unique to one logical action.
Use the same id and same intent for every retry. A reused id with a changed intent is refused.
EVM endpoint fallback broadcasts identical bytes with the same nonce and hash. Solana signs the
exact simulated message once. A stale blockhash fails safely and needs reconciliation.

Before signing, the process takes an exclusive filesystem lock and fsyncs a reservation under
`signing-reservations/`, beside the activity ledger. It persists signed bytes and the expected
hash before broadcast. Persistence errors prevent sending. Logging for the dashboard is separate
from this safety state. All signers use the same lock, including different chains and processes.

Uncertain operations remain reserved indefinitely. Reservations with observed chain finality consume the rolling
24-hour budget from the time finality is observed. Repeating the original operation can
query its receipt and mark it confirmed; it never creates or signs another transaction. A missing
receipt, timeout, corrupt ledger or disk failure never restores allowance automatically.
ERC-4337 reconciliation verifies the matching `UserOperationEvent` from the configured
EntryPoint in the canonical transaction receipt; a bundler's claim alone cannot age out a hold.

## Recovery

1. Engage the kill switch and stop all signer/scheduler processes before administrative recovery.
2. Inspect the operation hash through an independent chain explorer/RPC. Distinguish confirmed,
   reverted, pending and provably expired/dropped transactions. A timeout is not proof of failure.
3. Restart and re-call the same operation with its original id to reconcile a known receipt.
   Some policy gates may require an administrator to restore the intended policy first; no new
   signature should be authorized merely to retrieve a receipt.
4. A process crash can leave `signing-reservations/.lock`. Only the administrator may remove it,
   after confirming no signer still holds it and reconciling all prepared/broadcast operations.
5. An operation reserved before a crash but without a persisted hash requires manual investigation.
   Preserve a backup and reconcile the wallet nonce/signature history before correcting local state.
   Never delete or reset journals merely to regain allowance. Escalate unresolved outcomes.

Journal files contain sensitive signed authorization bytes. Keep the directory private; never
upload it, paste it into chat, add it to source control, or print signed bytes in diagnostics.

## Scheduled execution

Call `chaingpt_strategy_due_steps name=<plan> claim=true` before autonomous execution. Claims
are fsynced under a filesystem lock and include a stable `operationId`. Pass that exact id to
the signer. A claimed step stays in flight after a crash and is never returned as a fresh due
action. Reconcile using the same id; do not invent a replacement. Mark the result only after
obtaining its transaction hash. Completed execution records cannot be overwritten. Plans with
execution history cannot be replaced, and plans with in-flight claims cannot be deleted.

These controls provide at-most-once signing per operation id. They cannot infer that two distinct
ids represent the same human intention, guarantee external-wallet execution, or make an arbitrary
scheduler exactly-once. Keep the confirmation hook enabled; unattended signing needs a separately
reviewed executor and approval boundary.

## Threat boundary

The MCP signing policy assumes the caller cannot edit wallet files, access the OS keychain,
execute arbitrary host commands or administer the dashboard. A coding agent with host access
needs OS-level isolation from the signer and secrets. Dashboard tokens returned by administration
tools are privileged. Host compromise defeats the local policy; ERC-4337 on-chain session-cap
support remains beta until the published live acceptance loop exists.

Audit-before-deploy and protocol risk checks are workflow requirements. The unsigned deployment
builder's acknowledgment flag does not prove that its bytecode passed an audit. Solidity example
compilation proves compilation only.
